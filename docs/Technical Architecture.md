# Kyclius — Technical Architecture Document

**Version:** 2.8.1 (supersedes 2.7.1)
**Status:** Pre-development

**Changelog from 2.7.1:**
- New **Branching & Release Strategy** section (Section 6) — the standalone voice system is developed on its own git branch and only merged to `main` after it passes verification in the *integrated* app, not just standalone, per your explicit direction.
- Added root-cause investigation notes for the app freeze (EF-10), the repeated-failure pattern (EF-07), the file-attachment breakage (EF-11), the raw tool-call leakage (EF-12), and the cross-conversation stale-response bug (EF-13) — these are architecture-level hypotheses to guide debugging, not confirmed fixes.
- Added the conversation history preview component to the file structure (Section 2).

---

## 1. Recommended Tech Stack

Unchanged from 2.7.1 — no stack changes in this version. This release is a bugfix/stability pass plus one feature, not an architecture rework.

---

## 2. Complete File & Folder Structure

Unchanged from 2.7.1, with one addition under `src/renderer/components/`:

```
├── components/
│   ├── ...(all 2.7.1 components unchanged)
│   └── ConversationPreview/        # NEW — modal overlay for the history-preview feature (Section 6 of Frontend Spec)
│       ├── ConversationPreviewModal.tsx
│       └── ConversationPreviewMessage.tsx   # single message row with its own Copy control
```

**Confirmed:** this is a renderer-only modal, not a second Electron `BrowserWindow` — no new main-process window or separate preload surface is needed. Matches the existing Settings modal's implementation pattern.

---

## 3. Database Schema

Unchanged from 2.7.1 — no schema changes required for this version's bug fixes or the history preview feature (the preview reads existing `conversations`/`messages` rows; it doesn't need new tables).

---

## 4. Environment Variables & Configuration Notes

Unchanged from 2.7.1.

---

## 5. Root-Cause Investigation Notes (New for v2.8.1)

These are architecture-level hypotheses to direct debugging — not confirmed fixes. Each ties to a ticket in the addendum.

### 5.1 App freeze / "Not Responding" (EF-10)
The recording shows the entire window (including the sidebar and window chrome) become unresponsive, not just the chat area — this points at the **main process event loop being blocked**, not a renderer-only rendering issue, since a renderer-only hang would typically leave window chrome (minimize/close buttons) responsive. Primary suspects, in order of likelihood:
- A **synchronous or unbounded-retry call** somewhere in the main process — e.g., the Cloud STT provider call (which is failing with a 401, per the evidence) retrying without a capped backoff or timeout, blocking the main process thread it runs on.
- An **Autonomous Mode planning call** without a hard wall-clock timeout enforced at the IPC/main-process level — `max_plan_duration_seconds` (per the `autonomous_mode_config` schema) needs to actually be enforced with a real timer that can abort an in-flight call, not just checked between already-completed steps.
- A file/folder read (T-24 attachment ingestion, or EF-11 investigation below) reading a very large file synchronously on the main thread.

**Recommended fix approach:** audit every main-process call that can be triggered by a single user action for (a) a hard timeout, and (b) whether it's genuinely async/non-blocking rather than synchronous Node I/O. Any call without both should be treated as a candidate cause until ruled out.

### 5.2 "Repeated failure after 3–4 requests" — CONFIRMED to be the same bug as §5.5 (EF-13, absorbs EF-07)
A real conversation transcript resolved this: it is not a crash or a provider error at all. The "failure" is Autonomous Mode's plan-halt message ("I stopped after quite a few consecutive actions to stay safe...") being returned for an ordinary conversational message that never should have engaged multi-step planning in the first place. See §5.5 below for the merged root-cause analysis — this subsection is kept only to preserve the original investigation trail; all further work on this symptom is tracked under §5.5 / ticket EF-13.

### 5.3 File attachment broken (EF-11)
Given T-24 was previously specified and presumably built, "shows an error even when the file is added, and drag-and-drop shows nothing" suggests **two distinct failures**, not one:
- The "+"-icon manual-picker path reaches the `attach_file` tool but the tool itself errors (worth checking the attachment ingestion code against the actual file path format on the user's OS — Windows path escaping is a common source of this class of bug, and the Dashboard screenshot shows Windows-style paths like `C:\Users\aradh\Downloads\random_sample.pdf`).
- The drag-and-drop path (T-23) may not be wired to the same `attach_file` flow at all — "nothing shows up" (no error, no chip, no attempt) suggests the drop event isn't being captured or isn't calling `webUtils.getPathForFile` at all, rather than the resolution failing after being called.

**Recommended fix approach:** treat these as two separate bugs to verify independently — confirm the "+" picker path and the drag-and-drop path both actually invoke the same underlying `attach_file` handler, rather than assuming a shared root cause.

### 5.4 Raw tool-call syntax leaking into responses (EF-12)
Per the Agent & Tool Execution Specification's Step 4, any tool call — including one produced via the structured-prompt fallback for providers without native function-calling (added in v2.7.1) — must be parsed and validated before anything reaches the user. The observed `<invoke name="pdf_summary">...` text appearing as if it were the assistant's answer means **the parsing/validation step is being skipped or is failing silently and falling through to displaying the raw model output** rather than either successfully executing the tool or raising the "Kyclius tried to do something it doesn't know how to do safely" error already specified for malformed calls. This is very likely tied to the structured-prompt fallback path specifically (native tool-calling providers are less likely to produce this failure mode) — check whether the provider/model used for that request was using the fallback path, and whether its parser correctly strips/executes the fenced block rather than passing it through untouched on a parse failure.

### 5.5 Autonomous Mode's "consecutive actions" counter misfires on ordinary messages (EF-13, absorbs EF-07 — CONFIRMED root cause)
A conversation transcript showed the actual failure directly: a user sent "hi" (normal reply received), then sent an unrelated, plain question — "what can you do" — as their very next message, and got back Autonomous Mode's plan-step-ceiling message instead of an answer. This is not a cache bug or a cross-conversation content bleed in the way originally hypothesized — it's a **counter/scoping bug in the Autonomous Mode plan-halt logic itself** (Agent & Tool Execution Specification, Step 3a):

1. **Scoping:** the "consecutive actions" counter is very likely global to the app session (or persists indefinitely with no reset), rather than scoped to `conversation_id` or to a specific in-progress plan. This explains both the original "fails after 3–4 requests" report and the "three unrelated questions, identical response" evidence — same stuck counter, same canned output, regardless of what's actually asked.
2. **Trigger condition:** the counter may be incrementing on *every* message rather than only on messages that actually invoke multi-step autonomous planning. "What can you do" is a plain conversational question with no tool calls involved — it should never touch this logic at all. This is worth checking independently of (1), since it's a distinct bug even if scoping were fixed.
3. **No reset path:** once the halt message fires, nothing appears to clear the counter — every subsequent message in whatever scope it's tracked at keeps returning the same text, matching what was observed.

**Recommended fix approach:** check all three of the above against the actual plan-halt implementation, in order — (2) first, since a counter that shouldn't be incrementing at all is the simplest and most likely culprit given a plain question triggered this on only the second message of a session. Add direct test coverage: two conversations running in parallel with different content must never show one's halt state or response in the other, and an ordinary non-planning message must never trigger the plan-halt message regardless of prior message count.

---

## 6. Branching & Release Strategy (New for v2.8.1)

Per your direction: **the standalone voice system, currently at [`https://github.com/aradhyapratapconnect-cell/Random-Projects/tree/main/kyclius-voice-standalone`](https://github.com/aradhyapratapconnect-cell/Random-Projects/tree/main/kyclius-voice-standalone), is not merged directly into `main`.** Instead:

1. Create a dedicated branch off `main` — e.g., `feature/voice-system-integration` — and pull the verified standalone code from the source repo above into that branch first, adapting it to the real codebase's file layout, real `providers` table (not the standalone build's mocked data layer), and real Electron main/preload/renderer wiring.
2. Run the standalone build's demonstration harness (`npm run verify`) **again inside this integration branch**, not just in the original standalone repo, since the whole point of re-running it here is to catch anything that breaks specifically during integration (real IPC wiring, real provider data, real audio devices) that the standalone mocks couldn't have caught.
3. Manually test the integration branch's build for the specific symptoms already known to be broken in the current `main` (EF-08 poor pronunciation, EF-09 voice latency) — confirm those are actually resolved by the new voice system before merging, not just "the new code is in."
4. Only after both (2) and (3) pass does `feature/voice-system-integration` get merged into `main` — via a normal PR/review step even if you're the only contributor right now, so there's a clean point-in-time record of what changed.
5. If integration reveals the standalone architecture needs changes, make them on the integration branch — `main` stays on the current (known-broken-but-working-enough-to-test) voice implementation until the replacement is actually verified end-to-end, so there's always a working `main` to fall back to.

**Why this matters given EF-08/EF-09 specifically:** the current in-app TTS's pronunciation and latency problems might already be fully solved by the standalone system sitting unmerged — or they might not be, if the standalone system's mocks hid something that only shows up against real model weights and real audio hardware. Don't close EF-08/EF-09 until the merged-and-tested version is confirmed to fix them; "we built a new voice system" and "the bug is fixed" are two different claims until step 3 above actually happens.