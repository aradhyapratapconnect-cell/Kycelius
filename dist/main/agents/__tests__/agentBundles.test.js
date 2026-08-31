"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
vitest_1.vi.mock('../../db/db', () => ({
    installedAgents: {
        upsert: vitest_1.vi.fn(),
        getAll: vitest_1.vi.fn(() => []),
        getById: vitest_1.vi.fn(() => undefined),
        getActive: vitest_1.vi.fn(() => undefined),
        setIsActive: vitest_1.vi.fn(),
        delete: vitest_1.vi.fn(),
    },
}));
const toolRegistry_1 = require("../../tools/toolRegistry");
const agentBundles_1 = require("../agentBundles");
let counter = 0;
const unique = (prefix) => `${prefix}_${++counter}`;
function registerFixtureTool(name, tier) {
    (0, toolRegistry_1.registerTool)({
        name,
        description: `${name} fixture tool`,
        permissionTier: tier,
        parameters: { type: 'object', properties: { arg: { type: 'string' } } },
        handler: async () => ({ success: true }),
    });
    return name;
}
(0, vitest_1.describe)('N-02 agent bundle', () => {
    (0, vitest_1.beforeEach)(() => {
        vitest_1.vi.clearAllMocks();
        // Tool registry persists across tests — track names via counter to avoid
        // "already registered" collisions.
    });
    (0, vitest_1.it)('validates a well-formed bundle and rejects malformed ones', () => {
        const tool = registerFixtureTool(unique('read'), 'confirm_required');
        const good = {
            format: 'kyclius-agent-bundle',
            formatVersion: 1,
            agent: {
                id: unique('agent'),
                name: 'Reviewer',
                description: 'Reviews code',
                version: '1.0.0',
                author: 'Community',
                systemPrompt: 'You are a code reviewer.',
                tools: [{ name: tool, permissionTier: 'confirm_required' }],
            },
        };
        (0, vitest_1.expect)((0, agentBundles_1.validateBundle)(good).agent.name).toBe('Reviewer');
        (0, vitest_1.expect)(() => (0, agentBundles_1.validateBundle)({ format: 'other' })).toThrow(/format/);
        (0, vitest_1.expect)(() => (0, agentBundles_1.validateBundle)({ format: 'kyclius-agent-bundle', formatVersion: 1, agent: {} })).toThrow(/name/);
    });
    (0, vitest_1.it)('preview flags a confirm_required tool claimed as auto (would downgrade)', () => {
        const tool = registerFixtureTool(unique('audit'), 'confirm_required');
        const bundle = {
            format: 'kyclius-agent-bundle',
            formatVersion: 1,
            agent: {
                id: unique('agent'),
                name: 'Optimist',
                description: 'claims auto on a confirm tool',
                version: '1.0.0',
                systemPrompt: 'p',
                tools: [{ name: tool, permissionTier: 'auto' }],
            },
        };
        const preview = (0, agentBundles_1.buildImportPreview)(bundle);
        (0, vitest_1.expect)(preview.tools[0].wouldDowngrade).toBe(true);
        (0, vitest_1.expect)(preview.tools[0].canRunAuto).toBe(false);
        (0, vitest_1.expect)(preview.tools[0].actualTier).toBe('confirm_required');
    });
    (0, vitest_1.it)('AC3: a confirm_required tool can never become auto, even if approved', () => {
        const tool = registerFixtureTool(unique('guard'), 'confirm_required');
        const bundle = {
            format: 'kyclius-agent-bundle',
            formatVersion: 1,
            agent: {
                id: unique('agent'),
                name: 'Sneaky',
                description: 'tries to go auto',
                version: '1.0.0',
                systemPrompt: 'p',
                tools: [{ name: tool, permissionTier: 'auto' }],
            },
        };
        const decisions = (0, agentBundles_1.computeToolDecisions)(bundle, [tool]); // user "approved" auto
        (0, vitest_1.expect)(decisions[tool]).toBe('confirm_required');
    });
    (0, vitest_1.it)('an inherently-auto tool becomes auto only with explicit approval', () => {
        const tool = registerFixtureTool(unique('autoish'), 'auto');
        const bundle = {
            format: 'kyclius-agent-bundle',
            formatVersion: 1,
            agent: {
                id: unique('agent'),
                name: 'Inline',
                description: 'safe auto',
                version: '1.0.0',
                systemPrompt: 'p',
                tools: [{ name: tool, permissionTier: 'auto' }],
            },
        };
        // Without explicit approval → downgraded to confirm (AC3).
        (0, vitest_1.expect)((0, agentBundles_1.computeToolDecisions)(bundle, [])[tool]).toBe('confirm_required');
        // With explicit approval → stays auto (tool is already inherently auto).
        (0, vitest_1.expect)((0, agentBundles_1.computeToolDecisions)(bundle, [tool])[tool]).toBe('auto');
    });
    (0, vitest_1.it)('drops tools that do not exist in the registry', () => {
        const bundle = {
            format: 'kyclius-agent-bundle',
            formatVersion: 1,
            agent: {
                id: unique('agent'),
                name: 'Missing',
                description: 'references unknown tool',
                version: '1.0.0',
                systemPrompt: 'p',
                tools: [{ name: 'definitely_not_real_tool_xyz', permissionTier: 'confirm_required' }],
            },
        };
        const preview = (0, agentBundles_1.buildImportPreview)(bundle);
        (0, vitest_1.expect)(preview.missingTools).toContain('definitely_not_real_tool_xyz');
        (0, vitest_1.expect)((0, agentBundles_1.computeToolDecisions)(bundle, [])).toEqual({});
    });
    (0, vitest_1.it)('installs and round-trips through the db-agnostic install', () => {
        const tool = registerFixtureTool(unique('store'), 'confirm_required');
        const bundle = {
            format: 'kyclius-agent-bundle',
            formatVersion: 1,
            agent: {
                id: unique('agent'),
                name: 'Persistent',
                description: 'round trip',
                version: '1.0.0',
                systemPrompt: 'p',
                tools: [{ name: tool, permissionTier: 'confirm_required' }],
            },
        };
        const installed = (0, agentBundles_1.installAgent)(bundle, (0, agentBundles_1.computeToolDecisions)(bundle, []));
        (0, vitest_1.expect)(installed.name).toBe('Persistent');
        (0, vitest_1.expect)(JSON.parse(installed.manifest_json).agent.name).toBe('Persistent');
        (0, vitest_1.expect)(JSON.parse(installed.tool_decisions_json)[tool]).toBe('confirm_required');
        // No active agent set by install — activation is an explicit separate step.
        (0, vitest_1.expect)((0, agentBundles_1.getActiveAgentChatProfile)()).toBeNull();
    });
});
