"use strict";
// Autonomous Mode IPC surface (F-11): config get/update plus plan run/cancel.
//
// This file owns ALL production wiring for the planner — llmRouter, the tool
// registry pipeline, and the agent_plans / conversations DAOs — so
// agent/planner.ts itself stays free of Electron coupling and unit-testable.
Object.defineProperty(exports, "__esModule", { value: true });
exports.broadcastAutonomousModeChange = broadcastAutonomousModeChange;
exports.registerAutonomousHandlers = registerAutonomousHandlers;
const electron_1 = require("electron");
const db_1 = require("../db/db");
const llmRouter_1 = require("../llm/llmRouter");
const toolRegistry_1 = require("../tools/toolRegistry");
const planner_1 = require("../agent/planner");
/**
 * T-20: push the current config to every window so UI (SettingsPanel, the
 * composer badge) reflects changes immediately without a restart or refetch.
 * Also called by settings.handlers when autonomousModeEnabled arrives via the
 * generic update-settings path, so both writers stay in sync.
 */
function broadcastAutonomousModeChange() {
    const config = toIpcConfig(db_1.autonomousModeConfig.get());
    for (const win of electron_1.BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) {
            win.webContents.send('kyclius:autonomous-mode-changed', config);
        }
    }
}
function toIpcConfig(row) {
    return {
        enabled: row.enabled,
        toolOverrides: row.tool_overrides,
        maxPlanSteps: row.max_plan_steps,
        maxPlanDurationSeconds: row.max_plan_duration_seconds,
    };
}
function validateOverrides(value) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error('toolOverrides must be an object mapping tool names to tiers');
    }
    const result = {};
    for (const [toolName, tier] of Object.entries(value)) {
        if (tier !== 'auto' && tier !== 'confirm_required' && tier !== 'never') {
            throw new Error(`Invalid override for "${toolName}": must be "auto", "confirm_required", or "never"`);
        }
        result[toolName] = tier;
    }
    return result;
}
function validateBoundedInt(value, label, min, max) {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
        throw new Error(`${label} must be a whole number between ${min} and ${max}`);
    }
    return value;
}
function registerAutonomousHandlers() {
    // Production planner wiring. llmRouter.initialize() is idempotent and runs
    // lazily per request, matching the pattern used by llm.handlers.ts.
    planner_1.planner.configure({
        chatCompletion: messages => llmRouter_1.llmRouter.chatCompletion(messages, []),
        listTools: () => (0, toolRegistry_1.getToolSchemas)(),
        execute: (toolName, args) => (0, toolRegistry_1.executeToolCall)(toolName, args),
        plans: {
            create: plan => ({ id: db_1.agentPlans.create(plan).id }),
            updateStatus: (id, status, completedAt) => db_1.agentPlans.updateStatus(id, status, completedAt),
        },
        limits: () => {
            const config = db_1.autonomousModeConfig.get();
            return {
                maxPlanSteps: config.max_plan_steps,
                maxPlanDurationMs: config.max_plan_duration_seconds * 1000,
            };
        },
        now: () => Date.now(),
    });
    electron_1.ipcMain.handle('kyclius:get-autonomous-config', async () => toIpcConfig(db_1.autonomousModeConfig.get()));
    electron_1.ipcMain.handle('kyclius:update-autonomous-config', async (_event, partial) => {
        const update = {};
        if (partial && typeof partial === 'object') {
            if ('enabled' in partial) {
                if (typeof partial.enabled !== 'boolean') {
                    throw new Error('enabled must be a boolean');
                }
                update.enabled = partial.enabled;
            }
            if ('toolOverrides' in partial) {
                update.tool_overrides = validateOverrides(partial.toolOverrides);
            }
            if ('maxPlanSteps' in partial) {
                update.max_plan_steps = validateBoundedInt(partial.maxPlanSteps, 'maxPlanSteps', 1, 50);
            }
            if ('maxPlanDurationSeconds' in partial) {
                update.max_plan_duration_seconds = validateBoundedInt(partial.maxPlanDurationSeconds, 'maxPlanDurationSeconds', 10, 3600);
            }
        }
        db_1.autonomousModeConfig.set(update);
        const next = toIpcConfig(db_1.autonomousModeConfig.get());
        broadcastAutonomousModeChange();
        return next;
    });
    electron_1.ipcMain.handle('kyclius:run-plan', async (_event, goal, conversationId) => {
        if (typeof goal !== 'string' || goal.trim().length === 0) {
            throw new Error('Describe what Kyclius should do first.');
        }
        if (goal.length > 2000) {
            throw new Error('That goal is too long to plan against.');
        }
        // agent_plans.conversation_id has a NOT NULL FK constraint.
        let convoId = typeof conversationId === 'string' && conversationId.trim().length > 0
            ? conversationId
            : undefined;
        if (!convoId) {
            convoId = db_1.conversations.create(`Plan: ${goal.trim().slice(0, 60)}`).id;
        }
        await llmRouter_1.llmRouter.initialize();
        const plan = await planner_1.planner.generatePlan(goal, convoId);
        return planner_1.planner.runPlan(plan);
    });
    electron_1.ipcMain.handle('kyclius:cancel-plan', async () => planner_1.planner.cancelActivePlan());
}
