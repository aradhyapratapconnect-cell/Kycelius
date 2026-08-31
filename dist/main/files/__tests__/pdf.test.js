"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const zlib_1 = require("zlib");
const pdf_1 = require("../pdf");
function makePdf(contentStream, filter) {
    const body = filter === 'flate' ? (0, zlib_1.deflateSync)(Buffer.from(contentStream, 'latin1')) : Buffer.from(contentStream, 'latin1');
    const filterTok = filter === 'flate' ? '/Filter /FlateDecode' : '';
    return Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n' +
        '2 0 obj\n<< /Type /Page /Parent 1 0 R /Contents 3 0 R >>\nendobj\n' +
        `3 0 obj\n<< /Length ${body.length} ${filterTok} >>\nstream\n${body.toString('latin1')}\nendstream\nendobj\n` +
        'trailer\n<< /Root 1 0 R >>\n%%EOF', 'latin1');
}
(0, vitest_1.describe)('pdfContentToText', () => {
    (0, vitest_1.it)('extracts Tj literals', () => {
        (0, vitest_1.expect)((0, pdf_1.pdfContentToText)('BT /F1 12 Tf 72 720 Td (Hello World) Tj ET')).toContain('Hello World');
    });
    (0, vitest_1.it)('splits lines on text positioning operators', () => {
        const text = (0, pdf_1.pdfContentToText)('BT (Line one) Td (Line two) T* (Line three) ET');
        (0, vitest_1.expect)(text.split('\n')).toEqual(['Line one', 'Line two', 'Line three']);
    });
    (0, vitest_1.it)('concatenates TJ array pieces with a space', () => {
        (0, vitest_1.expect)((0, pdf_1.pdfContentToText)('BT [(Hel) (lo) ( Wor) (ld)] TJ ET')).toContain('Hello World');
    });
    (0, vitest_1.it)('decodes escaped parentheses and backslashes', () => {
        (0, vitest_1.expect)((0, pdf_1.pdfContentToText)('BT (A\\(B\\)C \\\\ ok) Tj ET')).toContain('A(B)C \\ ok');
    });
    (0, vitest_1.it)('handles nested parentheses', () => {
        (0, vitest_1.expect)((0, pdf_1.pdfContentToText)('BT (outer (inner) end) Tj ET')).toContain('outer (inner) end');
    });
});
(0, vitest_1.describe)('extractPdfText', () => {
    (0, vitest_1.it)('extracts text from a flate-compressed content stream', () => {
        const result = (0, pdf_1.extractPdfText)(makePdf('BT (Hello from PDF) Tj ET', 'flate'));
        (0, vitest_1.expect)(result).toContain('Hello from PDF');
    });
    (0, vitest_1.it)('extracts text from an uncompressed content stream', () => {
        const result = (0, pdf_1.extractPdfText)(makePdf('BT (Plain text body) Tj ET', 'none'));
        (0, vitest_1.expect)(result).toContain('Plain text body');
    });
    (0, vitest_1.it)('ignores image streams (no /Subtype /Image handling of text)', () => {
        const imageStream = Buffer.from([0xde, 0xad, 0xbe, 0xef]);
        const pdf = Buffer.from('4 0 obj\n<< /Subtype /Image /Width 1 /Height 1 /Filter /FlateDecode >>\nstream\n' +
            imageStream.toString('latin1') +
            '\nendstream\nendobj\n', 'latin1');
        (0, vitest_1.expect)((0, pdf_1.extractPdfText)(pdf)).toBe('');
    });
    (0, vitest_1.it)('returns empty string when no text is present', () => {
        (0, vitest_1.expect)((0, pdf_1.extractPdfText)(Buffer.from('not a pdf at all', 'latin1'))).toBe('');
    });
});
