# Kyclius — Product Requirements Document (PRD)

**Version:** 2.8.1 (supersedes 2.7.1)
**Owner:** [pratap]
**Status:** Pre-development

**Changelog from 2.7.1:** This version is primarily a **stability and reliability pass**, prompted by real testing that surfaced a full application freeze, a repeating-failure pattern after a handful of requests, a broken file-attachment feature, and two data-integrity bugs (tool-call syntax leaking into visible answers; a stale response reused across unrelated questions). One new feature — a conversation history preview — is also included. See `06_FEATURE_TICKETS_v2.8.1_ADDENDUM.md` for the full bug list (EF-07 through EF-13) and new feature ticket (T-27).

**Both items flagged in the prior draft are now resolved:**
- The "error after 3–4 requests" (EF-07) turned out to be Autonomous Mode's plan-halt message firing on ordinary messages — merged into EF-13, now a confirmed diagnosis rather than an open investigation. See the addendum.
- The history preview (Section 5, Section 6) is confirmed as an **in-app modal overlay**, matching the existing Settings modal — not a separate OS window.

---

## 1. One-Line Summary

Unchanged from 2.7.1 — Kyclius is a free, open-source, local-first AI desktop assistant you talk to out loud, reasoning with an LLM of your choice (any free or paid provider, bring your own key), speaking its answer back to you, and taking real actions on your OS.

---

## 2. Known Critical Issues (New section — must-fix before wider testing/use)

Testing surfaced the following as **severity-blocking**, not polish items. Nothing in Section 5's new feature should be prioritized over these:

| Issue | Impact | Ticket |
|---|---|---|
| App becomes fully unresponsive ("Not Responding") after an ordinary request, observed lasting over a minute | Total loss of functionality mid-session; the only recovery is force-closing the app | EF-10 |
| Autonomous Mode's "consecutive actions" plan-halt message fires on ordinary conversational messages, not just real multi-step plans — confirmed cause of both "repeated failure after 3-4 requests" and "identical response to unrelated questions" | Makes real conversation impossible once the (incorrectly-scoped) counter is tripped; likely the single biggest source of the app appearing broken during testing | EF-13 (absorbs EF-07) |
| File attachment (T-24) shows an error even when a file is successfully added, and drag-and-drop produces no visible result at all | A whole shipped feature is non-functional | EF-11 |
| Raw, unexecuted tool-call syntax (e.g., `<invoke name="pdf_summary">...`) appears directly in the assistant's visible answer | Breaks the core trust contract that the LLM never executes/exposes tool machinery directly to the user — this is a correctness bug in the tool-call parsing pipeline, not a cosmetic one | EF-12 |
| TTS pronunciation quality is poor, and voice output still has a long delay before it starts | The v2.7.1 streaming/latency fix (T-26) and the separately-built standalone voice system ([`kyclius-voice-standalone`](https://github.com/aradhyapratapconnect-cell/Random-Projects/tree/main/kyclius-voice-standalone)) have not yet been verified as merged and active in the running app | EF-08, EF-09 |

---

## 3. The Problem

Unchanged from 2.7.1.

## 4. Who It's For

Unchanged from 2.7.1.

## 5. Core Features

**Must-Have (MVP):** Unchanged from 2.7.1 — see that version for the full table. One addition:

| Feature | Description |
|---|---|
| **Conversation history preview (NEW)** | Tapping a previous conversation in the Conversations list opens a compact preview — in this version specified as an in-app modal overlay, not a full navigation — showing that conversation's full scrollback, with per-message and copy-all controls, without losing the user's current place in the app. See Section 6 and the Frontend Spec for full detail; **this is one of the two assumptions flagged above.** |

**Nice-to-Have (Post-MVP / Future):** Unchanged from 2.7.1.

## 6. User Flow (Start to Finish)

Unchanged from 2.7.1, with one addition around the step where the user opens the Conversations list: **tapping an individual past conversation now opens the preview overlay described above**, rather than immediately navigating fully into that conversation — the user can read, scroll, and copy from the preview, and only "opens" it as an active session if they choose to continue it from there.

## 7. What the MVP Looks Like

Unchanged from 2.7.1, with one explicit addition: **the app must not become unresponsive under ordinary use.** This was previously assumed rather than stated — given EF-10, it's now stated directly: a hang/freeze of the main window during normal conversation is a release blocker, not a known limitation to document around.

## 8. Success Metrics

Unchanged from 2.7.1, with one addition:

| Metric | What it tells us |
|---|---|
| **Hang/freeze incidents per session, and requests-until-failure (NEW)** | Directly tracks whether EF-07 and EF-10 are actually resolved, rather than relying on anecdotal reports — this should be logged locally (timestamp + what was happening when it occurred) even before any telemetry feature exists, since the `tool_executions.latency_ms` field added in v2.7.1 already gives a place to notice a call that never returned |

## 9. What We Are Deliberately NOT Building (v2.8.1)

Unchanged from 2.7.1. No scope was removed in this version — this release adds one feature and fixes defects, it doesn't change what's out of scope.