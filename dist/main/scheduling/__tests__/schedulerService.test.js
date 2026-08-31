"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const store = vitest_1.vi.hoisted(() => ({
    tasks: new Map(),
    conversations: new Map(),
}));
const runTurnMock = vitest_1.vi.hoisted(() => vitest_1.vi.fn());
vitest_1.vi.mock('electron', () => ({
    BrowserWindow: { getAllWindows: () => [] },
}));
vitest_1.vi.mock('../../db/db', () => {
    let seq = 0;
    const now = 'now';
    const make = (input) => ({
        id: `t${++seq}`,
        input,
        name: input.name ?? '',
        schedule: input.schedule ?? '',
        command: input.command ?? '',
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
            create: (input) => {
                const task = make(input);
                store.tasks.set(task.id, task);
                return task;
            },
            getAll: () => Array.from(store.tasks.values()),
            getById: (id) => store.tasks.get(id),
            update: (id, patch) => {
                const task = store.tasks.get(id);
                if (!task)
                    return undefined;
                const next = { ...task, ...patch };
                store.tasks.set(id, next);
                return next;
            },
            setEnabled: (id, enabled) => {
                const task = store.tasks.get(id);
                if (task)
                    task.enabled = enabled;
            },
            setConversation: (id, conversationId) => {
                const task = store.tasks.get(id);
                if (task)
                    task.conversation_id = conversationId;
            },
            setLastRun: (id, outcome) => {
                const task = store.tasks.get(id);
                if (task) {
                    task.last_run_at = 'run-time';
                    task.last_status = outcome.status ?? null;
                    task.last_error = outcome.error ?? null;
                }
            },
            delete: (id) => store.tasks.delete(id),
        },
        conversations: {
            create: (title) => {
                const id = `c${store.tasks.size + store.conversations.size + 1}`;
                store.conversations.set(id, { id, title });
                return { id, title };
            },
            getById: (id) => store.conversations.get(id),
        },
    };
});
vitest_1.vi.mock('../../assistantState', () => ({
    broadcastAssistantState: vitest_1.vi.fn(),
}));
vitest_1.vi.mock('../../ipc/chat.handlers', () => ({
    runTurn: runTurnMock,
}));
const schedulerService_1 = require("../schedulerService");
const db_1 = require("../../db/db");
function armEnabledTask() {
    return db_1.scheduledTasks.create({
        name: 'minutely',
        schedule: '* * * * *',
        command: 'summarize unread GitHub notifications',
        enabled: true,
    }).id;
}
(0, vitest_1.beforeEach)(() => {
    store.tasks.clear();
    store.conversations.clear();
    runTurnMock.mockReset();
    runTurnMock.mockResolvedValue({ success: true, message: 'done' });
    vitest_1.vi.useFakeTimers();
    vitest_1.vi.setSystemTime(new Date(2026, 0, 3, 8, 59, 30));
});
(0, vitest_1.afterEach)(() => {
    vitest_1.vi.useRealTimers();
    (0, schedulerService_1.shutdownScheduler)();
});
(0, vitest_1.describe)('schedulerService', () => {
    (0, vitest_1.it)('fires an armed task at its next cron minute and records the outcome', async () => {
        const id = armEnabledTask();
        (0, schedulerService_1.startScheduler)();
        (0, vitest_1.expect)(runTurnMock).not.toHaveBeenCalled();
        await vitest_1.vi.advanceTimersByTimeAsync(30_000); // to 09:00:00
        (0, vitest_1.expect)(runTurnMock).toHaveBeenCalledTimes(1);
        const call = runTurnMock.mock.calls[0][0];
        (0, vitest_1.expect)(call.userText).toBe('summarize unread GitHub notifications');
        (0, vitest_1.expect)(call.agentProfile).toBeNull();
        (0, vitest_1.expect)(call.autoLearn).toBe(false);
        (0, vitest_1.expect)(call.inputMode).toBe('text');
        const task = store.tasks.get(id);
        (0, vitest_1.expect)(task.last_status).toBe('success');
        (0, vitest_1.expect)(task.conversation_id).toBeTruthy();
        // Runs into its own dedicated conversation, never the user's active one.
        (0, vitest_1.expect)(store.conversations.has(task.conversation_id)).toBe(true);
        // Re-arms for 09:01.
        await vitest_1.vi.advanceTimersByTimeAsync(60_000);
        (0, vitest_1.expect)(runTurnMock).toHaveBeenCalledTimes(2);
    });
    (0, vitest_1.it)('never schedules a disabled task', async () => {
        const disabledId = db_1.scheduledTasks.create({
            name: 'off',
            schedule: '* * * * *',
            command: 'hello',
            enabled: false,
        }).id;
        (0, schedulerService_1.startScheduler)();
        await vitest_1.vi.advanceTimersByTimeAsync(10 * 60_000);
        (0, vitest_1.expect)(runTurnMock).not.toHaveBeenCalled();
        (0, vitest_1.expect)(store.tasks.get(disabledId).last_status).toBeNull();
    });
    (0, vitest_1.it)('reloadScheduler drops timers for deleted tasks and arms new ones', async () => {
        const id = armEnabledTask();
        (0, schedulerService_1.startScheduler)();
        store.tasks.delete(id);
        (0, schedulerService_1.reloadScheduler)();
        await vitest_1.vi.advanceTimersByTimeAsync(10 * 60_000);
        (0, vitest_1.expect)(runTurnMock).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('skips overlapping occurrences while a run is still in flight', async () => {
        let resolveRun;
        runTurnMock.mockImplementation(() => new Promise(resolve => { resolveRun = resolve; }));
        armEnabledTask();
        (0, schedulerService_1.startScheduler)();
        await vitest_1.vi.advanceTimersByTimeAsync(30_000); // first fire starts, stays pending
        (0, vitest_1.expect)(runTurnMock).toHaveBeenCalledTimes(1);
        // Minute 09:01 and 09:02 fire while the first is still parked (e.g. waiting
        // on a confirmation) — dropped, never stacked.
        await vitest_1.vi.advanceTimersByTimeAsync(120_000);
        (0, vitest_1.expect)(runTurnMock).toHaveBeenCalledTimes(1);
        resolveRun({ success: true, message: 'done' });
        await vitest_1.vi.advanceTimersByTimeAsync(0);
        const task = Array.from(store.tasks.values())[0];
        (0, vitest_1.expect)(task.last_status).toBe('success');
    });
    (0, vitest_1.it)('records a failed run with the error', async () => {
        runTurnMock.mockRejectedValue(new Error('boom'));
        armEnabledTask();
        (0, schedulerService_1.startScheduler)();
        await vitest_1.vi.advanceTimersByTimeAsync(30_000);
        const task = Array.from(store.tasks.values())[0];
        (0, vitest_1.expect)(task.last_status).toBe('failed');
        (0, vitest_1.expect)(task.last_error).toContain('boom');
    });
    (0, vitest_1.it)('marks a failed CommandResult as failed', async () => {
        runTurnMock.mockResolvedValue({ success: false, message: 'no key', error: 'no key' });
        armEnabledTask();
        (0, schedulerService_1.startScheduler)();
        await vitest_1.vi.advanceTimersByTimeAsync(30_000);
        const task = Array.from(store.tasks.values())[0];
        (0, vitest_1.expect)(task.last_status).toBe('failed');
        (0, vitest_1.expect)(task.last_error).toBe('no key');
    });
});
