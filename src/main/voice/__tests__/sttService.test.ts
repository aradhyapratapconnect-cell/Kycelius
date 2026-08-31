import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { sttService, type SttEngine } from '../sttService';
import type { SpeechDetector } from '../vad/sileroVad';

function makeSink() {
  return {
    onTranscript: vi.fn(),
    onVoiceError: vi.fn(),
  };
}

function fakeEngine(transcript = 'hello world') {
  const transcribeMock = vi.fn(async (_pcm: Float32Array) => transcript);
  const engine: SttEngine = { id: 'whisper', transcribe: transcribeMock };
  return { engine, transcribeMock };
}

function loudChunk(ms = 100): Float32Array {
  const samples = new Float32Array((16000 * ms) / 1000);
  for (let i = 0; i < samples.length; i++) samples[i] = i % 2 === 0 ? 0.5 : -0.5;
  return samples;
}

function silentChunk(ms = 100): Float32Array {
  return new Float32Array((16000 * ms) / 1000);
}

async function waitFor(predicate: () => boolean, timeoutMs = 500): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('condition not met in time');
    await new Promise(r => setTimeout(r, 5));
  }
}

beforeEach(() => {
  sttService.configure(makeSink());
  sttService.setActiveEngine('whisper');
});

describe('sttService sessions', () => {
  it('starts a session for the active engine and reports which one', () => {
    sttService.setActiveEngine('system');
    expect(sttService.startSession()).toEqual({ started: true, engine: 'system' });
    expect(sttService.isSessionActive()).toBe(true);
    sttService.stopSession(false);
  });

  it('ignores audio chunks when no session is active', () => {
    const { engine, transcribeMock } = fakeEngine();
    sttService.registerEngine(engine);
    sttService.feedAudioChunk(loudChunk());
    expect(transcribeMock).not.toHaveBeenCalled();
  });
});

describe('sttService utterance segmentation', () => {
  it('finalizes a spoken utterance once silence follows, sending its final transcript', async () => {
    const sink = makeSink();
    sttService.configure(sink);
    const { engine, transcribeMock } = fakeEngine('open vs code please');
    sttService.registerEngine(engine);

    sttService.startSession();
    sttService.feedAudioChunk(silentChunk(300));
    sttService.feedAudioChunk(loudChunk(400));

    expect(transcribeMock).not.toHaveBeenCalled();

    await new Promise(resolve => setTimeout(resolve, 750));
    sttService.feedAudioChunk(silentChunk(50));

    await waitFor(() => transcribeMock.mock.calls.length === 1);
    await waitFor(() => sink.onTranscript.mock.calls.length > 0);

    const receivedPcm = transcribeMock.mock.calls[0][0] as Float32Array;
    expect(receivedPcm.length).toBeGreaterThan((16000 * 400) / 1000);
    expect(sink.onTranscript).toHaveBeenCalledWith('open vs code please', true);
  });

  it('discards very short noise blips below the minimum utterance length', async () => {
    const { engine, transcribeMock } = fakeEngine();
    sttService.registerEngine(engine);

    sttService.startSession();
    sttService.feedAudioChunk(loudChunk(80));
    await new Promise(resolve => setTimeout(resolve, 750));
    await sttService.finalizeUtterance();

    expect(transcribeMock).not.toHaveBeenCalled();
  });

  it('force-flushes speech that runs past the maximum utterance window', () => {
    const { engine, transcribeMock } = fakeEngine();
    sttService.registerEngine(engine);
    sttService.configure(makeSink(), { maxUtteranceMs: 300 });

    sttService.startSession();
    sttService.feedAudioChunk(loudChunk(200));
    sttService.feedAudioChunk(loudChunk(200));

    expect(transcribeMock).toHaveBeenCalledTimes(1);
    sttService.stopSession(false);
  });

  it('flushes pending speech when the session stops', async () => {
    const { engine, transcribeMock } = fakeEngine('last words');
    sttService.registerEngine(engine);

    sttService.startSession();
    sttService.feedAudioChunk(loudChunk(500));
    sttService.stopSession();

    expect(transcribeMock).toHaveBeenCalledTimes(1);
  });

  it('never emits transcripts for pure silence', () => {
    const sink = makeSink();
    sttService.configure(sink);
    const { engine, transcribeMock } = fakeEngine();
    sttService.registerEngine(engine);

    sttService.startSession();
    sttService.feedAudioChunk(silentChunk(5000));
    sttService.stopSession();

    expect(transcribeMock).not.toHaveBeenCalled();
    expect(sink.onTranscript).not.toHaveBeenCalled();
  });

  it('surfaces an actionable error when no local engine matches the selection', async () => {
    const sink = makeSink();
    sttService.configure(sink);
    sttService.unregisterEngine('whisper');

    sttService.startSession();
    sttService.feedAudioChunk(loudChunk(400));
    await new Promise(resolve => setTimeout(resolve, 750));
    await sttService.finalizeUtterance();

    expect(sink.onVoiceError).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'stt_engine_unavailable',
        message: expect.stringMatching(/Settings|engine/i),
      })
    );
  });

  it('reports engine failures through the voice error channel instead of throwing', async () => {
    const sink = makeSink();
    sttService.configure(sink);
    sttService.registerEngine({
      id: 'whisper',
      transcribe: vi.fn(async () => {
        throw new Error('model exploded');
      }),
    });

    sttService.startSession();
    sttService.feedAudioChunk(loudChunk(400));
    await new Promise(resolve => setTimeout(resolve, 750));
    await sttService.finalizeUtterance();

    expect(sink.onVoiceError).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'stt_engine_error' })
    );
  });

  it('captures microphone permission failures as voice errors', () => {
    const sink = makeSink();
    sttService.configure(sink);

    sttService.startSession();
    sttService.handleCaptureFailed({ code: 'mic_permission_denied', message: 'denied' });

    expect(sttService.isSessionActive()).toBe(false);
    expect(sink.onVoiceError).toHaveBeenCalledWith({
      code: 'mic_permission_denied',
      message: 'denied',
    });
  });
});

describe('sttService leading-silence watchdog (EF-04 Symptom B)', () => {
  afterEach(() => {
    vi.useRealTimers();
    sttService.stopSession(false);
  });

  it("resolves a silent session to a \"didn't catch that\" error instead of hanging", () => {
    vi.useFakeTimers();
    const sink = makeSink();
    sttService.configure(sink);

    sttService.startSession();
    expect(sttService.isSessionActive()).toBe(true);

    // Feed silence only — no speech ever starts.
    sttService.feedAudioChunk(silentChunk(500));
    vi.advanceTimersByTime(8001);

    expect(sttService.isSessionActive()).toBe(false);
    expect(sink.onVoiceError).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'no_speech_detected',
        message: expect.stringMatching(/didn't catch/i),
      })
    );
  });

  it('cancels the watchdog once real speech starts', () => {
    vi.useFakeTimers();
    const sink = makeSink();
    sttService.configure(sink, { silenceMsToFinalize: 120 });
    const { engine } = fakeEngine('spoken words');
    sttService.registerEngine(engine);

    sttService.startSession();
    sttService.feedAudioChunk(silentChunk(500));
    sttService.feedAudioChunk(loudChunk(500));

    // Even after a full watchdog window elapses, speech present = no error.
    vi.advanceTimersByTime(8001);
    expect(sink.onVoiceError).not.toHaveBeenCalled();
    expect(sttService.isSessionActive()).toBe(true);
  });
});

describe('sttService neural speech detector', () => {
  function fakeDetector(initialVerdict = false) {
    let verdict = initialVerdict;
    const processMock = vi.fn(async () => verdict);
    const detector: SpeechDetector & {
      setVerdict(v: boolean): void;
      processMock: typeof processMock;
    } = {
      process: processMock,
      reset: vi.fn(() => {
        verdict = initialVerdict;
      }),
      setVerdict(v: boolean) {
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

  beforeEach(() => {
    sttService.setSpeechDetector(null);
  });

  it('finalizes via the neural detector and includes pre-roll audio in the utterance', async () => {
    const sink = makeSink();
    sttService.configure(sink, { silenceMsToFinalize: 120 });
    const { engine, transcribeMock } = fakeEngine('neural vad works');
    sttService.registerEngine(engine);
    const detector = fakeDetector(false);
    sttService.setSpeechDetector(detector);

    sttService.startSession();

    // Leading quiet audio — must land in the pre-roll, not trigger speech.
    sttService.feedAudioChunk(silentChunk(SILENT_CHUNK_MS));
    await waitFor(() => detector.processMock.mock.calls.length === 8);
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(sttService.hasNeuralVad()).toBe(true);

    // Speech starts.
    detector.setVerdict(true);
    sttService.feedAudioChunk(loudChunk(SPEECH_CHUNK_MS));
    await waitFor(() => detector.processMock.mock.calls.length === 20);
    await new Promise(resolve => setTimeout(resolve, 10));

    // Speech ends; after a quiet gap past the silence window, the next
    // chunk's frames finalize the utterance.
    detector.setVerdict(false);
    await new Promise(resolve => setTimeout(resolve, 200));
    sttService.feedAudioChunk(silentChunk(SILENT_CHUNK_MS));
    await waitFor(() => transcribeMock.mock.calls.length === 1);
    await waitFor(() => sink.onTranscript.mock.calls.length > 0);

    // Pre-roll (~300ms) + spoken audio (384ms) must all be present.
    const receivedPcm = transcribeMock.mock.calls[0][0] as Float32Array;
    expect(receivedPcm.length).toBeGreaterThan((16000 * 600) / 1000);
    expect(sink.onTranscript).toHaveBeenCalledWith('neural vad works', true);
  });

  it('resets the detector state when a session starts', async () => {
    sttService.configure(makeSink());
    const detector = fakeDetector();
    sttService.setSpeechDetector(detector);

    sttService.startSession();
    expect(detector.reset).toHaveBeenCalled();
    sttService.stopSession(false);
  });

  it('falls back to RMS detection permanently if the neural detector errors', async () => {
    const sink = makeSink();
    sttService.configure(sink);
    const { engine } = fakeEngine('rms fallback');
    sttService.registerEngine(engine);
    sttService.setSpeechDetector({
      process: vi.fn(async () => {
        throw new Error('model exploded');
      }),
      reset: vi.fn(),
    });

    sttService.startSession();
    sttService.feedAudioChunk(loudChunk(400)); // kills the neural path
    await waitFor(() => !sttService.hasNeuralVad());

    // Subsequent audio flows through the legacy RMS path and still finalizes.
    sttService.feedAudioChunk(loudChunk(400));
    await new Promise(resolve => setTimeout(resolve, 750));
    sttService.feedAudioChunk(silentChunk(50));

    // Wait on the sink, not on transcribeMock — the mock records its call
    // synchronously at invocation, before the transcript is delivered.
    await waitFor(() => sink.onTranscript.mock.calls.length > 0);
    expect(sink.onTranscript).toHaveBeenCalledWith('rms fallback', true);
  });
});

describe('sttService streaming partial transcripts', () => {
  function scriptedEngine(responses: string[]) {
    const queue = [...responses];
    const transcribeMock = vi.fn(async () => queue.shift() ?? 'final words');
    const engine: SttEngine = { id: 'whisper', transcribe: transcribeMock };
    return { engine, transcribeMock };
  }

  beforeEach(() => {
    sttService.setSpeechDetector(null);
  });

  it('emits interim transcripts during ongoing speech, then a final one', async () => {
    const sink = makeSink();
    sttService.configure(sink, {
      silenceMsToFinalize: 120,
      partialMinBufferedMs: 300,
      partialMinNewMs: 300,
    });
    const { engine } = scriptedEngine(['interim words', 'final words']);
    sttService.registerEngine(engine);
    sttService.startSession();

    // RMS path: enough speech in one chunk to clear the partial threshold.
    sttService.feedAudioChunk(loudChunk(400));
    await waitFor(() => sink.onTranscript.mock.calls.some(([t, f]) => t === 'interim words' && f === false));

    // Speech ends; silence past the window finalizes with the next chunk.
    await new Promise(resolve => setTimeout(resolve, 200));
    sttService.feedAudioChunk(silentChunk(100));
    await waitFor(() => sink.onTranscript.mock.calls.some(([t, f]) => t === 'final words' && f === true));

    expect(sink.onVoiceError).not.toHaveBeenCalled();
    sttService.stopSession(false);
  });

  it('never emits interim transcripts below the minimum buffered duration', async () => {
    const sink = makeSink();
    sttService.configure(sink, { partialMinBufferedMs: 800 });
    const { engine } = scriptedEngine(['only final']);
    sttService.registerEngine(engine);
    sttService.startSession();

    sttService.feedAudioChunk(loudChunk(500));
    await new Promise(resolve => setTimeout(resolve, 750));
    sttService.feedAudioChunk(silentChunk(50));

    await waitFor(() => sink.onTranscript.mock.calls.length > 0);
    expect(sink.onTranscript).toHaveBeenCalledTimes(1);
    expect(sink.onTranscript).toHaveBeenCalledWith('only final', true);
    sttService.stopSession(false);
  });

  it('discards an in-flight interim transcript once the utterance is reset', async () => {
    const sink = makeSink();
    sttService.configure(sink, { partialMinBufferedMs: 300 });
    let release!: (value: string) => void;
    const gated = new Promise<string>(resolve => {
      release = resolve;
    });
    let nextResponse: Promise<string> = gated;
    const transcribeMock = vi.fn(async (_pcm: Float32Array): Promise<string> => {
      const response = nextResponse;
      nextResponse = Promise.resolve('late final');
      return response;
    });
    sttService.registerEngine({ id: 'whisper', transcribe: transcribeMock });
    sttService.startSession();

    sttService.feedAudioChunk(loudChunk(400)); // kicks off the gated interim pass

    // Ending the session without flushing invalidates the utterance.
    sttService.stopSession(false);
    release('should never be emitted');
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(sink.onTranscript).not.toHaveBeenCalled();
  });

  it('emits interim transcripts on the neural-detector path too', async () => {
    const sink = makeSink();
    sttService.configure(sink, { partialMinBufferedMs: 300 });
    const { engine } = scriptedEngine(['neural interim', 'neural final']);
    sttService.registerEngine(engine);
    sttService.setSpeechDetector({
      process: vi.fn(async () => true),
      reset: vi.fn(),
    });
    sttService.startSession();

    sttService.feedAudioChunk(loudChunk(384));
    await waitFor(() =>
      sink.onTranscript.mock.calls.some(([t, f]) => t === 'neural interim' && f === false)
    );

    sttService.stopSession(true); // flushes -> final
    await waitFor(() => sink.onTranscript.mock.calls.length > 1);
    expect(sink.onTranscript).toHaveBeenLastCalledWith('neural final', true);
  });
});
