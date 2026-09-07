import { describe, expect, it } from 'vitest';
import {
  UNSAFE_TOOL_ERROR,
  containsUnexecutedToolSyntax,
  sanitizeAssistantText,
} from '../toolCallSanitizer';
import { parseStructuredToolCall } from '../../llm/openAICompatibleClient';

// EF-12: a deliberately malformed structured-prompt response must resolve to
// the standard error, never to raw tool-call text in the visible answer.
describe('EF-12 raw tool-call syntax never reaches the user', () => {
  const MALFORMED_INVOKE =
    '<invoke name="pdf_summary"><parameter name="pdf_path">C:\\Users\\aradh\\Downloads\\random_sample.pdf</parameter></invoke>';

  it('the structured fallback parser does NOT execute <invoke> syntax (proves the bypass path exists)', () => {
    expect(parseStructuredToolCall(MALFORMED_INVOKE)).toBeNull();
  });

  it('the sanitizer catches the observed <invoke>/<parameter> leak', () => {
    expect(containsUnexecutedToolSyntax(MALFORMED_INVOKE)).toBe(true);
    expect(sanitizeAssistantText(MALFORMED_INVOKE)).toBe(UNSAFE_TOOL_ERROR);
  });

  it('a malformed fenced tool-call block resolves to the standard error, not raw text', () => {
    const malformedFenced =
      '```json\n{"name": "pdf_summary", "arguments": {broken json...\n```';
    // Unparseable, so the fallback yields raw text — the chat gate must catch it.
    expect(parseStructuredToolCall(malformedFenced)).toBeNull();
    expect(sanitizeAssistantText(malformedFenced)).toBe(UNSAFE_TOOL_ERROR);
  });

  it('ordinary prose (including Windows paths and JSON mentions) passes through untouched', () => {
    const plain =
      'I read C:\\Users\\aradh\\Downloads\\random_sample.pdf and it is about weather. No tool syntax here.';
    expect(containsUnexecutedToolSyntax(plain)).toBe(false);
    expect(sanitizeAssistantText(plain)).toBe(plain);
  });

  it('the standard error itself is clean (no self-trigger)', () => {
    expect(containsUnexecutedToolSyntax(UNSAFE_TOOL_ERROR)).toBe(false);
  });
});
