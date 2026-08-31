// Kyclius plugin harness — runs inside a forked Node child process.
//
// A plugin is a plain CommonJS module that exports a single function:
//
//   module.exports = async function (sdk) {
//     sdk.registerTool({
//       name: 'my_tool',
//       description: 'What this tool does',
//       permissionTier: 'confirm_required',   // REQUIRED: 'auto' | 'confirm_required'
//       parameters: { type: 'object', properties: { ... }, required: [...] },
//       handler: async (params) => ({ success: true, result: '...' }),
//     });
//   };
//
// (also accepts `module.exports = { register(sdk) { ... } }`)
//
// `sdk.registerTool` enforces the same rules as the built-in registry before a
// tool is ever surfaced: an explicit permissionTier, a non-empty name and
// description, an object JSON schema, and a handler function. The child has no
// access to the main process, the database, or Electron — it only exchanges
// tool definitions and execution results over process IPC.
//
// Message protocol (parent -> child):
//   { type: 'load', entry }                    load <entry> and report its tools
//   { type: 'execute', id, name, params }      run a registered tool's handler
// Child -> parent:
//   { type: 'ready',  defs: [{name, description, parameters, permissionTier}] }
//   { type: 'result', id, result }
//   { type: 'error',  id?, message }

const { dirname } = require('path');

const VALID_TIERS = ['auto', 'confirm_required'];
const TOOL_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// The plugin's tools (including handlers) live here for this process's life.
// A harness process serves exactly one plugin.
const pluginTools = new Map();

function makeSdk(pluginDir) {
  return {
    // Absolute path to the plugin's own folder (for reading bundled assets).
    pluginDir: pluginDir,
    registerTool(def) {
      if (!isPlainObject(def)) throw new Error('registerTool requires a tool definition object');
      if (typeof def.name !== 'string' || def.name.trim().length === 0) {
        throw new Error('Tool must have a non-empty "name"');
      }
      if (!TOOL_NAME_RE.test(def.name)) {
        throw new Error(
          `Tool name "${def.name}" must match ^[A-Za-z_][A-Za-z0-9_]*$ (snake_case)`
        );
      }
      if (!VALID_TIERS.includes(def.permissionTier)) {
        throw new Error(
          `Tool "${def.name}" must declare an explicit permissionTier of 'auto' or 'confirm_required'`
        );
      }
      if (typeof def.description !== 'string' || def.description.trim().length === 0) {
        throw new Error(`Tool "${def.name}" must have a non-empty "description"`);
      }
      if (!isPlainObject(def.parameters) || def.parameters.type !== 'object') {
        throw new Error(`Tool "${def.name}" must have a JSON schema with top-level type "object"`);
      }
      if (typeof def.handler !== 'function') {
        throw new Error(`Tool "${def.name}" must have a handler function`);
      }
      if (pluginTools.has(def.name)) {
        throw new Error(`Tool "${def.name}" is registered twice by this plugin`);
      }
      pluginTools.set(def.name, {
        name: def.name,
        description: def.description,
        parameters: def.parameters,
        permissionTier: def.permissionTier,
        handler: def.handler,
      });
    },
  };
}

function send(message) {
  if (process.connected && process.send) {
    process.send(message);
  }
}

process.on('message', async (msg) => {
  if (!msg || typeof msg !== 'object') return;
  try {
    if (msg.type === 'load') {
      const entry = String(msg.entry);
      const mod = require(entry);
      const init =
        mod && typeof mod === 'object' && typeof mod.register === 'function'
          ? mod.register
          : mod;
      if (typeof init !== 'function') {
        throw new Error(
          'Plugin entry must export a function (module.exports = (sdk) => { ... }) or { register(sdk) }'
        );
      }
      await init(makeSdk(dirname(entry)));
      if (pluginTools.size === 0) {
        send({ type: 'error', message: 'Plugin registered no tools.' });
        return;
      }
      const defs = Array.from(pluginTools.values()).map(({ handler: _h, ...def }) => def);
      send({ type: 'ready', defs });
      return;
    }

    if (msg.type === 'execute') {
      const { id, name, params } = msg;
      const tool = pluginTools.get(String(name));
      if (!tool) {
        send({ type: 'error', id, message: `Unknown plugin tool: ${name}` });
        return;
      }
      let result;
      try {
        result = await tool.handler(params);
      } catch (err) {
        send({
          type: 'result',
          id,
          result: { success: false, error: err instanceof Error ? err.message : String(err) },
        });
        return;
      }
      if (!isPlainObject(result) || typeof result.success !== 'boolean') {
        send({
          type: 'result',
          id,
          result: { success: false, error: 'Plugin tool returned a malformed result' },
        });
        return;
      }
      send({ type: 'result', id, result });
      return;
    }
  } catch (err) {
    send({
      type: 'error',
      id: msg && msg.type === 'execute' ? msg.id : undefined,
      message: err instanceof Error ? err.message : String(err),
    });
  }
});