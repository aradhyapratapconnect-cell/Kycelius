import { beforeEach, describe, expect, it, vi } from 'vitest';
import { join, resolve } from 'path';

const { existsSyncMock, mkdirSyncMock, writeFileSyncMock, homedirMock } = vi.hoisted(() => ({
  existsSyncMock: vi.fn(),
  mkdirSyncMock: vi.fn(),
  writeFileSyncMock: vi.fn(),
  homedirMock: vi.fn(),
}));

vi.mock('fs', () => ({
  existsSync: existsSyncMock,
  mkdirSync: mkdirSyncMock,
  writeFileSync: writeFileSyncMock,
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
import '../createFile';
import { getTool } from '../toolRegistry';

const HOME = resolve('/home/testuser');
const SCOPE_ROOT = join(HOME, 'Documents', 'Kyclius');

beforeEach(() => {
  vi.clearAllMocks();
  homedirMock.mockReturnValue(HOME);
  existsSyncMock.mockReturnValue(false);
});

describe('create_file tool', () => {
  const tool = () => getTool('create_file')!;

  it('is registered with auto permission tier', () => {
    expect(tool()).toBeDefined();
    expect(tool().permissionTier).toBe('auto');
  });

  it('rejects a missing or empty filename', async () => {
    const missing = await tool().handler({ content: 'hello' });
    expect(missing.success).toBe(false);
    expect(missing.error).toMatch(/filename must be a non-empty string/);

    const empty = await tool().handler({ filename: '   ', content: 'hello' });
    expect(empty.success).toBe(false);
    expect(empty.error).toMatch(/filename must be an actual file name|non-empty/);
  });

  it('rejects non-string content', async () => {
    const result = await tool().handler({ filename: 'notes.txt', content: 42 });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/content must be a string/);
  });

  it('creates the file with correct content at the default Kyclius Documents location', async () => {
    const result = await tool().handler({
      filename: 'todo.txt',
      content: 'buy oat milk',
    });

    expect(result.success).toBe(true);
    const expectedPath = join(SCOPE_ROOT, 'todo.txt');
    expect(writeFileSyncMock).toHaveBeenCalledWith(expectedPath, 'buy oat milk', 'utf8');
    // The default scope folder is created on demand.
    expect(mkdirSyncMock).toHaveBeenCalledWith(SCOPE_ROOT, { recursive: true });
    // Result reports the final resolved absolute path.
    expect(result.result).toContain(expectedPath);
  });

  it('resolves a relative path into a subfolder of the Kyclius scope', async () => {
    const result = await tool().handler({
      path: 'notes',
      filename: 'idea.md',
      content: '# Idea',
    });

    expect(result.success).toBe(true);
    const expectedDir = join(SCOPE_ROOT, 'notes');
    expect(mkdirSyncMock).toHaveBeenCalledWith(expectedDir, { recursive: true });
    expect(writeFileSyncMock).toHaveBeenCalledWith(join(expectedDir, 'idea.md'), '# Idea', 'utf8');
    expect(result.result).toContain(join(expectedDir, 'idea.md'));
  });

  it('accepts an absolute path that stays inside the allowed scope', async () => {
    const insideDir = join(SCOPE_ROOT, 'deep', 'nested');
    const result = await tool().handler({
      path: insideDir,
      filename: 'a.txt',
      content: 'x',
    });

    expect(result.success).toBe(true);
    expect(writeFileSyncMock).toHaveBeenCalledWith(join(insideDir, 'a.txt'), 'x', 'utf8');
  });

  it('refuses to overwrite an existing file and writes nothing', async () => {
    existsSyncMock.mockImplementation(p => p === join(SCOPE_ROOT, 'existing.txt'));

    const result = await tool().handler({
      filename: 'existing.txt',
      content: 'clobber attempt',
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/already exists/i);
    expect(writeFileSyncMock).not.toHaveBeenCalled();
  });

  it('rejects absolute paths outside the Kyclius scope', async () => {
    const outsideDir = join(HOME, 'Desktop');
    const result = await tool().handler({
      path: outsideDir,
      filename: 'evil.txt',
      content: 'x',
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/outside/i);
    expect(writeFileSyncMock).not.toHaveBeenCalled();
  });

  it('rejects relative traversal that climbs out of the Kyclius scope', async () => {
    const result = await tool().handler({
      path: '../../elsewhere',
      filename: 'escape.txt',
      content: 'x',
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/outside/i);
    expect(writeFileSyncMock).not.toHaveBeenCalled();
  });

  it('rejects filenames containing path separators (traversal via filename)', async () => {
    for (const bad of ['../evil.txt', '..\\evil.txt', 'sub/dir.txt']) {
      const result = await tool().handler({ filename: bad, content: 'x' });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/path separators/);
    }
    expect(writeFileSyncMock).not.toHaveBeenCalled();
  });

  it('reports disk-full as a clear typed failure', async () => {
    writeFileSyncMock.mockImplementation(() => {
      const err = new Error('no space') as NodeJS.ErrnoException;
      err.code = 'ENOSPC';
      throw err;
    });

    const result = await tool().handler({ filename: 'big.bin', content: 'data' });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/disk is full/i);
  });

  it('reports permission problems as a clear typed failure', async () => {
    writeFileSyncMock.mockImplementation(() => {
      const err = new Error('denied') as NodeJS.ErrnoException;
      err.code = 'EACCES';
      throw err;
    });

    const result = await tool().handler({ filename: 'locked.txt', content: 'data' });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/permission denied/i);
  });
});
