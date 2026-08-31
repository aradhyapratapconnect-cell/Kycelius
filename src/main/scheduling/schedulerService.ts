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

import { BrowserWindow } from 'electron';
import { randomUUID } from 'crypto';
import { conversations, scheduledTasks, type ScheduledTask } from '../db/db';
import { runTurn } from '../ipc/chat.handlers';
import { broadcastAssistantState } from '../assistantState';
import { nextFireAt } from './cron';

/** Node's setTimeout caps at ~24.8 days; larger delays re-check on that cadence. */
const MAX_TIMEOUT_MS = 2 ** 31 - 1;
/** Small cushion so a fire time computed milliseconds in the past still fires. */
const MIN_DELAY_MS = 50;

const pending = new Map<string, NodeJS.Timeout>();
const inFlight = new Set<string>();

type NotifyFn = () => void;
const listeners = new Set<NotifyFn>();

export function subscribeSchedulerNotifications(callback: NotifyFn): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

/** Tell the renderer (and in-process subscribers) the task set changed. */
export function announceSchedulerChange(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('kyclius:scheduled-tasks-changed');
    }
  }
  for (const listener of listeners) listener();
}

/** Clear + re-arm a task from its current (possibly edited) DB row. */
export function reloadScheduler(): void {
  const current = new Map(scheduledTasks.getAll().map(t => [t.id, t]));

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
    if (task.enabled) scheduleTask(task);
  }
}

function arm(task: ScheduledTask, delayMs: number): void {
  const existing = pending.get(task.id);
  if (existing) clearTimeout(existing);
  pending.delete(task.id);

  if (delayMs > MAX_TIMEOUT_MS) {
    // Gap larger than a single setTimeout — re-evaluate on the timeout cap.
    pending.set(
      task.id,
      setTimeout(() => {
        pending.delete(task.id);
        arm(task, delayMs - MAX_TIMEOUT_MS);
      }, MAX_TIMEOUT_MS)
    );
    return;
  }

  pending.set(
    task.id,
    setTimeout(() => {
      pending.delete(task.id);
      void fire(task.id);
    }, Math.max(delayMs, MIN_DELAY_MS))
  );
}

function scheduleTask(task: ScheduledTask): void {
  if (!task.enabled) return;
  try {
    const fireAt = nextFireAt(task.schedule, new Date());
    arm(task, fireAt.getTime() - Date.now());
  } catch (err) {
    console.error(
      `[scheduler] Task "${task.name}" has an invalid schedule and was not armed: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
}

async function fire(taskId: string): Promise<void> {
  const task = scheduledTasks.getById(taskId);
  if (!task || !task.enabled) return;

  // Overlapping occurrence — drop instead of stacking runs for one task.
  if (inFlight.has(taskId)) {
    rescheduleNext(taskId);
    return;
  }
  inFlight.add(taskId);
  scheduledTasks.setLastRun(taskId, { status: 'running' });

  try {
    // Each task gets its own conversation (created on first run) so scheduled
    // output lives apart from the user's active conversation and still shows
    // up on the Dashboard as a normal Q&A entry.
    let conversationId = task.conversation_id;
    if (!conversationId || !conversations.getById(conversationId)) {
      conversationId = conversations.create(task.name).id;
      scheduledTasks.setConversation(task.id, conversationId);
    }

    const result = await runTurn({
      conversationId,
      userText: task.command,
      inputMode: 'text',
      turnId: randomUUID(),
      isCancelled: () => false,
      broadcast: broadcastAssistantState,
      // Schedules use the full registry toolset, never the active persona's
      // narrowed list, and never teach themselves facts from automated runs.
      agentProfile: null,
      autoLearn: false,
    });

    scheduledTasks.setLastRun(taskId, {
      status: result.success ? 'success' : 'failed',
      error: result.success ? undefined : (result.error ?? result.message),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[scheduler] Task "${task.name}" failed: ${message}`);
    scheduledTasks.setLastRun(taskId, { status: 'failed', error: message });
  } finally {
    inFlight.delete(taskId);
    announceSchedulerChange();
    rescheduleNext(taskId);
  }
}

/** Re-arm the next occurrence after a run (skips if deleted or disabled). */
function rescheduleNext(taskId: string): void {
  const task = scheduledTasks.getById(taskId);
  if (task) scheduleTask(task);
}

/** Arm every enabled task. Call once after the main window is created. */
export function startScheduler(): void {
  reloadScheduler();
  const enabledCount = scheduledTasks.getAll().filter(t => t.enabled).length;
  console.log(`[scheduler] ${enabledCount} scheduled task(s) armed`);
}

/** Drop all timers. Call on quit so nothing fires mid-shutdown. */
export function shutdownScheduler(): void {
  for (const [, timer] of pending) clearTimeout(timer);
  pending.clear();
  inFlight.clear();
}