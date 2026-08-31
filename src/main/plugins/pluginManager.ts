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

import { app } from 'electron';
import { fork, type ChildProcess } from 'child_process';
import { join } from 'path';
import { mkdirSync, cpSync, existsSync, rmSync, statSync, readFileSync } from 'fs';
import { randomUUID } from 'crypto';
import {
  registerTool,
  unregisterTool,
  getTool,
  DEFAULT_TOOL_TIMEOUT_MS,
  type JSONSchema,
} from '../tools/toolRegistry';
import { installedPlugins, type InstalledPlugin } from '../db/db';
import {
  validatePluginManifest,
  buildPluginInstallPreview,
  computePluginToolDecisions,
  PLUGIN_MANIFEST_FILE,
  type PluginManifest,
  type PluginInstallPreview,
  type PluginToolDisclosure,
} from './manifest';

export interface LoadedPlugin {
  child: ChildProcess;
  toolNames: string[];
  rpcPending: Map<string, (msg: { result?: ToolResultLike }) => void>;
}

interface ToolResultLike {
  success: boolean;
  result?: string;
  error?: string;
}

interface HarnessMessage {
  type: string;
  defs?: PluginToolDisclosure[];
  message?: string;
  id?: string;
  result?: ToolResultLike;
}

const HARNESS_PATH = join(__dirname, 'harness.cjs');
const LOAD_TIMEOUT_MS = 10_000;

const living = new Map<string, LoadedPlugin>(); // plugin id -> child + registered names

function pluginsBaseDir(): string {
  return join(app.getPath('userData'), 'plugins');
}

/* ------------------------------------------------------------------ */
/*  Child-process plumbing                                             */
/* ------------------------------------------------------------------ */

function forkHarness(): ChildProcess {
  return fork(HARNESS_PATH, [], {
    execPath: process.execPath,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  });
}

function readManifestFile(sourceDir: string): unknown {
  const manifestPath = join(sourceDir, PLUGIN_MANIFEST_FILE);
  if (!existsSync(manifestPath)) {
    throw new Error(`No ${PLUGIN_MANIFEST_FILE} found in the selected folder.`);
  }
  return JSON.parse(readFileSync(manifestPath, 'utf-8')) as unknown;
}

function assertLoadableEntry(manifest: PluginManifest, sourceDir: string): string {
  const entryPath = join(sourceDir, manifest.entry);
  if (!existsSync(entryPath)) {
    throw new Error(`Plugin entry file "${manifest.entry}" is missing.`);
  }
  if (!statSync(entryPath).isFile()) {
    throw new Error(`Plugin entry "${manifest.entry}" must be a file.`);
  }
  if (!/\.(c?js)$/.test(manifest.entry)) {
    throw new Error('Plugin entry must be a CommonJS .js/.cjs file.');
  }
  return entryPath;
}

/** Spawn a throwaway child that loads the entry and reports its tool defs. */
async function spawnAndLoad(entry: string): Promise<PluginToolDisclosure[]> {
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

    const fail = (err: Error) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(err);
      }
    };

    child.on('message', (msg: unknown) => {
      const message = msg as HarnessMessage;
      if (message.type === 'ready' && !settled) {
        settled = true;
        clearTimeout(timer);
        resolve(Array.isArray(message.defs) ? message.defs : []);
      } else if (message.type === 'error' && !settled) {
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

function registerPluginTools(
  plugin: InstalledPlugin,
  defs: PluginToolDisclosure[]
): { toolNames: string[]; skipped: string[] } {
  const decisions = JSON.parse(plugin.tool_decisions_json) as Record<
    string,
    'auto' | 'confirm_required'
  >;
  const toolNames: string[] = [];
  const skipped: string[] = [];

  for (const def of defs) {
    const tier = decisions[def.name] ?? 'confirm_required';
    // Never shadow an existing tool (built-in or another plugin's).
    if (getTool(def.name)) {
      skipped.push(def.name);
      continue;
    }
    registerTool({
      name: def.name,
      description: def.description,
      // The harness guarantees parameters.type === 'object' before defs are
      // ever relayed; the cast only bridges the two schema types.
      parameters: def.parameters as unknown as JSONSchema,
      permissionTier: tier,
      handler: (params) => callTool(plugin, def.name, params),
    });
    toolNames.push(def.name);
  }
  return { toolNames, skipped };
}

async function loadPlugin(plugin: InstalledPlugin): Promise<LoadedPlugin> {
  const child = forkHarness();
  const loaded: LoadedPlugin = {
    child,
    toolNames: [],
    rpcPending: new Map(),
  };

  const defs = await new Promise<PluginToolDisclosure[]>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill();
        reject(new Error(`Plugin load timed out (${plugin.name}).`));
      }
    }, LOAD_TIMEOUT_MS);

    const fail = (err: Error) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(err);
      }
    };

    child.on('message', (msg: unknown) => {
      const message = msg as HarnessMessage;
      if (message.type === 'ready' && !settled) {
        settled = true;
        clearTimeout(timer);
        resolve(Array.isArray(message.defs) ? message.defs : []);
      } else if (message.type === 'result' && message.id) {
        const pending = loaded.rpcPending.get(message.id);
        if (pending) {
          pending(message);
          loaded.rpcPending.delete(message.id);
        }
      } else if (message.type === 'error' && !settled) {
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

    child.send({ type: 'load', entry: join(plugin.plugin_dir, plugin.entry) });
  });

  const { toolNames, skipped } = registerPluginTools(plugin, defs);
  if (skipped.length > 0) {
    console.warn(`[plugins] ${plugin.name}: skipped already-registered tools: ${skipped.join(', ')}`);
  }
  loaded.toolNames = toolNames;
  living.set(plugin.id, loaded);
  return loaded;
}

async function callTool(
  plugin: InstalledPlugin,
  name: string,
  params: Record<string, unknown>
): Promise<ToolResultLike> {
  const loaded = living.get(plugin.id);
  if (!loaded || !loaded.child.connected) {
    return { success: false, error: 'Plugin is not running.' };
  }
  const id = randomUUID();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      loaded.rpcPending.delete(id);
      resolve({ success: false, error: `Plugin tool "${name}" timed out.` });
    }, DEFAULT_TOOL_TIMEOUT_MS);

    loaded.rpcPending.set(id, (msg) => {
      clearTimeout(timer);
      resolve(msg.result ?? { success: false, error: `Plugin tool "${name}" returned no result.` });
    });

    loaded.child.send({ type: 'execute', id, name, params });
  });
}

/** Unloads a plugin: kills its child and unregisters its tools. */
export async function unloadPlugin(pluginId: string): Promise<void> {
  const loaded = living.get(pluginId);
  if (loaded) {
    for (const name of loaded.toolNames) unregisterTool(name);
    try {
      loaded.child.kill();
    } catch {
      // already gone
    }
    living.delete(pluginId);
  }
}

/* ------------------------------------------------------------------ */
/*  Install / uninstall lifecycle                                      */
/* ------------------------------------------------------------------ */

export async function installPluginFromFolder(
  sourceDir: string,
  approvedAuto: string[]
): Promise<InstalledPlugin> {
  const manifest = validatePluginManifest(readManifestFile(sourceDir));
  const entryPath = assertLoadableEntry(manifest, sourceDir);

  // Self-reported tool defs (sandboxed inspect child — nothing installed yet).
  const toolDisclosures = await spawnAndLoad(entryPath);
  const decisions = computePluginToolDecisions(toolDisclosures, approvedAuto);

  // Copy the folder to a stable location under userData.
  const destDir = join(pluginsBaseDir(), manifest.id);
  if (existsSync(destDir)) rmSync(destDir, { recursive: true, force: true });
  mkdirSync(destDir, { recursive: true });
  cpSync(sourceDir, destDir, { recursive: true });

  const plugin: InstalledPlugin = {
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
  installedPlugins.upsert(plugin);
  return plugin;
}

export async function uninstallPlugin(id: string): Promise<void> {
  await unloadPlugin(id);
  installedPlugins.delete(id);
  const dir = join(pluginsBaseDir(), id);
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
}

export async function setPluginActive(id: string, active: boolean): Promise<void> {
  const plugin = installedPlugins.getById(id);
  if (!plugin) throw new Error('Plugin not found.');
  if (active) {
    try {
      await loadPlugin({ ...plugin, active: true });
    } catch (err) {
      throw new Error(`Could not load plugin: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    await unloadPlugin(id);
  }
  installedPlugins.setActive(id, active);
}

export function listPlugins() {
  return installedPlugins.getAll().map((plugin) => {
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
export async function reloadAllPlugins(): Promise<void> {
  for (const plugin of installedPlugins.getAll()) {
    if (!plugin.active) continue;
    try {
      await loadPlugin(plugin);
    } catch (err) {
      console.error(
        `[plugins] failed to load "${plugin.name}": ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
}

/** Validate + inspect a folder without installing (used by the preview dialog). */
export async function previewPluginFolder(
  sourceDir: string
): Promise<{ manifest: PluginManifest; preview: PluginInstallPreview }> {
  const manifest = validatePluginManifest(readManifestFile(sourceDir));
  const entryPath = assertLoadableEntry(manifest, sourceDir);
  const toolDisclosures = await spawnAndLoad(entryPath);
  const preview = buildPluginInstallPreview(manifest, toolDisclosures);
  return { manifest, preview };
}

/** Release all plugin children on quit. */
export function shutdownPlugins(): void {
  for (const [id, loaded] of living) {
    try {
      loaded.child.kill();
    } catch {
      // ignore
    }
    living.delete(id);
  }
}