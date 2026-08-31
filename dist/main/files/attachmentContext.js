"use strict";
/**
 * Per-request attachment context.
 *
 * Reads attached files/folders for the current conversation, extracts their
 * content, and renders it as an extra system message for THIS turn only.
 * Nothing is persisted: the extracted text never lands in the conversation
 * history, so a later turn that does not reference the attachment gets no
 * attachment content.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildAttachmentContext = buildAttachmentContext;
const db_1 = require("../db/db");
const fs_1 = require("fs");
const path_1 = require("path");
const MAX_FILE_CHARS = 50000;
const MAX_TOTAL_CHARS = 100000;
function indent(value) {
    return value
        .split('\n')
        .map(line => `   ${line}`)
        .join('\n');
}
function readTextFile(path) {
    try {
        return (0, fs_1.readFileSync)(path, 'utf-8');
    }
    catch {
        return '';
    }
}
function getFolderFiles(path, maxFiles = 50) {
    const files = [];
    try {
        const entries = (0, fs_1.readdirSync)(path, { withFileTypes: true });
        for (const entry of entries) {
            if (files.length >= maxFiles)
                break;
            const fullPath = (0, path_1.join)(path, entry.name);
            if (entry.isFile()) {
                const ext = (0, path_1.extname)(entry.name).toLowerCase();
                const textExtensions = ['.txt', '.md', '.js', '.ts', '.jsx', '.tsx', '.json', '.html', '.css', '.py', '.rs', '.go', '.java', '.cpp', '.c', '.h', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf', '.sh', '.bat', '.ps1', '.sql', '.xml', '.csv', '.log'];
                if (textExtensions.includes(ext) || ext === '') {
                    const content = readTextFile(fullPath);
                    if (content) {
                        files.push({ path: entry.name, content });
                    }
                }
            }
        }
    }
    catch {
        // ignore errors
    }
    return files;
}
function buildAttachmentContext(conversationId) {
    const attachedFiles = db_1.attachments.getByConversation(conversationId);
    if (attachedFiles.length === 0) {
        return { contextBlock: null, attachmentIds: [] };
    }
    const sections = [];
    let budget = MAX_TOTAL_CHARS;
    const attachmentIds = [];
    for (const attachment of attachedFiles) {
        attachmentIds.push(attachment.id);
        const { original_path, display_name, size_bytes } = attachment;
        try {
            const stats = (0, fs_1.statSync)(original_path);
            const isFolder = stats.isDirectory();
            if (isFolder) {
                const files = getFolderFiles(original_path);
                const sizeKB = Math.round(size_bytes / 1024);
                let contentText = `Folder: ${display_name} (${files.length} files, ${sizeKB} KB)`;
                if (files.length > 0) {
                    for (const file of files) {
                        if (budget <= 0)
                            break;
                        const capped = file.content.slice(0, Math.min(MAX_FILE_CHARS, budget));
                        budget -= capped.length;
                        contentText += `\n\n=== ${file.path} ===\n${capped}`;
                    }
                }
                if (budget <= 0) {
                    contentText += '\n\n(truncated — budget exceeded)';
                }
                sections.push(contentText);
            }
            else {
                const ext = (0, path_1.extname)(display_name).toLowerCase();
                const textExtensions = ['.txt', '.md', '.js', '.ts', '.jsx', '.tsx', '.json', '.html', '.css', '.py', '.rs', '.go', '.java', '.cpp', '.c', '.h', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf', '.sh', '.bat', '.ps1', '.sql', '.xml', '.csv', '.log'];
                if (textExtensions.includes(ext) || ext === '') {
                    const content = readTextFile(original_path);
                    if (content) {
                        const capped = content.slice(0, Math.min(MAX_FILE_CHARS, budget));
                        budget -= capped.length;
                        const sizeKB = Math.round(size_bytes / 1024);
                        let contentText = `File: ${display_name} (${sizeKB} KB)`;
                        if (capped.length < content.length) {
                            contentText += ` (truncated)`;
                        }
                        contentText += `:\n${indent(capped)}`;
                        sections.push(contentText);
                    }
                    else {
                        sections.push(`- File ${display_name}: could not be read (empty or binary)`);
                    }
                }
                else {
                    sections.push(`- Binary file ${display_name} (${Math.round(size_bytes / 1024)} KB): content not included in context`);
                }
            }
        }
        catch (err) {
            sections.push(`- Attachment ${display_name}: could not be read — ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    const contextBlock = 'Files/folders the user attached to this conversation (content is included only for this turn — ' +
        'repeat it in your reply when you use it, since it will not be remembered):\n' +
        sections.join('\n\n');
    return { contextBlock, attachmentIds };
}
