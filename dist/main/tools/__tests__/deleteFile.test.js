"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const path_1 = require("path");
const { existsSyncMock, statSyncMock, unlinkSyncMock, homedirMock } = vitest_1.vi.hoisted(() => ({
    existsSyncMock: vitest_1.vi.fn(),
    statSyncMock: vitest_1.vi.fn(),
    unlinkSyncMock: vitest_1.vi.fn(),
    homedirMock: vitest_1.vi.fn(),
}));
vitest_1.vi.mock('fs', () => ({
    existsSync: existsSyncMock,
    statSync: statSyncMock,
    unlinkSync: unlinkSyncMock,
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
require("../deleteFile");
const toolRegistry_1 = require("../toolRegistry");
const db_1 = require("../../db/db");
const HOME = (0, path_1.resolve)((0, path_1.join)('/', 'home', 'testuser'));
const TARGET = (0, path_1.resolve)((0, path_1.join)(HOME, 'Documents', 'notes.txt'));
function approvedGate() {
    return vitest_1.vi.fn(async () => ({ decision: 'proceed' }));
}
function deniedGate() {
    return vitest_1.vi.fn(async () => ({ decision: 'deny', reason: 'user said no' }));
}
function gateParams(gate) {
    const context = gate.mock.calls[0][0];
    return context.params;
}
(0, vitest_1.beforeEach)(() => {
    vitest_1.vi.clearAllMocks();
    homedirMock.mockReturnValue(HOME);
    // Default: the target exists and is a regular file.
    existsSyncMock.mockImplementation(p => p === TARGET);
    statSyncMock.mockImplementation(p => p === TARGET ? { isFile: () => true, isDirectory: () => false } : null);
    (0, toolRegistry_1.setExecutionGate)(null);
});
(0, vitest_1.describe)('delete_file tool', () => {
    const tool = () => (0, toolRegistry_1.getTool)('delete_file');
    (0, vitest_1.it)('is registered with confirm_required permission tier', () => {
        (0, vitest_1.expect)(tool()).toBeDefined();
        (0, vitest_1.expect)(tool().permissionTier).toBe('confirm_required');
    });
    (0, vitest_1.it)('resolves ~ paths to an absolute path so the dialog shows exactly what is deleted', async () => {
        const gate = approvedGate();
        (0, toolRegistry_1.setExecutionGate)(gate);
        // Exists during normalization + handler pre-check; gone after deletion.
        existsSyncMock.mockImplementation(p => p === TARGET && existsSyncMock.mock.calls.length <= 2);
        const outcome = await (0, toolRegistry_1.executeToolCall)('delete_file', { path: '~/Documents/notes.txt' });
        (0, vitest_1.expect)(outcome.success).toBe(true);
        const shownParams = gateParams(gate);
        (0, vitest_1.expect)(shownParams.path).toBe(TARGET); // exact resolved absolute path pre-approval
    });
    (0, vitest_1.it)('refuses system-critical paths outright — the confirmation gate never fires', async () => {
        const windowsPath = (0, path_1.join)(process.env.SystemRoot ?? 'C:\\Windows', 'system32', 'kernel32.dll');
        existsSyncMock.mockReturnValue(true);
        const outcome = await (0, toolRegistry_1.executeToolCall)('delete_file', { path: windowsPath });
        (0, vitest_1.expect)(outcome.success).toBe(false);
        (0, vitest_1.expect)(outcome.error).toMatch(/Refused|system-critical/i);
        (0, vitest_1.expect)(unlinkSyncMock).not.toHaveBeenCalled();
        (0, vitest_1.expect)(db_1.toolExecutions.updateStatus).toHaveBeenCalledWith(vitest_1.expect.any(String), 'failed', vitest_1.expect.anything());
    });
    (0, vitest_1.it)('refuses the user home root itself even though it exists', async () => {
        existsSyncMock.mockReturnValue(true);
        const outcome = await (0, toolRegistry_1.executeToolCall)('delete_file', { path: HOME });
        (0, vitest_1.expect)(outcome.success).toBe(false);
        (0, vitest_1.expect)(outcome.error).toMatch(/Refused|system-critical|regular file/i);
        (0, vitest_1.expect)(unlinkSyncMock).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('returns a clear "nothing to delete" result for missing files without any dialog', async () => {
        const gate = approvedGate();
        (0, toolRegistry_1.setExecutionGate)(gate);
        const outcome = await (0, toolRegistry_1.executeToolCall)('delete_file', { path: (0, path_1.join)(HOME, 'ghost.txt') });
        (0, vitest_1.expect)(outcome.success).toBe(false);
        (0, vitest_1.expect)(outcome.error).toMatch(/nothing to delete/i);
        (0, vitest_1.expect)(gate).not.toHaveBeenCalled();
        (0, vitest_1.expect)(unlinkSyncMock).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('refuses directories instead of attempting deletion', async () => {
        const dir = (0, path_1.join)(HOME, 'some-folder');
        existsSyncMock.mockImplementation(p => p === dir);
        statSyncMock.mockImplementation(p => p === dir ? { isFile: () => false, isDirectory: () => true } : null);
        const outcome = await (0, toolRegistry_1.executeToolCall)('delete_file', { path: dir });
        (0, vitest_1.expect)(outcome.success).toBe(false);
        (0, vitest_1.expect)(outcome.error).toMatch(/not a regular file/i);
        (0, vitest_1.expect)(unlinkSyncMock).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('deletes only after approval and verifies the file is actually gone before success', async () => {
        (0, toolRegistry_1.setExecutionGate)(approvedGate());
        // Sequence: pre-gate existence check true, handler pre-check true,
        // post-unlink verification false.
        existsSyncMock.mockImplementation(p => p === TARGET && existsSyncMock.mock.calls.length <= 2);
        const outcome = await (0, toolRegistry_1.executeToolCall)('delete_file', { path: TARGET });
        (0, vitest_1.expect)(unlinkSyncMock).toHaveBeenCalledWith(TARGET);
        (0, vitest_1.expect)(outcome.success).toBe(true);
        (0, vitest_1.expect)(outcome.result).toContain(TARGET);
    });
    (0, vitest_1.it)('reports honest failure if the file somehow survives the delete call', async () => {
        (0, toolRegistry_1.setExecutionGate)(approvedGate());
        existsSyncMock.mockReturnValue(true); // still present after unlink
        const outcome = await (0, toolRegistry_1.executeToolCall)('delete_file', { path: TARGET });
        (0, vitest_1.expect)(unlinkSyncMock).toHaveBeenCalled();
        (0, vitest_1.expect)(outcome.success).toBe(false);
        (0, vitest_1.expect)(outcome.error).toMatch(/still present/i);
    });
    (0, vitest_1.it)('denial results in no deletion and a denied audit entry', async () => {
        (0, toolRegistry_1.setExecutionGate)(deniedGate());
        const outcome = await (0, toolRegistry_1.executeToolCall)('delete_file', { path: TARGET });
        (0, vitest_1.expect)(outcome.success).toBe(false);
        (0, vitest_1.expect)(outcome.error).toMatch(/not approved/);
        (0, vitest_1.expect)(unlinkSyncMock).not.toHaveBeenCalled();
        (0, vitest_1.expect)(db_1.toolExecutions.updateStatus).toHaveBeenCalledWith(vitest_1.expect.any(String), 'denied', vitest_1.expect.stringContaining('user said no'));
    });
    (0, vitest_1.it)('maps locked/permission failures to a clear typed error', async () => {
        unlinkSyncMock.mockImplementation(() => {
            const err = new Error('busy');
            err.code = 'EBUSY';
            throw err;
        });
        (0, toolRegistry_1.setExecutionGate)(approvedGate());
        const outcome = await (0, toolRegistry_1.executeToolCall)('delete_file', { path: TARGET });
        (0, vitest_1.expect)(outcome.success).toBe(false);
        (0, vitest_1.expect)(outcome.error).toMatch(/open or locked/i);
    });
    (0, vitest_1.it)('re-runs safety checks on user-edited params from the dialog Edit flow', async () => {
        const editedPath = (0, path_1.join)(process.env.SystemRoot ?? 'C:\\Windows', 'evil.dll');
        const gate = vitest_1.vi.fn(async () => ({
            decision: 'proceed_with_params',
            params: { path: editedPath },
        }));
        (0, toolRegistry_1.setExecutionGate)(gate);
        existsSyncMock.mockReturnValue(true);
        const outcome = await (0, toolRegistry_1.executeToolCall)('delete_file', { path: TARGET });
        (0, vitest_1.expect)(outcome.success).toBe(false);
        (0, vitest_1.expect)(outcome.error).toMatch(/Edited parameters rejected/);
        (0, vitest_1.expect)(unlinkSyncMock).not.toHaveBeenCalled();
    });
});
