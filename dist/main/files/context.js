"use strict";
/**
 * N-06 — Per-request file context.
 *
 * Reads every `@path` mention out of a command, extracts the referenced
 * file's content, and renders it as an extra system message for THIS turn
 * only. Nothing is persisted: the extracted text never lands in the
 * conversation history, so a later turn that does not reference the file
 * gets no file content (AC2).
 *
 * Failures are never silent — a missing/unsupported/unreadable file yields a
 * notice telling the model to explain the problem plainly (AC3), and a cap
 * on total injected characters keeps the context window safe.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildFileContext = buildFileContext;
const fileRefs_1 = require("./fileRefs");
const extract_1 = require("./extract");
function indent(value) {
    return value
        .split('\n')
        .map(line => `   ${line}`)
        .join('\n');
}
function buildFileContext(userText) {
    const refs = (0, fileRefs_1.findFileRefs)(userText);
    if (refs.length === 0) {
        return { cleanUserText: String(userText ?? ''), contextBlock: null };
    }
    const cleanUserText = (0, fileRefs_1.stripFileRefs)(userText);
    const sections = [];
    let budget = extract_1.MAX_TOTAL_CHARS;
    for (const ref of refs) {
        const extracted = (0, extract_1.extractFile)(ref.path);
        if (extracted.failed) {
            sections.push(`- Referenced file "${ref.path}": could not be read — ${extracted.content}. Tell the user this clearly.`);
            continue;
        }
        if (extracted.kind === 'note' || extracted.content.trim().length === 0) {
            sections.push(`- Referenced file ${extracted.name}:\n${indent(extracted.content)}`);
            continue;
        }
        const capped = (0, extract_1.capText)(extracted.content, Math.min(extract_1.MAX_FILE_CHARS, budget));
        budget -= capped.text.length;
        const marker = capped.truncated ? ' (truncated — only the first part is included)' : '';
        sections.push(`- Referenced file ${extracted.name}${marker}:\n${indent(capped.text)}`);
    }
    const contextBlock = 'Files the user referenced in this request and asked you to work with (content is included only for this turn — ' +
        'repeat it in your reply when you use it, since it will not be remembered):\n' +
        sections.join('\n');
    return { cleanUserText, contextBlock };
}
