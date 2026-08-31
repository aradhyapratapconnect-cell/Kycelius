import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type ExecCallback = (
  error: Error | null,
  stdout: string,
  stderr: string
) => void;

const { execFileMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
}));

vi.mock('child_process', () => ({
  execFile: execFileMock,
}));

vi.mock('../../db/db', () => ({
  toolExecutions: {
    create: vi.fn(),
    updateStatus: vi.fn(),
  },
}));

import '../runShellCommand';
import { executeToolCall, getTool, setExecutionGate } from '../toolRegistry';

const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform');

function usePlatform(value: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', {
    value,
    writable: true,
    configurable: true,
  });
}

function approvedGate() {
  return vi.fn(async (_context: unknown) => ({ decision: 'proceed' as const }));
}

/** Resolves the exec callback with a successful run. */
function succeedWith(stdout = '', stderr = '') {
  execFileMock.mockImplementation(
    (_file: unknown, _args: unknown, _opts: unknown, cb: ExecCallback) => {
      process.nextTick(() => cb(null, stdout, stderr));
    }
  );
}

describe('run_shell_command tool', () => {
  const tool = () => getTool('run_shell_command')!;

  beforeEach(() => {
    vi.clearAllMocks();
    setExecutionGate(null);
  });

  afterEach(() => {
    setExecutionGate(null);
    if (platformDescriptor) {
      Object.defineProperty(process, 'platform', platformDescriptor);
    }
  });

  it('is registered with confirm_required permission tier', () => {
    expect(tool()).toBeDefined();
    expect(tool().permissionTier).toBe('confirm_required');
  });

  it('uses PowerShell on Windows', async () => {
    usePlatform('win32');
    const gate = approvedGate();
    setExecutionGate(gate);
    succeedWith('hello');

    const outcome = await executeToolCall('run_shell_command', {
      command: 'echo hello',
    });

    expect(outcome.success).toBe(true);
    const [file, args] = execFileMock.mock.calls[0];
    expect(file).toBe('powershell.exe');
    expect(args).toEqual(['-NoProfile', '-NonInteractive', '-Command', 'echo hello']);
    expect(gate).toHaveBeenCalledTimes(1);
    const gateContext = gate.mock.calls[0][0] as { params: { command: string } };
    expect(gateContext.params.command).toBe('echo hello');
  });

  it('uses bash on Linux and zsh on macOS', async () => {
    usePlatform('linux');
    const gate = approvedGate();
    setExecutionGate(gate);
    succeedWith();

    await executeToolCall('run_shell_command', { command: 'echo hi' });
    let [file, args] = execFileMock.mock.calls[0];
    expect(file).toBe('/bin/bash');
    expect(args).toEqual(['-c', 'echo hi']);

    usePlatform('darwin');
    setExecutionGate(approvedGate());
    await executeToolCall('run_shell_command', { command: 'echo hi' });
    [file, args] = execFileMock.mock.calls[1];
    expect(file).toBe('/bin/zsh');
    expect(args).toEqual(['-c', 'echo hi']);
  });

  it('refuses Unix-only syntax on Windows before any dialog or execution', async () => {
    usePlatform('win32');
    const gate = approvedGate();
    setExecutionGate(gate);
    succeedWith();

    for (const command of [
      'sudo apt-get install figlet',
      'grep -r TODO . | wc -l',
      'cat log.txt > /dev/null',
      '#!/bin/bash\necho hi',
    ]) {
      const outcome = await executeToolCall('run_shell_command', { command });
      expect(outcome.success).toBe(false);
      expect(outcome.error).toMatch(/Unix\/macOS.*Windows|Windows.*translation/i);
    }
    expect(execFileMock).not.toHaveBeenCalled();
    expect(gate).not.toHaveBeenCalled();
  });

  it('refuses Windows/PowerShell-only syntax on macOS and Linux', async () => {
    usePlatform('darwin');
    const gate = approvedGate();
    setExecutionGate(gate);
    succeedWith();

    for (const command of [
      'Get-Process -Name Spotify',
      '$env:PATH',
      'reg query HKLM\\Software',
      'cleanup.ps1',
    ]) {
      const outcome = await executeToolCall('run_shell_command', { command });
      expect(outcome.success).toBe(false);
      expect(outcome.error).toMatch(/macOS.*translation|PowerShell-only/i);
    }

    usePlatform('linux');
    const linuxOutcome = await executeToolCall('run_shell_command', {
      command: 'tasklist /FI "STATUS eq RUNNING"',
    });
    expect(linuxOutcome.success).toBe(false);
    expect(linuxOutcome.error).toMatch(/Linux.*translation|PowerShell-only/i);

    expect(execFileMock).not.toHaveBeenCalled();
    expect(gate).not.toHaveBeenCalled();
  });

  it('returns full stdout, stderr, and exit code without truncation', async () => {
    usePlatform('win32');
    const stdout = ['line one', 'line two', 'line three'].join('\n');
    const stderr = 'a warning from the command';
    setExecutionGate(approvedGate());
    succeedWith(stdout, stderr);

    const outcome = await executeToolCall('run_shell_command', {
      command: 'Get-Process',
    });

    expect(outcome.success).toBe(true);
    expect(outcome.result).toContain('Exit code: 0');
    expect(outcome.result).toContain('--- stdout ---');
    expect(outcome.result).toContain(stdout);
    expect(outcome.result).toContain('--- stderr ---');
    expect(outcome.result).toContain(stderr);
  });

  it('surfaces nonzero exit codes as data with full output attached', async () => {
    usePlatform('linux');
    setExecutionGate(approvedGate());
    execFileMock.mockImplementation(
      (_file: unknown, _args: unknown, _opts: unknown, cb: ExecCallback) => {
        process.nextTick(() => {
          const err = Object.assign(new Error('Command failed'), {
            code: 127,
            killed: false,
            signal: null,
          });
          cb(err, 'partial out', 'command not found: frobnicate');
        });
      }
    );

    const outcome = await executeToolCall('run_shell_command', {
      command: 'frobnicate --all',
    });

    expect(outcome.success).toBe(true);
    expect(outcome.result).toContain('Exit code: 127');
    expect(outcome.result).toContain('command not found: frobnicate');
  });

  it('kills and reports a timed-out command instead of hanging', async () => {
    usePlatform('win32');
    setExecutionGate(approvedGate());
    execFileMock.mockImplementation(
      (_file: unknown, _args: unknown, opts: { timeout?: number }, cb: ExecCallback) => {
        expect(opts.timeout).toBe(30000);
        process.nextTick(() => {
          const err = Object.assign(new Error('Command was killed'), {
            code: null,
            killed: true,
            signal: 'SIGKILL' as const,
          });
          cb(err, 'partial stdout before kill', '');
        });
      }
    );

    const outcome = await executeToolCall('run_shell_command', {
      command: 'Start-Sleep -Seconds 999',
    });

    expect(outcome.success).toBe(false);
    expect(outcome.error).toMatch(/timed out after 30s/i);
    expect(outcome.error).toContain('partial stdout before kill');
  });

  it('applies the optional configurable timeout with sane clamping', async () => {
    usePlatform('win32');
    setExecutionGate(approvedGate());
    const timeoutsSeen: Array<number | undefined> = [];
    execFileMock.mockImplementation(
      (_file: unknown, _args: unknown, opts: { timeout?: number }, _cb: ExecCallback) => {
        timeoutsSeen.push(opts.timeout);
        process.nextTick(() => {
          const err = Object.assign(new Error('killed'), { code: null, killed: true, signal: null });
          _cb(err, '', '');
        });
      }
    );

    await executeToolCall('run_shell_command', {
      command: 'Start-Sleep 5',
      timeoutSeconds: 5,
    });
    await executeToolCall('run_shell_command', {
      command: 'Start-Sleep 5',
      timeoutSeconds: 9999,
    });
    await executeToolCall('run_shell_command', {
      command: 'Start-Sleep 5',
      timeoutSeconds: 0.5,
    });

    expect(timeoutsSeen).toEqual([5000, 300000, 1000]);
  });

  it('reports honestly when the shell itself cannot be started', async () => {
    usePlatform('win32');
    setExecutionGate(approvedGate());
    execFileMock.mockImplementation(
      (_file: unknown, _args: unknown, _opts: unknown, cb: ExecCallback) => {
        process.nextTick(() => {
          const err = Object.assign(new Error('spawn ENOENT'), {
            code: 'ENOENT',
            killed: false,
            signal: null,
          });
          cb(err, '', '');
        });
      }
    );

    const outcome = await executeToolCall('run_shell_command', {
      command: 'echo hi',
    });

    expect(outcome.success).toBe(false);
    expect(outcome.error).toMatch(/Failed to start shell/i);
  });
});
