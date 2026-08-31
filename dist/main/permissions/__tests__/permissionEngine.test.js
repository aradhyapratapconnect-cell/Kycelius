"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const { createMock, updateStatusMock } = vitest_1.vi.hoisted(() => ({
    createMock: vitest_1.vi.fn(),
    updateStatusMock: vitest_1.vi.fn(),
}));
vitest_1.vi.mock('../../db/db', () => ({
    toolExecutions: {
        create: createMock,
        updateStatus: updateStatusMock,
    },
}));
const toolRegistry_1 = require("../../tools/toolRegistry");
const permissionEngine_1 = require("../permissionEngine");
const confirmationQueue_1 = require("../confirmationQueue");
const autonomousPolicy_1 = require("../autonomousPolicy");
let nameCounter = 0;
const uniqueName = (prefix) => `${prefix}_${++nameCounter}`;
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
(0, vitest_1.beforeEach)(() => {
    vitest_1.vi.clearAllMocks();
    (0, confirmationQueue_1.resetQueue)();
    (0, permissionEngine_1.installPermissionEngine)({ notify: vitest_1.vi.fn() });
    (0, toolRegistry_1.setExecutionGate)(permissionEngine_1.permissionGate);
    // F-11: pin Autonomous Mode to its safe default (off) so these tests
    // exercise the plain confirmation path without touching the DB.
    (0, autonomousPolicy_1.configureAutonomousPolicy)(() => ({
        enabled: false,
        tool_overrides: {},
        max_plan_steps: 10,
        max_plan_duration_seconds: 300,
    }));
});
(0, vitest_1.afterEach)(() => {
    (0, toolRegistry_1.setExecutionGate)(null);
});
function makeDefinition(overrides = {}) {
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
        handler: vitest_1.vi.fn(async (params) => ({
            success: true,
            result: `ran with ${params.message}`,
        })),
        ...overrides,
    };
}
(0, vitest_1.describe)('permissionEngine gating', () => {
    (0, vitest_1.it)('never triggers a confirmation for an auto-tier tool', async () => {
        const handler = vitest_1.vi.fn(async () => ({ success: true, result: 'done' }));
        const def = makeDefinition({ handler });
        (0, toolRegistry_1.registerTool)(def);
        const result = await (0, toolRegistry_1.executeToolCall)(def.name, { message: 'hi' });
        (0, vitest_1.expect)(result.success).toBe(true);
        (0, vitest_1.expect)(handler).toHaveBeenCalledTimes(1);
        (0, vitest_1.expect)((0, confirmationQueue_1.getPendingConfirmations)()).toHaveLength(0);
    });
    (0, vitest_1.it)('pauses a confirm_required call until an explicit approve arrives', async () => {
        const notify = vitest_1.vi.fn();
        (0, permissionEngine_1.installPermissionEngine)({ notify });
        const handler = vitest_1.vi.fn(async () => ({ success: true, result: 'done' }));
        const def = makeDefinition({
            permissionTier: 'confirm_required',
            handler,
            parameters: {
                type: 'object',
                properties: { path: { type: 'string' } },
                required: ['path'],
            },
        });
        (0, toolRegistry_1.registerTool)(def);
        const pendingCall = (0, toolRegistry_1.executeToolCall)(def.name, { path: '/tmp/report.txt' });
        await flush();
        (0, vitest_1.expect)(handler).not.toHaveBeenCalled();
        const notices = (0, permissionEngine_1.getPendingConfirmationNotices)();
        (0, vitest_1.expect)(notices).toHaveLength(1);
        (0, vitest_1.expect)(notify).toHaveBeenCalledWith(vitest_1.expect.objectContaining({
            id: notices[0].id,
            toolName: def.name,
            parameters: { path: '/tmp/report.txt' },
            permissionTier: 'confirm_required',
            timestamp: vitest_1.expect.any(Number),
        }));
        (0, permissionEngine_1.respondToConfirmation)(notices[0].id, { action: 'approve' });
        const result = await pendingCall;
        (0, vitest_1.expect)(result.success).toBe(true);
        (0, vitest_1.expect)(handler).toHaveBeenCalledWith({ path: '/tmp/report.txt' });
        const statusesForRun = updateStatusMock.mock.calls
            .filter(call => call[0] === result.executionId)
            .map(call => call[1]);
        (0, vitest_1.expect)(statusesForRun).toEqual(['confirmed', 'success']);
    });
    (0, vitest_1.it)('records a deny as status "denied" and never executes', async () => {
        const handler = vitest_1.vi.fn(async () => ({ success: true, result: 'done' }));
        const def = makeDefinition({ permissionTier: 'confirm_required', handler });
        (0, toolRegistry_1.registerTool)(def);
        const pendingCall = (0, toolRegistry_1.executeToolCall)(def.name, { message: 'hi' });
        await flush();
        const notice = (0, permissionEngine_1.getPendingConfirmationNotices)()[0];
        (0, permissionEngine_1.respondToConfirmation)(notice.id, { action: 'deny', reason: 'not today' });
        const result = await pendingCall;
        (0, vitest_1.expect)(result.success).toBe(false);
        (0, vitest_1.expect)(result.error).toMatch(/was not approved: not today/);
        (0, vitest_1.expect)(handler).not.toHaveBeenCalled();
        (0, vitest_1.expect)(updateStatusMock).toHaveBeenCalledWith(vitest_1.expect.any(String), 'denied', 'not today');
        (0, vitest_1.expect)(updateStatusMock.mock.calls.some(call => call[1] === 'success')).toBe(false);
    });
    (0, vitest_1.it)('executes edited parameters only after re-validating them against the schema', async () => {
        const handler = vitest_1.vi.fn(async (params) => ({
            success: true,
            result: `ran with ${String(params.message)}`,
        }));
        const def = makeDefinition({ permissionTier: 'confirm_required', handler });
        (0, toolRegistry_1.registerTool)(def);
        const pendingCall = (0, toolRegistry_1.executeToolCall)(def.name, { message: 'original' });
        await flush();
        const notice = (0, permissionEngine_1.getPendingConfirmationNotices)()[0];
        (0, permissionEngine_1.respondToConfirmation)(notice.id, {
            action: 'edit',
            editedParams: { message: 'edited by user' },
        });
        const result = await pendingCall;
        (0, vitest_1.expect)(result.success).toBe(true);
        (0, vitest_1.expect)(handler).toHaveBeenCalledWith({ message: 'edited by user' });
        (0, vitest_1.expect)(result.result).toBe('ran with edited by user');
    });
    (0, vitest_1.it)('rejects invalid edited parameters without executing', async () => {
        const handler = vitest_1.vi.fn(async () => ({ success: true, result: 'done' }));
        const def = makeDefinition({ permissionTier: 'confirm_required', handler });
        (0, toolRegistry_1.registerTool)(def);
        const pendingCall = (0, toolRegistry_1.executeToolCall)(def.name, { message: 'original' });
        await flush();
        const notice = (0, permissionEngine_1.getPendingConfirmationNotices)()[0];
        (0, permissionEngine_1.respondToConfirmation)(notice.id, {
            action: 'edit',
            editedParams: { message: 42 },
        });
        const result = await pendingCall;
        (0, vitest_1.expect)(result.success).toBe(false);
        (0, vitest_1.expect)(result.error).toMatch(/Edited parameters rejected/);
        (0, vitest_1.expect)(handler).not.toHaveBeenCalled();
        (0, vitest_1.expect)(updateStatusMock).toHaveBeenCalledWith(vitest_1.expect.any(String), 'failed', vitest_1.expect.stringMatching(/must be of type string/));
    });
    (0, vitest_1.it)('presents and resolves two simultaneous confirmations individually', async () => {
        const notify = vitest_1.vi.fn();
        (0, permissionEngine_1.installPermissionEngine)({ notify });
        const handler = vitest_1.vi.fn(async (params) => ({
            success: true,
            result: String(params.message),
        }));
        const def = makeDefinition({ permissionTier: 'confirm_required', handler });
        (0, toolRegistry_1.registerTool)(def);
        const first = (0, toolRegistry_1.executeToolCall)(def.name, { message: 'first' });
        const second = (0, toolRegistry_1.executeToolCall)(def.name, { message: 'second' });
        await flush();
        (0, vitest_1.expect)(notify).toHaveBeenCalledTimes(2);
        const pending = (0, confirmationQueue_1.getPendingConfirmations)();
        (0, vitest_1.expect)(pending).toHaveLength(2);
        const [firstEntry, secondEntry] = pending;
        (0, permissionEngine_1.respondToConfirmation)(firstEntry.id, { action: 'approve' });
        const firstResult = await first;
        (0, vitest_1.expect)(firstResult.success).toBe(true);
        (0, vitest_1.expect)((0, confirmationQueue_1.getPendingConfirmations)().map(entry => entry.id)).toEqual([secondEntry.id]);
        (0, permissionEngine_1.respondToConfirmation)(secondEntry.id, { action: 'deny' });
        const secondResult = await second;
        (0, vitest_1.expect)(secondResult.success).toBe(false);
        const statusesById = new Map();
        for (const [id, status] of updateStatusMock.mock.calls.map(c => [c[0], c[1]])) {
            statusesById.set(id, [...(statusesById.get(id) ?? []), status]);
        }
        (0, vitest_1.expect)(statusesById.get(firstEntry.id)).toEqual(['confirmed', 'success']);
        (0, vitest_1.expect)(statusesById.get(secondEntry.id)).toEqual(['denied']);
    });
    (0, vitest_1.it)('returns false when responding to an unknown confirmation id', async () => {
        (0, vitest_1.expect)((0, permissionEngine_1.respondToConfirmation)('ghost-id', { action: 'approve' })).toBe(false);
    });
    (0, vitest_1.it)('fails closed when no gate is registered and the tool is confirm_required', async () => {
        (0, toolRegistry_1.setExecutionGate)(null);
        const handler = vitest_1.vi.fn(async () => ({ success: true, result: 'done' }));
        const def = makeDefinition({ permissionTier: 'confirm_required', handler });
        (0, toolRegistry_1.registerTool)(def);
        const result = await (0, toolRegistry_1.executeToolCall)(def.name, { message: 'hi' });
        (0, vitest_1.expect)(result.success).toBe(false);
        (0, vitest_1.expect)(result.error).toMatch(/no permission engine is registered/);
        (0, vitest_1.expect)(handler).not.toHaveBeenCalled();
        (0, vitest_1.expect)(updateStatusMock).toHaveBeenCalledWith(vitest_1.expect.any(String), 'denied', vitest_1.expect.any(String));
    });
    (0, vitest_1.it)('records a failure if the gate itself throws', async () => {
        (0, toolRegistry_1.setExecutionGate)(async () => {
            throw new Error('engine exploded');
        });
        const handler = vitest_1.vi.fn(async () => ({ success: true, result: 'done' }));
        const def = makeDefinition({ permissionTier: 'auto', handler });
        (0, toolRegistry_1.registerTool)(def);
        const result = await (0, toolRegistry_1.executeToolCall)(def.name, { message: 'hi' });
        (0, vitest_1.expect)(result.success).toBe(false);
        (0, vitest_1.expect)(result.error).toMatch(/Permission check failed: engine exploded/);
        (0, vitest_1.expect)(handler).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('blocks an auto-tier tool outright when its override is "never", even with Autonomous Mode on', async () => {
        const handler = vitest_1.vi.fn(async () => ({ success: true, result: 'done' }));
        const def = makeDefinition({ handler }); // default tier: auto
        (0, toolRegistry_1.registerTool)(def);
        (0, autonomousPolicy_1.configureAutonomousPolicy)(() => ({
            enabled: true,
            tool_overrides: { [def.name]: 'never' },
            max_plan_steps: 10,
            max_plan_duration_seconds: 300,
        }));
        const result = await (0, toolRegistry_1.executeToolCall)(def.name, { message: 'hi' });
        (0, vitest_1.expect)(result.success).toBe(false);
        (0, vitest_1.expect)(result.error).toMatch(/Never Allow/);
        (0, vitest_1.expect)(handler).not.toHaveBeenCalled();
        (0, vitest_1.expect)((0, confirmationQueue_1.getPendingConfirmations)()).toHaveLength(0);
        (0, vitest_1.expect)(updateStatusMock).toHaveBeenCalledWith(vitest_1.expect.any(String), 'denied', vitest_1.expect.any(String));
    });
    (0, vitest_1.it)('blocks a confirm_required tool before any confirmation dialog when overridden to "never"', async () => {
        const handler = vitest_1.vi.fn(async () => ({ success: true, result: 'done' }));
        const def = makeDefinition({ permissionTier: 'confirm_required', handler });
        (0, toolRegistry_1.registerTool)(def);
        (0, autonomousPolicy_1.configureAutonomousPolicy)(() => ({
            enabled: false,
            tool_overrides: { [def.name]: 'never' },
            max_plan_steps: 10,
            max_plan_duration_seconds: 300,
        }));
        const result = await (0, toolRegistry_1.executeToolCall)(def.name, { message: 'hi' });
        (0, vitest_1.expect)(result.success).toBe(false);
        (0, vitest_1.expect)(result.error).toMatch(/Never Allow/);
        (0, vitest_1.expect)(handler).not.toHaveBeenCalled();
        (0, vitest_1.expect)((0, confirmationQueue_1.getPendingConfirmations)()).toHaveLength(0);
    });
    (0, vitest_1.it)('downgrades an auto-tier tool to "asks every time" when overridden', async () => {
        const notify = vitest_1.vi.fn();
        (0, permissionEngine_1.installPermissionEngine)({ notify });
        const handler = vitest_1.vi.fn(async () => ({ success: true, result: 'done' }));
        const def = makeDefinition({ handler }); // default tier: auto
        (0, toolRegistry_1.registerTool)(def);
        (0, autonomousPolicy_1.configureAutonomousPolicy)(() => ({
            enabled: false,
            tool_overrides: { [def.name]: 'confirm_required' },
            max_plan_steps: 10,
            max_plan_duration_seconds: 300,
        }));
        const pendingCall = (0, toolRegistry_1.executeToolCall)(def.name, { message: 'hi' });
        await flush();
        (0, vitest_1.expect)(handler).not.toHaveBeenCalled();
        (0, vitest_1.expect)((0, permissionEngine_1.getPendingConfirmationNotices)()).toHaveLength(1);
        (0, permissionEngine_1.respondToConfirmation)((0, permissionEngine_1.getPendingConfirmationNotices)()[0].id, { action: 'approve' });
        const result = await pendingCall;
        (0, vitest_1.expect)(result.success).toBe(true);
        (0, vitest_1.expect)(handler).toHaveBeenCalledTimes(1);
    });
    (0, vitest_1.it)('resolving with "always_allow" writes the shared store override and proceeds', async () => {
        const writer = vitest_1.vi.fn();
        (0, autonomousPolicy_1.configureAutonomousOverrideWriter)(writer);
        const handler = vitest_1.vi.fn(async () => ({ success: true, result: 'done' }));
        const def = makeDefinition({ permissionTier: 'confirm_required', handler });
        (0, toolRegistry_1.registerTool)(def);
        const pendingCall = (0, toolRegistry_1.executeToolCall)(def.name, { message: 'hi' });
        await flush();
        (0, vitest_1.expect)((0, permissionEngine_1.getPendingConfirmationNotices)()).toHaveLength(1);
        (0, permissionEngine_1.respondToConfirmation)((0, permissionEngine_1.getPendingConfirmationNotices)()[0].id, { action: 'always_allow' });
        const result = await pendingCall;
        (0, vitest_1.expect)(result.success).toBe(true);
        (0, vitest_1.expect)(handler).toHaveBeenCalledWith({ message: 'hi' });
        (0, vitest_1.expect)(writer).toHaveBeenCalledWith(def.name, 'auto');
    });
    (0, vitest_1.it)('skips confirmation for a confirm_required tool only when opted to "auto" AND Autonomous Mode is on', async () => {
        const handler = vitest_1.vi.fn(async () => ({ success: true, result: 'done' }));
        const def = makeDefinition({ permissionTier: 'confirm_required', handler });
        (0, toolRegistry_1.registerTool)(def);
        (0, autonomousPolicy_1.configureAutonomousPolicy)(() => ({
            enabled: true,
            tool_overrides: { [def.name]: 'auto' },
            max_plan_steps: 10,
            max_plan_duration_seconds: 300,
        }));
        const result = await (0, toolRegistry_1.executeToolCall)(def.name, { message: 'hi' });
        (0, vitest_1.expect)(result.success).toBe(true);
        (0, vitest_1.expect)(handler).toHaveBeenCalledTimes(1);
        (0, vitest_1.expect)((0, confirmationQueue_1.getPendingConfirmations)()).toHaveLength(0);
    });
    (0, vitest_1.it)('still asks for an "Always Allowed" confirm_required tool when Autonomous Mode is off', async () => {
        const handler = vitest_1.vi.fn(async () => ({ success: true, result: 'done' }));
        const def = makeDefinition({ permissionTier: 'confirm_required', handler });
        (0, toolRegistry_1.registerTool)(def);
        (0, autonomousPolicy_1.configureAutonomousPolicy)(() => ({
            enabled: false,
            tool_overrides: { [def.name]: 'auto' },
            max_plan_steps: 10,
            max_plan_duration_seconds: 300,
        }));
        const pendingCall = (0, toolRegistry_1.executeToolCall)(def.name, { message: 'hi' });
        await flush();
        (0, vitest_1.expect)(handler).not.toHaveBeenCalled();
        (0, vitest_1.expect)((0, permissionEngine_1.getPendingConfirmationNotices)()).toHaveLength(1);
        const result0 = (0, permissionEngine_1.getPendingConfirmationNotices)()[0];
        (0, permissionEngine_1.respondToConfirmation)(result0.id, { action: 'approve' });
        const result = await pendingCall;
        (0, vitest_1.expect)(result.success).toBe(true);
    });
});
