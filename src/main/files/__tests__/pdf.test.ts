import { describe, expect, it } from 'vitest';
import { deflateSync } from 'zlib';
import { extractPdfText, pdfContentToText } from '../pdf';

function makePdf(contentStream: string, filter: 'flate' | 'none'): Buffer {
  const body = filter === 'flate' ? deflateSync(Buffer.from(contentStream, 'latin1')) : Buffer.from(contentStream, 'latin1');
  const filterTok = filter === 'flate' ? '/Filter /FlateDecode' : '';
  return Buffer.from(
    '%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n' +
      '2 0 obj\n<< /Type /Page /Parent 1 0 R /Contents 3 0 R >>\nendobj\n' +
      `3 0 obj\n<< /Length ${body.length} ${filterTok} >>\nstream\n${body.toString('latin1')}\nendstream\nendobj\n` +
      'trailer\n<< /Root 1 0 R >>\n%%EOF',
    'latin1'
  );
}

describe('pdfContentToText', () => {
  it('extracts Tj literals', () => {
    expect(pdfContentToText('BT /F1 12 Tf 72 720 Td (Hello World) Tj ET')).toContain('Hello World');
  });

  it('splits lines on text positioning operators', () => {
    const text = pdfContentToText('BT (Line one) Td (Line two) T* (Line three) ET');
    expect(text.split('\n')).toEqual(['Line one', 'Line two', 'Line three']);
  });

  it('concatenates TJ array pieces with a space', () => {
    expect(pdfContentToText('BT [(Hel) (lo) ( Wor) (ld)] TJ ET')).toContain('Hello World');
  });

  it('decodes escaped parentheses and backslashes', () => {
    expect(pdfContentToText('BT (A\\(B\\)C \\\\ ok) Tj ET')).toContain('A(B)C \\ ok');
  });

  it('handles nested parentheses', () => {
    expect(pdfContentToText('BT (outer (inner) end) Tj ET')).toContain('outer (inner) end');
  });
});

describe('extractPdfText', () => {
  it('extracts text from a flate-compressed content stream', () => {
    const result = extractPdfText(makePdf('BT (Hello from PDF) Tj ET', 'flate'));
    expect(result).toContain('Hello from PDF');
  });

  it('extracts text from an uncompressed content stream', () => {
    const result = extractPdfText(makePdf('BT (Plain text body) Tj ET', 'none'));
    expect(result).toContain('Plain text body');
  });

  it('ignores image streams (no /Subtype /Image handling of text)', () => {
    const imageStream = Buffer.from([0xde, 0xad, 0xbe, 0xef]);
    const pdf = Buffer.from(
      '4 0 obj\n<< /Subtype /Image /Width 1 /Height 1 /Filter /FlateDecode >>\nstream\n' +
        imageStream.toString('latin1') +
        '\nendstream\nendobj\n',
      'latin1'
    );
    expect(extractPdfText(pdf)).toBe('');
  });

  it('returns empty string when no text is present', () => {
    expect(extractPdfText(Buffer.from('not a pdf at all', 'latin1'))).toBe('');
  });
});