import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  DEFAULT_TOOL_TIMEOUT_MS,
  executeToolCall,
  getAllTools,
  getTool,
  registerTool,
  type ToolDefinition,
} from '../toolRegistry';

let nameCounter = 0;
const uniqueName = (prefix: string) => `${prefix}_${++nameCounter}`;

beforeEach(() => {
  vi.clearAllMocks();
});

function makeDefinition(overrides: Partial<ToolDefinition> = {}): ToolDefinition {
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
    handler: vi.fn(async (params: Record<string, unknown>) => ({
      success: true as const,
      result: `echo: ${params.message}`,
    })),
    ...overrides,
  };
}

describe('registerTool', () => {
  it('throws when permissionTier is missing — no silent default', () => {
    const def = makeDefinition();
    delete (def as Partial<ToolDefinition>).permissionTier;
    expect(() => registerTool(def as ToolDefinition)).toThrow(/permissionTier/);
  });

  it('throws when permissionTier is an invalid value', () => {
    const def = makeDefinition({ permissionTier: 'maybe' as never });
    expect(() => registerTool(def)).toThrow(/permissionTier/);
  });

  it('throws when a tool with the same name is already registered', () => {
    const def = makeDefinition();
    const duplicate = { ...def, handler: async () => ({ success: true }) };
    expect(() => {
      registerTool(def);
      registerTool(duplicate);
    }).toThrow(/already registered/);
  });

  it('stores the tool and exposes it via getTool/getAllTools', () => {
    const def = makeDefinition();
    registerTool(def);
    expect(getTool(def.name)).toBe(def);
    expect(getAllTools()).toContain(def);
  });
});

describe('executeToolCall', () => {
  it('returns an error for an unregistered tool name', async () => {
    const result = await executeToolCall('no_such_tool', {});
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Unknown tool/);
    expect(createMock).not.toHaveBeenCalled();
  });

  it('rejects missing required parameters before the handler runs', async () => {
    const handler = vi.fn(async () => ({ success: true, result: 'ran' }));
    const def = makeDefinition({ handler });
    registerTool(def);

    const result = await executeToolCall(def.name, {});

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Missing required parameter: message/);
    expect(handler).not.toHaveBeenCalled();
  });

  it('rejects wrongly-typed parameters before the handler runs', async () => {
    const handler = vi.fn(async () => ({ success: true, result: 'ran' }));
    const def = makeDefinition({ handler });
    registerTool(def);

    const result = await executeToolCall(def.name, { message: 42 });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/must be of type string, got number/);
    expect(handler).not.toHaveBeenCalled();
  });

  it('rejects non-object parameter payloads', async () => {
    const def = makeDefinition();
    registerTool(def);

    const result = await executeToolCall(def.name, 'not-an-object' as unknown);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Parameters must be an object/);
  });

  it('records a failed audit row when validation rejects the call', async () => {
    const def = makeDefinition();
    registerTool(def);

    await executeToolCall(def.name, {});

    expect(createMock).toHaveBeenCalledTimes(1);
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tool_name: def.name,
        permission_tier: 'auto',
        status: 'pending',
        parameters: {},
      })
    );
    expect(updateStatusMock).toHaveBeenCalledWith(
      expect.any(String),
      'failed',
      expect.stringMatching(/Missing required parameter/)
    );
  });

  it('executes the handler and records a success row on success', async () => {
    const def = makeDefinition();
    registerTool(def);

    const result = await executeToolCall(def.name, { message: 'hello' });

    expect(result.success).toBe(true);
    expect(result.result).toBe('echo: hello');
    expect(result.executionId).toEqual(expect.any(String));
    expect(updateStatusMock).toHaveBeenCalledTimes(1);
    expect(updateStatusMock).toHaveBeenCalledWith(expect.any(String), 'success', 'echo: hello');
  });

  it('records a failed row when the handler throws', async () => {
    const handler = vi.fn(async () => {
      throw new Error('disk exploded');
    });
    const def = makeDefinition({ handler });
    registerTool(def);

    const result = await executeToolCall(def.name, { message: 'hi' });

    expect(result.success).toBe(false);
    expect(result.error).toBe('disk exploded');
    expect(updateStatusMock).toHaveBeenCalledWith(expect.any(String), 'failed', 'disk exploded');
  });

  it('records a failed row when the handler returns success:false', async () => {
    const handler = vi.fn(async () => ({ success: false, error: 'file not found' }));
    const def = makeDefinition({ handler });
    registerTool(def);

    const result = await executeToolCall(def.name, { message: 'hi' });

    expect(result.success).toBe(false);
    expect(result.error).toBe('file not found');
    expect(updateStatusMock).toHaveBeenCalledWith(expect.any(String), 'failed', 'file not found');
  });

  it('kills a hung handler at the timeout and records it as failed', async () => {
    const handler = vi.fn((): Promise<never> => new Promise(() => {}));
    const def = makeDefinition({ handler });
    registerTool(def);

    const start = Date.now();
    const result = await executeToolCall(def.name, { message: 'hi' }, { timeoutMs: 50 });
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(DEFAULT_TOOL_TIMEOUT_MS);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/timed out after 50ms/);
    expect(updateStatusMock).toHaveBeenCalledWith(
      expect.any(String),
      'failed',
      expect.stringMatching(/timed out/)
    );
  }, 5000);

  it('produces exactly one tool_executions row per attempt regardless of outcome', async () => {
    const okDef = makeDefinition();
    const failDef = makeDefinition({
      handler: vi.fn(async () => ({ success: false, error: 'nope' })),
    });
    const throwDef = makeDefinition({
      handler: vi.fn(async () => {
        throw new Error('boom');
      }),
    });
    const hangDef = makeDefinition({ handler: () => new Promise(() => {}) });
    registerTool(okDef);
    registerTool(failDef);
    registerTool(throwDef);
    registerTool(hangDef);

    await executeToolCall(okDef.name, { message: 'a' });
    await executeToolCall(failDef.name, { message: 'b' });
    await executeToolCall(throwDef.name, { message: 'c' });
    await executeToolCall(hangDef.name, { message: 'd' }, { timeoutMs: 30 });
    await executeToolCall(okDef.name, {}); // validation failure

    expect(createMock).toHaveBeenCalledTimes(5);
    expect(createMock.mock.calls.every(([row]) => (row as { status: string }).status === 'pending')).toBe(
      true
    );
    expect(updateStatusMock).toHaveBeenCalledTimes(5);
    const statuses = updateStatusMock.mock.calls.map(call => call[1]);
    expect(statuses).toEqual(['success', 'failed', 'failed', 'failed', 'failed']);
  });

  it('aborts without executing when the audit row cannot be written (fail closed)', async () => {
    createMock.mockImplementationOnce(() => {
      throw new Error('db locked');
    });
    const handler = vi.fn(async () => ({ success: true, result: 'ran' }));
    const def = makeDefinition({ handler });
    registerTool(def);

    const result = await executeToolCall(def.name, { message: 'hi' });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/unable to write audit log/);
    expect(handler).not.toHaveBeenCalled();
  });

  it('uses the configurable timeout rather than only the default', async () => {
    const handler = vi.fn(
      () => new Promise<never>((_, reject) => setTimeout(() => reject(new Error('late')), 200))
    );
    const def = makeDefinition({ handler });
    registerTool(def);

    const result = await executeToolCall(def.name, { message: 'hi' }, { timeoutMs: 25 });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/timed out after 25ms/);
  });
});
