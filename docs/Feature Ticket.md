# Kyclius — Feature Ticket List

**Version:** 2.6.1
**Source:** Derived from Kyclius PRD v2.6.1
**Format note:** Each ticket is written so it can be pasted directly into an AI coding tool (Claude Code, Cursor, etc.) as a self-contained task prompt. Tickets are grouped into **Foundation** (infrastructure every feature depends on) and **Features** (mapped to the PRD's Must-Have / Nice-to-Have lists), then ordered so dependencies come before what depends on them.

---

## How to read a ticket
- **Priority:** `Must-have` (blocks launch), `Should-have` (strongly desired, launch can slip a little without it), `Nice-to-have` (explicitly post-MVP per the PRD)
- **Depends on:** Other ticket IDs that must be functionally complete first
- **Acceptance criteria:** Written as testable, observable outcomes — a ticket is "done" only when every box is true

---

## FOUNDATION TICKETS

### F-01 — Project Scaffolding & Electron App Shell
**Priority:** Must-have
**Depends on:** None

**Description:** Set up the base Electron + React + TypeScript + Tailwind CSS project. Configure the main/preload/renderer process split per Electron's security model (context isolation on, node integration off in the renderer). Set up Vite for the renderer build, ESLint + Prettier, and a basic window that opens on launch.

**Ticket prompt for AI coding tool:**
> Scaffold a new Electron + TypeScript + React + Tailwind CSS desktop app named "kyclius". Use Vite to build the renderer. Enable `contextIsolation: true` and `nodeIntegration: false` on the BrowserWindow. Create the folder structure: `src/main/`, `src/preload/`, `src/renderer/`, `src/shared/`. Set up ESLint and Prettier with a standard TypeScript config. The app should launch to a blank window with a placeholder "Kyclius" heading rendered from React, proving the renderer, preload bridge, and main process are wired together correctly.

**Acceptance criteria:**
- [ ] `npm run dev` launches a working Electron window on Windows, macOS, and Linux
- [ ] Renderer process has zero direct Node.js/OS API access (verified: `window.require` is undefined in the renderer devtools console)
- [ ] A basic `contextBridge` API is exposed from preload and callable from React
- [ ] Lint and format scripts run clean on a fresh checkout

---

### F-02 — IPC Bridge & Security Boundary
**Priority:** Must-have
**Depends on:** F-01

**Description:** Build the `preload.ts` `contextBridge` API that will be the *only* channel between the renderer (UI) and the main process (OS access). Every function exposed here should be explicit and typed — no generic "run arbitrary IPC message" passthrough.

**Ticket prompt for AI coding tool:**
> In `src/preload/preload.ts`, create a `contextBridge.exposeInMainWorld('kyclius', {...})` API with explicitly typed methods (start with stubs: `sendCommand`, `getMemory`, `getToolHistory`). Define the shared TypeScript types for these calls in `src/shared/types/ipc.ts` so both main and renderer import the same types. Do not expose a generic `ipcRenderer.send`/`invoke` passthrough — every capability must be its own named, typed function on the bridge object.

**Acceptance criteria:**
- [ ] No generic/unscoped IPC channel is exposed to the renderer
- [ ] Every bridge method has a TypeScript type shared between main and renderer
- [ ] Calling an exposed method from the React devtools console round-trips to a stub handler in main and back

---

### F-03 — SQLite Database & Schema Setup
**Priority:** Must-have
**Depends on:** F-01

**Description:** Set up `better-sqlite3` in the main process, pointed at a file under Electron's `app.getPath('userData')`. Implement the schema from the Technical Architecture Document: `conversations`, `messages`, `memory_facts`, `tool_executions`, `user_config`, `cloud_sync_state`. Add a lightweight migration runner so schema changes are versioned.

**Ticket prompt for AI coding tool:**
> Set up `better-sqlite3` in the Electron main process. Store the database file at `app.getPath('userData')/kyclius.db`. Create migration files implementing these tables with these exact fields: `conversations(id, title, created_at, updated_at)`, `messages(id, conversation_id, role, content, created_at)`, `memory_facts(id, key, value, source, created_at, updated_at)`, `tool_executions(id, message_id, tool_name, parameters, permission_tier, status, result, created_at)`, `user_config(key, value)`, `cloud_sync_state(supabase_user_id, last_synced_at, sync_enabled)`. Write a simple migration runner that applies any unapplied `.sql` files in order and records applied migrations in a `_migrations` table. Add basic typed query helper functions for each table (insert, get by id, list, update, delete).

**Acceptance criteria:**
- [ ] Database file is created automatically on first launch, in the correct OS-specific user data directory
- [ ] All six tables exist with the fields specified above
- [ ] Migration runner does not re-apply an already-applied migration on subsequent launches
- [ ] Typed helper functions exist for basic CRUD on each table and are unit tested

---

### F-04 — LLM Provider Integration Layer (Groq + OpenRouter, BYOK)
**Priority:** Must-have
**Depends on:** F-02, F-03

**Description:** Build a provider-agnostic LLM client interface (`llmRouter.ts`) with concrete implementations for Groq and OpenRouter, both using OpenAI-compatible chat completion + tool-calling formats. API keys are entered by the user, encrypted via Electron's `safeStorage`, and never stored in plain text.

**Ticket prompt for AI coding tool:**
> Create `src/main/llm/llmRouter.ts` defining an `LLMProvider` interface with a method like `chatCompletion(messages, tools): Promise<LLMResponse>`. Implement `groqClient.ts` and `openRouterClient.ts` against this interface, each calling their respective OpenAI-compatible `/chat/completions` endpoint with the user's API key in the `Authorization` header. Store and retrieve API keys using Electron's `safeStorage` API (encrypt before writing to the `user_config` table, decrypt only in-memory when making a call — never log or persist the decrypted value). Add a settings function to switch the active provider.

**Acceptance criteria:**
- [ ] Both Groq and OpenRouter can be configured with a user-supplied key and successfully return a chat completion
- [ ] API keys are never written to disk in plain text (verified by inspecting the SQLite file directly)
- [ ] API keys never appear in console logs or error output
- [ ] Switching the active provider in settings takes effect on the next request without an app restart

---

### F-05 — Tool Execution Engine & Tool Registry
**Priority:** Must-have
**Depends on:** F-02, F-03

**Description:** Implement the `toolRegistry.ts` and the core execution pipeline described in the Agent & Tool Execution Specification: parse LLM tool calls, validate against registered schemas, and dispatch to the correct handler. This ticket is the plumbing only — individual tool handlers (open app, create file, etc.) are separate tickets below.

**Ticket prompt for AI coding tool:**
> Implement `src/main/tools/toolRegistry.ts` exporting a `ToolDefinition` interface (`name`, `description`, `parameters` as a JSON schema, `permissionTier: 'auto' | 'confirm_required'`, `handler`). Build a `registerTool()` function that fails at startup if a tool is registered without an explicit `permissionTier` (no silent default). Build an `executeToolCall(toolName, rawParams)` function that: (1) looks up the tool, (2) validates `rawParams` against the tool's JSON schema before calling the handler, (3) enforces a configurable timeout on the handler call, (4) writes a row to `tool_executions` with the result. Do not implement any actual tool handlers in this ticket — use two fake test tools (one `auto`, one `confirm_required`) to prove the pipeline works end to end.

**Acceptance criteria:**
- [ ] Registering a tool without a `permissionTier` throws at startup, not silently defaulting
- [ ] Calling `executeToolCall` with invalid parameters (wrong type/missing required field) is rejected before the handler runs
- [ ] A hung handler is killed after its timeout and recorded as `failed`
- [ ] Every execution attempt (success or failure) produces a row in `tool_executions`

---

### F-06 — Permission Engine & Confirmation Queue
**Priority:** Must-have
**Depends on:** F-05

**Description:** Implement the logic that decides whether a validated tool call proceeds immediately (`auto`) or is queued for user confirmation (`confirm_required`), and the mechanism for the renderer to receive and respond to pending confirmations one at a time.

**Ticket prompt for AI coding tool:**
> Implement `src/main/permissions/permissionEngine.ts` and `confirmationQueue.ts`. When `executeToolCall` (from F-05) is invoked, `permissionEngine` checks the tool's `permissionTier`. If `auto`, execution proceeds immediately. If `confirm_required`, the call is pushed onto `confirmationQueue`, a typed event is sent to the renderer over the IPC bridge (from F-02) containing the tool name and full parameters, and execution pauses until the renderer calls back with `approve`, `edit`, or `deny`. If a response contains edited parameters, re-validate them against the tool's schema before executing. Multiple pending confirmations must be surfaced and resolved individually, never batched into one approval.

**Acceptance criteria:**
- [ ] An `auto` tool call never triggers a confirmation event
- [ ] A `confirm_required` tool call does not execute until an explicit `approve` (or `edit`+approve) is received
- [ ] A `deny` response results in a `denied` status in `tool_executions` and no execution
- [ ] Two `confirm_required` calls queued at once are presented and resolved as two separate confirmations, not one combined approval

---

### F-07 — Speech-to-Text & Text-to-Speech Engine Integration
**Priority:** Must-have
**Depends on:** F-01

**Description:** Voice is now the primary interaction mode, so this ticket builds the core STT (speech-to-text) and TTS (text-to-speech) plumbing that every voice-facing feature depends on. Both run locally/offline by default, per the Technical Architecture Document.

**Ticket prompt for AI coding tool:**
> In `src/main/voice/`, implement `sttService.ts` wrapping `faster-whisper` (CTranslate2 backend, free, MIT-licensed) running the **large-v3-turbo** model by default, transcribing a live audio stream to text in-memory — never write raw audio to disk. Add a Settings-exposed option to step down to the `small` model for low-end hardware where large-v3-turbo is too slow. Implement `ttsService.ts` wrapping **Kokoro-82M** (Apache 2.0, free, CPU-capable) by default to synthesize a given text string to spoken audio, entirely in-memory/streamed — never OS-native voices as the primary path, since they sound noticeably worse. Add a Settings option to switch to **Chatterbox** (MIT-licensed) for users who want higher voice quality and have the hardware for it. Expose both through the IPC bridge (F-02) as `kyclius.startListening()` / `kyclius.stopListening()` (streaming transcript events back to the renderer as they're recognized) and `kyclius.speak(text)`. Add microphone permission handling with a clear, actionable error if permission is denied.

**Acceptance criteria:**
- [ ] Speaking into the microphone produces a live, incrementally-updating text transcript in the renderer within roughly a second of speech, at accuracy noticeably better than a small/base Whisper model would give
- [ ] `kyclius.speak(text)` produces natural-sounding audible speech (Kokoro by default) through the system's default output device — not a robotic OS-voice sound
- [ ] Switching the STT model size or the TTS engine in Settings takes effect on the next request without an app restart
- [ ] No raw audio file or buffer is ever written to disk at any point in either path
- [ ] Denied microphone permission surfaces a clear on-screen message and does not crash or silently disable the app
- [ ] STT and TTS both function fully offline (no network call required for either)

---

### F-08 — Voice Confirmation Listener
**Priority:** Must-have
**Depends on:** F-06, F-07

**Description:** The narrowly-scoped listener that lets a `confirm_required` action be approved or cancelled by voice, as an equal alternative to clicking, per the Agent & Tool Execution Specification (Step 5a) and the Security & Access Document (Section 3).

**Ticket prompt for AI coding tool:**
> Implement `src/main/voice/voiceConfirmationListener.ts`. When `confirmationQueue` (F-06) surfaces a pending confirmation, this listener opens a short, bounded listening window (configurable timeout, e.g., 15s) scoped to that one specific pending action — it must not be a general always-on command channel. Match recognized speech against a small fixed set of affirmative phrases ("okay", "continue", "yes", "confirm", "send it") to resolve **approve**, and a small fixed set of negative phrases ("cancel", "stop", "no") to resolve **deny**. Anything else recognized, low-confidence, or a timeout with no match must resolve to **not approved** (equivalent to deny) — never default to approve. Call the exact same resolution handler that a clicked Approve/Cancel button calls (from F-06), so voice and click are two inputs into one code path, not two separate flows. Trigger `ttsService.speak()` (F-07) to read the pending action's content aloud when the window opens.

**Acceptance criteria:**
- [ ] A recognized affirmative phrase within the window resolves the exact same `approve` path as clicking Approve, including audit logging
- [ ] A recognized negative phrase, unrecognized speech, or a timeout all resolve to not-approved — none of them ever execute the action
- [ ] The listening window is closed and inactive as soon as the confirmation resolves (by voice or by click) — it never lingers listening after resolution
- [ ] Two sequential confirmations never share or leak into each other's listening window

---

### F-09 — Wake Word Background Listener
**Priority:** Must-have
**Depends on:** F-01, F-07

**Description:** Always-on, local-only background listener for the configured wake word, per the Security & Access Document, Section 6.

**Ticket prompt for AI coding tool:**
> Install `openWakeWord` (or equivalent free, offline, open-source wake-word engine). Implement `src/main/voice/wakeWordService.ts` running as a background process independent of the main window's visibility — keep the app alive via a system tray/menu-bar icon when the window is closed, with an unambiguous "Quit" option that fully stops the process. Process incoming audio in a rolling in-memory buffer only; never write raw audio to disk or send it over the network at any point in this service. On a wake-word match, call `ttsService.speak("How can I help you?")` (F-07), surface/focus the app window, and hand off to the normal command-listening flow (T-01). Store the configured wake phrase (default "Hey Kyclius") in `user_config`, editable via Settings, with a lightweight validation warning (not a hard block) for phrases that are very short or a common word.

**Acceptance criteria:**
- [ ] Saying the configured wake phrase while the app is minimized/unfocused triggers the spoken reply and brings the app forward
- [ ] No audio buffer or file is ever persisted to disk by this service
- [ ] Disabling the background-listening Settings toggle immediately and fully stops the background process, not just hides its effects
- [ ] Revoked microphone permission is detected and clearly surfaced, not failed silently
- [ ] Changing the wake phrase in Settings takes effect without requiring an app restart

---

### F-10 — Voice Biometrics (Speaker Verification)
**Priority:** Must-have
**Depends on:** F-03, F-07

**Description:** Local speaker-verification enrollment and matching, gating both command issuance and confirmation approval, per the Security & Access Document, Section 5.

**Ticket prompt for AI coding tool:**
> Implement `src/main/voice/speakerVerificationService.ts` using `SpeechBrain`'s ECAPA-TDNN model via `onnxruntime-node` (free, open source, fully offline). Provide `enroll(audioSamples): Promise<void>` — records 3–5 short phrases, generates a voiceprint embedding, and stores it in the `voice_profiles` table using the same `safeStorage`-backed encryption pattern as API keys (F-04) — never store raw audio. Provide `verify(audioSample): Promise<{ matched: boolean; confidence: number }>` comparing incoming audio against the stored embedding via cosine similarity against a configurable threshold; a low-confidence result must resolve to `matched: false` (fail closed), never guess yes. Wire `verify()` into both the command-issuance path (T-01) and the voice-confirmation path (F-08) — an unmatched voice is surfaced back to the user as unrecognized in both cases, with a clear fallback to typed/click interaction. Provide a `removeEnrollment()` function that deletes the stored embedding outright.

**Acceptance criteria:**
- [ ] Enrolling and then speaking a command/confirmation in the same voice succeeds
- [ ] A different voice speaking the same command/confirmation is rejected as unrecognized on both the command-issuance and confirmation paths
- [ ] No raw audio from enrollment or verification is ever written to disk
- [ ] `removeEnrollment()` fully deletes the stored voiceprint, and Kyclius immediately reverts to accepting any voice, exactly as if biometrics had never been enrolled
- [ ] A low-confidence match never resolves to `matched: true`

---

### F-11 — Autonomous Mode & Multi-Step Planner
**Priority:** Must-have
**Depends on:** F-03, F-04, F-05, F-06

**Description:** The per-tool risk-tolerance configuration and the multi-step planning layer, per the Security & Access Document, Section 4, and the Agent & Tool Execution Specification's Step 3a/5.

**Ticket prompt for AI coding tool:**
> Implement the `autonomous_mode_config` table (F-03's migrations) and a `src/main/agent/planner.ts` module. `planner.ts` exposes a function that, given a user goal requiring multiple tool calls, prompts the LLM (via `llmRouter.ts`, F-04) to return an ordered list of proposed tool calls with brief reasons, writes it to a new `agent_plans` row (`status: planning`), then iterates the list — routing each step through the *existing* `executeToolCall`/`permissionEngine` pipeline (F-05/F-06) unchanged. Extend `permissionEngine.ts` so that, for a `confirm_required` tool, it also checks `autonomous_mode_config.tool_overrides[toolName] === "auto"` **and** `autonomous_mode_config.enabled === true` before skipping confirmation — both conditions required, tool-by-tool, never a single blanket switch. Enforce `max_plan_steps` and `max_plan_duration_seconds` as hard ceilings, stopping and updating `agent_plans.status` to `stopped_by_limit` if exceeded. A step that isn't auto-approved pauses the plan for a normal confirmation (F-06/F-08) and resumes on response. Support cancelling a running plan mid-execution (by voice "stop" or a UI control), updating `status` to `stopped_by_user`.

**Acceptance criteria:**
- [ ] With Autonomous Mode off, no tool ever skips confirmation, regardless of `tool_overrides` content
- [ ] With Autonomous Mode on, only tools explicitly marked `"auto"` in `tool_overrides` skip confirmation — everything else still pauses normally, including mid-plan
- [ ] A plan exceeding `max_plan_steps` or `max_plan_duration_seconds` stops and is marked `stopped_by_limit`, reporting which steps completed
- [ ] A plan can be cancelled mid-run, halting further steps and marking `stopped_by_user`
- [ ] Every step of a plan produces its own `tool_executions` row, identical in shape to a non-plan action
- [ ] Changing a tool's override mid-plan affects only steps not yet permission-checked, never steps already past that check

---

## FEATURE TICKETS (Must-Have — v2.6.1, per PRD Section 5 & 7)

### T-01 — Voice-First Command Input (with Typed Fallback)
**Priority:** Must-have
**Depends on:** F-01, F-04, F-07

**Description:** The primary way the user gives Kyclius a request is by speaking; a typed command bar remains available as a fallback and for accessibility, both feeding the same submission path.

**Ticket prompt for AI coding tool:**
> Build a `CommandBar` React component with a mic button as the primary affordance: tapping/holding it (or a wake word, if enabled) calls `kyclius.startListening()` (F-07) and streams the live transcript into the input as text, pulsing the mic icon while active. A standard text input remains always clickable/typeable as a fallback — both paths converge on the same `kyclius.sendCommand(text)` bridge call once finalized (Enter for typed, end-of-speech detection for voice). Show a disabled/loading state while a request is in flight, and support a global keyboard shortcut (configurable, default `Cmd/Ctrl+K`) to focus/activate the command bar from anywhere in the app.

**Acceptance criteria:**
- [ ] Speaking a command shows the live transcript as it's recognized, then submits it once speech ends, without requiring a manual button press to "send" (a manual stop/send control is still available)
- [ ] Typing and pressing Enter sends a command exactly as before, unaffected by the voice path
- [ ] Input/mic control is disabled (not hidden) while awaiting a response, with a visible loading indicator
- [ ] Global shortcut activates the command bar regardless of which panel is open
- [ ] Empty/silent submissions are ignored (no empty message sent)

---

### T-02 — Home Screen with Animated Scenery Background (No Blob/Mascot)
**Priority:** Must-have
**Depends on:** F-01

**Description:** The idle/ambient home screen using the looping scenery video as the environment, with status communicated through subtle indicators on ordinary UI elements — no character, blob, or mascot — per the Frontend Specification, Section 6 (Status & Presence Indicators). This ticket replaces an earlier direction that used a 3D `OrisonNatureBlob` component; that component and its dependencies (`three`, `@react-three/fiber`, `@react-three/drei`) are dropped entirely.

**Ticket prompt for AI coding tool:**
> Build a `SceneryBackground` component rendering `src/renderer/assets/background-scenery.mp4` as a full-bleed, looped, muted, autoplaying `<video>` element (`preload="auto"`) behind all other UI. Build a `HomeScreen` component layering the composer and minimal top navigation over it as translucent glass panels (`backdrop-filter: blur()`, subtle border, soft shadow per the Frontend Spec's Component Styles), with a subtle dark overlay applied only where needed for text legibility — never a flat scrim over the whole scene. Wire the app's central assistant-state value (`idle | listening | thinking | awaiting_confirmation | executing | speaking | error`) into the composer's border/glow and mic-button waveform per the Frontend Spec's Status & Presence Indicators table, rather than into any separate character component. Do not install or reference `three`, `@react-three/fiber`, or `@react-three/drei` — they are not needed for this UI.

**Acceptance criteria:**
- [ ] The scenery video plays on loop, muted, starting automatically with no user interaction required, on Windows, macOS, and Linux
- [ ] No blob, orb, or character component exists anywhere in the codebase or renders on screen
- [ ] Changing the app's assistant-state value visibly changes the composer's indicator (border glow, waveform, etc.) within roughly one second, matching the Frontend Spec's per-state table
- [ ] Text and controls remain legible over every part of the video without a flat overlay dulling the whole scene
- [ ] Background video and glass UI layer correctly together on all three target OS window sizes/aspect ratios, with no blank white space at any size

---

### T-03 — Chat/Workspace View (Hybrid UI Transition)
**Priority:** Must-have
**Depends on:** T-01, T-02

**Description:** The transition from the ambient home screen into an active chat/workspace view when the user starts interacting, per the PRD's "Hybrid UI" requirement.

**Ticket prompt for AI coding tool:**
> Build the transition logic between `HomeScreen` and a `ChatWorkspace` view: on the user's first command in a session, animate/fade the chat view in (over or beside the home screen per the Frontend Spec's hybrid layout), with the command bar persisting in a docked position at the bottom throughout. Chat messages render in a scrollable list, max content width 720px, with distinct styling for user vs. assistant vs. tool-result messages. Every assistant message is spoken aloud via `ttsService.speak()` (F-07) at the same time it's rendered as text — set the shared assistant-state value to `speaking` for the duration so the composer's status indicator (T-02) reflects it, and show a small animated speaker/waveform icon next to the message per the Frontend Spec — with a small mute/stop icon on each assistant message to interrupt playback without affecting the written text. Provide a way to return to the pure ambient home screen (e.g., closing the workspace or starting a new conversation).

**Acceptance criteria:**
- [ ] Sending the first command in a session transitions from home screen to chat view without a jarring layout jump
- [ ] Command bar remains accessible and in the same relative position across both states
- [ ] User, assistant, and tool-result messages are visually distinguishable
- [ ] Every assistant reply is spoken aloud automatically as it's shown, with a working per-message control to stop playback
- [ ] User can return to the ambient home screen state

---

### T-04 — Confirmation Dialog Component (Voice + Click)
**Priority:** Must-have
**Depends on:** F-06, F-08, T-03, T-21

**Description:** The modal UI for `confirm_required` (Ask Every Time) actions, showing exact action content and speaking it aloud, offering Cancel / Allow Once / Always Allow by either voice or click, per the Frontend Spec and Security Document.

**Ticket prompt for AI coding tool:**
> Build a `ConfirmationDialog` React component that listens for pending-confirmation events from the bridge (F-06) and for resolution events from the voice confirmation listener (F-08). On open, trigger `ttsService.speak()` to read the action aloud while simultaneously rendering it on screen. Show the action type in the header (with `--color-danger` styling and a warning icon for `delete_file`/`run_shell_command`, neutral styling otherwise), and the *exact, full, unabbreviated* parameters in the body (monospace font for file paths/shell commands per the Frontend Spec). Show a small mic-pulse indicator with helper text ("Say 'okay' to allow once, 'always allow', or 'cancel' to stop") alongside three actions: **Cancel** (Secondary, non-dominant), **Allow Once** (Primary/Danger depending on risk — approves this instance only), and **Always Allow** (secondary/text-style, beside or beneath Allow Once — approves this instance **and** writes this action's setting to "Always Allow" in the shared permission store from T-21, the same store the Permissions panel reads/writes). For editable action types (email drafts), allow inline editing before the user picks one of the three final actions. All three actions (and their voice equivalents) must call through to the same handlers T-21 uses — no separate one-off "remember this" flag. When resolved by voice, briefly flash the corresponding button's active state before closing so the user has clear visual feedback which of the two approval types was triggered.

**Acceptance criteria:**
- [ ] The full, exact action content is shown on screen — never a truncated or summarized version — and is also spoken aloud via TTS when the dialog opens
- [ ] Shell commands and file paths render in monospace
- [ ] `delete_file` and `run_shell_command` confirmations are visually distinct (danger styling) from lower-risk confirmations
- [ ] Choosing "Allow Once" (by voice or click) executes the action without changing that action's Permissions setting
- [ ] Choosing "Always Allow" (by voice or click) executes the action AND updates the Permissions panel (T-21) to show that action as "Always Allow" from then on
- [ ] Resolving by voice visibly confirms which of the two approval types was taken before the dialog closes
- [ ] Edited content is re-sent and re-validated, not executed as originally proposed
- [ ] Cancel is never the visually dominant option, by voice framing or by button styling

---

### T-05 — Tool: Open Application
**Priority:** Must-have
**Depends on:** F-05

**Description:** `open_application` tool — launches an installed application by name, OS-aware.

**Ticket prompt for AI coding tool:**
> Implement `src/main/tools/openApp.ts` registering an `open_application` tool with `permissionTier: 'auto'`. Parameters: `{ appName: string }`. Implementation should resolve and launch the named application using the correct OS-specific mechanism (e.g., `open -a` on macOS, `start` on Windows, `xdg-open`/`.desktop` lookup on Linux — using a small cross-platform library such as `open` rather than hand-rolled shell calls where possible). Return a clear error result (not a thrown exception) if the app name can't be resolved.

**Acceptance criteria:**
- [ ] Launches a known installed app by name on Windows, macOS, and Linux
- [ ] An unresolvable app name returns a typed failure result with a clear message, not a crash
- [ ] Tool never falls through to running an arbitrary shell command as a workaround

---

### T-06 — Tool: Create File
**Priority:** Must-have
**Depends on:** F-05

**Description:** `create_file` tool — creates a new file with given content at a specified or sensible default path.

**Ticket prompt for AI coding tool:**
> Implement `src/main/tools/createFile.ts` registering a `create_file` tool with `permissionTier: 'auto'`. Parameters: `{ path?: string, filename: string, content: string }`. If `path` is omitted, default to a `Kyclius` subfolder under the OS's Documents directory (create it if missing). Fail clearly (typed error, not a thrown exception) on: path traversal attempts outside allowed directories, disk full, or a file that already exists at that exact path (do not silently overwrite).

**Acceptance criteria:**
- [ ] Creates a file with correct content at the resolved path
- [ ] Refuses to overwrite an existing file at the same path without a separate, explicit instruction to do so
- [ ] Rejects path traversal outside the intended directory scope
- [ ] Returns the final resolved absolute path in the result, so the assistant can accurately tell the user where the file went

---

### T-07 — Tool: Draft & Send Email
**Priority:** Must-have
**Depends on:** F-05, F-06, T-04

**Description:** Drafting is `auto`; sending is `confirm_required`. This release uses the OS's default mail client (`mailto:`), per the Technical Architecture Document.

**Ticket prompt for AI coding tool:**
> Implement `src/main/tools/sendEmail.ts` registering a `send_email` tool with `permissionTier: 'confirm_required'`. Parameters: `{ to: string, subject: string, body: string }`. Validate the `to` address format before the confirmation dialog is even shown (reject malformed addresses at the parsing stage, not after user approval). On approval, open the address via the OS default mail handler (`mailto:` URL) pre-filled with subject/body — do not claim delivery; the tool result and the assistant's follow-up message must say "opened in your mail client," not "delivered" or "sent," since Kyclius cannot confirm actual delivery through this method.

**Acceptance criteria:**
- [ ] Malformed recipient addresses are rejected before the confirmation dialog appears
- [ ] Approving the confirmation opens the OS mail client pre-filled with the exact to/subject/body shown in the dialog
- [ ] Tool result and user-facing message never overstate what happened (no false "sent" claim)
- [ ] Denying the confirmation results in no mail client action and a `denied` log entry

---

### T-08 — Tool: Delete File
**Priority:** Must-have
**Depends on:** F-05, F-06, T-04

**Description:** `delete_file` tool, always `confirm_required`.

**Ticket prompt for AI coding tool:**
> Implement `src/main/tools/deleteFile.ts` registering a `delete_file` tool with `permissionTier: 'confirm_required'`. Parameters: `{ path: string }`. Before returning the proposed action for confirmation, verify the file exists and include its resolved absolute path in what's shown to the user. On approval, delete the file and then verify it no longer exists before reporting success (don't assume the OS call succeeded). Reject deletion of paths outside directories the user has plausibly interacted with (avoid allowing deletion of core OS/system paths as a safety backstop).

**Acceptance criteria:**
- [ ] Confirmation dialog shows the exact, full resolved path
- [ ] Success is only reported after verifying the file is actually gone
- [ ] Attempting to delete a system-critical path is refused outright, even with confirmation
- [ ] A file that doesn't exist returns a clear "nothing to delete" result rather than a false success

---

### T-09 — Tool: Run Shell Command
**Priority:** Must-have
**Depends on:** F-05, F-06, T-04

**Description:** `run_shell_command` tool, OS-aware, always `confirm_required`, with full output shown.

**Ticket prompt for AI coding tool:**
> Implement `src/main/tools/runShellCommand.ts` registering a `run_shell_command` tool with `permissionTier: 'confirm_required'`. Parameters: `{ command: string }`. Detect the host OS and use the appropriate shell (`bash`/`zsh` on macOS/Linux, PowerShell or `cmd` on Windows) — never blindly pass a Unix command through on Windows or vice versa; if the LLM proposes a command syntax mismatched to the detected OS, surface that as an error rather than attempting a naive translation. Enforce a hard execution timeout (configurable, default e.g. 30s) and kill the process on timeout. Capture and return full stdout, stderr, and exit code — never summarize or truncate this in the result.

**Acceptance criteria:**
- [ ] Confirmation dialog shows the exact full command text in monospace before execution
- [ ] Full stdout, stderr, and exit code are shown to the user after execution, not just "done"/"failed"
- [ ] A command that exceeds the timeout is killed and reported as timed out, not left hanging
- [ ] Command execution uses the OS-correct shell automatically

---

### T-10 — GitHub Integration (Read + Basic Write)
**Priority:** Must-have
**Depends on:** F-05, F-06, T-04

**Description:** `github_read` (`auto`) and `github_write` (`confirm_required`) tools, covering the PRD's "at least one useful GitHub task" MVP bar.

**Ticket prompt for AI coding tool:**
> Implement `src/main/tools/github.ts` registering two tools: `github_read` (`permissionTier: 'auto'`) for listing/summarizing issues and PRs (`GET /repos/{owner}/{repo}/issues`, `GET /repos/{owner}/{repo}/pulls`), and `github_write` (`permissionTier: 'confirm_required'`) for state-changing actions such as posting a comment (`POST /repos/{owner}/{repo}/issues/{id}/comments`). Store the user's GitHub personal access token using the same `safeStorage` encryption pattern as the LLM API keys (F-04). Handle and distinguish these error cases explicitly: missing/invalid token, rate limit hit, repo/issue not found, network failure — each should produce a distinct, specific user-facing message.

**Acceptance criteria:**
- [ ] `github_read` can list and summarize open issues/PRs for a repo the user specifies, with no confirmation prompt
- [ ] `github_write` (e.g., posting a comment) always requires confirmation showing the exact comment text and target
- [ ] Invalid/expired token, rate limiting, and "repo not found" produce three distinguishably different error messages
- [ ] GitHub token is encrypted at rest using the same mechanism as LLM API keys

---

### T-11 — Local Memory System
**Priority:** Must-have
**Depends on:** F-03, F-04

**Description:** Store and retrieve durable facts the user states, and make relevant facts available to the LLM reasoning step, per the Agent & Tool Execution Spec's context-assembly step.

**Ticket prompt for AI coding tool:**
> Implement `src/main/memory/memoryService.ts` with functions to `getFact(key)`, `setFact(key, value, source)`, `listFacts()`, and `deleteFact(id)` against the `memory_facts` table (F-03). Wire a step into the command pipeline (before the LLM call) that retrieves a small, relevant subset of memory facts (not the entire store) and includes them in the context sent to the LLM. After an LLM response, detect when the exchange revealed a new or corrected durable fact and write it with `source: 'auto_learned'`.

**Acceptance criteria:**
- [ ] A fact stated by the user in conversation ("my default editor is VS Code") is stored and retrievable afterward
- [ ] Only relevant facts are included in LLM context per request, not the entire memory table on every call
- [ ] Facts are tagged with the correct `source` value
- [ ] Updating an existing fact overwrites rather than duplicating a row for the same `key`

---

### T-12 — Memory Panel (View / Edit / Delete)
**Priority:** Must-have
**Depends on:** T-11

**Description:** The UI surface where the user can see and control everything Kyclius remembers, per the PRD's must-have requirement.

**Ticket prompt for AI coding tool:**
> Build a `MemoryPanel` React component: a 360px slide-in side panel (per the Frontend Spec) listing all `memory_facts` as editable cards (key, value, source badge distinguishing `auto_learned` vs `user_added`). Support inline editing of a fact's value, deleting a fact, and manually adding a new fact. All actions call through the bridge to `memoryService` (T-11) and reflect immediately in the UI.

**Acceptance criteria:**
- [ ] Every stored memory fact is visible in the panel with no omissions
- [ ] Editing a fact's value persists to the database and is reflected on next app launch
- [ ] Deleting a fact removes it from the database, not just the UI
- [ ] User-added facts are clearly distinguishable from auto-learned ones

---

### T-13 — Settings Panel (API Keys & Provider Selection)
**Priority:** Must-have
**Depends on:** F-04

**Description:** UI for entering/managing the Groq/OpenRouter API keys and choosing the active provider, plus the GitHub token from T-10.

**Ticket prompt for AI coding tool:**
> Build a `SettingsPanel` React component with a monospace-font input for API key entry (Groq, OpenRouter, GitHub token), each with a show/hide toggle, and a provider selector for which LLM provider is active. Include a link/help text pointing to how to get a free Groq/OpenRouter API key. On save, keys are sent through the bridge to be encrypted and stored (F-04); the panel never receives a previously-stored key back in plain text — only a masked "key is set" indicator.

**Acceptance criteria:**
- [ ] Entered keys are never visible again in plain text after saving, only a masked/confirmed state
- [ ] Switching the active provider takes effect immediately for the next command
- [ ] Missing/unset key state is clearly indicated, blocking chat with a helpful prompt rather than a silent failure
- [ ] Help text/link for obtaining a free API key is present for each supported provider

---

### T-14 — Tool Execution History / Audit Log View
**Priority:** Must-have
**Depends on:** F-05, F-06

**Description:** A reviewable list of everything Kyclius has actually done, reading from `tool_executions`, per the Security & Access Document's transparency requirement.

**Ticket prompt for AI coding tool:**
> Build a `ToolHistoryView` React component listing rows from `tool_executions` (most recent first): tool name, parameters (collapsed by default, expandable to full detail), permission tier, status (`pending`/`confirmed`/`denied`/`success`/`failed`), and timestamp. Support filtering by status and by tool name.

**Acceptance criteria:**
- [ ] Every tool execution attempt (regardless of outcome) appears in the list
- [ ] Full parameters and result/error are viewable on expand, not just a summary
- [ ] Filtering by status and tool name works correctly
- [ ] List updates in near-real-time as new actions occur during the session

---

### T-15 — Cross-Platform Packaging & Distribution
**Priority:** Must-have
**Depends on:** All feature tickets functionally complete

**Description:** Package the app for Windows, macOS, and Linux using `electron-builder`, publish to GitHub Releases.

**Ticket prompt for AI coding tool:**
> Configure `electron-builder.yml` to produce a Windows `.exe` (NSIS installer), a macOS `.dmg`, and Linux `.AppImage` and `.deb` packages from the same codebase. Set up a GitHub Actions workflow (`.github/workflows/release.yml`) that builds all three targets on tag push and attaches the artifacts to a GitHub Release. Document code-signing requirements as a follow-up — a working unsigned build is enough for this ticket to be done; don't block on getting signing certificates set up first.

**Acceptance criteria:**
- [ ] A single tagged commit produces installable artifacts for all three OSes via CI
- [ ] Each artifact installs and launches a working app on its target OS
- [ ] Artifacts are automatically attached to a GitHub Release on tag push
- [ ] Build works without requiring code-signing secrets to be present (falls back to unsigned build)

---

### T-16 — Open Source Release Setup
**Priority:** Must-have
**Depends on:** None (can proceed in parallel with everything else)

**Description:** Repository hygiene required to actually be a usable open-source project, per the PRD's "Open source release" must-have.

**Ticket prompt for AI coding tool:**
> Add a `LICENSE` file (MIT), a `README.md` covering what Kyclius is, setup instructions (including how to get free Groq/OpenRouter API keys), build-from-source steps for each OS, and a screenshot/GIF placeholder section. Add a `CONTRIBUTING.md` with basic PR/issue guidelines. Set up a CI workflow (`.github/workflows/ci.yml`) that runs lint, typecheck, and unit tests on every PR.

**Acceptance criteria:**
- [ ] A new contributor can clone the repo and get a working dev build using only the README
- [ ] LICENSE file is present and correctly identifies the project as MIT-licensed
- [ ] CI runs and blocks merging on lint/typecheck/test failure
- [ ] CONTRIBUTING.md exists with clear PR expectations

---

### T-17 — Q&A Dashboard
**Priority:** Must-have
**Depends on:** F-03, F-07, T-03

**Description:** A dedicated, browsable log of every question asked and answer given, in both written and (on-demand) spoken form, per the Frontend Specification (Section 7) — distinct from the live chat/workspace and from the Tool Execution History (T-14).

**Ticket prompt for AI coding tool:**
> Build a `Dashboard` React component reading from the `messages` table (F-03) via a bridge method: a reverse-chronological list of entry cards, each showing the question text with a `Spoken`/`Typed` badge (from `input_mode`), the answer text below it, a timestamp, and a Listen button. The Listen button calls `ttsService.speak()` (F-07) on that stored answer's text on demand — do not store or play back raw audio, always regenerate speech from the saved transcript. If the exchange has an associated `tool_executions` row, show a compact one-line summary linking to that entry in the Tool Execution History view (T-14) rather than duplicating its detail. Add a text search box filtering across questions and answers, and a filter toggle for `Spoken` vs `Typed` input.

**Acceptance criteria:**
- [ ] Every past exchange appears in the Dashboard, most recent first, surviving app restarts
- [ ] Listen button plays synthesized speech of the stored answer text, not a recording
- [ ] Search filters the visible list by matching text in either the question or answer
- [ ] Spoken/Typed filter correctly narrows the list using `input_mode`
- [ ] An exchange that triggered a tool action shows a linked summary rather than repeating the full tool-execution detail

---

### T-18 — System Tray Icon & Background Listening Indicator
**Priority:** Must-have
**Depends on:** F-09

**Description:** The lightweight, always-visible indicator of Kyclius's background listening state, since the app has no in-window character to represent this while the window is hidden, per the Frontend Spec's note on this.

**Ticket prompt for AI coding tool:**
> Build a system tray/menu-bar icon (a simple abstract mark — e.g., a small leaf or wordmark glyph, not a character/mascot) with three distinct visual states: listening-for-wake-word, actively-processing-a-command, and background-listening-off. Wire it to `wakeWordService.ts` (F-09) state changes. Include a tray context menu with at least: Open Kyclius, Toggle background listening, Quit. Ensure toggling background listening from the tray menu has identical effect to toggling it in the in-app Settings panel (same underlying state, not two separate switches).

**Acceptance criteria:**
- [ ] Tray icon visibly changes between all three states within roughly a second of the underlying state changing
- [ ] Toggling background listening from the tray menu is reflected immediately in the Settings panel, and vice versa
- [ ] Quit from the tray menu fully stops the wake-word background process, not just closes the window
- [ ] Icon renders correctly on Windows, macOS, and Linux tray/menu-bar conventions

---

### T-19 — Voice Enrollment Flow
**Priority:** Must-have
**Depends on:** F-10

**Description:** The guided UI for enrolling, re-enrolling, and removing voice biometric data, per the Frontend Spec, Section 8.

**Ticket prompt for AI coding tool:**
> Build a `VoiceEnrollment` React component: a status display (not enrolled / enrolled on `<date>`), an "Enroll"/"Re-enroll" button launching a short guided sequence (3–5 prompted phrases with a simple level meter for feedback), and a "Remove my voice data" action. Wire Enroll to `speakerVerificationService.enroll()` and Remove to `removeEnrollment()` (both F-10). Show a brief, plain-language note about what's stored (a numeric voiceprint, not audio) during enrollment.

**Acceptance criteria:**
- [ ] Completing enrollment updates the status display and enables voice-biometric gating elsewhere in the app
- [ ] Re-enrolling replaces the previous voiceprint rather than creating a second one
- [ ] Removing voice data reverts Kyclius to accepting any voice immediately, with the status display updating to "not enrolled"
- [ ] Enrollment flow can be exited/skipped at any point without leaving a partial/corrupt profile behind

---

### T-20 — Autonomous Mode Settings Panel
**Priority:** Must-have
**Depends on:** F-11, T-21

**Description:** The master toggle and runaway-protection controls for Autonomous Mode, per the Frontend Spec, Section 8, and the Security & Access Document, Section 4. Per-action risk tolerance itself lives in the Permissions panel (T-21) — Autonomous Mode does not keep its own separate list, to avoid two settings drifting out of sync.

**Ticket prompt for AI coding tool:**
> Extend `SettingsPanel` with an Autonomous Mode section: a master toggle (off by default) with a one-line explanation ("Let Kyclius take some actions without asking first — you choose which ones"), a maximum-steps stepper, and a timeout control, both mapping to `autonomous_mode_config.max_plan_steps`/`max_plan_duration_seconds`. Do not duplicate the per-action approve list here — link directly to the Permissions panel (T-21) instead, with a note explaining that actions set to "Always Allow" there are what Autonomous Mode will run without asking. Persist changes immediately on toggle, no separate save step. Add a small persistent badge near the composer whenever the master toggle is on.

**Acceptance criteria:**
- [ ] Master toggle defaults to off on first launch
- [ ] Changing max steps or timeout persists immediately and is reflected in `autonomous_mode_config`
- [ ] No separate per-action approval list exists on this panel — it links to T-21's Permissions panel instead
- [ ] The composer badge appears if and only if the master toggle is currently on
- [ ] Toggling any setting here is reflected by the permission engine on the very next relevant action, with no app restart required

---

### T-21 — Permissions & Confirmation Panel (Always Allow / Ask Every Time / Never Allow)
**Priority:** Must-have
**Depends on:** F-06

**Description:** The single, unified per-action permission control referenced by both the base confirmation flow and Autonomous Mode, per the Frontend Spec's Settings section and the Security & Access Document's three-tier permission model. This introduces "Never Allow" as a new tier beyond the original two (auto / confirm-required), and surfaces action categories at a more granular, user-facing level than the raw tool names.

**Ticket prompt for AI coding tool:**
> Build a `PermissionsPanel` React component listing each user-facing action category (open applications, create files, send email, delete files, execute commands, GitHub actions, and any other tool defined in `toolRegistry`) as a row with a three-way segmented control: **Always Allow / Ask Every Time / Never Allow**. Persist each row's value to a shared permission store (the same one `autonomous_mode_config.tool_overrides` and the confirmation dialog's "Always Allow" button both read/write — there must be exactly one source of truth, not a duplicate list). Default every row to "Ask Every Time" except the tools already defined as `auto` in `toolRegistry` (default those to "Always Allow"). Extend `permissionEngine.ts` (F-06) to check for "Never Allow" first, before any other check, rejecting the tool call outright with a clear message and never reaching a confirmation prompt or execution. Add the `--color-danger` warning note beneath `delete_file`/`run_shell_command` rows regardless of their current setting.

**Acceptance criteria:**
- [ ] Setting any action to "Never Allow" causes every subsequent attempt at that action to be rejected before a confirmation dialog ever appears, regardless of Autonomous Mode's master toggle
- [ ] Setting an action to "Always Allow" here has the identical effect to choosing "Always Allow" on that action's confirmation dialog — verified by checking both write to the same underlying store
- [ ] Changing a setting here takes effect on the very next relevant action, no app restart required
- [ ] Every tool in `toolRegistry` appears in this panel — no action exists that's controllable by the permission engine but invisible in this UI
- [ ] Default state on first launch matches each tool's original tier (auto → Always Allow, confirm-required → Ask Every Time), with nothing pre-set to Never Allow

---

### T-22 — UI/UX Consolidation & Fix Pass (Reference Mockups)
**Priority:** Must-have
**Depends on:** T-02, T-03, T-04, T-13, T-14, T-17, T-18, T-19, T-20, T-21

**Description:** A final integration and fix pass across every UI surface built in the tickets above — **not a replacement for them**. Reference mockups (home screen, Activity/Dashboard, Settings) exported from an AI design tool are provided in a `test/` folder at the repo root. Treat them as the authoritative visual/structural reference for layout, spacing, glass/blur treatment, and component styling wherever they conflict with an earlier, less-refined description in this document — but treat this document's *functional* decisions (real tool names, real permission tiers, real data) as authoritative over anything the mockups show as placeholder content, since the mockups were generated without knowledge of the actual backend.

**Ticket prompt for AI coding tool:**
> Reference the HTML mockups in `test/` (home screen, Activity/Dashboard, Settings) as the visual/structural ground truth for this pass, and reconcile every UI surface already built in prior tickets against them. Rebuild in React/TypeScript/Tailwind (or extend existing components), matching this project's actual stack — do not just port the raw HTML. Specifically:
>
> 1. **Replace every placeholder background image URL with the actual looped video asset** (`background-scenery.mp4`, per T-02) — none of the mockups' `googleusercontent.com` placeholder image URLs should survive into the real app, on the home screen, Settings, or anywhere else a background is shown.
> 2. **Remove any trace of a blob/orb/sphere/avatar character** — this includes the empty "3D AI Blob Animation Container" placeholder in the home screen mockup (delete it, don't fill it) and the circular sphere "AI avatar" image in the Activity/Dashboard sidebar header (replace with the flat Logo Mark from the Frontend Spec, Section 4 — not an organic or sphere-shaped image).
> 3. **Adopt the persistent left sidebar app-shell** (Conversations, Activity, Memory, Dashboard, with Settings pinned at the bottom) for every view except the home screen, per the Frontend Spec, Section 5 — the home screen stays sidebar-free and immersive. Collapse the sidebar to the bottom navigation bar on narrow/mobile widths, matching the mockups' mobile nav pattern.
> 4. **Replace placeholder/generic content with real Kyclius data and actions.** The mockups contain filler that doesn't correspond to anything real — e.g., quick-action chips reading "Scan Environment," "Review Logs," "System Status" (replace with real actions like "Open an app," "Check GitHub," "View memory"), fabricated dashboard stats ("1,432 conversations," "99.8% successful," "+12%" trend badges) — wire these to real counts from the `messages`/`tool_executions` tables instead, and drop any trend/percentage indicator not backed by real historical data. The Activity log rows, statuses, and the confirmation modal's Allow Once/Always Allow/Cancel pattern are structurally correct as shown and should be kept, just wired to real data instead of the mockup's hardcoded examples.
> 5. **Reconcile the Settings sidebar's category list** with the full authoritative list in the Frontend Spec, Section 8 (AI Providers, Models, Permissions, Memory, Voice, Voice Biometrics, Wake Word, Autonomous Mode, Text-to-Speech, Integrations, GitHub, Activity, Privacy, Security, Appearance, Advanced) — the mockup's shorter list is incomplete, not a deliberate scope cut.
> 6. **Carry over what's already correct without rebuilding it from scratch:** the glass/blur panel treatment, the AI Providers card layout (masked key, model dropdown, Test Connection), the confirmation modal's three-button pattern, and the color token values used in the mockups are all good and should be kept — map them onto this project's existing Tailwind config/palette (Frontend Spec, Section 2) rather than introducing a second, parallel color system alongside it.
> 7. Fix any other visibly broken, inconsistent, or half-implemented UI you encounter while doing this pass, and note what you fixed and why in your summary.

**Acceptance criteria:**
- [ ] No placeholder image URLs from the reference mockups exist anywhere in the shipped app
- [ ] No blob, orb, sphere, or organic character/avatar exists anywhere in the UI, including the sidebar header — only the flat Logo Mark appears
- [ ] The left sidebar app-shell is present and functional on every non-home view, and correctly collapses to bottom navigation below the mobile breakpoint
- [ ] Every dashboard stat, activity row, and quick-action shown in the UI reflects real local data — nothing hardcoded or fabricated remains
- [ ] The Settings modal's sidebar lists all sixteen categories from the Frontend Spec, each navigable and showing real, functioning content (not empty placeholders) for every setting already built in prior tickets
- [ ] Existing functionality from every dependency ticket (T-02 through T-21) still works identically after this pass — this is a visual/structural reconciliation, not a functional rewrite
- [ ] A written summary accompanies the change listing every specific fix made, so this can be reviewed against the mockups and this document rather than taken on faith

---

## FEATURE TICKETS (Should-Have)

### S-01 — First-Run Onboarding Flow
**Priority:** Should-have
**Depends on:** T-13, T-02, T-19

**Description:** Not explicitly listed as its own PRD line item, but required to make PRD Section 6, Step 1 ("First launch") actually work well: guiding a brand-new user to add an API key before they can chat, with optional voice enrollment offered alongside it.

**Ticket prompt for AI coding tool:**
> Build an `OnboardingFlow` that appears on first launch (detect via an `onboarding_complete` flag in `user_config`): a short welcome screen over the home screen background, a step prompting the user to paste a Groq or OpenRouter API key (reusing the Settings panel's key-entry component from T-13) with a direct link to each provider's free API key signup page, a skippable step offering voice enrollment (reusing `VoiceEnrollment` from T-19), and a completion step that sets the flag and drops the user into the normal idle home screen.

**Acceptance criteria:**
- [ ] Onboarding appears once, on first launch only, never again after completion
- [ ] User cannot reach the normal command bar without either completing key setup or explicitly skipping (if skip is allowed, chat remains blocked with a clear prompt until a key is added)
- [ ] Voice enrollment step can be skipped without blocking progress through the rest of onboarding
- [ ] Links to free API key signup pages are correct and open in the system browser, not in-app

---

## FEATURE TICKETS (Nice-to-Have — Post-MVP, per PRD Section 5)

*(Voice input/output, wake word, voice biometrics, and Autonomous Mode all moved to Must-have — see F-07 through F-11, T-01, T-03, T-04, T-17 through T-21. They're core to this release now, not deferred.)*

### N-01 — Cloud Sync (Optional Account via Supabase)
**Priority:** Nice-to-have
**Depends on:** F-03, T-13

**Ticket prompt for AI coding tool:**
> Implement optional Supabase Auth (magic link, email-based) and a sync service that mirrors local `conversations`, `messages`, `memory_facts` to Supabase tables scoped by RLS to `user_id = auth.uid()`, per the Security & Access Document. Sync must never block local functionality if offline or logged out, and must never auto-execute any `confirm_required` action as part of syncing.

**Acceptance criteria:**
- [ ] App is fully functional with sync disabled/logged out (baseline, unaffected by this feature)
- [ ] Enabling sync mirrors local data to Supabase, scoped correctly per RLS rules
- [ ] Going offline never blocks or errors core local functionality
- [ ] Sync conflicts favor most-recent-edit but log the discarded version rather than silently dropping it

---

### N-02 — Shared/Community Agents
**Priority:** Nice-to-have
**Depends on:** N-01, F-05

**Ticket prompt for AI coding tool:**
> Design and implement an "agent bundle" format (a declarative manifest of tool configurations/prompts) that users can export, share, and import. Imported agents must declare any permission tiers they rely on up front, shown to the user before install — no agent can introduce a new auto-allowed capability without explicit review at install time.

**Acceptance criteria:**
- [ ] An agent bundle can be exported from one install and imported into another
- [ ] Import screen clearly shows what permissions/tools the agent uses before the user confirms install
- [ ] No imported agent can register a tool as `auto` without explicit user review

---

### N-03 — Plugin System for Third-Party Tools
**Priority:** Nice-to-have
**Depends on:** F-05

**Ticket prompt for AI coding tool:**
> Design a plugin SDK allowing third-party tool definitions to register with `toolRegistry` (F-05) through a sandboxed interface, requiring every plugin tool to declare a `permissionTier` at registration (enforced the same way as built-in tools) and to declare what OS/network resources it needs, shown to the user at plugin install time.

**Acceptance criteria:**
- [ ] A sample third-party plugin can register a new tool without modifying core app code
- [ ] Plugin tools are subject to the exact same permission-check pipeline as built-in tools
- [ ] Plugin capabilities/resource needs are disclosed to the user before install

---

### N-04 — Multi-LLM Routing
**Priority:** Nice-to-have
**Depends on:** F-04

**Ticket prompt for AI coding tool:**
> Extend `llmRouter.ts` (F-04) to support rule-based routing across multiple configured providers/models (e.g., cheaper/faster model for simple intent classification, stronger model for complex tool planning), configurable by the user in Settings.

**Acceptance criteria:**
- [ ] User can configure routing rules (or accept a sensible default) without editing code
- [ ] Routing decision is logged/visible so the user can tell which model handled a given request
- [ ] Falls back gracefully to a single-provider mode if only one key is configured

---

### N-05 — Scheduled/Triggered Tasks
**Priority:** Nice-to-have
**Depends on:** F-05, F-06

**Ticket prompt for AI coding tool:**
> Add a scheduling system (e.g., a `scheduled_tasks` table + a main-process timer/cron mechanism) letting users define recurring commands ("every morning at 9am, summarize unread GitHub notifications"). Scheduled runs must still respect the permission engine — a `confirm_required` action triggered by a schedule queues a confirmation like any other, it does not bypass confirmation just because it's automated.

**Acceptance criteria:**
- [ ] A scheduled task fires at the configured time reliably across app restarts
- [ ] A scheduled task that proposes a `confirm_required` action produces a normal confirmation prompt, never auto-executes
- [ ] User can view, edit, and delete scheduled tasks

---

### N-06 — Rich File/Document Understanding
**Priority:** Nice-to-have
**Depends on:** F-04

**Ticket prompt for AI coding tool:**
> Add the ability for the user to reference a local file (PDF, spreadsheet, image) in a command, with the main process extracting text/relevant content and including it in the LLM context for that request. Respect the same context-size and relevance principles as memory (T-11) — don't dump entire large documents into every subsequent request.

**Acceptance criteria:**
- [ ] Referencing a PDF/spreadsheet/image in a command results in its content being available to the LLM for that request
- [ ] Extracted content is scoped to the triggering request, not persisted into every future context automatically
- [ ] Unsupported file types fail with a clear message rather than a silent no-op

# Kyclius — Feature Ticket Addendum for v2.7.1

**A note on scope:** I don't have the full original text of `06_FEATURE_TICKETS.md` (F-01–F-11, T-01–T-22, S-01, N-01–N-06) — only the summary of what each range covers. Rather than reconstruct 40 tickets from inference and risk misrepresenting their original acceptance criteria, this addendum contains only the **new v2.7.1 tickets**, ready to append to your existing file as-is. Your original F/T/S/N tickets are untouched — just bump their parent document's version header to 2.7.1 when you merge this in, since nothing about their own content changed.

---

## New Feature Tickets

### N-07 — Paid LLM provider support via an open provider registry
Add built-in presets for OpenAI, Anthropic, Google Gemini, NVIDIA NIM, Together AI, Fireworks AI, Mistral, and DeepSeek, plus a generic "Custom / OpenAI-Compatible" preset, per `02_TECHNICAL_ARCHITECTURE.md` §2. Replaces the fixed Groq/OpenRouter-only client pair with `providerRegistry.ts` + `openAICompatibleClient.ts` (shared across all OpenAI-compatible presets) + dedicated `anthropicClient.ts`/`geminiClient.ts` adapters. Depends on: F-04 (original LLM client layer).

**Acceptance criteria:** A user can add any of the nine built-in presets or a fully custom endpoint, each with its own key, and select one as the default `llm` provider; switching providers requires no code change, only a new row in the presets table for anything OpenAI-compatible.

### N-08 — Paid cloud STT/TTS provider option
Add the same provider-registry pattern to voice: a configured cloud STT and/or TTS provider is used when enabled, with automatic fallback to the local free engine (`faster-whisper` / Kokoro) if the cloud provider is unset, disabled, or fails. Depends on: F-07, F-08 (original STT/TTS integration), N-07 (shares the `providers` table design).

**Acceptance criteria:** A user can add a cloud STT and/or TTS provider via the same "+ Add Provider" UI pattern as LLM providers; disabling or removing it falls back to the local engine without any dead/silent state.

### T-23 — Drag-and-drop path resolution
Any field expecting a file/folder path, plus the command bar itself, accepts a native OS drag-and-drop and resolves it to an absolute path via `webUtils.getPathForFile`, displayed back to the user in monospace. Depends on: existing command bar (T-01) and any path-accepting Settings fields.

**Acceptance criteria:** Dragging a file from Finder/Explorer/file manager onto the command bar or a path field populates the correct absolute path without the user typing anything.

### T-24 — File/folder attachment via "+" icon
A "+" icon in the command bar opens the OS file/folder picker and also serves as the drop target for T-23's drag-and-drop; attached content is read into context for that exchange only (new `attach_file` tool, `auto` tier) and is subject to the same prompt-injection safeguard as email/GitHub/web content. Depends on: T-23, F-05 (tool registry), existing injection safeguard logic (originally scoped in `05_AGENT_TOOL_EXECUTION_SPEC.md`).

**Acceptance criteria:** Attaching a file shows a chip with its name/size before sending; Kyclius can reference its content in its response; text inside the attached file is never treated as a new instruction, even when it looks like one.

### T-25 — In-app "How to Use" guide
A new Settings category (or top-level nav item — product decision, see `04_FRONTEND_SPEC.md` §8) containing a scrollable, searchable plain-language guide covering setup, voice commands, permissions, Autonomous Mode, voice biometrics limits, attachments, and providers. No hard dependencies — can be built in parallel with anything else.

**Acceptance criteria:** A new user can find an answer to "what does Always Allow mean" or "how do I add a paid provider" without leaving the app or reading external docs.

### T-26 — Response streaming and sentence-level TTS streaming (latency fix)
`llmRouter.ts` requests streaming completions from whichever provider is active and forwards tokens to the renderer as they arrive; `ttsService.ts` synthesizes and plays audio sentence-by-sentence as the text stream produces complete sentences, rather than waiting for the full response. Depends on: N-07 (all provider adapters must support streaming), F-08 (TTS integration).

**Acceptance criteria:** Time-to-first-visible-token and time-to-first-audio are both measurably reduced versus the current wait-for-full-response behavior; this holds across every configured provider, not just one.

---



**Recommended sequencing for this version:** N-07 first (it's the foundation everything else in this batch either depends on or benefits from), then T-26 (latency — directly addressable once streaming-capable providers are wired up), then N-08, T-23/T-24 (independent of each other, can run in parallel), then T-25 last (no dependencies, but most useful once the other features exist to document). Bug tickets EF-02 and EF-04 remain independent priorities and can run alongside this batch at any point — recommend not deprioritizing them just because new features are landing, since they represent completely broken voice input/output.