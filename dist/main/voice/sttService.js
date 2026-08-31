"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sttService = exports.DETECTOR_FRAME_SAMPLES = void 0;
const DEFAULT_VAD = {
    sampleRate: 16000,
    rmsSpeechThreshold: 0.008,
    silenceMsToFinalize: 700,
    minUtteranceMs: 250,
    maxUtteranceMs: 15000,
    partialMinBufferedMs: 1500,
    partialMinNewMs: 800,
};
/**
 * Audio kept from just before speech onset so the first syllable of a quiet
 * start is never clipped out of the utterance handed to the STT engine.
 */
const PRE_ROLL_MS = 300;
/** Frame size fed to a neural speech detector (Silero VAD v5 standard). */
exports.DETECTOR_FRAME_SAMPLES = 512;
function rms(chunk) {
    if (chunk.length === 0)
        return 0;
    let sum = 0;
    for (let i = 0; i < chunk.length; i++)
        sum += chunk[i] * chunk[i];
    return Math.sqrt(sum / chunk.length);
}
class SttService {
    engines = new Map();
    activeEngineId = 'whisper';
    /**
     * N-08: per-session engine override. beginCommandListening points this at a
     * registered cloud-STT engine id when a cloud provider is the active speech
     * engine; it never touches the user's saved local toggle (activeEngineId),
     * so the Settings toggle keeps reflecting the real choice.
     */
    sessionEngineOverride = null;
    sink = null;
    sessionActive = false;
    captureConfirmed = false;
    buffer = [];
    bufferedSamples = 0;
    speechStartedAt = null;
    lastVoiceAt = 0;
    vad = { ...DEFAULT_VAD };
    /**
     * Optional neural speech detector (Silero VAD). When null, the legacy
     * synchronous RMS energy threshold decides speech — which is also the
     * graceful fallback if the neural model fails to load or run.
     */
    detector = null;
    // Neural-detector pipeline state (async pump over incoming chunks).
    pendingChunks = [];
    pumpRunning = false;
    pumpSessionId = 0;
    frameRemainder = [];
    frameRemainderSamples = 0;
    // Pre-roll ring buffer: last PRE_ROLL_MS of audio, flushed into the
    // utterance buffer the moment the detector says speech started.
    preRoll = new Float32Array(0);
    preRollFill = 0;
    // Streaming partials: interim transcriptions of in-progress speech.
    partialTranscribedSamples = 0;
    partialInFlight = false;
    /** Bumped whenever an utterance ends/resets; stale partials are discarded. */
    utteranceGeneration = 0;
    /**
     * Adaptive noise floor (RMS path): a slow EMA of ambient level measured
     * while no speech is active. The speech threshold floats above it, so the
     * same code works in a quiet room and next to a fan. Clamped so a dead-silent
     * room doesn't become hair-trigger and a loud room doesn't go deaf.
     */
    noiseFloorRms = 0.005;
    static NOISE_FLOOR_MULTIPLIER = 3;
    static MIN_SPEECH_RMS = 0.02;
    static MAX_SPEECH_RMS = 0.12;
    // Loud-duration gate: an utterance must contain at least this much audio
    // above the speech threshold to be worth transcribing — kills the
    // "one noisy chunk triggered it, whisper hallucinated [BLANK_AUDIO]" class.
    utteranceLoudSamples = 0;
    static MIN_LOUD_UTTERANCE_MS = 150;
    // EF-04 Symptom B: if the user opens the mic but never speaks, the session
    // must resolve to a clear "didn't catch that" state instead of hanging
    // indefinitely. This timer fires when no speech has started within the
    // window; once speech starts it is cancelled (the silence-to-finalize logic
    // takes over from there).
    noSpeechTimer = null;
    static NO_SPEECH_TIMEOUT_MS = 8000;
    configure(sink, vad) {
        this.sink = sink;
        this.vad = { ...DEFAULT_VAD, ...vad };
    }
    /**
     * Installs (or clears) the neural speech detector. Passing null reverts to
     * RMS energy detection. Safe to call mid-session; takes effect on the next
     * incoming chunk.
     */
    setSpeechDetector(detector) {
        this.detector = detector;
        this.pendingChunks = [];
        this.frameRemainder = [];
        this.frameRemainderSamples = 0;
        if (!detector)
            this.preRollFill = 0;
    }
    hasNeuralVad() {
        return this.detector !== null;
    }
    registerEngine(engine) {
        this.engines.set(engine.id, engine);
    }
    unregisterEngine(id) {
        this.engines.delete(id);
    }
    setActiveEngine(id) {
        this.activeEngineId = id;
    }
    getActiveEngine() {
        return this.activeEngineId;
    }
    /** Points the next session at a cloud engine id, or clears back to local. */
    setSessionEngine(id) {
        this.sessionEngineOverride = id;
    }
    effectiveEngineId() {
        return this.sessionEngineOverride ?? this.activeEngineId;
    }
    isSessionActive() {
        return this.sessionActive;
    }
    startSession() {
        this.resetBuffer();
        this.pumpSessionId++;
        this.preRoll = new Float32Array((this.vad.sampleRate * PRE_ROLL_MS) / 1000);
        this.preRollFill = 0;
        this.detector?.reset();
        this.sessionActive = true;
        this.captureConfirmed = false;
        this.scheduleNoSpeechTimeout();
        return { started: true, engine: this.activeEngineId };
    }
    stopSession(flushPending = true) {
        const wasActive = this.sessionActive;
        this.sessionActive = false;
        this.pumpSessionId++;
        this.captureConfirmed = false;
        this.clearNoSpeechTimeout();
        this.sessionEngineOverride = null;
        if (wasActive && flushPending) {
            void this.finalizeUtterance();
        }
        else {
            this.resetBuffer();
        }
    }
    /**
     * EF-04 Symptom B: arms the "no speech" watchdog for the whole session. If
     * no speech has started before it fires, the session resolves to a clear
     * "didn't catch that" error and stops rather than hanging on silence.
     */
    scheduleNoSpeechTimeout() {
        this.clearNoSpeechTimeout();
        this.noSpeechTimer = setTimeout(() => {
            this.noSpeechTimer = null;
            if (!this.sessionActive || this.speechStartedAt !== null)
                return;
            // Guard: an impartial backend may have reset the buffer right as the
            // timer fired — only stop if we're still in a live, silent session.
            if (!this.sessionActive)
                return;
            this.sessionActive = false;
            this.captureConfirmed = false;
            this.resetBuffer();
            this.sink?.onVoiceError({
                code: 'no_speech_detected',
                message: "Didn't catch that — I couldn't hear any speech. Try again, or type your request in the command bar.",
            });
        }, SttService.NO_SPEECH_TIMEOUT_MS);
    }
    clearNoSpeechTimeout() {
        if (this.noSpeechTimer) {
            clearTimeout(this.noSpeechTimer);
            this.noSpeechTimer = null;
        }
    }
    handleCaptureStarted() {
        this.captureConfirmed = true;
    }
    handleCaptureFailed(error) {
        this.sessionActive = false;
        this.captureConfirmed = false;
        this.clearNoSpeechTimeout();
        this.resetBuffer();
        this.sink?.onVoiceError(error);
    }
    isCaptureConfirmed() {
        return this.captureConfirmed;
    }
    feedAudioChunk(chunk) {
        if (!this.sessionActive || chunk.length === 0)
            return;
        const now = Date.now();
        const level = rms(chunk);
        const threshold = this.effectiveSpeechThreshold();
        const loud = level >= threshold;
        // Track the ambient floor only while no speech is in progress, so the
        // user's own voice never raises the bar against themselves.
        if (this.speechStartedAt === null && !loud) {
            this.noiseFloorRms = 0.9 * this.noiseFloorRms + 0.1 * level;
        }
        // Rolling pre-speech audio, flushed into the utterance if the neural
        // detector later says speech started (covers quiet word onsets).
        this.writePreRoll(chunk);
        // Neural path: chunks are queued and processed frame-by-frame through the
        // detector by an async pump (inference is asynchronous).
        if (this.detector) {
            this.pendingChunks.push(chunk);
            if (!this.pumpRunning)
                void this.runDetectorPump();
            return;
        }
        // Legacy RMS path (synchronous, also the neural fallback): every chunk
        // during the session is buffered so nothing ahead of the trigger is lost.
        if (loud) {
            this.utteranceLoudSamples += chunk.length;
            if (this.speechStartedAt === null) {
                this.speechStartedAt = now;
                this.clearNoSpeechTimeout();
            }
            this.lastVoiceAt = now;
        }
        this.buffer.push(chunk);
        this.bufferedSamples += chunk.length;
        if (this.speechStartedAt === null)
            return;
        const bufferedMs = (this.bufferedSamples / this.vad.sampleRate) * 1000;
        const msSinceLastVoice = now - this.lastVoiceAt;
        this.maybeQueuePartialTranscription();
        if (msSinceLastVoice >= this.vad.silenceMsToFinalize ||
            bufferedMs >= this.vad.maxUtteranceMs) {
            void this.finalizeUtterance();
        }
    }
    effectiveSpeechThreshold() {
        const floating = this.noiseFloorRms * SttService.NOISE_FLOOR_MULTIPLIER;
        return Math.min(Math.max(floating, SttService.MIN_SPEECH_RMS, this.vad.rmsSpeechThreshold), SttService.MAX_SPEECH_RMS);
    }
    /**
     * Neural-detector pipeline: drains queued chunks in order, slicing them
     * into fixed-size frames for the detector. Only audio from speech onset
     * (+ pre-roll) is buffered, unlike the RMS path.
     */
    async runDetectorPump() {
        this.pumpRunning = true;
        const sessionId = this.pumpSessionId;
        try {
            while (this.pendingChunks.length > 0 && this.sessionActive) {
                const chunk = this.pendingChunks.shift();
                for (const frame of this.sliceIntoFrames(chunk)) {
                    if (!this.sessionActive || sessionId !== this.pumpSessionId) {
                        this.pendingChunks = [];
                        this.frameRemainder = [];
                        this.frameRemainderSamples = 0;
                        return;
                    }
                    let isSpeech;
                    try {
                        // A rejected promise must land here too — async detectors never
                        // throw synchronously, so the await has to be inside the try.
                        const result = this.detector ? this.detector.process(frame) : true;
                        isSpeech = typeof result === 'boolean' ? result : await result;
                    }
                    catch (err) {
                        this.degradeToRms(err);
                        return;
                    }
                    if (!this.sessionActive || sessionId !== this.pumpSessionId) {
                        this.pendingChunks = [];
                        return;
                    }
                    this.applyDetectorVerdict(isSpeech, frame);
                }
            }
        }
        finally {
            this.pumpRunning = false;
        }
    }
    applyDetectorVerdict(isSpeech, frame) {
        const now = Date.now();
        if (isSpeech && this.speechStartedAt === null) {
            this.speechStartedAt = now;
            this.clearNoSpeechTimeout();
            this.flushPreRollIntoBuffer();
        }
        if (isSpeech) {
            this.lastVoiceAt = now;
            this.utteranceLoudSamples += frame.length;
        }
        // Buffer only once speech has started; pre-roll covers the onset.
        if (this.speechStartedAt !== null) {
            this.buffer.push(frame);
            this.bufferedSamples += frame.length;
        }
        if (this.speechStartedAt === null)
            return;
        const bufferedMs = (this.bufferedSamples / this.vad.sampleRate) * 1000;
        const msSinceLastVoice = now - this.lastVoiceAt;
        this.maybeQueuePartialTranscription();
        if (msSinceLastVoice >= this.vad.silenceMsToFinalize ||
            bufferedMs >= this.vad.maxUtteranceMs) {
            void this.finalizeUtterance();
        }
    }
    /**
     * Emits interim transcripts while speech is still in progress (STT
     * upgrade step 1c), so the command bar can show live text. Partials are
     * display-only: they never route through biometric gating or command
     * handling — only the final utterance does.
     */
    maybeQueuePartialTranscription() {
        if (!this.sink || this.partialInFlight || this.bufferedSamples === 0)
            return;
        const bufferedMs = (this.bufferedSamples / this.vad.sampleRate) * 1000;
        const newMs = ((this.bufferedSamples - this.partialTranscribedSamples) / this.vad.sampleRate) * 1000;
        const firstPartialReady = this.partialTranscribedSamples === 0 && bufferedMs >= this.vad.partialMinBufferedMs;
        const nextPartialReady = this.partialTranscribedSamples > 0 && newMs >= this.vad.partialMinNewMs;
        if (!firstPartialReady && !nextPartialReady)
            return;
        void this.runPartialTranscription();
    }
    async runPartialTranscription() {
        const generation = this.utteranceGeneration;
        const parts = this.buffer.slice();
        const samples = this.bufferedSamples;
        this.partialInFlight = true;
        try {
            // Snapshot the buffer so ongoing capture isn't disturbed by the
            // transcription pass running on its own copy.
            const merged = new Float32Array(samples);
            let offset = 0;
            for (const part of parts) {
                merged.set(part, offset);
                offset += part.length;
            }
            const engine = this.engines.get(this.effectiveEngineId());
            if (!engine)
                return;
            const text = await engine.transcribe(merged);
            if (generation !== this.utteranceGeneration || !this.sessionActive)
                return;
            const trimmed = text.trim();
            if (trimmed.length === 0)
                return;
            this.partialTranscribedSamples = samples;
            this.sink?.onTranscript(trimmed, false);
        }
        catch {
            // Interim failures are non-fatal — the final pass surfaces real
            // errors through the normal channel.
        }
        finally {
            this.partialInFlight = false;
        }
    }
    /** Neural detection failed permanently — fall back to RMS and drain what's queued. */
    degradeToRms(err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`[sttService] neural voice-activity detector unavailable, falling back to volume-based detection: ${message}`);
        this.detector = null;
        this.pendingChunks = [];
        this.frameRemainder = [];
        this.frameRemainderSamples = 0;
        this.preRollFill = 0;
    }
    *sliceIntoFrames(chunk) {
        let offset = 0;
        // Keep going while raw chunk data remains OR a complete frame is already
        // assembled — a ready frame must never wait for the next chunk.
        while (offset < chunk.length ||
            this.frameRemainderSamples >= exports.DETECTOR_FRAME_SAMPLES) {
            if (this.frameRemainderSamples >= exports.DETECTOR_FRAME_SAMPLES) {
                yield this.takeFrame();
            }
            else {
                const space = exports.DETECTOR_FRAME_SAMPLES - this.frameRemainderSamples;
                const take = Math.min(space, chunk.length - offset);
                this.frameRemainder.push(chunk.subarray(offset, offset + take));
                this.frameRemainderSamples += take;
                offset += take;
            }
        }
    }
    takeFrame() {
        const frame = new Float32Array(exports.DETECTOR_FRAME_SAMPLES);
        let filled = 0;
        while (filled < exports.DETECTOR_FRAME_SAMPLES && this.frameRemainder.length > 0) {
            const part = this.frameRemainder[0];
            const take = Math.min(part.length, exports.DETECTOR_FRAME_SAMPLES - filled);
            frame.set(part.subarray(0, take), filled);
            filled += take;
            if (take < part.length) {
                this.frameRemainder[0] = part.subarray(take);
            }
            else {
                this.frameRemainder.shift();
            }
            this.frameRemainderSamples -= take;
        }
        return frame;
    }
    writePreRoll(chunk) {
        if (this.preRoll.length === 0)
            return;
        if (chunk.length >= this.preRoll.length) {
            this.preRoll.set(chunk.subarray(chunk.length - this.preRoll.length));
            this.preRollFill = this.preRoll.length;
            return;
        }
        const overflow = this.preRollFill + chunk.length - this.preRoll.length;
        if (overflow > 0) {
            this.preRoll.copyWithin(0, overflow, this.preRollFill);
            this.preRollFill -= overflow;
        }
        this.preRoll.set(chunk, this.preRollFill);
        this.preRollFill += chunk.length;
    }
    flushPreRollIntoBuffer() {
        if (this.preRoll.length === 0 || this.preRollFill === 0)
            return;
        const heldAudio = this.preRoll.slice(this.preRoll.length - this.preRollFill, this.preRoll.length);
        this.buffer.push(heldAudio);
        this.bufferedSamples += heldAudio.length;
        this.preRollFill = 0;
    }
    async finalizeUtterance() {
        const parts = this.buffer;
        const samples = this.bufferedSamples;
        const speechStartedAt = this.speechStartedAt;
        this.resetBuffer();
        if (speechStartedAt === null || samples === 0)
            return;
        const durationMs = (samples / this.vad.sampleRate) * 1000;
        if (durationMs < this.vad.minUtteranceMs) {
            return;
        }
        const merged = new Float32Array(samples);
        let offset = 0;
        for (const part of parts) {
            merged.set(part, offset);
            offset += part.length;
        }
        const engine = this.engines.get(this.effectiveEngineId());
        if (!engine) {
            this.sink?.onVoiceError({
                code: 'stt_engine_unavailable',
                message: 'The selected speech engine is not available. Pick another engine in Settings, or type your request in the command bar.',
            });
            return;
        }
        try {
            const text = await engine.transcribe(merged);
            const trimmed = text.trim();
            if (trimmed.length > 0) {
                if (this.sink?.onUtteranceFinalized) {
                    this.sink.onUtteranceFinalized(merged, trimmed);
                }
                else {
                    this.sink?.onTranscript(trimmed, true);
                }
            }
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this.sink?.onVoiceError({ code: 'stt_engine_error', message });
        }
    }
    resetBuffer() {
        this.buffer = [];
        this.bufferedSamples = 0;
        this.speechStartedAt = null;
        this.lastVoiceAt = 0;
        this.pendingChunks = [];
        this.frameRemainder = [];
        this.frameRemainderSamples = 0;
        // Any in-flight interim transcription now belongs to a dead utterance.
        this.utteranceGeneration++;
        this.partialTranscribedSamples = 0;
    }
}
exports.sttService = new SttService();
