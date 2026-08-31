import { randomUUID } from 'crypto';
import { toolExecutions } from '../db/db';

export type PermissionTier = 'auto' | 'confirm_required';
export type ToolExecutionStatus = 'pending' | 'confirmed' | 'denied' | 'success' | 'failed';

export interface ToolResult {
  success: boolean;
  result?: string;
  error?: string;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: JSONSchema;
  permissionTier: PermissionTier;
  handler: (params: Record<string, unknown>) => Promise<ToolResult>;
  /**
   * Optional semantic validation run AFTER schema-type validation but BEFORE
   * the permission gate, so malformed requests (e.g. a bad email address) are
   * rejected without ever showing the confirmation dialog. Must also pass for
   * user-edited params coming back from the dialog's Edit flow.
   */
  validate?: (params: Record<string, unknown>) => string | null;
  /**
   * Optional param normalization run before the gate (and re-applied to
   * user-edited params). May rewrite params — e.g. resolving a relative path
   * to its absolute form so the confirmation dialog shows exactly what will
   * happen — or return an error string to reject outright (e.g. a
   * system-critical path that must never even reach confirmation).
   */
  normalizeParams?: (
    params: Record<string, unknown>
  ) => Record<string, unknown> | string;
}

export interface JSONSchema {
  type: string;
  properties?: Record<string, JSONSchemaProperty>;
  required?: string[];
}

export interface JSONSchemaProperty {
  type: string;
  description?: string;
  enum?: unknown[];
}

export const DEFAULT_TOOL_TIMEOUT_MS = 30_000;

export interface ExecuteToolOptions {
  timeoutMs?: number;
  messageId?: string | null;
}

export interface ExecutedToolResult extends ToolResult {
  executionId?: string;
}

export interface ExecutionContext {
  executionId: string;
  toolName: string;
  permissionTier: PermissionTier;
  params: Record<string, unknown>;
}

export type GateDecision =
  | { decision: 'proceed' }
  | { decision: 'proceed_with_params'; params: Record<string, unknown> }
  | { decision: 'deny'; reason?: string };

export type ExecutionGate = (context: ExecutionContext) => Promise<GateDecision>;

let executionGate: ExecutionGate | null = null;

export function setExecutionGate(gate: ExecutionGate | null): void {
  executionGate = gate;
}

/**
 * T-14: optional push hook invoked after every status transition (including
 * the initial 'pending' write) so the UI can reflect tool activity in
 * near-real-time. Dependency-injected via setToolExecutionNotifier to keep
 * this module Electron-free, mirroring setExecutionGate.
 */
export interface ToolExecutionNotice {
  id: string;
  status: ToolExecutionStatus;
  result?: string;
}

export type ToolExecutionNotifier = (notice: ToolExecutionNotice) => void;

let executionNotifier: ToolExecutionNotifier | null = null;

export function setToolExecutionNotifier(notifier: ToolExecutionNotifier | null): void {
  executionNotifier = notifier;
}

const toolRegistry = new Map<string, ToolDefinition>();

const VALID_TIERS: PermissionTier[] = ['auto', 'confirm_required'];

export function registerTool(definition: ToolDefinition): void {
  if (!definition || typeof definition !== 'object') {
    throw new Error('registerTool requires a ToolDefinition object');
  }
  if (typeof definition.name !== 'string' || definition.name.trim().length === 0) {
    throw new Error('Tool must have a non-empty "name"');
  }
  if (!VALID_TIERS.includes(definition.permissionTier)) {
    throw new Error(
      `Tool "${definition.name}" must declare an explicit permissionTier of 'auto' or 'confirm_required' — no default tier is allowed`
    );
  }
  if (typeof definition.description !== 'string' || definition.description.trim().length === 0) {
    throw new Error(`Tool "${definition.name}" must have a non-empty "description"`);
  }
  if (!isPlainObject(definition.parameters) || definition.parameters.type !== 'object') {
    throw new Error(`Tool "${definition.name}" must have a JSON schema with top-level type "object"`);
  }
  if (typeof definition.handler !== 'function') {
    throw new Error(`Tool "${definition.name}" must have a handler function`);
  }
  if (toolRegistry.has(definition.name)) {
    throw new Error(`Tool "${definition.name}" is already registered`);
  }
  toolRegistry.set(definition.name, definition);
}

export function getTool(name: string): ToolDefinition | undefined {
  return toolRegistry.get(name);
}

/** N-03: removes a runtime-registered tool (used when a plugin is uninstalled). */
export function unregisterTool(name: string): boolean {
  return toolRegistry.delete(name);
}

export function getAllTools(): ToolDefinition[] {
  return Array.from(toolRegistry.values());
}

export function getToolSchemas(): Array<{
  name: string;
  description: string;
  permissionTier: PermissionTier;
  parameters: JSONSchema;
}> {
  return getAllTools().map(t => ({
    name: t.name,
    description: t.description,
    permissionTier: t.permissionTier,
    parameters: t.parameters,
  }));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function matchesType(value: unknown, expectedType: string): boolean {
  switch (expectedType) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && !Number.isNaN(value);
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'array':
      return Array.isArray(value);
    case 'object':
      return isPlainObject(value);
    case 'null':
      return value === null;
    default:
      return false;
  }
}

export function validateParams(
  schema: JSONSchema,
  params: unknown
): { valid: boolean; error?: string } {
  if (!isPlainObject(params)) {
    return { valid: false, error: 'Parameters must be an object' };
  }

  const properties = schema.properties ?? {};
  const required = schema.required ?? [];

  for (const field of required) {
    if (!(field in params)) {
      return { valid: false, error: `Missing required parameter: ${field}` };
    }
  }

  for (const [key, value] of Object.entries(params)) {
    const propSchema = properties[key];
    if (!propSchema) {
      return { valid: false, error: `Unknown parameter: ${key}` };
    }
    if (!matchesType(value, propSchema.type)) {
      const actualType = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
      return {
        valid: false,
        error: `Parameter "${key}" must be of type ${propSchema.type}, got ${actualType}`,
      };
    }
    if (propSchema.enum && !propSchema.enum.includes(value)) {
      return {
        valid: false,
        error: `Parameter "${key}" must be one of: ${propSchema.enum.map(String).join(', ')}`,
      };
    }
  }

  return { valid: true };
}

function recordStatus(id: string, status: ToolExecutionStatus, result?: string): void {
  try {
    toolExecutions.updateStatus(id, status, result);
  } catch {
    console.error(`[toolRegistry] Failed to record ${status} status for execution ${id}`);
    return;
  }
  if (executionNotifier) {
    try {
      executionNotifier({ id, status, result });
    } catch (err) {
      console.error(
        `[toolRegistry] Execution notifier threw for ${id}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
}

function describeOutcome(outcome: ToolResult): string {
  if (outcome.error) return outcome.error;
  if (outcome.result !== undefined) return outcome.result;
  return outcome.success ? 'success' : 'failed';
}

export async function executeToolCall(
  toolName: string,
  rawParams: unknown,
  options: ExecuteToolOptions = {}
): Promise<ExecutedToolResult> {
  const timeoutMs =
    typeof options.timeoutMs === 'number' && options.timeoutMs > 0
      ? options.timeoutMs
      : DEFAULT_TOOL_TIMEOUT_MS;

  const tool = getTool(toolName);
  if (!tool) {
    return { success: false, error: `Unknown tool: ${toolName}` };
  }

  const params: unknown = rawParams ?? {};
  const executionId = randomUUID();

  try {
    toolExecutions.create({
      id: executionId,
      message_id: options.messageId ?? null,
      tool_name: tool.name,
      parameters: isPlainObject(params) ? params : {},
      permission_tier: tool.permissionTier,
      status: 'pending',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[toolRegistry] Could not audit-log execution for "${toolName}": ${message}`);
    return { success: false, error: 'Tool execution aborted: unable to write audit log', executionId };
  }

  // T-14: surface the new 'pending' row immediately — confirm_required tools
  // can sit in this state for a long time while the user decides.
  if (executionNotifier) {
    try {
      executionNotifier({ id: executionId, status: 'pending' });
    } catch {
      // Never let UI push failures affect tool execution.
    }
  }

  const prepareParams = (
    raw: unknown
  ): { valid: true; params: Record<string, unknown> } | { valid: false; error: string } => {
    let candidate = raw;
    if (tool.normalizeParams) {
      const normalized = tool.normalizeParams(candidate as Record<string, unknown>);
      if (typeof normalized === 'string') {
        return { valid: false, error: normalized };
      }
      candidate = normalized ?? {};
    }
    const typeCheck = validateParams(tool.parameters, candidate);
    if (!typeCheck.valid) {
      return { valid: false, error: typeCheck.error ?? 'invalid parameters' };
    }
    const asRecord = candidate as Record<string, unknown>;
    if (tool.validate) {
      const semanticError = tool.validate(asRecord);
      if (semanticError) return { valid: false, error: semanticError };
    }
    return { valid: true, params: asRecord };
  };

  let activeParams: Record<string, unknown>;
  const prepared = prepareParams(params);
  if (!prepared.valid) {
    const error = `Invalid parameters for tool "${tool.name}": ${prepared.error}`;
    recordStatus(executionId, 'failed', error);
    return { success: false, error, executionId };
  }
  activeParams = prepared.params;

  if (executionGate) {
    let gateResult: GateDecision;
    try {
      gateResult = await executionGate({
        executionId,
        toolName: tool.name,
        permissionTier: tool.permissionTier,
        params: activeParams,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      recordStatus(executionId, 'failed', `Permission check failed: ${message}`);
      return { success: false, error: `Permission check failed: ${message}`, executionId };
    }

    if (gateResult.decision === 'deny') {
      const reason = gateResult.reason ?? 'denied by user';
      recordStatus(executionId, 'denied', reason);
      return {
        success: false,
        error: `Tool "${tool.name}" was not approved: ${reason}`,
        executionId,
      };
    }

    if (gateResult.decision === 'proceed_with_params') {
      const reprepared = prepareParams(gateResult.params);
      if (!reprepared.valid) {
        const error = `Edited parameters rejected for tool "${tool.name}": ${reprepared.error}`;
        recordStatus(executionId, 'failed', error);
        return { success: false, error, executionId };
      }
      activeParams = reprepared.params;
    }
    recordStatus(executionId, 'confirmed');
  } else if (tool.permissionTier === 'confirm_required') {
    const reason = 'no permission engine registered';
    recordStatus(executionId, 'denied', reason);
    return {
      success: false,
      error: `Tool "${tool.name}" requires confirmation but no permission engine is registered`,
      executionId,
    };
  }

  let timer: NodeJS.Timeout | undefined;
  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`Tool "${tool.name}" timed out after ${timeoutMs}ms and was killed`));
      }, timeoutMs);
    });

    const outcome = await Promise.race([
      Promise.resolve(tool.handler(activeParams)),
      timeoutPromise,
    ]);

    if (!outcome || typeof outcome !== 'object' || typeof outcome.success !== 'boolean') {
      const error = `Tool "${tool.name}" returned a malformed result`;
      recordStatus(executionId, 'failed', error);
      return { success: false, error, executionId };
    }

    const detail = describeOutcome(outcome);
    recordStatus(executionId, outcome.success ? 'success' : 'failed', detail);
    return { ...outcome, executionId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    recordStatus(executionId, 'failed', message);
    return { success: false, error: message, executionId };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
