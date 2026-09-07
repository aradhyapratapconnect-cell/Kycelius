"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeAttachPath = normalizeAttachPath;
exports.isAbsoluteAttachPath = isAbsoluteAttachPath;
exports.ingestAttachment = ingestAttachment;
exports.setAttachFileConversationGetter = setAttachFileConversationGetter;
const toolRegistry_1 = require("./toolRegistry");
const db_1 = require("../db/db");
const fs_1 = require("fs");
const path_1 = require("path");
const extract_1 = require("../files/extract");
/**
 * EF-11: normalize a user-supplied attachment path before any fs access.
 * Windows evidence showed paths like `C:\Users\aradh\Downloads\random_sample.pdf`
 * arriving with surrounding quotes (drag-drop/picker serialization) or
 * file:/// URL wrapping — all of which made statSync fail with "Path does not
 * exist" even though the file was fine. Normalization is shared by the picker
 * path, the drag-and-drop path, and the LLM tool path so all three resolve
 * identically.
 */
function normalizeAttachPath(input) {
    if (typeof input !== 'string')
        return '';
    let p = input.trim();
    // Strip a single layer of surrounding quotes.
    if (p.length >= 2) {
        const first = p[0];
        const last = p[p.length - 1];
        if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
            p = p.slice(1, -1).trim();
        }
    }
    // Unwrap file:/// URLs to plain paths.
    if (/^file:\/\/\//i.test(p)) {
        try {
            p = decodeURI(new URL(p).pathname);
            // URL pathname on Windows yields /C:/... — strip the leading slash.
            if (/^\/[A-Za-z]:\//.test(p))
                p = p.slice(1);
        }
        catch {
            // fall through with the raw string
        }
    }
    if (!p)
        return '';
    // Normalize separators (forward slashes work on Windows, but collapse
    // redundant segments and trailing slashes consistently).
    try {
        p = (0, path_1.normalize)(p);
    }
    catch {
        // keep best-effort value
    }
    return p;
}
function isAbsoluteAttachPath(p) {
    try {
        return (0, path_1.isAbsolute)(p);
    }
    catch {
        return false;
    }
}
function getFileSize(path) {
    try {
        return (0, fs_1.statSync)(path).size;
    }
    catch {
        return 0;
    }
}
function getFolderSize(path) {
    let total = 0;
    try {
        const entries = (0, fs_1.readdirSync)(path, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = (0, path_1.join)(path, entry.name);
            if (entry.isFile()) {
                total += getFileSize(fullPath);
            }
            else if (entry.isDirectory()) {
                total += getFolderSize(fullPath);
            }
        }
    }
    catch {
        // ignore errors
    }
    return total;
}
function readTextFile(path) {
    try {
        const content = (0, fs_1.readFileSync)(path, 'utf-8');
        return content;
    }
    catch {
        return '';
    }
}
function readFolderContents(path, maxFiles = 50, maxTotalChars = 100000) {
    const files = [];
    let totalChars = 0;
    let truncated = false;
    try {
        const entries = (0, fs_1.readdirSync)(path, { withFileTypes: true });
        for (const entry of entries) {
            if (files.length >= maxFiles) {
                truncated = true;
                break;
            }
            const fullPath = (0, path_1.join)(path, entry.name);
            if (entry.isFile()) {
                const ext = (0, path_1.extname)(entry.name).toLowerCase();
                // Only read text-like files
                const textExtensions = ['.txt', '.md', '.js', '.ts', '.jsx', '.tsx', '.json', '.html', '.css', '.py', '.rs', '.go', '.java', '.cpp', '.c', '.h', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf', '.sh', '.bat', '.ps1', '.sql', '.xml', '.csv', '.log'];
                if (textExtensions.includes(ext) || ext === '') {
                    const content = readTextFile(fullPath);
                    if (content) {
                        if (totalChars + content.length > maxTotalChars) {
                            truncated = true;
                            break;
                        }
                        files.push({ path: entry.name, content });
                        totalChars += content.length;
                    }
                }
            }
        }
    }
    catch {
        // ignore errors
    }
    return { files, truncated };
}
function buildSummary(kind, displayName, sizeBytes, details) {
    const sizeKB = Math.round(sizeBytes / 1024);
    if (kind === 'file') {
        return `File: ${displayName} (${sizeKB} KB)`;
    }
    else {
        const fileCount = details?.files?.length ?? 0;
        const truncated = details?.truncated ? ' (truncated)' : '';
        return `Folder: ${displayName} (${fileCount} files, ${sizeKB} KB)${truncated}`;
    }
}
/**
 * EF-11: shared ingestion core. The "+" picker, drag-and-drop, and the LLM
 * `attach_file` tool all funnel through here, so a Windows path that works in
 * one path works in all of them. Returns specific errors (Step 2: surfaced at
 * the point of attachment, not discovered later inside an LLM call).
 */
async function ingestAttachment(rawPath, conversationId) {
    const path = normalizeAttachPath(rawPath);
    if (!path) {
        return { success: false, error: 'Path is required' };
    }
    if (!isAbsoluteAttachPath(path)) {
        return { success: false, error: `That path doesn't look absolute and can't be read safely: ${path}` };
    }
    let stats;
    try {
        stats = (0, fs_1.statSync)(path);
    }
    catch {
        return { success: false, error: `Couldn't read that file — it doesn't exist or can't be accessed: ${path}` };
    }
    const isFolder = stats.isDirectory();
    const kind = isFolder ? 'folder' : 'file';
    const displayName = (0, path_1.basename)(path) || path;
    const sizeBytes = isFolder ? getFolderSize(path) : stats.size;
    // Read content for context injection
    let contentSummary = '';
    let contentForContext = '';
    if (isFolder) {
        const result = readFolderContents(path);
        contentSummary = buildSummary('folder', displayName, sizeBytes, result);
        if (result.files.length > 0) {
            contentForContext = result.files.map(f => `=== ${f.path} ===\n${f.content}`).join('\n\n');
        }
    }
    else {
        const extracted = (0, extract_1.extractFile)(path);
        if (extracted.failed) {
            contentSummary = `File: ${displayName} (${Math.round(sizeBytes / 1024)} KB) — failed to extract: ${extracted.content}`;
        }
        else if (extracted.kind === 'note') {
            contentSummary = `Binary file: ${displayName} (${Math.round(sizeBytes / 1024)} KB) — ${extracted.content}`;
        }
        else {
            contentForContext = extracted.content;
            contentSummary = buildSummary('file', displayName, sizeBytes);
        }
    }
    // Store attachment metadata
    const attachmentId = crypto.randomUUID();
    await db_1.attachments.create({
        id: attachmentId,
        conversation_id: conversationId,
        original_path: path,
        display_name: displayName,
        kind,
        size_bytes: sizeBytes,
        ingested_content_summary: contentSummary,
    });
    return {
        success: true,
        attachment: {
            attachmentId,
            path,
            displayName,
            kind,
            sizeBytes,
            summary: contentSummary,
            content: contentForContext,
        },
    };
}
(0, toolRegistry_1.registerTool)({
    name: 'attach_file',
    description: 'Read a user-provided file or folder into the current conversation context. The user explicitly provides this via drag-and-drop or the attach button. Content is read fresh from disk each time, not stored in the database.',
    parameters: {
        type: 'object',
        properties: {
            path: { type: 'string', description: 'Absolute path to the file or folder to attach' },
        },
        required: ['path'],
    },
    permissionTier: 'auto',
    handler: async (params) => {
        const conversationId = getActiveConversationId?.() ?? 'unknown';
        const outcome = await ingestAttachment(params.path, conversationId);
        if (!outcome.success) {
            return { success: false, error: outcome.error };
        }
        const attachment = outcome.attachment;
        return {
            success: true,
            result: JSON.stringify(attachment),
        };
    },
});
// This will be set by the chat handlers when a turn starts
let getActiveConversationId;
function setAttachFileConversationGetter(fn) {
    getActiveConversationId = fn;
}
