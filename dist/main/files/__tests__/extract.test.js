"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const fs_1 = require("fs");
const path_1 = require("path");
const os_1 = require("os");
const zlib_1 = require("zlib");
const extract_1 = require("../extract");
const zipFixture_1 = require("./zipFixture");
let dir;
(0, vitest_1.beforeEach)(() => {
    dir = (0, fs_1.mkdtempSync)((0, path_1.join)((0, os_1.tmpdir)(), 'kyclius-extract-'));
});
(0, vitest_1.afterEach)(() => {
    (0, fs_1.rmSync)(dir, { recursive: true, force: true });
});
function write(name, data) {
    const p = (0, path_1.join)(dir, name);
    (0, fs_1.writeFileSync)(p, data);
    return p;
}
function makePdf(content) {
    const body = (0, zlib_1.deflateSync)(Buffer.from(content, 'latin1'));
    return Buffer.from(`%PDF-1.4\n3 0 obj\n<< /Length ${body.length} /Filter /FlateDecode >>\nstream\n${body.toString('latin1')}\nendstream\nendobj\n`, 'latin1');
}
function makePng(width, height) {
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
(0, vitest_1.describe)('parseCsvText', () => {
    (0, vitest_1.it)('parses quoted fields row by row', () => {
        const rows = (0, extract_1.parseCsvText)('name,age\n"Smith, John",42\n');
        (0, vitest_1.expect)(rows).toContain('Row 1: name | age');
        (0, vitest_1.expect)(rows).toContain('Row 2: Smith, John | 42');
    });
    (0, vitest_1.it)('handles escaped quotes', () => {
        const rows = (0, extract_1.parseCsvText)('note\n"say ""hi"""\n');
        (0, vitest_1.expect)(rows).toContain('Row 2: say "hi"');
    });
    (0, vitest_1.it)('handles CRLF line endings', () => {
        const rows = (0, extract_1.parseCsvText)('a,b\r\n1,2\r\n');
        (0, vitest_1.expect)(rows).toContain('Row 2: 1 | 2');
    });
    (0, vitest_1.it)('marks truncated files', () => {
        const rows = (0, extract_1.parseCsvText)(`a,b\n${[1, 2, 3, 4, 5].join(',')}\n`.repeat(600));
        (0, vitest_1.expect)(rows).toContain('[ … remaining rows omitted … ]');
    });
});
(0, vitest_1.describe)('capText', () => {
    (0, vitest_1.it)('keeps short text untouched', () => {
        (0, vitest_1.expect)((0, extract_1.capText)('hello', 10)).toEqual({ text: 'hello', truncated: false });
    });
    (0, vitest_1.it)('truncates long text with a marker', () => {
        const { text, truncated } = (0, extract_1.capText)('x'.repeat(100), 10);
        (0, vitest_1.expect)(truncated).toBe(true);
        (0, vitest_1.expect)(text).toContain('truncated');
    });
});
(0, vitest_1.describe)('extractFile', () => {
    (0, vitest_1.it)('reads plain text files', () => {
        const p = write('note.txt', 'hello world\nsecond line');
        const result = (0, extract_1.extractFile)(p);
        (0, vitest_1.expect)(result.failed).toBe(false);
        (0, vitest_1.expect)(result.kind).toBe('text');
        (0, vitest_1.expect)(result.content).toContain('hello world');
    });
    (0, vitest_1.it)('parses csv files as a row grid', () => {
        const p = write('data.csv', 'a,b\n1,2\n');
        const result = (0, extract_1.extractFile)(p);
        (0, vitest_1.expect)(result.content).toContain('Row 1: a | b');
        (0, vitest_1.expect)(result.content).toContain('Row 2: 1 | 2');
    });
    (0, vitest_1.it)('extracts pdf text', () => {
        const p = write('doc.pdf', makePdf('BT (Extracted PDF text) Tj ET'));
        const result = (0, extract_1.extractFile)(p);
        (0, vitest_1.expect)(result.failed).toBe(false);
        (0, vitest_1.expect)(result.content).toContain('Extracted PDF text');
    });
    (0, vitest_1.it)('flags a scanned / textless PDF clearly', () => {
        const p = write('scan.pdf', Buffer.from('%PDF-1.4\n%%EOF\n', 'latin1'));
        const result = (0, extract_1.extractFile)(p);
        (0, vitest_1.expect)(result.failed).toBe(true);
        (0, vitest_1.expect)(result.content).toMatch(/no extractable text/i);
    });
    (0, vitest_1.it)('extracts xlsx cell text', () => {
        const sheet = '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row></sheetData></worksheet>';
        const p = write('book.xlsx', (0, zipFixture_1.miniXlsx)(['Cell'], sheet));
        const result = (0, extract_1.extractFile)(p);
        (0, vitest_1.expect)(result.failed).toBe(false);
        (0, vitest_1.expect)(result.content).toContain('Cell');
    });
    (0, vitest_1.it)('reports an unreadable xlsx clearly', () => {
        const p = write('bad.xlsx', Buffer.from('not a zip', 'utf8'));
        const result = (0, extract_1.extractFile)(p);
        (0, vitest_1.expect)(result.failed).toBe(true);
        (0, vitest_1.expect)(result.content).toMatch(/not a valid XLSX/i);
    });
    (0, vitest_1.it)('gives metadata plus a pixel note for images', () => {
        const p = write('photo.png', makePng(2, 3));
        const result = (0, extract_1.extractFile)(p);
        (0, vitest_1.expect)(result.kind).toBe('note');
        (0, vitest_1.expect)(result.content).toContain('PNG');
        (0, vitest_1.expect)(result.content).toContain('2 x 3px');
        (0, vitest_1.expect)(result.content).toMatch(/can't read image pixels/i);
    });
    (0, vitest_1.it)('fails clearly for unsupported types', () => {
        const p = write('file.docx', Buffer.from('pk', 'utf8'));
        const result = (0, extract_1.extractFile)(p);
        (0, vitest_1.expect)(result.failed).toBe(true);
        (0, vitest_1.expect)(result.content).toMatch(/unsupported file type/i);
    });
    (0, vitest_1.it)('fails clearly for a missing file', () => {
        const result = (0, extract_1.extractFile)((0, path_1.join)(dir, 'nope.pdf'));
        (0, vitest_1.expect)(result.failed).toBe(true);
        (0, vitest_1.expect)(result.content).toMatch(/file not found/i);
    });
});
