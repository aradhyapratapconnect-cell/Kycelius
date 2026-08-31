# Kyclius — Security & Access Document

**Version:** 2.7.1 (supersedes 2.6.1)
**Status:** Pre-development
**Written for:** a non-technical founder, in plain English, with technical detail where it matters

**Changelog from 2.6.1:**
- Generalized all API-key-handling language from "Groq/OpenRouter keys" to "any configured provider's key," since the provider list is now open-ended.
- Added the `providers` table to the cloud-sync exclusion list, alongside `voice_profiles`.
- Added new edge cases: a malicious/incorrect custom provider `base_url`, and attached-file content requiring the same prompt-injection safeguard as email/GitHub content.
- Generalized the API key error-handling row to cover every provider generically, not just two named ones.

---

## 1. Authentication Method

**What we're protecting against:** Kyclius is unusual for a "login system" because for most users there is no login at all. The core app works fully on-device with user-supplied API keys for whichever LLM/voice providers they choose. The only thing authentication protects is the *optional* cloud sync feature.

**Recommended approach: Supabase Auth, email + magic link (passwordless), used only for the optional account.**

- **Why passwordless:** No password to leak, forget, or reuse from another breach. Lower friction for an optional feature.
- **Why Supabase specifically:** It bundles auth and a Postgres database together, is free at the scale a hobby/early open-source project will see, and matches the local-first philosophy.
- **What's authenticated:** Only the sync relationship between a local install and the user's cloud data. The AI assistant itself, every provider's LLM/voice calls, and all local actions never require being logged in.
- **Session handling:** Supabase issues a JWT on login; it's stored using Electron's `safeStorage` (OS-keychain-backed), never in plain text, and refreshed automatically by the Supabase client SDK.

---

## 2. User Roles — What Each Can and Cannot Do

| Role | Can do | Cannot do |
|---|---|---|
| **Local user (default, no login)** | Use all core AI/chat/tool-execution features; configure any number of LLM/STT/TTS providers with their own keys; view, edit, and delete all local memory and history | Sync data across devices; access any other user's data (there is none — everything is local) |
| **Authenticated user (opted into cloud sync)** | Everything the local user can do, plus: sync memory/history/config to their own Supabase account; access that synced data from another device where they log in | Access another user's synced data; use cloud sync to bypass local permission confirmations |
| **Kyclius (the AI/"assistant")** | Propose actions (open app, create file, draft email, etc.), via whichever provider is currently active; execute **auto-allowed** actions without asking; execute **confirm-required** actions only after explicit user approval | Execute a confirm-required action without approval, under any circumstance, including when instructed by content it reads (email, file, GitHub issue, or an **attached file/folder** — see Edge Cases); access the network for anything other than the currently configured provider(s) and (if enabled) Supabase sync; modify its own permission rules; choose or switch its own provider without the user having configured and selected it |
| **Shared/community agent** *(post-MVP)* | Run within the same permission engine as built-in tools once installed | Introduce new auto-allowed action types without explicit user review at install time |

**Plain-English summary of the permission tiers you specified:**

| Action | Tier | Why |
|---|---|---|
| Open an application | Auto-allowed | Low risk, easily reversible, no data loss possible |
| Create a file | Auto-allowed | Low risk — creating something new doesn't destroy existing data |
| Attach/read a file or folder the user explicitly provided | Auto-allowed | The user is the one handing the content over directly (via drag-and-drop or the "+" icon) — this is fundamentally different from Kyclius reaching out and reading something on its own initiative |
| Send an email | Confirm required | Irreversible once sent, visible to a third party |
| Delete files | Confirm required | Irreversible, potential data loss |
| Run shell commands | Confirm required | Highest-risk category — always requires a human in the loop, exact command text always shown |

**A third tier — Never Allow.** Unchanged from 2.6.1: blocks an action outright before it ever reaches a confirmation prompt, and always wins over Autonomous Mode.

**How "confirm required" (Ask Every Time) is satisfied — voice or click, never a detour through the target app.** Unchanged from 2.6.1 — see the original mechanism description; it applies identically regardless of which LLM provider produced the proposed action.

---

## 3. Voice Confirmation — What It Trusts, and Its Limits

Unchanged from 2.6.1. This section governs the confirmation mechanism itself, which is provider-independent — it works the same way whether the underlying model call went to Groq, a paid OpenAI key, or a self-hosted custom endpoint. See the original document's full text for the phrase list, listening-window behavior, and the click-only fallback recommendation for less-private spaces.

## 4. Autonomous Mode — How Risk Tolerance Actually Works

Unchanged from 2.6.1, with one clarification: the LLM call that produces a multi-step plan goes through whichever provider is currently configured as default for `llm` capability, same as any single-step request — Autonomous Mode does not require or prefer any particular provider, and does not change which provider is used.

## 5. Voice Biometrics — What It Gates, and Its Limits

Unchanged from 2.6.1.

## 6. Always-On Background Listening — Privacy Model

Unchanged from 2.6.1.

## 7. Row-Level Security (RLS) Rules

Row-Level Security matters only for the optional Supabase cloud layer.

For the Supabase tables (mirroring the local schema for sync — `conversations`, `messages`, `memory_facts`, `tool_executions_log`):

- **Rule 1:** A row can only be read if `row.user_id = auth.uid()`.
- **Rule 2:** A row can only be inserted if the `user_id` being written matches `auth.uid()`.
- **Rule 3:** A row can only be updated or deleted under the same condition as reads.
- **Rule 4:** There is no `service_role` key anywhere in the shipped app.
- **Rule 5 (updated for v2.7.1):** **`voice_profiles` and `providers` are both excluded from the default cloud sync table set entirely**, even for a user with sync fully enabled for conversations/messages/memory. The `providers` table holds every configured API key (encrypted at rest, but still highly sensitive) across every LLM/STT/TTS provider the user has added — the same reasoning that kept biometric embeddings out of default sync applies with even more force here, since a leaked or misconfigured sync of this table would expose live API keys, not just a voiceprint. If a user wants encrypted provider configs to sync across their own devices in the future, that needs its own separate, explicit opt-in and its own dedicated security review — do not fold it into the general sync toggle by default.

**Plain English:** think of RLS as a bouncer standing at every single row of the database saying "is this your data? No? Then you can't see or touch it" — automatically, on every request, even if there's a bug in the app's own code.

---

## 8. Error Handling Guide (Major Failure Points)

| Failure point | What can go wrong | How Kyclius should handle it |
|---|---|---|
| **LLM API call (any configured provider)** | Invalid/expired API key, rate limit hit, network down, provider outage, malformed custom `base_url` unreachable | Show a clear, specific error naming the actual provider involved ("Your OpenAI key was rejected — check it in Settings" / "Couldn't reach the custom endpoint at [url] — check the address"), never a generic "something went wrong"; never silently retry a confirm-required action; never silently fall back to a *different* provider without telling the user, even though a same-capability fallback (e.g., cloud TTS → local TTS) is expected and fine per the voice-fallback rule below — the distinction is that LLM provider fallback is not automatic (the user picked that provider deliberately for reasoning), while voice-engine fallback is explicitly designed to be automatic and disclosed |
| **Cloud STT/TTS provider call** | Invalid/expired key, rate limit, network down | Same honest-and-specific error pattern as LLM calls, naming the actual voice provider; automatically fall back to the local engine (per Technical Architecture doc Section 2.4) with a clear, non-blocking on-screen note that the fallback is active |
| **Tool execution — file operations** | Permission denied by OS, disk full, path doesn't exist, file already exists | Catch and surface the OS-level error in plain language; never assume success |
| **Tool execution — file/folder attachment (NEW)** | Attached path no longer exists, permission denied reading it, folder far larger than reasonable to ingest | Show the size/file-count summary *before* ingesting (per Technical Architecture doc); if the read fails partway, report exactly what was and wasn't read rather than silently truncating |
| **Tool execution — send email** | Email client not configured, network failure mid-send, malformed address | Validate the recipient address format *before* showing the confirmation dialog; if sending fails after confirmation, clearly state it failed and did not send |
| **Tool execution — shell commands** | Command fails, times out, requires elevated permissions | Always show exit code and full stdout/stderr, never just "done"; enforce a timeout; never auto-elevate |
| **GitHub integration** | Expired/invalid GitHub token, rate limiting, repo/issue not found, network failure | Distinguish "not authenticated" from "unreachable" from "doesn't exist" |
| **Local database (SQLite)** | Disk full, corrupted DB file, concurrent write conflict | Keep automatic backups; fail loudly rather than silently dropping writes |
| **Optional cloud sync (Supabase)** | Auth token expired, sync conflict, offline | Sync failures must never block local functionality; on conflict, prefer most-recent-edit-wins but log the discarded version |
| **API key storage/decryption (any provider)** | OS keychain unavailable, corrupted encrypted blob for any provider's key | If a stored key can't be decrypted, prompt the user to re-enter it for that specific provider rather than crashing or silently disabling AI features with no explanation |
| **Voice input (speech-to-text)** | No microphone access/permission, unrecognized speech, background noise, low confidence, no STT engine currently loaded/reachable | If transcription confidence is low, ask the user to repeat rather than acting on a guessed transcript; if the mic is inaccessible, fall back to the typed command bar with a clear on-screen reason; if no STT engine (local or cloud) is currently usable, this must never silently do nothing — see the fallback requirement in the Technical Architecture doc |
| **Voice confirmation (listening for approval)** | Ambiguous speech, no response within the listening window, misrecognized word | Ambiguous/unrecognized speech is treated as "not approved," never as approval by default |
| **Voice output (text-to-speech)** | TTS engine unavailable/fails, no audio output device, no TTS engine currently loaded/reachable | Always show the written response regardless of whether speech succeeds; if no TTS engine (local or cloud) is usable, degrade to text-only with a visible note explaining that, never silent failure with no explanation |
| **Wake word detection (background)** | Background process crashes/stops, false positive triggers, mic permission revoked mid-session | Restart automatically on crash with a visible tray-icon state change |
| **Voice biometrics (speaker verification)** | No enrollment on file, low-confidence match | A low-confidence match fails closed; always offer the typed/click fallback |
| **Autonomous plan execution** | A step fails partway through, hits the step/time ceiling, encounters a step requiring confirmation | Report exactly which steps completed, failed, or were never reached |
| **Custom/OpenAI-compatible provider misconfiguration (NEW)** | User enters a malformed or unreachable `base_url`, or points it at a server that doesn't actually implement the expected API shape | Validate the URL format at save time and run a "Test Connection" call before marking the provider usable; if a saved custom provider starts failing later, surface that specifically ("Your Custom provider at [url] isn't responding") rather than a generic LLM error |

**General principle for all of the above:** every failure should produce a message a non-technical user could act on, not a raw stack trace or a silent no-op.

---

## 9. Edge Cases to Handle Before Launch

1. **Prompt injection via tool content.** If Kyclius reads an email, file, GitHub issue, web content, **or a user-attached file/folder (NEW)**, it must never treat embedded text within that content as a command from the user. Only text the user directly typed/spoke counts as an instruction — this now explicitly includes content read via the new file-attachment feature, which is a new content-ingestion surface and needs the identical injection safeguard already specified for email/GitHub/web content in the Agent & Tool Execution Specification. Flag this explicitly to whoever implements attachment ingestion, since it's easy to build the "happy path" of reading a file into context and forget this safeguard needs to apply there too.
2. **Ambiguous or destructive natural-language requests.** Unchanged from 2.6.1.
3. **API key leakage in logs or error reports (updated for v2.7.1).** With an open-ended provider list, this now applies generically to *every* provider's key in the `providers` table, not just two named ones — redact any value read from `api_key_encrypted` in all logging code paths, regardless of which provider it belongs to. A generic redaction rule keyed on the field name (not a hardcoded list of "Groq key, OpenRouter key") is what actually scales safely as more providers get added.
4. **Multiple confirm-required actions queued at once.** Unchanged from 2.6.1.
5. **User cancels mid-execution.** Unchanged from 2.6.1.
6. **Confirmation dialog fatigue.** Unchanged from 2.6.1.
7. **Cross-platform shell command differences.** Unchanged from 2.6.1.
8. **Losing network mid-LLM-response.** Only a fully-formed, complete tool call should ever reach the permission engine — this now also applies mid-stream: if a streamed response is interrupted before a tool call is fully assembled, the partial/malformed call must be discarded, never partially executed.
9. **First-run with no provider configured (updated for v2.7.1).** Kyclius should clearly block AI features with a helpful setup prompt directing the user to configure at least one LLM provider (from the preset list or Custom) rather than erroring unclearly — this replaces the 2.6.1 "no API key configured" case with the more general "no enabled `llm`-capability provider" case.
10. **Uninstall / data deletion.** Unchanged from 2.6.1 — note that deleting all Kyclius data must also clear every provider's encrypted key from the `providers` table, not just a single hardcoded config location.
11. **Background voices/TV/other speakers triggering a confirmation.** Unchanged from 2.6.1.
12. **A destructive confirmation spoken by a child or unintended household member.** Unchanged from 2.6.1.
13. **Voice command misheard as a different, unintended command.** Unchanged from 2.6.1.
14. **Autonomous Mode enabled, then the user changes their mind mid-plan.** Unchanged from 2.6.1.
15. **A tool's Autonomous Mode override is changed while a plan referencing it is already running.** Unchanged from 2.6.1.
16. **Voice enrollment recorded in a noisy environment, degrading future matching.** Unchanged from 2.6.1.
17. **Household members other than the enrolled user living with someone who has Autonomous Mode + auto-approved actions configured.** Unchanged from 2.6.1.
18. **Wake word false-triggers during normal conversation or media playback.** Unchanged from 2.6.1.
19. **A malicious or mistyped custom provider `base_url` (NEW).** Because the Custom/OpenAI-Compatible preset lets a user point Kyclius at *any* URL, a typo or a maliciously shared "helpful config" could send the user's conversation content and API key to an untrusted server. Mitigations: require `https://` by default with an explicit, separately-confirmed opt-in to allow plain `http://` (useful for local servers like Ollama on `localhost`, which should be allowed without the warning since it never leaves the machine); show the exact `base_url` being used prominently in the provider card, not hidden after setup; never auto-import or auto-apply a custom provider config from an external source (e.g., a pasted config blob) without the user seeing and confirming the exact URL and key fields first.
20. **An attached folder that's far larger than reasonable to send to an LLM (NEW).** Dragging in a large folder could balloon token usage/cost unexpectedly, especially with a paid provider. Show the file-count/size summary before ingesting (per Technical Architecture doc), and consider a soft warning threshold (e.g., "This folder has 400 files — are you sure you want to include all of it?") rather than silently processing everything.