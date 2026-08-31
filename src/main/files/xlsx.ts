/**
 * N-06 — Zero-dependency XLSX text extraction.
 *
 * A real XLSX is a ZIP of XML parts. Rather than pulling in a zip/XML
 * library, this module reads the file's central directory manually, inflates
 * the entries with Node's `zlib`, and scrapes cell text from
 * `xl/sharedStrings.xml` + `xl/worksheets/sheetN.xml`. Output is one compact
 * "row grid" per sheet — enough for the LLM to grasp tabular content without
 * any rich-cell fidelity (formulas, styles and numbers are dropped except for
 * their stored text/values).
 */

import { inflateRawSync } from 'zlib';

const EOCD_SIG = 0x06054b50;
const CD_SIG = 0x02014b50;

export class XlsxParseError extends Error {}

interface ZipLocator {
  totalEntries: number;
  cdOffset: number;
}

/** Finds the End Of Central Directory record by scanning the tail of a ZIP. */
function locateEocd(buffer: Buffer): ZipLocator {
  const start = Math.max(0, buffer.length - 22 - 65535);
  for (let i = buffer.length - 22; i >= start; i--) {
    if (
      buffer.readUInt32LE(i) === EOCD_SIG &&
      buffer.readUInt16LE(i + 4) === 0 // single-disk archive
    ) {
      return {
        totalEntries: buffer.readUInt16LE(i + 10),
        cdOffset: buffer.readUInt32LE(i + 16),
      };
    }
  }
  throw new XlsxParseError('not a valid XLSX: no end-of-central-directory record');
}

/** Reads every central-directory entry name -> inflated data. */
function readZip(buffer: Buffer): Map<string, Buffer> {
  const { totalEntries, cdOffset } = locateEocd(buffer);
  const entries = new Map<string, Buffer>();
  let p = cdOffset;
  for (let e = 0; e < totalEntries; e++) {
    if (buffer.readUInt32LE(p) !== CD_SIG) {
      throw new XlsxParseError('not a valid XLSX: corrupt central directory');
    }
    const method = buffer.readUInt16LE(p + 10);
    const compSize = buffer.readUInt32LE(p + 20);
    const nameLen = buffer.readUInt16LE(p + 28);
    const extraLen = buffer.readUInt16LE(p + 30);
    const commentLen = buffer.readUInt16LE(p + 32);
    const lfhOffset = buffer.readUInt32LE(p + 42);
    const name = buffer.toString('utf8', p + 46, p + 46 + nameLen);

    const lnameLen = buffer.readUInt16LE(lfhOffset + 26);
    const lextraLen = buffer.readUInt16LE(lfhOffset + 28);
    const dataStart = lfhOffset + 30 + lnameLen + lextraLen;
    const compressed = buffer.subarray(dataStart, dataStart + compSize);

    let data: Buffer;
    if (method === 0) data = Buffer.from(compressed);
    else if (method === 8) data = inflateRawSync(compressed);
    else {
      throw new XlsxParseError(`not a valid XLSX: unsupported zip method ${method}`);
    }
    entries.set(name, data);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function decodeXml(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function extractCellText(xml: string, sharedStrings: string[]): string[] {
  const cells: string[] = [];
  const sharedCell = /<c\b([^>]*?)>([\s\S]*?)<\/c>|(<c\b[^>]*?\/>)/g;
  let match: RegExpExecArray | null;
  while ((match = sharedCell.exec(xml))) {
    const attrs = match[1] ?? '';
    const type = /t="([^"]*)"/.exec(attrs)?.[1] ?? 'n';
    const body = match[2] ?? '';
    const value = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? '';
    let text = '';
    if (type === 's') {
      const index = Number(value);
      text = Number.isInteger(index) && index >= 0 ? sharedStrings[index] ?? '' : '';
    } else if (type === 'inlineStr') {
      text = decodeXml(/<t\b[^>]*>([\s\S]*?)<\/t>/.exec(body)?.[1] ?? '');
    } else {
      text = decodeXml(value);
    }
    cells.push(text.trim());
  }
  return cells;
}

/** Extracts a readable row grid from an XLSX buffer. */
export function extractXlsxText(buffer: Buffer): string {
  let entries: Map<string, Buffer>;
  try {
    entries = readZip(buffer);
  } catch (err) {
    if (err instanceof XlsxParseError) throw err;
    throw new XlsxParseError(`not a valid XLSX: ${err instanceof Error ? err.message : String(err)}`);
  }

  const sharedXml = entries.get('xl/sharedStrings.xml');
  const sharedStrings: string[] = [];
  if (sharedXml) {
    const src = sharedXml.toString('utf8');
    const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
    let si: RegExpExecArray | null;
    while ((si = siRe.exec(src))) {
      const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
      let text = '';
      let t: RegExpExecArray | null;
      while ((t = tRe.exec(si[1]))) text += t[1];
      sharedStrings.push(decodeXml(text));
    }
  }

  const sheetNames = [...entries.keys()]
    .filter(name => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
    .sort((a, b) => {
      const na = Number(a.match(/sheet(\d+)/)?.[1] ?? 0);
      const nb = Number(b.match(/sheet(\d+)/)?.[1] ?? 0);
      return na - nb;
    });

  const blocks: string[] = [];
  for (const sheetName of sheetNames) {
    const xml = entries.get(sheetName)!.toString('utf8');
    const rows: string[] = [];
    const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
    let row: RegExpExecArray | null;
    while ((row = rowRe.exec(xml))) {
      const cells = extractCellText(row[1], sharedStrings);
      rows.push(cells.join(' | '));
    }
    const label = sheetName.replace(/^xl\/worksheets\//, '').replace(/\.xml$/, '');
    blocks.push(`${label}:\n${rows.join('\n')}`);
  }

  return blocks.join('\n\n').trim();
}