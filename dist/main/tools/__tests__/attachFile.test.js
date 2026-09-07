"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const fs_1 = require("fs");
const os_1 = require("os");
const path_1 = require("path");
const { createMock } = vitest_1.vi.hoisted(() => ({ createMock: vitest_1.vi.fn() }));
vitest_1.vi.mock('../../db/db', () => ({
    attachments: { create: createMock },
}));
const attachFile_1 = require("../attachFile");
(0, vitest_1.beforeEach)(() => {
    vitest_1.vi.clearAllMocks();
});
(0, vitest_1.describe)('EF-11 normalizeAttachPath (Windows paths)', () => {
    (0, vitest_1.it)('passes a plain Windows path through', () => {
        (0, vitest_1.expect)((0, attachFile_1.normalizeAttachPath)('C:\\Users\\aradh\\Downloads\\random_sample.pdf')).toContain('random_sample.pdf');
    });
    (0, vitest_1.it)('strips surrounding quotes from picker/drag-drop serialization', () => {
        const quoted = '"C:\\Users\\aradh\\Downloads\\random_sample.pdf"';
        (0, vitest_1.expect)((0, attachFile_1.normalizeAttachPath)(quoted)).toBe((0, attachFile_1.normalizeAttachPath)('C:\\Users\\aradh\\Downloads\\random_sample.pdf'));
    });
    (0, vitest_1.it)('unwraps file:/// URLs', () => {
        const url = 'file:///C:/Users/aradh/Downloads/random_sample.pdf';
        (0, vitest_1.expect)((0, attachFile_1.normalizeAttachPath)(url)).toContain('random_sample.pdf');
    });
    (0, vitest_1.it)('rejects non-strings and empty input', () => {
        (0, vitest_1.expect)((0, attachFile_1.normalizeAttachPath)('')).toBe('');
        (0, vitest_1.expect)((0, attachFile_1.normalizeAttachPath)(undefined)).toBe('');
        (0, vitest_1.expect)((0, attachFile_1.normalizeAttachPath)(42)).toBe('');
    });
});
(0, vitest_1.describe)('EF-11 ingestAttachment (shared picker + drag-drop core)', () => {
    (0, vitest_1.it)('picker and drag-drop paths resolve identically (quoted vs bare)', async () => {
        const dir = (0, fs_1.mkdtempSync)((0, path_1.join)((0, os_1.tmpdir)(), 'kyclius-attach-'));
        const file = (0, path_1.join)(dir, 'hello.txt');
        (0, fs_1.writeFileSync)(file, 'hello attachment');
        try {
            const bare = await (0, attachFile_1.ingestAttachment)(file, 'convo-1');
            const quoted = await (0, attachFile_1.ingestAttachment)(`"${file}"`, 'convo-1');
            (0, vitest_1.expect)(bare.success).toBe(true);
            (0, vitest_1.expect)(quoted.success).toBe(true);
            if (bare.success && quoted.success) {
                (0, vitest_1.expect)(quoted.attachment.path).toBe(bare.attachment.path);
                (0, vitest_1.expect)(quoted.attachment.displayName).toBe('hello.txt');
            }
            (0, vitest_1.expect)(createMock).toHaveBeenCalledTimes(2);
        }
        finally {
            (0, fs_1.rmSync)(dir, { recursive: true, force: true });
        }
    });
    (0, vitest_1.it)('missing files produce a specific error (not a silent no-op)', async () => {
        const outcome = await (0, attachFile_1.ingestAttachment)('C:\\definitely\\not\\here\\missing.pdf', 'convo-1');
        (0, vitest_1.expect)(outcome.success).toBe(false);
        if (!outcome.success) {
            (0, vitest_1.expect)(outcome.error).toMatch(/couldn't read|doesn't exist/i);
        }
        (0, vitest_1.expect)(createMock).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('relative paths are rejected safely', async () => {
        const outcome = await (0, attachFile_1.ingestAttachment)('relative/path.txt', 'convo-1');
        (0, vitest_1.expect)(outcome.success).toBe(false);
    });
});
