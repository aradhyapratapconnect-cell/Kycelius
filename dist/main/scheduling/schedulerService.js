"use strict";
/**
 * N-05: main-process scheduler for recurring commands.
 *
 * On startup every enabled scheduled_tasks row is armed with a wall-clock
 * timer computed from its cron expression. When a task fires it runs through
 * the same agent pipeline as an interactive command (runTurn in
 * chat.handlers) but into its own dedicated conversation, so automated output
 * never pollutes the user's active thread. Every confirm_required action still
 * passes through the standard permission engine — queued to the renderer as a
 * normal confirmation dialog, never auto-executed.
 *
 * Reliability across restarts: fire times are always recomputed from the cron
 * expression relative to now when arming, so missed occurrences while the app
 * was closed are skipped rather than replayed. Overlapping occurrences of the
 * same task are dropped rather than queued.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.subscribeSchedulerNotifications = subscribeSchedulerNotifications;
exports.announceSchedulerChange = announceSchedulerChange;
exports.reloadScheduler = reloadScheduler;
exports.startScheduler = startScheduler;
exports.shutdownScheduler = shutdownScheduler;
const electron_1 = require("electron");
const crypto_1 = require("crypto");
const db_1 = require("../db/db");
const chat_handlers_1 = require("../ipc/chat.handlers");
const assistantState_1 = require("../assistantState");
const cron_1 = require("./cron");
/** Node's setTimeout caps at ~24.8 days; larger delays re-check on that cadence. */
const MAX_TIMEOUT_MS = 2 ** 31 - 1;
/** Small cushion so a fire time computed milliseconds in the past still fires. */
const MIN_DELAY_MS = 50;
const pending = new Map();
const inFlight = new Set();
const listeners = new Set();
function subscribeSchedulerNotifications(callback) {
    listeners.add(callback);
    return () => listeners.delete(callback);
}
/** Tell the renderer (and in-process subscribers) the task set changed. */
function announceSchedulerChange() {
    for (const win of electron_1.BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) {
            win.webContents.send('kyclius:scheduled-tasks-changed');
        }
    }
    for (const listener of listeners)
        listener();
}
/** Clear + re-arm a task from its current (possibly edited) DB row. */
function reloadScheduler() {
    const current = new Map(db_1.scheduledTasks.getAll().map(t => [t.id, t]));
    // Drop timers for tasks that were deleted or disabled.
    for (const [id, timer] of pending) {
        const task = current.get(id);
        if (!task || !task.enabled) {
            clearTimeout(timer);
            pending.delete(id);
        }
    }
    // (Re)arm everything enabled; scheduleTask starts with clearing the timer,
    // so this is safe to run alongside existing entries.
    for (const task of current.values()) {
        if (task.enabled)
            scheduleTask(task);
    }
}
function arm(task, delayMs) {
    const existing = pending.get(task.id);
    if (existing)
        clearTimeout(existing);
    pending.delete(task.id);
    if (delayMs > MAX_TIMEOUT_MS) {
        // Gap larger than a single setTimeout — re-evaluate on the timeout cap.
        pending.set(task.id, setTimeout(() => {
            pending.delete(task.id);
            arm(task, delayMs - MAX_TIMEOUT_MS);
        }, MAX_TIMEOUT_MS));
        return;
    }
    pending.set(task.id, setTimeout(() => {
        pending.delete(task.id);
        void fire(task.id);
    }, Math.max(delayMs, MIN_DELAY_MS)));
}
function scheduleTask(task) {
    if (!task.enabled)
        return;
    try {
        const fireAt = (0, cron_1.nextFireAt)(task.schedule, new Date());
        arm(task, fireAt.getTime() - Date.now());
    }
    catch (err) {
        console.error(`[scheduler] Task "${task.name}" has an invalid schedule and was not armed: ${err instanceof Error ? err.message : String(err)}`);
    }
}
async function fire(taskId) {
    const task = db_1.scheduledTasks.getById(taskId);
    if (!task || !task.enabled)
        return;
    // Overlapping occurrence — drop instead of stacking runs for one task.
    if (inFlight.has(taskId)) {
        rescheduleNext(taskId);
        return;
    }
    inFlight.add(taskId);
    db_1.scheduledTasks.setLastRun(taskId, { status: 'running' });
    try {
        // Each task gets its own conversation (created on first run) so scheduled
        // output lives apart from the user's active conversation and still shows
        // up on the Dashboard as a normal Q&A entry.
        let conversationId = task.conversation_id;
        if (!conversationId || !db_1.conversations.getById(conversationId)) {
            conversationId = db_1.conversations.create(task.name).id;
            db_1.scheduledTasks.setConversation(task.id, conversationId);
        }
        const result = await (0, chat_handlers_1.runTurn)({
            conversationId,
            userText: task.command,
            inputMode: 'text',
            turnId: (0, crypto_1.randomUUID)(),
            isCancelled: () => false,
            broadcast: assistantState_1.broadcastAssistantState,
            // Schedules use the full registry toolset, never the active persona's
            // narrowed list, and never teach themselves facts from automated runs.
            agentProfile: null,
            autoLearn: false,
        });
        db_1.scheduledTasks.setLastRun(taskId, {
            status: result.success ? 'success' : 'failed',
            error: result.success ? undefined : (result.error ?? result.message),
        });
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[scheduler] Task "${task.name}" failed: ${message}`);
        db_1.scheduledTasks.setLastRun(taskId, { status: 'failed', error: message });
    }
    finally {
        inFlight.delete(taskId);
        announceSchedulerChange();
        rescheduleNext(taskId);
    }
}
/** Re-arm the next occurrence after a run (skips if deleted or disabled). */
function rescheduleNext(taskId) {
    const task = db_1.scheduledTasks.getById(taskId);
    if (task)
        scheduleTask(task);
}
/** Arm every enabled task. Call once after the main window is created. */
function startScheduler() {
    reloadScheduler();
    const enabledCount = db_1.scheduledTasks.getAll().filter(t => t.enabled).length;
    console.log(`[scheduler] ${enabledCount} scheduled task(s) armed`);
}
/** Drop all timers. Call on quit so nothing fires mid-shutdown. */
function shutdownScheduler() {
    for (const [, timer] of pending)
        clearTimeout(timer);
    pending.clear();
    inFlight.clear();
}
