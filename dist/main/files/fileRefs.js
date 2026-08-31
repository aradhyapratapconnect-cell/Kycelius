"use strict";
/**
 * N-06 — File references ("@path" mentions)
 *
 * A user triggers content extraction for a single request by naming a local
 * file in their command with an `@` mention: "summarize @C:\docs\report.pdf".
 * Windows paths contain backslashes and may contain spaces, so a mention is
 * either a quoted path (`@"..."` or `@'...'`) or a bare token that ends at
 * whitespace or sentence punctuation.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.findFileRefs = findFileRefs;
exports.stripFileRefs = stripFileRefs;
const FILE_MENTION_RE = /@\s*(?:"([^"]*)"|'([^']*)'|([^\s,;!?'"()]+))/g;
/** Extensions the pipeline is able to read (document + image types). */
const KNOWN_EXTS = new Set([
    'pdf', 'xlsx', 'csv', 'txt', 'md', 'json', 'log',
    'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp',
]);
/**
 * A bare mention is only accepted when it actually looks like a file: it
 * contains a path separator, or ends with a known read-able extension. This
 * stops `sam@example.com` (or plain words) from being treated as a file
 * reference while still accepting `@report.pdf`. Quoted mentions are always
 * taken literally.
 */
function looksLikePath(path) {
    if (/[\\/]/.test(path))
        return true;
    const ext = path.toLowerCase().replace(/^.*\./, '');
    return KNOWN_EXTS.has(ext);
}
/** Finds every `@path` mention in a command. */
function findFileRefs(text) {
    const refs = [];
    const source = String(text ?? '');
    let match;
    FILE_MENTION_RE.lastIndex = 0;
    while ((match = FILE_MENTION_RE.exec(source))) {
        let path = (match[1] ?? match[2] ?? match[3] ?? '').trim();
        if (path.length === 0)
            continue;
        const quoted = match[1] !== undefined || match[2] !== undefined;
        if (!quoted) {
            // A bare token may pick up the sentence's final period: "@report.pdf."
            if (path.endsWith('.'))
                path = path.slice(0, -1);
            if (!looksLikePath(path))
                continue;
        }
        refs.push({ token: match[0], path });
    }
    return refs;
}
/**
 * Removes every accepted mention from the command so the LLM sees the
 * instruction without the raw path token (the extracted content is attached
 * separately). Only mentions that actually resolved as file references are
 * stripped, so an email like "write to sam@example.com" is left intact.
 */
function stripFileRefs(text) {
    let out = String(text ?? '');
    for (const ref of findFileRefs(out)) {
        out = out.split(ref.token).join('');
    }
    return out
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/ +([.,;:!?])/g, '$1')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}
