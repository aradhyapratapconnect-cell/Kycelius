# Kyclius — Frontend Specification Document

**Version:** 2.8.1 (supersedes 2.7.1)
**Status:** Pre-development

**Changelog from 2.7.1:**
- Added the Conversation History Preview modal (new feature, T-27).
- Noted that the command bar focus outline (EF-06, specified as fixed in v2.7.1) is confirmed **still broken** as of this version's testing evidence — carried forward as still-open, not re-described as new.
- Added a UI-level requirement tied to EF-10: a visible "taking longer than expected" state before any operation could appear frozen, so a slow call is distinguishable from a hung app.

---

## 1–4. (Design Direction, Color Palette, Typography, Component Styles)

Unchanged from 2.7.1 — see that version for full text, with one correction:

**EF-06 status update:** the 2.7.1 Frontend Spec specified the command bar's focus state as fixed (soft `--color-leaf-soft`/`--color-blossom` glow replacing the hard blue outline). Testing evidence from this version shows **the hard blue rectangular outline is still present** — this was either not actually implemented, or regressed. This is carried forward as an open bug (still EF-06, not renumbered) rather than treated as new — flag to whoever implements it that the fix specified in 2.7.1 needs to actually be verified in a running build, not just marked complete in a ticket tracker.

---

## 5. Spacing & Layout Rules

Unchanged from 2.7.1, plus one new requirement tied to EF-10:

**"Taking longer than expected" state (NEW).** Any operation using the existing "Thinking" composer state (per Section 6 of the 2.7.1 Frontend Spec) must transition to a distinct, still-calm-but-clearly-different visual state if it exceeds a short threshold (recommend ~8–10 seconds, well above normal streaming time-to-first-token but well below what would read as a freeze) — e.g., the pulse slows and a small "still working — tap to cancel" affordance appears. This is a UI requirement independent of whatever the actual EF-10 root cause turns out to be: even after the freeze itself is fixed, any future slow call should never look identical to a hung app with no way to tell the difference or cancel.

---

## 6. Conversation History Preview (New Feature — T-27)

**Trigger:** Tapping a conversation entry in the Conversations list (sidebar) opens this preview, rather than immediately navigating into the full Conversation view.

**Confirmed:** this is an **in-app modal overlay**, not a separate OS-level window — matching the existing Settings modal pattern already used elsewhere in Kyclius (floating glass panel, centered over whatever screen is behind it). No new Electron `BrowserWindow` or separate preload surface is needed for this feature.

**Layout (as an in-app modal):**
- Centered overlay, narrower than the full Conversation view (~560px max-width) and capped at a reasonable viewport height (~70vh) with internal scroll — "small window" in spirit, using the existing Modal component treatment (`--color-mist` background, 16px radius) rather than a full-screen takeover.
- **Header:** the conversation's title (matching `conversations.title`) and its creation date, plus a close (×) control and an "Open full conversation" link/button that navigates into the real Conversation view if the user wants to continue it from here.
- **Body:** the full scrollback for that conversation, rendered using the same message-bubble styling as the live Conversation view, but read-only in this context — no command bar, since this is a preview, not an active session (opening the full Conversation view is how the user actually continues chatting, per the "Open full conversation" control above).
- **Per-message copy control:** each message row gets a small copy icon (consistent with the Ghost/icon button style) that copies just that message's text.
- **Copy-all control:** a single control in the header or footer that copies the entire visible transcript as plain text (question/answer pairs, in order) to the clipboard.
- **Does not affect the main app's navigation state:** opening and closing this preview never changes what's behind it — if the user had the home screen open, it's still the home screen once the preview closes; if they were inside Activity/Memory/Dashboard, they're still there. This is a strict overlay, not a route change.

**Interaction:** clicking outside the modal, pressing Escape, or the close control all dismiss it the same way. Opening a second conversation's preview while one is already open replaces its content rather than stacking modals.