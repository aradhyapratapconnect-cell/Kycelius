import { EventEmitter } from 'events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { execMock, spawnMock } = vi.hoisted(() => ({
  execMock: vi.fn(),
  spawnMock: vi.fn(),
}));

vi.mock('child_process', () => ({
  exec: execMock,
  spawn: spawnMock,
}));

vi.mock('../../db/db', () => ({
  toolExecutions: {
    create: vi.fn(),
    updateStatus: vi.fn(),
  },
}));

// Import after mocks are set up — this triggers registerTool
import '../sendEmail';
import { getTool, setExecutionGate, type ExecutionGate } from '../toolRegistry';
import { validateEmailAddress } from '../sendEmail';
import { toolExecutions } from '../../db/db';

const originalPlatform = process.platform;

function setPlatform(platform: string) {
  Object.defineProperty(process, 'platform', { value: platform, writable: true, configurable: true });
}

function makeSpawnChild(exitCode = 0): EventEmitter & { killed: boolean } {
  const child: EventEmitter & { killed: boolean } = new EventEmitter() as never;
  child.killed = false;
  queueMicrotask(() => {
    if (exitCode === 0) child.emit('close', 0);
    else child.emit('error', new Error(`spawn failed (${exitCode})`));
  });
  return child;
}

function decodedPsScript(callIndex = 0): string {
  const command = execMock.mock.calls[callIndex][0] as string;
  const encoded = command.split('-EncodedCommand ')[1];
  expect(encoded).toBeDefined();
  return Buffer.from(encoded, 'base64').toString('utf16le');
}

const VALID_PARAMS = {
  to: 'friend@example.com',
  subject: 'Lunch',
  body: 'Want to grab lunch tomorrow?',
};

beforeEach(() => {
  vi.clearAllMocks();
  execMock.mockImplementation((_command: string, _opts: unknown, cb?: unknown) => {
    if (typeof cb === 'function') {
      queueMicrotask(() => (cb as (err: Error | null, stdout: string) => void)(null, ''));
    }
    return {};
  });
  spawnMock.mockImplementation(() => makeSpawnChild(0));
});

afterEach(() => {
  setExecutionGate(null);
  setPlatform(originalPlatform);
});

describe('validateEmailAddress', () => {
  it('accepts normal addresses', () => {
    expect(validateEmailAddress('person@example.com')).toBeNull();
    expect(validateEmailAddress('  person@example.com  ')).toBeNull();
    expect(validateEmailAddress('first.last+tag@sub.domain.co')).toBeNull();
  });

  it('rejects malformed addresses with clear messages', () => {
    expect(validateEmailAddress('not-an-email')).toMatch(/not a valid email/);
    expect(validateEmailAddress('missing@tld')).toMatch(/not a valid email/);
    expect(validateEmailAddress('has space@example.com')).toMatch(/not a valid email/);
    expect(validateEmailAddress('@example.com')).toMatch(/not a valid email/);
    expect(validateEmailAddress('')).toMatch(/must not be empty/);
    expect(validateEmailAddress(undefined)).toMatch(/must be a string/);
  });
});

describe('send_email tool', () => {
  const tool = () => getTool('send_email')!;

  it('is registered with confirm_required permission tier', () => {
    expect(tool()).toBeDefined();
    expect(tool().permissionTier).toBe('confirm_required');
  });

  it('rejects a malformed address BEFORE the confirmation gate ever fires', async () => {
    const gate: ExecutionGate = vi.fn(async () => ({ decision: 'proceed' as const }));
    setExecutionGate(gate);

    const result = await getTool('send_email')!.handler; // reference sanity
    expect(result).toBeTypeOf('function');

    const { executeToolCall } = await import('../toolRegistry');
    const outcome = await executeToolCall('send_email', { ...VALID_PARAMS, to: 'broken@@mail' });

    expect(outcome.success).toBe(false);
    expect(outcome.error).toMatch(/not a valid email/);
    expect(gate).not.toHaveBeenCalled();
  });

  it('runs semantic validation after user edits too (edited malformed address is rejected)', async () => {
    const { executeToolCall } = await import('../toolRegistry');
    setPlatform('darwin');
    const gate: ExecutionGate = vi.fn(async () => ({
      decision: 'proceed_with_params' as const,
      params: { ...VALID_PARAMS, to: 'oops no at sign' },
    }));
    setExecutionGate(gate);

    const outcome = await executeToolCall('send_email', { ...VALID_PARAMS });

    expect(outcome.success).toBe(false);
    expect(outcome.error).toMatch(/Edited parameters rejected/);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('opens PowerShell Start-Process on Windows with the encoded mailto URL', async () => {
    setPlatform('win32');
    const gate: ExecutionGate = vi.fn(async () => ({ decision: 'proceed' as const }));
    setExecutionGate(gate);
    const { executeToolCall } = await import('../toolRegistry');

    const outcome = await executeToolCall('send_email', {
      to: 'friend@example.com',
      subject: 'Hello world',
      body: 'line one\nline two',
    });

    expect(outcome.success).toBe(true);
    const script = decodedPsScript(0);
    expect(script).toContain('Start-Process');
    expect(script).toContain('mailto:friend%40example.com'); // '@' encoded
    expect(script).toContain('subject=Hello%20world');
    expect(script).toContain('body=line%20one%0Aline%20two');
  });

  it('opens the draft via `open` on macOS', async () => {
    setPlatform('darwin');
    const gate: ExecutionGate = vi.fn(async () => ({ decision: 'proceed' as const }));
    setExecutionGate(gate);
    const { executeToolCall } = await import('../toolRegistry');

    const outcome = await executeToolCall('send_email', VALID_PARAMS);

    expect(outcome.success).toBe(true);
    expect(spawnMock).toHaveBeenCalledWith(
      'open',
      [expect.stringMatching(/^mailto:friend%40example\.com\?subject=Lunch&body=/)],
      expect.anything()
    );
  });

  it('opens the draft via xdg-open on Linux', async () => {
    setPlatform('linux');
    const gate: ExecutionGate = vi.fn(async () => ({ decision: 'proceed' as const }));
    setExecutionGate(gate);
    const { executeToolCall } = await import('../toolRegistry');

    const outcome = await executeToolCall('send_email', VALID_PARAMS);

    expect(outcome.success).toBe(true);
    expect(spawnMock).toHaveBeenCalledWith(
      'xdg-open',
      [expect.stringContaining('mailto:')],
      expect.anything()
    );
  });

  it('never claims "sent" or "delivered" on success', async () => {
    setPlatform('darwin');
    const gate: ExecutionGate = vi.fn(async () => ({ decision: 'proceed' as const }));
    setExecutionGate(gate);
    const { executeToolCall } = await import('../toolRegistry');

    const outcome = await executeToolCall('send_email', VALID_PARAMS);

    expect(outcome.result).toMatch(/opened/i);
    expect(outcome.result).toMatch(/mail client/);
    expect(outcome.result).not.toMatch(/\bsent\b|\bdelivered\b/i);
  });

  it('denial results in no mail client action and a denied audit entry', async () => {
    setPlatform('darwin');
    const gate: ExecutionGate = vi.fn(async () => ({ decision: 'deny' as const, reason: 'user said no' }));
    setExecutionGate(gate);
    const { executeToolCall } = await import('../toolRegistry');

    const outcome = await executeToolCall('send_email', VALID_PARAMS);

    expect(outcome.success).toBe(false);
    expect(outcome.error).toMatch(/not approved/);
    expect(spawnMock).not.toHaveBeenCalled();
    expect(execMock).not.toHaveBeenCalled();
    expect(toolExecutions.updateStatus).toHaveBeenCalledWith(
      expect.any(String),
      'denied',
      expect.stringContaining('user said no')
    );
  });

  it('reports opener failures as typed errors instead of pretending success', async () => {
    setPlatform('darwin');
    spawnMock.mockImplementation(() => makeSpawnChild(1));
    const gate: ExecutionGate = vi.fn(async () => ({ decision: 'proceed' as const }));
    setExecutionGate(gate);
    const { executeToolCall } = await import('../toolRegistry');

    const outcome = await executeToolCall('send_email', VALID_PARAMS);

    expect(outcome.success).toBe(false);
    expect(outcome.error).toMatch(/Could not open your mail client/);
  });
});
