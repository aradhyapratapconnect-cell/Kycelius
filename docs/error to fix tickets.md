# Kyclius — Error to Fix Tickets (EF-01 to EF-04)

**Version:** 2.6.1 (bugfix pass)
**Status:** Ready for implementation
**Context:** These bugs were found during manual testing after the T-22 UI/UX pass. They regress against behavior already specified in `01_PRD.md`, `04_FRONTEND_SPEC.md`, and `05_AGENT_TOOL_EXECUTION_SPEC.md` — this document does not introduce new product decisions, it corrects implementation drift from the existing spec. Evidence for each bug is a screen recording / screenshot from the live app.

---

## EF-01 — Sending a message from the home screen jumps straight into the full Conversation view instead of staying on the home screen

**Observed behavior:** Typing a message on the home screen and hitting send immediately replaces the entire home screen with the persistent left sidebar + a separate "Conversation" panel (with its own header, back arrow, and "New conversation" button). The ambient home screen (video background, "Hello." greeting, quick-action pills) disappears entirely.

**Clarified expected behavior (confirmed by product owner):**
- The home screen — video background, greeting, everything — must **stay visible and playing**. Asking a question never navigates away from it.
- The answer is delivered **orally** (TTS) as the primary channel.
- On screen, the exchange shows only as a **small inline element right where the question was asked** — i.e., in/near the command bar area itself (a compact response strip, toast, or expanding line under the input) — **not** a full chat transcript, and **not** the Conversation panel opening.
- The full sidebar + dedicated "Conversation" view (with history, back arrow, "New conversation" button) should only ever appear when the user **explicitly** navigates to it — e.g., clicking "Conversations" in the top nav/sidebar — never as a side effect of simply asking something from the home screen.

**Fix:**
- Remove any auto-navigation to a Conversation route/panel on message send from the home screen.
- Add a compact inline response surface anchored to the command bar (expands/collapses with the exchange, home screen and video remain untouched behind it).
- Trigger TTS playback of the answer as the default behavior for this inline flow (ties into EF-04 below — this can't be verified as fully fixed until voice output actually works).
- The existing full Conversation panel/sidebar navigation stays exactly as-is for when the user deliberately opens it from Conversations/Activity/Memory/Dashboard — this ticket only changes what happens on a home-screen ask, not the dedicated views themselves.

**Acceptance criteria:**
- Asking a question from the home screen never changes the route/screen — video keeps playing, greeting and quick-action pills remain.
- The question/answer appears only as a small element near the input, not a transcript panel.
- The answer is spoken aloud.
- Opening the full Conversation view still works, but only via explicit navigation, never automatically.

---

## EF-02 — Downloading the STT model from Hugging Face fails with `401 Unauthorized`

**Observed behavior:** In Settings → Voice, clicking "Download" for either Large v3 Turbo or Small shows: `Failed to download https://huggingface.co/ggml-org/whisper/resolve/main/ggml-large-v3-turbo-q5_0.bin: 401 Unauthorized`.

**Confirmed by product owner:** this happens **every time**, not intermittently — so treat this as a code/request bug first, not a transient Hugging Face rate limit or outage. A consistent 401 on what should be a public model repo almost always means something in the request itself is wrong (bad/expired token being sent when none is needed, wrong repo path resolving to a private/gated mirror, or a malformed request header) rather than an HF-side access problem.

**Fix:**
- Log the exact outgoing request (full URL + all headers, redacting nothing since no real secret should be involved in a public download) before changing anything else — confirm whether an `Authorization` header is being sent at all, and if so, why.
- Verify the exact Hugging Face repo path is correct and does not require authentication (most `ggml-org` GGUF/GGML mirrors are public — confirm this specific repo isn't gated or renamed).
- If a token is being sent, check where it's coming from (leftover config, incorrectly reused GitHub/API-key logic, etc.) and remove it if this repo needs no auth.
- Add clear error surfacing per `03_SECURITY_ACCESS.md`'s Error Handling Guide — the raw error is acceptable to show, but pair it with a plain-language line the user can act on (e.g., "Couldn't download the model — check your connection or try again later").
- Add retry logic with backoff once the underlying request is confirmed correct.

---

## EF-03 — Navigating to Activity/Memory/Dashboard/Settings from the sidebar or top nav makes it impossible to return to the home screen

**Observed behavior:** Once inside the Conversation panel (or presumably Activity/Memory/Dashboard), the back arrow next to "Conversation" does not navigate back to the home screen — clicking it repeatedly produces no change in the UI.

**Expected behavior (per `04_FRONTEND_SPEC.md` §5):** The home screen is a distinct, reachable state — the persistent sidebar and other views exist "for every view except the home screen." There must always be a way back to it.

**Fix:**
- Wire the back arrow (and/or a "Home"/logo click target in the sidebar header, which is a common convention) to actually navigate back to the home screen route/state.
- Confirm this works from every one of the sidebar destinations (Conversations, Activity, Memory, Dashboard), not just the Conversation panel where it was observed.
- Add a lightweight navigation/route test so this can't silently regress again (this is a basic routing bug, not a logic-heavy feature, so it should have direct test coverage).

**Acceptance criteria:** From any sidebar-attached view, there is at least one always-visible, working control that returns the user to the ambient home screen.

---

## EF-04 — Voice pipeline (TTS output, mic input, and no-model fallback) non-functional — merged root-cause ticket

**Merged per product owner's direction:** these three symptoms are being treated as one investigation, since they very likely share a root cause (no STT/TTS model actually loaded), rather than three independent bugs to fix in isolation.

### Symptom A — Assistant responses only show as text; TTS never plays
After sending a message, the assistant's reply appears as text with a timestamp and provider label ("via openrouter · openrouter/free"), but nothing is spoken aloud and there's no speaker/waveform indicator on the message.

### Symptom B — Microphone doesn't capture anything
**Confirmed by product owner:** clicking the mic button **does** trigger a visual/animated "listening" state (so the button itself is wired correctly) — but no speech is ever actually captured, even when the user speaks clearly, and staying silent doesn't cause any timeout/cancel behavior either. The interaction simply never progresses to a transcribed message or a started conversation. This points at the capture/transcription pipeline underneath the button, not the button's UI wiring.

### Symptom C — No fallback when no STT/TTS model is available
When the Whisper download fails (EF-02), there's no working voice path at all — the "System" engine toggle exists in the UI (see screenshot) but it's unverified whether it actually works as a real fallback right now.

**Expected behavior (per `01_PRD.md`, `04_FRONTEND_SPEC.md` §6, `03_SECURITY_ACCESS.md` Error Handling Guide, and `02_TECHNICAL_ARCHITECTURE.md` note 12):**
- Every assistant response should be spoken via TTS **and** shown as text by default — voice is the default presentation, not opt-in.
- Voice input should reliably capture and transcribe speech, and silence/no-speech should resolve to a clear "didn't catch that" state rather than hanging indefinitely.
- If no local model is loaded (download failed or never run), the app should fall back to the OS-native/System engine for both STT and TTS, per the already-documented Kokoro fallback behavior in the Technical Architecture doc — never leave voice completely dead.

**Recommended investigation order (root cause first, then symptoms):**
1. **Check model-load state first.** Confirm whether *any* STT model (local Whisper or System) and *any* TTS model (Kokoro or OS-native) is actually loaded and ready right now. Given EF-02's download always fails, it's plausible nothing has ever loaded successfully — that alone could explain both Symptom A and Symptom B.
2. **Fix the fallback (Symptom C) first**, so there's always a working engine to test against: if no local Whisper model is present/loaded, automatically switch to the System STT engine rather than leaving it dangling; same for TTS → OS-native. Surface a clear, non-blocking message when a fallback is active (e.g., "Using your system's voice engine until the local model finishes downloading").
3. **Re-test Symptom A (TTS) and Symptom B (mic capture) against the fallback engine.** If they start working once a real engine is loaded, the root cause was simply "no engine was ever active" and both symptoms close together.
4. **If mic capture still fails even with a working STT engine loaded**, then separately debug: OS-level microphone permission actually being requested/granted (per `01_PRD.md` step 1's one-time mic permission prompt — confirm the prompt has ever fired), the audio stream actually reaching the STT service, and whether silence/no-speech is given a timeout that surfaces "didn't catch that, try again" instead of hanging forever with no feedback.
5. **If TTS still fails even with a working engine loaded**, separately debug the response→TTS trigger path and add the missing speaker/waveform UI element with stop control per the Frontend Spec.

**Acceptance criteria:**
- A fresh install, or one where the local model download has failed, always has *some* working STT and TTS engine (system fallback), clearly indicated to the user.
- Speaking into the mic reliably produces a transcribed message that starts/continues the conversation.
- Staying silent after opening the mic resolves to a clear "didn't catch that" state within a reasonable timeout, never an indefinite hang.
- Every assistant response is both shown as text and spoken aloud by default.

---

## Suggested execution order

1. **EF-02** first — it's a consistent, reproducible request bug (not flaky), and its outcome (a working model download) unblocks real testing of EF-04.
2. **EF-04**, in the internal order laid out in that ticket (fallback → re-test → targeted debugging of whichever symptom remains).
3. **EF-01** and **EF-03** are independent navigation/UI bugs and can be fixed in parallel with the above at any time.

All open clarifying questions from the previous draft have been answered and folded into the tickets above.