/**
 * T-06 — Tool: Create File
 *
 * Creates a new file with the given content at a specified or sensible
 * default path. Writes are scoped to the Kyclius folder under the OS
 * Documents directory: relative `path` values resolve inside it and absolute
 * paths must stay within it, so path traversal can never escape that root
 * while the tool remains auto-approved (Security doc risk rationale).
 *
 * Never overwrites: an existing file at the exact target path is a typed
 * failure, not a silent clobber. All failures come back as ToolResult
 * errors — nothing here throws past the registry.
 */

import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { isAbsolute, join, relative, resolve } from 'path';
import { registerTool, type ToolResult } from './toolRegistry';

function documentsDir(): string {
  // The OS Documents folder; every mainstream platform keeps it under $HOME.
  return join(homedir(), 'Documents');
}

function kycliusScopeRoot(): string {
  return resolve(documentsDir(), 'Kyclius');
}

/** True when `target` is strictly inside `scopeRoot` (no climbing out via ..). */
function isInsideScope(target: string, scopeRoot: string): boolean {
  const rel = relative(scopeRoot, target);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

function validateFilename(filename: string): string | null {
  if (filename.trim().length === 0) {
    return 'filename must be a non-empty string';
  }
  if (filename.includes('/') || filename.includes('\\')) {
    return 'filename must not contain path separators — use the "path" parameter for folders';
  }
  if (filename === '.' || filename === '..') {
    return 'filename must be an actual file name';
  }
  if (filename.includes('\0')) {
    return 'filename contains invalid characters';
  }
  return null;
}

function describeWriteError(err: unknown, fullPath: string): ToolResult {
  const code = (err as NodeJS.ErrnoException)?.code;
  if (code === 'ENOSPC') {
    return { success: false, error: `Disk is full — could not write "${fullPath}". Free up space and try again.` };
  }
  if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') {
    return { success: false, error: `Permission denied writing "${fullPath}".` };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { success: false, error: `Failed to create "${fullPath}": ${message}` };
}

registerTool({
  name: 'create_file',
  description:
    'Create a NEW file with the given content. Files live inside the Kyclius folder under the OS Documents directory: omit "path" to place the file there directly, pass a relative folder (e.g. "notes") to use a subfolder, or pass an absolute folder inside that same Kyclius directory. Existing files are never overwritten.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description:
          'Optional destination folder. Relative folders resolve inside Documents/Kyclius; absolute paths must also be inside Documents/Kyclius.',
      },
      filename: {
        type: 'string',
        description: 'File name only (no folders), e.g. "meeting-notes.md"',
      },
      content: {
        type: 'string',
        description: 'The full text content to write into the file',
      },
    },
    required: ['filename', 'content'],
  },
  permissionTier: 'auto',
  handler: async (params: Record<string, unknown>): Promise<ToolResult> => {
    const filename = typeof params.filename === 'string' ? params.filename.trim() : undefined;
    if (typeof filename !== 'string') {
      return { success: false, error: 'filename must be a non-empty string' };
    }
    const filenameError = validateFilename(filename);
    if (filenameError) {
      return { success: false, error: filenameError };
    }

    const content = params.content;
    if (typeof content !== 'string') {
      return { success: false, error: 'content must be a string' };
    }

    const scopeRoot = kycliusScopeRoot();

    let targetDir: string;
    const requestedPath = params.path;
    if (requestedPath !== undefined) {
      if (typeof requestedPath !== 'string' || requestedPath.trim().length === 0) {
        return { success: false, error: 'path must be a non-empty string when provided' };
      }
      targetDir = isAbsolute(requestedPath)
        ? resolve(requestedPath)
        : resolve(scopeRoot, requestedPath);

      if (!isInsideScope(targetDir, scopeRoot)) {
        return {
          success: false,
          error: `Refused: "${requestedPath}" is outside the directory Kyclius may write to (${scopeRoot}). Use a folder inside it, or omit "path" for the default location.`,
        };
      }
    } else {
      targetDir = scopeRoot;
    }

    const fullPath = join(targetDir, filename);
    if (!isInsideScope(fullPath, scopeRoot)) {
      return {
        success: false,
        error: `Refused: "${fullPath}" is outside the directory Kyclius may write to (${scopeRoot}).`,
      };
    }

    if (existsSync(fullPath)) {
      return {
        success: false,
        error: `"${fullPath}" already exists. I won't overwrite it — tell me a different name if you want a new copy.`,
      };
    }

    try {
      mkdirSync(targetDir, { recursive: true });
      writeFileSync(fullPath, content, 'utf8');
    } catch (err) {
      return describeWriteError(err, fullPath);
    }

    return { success: true, result: `Created "${filename}" at ${fullPath}` };
  },
});
