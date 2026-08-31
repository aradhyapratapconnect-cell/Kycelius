import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import {
  voiceConfirmationListener,
  classifySpeech,
  describePendingAction,
} from '../voiceConfirmationListener';
import type { QueuedConfirmation } from '../../permissions/confirmationQueue';

interface FakeDepsHarness {
  deps: {
    subscribeQueue: (l: (p: readonly QueuedConfirmation[]) => void) => () => void;
    subscribeTranscripts: (l: (t: string, isFinal: boolean) => void) => () => void;
    respond: Mock<
      [id: string, response: { action: 'approve' | 'deny'; reason?: string }],
      boolean
    >;
    speak: Mock<[text: string], Promise<void>>;
    startCapture: Mock<[], void>;
    stopCapture: Mock<[], void>;
    isCapturing: Mock<[], boolean>;
    timeoutMs: number;
  };
  emitQueue: (pending: readonly QueuedConfirmation[]) => void;
  emitTranscript: (text: string, isFinal?: boolean) => void;
  responded: Array<{ id: string; response: { action: string; reason?: string } }>;
}

function makeConfirmation(id = 'conf-1'): QueuedConfirmation {
  return {
    id,
    toolName: 'run_shell_command',
    parameters: { command: 'rm -rf build/' },
    enqueuedAt: Date.now(),
  };
}

function makeDeps(options?: { capturing?: boolean }): FakeDepsHarness {
  const queueListeners = new Set<(pending: readonly QueuedConfirmation[]) => void>();
  const transcriptListeners = new Set<(text: string, isFinal: boolean) => void>();
  let pending: readonly QueuedConfirmation[] = [];
  const responded: Array<{ id: string; response: { action: string; reason?: string } }> = [];

  const harness: FakeDepsHarness = {
    deps: {
      subscribeQueue: listener => {
        queueListeners.add(listener);
        return () => queueListeners.delete(listener);
      },
      subscribeTranscripts: listener => {
        transcriptListeners.add(listener);
        return () => transcriptListeners.delete(listener);
      },
      respond: vi.fn((id: string, response: { action: 'approve' | 'deny'; reason?: string }) => {
        if (!pending.some(entry => entry.id === id)) return false;
        responded.push({ id, response });
        pending = pending.filter(entry => entry.id !== id);
        harness.emitQueue(pending);
        return true;
      }),
      speak: vi.fn(async (_text: string) => {}),
      startCapture: vi.fn(),
      stopCapture: vi.fn(),
      isCapturing: vi.fn(() => options?.capturing ?? false),
      timeoutMs: 60,
    },
    emitQueue: next => {
      pending = next;
      for (const listener of queueListeners) listener(next);
    },
    emitTranscript: (text, isFinal = true) => {
      for (const listener of transcriptListeners) listener(text, isFinal);
    },
    responded,
  };

  return harness;
}

async function flush(ms = 20): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms));
}

describe('classifySpeech', () => {
  it('approves short affirmative utterances', () => {
    expect(classifySpeech('Okay.')).toBe('approve');
    expect(classifySpeech('yes please')).toBe('approve');
    expect(classifySpeech('send it')).toBe('approve');
    expect(classifySpeech('Confirm')).toBe('approve');
  });

  it('denies negative words anywhere in the utterance', () => {
    expect(classifySpeech('cancel')).toBe('deny');
    expect(classifySpeech('no!')).toBe('deny');
    expect(classifySpeech('stop, wait')).toBe('deny');
    expect(classifySpeech('actually no way')).toBe('deny');
  });

  it('classifies "always allow" phrases as always_allow, not approve', () => {
    expect(classifySpeech('always allow')).toBe('always_allow');
    expect(classifySpeech('allow always')).toBe('always_allow');
    expect(classifySpeech('always allow the delete')).toBe('always_allow');
    expect(classifySpeech('please always allow')).toBe('always_allow');
  });

  it('never approves long sentences even if they contain an affirmative word', () => {
    expect(
      classifySpeech('no wait actually I meant continue with that other thing')
    ).toBe('deny');
    expect(classifySpeech('hey so I was thinking maybe you could okay just look at this')).toBe(
      'ignore'
    );
  });

  it('ignores unrelated speech and emptiness', () => {
    expect(classifySpeech("what's the weather like tomorrow?")).toBe('ignore');
    expect(classifySpeech('   ')).toBe('ignore');
    expect(classifySpeech('delete the file now')).toBe('ignore');
  });
});

describe('describePendingAction', () => {
  it('reads the exact tool name and parameters aloud', () => {
    const spoken = describePendingAction({
      toolName: 'delete_file',
      parameters: { path: 'C:/temp/notes.txt' },
    });
    expect(spoken).toContain('delete_file');
    expect(spoken).toContain('C:/temp/notes.txt');
    expect(spoken).toMatch(/cancel/i);
  });
});

describe('voiceConfirmationListener windows', () => {
  let harness: FakeDepsHarness;

  beforeEach(() => {
    harness = makeDeps();
    voiceConfirmationListener.install(harness.deps);
  });

  afterEach(() => {
    voiceConfirmationListener.uninstall();
  });

  it('resolves approve through the same handler clicks use when an affirmative phrase arrives', async () => {
    harness.emitQueue([makeConfirmation()]);
    await flush();
    harness.emitTranscript('Okay.');
    await flush();

    expect(harness.responded).toEqual([
      { id: 'conf-1', response: { action: 'approve', reason: 'Approved by voice.' } },
    ]);
    expect(voiceConfirmationListener.getWindowConfirmationId()).toBeNull();
  });

  it('resolves "always allow" into the always_allow action the panel store understands', async () => {
    harness.emitQueue([makeConfirmation()]);
    await flush();
    harness.emitTranscript('always allow');
    await flush();

    expect(harness.responded).toEqual([
      {
        id: 'conf-1',
        response: {
          action: 'always_allow',
          reason: 'Approved and always allowed by voice.',
        },
      },
    ]);
    expect(voiceConfirmationListener.getWindowConfirmationId()).toBeNull();
  });

  it('reads the pending action aloud when the window opens', async () => {
    harness.emitQueue([makeConfirmation()]);
    await flush();

    expect(harness.deps.speak).toHaveBeenCalledTimes(1);
    const spoken = harness.deps.speak.mock.calls[0][0] as string;
    expect(spoken).toContain('run_shell_command');
    expect(spoken).toContain('rm -rf build/');
  });

  it('starts its own capture when idle and stops it on resolution', async () => {
    harness.emitQueue([makeConfirmation()]);
    await flush();

    expect(harness.deps.startCapture).toHaveBeenCalledTimes(1);

    harness.emitTranscript('yes');
    await flush();

    expect(harness.deps.stopCapture).toHaveBeenCalledTimes(1);
  });

  it('does not steal capture control when a session is already active', async () => {
    voiceConfirmationListener.uninstall();
    harness = makeDeps({ capturing: true });
    voiceConfirmationListener.install(harness.deps);

    harness.emitQueue([makeConfirmation()]);
    await flush();
    harness.emitTranscript('confirm');
    await flush();

    expect(harness.deps.startCapture).not.toHaveBeenCalled();
    expect(harness.deps.stopCapture).not.toHaveBeenCalled();
  });

  it('resolves deny for a negative phrase', async () => {
    harness.emitQueue([makeConfirmation()]);
    await flush();
    harness.emitTranscript('cancel that');
    await flush();

    expect(harness.responded).toEqual([
      { id: 'conf-1', response: { action: 'deny', reason: 'Denied by voice.' } },
    ]);
  });

  it('fails closed: unrecognized speech plus timeout denies without executing', async () => {
    harness.emitQueue([makeConfirmation()]);
    await flush();
    harness.emitTranscript('what time is it in Tokyo');

    await new Promise(resolve => setTimeout(resolve, 120));

    expect(harness.responded).toEqual([
      {
        id: 'conf-1',
        response: { action: 'deny', reason: 'Voice confirmation window timed out.' },
      },
    ]);
    expect(harness.responded[0].response.action).not.toBe('approve');
  });

  it('closes the window immediately when a click resolves the confirmation first', async () => {
    harness.emitQueue([makeConfirmation()]);
    await flush();

    harness.emitQueue([]);
    await flush(5);
    harness.emitTranscript('okay yes absolutely confirm');
    await new Promise(resolve => setTimeout(resolve, 120));

    expect(harness.responded).toHaveLength(0);
    expect(voiceConfirmationListener.getWindowConfirmationId()).toBeNull();
  });

  it('ignores speech during TTS playback, then listens after the spoken prompt ends', async () => {
    voiceConfirmationListener.uninstall();
    let releaseSpeak!: () => void;
    harness = makeDeps();
    harness.deps.speak.mockImplementation(() => new Promise<void>(resolve => {
      releaseSpeak = resolve;
    }));
    harness.deps.timeoutMs = 5000;
    voiceConfirmationListener.install(harness.deps);

    harness.emitQueue([makeConfirmation()]);
    await flush();

    harness.emitTranscript('okay');
    await flush();
    expect(harness.responded).toHaveLength(0);

    releaseSpeak();
    await flush();

    harness.emitTranscript('okay');
    await flush();
    expect(harness.responded).toEqual([
      { id: 'conf-1', response: { action: 'approve', reason: 'Approved by voice.' } },
    ]);
  });

  it('gives each sequential confirmation its own isolated window', async () => {
    harness.emitQueue([makeConfirmation('conf-1')]);
    await flush();

    harness.emitTranscript('yes');
    await flush();
    expect(harness.responded.map(r => r.response.action)).toEqual(['approve']);

    harness.emitQueue([
      makeConfirmation('conf-2'),
    ]);
    await flush();

    expect(voiceConfirmationListener.getWindowConfirmationId()).toBe('conf-2');
    harness.emitTranscript('cancel');
    await flush();

    expect(harness.responded).toEqual([
      { id: 'conf-1', response: { action: 'approve', reason: 'Approved by voice.' } },
      { id: 'conf-2', response: { action: 'deny', reason: 'Denied by voice.' } },
    ]);
  });

  it('stops listening entirely after uninstall', async () => {
    harness.emitQueue([makeConfirmation()]);
    await flush();

    voiceConfirmationListener.uninstall();
    harness.emitTranscript('okay');
    await new Promise(resolve => setTimeout(resolve, 120));

    expect(harness.responded).toHaveLength(0);
    expect(harness.deps.stopCapture).toHaveBeenCalledTimes(1);
  });
});
