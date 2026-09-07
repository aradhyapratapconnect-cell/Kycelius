import { describe, expect, it, vi, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));

vi.mock('../../db/db', () => ({
  attachments: { create: createMock },
}));

import { ingestAttachment, normalizeAttachPath } from '../attachFile';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('EF-11 normalizeAttachPath (Windows paths)', () => {
  it('passes a plain Windows path through', () => {
    expect(normalizeAttachPath('C:\\Users\\aradh\\Downloads\\random_sample.pdf')).toContain('random_sample.pdf');
  });

  it('strips surrounding quotes from picker/drag-drop serialization', () => {
    const quoted = '"C:\\Users\\aradh\\Downloads\\random_sample.pdf"';
    expect(normalizeAttachPath(quoted)).toBe(normalizeAttachPath('C:\\Users\\aradh\\Downloads\\random_sample.pdf'));
  });

  it('unwraps file:/// URLs', () => {
    const url = 'file:///C:/Users/aradh/Downloads/random_sample.pdf';
    expect(normalizeAttachPath(url)).toContain('random_sample.pdf');
  });

  it('rejects non-strings and empty input', () => {
    expect(normalizeAttachPath('')).toBe('');
    expect(normalizeAttachPath(undefined)).toBe('');
    expect(normalizeAttachPath(42)).toBe('');
  });
});

describe('EF-11 ingestAttachment (shared picker + drag-drop core)', () => {
  it('picker and drag-drop paths resolve identically (quoted vs bare)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kyclius-attach-'));
    const file = join(dir, 'hello.txt');
    writeFileSync(file, 'hello attachment');
    try {
      const bare = await ingestAttachment(file, 'convo-1');
      const quoted = await ingestAttachment(`"${file}"`, 'convo-1');
      expect(bare.success).toBe(true);
      expect(quoted.success).toBe(true);
      if (bare.success && quoted.success) {
        expect(quoted.attachment.path).toBe(bare.attachment.path);
        expect(quoted.attachment.displayName).toBe('hello.txt');
      }
      expect(createMock).toHaveBeenCalledTimes(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('missing files produce a specific error (not a silent no-op)', async () => {
    const outcome = await ingestAttachment('C:\\definitely\\not\\here\\missing.pdf', 'convo-1');
    expect(outcome.success).toBe(false);
    if (!outcome.success) {
      expect(outcome.error).toMatch(/couldn't read|doesn't exist/i);
    }
    expect(createMock).not.toHaveBeenCalled();
  });

  it('relative paths are rejected safely', async () => {
    const outcome = await ingestAttachment('relative/path.txt', 'convo-1');
    expect(outcome.success).toBe(false);
  });
});
