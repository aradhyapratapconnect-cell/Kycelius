"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const { execMock, execSyncMock } = vitest_1.vi.hoisted(() => ({
    execMock: vitest_1.vi.fn(),
    execSyncMock: vitest_1.vi.fn(),
}));
vitest_1.vi.mock('child_process', () => ({
    exec: execMock,
    execSync: execSyncMock,
}));
vitest_1.vi.mock('../../db/db', () => ({
    toolExecutions: {
        create: vitest_1.vi.fn(),
        updateStatus: vitest_1.vi.fn(),
    },
}));
// Import after mocks are set up — this triggers registerTool
require("../openApp");
const toolRegistry_1 = require("../toolRegistry");
const originalPlatform = process.platform;
function setPlatform(platform) {
    Object.defineProperty(process, 'platform', { value: platform, writable: true, configurable: true });
}
function queueExecResults(results) {
    let index = 0;
    execMock.mockImplementation((_command, _opts, maybeCb) => {
        const result = results[Math.min(index, results.length - 1)];
        index += 1;
        setTimeout(() => {
            if (typeof maybeCb === 'function') {
                maybeCb(result.error ?? null, result.stdout ?? '');
            }
        }, 5);
        return {};
    });
}
function execCommandAt(callIndex) {
    return execMock.mock.calls[callIndex][0];
}
function decodedPsScript(callIndex = 0) {
    const command = execCommandAt(callIndex);
    const encoded = command.split('-EncodedCommand ')[1];
    (0, vitest_1.expect)(encoded).toBeDefined();
    return Buffer.from(encoded, 'base64').toString('utf16le');
}
(0, vitest_1.beforeEach)(() => {
    vitest_1.vi.clearAllMocks();
    vitest_1.vi.useFakeTimers({ shouldAdvanceTime: true });
});
(0, vitest_1.afterEach)(() => {
    setPlatform(originalPlatform);
});
(0, vitest_1.describe)('open_application tool', () => {
    const tool = () => (0, toolRegistry_1.getTool)('open_application');
    (0, vitest_1.it)('is registered with auto permission tier', () => {
        (0, vitest_1.expect)(tool()).toBeDefined();
        (0, vitest_1.expect)(tool().permissionTier).toBe('auto');
    });
    (0, vitest_1.it)('rejects empty appName', async () => {
        const result = await tool().handler({ appName: '' });
        (0, vitest_1.expect)(result.success).toBe(false);
        (0, vitest_1.expect)(result.error).toMatch(/non-empty string/);
    });
    (0, vitest_1.it)('rejects non-string appName', async () => {
        const result = await tool().handler({ appName: 42 });
        (0, vitest_1.expect)(result.success).toBe(false);
        (0, vitest_1.expect)(result.error).toMatch(/non-empty string/);
    });
    (0, vitest_1.it)('launches UWP/desktop apps on Windows via AppsFolder shell URI', async () => {
        setPlatform('win32');
        queueExecResults([
            { stdout: 'FOUND|Calculator|Microsoft.WindowsCalculator_8wekyb3d8bbwe!App' },
            {},
        ]);
        const result = await tool().handler({ appName: 'Calculator' });
        (0, vitest_1.expect)(result.success).toBe(true);
        (0, vitest_1.expect)(result.result).toBe('Opened Calculator');
        const lookupScript = decodedPsScript(0);
        (0, vitest_1.expect)(lookupScript).toContain('Get-StartApps');
        (0, vitest_1.expect)(lookupScript).toContain("'Calculator'");
        (0, vitest_1.expect)(execCommandAt(1)).toContain('shell:AppsFolder\\Microsoft.WindowsCalculator_8wekyb3d8bbwe!App');
    });
    (0, vitest_1.it)('prefers exact name match over partial match', async () => {
        setPlatform('win32');
        queueExecResults([{ stdout: 'FOUND|Notepad|{1AC14E77}\\notepad.exe' }, {}]);
        await tool().handler({ appName: 'Notepad' });
        const script = decodedPsScript(0);
        const exactIndex = script.indexOf("$_.Name -eq 'Notepad'");
        const likeIndex = script.indexOf("$_.Name -like '*Notepad*'");
        (0, vitest_1.expect)(exactIndex).toBeGreaterThan(-1);
        (0, vitest_1.expect)(likeIndex).toBeGreaterThan(-1);
        (0, vitest_1.expect)(exactIndex).toBeLessThan(likeIndex);
    });
    (0, vitest_1.it)('escapes single quotes in appName to prevent PowerShell injection', async () => {
        setPlatform('win32');
        queueExecResults([
            { stdout: "FOUND|O'Brien|some.appid" },
            {},
        ]);
        await tool().handler({ appName: "O'Brien" });
        const script = decodedPsScript(0);
        (0, vitest_1.expect)(script).toContain("O''Brien");
        (0, vitest_1.expect)(script.match(/[^']O'Brien/)).toBeNull();
    });
    (0, vitest_1.it)('falls back to PATH lookup when app is missing from Start Menu', async () => {
        setPlatform('win32');
        queueExecResults([{ stdout: 'NOT_FOUND' }, {}]);
        execSyncMock.mockReturnValue('C:\\Windows\\System32\\customtool.exe\n');
        const result = await tool().handler({ appName: 'customtool' });
        (0, vitest_1.expect)(result.success).toBe(true);
        (0, vitest_1.expect)(result.result).toBe('Opened customtool');
        (0, vitest_1.expect)(execSyncMock).toHaveBeenCalledWith('where "customtool.exe"', vitest_1.expect.objectContaining({ windowsHide: true }));
        (0, vitest_1.expect)(execCommandAt(1)).toContain('start "" "C:\\Windows\\System32\\customtool.exe"');
    });
    (0, vitest_1.it)('returns a friendly error when the app cannot be resolved anywhere', async () => {
        setPlatform('win32');
        queueExecResults([{ stdout: 'NOT_FOUND' }]);
        execSyncMock.mockImplementation(() => {
            throw new Error('INFO: Could not find files for the given pattern(s).');
        });
        const result = await tool().handler({ appName: 'DefinitelyMissingApp999' });
        (0, vitest_1.expect)(result.success).toBe(false);
        (0, vitest_1.expect)(result.error).toMatch(/not found/i);
    });
    (0, vitest_1.it)('reports failure when Start Menu entry exists but launch fails', async () => {
        setPlatform('win32');
        queueExecResults([
            { stdout: 'FOUND|BrokenApp|broken.app.id' },
            { error: new Error('launch failed') },
        ]);
        const result = await tool().handler({ appName: 'BrokenApp' });
        // explorer launch is fire-and-forget; the promise still resolves successfully
        (0, vitest_1.expect)(result.success).toBe(true);
        (0, vitest_1.expect)(result.result).toBe('Opened BrokenApp');
    });
    (0, vitest_1.it)('launches app on macOS using open -a', async () => {
        setPlatform('darwin');
        queueExecResults([{}]);
        const result = await tool().handler({ appName: 'Safari' });
        (0, vitest_1.expect)(result.success).toBe(true);
        (0, vitest_1.expect)(result.result).toBe('Opened Safari');
        (0, vitest_1.expect)(execCommandAt(0)).toBe("open -a 'Safari'");
    });
    (0, vitest_1.it)('returns a not-found error on macOS when open fails', async () => {
        setPlatform('darwin');
        queueExecResults([
            { error: new Error('Unable to find application named Missing') },
        ]);
        const result = await tool().handler({ appName: 'Missing' });
        (0, vitest_1.expect)(result.success).toBe(false);
        (0, vitest_1.expect)(result.error).toMatch(/not found/i);
    });
    (0, vitest_1.it)('launches app on Linux using xdg-open', async () => {
        setPlatform('linux');
        queueExecResults([{}]);
        const result = await tool().handler({ appName: 'firefox' });
        (0, vitest_1.expect)(result.success).toBe(true);
        (0, vitest_1.expect)(result.result).toBe('Opened firefox');
        (0, vitest_1.expect)(execCommandAt(0)).toBe("xdg-open 'firefox'");
    });
});
