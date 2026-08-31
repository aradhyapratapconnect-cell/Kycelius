"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const fs_1 = require("fs");
const path_1 = require("path");
const os_1 = require("os");
const context_1 = require("../context");
let dir;
(0, vitest_1.beforeEach)(() => {
    dir = (0, fs_1.mkdtempSync)((0, path_1.join)((0, os_1.tmpdir)(), 'kyclius-context-'));
});
(0, vitest_1.afterEach)(() => {
    (0, fs_1.rmSync)(dir, { recursive: true, force: true });
});
function write(name, contents) {
    const p = (0, path_1.join)(dir, name);
    (0, fs_1.writeFileSync)(p, contents);
    return p;
}
(0, vitest_1.describe)('buildFileContext', () => {
    (0, vitest_1.it)('returns null block when no mention exists', () => {
        const result = (0, context_1.buildFileContext)('hello there');
        (0, vitest_1.expect)(result.contextBlock).toBeNull();
        (0, vitest_1.expect)(result.cleanUserText).toBe('hello there');
    });
    (0, vitest_1.it)('attaches extracted text for the request only', () => {
        const p = write('note.txt', 'the secret is pineapples');
        const result = (0, context_1.buildFileContext)(`what is in @${p}?`);
        (0, vitest_1.expect)(result.contextBlock).toContain('the secret is pineapples');
        (0, vitest_1.expect)(result.contextBlock).toContain('note.txt');
        (0, vitest_1.expect)(result.cleanUserText).toBe('what is in?');
    });
    (0, vitest_1.it)('strips the mention but keeps surrounding wording', () => {
        const p = write('doc.pdf', 'dummy');
        const result = (0, context_1.buildFileContext)(`summarize @${p} please`);
        (0, vitest_1.expect)(result.cleanUserText).toBe('summarize please');
    });
    (0, vitest_1.it)('reports failed references as a clear notice', () => {
        const p = (0, path_1.join)(dir, 'missing.pdf');
        const result = (0, context_1.buildFileContext)(`read @${p}`);
        (0, vitest_1.expect)(result.contextBlock).toContain('could not be read');
        (0, vitest_1.expect)(result.contextBlock).toContain('Tell the user this clearly');
    });
    (0, vitest_1.it)('handles images as a note, not a failure', () => {
        const png = Buffer.from([
            0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
            0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
            0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00, 0x03, 0x08, 0x06,
        ]);
        const p = write('pic.png', png);
        const result = (0, context_1.buildFileContext)(`describe @${p}`);
        (0, vitest_1.expect)(result.contextBlock).toContain('pic.png');
        (0, vitest_1.expect)(result.contextBlock).toContain("can't read image pixels yet");
    });
    (0, vitest_1.it)('handles multiple references in one command', () => {
        const a = write('a.txt', 'alpha');
        const b = write('b.txt', 'beta');
        const result = (0, context_1.buildFileContext)(`compare @${a} @${b}`);
        (0, vitest_1.expect)(result.contextBlock).toContain('alpha');
        (0, vitest_1.expect)(result.contextBlock).toContain('beta');
        (0, vitest_1.expect)(result.cleanUserText).toBe('compare');
    });
});
