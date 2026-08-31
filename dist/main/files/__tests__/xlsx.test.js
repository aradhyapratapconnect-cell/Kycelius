"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const xlsx_1 = require("../xlsx");
const zipFixture_1 = require("./zipFixture");
(0, vitest_1.describe)('extractXlsxText', () => {
    (0, vitest_1.it)('reads shared strings and numeric values per row', () => {
        const sheet = '<worksheet><sheetData>' +
            '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>' +
            '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>42</v></c></row>' +
            '</sheetData></worksheet>';
        const result = (0, xlsx_1.extractXlsxText)((0, zipFixture_1.miniXlsx)(['Name', 'Value', 'Widget'], sheet));
        (0, vitest_1.expect)(result).toContain('sheet1:');
        (0, vitest_1.expect)(result).toContain('Name | Value');
        (0, vitest_1.expect)(result).toContain('Widget | 42');
    });
    (0, vitest_1.it)('reads stored (uncompressed) entries too', () => {
        const sheet = '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"><v>9</v></c></row></sheetData></worksheet>';
        const result = (0, xlsx_1.extractXlsxText)((0, zipFixture_1.miniXlsx)(['Qty'], sheet, true));
        (0, vitest_1.expect)(result).toContain('Qty | 9');
    });
    (0, vitest_1.it)('handles rich-text runs inside shared strings', () => {
        const sheet = '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row></sheetData></worksheet>';
        const sharedXml = '<sst><si><r><t>Hello </t></r><r><t>World</t></r></si></sst>';
        const buffer = (0, zipFixture_1.buildZip)([
            { name: 'xl/sharedStrings.xml', data: Buffer.from(sharedXml, 'utf8') },
            { name: 'xl/worksheets/sheet1.xml', data: Buffer.from(sheet, 'utf8') },
        ]);
        (0, vitest_1.expect)((0, xlsx_1.extractXlsxText)(buffer)).toContain('Hello World');
    });
    (0, vitest_1.it)('decodes XML entities', () => {
        const sheet = '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>A &amp; B</t></is></c></row></sheetData></worksheet>';
        const result = (0, xlsx_1.extractXlsxText)((0, zipFixture_1.miniXlsx)([], sheet));
        (0, vitest_1.expect)(result).toContain('A & B');
    });
    (0, vitest_1.it)('extracts across multiple sheets in order', () => {
        const sheet1 = '<worksheet><sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData></worksheet>';
        const sheet2 = '<worksheet><sheetData><row r="1"><c r="A1"><v>2</v></c></row></sheetData></worksheet>';
        const buffer = (0, zipFixture_1.buildZip)([
            { name: 'xl/sharedStrings.xml', data: Buffer.from('<sst/>', 'utf8') },
            { name: 'xl/worksheets/sheet1.xml', data: Buffer.from(sheet1, 'utf8') },
            { name: 'xl/worksheets/sheet2.xml', data: Buffer.from(sheet2, 'utf8') },
        ]);
        const result = (0, xlsx_1.extractXlsxText)(buffer);
        (0, vitest_1.expect)(result.indexOf('sheet1:')).toBeLessThan(result.indexOf('sheet2:'));
        (0, vitest_1.expect)(result).toContain('2');
    });
    (0, vitest_1.it)('throws a clear error for non-zip input', () => {
        (0, vitest_1.expect)(() => (0, xlsx_1.extractXlsxText)(Buffer.from('this is not a zip file', 'utf8'))).toThrow(xlsx_1.XlsxParseError);
    });
});
