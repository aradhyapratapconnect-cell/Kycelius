import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: {} }));
vi.mock('../../db/db', () => ({ autonomousModeConfig: { get: () => ({}) } }));

import { permissionGate } from '../permissionEngine';
import {
  configureAutonomousPolicy,
  isAutoApprovedUnderAutonomousMode,
} from '../autonomousPolicy';
import {
  getPendingConfirmations,
  resetQueue,
  resolveConfirmation,
} from '../confirmationQueue';

function setPolicy(enabled: boolean, overrides: Record<string, 'auto' | 'confirm_required'>) {
  configureAutonomousPolicy(() => ({
    enabled,
    tool_overrides: overrides,
    max_plan_steps: 10,
    max_plan_duration_seconds: 300,
  }));
}

/** Starts a gate check for a confirm_required tool without awaiting it. */
function startGateCheck(toolName: string, executionId = `exec-${toolName}`) {
  return permissionGate({
    executionId,
    toolName,
    permissionTier: 'confirm_required',
    params: {},
  });
}

describe('autonomousMode override policy', () => {
  it('requires BOTH the master toggle and a per-tool "auto" mark', () => {
    const cases: Array<[boolean, Record<string, 'auto' | 'confirm_required'>, boolean]> = [
      [false, { send_email: 'auto' }, false], // toggle off wins
      [true, {}, false], // nothing opted in
      [true, { send_email: 'confirm_required' }, false], // explicitly kept manual
      [true, { send_email: 'auto' }, true], // both conditions met
      [false, {}, false],
    ];
    for (const [enabled, overrides, expected] of cases) {
      setPolicy(enabled, overrides);
      expect(isAutoApprovedUnderAutonomousMode('send_email')).toBe(expected);
    }
  });

  it('re-reads the config live so mid-plan changes apply to future checks only', () => {
    setPolicy(false, { send_email: 'auto' });
    expect(isAutoApprovedUnderAutonomousMode('send_email')).toBe(false);

    // The user flips the toggle on between two steps...
    setPolicy(true, { send_email: 'auto' });
    expect(isAutoApprovedUnderAutonomousMode('send_email')).toBe(true);
  });
});

describe('permissionGate × Autonomous Mode (F-11)', () => {
  beforeEach(() => {
    setPolicy(false, {});
  });

  afterEach(() => {
    // Restore a safe "everything manual" policy for any later checks.
    configureAutonomousPolicy(() => ({
      enabled: false,
      tool_overrides: {},
      max_plan_steps: 10,
      max_plan_duration_seconds: 300,
    }));
    resetQueue();
  });

  it('never skips confirmation while Autonomous Mode is off — even with an "auto" override stored', async () => {
    setPolicy(false, { delete_file: 'auto' });

    const pending = startGateCheck('delete_file');
    await Promise.resolve();

    // Paused: the tool sits in the confirmation queue awaiting the user.
    expect(getPendingConfirmations().map(c => c.toolName)).toContain('delete_file');

    resolveConfirmation('exec-delete_file', { action: 'approve' });
    await expect(pending).resolves.toEqual({ decision: 'proceed' });
  });

  it('skips confirmation when the toggle is on AND this exact tool is marked "auto"', async () => {
    setPolicy(true, { create_file: 'auto', delete_file: 'confirm_required' });

    await expect(startGateCheck('create_file')).resolves.toEqual({ decision: 'proceed' });
    expect(getPendingConfirmations()).toHaveLength(0);
  });

  it('still pauses tools that are not marked "auto" while the toggle is on', async () => {
    setPolicy(true, { create_file: 'auto' });

    const pending = startGateCheck('delete_file');
    await Promise.resolve();

    expect(getPendingConfirmations().map(c => c.toolName)).toContain('delete_file');
    resolveConfirmation('exec-delete_file', { action: 'deny', reason: 'nope' });
    await expect(pending).resolves.toEqual({ decision: 'deny', reason: 'nope' });
  });
});
