import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const spawnMock = vi.hoisted(() => vi.fn());
vi.mock('child_process', () => ({ spawn: spawnMock }));

import { buildSpeakCommand, ttsService } from '../ttsService';

class FakeChild {
  stdin = { write: vi.fn(), end: vi.fn() };
  stderr = { on: vi.fn() };
  handlers = new Map<string, (arg?: unknown) => void>();
  killed = false;

  on(event: string, handler: (arg?: unknown) => void) {
    this.handlers.set(event, handler);
  }

  kill() {
    this.killed = true;
    this.handlers.get('close')?.();
  }

  emitError(message: string) {
    this.handlers.get('error')?.(new Error(message));
  }

  emitClose(code: number) {
    this.handlers.get('close')?.(code);
  }
}

beforeEach(() => {
  spawnMock.mockReset();
});

afterEach(() => {
  ttsService.stopSpeaking();
});

describe('buildSpeakCommand', () => {
  it('uses SAPI through PowerShell with encoded command on Windows', () => {
    const cmd = buildSpeakCommand('win32', 'hello');
    expect(cmd.file).toBe('powershell.exe');
    expect(cmd.args).toContain('-NoProfile');
    expect(cmd.args).toHaveLength(4);
    const encoded = cmd.args[3];
    const decoded = Buffer.from(encoded, 'base64').toString('utf16le');
    expect(decoded).toMatch(/System\.Speech/);
    expect(decoded).not.toContain('hello');
  });

  it('pipes the text via stdin rather than argv on Windows (no injection surface)', () => {
    const evilText = '"); Remove-Item -Recurse C:\\; ("';
    const cmd = buildSpeakCommand('win32', evilText);
    expect(JSON.stringify(cmd.args)).not.toContain('Remove-Item');
  });

  it('uses say on macOS', () => {
    expect(buildSpeakCommand('darwin', 'hi')).toEqual({ file: 'say', args: ['hi'] });
    expect(buildSpeakCommand('darwin', '-weird').args[0]).toBe('--');
  });

  it('uses spd-say in wait mode on Linux', () => {
    expect(buildSpeakCommand('linux', 'namaste')).toEqual({
      file: 'spd-say',
      args: ['-w', '-l', '0', 'namaste'],
    });
  });
});

describe('ttsService.speak', () => {
  it('spawns the platform engine and resolves when playback finishes', async () => {
    const child = new FakeChild();
    spawnMock.mockImplementation(() => child);

    const promise = ttsService.speak('good morning');
    child.emitClose(0);

    await expect(promise).resolves.toBeUndefined();
    expect(spawnMock).toHaveBeenCalledTimes(1);
  });

  it('writes text to stdin on Windows and closes the pipe', async () => {
    const child = new FakeChild();
    spawnMock.mockImplementation(() => child);

    const promise = ttsService.speak('windows text');
    child.emitClose(0);
    await promise;

    expect(child.stdin.write).toHaveBeenCalledWith('windows text');
    expect(child.stdin.end).toHaveBeenCalledTimes(1);
  });

  it('rejects with a clear error when the engine exits non-zero', async () => {
    const child = new FakeChild();
    child.stderr.on = vi.fn((_event, cb) => cb(Buffer.from('no voices installed')));
    spawnMock.mockImplementation(() => child);

    const promise = ttsService.speak('hello');
    child.emitClose(1);

    await expect(promise).rejects.toThrow(/exit 1.*no voices installed/s);
  });

  it('rejects when the engine binary cannot be spawned', async () => {
    const child = new FakeChild();
    spawnMock.mockImplementation(() => child);

    const promise = ttsService.speak('hello');
    child.emitError('ENOENT');

    await expect(promise).rejects.toThrow(/could not be started/);
  });

  it('kills the active process on stopSpeaking so speech can be interrupted', async () => {
    const child = new FakeChild();
    spawnMock.mockImplementation(() => child);

    const promise = ttsService.speak('long running speech');
    expect(ttsService.isSpeaking()).toBe(true);

    ttsService.stopSpeaking();

    expect(child.killed).toBe(true);
    expect(ttsService.isSpeaking()).toBe(false);

    child.emitClose(1);
    await promise.catch(() => {});
  });

  it('ignores empty text without spawning anything', async () => {
    await ttsService.speak('   ');
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('stops any previous utterance before starting a new one', async () => {
    const first = new FakeChild();
    const second = new FakeChild();
    spawnMock.mockImplementationOnce(() => first).mockImplementationOnce(() => second);

    const p1 = ttsService.speak('first');
    ttsService.speak('second');

    expect(first.killed).toBe(true);

    second.emitClose(0);
    first.emitClose(0);
    await Promise.allSettled([p1]);
  });

  it('BYOK cloud failure (bad key) throws visibly instead of silently falling back to local', async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValue(new Response('Unauthorized', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    ttsService.installCloud(
      () => ({
        id: 'elevenlabs_tts',
        displayName: 'ElevenLabs',
        baseUrl: 'https://api.elevenlabs.io/v1',
        apiKey: 'bad-key',
        model: '21m00Tcm4TlvDq8ikWAM',
        presetKey: 'elevenlabs_tts',
      }),
      () => {}
    );
    try {
      await expect(ttsService.speak('hello')).rejects.toThrow(
        /ElevenLabs TTS failed.*rejected the API key/
      );
      // No local engine was spawned as a silent replacement.
      expect(spawnMock).not.toHaveBeenCalled();
    } finally {
      ttsService.installCloud(() => null, () => {});
      vi.unstubAllGlobals();
    }
  });

  it('generic cloud TTS failure still falls back to local (existing N-08 behavior)', async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValue(new Response('Unauthorized', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    const child = new FakeChild();
    spawnMock.mockImplementation(() => child);
    ttsService.installCloud(
      () => ({
        id: 'row-9',
        displayName: 'Custom Cloud TTS',
        baseUrl: 'https://tts.example.com/v1',
        apiKey: 'bad-key',
        model: 'alloy',
      }),
      () => {}
    );
    try {
      const promise = ttsService.speak('hello');
      // The cloud attempt awaits fetch first — wait until the local fallback
      // actually spawns before closing it.
      await vi.waitFor(() => expect(spawnMock).toHaveBeenCalled());
      child.emitClose(0);
      await expect(promise).resolves.toBeUndefined();
      expect(spawnMock).toHaveBeenCalled();
    } finally {
      ttsService.installCloud(() => null, () => {});
      vi.unstubAllGlobals();
    }
  });
});
