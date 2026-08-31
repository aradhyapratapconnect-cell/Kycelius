"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
/**
 * Minimal in-memory stand-in for better-sqlite3, supporting exactly the
 * prepare() statements the provider registry issues against `providers`.
 * All of it lives inside vi.hoisted so the module mocks (which are hoisted
 * above every other statement) can construct it first.
 */
const { configStore, fakeDb, safeStorageMock } = vitest_1.vi.hoisted(() => {
    const parseRef = (token, argCursor) => {
        if (token.trim() === '?')
            return { kind: 'bound', index: argCursor.n++ };
        if (token.trim().toUpperCase() === 'NULL')
            return { kind: 'lit', value: null };
        const num = Number(token.trim());
        if (!Number.isNaN(num) && token.trim() !== '')
            return { kind: 'lit', value: num };
        return { kind: 'lit', value: token.trim().replace(/^'|'$/g, '') };
    };
    const matches = (row, c, args) => row[c.col] === (c.ref.kind === 'lit' ? c.ref.value : args[c.ref.index]);
    class FakeStatement {
        db;
        sql;
        constructor(db, sql) {
            this.db = db;
            this.sql = sql;
        }
        spec() {
            const sql = this.sql.trim();
            const action = sql.startsWith('INSERT')
                ? 'insert'
                : sql.startsWith('UPDATE')
                    ? 'update'
                    : sql.startsWith('DELETE')
                        ? 'delete'
                        : 'select';
            const argCursor = { n: 0 };
            let assignments = [];
            let columns = [];
            let values = [];
            let conditions = [];
            let orderBy = null;
            const whereMatch = /WHERE (.+?)(?: ORDER BY| LIMIT|$)/.exec(sql);
            if (action === 'update') {
                const setMatch = /UPDATE providers SET (.+?) WHERE/.exec(sql);
                if (setMatch) {
                    assignments = setMatch[1].split(/,\s+/).map(part => {
                        const [col, ...rest] = part.split(/\s*=\s*/);
                        return { col: col.trim(), ref: parseRef(rest.join('='), argCursor) };
                    });
                }
            }
            else if (action === 'insert') {
                const head = /INTO providers\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/.exec(sql);
                if (head) {
                    columns = head[1].split(',').map(c => c.trim());
                    values = head[2].split(',').map(tk => parseRef(tk, argCursor));
                }
            }
            if (whereMatch) {
                conditions = whereMatch[1]
                    .split(/\s+AND\s+/)
                    .map(part => {
                    const m = /^(\w+)\s*(=?)\s*(.+)$/.exec(part.trim());
                    if (!m)
                        return null;
                    return { col: m[1], op: m[2], ref: parseRef(m[3], argCursor) };
                })
                    .filter((c) => c !== null);
            }
            const orderMatch = /ORDER BY (\w+) (ASC|DESC)/.exec(sql);
            if (orderMatch)
                orderBy = { col: orderMatch[1], dir: orderMatch[2] };
            return { action, assignments, columns, values, conditions, orderBy };
        }
        sort(rows, orderBy) {
            const cmp = (a, b) => {
                const av = a[orderBy.col] ?? '';
                const bv = b[orderBy.col] ?? '';
                if (av < bv)
                    return -1;
                if (av > bv)
                    return 1;
                return 0;
            };
            return [...rows].sort((a, b) => (orderBy.dir === 'DESC' ? -cmp(a, b) : cmp(a, b)));
        }
        get(...args) {
            const s = this.spec();
            const filtered = this.db.rows.filter(r => s.conditions.every(c => matches(r, c, args)));
            const rows = s.orderBy ? this.sort(filtered, s.orderBy) : filtered;
            return rows[0];
        }
        all(...args) {
            const s = this.spec();
            const filtered = this.db.rows.filter(r => s.conditions.every(c => matches(r, c, args)));
            return s.orderBy ? this.sort(filtered, s.orderBy) : filtered;
        }
        run(...args) {
            const s = this.spec();
            if (s.action === 'insert') {
                const row = {};
                s.columns.forEach((col, i) => {
                    const ref = s.values[i];
                    row[col] = ref.kind === 'lit' ? ref.value : args[ref.index];
                });
                this.db.rows.push(row);
                return { changes: 1 };
            }
            if (s.action === 'update') {
                let changes = 0;
                for (const row of this.db.rows) {
                    if (!s.conditions.every(c => matches(row, c, args)))
                        continue;
                    for (const a of s.assignments)
                        row[a.col] = a.ref.kind === 'lit' ? a.ref.value : args[a.ref.index];
                    changes++;
                }
                return { changes };
            }
            let changes = 0;
            this.db.rows = this.db.rows.filter(row => {
                const match = s.conditions.every(c => matches(row, c, args));
                if (match)
                    changes++;
                return !match;
            });
            return { changes };
        }
    }
    class FakeDb {
        rows = [];
        prepare(sql) {
            return new FakeStatement(this, sql);
        }
    }
    return {
        configStore: new Map(),
        fakeDb: new FakeDb(),
        safeStorageMock: {
            isEncryptionAvailable: vitest_1.vi.fn(() => true),
            encryptString: vitest_1.vi.fn((s) => Buffer.from(`enc(${s})`)),
            decryptString: vitest_1.vi.fn((b) => {
                const text = b.toString();
                const match = /^enc\((.*)\)$/.exec(text);
                if (!match)
                    throw new Error('not an encrypted blob');
                return match[1];
            }),
        },
    };
});
vitest_1.vi.mock('electron', () => ({ safeStorage: safeStorageMock }));
vitest_1.vi.mock('../../db/db', () => ({
    userConfig: {
        get: (key) => configStore.get(key),
        set: (key, value) => void configStore.set(key, value),
        delete: (key) => void configStore.delete(key),
    },
    getDb: () => fakeDb,
}));
const providerConfig_1 = require("../providerConfig");
const providerRegistry_1 = require("../providerRegistry");
const providerErrors_1 = require("../providerErrors");
function seedDefaults() {
    configStore.clear();
    fakeDb.rows = [];
    providerRegistry_1.providerRegistry.add({ capability: 'llm', presetKey: 'groq', enabled: true });
    providerRegistry_1.providerRegistry.add({ capability: 'llm', presetKey: 'openrouter', enabled: true });
    providerRegistry_1.providerRegistry.setDefaultLlmProvider('groq');
}
(0, vitest_1.describe)('legacy migration + seeding (registry init)', () => {
    (0, vitest_1.it)('seeds preset rows and migrates v2.6.1 keys on first init', () => {
        configStore.set('groq_api_key', Buffer.from('enc(gsk_legacy)').toString('base64'));
        configStore.set('groq_model', 'legacy-model');
        configStore.set('llm_provider', 'groq');
        (0, providerRegistry_1.initProviderRegistry)();
        const groq = providerRegistry_1.providerRegistry.get('groq');
        (0, vitest_1.expect)(groq).toMatchObject({
            displayName: 'Groq',
            capability: 'llm',
            schema: 'openai_compatible',
            enabled: true,
            isDefault: true,
            hasKey: true,
        });
        (0, vitest_1.expect)(providerRegistry_1.providerRegistry.getConfiguredModel('groq')).toBe('legacy-model');
        (0, vitest_1.expect)(providerRegistry_1.providerRegistry.getConfiguredModel('openrouter')).toBe('openrouter/free');
    });
    (0, vitest_1.it)('leaves dormant presets disabled until a key is configured', () => {
        (0, providerRegistry_1.initProviderRegistry)();
        for (const id of ['openai', 'anthropic', 'gemini', 'mistral', 'deepseek']) {
            const p = providerRegistry_1.providerRegistry.get(id);
            (0, vitest_1.expect)(p).toBeDefined();
            (0, vitest_1.expect)(p.enabled).toBe(false);
        }
    });
});
(0, vitest_1.describe)('isProviderId', () => {
    (0, vitest_1.beforeEach)(seedDefaults);
    (0, vitest_1.it)('accepts known preset ids and rejects unknown strings', () => {
        (0, vitest_1.expect)((0, providerConfig_1.isProviderId)('groq')).toBe(true);
        (0, vitest_1.expect)((0, providerConfig_1.isProviderId)('openrouter')).toBe(true);
        (0, vitest_1.expect)((0, providerConfig_1.isProviderId)('anthropic')).toBe(true);
        (0, vitest_1.expect)((0, providerConfig_1.isProviderId)('nonsense')).toBe(false);
        (0, vitest_1.expect)((0, providerConfig_1.isProviderId)('')).toBe(false);
    });
});
(0, vitest_1.describe)('API key vault (via providers table)', () => {
    (0, vitest_1.beforeEach)(seedDefaults);
    (0, vitest_1.it)('reports whether a key exists', () => {
        (0, vitest_1.expect)((0, providerConfig_1.hasApiKey)('groq')).toBe(false);
        (0, providerConfig_1.encryptAndStoreApiKey)('groq', 'gsk_test');
        (0, vitest_1.expect)((0, providerConfig_1.hasApiKey)('groq')).toBe(true);
    });
    (0, vitest_1.it)('round-trips a key through encryption without storing plain text', () => {
        (0, providerConfig_1.encryptAndStoreApiKey)('groq', 'gsk_secret_value');
        const expectedBlob = Buffer.from('enc(gsk_secret_value)').toString('base64');
        (0, vitest_1.expect)((0, providerConfig_1.getDecryptedApiKey)('groq')).toBe('gsk_secret_value');
        // The table holds only the encrypted blob, never the raw key.
        const row = providerRegistry_1.providerRegistry.get('groq');
        (0, vitest_1.expect)(row.hasKey).toBe(true);
        if (row) {
            const stored = fakeDb.rows.find(r => r.id === 'groq');
            (0, vitest_1.expect)(stored.api_key_encrypted).toBe(expectedBlob);
            (0, vitest_1.expect)(stored.api_key_encrypted).not.toContain('gsk_secret_value');
        }
    });
    (0, vitest_1.it)('removes keys outright and disables the provider', () => {
        (0, providerConfig_1.encryptAndStoreApiKey)('openrouter', 'sk-or-test');
        (0, providerConfig_1.removeApiKey)('openrouter');
        (0, vitest_1.expect)((0, providerConfig_1.hasApiKey)('openrouter')).toBe(false);
        (0, vitest_1.expect)(providerRegistry_1.providerRegistry.get('openrouter').enabled).toBe(false);
    });
    (0, vitest_1.it)('throws key_not_set when no key is stored', () => {
        try {
            (0, providerConfig_1.getDecryptedApiKey)('groq');
            throw new Error('should have thrown');
        }
        catch (err) {
            (0, vitest_1.expect)(err).toBeInstanceOf(providerErrors_1.LLMProviderError);
            (0, vitest_1.expect)(err.kind).toBe('key_not_set');
            (0, vitest_1.expect)(err.message).toMatch(/Settings/);
        }
    });
    (0, vitest_1.it)('throws key_unreadable when decryption fails, prompting re-entry', () => {
        fakeDb.rows.find(r => r.id === 'groq').api_key_encrypted = 'Y29ycnVwdGVkLWJsb2I=';
        try {
            (0, providerConfig_1.getDecryptedApiKey)('groq');
            throw new Error('should have thrown');
        }
        catch (err) {
            (0, vitest_1.expect)(err).toBeInstanceOf(providerErrors_1.LLMProviderError);
            (0, vitest_1.expect)(err.kind).toBe('key_unreadable');
            (0, vitest_1.expect)(err.message).toMatch(/re-enter/i);
        }
    });
    (0, vitest_1.it)('refuses to store keys when secure storage is unavailable', () => {
        safeStorageMock.isEncryptionAvailable.mockReturnValue(false);
        try {
            (0, providerConfig_1.encryptAndStoreApiKey)('groq', 'gsk_test');
            throw new Error('should have thrown');
        }
        catch (err) {
            (0, vitest_1.expect)(err).toBeInstanceOf(providerErrors_1.LLMProviderError);
            (0, vitest_1.expect)(err.kind).toBe('key_unreadable');
            (0, vitest_1.expect)(err.message).toMatch(/secure storage/i);
        }
        (0, vitest_1.expect)((0, providerConfig_1.hasApiKey)('groq')).toBe(false);
    });
});
(0, vitest_1.describe)('model configuration', () => {
    (0, vitest_1.beforeEach)(seedDefaults);
    (0, vitest_1.it)('falls back to free-tier-friendly defaults when unset', () => {
        (0, vitest_1.expect)(providerConfig_1.DEFAULT_MODELS).toEqual({});
        (0, vitest_1.expect)(providerRegistry_1.providerRegistry.getConfiguredModel('groq')).toBe('llama-3.3-70b-versatile');
        (0, vitest_1.expect)(providerRegistry_1.providerRegistry.getConfiguredModel('openrouter')).toBe('openrouter/free');
    });
    (0, vitest_1.it)('persists a configured model that overrides the default', () => {
        (0, providerConfig_1.setConfiguredModel)('openrouter', 'google/gemma-3-27b-it:free');
        (0, vitest_1.expect)((0, providerConfig_1.getConfiguredModel)('openrouter')).toBe('google/gemma-3-27b-it:free');
        (0, vitest_1.expect)(providerRegistry_1.providerRegistry.get('openrouter').defaultModel).toBe('google/gemma-3-27b-it:free');
    });
    (0, vitest_1.it)('trims surrounding whitespace from model IDs', () => {
        (0, providerConfig_1.setConfiguredModel)('groq', '  llama-3.1-8b-instant  ');
        (0, vitest_1.expect)((0, providerConfig_1.getConfiguredModel)('groq')).toBe('llama-3.1-8b-instant');
    });
    (0, vitest_1.it)('rejects empty model IDs', () => {
        (0, vitest_1.expect)(() => (0, providerConfig_1.setConfiguredModel)('groq', '   ')).toThrow(/empty/i);
    });
    (0, vitest_1.it)('rejects absurdly long model IDs', () => {
        (0, vitest_1.expect)(() => (0, providerConfig_1.setConfiguredModel)('groq', 'x'.repeat(201))).toThrow(/too long/i);
    });
    (0, vitest_1.it)('sets the active default and keeps a legacy mirror in user_config', () => {
        providerRegistry_1.providerRegistry.setDefaultLlmProvider('openrouter');
        (0, vitest_1.expect)(providerRegistry_1.providerRegistry.getDefaultLlmProviderId()).toBe('openrouter');
        (0, vitest_1.expect)(providerRegistry_1.providerRegistry.get('groq').isDefault).toBe(false);
        (0, vitest_1.expect)(providerRegistry_1.providerRegistry.get('openrouter').isDefault).toBe(true);
        (0, vitest_1.expect)(configStore.get('llm_provider')).toBe('openrouter');
    });
});
(0, vitest_1.describe)('N-08 cloud STT/TTS provider rows (voice capability)', () => {
    (0, vitest_1.beforeEach)(() => {
        configStore.clear();
        fakeDb.rows = [];
        // Earlier tests flip this mock; encryption must be available here.
        safeStorageMock.isEncryptionAvailable.mockReturnValue(true);
    });
    /** Mirrors what seedPresetRows() writes for custom voice presets. */
    function addVoice() {
        const stt = providerRegistry_1.providerRegistry.add({
            capability: 'stt',
            presetKey: 'custom_stt',
            displayName: 'My STT',
            baseUrl: 'https://stt.example.com/v1',
            defaultModel: 'whisper-1',
        });
        const tts = providerRegistry_1.providerRegistry.add({
            capability: 'tts',
            presetKey: 'custom_tts',
            displayName: 'My TTS',
            baseUrl: 'https://tts.example.com/v1',
            defaultModel: 'alloy',
        });
        return { sttId: stt.id, ttsId: tts.id };
    }
    /** Injects two phone-style rows straight into the table so removal can be
     *  exercised without the single-preset-per-capability collision. */
    function insertRawVoiceRows() {
        const now = new Date().toISOString();
        fakeDb.rows.push({
            id: 'voice-a',
            capability: 'stt',
            preset_key: 'custom_stt',
            display_name: 'Voice A',
            schema: 'cloud_stt',
            base_url: 'https://a.example/v1',
            api_key_encrypted: 'ZW5jKGEp',
            default_model: 'whisper-1',
            enabled: 1,
            is_default: 1,
            created_at: now,
            updated_at: now,
        });
        fakeDb.rows.push({
            id: 'voice-b',
            capability: 'stt',
            preset_key: 'custom_stt',
            display_name: 'Voice B',
            schema: 'cloud_stt',
            base_url: 'https://b.example/v1',
            api_key_encrypted: 'ZW5jKGIp',
            default_model: 'whisper-1',
            enabled: 1,
            is_default: 0,
            created_at: now,
            updated_at: now,
        });
        return ['voice-a', 'voice-b'];
    }
    (0, vitest_1.it)('adds cloud voice rows dormant (no key, disabled, not default)', () => {
        const { sttId, ttsId } = addVoice();
        (0, vitest_1.expect)(providerRegistry_1.providerRegistry.get(sttId)).toMatchObject({
            capability: 'stt',
            schema: 'cloud_stt',
            enabled: false,
            isDefault: false,
            hasKey: false,
        });
        (0, vitest_1.expect)(providerRegistry_1.providerRegistry.get(ttsId)).toMatchObject({
            capability: 'tts',
            schema: 'cloud_tts',
            enabled: false,
            hasKey: false,
        });
    });
    (0, vitest_1.it)('reports NO default voice provider before any voice row exists', () => {
        (0, vitest_1.expect)(providerRegistry_1.providerRegistry.getDefaultProviderId('stt')).toBe('');
        (0, vitest_1.expect)(providerRegistry_1.providerRegistry.getDefaultProviderId('tts')).toBe('');
    });
    (0, vitest_1.it)('offers exactly the voice presets and no LLM presets through listPresets', () => {
        const ids = providerRegistry_1.providerRegistry.listPresets('stt').map(p => p.presetKey);
        (0, vitest_1.expect)(ids).toEqual(['custom_stt']);
        const tts = providerRegistry_1.providerRegistry.listPresets('tts').map(p => p.presetKey);
        (0, vitest_1.expect)(tts).toEqual(['custom_tts']);
    });
    (0, vitest_1.it)('recognizes voice rows as providers but never as LLM providers', () => {
        const { sttId, ttsId } = addVoice();
        (0, vitest_1.expect)(providerRegistry_1.providerRegistry.isKnownProvider(sttId)).toBe(true);
        (0, vitest_1.expect)(providerRegistry_1.providerRegistry.isKnownProvider(sttId, 'stt')).toBe(true);
        (0, vitest_1.expect)(providerRegistry_1.providerRegistry.isKnownProvider(ttsId, 'tts')).toBe(true);
        (0, vitest_1.expect)(providerRegistry_1.providerRegistry.isKnownProvider(sttId, 'llm')).toBe(false);
        (0, vitest_1.expect)(providerRegistry_1.providerRegistry.isKnownProvider(ttsId, 'llm')).toBe(false);
        (0, vitest_1.expect)(providerRegistry_1.providerRegistry.isKnownProvider('custom_stt', 'stt')).toBe(true);
        (0, vitest_1.expect)(providerRegistry_1.providerRegistry.isKnownLlmProvider('custom_stt')).toBe(false);
    });
    (0, vitest_1.it)('setDefaultProvider is capability-scoped and leaves the LLM default alone', () => {
        seedDefaults();
        const { sttId, ttsId } = addVoice();
        providerRegistry_1.providerRegistry.setDefaultProvider(sttId);
        (0, vitest_1.expect)(providerRegistry_1.providerRegistry.getDefaultProviderId('stt')).toBe(sttId);
        providerRegistry_1.providerRegistry.setDefaultProvider(ttsId);
        (0, vitest_1.expect)(providerRegistry_1.providerRegistry.getDefaultProviderId('stt')).toBe(sttId);
        (0, vitest_1.expect)(providerRegistry_1.providerRegistry.getDefaultProviderId('tts')).toBe(ttsId);
        (0, vitest_1.expect)(providerRegistry_1.providerRegistry.getDefaultProviderId('llm')).toBe('groq');
        (0, vitest_1.expect)(providerRegistry_1.providerRegistry.get('groq').isDefault).toBe(true);
        (0, vitest_1.expect)(providerRegistry_1.providerRegistry.get(sttId).isDefault).toBe(true);
        (0, vitest_1.expect)(providerRegistry_1.providerRegistry.get(ttsId).isDefault).toBe(true);
    });
    (0, vitest_1.it)('storing a key enables a voice row; removing it disables it again', () => {
        const { sttId } = addVoice();
        providerRegistry_1.providerRegistry.setApiKey(sttId, 'sk-voice-secret');
        (0, vitest_1.expect)(providerRegistry_1.providerRegistry.get(sttId).enabled).toBe(true);
        (0, vitest_1.expect)(providerRegistry_1.providerRegistry.get(sttId).hasKey).toBe(true);
        providerRegistry_1.providerRegistry.removeApiKey(sttId);
        (0, vitest_1.expect)(providerRegistry_1.providerRegistry.get(sttId).hasKey).toBe(false);
        (0, vitest_1.expect)(providerRegistry_1.providerRegistry.get(sttId).enabled).toBe(false);
    });
    (0, vitest_1.it)('removing the default voice row promotes another row of the same capability', () => {
        seedDefaults();
        const [aId, bId] = insertRawVoiceRows();
        providerRegistry_1.providerRegistry.remove(aId);
        (0, vitest_1.expect)(providerRegistry_1.providerRegistry.getDefaultProviderId('stt')).toBe(bId);
        (0, vitest_1.expect)(providerRegistry_1.providerRegistry.getDefaultProviderId('llm')).toBe('groq');
        (0, vitest_1.expect)(providerRegistry_1.providerRegistry.get(aId)).toBeUndefined();
        (0, vitest_1.expect)(providerRegistry_1.providerRegistry.get(bId).isDefault).toBe(true);
    });
    (0, vitest_1.it)('removing the last voice row yields a clean no-cloud state, never a crash', () => {
        seedDefaults();
        const [aId, bId] = insertRawVoiceRows();
        providerRegistry_1.providerRegistry.remove(aId);
        providerRegistry_1.providerRegistry.remove(bId);
        (0, vitest_1.expect)(providerRegistry_1.providerRegistry.getDefaultProviderId('stt')).toBe('');
        (0, vitest_1.expect)(providerRegistry_1.providerRegistry.getDefaultProviderId('llm')).toBe('groq');
    });
});
