import { beforeEach, describe, expect, it, vi } from 'vitest';
import { join, resolve } from 'path';

const { existsSyncMock, statSyncMock, unlinkSyncMock, homedirMock } = vi.hoisted(() => ({
  existsSyncMock: vi.fn(),
  statSyncMock: vi.fn(),
  unlinkSyncMock: vi.fn(),
  homedirMock: vi.fn(),
}));

vi.mock('fs', () => ({
  existsSync: existsSyncMock,
  statSync: statSyncMock,
  unlinkSync: unlinkSyncMock,
}));

vi.mock('os', () => ({
  homedir: homedirMock,
}));

vi.mock('../../db/db', () => ({
  toolExecutions: {
    create: vi.fn(),
    updateStatus: vi.fn(),
  },
}));

// Import after mocks are set up — this triggers registerTool
import '../deleteFile';
import { executeToolCall, getTool, setExecutionGate, type ExecutionGate } from '../toolRegistry';
import { toolExecutions } from '../../db/db';

const HOME = resolve(join('/', 'home', 'testuser'));
const TARGET = resolve(join(HOME, 'Documents', 'notes.txt'));

function approvedGate(): ExecutionGate {
  return vi.fn(async () => ({ decision: 'proceed' as const }));
}

function deniedGate(): ExecutionGate {
  return vi.fn(async () => ({ decision: 'deny' as const, reason: 'user said no' }));
}

function gateParams(gate: ReturnType<typeof approvedGate>): Record<string, unknown> {
  const context = (gate as ReturnType<typeof vi.fn>).mock.calls[0][0];
  return context.params;
}

beforeEach(() => {
  vi.clearAllMocks();
  homedirMock.mockReturnValue(HOME);
  // Default: the target exists and is a regular file.
  existsSyncMock.mockImplementation(p => p === TARGET);
  statSyncMock.mockImplementation(p =>
    p === TARGET ? { isFile: () => true, isDirectory: () => false } : null
  );
  setExecutionGate(null);
});

describe('delete_file tool', () => {
  const tool = () => getTool('delete_file')!;

  it('is registered with confirm_required permission tier', () => {
    expect(tool()).toBeDefined();
    expect(tool().permissionTier).toBe('confirm_required');
  });

  it('resolves ~ paths to an absolute path so the dialog shows exactly what is deleted', async () => {
    const gate = approvedGate();
    setExecutionGate(gate);
    // Exists during normalization + handler pre-check; gone after deletion.
    existsSyncMock.mockImplementation(
      p => p === TARGET && existsSyncMock.mock.calls.length <= 2
    );

    const outcome = await executeToolCall('delete_file', { path: '~/Documents/notes.txt' });

    expect(outcome.success).toBe(true);
    const shownParams = gateParams(gate);
    expect(shownParams.path).toBe(TARGET); // exact resolved absolute path pre-approval
  });

  it('refuses system-critical paths outright — the confirmation gate never fires', async () => {
    const windowsPath = join(process.env.SystemRoot ?? 'C:\\Windows', 'system32', 'kernel32.dll');
    existsSyncMock.mockReturnValue(true);

    const outcome = await executeToolCall('delete_file', { path: windowsPath });

    expect(outcome.success).toBe(false);
    expect(outcome.error).toMatch(/Refused|system-critical/i);
    expect(unlinkSyncMock).not.toHaveBeenCalled();
    expect(toolExecutions.updateStatus).toHaveBeenCalledWith(
      expect.any(String),
      'failed',
      expect.anything()
    );
  });

  it('refuses the user home root itself even though it exists', async () => {
    existsSyncMock.mockReturnValue(true);

    const outcome = await executeToolCall('delete_file', { path: HOME });

    expect(outcome.success).toBe(false);
    expect(outcome.error).toMatch(/Refused|system-critical|regular file/i);
    expect(unlinkSyncMock).not.toHaveBeenCalled();
  });

  it('returns a clear "nothing to delete" result for missing files without any dialog', async () => {
    const gate = approvedGate();
    setExecutionGate(gate);

    const outcome = await executeToolCall('delete_file', { path: join(HOME, 'ghost.txt') });

    expect(outcome.success).toBe(false);
    expect(outcome.error).toMatch(/nothing to delete/i);
    expect(gate).not.toHaveBeenCalled();
    expect(unlinkSyncMock).not.toHaveBeenCalled();
  });

  it('refuses directories instead of attempting deletion', async () => {
    const dir = join(HOME, 'some-folder');
    existsSyncMock.mockImplementation(p => p === dir);
    statSyncMock.mockImplementation(p =>
      p === dir ? { isFile: () => false, isDirectory: () => true } : null
    );

    const outcome = await executeToolCall('delete_file', { path: dir });

    expect(outcome.success).toBe(false);
    expect(outcome.error).toMatch(/not a regular file/i);
    expect(unlinkSyncMock).not.toHaveBeenCalled();
  });

  it('deletes only after approval and verifies the file is actually gone before success', async () => {
    setExecutionGate(approvedGate());
    // Sequence: pre-gate existence check true, handler pre-check true,
    // post-unlink verification false.
    existsSyncMock.mockImplementation(
      p => p === TARGET && existsSyncMock.mock.calls.length <= 2
    );

    const outcome = await executeToolCall('delete_file', { path: TARGET });

    expect(unlinkSyncMock).toHaveBeenCalledWith(TARGET);
    expect(outcome.success).toBe(true);
    expect(outcome.result).toContain(TARGET);
  });

  it('reports honest failure if the file somehow survives the delete call', async () => {
    setExecutionGate(approvedGate());
    existsSyncMock.mockReturnValue(true); // still present after unlink

    const outcome = await executeToolCall('delete_file', { path: TARGET });

    expect(unlinkSyncMock).toHaveBeenCalled();
    expect(outcome.success).toBe(false);
    expect(outcome.error).toMatch(/still present/i);
  });

  it('denial results in no deletion and a denied audit entry', async () => {
    setExecutionGate(deniedGate());

    const outcome = await executeToolCall('delete_file', { path: TARGET });

    expect(outcome.success).toBe(false);
    expect(outcome.error).toMatch(/not approved/);
    expect(unlinkSyncMock).not.toHaveBeenCalled();
    expect(toolExecutions.updateStatus).toHaveBeenCalledWith(
      expect.any(String),
      'denied',
      expect.stringContaining('user said no')
    );
  });

  it('maps locked/permission failures to a clear typed error', async () => {
    unlinkSyncMock.mockImplementation(() => {
      const err = new Error('busy') as NodeJS.ErrnoException;
      err.code = 'EBUSY';
      throw err;
    });
    setExecutionGate(approvedGate());

    const outcome = await executeToolCall('delete_file', { path: TARGET });

    expect(outcome.success).toBe(false);
    expect(outcome.error).toMatch(/open or locked/i);
  });

  it('re-runs safety checks on user-edited params from the dialog Edit flow', async () => {
    const editedPath = join(process.env.SystemRoot ?? 'C:\\Windows', 'evil.dll');
    const gate: ExecutionGate = vi.fn(async () => ({
      decision: 'proceed_with_params' as const,
      params: { path: editedPath },
    }));
    setExecutionGate(gate);
    existsSyncMock.mockReturnValue(true);

    const outcome = await executeToolCall('delete_file', { path: TARGET });

    expect(outcome.success).toBe(false);
    expect(outcome.error).toMatch(/Edited parameters rejected/);
    expect(unlinkSyncMock).not.toHaveBeenCalled();
  });
});
