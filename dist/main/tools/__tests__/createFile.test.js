"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const path_1 = require("path");
const { existsSyncMock, mkdirSyncMock, writeFileSyncMock, homedirMock } = vitest_1.vi.hoisted(() => ({
    existsSyncMock: vitest_1.vi.fn(),
    mkdirSyncMock: vitest_1.vi.fn(),
    writeFileSyncMock: vitest_1.vi.fn(),
    homedirMock: vitest_1.vi.fn(),
}));
vitest_1.vi.mock('fs', () => ({
    existsSync: existsSyncMock,
    mkdirSync: mkdirSyncMock,
    writeFileSync: writeFileSyncMock,
}));
vitest_1.vi.mock('os', () => ({
    homedir: homedirMock,
}));
vitest_1.vi.mock('../../db/db', () => ({
    toolExecutions: {
        create: vitest_1.vi.fn(),
        updateStatus: vitest_1.vi.fn(),
    },
}));
// Import after mocks are set up — this triggers registerTool
require("../createFile");
const toolRegistry_1 = require("../toolRegistry");
const HOME = (0, path_1.resolve)('/home/testuser');
const SCOPE_ROOT = (0, path_1.join)(HOME, 'Documents', 'Kyclius');
(0, vitest_1.beforeEach)(() => {
    vitest_1.vi.clearAllMocks();
    homedirMock.mockReturnValue(HOME);
    existsSyncMock.mockReturnValue(false);
});
(0, vitest_1.describe)('create_file tool', () => {
    const tool = () => (0, toolRegistry_1.getTool)('create_file');
    (0, vitest_1.it)('is registered with auto permission tier', () => {
        (0, vitest_1.expect)(tool()).toBeDefined();
        (0, vitest_1.expect)(tool().permissionTier).toBe('auto');
    });
    (0, vitest_1.it)('rejects a missing or empty filename', async () => {
        const missing = await tool().handler({ content: 'hello' });
        (0, vitest_1.expect)(missing.success).toBe(false);
        (0, vitest_1.expect)(missing.error).toMatch(/filename must be a non-empty string/);
        const empty = await tool().handler({ filename: '   ', content: 'hello' });
        (0, vitest_1.expect)(empty.success).toBe(false);
        (0, vitest_1.expect)(empty.error).toMatch(/filename must be an actual file name|non-empty/);
    });
    (0, vitest_1.it)('rejects non-string content', async () => {
        const result = await tool().handler({ filename: 'notes.txt', content: 42 });
        (0, vitest_1.expect)(result.success).toBe(false);
        (0, vitest_1.expect)(result.error).toMatch(/content must be a string/);
    });
    (0, vitest_1.it)('creates the file with correct content at the default Kyclius Documents location', async () => {
        const result = await tool().handler({
            filename: 'todo.txt',
            content: 'buy oat milk',
        });
        (0, vitest_1.expect)(result.success).toBe(true);
        const expectedPath = (0, path_1.join)(SCOPE_ROOT, 'todo.txt');
        (0, vitest_1.expect)(writeFileSyncMock).toHaveBeenCalledWith(expectedPath, 'buy oat milk', 'utf8');
        // The default scope folder is created on demand.
        (0, vitest_1.expect)(mkdirSyncMock).toHaveBeenCalledWith(SCOPE_ROOT, { recursive: true });
        // Result reports the final resolved absolute path.
        (0, vitest_1.expect)(result.result).toContain(expectedPath);
    });
    (0, vitest_1.it)('resolves a relative path into a subfolder of the Kyclius scope', async () => {
        const result = await tool().handler({
            path: 'notes',
            filename: 'idea.md',
            content: '# Idea',
        });
        (0, vitest_1.expect)(result.success).toBe(true);
        const expectedDir = (0, path_1.join)(SCOPE_ROOT, 'notes');
        (0, vitest_1.expect)(mkdirSyncMock).toHaveBeenCalledWith(expectedDir, { recursive: true });
        (0, vitest_1.expect)(writeFileSyncMock).toHaveBeenCalledWith((0, path_1.join)(expectedDir, 'idea.md'), '# Idea', 'utf8');
        (0, vitest_1.expect)(result.result).toContain((0, path_1.join)(expectedDir, 'idea.md'));
    });
    (0, vitest_1.it)('accepts an absolute path that stays inside the allowed scope', async () => {
        const insideDir = (0, path_1.join)(SCOPE_ROOT, 'deep', 'nested');
        const result = await tool().handler({
            path: insideDir,
            filename: 'a.txt',
            content: 'x',
        });
        (0, vitest_1.expect)(result.success).toBe(true);
        (0, vitest_1.expect)(writeFileSyncMock).toHaveBeenCalledWith((0, path_1.join)(insideDir, 'a.txt'), 'x', 'utf8');
    });
    (0, vitest_1.it)('refuses to overwrite an existing file and writes nothing', async () => {
        existsSyncMock.mockImplementation(p => p === (0, path_1.join)(SCOPE_ROOT, 'existing.txt'));
        const result = await tool().handler({
            filename: 'existing.txt',
            content: 'clobber attempt',
        });
        (0, vitest_1.expect)(result.success).toBe(false);
        (0, vitest_1.expect)(result.error).toMatch(/already exists/i);
        (0, vitest_1.expect)(writeFileSyncMock).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('rejects absolute paths outside the Kyclius scope', async () => {
        const outsideDir = (0, path_1.join)(HOME, 'Desktop');
        const result = await tool().handler({
            path: outsideDir,
            filename: 'evil.txt',
            content: 'x',
        });
        (0, vitest_1.expect)(result.success).toBe(false);
        (0, vitest_1.expect)(result.error).toMatch(/outside/i);
        (0, vitest_1.expect)(writeFileSyncMock).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('rejects relative traversal that climbs out of the Kyclius scope', async () => {
        const result = await tool().handler({
            path: '../../elsewhere',
            filename: 'escape.txt',
            content: 'x',
        });
        (0, vitest_1.expect)(result.success).toBe(false);
        (0, vitest_1.expect)(result.error).toMatch(/outside/i);
        (0, vitest_1.expect)(writeFileSyncMock).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('rejects filenames containing path separators (traversal via filename)', async () => {
        for (const bad of ['../evil.txt', '..\\evil.txt', 'sub/dir.txt']) {
            const result = await tool().handler({ filename: bad, content: 'x' });
            (0, vitest_1.expect)(result.success).toBe(false);
            (0, vitest_1.expect)(result.error).toMatch(/path separators/);
        }
        (0, vitest_1.expect)(writeFileSyncMock).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('reports disk-full as a clear typed failure', async () => {
        writeFileSyncMock.mockImplementation(() => {
            const err = new Error('no space');
            err.code = 'ENOSPC';
            throw err;
        });
        const result = await tool().handler({ filename: 'big.bin', content: 'data' });
        (0, vitest_1.expect)(result.success).toBe(false);
        (0, vitest_1.expect)(result.error).toMatch(/disk is full/i);
    });
    (0, vitest_1.it)('reports permission problems as a clear typed failure', async () => {
        writeFileSyncMock.mockImplementation(() => {
            const err = new Error('denied');
            err.code = 'EACCES';
            throw err;
        });
        const result = await tool().handler({ filename: 'locked.txt', content: 'data' });
        (0, vitest_1.expect)(result.success).toBe(false);
        (0, vitest_1.expect)(result.error).toMatch(/permission denied/i);
    });
});
