
import { registerTool } from './toolRegistry';
import { attachments } from '../db/db';
import { readFileSync, statSync, readdirSync } from 'fs';
import { join, extname, basename, normalize, isAbsolute } from 'path';
import { extractFile } from '../files/extract';

/**
 * EF-11: normalize a user-supplied attachment path before any fs access.
 * Windows evidence showed paths like `C:\Users\aradh\Downloads\random_sample.pdf`
 * arriving with surrounding quotes (drag-drop/picker serialization) or
 * file:/// URL wrapping — all of which made statSync fail with "Path does not
 * exist" even though the file was fine. Normalization is shared by the picker
 * path, the drag-and-drop path, and the LLM tool path so all three resolve
 * identically.
 */
export function normalizeAttachPath(input: unknown): string {
  if (typeof input !== 'string') return '';
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
      if (/^\/[A-Za-z]:\//.test(p)) p = p.slice(1);
    } catch {
      // fall through with the raw string
    }
  }
  if (!p) return '';
  // Normalize separators (forward slashes work on Windows, but collapse
  // redundant segments and trailing slashes consistently).
  try {
    p = normalize(p);
  } catch {
    // keep best-effort value
  }
  return p;
}

export function isAbsoluteAttachPath(p: string): boolean {
  try {
    return isAbsolute(p);
  } catch {
    return false;
  }
}

interface AttachFileParams {
  path: string;
}

function getFileSize(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

function getFolderSize(path: string): number {
  let total = 0;
  try {
    const entries = readdirSync(path, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(path, entry.name);
      if (entry.isFile()) {
        total += getFileSize(fullPath);
      } else if (entry.isDirectory()) {
        total += getFolderSize(fullPath);
      }
    }
  } catch {
    // ignore errors
  }
  return total;
}

function readTextFile(path: string): string {
  try {
    const content = readFileSync(path, 'utf-8');
    return content;
  } catch {
    return '';
  }
}

function readFolderContents(path: string, maxFiles = 50, maxTotalChars = 100000): { files: Array<{ path: string; content: string }>; truncated: boolean } {
  const files: Array<{ path: string; content: string }> = [];
  let totalChars = 0;
  let truncated = false;

  try {
    const entries = readdirSync(path, { withFileTypes: true });
    for (const entry of entries) {
      if (files.length >= maxFiles) {
        truncated = true;
        break;
      }
      const fullPath = join(path, entry.name);
      if (entry.isFile()) {
        const ext = extname(entry.name).toLowerCase();
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
  } catch {
    // ignore errors
  }

  return { files, truncated };
}

function buildSummary(kind: 'file' | 'folder', displayName: string, sizeBytes: number, details?: { files?: Array<{ path: string; content: string }>; truncated?: boolean }): string {
  const sizeKB = Math.round(sizeBytes / 1024);
  if (kind === 'file') {
    return `File: ${displayName} (${sizeKB} KB)`;
  } else {
    const fileCount = details?.files?.length ?? 0;
    const truncated = details?.truncated ? ' (truncated)' : '';
    return `Folder: ${displayName} (${fileCount} files, ${sizeKB} KB)${truncated}`;
  }
}

export interface IngestedAttachment {
  attachmentId: string;
  path: string;
  displayName: string;
  kind: 'file' | 'folder';
  sizeBytes: number;
  summary: string;
  content: string;
}

/**
 * EF-11: shared ingestion core. The "+" picker, drag-and-drop, and the LLM
 * `attach_file` tool all funnel through here, so a Windows path that works in
 * one path works in all of them. Returns specific errors (Step 2: surfaced at
 * the point of attachment, not discovered later inside an LLM call).
 */
export async function ingestAttachment(
  rawPath: unknown,
  conversationId: string
): Promise<{ success: true; attachment: IngestedAttachment } | { success: false; error: string }> {
  const path = normalizeAttachPath(rawPath);

  if (!path) {
    return { success: false, error: 'Path is required' };
  }
  if (!isAbsoluteAttachPath(path)) {
    return { success: false, error: `That path doesn't look absolute and can't be read safely: ${path}` };
  }

  let stats: ReturnType<typeof statSync>;
  try {
    stats = statSync(path);
  } catch {
    return { success: false, error: `Couldn't read that file — it doesn't exist or can't be accessed: ${path}` };
  }

  const isFolder = stats.isDirectory();
  const kind = isFolder ? 'folder' : 'file';
  const displayName = basename(path) || path;
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
  } else {
    const extracted = extractFile(path);
    if (extracted.failed) {
      contentSummary = `File: ${displayName} (${Math.round(sizeBytes / 1024)} KB) — failed to extract: ${extracted.content}`;
    } else if (extracted.kind === 'note') {
      contentSummary = `Binary file: ${displayName} (${Math.round(sizeBytes / 1024)} KB) — ${extracted.content}`;
    } else {
      contentForContext = extracted.content;
      contentSummary = buildSummary('file', displayName, sizeBytes);
    }
  }

  // Store attachment metadata
  const attachmentId = crypto.randomUUID();
  await attachments.create({
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

registerTool({
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
  handler: async (params: Record<string, unknown>) => {
    const conversationId = getActiveConversationId?.() ?? 'unknown';
    const outcome = await ingestAttachment(params.path, conversationId);
    if (!outcome.success) {
      return { success: false as const, error: (outcome as { success: false; error: string }).error };
    }
    const attachment = (outcome as { success: true; attachment: IngestedAttachment }).attachment;
    return {
      success: true as const,
      result: JSON.stringify(attachment),
    };
  },
});

// This will be set by the chat handlers when a turn starts
let getActiveConversationId: (() => string) | undefined;

export function setAttachFileConversationGetter(fn: () => string) {
  getActiveConversationId = fn;
}