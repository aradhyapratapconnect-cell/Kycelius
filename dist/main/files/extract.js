"use strict";
/**
 * N-06 — File extraction orchestrator.
 *
 * A referenced local file (via `@path` in a command) is read and turned into
 * a text block that rides along for that one request:
 *   - text formats (txt/md/json/log/csv) are read as-is;
 *   - PDFs go through the zero-dep extractor (`pdf.ts`);
 *   - spreadsheets (.xlsx) go through the minimal ZIP/XML scraper (`xlsx.ts`);
 *   - images resolve to metadata + an explicit pixel-content note (`image.ts`);
 *   - anything else fails with a clear message rather than a silent no-op.
 *
 * Output is capped so a giant document can never blow up the context window;
 * the LLM is told when content was truncated.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_CSV_ROWS = exports.MAX_TOTAL_CHARS = exports.MAX_FILE_CHARS = void 0;
exports.capText = capText;
exports.parseCsvText = parseCsvText;
exports.extractFile = extractFile;
const fs_1 = require("fs");
const path_1 = require("path");
const pdf_1 = require("./pdf");
const xlsx_1 = require("./xlsx");
const image_1 = require("./image");
/** Anything larger than this is refused outright to protect the process. */
const MAX_BYTES = 100 * 1024 * 1024;
exports.MAX_FILE_CHARS = 15000;
exports.MAX_TOTAL_CHARS = 30000;
exports.MAX_CSV_ROWS = 500;
const TEXT_EXTS = new Set(['.txt', '.md', '.json', '.log', '.csv']);
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp']);
function basenameOf(path) {
    try {
        return (0, path_1.basename)(path);
    }
    catch {
        return path;
    }
}
/** Trims a text block to `cap` characters with a truncation marker. */
function capText(text, cap) {
    if (text.length <= cap)
        return { text, truncated: false };
    const kept = text.slice(0, cap).trimEnd();
    return { text: `${kept}\n[… truncated — remaining content omitted to fit the request context …]`, truncated: true };
}
/**
 * Parses CSV text (RFC-ish: quoted fields, escaped quotes, optional trailing
 * newline) into printable rows. Returns '' when there is nothing readable.
 */
function parseCsvText(text) {
    if (text.includes('\0'))
        return '';
    const source = text.replace(/^\ufeff/, '');
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    let i = 0;
    const flushField = () => {
        row.push(field.trim());
        field = '';
    };
    while (i < source.length && rows.length <= exports.MAX_CSV_ROWS) {
        const ch = source[i];
        if (inQuotes) {
            if (ch === '"') {
                if (source[i + 1] === '"') {
                    field += '"';
                    i += 2;
                    continue;
                }
                inQuotes = false;
            }
            else {
                field += ch;
            }
        }
        else if (ch === '"') {
            inQuotes = true;
        }
        else if (ch === ',') {
            flushField();
        }
        else if (ch === '\r') {
            if (source[i + 1] === '\n')
                i++;
            flushField();
            rows.push(row);
            row = [];
        }
        else if (ch === '\n') {
            flushField();
            rows.push(row);
            row = [];
        }
        else {
            field += ch;
        }
        i++;
    }
    if (row.length > 0 || field !== '') {
        flushField();
        rows.push(row);
    }
    if (rows.length === 0)
        return '';
    const truncated = i < source.length;
    const lines = rows.slice(0, exports.MAX_CSV_ROWS).map((cells, idx) => {
        return cells.length > 0 ? `Row ${idx + 1}: ${cells.join(' | ')}` : `Row ${idx + 1}: (empty row)`;
    });
    if (truncated)
        lines.push('[ … remaining rows omitted … ]');
    return lines.join('\n');
}
/** Extraction per file extension; never throws. */
function extractFile(absPath, options) {
    const name = basenameOf(absPath);
    const fail = (reason) => ({
        name,
        path: absPath,
        kind: 'text',
        content: reason,
        truncated: false,
        failed: true,
    });
    let stat;
    try {
        stat = (0, fs_1.statSync)(absPath);
    }
    catch {
        return fail(`file not found: ${absPath}`);
    }
    if (!stat.isFile()) {
        return fail(`${absPath} is not a file`);
    }
    const byteLimit = options?.maxBytes ?? MAX_BYTES;
    if (stat.size > byteLimit) {
        return fail(`file is too large to read (${Math.round(stat.size / (1024 * 1024))} MB > ${Math.round(byteLimit / (1024 * 1024))} MB)`);
    }
    const raw = (0, fs_1.readFileSync)(absPath);
    const ext = (0, path_1.extname)(absPath).toLowerCase();
    if (TEXT_EXTS.has(ext)) {
        const text = parseCsvOrPlain(raw.toString('utf8'), ext);
        return {
            name,
            path: absPath,
            kind: 'text',
            content: text,
            truncated: false,
            failed: false,
        };
    }
    if (ext === '.pdf') {
        const extracted = (0, pdf_1.extractPdfText)(raw);
        if (extracted.length === 0) {
            return fail('no extractable text found (the PDF may be scanned/image-only or password-protected)');
        }
        return { name, path: absPath, kind: 'text', content: extracted, truncated: false, failed: false };
    }
    if (ext === '.xlsx') {
        try {
            const extracted = (0, xlsx_1.extractXlsxText)(raw);
            if (extracted.length === 0) {
                return fail('no readable cells found in the spreadsheet');
            }
            return { name, path: absPath, kind: 'text', content: extracted, truncated: false, failed: false };
        }
        catch (err) {
            return fail(err instanceof xlsx_1.XlsxParseError ? err.message : `not a valid XLSX: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    if (IMAGE_EXTS.has(ext)) {
        const meta = (0, image_1.extractImageMetadata)(raw);
        return {
            name,
            path: absPath,
            kind: 'note',
            content: (0, image_1.describeImageMetadata)(meta),
            truncated: false,
            failed: false,
        };
    }
    return fail(`unsupported file type "${ext || '(no extension)'}" — Kyclius can read PDF, XLSX, CSV and plain text (txt/md/json/log) files`);
}
function parseCsvOrPlain(text, ext) {
    if (ext !== '.csv')
        return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
    const rows = parseCsvText(text);
    return rows.length > 0 ? rows : '(empty CSV)';
}
