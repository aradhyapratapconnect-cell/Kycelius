# Kyclius — Security & Access Document

**Version:** 2.8.1 (supersedes 2.7.1)
**Status:** Pre-development

**Changelog from 2.7.1:**
- Added Error Handling Guide rows for the repeated-failure pattern (EF-07) and the file-attachment breakage (EF-11).
- Added two new Edge Cases: raw/unexecuted tool-call syntax must never reach the user (EF-12), and responses must never bleed across conversations (EF-13) — both are now treated as data-integrity requirements with explicit test coverage expectations, not just bugs to patch once.

---

## 1–7. (Authentication, User Roles, Voice Confirmation, Autonomous Mode, Voice Biometrics, Always-On Listening, RLS)

Unchanged from 2.7.1 — see that version for full text. Nothing in this version's fixes touches auth, roles, RLS, or the confirmation/biometrics mechanisms themselves.

---

## 8. Error Handling Guide (Major Failure Points)

Unchanged rows from 2.7.1 carry forward as-is. **New rows for v2.8.1:**

| Failure point | What can go wrong | How Kyclius should handle it |
|---|---|---|
| **Repeated request failure after a few turns (NEW — EF-07)** | Exact cause not yet confirmed (see Technical Architecture Document §5.2 for investigation candidates: rate limiting, unreleased resources, growing context exceeding a token limit) | Until root-caused, at minimum the failure must surface a **specific** message naming what actually failed (which provider, what HTTP status if applicable) rather than a generic error — a silent or generic failure here is itself a bug independent of whatever the root cause turns out to be |
| **File/folder attachment fails despite a valid file (NEW — EF-11)** | The "+" picker path and the drag-and-drop path may fail independently (see Technical Architecture Document §5.3) — a Windows-style path, an unreadable file, or a drop event never reaching the attach handler | Each path (picker vs. drag-and-drop) needs its own error surface — if a drop silently does nothing, that's worse than a visible error, since the user doesn't know their action was even registered; at minimum, a drop should always produce *some* visible acknowledgment (a chip, or a specific error), never total silence |
| **App becomes unresponsive during a request (NEW — EF-10)** | A blocking/unbounded call on the main process thread (see Technical Architecture Document §5.1) | Every main-process call triggered by a single user action must have an enforced timeout that can actually abort the call, with a visible "this is taking longer than expected" state surfaced to the user well before a full freeze — a freeze with no warning state beforehand is the failure mode to eliminate, not just recover from faster |

---

## 9. Edge Cases to Handle Before Launch

Unchanged edge cases 1–20 from 2.7.1 carry forward as-is. **New edge cases for v2.8.1:**

21. **Unexecuted or malformed tool-call syntax must never be displayed to the user as if it were a real answer (NEW — EF-12).** Per the Agent & Tool Execution Specification's Step 4, every proposed tool call — including one produced via the structured-prompt fallback for providers without native function-calling — must either execute successfully or produce the already-specified "Kyclius tried to do something it doesn't know how to do safely" error. There is no valid state in which raw tool-call syntax (e.g., `<invoke name="...">...`) is shown to the user as though it were the assistant's response. This needs explicit test coverage: deliberately feed a malformed/unparseable tool-call response through the pipeline and assert the user-visible output is the standard error message, never the raw text. Treat any occurrence of this in testing as a release blocker, not a cosmetic issue — it's a break in the core trust contract that "the LLM never executes anything directly" (Agent & Tool Execution Specification, Design Guarantee 1), since raw tool syntax reaching the user is evidence the validation step was bypassed, not just poorly formatted.
22. **A canned/system-generated message (such as Autonomous Mode's plan-halt notice) must never be returned for a message it doesn't apply to (NEW — EF-13, confirmed cause).** A real transcript showed Autonomous Mode's "I stopped after quite a few consecutive actions to stay safe..." message returned for a plain conversational question that never triggered multi-step planning at all. The confirmed cause is a "consecutive actions" counter that isn't correctly scoped to `conversation_id` and/or isn't limited to only incrementing when a real autonomous plan is in progress — see Technical Architecture Document §5.5 for the fix approach. This needs explicit test coverage: an ordinary message must never trigger the plan-halt message regardless of prior message count, and two conversations run in parallel must never show one's halt state in the other — a passing manual spot-check is not sufficient here given how this class of bug tends to reappear intermittently rather than consistently.