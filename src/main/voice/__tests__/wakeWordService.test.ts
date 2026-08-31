import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import {
  DEFAULT_WAKE_PHRASE,
  transcriptContainsPhrase,
  validateWakePhrase,
  wakeWordService,
  type WakeListeningState,
  type WakeVoiceError,
} from '../wakeWordService';

const SAMPLE_RATE = 16000;

function loudChunk(ms = 400): Float32Array {
  const samples = new Float32Array((SAMPLE_RATE * ms) / 1000);
  for (let i = 0; i < samples.length; i++) samples[i] = i % 2 === 0 ? 0.5 : -0.5;
  return samples;
}

function silentChunk(ms = 100): Float32Array {
  return new Float32Array((SAMPLE_RATE * ms) / 1000);
}

async function settle(): Promise<void> {
  // Flush pending microtasks and any due timers so async detection resolves.
  await vi.advanceTimersByTimeAsync(0);
}

describe('validateWakePhrase', () => {
  it('rejects an empty phrase outright', () => {
    const result = validateWakePhrase('   ');
    expect(result.ok).toBe(false);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('accepts the default phrase with no warnings', () => {
    expect(validateWakePhrase(DEFAULT_WAKE_PHRASE)).toEqual({ ok: true, warnings: [] });
  });

  it('warns (but does not block) for very short phrases', () => {
    const result = validateWakePhrase('hey');
    expect(result.ok).toBe(true);
    expect(result.warnings.some(w => w.toLowerCase().includes('short'))).toBe(true);
  });

  it('warns for a single common word that would false-trigger often', () => {
    const result = validateWakePhrase('okay');
    expect(result.ok).toBe(true);
    expect(result.warnings.some(w => w.toLowerCase().includes('common'))).toBe(true);
  });

  it('warns for impractically long phrases', () => {
    const result = validateWakePhrase('hey kyclius please come here right now');
    expect(result.ok).toBe(true);
    expect(result.warnings.some(w => w.toLowerCase().includes('long'))).toBe(true);
  });
});

describe('transcriptContainsPhrase', () => {
  it('matches an exact spoken phrase inside a longer transcript', () => {
    expect(transcriptContainsPhrase('hey kyclius what time is it', 'Hey Kyclius')).toBe(true);
  });

  it('ignores case and punctuation', () => {
    expect(transcriptContainsPhrase("HEY, KYCLIUS!", 'hey kyclius')).toBe(true);
  });

  it('tolerates common misrecognitions of the phrase', () => {
    expect(transcriptContainsPhrase('so hey clius come over', 'Hey Kyclius')).toBe(true);
  });

  it('does not match unrelated speech', () => {
    expect(transcriptContainsPhrase('what time is it right now', 'Hey Kyclius')).toBe(false);
  });

  it('returns false for empty input', () => {
    expect(transcriptContainsPhrase('', 'Hey Kyclius')).toBe(false);
    expect(transcriptContainsPhrase('hello there', '')).toBe(false);
  });

  it('handles single-word phrases', () => {
    expect(transcriptContainsPhrase('is my computer ready', 'computer')).toBe(true);
    expect(transcriptContainsPhrase('nothing relevant here', 'computer')).toBe(false);
  });
});

describe('wakeWordService', () => {
  let transcribeMock: Mock<[Float32Array], Promise<string>>;
  let onWakeDetected: Mock<[string], void>;
  let onStateChanged: Mock<[WakeListeningState], void>;
  let onError: Mock<[WakeVoiceError], void>;
  let currentPhrase: string;
  let speaking: boolean;
  let sessionActive: boolean;

  function speechBurst(): void {
    // Speak, then go silent long enough to finalize a detection window.
    wakeWordService.ingestChunk(loudChunk(400));
    vi.advanceTimersByTime(700);
    wakeWordService.ingestChunk(silentChunk(100));
  }

  beforeEach(() => {
    vi.useFakeTimers();
    currentPhrase = 'Hey Kyclius';
    speaking = false;
    sessionActive = false;

    transcribeMock = vi.fn(async (_pcm: Float32Array) => 'weather looks nice today');
    onWakeDetected = vi.fn();
    onStateChanged = vi.fn();
    onError = vi.fn();

    wakeWordService.configure({
      getPhrase: () => currentPhrase,
      transcribe: transcribeMock,
      onWakeDetected,
      onStateChanged,
      onError,
      isCommandSessionActive: () => sessionActive,
      isSpeaking: () => speaking,
    });

    // Force a clean on state regardless of what a previous test left behind.
    wakeWordService.setEnabled(false);
    wakeWordService.setEnabled(true);
  });

  afterEach(() => {
    wakeWordService.reset();
    wakeWordService.setEnabled(false);
    vi.useRealTimers();
  });

  it('starts enabled in the listening state', () => {
    expect(wakeWordService.isEnabled()).toBe(true);
    expect(wakeWordService.getState()).toBe('listening');
  });

  it('never runs detection while disabled', async () => {
    wakeWordService.setEnabled(false);
    wakeWordService.ingestChunk(loudChunk(500));
    vi.advanceTimersByTime(2000);
    wakeWordService.ingestChunk(silentChunk(200));
    await settle();

    expect(transcribeMock).not.toHaveBeenCalled();
  });

  it('triggers once after speech followed by silence, then reverts to listening', async () => {
    transcribeMock.mockImplementation(async () => 'hey kyclius come here please');

    speechBurst();
    await settle();

    expect(transcribeMock).toHaveBeenCalledTimes(1);
    expect(onWakeDetected).toHaveBeenCalledWith('hey kyclius come here please');

    const states = onStateChanged.mock.calls.map(call => call[0]);
    expect(states).toContain('triggered');

    await vi.advanceTimersByTimeAsync(2600);
    expect(wakeWordService.getState()).toBe('listening');
  });

  it('does not trigger when the transcript does not contain the phrase', async () => {
    speechBurst();
    await settle();

    expect(transcribeMock).toHaveBeenCalledTimes(1);
    expect(onWakeDetected).not.toHaveBeenCalled();
    expect(wakeWordService.getState()).toBe('listening');
  });

  it('respects the cooldown before triggering again', async () => {
    transcribeMock.mockImplementation(async () => 'hey kyclius');

    speechBurst(); // t≈700ms — first trigger
    await settle();
    expect(onWakeDetected).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1000); // still well within cooldown
    speechBurst();
    await settle();
    expect(transcribeMock).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(8000); // past the cooldown window
    speechBurst();
    await settle();
    expect(transcribeMock).toHaveBeenCalledTimes(2);
    expect(onWakeDetected).toHaveBeenCalledTimes(2);
  });

  it('pauses detection entirely while text-to-speech is playing', async () => {
    speaking = true;
    speechBurst();
    await settle();
    expect(transcribeMock).not.toHaveBeenCalled();

    speaking = false;
    speechBurst();
    await settle();
    expect(transcribeMock).toHaveBeenCalledTimes(1);
  });

  it('pauses detection while a command session is active', async () => {
    sessionActive = true;
    speechBurst();
    await settle();
    expect(transcribeMock).not.toHaveBeenCalled();

    sessionActive = false;
    speechBurst();
    await settle();
    expect(transcribeMock).toHaveBeenCalledTimes(1);
  });

  it('surfaces revoked microphone permission as unavailable, then recovers', async () => {
    const error: WakeVoiceError = { code: 'mic_permission_denied', message: 'Mic denied.' };
    wakeWordService.handleCaptureFailed(error);

    expect(onError).toHaveBeenCalledWith(error);
    expect(wakeWordService.getState()).toBe('unavailable');

    // No detection attempts while unavailable.
    speechBurst();
    await settle();
    expect(transcribeMock).not.toHaveBeenCalled();

    // Renderer reports ambient capture working again -> back to listening.
    wakeWordService.handleAmbientCaptureStarted();
    expect(wakeWordService.getState()).toBe('listening');

    speechBurst();
    await settle();
    expect(transcribeMock).toHaveBeenCalledTimes(1);
  });

  it('ignores capture failures when background listening is off', () => {
    wakeWordService.setEnabled(false);
    wakeWordService.handleCaptureFailed({ code: 'mic_not_found', message: 'No mic.' });

    expect(onError).not.toHaveBeenCalled();
    expect(wakeWordService.getState()).toBe('off');
  });

  it('stops immediately when disabled mid-stream', async () => {
    wakeWordService.ingestChunk(loudChunk(300));
    wakeWordService.setEnabled(false);
    expect(wakeWordService.getState()).toBe('off');

    vi.advanceTimersByTime(5000);
    wakeWordService.ingestChunk(loudChunk(400));
    vi.advanceTimersByTime(1000);
    wakeWordService.ingestChunk(silentChunk(200));
    await settle();

    expect(transcribeMock).not.toHaveBeenCalled();
  });

  it('picks up a changed wake phrase without any restart or reconfigure', async () => {
    // The transcript contains the new phrase all along; only the configured
    // phrase changes, so a trigger proves the service re-read it live.
    transcribeMock.mockImplementation(async () => 'um hey kyclius are you there');

    currentPhrase = 'Jarvis help';
    speechBurst();
    await settle();
    expect(onWakeDetected).not.toHaveBeenCalled();

    currentPhrase = 'Hey Kyclius'; // Settings updated the stored phrase
    vi.advanceTimersByTime(2000); // clear min-detect interval
    speechBurst();
    await settle();

    expect(onWakeDetected).toHaveBeenCalledTimes(1);
  });

  it('keeps the rolling buffer bounded in memory', async () => {
    for (let i = 0; i < 40; i++) {
      wakeWordService.ingestChunk(loudChunk(500)); // 20s of audio total
      await settle();
    }

    expect(wakeWordService.getBufferedSampleCount()).toBeLessThanOrEqual(15 * SAMPLE_RATE);
  });

  it('throttles repeated transcription errors instead of spamming', async () => {
    transcribeMock.mockRejectedValue(new Error('whisper crashed'));

    speechBurst();
    await settle();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0].code).toBe('stt_engine_error');

    vi.advanceTimersByTime(10_000); // same failure again, still throttled
    speechBurst();
    await settle();
    expect(onError).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(60_000); // past the repeat window
    speechBurst();
    await settle();
    expect(onError).toHaveBeenCalledTimes(2);
  });
});
