import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  executeToolCall,
  registerTool,
  setExecutionGate,
  type ToolDefinition,
} from '../../tools/toolRegistry';
import {
  getPendingConfirmationNotices,
  installPermissionEngine,
  permissionGate,
  respondToConfirmation,
} from '../permissionEngine';
import { getPendingConfirmations, resetQueue } from '../confirmationQueue';
import {
  configureAutonomousOverrideWriter,
  configureAutonomousPolicy,
} from '../autonomousPolicy';

let nameCounter = 0;
const uniqueName = (prefix: string) => `${prefix}_${++nameCounter}`;

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

beforeEach(() => {
  vi.clearAllMocks();
  resetQueue();
  installPermissionEngine({ notify: vi.fn() });
  setExecutionGate(permissionGate);
  // F-11: pin Autonomous Mode to its safe default (off) so these tests
  // exercise the plain confirmation path without touching the DB.
  configureAutonomousPolicy(() => ({
    enabled: false,
    tool_overrides: {},
    max_plan_steps: 10,
    max_plan_duration_seconds: 300,
  }));
});

afterEach(() => {
  setExecutionGate(null);
});

function makeDefinition(overrides: Partial<ToolDefinition> = {}): ToolDefinition {
  return {
    name: uniqueName('perm_tool'),
    description: 'A test tool',
    parameters: {
      type: 'object',
      properties: {
        message: { type: 'string' },
      },
      required: ['message'],
    },
    permissionTier: 'auto',
    handler: vi.fn(async (params: Record<string, unknown>) => ({
      success: true as const,
      result: `ran with ${params.message}`,
    })),
    ...overrides,
  };
}

describe('permissionEngine gating', () => {
  it('never triggers a confirmation for an auto-tier tool', async () => {
    const handler = vi.fn(async () => ({ success: true, result: 'done' }));
    const def = makeDefinition({ handler });
    registerTool(def);

    const result = await executeToolCall(def.name, { message: 'hi' });

    expect(result.success).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(getPendingConfirmations()).toHaveLength(0);
  });

  it('pauses a confirm_required call until an explicit approve arrives', async () => {
    const notify = vi.fn();
    installPermissionEngine({ notify });
    const handler = vi.fn(async () => ({ success: true, result: 'done' }));
    const def = makeDefinition({
      permissionTier: 'confirm_required',
      handler,
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
      },
    });
    registerTool(def);

    const pendingCall = executeToolCall(def.name, { path: '/tmp/report.txt' });
    await flush();

    expect(handler).not.toHaveBeenCalled();

    const notices = getPendingConfirmationNotices();
    expect(notices).toHaveLength(1);
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        id: notices[0].id,
        toolName: def.name,
        parameters: { path: '/tmp/report.txt' },
        permissionTier: 'confirm_required',
        timestamp: expect.any(Number),
      })
    );

    respondToConfirmation(notices[0].id, { action: 'approve' });
    const result = await pendingCall;

    expect(result.success).toBe(true);
    expect(handler).toHaveBeenCalledWith({ path: '/tmp/report.txt' });

    const statusesForRun = updateStatusMock.mock.calls
      .filter(call => call[0] === result.executionId)
      .map(call => call[1]);
    expect(statusesForRun).toEqual(['confirmed', 'success']);
  });

  it('records a deny as status "denied" and never executes', async () => {
    const handler = vi.fn(async () => ({ success: true, result: 'done' }));
    const def = makeDefinition({ permissionTier: 'confirm_required', handler });
    registerTool(def);

    const pendingCall = executeToolCall(def.name, { message: 'hi' });
    await flush();

    const notice = getPendingConfirmationNotices()[0];
    respondToConfirmation(notice.id, { action: 'deny', reason: 'not today' });
    const result = await pendingCall;

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/was not approved: not today/);
    expect(handler).not.toHaveBeenCalled();
    expect(updateStatusMock).toHaveBeenCalledWith(expect.any(String), 'denied', 'not today');
    expect(updateStatusMock.mock.calls.some(call => call[1] === 'success')).toBe(false);
  });

  it('executes edited parameters only after re-validating them against the schema', async () => {
    const handler = vi.fn(async (params: Record<string, unknown>) => ({
      success: true,
      result: `ran with ${String(params.message)}`,
    }));
    const def = makeDefinition({ permissionTier: 'confirm_required', handler });
    registerTool(def);

    const pendingCall = executeToolCall(def.name, { message: 'original' });
    await flush();

    const notice = getPendingConfirmationNotices()[0];
    respondToConfirmation(notice.id, {
      action: 'edit',
      editedParams: { message: 'edited by user' },
    });
    const result = await pendingCall;

    expect(result.success).toBe(true);
    expect(handler).toHaveBeenCalledWith({ message: 'edited by user' });
    expect(result.result).toBe('ran with edited by user');
  });

  it('rejects invalid edited parameters without executing', async () => {
    const handler = vi.fn(async () => ({ success: true, result: 'done' }));
    const def = makeDefinition({ permissionTier: 'confirm_required', handler });
    registerTool(def);

    const pendingCall = executeToolCall(def.name, { message: 'original' });
    await flush();

    const notice = getPendingConfirmationNotices()[0];
    respondToConfirmation(notice.id, {
      action: 'edit',
      editedParams: { message: 42 },
    });
    const result = await pendingCall;

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Edited parameters rejected/);
    expect(handler).not.toHaveBeenCalled();
    expect(updateStatusMock).toHaveBeenCalledWith(
      expect.any(String),
      'failed',
      expect.stringMatching(/must be of type string/)
    );
  });

  it('presents and resolves two simultaneous confirmations individually', async () => {
    const notify = vi.fn();
    installPermissionEngine({ notify });
    const handler = vi.fn(async (params: Record<string, unknown>) => ({
      success: true,
      result: String(params.message),
    }));
    const def = makeDefinition({ permissionTier: 'confirm_required', handler });
    registerTool(def);

    const first = executeToolCall(def.name, { message: 'first' });
    const second = executeToolCall(def.name, { message: 'second' });
    await flush();

    expect(notify).toHaveBeenCalledTimes(2);
    const pending = getPendingConfirmations();
    expect(pending).toHaveLength(2);

    const [firstEntry, secondEntry] = pending;

    respondToConfirmation(firstEntry.id, { action: 'approve' });
    const firstResult = await first;
    expect(firstResult.success).toBe(true);
    expect(getPendingConfirmations().map(entry => entry.id)).toEqual([secondEntry.id]);

    respondToConfirmation(secondEntry.id, { action: 'deny' });
    const secondResult = await second;
    expect(secondResult.success).toBe(false);

    const statusesById = new Map<string, string[]>();
    for (const [id, status] of updateStatusMock.mock.calls.map(c => [c[0], c[1]])) {
      statusesById.set(id as string, [...(statusesById.get(id as string) ?? []), status as string]);
    }
    expect(statusesById.get(firstEntry.id)).toEqual(['confirmed', 'success']);
    expect(statusesById.get(secondEntry.id)).toEqual(['denied']);
  });

  it('returns false when responding to an unknown confirmation id', async () => {
    expect(respondToConfirmation('ghost-id', { action: 'approve' })).toBe(false);
  });

  it('fails closed when no gate is registered and the tool is confirm_required', async () => {
    setExecutionGate(null);
    const handler = vi.fn(async () => ({ success: true, result: 'done' }));
    const def = makeDefinition({ permissionTier: 'confirm_required', handler });
    registerTool(def);

    const result = await executeToolCall(def.name, { message: 'hi' });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/no permission engine is registered/);
    expect(handler).not.toHaveBeenCalled();
    expect(updateStatusMock).toHaveBeenCalledWith(expect.any(String), 'denied', expect.any(String));
  });

  it('records a failure if the gate itself throws', async () => {
    setExecutionGate(async () => {
      throw new Error('engine exploded');
    });
    const handler = vi.fn(async () => ({ success: true, result: 'done' }));
    const def = makeDefinition({ permissionTier: 'auto', handler });
    registerTool(def);

    const result = await executeToolCall(def.name, { message: 'hi' });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Permission check failed: engine exploded/);
    expect(handler).not.toHaveBeenCalled();
  });

  it('blocks an auto-tier tool outright when its override is "never", even with Autonomous Mode on', async () => {
    const handler = vi.fn(async () => ({ success: true, result: 'done' }));
    const def = makeDefinition({ handler }); // default tier: auto
    registerTool(def);
    configureAutonomousPolicy(() => ({
      enabled: true,
      tool_overrides: { [def.name]: 'never' },
      max_plan_steps: 10,
      max_plan_duration_seconds: 300,
    }));

    const result = await executeToolCall(def.name, { message: 'hi' });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Never Allow/);
    expect(handler).not.toHaveBeenCalled();
    expect(getPendingConfirmations()).toHaveLength(0);
    expect(updateStatusMock).toHaveBeenCalledWith(expect.any(String), 'denied', expect.any(String));
  });

  it('blocks a confirm_required tool before any confirmation dialog when overridden to "never"', async () => {
    const handler = vi.fn(async () => ({ success: true, result: 'done' }));
    const def = makeDefinition({ permissionTier: 'confirm_required', handler });
    registerTool(def);
    configureAutonomousPolicy(() => ({
      enabled: false,
      tool_overrides: { [def.name]: 'never' },
      max_plan_steps: 10,
      max_plan_duration_seconds: 300,
    }));

    const result = await executeToolCall(def.name, { message: 'hi' });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Never Allow/);
    expect(handler).not.toHaveBeenCalled();
    expect(getPendingConfirmations()).toHaveLength(0);
  });

  it('downgrades an auto-tier tool to "asks every time" when overridden', async () => {
    const notify = vi.fn();
    installPermissionEngine({ notify });
    const handler = vi.fn(async () => ({ success: true, result: 'done' }));
    const def = makeDefinition({ handler }); // default tier: auto
    registerTool(def);
    configureAutonomousPolicy(() => ({
      enabled: false,
      tool_overrides: { [def.name]: 'confirm_required' },
      max_plan_steps: 10,
      max_plan_duration_seconds: 300,
    }));

    const pendingCall = executeToolCall(def.name, { message: 'hi' });
    await flush();

    expect(handler).not.toHaveBeenCalled();
    expect(getPendingConfirmationNotices()).toHaveLength(1);

    respondToConfirmation(getPendingConfirmationNotices()[0].id, { action: 'approve' });
    const result = await pendingCall;
    expect(result.success).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('resolving with "always_allow" writes the shared store override and proceeds', async () => {
    const writer = vi.fn();
    configureAutonomousOverrideWriter(writer);
    const handler = vi.fn(async () => ({ success: true, result: 'done' }));
    const def = makeDefinition({ permissionTier: 'confirm_required', handler });
    registerTool(def);

    const pendingCall = executeToolCall(def.name, { message: 'hi' });
    await flush();

    expect(getPendingConfirmationNotices()).toHaveLength(1);
    respondToConfirmation(getPendingConfirmationNotices()[0].id, { action: 'always_allow' });
    const result = await pendingCall;

    expect(result.success).toBe(true);
    expect(handler).toHaveBeenCalledWith({ message: 'hi' });
    expect(writer).toHaveBeenCalledWith(def.name, 'auto');
  });

  it('skips confirmation for a confirm_required tool only when opted to "auto" AND Autonomous Mode is on', async () => {
    const handler = vi.fn(async () => ({ success: true, result: 'done' }));
    const def = makeDefinition({ permissionTier: 'confirm_required', handler });
    registerTool(def);
    configureAutonomousPolicy(() => ({
      enabled: true,
      tool_overrides: { [def.name]: 'auto' },
      max_plan_steps: 10,
      max_plan_duration_seconds: 300,
    }));

    const result = await executeToolCall(def.name, { message: 'hi' });

    expect(result.success).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(getPendingConfirmations()).toHaveLength(0);
  });

  it('still asks for an "Always Allowed" confirm_required tool when Autonomous Mode is off', async () => {
    const handler = vi.fn(async () => ({ success: true, result: 'done' }));
    const def = makeDefinition({ permissionTier: 'confirm_required', handler });
    registerTool(def);
    configureAutonomousPolicy(() => ({
      enabled: false,
      tool_overrides: { [def.name]: 'auto' },
      max_plan_steps: 10,
      max_plan_duration_seconds: 300,
    }));

    const pendingCall = executeToolCall(def.name, { message: 'hi' });
    await flush();

    expect(handler).not.toHaveBeenCalled();
    expect(getPendingConfirmationNotices()).toHaveLength(1);
    const result0 = getPendingConfirmationNotices()[0];
    respondToConfirmation(result0.id, { action: 'approve' });
    const result = await pendingCall;
    expect(result.success).toBe(true);
  });
});
