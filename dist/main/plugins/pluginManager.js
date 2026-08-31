"use strict";
/**
 * N-03 — Plugin system runtime, main-process side.
 *
 * Plugins run inside forked Node child processes (harness.cjs) so untrusted
 * third-party code never runs in the main process. The main process only
 * holds the tool *definitions* the harness reported — registered into the real
 * toolRegistry — whose handlers round-trip an execution request to the child
 * over process IPC. Because those definitions are normal ToolDefinitions, every
 * plugin tool flows through the exact same validate → audit → permission-gate
 * → timeout pipeline as a built-in tool (AC2).
 *
 * Install flow (nothing loads until review):
 *   1. preview — validate plugin.json + spawn a throwaway "inspect" child to
 *      collect the self-reported tool defs (still sandboxed; nothing installed).
 *   2. confirm — copy the folder into userData, spawn the live child, register
 *      tools, persist. Auto claims are honored only if the user approved them.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.unloadPlugin = unloadPlugin;
exports.installPluginFromFolder = installPluginFromFolder;
exports.uninstallPlugin = uninstallPlugin;
exports.setPluginActive = setPluginActive;
exports.listPlugins = listPlugins;
exports.reloadAllPlugins = reloadAllPlugins;
exports.previewPluginFolder = previewPluginFolder;
exports.shutdownPlugins = shutdownPlugins;
const electron_1 = require("electron");
const child_process_1 = require("child_process");
const path_1 = require("path");
const fs_1 = require("fs");
const crypto_1 = require("crypto");
const toolRegistry_1 = require("../tools/toolRegistry");
const db_1 = require("../db/db");
const manifest_1 = require("./manifest");
const HARNESS_PATH = (0, path_1.join)(__dirname, 'harness.cjs');
const LOAD_TIMEOUT_MS = 10_000;
const living = new Map(); // plugin id -> child + registered names
function pluginsBaseDir() {
    return (0, path_1.join)(electron_1.app.getPath('userData'), 'plugins');
}
/* ------------------------------------------------------------------ */
/*  Child-process plumbing                                             */
/* ------------------------------------------------------------------ */
function forkHarness() {
    return (0, child_process_1.fork)(HARNESS_PATH, [], {
        execPath: process.execPath,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    });
}
function readManifestFile(sourceDir) {
    const manifestPath = (0, path_1.join)(sourceDir, manifest_1.PLUGIN_MANIFEST_FILE);
    if (!(0, fs_1.existsSync)(manifestPath)) {
        throw new Error(`No ${manifest_1.PLUGIN_MANIFEST_FILE} found in the selected folder.`);
    }
    return JSON.parse((0, fs_1.readFileSync)(manifestPath, 'utf-8'));
}
function assertLoadableEntry(manifest, sourceDir) {
    const entryPath = (0, path_1.join)(sourceDir, manifest.entry);
    if (!(0, fs_1.existsSync)(entryPath)) {
        throw new Error(`Plugin entry file "${manifest.entry}" is missing.`);
    }
    if (!(0, fs_1.statSync)(entryPath).isFile()) {
        throw new Error(`Plugin entry "${manifest.entry}" must be a file.`);
    }
    if (!/\.(c?js)$/.test(manifest.entry)) {
        throw new Error('Plugin entry must be a CommonJS .js/.cjs file.');
    }
    return entryPath;
}
/** Spawn a throwaway child that loads the entry and reports its tool defs. */
async function spawnAndLoad(entry) {
    return new Promise((resolve, reject) => {
        const child = forkHarness();
        let settled = false;
        const timer = setTimeout(() => {
            if (!settled) {
                settled = true;
                child.kill();
                reject(new Error('Plugin load timed out.'));
            }
        }, LOAD_TIMEOUT_MS);
        const fail = (err) => {
            if (!settled) {
                settled = true;
                clearTimeout(timer);
                reject(err);
            }
        };
        child.on('message', (msg) => {
            const message = msg;
            if (message.type === 'ready' && !settled) {
                settled = true;
                clearTimeout(timer);
                resolve(Array.isArray(message.defs) ? message.defs : []);
            }
            else if (message.type === 'error' && !settled) {
                clearTimeout(timer);
                child.kill();
                fail(new Error(message.message ?? 'Plugin failed to load.'));
            }
        });
        child.on('error', fail);
        child.on('exit', () => {
            if (!settled) {
                clearTimeout(timer);
                fail(new Error('Plugin process exited before loading.'));
            }
        });
        child.send({ type: 'load', entry });
    });
}
/* ------------------------------------------------------------------ */
/*  Live loading — registers plugin tools into the real registry       */
/* ------------------------------------------------------------------ */
function registerPluginTools(plugin, defs) {
    const decisions = JSON.parse(plugin.tool_decisions_json);
    const toolNames = [];
    const skipped = [];
    for (const def of defs) {
        const tier = decisions[def.name] ?? 'confirm_required';
        // Never shadow an existing tool (built-in or another plugin's).
        if ((0, toolRegistry_1.getTool)(def.name)) {
            skipped.push(def.name);
            continue;
        }
        (0, toolRegistry_1.registerTool)({
            name: def.name,
            description: def.description,
            // The harness guarantees parameters.type === 'object' before defs are
            // ever relayed; the cast only bridges the two schema types.
            parameters: def.parameters,
            permissionTier: tier,
            handler: (params) => callTool(plugin, def.name, params),
        });
        toolNames.push(def.name);
    }
    return { toolNames, skipped };
}
async function loadPlugin(plugin) {
    const child = forkHarness();
    const loaded = {
        child,
        toolNames: [],
        rpcPending: new Map(),
    };
    const defs = await new Promise((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => {
            if (!settled) {
                settled = true;
                child.kill();
                reject(new Error(`Plugin load timed out (${plugin.name}).`));
            }
        }, LOAD_TIMEOUT_MS);
        const fail = (err) => {
            if (!settled) {
                settled = true;
                clearTimeout(timer);
                reject(err);
            }
        };
        child.on('message', (msg) => {
            const message = msg;
            if (message.type === 'ready' && !settled) {
                settled = true;
                clearTimeout(timer);
                resolve(Array.isArray(message.defs) ? message.defs : []);
            }
            else if (message.type === 'result' && message.id) {
                const pending = loaded.rpcPending.get(message.id);
                if (pending) {
                    pending(message);
                    loaded.rpcPending.delete(message.id);
                }
            }
            else if (message.type === 'error' && !settled) {
                clearTimeout(timer);
                child.kill();
                fail(new Error(message.message ?? 'Plugin failed to load.'));
            }
        });
        child.on('error', fail);
        child.on('exit', () => {
            if (!settled) {
                clearTimeout(timer);
                fail(new Error('Plugin process exited before loading.'));
            }
        });
        child.send({ type: 'load', entry: (0, path_1.join)(plugin.plugin_dir, plugin.entry) });
    });
    const { toolNames, skipped } = registerPluginTools(plugin, defs);
    if (skipped.length > 0) {
        console.warn(`[plugins] ${plugin.name}: skipped already-registered tools: ${skipped.join(', ')}`);
    }
    loaded.toolNames = toolNames;
    living.set(plugin.id, loaded);
    return loaded;
}
async function callTool(plugin, name, params) {
    const loaded = living.get(plugin.id);
    if (!loaded || !loaded.child.connected) {
        return { success: false, error: 'Plugin is not running.' };
    }
    const id = (0, crypto_1.randomUUID)();
    return new Promise((resolve) => {
        const timer = setTimeout(() => {
            loaded.rpcPending.delete(id);
            resolve({ success: false, error: `Plugin tool "${name}" timed out.` });
        }, toolRegistry_1.DEFAULT_TOOL_TIMEOUT_MS);
        loaded.rpcPending.set(id, (msg) => {
            clearTimeout(timer);
            resolve(msg.result ?? { success: false, error: `Plugin tool "${name}" returned no result.` });
        });
        loaded.child.send({ type: 'execute', id, name, params });
    });
}
/** Unloads a plugin: kills its child and unregisters its tools. */
async function unloadPlugin(pluginId) {
    const loaded = living.get(pluginId);
    if (loaded) {
        for (const name of loaded.toolNames)
            (0, toolRegistry_1.unregisterTool)(name);
        try {
            loaded.child.kill();
        }
        catch {
            // already gone
        }
        living.delete(pluginId);
    }
}
/* ------------------------------------------------------------------ */
/*  Install / uninstall lifecycle                                      */
/* ------------------------------------------------------------------ */
async function installPluginFromFolder(sourceDir, approvedAuto) {
    const manifest = (0, manifest_1.validatePluginManifest)(readManifestFile(sourceDir));
    const entryPath = assertLoadableEntry(manifest, sourceDir);
    // Self-reported tool defs (sandboxed inspect child — nothing installed yet).
    const toolDisclosures = await spawnAndLoad(entryPath);
    const decisions = (0, manifest_1.computePluginToolDecisions)(toolDisclosures, approvedAuto);
    // Copy the folder to a stable location under userData.
    const destDir = (0, path_1.join)(pluginsBaseDir(), manifest.id);
    if ((0, fs_1.existsSync)(destDir))
        (0, fs_1.rmSync)(destDir, { recursive: true, force: true });
    (0, fs_1.mkdirSync)(destDir, { recursive: true });
    (0, fs_1.cpSync)(sourceDir, destDir, { recursive: true });
    const plugin = {
        id: manifest.id,
        name: manifest.name,
        version: manifest.version,
        author: manifest.author ?? null,
        description: manifest.description,
        entry: manifest.entry,
        plugin_dir: destDir,
        manifest_json: JSON.stringify(manifest),
        tool_decisions_json: JSON.stringify(decisions),
        active: true,
        installed_at: new Date().toISOString(),
    };
    // Live-load it so it's usable immediately after install.
    await loadPlugin(plugin);
    db_1.installedPlugins.upsert(plugin);
    return plugin;
}
async function uninstallPlugin(id) {
    await unloadPlugin(id);
    db_1.installedPlugins.delete(id);
    const dir = (0, path_1.join)(pluginsBaseDir(), id);
    if ((0, fs_1.existsSync)(dir))
        (0, fs_1.rmSync)(dir, { recursive: true, force: true });
}
async function setPluginActive(id, active) {
    const plugin = db_1.installedPlugins.getById(id);
    if (!plugin)
        throw new Error('Plugin not found.');
    if (active) {
        try {
            await loadPlugin({ ...plugin, active: true });
        }
        catch (err) {
            throw new Error(`Could not load plugin: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    else {
        await unloadPlugin(id);
    }
    db_1.installedPlugins.setActive(id, active);
}
function listPlugins() {
    return db_1.installedPlugins.getAll().map((plugin) => {
        const loaded = living.get(plugin.id);
        return {
            id: plugin.id,
            name: plugin.name,
            version: plugin.version,
            author: plugin.author,
            description: plugin.description,
            active: plugin.active,
            installed_at: plugin.installed_at,
            running: !!loaded,
            toolNames: loaded?.toolNames ?? [],
        };
    });
}
/** Reloads every active plugin at app startup. Per-plugin failures never block it. */
async function reloadAllPlugins() {
    for (const plugin of db_1.installedPlugins.getAll()) {
        if (!plugin.active)
            continue;
        try {
            await loadPlugin(plugin);
        }
        catch (err) {
            console.error(`[plugins] failed to load "${plugin.name}": ${err instanceof Error ? err.message : String(err)}`);
        }
    }
}
/** Validate + inspect a folder without installing (used by the preview dialog). */
async function previewPluginFolder(sourceDir) {
    const manifest = (0, manifest_1.validatePluginManifest)(readManifestFile(sourceDir));
    const entryPath = assertLoadableEntry(manifest, sourceDir);
    const toolDisclosures = await spawnAndLoad(entryPath);
    const preview = (0, manifest_1.buildPluginInstallPreview)(manifest, toolDisclosures);
    return { manifest, preview };
}
/** Release all plugin children on quit. */
function shutdownPlugins() {
    for (const [id, loaded] of living) {
        try {
            loaded.child.kill();
        }
        catch {
            // ignore
        }
        living.delete(id);
    }
}
