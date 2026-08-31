import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({
  tasks: new Map<string, Record<string, unknown>>(),
  conversations: new Map<string, Record<string, unknown>>(),
}));

const runTurnMock = vi.hoisted(() => vi.fn());

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
}));

vi.mock('../../db/db', () => {
  let seq = 0;
  const now = 'now';
  const make = (input: Record<string, unknown>) => ({
    id: `t${++seq}`,
    input,
    name: (input.name as string) ?? '',
    schedule: (input.schedule as string) ?? '',
    command: (input.command as string) ?? '',
    enabled: input.enabled !== false,
    conversation_id: null,
    last_run_at: null,
    last_status: null,
    last_error: null,
    created_at: now,
    updated_at: now,
  });
  return {
    scheduledTasks: {
      create: (input: Record<string, unknown>) => {
        const task = make(input);
        store.tasks.set(task.id as string, task);
        return task;
      },
      getAll: () => Array.from(store.tasks.values()),
      getById: (id: string) => store.tasks.get(id),
      update: (id: string, patch: Record<string, unknown>) => {
        const task = store.tasks.get(id);
        if (!task) return undefined;
        const next = { ...task, ...patch };
        store.tasks.set(id, next);
        return next;
      },
      setEnabled: (id: string, enabled: boolean) => {
        const task = store.tasks.get(id);
        if (task) task.enabled = enabled;
      },
      setConversation: (id: string, conversationId: string) => {
        const task = store.tasks.get(id);
        if (task) task.conversation_id = conversationId;
      },
      setLastRun: (
        id: string,
        outcome: { status: string | null; error?: string }
      ) => {
        const task = store.tasks.get(id);
        if (task) {
          task.last_run_at = 'run-time';
          task.last_status = outcome.status ?? null;
          task.last_error = outcome.error ?? null;
        }
      },
      delete: (id: string) => store.tasks.delete(id),
    },
    conversations: {
      create: (title: string) => {
        const id = `c${store.tasks.size + store.conversations.size + 1}`;
        store.conversations.set(id, { id, title });
        return { id, title };
      },
      getById: (id: string) => store.conversations.get(id),
    },
  };
});

vi.mock('../../assistantState', () => ({
  broadcastAssistantState: vi.fn(),
}));

vi.mock('../../ipc/chat.handlers', () => ({
  runTurn: runTurnMock,
}));

import {
  startScheduler,
  shutdownScheduler,
  reloadScheduler,
} from '../schedulerService';
import { scheduledTasks as mockScheduledTasks } from '../../db/db';

function armEnabledTask(): string {
  return mockScheduledTasks.create({
    name: 'minutely',
    schedule: '* * * * *',
    command: 'summarize unread GitHub notifications',
    enabled: true,
  }).id;
}

beforeEach(() => {
  store.tasks.clear();
  store.conversations.clear();
  runTurnMock.mockReset();
  runTurnMock.mockResolvedValue({ success: true, message: 'done' });
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 0, 3, 8, 59, 30));
});

afterEach(() => {
  vi.useRealTimers();
  shutdownScheduler();
});

describe('schedulerService', () => {
  it('fires an armed task at its next cron minute and records the outcome', async () => {
    const id = armEnabledTask();
    startScheduler();
    expect(runTurnMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(30_000); // to 09:00:00
    expect(runTurnMock).toHaveBeenCalledTimes(1);
    const call = runTurnMock.mock.calls[0][0];
    expect(call.userText).toBe('summarize unread GitHub notifications');
    expect(call.agentProfile).toBeNull();
    expect(call.autoLearn).toBe(false);
    expect(call.inputMode).toBe('text');

    const task = store.tasks.get(id)!;
    expect(task.last_status).toBe('success');
    expect(task.conversation_id).toBeTruthy();
    // Runs into its own dedicated conversation, never the user's active one.
    expect(store.conversations.has(task.conversation_id as string)).toBe(true);

    // Re-arms for 09:01.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(runTurnMock).toHaveBeenCalledTimes(2);
  });

  it('never schedules a disabled task', async () => {
    const disabledId = mockScheduledTasks.create({
      name: 'off',
      schedule: '* * * * *',
      command: 'hello',
      enabled: false,
    }).id;
    startScheduler();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(runTurnMock).not.toHaveBeenCalled();
    expect(store.tasks.get(disabledId)!.last_status).toBeNull();
  });

  it('reloadScheduler drops timers for deleted tasks and arms new ones', async () => {
    const id = armEnabledTask();
    startScheduler();
    store.tasks.delete(id);
    reloadScheduler();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(runTurnMock).not.toHaveBeenCalled();
  });

  it('skips overlapping occurrences while a run is still in flight', async () => {
    let resolveRun: ((value: unknown) => void) | undefined;
    runTurnMock.mockImplementation(
      () => new Promise(resolve => { resolveRun = resolve; })
    );
    armEnabledTask();
    startScheduler();

    await vi.advanceTimersByTimeAsync(30_000); // first fire starts, stays pending
    expect(runTurnMock).toHaveBeenCalledTimes(1);

    // Minute 09:01 and 09:02 fire while the first is still parked (e.g. waiting
    // on a confirmation) — dropped, never stacked.
    await vi.advanceTimersByTimeAsync(120_000);
    expect(runTurnMock).toHaveBeenCalledTimes(1);

    resolveRun!({ success: true, message: 'done' });
    await vi.advanceTimersByTimeAsync(0);
    const task = Array.from(store.tasks.values())[0];
    expect(task.last_status).toBe('success');
  });

  it('records a failed run with the error', async () => {
    runTurnMock.mockRejectedValue(new Error('boom'));
    armEnabledTask();
    startScheduler();
    await vi.advanceTimersByTimeAsync(30_000);
    const task = Array.from(store.tasks.values())[0];
    expect(task.last_status).toBe('failed');
    expect(task.last_error).toContain('boom');
  });

  it('marks a failed CommandResult as failed', async () => {
    runTurnMock.mockResolvedValue({ success: false, message: 'no key', error: 'no key' });
    armEnabledTask();
    startScheduler();
    await vi.advanceTimersByTimeAsync(30_000);
    const task = Array.from(store.tasks.values())[0];
    expect(task.last_status).toBe('failed');
    expect(task.last_error).toBe('no key');
  });
});