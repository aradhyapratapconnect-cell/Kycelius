"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const { execFileMock } = vitest_1.vi.hoisted(() => ({
    execFileMock: vitest_1.vi.fn(),
}));
vitest_1.vi.mock('child_process', () => ({
    execFile: execFileMock,
}));
vitest_1.vi.mock('../../db/db', () => ({
    toolExecutions: {
        create: vitest_1.vi.fn(),
        updateStatus: vitest_1.vi.fn(),
    },
}));
require("../runShellCommand");
const toolRegistry_1 = require("../toolRegistry");
const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform');
function usePlatform(value) {
    Object.defineProperty(process, 'platform', {
        value,
        writable: true,
        configurable: true,
    });
}
function approvedGate() {
    return vitest_1.vi.fn(async (_context) => ({ decision: 'proceed' }));
}
/** Resolves the exec callback with a successful run. */
function succeedWith(stdout = '', stderr = '') {
    execFileMock.mockImplementation((_file, _args, _opts, cb) => {
        process.nextTick(() => cb(null, stdout, stderr));
    });
}
(0, vitest_1.describe)('run_shell_command tool', () => {
    const tool = () => (0, toolRegistry_1.getTool)('run_shell_command');
    (0, vitest_1.beforeEach)(() => {
        vitest_1.vi.clearAllMocks();
        (0, toolRegistry_1.setExecutionGate)(null);
    });
    (0, vitest_1.afterEach)(() => {
        (0, toolRegistry_1.setExecutionGate)(null);
        if (platformDescriptor) {
            Object.defineProperty(process, 'platform', platformDescriptor);
        }
    });
    (0, vitest_1.it)('is registered with confirm_required permission tier', () => {
        (0, vitest_1.expect)(tool()).toBeDefined();
        (0, vitest_1.expect)(tool().permissionTier).toBe('confirm_required');
    });
    (0, vitest_1.it)('uses PowerShell on Windows', async () => {
        usePlatform('win32');
        const gate = approvedGate();
        (0, toolRegistry_1.setExecutionGate)(gate);
        succeedWith('hello');
        const outcome = await (0, toolRegistry_1.executeToolCall)('run_shell_command', {
            command: 'echo hello',
        });
        (0, vitest_1.expect)(outcome.success).toBe(true);
        const [file, args] = execFileMock.mock.calls[0];
        (0, vitest_1.expect)(file).toBe('powershell.exe');
        (0, vitest_1.expect)(args).toEqual(['-NoProfile', '-NonInteractive', '-Command', 'echo hello']);
        (0, vitest_1.expect)(gate).toHaveBeenCalledTimes(1);
        const gateContext = gate.mock.calls[0][0];
        (0, vitest_1.expect)(gateContext.params.command).toBe('echo hello');
    });
    (0, vitest_1.it)('uses bash on Linux and zsh on macOS', async () => {
        usePlatform('linux');
        const gate = approvedGate();
        (0, toolRegistry_1.setExecutionGate)(gate);
        succeedWith();
        await (0, toolRegistry_1.executeToolCall)('run_shell_command', { command: 'echo hi' });
        let [file, args] = execFileMock.mock.calls[0];
        (0, vitest_1.expect)(file).toBe('/bin/bash');
        (0, vitest_1.expect)(args).toEqual(['-c', 'echo hi']);
        usePlatform('darwin');
        (0, toolRegistry_1.setExecutionGate)(approvedGate());
        await (0, toolRegistry_1.executeToolCall)('run_shell_command', { command: 'echo hi' });
        [file, args] = execFileMock.mock.calls[1];
        (0, vitest_1.expect)(file).toBe('/bin/zsh');
        (0, vitest_1.expect)(args).toEqual(['-c', 'echo hi']);
    });
    (0, vitest_1.it)('refuses Unix-only syntax on Windows before any dialog or execution', async () => {
        usePlatform('win32');
        const gate = approvedGate();
        (0, toolRegistry_1.setExecutionGate)(gate);
        succeedWith();
        for (const command of [
            'sudo apt-get install figlet',
            'grep -r TODO . | wc -l',
            'cat log.txt > /dev/null',
            '#!/bin/bash\necho hi',
        ]) {
            const outcome = await (0, toolRegistry_1.executeToolCall)('run_shell_command', { command });
            (0, vitest_1.expect)(outcome.success).toBe(false);
            (0, vitest_1.expect)(outcome.error).toMatch(/Unix\/macOS.*Windows|Windows.*translation/i);
        }
        (0, vitest_1.expect)(execFileMock).not.toHaveBeenCalled();
        (0, vitest_1.expect)(gate).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('refuses Windows/PowerShell-only syntax on macOS and Linux', async () => {
        usePlatform('darwin');
        const gate = approvedGate();
        (0, toolRegistry_1.setExecutionGate)(gate);
        succeedWith();
        for (const command of [
            'Get-Process -Name Spotify',
            '$env:PATH',
            'reg query HKLM\\Software',
            'cleanup.ps1',
        ]) {
            const outcome = await (0, toolRegistry_1.executeToolCall)('run_shell_command', { command });
            (0, vitest_1.expect)(outcome.success).toBe(false);
            (0, vitest_1.expect)(outcome.error).toMatch(/macOS.*translation|PowerShell-only/i);
        }
        usePlatform('linux');
        const linuxOutcome = await (0, toolRegistry_1.executeToolCall)('run_shell_command', {
            command: 'tasklist /FI "STATUS eq RUNNING"',
        });
        (0, vitest_1.expect)(linuxOutcome.success).toBe(false);
        (0, vitest_1.expect)(linuxOutcome.error).toMatch(/Linux.*translation|PowerShell-only/i);
        (0, vitest_1.expect)(execFileMock).not.toHaveBeenCalled();
        (0, vitest_1.expect)(gate).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('returns full stdout, stderr, and exit code without truncation', async () => {
        usePlatform('win32');
        const stdout = ['line one', 'line two', 'line three'].join('\n');
        const stderr = 'a warning from the command';
        (0, toolRegistry_1.setExecutionGate)(approvedGate());
        succeedWith(stdout, stderr);
        const outcome = await (0, toolRegistry_1.executeToolCall)('run_shell_command', {
            command: 'Get-Process',
        });
        (0, vitest_1.expect)(outcome.success).toBe(true);
        (0, vitest_1.expect)(outcome.result).toContain('Exit code: 0');
        (0, vitest_1.expect)(outcome.result).toContain('--- stdout ---');
        (0, vitest_1.expect)(outcome.result).toContain(stdout);
        (0, vitest_1.expect)(outcome.result).toContain('--- stderr ---');
        (0, vitest_1.expect)(outcome.result).toContain(stderr);
    });
    (0, vitest_1.it)('surfaces nonzero exit codes as data with full output attached', async () => {
        usePlatform('linux');
        (0, toolRegistry_1.setExecutionGate)(approvedGate());
        execFileMock.mockImplementation((_file, _args, _opts, cb) => {
            process.nextTick(() => {
                const err = Object.assign(new Error('Command failed'), {
                    code: 127,
                    killed: false,
                    signal: null,
                });
                cb(err, 'partial out', 'command not found: frobnicate');
            });
        });
        const outcome = await (0, toolRegistry_1.executeToolCall)('run_shell_command', {
            command: 'frobnicate --all',
        });
        (0, vitest_1.expect)(outcome.success).toBe(true);
        (0, vitest_1.expect)(outcome.result).toContain('Exit code: 127');
        (0, vitest_1.expect)(outcome.result).toContain('command not found: frobnicate');
    });
    (0, vitest_1.it)('kills and reports a timed-out command instead of hanging', async () => {
        usePlatform('win32');
        (0, toolRegistry_1.setExecutionGate)(approvedGate());
        execFileMock.mockImplementation((_file, _args, opts, cb) => {
            (0, vitest_1.expect)(opts.timeout).toBe(30000);
            process.nextTick(() => {
                const err = Object.assign(new Error('Command was killed'), {
                    code: null,
                    killed: true,
                    signal: 'SIGKILL',
                });
                cb(err, 'partial stdout before kill', '');
            });
        });
        const outcome = await (0, toolRegistry_1.executeToolCall)('run_shell_command', {
            command: 'Start-Sleep -Seconds 999',
        });
        (0, vitest_1.expect)(outcome.success).toBe(false);
        (0, vitest_1.expect)(outcome.error).toMatch(/timed out after 30s/i);
        (0, vitest_1.expect)(outcome.error).toContain('partial stdout before kill');
    });
    (0, vitest_1.it)('applies the optional configurable timeout with sane clamping', async () => {
        usePlatform('win32');
        (0, toolRegistry_1.setExecutionGate)(approvedGate());
        const timeoutsSeen = [];
        execFileMock.mockImplementation((_file, _args, opts, _cb) => {
            timeoutsSeen.push(opts.timeout);
            process.nextTick(() => {
                const err = Object.assign(new Error('killed'), { code: null, killed: true, signal: null });
                _cb(err, '', '');
            });
        });
        await (0, toolRegistry_1.executeToolCall)('run_shell_command', {
            command: 'Start-Sleep 5',
            timeoutSeconds: 5,
        });
        await (0, toolRegistry_1.executeToolCall)('run_shell_command', {
            command: 'Start-Sleep 5',
            timeoutSeconds: 9999,
        });
        await (0, toolRegistry_1.executeToolCall)('run_shell_command', {
            command: 'Start-Sleep 5',
            timeoutSeconds: 0.5,
        });
        (0, vitest_1.expect)(timeoutsSeen).toEqual([5000, 300000, 1000]);
    });
    (0, vitest_1.it)('reports honestly when the shell itself cannot be started', async () => {
        usePlatform('win32');
        (0, toolRegistry_1.setExecutionGate)(approvedGate());
        execFileMock.mockImplementation((_file, _args, _opts, cb) => {
            process.nextTick(() => {
                const err = Object.assign(new Error('spawn ENOENT'), {
                    code: 'ENOENT',
                    killed: false,
                    signal: null,
                });
                cb(err, '', '');
            });
        });
        const outcome = await (0, toolRegistry_1.executeToolCall)('run_shell_command', {
            command: 'echo hi',
        });
        (0, vitest_1.expect)(outcome.success).toBe(false);
        (0, vitest_1.expect)(outcome.error).toMatch(/Failed to start shell/i);
    });
});
