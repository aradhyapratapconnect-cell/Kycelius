"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const llmRouting_1 = require("../llmRouting");
const RULE = {
    id: 'r1',
    description: 'planning',
    pattern: 'plan',
    provider: 'groq',
};
const KNOWN = ['groq', 'openrouter'];
const messages = (texts) => texts.length > 0
    ? texts.map(content => ({ role: 'user', content }))
    : [{ role: 'user', content: 'hello' }];
(0, vitest_1.describe)('compilePattern', () => {
    (0, vitest_1.it)('matches plain substrings case-insensitively', () => {
        const p = (0, llmRouting_1.compilePattern)('open vs code');
        (0, vitest_1.expect)(p.test('please open vs code now')).toBe(true);
        (0, vitest_1.expect)(p.test('OPEN VS CODE')).toBe(true);
        (0, vitest_1.expect)(p.test('nothing here')).toBe(false);
    });
    (0, vitest_1.it)('supports /regex/ literals', () => {
        const p = (0, llmRouting_1.compilePattern)('/planner|schedule/');
        (0, vitest_1.expect)(p.test('run the planner')).toBe(true);
        (0, vitest_1.expect)(p.test('make a schedule')).toBe(true);
        (0, vitest_1.expect)(p.test('plans are nice')).toBe(false);
        (0, vitest_1.expect)(p.test('setup the plan')).toBe(false);
    });
    (0, vitest_1.it)('throws on invalid regex', () => {
        (0, vitest_1.expect)(() => (0, llmRouting_1.compilePattern)('/(/')).toThrow(/regex/);
    });
});
(0, vitest_1.describe)('getNewestUserText', () => {
    (0, vitest_1.it)('returns the latest user message, skipping later non-user roles', () => {
        (0, vitest_1.expect)((0, llmRouting_1.getNewestUserText)([
            { role: 'system', content: 'x' },
            { role: 'user', content: 'first' },
            { role: 'assistant', content: 'reply' },
            { role: 'user', content: 'second' },
        ])).toBe('second');
        (0, vitest_1.expect)((0, llmRouting_1.getNewestUserText)([])).toBeNull();
    });
});
(0, vitest_1.describe)('resolveRoutingDecision', () => {
    const bothConfigured = (p) => p === 'groq' || p === 'openrouter';
    const onlyGroq = (p) => p === 'groq';
    const none = () => false;
    (0, vitest_1.it)('routing disabled -> active provider (single-provider mode)', () => {
        const d = (0, llmRouting_1.resolveRoutingDecision)({
            enabled: false,
            rules: [RULE],
            activeProvider: 'groq',
            messages: messages(['let us plan something']),
            isProviderConfigured: bothConfigured,
            knownProviders: KNOWN,
        });
        (0, vitest_1.expect)(d).toMatchObject({ provider: 'groq', reason: 'single' });
    });
    (0, vitest_1.it)('every-day command routes by first matching rule', () => {
        const d = (0, llmRouting_1.resolveRoutingDecision)({
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
        (0, vitest_1.expect)(d).toEqual({
            provider: 'openrouter',
            model: 'deepseek-r1',
            reason: 'rule',
            matchedRuleId: 'r2',
            matchedRuleDescription: 'hard',
        });
    });
    (0, vitest_1.it)('first matching rule wins', () => {
        const d = (0, llmRouting_1.resolveRoutingDecision)({
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
        (0, vitest_1.expect)(d.provider).toBe('groq');
        (0, vitest_1.expect)(d.reason).toBe('rule');
    });
    (0, vitest_1.it)('no matching rule -> active provider', () => {
        const d = (0, llmRouting_1.resolveRoutingDecision)({
            enabled: true,
            rules: [RULE],
            activeProvider: 'openrouter',
            messages: messages(['hello there']),
            isProviderConfigured: bothConfigured,
            knownProviders: KNOWN,
        });
        (0, vitest_1.expect)(d).toEqual({ provider: 'openrouter', reason: 'no_match' });
    });
    (0, vitest_1.it)('AC3: rule targets an unconfigured provider -> falls back to active', () => {
        const d = (0, llmRouting_1.resolveRoutingDecision)({
            enabled: true,
            rules: [{ ...RULE, id: 'r1', pattern: 'plan', provider: 'openrouter', model: 'x' }],
            activeProvider: 'groq',
            messages: messages(['plan the trip']),
            isProviderConfigured: onlyGroq,
            knownProviders: KNOWN,
        });
        (0, vitest_1.expect)(d).toEqual({
            provider: 'groq',
            reason: 'fallback',
            matchedRuleId: 'r1',
            matchedRuleDescription: 'planning',
        });
    });
    (0, vitest_1.it)('AC3: active provider unconfigured too -> single configured provider', () => {
        const d = (0, llmRouting_1.resolveRoutingDecision)({
            enabled: true,
            rules: [{ ...RULE, id: 'r1', pattern: 'plan', provider: 'groq' }],
            activeProvider: 'groq',
            messages: messages(['plan something']),
            isProviderConfigured: (p) => p === 'openrouter',
            knownProviders: KNOWN,
        });
        (0, vitest_1.expect)(d.provider).toBe('openrouter');
        (0, vitest_1.expect)(d.reason).toBe('fallback');
    });
    (0, vitest_1.it)('AC3: nothing configured -> keeps intent, provider layer reports key missing', () => {
        const d = (0, llmRouting_1.resolveRoutingDecision)({
            enabled: true,
            rules: [{ ...RULE, id: 'r1', pattern: 'plan', provider: 'openrouter' }],
            activeProvider: 'groq',
            messages: messages(['plan']),
            isProviderConfigured: none,
            knownProviders: KNOWN,
        });
        (0, vitest_1.expect)(d).toMatchObject({ provider: 'openrouter', reason: 'rule' });
    });
    (0, vitest_1.it)('skips malformed rule patterns instead of failing', () => {
        const d = (0, llmRouting_1.resolveRoutingDecision)({
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
        (0, vitest_1.expect)(d.provider).toBe('openrouter');
    });
});
(0, vitest_1.describe)('sanitizeRoutingRule', () => {
    (0, vitest_1.it)('accepts a valid rule and normalizes the model', () => {
        const rule = (0, llmRouting_1.sanitizeRoutingRule)({
            id: 'r1',
            description: 'hi',
            pattern: 'email',
            provider: 'openrouter',
            model: '  deepseek-r1  ',
        }, KNOWN);
        (0, vitest_1.expect)(rule).toMatchObject({
            id: 'r1',
            pattern: 'email',
            provider: 'openrouter',
            model: 'deepseek-r1',
        });
    });
    (0, vitest_1.it)('drops an empty model override', () => {
        const rule = (0, llmRouting_1.sanitizeRoutingRule)({ pattern: 'x', provider: 'groq', model: '  ' }, KNOWN);
        (0, vitest_1.expect)(rule.model).toBeUndefined();
    });
    (0, vitest_1.it)('rejects unknown providers and invalid patterns', () => {
        (0, vitest_1.expect)(() => (0, llmRouting_1.sanitizeRoutingRule)({ pattern: 'x', provider: 'amazon' }, KNOWN)).toThrow(/provider/);
        (0, vitest_1.expect)(() => (0, llmRouting_1.sanitizeRoutingRule)({ pattern: '/(/', provider: 'groq' }, KNOWN)).toThrow(/regex/);
        (0, vitest_1.expect)(() => (0, llmRouting_1.sanitizeRoutingRule)({ pattern: ' ', provider: 'groq' }, KNOWN)).toThrow(/pattern/);
    });
});
(0, vitest_1.describe)('sanitizeRoutingRules', () => {
    (0, vitest_1.it)('drops malformed rules but keeps valid ones with stable ids', () => {
        const result = (0, llmRouting_1.sanitizeRoutingRules)([
            { id: 'keep', pattern: 'email', provider: 'groq' },
            { pattern: '/(/', provider: 'groq' },
            { id: 'keep', pattern: 'second', provider: 'openrouter' },
        ], KNOWN);
        (0, vitest_1.expect)(result.map(r => r.id)).toEqual(['keep', vitest_1.expect.any(String)]);
        (0, vitest_1.expect)(result).toHaveLength(2);
    });
    (0, vitest_1.it)('ignores non-array input', () => {
        (0, vitest_1.expect)((0, llmRouting_1.sanitizeRoutingRules)('nope', KNOWN)).toEqual([]);
    });
});
