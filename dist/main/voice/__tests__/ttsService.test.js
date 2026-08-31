"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const spawnMock = vitest_1.vi.hoisted(() => vitest_1.vi.fn());
vitest_1.vi.mock('child_process', () => ({ spawn: spawnMock }));
const ttsService_1 = require("../ttsService");
class FakeChild {
    stdin = { write: vitest_1.vi.fn(), end: vitest_1.vi.fn() };
    stderr = { on: vitest_1.vi.fn() };
    handlers = new Map();
    killed = false;
    on(event, handler) {
        this.handlers.set(event, handler);
    }
    kill() {
        this.killed = true;
        this.handlers.get('close')?.();
    }
    emitError(message) {
        this.handlers.get('error')?.(new Error(message));
    }
    emitClose(code) {
        this.handlers.get('close')?.(code);
    }
}
(0, vitest_1.beforeEach)(() => {
    spawnMock.mockReset();
});
(0, vitest_1.afterEach)(() => {
    ttsService_1.ttsService.stopSpeaking();
});
(0, vitest_1.describe)('buildSpeakCommand', () => {
    (0, vitest_1.it)('uses SAPI through PowerShell with encoded command on Windows', () => {
        const cmd = (0, ttsService_1.buildSpeakCommand)('win32', 'hello');
        (0, vitest_1.expect)(cmd.file).toBe('powershell.exe');
        (0, vitest_1.expect)(cmd.args).toContain('-NoProfile');
        (0, vitest_1.expect)(cmd.args).toHaveLength(4);
        const encoded = cmd.args[3];
        const decoded = Buffer.from(encoded, 'base64').toString('utf16le');
        (0, vitest_1.expect)(decoded).toMatch(/System\.Speech/);
        (0, vitest_1.expect)(decoded).not.toContain('hello');
    });
    (0, vitest_1.it)('pipes the text via stdin rather than argv on Windows (no injection surface)', () => {
        const evilText = '"); Remove-Item -Recurse C:\\; ("';
        const cmd = (0, ttsService_1.buildSpeakCommand)('win32', evilText);
        (0, vitest_1.expect)(JSON.stringify(cmd.args)).not.toContain('Remove-Item');
    });
    (0, vitest_1.it)('uses say on macOS', () => {
        (0, vitest_1.expect)((0, ttsService_1.buildSpeakCommand)('darwin', 'hi')).toEqual({ file: 'say', args: ['hi'] });
        (0, vitest_1.expect)((0, ttsService_1.buildSpeakCommand)('darwin', '-weird').args[0]).toBe('--');
    });
    (0, vitest_1.it)('uses spd-say in wait mode on Linux', () => {
        (0, vitest_1.expect)((0, ttsService_1.buildSpeakCommand)('linux', 'namaste')).toEqual({
            file: 'spd-say',
            args: ['-w', '-l', '0', 'namaste'],
        });
    });
});
(0, vitest_1.describe)('ttsService.speak', () => {
    (0, vitest_1.it)('spawns the platform engine and resolves when playback finishes', async () => {
        const child = new FakeChild();
        spawnMock.mockImplementation(() => child);
        const promise = ttsService_1.ttsService.speak('good morning');
        child.emitClose(0);
        await (0, vitest_1.expect)(promise).resolves.toBeUndefined();
        (0, vitest_1.expect)(spawnMock).toHaveBeenCalledTimes(1);
    });
    (0, vitest_1.it)('writes text to stdin on Windows and closes the pipe', async () => {
        const child = new FakeChild();
        spawnMock.mockImplementation(() => child);
        const promise = ttsService_1.ttsService.speak('windows text');
        child.emitClose(0);
        await promise;
        (0, vitest_1.expect)(child.stdin.write).toHaveBeenCalledWith('windows text');
        (0, vitest_1.expect)(child.stdin.end).toHaveBeenCalledTimes(1);
    });
    (0, vitest_1.it)('rejects with a clear error when the engine exits non-zero', async () => {
        const child = new FakeChild();
        child.stderr.on = vitest_1.vi.fn((_event, cb) => cb(Buffer.from('no voices installed')));
        spawnMock.mockImplementation(() => child);
        const promise = ttsService_1.ttsService.speak('hello');
        child.emitClose(1);
        await (0, vitest_1.expect)(promise).rejects.toThrow(/exit 1.*no voices installed/s);
    });
    (0, vitest_1.it)('rejects when the engine binary cannot be spawned', async () => {
        const child = new FakeChild();
        spawnMock.mockImplementation(() => child);
        const promise = ttsService_1.ttsService.speak('hello');
        child.emitError('ENOENT');
        await (0, vitest_1.expect)(promise).rejects.toThrow(/could not be started/);
    });
    (0, vitest_1.it)('kills the active process on stopSpeaking so speech can be interrupted', async () => {
        const child = new FakeChild();
        spawnMock.mockImplementation(() => child);
        const promise = ttsService_1.ttsService.speak('long running speech');
        (0, vitest_1.expect)(ttsService_1.ttsService.isSpeaking()).toBe(true);
        ttsService_1.ttsService.stopSpeaking();
        (0, vitest_1.expect)(child.killed).toBe(true);
        (0, vitest_1.expect)(ttsService_1.ttsService.isSpeaking()).toBe(false);
        child.emitClose(1);
        await promise.catch(() => { });
    });
    (0, vitest_1.it)('ignores empty text without spawning anything', async () => {
        await ttsService_1.ttsService.speak('   ');
        (0, vitest_1.expect)(spawnMock).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('stops any previous utterance before starting a new one', async () => {
        const first = new FakeChild();
        const second = new FakeChild();
        spawnMock.mockImplementationOnce(() => first).mockImplementationOnce(() => second);
        const p1 = ttsService_1.ttsService.speak('first');
        ttsService_1.ttsService.speak('second');
        (0, vitest_1.expect)(first.killed).toBe(true);
        second.emitClose(0);
        first.emitClose(0);
        await Promise.allSettled([p1]);
    });
});
