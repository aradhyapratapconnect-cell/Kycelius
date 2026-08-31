/**
 * N-06 — Zero-dependency PDF text extraction.
 *
 * PDFs are scanned for `stream ... endstream` objects; streams whose object
 * dictionary names `/FlateDecode` are inflated with Node's built-in `zlib`.
 * Display text is then recovered from the resulting content streams by
 * reading parenthesized string literals (the operands of `Tj` / `TJ`, and
 * plain strings between text-positioning operators).
 *
 * This is deliberately a CLI-grade extractor: it captures extractable text
 * from ordinary text-based PDFs and fails cleanly (returns nothing / a
 * message) for scanned or exotic files. It never renders layout.
 */

import { inflateSync } from 'zlib';

function findStreams(source: string): string[] {
  const streams: string[] = [];
  let index = 0;
  while (index < source.length) {
    const streamAt = source.indexOf('stream', index);
    if (streamAt === -1) break;

    let dataStart = streamAt + 'stream'.length;
    while (dataStart < source.length && (source[dataStart] === '\r' || source[dataStart] === '\n')) {
      dataStart++;
    }
    const dataEnd = source.indexOf('endstream', dataStart);
    if (dataEnd === -1) break;

    const preceding = source.slice(Math.max(0, streamAt - 4096), streamAt);
    const isFlate = /\/Filter\s*\[?[^\]]*\/FlateDecode|\/Fl($|[^A-Za-z])/.test(preceding);
    const isImage = /\/Subtype\s*\/Image/.test(preceding);

    const raw = source.slice(dataStart, dataEnd);
    if (isFlate && !isImage) {
      try {
        streams.push(inflateSync(Buffer.from(raw, 'latin1')).toString('latin1'));
      } catch {
        // Corrupt/rejected streams are skipped; the file may still yield text.
      }
    } else {
      streams.push(raw);
    }
    index = dataEnd + 'endstream'.length;
  }
  return streams;
}

function cleanOutput(text: string): string {
  const printable = text
    .split('')
    .filter(ch => {
      const code = ch.charCodeAt(0);
      return code >= 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;
    })
    .join('');
  return printable
    .replace(/[ \t]{2,}/g, ' ')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .join('\n')
    .trim();
}

/**
 * Reads text out of one inflated/uncompressed content stream. String
 * literals accumulate into the current line; the common positioning
 * operators (`Td`, `TD`, `T*`, `Tm`) start a new line.
 */
export function pdfContentToText(content: string): string {
  let result = '';
  let currentLine = '';
  let i = 0;
  const n = content.length;

  const flushLine = () => {
    const trimmed = currentLine.trim();
    if (trimmed.length > 0) result += trimmed + '\n';
    currentLine = '';
  };

  while (i < n) {
    const ch = content[i];
    if (ch === '(') {
      // Parenthesized literal (may nest and contains escapes).
      i++;
      let depth = 1;
      let buffer = '';
      while (i < n && depth > 0) {
        const c = content[i];
        if (c === '\\') {
          const next = content[i + 1];
          if (next === 'n') buffer += '\n';
          else if (next === 'r') buffer += '\r';
          else if (next === 't') buffer += '\t';
          else if (next === '(' || next === ')' || next === '\\') buffer += next;
          else if (next >= '0' && next <= '7') {
            let octal = '';
            while (i + 1 < n && /[0-7]/.test(content[i + 1]) && octal.length < 3) {
              octal += content[i + 1];
              i++;
            }
            buffer += String.fromCharCode(parseInt(octal, 8));
          } else {
            buffer += next ?? '';
          }
          i += 2;
          continue;
        }
        if (c === '(') depth++;
        else if (c === ')') {
          depth--;
          if (depth === 0) {
            i++;
            break;
          }
        }
        buffer += c;
        i++;
      }
      currentLine += buffer;
    } else if (ch === '\\') {
      i += 2;
    } else if (ch === ')' || ch === ']' || ch === '[') {
      i++;
    } else if (ch === 'T' && /^T[dD*]|^Tm/.test(content.slice(i, i + 2))) {
      flushLine();
      i += 2;
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && content[i + 1] === '\n') i++;
      flushLine();
      i++;
    } else {
      // Operator names, numeric operands and the whitespace between tokens
      // are all dropped. Inter-literal whitespace is token separation, not
      // text — visible spaces are encoded inside literals like `(Hello )`,
      // which keeps simple word spacing intact without inventing gaps.
      i++;
    }
  }
  flushLine();
  return cleanOutput(result);
}

/** Extracts display text from a raw PDF buffer; '' if none can be found. */
export function extractPdfText(buffer: Buffer): string {
  const source = buffer.toString('latin1');
  const streams = findStreams(source);
  let out = '';
  for (const stream of streams) {
    out += pdfContentToText(stream) + '\n';
  }
  return cleanOutput(out);
}