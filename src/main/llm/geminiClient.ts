/**
 * Google Gemini native API client (N-07).
 *
 * Implements the same llmTypes contract via the native schema: roles are
 * `user`/`model`, tools are `functionDeclarations`, tool calls are
 * `functionCall` parts, results are `functionResponse` parts keyed by
 * function NAME (so chat.handlers must set `LLMMessage.name` on `tool`-role
 * results), and streaming uses `:streamGenerateContent?alt=sse` (T-26).
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

const MAX_TOKENS = 4096;

interface GeminiPart {
  text?: string;
  functionCall?: { name: string; args?: Record<string, unknown> };
  functionResponse?: { name: string; response: { result: unknown } };
}

interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

function generateUrl(baseUrl: string, model: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;
}

function modelsUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/v1beta/models`;
}

function buildContents(
  messages: LLMMessage[]
): { contents: GeminiContent[]; system: string } {
  const systemParts: string[] = [];
  const contents: GeminiContent[] = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      systemParts.push(msg.content);
      continue;
    }
    if (msg.role === 'user') {
      contents.push({ role: 'user', parts: [{ text: msg.content }] });
      continue;
    }
    if (msg.role === 'tool') {
      contents.push({
        role: 'user',
        parts: [
          {
            functionResponse: {
              name: msg.name ?? msg.tool_call_id ?? '',
              response: { result: parseTextPayload(msg.content) },
            },
          },
        ],
      });
      continue;
    }
    // assistant / model
    const parts: GeminiPart[] = [];
    if (msg.content) parts.push({ text: msg.content });
    for (const call of msg.tool_calls ?? []) {
      parts.push({ functionCall: { name: call.function.name, args: parseArguments(call.function.arguments) } });
    }
    contents.push({ role: 'model', parts });
  }

  // Coalesce consecutive same-role turns (Gemini rejects user-user / model-model).
  const merged: GeminiContent[] = [];
  for (const item of contents) {
    const prev = merged[merged.length - 1];
    if (prev && prev.role === item.role) {
      prev.parts.push(...item.parts);
    } else {
      merged.push(item);
    }
  }
  return { contents: merged, system: systemParts.join('\n\n') };
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

/** Tool results arrive as JSON strings; keep them parseable for the model by
 *  preserving structure and falling back to a plain text payload. */
function parseTextPayload(content: string): unknown {
  if (!content) return { t: content };
  try {
    return JSON.parse(content);
  } catch {
    return { t: content };
  }
}

function finishReasonToStandard(reason: string | undefined): string {
  if (!reason) return 'stop';
  const map: Record<string, string> = {
    STOP: 'stop',
    MAX_TOKENS: 'length',
    SAFETY: 'content_filter',
    RECITATION: 'content_filter',
    OTHER: 'stop',
  };
  return map[reason] ?? reason;
}

async function postGenerate(
  baseUrl: string,
  model: string,
  apiKey: string,
  body: Record<string, unknown>
): Promise<Response> {
  try {
    return await fetch(generateUrl(baseUrl, model), {
      method: 'POST',
      headers: {
        'x-goog-api-key': apiKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw mapNetworkError(baseUrl);
  }
}

interface AccumulatedCall {
  name: string;
  argsJson: string;
}

export class GeminiProvider implements LLMProvider {
  name: string;
  displayName: string;
  schema = 'gemini_native' as const;
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

    const { contents, system } = buildContents(messages);
    const body: Record<string, unknown> = {
      contents: contents as unknown[],
      generationConfig: { temperature: 0.3, maxOutputTokens: MAX_TOKENS },
    };
    if (system.length > 0) {
      body.systemInstruction = { parts: [{ text: system }] };
    }
    if (tools.length > 0) {
      body.tools = [
        {
          functionDeclarations: tools.map(t => ({
            name: t.function.name,
            description: t.function.description,
            parameters: t.function.parameters,
          })),
        },
      ];
    }

    const response = await postGenerate(baseUrl, model, apiKey, body);
    if (!response.ok) {
      const err = (await response.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      throw mapHttpError(this.name, response.status, err.error?.message, model);
    }

    const calls = new Map<string, AccumulatedCall>();
    let finishReason = 'stop';
    let blocked = false;

    for await (const event of parseSseStream(response)) {
      let payload: {
        candidates?: Array<{
          content?: { parts?: GeminiPart[]; role?: string };
          finishReason?: string;
        }>;
        promptFeedback?: { blockReason?: string };
      };
      try {
        payload = JSON.parse(event.data);
      } catch {
        continue;
      }
      if (payload.promptFeedback?.blockReason) blocked = true;
      const candidate = payload.candidates?.[0];
      if (!candidate) continue;
      if (candidate.finishReason) {
        finishReason = finishReasonToStandard(candidate.finishReason);
      }
      const parts = candidate.content?.parts ?? [];
      for (const part of parts) {
        if (typeof part.text === 'string' && part.text.length > 0) {
          yield { kind: 'text', delta: part.text };
        }
        if (part.functionCall) {
          const name = part.functionCall.name;
          const acc = calls.get(name) ?? { name, argsJson: '' };
          if (part.functionCall.args) {
            try {
              acc.argsJson = JSON.stringify(part.functionCall.args);
            } catch {
              /* fall through */
            }
          }
          calls.set(name, acc);
        }
      }
    }

    if (calls.size > 0) {
      const toolCalls: LLMToolCall[] = Array.from(calls.values())
        .filter(c => c.name)
        .map(c => ({
          id: `call_${crypto.randomUUID().slice(0, 8)}`,
          type: 'function' as const,
          function: { name: c.name, arguments: c.argsJson || '{}' },
        }));
      if (toolCalls.length > 0) {
        yield { kind: 'tool_calls', calls: toolCalls };
      }
    }

    if (blocked && !calls.size) {
      throw new Error(
        `${this.displayName} declined this request (safety filter). Try rephrasing or a different provider.`
      );
    }

    yield { kind: 'done', finish_reason: finishReason };
  }

  async validateKey(apiKey: string): Promise<boolean> {
    try {
      const baseUrl = this.getBaseUrl();
      const response = await fetch(modelsUrl(baseUrl), {
        headers: { 'x-goog-api-key': apiKey },
      });
      return response.status !== 401 && response.status !== 403 && response.status !== 407;
    } catch {
      return false;
    }
  }
}