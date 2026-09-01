"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setAttachFileConversationGetter = setAttachFileConversationGetter;
const toolRegistry_1 = require("./toolRegistry");
const db_1 = require("../db/db");
const fs_1 = require("fs");
const path_1 = require("path");
const extract_1 = require("../files/extract");
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
        const path = params.path;
        if (!path || typeof path !== 'string') {
            return { success: false, error: 'Path is required' };
        }
        // Validate path exists
        try {
            (0, fs_1.statSync)(path);
        }
        catch {
            return { success: false, error: `Path does not exist: ${path}` };
        }
        const stats = (0, fs_1.statSync)(path);
        const isFolder = stats.isDirectory();
        const kind = isFolder ? 'folder' : 'file';
        const displayName = (0, path_1.basename)(path);
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
        const conversationId = getActiveConversationId?.() ?? 'unknown'; // Will be set by caller
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
            result: JSON.stringify({
                attachmentId,
                path,
                displayName,
                kind,
                sizeBytes,
                summary: contentSummary,
                content: contentForContext, // For context injection
            }),
        };
    },
});
// This will be set by the chat handlers when a turn starts
let getActiveConversationId;
function setAttachFileConversationGetter(fn) {
    getActiveConversationId = fn;
}
