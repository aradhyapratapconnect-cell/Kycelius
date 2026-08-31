import { describe, expect, it } from 'vitest';
import {
  validatePluginManifest,
  buildPluginInstallPreview,
  computePluginToolDecisions,
  type PluginManifest,
} from '../manifest';

describe('validatePluginManifest', () => {
  it('accepts a well-formed manifest', () => {
    const manifest = validatePluginManifest({
      id: 'com.example.tools',
      name: 'Example Tools',
      version: '1.0.0',
      author: 'Community',
      description: 'A sample plugin.',
      entry: 'index.js',
      capabilities: [{ kind: 'network', detail: 'https://api.example.com' }],
    });
    expect(manifest).toMatchObject({
      id: 'com.example.tools',
      name: 'Example Tools',
      version: '1.0.0',
      author: 'Community',
      entry: 'index.js',
    });
    expect(manifest.capabilities).toEqual([
      { kind: 'network', detail: 'https://api.example.com' },
    ]);
  });

  it('defaults capabilities to an empty list', () => {
    const manifest = validatePluginManifest({
      id: 'a.b',
      name: 'No caps',
      version: '0.1.0',
      description: 'Nothing declared.',
      entry: 'index.js',
    });
    expect(manifest.capabilities).toEqual([]);
  });

  it('rejects a missing id / bad id / missing fields', () => {
    expect(() => validatePluginManifest({ name: 'x' })).toThrow(/id/);
    expect(() =>
      validatePluginManifest({ id: 'not valid!', name: 'x', version: '1', description: 'd' })
    ).toThrow(/id/);
    expect(() => validatePluginManifest({ id: 'a.b' })).toThrow(/name/);
    expect(() => validatePluginManifest({ id: 'a.b', name: 'x' })).toThrow(/version/);
    expect(() =>
      validatePluginManifest({ id: 'a.b', name: 'x', version: '1' })
    ).toThrow(/description/);
    expect(() =>
      validatePluginManifest({ id: 'a.b', name: 'x', version: '1', description: 'd' })
    ).toThrow(/entry/);
  });

  it('skips malformed capability entries', () => {
    const manifest = validatePluginManifest({
      id: 'a.b',
      name: 'x',
      version: '1',
      description: 'd',
      entry: 'index.js',
      capabilities: [
        { kind: 'bogus', detail: 'ignored' },
        { kind: 'os', detail: '' },
        'not-an-object',
        { kind: 'filesystem', detail: 'read:~/notes' },
      ],
    });
    expect(manifest.capabilities).toEqual([{ kind: 'filesystem', detail: 'read:~/notes' }]);
  });
});

describe('buildPluginInstallPreview', () => {
  const manifest: PluginManifest = {
    id: 'a.b',
    name: 'x',
    version: '1',
    description: 'd',
    entry: 'index.js',
    capabilities: [{ kind: 'os', detail: 'clipboard' }],
  };

  it('surfaces tools and flags auto claims', () => {
    const preview = buildPluginInstallPreview(manifest, [
      { name: 't1', description: 'one', permissionTier: 'auto', parameters: { type: 'object' } },
      { name: 't2', description: 'two', permissionTier: 'confirm_required', parameters: { type: 'object' } },
    ]);
    expect(preview.tools).toHaveLength(2);
    expect(preview.hasAutoTools).toBe(true);
    expect(preview.capabilities).toEqual([{ kind: 'os', detail: 'clipboard' }]);
  });

  it('hasAutoTools is false when nothing claims auto', () => {
    const preview = buildPluginInstallPreview(manifest, [
      { name: 't1', description: 'one', permissionTier: 'confirm_required', parameters: { type: 'object' } },
    ]);
    expect(preview.hasAutoTools).toBe(false);
  });
});

describe('computePluginToolDecisions', () => {
  it('AC3: auto is only honored with explicit user approval', () => {
    const decisions = computePluginToolDecisions(
      [
        { name: 'a', description: '', permissionTier: 'auto', parameters: { type: 'object' } },
        { name: 'b', description: '', permissionTier: 'auto', parameters: { type: 'object' } },
        { name: 'c', description: '', permissionTier: 'confirm_required', parameters: { type: 'object' } },
      ],
      ['b']
    );
    expect(decisions).toEqual({
      a: 'confirm_required',
      b: 'auto',
      c: 'confirm_required',
    });
  });

  it('never elevates a confirm_required tool, even if approved', () => {
    const decisions = computePluginToolDecisions(
      [{ name: 'c', description: '', permissionTier: 'confirm_required', parameters: { type: 'object' } }],
      ['c']
    );
    expect(decisions.c).toBe('confirm_required');
  });
});