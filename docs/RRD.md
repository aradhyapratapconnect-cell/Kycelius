# Kyclius — Product Requirements Document (PRD)

**Version:** 2.7.1 (supersedes 2.6.1)
**Owner:** [pratap]
**Status:** Pre-development

**Changelog from 2.6.1:**
- Expanded LLM provider support from a fixed Groq/OpenRouter pair into an open, freemium provider ecosystem (any free or paid provider, including a generic custom/OpenAI-compatible option).
- Added optional paid cloud STT/TTS providers alongside the existing free local defaults.
- Added drag-and-drop file/folder path input.
- Added file/folder attachment via a "+" icon in the command bar.
- Added an in-app "How to Use" guide.
- Added response/voice streaming to address latency complaints.
- Folded in two UI fixes: a persistent command bar inside the Conversation view, and a home-screen "ask" flow that never navigates away from the ambient home screen.

---

## 1. One-Line Summary

Kyclius is a free, open-source, local-first AI desktop assistant you talk to out loud — say "write an email," "open VS Code," "summarize this file" — and it reasons with an LLM of your choice (any free or paid provider, bring your own key), speaks its answer back to you, and takes real actions on your OS, with a dashboard that keeps a written and playable-back record of everything asked and answered.

---

## 2. The Problem

People already talk to AI chatbots for advice, drafting, and reasoning — but every one of those conversations dead-ends in a text box. To actually *do* something with the answer (send the email, open the app, save the file, check the GitHub issue), the user has to leave the chat and do it manually themselves.

Existing "agentic" assistants that close this gap are either:

- **Cloud-only and closed-source** (tied to one company's servers, one LLM, one pricing model), or
- **Paid / subscription-gated**, pricing out hobbyists, students, and privacy-conscious users, or
- **Narrow single-purpose tools** (e.g., just an email assistant, just a coding agent) rather than a general-purpose "do things on my computer" layer, or
- **Locked to one or two LLM providers**, forcing a user to abandon a paid subscription they already have elsewhere just to use the assistant.

There is no free, open-source, cross-platform assistant that lives on the desktop, works with a user's own key from *any* provider they choose — free or paid — and is trusted enough to actually take actions — not just chat.

---

## 3. Who It's For

| Persona | Description | Why they want Kyclius |
|---|---|---|
| **Indie developers / hobbyist coders** | Comfortable with GitHub, VS Code, terminal | Want a scriptable, hackable, self-hosted assistant they can extend themselves |
| **Privacy-conscious power users** | Don't want their data on a third party's cloud | Local-first architecture, own API key, no forced account |
| **Students / budget-constrained users** | Want AI assistant capabilities without a subscription | Free and open source, works with free-tier LLM APIs (Groq, OpenRouter, and others) |
| **Productivity enthusiasts** | Already use voice/text assistants, automation tools (Raycast, Alfred, AutoHotkey) | Wants a single natural-language layer on top of everyday OS tasks |
| **Existing paid-API users** | Already pay for OpenAI, Anthropic, Gemini, NVIDIA NIM, or another provider for other tools | Wants to point that same investment at Kyclius instead of being forced onto a free tier or a second subscription |

**Primary persona for these design decisions:** the indie developer / power user — technical enough to install a desktop app, get an API key, and tolerate early rough edges, but who wants a genuinely useful daily-driver, not a toy demo.

---

## 4. What Problem It Solves

Kyclius turns natural-language requests into real, executed actions on the user's own machine:

- **Removes the "copy-paste gap"** between "the AI told me what to do" and "the AI actually did it."
- **Removes the cost barrier** — bring-your-own-key with free-tier providers (Groq, OpenRouter, and others) means no subscription is required to get a genuinely useful assistant.
- **Removes provider lock-in** — a user is never stuck with whichever two providers a developer happened to wire up first. Any provider, free or paid, including ones that don't exist yet, can be added through a generic custom/OpenAI-compatible slot.
- **Removes the privacy trade-off** — runs locally, stores memory and history locally, and only touches the network for the LLM/voice-provider call itself (and optional cloud sync, which is opt-in).
- **Removes the platform lock-in** — one open-source codebase, built with Electron, runs identically on Windows, macOS, and Linux.

---

## 5. Core Features

### Must-Have (MVP)

| Feature | Description |
|---|---|
| **Voice command input** | The user speaks directly to Kyclius as the primary way to give it a request; a typed command bar remains available as a fallback/accessibility option, not the primary path |
| **Voice response output** | Kyclius speaks its answers back out loud, not just displaying text |
| **Q&A Dashboard** | A dedicated screen listing every question asked and answer given, showing the written transcript for each exchange with a "listen" control to hear the answer spoken back |
| **Open, freemium LLM provider support** | User supplies their own API key for any supported provider — built-in presets for Groq, OpenRouter, OpenAI, Anthropic, Google Gemini, NVIDIA NIM, Together AI, Fireworks AI, Mistral, and DeepSeek — plus a generic **Custom / OpenAI-Compatible** provider slot so any other provider (present or future, free or paid, including self-hosted options like Ollama or LM Studio) can be added with just a base URL, key, and model name. A user can configure multiple providers at once and choose which one handles a given request. |
| **Optional paid cloud STT/TTS providers** | Alongside the free local STT/TTS defaults, a user can plug in a paid cloud voice provider (e.g., a hosted Whisper endpoint, Deepgram, ElevenLabs, Cartesia) via the same BYOK pattern, for faster or higher-quality voice at their own cost |
| **Tool/action execution engine** | Structured system that maps LLM intent → a defined set of "tools" (open app, create file, send email, etc.) — see the Agent & Tool Execution Spec |
| **Permission system** | Some actions run automatically (open app, create file); others require explicit user confirmation before running (send email, delete file, run shell command). Confirmation can be given either by speaking an affirmative phrase ("okay," "continue," "yes") or by clicking Approve in the UI — the user is never forced to leave the conversation to go interact with the target app or a native OS dialog just to confirm |
| **Open an application** | Launch any installed application by name |
| **Create a file** | Create a new file (with content) at a user-specified or sensible default location |
| **Drag-and-drop path input** | Anywhere a file/folder path is needed, the user can drag it from their OS file manager and drop it in, rather than typing the full path by hand |
| **File/folder attachment** | A "+" icon in the command bar (also accepting a drag-and-drop) lets the user directly attach a file or folder for Kyclius to read/reference in the current exchange |
| **Draft & send email** | Compose an email from a natural-language instruction; sending requires confirmation (spoken or clicked) |
| **GitHub task handling** | Read/summarize issues or PRs, and perform simple GitHub actions on request (see Technical Architecture doc for defined scope) |
| **Local memory** | Kyclius remembers facts the user tells it (name, preferences, default apps) in a local SQLite database; fully visible and editable by the user |
| **Home / chat hybrid UI** | A calm, ambient home screen (animated nature scenery background, no character/mascot) that stays visible and playing at all times; a spoken question and its answer appear only as a small inline element near the command bar, never by navigating away to a separate screen |
| **In-app "How to Use" guide** | A dedicated, plain-language guide inside the app covering setup, voice commands, permissions, Autonomous Mode, and every other feature — no need to leave the app to understand it |
| **Local-first operation** | Core app functions (chat, memory, most tool execution) work with zero cloud dependency beyond the LLM/voice API call itself |
| **Cross-platform desktop app** | Single Electron codebase, packaged for Windows, macOS, Linux |
| **Open source release** | Full source on GitHub under an open license, installable/buildable by anyone |
| **Always-on wake word listening** | Kyclius listens in the background (even when the app window isn't focused/open) for a wake phrase — default "Hey Kyclius," user-editable in Settings — and replies aloud "How can I help you?" when triggered, then opens into a normal listening/command exchange |
| **Voice biometrics** | Kyclius can recognize the enrolled user's voice and use that to gate both issuing commands and approving confirm-required actions, on top of (not replacing) the existing phrase-based voice confirmation |
| **Autonomous Mode (opt-in, per-action configurable)** | A Settings toggle that lets Kyclius chain multiple tool calls together toward a stated goal without a prompt at every single step. The user sets per-action-type risk tolerance — e.g., "auto-approve `send_email` and `create_file` under Autonomous Mode, but always still confirm `delete_file` and `run_shell_command`" — rather than one blanket autonomous/not-autonomous switch. Off by default. |
| **Streamed responses and voice** | LLM responses stream token-by-token to the UI as they're generated, and TTS begins speaking as soon as the first complete sentence is ready, rather than waiting for the full response — this is what keeps both text and voice feeling fast regardless of provider |

### Nice-to-Have (Post-MVP / Future)

| Feature | Description |
|---|---|
| **Cloud sync (optional account)** | Sync memory/history across devices via Supabase, only if the user opts in |
| **Shared/community agents** | Pre-built "recipes" or tool bundles other users can install |
| **Plugin system for third-party tools** | Let the community add new tools beyond the built-in set |
| **Multi-LLM routing** | Automatically pick between configured providers/models based on task type or cost |
| **Scheduled/triggered tasks** | "Every morning, summarize my unread GitHub notifications" |
| **Rich file/document understanding** | Read and reason over PDFs, spreadsheets, images the user references (building further on the file-attachment feature above) |

---

## 6. User Flow (Start to Finish)

1. **First launch** — User installs Kyclius, is greeted by the home screen (animated nature scenery, no character/mascot), and is prompted to configure at least one LLM provider: pick a built-in preset (Groq, OpenRouter, OpenAI, Anthropic, Gemini, NVIDIA NIM, Together AI, Fireworks, Mistral, DeepSeek) and paste in a key, or choose "Custom / OpenAI-Compatible" and supply a base URL, key, and model name for anything else — plus a one-time microphone permission prompt. An optional voice enrollment step lets the user record a few phrases so Kyclius can recognize their voice later (skippable — voice biometrics stays off until enrolled). No account or login required at this step.
2. **Idle/background state** — Whether the app window is open or minimized, Kyclius listens locally for its wake word (default "Hey Kyclius," editable in Settings). No audio is sent anywhere and nothing is stored during this state. The home screen's video background keeps playing throughout.
3. **Wake word heard** — Kyclius replies aloud, "How can I help you?", brings the app to the foreground (or shows the home screen if it was hidden), and the interface shows a subtle listening indicator on the message composer. The home screen does not navigate away.
4. **User speaks or types a command** — e.g., says out loud, "Write an email to Sam about rescheduling our call to Friday," or drags a file onto the command bar and asks Kyclius to summarize it. The composer shows an active listening/recording state while capturing audio, or a small attachment chip once a file is dropped/attached.
5. **Kyclius thinks** — The composer shows a "generating" state; the transcribed request, relevant context/memory, and any attached file content is sent to the configured LLM provider. The response streams in token-by-token rather than appearing all at once.
6. **Kyclius proposes an action, out loud and inline** — It speaks the response aloud (starting as soon as the first sentence is ready) and shows it as a small inline element near the command bar — the home screen and its video background remain visible and unchanged throughout. If the action needs confirmation (e.g., "send email"), the confirmation dialog appears — unless Autonomous Mode is enabled with that action type marked auto-approvable, in which case it proceeds directly and reports the result.
7. **User confirms by voice or by click** (when confirmation is required) — Saying an unambiguous affirmative ("okay," "continue," "yes," "send it") within the listening window counts as approval, exactly like clicking Approve. If voice biometrics is enabled, the confirming voice must also match the enrolled profile; an unrecognized voice is treated as not-approved and falls back to click confirmation. The user can also say "cancel"/"stop," or edit the draft by voice or by clicking.
8. **Action executes** — On approval (or automatically, under Autonomous Mode for that action type), Kyclius performs the action, reports the result out loud, and logs it.
9. **Session continues, or the user explicitly opens the full Conversation view** — Only clicking into "Conversations" (or Activity/Memory/Dashboard) from the sidebar navigates away from the ambient home screen into a dedicated view — that view has its own persistently docked command bar so the conversation can continue there too.
10. **Memory update (as relevant)** — If the user reveals a durable fact ("my default email is X"), Kyclius stores it locally and it's visible/editable later in a "Memory" panel.
11. **Dashboard record** — The exchange (question, answer, any action taken) appears in the Q&A Dashboard as a written entry with a control to play back Kyclius's spoken answer again.
12. **First-time confusion? The "How to Use" guide is one click away** — reachable from Settings (or a top-level nav item) at any point, explaining exactly what's happening at each of the steps above in plain language.

---

## 7. What the MVP Looks Like

The MVP is a working desktop app (Windows/macOS/Linux via Electron) that:

- Has the hybrid home/chat UI with the animated nature scenery background (no character/mascot) that never navigates away on a simple ask — the video background, greeting, and quick-action pills stay put, with the exchange appearing inline near the command bar.
- Lets the user speak commands as the primary input, and hears Kyclius speak its answers back (streamed, starting from the first sentence); a typed command bar exists as a fallback, present on both the home screen and inside the dedicated Conversation view.
- Listens locally for a wake word (default "Hey Kyclius," editable) even when the app isn't focused, replying aloud and opening a listening session when triggered.
- Supports configuring **any number of LLM providers** — built-in presets for Groq, OpenRouter, OpenAI, Anthropic, Gemini, NVIDIA NIM, Together AI, Fireworks, Mistral, and DeepSeek, plus a generic Custom/OpenAI-Compatible slot for anything else — with no built-in/paid Anthropic-hosted key ever used on the user's behalf.
- Optionally supports a paid cloud STT/TTS provider alongside the free local defaults.
- Lets the user drag and drop a file/folder anywhere a path is expected, and attach a file/folder directly via a "+" icon in the command bar.
- Can reliably execute the following actions end-to-end: open an application, create a file, draft an email, send an email (with confirmation), run a shell command (with confirmation), delete a file (with confirmation), and perform at least one useful GitHub task (e.g., summarize open issues/PRs on a repo, or open/comment on an issue).
- Lets the user confirm any confirm-required action either by speaking an unambiguous affirmative or by clicking Approve in the UI, without ever having to leave the conversation to interact with the target app or a native OS dialog.
- Offers optional voice enrollment, and if enabled, uses voice matching to gate both issuing commands and approving confirmations, falling back to typed/click interaction for unrecognized voices.
- Offers an Autonomous Mode toggle in Settings, off by default, with a per-action-type risk-tolerance list so the user decides exactly which confirm-required actions (if any) can proceed without a prompt when it's on; can chain multiple tool calls toward a stated goal under a bounded step/time/cost ceiling.
- Has a Q&A Dashboard listing every question asked and answer given, with the written transcript always visible and a control to replay the spoken answer.
- Has an in-app "How to Use" guide covering every feature in plain language.
- Stores conversation history and memory locally in SQLite; includes a simple "what Kyclius remembers about you" screen with edit/delete controls.
- Ships with no login requirement; cloud sync/account is entirely absent or clearly marked "coming later" rather than half-built.
- Is installable from a GitHub release (or build-from-source) on all three major desktop OSes.

**Explicitly out of scope for "done"**: plugin marketplace, mobile companion app, unbounded/indefinite autonomous operation, storing raw audio recordings long-term (spoken answers are regenerated/replayed via text-to-speech from the saved transcript, and always-on listening audio is discarded unless the wake word is heard, to keep storage and privacy simple), and any provider preset that requires Kyclius itself to hold a shared/paid key on the user's behalf.

---

## 8. Success Metrics

Since this is an open-source hobby/portfolio-grade project rather than a funded startup, success should be measured primarily by **usage and adoption signals**, not revenue:

| Metric | What it tells us |
|---|---|
| **GitHub stars / forks** | Community interest and discoverability |
| **Installs / downloads per release** | Real usage beyond GitHub browsing |
| **Weekly active local users** (if telemetry is added, opt-in only) | Whether people keep using it after install |
| **Number of successfully completed actions vs. cancelled/failed ones** | Whether the tool-execution flow is actually reliable and trusted |
| **Time from command to completed action, and time-to-first-token / time-to-first-audio** | Whether the experience feels fast enough to be useful, not a novelty |
| **Issues/PRs from external contributors** | Whether the open-source project is attracting real community involvement |
| **Distribution of configured providers across users** | Whether the open provider model is actually being used broadly, or whether everyone still just picks the same one or two — tells us if the freemium bet paid off |
| **Autonomous Mode opt-in rate, and which action types get auto-approved** | Whether the risk-tolerance model actually matches what real users are comfortable with, or needs rethinking |
| **Personal daily use** | The simplest test: are *you* still using it instead of falling back to manual steps after 30 days? |

---

## 9. What We Are Deliberately NOT Building (v2.7.1)

- **No Anthropic-hosted or otherwise built-in/paid API key** — this remains BYOK-only for every provider, free or paid; Kyclius never pays for, proxies, or subsidizes an LLM/voice call on the user's behalf, no matter how many providers are supported.
- **No mandatory account/login** — accounts exist only for optional cloud sync/shared agents, never gating core functionality.
- **No mobile app** — desktop only (Windows/macOS/Linux) for this release.
- **No unbounded/unattended autonomy** — even with Autonomous Mode enabled, action types the user has not explicitly marked as auto-approvable still require confirmation, and multi-step plans run under a hard step-count/time/cost ceiling (see Security & Access Document and Agent & Tool Execution Specification) rather than running indefinitely on their own.
- **No plugin marketplace or third-party tool SDK** — the tool set is fixed and built-in for this release; extensibility comes later.
- **No fine-tuned or self-hosted local LLM shipped by default** — relies on hosted provider APIs by default (wake word and voice biometric models still run locally regardless of LLM provider choice); a user who wants a fully local LLM can still point the Custom/OpenAI-Compatible provider slot at a local server like Ollama, but Kyclius doesn't ship or manage that server itself.
- **No enterprise features** (SSO, audit logs beyond the local tool-execution log, team management, admin console).
- **No strong speaker-authentication guarantee.** Voice biometrics in this release is a recognition/convenience layer, not a hardened security boundary — it can be spoofed by a sufficiently good recording of the enrolled user, the same limitation any voice-based system has. See the Security & Access Document for exactly what it does and doesn't protect against, and the recommended fallback (PIN/typed) for anyone who needs a stronger guarantee.
- **No cloud processing of always-on background audio.** Wake word detection runs fully locally; audio before the wake word is heard is never transmitted anywhere and is discarded from memory immediately if no wake word is detected.
- **No silent forwarding of a user's data to an untrusted custom endpoint.** The Custom/OpenAI-Compatible provider slot is powerful but the user is responsible for the endpoint they configure — Kyclius validates the URL is well-formed and reachable but cannot vouch for the trustworthiness of an arbitrary third-party server the user chooses to add (see Security & Access Document, Edge Cases).