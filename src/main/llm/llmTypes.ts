/**
 * Shared types for the multi-provider LLM layer (N-07).
 *
 * The internal message/tool-call format is OpenAI-shaped; each adapter
 * (OpenAI-compatible, Anthropic native, Gemini native) translates to and from
 * its own API's schema. `LLMProvider` is the single client interface the
 * router depends on — every configured provider row is materialized into one
 * of these by the registry.
 */

/** Row id of a configured provider. Presets seed as `groq`, `openrouter`,
 * `openai`, etc.; additional `custom` rows get a UUID id. */
export type ProviderId = string;

export type ProviderCapability = 'llm' | 'stt' | 'tts';

export type ProviderSchema =
  | 'openai_compatible'
  | 'anthropic_native'
  | 'gemini_native'
  | 'cloud_stt'
  | 'cloud_tts';

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: LLMToolCall[];
  tool_call_id?: string;
  /** Function name for `tool`-role results — adapters whose native schema keys
   *  a function response by name (Gemini) need this alongside the call id. */
  name?: string;
}

export interface LLMToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface LLMToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface LLMResponse {
  content: string | null;
  tool_calls: LLMToolCall[] | null;
  finish_reason: string;
}

/** One event from a streaming completion (T-26). */
export type LLMStreamDelta =
  | { kind: 'text'; delta: string }
  | { kind: 'tool_calls'; calls: LLMToolCall[] }
  | { kind: 'done'; finish_reason: string };

/** Static config a provider adapter is built from. */
export interface LLMProviderConfig {
  /** Row id (preset key for presets, UUID for extra custom rows). */
  name: string;
  displayName: string;
  schema: ProviderSchema;
  baseUrl?: string;
  defaultModel: string;
}

export interface LLMProvider extends LLMProviderConfig {
  streamChat(
    messages: LLMMessage[],
    tools: LLMToolDefinition[],
    modelOverride: string | undefined
  ): AsyncGenerator<LLMStreamDelta>;
  validateKey(apiKey: string): Promise<boolean>;
  /** Optional: enumerates available models for the Settings model picker. */
  listModels?(): Promise<string[]>;
}

/** Which configured provider (and model) handled a given request. */
export interface LLMRoute {
  provider: ProviderId;
  model: string;
}