import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { execMock, execSyncMock } = vi.hoisted(() => ({
  execMock: vi.fn(),
  execSyncMock: vi.fn(),
}));

vi.mock('child_process', () => ({
  exec: execMock,
  execSync: execSyncMock,
}));

vi.mock('../../db/db', () => ({
  toolExecutions: {
    create: vi.fn(),
    updateStatus: vi.fn(),
  },
}));

// Import after mocks are set up — this triggers registerTool
import '../openApp';
import { getTool } from '../toolRegistry';

const originalPlatform = process.platform;

function setPlatform(platform: string) {
  Object.defineProperty(process, 'platform', { value: platform, writable: true, configurable: true });
}

interface ExecResult {
  error?: Error | null;
  stdout?: string;
}

function queueExecResults(results: ExecResult[]) {
  let index = 0;
  execMock.mockImplementation((_command: string, _opts: unknown, maybeCb?: unknown) => {
    const result = results[Math.min(index, results.length - 1)];
    index += 1;
    setTimeout(() => {
      if (typeof maybeCb === 'function') {
        (maybeCb as (err: Error | null, stdout: string) => void)(result.error ?? null, result.stdout ?? '');
      }
    }, 5);
    return {};
  });
}

function execCommandAt(callIndex: number): string {
  return execMock.mock.calls[callIndex][0] as string;
}

function decodedPsScript(callIndex = 0): string {
  const command = execCommandAt(callIndex);
  const encoded = command.split('-EncodedCommand ')[1];
  expect(encoded).toBeDefined();
  return Buffer.from(encoded, 'base64').toString('utf16le');
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  setPlatform(originalPlatform);
});

describe('open_application tool', () => {
  const tool = () => getTool('open_application')!;

  it('is registered with auto permission tier', () => {
    expect(tool()).toBeDefined();
    expect(tool().permissionTier).toBe('auto');
  });

  it('rejects empty appName', async () => {
    const result = await tool().handler({ appName: '' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/non-empty string/);
  });

  it('rejects non-string appName', async () => {
    const result = await tool().handler({ appName: 42 });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/non-empty string/);
  });

  it('launches UWP/desktop apps on Windows via AppsFolder shell URI', async () => {
    setPlatform('win32');
    queueExecResults([
      { stdout: 'FOUND|Calculator|Microsoft.WindowsCalculator_8wekyb3d8bbwe!App' },
      {},
    ]);

    const result = await tool().handler({ appName: 'Calculator' });

    expect(result.success).toBe(true);
    expect(result.result).toBe('Opened Calculator');

    const lookupScript = decodedPsScript(0);
    expect(lookupScript).toContain('Get-StartApps');
    expect(lookupScript).toContain("'Calculator'");
    expect(execCommandAt(1)).toContain('shell:AppsFolder\\Microsoft.WindowsCalculator_8wekyb3d8bbwe!App');
  });

  it('prefers exact name match over partial match', async () => {
    setPlatform('win32');
    queueExecResults([{ stdout: 'FOUND|Notepad|{1AC14E77}\\notepad.exe' }, {}]);

    await tool().handler({ appName: 'Notepad' });

    const script = decodedPsScript(0);
    const exactIndex = script.indexOf("$_.Name -eq 'Notepad'");
    const likeIndex = script.indexOf("$_.Name -like '*Notepad*'");
    expect(exactIndex).toBeGreaterThan(-1);
    expect(likeIndex).toBeGreaterThan(-1);
    expect(exactIndex).toBeLessThan(likeIndex);
  });

  it('escapes single quotes in appName to prevent PowerShell injection', async () => {
    setPlatform('win32');
    queueExecResults([
      { stdout: "FOUND|O'Brien|some.appid" },
      {},
    ]);

    await tool().handler({ appName: "O'Brien" });

    const script = decodedPsScript(0);
    expect(script).toContain("O''Brien");
    expect(script.match(/[^']O'Brien/)).toBeNull();
  });

  it('falls back to PATH lookup when app is missing from Start Menu', async () => {
    setPlatform('win32');
    queueExecResults([{ stdout: 'NOT_FOUND' }, {}]);
    execSyncMock.mockReturnValue('C:\\Windows\\System32\\customtool.exe\n');

    const result = await tool().handler({ appName: 'customtool' });

    expect(result.success).toBe(true);
    expect(result.result).toBe('Opened customtool');
    expect(execSyncMock).toHaveBeenCalledWith(
      'where "customtool.exe"',
      expect.objectContaining({ windowsHide: true })
    );
    expect(execCommandAt(1)).toContain('start "" "C:\\Windows\\System32\\customtool.exe"');
  });

  it('returns a friendly error when the app cannot be resolved anywhere', async () => {
    setPlatform('win32');
    queueExecResults([{ stdout: 'NOT_FOUND' }]);
    execSyncMock.mockImplementation(() => {
      throw new Error('INFO: Could not find files for the given pattern(s).');
    });

    const result = await tool().handler({ appName: 'DefinitelyMissingApp999' });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not found/i);
  });

  it('reports failure when Start Menu entry exists but launch fails', async () => {
    setPlatform('win32');
    queueExecResults([
      { stdout: 'FOUND|BrokenApp|broken.app.id' },
      { error: new Error('launch failed') },
    ]);

    const result = await tool().handler({ appName: 'BrokenApp' });

    // explorer launch is fire-and-forget; the promise still resolves successfully
    expect(result.success).toBe(true);
    expect(result.result).toBe('Opened BrokenApp');
  });

  it('launches app on macOS using open -a', async () => {
    setPlatform('darwin');
    queueExecResults([{}]);

    const result = await tool().handler({ appName: 'Safari' });

    expect(result.success).toBe(true);
    expect(result.result).toBe('Opened Safari');
    expect(execCommandAt(0)).toBe("open -a 'Safari'");
  });

  it('returns a not-found error on macOS when open fails', async () => {
    setPlatform('darwin');
    queueExecResults([
      { error: new Error('Unable to find application named Missing') },
    ]);

    const result = await tool().handler({ appName: 'Missing' });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not found/i);
  });

  it('launches app on Linux using xdg-open', async () => {
    setPlatform('linux');
    queueExecResults([{}]);

    const result = await tool().handler({ appName: 'firefox' });

    expect(result.success).toBe(true);
    expect(result.result).toBe('Opened firefox');
    expect(execCommandAt(0)).toBe("xdg-open 'firefox'");
  });
});
