# Kyclius — Feature Ticket Addendum for v2.8.1

This addendum covers new tickets only (EF-07 through EF-13, plus T-27) — as with the v2.7.1 addendum, I don't have the original `06_FEATURE_TICKETS.md` content, so this is meant to be appended to your existing file, not to replace it.

**Both previously-open questions are now resolved (confirmed by the person building this):**
- **EF-07 is merged into EF-13** — a screenshot showing the actual failure in context revealed they're the same bug, not two separate ones. See EF-13 below.
- **T-27 is confirmed as an in-app modal**, matching the existing Settings modal pattern — not a separate OS window.

---

## Critical bug tickets (from this version's testing)

### EF-07 — MERGED into EF-13 (see below)
What looked like "an error after 3–4 requests" turned out, on inspection of the actual conversation, to be the Autonomous Mode plan-halt message ("I stopped after quite a few consecutive actions to stay safe...") firing on an ordinary second message that never should have triggered multi-step planning at all. This is the same underlying bug as EF-13 — a "consecutive actions" counter that isn't correctly scoped — not a separate failure. Tracked as one ticket going forward: **EF-13**.

### EF-08 — TTS pronunciation quality
Voice output mispronounces words. Root cause not yet isolated — could be the current in-app TTS engine specifically, or could already be addressed by the unmerged standalone voice system at [`https://github.com/aradhyapratapconnect-cell/Random-Projects/tree/main/kyclius-voice-standalone`](https://github.com/aradhyapratapconnect-cell/Random-Projects/tree/main/kyclius-voice-standalone) (see EF-09 and the Branching & Release Strategy in the Technical Architecture Document). **Do not close this ticket on the basis of "the new voice system is built" — only close it once the integration branch is merged and this specific symptom is re-tested and confirmed fixed** (Technical Architecture Document §6, step 3).

### EF-09 — TTS/voice response latency still slow in the running app
The v2.7.1 streaming/latency fix (T-26) and the separately verified standalone voice system are not yet confirmed active in the app the user is testing. This ticket tracks getting the integration branch (per the new Branching & Release Strategy) merged and re-verified for latency specifically, not just functionally passing its own demonstration harness.

### EF-10 — App becomes fully unresponsive ("Not Responding") during normal use
Observed lasting over a minute after an ordinary request with Autonomous Mode enabled. See `02_TECHNICAL_ARCHITECTURE.md` §5.1 for investigation candidates (unbounded retry on the failing Cloud STT call, an unenforced Autonomous Mode plan timeout, a synchronous large-file read). **Treat as the single highest-priority ticket in this batch** — every other new feature or polish item should wait behind this one, since a hang with no recovery path other than a force-quit is a totally broken experience regardless of what else works.

**Acceptance criteria:** every main-process call reachable from a single user action has an enforced, real (not just checked-between-steps) timeout; the UI shows a "taking longer than expected" state (per the new Frontend Spec requirement) well before anything could look frozen.

### EF-11 — File/folder attachment broken: errors on manual add, silent no-op on drag-and-drop
Two likely-independent failures — see `02_TECHNICAL_ARCHITECTURE.md` §5.3. Verify the "+"-icon picker path and the drag-and-drop path (T-23) both actually reach the same `attach_file` handler; don't assume a shared root cause without checking both independently. Pay particular attention to Windows-style path handling given the evidence shows paths like `C:\Users\aradh\Downloads\random_sample.pdf`.

### EF-12 — Raw tool-call syntax leaking into visible assistant responses
Observed: `<invoke name="pdf_summary"><parameter name="pdf_path">...` appearing as if it were the answer text. This is a **release-blocking correctness bug**, not cosmetic — it means Step 4's parsing/validation is being bypassed for at least one code path (very likely the structured-prompt fallback for non-native-tool-calling providers, added in v2.7.1). See `05_AGENT_TOOL_EXECUTION_SPEC.md`'s strengthened Step 4 requirement and `03_SECURITY_ACCESS.md` Edge Case 21 for the exact acceptance bar: a deliberately malformed tool-call response must always resolve to the standard error message, never raw text, and this needs direct test coverage, not just a code read-through.

### EF-13 — Autonomous Mode's "consecutive actions" plan-halt message fires on ordinary messages, not just real multi-step plans (absorbs EF-07)
**Confirmed root cause, not just a hypothesis, based on a real conversation transcript:** a user sent "hi" (got a normal reply), then sent an unrelated, ordinary question ("what can you do") as their very next message — and received Autonomous Mode's plan-step-ceiling message ("I stopped after quite a few consecutive actions to stay safe. Here's where things stand — tell me what to do next, or break the task into smaller requests.") instead of an actual answer. Separately, three different questions in another session ("hi," "can u tell what it is about," "can u summarize it") all returned that exact same text.

This is one bug, not several: a "consecutive actions" counter — almost certainly tied to `autonomous_mode_config.max_plan_steps`/the plan-halt logic in the Agent & Tool Execution Specification's Step 3a — is being incremented and checked in a scope that's too broad. Specific things to check, in order:
1. **Is the counter scoped per `conversation_id`, or is it global to the app session (or worse, never reset between conversations at all)?** The three-identical-responses evidence and the "fires on message 2" evidence both point at a counter that persists and accumulates well beyond where it should.
2. **Is the counter incrementing on every message, or only on messages that actually invoke a multi-step autonomous plan?** "What can you do" is a plain conversational question — it should never touch the plan-step-ceiling logic at all. If the counter increments on any turn regardless of whether planning occurred, that's the bug on its own, independent of scoping.
3. **Once the plan-halt message fires once, does anything ever reset the counter?** If not, every subsequent message in that scope will keep returning the same canned text forever, which matches what was observed.

**Acceptance criteria:** an ordinary conversational message never triggers the plan-halt message, regardless of how many prior messages exist in the app; the counter (however it's scoped) resets appropriately between conversations at minimum, and ideally only increments when a real Autonomous Mode plan is actually in progress; running two conversations in parallel with different content never causes one to see the other's halt state or response — this needs direct test coverage (per `03_SECURITY_ACCESS.md` Edge Case 22), not a single manual retest, since this class of bug is the kind that comes back intermittently rather than consistently.

---

## New feature ticket

### T-27 — Conversation history preview modal
**Confirmed:** an in-app modal overlay, not a separate OS window — matching the existing Settings modal pattern already used elsewhere in the app, per the person building this. No new main-process window or separate preload surface is needed.

**As specified:** tapping a conversation in the Conversations list opens a centered modal (~560px wide, ~70vh tall, internal scroll) showing that conversation's full read-only scrollback, with a per-message copy control, a copy-all control, a close control, and an "Open full conversation" link that navigates into the real Conversation view. Does not change the app's underlying navigation state — closing it returns to whatever was behind it.

**Acceptance criteria:** opening the preview never loses the user's place elsewhere in the app; copy controls produce correct plain-text output; opening a second conversation's preview while one is open replaces rather than stacks.

---

## Process note: voice-system branching (not a ticket — a workflow decision)

Per your direction, documented formally in `02_TECHNICAL_ARCHITECTURE.md` §6: the standalone voice system ([`kyclius-voice-standalone`](https://github.com/aradhyapratapconnect-cell/Random-Projects/tree/main/kyclius-voice-standalone)) is integrated on a dedicated branch (`feature/voice-system-integration`), re-verified inside that branch (not just standalone), and manually re-tested against EF-08/EF-09 specifically, before merging to `main`. `main` stays on the current voice implementation until that full sequence passes — there's always a working fallback branch while the replacement is being integrated.

---

## Suggested priority order for this batch

1. **EF-10** (app freeze) — blocks everything else from being usable long enough to test.
2. **EF-13** (Autonomous Mode counter misfiring, absorbs EF-07) and **EF-12** (raw tool-call leakage) — both are now well-diagnosed, testable bugs with a clear fix target; this is likely the highest-value pair to fix next since EF-13 alone was probably making the app look broken far more often than it actually is.
3. **EF-11** (file attachment) — verify the two paths independently.
4. **Voice system integration branch → EF-08/EF-09** — run in parallel with the above, following the Branching & Release Strategy; don't merge until re-verified.
5. **T-27** (history preview) — lowest risk, do last. Scope is now fully confirmed (in-app modal).