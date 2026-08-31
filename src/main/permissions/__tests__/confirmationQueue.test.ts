import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createMock, updateStatusMock } = vi.hoisted(() => ({
  createMock: vi.fn(),
  updateStatusMock: vi.fn(),
}));

vi.mock('../../db/db', () => ({
  toolExecutions: {
    create: createMock,
    updateStatus: updateStatusMock,
  },
}));

import {
  enqueueConfirmation,
  getPendingConfirmationById,
  getPendingConfirmations,
  isConfirmationPending,
  resetQueue,
  resolveConfirmation,
  subscribeToQueue,
  type ConfirmationResponse,
} from '../confirmationQueue';

beforeEach(() => {
  resetQueue();
});

describe('confirmationQueue', () => {
  it('enqueues confirmations in order and exposes their full parameters', () => {
    enqueueConfirmation({ id: 'a', toolName: 'delete_file', parameters: { path: '/tmp/a' } });
    enqueueConfirmation({ id: 'b', toolName: 'run_shell_command', parameters: { command: 'ls' } });

    const pending = getPendingConfirmations();

    expect(pending.map(p => p.id)).toEqual(['a', 'b']);
    expect(pending[0].parameters).toEqual({ path: '/tmp/a' });
    expect(pending[0].toolName).toBe('delete_file');
    expect(pending[0].enqueuedAt).toEqual(expect.any(Number));
  });

  it('resolves each confirmation individually, never as a batch', async () => {
    const first = enqueueConfirmation({ id: 'a', toolName: 't', parameters: {} });
    const second = enqueueConfirmation({ id: 'b', toolName: 't', parameters: {} });

    let firstResult: ConfirmationResponse | undefined;
    let secondResult: ConfirmationResponse | undefined;
    first.response.then(r => (firstResult = r));
    second.response.then(r => (secondResult = r));

    resolveConfirmation('a', { action: 'approve' });
    await Promise.resolve();
    await Promise.resolve();

    expect(firstResult?.action).toBe('approve');
    expect(secondResult).toBeUndefined();
    expect(getPendingConfirmations().map(p => p.id)).toEqual(['b']);

    resolveConfirmation('b', { action: 'deny', reason: 'nope' });
    await Promise.resolve();
    await Promise.resolve();

    expect(secondResult?.action).toBe('deny');
    expect(secondResult?.reason).toBe('nope');
    expect(getPendingConfirmations()).toHaveLength(0);
  });

  it('returns false when resolving an unknown or already-resolved id', () => {
    enqueueConfirmation({ id: 'a', toolName: 't', parameters: {} });

    expect(resolveConfirmation('missing', { action: 'approve' })).toBe(false);
    expect(resolveConfirmation('a', { action: 'approve' })).toBe(true);
    expect(resolveConfirmation('a', { action: 'deny' })).toBe(false);
  });

  it('rejects an invalid response action', () => {
    enqueueConfirmation({ id: 'a', toolName: 't', parameters: {} });
    expect(
      resolveConfirmation('a', { action: 'maybe' as never })
    ).toBe(false);
    expect(isConfirmationPending('a')).toBe(true);
  });

  it('accepts the T-21 "always_allow" action alongside approve/deny/edit', async () => {
    const first = enqueueConfirmation({ id: 'aa', toolName: 't', parameters: {} });
    enqueueConfirmation({ id: 'ab', toolName: 't', parameters: {} });
    let firstResult: ConfirmationResponse | undefined;
    first.response.then(r => (firstResult = r));

    expect(resolveConfirmation('aa', { action: 'always_allow', reason: 'trust it' })).toBe(true);
    await Promise.resolve();
    await Promise.resolve();

    expect(firstResult?.action).toBe('always_allow');
    expect(isConfirmationPending('ab')).toBe(true);
  });

  it('throws when the same confirmation id is enqueued twice', () => {
    enqueueConfirmation({ id: 'dup', toolName: 't', parameters: {} });
    expect(() =>
      enqueueConfirmation({ id: 'dup', toolName: 't', parameters: {} })
    ).toThrow(/already pending/);
  });

  it('notifies subscribers on every enqueue and resolution', () => {
    const listener = vi.fn();
    subscribeToQueue(listener);

    enqueueConfirmation({ id: 'a', toolName: 't', parameters: {} });
    resolveConfirmation('a', { action: 'deny' });

    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener.mock.calls[0][0]).toHaveLength(1);
    expect(listener.mock.calls[1][0]).toHaveLength(0);
  });

  it('looks up a single pending confirmation by id', () => {
    enqueueConfirmation({ id: 'xyz', toolName: 'send_email', parameters: { to: 'a@b.c' } });

    expect(getPendingConfirmationById('xyz')?.parameters).toEqual({ to: 'a@b.c' });
    expect(getPendingConfirmationById('other')).toBeUndefined();
  });

  it('resets pending entries with a denial so nothing hangs', async () => {
    const { response } = enqueueConfirmation({ id: 'stuck', toolName: 't', parameters: {} });
    let result: ConfirmationResponse | undefined;
    response.then(r => (result = r));

    resetQueue();
    await Promise.resolve();
    await Promise.resolve();

    expect(result?.action).toBe('deny');
    expect(result?.reason).toBe('queue reset');
  });
});
