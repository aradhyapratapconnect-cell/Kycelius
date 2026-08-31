"use strict";
/**
 * N-03 — Plugin manifest format and validation.
 *
 * A plugin is a folder containing:
 *   plugin.json   — declarative manifest (below)
 *   <entry>       — a CommonJS file exporting `(sdk) => void` or `{ register(sdk) }`
 *
 * `plugin.json`:
 * {
 *   "id": "com.example.greeter",
 *   "name": "Greeter",
 *   "version": "1.0.0",
 *   "author": "Community",
 *   "description": "...",
 *   "entry": "index.js",
 *   "capabilities": [
 *     { "kind": "network",     "detail": "https://example.com" },
 *     { "kind": "filesystem",  "detail": "read:my documents" },
 *     { "kind": "os",          "detail": "clipboard" }
 *   ]
 * }
 *
 * `capabilities` are the OS/network resource disclosures shown to the user at
 * install time (AC3). `tools` are NOT declared in the manifest: they are
 * self-reported by the plugin code at load time through the harness and are
 * disclosed in the install review from the (validated) registry definitions.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PLUGIN_MANIFEST_FILE = void 0;
exports.validatePluginManifest = validatePluginManifest;
exports.buildPluginInstallPreview = buildPluginInstallPreview;
exports.formatCapability = formatCapability;
exports.computePluginToolDecisions = computePluginToolDecisions;
exports.PLUGIN_MANIFEST_FILE = 'plugin.json';
function isPlainObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function asString(value) {
    return typeof value === 'string' ? value.trim() : '';
}
const ID_RE = /^[A-Za-z][A-Za-z0-9_.-]*$/;
/**
 * Validates a raw parsed plugin.json. Returns the normalized manifest or throws
 * a descriptive error.
 */
function validatePluginManifest(input) {
    if (!isPlainObject(input))
        throw new Error('plugin.json must be a JSON object.');
    const id = asString(input.id);
    if (!id)
        throw new Error('plugin.json is missing an "id".');
    if (!ID_RE.test(id)) {
        throw new Error(`Plugin id "${id}" must match ^[A-Za-z][A-Za-z0-9_.-]*$`);
    }
    const name = asString(input.name);
    if (!name)
        throw new Error(`Plugin "${id}" is missing a "name".`);
    const version = asString(input.version);
    if (!version)
        throw new Error(`Plugin "${name}" is missing a "version".`);
    const description = asString(input.description);
    if (!description)
        throw new Error(`Plugin "${name}" is missing a "description".`);
    const entry = asString(input.entry);
    if (!entry)
        throw new Error(`Plugin "${name}" is missing an "entry" file.`);
    const rawCapabilities = Array.isArray(input.capabilities) ? input.capabilities : [];
    const capabilities = [];
    for (const raw of rawCapabilities) {
        if (!isPlainObject(raw))
            continue;
        const kind = asString(raw.kind);
        if (!['network', 'filesystem', 'os', 'other'].includes(kind))
            continue;
        const detail = asString(raw.detail);
        if (!detail)
            continue;
        capabilities.push({ kind, detail });
    }
    return {
        id,
        name,
        version,
        author: asString(input.author) || undefined,
        description,
        entry,
        capabilities,
    };
}
/** Builds the install review preview for a validated manifest. */
function buildPluginInstallPreview(manifest, toolDisclosures) {
    return {
        manifest: {
            id: manifest.id,
            name: manifest.name,
            version: manifest.version,
            author: manifest.author,
            description: manifest.description,
            entry: manifest.entry,
        },
        capabilities: manifest.capabilities,
        tools: toolDisclosures,
        hasAutoTools: toolDisclosures.some(t => t.permissionTier === 'auto'),
    };
}
function formatCapability(kind) {
    switch (kind) {
        case 'network':
            return 'Network access';
        case 'filesystem':
            return 'File access';
        case 'os':
            return 'OS access';
        default:
            return 'Other capability';
    }
}
/**
 * AC3: compute stored per-tool decisions for a plugin. A tool only becomes
 * `auto` if it declared `auto` AND the user explicitly approved it during the
 * install review. Everything else is pinned to `confirm_required`.
 */
function computePluginToolDecisions(toolDisclosures, approvedAuto = []) {
    const approved = new Set(approvedAuto);
    const decisions = {};
    for (const tool of toolDisclosures) {
        decisions[tool.name] =
            tool.permissionTier === 'auto' && approved.has(tool.name) ? 'auto' : 'confirm_required';
    }
    return decisions;
}
