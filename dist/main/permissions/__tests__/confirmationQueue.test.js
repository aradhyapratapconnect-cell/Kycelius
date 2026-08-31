"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const { createMock, updateStatusMock } = vitest_1.vi.hoisted(() => ({
    createMock: vitest_1.vi.fn(),
    updateStatusMock: vitest_1.vi.fn(),
}));
vitest_1.vi.mock('../../db/db', () => ({
    toolExecutions: {
        create: createMock,
        updateStatus: updateStatusMock,
    },
}));
const confirmationQueue_1 = require("../confirmationQueue");
(0, vitest_1.beforeEach)(() => {
    (0, confirmationQueue_1.resetQueue)();
});
(0, vitest_1.describe)('confirmationQueue', () => {
    (0, vitest_1.it)('enqueues confirmations in order and exposes their full parameters', () => {
        (0, confirmationQueue_1.enqueueConfirmation)({ id: 'a', toolName: 'delete_file', parameters: { path: '/tmp/a' } });
        (0, confirmationQueue_1.enqueueConfirmation)({ id: 'b', toolName: 'run_shell_command', parameters: { command: 'ls' } });
        const pending = (0, confirmationQueue_1.getPendingConfirmations)();
        (0, vitest_1.expect)(pending.map(p => p.id)).toEqual(['a', 'b']);
        (0, vitest_1.expect)(pending[0].parameters).toEqual({ path: '/tmp/a' });
        (0, vitest_1.expect)(pending[0].toolName).toBe('delete_file');
        (0, vitest_1.expect)(pending[0].enqueuedAt).toEqual(vitest_1.expect.any(Number));
    });
    (0, vitest_1.it)('resolves each confirmation individually, never as a batch', async () => {
        const first = (0, confirmationQueue_1.enqueueConfirmation)({ id: 'a', toolName: 't', parameters: {} });
        const second = (0, confirmationQueue_1.enqueueConfirmation)({ id: 'b', toolName: 't', parameters: {} });
        let firstResult;
        let secondResult;
        first.response.then(r => (firstResult = r));
        second.response.then(r => (secondResult = r));
        (0, confirmationQueue_1.resolveConfirmation)('a', { action: 'approve' });
        await Promise.resolve();
        await Promise.resolve();
        (0, vitest_1.expect)(firstResult?.action).toBe('approve');
        (0, vitest_1.expect)(secondResult).toBeUndefined();
        (0, vitest_1.expect)((0, confirmationQueue_1.getPendingConfirmations)().map(p => p.id)).toEqual(['b']);
        (0, confirmationQueue_1.resolveConfirmation)('b', { action: 'deny', reason: 'nope' });
        await Promise.resolve();
        await Promise.resolve();
        (0, vitest_1.expect)(secondResult?.action).toBe('deny');
        (0, vitest_1.expect)(secondResult?.reason).toBe('nope');
        (0, vitest_1.expect)((0, confirmationQueue_1.getPendingConfirmations)()).toHaveLength(0);
    });
    (0, vitest_1.it)('returns false when resolving an unknown or already-resolved id', () => {
        (0, confirmationQueue_1.enqueueConfirmation)({ id: 'a', toolName: 't', parameters: {} });
        (0, vitest_1.expect)((0, confirmationQueue_1.resolveConfirmation)('missing', { action: 'approve' })).toBe(false);
        (0, vitest_1.expect)((0, confirmationQueue_1.resolveConfirmation)('a', { action: 'approve' })).toBe(true);
        (0, vitest_1.expect)((0, confirmationQueue_1.resolveConfirmation)('a', { action: 'deny' })).toBe(false);
    });
    (0, vitest_1.it)('rejects an invalid response action', () => {
        (0, confirmationQueue_1.enqueueConfirmation)({ id: 'a', toolName: 't', parameters: {} });
        (0, vitest_1.expect)((0, confirmationQueue_1.resolveConfirmation)('a', { action: 'maybe' })).toBe(false);
        (0, vitest_1.expect)((0, confirmationQueue_1.isConfirmationPending)('a')).toBe(true);
    });
    (0, vitest_1.it)('accepts the T-21 "always_allow" action alongside approve/deny/edit', async () => {
        const first = (0, confirmationQueue_1.enqueueConfirmation)({ id: 'aa', toolName: 't', parameters: {} });
        (0, confirmationQueue_1.enqueueConfirmation)({ id: 'ab', toolName: 't', parameters: {} });
        let firstResult;
        first.response.then(r => (firstResult = r));
        (0, vitest_1.expect)((0, confirmationQueue_1.resolveConfirmation)('aa', { action: 'always_allow', reason: 'trust it' })).toBe(true);
        await Promise.resolve();
        await Promise.resolve();
        (0, vitest_1.expect)(firstResult?.action).toBe('always_allow');
        (0, vitest_1.expect)((0, confirmationQueue_1.isConfirmationPending)('ab')).toBe(true);
    });
    (0, vitest_1.it)('throws when the same confirmation id is enqueued twice', () => {
        (0, confirmationQueue_1.enqueueConfirmation)({ id: 'dup', toolName: 't', parameters: {} });
        (0, vitest_1.expect)(() => (0, confirmationQueue_1.enqueueConfirmation)({ id: 'dup', toolName: 't', parameters: {} })).toThrow(/already pending/);
    });
    (0, vitest_1.it)('notifies subscribers on every enqueue and resolution', () => {
        const listener = vitest_1.vi.fn();
        (0, confirmationQueue_1.subscribeToQueue)(listener);
        (0, confirmationQueue_1.enqueueConfirmation)({ id: 'a', toolName: 't', parameters: {} });
        (0, confirmationQueue_1.resolveConfirmation)('a', { action: 'deny' });
        (0, vitest_1.expect)(listener).toHaveBeenCalledTimes(2);
        (0, vitest_1.expect)(listener.mock.calls[0][0]).toHaveLength(1);
        (0, vitest_1.expect)(listener.mock.calls[1][0]).toHaveLength(0);
    });
    (0, vitest_1.it)('looks up a single pending confirmation by id', () => {
        (0, confirmationQueue_1.enqueueConfirmation)({ id: 'xyz', toolName: 'send_email', parameters: { to: 'a@b.c' } });
        (0, vitest_1.expect)((0, confirmationQueue_1.getPendingConfirmationById)('xyz')?.parameters).toEqual({ to: 'a@b.c' });
        (0, vitest_1.expect)((0, confirmationQueue_1.getPendingConfirmationById)('other')).toBeUndefined();
    });
    (0, vitest_1.it)('resets pending entries with a denial so nothing hangs', async () => {
        const { response } = (0, confirmationQueue_1.enqueueConfirmation)({ id: 'stuck', toolName: 't', parameters: {} });
        let result;
        response.then(r => (result = r));
        (0, confirmationQueue_1.resetQueue)();
        await Promise.resolve();
        await Promise.resolve();
        (0, vitest_1.expect)(result?.action).toBe('deny');
        (0, vitest_1.expect)(result?.reason).toBe('queue reset');
    });
});
