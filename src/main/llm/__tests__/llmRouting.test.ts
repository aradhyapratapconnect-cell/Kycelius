import { describe, expect, it } from 'vitest';
import {
  compilePattern,
  getNewestUserText,
  resolveRoutingDecision,
  sanitizeRoutingRule,
  sanitizeRoutingRules,
  type RoutingRule,
} from '../llmRouting';

const RULE: RoutingRule = {
  id: 'r1',
  description: 'planning',
  pattern: 'plan',
  provider: 'groq',
};

const KNOWN: string[] = ['groq', 'openrouter'];

const messages = (texts: string[]): Array<{ role: string; content: string }> =>
  texts.length > 0
    ? texts.map(content => ({ role: 'user', content }))
    : [{ role: 'user', content: 'hello' }];

describe('compilePattern', () => {
  it('matches plain substrings case-insensitively', () => {
    const p = compilePattern('open vs code');
    expect(p.test('please open vs code now')).toBe(true);
    expect(p.test('OPEN VS CODE')).toBe(true);
    expect(p.test('nothing here')).toBe(false);
  });

  it('supports /regex/ literals', () => {
    const p = compilePattern('/planner|schedule/');
    expect(p.test('run the planner')).toBe(true);
    expect(p.test('make a schedule')).toBe(true);
    expect(p.test('plans are nice')).toBe(false);
    expect(p.test('setup the plan')).toBe(false);
  });

  it('throws on invalid regex', () => {
    expect(() => compilePattern('/(/')).toThrow(/regex/);
  });
});

describe('getNewestUserText', () => {
  it('returns the latest user message, skipping later non-user roles', () => {
    expect(
      getNewestUserText([
        { role: 'system', content: 'x' },
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'reply' },
        { role: 'user', content: 'second' },
      ])
    ).toBe('second');
    expect(getNewestUserText([])).toBeNull();
  });
});

describe('resolveRoutingDecision', () => {
  const bothConfigured = (p: string) => p === 'groq' || p === 'openrouter';
  const onlyGroq = (p: string) => p === 'groq';
  const none = () => false;

  it('routing disabled -> active provider (single-provider mode)', () => {
    const d = resolveRoutingDecision({
      enabled: false,
      rules: [RULE],
      activeProvider: 'groq',
      messages: messages(['let us plan something']),
      isProviderConfigured: bothConfigured,
      knownProviders: KNOWN,
    });
    expect(d).toMatchObject({ provider: 'groq', reason: 'single' });
  });

  it('every-day command routes by first matching rule', () => {
    const d = resolveRoutingDecision({
      enabled: true,
      rules: [
        { ...RULE, id: 'r1', pattern: 'quick', provider: 'groq' },
        { id: 'r2', description: 'hard', pattern: 'planner', provider: 'openrouter', model: 'deepseek-r1' },
      ],
      activeProvider: 'groq',
      messages: messages(['run the planner please']),
      isProviderConfigured: bothConfigured,
      knownProviders: KNOWN,
    });
    expect(d).toEqual({
      provider: 'openrouter',
      model: 'deepseek-r1',
      reason: 'rule',
      matchedRuleId: 'r2',
      matchedRuleDescription: 'hard',
    });
  });

  it('first matching rule wins', () => {
    const d = resolveRoutingDecision({
      enabled: true,
      rules: [
        { id: 'r1', description: 'a', pattern: 'plan', provider: 'groq' },
        { id: 'r2', description: 'b', pattern: 'planner', provider: 'openrouter' },
      ],
      activeProvider: 'groq',
      messages: messages(['call the planner']),
      isProviderConfigured: bothConfigured,
      knownProviders: KNOWN,
    });
    expect(d.provider).toBe('groq');
    expect(d.reason).toBe('rule');
  });

  it('no matching rule -> active provider', () => {
    const d = resolveRoutingDecision({
      enabled: true,
      rules: [RULE],
      activeProvider: 'openrouter',
      messages: messages(['hello there']),
      isProviderConfigured: bothConfigured,
      knownProviders: KNOWN,
    });
    expect(d).toEqual({ provider: 'openrouter', reason: 'no_match' });
  });

  it('AC3: rule targets an unconfigured provider -> falls back to active', () => {
    const d = resolveRoutingDecision({
      enabled: true,
      rules: [{ ...RULE, id: 'r1', pattern: 'plan', provider: 'openrouter', model: 'x' }],
      activeProvider: 'groq',
      messages: messages(['plan the trip']),
      isProviderConfigured: onlyGroq,
      knownProviders: KNOWN,
    });
    expect(d).toEqual({
      provider: 'groq',
      reason: 'fallback',
      matchedRuleId: 'r1',
      matchedRuleDescription: 'planning',
    });
  });

  it('AC3: active provider unconfigured too -> single configured provider', () => {
    const d = resolveRoutingDecision({
      enabled: true,
      rules: [{ ...RULE, id: 'r1', pattern: 'plan', provider: 'groq' }],
      activeProvider: 'groq',
      messages: messages(['plan something']),
      isProviderConfigured: (p: string) => p === 'openrouter',
      knownProviders: KNOWN,
    });
    expect(d.provider).toBe('openrouter');
    expect(d.reason).toBe('fallback');
  });

  it('AC3: nothing configured -> keeps intent, provider layer reports key missing', () => {
    const d = resolveRoutingDecision({
      enabled: true,
      rules: [{ ...RULE, id: 'r1', pattern: 'plan', provider: 'openrouter' }],
      activeProvider: 'groq',
      messages: messages(['plan']),
      isProviderConfigured: none,
      knownProviders: KNOWN,
    });
    expect(d).toMatchObject({ provider: 'openrouter', reason: 'rule' });
  });

  it('skips malformed rule patterns instead of failing', () => {
    const d = resolveRoutingDecision({
      enabled: true,
      rules: [
        { id: 'bad', description: '', pattern: '/(/', provider: 'groq' },
        { id: 'good', description: '', pattern: 'plan', provider: 'openrouter' },
      ],
      activeProvider: 'groq',
      messages: messages(['plan']),
      isProviderConfigured: bothConfigured,
      knownProviders: KNOWN,
    });
    expect(d.provider).toBe('openrouter');
  });
});

describe('sanitizeRoutingRule', () => {
  it('accepts a valid rule and normalizes the model', () => {
    const rule = sanitizeRoutingRule({
      id: 'r1',
      description: 'hi',
      pattern: 'email',
      provider: 'openrouter',
      model: '  deepseek-r1  ',
    }, KNOWN);
    expect(rule).toMatchObject({
      id: 'r1',
      pattern: 'email',
      provider: 'openrouter',
      model: 'deepseek-r1',
    });
  });

  it('drops an empty model override', () => {
    const rule = sanitizeRoutingRule({ pattern: 'x', provider: 'groq', model: '  ' }, KNOWN);
    expect(rule.model).toBeUndefined();
  });

  it('rejects unknown providers and invalid patterns', () => {
    expect(() =>
      sanitizeRoutingRule({ pattern: 'x', provider: 'amazon' as never }, KNOWN)
    ).toThrow(/provider/);
    expect(() => sanitizeRoutingRule({ pattern: '/(/', provider: 'groq' }, KNOWN)).toThrow(/regex/);
    expect(() => sanitizeRoutingRule({ pattern: ' ', provider: 'groq' }, KNOWN)).toThrow(/pattern/);
  });
});

describe('sanitizeRoutingRules', () => {
  it('drops malformed rules but keeps valid ones with stable ids', () => {
    const result = sanitizeRoutingRules([
      { id: 'keep', pattern: 'email', provider: 'groq' },
      { pattern: '/(/', provider: 'groq' },
      { id: 'keep', pattern: 'second', provider: 'openrouter' },
    ], KNOWN);
    expect(result.map(r => r.id)).toEqual(['keep', expect.any(String)]);
    expect(result).toHaveLength(2);
  });

  it('ignores non-array input', () => {
    expect(sanitizeRoutingRules('nope', KNOWN)).toEqual([]);
  });
});