# Kyclius — AI Agent & Tool Execution Specification

**Version:** 2.8.1 (supersedes 2.7.1)
**Status:** Pre-development

**Changelog from 2.7.1:**
- Step 4 (Intent & Tool-Call Parsing) strengthened with an explicit, testable requirement that raw/malformed tool-call syntax must never reach the user as visible text (EF-12).
- Step 9 (Memory/Log/Dashboard/Plan Update) strengthened with an explicit conversation-scoping requirement (EF-13).
- Step 3a and Step 6 given explicit timeout-enforcement requirements tied to the app-freeze investigation (EF-10).
- Step 2 given a note on attachment ingestion failure modes tied to EF-11.

---

## 1–2. (Purpose, The Full Pipeline)

Unchanged from 2.7.1 — see that version for the full pipeline diagram. The steps below are the specific ones that gained new, stronger requirements in this version; all other steps are unchanged.

### Step 2 — Context Assembly (amendment)
The 2.7.1 note that attached-file content is read fresh from disk and demarcated as reference content stands unchanged. **New for v2.8.1:** if that read fails (file unreadable, path malformed, permission denied), this must produce a clear, specific error surfaced to the user at the point of attachment — not a failure discovered later inside an otherwise-successful LLM call. See Technical Architecture Document §5.3 for the investigation into why this is currently failing for both the manual-picker and drag-and-drop attachment paths.

### Step 3a — Planning (amendment)
**New for v2.8.1:** `max_plan_duration_seconds` and `max_plan_steps` (from `autonomous_mode_config`) must be enforced by an actual timer/counter capable of **aborting an in-flight call**, not merely checked between already-completed steps. A plan step that itself hangs (e.g., waiting on an unresponsive provider) must be interruptible by this ceiling — this is a direct response to the observed app freeze (EF-10), where the evidence suggests a step or call was allowed to block indefinitely rather than being bounded.

### Step 4 — Intent & Tool-Call Parsing (strengthened requirement — EF-12)
The 2.7.1 injection-safeguard and schema-validation requirements stand unchanged. **New, explicit requirement for v2.8.1:** there is no code path by which raw tool-call syntax — from either a native function-calling response or the structured-prompt fallback (added in v2.7.1 for providers without native tool-calling support) — reaches the user as if it were the assistant's answer. Every tool-call attempt resolves to exactly one of: (a) successful validated execution, continuing to Step 5, or (b) the standard "Kyclius tried to do something it doesn't know how to do safely" error. **There is no third path where a parse failure silently falls through to displaying the model's raw output.** This must have direct test coverage: deliberately construct a malformed structured-prompt response and assert the user-visible result is the standard error, never the raw text — this is what actually verifies the fix, not just re-reading the code and confirming it looks right.

### Step 6 — Tool Execution (amendment)
**New for v2.8.1:** every tool handler must run under an enforced timeout at the IPC/main-process level, per Technical Architecture Document §5.1 — a hung external call (a stuck network request, a blocking file read) inside a tool handler must not be able to block the main process indefinitely. This generalizes the existing 2.6.1 requirement ("a hard timeout, so a hung shell command or network call can't freeze the app") from `run_shell_command` specifically to **every** tool handler, since the freeze observed in this version's testing was not necessarily caused by the shell-command tool.

### Step 3a — Planning (additional strengthened requirement — EF-13, confirmed cause)
**Confirmed via a real transcript, not just hypothesized:** the "consecutive actions" counter behind Autonomous Mode's plan-halt message fired on an ordinary conversational message that never invoked multi-step planning at all — the message immediately following it, "hi," got a normal reply, and the very next message, "what can you do," returned the halt notice instead of an answer. Two requirements follow directly:
1. **The counter must only increment when a real autonomous plan is actually in progress** (i.e., only inside the Step 3a path itself), never on an ordinary Step 3 single-response turn. A plain question must never be able to trip this ceiling.
2. **The counter must be scoped to `conversation_id`** (and ideally to the specific `agent_plans` row it belongs to), never global to the app session — see Technical Architecture Document §5.5 for the full analysis. This must have direct test coverage: an ordinary message never triggers the plan-halt message regardless of how many prior messages exist, and two conversations run in parallel never show one's halt state in the other.

### Step 9 — Memory/Log/Dashboard/Plan Update (strengthened requirement)
The 2.7.1 requirement that `messages` rows record `provider_id` and `attachment_ids` stands unchanged. **New, explicit requirement for v2.8.1:** any response — freshly generated or served from a cache, if a caching layer exists anywhere in the pipeline — must be scoped to the `conversation_id` it belongs to, and must never be displayed against a different conversation. If a caching mechanism exists between Step 3 (LLM call) and Step 8 (response to user), its cache key must include `conversation_id` at minimum.

---

## 3–4. (Tool Definition Schema, Design Guarantees)

Unchanged from 2.7.1.