/**
 * N-02 — Shared/Community Agents.
 *
 * An "agent bundle" is a declarative manifest of a system prompt plus
 * references to existing registry tools, each with a permission-tier claim.
 * Users can export an installed agent, share that JSON, and import it on
 * another install.
 *
 * Security model (AC3): an imported bundle is DATA, not code — it can never
 * register a new executable tool. It can only reference tools that already
 * exist in the registry. Its permission claims are surfaced on the import
 * review screen, and no referenced tool is ever elevated to `auto` unless the
 * user explicitly approves it AND the underlying registry tool already runs
 * `auto`. A `confirm_required` tool cannot be upgraded to `auto` by an
 * imported manifest, period.
 */

import { randomUUID } from 'crypto';
import { getAllTools, getTool, type JSONSchema, type PermissionTier } from '../tools/toolRegistry';
import { installedAgents, type InstalledAgent } from '../db/db';

export const BUNDLE_FORMAT = 'kyclius-agent-bundle';
export const BUNDLE_FORMAT_VERSION = 1;

export interface AgentToolRef {
  name: string;
  /** The tier the bundle CLAIMS for this tool (surfaced for review). */
  permissionTier?: PermissionTier;
  /** Optional plain-language note about why this tool is used. */
  note?: string;
}

/** The on-disk / shareable agent bundle. */
export interface AgentBundle {
  format: typeof BUNDLE_FORMAT;
  formatVersion: number;
  agent: {
    id: string;
    name: string;
    description: string;
    version: string;
    author?: string;
    systemPrompt: string;
    tools: AgentToolRef[];
  };
}

/** What the review screen shows before install is confirmed. */
export interface AgentImportPreview {
  agent: {
    id: string;
    name: string;
    description: string;
    version: string;
    author?: string;
    systemPrompt: string;
  };
  tools: Array<{
    name: string;
    description: string;
    /** What this bundle claims. */
    claimedTier: PermissionTier;
    /** What the tool actually runs as in this install. */
    actualTier: PermissionTier;
    /** True when claimed auto but actual is confirm_required (cannot elevate). */
    wouldDowngrade: boolean;
    /** True when claimed auto AND actual is already auto (safe to allow). */
    canRunAuto: boolean;
  }>;
  /** Any referenced tool that doesn't exist in this install. */
  missingTools: string[];
}

interface ToolRecord {
  name: string;
  parameters: JSONSchema;
  description: string;
  permissionTier: PermissionTier;
}

/* ------------------------------------------------------------------ */
/*  Bundle validation                                                  */
/* ------------------------------------------------------------------ */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isValidTier(value: unknown): value is PermissionTier {
  return value === 'auto' || value === 'confirm_required';
}

/**
 * Structurally validates an arbitrary parsed value as an AgentBundle. Returns
 * the normalized bundle or throws a descriptive error.
 */
export function validateBundle(input: unknown): AgentBundle {
  if (!isPlainObject(input)) {
    throw new Error('Agent bundle must be a JSON object.');
  }
  if (input.format !== BUNDLE_FORMAT) {
    throw new Error('Not a Kyclius agent bundle (missing format header).');
  }
  if (input.formatVersion !== BUNDLE_FORMAT_VERSION) {
    throw new Error(`Unsupported bundle version: ${String(input.formatVersion)}.`);
  }

  const agent = input.agent;
  if (!isPlainObject(agent)) {
    throw new Error('Bundle is missing the "agent" manifest.');
  }

  const name = asString(agent.name);
  if (!name) throw new Error('Agent is missing a "name".');
  const description = asString(agent.description);
  if (!description) throw new Error(`Agent "${name}" is missing a "description".`);
  const version = asString(agent.version);
  if (!version) throw new Error(`Agent "${name}" is missing a "version".`);
  const systemPrompt = asString(agent.systemPrompt);
  if (!systemPrompt) throw new Error(`Agent "${name}" is missing a "systemPrompt".`);

  const rawTools = Array.isArray(agent.tools) ? agent.tools : [];
  const tools: AgentToolRef[] = rawTools.map(toolRaw => {
    if (!isPlainObject(toolRaw)) {
      throw new Error(`Agent "${name}" contains an invalid tool reference.`);
    }
    const toolName = asString(toolRaw.name);
    if (!toolName) {
      throw new Error(`Agent "${name}" contains a tool reference without a "name".`);
    }
    const ref: AgentToolRef = { name: toolName };
    if (toolRaw.permissionTier !== undefined) {
      if (!isValidTier(toolRaw.permissionTier)) {
        throw new Error(
          `Agent "${name}" declares an invalid permission tier for tool "${toolName}".`
        );
      }
      ref.permissionTier = toolRaw.permissionTier;
    }
    if (toolRaw.note !== undefined && typeof toolRaw.note === 'string') {
      ref.note = toolRaw.note.trim();
    }
    return ref;
  });

  return {
    format: BUNDLE_FORMAT,
    formatVersion: BUNDLE_FORMAT_VERSION,
    agent: {
      id: asString(agent.id) || randomUUID(),
      name,
      description,
      version,
      author: asString(agent.author) || undefined,
      systemPrompt,
      tools,
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Import preview (what the user reviews before install)              */
/* ------------------------------------------------------------------ */

export function buildImportPreview(bundle: AgentBundle): AgentImportPreview {
  const missingTools: string[] = [];
  const tools = bundle.agent.tools.map(ref => {
    const registered = getTool(ref.name);
    if (!registered) {
      missingTools.push(ref.name);
      return null;
    }
    const actualTier: PermissionTier = registered.permissionTier;
    const claimedTier: PermissionTier = ref.permissionTier ?? actualTier;
    const canRunAuto = claimedTier === 'auto' && actualTier === 'auto';
    return {
      name: registered.name,
      description: registered.description,
      claimedTier,
      actualTier,
      wouldDowngrade: claimedTier === 'auto' && actualTier !== 'auto',
      canRunAuto,
    };
  }).filter((t): t is NonNullable<typeof t> => t !== null);

  return {
    agent: {
      id: bundle.agent.id,
      name: bundle.agent.name,
      description: bundle.agent.description,
      version: bundle.agent.version,
      author: bundle.agent.author,
      systemPrompt: bundle.agent.systemPrompt,
    },
    tools,
    missingTools,
  };
}

/**
 * AC3: compute the stored per-tool decision. `approvedAuto` is the set of tool
 * names the user explicitly checked "allow automatic" on during review. A tool
 * only becomes `auto` if it was approved AND the underlying registry tool is
 * already `auto`. Everything else is pinned to `confirm_required`.
 */
export function computeToolDecisions(
  bundle: AgentBundle,
  approvedAuto: string[] = []
): Record<string, PermissionTier> {
  const decisions: Record<string, PermissionTier> = {};
  for (const ref of bundle.agent.tools) {
    const registered = getTool(ref.name);
    // Missing tools are dropped entirely (they can't run here).
    if (!registered) continue;
    const canAuto =
      ref.permissionTier !== 'confirm_required' &&
      registered.permissionTier === 'auto' &&
      approvedAuto.includes(ref.name);
    decisions[ref.name] = canAuto ? 'auto' : 'confirm_required';
  }
  return decisions;
}

/* ------------------------------------------------------------------ */
/*  Install / export                                                   */
/* ------------------------------------------------------------------ */

export function listInstalledAgents(): InstalledAgent[] {
  return installedAgents.getAll();
}

export function getActiveAgentId(): string | null {
  return installedAgents.getActive()?.id ?? null;
}

export function selectActiveAgent(id: string | null): void {
  installedAgents.setIsActive(id ?? '', !!id);
}

export function removeAgent(id: string): void {
  installedAgents.delete(id);
}

/** Install (or re-install/upgrade) a validated bundle with confirmed decisions. */
export function installAgent(
  bundle: AgentBundle,
  decisions: Record<string, PermissionTier>
): InstalledAgent {
  const agent: InstalledAgent = {
    id: bundle.agent.id,
    name: bundle.agent.name,
    description: bundle.agent.description,
    version: bundle.agent.version,
    author: bundle.agent.author ?? null,
    system_prompt: bundle.agent.systemPrompt,
    manifest_json: JSON.stringify(bundle),
    tool_decisions_json: JSON.stringify(decisions),
    active: false,
    installed_at: new Date().toISOString(),
  };
  installedAgents.upsert(agent);
  return agent;
}

/** Export an installed agent back to a shareable bundle object. */
export function exportBundle(agentId: string): AgentBundle {
  const agent = installedAgents.getById(agentId);
  if (!agent) throw new Error('Agent not found.');
  const stored = JSON.parse(agent.manifest_json) as AgentBundle;
  return stored;
}

export function buildBundleManifest(): AgentBundle {
  // A default/blank manifest template is not exported directly; exportBundle
  // is the authoritative path. This exists for constructing the UI's
  // "create a new agent" blank form if desired later.
  return {
    format: BUNDLE_FORMAT,
    formatVersion: BUNDLE_FORMAT_VERSION,
    agent: {
      id: randomUUID(),
      name: '',
      description: '',
      version: '1.0.0',
      systemPrompt: '',
      tools: [],
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Active-agent chat integration                                      */
/* ------------------------------------------------------------------ */

export interface AgentChatProfile {
  systemPrompt: string;
  tools: ToolRecord[];
}

/**
 * Builds the chat context for the currently active agent (if any): its system
 * prompt and its referenced tools with the EFFECTIVE permission tier from the
 * stored decisions. Missing tools are excluded. Returns null when no agent is
 * active.
 */
export function getActiveAgentChatProfile(): AgentChatProfile | null {
  const active = installedAgents.getActive();
  if (!active) return null;

  const bundle = JSON.parse(active.manifest_json) as AgentBundle;
  const decisions = JSON.parse(active.tool_decisions_json) as Record<string, PermissionTier>;

  const tools: ToolRecord[] = [];
  for (const ref of bundle.agent.tools) {
    const registered = getTool(ref.name);
    if (!registered) continue; // missing tool — can't run here
    tools.push({
      name: registered.name,
      parameters: registered.parameters,
      description: registered.description,
      // Enforce stored decision (never above the registry's real tier).
      permissionTier:
        decisions[ref.name] === 'auto' && registered.permissionTier === 'auto'
          ? 'auto'
          : registered.permissionTier,
    });
  }

  return { systemPrompt: active.system_prompt, tools };
}

/** The tool schemas the registry currently exposes (registry tools only). */
export function getRegistryToolCatalog(): ToolRecord[] {
  return getAllTools().map(t => ({
    name: t.name,
    parameters: t.parameters,
    description: t.description,
    permissionTier: t.permissionTier,
  }));
}