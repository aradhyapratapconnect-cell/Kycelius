"use strict";
/**
 * N-05: IPC surface for scheduled tasks. Mutations re-arm the main-process
 * scheduler and announce the change so the Settings panel stays fresh.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerSchedulerHandlers = registerSchedulerHandlers;
const electron_1 = require("electron");
const db_1 = require("../db/db");
const cron_1 = require("../scheduling/cron");
const schedulerService_1 = require("../scheduling/schedulerService");
function toInfo(task) {
    if (!task)
        return undefined;
    const info = {
        ...task,
        next_fire_at: null,
        schedule_description: (0, cron_1.describeCron)(task.schedule),
    };
    if (task.enabled) {
        try {
            info.next_fire_at = (0, cron_1.nextFireAt)(task.schedule).toISOString();
        }
        catch {
            info.next_fire_at = null;
        }
    }
    return info;
}
function parseSchedule(schedule) {
    const raw = typeof schedule === 'string' ? schedule.trim() : '';
    if (!raw)
        throw new Error('A cron schedule is required.');
    (0, cron_1.parseCron)(raw); // throws CronExpressionError on bad expressions.
    return raw;
}
function normalizeInput(input) {
    const out = {};
    if (typeof input.name === 'string') {
        const name = input.name.trim();
        if (!name)
            throw new Error('A name is required.');
        out.name = name;
    }
    if (typeof input.command === 'string') {
        const command = input.command.trim();
        if (!command)
            throw new Error('A command is required.');
        out.command = command;
    }
    if (typeof input.schedule === 'string')
        out.schedule = parseSchedule(input.schedule);
    if (typeof input.enabled === 'boolean')
        out.enabled = input.enabled;
    return out;
}
function registerSchedulerHandlers() {
    electron_1.ipcMain.handle('kyclius:list-scheduled-tasks', () => {
        return db_1.scheduledTasks
            .getAll()
            .map(task => toInfo(task))
            .filter((t) => t !== undefined);
    });
    electron_1.ipcMain.handle('kyclius:create-scheduled-task', (_event, input) => {
        const raw = (input ?? {});
        const normalized = normalizeInput(raw);
        if (normalized.name === undefined)
            throw new Error('A name is required.');
        if (normalized.command === undefined)
            throw new Error('A command is required.');
        if (normalized.schedule === undefined)
            throw new Error('A cron schedule is required.');
        const task = db_1.scheduledTasks.create({
            name: normalized.name,
            schedule: normalized.schedule,
            command: normalized.command,
            enabled: raw.enabled !== false,
        });
        (0, schedulerService_1.reloadScheduler)();
        (0, schedulerService_1.announceSchedulerChange)();
        return toInfo(task);
    });
    electron_1.ipcMain.handle('kyclius:update-scheduled-task', (_event, id, patch) => {
        const task = db_1.scheduledTasks.update(id, normalizeInput(patch));
        if (!task)
            throw new Error('Scheduled task not found.');
        (0, schedulerService_1.reloadScheduler)();
        (0, schedulerService_1.announceSchedulerChange)();
        return toInfo(task);
    });
    electron_1.ipcMain.handle('kyclius:delete-scheduled-task', (_event, id) => {
        db_1.scheduledTasks.delete(id);
        (0, schedulerService_1.reloadScheduler)();
        (0, schedulerService_1.announceSchedulerChange)();
        return { removed: true };
    });
}
