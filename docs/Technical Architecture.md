# Kyclius — Technical Architecture Document

**Version:** 2.7.1 (supersedes 2.6.1)
**Status:** Pre-development

**Changelog from 2.6.1:**
- LLM layer redesigned around a generic, extensible **provider registry** instead of two hardcoded clients (Groq, OpenRouter) — built-in presets for many providers plus a Custom/OpenAI-Compatible slot.
- STT/TTS layers gain the same pattern: optional paid cloud providers alongside the existing free local defaults.
- New `providers` table replaces/generalizes the provider-specific pieces of `user_config`.
- Added drag-and-drop path resolution and file/folder attachment ingestion notes.
- Added streaming architecture notes for both LLM text and TTS audio (latency fix).

---

## 1. Recommended Tech Stack

| Layer | Choice | Why |
|---|---|---|
| **Desktop shell** | Electron | Only mature option for a single codebase that ships identical native apps on Windows, macOS, and Linux with full OS access (file system, shell, app launching) — required since Kyclius must open apps and run commands, which a sandboxed web app cannot do |
| **UI framework** | React + TypeScript | Matches your stated preference; large ecosystem, easy to find contributors for an open-source project, strong typing reduces bugs in a tool-execution system where correctness matters |
| **Styling** | Tailwind CSS | Fast to build a distinctive, glass/translucent UI over the ambient background without fighting a component library's defaults; keeps the design system consistent and documented (see Frontend Spec) |
| **Animated background** | An `<video>` element (looped, muted, `autoplay`) playing a pre-rendered scenery clip, layered behind the UI with CSS `backdrop-filter: blur()` on the glass panels above it | No WebGL/3D engine needed — a looping video is far lighter on GPU/battery than a real-time 3D scene, and matches the direction of the environment itself being the "AI presence" rather than a separate character/mascot object |
| **LLM provider layer** | A generic **provider registry** (`providerRegistry.ts`) with built-in presets for Groq, OpenRouter, OpenAI, Anthropic, Google Gemini, NVIDIA NIM, Together AI, Fireworks AI, Mistral, and DeepSeek, plus a **Custom / OpenAI-Compatible** preset for anything else — BYOK for all, free or paid | Almost every modern inference provider (Groq, OpenRouter, OpenAI, Together, Fireworks, Mistral, DeepSeek, NVIDIA NIM, and most self-hosted servers like Ollama/LM Studio/vLLM) exposes an **OpenAI-compatible** `/chat/completions`-style API, so one generic client handles the large majority of providers by just varying `base_url`, API key header, and model name. Anthropic and Gemini use their own native request/response shapes, so they get thin dedicated adapters that normalize into the same internal message/tool-call format everything else already uses. This is what makes "add any provider" tractable instead of writing N bespoke clients. |
| **Speech-to-text (voice input)** | `faster-whisper` (CTranslate2-based, free, MIT-licensed) running Whisper **large-v3-turbo** as the default, with a step down to the `small` model as a Settings option for low-end hardware, **plus an optional paid cloud STT provider** (e.g., a hosted Whisper API, Deepgram) via the same BYOK provider-registry pattern | Local/free stays the default; a paid cloud option is offered for users who want lower latency or don't want to run a local model at all — see Section on Voice Provider Registry below |
| **Text-to-speech (voice output)** | **Kokoro-82M** (Apache 2.0, free, ~82M parameters, runs on CPU with no GPU required) as the default, with **Chatterbox** (MIT-licensed, voice cloning) as a free local upgrade, **plus an optional paid cloud TTS provider** (e.g., ElevenLabs, Cartesia) via the same BYOK provider-registry pattern | Local/free remains the default and the offline-capable option; paid cloud TTS is offered for users prioritizing speed/quality over running everything locally |
| **Wake word detection** | `openWakeWord` (free, open source, fully offline, supports custom-trained wake words) | Needs to run continuously in the background with minimal resource draw and zero network dependency — an open-source, locally-run model matches the local-first/free philosophy and lets the user's custom wake word ("Hey Kyclius" by default, editable) actually be retrainable rather than locked to a vendor's fixed phrase list |
| **Voice biometrics (speaker verification)** | `SpeechBrain`'s ECAPA-TDNN speaker-verification model, run locally via `onnxruntime-node` (free, open source, offline) | Produces a voiceprint (embedding) from a short enrollment recording and compares new audio against it with a cosine-similarity threshold — runs fully on-device, so the biometric data never has to leave the machine, consistent with the project's privacy stance |
| **Multi-step autonomous planning** | A lightweight planner layer on top of `llmRouter.ts` (now provider-registry-backed) — no new external dependency, just an LLM call pattern that returns an ordered list of tool calls instead of one, executed iteratively through the existing tool-execution pipeline | Keeps Autonomous Mode's "how it works" identical to normal tool execution (same permission engine, same audit log) rather than introducing a separate, harder-to-trust agent framework |
| **Local database** | SQLite via `better-sqlite3` | Synchronous, fast, zero-config, embeds directly in the Electron main process — matches your decision to store memory/settings/chat history locally in SQLite |
| **File/folder attachment & drag-and-drop** | Electron's native drag-and-drop file API (`webUtils.getPathForFile`) for path resolution; attached file contents read via Node's `fs` in the main process, streamed into LLM context as user-provided reference content | No new dependency needed — this is Electron/Node functionality already available given the existing main-process file-system access; the work is wiring and UI, not new infrastructure |
| **Process architecture** | Electron **main process** (Node.js, has OS access) + **renderer process** (React UI, sandboxed) communicating via `contextBridge`/IPC | Electron's security model requires this split — the renderer should never have direct Node/OS access; all tool execution happens in the main process behind an explicit, auditable IPC API |
| **Optional cloud backend** | Supabase (Postgres + Auth) | Matches your decision; only used for the optional account/cloud-sync feature, never required for core functionality |
| **Packaging/distribution** | `electron-builder` | Produces signed installers for `.exe` (Windows), `.dmg`/`.app` (macOS), `.AppImage`/`.deb` (Linux) and integrates with GitHub Releases for auto-updates |
| **State management (renderer)** | Zustand (or React Context for something this size) | Lightweight, avoids Redux boilerplate for an app whose complexity is mostly in the main process, not the UI state tree |
| **Testing** | Vitest (unit) + Playwright (E2E, via `electron` test mode) | TypeScript-native, fast, and Playwright has first-class Electron support for testing the full app including IPC flows |
| **Linting/formatting** | ESLint + Prettier | Standard for an open-source repo where external contributors will submit PRs |
| **License** | MIT (recommended) | Most permissive common open-source license; maximizes adoption and contribution, which matters for your success metrics (stars, forks, external PRs) |

---

## 2. The Provider Registry (New in v2.7.1)

This is the architectural core of the "add any provider, free or paid" feature. Rather than one client file per provider, providers are **data**, not code, wherever possible.

### 2.1 Built-in presets

| Preset key | Display name | Schema | Notes |
|---|---|---|---|
| `groq` | Groq | `openai_compatible` | Existing default free-tier provider |
| `openrouter` | OpenRouter | `openai_compatible` | Existing default free-tier provider, routes to many underlying models |
| `openai` | OpenAI | `openai_compatible` | Paid |
| `anthropic` | Anthropic | `anthropic_native` | Paid; native Messages API schema, needs its own adapter |
| `gemini` | Google Gemini | `gemini_native` | Free tier + paid; native schema, needs its own adapter |
| `nvidia_nim` | NVIDIA NIM | `openai_compatible` | Free tier + paid; NVIDIA's hosted inference API is OpenAI-compatible |
| `together` | Together AI | `openai_compatible` | Free credits + paid |
| `fireworks` | Fireworks AI | `openai_compatible` | Free credits + paid |
| `mistral` | Mistral | `openai_compatible` | Free tier + paid |
| `deepseek` | DeepSeek | `openai_compatible` | Free tier + paid |
| `custom` | Custom / OpenAI-Compatible | `openai_compatible` | User supplies their own `base_url`, key, and model name — covers Ollama, LM Studio, vLLM, any self-hosted server, or any provider not in this list, present or future |

Each preset (other than `custom`) ships with a known-good default `base_url` and auth header format, so the user only has to paste in a key and optionally pick a model. `custom` requires the user to supply the `base_url` themselves.

### 2.2 Client adapters

Three adapter implementations cover all presets:

- **`openAICompatibleClient.ts`** — handles every `openai_compatible` preset (Groq, OpenRouter, OpenAI, NVIDIA NIM, Together, Fireworks, Mistral, DeepSeek, Custom) via one shared implementation, parameterized by `base_url`, API key, and model. This is the bulk of provider support and needs no new code per provider added to this list in the future — just a new row in the presets table.
- **`anthropicClient.ts`** — thin adapter translating Kyclius's internal message/tool-call format to/from Anthropic's native Messages API schema.
- **`geminiClient.ts`** — thin adapter translating to/from Google's native Gemini API schema.

`llmRouter.ts` picks the correct adapter based on the active provider's `schema` field — this is the same "provider-agnostic interface" principle already established in the 2.6.1 architecture, now with concrete multi-provider implementations behind it instead of just Groq/OpenRouter.

### 2.3 Tool-calling support varies by provider/model

Not every model behind every provider supports reliable native function/tool-calling. The **Agent & Tool Execution Specification** now documents a fallback strategy (structured-prompt + response parsing) for providers/models without native tool-calling support — see that document, Section 3a. This is purely about *how* a tool call gets produced; every safeguard downstream (schema validation, permission engine, audit log) applies identically regardless of which path produced it.

### 2.4 Same pattern for voice: STT/TTS provider registry

The `providers` table (Section 3 below) is shared across three capabilities — `llm`, `stt`, and `tts` — rather than being three separate schemas. A cloud STT/TTS provider (e.g., a hosted Whisper endpoint, Deepgram, ElevenLabs, Cartesia) is added exactly the same way an LLM provider is: pick a preset or use Custom, paste in a key. `sttService.ts` and `ttsService.ts` check for a configured and enabled cloud provider first (if the user has one active) and fall back to the local engine (`faster-whisper` / Kokoro) otherwise — this fallback logic also directly satisfies the no-dead-voice-path requirement from the Security & Access Document's Error Handling Guide.

---

## 3. Complete File & Folder Structure

```
kyclius/
├── .github/
│   └── workflows/              # CI: lint, test, build installers per OS
├── build/                      # electron-builder output (gitignored)
├── docs/                       # This document set lives here
│   ├── 01_PRD.md
│   ├── 02_TECHNICAL_ARCHITECTURE.md
│   ├── 03_SECURITY_ACCESS.md
│   ├── 04_FRONTEND_SPEC.md
│   └── 05_AGENT_TOOL_EXECUTION_SPEC.md
├── src/
│   ├── main/                          # Electron main process (Node.js, OS access)
│   │   ├── index.ts                   # App entry point, window creation
│   │   ├── ipc/                       # IPC handler registrations
│   │   │   ├── chat.handlers.ts
│   │   │   ├── tools.handlers.ts
│   │   │   ├── memory.handlers.ts
│   │   │   └── providers.handlers.ts  # NEW — add/edit/delete/test provider configs
│   │   ├── tools/                     # One file per executable "tool"
│   │   │   ├── openApp.ts
│   │   │   ├── createFile.ts
│   │   │   ├── deleteFile.ts
│   │   │   ├── sendEmail.ts
│   │   │   ├── runShellCommand.ts
│   │   │   ├── github.ts
│   │   │   ├── attachFile.ts          # NEW — reads an attached file/folder into context
│   │   │   └── toolRegistry.ts        # Maps tool name -> handler + permission tier
│   │   ├── permissions/
│   │   │   ├── permissionEngine.ts    # Decides auto-allow vs confirm-required
│   │   │   └── confirmationQueue.ts
│   │   ├── voice/
│   │   │   ├── sttService.ts          # Local faster-whisper OR configured cloud STT provider
│   │   │   ├── ttsService.ts          # Local Kokoro/Chatterbox OR configured cloud TTS provider, sentence-chunked streaming
│   │   │   ├── voiceConfirmationListener.ts  # Bounded-window listener for spoken confirmations
│   │   │   ├── wakeWordService.ts     # Background wake-word listener (openWakeWord)
│   │   │   └── speakerVerificationService.ts  # Voice biometrics (SpeechBrain via onnxruntime-node)
│   │   ├── agent/
│   │   │   └── planner.ts             # Multi-step plan generation for Autonomous Mode
│   │   ├── llm/
│   │   │   ├── providerRegistry.ts    # NEW — preset definitions + user-added custom providers
│   │   │   ├── openAICompatibleClient.ts  # NEW — shared client for all openai_compatible presets
│   │   │   ├── anthropicClient.ts     # NEW — native Anthropic schema adapter
│   │   │   ├── geminiClient.ts        # NEW — native Gemini schema adapter
│   │   │   └── llmRouter.ts           # Picks provider/adapter based on user config, handles streaming
│   │   ├── db/
│   │   │   ├── schema.sql
│   │   │   ├── migrations/
│   │   │   └── db.ts                  # better-sqlite3 connection + queries
│   │   ├── memory/
│   │   │   └── memoryService.ts       # Read/write/edit remembered facts
│   │   ├── sync/
│   │   │   └── supabaseSync.ts        # Optional cloud sync, only if logged in
│   │   └── config/
│   │       └── userConfig.ts          # Non-provider preferences (encrypted at rest where sensitive)
│   │
│   ├── preload/
│   │   └── preload.ts                 # contextBridge — the ONLY bridge between renderer and main
│   │
│   ├── renderer/                      # React app (UI only, no OS access)
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   ├── components/
│   │   │   ├── SceneryBackground/      # Looped video background component (no character/mascot)
│   │   │   ├── HomeScreen/             # Ambient home screen; renders the inline response strip (not a full panel)
│   │   │   ├── ChatWorkspace/          # Dedicated Conversation view — includes its own docked command bar
│   │   │   ├── ConfirmationDialog/    # Renders confirm-required action prompts; accepts spoken or clicked approval
│   │   │   ├── Dashboard/             # Q&A history: written transcript + "listen" playback per answer
│   │   │   ├── MemoryPanel/           # View/edit what Kyclius remembers
│   │   │   ├── VoiceEnrollment/       # Record enrollment phrases for voice biometrics
│   │   │   ├── ProviderSettings/      # NEW — provider cards (LLM + STT/TTS), "Add Provider" flow
│   │   │   ├── AttachmentDropzone/    # NEW — drag-and-drop target + "+" attach icon, used in command bar and path fields
│   │   │   ├── HowToUse/              # NEW — in-app guide content
│   │   │   └── SettingsPanel/         # API keys, provider choice, wake word phrase, Autonomous Mode risk-tolerance matrix
│   │   ├── hooks/
│   │   ├── store/                     # Zustand stores
│   │   ├── styles/
│   │   │   └── tailwind.css
│   │   └── assets/
│   │       └── background-scenery.mp4  # Looped nature scenery background video
│   │
│   └── shared/
│       ├── types/                     # Shared TypeScript types (Tool, Message, MemoryFact, Provider, etc.)
│       └── constants.ts
│
├── electron-builder.yml
├── vite.config.ts
├── tailwind.config.ts
├── tsconfig.json
├── package.json
├── LICENSE
└── README.md
```

---

## 4. Database Schema (SQLite, local-first)

All tables live in a single local SQLite file (e.g., `~/.kyclius/kyclius.db` or the OS's standard app-data folder). Plain-English explanation follows each table. **New/changed tables for v2.7.1 are marked.**

### `conversations`
| Field | Type | Notes |
|---|---|---|
| `id` | TEXT (UUID) PK | |
| `title` | TEXT | Auto-generated summary of the conversation, shown in history |
| `created_at` | DATETIME | |
| `updated_at` | DATETIME | |

*Plain English:* Each time you open a chat/workspace session, it's a row here — like a folder holding all the messages from that session.

### `messages`
| Field | Type | Notes |
|---|---|---|
| `id` | TEXT (UUID) PK | |
| `conversation_id` | TEXT FK → `conversations.id` | |
| `role` | TEXT | `user` \| `assistant` \| `tool` |
| `content` | TEXT | The message text (always stored as text — the transcript — regardless of whether it was spoken or typed), or a JSON-encoded tool call/result |
| `input_mode` | TEXT | `voice` \| `text` — how the user delivered this message (only meaningful on `user` rows) |
| `output_mode` | TEXT | `voice` \| `text` \| `both` — how this message was presented to the user (only meaningful on `assistant` rows); `voice`/`both` means it was also spoken via TTS |
| `provider_id` | TEXT FK → `providers.id` **(NEW)** | Which configured provider actually handled this message — lets the Dashboard/Activity view show "via Groq" / "via your NVIDIA NIM key" per exchange, and helps debugging when multiple providers are configured |
| `attachment_ids` | TEXT (JSON array) **(NEW)** | IDs of any `attachments` rows referenced by this message, if the user attached a file/folder |
| `created_at` | DATETIME | |

*Plain English:* Every individual message — what you said or typed, what Kyclius said back, and any tool actions it ran — is one row, linked to its conversation. Only the text transcript is stored, never a raw audio recording.

### `memory_facts`
| Field | Type | Notes |
|---|---|---|
| `id` | TEXT (UUID) PK | |
| `key` | TEXT | Short label, e.g. `default_editor`, `name` |
| `value` | TEXT | The remembered value, e.g. `VS Code` |
| `source` | TEXT | `auto_learned` \| `user_added` |
| `created_at` | DATETIME | |
| `updated_at` | DATETIME | |

*Plain English:* This is Kyclius's "memory" — one row per fact it knows about you. The Memory Panel in the UI reads and writes directly to this table.

### `tool_executions`
| Field | Type | Notes |
|---|---|---|
| `id` | TEXT (UUID) PK | |
| `message_id` | TEXT FK → `messages.id` | The message that triggered this action |
| `tool_name` | TEXT | e.g. `send_email`, `create_file`, `attach_file` |
| `parameters` | TEXT (JSON) | What was passed to the tool |
| `permission_tier` | TEXT | `auto` \| `confirm_required` |
| `status` | TEXT | `pending` \| `confirmed` \| `denied` \| `success` \| `failed` |
| `result` | TEXT | Output or error message |
| `latency_ms` | INTEGER **(NEW)** | Time from tool call issued to result captured — feeds the performance metrics called for in the PRD |
| `created_at` | DATETIME | |

*Plain English:* An audit log of every action Kyclius has taken or attempted.

### `providers` **(NEW — replaces the provider-specific parts of `user_config`)**
| Field | Type | Notes |
|---|---|---|
| `id` | TEXT (UUID) PK | |
| `capability` | TEXT | `llm` \| `stt` \| `tts` — one table covers all three provider types |
| `preset_key` | TEXT | One of the built-in preset keys (Section 2.1) or `custom` |
| `display_name` | TEXT | User-editable label shown in Settings (defaults to the preset's display name) |
| `schema` | TEXT | `openai_compatible` \| `anthropic_native` \| `gemini_native` \| `cloud_stt` \| `cloud_tts` — tells the router which adapter to use |
| `base_url` | TEXT | Required for `custom`; pre-filled and normally hidden for known presets |
| `api_key_encrypted` | BLOB | Encrypted via Electron `safeStorage`, same as all other keys |
| `default_model` | TEXT | Model/voice name to use by default for this provider |
| `enabled` | BOOLEAN | Whether this provider is currently selectable |
| `is_default` | BOOLEAN | At most one enabled provider per `capability` can be the default used when the user doesn't explicitly pick one |
| `created_at` | DATETIME | |
| `updated_at` | DATETIME | |

*Plain English:* This is the heart of the freemium provider system — one table, one row per provider the user has configured, whether it's a free-tier LLM, a paid LLM, a paid cloud voice engine, or a fully custom endpoint. The Settings UI's provider cards read and write directly to this table.

### `attachments` **(NEW)**
| Field | Type | Notes |
|---|---|---|
| `id` | TEXT (UUID) PK | |
| `conversation_id` | TEXT FK → `conversations.id` | |
| `original_path` | TEXT | The absolute path the user dropped/selected, shown back to them for confirmation |
| `display_name` | TEXT | Filename or folder name shown in the attachment chip |
| `kind` | TEXT | `file` \| `folder` |
| `size_bytes` | INTEGER | Used for the pre-ingestion size summary |
| `ingested_content_summary` | TEXT | A short description of what was actually read (e.g., "3 files, 12KB text extracted") — not the full raw content, which stays out of the database and is only held in-memory for the LLM call itself |
| `created_at` | DATETIME | |

*Plain English:* A record that a file/folder was attached to a conversation, and roughly what was done with it — not a copy of the file's actual contents, which are read fresh from disk each time rather than duplicated into the database.

### `user_config`
| Field | Type | Notes |
|---|---|---|
| `key` | TEXT PK | e.g. `wake_word_phrase`, `autonomous_mode_enabled` — provider-specific keys have moved to the `providers` table |
| `value` | TEXT | Encrypted where sensitive |

*Plain English:* Non-provider settings, stored as simple key-value pairs.

### `cloud_sync_state` *(only populated if the user opts into an account)*
| Field | Type | Notes |
|---|---|---|
| `supabase_user_id` | TEXT | |
| `last_synced_at` | DATETIME | |
| `sync_enabled` | BOOLEAN | |

*Plain English:* Tracks whether/when this local install last synced to the optional Supabase backend.

### `voice_profiles`
| Field | Type | Notes |
|---|---|---|
| `id` | TEXT (UUID) PK | |
| `label` | TEXT | e.g. "primary user" |
| `embedding` | BLOB | The voiceprint produced by the speaker-verification model — never raw audio |
| `enrolled_at` | DATETIME | |
| `updated_at` | DATETIME | |

*Plain English:* The mathematical "fingerprint" of the enrolled user's voice, used for voice biometrics.

### `autonomous_mode_config`
| Field | Type | Notes |
|---|---|---|
| `enabled` | BOOLEAN | Master on/off for Autonomous Mode, defaults to `false` |
| `tool_overrides` | TEXT (JSON) | Per-tool map, e.g. `{"send_email": "auto", "delete_file": "confirm_required"}` |
| `max_plan_steps` | INTEGER | Hard ceiling on chained tool calls per plan |
| `max_plan_duration_seconds` | INTEGER | Hard time ceiling on a single autonomous plan |

*Plain English:* What the user's Settings toggle and per-action risk-tolerance list actually write to.

### `agent_plans`
| Field | Type | Notes |
|---|---|---|
| `id` | TEXT (UUID) PK | |
| `conversation_id` | TEXT FK → `conversations.id` | |
| `goal` | TEXT | The original stated goal that triggered multi-step planning |
| `steps` | TEXT (JSON) | Ordered list of planned tool calls |
| `status` | TEXT | `planning` \| `in_progress` \| `completed` \| `stopped_by_limit` \| `stopped_by_user` \| `failed` |
| `created_at` | DATETIME | |
| `completed_at` | DATETIME | |

*Plain English:* The record of a multi-step plan itself, separate from the individual steps logged in `tool_executions`.

**Relationships in plain English:** A conversation has many messages. A message can trigger zero or one tool execution, reference zero or more attachments, and is handled by exactly one provider. Memory facts, providers, and config are independent of any single conversation — they're global to the user's install.

---

## 5. Environment Variables & Configuration Notes

Because this is BYOK and local-first, there is **no `.env` full of secrets shipped with the app** — everything provider-related is user-supplied at runtime through the Settings UI and stored encrypted in the `providers` table.

| Variable / Config | Where used | Notes |
|---|---|---|
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | Build-time, in `src/main/sync/` | Public/anon key only — safe to ship in the built app. Only relevant if cloud sync ships at all. |
| *(User-provided)* Any provider's API key | Runtime, entered by user in the Provider Settings UI | Never hardcoded, never committed. Stored encrypted via Electron's `safeStorage` API in the `providers` table, not plain text. |
| *(User-provided, `custom` preset only)* Base URL | Runtime, entered by user | Validated as a well-formed `http(s)://` URL before saving; see Security & Access Document Edge Cases for why this matters |
| `NODE_ENV` | Build tooling | `development` vs `production` |
| Code signing certs (macOS/Windows) | CI only, via GitHub Actions secrets | Needed for `electron-builder` to produce installers that don't trigger OS security warnings; not required for local dev builds |
| Auto-update feed URL | `electron-builder.yml` | Points at your GitHub Releases if you enable `electron-updater` |

**Key architectural notes before starting to build:**

1. **Never store raw API keys in SQLite as plain text, for any provider.** Use Electron's built-in `safeStorage` (OS keychain-backed encryption) to encrypt every key in the `providers` table before writing, decrypt only in-memory when making a call.
2. **The renderer process must never get direct file-system, shell, or network access.** All of that lives in the main process; the renderer only talks to main through `preload.ts`.
3. **Every tool handler should be a pure, individually testable function.**
4. **The provider registry is the extensibility seam.** Adding a new `openai_compatible` preset in the future is a data change (a new row/constant), not a new client implementation — this is the entire point of the v2.7.1 redesign, so don't let future providers regress back into one-off client files unless their schema genuinely isn't OpenAI-compatible.
5. **SQLite file location** should follow OS conventions via Electron's `app.getPath('userData')`.
6. **Raw audio never touches disk or the database**, regardless of whether STT/TTS is local or a configured cloud provider — audio buffers stream in-memory to/from whichever engine is active; only resulting text is persisted.
7. **`voiceConfirmationListener.ts` runs on a strict, short, bounded time window.**
8. **The animated background is a looping video, not a 3D scene** — no `three`/`@react-three/fiber`/`@react-three/drei` dependency.
9. **Wake word detection must run as a lightweight background process independent of the main window's visibility.**
10. **Voice biometric embeddings are sensitive data** — same `safeStorage`-backed encryption, excluded from cloud sync by default.
11. **The autonomous planner reuses the existing tool-execution and permission-check pipeline for every step.**
12. **Local voice model weights (Kokoro, Whisper) download automatically on first launch, not bundled** — show a visible, one-time download progress indicator; on failure, fall back to the OS-native/system or a configured cloud engine per the fallback rule in Section 2.4, rather than leaving voice dead. See the Security & Access Document's Error Handling Guide for the exact failure-messaging requirement.
13. **Streaming is required, not optional, for both text and audio (NEW).** `llmRouter.ts` must request streaming completions from whichever provider is active (all `openai_compatible` presets, Anthropic, and Gemini all support SSE/streaming responses) and forward tokens to the renderer as they arrive, rather than buffering the full response. `ttsService.ts` must synthesize and begin playback sentence-by-sentence as soon as a complete sentence is available in the incoming text stream, rather than waiting for the full message. This is the direct fix for the "responses and voice take too long" complaint, and applies regardless of which provider is configured — a fast provider with a non-streaming UI still feels slow, so the streaming plumbing matters independent of provider choice.
14. **File/folder attachment content is read fresh from disk into memory for each use, never duplicated into SQLite (NEW).** The `attachments` table stores metadata only (Section 4); the actual bytes are read via the main process's `fs` access at the moment they're needed for an LLM call, then discarded — consistent with the existing "raw content isn't persisted, only derived text/metadata is" pattern already used for voice.
15. **Drag-and-drop path resolution uses `webUtils.getPathForFile`, not the deprecated `File.path` (NEW).** This runs in the renderer on drop, and the resolved absolute path string is then passed through the normal IPC/tool-call flow exactly like a typed path would be — no new trust boundary, no new permission tier, just a different way of getting the string.