import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { buildFileContext } from '../context';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'kyclius-context-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function write(name: string, contents: string | Buffer): string {
  const p = join(dir, name);
  writeFileSync(p, contents);
  return p;
}

describe('buildFileContext', () => {
  it('returns null block when no mention exists', () => {
    const result = buildFileContext('hello there');
    expect(result.contextBlock).toBeNull();
    expect(result.cleanUserText).toBe('hello there');
  });

  it('attaches extracted text for the request only', () => {
    const p = write('note.txt', 'the secret is pineapples');
    const result = buildFileContext(`what is in @${p}?`);
    expect(result.contextBlock).toContain('the secret is pineapples');
    expect(result.contextBlock).toContain('note.txt');
    expect(result.cleanUserText).toBe('what is in?');
  });

  it('strips the mention but keeps surrounding wording', () => {
    const p = write('doc.pdf', 'dummy');
    const result = buildFileContext(`summarize @${p} please`);
    expect(result.cleanUserText).toBe('summarize please');
  });

  it('reports failed references as a clear notice', () => {
    const p = join(dir, 'missing.pdf');
    const result = buildFileContext(`read @${p}`);
    expect(result.contextBlock).toContain('could not be read');
    expect(result.contextBlock).toContain('Tell the user this clearly');
  });

  it('handles images as a note, not a failure', () => {
    const png = Buffer.from(
      [
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
        0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00, 0x03, 0x08, 0x06,
      ],
    );
    const p = write('pic.png', png);
    const result = buildFileContext(`describe @${p}`);
    expect(result.contextBlock).toContain('pic.png');
    expect(result.contextBlock).toContain("can't read image pixels yet");
  });

  it('handles multiple references in one command', () => {
    const a = write('a.txt', 'alpha');
    const b = write('b.txt', 'beta');
    const result = buildFileContext(`compare @${a} @${b}`);
    expect(result.contextBlock).toContain('alpha');
    expect(result.contextBlock).toContain('beta');
    expect(result.cleanUserText).toBe('compare');
  });
});