import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fork, type ChildProcess } from 'child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const HARNESS = join(process.cwd(), 'src', 'main', 'plugins', 'harness.cjs');

interface HarnessMessage {
  type: string;
  defs?: Array<{
    name: string;
    description: string;
    permissionTier: string;
    parameters: Record<string, unknown>;
  }>;
  result?: { success: boolean; result?: string; error?: string };
  id?: string;
  message?: string;
}

function writePlugin(dir: string, manifest: object, indexJs: string) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'plugin.json'), JSON.stringify(manifest), 'utf-8');
  writeFileSync(join(dir, 'index.js'), indexJs, 'utf-8');
}

function spawnHarness() {
  const child = fork(HARNESS, [], {
    execPath: process.execPath,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  });
  const received: HarnessMessage[] = [];
  child.on('message', (m: unknown) => received.push(m as HarnessMessage));

  const push = (msg: object) => child.send(msg);

  function waitFor(type: string, timeout = 8000): Promise<HarnessMessage> {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      const tick = () => {
        const found = received.find(m => m.type === type);
        if (found) return resolve(found);
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

let tmpRoot: string;
let harnesses: ChildProcess[] = [];

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'kyclius-plugin-test-'));
  harnesses = [];
});

afterEach(() => {
  for (const child of harnesses) {
    try {
      child.kill();
    } catch {
      // already gone
    }
  }
  rmSync(tmpRoot, { recursive: true, force: true });
});

async function withHarness(pluginDir: string, fn: (h: ReturnType<typeof spawnHarness>) => Promise<void>) {
  const h = spawnHarness();
  harnesses.push(h.child);
  h.push({ type: 'load', entry: join(pluginDir, 'index.js') });
  await fn(h);
  try {
    h.child.kill();
  } catch {
    // ignore
  }
}

describe('plugin harness (E2E, forked Node child)', () => {
  it('AC1: a third-party plugin registers tools with no core-code changes', async () => {
    writePlugin(
      tmpRoot,
      { id: 'a.b', name: 'x', version: '1', description: 'd', entry: 'index.js' },
      REVERSE_PLUGIN
    );
    await withHarness(tmpRoot, async h => {
      const ready = await h.waitFor('ready');
      expect(ready.defs?.map(d => d.name)).toEqual(['reverse_text', 'fail_tool', 'bad_result']);
      expect(ready.defs?.[0]).toMatchObject({
        name: 'reverse_text',
        permissionTier: 'auto',
        description: 'Reverses a piece of text.',
      });
      expect(ready.defs?.[0]?.parameters).toEqual({
        type: 'object',
        properties: { text: { type: 'string' } },
        required: ['text'],
      });
    });
  });

  it('executes a tool round-trip and returns the result', async () => {
    writePlugin(
      tmpRoot,
      { id: 'a.b', name: 'x', version: '1', description: 'd', entry: 'index.js' },
      REVERSE_PLUGIN
    );
    await withHarness(tmpRoot, async h => {
      await h.waitFor('ready');
      h.push({ type: 'execute', id: 'req-1', name: 'reverse_text', params: { text: 'abc' } });
      const result = await h.waitFor('result');
      expect(result.id).toBe('req-1');
      expect(result.result).toEqual({ success: true, result: 'cba' });
    });
  });

  it('surfaces a thrown handler error as a failed result', async () => {
    writePlugin(
      tmpRoot,
      { id: 'a.b', name: 'x', version: '1', description: 'd', entry: 'index.js' },
      REVERSE_PLUGIN
    );
    await withHarness(tmpRoot, async h => {
      await h.waitFor('ready');
      h.push({ type: 'execute', id: 'req-2', name: 'fail_tool', params: {} });
      const result = await h.waitFor('result');
      expect(result.result).toEqual({ success: false, error: 'boom' });
    });
  });

  it('rejects a malformed handler result', async () => {
    writePlugin(
      tmpRoot,
      { id: 'a.b', name: 'x', version: '1', description: 'd', entry: 'index.js' },
      REVERSE_PLUGIN
    );
    await withHarness(tmpRoot, async h => {
      await h.waitFor('ready');
      h.push({ type: 'execute', id: 'req-3', name: 'bad_result', params: {} });
      const result = await h.waitFor('result');
      expect(result.result?.success).toBe(false);
      expect(result.result?.error).toMatch(/malformed result/);
    });
  });

  it('refuses a tool that omits permissionTier (mirrors registerTool rule)', async () => {
    writePlugin(
      tmpRoot,
      { id: 'a.b', name: 'x', version: '1', description: 'd', entry: 'index.js' },
      NO_TIER_PLUGIN
    );
    await withHarness(tmpRoot, async h => {
      const err = await h.waitFor('error');
      expect(err.message).toMatch(/permissionTier/);
    });
  });

  it('refuses a plugin whose export is not a function', async () => {
    writePlugin(
      tmpRoot,
      { id: 'a.b', name: 'x', version: '1', description: 'd', entry: 'index.js' },
      `module.exports = { tools: [] };`
    );
    await withHarness(tmpRoot, async h => {
      const err = await h.waitFor('error');
      expect(err.message).toMatch(/export a function/);
    });
  });

  it('reports an error when the entry is missing', async () => {
    const emptyDir = join(tmpRoot, 'empty');
    mkdirSync(emptyDir, { recursive: true });
    const h = spawnHarness();
    harnesses.push(h.child);
    h.push({ type: 'load', entry: join(emptyDir, 'index.js') });
    const err = await h.waitFor('error');
    expect(err.message).toBeTruthy();
    try {
      h.child.kill();
    } catch {
      // ignore
    }
  });
});