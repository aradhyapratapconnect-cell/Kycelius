"use strict";
/**
 * T-08 — Tool: Delete File (always confirm_required)
 *
 * Deletes a single file after explicit user confirmation. Safety design:
 *
 * - Path resolution, existence checks, and the system-location backstop all
 *   run in the registry's pre-gate normalizeParams hook — so a system path is
 *   refused OUTRIGHT (no dialog), a missing file returns "nothing to delete"
 *   without bothering the user, and the confirmation dialog shows the exact
 *   resolved absolute path that will be deleted.
 * - Success is only reported after verifying the file is actually gone; the
 *   OS call's return value alone is never trusted.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeDeleteTarget = normalizeDeleteTarget;
const fs_1 = require("fs");
const os_1 = require("os");
const path_1 = require("path");
const toolRegistry_1 = require("./toolRegistry");
/** True when `resolved` equals or sits inside `root`. */
function isInsideOrEqual(resolved, root) {
    const rel = (0, path_1.relative)(root, resolved);
    return rel === '' || (!rel.startsWith('..') && !(0, path_1.isAbsolute)(rel));
}
/**
 * System-critical backstop (AC: refused outright, even with confirmation).
 * Blocks OS/system locations and package/app data dirs by containment, plus
 * the filesystem/drive root and the user profile root by exact match.
 */
function isProtectedPath(resolved) {
    const containedRoots = [];
    const add = (p) => {
        if (p && p.trim().length > 0)
            containedRoots.push((0, path_1.resolve)(p));
    };
    switch (process.platform) {
        case 'win32':
            add(process.env.SystemRoot ?? 'C:\\Windows');
            add(process.env.ProgramFiles);
            add(process.env['ProgramFiles(x86)']);
            add(process.env.ProgramData);
            add(process.env.LOCALAPPDATA);
            add(process.env.APPDATA);
            break;
        case 'darwin':
            ['/System', '/Library', '/Applications', '/usr', '/bin', '/sbin', '/etc', '/var', '/private'].forEach(add);
            break;
        default:
            ['/bin', '/boot', '/dev', '/etc', '/lib', '/lib64', '/proc', '/run', '/sbin', '/srv', '/sys', '/usr', '/var'].forEach(add);
            break;
    }
    // Exact-match-only protections: deleting the root or the whole user
    // profile is refused, while ordinary files beside them stay deletable.
    if (resolved === (0, path_1.parse)(resolved).root)
        return true;
    if (resolved === (0, path_1.resolve)((0, os_1.homedir)()))
        return true;
    if (process.platform === 'darwin' && resolved === (0, path_1.join)((0, os_1.homedir)(), 'Library'))
        return true;
    for (const root of containedRoots) {
        if (isInsideOrEqual(resolved, root))
            return true;
    }
    return false;
}
function expandHome(raw) {
    if (raw === '~')
        return (0, os_1.homedir)();
    if (raw.startsWith('~/') || raw.startsWith('~\\'))
        return (0, path_1.join)((0, os_1.homedir)(), raw.slice(2));
    return raw;
}
/**
 * Pre-gate hook: resolve to an absolute path (so the dialog shows exactly
 * what will be deleted), refuse protected locations outright, and confirm a
 * regular file exists before asking the user anything.
 */
function normalizeDeleteTarget(params) {
    const raw = params.path;
    if (typeof raw !== 'string' || raw.trim().length === 0) {
        return 'path must be a non-empty string';
    }
    const resolved = (0, path_1.resolve)(expandHome(raw.trim()));
    if (isProtectedPath(resolved)) {
        return `Refused: "${resolved}" is a system-critical location that Kyclius will not delete from.`;
    }
    if (!(0, fs_1.existsSync)(resolved)) {
        return `"${resolved}" does not exist — nothing to delete.`;
    }
    let stat;
    try {
        stat = (0, fs_1.statSync)(resolved);
    }
    catch {
        stat = null;
    }
    if (!stat?.isFile()) {
        return `"${resolved}" is not a regular file — Kyclius only deletes single files.`;
    }
    return { ...params, path: resolved };
}
(0, toolRegistry_1.registerTool)({
    name: 'delete_file',
    description: 'Permanently delete ONE file after explicit user confirmation. Pass the full absolute path when known; "~" and home-relative paths also work. Refuses system locations, directories, and missing files.',
    parameters: {
        type: 'object',
        properties: {
            path: {
                type: 'string',
                description: 'Absolute path of the file to delete ("~" supported)',
            },
        },
        required: ['path'],
    },
    permissionTier: 'confirm_required',
    normalizeParams: normalizeDeleteTarget,
    handler: async (params) => {
        const target = typeof params.path === 'string' ? params.path : '';
        if (!target || !(0, fs_1.existsSync)(target)) {
            return {
                success: false,
                error: `"${target}" no longer exists — nothing was deleted.`,
            };
        }
        try {
            (0, fs_1.unlinkSync)(target);
        }
        catch (err) {
            const code = err?.code;
            if (code === 'ENOENT') {
                return { success: false, error: `"${target}" is already gone — nothing to delete.` };
            }
            if (code === 'EACCES' || code === 'EPERM' || code === 'EBUSY') {
                return { success: false, error: `Could not delete "${target}" — it may be open or locked.` };
            }
            const message = err instanceof Error ? err.message : String(err);
            return { success: false, error: `Failed to delete "${target}": ${message}` };
        }
        // Never trust the OS call alone — verify it is actually gone.
        if ((0, fs_1.existsSync)(target)) {
            return {
                success: false,
                error: `Tried to delete "${target}" but it is still present. Reporting this as a failure instead of assuming success.`,
            };
        }
        return { success: true, result: `Deleted ${target}` };
    },
});
