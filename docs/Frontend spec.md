# Kyclius — Frontend Specification Document

**Version:** 2.7.1 (supersedes 2.6.1)
**Status:** Pre-development

**Changelog from 2.6.1:**
- Home-screen "ask" flow now explicitly specified to never navigate away — response appears as a small inline element near the command bar (fixes EF-01).
- Conversation view explicitly specified to always include its own persistently docked command bar (fixes EF-05).
- Command bar focus state changed from a hard rectangular outline to a soft palette-matching glow (fixes EF-06).
- Added drag-and-drop styling for path-accepting fields and the command bar.
- Added the "+" attachment icon and attachment-chip component.
- AI Providers (and Voice/Text-to-Speech) settings sections rewritten around the dynamic provider-registry model — an open list of provider cards plus "Add Provider."
- Added the "How to Use" section to the Settings category list (now 17 categories) or as a top-level nav item.
- Added streaming-aware UI behavior for text and TTS playback.

---

## 1. Design Direction

Unchanged from 2.6.1. Kyclius's visual identity is calm, natural, and ambient. The home screen is a lush, painterly nature scene presented as a looping animated video, with the UI existing as translucent glass surfaces layered directly over it. There is no character, mascot, blob, or orb anywhere in the interface.

**Design principles:**
- **Ambient before active.** The home screen should feel alive and calm even when idle — and, as of v2.7.1, it should **remain** the active screen through ordinary use, not just at rest (see Section 5).
- **Clarity over cleverness in confirmations.** Unchanged.
- **Native, not web-y.** Unchanged.

---

## 2. Color Palette

Unchanged from 2.6.1.

| Token | Hex | Usage |
|---|---|---|
| `--color-sky-light` | `#DCEFFB` | Background gradient top, light surfaces |
| `--color-sky-deep` | `#6FA8D6` | Accent blue, links, focus rings *(no longer used for the command bar's focus state — see Section 4)* |
| `--color-leaf-primary` | `#4E8B4A` | Primary buttons, active states |
| `--color-leaf-soft` | `#8FC98A` | Secondary accents, success states, idle-state composer glow |
| `--color-blossom` | `#F2A6C9` | Accent highlights, notification dots, "awaiting confirmation" status tint |
| `--color-blossom-deep` | `#D9709F` | Active/focused accent state |
| `--color-stone` | `#E8E2D0` | Card backgrounds |
| `--color-bark` | `#6B5842` | Secondary text, borders on warm surfaces |
| `--color-ink` | `#2B2E2A` | Primary text |
| `--color-mist` | `#F7FAF9` | App chrome background |
| `--color-danger` | `#C0533E` | Confirm-required action warnings |
| `--color-success` | `#4E8B4A` | Completed action confirmations |
| `--color-warning` | `#D6A24A` | Non-blocking warnings |

---

## 3. Typography

Unchanged from 2.6.1 (Fraunces for headings, Inter for UI/body, JetBrains Mono for paths/commands/code — including, now, the resolved-path display for drag-and-dropped files per Section 4).

---

## 4. Component Styles

### Buttons
Unchanged from 2.6.1.

### Inputs

**Command bar (updated for v2.7.1):**
- Full-width, `--color-mist` background, 12px radius, soft inset shadow, placeholder text *"Ask Kyclius to do something…"*.
- A mic icon sits at the left, active/pulsing in `--color-blossom` while listening.
- **A "+" attach icon sits alongside the mic icon (NEW)** — clicking it opens the OS-native file/folder picker; the same drop target also accepts a direct drag-and-drop from the OS file manager (see the Attachment Dropzone spec below). Once a file/folder is attached, a small chip appears above or inline with the input showing the filename/foldername and a remove (×) control.
- The live transcript streams into the bar as text is recognized.
- Clicking directly into the bar to type is always available as a fallback.
- **Focus state (fixed for v2.7.1 — EF-06):** focusing the command bar (by click or tab) no longer shows the browser/OS default rectangular blue outline. Instead, use a soft glow consistent with the existing "Listening" state treatment already specced in Section 6 — `box-shadow: 0 0 0 3px rgba(143, 201, 138, 0.35)` (a soft `--color-leaf-soft` glow) or the `--color-blossom` equivalent, with `outline: none` explicitly set to suppress the default. This is a one-line CSS fix (the custom design token was simply never applied to override the browser default) — no structural change to the input itself.

**Drag-and-drop target behavior (NEW):** The command bar, and any Settings/dialog field that expects a file or folder path (e.g., a default save-location field), accepts a native OS drag-and-drop. On drag-over, the field shows a dashed `--color-leaf-soft` border and a subtle background tint to indicate it's a valid drop target. On drop, the path is resolved automatically (see Technical Architecture doc) and shown back to the user in monospace — for a path-only field this replaces the field's text content; for the command bar this creates an attachment chip exactly as if the "+" icon had been used.

**Standard text inputs (Settings, API key entry):** Unchanged — `--color-stone` background, `--color-bark` border, monospace for key/path fields with a show/hide toggle for secrets. **Custom provider `base_url` fields (NEW)** follow this same monospace treatment, since an exact URL is exactly the kind of value where ambiguous characters matter.

### Cards
Unchanged from 2.6.1, plus:
- **Attachment chip/card (NEW):** a compact card (not the full Card component size) showing a file-type icon, the filename/foldername, size, and a remove control — appears inline in the command bar area and, once sent, as part of the message it was attached to.
- **Provider card (NEW, replaces the old fixed "Groq/OpenRouter" cards):** see Section 8.

### Modals (Confirmation Dialogs)
Unchanged from 2.6.1.

### Sidebar Navigation (desktop, non-home views)
Unchanged from 2.6.1 — still ~288px, glass, floating, holds Conversations/Activity/Memory/Dashboard with Settings pinned at the bottom. **Clarification for v2.7.1:** this sidebar (and the dedicated views it leads to) is reached **only** by explicit navigation — see Section 5 for what changed about *not* reaching it accidentally from the home screen.

### Logo Mark
Unchanged from 2.6.1.

---

## 5. Spacing & Layout Rules

**Home screen (updated for v2.7.1 — fixes EF-01):** full-bleed looped video background, subtle overlay only where needed for legibility, composer panel anchored toward the lower-central portion of the screen. This is the one screen that stays purely ambient/immersive — and, as of this version, **asking a question from here never changes the screen or route.** The video keeps playing, the greeting and quick-action pills remain, and the exchange (question + streamed answer, spoken aloud) appears only as a **compact inline response strip** anchored just above or below the command bar — expanding to fit the exchange, then collapsing/fading once the user starts a new one. This inline strip is a lightweight, transient element, not a scrollable transcript — for the full conversation history, the user explicitly opens the Conversation view from the sidebar. Top navigation remains icon-only (logo mark + wordmark on the left; icon buttons for history/settings on the right), unchanged from 2.6.1.

**Every other view (Activity, Memory, Dashboard, Conversations):** on desktop, these share the persistent left sidebar app-shell — reached **only** when the user explicitly clicks into one of these destinations, never as a side effect of asking a question from the home screen. This is a stronger statement of the existing 2.6.1 rule, added because the previous wording left room for the home-screen "ask" flow to be implemented as a navigation, which is exactly the bug this version fixes.

**Conversation view specifically (updated for v2.7.1 — fixes EF-05):** in addition to the message list and header (back control, "New conversation"), the Conversation view **must** include its own command bar, persistently docked at the bottom, identical in capability to the home screen's (mic, "+", typed fallback, drag-and-drop target). A Conversation view with messages but no way to send a new one is considered incomplete/broken, not a valid state — this needs explicit test coverage given it regressed once already.

**Settings** stays a distinct floating modal/overlay. **Mobile bottom navigation** unchanged. **Chat/Workspace view** unchanged (max content width 720px, command bar docked at the bottom — now guaranteed present per the rule above). **Grid:** unchanged, 8px baseline / 16px gutters.

---

## 6. Status & Presence Indicators (No Character/Mascot)

Unchanged in structure from 2.6.1 (`idle | listening | thinking | awaiting_confirmation | executing | speaking | error`, expressed via the composer and other ordinary UI elements, no character). **Updated for streaming (v2.7.1):**

| State | Where it shows | Visual behavior |
|---|---|---|
| **Idle** | Composer border/glow | Calm `--color-leaf-soft` glow at rest; no motion |
| **Listening** | Composer border/glow + mic waveform | Border brightens, waveform animates |
| **Thinking** | Composer | Soft pulse while waiting for the *first* token — this state should be brief now that streaming is required; if it lasts more than ~1–2 seconds, that's a signal something upstream is slow and worth surfacing in logs |
| **Responding (NEW, replaces part of the old "Thinking" duration)** | Inline response strip (home) or message bubble (Conversation view) | Text renders progressively as tokens stream in, rather than appearing all at once after a delay |
| **Awaiting confirmation** | The confirmation modal itself | Unchanged |
| **Executing** | Activity view + inline status chip | Unchanged |
| **Speaking (updated)** | Speaker/waveform icon next to the assistant's message, with stop-playback control | Audio playback begins as soon as the first sentence has been synthesized, not after the full response completes — the waveform animation should visibly start well before the full text has finished streaming in, since these now happen concurrently |
| **Error** | Inline or toast | Restrained warning tint |

---

## 7. The Q&A Dashboard

Unchanged from 2.6.1, with one addition: each entry now also shows **which provider handled it** (e.g., a small "via NVIDIA NIM" label, matching `messages.provider_id`), consistent with the same provider-attribution pattern already visible in the Conversation view's message metadata.

---

## 8. Settings: Structure, Providers, Wake Word, Voice Enrollment, Autonomous Mode & How to Use

**Overall structure:** Unchanged — floating glass modal, internal left sidebar listing categories, selected category's content in the main panel.

**Full category list for v2.7.1** (supersedes the 2.6.1 list of 16): AI Providers, Voice Providers *(renamed/expanded from "Voice"/"Text-to-Speech" — see below)*, Models, Permissions, Memory, Voice Biometrics, Wake Word, Autonomous Mode, Integrations, GitHub, Activity, Privacy, Security, Appearance, Advanced, **How to Use (NEW)**. Group visually with light dividers as before; **How to Use** sits as its own group at the end, or — flagging this as a small open decision — could instead be a top-level nav item next to Activity/Memory/Dashboard if you want it more discoverable than a Settings category. Either placement should follow the existing grouped-category visual treatment.

### AI Providers (rewritten for v2.7.1)

This section no longer shows a fixed pair of cards. Instead:

- A list of **provider cards**, one per row in the `providers` table with `capability = 'llm'`, each showing: display name, preset icon/badge (or a generic "Custom" badge), connection status, a masked API key field with reveal/edit, a model selector (dynamically fetched from the provider where its API supports listing models; a free-text field otherwise), an Enable/Disable toggle, and a "Test Connection" action.
- Exactly one enabled provider can be marked **Default** (a small star/radio control on its card) — this is the provider used when the user doesn't explicitly say otherwise.
- An **"+ Add Provider"** button opens a chooser: a grid/list of built-in presets (Groq, OpenRouter, OpenAI, Anthropic, Gemini, NVIDIA NIM, Together AI, Fireworks, Mistral, DeepSeek) each pre-filled with the right base URL and auth format once picked, plus a **"Custom / OpenAI-Compatible"** option at the end of the list that instead asks for a display name, base URL, API key, and model name directly.
- Paid presets show a small, honest inline note (e.g., "Billed to your [Provider] account — Kyclius doesn't see or control your spend") — free-tier presets (Groq, OpenRouter, and any preset's free tier) don't need this note.
- A provider card can be deleted, which removes its row (and its encrypted key) entirely — this should require a lightweight confirmation ("Remove this provider? You'll need to re-enter the key to add it back") since it's a destructive-to-convenience action, though not data-loss in the file-deletion sense, so it doesn't need the full three-way permission-tier treatment used for tool actions.

### Voice Providers (renamed and expanded from "Voice" / "Text-to-Speech")

Same card-list-plus-"Add Provider" pattern as AI Providers, but split into two sub-sections within this one category:
- **Speech-to-Text:** local engine controls unchanged from 2.6.1 (Whisper local/System toggle, Large v3 Turbo / Small download rows), **plus** any configured cloud STT providers listed the same way as LLM provider cards, with the same Default-selection control. If a cloud STT provider is set as Default and later fails, the app falls back to whichever local option is available and shows the fallback-active note described in the Technical Architecture doc.
- **Text-to-Speech:** same structure — Kokoro/Chatterbox local options unchanged, plus cloud TTS provider cards (e.g., ElevenLabs, Cartesia) using the same pattern.

### Wake word, Voice enrollment, Autonomous Mode, Permissions & Confirmation

Unchanged from 2.6.1 — see the original document for full detail on each.

### How to Use (NEW)

A scrollable, searchable set of short sections (not one long document) covering, at minimum:
- First-run setup: adding a provider, granting mic permission.
- Voice commands vs. the typed fallback, and how the wake word works.
- What Always Allow / Ask Every Time / Never Allow mean, in plain language, with a couple of concrete examples.
- What Autonomous Mode does, its risks, and the recommended defaults for `delete_file`/`run_shell_command`.
- Voice biometrics: what it actually protects against and what it doesn't (matching the honest framing already established in the Security & Access Document).
- How to attach a file/folder (the "+" icon and drag-and-drop), and what happens to that content.
- How to add a paid or custom LLM/voice provider, and what "Default" means.
- Where to find the Q&A Dashboard and what it's for.

Written in the same plain, conversational, trust-building tone already used for things like the wake-word audio disclosure elsewhere in this doc set — this is part of the product experience, not a compliance afterthought. Each section should be short enough to scan, with clear headers, consistent with the app's calm/uncluttered design direction.

---

## 9. API & Third-Party Integration Spec

| Service | What it does | Endpoints called | Data sent | Expected response |
|---|---|---|---|---|
| **Any `openai_compatible` preset (Groq, OpenRouter, OpenAI, NVIDIA NIM, Together, Fireworks, Mistral, DeepSeek, Custom)** | LLM inference via one shared client, parameterized per provider | `POST {base_url}/chat/completions` (streaming) | Model name, message history + tool definitions, user's API key in `Authorization` header | Streamed JSON chunks; assembled into the assistant's message and/or a structured tool-call object |
| **Anthropic API** | LLM inference via native Messages API | `POST https://api.anthropic.com/v1/messages` (streaming) | Native-schema message history, user's API key in header | Streamed native-schema response, adapted internally to Kyclius's common format |
| **Google Gemini API** | LLM inference via native API | Native Gemini streaming endpoint | Native-schema request, user's API key | Streamed native-schema response, adapted internally |
| **Cloud STT provider (if configured)** | Speech-to-text | Provider-specific (e.g., a hosted Whisper endpoint, Deepgram) | Audio stream, user's API key | Transcript text |
| **Cloud TTS provider (if configured)** | Text-to-speech | Provider-specific (e.g., ElevenLabs, Cartesia) | Text (sentence-chunked as it becomes available), user's API key | Streamed audio |
| **GitHub API** | Read issues/PRs, post comments | `GET /repos/{owner}/{repo}/issues`, etc. | User's GitHub personal access token, repo owner/name, comment content | JSON list/resource |
| **System email client** | Sending drafted emails | OS `mailto:` handler or configured SMTP | Drafted subject/body/recipient | Confirmation the OS mail client accepted the send request |
| **Supabase** *(optional)* | Auth + cloud sync | Supabase JS SDK calls | Synced rows, scoped by RLS — **excluding `providers` and `voice_profiles`, per the Security & Access Document** | Synced row data or auth session tokens |

**Integration principle (updated for v2.7.1):** All outbound network calls should be enumerable in one place. With an open provider list, this now means the enumeration is **the contents of the `providers` table plus GitHub/Supabase**, rather than a fixed hardcoded list — the Privacy/Security Settings category should surface this dynamically (e.g., "Kyclius can currently reach: [list of enabled providers' base URLs], GitHub, [Supabase, if enabled]") so a security-conscious user can always see the real current picture, not a stale hardcoded description.