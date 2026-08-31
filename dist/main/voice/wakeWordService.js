"use strict";
// Wake word background listener (F-09).
//
// Listens locally for a configured wake phrase (default "Hey Kyclius") using
// audio streamed in from the renderer's ambient capture. Everything here is
// in-memory only: the rolling audio buffer lives in RAM, is never written to
// disk, and never leaves the process — only transcribed TEXT is inspected,
// and transcription itself pipes an in-memory WAV over whisper.cpp stdin.
Object.defineProperty(exports, "__esModule", { value: true });
exports.wakeWordService = exports.DEFAULT_WAKE_PHRASE = void 0;
exports.validateWakePhrase = validateWakePhrase;
exports.transcriptContainsPhrase = transcriptContainsPhrase;
const DEFAULT_OPTIONS = {
    sampleRate: 16000,
    rmsSpeechThreshold: 0.008,
    silenceMsToDetect: 600,
    detectWindowSeconds: 8,
    maxBufferSeconds: 15,
    cooldownMs: 8000,
    minDetectIntervalMs: 1500,
    errorRepeatMs: 60_000,
};
exports.DEFAULT_WAKE_PHRASE = 'Hey Kyclius';
const COMMON_SINGLE_WORDS = new Set([
    'hey',
    'hi',
    'hello',
    'ok',
    'okay',
    'yo',
    'please',
    'kyclius',
    'assistant',
    'computer',
    'wake',
]);
function normalizeText(raw) {
    return String(raw ?? '')
        .toLowerCase()
        .replace(/[^a-z\s']/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}
function validateWakePhrase(phrase) {
    const warnings = [];
    const text = String(phrase ?? '').trim();
    if (text.length === 0) {
        return { ok: false, warnings: ['The wake phrase cannot be empty.'] };
    }
    if (text.length < 4) {
        warnings.push('This phrase is very short and may trigger accidentally. A longer phrase like "Hey Kyclius" works better.');
    }
    const normalizedTokens = normalizeText(text).split(' ').filter(Boolean);
    if (normalizedTokens.length === 1 && COMMON_SINGLE_WORDS.has(normalizedTokens[0])) {
        warnings.push('This is a very common word and will likely trigger often during normal conversation. Try a more distinctive phrase.');
    }
    if (normalizedTokens.length > 5) {
        warnings.push('Very long wake phrases are hard to say consistently. Consider something shorter.');
    }
    return { ok: true, warnings };
}
/**
 * Fuzzy check of whether a transcript contains the configured wake phrase.
 * Tolerates common misrecognitions ("Kyclius" -> "clius"/"kill cie us") by
 * comparing token-level similarity instead of requiring an exact substring.
 */
function transcriptContainsPhrase(transcript, phrase) {
    const spokenWords = normalizeText(transcript).split(' ').filter(Boolean);
    const phraseWords = normalizeText(phrase).split(' ').filter(Boolean);
    if (spokenWords.length === 0 || phraseWords.length === 0)
        return false;
    for (let start = 0; start <= spokenWords.length - phraseWords.length; start++) {
        let matched = 0;
        for (let i = 0; i < phraseWords.length; i++) {
            if (tokensClose(spokenWords[start + i], phraseWords[i]))
                matched++;
        }
        // Allow one sloppy token per multi-word phrase; single-word phrases must match exactly.
        const allowedMisses = phraseWords.length > 1 ? 1 : 0;
        if (matched >= phraseWords.length - allowedMisses)
            return true;
    }
    return false;
}
function tokensClose(a, b) {
    if (!a || !b)
        return false;
    if (a === b)
        return true;
    const shorter = Math.min(a.length, b.length);
    if (shorter < 3)
        return false;
    // Substring containment handles truncated recognitions ("clius" ⊂ "kyclius").
    if (a.includes(b) || b.includes(a))
        return true;
    return levenshteinWithin(a, b, Math.max(1, Math.floor(shorter / 3)));
}
function levenshteinWithin(a, b, maxDistance) {
    if (Math.abs(a.length - b.length) > maxDistance)
        return false;
    let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
        const current = [i];
        let rowMin = current[0];
        for (let j = 1; j <= b.length; j++) {
            const substitution = previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1);
            const value = Math.min(previous[j] + 1, current[j - 1] + 1, substitution);
            current.push(value);
            if (value < rowMin)
                rowMin = value;
        }
        if (rowMin > maxDistance)
            return false;
        previous = current;
    }
    return previous[b.length] <= maxDistance;
}
function rms(chunk) {
    if (chunk.length === 0)
        return 0;
    let sum = 0;
    for (let i = 0; i < chunk.length; i++)
        sum += chunk[i] * chunk[i];
    return Math.sqrt(sum / chunk.length);
}
class WakeWordService {
    deps = null;
    options = { ...DEFAULT_OPTIONS };
    enabled = false;
    state = 'off';
    buffer = [];
    bufferedSamples = 0;
    sawSpeechSinceLastDetect = false;
    lastLoudAt = 0;
    lastDetectAt = 0;
    lastTriggerAt = 0;
    detecting = false;
    lastErrorMessage = '';
    lastErrorAt = 0;
    revertTimer = null;
    configure(deps, options) {
        this.deps = deps;
        this.options = { ...DEFAULT_OPTIONS, ...options };
    }
    isEnabled() {
        return this.enabled;
    }
    getState() {
        return this.state;
    }
    /** Current size of the in-memory rolling buffer, in samples (test/introspection aid). */
    getBufferedSampleCount() {
        return this.bufferedSamples;
    }
    setEnabled(enabled) {
        if (enabled === this.enabled)
            return;
        this.enabled = enabled;
        if (enabled) {
            this.reset();
            this.setState('listening');
        }
        else {
            this.reset();
            this.setState('off');
        }
    }
    /** Called when the renderer confirms ambient mic capture is running. */
    handleAmbientCaptureStarted() {
        if (this.enabled && this.state === 'unavailable') {
            this.setState('listening');
        }
    }
    /** Called when the renderer reports mic capture failure (e.g. revoked permission). */
    handleCaptureFailed(error) {
        if (!this.enabled)
            return;
        this.reset();
        this.setState('unavailable');
        this.emitError(error);
    }
    ingestChunk(chunk) {
        if (!this.enabled || this.state === 'unavailable' || chunk.length === 0)
            return;
        if (this.isSuppressed()) {
            this.clearSpeechTracking();
            return;
        }
        this.appendChunk(chunk);
        const now = Date.now();
        if (rms(chunk) >= this.options.rmsSpeechThreshold) {
            this.sawSpeechSinceLastDetect = true;
            this.lastLoudAt = now;
        }
        if (!this.sawSpeechSinceLastDetect ||
            this.detecting ||
            now - this.lastLoudAt < this.options.silenceMsToDetect ||
            now - this.lastDetectAt < this.options.minDetectIntervalMs ||
            now - this.lastTriggerAt < this.options.cooldownMs) {
            return;
        }
        void this.runDetection();
    }
    reset() {
        this.buffer = [];
        this.bufferedSamples = 0;
        this.sawSpeechSinceLastDetect = false;
        this.lastLoudAt = 0;
        this.lastDetectAt = 0;
        this.lastTriggerAt = 0;
        this.detecting = false;
        this.lastErrorMessage = '';
        this.lastErrorAt = 0;
        if (this.revertTimer) {
            clearTimeout(this.revertTimer);
            this.revertTimer = null;
        }
    }
    isSuppressed() {
        return Boolean(this.deps?.isCommandSessionActive?.()) || Boolean(this.deps?.isSpeaking?.());
    }
    clearSpeechTracking() {
        this.sawSpeechSinceLastDetect = false;
        this.lastLoudAt = 0;
    }
    appendChunk(chunk) {
        this.buffer.push(chunk);
        this.bufferedSamples += chunk.length;
        const maxSamples = this.options.maxBufferSeconds * this.options.sampleRate;
        while (this.bufferedSamples > maxSamples && this.buffer.length > 1) {
            const dropped = this.buffer.shift();
            if (dropped)
                this.bufferedSamples -= dropped.length;
        }
    }
    /** Latest samples up to the detection window, merged into one contiguous array. */
    takeDetectionWindow() {
        const maxWindowSamples = Math.min(this.options.detectWindowSeconds, this.options.maxBufferSeconds) *
            this.options.sampleRate;
        const parts = [];
        let collected = 0;
        for (let i = this.buffer.length - 1; i >= 0 && collected < maxWindowSamples; i--) {
            const part = this.buffer[i];
            parts.unshift(part);
            collected += part.length;
        }
        if (collected > maxWindowSamples && parts.length > 0) {
            const overflow = collected - maxWindowSamples;
            const first = parts[0];
            parts[0] = first.subarray(Math.min(overflow, first.length));
        }
        const merged = new Float32Array(collected);
        let offset = 0;
        for (const part of parts) {
            merged.set(part, offset);
            offset += part.length;
        }
        return merged;
    }
    async runDetection() {
        const deps = this.deps;
        if (!deps || this.detecting || !this.enabled)
            return;
        this.detecting = true;
        this.lastDetectAt = Date.now();
        const window = this.takeDetectionWindow();
        try {
            const transcript = await deps.transcribe(window);
            const phrase = deps.getPhrase();
            if (this.enabled && transcriptContainsPhrase(transcript, phrase)) {
                this.lastTriggerAt = Date.now();
                this.setState('triggered');
                this.scheduleRevertToListening();
                deps.onWakeDetected?.(transcript.trim());
            }
        }
        catch (err) {
            this.emitThrottledError(err);
        }
        finally {
            this.detecting = false;
        }
    }
    scheduleRevertToListening() {
        if (this.revertTimer)
            clearTimeout(this.revertTimer);
        this.revertTimer = setTimeout(() => {
            this.revertTimer = null;
            if (this.enabled && this.state === 'triggered') {
                this.setState('listening');
            }
        }, 2500);
    }
    emitThrottledError(err) {
        const message = err instanceof Error ? err.message : String(err);
        const now = Date.now();
        if (message === this.lastErrorMessage && now - this.lastErrorAt < this.options.errorRepeatMs) {
            return;
        }
        this.lastErrorMessage = message;
        this.lastErrorAt = now;
        this.emitError(this.toWakeError(err));
    }
    toWakeError(err) {
        const name = err instanceof Error ? err.name : '';
        if (name === 'WhisperNotConfiguredError') {
            return {
                code: 'stt_engine_unavailable',
                message: 'Wake word listening needs a local speech engine. Configure whisper.cpp in Settings, or turn off background listening.',
            };
        }
        const message = err instanceof Error ? err.message : String(err);
        return { code: 'stt_engine_error', message };
    }
    emitError(error) {
        this.deps?.onError?.(error);
    }
    setState(state) {
        if (this.state === state)
            return;
        this.state = state;
        this.deps?.onStateChanged?.(state);
    }
}
exports.wakeWordService = new WakeWordService();
