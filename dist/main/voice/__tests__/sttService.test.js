"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const sttService_1 = require("../sttService");
function makeSink() {
    return {
        onTranscript: vitest_1.vi.fn(),
        onVoiceError: vitest_1.vi.fn(),
    };
}
function fakeEngine(transcript = 'hello world') {
    const transcribeMock = vitest_1.vi.fn(async (_pcm) => transcript);
    const engine = { id: 'whisper', transcribe: transcribeMock };
    return { engine, transcribeMock };
}
function loudChunk(ms = 100) {
    const samples = new Float32Array((16000 * ms) / 1000);
    for (let i = 0; i < samples.length; i++)
        samples[i] = i % 2 === 0 ? 0.5 : -0.5;
    return samples;
}
function silentChunk(ms = 100) {
    return new Float32Array((16000 * ms) / 1000);
}
async function waitFor(predicate, timeoutMs = 500) {
    const start = Date.now();
    while (!predicate()) {
        if (Date.now() - start > timeoutMs)
            throw new Error('condition not met in time');
        await new Promise(r => setTimeout(r, 5));
    }
}
(0, vitest_1.beforeEach)(() => {
    sttService_1.sttService.configure(makeSink());
    sttService_1.sttService.setActiveEngine('whisper');
});
(0, vitest_1.describe)('sttService sessions', () => {
    (0, vitest_1.it)('starts a session for the active engine and reports which one', () => {
        sttService_1.sttService.setActiveEngine('system');
        (0, vitest_1.expect)(sttService_1.sttService.startSession()).toEqual({ started: true, engine: 'system' });
        (0, vitest_1.expect)(sttService_1.sttService.isSessionActive()).toBe(true);
        sttService_1.sttService.stopSession(false);
    });
    (0, vitest_1.it)('ignores audio chunks when no session is active', () => {
        const { engine, transcribeMock } = fakeEngine();
        sttService_1.sttService.registerEngine(engine);
        sttService_1.sttService.feedAudioChunk(loudChunk());
        (0, vitest_1.expect)(transcribeMock).not.toHaveBeenCalled();
    });
});
(0, vitest_1.describe)('sttService utterance segmentation', () => {
    (0, vitest_1.it)('finalizes a spoken utterance once silence follows, sending its final transcript', async () => {
        const sink = makeSink();
        sttService_1.sttService.configure(sink);
        const { engine, transcribeMock } = fakeEngine('open vs code please');
        sttService_1.sttService.registerEngine(engine);
        sttService_1.sttService.startSession();
        sttService_1.sttService.feedAudioChunk(silentChunk(300));
        sttService_1.sttService.feedAudioChunk(loudChunk(400));
        (0, vitest_1.expect)(transcribeMock).not.toHaveBeenCalled();
        await new Promise(resolve => setTimeout(resolve, 750));
        sttService_1.sttService.feedAudioChunk(silentChunk(50));
        await waitFor(() => transcribeMock.mock.calls.length === 1);
        await waitFor(() => sink.onTranscript.mock.calls.length > 0);
        const receivedPcm = transcribeMock.mock.calls[0][0];
        (0, vitest_1.expect)(receivedPcm.length).toBeGreaterThan((16000 * 400) / 1000);
        (0, vitest_1.expect)(sink.onTranscript).toHaveBeenCalledWith('open vs code please', true);
    });
    (0, vitest_1.it)('discards very short noise blips below the minimum utterance length', async () => {
        const { engine, transcribeMock } = fakeEngine();
        sttService_1.sttService.registerEngine(engine);
        sttService_1.sttService.startSession();
        sttService_1.sttService.feedAudioChunk(loudChunk(80));
        await new Promise(resolve => setTimeout(resolve, 750));
        await sttService_1.sttService.finalizeUtterance();
        (0, vitest_1.expect)(transcribeMock).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('force-flushes speech that runs past the maximum utterance window', () => {
        const { engine, transcribeMock } = fakeEngine();
        sttService_1.sttService.registerEngine(engine);
        sttService_1.sttService.configure(makeSink(), { maxUtteranceMs: 300 });
        sttService_1.sttService.startSession();
        sttService_1.sttService.feedAudioChunk(loudChunk(200));
        sttService_1.sttService.feedAudioChunk(loudChunk(200));
        (0, vitest_1.expect)(transcribeMock).toHaveBeenCalledTimes(1);
        sttService_1.sttService.stopSession(false);
    });
    (0, vitest_1.it)('flushes pending speech when the session stops', async () => {
        const { engine, transcribeMock } = fakeEngine('last words');
        sttService_1.sttService.registerEngine(engine);
        sttService_1.sttService.startSession();
        sttService_1.sttService.feedAudioChunk(loudChunk(500));
        sttService_1.sttService.stopSession();
        (0, vitest_1.expect)(transcribeMock).toHaveBeenCalledTimes(1);
    });
    (0, vitest_1.it)('never emits transcripts for pure silence', () => {
        const sink = makeSink();
        sttService_1.sttService.configure(sink);
        const { engine, transcribeMock } = fakeEngine();
        sttService_1.sttService.registerEngine(engine);
        sttService_1.sttService.startSession();
        sttService_1.sttService.feedAudioChunk(silentChunk(5000));
        sttService_1.sttService.stopSession();
        (0, vitest_1.expect)(transcribeMock).not.toHaveBeenCalled();
        (0, vitest_1.expect)(sink.onTranscript).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('surfaces an actionable error when no local engine matches the selection', async () => {
        const sink = makeSink();
        sttService_1.sttService.configure(sink);
        sttService_1.sttService.unregisterEngine('whisper');
        sttService_1.sttService.startSession();
        sttService_1.sttService.feedAudioChunk(loudChunk(400));
        await new Promise(resolve => setTimeout(resolve, 750));
        await sttService_1.sttService.finalizeUtterance();
        (0, vitest_1.expect)(sink.onVoiceError).toHaveBeenCalledWith(vitest_1.expect.objectContaining({
            code: 'stt_engine_unavailable',
            message: vitest_1.expect.stringMatching(/Settings|engine/i),
        }));
    });
    (0, vitest_1.it)('reports engine failures through the voice error channel instead of throwing', async () => {
        const sink = makeSink();
        sttService_1.sttService.configure(sink);
        sttService_1.sttService.registerEngine({
            id: 'whisper',
            transcribe: vitest_1.vi.fn(async () => {
                throw new Error('model exploded');
            }),
        });
        sttService_1.sttService.startSession();
        sttService_1.sttService.feedAudioChunk(loudChunk(400));
        await new Promise(resolve => setTimeout(resolve, 750));
        await sttService_1.sttService.finalizeUtterance();
        (0, vitest_1.expect)(sink.onVoiceError).toHaveBeenCalledWith(vitest_1.expect.objectContaining({ code: 'stt_engine_error' }));
    });
    (0, vitest_1.it)('captures microphone permission failures as voice errors', () => {
        const sink = makeSink();
        sttService_1.sttService.configure(sink);
        sttService_1.sttService.startSession();
        sttService_1.sttService.handleCaptureFailed({ code: 'mic_permission_denied', message: 'denied' });
        (0, vitest_1.expect)(sttService_1.sttService.isSessionActive()).toBe(false);
        (0, vitest_1.expect)(sink.onVoiceError).toHaveBeenCalledWith({
            code: 'mic_permission_denied',
            message: 'denied',
        });
    });
});
(0, vitest_1.describe)('sttService leading-silence watchdog (EF-04 Symptom B)', () => {
    (0, vitest_1.afterEach)(() => {
        vitest_1.vi.useRealTimers();
        sttService_1.sttService.stopSession(false);
    });
    (0, vitest_1.it)("resolves a silent session to a \"didn't catch that\" error instead of hanging", () => {
        vitest_1.vi.useFakeTimers();
        const sink = makeSink();
        sttService_1.sttService.configure(sink);
        sttService_1.sttService.startSession();
        (0, vitest_1.expect)(sttService_1.sttService.isSessionActive()).toBe(true);
        // Feed silence only — no speech ever starts.
        sttService_1.sttService.feedAudioChunk(silentChunk(500));
        vitest_1.vi.advanceTimersByTime(8001);
        (0, vitest_1.expect)(sttService_1.sttService.isSessionActive()).toBe(false);
        (0, vitest_1.expect)(sink.onVoiceError).toHaveBeenCalledWith(vitest_1.expect.objectContaining({
            code: 'no_speech_detected',
            message: vitest_1.expect.stringMatching(/didn't catch/i),
        }));
    });
    (0, vitest_1.it)('cancels the watchdog once real speech starts', () => {
        vitest_1.vi.useFakeTimers();
        const sink = makeSink();
        sttService_1.sttService.configure(sink, { silenceMsToFinalize: 120 });
        const { engine } = fakeEngine('spoken words');
        sttService_1.sttService.registerEngine(engine);
        sttService_1.sttService.startSession();
        sttService_1.sttService.feedAudioChunk(silentChunk(500));
        sttService_1.sttService.feedAudioChunk(loudChunk(500));
        // Even after a full watchdog window elapses, speech present = no error.
        vitest_1.vi.advanceTimersByTime(8001);
        (0, vitest_1.expect)(sink.onVoiceError).not.toHaveBeenCalled();
        (0, vitest_1.expect)(sttService_1.sttService.isSessionActive()).toBe(true);
    });
});
(0, vitest_1.describe)('sttService neural speech detector', () => {
    function fakeDetector(initialVerdict = false) {
        let verdict = initialVerdict;
        const processMock = vitest_1.vi.fn(async () => verdict);
        const detector = {
            process: processMock,
            reset: vitest_1.vi.fn(() => {
                verdict = initialVerdict;
            }),
            setVerdict(v) {
                verdict = v;
            },
            processMock,
        };
        return detector;
    }
    // Exact multiples of the 512-sample detector frame so every fed chunk is
    // fully processed with no cross-chunk remainder to race against.
    const SILENT_CHUNK_MS = 256; // 4096 samples = 8 frames
    const SPEECH_CHUNK_MS = 384; // 6144 samples = 12 frames
    (0, vitest_1.beforeEach)(() => {
        sttService_1.sttService.setSpeechDetector(null);
    });
    (0, vitest_1.it)('finalizes via the neural detector and includes pre-roll audio in the utterance', async () => {
        const sink = makeSink();
        sttService_1.sttService.configure(sink, { silenceMsToFinalize: 120 });
        const { engine, transcribeMock } = fakeEngine('neural vad works');
        sttService_1.sttService.registerEngine(engine);
        const detector = fakeDetector(false);
        sttService_1.sttService.setSpeechDetector(detector);
        sttService_1.sttService.startSession();
        // Leading quiet audio — must land in the pre-roll, not trigger speech.
        sttService_1.sttService.feedAudioChunk(silentChunk(SILENT_CHUNK_MS));
        await waitFor(() => detector.processMock.mock.calls.length === 8);
        await new Promise(resolve => setTimeout(resolve, 10));
        (0, vitest_1.expect)(sttService_1.sttService.hasNeuralVad()).toBe(true);
        // Speech starts.
        detector.setVerdict(true);
        sttService_1.sttService.feedAudioChunk(loudChunk(SPEECH_CHUNK_MS));
        await waitFor(() => detector.processMock.mock.calls.length === 20);
        await new Promise(resolve => setTimeout(resolve, 10));
        // Speech ends; after a quiet gap past the silence window, the next
        // chunk's frames finalize the utterance.
        detector.setVerdict(false);
        await new Promise(resolve => setTimeout(resolve, 200));
        sttService_1.sttService.feedAudioChunk(silentChunk(SILENT_CHUNK_MS));
        await waitFor(() => transcribeMock.mock.calls.length === 1);
        await waitFor(() => sink.onTranscript.mock.calls.length > 0);
        // Pre-roll (~300ms) + spoken audio (384ms) must all be present.
        const receivedPcm = transcribeMock.mock.calls[0][0];
        (0, vitest_1.expect)(receivedPcm.length).toBeGreaterThan((16000 * 600) / 1000);
        (0, vitest_1.expect)(sink.onTranscript).toHaveBeenCalledWith('neural vad works', true);
    });
    (0, vitest_1.it)('resets the detector state when a session starts', async () => {
        sttService_1.sttService.configure(makeSink());
        const detector = fakeDetector();
        sttService_1.sttService.setSpeechDetector(detector);
        sttService_1.sttService.startSession();
        (0, vitest_1.expect)(detector.reset).toHaveBeenCalled();
        sttService_1.sttService.stopSession(false);
    });
    (0, vitest_1.it)('falls back to RMS detection permanently if the neural detector errors', async () => {
        const sink = makeSink();
        sttService_1.sttService.configure(sink);
        const { engine } = fakeEngine('rms fallback');
        sttService_1.sttService.registerEngine(engine);
        sttService_1.sttService.setSpeechDetector({
            process: vitest_1.vi.fn(async () => {
                throw new Error('model exploded');
            }),
            reset: vitest_1.vi.fn(),
        });
        sttService_1.sttService.startSession();
        sttService_1.sttService.feedAudioChunk(loudChunk(400)); // kills the neural path
        await waitFor(() => !sttService_1.sttService.hasNeuralVad());
        // Subsequent audio flows through the legacy RMS path and still finalizes.
        sttService_1.sttService.feedAudioChunk(loudChunk(400));
        await new Promise(resolve => setTimeout(resolve, 750));
        sttService_1.sttService.feedAudioChunk(silentChunk(50));
        // Wait on the sink, not on transcribeMock — the mock records its call
        // synchronously at invocation, before the transcript is delivered.
        await waitFor(() => sink.onTranscript.mock.calls.length > 0);
        (0, vitest_1.expect)(sink.onTranscript).toHaveBeenCalledWith('rms fallback', true);
    });
});
(0, vitest_1.describe)('sttService streaming partial transcripts', () => {
    function scriptedEngine(responses) {
        const queue = [...responses];
        const transcribeMock = vitest_1.vi.fn(async () => queue.shift() ?? 'final words');
        const engine = { id: 'whisper', transcribe: transcribeMock };
        return { engine, transcribeMock };
    }
    (0, vitest_1.beforeEach)(() => {
        sttService_1.sttService.setSpeechDetector(null);
    });
    (0, vitest_1.it)('emits interim transcripts during ongoing speech, then a final one', async () => {
        const sink = makeSink();
        sttService_1.sttService.configure(sink, {
            silenceMsToFinalize: 120,
            partialMinBufferedMs: 300,
            partialMinNewMs: 300,
        });
        const { engine } = scriptedEngine(['interim words', 'final words']);
        sttService_1.sttService.registerEngine(engine);
        sttService_1.sttService.startSession();
        // RMS path: enough speech in one chunk to clear the partial threshold.
        sttService_1.sttService.feedAudioChunk(loudChunk(400));
        await waitFor(() => sink.onTranscript.mock.calls.some(([t, f]) => t === 'interim words' && f === false));
        // Speech ends; silence past the window finalizes with the next chunk.
        await new Promise(resolve => setTimeout(resolve, 200));
        sttService_1.sttService.feedAudioChunk(silentChunk(100));
        await waitFor(() => sink.onTranscript.mock.calls.some(([t, f]) => t === 'final words' && f === true));
        (0, vitest_1.expect)(sink.onVoiceError).not.toHaveBeenCalled();
        sttService_1.sttService.stopSession(false);
    });
    (0, vitest_1.it)('never emits interim transcripts below the minimum buffered duration', async () => {
        const sink = makeSink();
        sttService_1.sttService.configure(sink, { partialMinBufferedMs: 800 });
        const { engine } = scriptedEngine(['only final']);
        sttService_1.sttService.registerEngine(engine);
        sttService_1.sttService.startSession();
        sttService_1.sttService.feedAudioChunk(loudChunk(500));
        await new Promise(resolve => setTimeout(resolve, 750));
        sttService_1.sttService.feedAudioChunk(silentChunk(50));
        await waitFor(() => sink.onTranscript.mock.calls.length > 0);
        (0, vitest_1.expect)(sink.onTranscript).toHaveBeenCalledTimes(1);
        (0, vitest_1.expect)(sink.onTranscript).toHaveBeenCalledWith('only final', true);
        sttService_1.sttService.stopSession(false);
    });
    (0, vitest_1.it)('discards an in-flight interim transcript once the utterance is reset', async () => {
        const sink = makeSink();
        sttService_1.sttService.configure(sink, { partialMinBufferedMs: 300 });
        let release;
        const gated = new Promise(resolve => {
            release = resolve;
        });
        let nextResponse = gated;
        const transcribeMock = vitest_1.vi.fn(async (_pcm) => {
            const response = nextResponse;
            nextResponse = Promise.resolve('late final');
            return response;
        });
        sttService_1.sttService.registerEngine({ id: 'whisper', transcribe: transcribeMock });
        sttService_1.sttService.startSession();
        sttService_1.sttService.feedAudioChunk(loudChunk(400)); // kicks off the gated interim pass
        // Ending the session without flushing invalidates the utterance.
        sttService_1.sttService.stopSession(false);
        release('should never be emitted');
        await new Promise(resolve => setTimeout(resolve, 50));
        (0, vitest_1.expect)(sink.onTranscript).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('emits interim transcripts on the neural-detector path too', async () => {
        const sink = makeSink();
        sttService_1.sttService.configure(sink, { partialMinBufferedMs: 300 });
        const { engine } = scriptedEngine(['neural interim', 'neural final']);
        sttService_1.sttService.registerEngine(engine);
        sttService_1.sttService.setSpeechDetector({
            process: vitest_1.vi.fn(async () => true),
            reset: vitest_1.vi.fn(),
        });
        sttService_1.sttService.startSession();
        sttService_1.sttService.feedAudioChunk(loudChunk(384));
        await waitFor(() => sink.onTranscript.mock.calls.some(([t, f]) => t === 'neural interim' && f === false));
        sttService_1.sttService.stopSession(true); // flushes -> final
        await waitFor(() => sink.onTranscript.mock.calls.length > 1);
        (0, vitest_1.expect)(sink.onTranscript).toHaveBeenLastCalledWith('neural final', true);
    });
});
