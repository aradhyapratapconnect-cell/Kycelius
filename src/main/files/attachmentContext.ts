/**
 * Per-request attachment context.
 *
 * Reads attached files/folders for the current conversation, extracts their
 * content, and renders it as an extra system message for THIS turn only.
 * Nothing is persisted: the extracted text never lands in the conversation
 * history, so a later turn that does not reference the attachment gets no
 * attachment content.
 */

import { attachments } from '../db/db';
import { statSync, readdirSync } from 'fs';
import { readFileSync } from 'fs';
import { join, extname } from 'path';
import { extractFile } from './extract';

const MAX_FILE_CHARS = 50000;
const MAX_TOTAL_CHARS = 100000;

export interface AttachmentContext {
  contextBlock: string | null;
  attachmentIds: string[];
}

function indent(value: string): string {
  return value
    .split('\n')
    .map(line => `   ${line}`)
    .join('\n');
}

function readTextFile(path: string): string {
  try {
    return readFileSync(path, 'utf-8');
  } catch {
    return '';
  }
}


function getFolderFiles(path: string, maxFiles = 50): Array<{ path: string; content: string }> {
  const files: Array<{ path: string; content: string }> = [];
  try {
    const entries = readdirSync(path, { withFileTypes: true });
    for (const entry of entries) {
      if (files.length >= maxFiles) break;
      const fullPath = join(path, entry.name);
      if (entry.isFile()) {
        const ext = extname(entry.name).toLowerCase();
        const textExtensions = ['.txt', '.md', '.js', '.ts', '.jsx', '.tsx', '.json', '.html', '.css', '.py', '.rs', '.go', '.java', '.cpp', '.c', '.h', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf', '.sh', '.bat', '.ps1', '.sql', '.xml', '.csv', '.log'];
        if (textExtensions.includes(ext) || ext === '') {
          const content = readTextFile(fullPath);
          if (content) {
            files.push({ path: entry.name, content });
          }
        }
      }
    }
  } catch {
    // ignore errors
  }
  return files;
}

export function buildAttachmentContext(conversationId: string): AttachmentContext {
  const attachedFiles = attachments.getByConversation(conversationId);
  if (attachedFiles.length === 0) {
    return { contextBlock: null, attachmentIds: [] };
  }

  const sections: string[] = [];
  let budget = MAX_TOTAL_CHARS;
  const attachmentIds: string[] = [];

  for (const attachment of attachedFiles) {
    attachmentIds.push(attachment.id);
    const { original_path, display_name, size_bytes } = attachment;

    try {
      const stats = statSync(original_path);
      const isFolder = stats.isDirectory();

      if (isFolder) {
        const files = getFolderFiles(original_path);
        const sizeKB = Math.round(size_bytes / 1024);
        let contentText = `Folder: ${display_name} (${files.length} files, ${sizeKB} KB)`;
        
        if (files.length > 0) {
          for (const file of files) {
            if (budget <= 0) break;
            const capped = file.content.slice(0, Math.min(MAX_FILE_CHARS, budget));
            budget -= capped.length;
            contentText += `\n\n=== ${file.path} ===\n${capped}`;
          }
        }
        
        if (budget <= 0) {
          contentText += '\n\n(truncated — budget exceeded)';
        }
        
        sections.push(contentText);
      } else {
        const extracted = extractFile(original_path, { maxBytes: budget });
        if (extracted.failed) {
          sections.push(`- File ${display_name}: could not be read (${extracted.content})`);
        } else if (extracted.kind === 'note') {
          sections.push(`- Binary file ${display_name} (${Math.round(size_bytes / 1024)} KB): ${extracted.content}`);
        } else {
          const content = extracted.content;
          const capped = content.slice(0, Math.min(MAX_FILE_CHARS, budget));
          budget -= capped.length;
          const sizeKB = Math.round(size_bytes / 1024);
          let contentText = `File: ${display_name} (${sizeKB} KB)`;
          if (capped.length < content.length || extracted.truncated) {
            contentText += ` (truncated)`;
          }
          contentText += `:\n${indent(capped)}`;
          sections.push(contentText);
        }
      }
    } catch (err) {
      sections.push(`- Attachment ${display_name}: could not be read — ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const contextBlock =
    'Files/folders the user attached to this conversation (content is included only for this turn — ' +
    'repeat it in your reply when you use it, since it will not be remembered):\n' +
    sections.join('\n\n');

  return { contextBlock, attachmentIds };
}