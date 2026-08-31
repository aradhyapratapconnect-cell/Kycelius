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
const toolRegistry_1 = require("../toolRegistry");
let nameCounter = 0;
const uniqueName = (prefix) => `${prefix}_${++nameCounter}`;
(0, vitest_1.beforeEach)(() => {
    vitest_1.vi.clearAllMocks();
});
function makeDefinition(overrides = {}) {
    return {
        name: uniqueName('test_tool'),
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
            result: `echo: ${params.message}`,
        })),
        ...overrides,
    };
}
(0, vitest_1.describe)('registerTool', () => {
    (0, vitest_1.it)('throws when permissionTier is missing — no silent default', () => {
        const def = makeDefinition();
        delete def.permissionTier;
        (0, vitest_1.expect)(() => (0, toolRegistry_1.registerTool)(def)).toThrow(/permissionTier/);
    });
    (0, vitest_1.it)('throws when permissionTier is an invalid value', () => {
        const def = makeDefinition({ permissionTier: 'maybe' });
        (0, vitest_1.expect)(() => (0, toolRegistry_1.registerTool)(def)).toThrow(/permissionTier/);
    });
    (0, vitest_1.it)('throws when a tool with the same name is already registered', () => {
        const def = makeDefinition();
        const duplicate = { ...def, handler: async () => ({ success: true }) };
        (0, vitest_1.expect)(() => {
            (0, toolRegistry_1.registerTool)(def);
            (0, toolRegistry_1.registerTool)(duplicate);
        }).toThrow(/already registered/);
    });
    (0, vitest_1.it)('stores the tool and exposes it via getTool/getAllTools', () => {
        const def = makeDefinition();
        (0, toolRegistry_1.registerTool)(def);
        (0, vitest_1.expect)((0, toolRegistry_1.getTool)(def.name)).toBe(def);
        (0, vitest_1.expect)((0, toolRegistry_1.getAllTools)()).toContain(def);
    });
});
(0, vitest_1.describe)('executeToolCall', () => {
    (0, vitest_1.it)('returns an error for an unregistered tool name', async () => {
        const result = await (0, toolRegistry_1.executeToolCall)('no_such_tool', {});
        (0, vitest_1.expect)(result.success).toBe(false);
        (0, vitest_1.expect)(result.error).toMatch(/Unknown tool/);
        (0, vitest_1.expect)(createMock).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('rejects missing required parameters before the handler runs', async () => {
        const handler = vitest_1.vi.fn(async () => ({ success: true, result: 'ran' }));
        const def = makeDefinition({ handler });
        (0, toolRegistry_1.registerTool)(def);
        const result = await (0, toolRegistry_1.executeToolCall)(def.name, {});
        (0, vitest_1.expect)(result.success).toBe(false);
        (0, vitest_1.expect)(result.error).toMatch(/Missing required parameter: message/);
        (0, vitest_1.expect)(handler).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('rejects wrongly-typed parameters before the handler runs', async () => {
        const handler = vitest_1.vi.fn(async () => ({ success: true, result: 'ran' }));
        const def = makeDefinition({ handler });
        (0, toolRegistry_1.registerTool)(def);
        const result = await (0, toolRegistry_1.executeToolCall)(def.name, { message: 42 });
        (0, vitest_1.expect)(result.success).toBe(false);
        (0, vitest_1.expect)(result.error).toMatch(/must be of type string, got number/);
        (0, vitest_1.expect)(handler).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('rejects non-object parameter payloads', async () => {
        const def = makeDefinition();
        (0, toolRegistry_1.registerTool)(def);
        const result = await (0, toolRegistry_1.executeToolCall)(def.name, 'not-an-object');
        (0, vitest_1.expect)(result.success).toBe(false);
        (0, vitest_1.expect)(result.error).toMatch(/Parameters must be an object/);
    });
    (0, vitest_1.it)('records a failed audit row when validation rejects the call', async () => {
        const def = makeDefinition();
        (0, toolRegistry_1.registerTool)(def);
        await (0, toolRegistry_1.executeToolCall)(def.name, {});
        (0, vitest_1.expect)(createMock).toHaveBeenCalledTimes(1);
        (0, vitest_1.expect)(createMock).toHaveBeenCalledWith(vitest_1.expect.objectContaining({
            tool_name: def.name,
            permission_tier: 'auto',
            status: 'pending',
            parameters: {},
        }));
        (0, vitest_1.expect)(updateStatusMock).toHaveBeenCalledWith(vitest_1.expect.any(String), 'failed', vitest_1.expect.stringMatching(/Missing required parameter/));
    });
    (0, vitest_1.it)('executes the handler and records a success row on success', async () => {
        const def = makeDefinition();
        (0, toolRegistry_1.registerTool)(def);
        const result = await (0, toolRegistry_1.executeToolCall)(def.name, { message: 'hello' });
        (0, vitest_1.expect)(result.success).toBe(true);
        (0, vitest_1.expect)(result.result).toBe('echo: hello');
        (0, vitest_1.expect)(result.executionId).toEqual(vitest_1.expect.any(String));
        (0, vitest_1.expect)(updateStatusMock).toHaveBeenCalledTimes(1);
        (0, vitest_1.expect)(updateStatusMock).toHaveBeenCalledWith(vitest_1.expect.any(String), 'success', 'echo: hello');
    });
    (0, vitest_1.it)('records a failed row when the handler throws', async () => {
        const handler = vitest_1.vi.fn(async () => {
            throw new Error('disk exploded');
        });
        const def = makeDefinition({ handler });
        (0, toolRegistry_1.registerTool)(def);
        const result = await (0, toolRegistry_1.executeToolCall)(def.name, { message: 'hi' });
        (0, vitest_1.expect)(result.success).toBe(false);
        (0, vitest_1.expect)(result.error).toBe('disk exploded');
        (0, vitest_1.expect)(updateStatusMock).toHaveBeenCalledWith(vitest_1.expect.any(String), 'failed', 'disk exploded');
    });
    (0, vitest_1.it)('records a failed row when the handler returns success:false', async () => {
        const handler = vitest_1.vi.fn(async () => ({ success: false, error: 'file not found' }));
        const def = makeDefinition({ handler });
        (0, toolRegistry_1.registerTool)(def);
        const result = await (0, toolRegistry_1.executeToolCall)(def.name, { message: 'hi' });
        (0, vitest_1.expect)(result.success).toBe(false);
        (0, vitest_1.expect)(result.error).toBe('file not found');
        (0, vitest_1.expect)(updateStatusMock).toHaveBeenCalledWith(vitest_1.expect.any(String), 'failed', 'file not found');
    });
    (0, vitest_1.it)('kills a hung handler at the timeout and records it as failed', async () => {
        const handler = vitest_1.vi.fn(() => new Promise(() => { }));
        const def = makeDefinition({ handler });
        (0, toolRegistry_1.registerTool)(def);
        const start = Date.now();
        const result = await (0, toolRegistry_1.executeToolCall)(def.name, { message: 'hi' }, { timeoutMs: 50 });
        const elapsed = Date.now() - start;
        (0, vitest_1.expect)(elapsed).toBeLessThan(toolRegistry_1.DEFAULT_TOOL_TIMEOUT_MS);
        (0, vitest_1.expect)(result.success).toBe(false);
        (0, vitest_1.expect)(result.error).toMatch(/timed out after 50ms/);
        (0, vitest_1.expect)(updateStatusMock).toHaveBeenCalledWith(vitest_1.expect.any(String), 'failed', vitest_1.expect.stringMatching(/timed out/));
    }, 5000);
    (0, vitest_1.it)('produces exactly one tool_executions row per attempt regardless of outcome', async () => {
        const okDef = makeDefinition();
        const failDef = makeDefinition({
            handler: vitest_1.vi.fn(async () => ({ success: false, error: 'nope' })),
        });
        const throwDef = makeDefinition({
            handler: vitest_1.vi.fn(async () => {
                throw new Error('boom');
            }),
        });
        const hangDef = makeDefinition({ handler: () => new Promise(() => { }) });
        (0, toolRegistry_1.registerTool)(okDef);
        (0, toolRegistry_1.registerTool)(failDef);
        (0, toolRegistry_1.registerTool)(throwDef);
        (0, toolRegistry_1.registerTool)(hangDef);
        await (0, toolRegistry_1.executeToolCall)(okDef.name, { message: 'a' });
        await (0, toolRegistry_1.executeToolCall)(failDef.name, { message: 'b' });
        await (0, toolRegistry_1.executeToolCall)(throwDef.name, { message: 'c' });
        await (0, toolRegistry_1.executeToolCall)(hangDef.name, { message: 'd' }, { timeoutMs: 30 });
        await (0, toolRegistry_1.executeToolCall)(okDef.name, {}); // validation failure
        (0, vitest_1.expect)(createMock).toHaveBeenCalledTimes(5);
        (0, vitest_1.expect)(createMock.mock.calls.every(([row]) => row.status === 'pending')).toBe(true);
        (0, vitest_1.expect)(updateStatusMock).toHaveBeenCalledTimes(5);
        const statuses = updateStatusMock.mock.calls.map(call => call[1]);
        (0, vitest_1.expect)(statuses).toEqual(['success', 'failed', 'failed', 'failed', 'failed']);
    });
    (0, vitest_1.it)('aborts without executing when the audit row cannot be written (fail closed)', async () => {
        createMock.mockImplementationOnce(() => {
            throw new Error('db locked');
        });
        const handler = vitest_1.vi.fn(async () => ({ success: true, result: 'ran' }));
        const def = makeDefinition({ handler });
        (0, toolRegistry_1.registerTool)(def);
        const result = await (0, toolRegistry_1.executeToolCall)(def.name, { message: 'hi' });
        (0, vitest_1.expect)(result.success).toBe(false);
        (0, vitest_1.expect)(result.error).toMatch(/unable to write audit log/);
        (0, vitest_1.expect)(handler).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('uses the configurable timeout rather than only the default', async () => {
        const handler = vitest_1.vi.fn(() => new Promise((_, reject) => setTimeout(() => reject(new Error('late')), 200)));
        const def = makeDefinition({ handler });
        (0, toolRegistry_1.registerTool)(def);
        const result = await (0, toolRegistry_1.executeToolCall)(def.name, { message: 'hi' }, { timeoutMs: 25 });
        (0, vitest_1.expect)(result.success).toBe(false);
        (0, vitest_1.expect)(result.error).toMatch(/timed out after 25ms/);
    });
});
