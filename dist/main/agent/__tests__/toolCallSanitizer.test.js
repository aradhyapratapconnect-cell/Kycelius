"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const toolCallSanitizer_1 = require("../toolCallSanitizer");
const openAICompatibleClient_1 = require("../../llm/openAICompatibleClient");
// EF-12: a deliberately malformed structured-prompt response must resolve to
// the standard error, never to raw tool-call text in the visible answer.
(0, vitest_1.describe)('EF-12 raw tool-call syntax never reaches the user', () => {
    const MALFORMED_INVOKE = '<invoke name="pdf_summary"><parameter name="pdf_path">C:\\Users\\aradh\\Downloads\\random_sample.pdf</parameter></invoke>';
    (0, vitest_1.it)('the structured fallback parser does NOT execute <invoke> syntax (proves the bypass path exists)', () => {
        (0, vitest_1.expect)((0, openAICompatibleClient_1.parseStructuredToolCall)(MALFORMED_INVOKE)).toBeNull();
    });
    (0, vitest_1.it)('the sanitizer catches the observed <invoke>/<parameter> leak', () => {
        (0, vitest_1.expect)((0, toolCallSanitizer_1.containsUnexecutedToolSyntax)(MALFORMED_INVOKE)).toBe(true);
        (0, vitest_1.expect)((0, toolCallSanitizer_1.sanitizeAssistantText)(MALFORMED_INVOKE)).toBe(toolCallSanitizer_1.UNSAFE_TOOL_ERROR);
    });
    (0, vitest_1.it)('a malformed fenced tool-call block resolves to the standard error, not raw text', () => {
        const malformedFenced = '```json\n{"name": "pdf_summary", "arguments": {broken json...\n```';
        // Unparseable, so the fallback yields raw text — the chat gate must catch it.
        (0, vitest_1.expect)((0, openAICompatibleClient_1.parseStructuredToolCall)(malformedFenced)).toBeNull();
        (0, vitest_1.expect)((0, toolCallSanitizer_1.sanitizeAssistantText)(malformedFenced)).toBe(toolCallSanitizer_1.UNSAFE_TOOL_ERROR);
    });
    (0, vitest_1.it)('ordinary prose (including Windows paths and JSON mentions) passes through untouched', () => {
        const plain = 'I read C:\\Users\\aradh\\Downloads\\random_sample.pdf and it is about weather. No tool syntax here.';
        (0, vitest_1.expect)((0, toolCallSanitizer_1.containsUnexecutedToolSyntax)(plain)).toBe(false);
        (0, vitest_1.expect)((0, toolCallSanitizer_1.sanitizeAssistantText)(plain)).toBe(plain);
    });
    (0, vitest_1.it)('the standard error itself is clean (no self-trigger)', () => {
        (0, vitest_1.expect)((0, toolCallSanitizer_1.containsUnexecutedToolSyntax)(toolCallSanitizer_1.UNSAFE_TOOL_ERROR)).toBe(false);
    });
});
