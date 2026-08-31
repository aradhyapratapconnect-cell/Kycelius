import { describe, expect, it } from 'vitest';
import { extractXlsxText, XlsxParseError } from '../xlsx';
import { buildZip, miniXlsx } from './zipFixture';

describe('extractXlsxText', () => {
  it('reads shared strings and numeric values per row', () => {
    const sheet =
      '<worksheet><sheetData>' +
      '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>' +
      '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>42</v></c></row>' +
      '</sheetData></worksheet>';
    const result = extractXlsxText(miniXlsx(['Name', 'Value', 'Widget'], sheet));
    expect(result).toContain('sheet1:');
    expect(result).toContain('Name | Value');
    expect(result).toContain('Widget | 42');
  });

  it('reads stored (uncompressed) entries too', () => {
    const sheet =
      '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"><v>9</v></c></row></sheetData></worksheet>';
    const result = extractXlsxText(miniXlsx(['Qty'], sheet, true));
    expect(result).toContain('Qty | 9');
  });

  it('handles rich-text runs inside shared strings', () => {
    const sheet = '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row></sheetData></worksheet>';
    const sharedXml = '<sst><si><r><t>Hello </t></r><r><t>World</t></r></si></sst>';
    const buffer = buildZip([
      { name: 'xl/sharedStrings.xml', data: Buffer.from(sharedXml, 'utf8') },
      { name: 'xl/worksheets/sheet1.xml', data: Buffer.from(sheet, 'utf8') },
    ]);
    expect(extractXlsxText(buffer)).toContain('Hello World');
  });

  it('decodes XML entities', () => {
    const sheet =
      '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>A &amp; B</t></is></c></row></sheetData></worksheet>';
    const result = extractXlsxText(miniXlsx([], sheet));
    expect(result).toContain('A & B');
  });

  it('extracts across multiple sheets in order', () => {
    const sheet1 = '<worksheet><sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData></worksheet>';
    const sheet2 = '<worksheet><sheetData><row r="1"><c r="A1"><v>2</v></c></row></sheetData></worksheet>';
    const buffer = buildZip([
      { name: 'xl/sharedStrings.xml', data: Buffer.from('<sst/>', 'utf8') },
      { name: 'xl/worksheets/sheet1.xml', data: Buffer.from(sheet1, 'utf8') },
      { name: 'xl/worksheets/sheet2.xml', data: Buffer.from(sheet2, 'utf8') },
    ]);
    const result = extractXlsxText(buffer);
    expect(result.indexOf('sheet1:')).toBeLessThan(result.indexOf('sheet2:'));
    expect(result).toContain('2');
  });

  it('throws a clear error for non-zip input', () => {
    expect(() => extractXlsxText(Buffer.from('this is not a zip file', 'utf8'))).toThrow(XlsxParseError);
  });
});