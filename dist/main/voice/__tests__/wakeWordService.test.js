"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const wakeWordService_1 = require("../wakeWordService");
const SAMPLE_RATE = 16000;
function loudChunk(ms = 400) {
    const samples = new Float32Array((SAMPLE_RATE * ms) / 1000);
    for (let i = 0; i < samples.length; i++)
        samples[i] = i % 2 === 0 ? 0.5 : -0.5;
    return samples;
}
function silentChunk(ms = 100) {
    return new Float32Array((SAMPLE_RATE * ms) / 1000);
}
async function settle() {
    // Flush pending microtasks and any due timers so async detection resolves.
    await vitest_1.vi.advanceTimersByTimeAsync(0);
}
(0, vitest_1.describe)('validateWakePhrase', () => {
    (0, vitest_1.it)('rejects an empty phrase outright', () => {
        const result = (0, wakeWordService_1.validateWakePhrase)('   ');
        (0, vitest_1.expect)(result.ok).toBe(false);
        (0, vitest_1.expect)(result.warnings.length).toBeGreaterThan(0);
    });
    (0, vitest_1.it)('accepts the default phrase with no warnings', () => {
        (0, vitest_1.expect)((0, wakeWordService_1.validateWakePhrase)(wakeWordService_1.DEFAULT_WAKE_PHRASE)).toEqual({ ok: true, warnings: [] });
    });
    (0, vitest_1.it)('warns (but does not block) for very short phrases', () => {
        const result = (0, wakeWordService_1.validateWakePhrase)('hey');
        (0, vitest_1.expect)(result.ok).toBe(true);
        (0, vitest_1.expect)(result.warnings.some(w => w.toLowerCase().includes('short'))).toBe(true);
    });
    (0, vitest_1.it)('warns for a single common word that would false-trigger often', () => {
        const result = (0, wakeWordService_1.validateWakePhrase)('okay');
        (0, vitest_1.expect)(result.ok).toBe(true);
        (0, vitest_1.expect)(result.warnings.some(w => w.toLowerCase().includes('common'))).toBe(true);
    });
    (0, vitest_1.it)('warns for impractically long phrases', () => {
        const result = (0, wakeWordService_1.validateWakePhrase)('hey kyclius please come here right now');
        (0, vitest_1.expect)(result.ok).toBe(true);
        (0, vitest_1.expect)(result.warnings.some(w => w.toLowerCase().includes('long'))).toBe(true);
    });
});
(0, vitest_1.describe)('transcriptContainsPhrase', () => {
    (0, vitest_1.it)('matches an exact spoken phrase inside a longer transcript', () => {
        (0, vitest_1.expect)((0, wakeWordService_1.transcriptContainsPhrase)('hey kyclius what time is it', 'Hey Kyclius')).toBe(true);
    });
    (0, vitest_1.it)('ignores case and punctuation', () => {
        (0, vitest_1.expect)((0, wakeWordService_1.transcriptContainsPhrase)("HEY, KYCLIUS!", 'hey kyclius')).toBe(true);
    });
    (0, vitest_1.it)('tolerates common misrecognitions of the phrase', () => {
        (0, vitest_1.expect)((0, wakeWordService_1.transcriptContainsPhrase)('so hey clius come over', 'Hey Kyclius')).toBe(true);
    });
    (0, vitest_1.it)('does not match unrelated speech', () => {
        (0, vitest_1.expect)((0, wakeWordService_1.transcriptContainsPhrase)('what time is it right now', 'Hey Kyclius')).toBe(false);
    });
    (0, vitest_1.it)('returns false for empty input', () => {
        (0, vitest_1.expect)((0, wakeWordService_1.transcriptContainsPhrase)('', 'Hey Kyclius')).toBe(false);
        (0, vitest_1.expect)((0, wakeWordService_1.transcriptContainsPhrase)('hello there', '')).toBe(false);
    });
    (0, vitest_1.it)('handles single-word phrases', () => {
        (0, vitest_1.expect)((0, wakeWordService_1.transcriptContainsPhrase)('is my computer ready', 'computer')).toBe(true);
        (0, vitest_1.expect)((0, wakeWordService_1.transcriptContainsPhrase)('nothing relevant here', 'computer')).toBe(false);
    });
});
(0, vitest_1.describe)('wakeWordService', () => {
    let transcribeMock;
    let onWakeDetected;
    let onStateChanged;
    let onError;
    let currentPhrase;
    let speaking;
    let sessionActive;
    function speechBurst() {
        // Speak, then go silent long enough to finalize a detection window.
        wakeWordService_1.wakeWordService.ingestChunk(loudChunk(400));
        vitest_1.vi.advanceTimersByTime(700);
        wakeWordService_1.wakeWordService.ingestChunk(silentChunk(100));
    }
    (0, vitest_1.beforeEach)(() => {
        vitest_1.vi.useFakeTimers();
        currentPhrase = 'Hey Kyclius';
        speaking = false;
        sessionActive = false;
        transcribeMock = vitest_1.vi.fn(async (_pcm) => 'weather looks nice today');
        onWakeDetected = vitest_1.vi.fn();
        onStateChanged = vitest_1.vi.fn();
        onError = vitest_1.vi.fn();
        wakeWordService_1.wakeWordService.configure({
            getPhrase: () => currentPhrase,
            transcribe: transcribeMock,
            onWakeDetected,
            onStateChanged,
            onError,
            isCommandSessionActive: () => sessionActive,
            isSpeaking: () => speaking,
        });
        // Force a clean on state regardless of what a previous test left behind.
        wakeWordService_1.wakeWordService.setEnabled(false);
        wakeWordService_1.wakeWordService.setEnabled(true);
    });
    (0, vitest_1.afterEach)(() => {
        wakeWordService_1.wakeWordService.reset();
        wakeWordService_1.wakeWordService.setEnabled(false);
        vitest_1.vi.useRealTimers();
    });
    (0, vitest_1.it)('starts enabled in the listening state', () => {
        (0, vitest_1.expect)(wakeWordService_1.wakeWordService.isEnabled()).toBe(true);
        (0, vitest_1.expect)(wakeWordService_1.wakeWordService.getState()).toBe('listening');
    });
    (0, vitest_1.it)('never runs detection while disabled', async () => {
        wakeWordService_1.wakeWordService.setEnabled(false);
        wakeWordService_1.wakeWordService.ingestChunk(loudChunk(500));
        vitest_1.vi.advanceTimersByTime(2000);
        wakeWordService_1.wakeWordService.ingestChunk(silentChunk(200));
        await settle();
        (0, vitest_1.expect)(transcribeMock).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('triggers once after speech followed by silence, then reverts to listening', async () => {
        transcribeMock.mockImplementation(async () => 'hey kyclius come here please');
        speechBurst();
        await settle();
        (0, vitest_1.expect)(transcribeMock).toHaveBeenCalledTimes(1);
        (0, vitest_1.expect)(onWakeDetected).toHaveBeenCalledWith('hey kyclius come here please');
        const states = onStateChanged.mock.calls.map(call => call[0]);
        (0, vitest_1.expect)(states).toContain('triggered');
        await vitest_1.vi.advanceTimersByTimeAsync(2600);
        (0, vitest_1.expect)(wakeWordService_1.wakeWordService.getState()).toBe('listening');
    });
    (0, vitest_1.it)('does not trigger when the transcript does not contain the phrase', async () => {
        speechBurst();
        await settle();
        (0, vitest_1.expect)(transcribeMock).toHaveBeenCalledTimes(1);
        (0, vitest_1.expect)(onWakeDetected).not.toHaveBeenCalled();
        (0, vitest_1.expect)(wakeWordService_1.wakeWordService.getState()).toBe('listening');
    });
    (0, vitest_1.it)('respects the cooldown before triggering again', async () => {
        transcribeMock.mockImplementation(async () => 'hey kyclius');
        speechBurst(); // t≈700ms — first trigger
        await settle();
        (0, vitest_1.expect)(onWakeDetected).toHaveBeenCalledTimes(1);
        vitest_1.vi.advanceTimersByTime(1000); // still well within cooldown
        speechBurst();
        await settle();
        (0, vitest_1.expect)(transcribeMock).toHaveBeenCalledTimes(1);
        vitest_1.vi.advanceTimersByTime(8000); // past the cooldown window
        speechBurst();
        await settle();
        (0, vitest_1.expect)(transcribeMock).toHaveBeenCalledTimes(2);
        (0, vitest_1.expect)(onWakeDetected).toHaveBeenCalledTimes(2);
    });
    (0, vitest_1.it)('pauses detection entirely while text-to-speech is playing', async () => {
        speaking = true;
        speechBurst();
        await settle();
        (0, vitest_1.expect)(transcribeMock).not.toHaveBeenCalled();
        speaking = false;
        speechBurst();
        await settle();
        (0, vitest_1.expect)(transcribeMock).toHaveBeenCalledTimes(1);
    });
    (0, vitest_1.it)('pauses detection while a command session is active', async () => {
        sessionActive = true;
        speechBurst();
        await settle();
        (0, vitest_1.expect)(transcribeMock).not.toHaveBeenCalled();
        sessionActive = false;
        speechBurst();
        await settle();
        (0, vitest_1.expect)(transcribeMock).toHaveBeenCalledTimes(1);
    });
    (0, vitest_1.it)('surfaces revoked microphone permission as unavailable, then recovers', async () => {
        const error = { code: 'mic_permission_denied', message: 'Mic denied.' };
        wakeWordService_1.wakeWordService.handleCaptureFailed(error);
        (0, vitest_1.expect)(onError).toHaveBeenCalledWith(error);
        (0, vitest_1.expect)(wakeWordService_1.wakeWordService.getState()).toBe('unavailable');
        // No detection attempts while unavailable.
        speechBurst();
        await settle();
        (0, vitest_1.expect)(transcribeMock).not.toHaveBeenCalled();
        // Renderer reports ambient capture working again -> back to listening.
        wakeWordService_1.wakeWordService.handleAmbientCaptureStarted();
        (0, vitest_1.expect)(wakeWordService_1.wakeWordService.getState()).toBe('listening');
        speechBurst();
        await settle();
        (0, vitest_1.expect)(transcribeMock).toHaveBeenCalledTimes(1);
    });
    (0, vitest_1.it)('ignores capture failures when background listening is off', () => {
        wakeWordService_1.wakeWordService.setEnabled(false);
        wakeWordService_1.wakeWordService.handleCaptureFailed({ code: 'mic_not_found', message: 'No mic.' });
        (0, vitest_1.expect)(onError).not.toHaveBeenCalled();
        (0, vitest_1.expect)(wakeWordService_1.wakeWordService.getState()).toBe('off');
    });
    (0, vitest_1.it)('stops immediately when disabled mid-stream', async () => {
        wakeWordService_1.wakeWordService.ingestChunk(loudChunk(300));
        wakeWordService_1.wakeWordService.setEnabled(false);
        (0, vitest_1.expect)(wakeWordService_1.wakeWordService.getState()).toBe('off');
        vitest_1.vi.advanceTimersByTime(5000);
        wakeWordService_1.wakeWordService.ingestChunk(loudChunk(400));
        vitest_1.vi.advanceTimersByTime(1000);
        wakeWordService_1.wakeWordService.ingestChunk(silentChunk(200));
        await settle();
        (0, vitest_1.expect)(transcribeMock).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('picks up a changed wake phrase without any restart or reconfigure', async () => {
        // The transcript contains the new phrase all along; only the configured
        // phrase changes, so a trigger proves the service re-read it live.
        transcribeMock.mockImplementation(async () => 'um hey kyclius are you there');
        currentPhrase = 'Jarvis help';
        speechBurst();
        await settle();
        (0, vitest_1.expect)(onWakeDetected).not.toHaveBeenCalled();
        currentPhrase = 'Hey Kyclius'; // Settings updated the stored phrase
        vitest_1.vi.advanceTimersByTime(2000); // clear min-detect interval
        speechBurst();
        await settle();
        (0, vitest_1.expect)(onWakeDetected).toHaveBeenCalledTimes(1);
    });
    (0, vitest_1.it)('keeps the rolling buffer bounded in memory', async () => {
        for (let i = 0; i < 40; i++) {
            wakeWordService_1.wakeWordService.ingestChunk(loudChunk(500)); // 20s of audio total
            await settle();
        }
        (0, vitest_1.expect)(wakeWordService_1.wakeWordService.getBufferedSampleCount()).toBeLessThanOrEqual(15 * SAMPLE_RATE);
    });
    (0, vitest_1.it)('throttles repeated transcription errors instead of spamming', async () => {
        transcribeMock.mockRejectedValue(new Error('whisper crashed'));
        speechBurst();
        await settle();
        (0, vitest_1.expect)(onError).toHaveBeenCalledTimes(1);
        (0, vitest_1.expect)(onError.mock.calls[0][0].code).toBe('stt_engine_error');
        vitest_1.vi.advanceTimersByTime(10_000); // same failure again, still throttled
        speechBurst();
        await settle();
        (0, vitest_1.expect)(onError).toHaveBeenCalledTimes(1);
        vitest_1.vi.advanceTimersByTime(60_000); // past the repeat window
        speechBurst();
        await settle();
        (0, vitest_1.expect)(onError).toHaveBeenCalledTimes(2);
    });
});
