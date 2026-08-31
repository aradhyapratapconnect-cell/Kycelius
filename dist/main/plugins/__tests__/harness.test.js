"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const child_process_1 = require("child_process");
const fs_1 = require("fs");
const os_1 = require("os");
const path_1 = require("path");
const HARNESS = (0, path_1.join)(process.cwd(), 'src', 'main', 'plugins', 'harness.cjs');
function writePlugin(dir, manifest, indexJs) {
    (0, fs_1.mkdirSync)(dir, { recursive: true });
    (0, fs_1.writeFileSync)((0, path_1.join)(dir, 'plugin.json'), JSON.stringify(manifest), 'utf-8');
    (0, fs_1.writeFileSync)((0, path_1.join)(dir, 'index.js'), indexJs, 'utf-8');
}
function spawnHarness() {
    const child = (0, child_process_1.fork)(HARNESS, [], {
        execPath: process.execPath,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    });
    const received = [];
    child.on('message', (m) => received.push(m));
    const push = (msg) => child.send(msg);
    function waitFor(type, timeout = 8000) {
        return new Promise((resolve, reject) => {
            const started = Date.now();
            const tick = () => {
                const found = received.find(m => m.type === type);
                if (found)
                    return resolve(found);
                if (Date.now() - started > timeout) {
                    return reject(new Error(`timeout waiting for "${type}"; saw ${JSON.stringify(received)}`));
                }
                setTimeout(tick, 10);
            };
            tick();
        });
    }
    return { child, push, waitFor, received };
}
const REVERSE_PLUGIN = `
module.exports = function (sdk) {
  sdk.registerTool({
    name: 'reverse_text',
    description: 'Reverses a piece of text.',
    permissionTier: 'auto',
    parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    handler: async (params) => ({ success: true, result: String(params.text || '').split('').reverse().join('') }),
  });
  sdk.registerTool({
    name: 'fail_tool',
    description: 'Throws on purpose.',
    permissionTier: 'confirm_required',
    parameters: { type: 'object', properties: {} },
    handler: async () => { throw new Error('boom'); },
  });
  sdk.registerTool({
    name: 'bad_result',
    description: 'Returns a malformed result.',
    permissionTier: 'confirm_required',
    parameters: { type: 'object', properties: {} },
    handler: async () => ({ nope: true }),
  });
};
`;
const NO_TIER_PLUGIN = `
module.exports = function (sdk) {
  sdk.registerTool({
    name: 'missing_tier',
    description: 'No tier declared.',
    parameters: { type: 'object', properties: {} },
    handler: async () => ({ success: true, result: 'x' }),
  });
};
`;
let tmpRoot;
let harnesses = [];
(0, vitest_1.beforeEach)(() => {
    tmpRoot = (0, fs_1.mkdtempSync)((0, path_1.join)((0, os_1.tmpdir)(), 'kyclius-plugin-test-'));
    harnesses = [];
});
(0, vitest_1.afterEach)(() => {
    for (const child of harnesses) {
        try {
            child.kill();
        }
        catch {
            // already gone
        }
    }
    (0, fs_1.rmSync)(tmpRoot, { recursive: true, force: true });
});
async function withHarness(pluginDir, fn) {
    const h = spawnHarness();
    harnesses.push(h.child);
    h.push({ type: 'load', entry: (0, path_1.join)(pluginDir, 'index.js') });
    await fn(h);
    try {
        h.child.kill();
    }
    catch {
        // ignore
    }
}
(0, vitest_1.describe)('plugin harness (E2E, forked Node child)', () => {
    (0, vitest_1.it)('AC1: a third-party plugin registers tools with no core-code changes', async () => {
        writePlugin(tmpRoot, { id: 'a.b', name: 'x', version: '1', description: 'd', entry: 'index.js' }, REVERSE_PLUGIN);
        await withHarness(tmpRoot, async (h) => {
            const ready = await h.waitFor('ready');
            (0, vitest_1.expect)(ready.defs?.map(d => d.name)).toEqual(['reverse_text', 'fail_tool', 'bad_result']);
            (0, vitest_1.expect)(ready.defs?.[0]).toMatchObject({
                name: 'reverse_text',
                permissionTier: 'auto',
                description: 'Reverses a piece of text.',
            });
            (0, vitest_1.expect)(ready.defs?.[0]?.parameters).toEqual({
                type: 'object',
                properties: { text: { type: 'string' } },
                required: ['text'],
            });
        });
    });
    (0, vitest_1.it)('executes a tool round-trip and returns the result', async () => {
        writePlugin(tmpRoot, { id: 'a.b', name: 'x', version: '1', description: 'd', entry: 'index.js' }, REVERSE_PLUGIN);
        await withHarness(tmpRoot, async (h) => {
            await h.waitFor('ready');
            h.push({ type: 'execute', id: 'req-1', name: 'reverse_text', params: { text: 'abc' } });
            const result = await h.waitFor('result');
            (0, vitest_1.expect)(result.id).toBe('req-1');
            (0, vitest_1.expect)(result.result).toEqual({ success: true, result: 'cba' });
        });
    });
    (0, vitest_1.it)('surfaces a thrown handler error as a failed result', async () => {
        writePlugin(tmpRoot, { id: 'a.b', name: 'x', version: '1', description: 'd', entry: 'index.js' }, REVERSE_PLUGIN);
        await withHarness(tmpRoot, async (h) => {
            await h.waitFor('ready');
            h.push({ type: 'execute', id: 'req-2', name: 'fail_tool', params: {} });
            const result = await h.waitFor('result');
            (0, vitest_1.expect)(result.result).toEqual({ success: false, error: 'boom' });
        });
    });
    (0, vitest_1.it)('rejects a malformed handler result', async () => {
        writePlugin(tmpRoot, { id: 'a.b', name: 'x', version: '1', description: 'd', entry: 'index.js' }, REVERSE_PLUGIN);
        await withHarness(tmpRoot, async (h) => {
            await h.waitFor('ready');
            h.push({ type: 'execute', id: 'req-3', name: 'bad_result', params: {} });
            const result = await h.waitFor('result');
            (0, vitest_1.expect)(result.result?.success).toBe(false);
            (0, vitest_1.expect)(result.result?.error).toMatch(/malformed result/);
        });
    });
    (0, vitest_1.it)('refuses a tool that omits permissionTier (mirrors registerTool rule)', async () => {
        writePlugin(tmpRoot, { id: 'a.b', name: 'x', version: '1', description: 'd', entry: 'index.js' }, NO_TIER_PLUGIN);
        await withHarness(tmpRoot, async (h) => {
            const err = await h.waitFor('error');
            (0, vitest_1.expect)(err.message).toMatch(/permissionTier/);
        });
    });
    (0, vitest_1.it)('refuses a plugin whose export is not a function', async () => {
        writePlugin(tmpRoot, { id: 'a.b', name: 'x', version: '1', description: 'd', entry: 'index.js' }, `module.exports = { tools: [] };`);
        await withHarness(tmpRoot, async (h) => {
            const err = await h.waitFor('error');
            (0, vitest_1.expect)(err.message).toMatch(/export a function/);
        });
    });
    (0, vitest_1.it)('reports an error when the entry is missing', async () => {
        const emptyDir = (0, path_1.join)(tmpRoot, 'empty');
        (0, fs_1.mkdirSync)(emptyDir, { recursive: true });
        const h = spawnHarness();
        harnesses.push(h.child);
        h.push({ type: 'load', entry: (0, path_1.join)(emptyDir, 'index.js') });
        const err = await h.waitFor('error');
        (0, vitest_1.expect)(err.message).toBeTruthy();
        try {
            h.child.kill();
        }
        catch {
            // ignore
        }
    });
});
