/**
 * EF-12: raw/unexecuted tool-call syntax must never reach the user as if it
 * were the assistant's answer (Agent spec Step 4, Security Edge Case 21).
 *
 * Every tool-call attempt resolves to exactly one of:
 *   (a) successful validated execution (continues to Step 5), or
 *   (b) the standard unsafe-tool error below.
 * There is no third path where a parse failure silently falls through to
 * displaying the model's raw output.
 *
 * The gate lives at the end of runTurn (covers native function-calling AND
 * the structured-prompt fallback for providers without native tools): any
 * final text that still contains unexecuted tool-call syntax is replaced with
 * the standard error before it is persisted or returned.
 */

/** Verbatim standard error — user-approved wording, do not rephrase. */
export const UNSAFE_TOOL_ERROR =
  "Kyclius tried to do something it doesn't know how to do safely, so it stopped before acting. Try rephrasing your request.";

/**
 * Markers of unexecuted tool-call machinery. Conservative by design: plain
 * conversation never contains these, while the observed leak
 * (`<invoke name="pdf_summary"><parameter name="pdf_path">...`) always does.
 */
const UNSAFE_PATTERNS: RegExp[] = [
  /<\s*invoke[\s>]/i,
  /<\s*parameter[\s>]/i,
  /<\s*tool[_-]?call[\s>]/i,
  /<\s*function[_-]?call[\s>]/i,
  /<\s*tool[_-]?use[\s>]/i,
  /\[TOOL_CALL\]/i,
  // A fenced JSON block shaped like a tool call that was never executed
  // (the structured-prompt fallback's failure mode when its JSON is malformed).
  /```(?:json)?\s*\{[\s\S]*?"name"\s*:[\s\S]*?"arguments"\s*:/i,
];

/** True when `text` contains unexecuted tool-call syntax. Pure, testable. */
export function containsUnexecutedToolSyntax(text: string | null | undefined): boolean {
  if (!text) return false;
  return UNSAFE_PATTERNS.some(pattern => {
    pattern.lastIndex = 0;
    return pattern.test(text);
  });
}

/**
 * Final gate for assistant-visible text. Returns the standard error when the
 * text contains unexecuted tool syntax, otherwise the text unchanged.
 */
export function sanitizeAssistantText(text: string): string {
  if (containsUnexecutedToolSyntax(text)) return UNSAFE_TOOL_ERROR;
  return text;
}
