"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const fileRefs_1 = require("../fileRefs");
(0, vitest_1.describe)('findFileRefs', () => {
    (0, vitest_1.it)('finds a Windows path mention', () => {
        const refs = (0, fileRefs_1.findFileRefs)('summarize @C:\\docs\\report.pdf');
        (0, vitest_1.expect)(refs).toHaveLength(1);
        (0, vitest_1.expect)(refs[0].path).toBe('C:\\docs\\report.pdf');
    });
    (0, vitest_1.it)('finds multiple mentions in one command', () => {
        const refs = (0, fileRefs_1.findFileRefs)('compare @a.pdf with @b.xlsx');
        (0, vitest_1.expect)(refs.map(r => r.path)).toEqual(['a.pdf', 'b.xlsx']);
    });
    (0, vitest_1.it)('finds a quoted mention with spaces', () => {
        const refs = (0, fileRefs_1.findFileRefs)('read @"C:\\my docs\\file one.pdf" please');
        (0, vitest_1.expect)(refs).toHaveLength(1);
        (0, vitest_1.expect)(refs[0].path).toBe('C:\\my docs\\file one.pdf');
    });
    (0, vitest_1.it)('finds a single-quoted mention', () => {
        (0, vitest_1.expect)((0, fileRefs_1.findFileRefs)("read @'notes file.txt'")[0].path).toBe('notes file.txt');
    });
    (0, vitest_1.it)('stops a bare mention at punctuation', () => {
        const refs = (0, fileRefs_1.findFileRefs)('read @f.txt, ok?');
        (0, vitest_1.expect)(refs).toHaveLength(1);
        (0, vitest_1.expect)(refs[0].path).toBe('f.txt');
    });
    (0, vitest_1.it)('accepts a bare mention with a known extension', () => {
        (0, vitest_1.expect)((0, fileRefs_1.findFileRefs)('read @report.pdf')[0].path).toBe('report.pdf');
    });
    (0, vitest_1.it)('does not treat an email address as a file', () => {
        (0, vitest_1.expect)((0, fileRefs_1.findFileRefs)('email sam@example.com the notes')).toHaveLength(0);
    });
    (0, vitest_1.it)('does not treat a bare unknown word as a mention', () => {
        (0, vitest_1.expect)((0, fileRefs_1.findFileRefs)('please read the report now')).toHaveLength(0);
    });
    (0, vitest_1.it)('returns no refs for empty or mention-less text', () => {
        (0, vitest_1.expect)((0, fileRefs_1.findFileRefs)('')).toHaveLength(0);
        (0, vitest_1.expect)((0, fileRefs_1.findFileRefs)('nothing here')).toHaveLength(0);
    });
});
(0, vitest_1.describe)('stripFileRefs', () => {
    (0, vitest_1.it)('removes the mention but keeps the instruction', () => {
        (0, vitest_1.expect)((0, fileRefs_1.stripFileRefs)('summarize @C:\\docs\\report.pdf')).toBe('summarize');
    });
    (0, vitest_1.it)('keeps surrounding wording', () => {
        (0, vitest_1.expect)((0, fileRefs_1.stripFileRefs)('please summarize @a.pdf for me')).toBe('please summarize for me');
    });
    (0, vitest_1.it)('strips quoted mentions too', () => {
        (0, vitest_1.expect)((0, fileRefs_1.stripFileRefs)('read @"my file.pdf" now')).toBe('read now');
    });
    (0, vitest_1.it)('leaves email addresses untouched', () => {
        (0, vitest_1.expect)((0, fileRefs_1.stripFileRefs)('email sam@example.com please')).toBe('email sam@example.com please');
    });
    (0, vitest_1.it)('collapses double spaces left by stripping', () => {
        (0, vitest_1.expect)((0, fileRefs_1.stripFileRefs)('a @f.pdf b')).toBe('a b');
    });
});
