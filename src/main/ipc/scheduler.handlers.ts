/**
 * N-05: IPC surface for scheduled tasks. Mutations re-arm the main-process
 * scheduler and announce the change so the Settings panel stays fresh.
 */

import { ipcMain } from 'electron';
import { scheduledTasks, type ScheduledTask, type ScheduledTaskInput } from '../db/db';
import { parseCron, nextFireAt, describeCron } from '../scheduling/cron';
import { reloadScheduler, announceSchedulerChange } from '../scheduling/schedulerService';

/**
 * Main-process shape of what the renderer sees. Structurally identical to the
 * shared ScheduledTaskInfo (src/shared/types/ipc.ts); main can't import from
 * shared because its tsconfig rootDir is src/main.
 */
type ScheduledTaskInfo = ScheduledTask & {
  next_fire_at: string | null;
  schedule_description: string;
};

function toInfo(task: ScheduledTask | undefined): ScheduledTaskInfo | undefined {
  if (!task) return undefined;
  const info: ScheduledTaskInfo = {
    ...task,
    next_fire_at: null,
    schedule_description: describeCron(task.schedule),
  };
  if (task.enabled) {
    try {
      info.next_fire_at = nextFireAt(task.schedule).toISOString();
    } catch {
      info.next_fire_at = null;
    }
  }
  return info;
}

function parseSchedule(schedule: string): string {
  const raw = typeof schedule === 'string' ? schedule.trim() : '';
  if (!raw) throw new Error('A cron schedule is required.');
  parseCron(raw); // throws CronExpressionError on bad expressions.
  return raw;
}

function normalizeInput(input: Partial<ScheduledTaskInput> & Record<string, unknown>): Partial<ScheduledTaskInput> {
  const out: Partial<ScheduledTaskInput> = {};
  if (typeof input.name === 'string') {
    const name = input.name.trim();
    if (!name) throw new Error('A name is required.');
    out.name = name;
  }
  if (typeof input.command === 'string') {
    const command = input.command.trim();
    if (!command) throw new Error('A command is required.');
    out.command = command;
  }
  if (typeof input.schedule === 'string') out.schedule = parseSchedule(input.schedule);
  if (typeof input.enabled === 'boolean') out.enabled = input.enabled;
  return out;
}

export function registerSchedulerHandlers(): void {
  ipcMain.handle('kyclius:list-scheduled-tasks', (): ScheduledTaskInfo[] => {
    return scheduledTasks
      .getAll()
      .map(task => toInfo(task))
      .filter((t): t is ScheduledTaskInfo => t !== undefined);
  });

  ipcMain.handle(
    'kyclius:create-scheduled-task',
    (_event, input: unknown): ScheduledTaskInfo => {
      const raw = (input ?? {}) as Partial<ScheduledTaskInput> & Record<string, unknown>;
      const normalized = normalizeInput(raw);
      if (normalized.name === undefined) throw new Error('A name is required.');
      if (normalized.command === undefined) throw new Error('A command is required.');
      if (normalized.schedule === undefined) throw new Error('A cron schedule is required.');
      const task = scheduledTasks.create({
        name: normalized.name,
        schedule: normalized.schedule,
        command: normalized.command,
        enabled: raw.enabled !== false,
      });
      reloadScheduler();
      announceSchedulerChange();
      return toInfo(task) as ScheduledTaskInfo;
    }
  );

  ipcMain.handle(
    'kyclius:update-scheduled-task',
    (_event, id: string, patch: unknown): ScheduledTaskInfo => {
      const task = scheduledTasks.update(id, normalizeInput(patch as Record<string, unknown>));
      if (!task) throw new Error('Scheduled task not found.');
      reloadScheduler();
      announceSchedulerChange();
      return toInfo(task) as ScheduledTaskInfo;
    }
  );

  ipcMain.handle(
    'kyclius:delete-scheduled-task',
    (_event, id: string): { removed: boolean } => {
      scheduledTasks.delete(id);
      reloadScheduler();
      announceSchedulerChange();
      return { removed: true };
    }
  );
}