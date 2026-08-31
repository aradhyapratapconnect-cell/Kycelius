"use strict";
/**
 * Shared types for the multi-provider LLM layer (N-07).
 *
 * The internal message/tool-call format is OpenAI-shaped; each adapter
 * (OpenAI-compatible, Anthropic native, Gemini native) translates to and from
 * its own API's schema. `LLMProvider` is the single client interface the
 * router depends on — every configured provider row is materialized into one
 * of these by the registry.
 */
Object.defineProperty(exports, "__esModule", { value: true });
