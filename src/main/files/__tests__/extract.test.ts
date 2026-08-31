import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { deflateSync } from 'zlib';
import { extractFile, parseCsvText, capText } from '../extract';
import { miniXlsx } from './zipFixture';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'kyclius-extract-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function write(name: string, data: Buffer | string): string {
  const p = join(dir, name);
  writeFileSync(p, data);
  return p;
}

function makePdf(content: string): Buffer {
  const body = deflateSync(Buffer.from(content, 'latin1'));
  return Buffer.from(
    `%PDF-1.4\n3 0 obj\n<< /Length ${body.length} /Filter /FlateDecode >>\nstream\n${body.toString('latin1')}\nendstream\nendobj\n`,
    'latin1'
  );
}

function makePng(width: number, height: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const header = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(13, 0);
  const type = Buffer.from('IHDR', 'latin1');
  const crc = Buffer.alloc(4);
  return Buffer.concat([header, len, type, ihdr, crc]);
}

describe('parseCsvText', () => {
  it('parses quoted fields row by row', () => {
    const rows = parseCsvText('name,age\n"Smith, John",42\n');
    expect(rows).toContain('Row 1: name | age');
    expect(rows).toContain('Row 2: Smith, John | 42');
  });

  it('handles escaped quotes', () => {
    const rows = parseCsvText('note\n"say ""hi"""\n');
    expect(rows).toContain('Row 2: say "hi"');
  });

  it('handles CRLF line endings', () => {
    const rows = parseCsvText('a,b\r\n1,2\r\n');
    expect(rows).toContain('Row 2: 1 | 2');
  });

  it('marks truncated files', () => {
    const rows = parseCsvText(`a,b\n${[1, 2, 3, 4, 5].join(',')}\n`.repeat(600));
    expect(rows).toContain('[ … remaining rows omitted … ]');
  });
});

describe('capText', () => {
  it('keeps short text untouched', () => {
    expect(capText('hello', 10)).toEqual({ text: 'hello', truncated: false });
  });

  it('truncates long text with a marker', () => {
    const { text, truncated } = capText('x'.repeat(100), 10);
    expect(truncated).toBe(true);
    expect(text).toContain('truncated');
  });
});

describe('extractFile', () => {
  it('reads plain text files', () => {
    const p = write('note.txt', 'hello world\nsecond line');
    const result = extractFile(p);
    expect(result.failed).toBe(false);
    expect(result.kind).toBe('text');
    expect(result.content).toContain('hello world');
  });

  it('parses csv files as a row grid', () => {
    const p = write('data.csv', 'a,b\n1,2\n');
    const result = extractFile(p);
    expect(result.content).toContain('Row 1: a | b');
    expect(result.content).toContain('Row 2: 1 | 2');
  });

  it('extracts pdf text', () => {
    const p = write('doc.pdf', makePdf('BT (Extracted PDF text) Tj ET'));
    const result = extractFile(p);
    expect(result.failed).toBe(false);
    expect(result.content).toContain('Extracted PDF text');
  });

  it('flags a scanned / textless PDF clearly', () => {
    const p = write('scan.pdf', Buffer.from('%PDF-1.4\n%%EOF\n', 'latin1'));
    const result = extractFile(p);
    expect(result.failed).toBe(true);
    expect(result.content).toMatch(/no extractable text/i);
  });

  it('extracts xlsx cell text', () => {
    const sheet = '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row></sheetData></worksheet>';
    const p = write('book.xlsx', miniXlsx(['Cell'], sheet));
    const result = extractFile(p);
    expect(result.failed).toBe(false);
    expect(result.content).toContain('Cell');
  });

  it('reports an unreadable xlsx clearly', () => {
    const p = write('bad.xlsx', Buffer.from('not a zip', 'utf8'));
    const result = extractFile(p);
    expect(result.failed).toBe(true);
    expect(result.content).toMatch(/not a valid XLSX/i);
  });

  it('gives metadata plus a pixel note for images', () => {
    const p = write('photo.png', makePng(2, 3));
    const result = extractFile(p);
    expect(result.kind).toBe('note');
    expect(result.content).toContain('PNG');
    expect(result.content).toContain('2 x 3px');
    expect(result.content).toMatch(/can't read image pixels/i);
  });

  it('fails clearly for unsupported types', () => {
    const p = write('file.docx', Buffer.from('pk', 'utf8'));
    const result = extractFile(p);
    expect(result.failed).toBe(true);
    expect(result.content).toMatch(/unsupported file type/i);
  });

  it('fails clearly for a missing file', () => {
    const result = extractFile(join(dir, 'nope.pdf'));
    expect(result.failed).toBe(true);
    expect(result.content).toMatch(/file not found/i);
  });
});