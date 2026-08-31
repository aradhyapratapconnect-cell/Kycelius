-- N-07/N-08: Open provider registry.
--
-- One table covers every provider the user has configured — free or paid LLM,
-- cloud STT, or cloud TTS. Provider-specific user_config keys (groq_api_key,
-- openrouter_api_key, groq_model, openrouter_model, llm_provider) are migrated
-- into rows here by providerRegistry.ts on first init; the user_config entries
-- are left in place for backwards compatibility and deleted once the migration
-- has run.
--
-- api_key_encrypted intentionally mirrors the base64 text convention used by
-- the legacy user_config key vault (the value written is `safeStorage` cipher
-- base64, never a raw key). A TEXT column round-trips that value without
-- better-sqlite3 coercing it into a Buffer on read, which would break
-- `safeStorage.decryptString`.

CREATE TABLE IF NOT EXISTS providers (
    id TEXT PRIMARY KEY,
    capability TEXT NOT NULL CHECK (capability IN ('llm', 'stt', 'tts')),
    preset_key TEXT NOT NULL,
    display_name TEXT NOT NULL,
    schema TEXT NOT NULL CHECK (
        schema IN (
            'openai_compatible',
            'anthropic_native',
            'gemini_native',
            'cloud_stt',
            'cloud_tts'
        )
    ),
    base_url TEXT,
    api_key_encrypted TEXT,
    default_model TEXT,
    enabled INTEGER NOT NULL DEFAULT 0,
    is_default INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_providers_capability ON providers(capability);