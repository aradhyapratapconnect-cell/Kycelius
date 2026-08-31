"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const manifest_1 = require("../manifest");
(0, vitest_1.describe)('validatePluginManifest', () => {
    (0, vitest_1.it)('accepts a well-formed manifest', () => {
        const manifest = (0, manifest_1.validatePluginManifest)({
            id: 'com.example.tools',
            name: 'Example Tools',
            version: '1.0.0',
            author: 'Community',
            description: 'A sample plugin.',
            entry: 'index.js',
            capabilities: [{ kind: 'network', detail: 'https://api.example.com' }],
        });
        (0, vitest_1.expect)(manifest).toMatchObject({
            id: 'com.example.tools',
            name: 'Example Tools',
            version: '1.0.0',
            author: 'Community',
            entry: 'index.js',
        });
        (0, vitest_1.expect)(manifest.capabilities).toEqual([
            { kind: 'network', detail: 'https://api.example.com' },
        ]);
    });
    (0, vitest_1.it)('defaults capabilities to an empty list', () => {
        const manifest = (0, manifest_1.validatePluginManifest)({
            id: 'a.b',
            name: 'No caps',
            version: '0.1.0',
            description: 'Nothing declared.',
            entry: 'index.js',
        });
        (0, vitest_1.expect)(manifest.capabilities).toEqual([]);
    });
    (0, vitest_1.it)('rejects a missing id / bad id / missing fields', () => {
        (0, vitest_1.expect)(() => (0, manifest_1.validatePluginManifest)({ name: 'x' })).toThrow(/id/);
        (0, vitest_1.expect)(() => (0, manifest_1.validatePluginManifest)({ id: 'not valid!', name: 'x', version: '1', description: 'd' })).toThrow(/id/);
        (0, vitest_1.expect)(() => (0, manifest_1.validatePluginManifest)({ id: 'a.b' })).toThrow(/name/);
        (0, vitest_1.expect)(() => (0, manifest_1.validatePluginManifest)({ id: 'a.b', name: 'x' })).toThrow(/version/);
        (0, vitest_1.expect)(() => (0, manifest_1.validatePluginManifest)({ id: 'a.b', name: 'x', version: '1' })).toThrow(/description/);
        (0, vitest_1.expect)(() => (0, manifest_1.validatePluginManifest)({ id: 'a.b', name: 'x', version: '1', description: 'd' })).toThrow(/entry/);
    });
    (0, vitest_1.it)('skips malformed capability entries', () => {
        const manifest = (0, manifest_1.validatePluginManifest)({
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
        (0, vitest_1.expect)(manifest.capabilities).toEqual([{ kind: 'filesystem', detail: 'read:~/notes' }]);
    });
});
(0, vitest_1.describe)('buildPluginInstallPreview', () => {
    const manifest = {
        id: 'a.b',
        name: 'x',
        version: '1',
        description: 'd',
        entry: 'index.js',
        capabilities: [{ kind: 'os', detail: 'clipboard' }],
    };
    (0, vitest_1.it)('surfaces tools and flags auto claims', () => {
        const preview = (0, manifest_1.buildPluginInstallPreview)(manifest, [
            { name: 't1', description: 'one', permissionTier: 'auto', parameters: { type: 'object' } },
            { name: 't2', description: 'two', permissionTier: 'confirm_required', parameters: { type: 'object' } },
        ]);
        (0, vitest_1.expect)(preview.tools).toHaveLength(2);
        (0, vitest_1.expect)(preview.hasAutoTools).toBe(true);
        (0, vitest_1.expect)(preview.capabilities).toEqual([{ kind: 'os', detail: 'clipboard' }]);
    });
    (0, vitest_1.it)('hasAutoTools is false when nothing claims auto', () => {
        const preview = (0, manifest_1.buildPluginInstallPreview)(manifest, [
            { name: 't1', description: 'one', permissionTier: 'confirm_required', parameters: { type: 'object' } },
        ]);
        (0, vitest_1.expect)(preview.hasAutoTools).toBe(false);
    });
});
(0, vitest_1.describe)('computePluginToolDecisions', () => {
    (0, vitest_1.it)('AC3: auto is only honored with explicit user approval', () => {
        const decisions = (0, manifest_1.computePluginToolDecisions)([
            { name: 'a', description: '', permissionTier: 'auto', parameters: { type: 'object' } },
            { name: 'b', description: '', permissionTier: 'auto', parameters: { type: 'object' } },
            { name: 'c', description: '', permissionTier: 'confirm_required', parameters: { type: 'object' } },
        ], ['b']);
        (0, vitest_1.expect)(decisions).toEqual({
            a: 'confirm_required',
            b: 'auto',
            c: 'confirm_required',
        });
    });
    (0, vitest_1.it)('never elevates a confirm_required tool, even if approved', () => {
        const decisions = (0, manifest_1.computePluginToolDecisions)([{ name: 'c', description: '', permissionTier: 'confirm_required', parameters: { type: 'object' } }], ['c']);
        (0, vitest_1.expect)(decisions.c).toBe('confirm_required');
    });
});
