import { beforeEach, describe, expect, it, vi } from 'vitest';

const spawnMock = vi.hoisted(() => vi.fn());
vi.mock('child_process', () => ({ spawn: spawnMock }));

const fsMocks = vi.hoisted(() => ({
  accessMock: vi.fn(),
}));
vi.mock('fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('fs/promises')>();
  // Real temp-file helpers so transcribe() exercises genuine disk behavior;
  // only access() is mocked for resolveWhisperConfig tests.
  return { ...actual, access: fsMocks.accessMock };
});

import { existsSync } from 'fs';
import {
  cleanTranscript,
  createWhisperCppEngine,
  resolveWhisperConfig,
  WhisperNotConfiguredError,
} from '../engines/whisperCppEngine';

interface FakeChild {
  stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn>; on: ReturnType<typeof vi.fn> };
  feed(text: string): void;
  fail(text: string): void;
  exit(code: number): void;
  crash(message: string): void;
}

function makeFakeChild(): FakeChild & { stdoutArgs: string[]; stderrArgs: string[]; spawnCall: { file: string; args: string[] } | null } {
  const state = {
    stdoutArgs: [] as string[],
    stderrArgs: [] as string[],
    stdoutCb: null as ((chunk: Buffer) => void) | null,
    stderrCb: null as ((chunk: Buffer) => void) | null,
    closeHandler: null as ((code?: number) => void) | null,
    errorHandler: null as ((err: Error) => void) | null,
    spawnCall: null as { file: string; args: string[] } | null,
  };

  const child = {
    stdin: {
      write: vi.fn(),
      end: vi.fn(),
      on: vi.fn(),
    },
    stdout: {
      on: vi.fn((_event: string, cb: (chunk: Buffer) => void) => {
        state.stdoutCb = cb;
      }),
    },
    stderr: {
      on: vi.fn((_event: string, cb: (chunk: Buffer) => void) => {
        state.stderrCb = cb;
      }),
    },
    on(event: string, handler: (arg?: unknown) => void) {
      if (event === 'close') state.closeHandler = handler as (code?: number) => void;
      if (event === 'error') state.errorHandler = handler as (err: Error) => void;
    },
    feed(text: string) {
      state.stdoutCb?.(Buffer.from(text));
    },
    fail(text: string) {
      state.stderrCb?.(Buffer.from(text));
    },
    exit(code: number) {
      state.closeHandler?.(code);
    },
    crash(message: string) {
      state.errorHandler?.(new Error(message));
    },
    get stdoutArgs() {
      return state.stdoutArgs;
    },
    get stderrArgs() {
      return state.stderrArgs;
    },
    get spawnCall() {
      return state.spawnCall;
    },
  };

  spawnMock.mockImplementation((file: string, args: string[]) => {
    state.spawnCall = { file, args };
    return child;
  });

  return child as unknown as FakeChild & typeof child;
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

// transcribe() performs real async temp-file work before spawning, so tests
// must wait until the fake child actually exists before driving its events.
async function waitForSpawn(child: { spawnCall: unknown }): Promise<void> {
  for (let i = 0; i < 100 && !child.spawnCall; i++) {
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  expect(child.spawnCall).toBeTruthy();
}

beforeEach(() => {
  spawnMock.mockReset();
  fsMocks.accessMock.mockReset();
  fsMocks.accessMock.mockResolvedValue(undefined);
});

describe('resolveWhisperConfig', () => {
  it('throws an actionable error when binary or model paths are unset', async () => {
    await expect(resolveWhisperConfig(() => undefined)).rejects.toBeInstanceOf(
      WhisperNotConfiguredError
    );
  });

  it('throws when the configured paths do not exist', async () => {
    fsMocks.accessMock.mockRejectedValue(new Error('ENOENT'));
    await expect(
      resolveWhisperConfig(key =>
        key === 'whisper_binary_path' ? 'C:\\tools\\whisper.exe' : 'C:\\models\\ggml.bin'
      )
    ).rejects.toThrow(/not configured/);
  });

  it('returns the config with a language default when paths exist', async () => {
    const config = await resolveWhisperConfig(key =>
      key === 'whisper_binary_path' ? 'whisper-cli' : key === 'whisper_model_path' ? 'model.bin' : undefined
    );
    expect(config.binaryPath).toBe('whisper-cli');
    expect(config.modelPath).toBe('model.bin');
    expect(config.language).toBe('en');
    expect(config.initialPrompt).toBeUndefined();
  });

  it('honors explicit language and initial-prompt settings', async () => {
    const config = await resolveWhisperConfig(key =>
      key === 'whisper_binary_path'
        ? 'whisper-cli'
        : key === 'whisper_model_path'
          ? 'model.bin'
          : key === 'whisper_language'
            ? 'auto'
            : key === 'whisper_initial_prompt'
              ? '  Supabase, camelCase, Kyclius  '
              : undefined
    );
    expect(config.language).toBe('auto');
    // Prompt is trimmed; empty/whitespace-only prompts resolve to undefined.
    expect(config.initialPrompt).toBe('Supabase, camelCase, Kyclius');
  });
});

describe('createWhisperCppEngine.transcribe', () => {
  it('hands the utterance to whisper as a transient temp file and cleans it up', async () => {
    const child = makeFakeChild();

    const engine = createWhisperCppEngine(async () => ({
      binaryPath: 'whisper-cli',
      modelPath: 'model.bin',
      language: 'en',
    }));

    const pending = engine.transcribe(new Float32Array(1600));
    await waitForSpawn(child);
    child.feed('hello there');
    child.exit(0);
    const text = await pending;

    expect(text).toBe('hello there');

    expect(child.spawnCall?.file).toBe('whisper-cli');
    const args = child.spawnCall?.args ?? [];
    const wavPath = args[args.indexOf('-f') + 1];
    // A real transient file path is passed (never stdin '-'), with valid flags only.
    expect(wavPath).toBeTruthy();
    expect(wavPath).not.toBe('-');
    expect(wavPath).toMatch(/utterance\.wav$/);
    expect(args).toContain('-nt');
    expect(args).not.toContain('-no-timestamps');
    expect(args).toContain('--no-prints');
    expect(args).toContain('-l');
    expect(args[args.indexOf('-l') + 1]).toBe('en');
    // No prompt configured -> no --prompt flag at all.
    expect(args).not.toContain('--prompt');

    // The temp file existed during the run and is deleted once transcription settles.
    expect(existsSync(wavPath)).toBe(false);
  });

  it('passes the initial prompt to whisper for vocabulary biasing', async () => {
    const child = makeFakeChild();

    const engine = createWhisperCppEngine(async () => ({
      binaryPath: 'whisper-cli',
      modelPath: 'model.bin',
      language: 'en',
      initialPrompt: 'Supabase, camelCase, Kyclius',
    }));

    const pending = engine.transcribe(new Float32Array(1600));
    await waitForSpawn(child);
    child.feed('supabase camel case kyclius');
    child.exit(0);
    const text = await pending;

    expect(text).toBe('supabase camel case kyclius');

    const args = child.spawnCall?.args ?? [];
    expect(args).toContain('--prompt');
    expect(args[args.indexOf('--prompt') + 1]).toBe('Supabase, camelCase, Kyclius');
  });

  it('rejects with an engine error when whisper exits non-zero without output', async () => {
    const child = makeFakeChild();

    const engine = createWhisperCppEngine(async () => ({
      binaryPath: 'whisper-cli',
      modelPath: 'missing.bin',
    }));

    const pending = engine.transcribe(new Float32Array(1600));
    await waitForSpawn(child);
    child.fail('failed to load model');
    child.exit(1);

    await expect(pending).rejects.toThrow(/exit 1.*failed to load model/s);
  });

  it('reports a spawn failure as a clear engine error', async () => {
    const child = makeFakeChild();

    const engine = createWhisperCppEngine(async () => ({
      binaryPath: 'nope',
      modelPath: 'model.bin',
    }));

    const pending = engine.transcribe(new Float32Array(1600));
    await waitForSpawn(child);
    child.crash('ENOENT');

    await expect(pending).rejects.toThrow(/failed to start/i);
  });
});

describe('cleanTranscript', () => {
  it('strips timestamps and internal whisper chatter', () => {
    const raw = [
      '[00:00:00.000 --> 00:00:01.500]   Open the settings',
      '[00:00:01.500 --> 00:00:02.000]',
      'system_info: n_threads = 4',
      '',
    ].join('\n');

    expect(cleanTranscript(raw)).toBe('Open the settings');
  });
});
