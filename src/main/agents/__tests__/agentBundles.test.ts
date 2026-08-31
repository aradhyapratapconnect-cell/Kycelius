import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../db/db', () => ({
  installedAgents: {
    upsert: vi.fn(),
    getAll: vi.fn(() => []),
    getById: vi.fn(() => undefined),
    getActive: vi.fn(() => undefined),
    setIsActive: vi.fn(),
    delete: vi.fn(),
  },
}));

import { registerTool, type PermissionTier } from '../../tools/toolRegistry';
import {
  validateBundle,
  buildImportPreview,
  computeToolDecisions,
  installAgent,
  getActiveAgentChatProfile,
  type AgentBundle,
} from '../agentBundles';

let counter = 0;
const unique = (prefix: string) => `${prefix}_${++counter}`;

function registerFixtureTool(name: string, tier: PermissionTier) {
  registerTool({
    name,
    description: `${name} fixture tool`,
    permissionTier: tier,
    parameters: { type: 'object', properties: { arg: { type: 'string' } } },
    handler: async () => ({ success: true }),
  });
  return name;
}

describe('N-02 agent bundle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Tool registry persists across tests — track names via counter to avoid
    // "already registered" collisions.
  });

  it('validates a well-formed bundle and rejects malformed ones', () => {
    const tool = registerFixtureTool(unique('read'), 'confirm_required');
    const good: AgentBundle = {
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
    expect(validateBundle(good).agent.name).toBe('Reviewer');

    expect(() => validateBundle({ format: 'other' })).toThrow(/format/);
    expect(() =>
      validateBundle({ format: 'kyclius-agent-bundle', formatVersion: 1, agent: {} })
    ).toThrow(/name/);
  });

  it('preview flags a confirm_required tool claimed as auto (would downgrade)', () => {
    const tool = registerFixtureTool(unique('audit'), 'confirm_required');
    const bundle: AgentBundle = {
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
    const preview = buildImportPreview(bundle);
    expect(preview.tools[0].wouldDowngrade).toBe(true);
    expect(preview.tools[0].canRunAuto).toBe(false);
    expect(preview.tools[0].actualTier).toBe('confirm_required');
  });

  it('AC3: a confirm_required tool can never become auto, even if approved', () => {
    const tool = registerFixtureTool(unique('guard'), 'confirm_required');
    const bundle: AgentBundle = {
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
    const decisions = computeToolDecisions(bundle, [tool]); // user "approved" auto
    expect(decisions[tool]).toBe('confirm_required');
  });

  it('an inherently-auto tool becomes auto only with explicit approval', () => {
    const tool = registerFixtureTool(unique('autoish'), 'auto');
    const bundle: AgentBundle = {
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
    expect(computeToolDecisions(bundle, [])[tool]).toBe('confirm_required');
    // With explicit approval → stays auto (tool is already inherently auto).
    expect(computeToolDecisions(bundle, [tool])[tool]).toBe('auto');
  });

  it('drops tools that do not exist in the registry', () => {
    const bundle: AgentBundle = {
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
    const preview = buildImportPreview(bundle);
    expect(preview.missingTools).toContain('definitely_not_real_tool_xyz');
    expect(computeToolDecisions(bundle, [])).toEqual({});
  });

  it('installs and round-trips through the db-agnostic install', () => {
    const tool = registerFixtureTool(unique('store'), 'confirm_required');
    const bundle: AgentBundle = {
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
    const installed = installAgent(bundle, computeToolDecisions(bundle, []));
    expect(installed.name).toBe('Persistent');
    expect(JSON.parse(installed.manifest_json).agent.name).toBe('Persistent');
    expect(JSON.parse(installed.tool_decisions_json)[tool]).toBe('confirm_required');
    // No active agent set by install — activation is an explicit separate step.
    expect(getActiveAgentChatProfile()).toBeNull();
  });
});
