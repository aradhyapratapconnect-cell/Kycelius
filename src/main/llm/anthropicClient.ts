/**
 * Anthropic (Claude) native Messages API client (N-07).
 *
 * Implements the same llmTypes contract as the OpenAI-compatible client via
 * the native schema: tool_use / tool_result blocks, `x-api-key` auth, SSE
 * streaming (T-26) with text_delta / input_json_delta accumulation.
 *
 * Conversation mapping: our internal OpenAI-shaped messages map 1:1 —
 * assistant tool_calls become tool_use blocks, `tool`-role results become
 * user-message tool_result blocks keyed by tool_call_id, the leading system
 * prompt(s) become the `system` param.
 */

import { mapHttpError, mapNetworkError } from './providerErrors';
import { parseSseStream } from './sse';
import type {
  LLMMessage,
  LLMProvider,
  LLMProviderConfig,
  LLMStreamDelta,
  LLMToolCall,
  LLMToolDefinition,
} from './llmTypes';

const ANTHROPIC_VERSION = '2023-06-01';
const MAX_TOKENS = 4096;

type AnthropicBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_last_block?: boolean };

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: AnthropicBlock[];
}

/** Internal build phase may carry a transient `tool-result` message role. */
type BuiltMessage =
  | { role: 'user' | 'assistant'; content: AnthropicMessage['content'] }
  | { role: 'tool-result'; content: AnthropicMessage['content'] };

interface AccumulatedBlock {
  index: number;
  type?: 'text' | 'tool_use';
  text: string;
  toolUseId: string;
  toolName: string;
  json: string;
}

function messagesUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/v1/messages`;
}

function modelsUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/v1/models`;
}

function buildMessages(
  messages: LLMMessage[]
): { messages: AnthropicMessage[]; system: string } {
  const systemParts: string[] = [];
  const built: BuiltMessage[] = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      systemParts.push(msg.content);
      continue;
    }
    if (msg.role === 'user') {
      built.push({ role: 'user', content: [{ type: 'text', text: msg.content }] });
      continue;
    }
    if (msg.role === 'tool') {
      built.push({
        role: 'tool-result',
        content: [
          {
            type: 'tool_result',
            tool_use_id: msg.tool_call_id ?? '',
            content: msg.content,
          },
        ],
      });
      continue;
    }
    // assistant
    const blocks: AnthropicBlock[] = [];
    if (msg.content && msg.content.length > 0) {
      blocks.push({ type: 'text', text: msg.content });
    }
    for (const call of msg.tool_calls ?? []) {
      blocks.push({
        type: 'tool_use',
        id: call.id,
        name: call.function.name,
        input: parseArguments(call.function.arguments),
      });
    }
    built.push({ role: 'assistant', content: blocks });
  }

  // Coalesce consecutive messages of the same output role, then normalize
  // tool_result `is_last_block` flags within each user turn.
  const merged: AnthropicMessage[] = [];
  for (const item of built) {
    const role: 'user' | 'assistant' = item.role === 'tool-result' ? 'user' : item.role;
    const content = item.content;
    const prev = merged[merged.length - 1];
    if (prev && prev.role === role) {
      prev.content.push(...content);
    } else {
      merged.push({ role, content: [...content] });
    }
  }
  for (const message of merged) {
    if (message.role !== 'user') continue;
    const last = message.content[message.content.length - 1];
    if (last && last.type === 'tool_result') {
      for (const block of message.content) {
        if (block.type === 'tool_result') delete block.is_last_block;
      }
      last.is_last_block = true;
    }
  }

  return { messages: merged, system: systemParts.join('\n\n') };
}

function parseArguments(raw: string): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

async function postMessages(
  baseUrl: string,
  apiKey: string,
  body: Record<string, unknown>
): Promise<Response> {
  try {
    return await fetch(messagesUrl(baseUrl), {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw mapNetworkError(baseUrl);
  }
}

export class AnthropicProvider implements LLMProvider {
  name: string;
  displayName: string;
  schema = 'anthropic_native' as const;
  baseUrl?: string;
  defaultModel: string;

  constructor(config: LLMProviderConfig) {
    this.name = config.name;
    this.displayName = config.displayName;
    this.baseUrl = config.baseUrl;
    this.defaultModel = config.defaultModel;
  }

  private getBaseUrl(): string {
    const baseUrl = this.baseUrl?.trim();
    if (!baseUrl) {
      throw new Error(`${this.displayName} has no base URL configured.`);
    }
    return baseUrl;
  }

  async *streamChat(
    messages: LLMMessage[],
    tools: LLMToolDefinition[],
    modelOverride: string | undefined
  ): AsyncGenerator<LLMStreamDelta> {
    const baseUrl = this.getBaseUrl();
    const apiKey = (await import('./providerRegistry')).getDecryptedApiKey(this.name);
    const model = modelOverride ?? this.defaultModel;

    const { messages: anthropicMessages, system } = buildMessages(messages);
    const body: Record<string, unknown> = {
      model,
      max_tokens: MAX_TOKENS,
      stream: true,
      messages: anthropicMessages as unknown[],
    };
    if (system.length > 0) body.system = system;
    if (tools.length > 0) {
      body.tools = tools.map(t => ({
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters,
      }));
      body.tool_choice = { type: 'auto' };
    }

    const response = await postMessages(baseUrl, apiKey, body);
    if (!response.ok) {
      const err = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
      throw mapHttpError(this.name, response.status, err.error?.message, model);
    }

    const toolAccs = new Map<number, AccumulatedBlock>();
    let finishReason = 'stop';

    for await (const event of parseSseStream(response)) {
      if (event.event === 'error') {
        let message = event.data;
        try {
          const parsed = JSON.parse(event.data) as { error?: { message?: string } };
          message = parsed.error?.message ?? event.data;
        } catch {
          /* keep raw */
        }
        throw new Error(`${this.displayName}: ${message}`);
      }
      if (event.event !== 'content_block_start' && event.event !== 'content_block_delta' && event.event !== 'content_block_stop' && event.event !== 'message_delta') {
        continue;
      }

      if (event.event === 'content_block_start') {
        const payload = JSON.parse(event.data) as {
          index: number;
          content_block?: { type?: string; id?: string; name?: string };
        };
        const acc = toolAccs.get(payload.index) ?? {
          index: payload.index,
          text: '',
          toolUseId: '',
          toolName: '',
          json: '',
        };
        const blockType = payload.content_block?.type;
        if (blockType === 'text' || blockType === 'tool_use') acc.type = blockType;
        if (payload.content_block?.id) acc.toolUseId = payload.content_block.id;
        if (payload.content_block?.name) acc.toolName = payload.content_block.name;
        toolAccs.set(payload.index, acc);
        continue;
      }

      if (event.event === 'content_block_delta') {
        const payload = JSON.parse(event.data) as {
          index: number;
          delta?: { type?: string; text?: string; partial_json?: string };
        };
        const acc = toolAccs.get(payload.index) ?? { index: payload.index, text: '', toolUseId: '', toolName: '', json: '' };
        toolAccs.set(payload.index, acc);
        if (payload.delta?.type === 'text_delta' && payload.delta.text) {
          acc.text += payload.delta.text;
          yield { kind: 'text', delta: payload.delta.text };
        } else if (payload.delta?.type === 'input_json_delta' && payload.delta.partial_json !== undefined) {
          acc.json += payload.delta.partial_json;
        }
        continue;
      }

      if (event.event === 'content_block_stop') {
        const payload = JSON.parse(event.data) as { index: number };
        const acc = toolAccs.get(payload.index);
        if (acc && acc.type === 'tool_use' && acc.toolName) {
          yield {
            kind: 'tool_calls',
            calls: [
              {
                id: acc.toolUseId || `call_${crypto.randomUUID().slice(0, 8)}`,
                type: 'function',
                function: { name: acc.toolName, arguments: acc.json || '{}' },
              },
            ],
          };
        }
        toolAccs.delete(payload.index);
        continue;
      }

      if (event.event === 'message_delta') {
        const payload = JSON.parse(event.data) as {
          delta?: { stop_reason?: string | null };
        };
        if (payload.delta?.stop_reason) {
          finishReason = payload.delta.stop_reason === 'end_turn' ? 'stop' : payload.delta.stop_reason;
        }
      }
    }

    yield { kind: 'done', finish_reason: finishReason };
  }

  async validateKey(apiKey: string): Promise<boolean> {
    try {
      const baseUrl = this.getBaseUrl();
      const response = await fetch(modelsUrl(baseUrl), {
        headers: { 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_VERSION },
      });
      return response.status !== 401 && response.status !== 403 && response.status !== 407;
    } catch {
      return false;
    }
  }
}