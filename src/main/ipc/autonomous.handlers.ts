// Autonomous Mode IPC surface (F-11): config get/update plus plan run/cancel.
//
// This file owns ALL production wiring for the planner — llmRouter, the tool
// registry pipeline, and the agent_plans / conversations DAOs — so
// agent/planner.ts itself stays free of Electron coupling and unit-testable.

import { BrowserWindow, ipcMain } from 'electron';
import { agentPlans, autonomousModeConfig, conversations } from '../db/db';
import { llmRouter } from '../llm/llmRouter';
import { executeToolCall, getToolSchemas } from '../tools/toolRegistry';
import { planner } from '../agent/planner';

/**
 * Mirrors `AutonomousModeConfig` from @shared/types/ipc.ts. Kept structural
 * here because tsconfig.main's rootDir is src/main only.
 */
interface IpcAutonomousModeConfig {
  enabled: boolean;
  toolOverrides: Record<string, 'auto' | 'confirm_required' | 'never'>;
  maxPlanSteps: number;
  maxPlanDurationSeconds: number;
}

type OverrideValue = 'auto' | 'confirm_required' | 'never';

/**
 * T-20: push the current config to every window so UI (SettingsPanel, the
 * composer badge) reflects changes immediately without a restart or refetch.
 * Also called by settings.handlers when autonomousModeEnabled arrives via the
 * generic update-settings path, so both writers stay in sync.
 */
export function broadcastAutonomousModeChange(): void {
  const config = toIpcConfig(autonomousModeConfig.get());
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('kyclius:autonomous-mode-changed', config);
    }
  }
}

function toIpcConfig(row: {
  enabled: boolean;
  tool_overrides: Record<string, OverrideValue>;
  max_plan_steps: number;
  max_plan_duration_seconds: number;
}): IpcAutonomousModeConfig {
  return {
    enabled: row.enabled,
    toolOverrides: row.tool_overrides,
    maxPlanSteps: row.max_plan_steps,
    maxPlanDurationSeconds: row.max_plan_duration_seconds,
  };
}

function validateOverrides(value: unknown): Record<string, OverrideValue> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('toolOverrides must be an object mapping tool names to tiers');
  }
  const result: Record<string, OverrideValue> = {};
  for (const [toolName, tier] of Object.entries(value as Record<string, unknown>)) {
    if (tier !== 'auto' && tier !== 'confirm_required' && tier !== 'never') {
      throw new Error(
        `Invalid override for "${toolName}": must be "auto", "confirm_required", or "never"`
      );
    }
    result[toolName] = tier;
  }
  return result;
}

function validateBoundedInt(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${label} must be a whole number between ${min} and ${max}`);
  }
  return value;
}

export function registerAutonomousHandlers(): void {
  // Production planner wiring. llmRouter.initialize() is idempotent and runs
  // lazily per request, matching the pattern used by llm.handlers.ts.
  planner.configure({
    chatCompletion: messages => llmRouter.chatCompletion(messages, []),
    listTools: () => getToolSchemas(),
    execute: (toolName, args) => executeToolCall(toolName, args),
    plans: {
      create: plan => ({ id: agentPlans.create(plan).id }),
      updateStatus: (id, status, completedAt) => agentPlans.updateStatus(id, status, completedAt),
    },
    limits: () => {
      const config = autonomousModeConfig.get();
      return {
        maxPlanSteps: config.max_plan_steps,
        maxPlanDurationMs: config.max_plan_duration_seconds * 1000,
      };
    },
    now: () => Date.now(),
  });

  ipcMain.handle('kyclius:get-autonomous-config', async () =>
    toIpcConfig(autonomousModeConfig.get())
  );

  ipcMain.handle('kyclius:update-autonomous-config', async (_event, partial: Partial<IpcAutonomousModeConfig>) => {
    const update: Parameters<typeof autonomousModeConfig.set>[0] = {};

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
        update.max_plan_duration_seconds = validateBoundedInt(
          partial.maxPlanDurationSeconds,
          'maxPlanDurationSeconds',
          10,
          3600
        );
      }
    }

    autonomousModeConfig.set(update);
    const next = toIpcConfig(autonomousModeConfig.get());
    broadcastAutonomousModeChange();
    return next;
  });

  ipcMain.handle(
    'kyclius:run-plan',
    async (_event, goal: string, conversationId?: string) => {
      if (typeof goal !== 'string' || goal.trim().length === 0) {
        throw new Error('Describe what Kyclius should do first.');
      }
      if (goal.length > 2000) {
        throw new Error('That goal is too long to plan against.');
      }

      // agent_plans.conversation_id has a NOT NULL FK constraint.
      let convoId =
        typeof conversationId === 'string' && conversationId.trim().length > 0
          ? conversationId
          : undefined;
      if (!convoId) {
        convoId = conversations.create(`Plan: ${goal.trim().slice(0, 60)}`).id;
      }

      await llmRouter.initialize();
      const plan = await planner.generatePlan(goal, convoId);
      return planner.runPlan(plan);
    }
  );

  ipcMain.handle('kyclius:cancel-plan', async () => planner.cancelActivePlan());
}
