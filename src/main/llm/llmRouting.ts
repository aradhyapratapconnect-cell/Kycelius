/**
 * N-04 — Rule-based multi-LLM routing.
 *
 * Pure decision logic (no Electron, no DB): given the routing config, the
 * active provider, the message list, and which providers actually have keys,
 * pick which provider/model should handle a request.
 *
 * Rule model:
 *   - Rules are evaluated in order against the newest user message.
 *   - A `pattern` is either a plain substring (case-insensitive) or, when it
 *     starts and ends with `/`, a regex literal (e.g. `/planner|schedule/`).
 *   - The first matching rule wins and pins `provider` + optional `model`.
 *   - No match  -> the active provider (configured as the default in Settings).
 *
 * AC3 (graceful single-provider fallback): if the rule's target provider has no
 * API key, fall back to the active provider when it is configured, otherwise to
 * the first configured provider. If the active provider is unconfigured but a
 * single provider has a key, that provider handles everything.
 */

import { randomUUID } from 'crypto';
import type { ProviderId } from './llmTypes';

// Backward-compatible default seed list. Since N-07 the source of truth is the
// `providers` table, so every validation/decision API accepts the live set of
// known provider ids instead of a hardcoded compile-time list.
export const ROUTING_PROVIDERS: ProviderId[] = ['groq', 'openrouter'];

export interface RoutingRule {
  id: string;
  description: string;
  /** Plain substring (case-insensitive) or `/.../` regex literal. */
  pattern: string;
  provider: ProviderId;
  /** Optional model override; empty/undefined uses the provider's configured model. */
  model?: string;
}

export interface LlmRoutingConfig {
  enabled: boolean;
  rules: RoutingRule[];
}

export const ROUTING_CONFIG_KEY = 'llm_routing_config';

export type RoutingReason = 'single' | 'rule' | 'no_match' | 'fallback';

export interface RoutingDecision {
  provider: ProviderId;
  /** Model override to use, or undefined to use the provider's configured model. */
  model?: string;
  reason: RoutingReason;
  matchedRuleId?: string;
  matchedRuleDescription?: string;
}

interface ResolveInput {
  enabled: boolean;
  rules: RoutingRule[];
  activeProvider: ProviderId;
  /** Message list (the newest `user` message is the routing subject). */
  messages: Array<{ role: string; content: string }>;
  isProviderConfigured: (provider: ProviderId) => boolean;
  /** Live ids of all configured provider rows (incl. custom UUID rows). */
  knownProviders: ProviderId[];
}

/** Compiles a pattern string; throws on an invalid regex literal. */
export function compilePattern(pattern: string): { test(text: string): boolean } {
  const trimmed = pattern.trim();
  if (!trimmed) {
    throw new Error('A routing rule needs a pattern to match against.');
  }
  if (trimmed.startsWith('/') && trimmed.endsWith('/') && trimmed.length > 2) {
    const body = trimmed.slice(1, -1);
    try {
      // eslint-disable-next-line prefer-regex-literals
      return new RegExp(body, 'i');
    } catch {
      throw new Error(`The regex "${body}" is invalid.`);
    }
  }
  const needle = trimmed.toLowerCase();
  return { test: (text: string) => text.toLowerCase().includes(needle) };
}

function isProviderIdValue(value: unknown, knownProviders: ProviderId[]): value is ProviderId {
  return typeof value === 'string' && knownProviders.includes(value as ProviderId);
}

/** Validates raw (e.g. from the renderer) rule fields; throws on invalid input. */
export function sanitizeRoutingRule(
  raw: Partial<RoutingRule>,
  knownProviders: ProviderId[]
): Omit<RoutingRule, 'id'> & { id?: string } {
  const pattern = typeof raw.pattern === 'string' ? raw.pattern.trim() : '';
  if (!pattern) {
    throw new Error('Every rule needs a pattern to match against.');
  }
  compilePattern(pattern); // throws a helpful message for bad regex
  if (!isProviderIdValue(raw.provider, knownProviders)) {
    throw new Error(`Rule targets unknown provider "${String(raw.provider)}".`);
  }
  let model: string | undefined;
  if (typeof raw.model === 'string' && raw.model.trim().length > 0) {
    const trimmed = raw.model.trim();
    if (trimmed.length > 200) throw new Error('Model override is too long.');
    model = trimmed;
  }
  return {
    id: typeof raw.id === 'string' && raw.id.length > 0 ? raw.id : undefined,
    description: typeof raw.description === 'string' ? raw.description.trim() : '',
    pattern,
    provider: raw.provider,
    model,
  };
}

/** Assigns stable ids and drops invalid rules before persisting. */
export function sanitizeRoutingRules(rawRules: unknown, knownProviders: ProviderId[]): RoutingRule[] {
  const rules = (Array.isArray(rawRules) ? rawRules : []) as Array<Partial<RoutingRule>>;
  const seen = new Set<string>();
  const result: RoutingRule[] = [];
  for (const raw of rules) {
    try {
      const rule = sanitizeRoutingRule(raw, knownProviders);
      const id = rule.id && !seen.has(rule.id) ? rule.id : randomUUID();
      seen.add(id);
      result.push({ ...rule, id });
    } catch {
      // Skip malformed rules entirely rather than crashing the save.
    }
  }
  return result;
}

export function getNewestUserText(
  messages: Array<{ role: string; content: string }>
): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') return messages[i].content;
  }
  return null;
}

/**
 * Picks the provider/model for one request.
 * `model` in the result is a rule override; resolve the concrete model id with
 * `getConfiguredModel(decision.provider)` unless the rule pinned one.
 */
export function resolveRoutingDecision(input: ResolveInput): RoutingDecision {
  const single = (provider: ProviderId, reason: RoutingReason): RoutingDecision => ({
    provider,
    reason,
  });

  if (!input.enabled) {
    return single(input.activeProvider, 'single');
  }

  const userText = getNewestUserText(input.messages);
  if (!userText) {
    return single(input.activeProvider, 'single');
  }

  // First matching rule wins.
  let matched: RoutingRule | null = null;
  for (const rule of input.rules) {
    let compiled: { test(text: string): boolean };
    try {
      compiled = compilePattern(rule.pattern);
    } catch {
      continue; // a bad pattern is skipped, never fatal
    }
    if (compiled.test(userText)) {
      matched = rule;
      break;
    }
  }

  const configured = input.knownProviders.filter(input.isProviderConfigured);

  if (!matched) {
    // No rule matched -> active provider, unless it's unconfigured, in which
    // case gracefully use any single configured provider (AC3).
    if (input.isProviderConfigured(input.activeProvider)) {
      return single(input.activeProvider, 'no_match');
    }
    if (configured.length === 1) {
      return single(configured[0], 'fallback');
    }
    return single(input.activeProvider, 'no_match');
  }

  const target: RoutingDecision = {
    provider: matched.provider,
    model: matched.model,
    reason: 'rule',
    matchedRuleId: matched.id,
    matchedRuleDescription: matched.description,
  };

  // Target configured -> use it.
  if (input.isProviderConfigured(matched.provider)) {
    return target;
  }

  // AC3: rule target has no key. Fall back to the active provider when
  // configured, otherwise the single configured provider.
  if (input.isProviderConfigured(input.activeProvider)) {
    return {
      provider: input.activeProvider,
      reason: 'fallback',
      matchedRuleId: matched.id,
      matchedRuleDescription: matched.description,
    };
  }
  if (configured.length === 1) {
    return {
      provider: configured[0],
      reason: 'fallback',
      matchedRuleId: matched.id,
      matchedRuleDescription: matched.description,
    };
  }
  // Nothing usable configured — keep the rule's intent; the provider layer will
  // surface the existing "no API key set" error rather than a crash.
  return target;
}