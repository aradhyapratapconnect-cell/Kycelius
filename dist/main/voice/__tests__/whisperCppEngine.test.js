"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const spawnMock = vitest_1.vi.hoisted(() => vitest_1.vi.fn());
vitest_1.vi.mock('child_process', () => ({ spawn: spawnMock }));
const fsMocks = vitest_1.vi.hoisted(() => ({
    accessMock: vitest_1.vi.fn(),
}));
vitest_1.vi.mock('fs/promises', async (importOriginal) => {
    const actual = await importOriginal();
    // Real temp-file helpers so transcribe() exercises genuine disk behavior;
    // only access() is mocked for resolveWhisperConfig tests.
    return { ...actual, access: fsMocks.accessMock };
});
const fs_1 = require("fs");
const whisperCppEngine_1 = require("../engines/whisperCppEngine");
function makeFakeChild() {
    const state = {
        stdoutArgs: [],
        stderrArgs: [],
        stdoutCb: null,
        stderrCb: null,
        closeHandler: null,
        errorHandler: null,
        spawnCall: null,
    };
    const child = {
        stdin: {
            write: vitest_1.vi.fn(),
            end: vitest_1.vi.fn(),
            on: vitest_1.vi.fn(),
        },
        stdout: {
            on: vitest_1.vi.fn((_event, cb) => {
                state.stdoutCb = cb;
            }),
        },
        stderr: {
            on: vitest_1.vi.fn((_event, cb) => {
                state.stderrCb = cb;
            }),
        },
        on(event, handler) {
            if (event === 'close')
                state.closeHandler = handler;
            if (event === 'error')
                state.errorHandler = handler;
        },
        feed(text) {
            state.stdoutCb?.(Buffer.from(text));
        },
        fail(text) {
            state.stderrCb?.(Buffer.from(text));
        },
        exit(code) {
            state.closeHandler?.(code);
        },
        crash(message) {
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
    spawnMock.mockImplementation((file, args) => {
        state.spawnCall = { file, args };
        return child;
    });
    return child;
}
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
// transcribe() performs real async temp-file work before spawning, so tests
// must wait until the fake child actually exists before driving its events.
async function waitForSpawn(child) {
    for (let i = 0; i < 100 && !child.spawnCall; i++) {
        await new Promise(resolve => setTimeout(resolve, 5));
    }
    (0, vitest_1.expect)(child.spawnCall).toBeTruthy();
}
(0, vitest_1.beforeEach)(() => {
    spawnMock.mockReset();
    fsMocks.accessMock.mockReset();
    fsMocks.accessMock.mockResolvedValue(undefined);
});
(0, vitest_1.describe)('resolveWhisperConfig', () => {
    (0, vitest_1.it)('throws an actionable error when binary or model paths are unset', async () => {
        await (0, vitest_1.expect)((0, whisperCppEngine_1.resolveWhisperConfig)(() => undefined)).rejects.toBeInstanceOf(whisperCppEngine_1.WhisperNotConfiguredError);
    });
    (0, vitest_1.it)('throws when the configured paths do not exist', async () => {
        fsMocks.accessMock.mockRejectedValue(new Error('ENOENT'));
        await (0, vitest_1.expect)((0, whisperCppEngine_1.resolveWhisperConfig)(key => key === 'whisper_binary_path' ? 'C:\\tools\\whisper.exe' : 'C:\\models\\ggml.bin')).rejects.toThrow(/not configured/);
    });
    (0, vitest_1.it)('returns the config with a language default when paths exist', async () => {
        const config = await (0, whisperCppEngine_1.resolveWhisperConfig)(key => key === 'whisper_binary_path' ? 'whisper-cli' : key === 'whisper_model_path' ? 'model.bin' : undefined);
        (0, vitest_1.expect)(config.binaryPath).toBe('whisper-cli');
        (0, vitest_1.expect)(config.modelPath).toBe('model.bin');
        (0, vitest_1.expect)(config.language).toBe('en');
        (0, vitest_1.expect)(config.initialPrompt).toBeUndefined();
    });
    (0, vitest_1.it)('honors explicit language and initial-prompt settings', async () => {
        const config = await (0, whisperCppEngine_1.resolveWhisperConfig)(key => key === 'whisper_binary_path'
            ? 'whisper-cli'
            : key === 'whisper_model_path'
                ? 'model.bin'
                : key === 'whisper_language'
                    ? 'auto'
                    : key === 'whisper_initial_prompt'
                        ? '  Supabase, camelCase, Kyclius  '
                        : undefined);
        (0, vitest_1.expect)(config.language).toBe('auto');
        // Prompt is trimmed; empty/whitespace-only prompts resolve to undefined.
        (0, vitest_1.expect)(config.initialPrompt).toBe('Supabase, camelCase, Kyclius');
    });
});
(0, vitest_1.describe)('createWhisperCppEngine.transcribe', () => {
    (0, vitest_1.it)('hands the utterance to whisper as a transient temp file and cleans it up', async () => {
        const child = makeFakeChild();
        const engine = (0, whisperCppEngine_1.createWhisperCppEngine)(async () => ({
            binaryPath: 'whisper-cli',
            modelPath: 'model.bin',
            language: 'en',
        }));
        const pending = engine.transcribe(new Float32Array(1600));
        await waitForSpawn(child);
        child.feed('hello there');
        child.exit(0);
        const text = await pending;
        (0, vitest_1.expect)(text).toBe('hello there');
        (0, vitest_1.expect)(child.spawnCall?.file).toBe('whisper-cli');
        const args = child.spawnCall?.args ?? [];
        const wavPath = args[args.indexOf('-f') + 1];
        // A real transient file path is passed (never stdin '-'), with valid flags only.
        (0, vitest_1.expect)(wavPath).toBeTruthy();
        (0, vitest_1.expect)(wavPath).not.toBe('-');
        (0, vitest_1.expect)(wavPath).toMatch(/utterance\.wav$/);
        (0, vitest_1.expect)(args).toContain('-nt');
        (0, vitest_1.expect)(args).not.toContain('-no-timestamps');
        (0, vitest_1.expect)(args).toContain('--no-prints');
        (0, vitest_1.expect)(args).toContain('-l');
        (0, vitest_1.expect)(args[args.indexOf('-l') + 1]).toBe('en');
        // No prompt configured -> no --prompt flag at all.
        (0, vitest_1.expect)(args).not.toContain('--prompt');
        // The temp file existed during the run and is deleted once transcription settles.
        (0, vitest_1.expect)((0, fs_1.existsSync)(wavPath)).toBe(false);
    });
    (0, vitest_1.it)('passes the initial prompt to whisper for vocabulary biasing', async () => {
        const child = makeFakeChild();
        const engine = (0, whisperCppEngine_1.createWhisperCppEngine)(async () => ({
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
        (0, vitest_1.expect)(text).toBe('supabase camel case kyclius');
        const args = child.spawnCall?.args ?? [];
        (0, vitest_1.expect)(args).toContain('--prompt');
        (0, vitest_1.expect)(args[args.indexOf('--prompt') + 1]).toBe('Supabase, camelCase, Kyclius');
    });
    (0, vitest_1.it)('rejects with an engine error when whisper exits non-zero without output', async () => {
        const child = makeFakeChild();
        const engine = (0, whisperCppEngine_1.createWhisperCppEngine)(async () => ({
            binaryPath: 'whisper-cli',
            modelPath: 'missing.bin',
        }));
        const pending = engine.transcribe(new Float32Array(1600));
        await waitForSpawn(child);
        child.fail('failed to load model');
        child.exit(1);
        await (0, vitest_1.expect)(pending).rejects.toThrow(/exit 1.*failed to load model/s);
    });
    (0, vitest_1.it)('reports a spawn failure as a clear engine error', async () => {
        const child = makeFakeChild();
        const engine = (0, whisperCppEngine_1.createWhisperCppEngine)(async () => ({
            binaryPath: 'nope',
            modelPath: 'model.bin',
        }));
        const pending = engine.transcribe(new Float32Array(1600));
        await waitForSpawn(child);
        child.crash('ENOENT');
        await (0, vitest_1.expect)(pending).rejects.toThrow(/failed to start/i);
    });
});
(0, vitest_1.describe)('cleanTranscript', () => {
    (0, vitest_1.it)('strips timestamps and internal whisper chatter', () => {
        const raw = [
            '[00:00:00.000 --> 00:00:01.500]   Open the settings',
            '[00:00:01.500 --> 00:00:02.000]',
            'system_info: n_threads = 4',
            '',
        ].join('\n');
        (0, vitest_1.expect)((0, whisperCppEngine_1.cleanTranscript)(raw)).toBe('Open the settings');
    });
});
