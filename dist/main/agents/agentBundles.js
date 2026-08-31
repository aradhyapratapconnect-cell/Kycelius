"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.BUNDLE_FORMAT_VERSION = exports.BUNDLE_FORMAT = void 0;
exports.validateBundle = validateBundle;
exports.buildImportPreview = buildImportPreview;
exports.computeToolDecisions = computeToolDecisions;
exports.listInstalledAgents = listInstalledAgents;
exports.getActiveAgentId = getActiveAgentId;
exports.selectActiveAgent = selectActiveAgent;
exports.removeAgent = removeAgent;
exports.installAgent = installAgent;
exports.exportBundle = exportBundle;
exports.buildBundleManifest = buildBundleManifest;
exports.getActiveAgentChatProfile = getActiveAgentChatProfile;
exports.getRegistryToolCatalog = getRegistryToolCatalog;
const crypto_1 = require("crypto");
const toolRegistry_1 = require("../tools/toolRegistry");
const db_1 = require("../db/db");
exports.BUNDLE_FORMAT = 'kyclius-agent-bundle';
exports.BUNDLE_FORMAT_VERSION = 1;
/* ------------------------------------------------------------------ */
/*  Bundle validation                                                  */
/* ------------------------------------------------------------------ */
function isPlainObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function asString(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function isValidTier(value) {
    return value === 'auto' || value === 'confirm_required';
}
/**
 * Structurally validates an arbitrary parsed value as an AgentBundle. Returns
 * the normalized bundle or throws a descriptive error.
 */
function validateBundle(input) {
    if (!isPlainObject(input)) {
        throw new Error('Agent bundle must be a JSON object.');
    }
    if (input.format !== exports.BUNDLE_FORMAT) {
        throw new Error('Not a Kyclius agent bundle (missing format header).');
    }
    if (input.formatVersion !== exports.BUNDLE_FORMAT_VERSION) {
        throw new Error(`Unsupported bundle version: ${String(input.formatVersion)}.`);
    }
    const agent = input.agent;
    if (!isPlainObject(agent)) {
        throw new Error('Bundle is missing the "agent" manifest.');
    }
    const name = asString(agent.name);
    if (!name)
        throw new Error('Agent is missing a "name".');
    const description = asString(agent.description);
    if (!description)
        throw new Error(`Agent "${name}" is missing a "description".`);
    const version = asString(agent.version);
    if (!version)
        throw new Error(`Agent "${name}" is missing a "version".`);
    const systemPrompt = asString(agent.systemPrompt);
    if (!systemPrompt)
        throw new Error(`Agent "${name}" is missing a "systemPrompt".`);
    const rawTools = Array.isArray(agent.tools) ? agent.tools : [];
    const tools = rawTools.map(toolRaw => {
        if (!isPlainObject(toolRaw)) {
            throw new Error(`Agent "${name}" contains an invalid tool reference.`);
        }
        const toolName = asString(toolRaw.name);
        if (!toolName) {
            throw new Error(`Agent "${name}" contains a tool reference without a "name".`);
        }
        const ref = { name: toolName };
        if (toolRaw.permissionTier !== undefined) {
            if (!isValidTier(toolRaw.permissionTier)) {
                throw new Error(`Agent "${name}" declares an invalid permission tier for tool "${toolName}".`);
            }
            ref.permissionTier = toolRaw.permissionTier;
        }
        if (toolRaw.note !== undefined && typeof toolRaw.note === 'string') {
            ref.note = toolRaw.note.trim();
        }
        return ref;
    });
    return {
        format: exports.BUNDLE_FORMAT,
        formatVersion: exports.BUNDLE_FORMAT_VERSION,
        agent: {
            id: asString(agent.id) || (0, crypto_1.randomUUID)(),
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
function buildImportPreview(bundle) {
    const missingTools = [];
    const tools = bundle.agent.tools.map(ref => {
        const registered = (0, toolRegistry_1.getTool)(ref.name);
        if (!registered) {
            missingTools.push(ref.name);
            return null;
        }
        const actualTier = registered.permissionTier;
        const claimedTier = ref.permissionTier ?? actualTier;
        const canRunAuto = claimedTier === 'auto' && actualTier === 'auto';
        return {
            name: registered.name,
            description: registered.description,
            claimedTier,
            actualTier,
            wouldDowngrade: claimedTier === 'auto' && actualTier !== 'auto',
            canRunAuto,
        };
    }).filter((t) => t !== null);
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
function computeToolDecisions(bundle, approvedAuto = []) {
    const decisions = {};
    for (const ref of bundle.agent.tools) {
        const registered = (0, toolRegistry_1.getTool)(ref.name);
        // Missing tools are dropped entirely (they can't run here).
        if (!registered)
            continue;
        const canAuto = ref.permissionTier !== 'confirm_required' &&
            registered.permissionTier === 'auto' &&
            approvedAuto.includes(ref.name);
        decisions[ref.name] = canAuto ? 'auto' : 'confirm_required';
    }
    return decisions;
}
/* ------------------------------------------------------------------ */
/*  Install / export                                                   */
/* ------------------------------------------------------------------ */
function listInstalledAgents() {
    return db_1.installedAgents.getAll();
}
function getActiveAgentId() {
    return db_1.installedAgents.getActive()?.id ?? null;
}
function selectActiveAgent(id) {
    db_1.installedAgents.setIsActive(id ?? '', !!id);
}
function removeAgent(id) {
    db_1.installedAgents.delete(id);
}
/** Install (or re-install/upgrade) a validated bundle with confirmed decisions. */
function installAgent(bundle, decisions) {
    const agent = {
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
    db_1.installedAgents.upsert(agent);
    return agent;
}
/** Export an installed agent back to a shareable bundle object. */
function exportBundle(agentId) {
    const agent = db_1.installedAgents.getById(agentId);
    if (!agent)
        throw new Error('Agent not found.');
    const stored = JSON.parse(agent.manifest_json);
    return stored;
}
function buildBundleManifest() {
    // A default/blank manifest template is not exported directly; exportBundle
    // is the authoritative path. This exists for constructing the UI's
    // "create a new agent" blank form if desired later.
    return {
        format: exports.BUNDLE_FORMAT,
        formatVersion: exports.BUNDLE_FORMAT_VERSION,
        agent: {
            id: (0, crypto_1.randomUUID)(),
            name: '',
            description: '',
            version: '1.0.0',
            systemPrompt: '',
            tools: [],
        },
    };
}
/**
 * Builds the chat context for the currently active agent (if any): its system
 * prompt and its referenced tools with the EFFECTIVE permission tier from the
 * stored decisions. Missing tools are excluded. Returns null when no agent is
 * active.
 */
function getActiveAgentChatProfile() {
    const active = db_1.installedAgents.getActive();
    if (!active)
        return null;
    const bundle = JSON.parse(active.manifest_json);
    const decisions = JSON.parse(active.tool_decisions_json);
    const tools = [];
    for (const ref of bundle.agent.tools) {
        const registered = (0, toolRegistry_1.getTool)(ref.name);
        if (!registered)
            continue; // missing tool — can't run here
        tools.push({
            name: registered.name,
            parameters: registered.parameters,
            description: registered.description,
            // Enforce stored decision (never above the registry's real tier).
            permissionTier: decisions[ref.name] === 'auto' && registered.permissionTier === 'auto'
                ? 'auto'
                : registered.permissionTier,
        });
    }
    return { systemPrompt: active.system_prompt, tools };
}
/** The tool schemas the registry currently exposes (registry tools only). */
function getRegistryToolCatalog() {
    return (0, toolRegistry_1.getAllTools)().map(t => ({
        name: t.name,
        parameters: t.parameters,
        description: t.description,
        permissionTier: t.permissionTier,
    }));
}
