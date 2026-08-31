import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Minimal in-memory stand-in for better-sqlite3, supporting exactly the
 * prepare() statements the provider registry issues against `providers`.
 * All of it lives inside vi.hoisted so the module mocks (which are hoisted
 * above every other statement) can construct it first.
 */
const { configStore, fakeDb, safeStorageMock } = vi.hoisted(() => {
  type SqlRef = { kind: 'bound'; index: number } | { kind: 'lit'; value: unknown };

  const parseRef = (token: string, argCursor: { n: number }): SqlRef => {
    if (token.trim() === '?') return { kind: 'bound', index: argCursor.n++ };
    if (token.trim().toUpperCase() === 'NULL') return { kind: 'lit', value: null };
    const num = Number(token.trim());
    if (!Number.isNaN(num) && token.trim() !== '') return { kind: 'lit', value: num };
    return { kind: 'lit', value: token.trim().replace(/^'|'$/g, '') };
  };

  const matches = (row: Record<string, unknown>, c: { col: string; ref: SqlRef }, args: unknown[]): boolean =>
    row[c.col] === (c.ref.kind === 'lit' ? c.ref.value : args[c.ref.index]);

  class FakeStatement {
    constructor(
      private db: FakeDb,
      private sql: string
    ) {}

    private spec() {
      const sql = this.sql.trim();
      const action = sql.startsWith('INSERT')
        ? 'insert'
        : sql.startsWith('UPDATE')
          ? 'update'
          : sql.startsWith('DELETE')
            ? 'delete'
            : 'select';
      const argCursor = { n: 0 };
      let assignments: Array<{ col: string; ref: SqlRef }> = [];
      let columns: string[] = [];
      let values: SqlRef[] = [];
      let conditions: Array<{ col: string; op: string; ref: SqlRef }> = [];
      let orderBy: { col: string; dir: 'ASC' | 'DESC' } | null = null;

      const whereMatch = /WHERE (.+?)(?: ORDER BY| LIMIT|$)/.exec(sql);
      if (action === 'update') {
        const setMatch = /UPDATE providers SET (.+?) WHERE/.exec(sql);
        if (setMatch) {
          assignments = setMatch[1].split(/,\s+/).map(part => {
            const [col, ...rest] = part.split(/\s*=\s*/);
            return { col: col.trim(), ref: parseRef(rest.join('='), argCursor) };
          });
        }
      } else if (action === 'insert') {
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
            if (!m) return null;
            return { col: m[1], op: m[2], ref: parseRef(m[3], argCursor) };
          })
          .filter((c): c is NonNullable<typeof c> => c !== null);
      }
      const orderMatch = /ORDER BY (\w+) (ASC|DESC)/.exec(sql);
      if (orderMatch) orderBy = { col: orderMatch[1], dir: orderMatch[2] as 'ASC' | 'DESC' };
      return { action, assignments, columns, values, conditions, orderBy };
    }

    private sort(rows: Array<Record<string, unknown>>, orderBy: { col: string; dir: 'ASC' | 'DESC' }) {
      const cmp = (a: Record<string, unknown>, b: Record<string, unknown>) => {
        const av = a[orderBy.col] ?? '';
        const bv = b[orderBy.col] ?? '';
        if (av < bv) return -1;
        if (av > bv) return 1;
        return 0;
      };
      return [...rows].sort((a, b) => (orderBy.dir === 'DESC' ? -cmp(a, b) : cmp(a, b)));
    }

    get(...args: unknown[]): Record<string, unknown> | undefined {
      const s = this.spec();
      const filtered = this.db.rows.filter(r => s.conditions.every(c => matches(r, c, args)));
      const rows = s.orderBy ? this.sort(filtered, s.orderBy) : filtered;
      return rows[0];
    }

    all(...args: unknown[]): Array<Record<string, unknown>> {
      const s = this.spec();
      const filtered = this.db.rows.filter(r => s.conditions.every(c => matches(r, c, args)));
      return s.orderBy ? this.sort(filtered, s.orderBy) : filtered;
    }

    run(...args: unknown[]): { changes: number } {
      const s = this.spec();
      if (s.action === 'insert') {
        const row: Record<string, unknown> = {};
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
          if (!s.conditions.every(c => matches(row, c, args))) continue;
          for (const a of s.assignments) row[a.col] = a.ref.kind === 'lit' ? a.ref.value : args[a.ref.index];
          changes++;
        }
        return { changes };
      }
      let changes = 0;
      this.db.rows = this.db.rows.filter(row => {
        const match = s.conditions.every(c => matches(row, c, args));
        if (match) changes++;
        return !match;
      });
      return { changes };
    }
  }

  class FakeDb {
    rows: Array<Record<string, unknown>> = [];
    prepare(sql: string): FakeStatement {
      return new FakeStatement(this, sql);
    }
  }

  return {
    configStore: new Map<string, string>(),
    fakeDb: new FakeDb(),
    safeStorageMock: {
      isEncryptionAvailable: vi.fn(() => true),
      encryptString: vi.fn((s: string) => Buffer.from(`enc(${s})`)),
      decryptString: vi.fn((b: Buffer) => {
        const text = b.toString();
        const match = /^enc\((.*)\)$/.exec(text);
        if (!match) throw new Error('not an encrypted blob');
        return match[1];
      }),
    },
  };
});

vi.mock('electron', () => ({ safeStorage: safeStorageMock }));

vi.mock('../../db/db', () => ({
  userConfig: {
    get: (key: string) => configStore.get(key),
    set: (key: string, value: string) => void configStore.set(key, value),
    delete: (key: string) => void configStore.delete(key),
  },
  getDb: () => fakeDb,
}));

import {
  DEFAULT_MODELS,
  encryptAndStoreApiKey,
  getConfiguredModel,
  getDecryptedApiKey,
  hasApiKey,
  isProviderId,
  removeApiKey,
  setConfiguredModel,
} from '../providerConfig';
import { providerRegistry, initProviderRegistry } from '../providerRegistry';
import { LLMProviderError } from '../providerErrors';

function seedDefaults(): void {
  configStore.clear();
  fakeDb.rows = [];
  providerRegistry.add({ capability: 'llm', presetKey: 'groq', enabled: true });
  providerRegistry.add({ capability: 'llm', presetKey: 'openrouter', enabled: true });
  providerRegistry.setDefaultLlmProvider('groq');
}

describe('legacy migration + seeding (registry init)', () => {
  it('seeds preset rows and migrates v2.6.1 keys on first init', () => {
    configStore.set('groq_api_key', Buffer.from('enc(gsk_legacy)').toString('base64'));
    configStore.set('groq_model', 'legacy-model');
    configStore.set('llm_provider', 'groq');

    initProviderRegistry();

    const groq = providerRegistry.get('groq');
    expect(groq).toMatchObject({
      displayName: 'Groq',
      capability: 'llm',
      schema: 'openai_compatible',
      enabled: true,
      isDefault: true,
      hasKey: true,
    });
    expect(providerRegistry.getConfiguredModel('groq')).toBe('legacy-model');
    expect(providerRegistry.getConfiguredModel('openrouter')).toBe('openrouter/free');
  });

  it('leaves dormant presets disabled until a key is configured', () => {
    initProviderRegistry();
    for (const id of ['openai', 'anthropic', 'gemini', 'mistral', 'deepseek']) {
      const p = providerRegistry.get(id);
      expect(p).toBeDefined();
      expect(p!.enabled).toBe(false);
    }
  });
});

describe('isProviderId', () => {
  beforeEach(seedDefaults);

  it('accepts known preset ids and rejects unknown strings', () => {
    expect(isProviderId('groq')).toBe(true);
    expect(isProviderId('openrouter')).toBe(true);
    expect(isProviderId('anthropic')).toBe(true);
    expect(isProviderId('nonsense')).toBe(false);
    expect(isProviderId('')).toBe(false);
  });
});

describe('API key vault (via providers table)', () => {
  beforeEach(seedDefaults);

  it('reports whether a key exists', () => {
    expect(hasApiKey('groq')).toBe(false);
    encryptAndStoreApiKey('groq', 'gsk_test');
    expect(hasApiKey('groq')).toBe(true);
  });

  it('round-trips a key through encryption without storing plain text', () => {
    encryptAndStoreApiKey('groq', 'gsk_secret_value');
    const expectedBlob = Buffer.from('enc(gsk_secret_value)').toString('base64');
    expect(getDecryptedApiKey('groq')).toBe('gsk_secret_value');
    // The table holds only the encrypted blob, never the raw key.
    const row = providerRegistry.get('groq')!;
    expect(row.hasKey).toBe(true);
    if (row) {
      const stored = fakeDb.rows.find(r => r.id === 'groq')!;
      expect(stored.api_key_encrypted).toBe(expectedBlob);
      expect(stored.api_key_encrypted).not.toContain('gsk_secret_value');
    }
  });

  it('removes keys outright and disables the provider', () => {
    encryptAndStoreApiKey('openrouter', 'sk-or-test');
    removeApiKey('openrouter');
    expect(hasApiKey('openrouter')).toBe(false);
    expect(providerRegistry.get('openrouter')!.enabled).toBe(false);
  });

  it('throws key_not_set when no key is stored', () => {
    try {
      getDecryptedApiKey('groq');
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(LLMProviderError);
      expect((err as LLMProviderError).kind).toBe('key_not_set');
      expect((err as Error).message).toMatch(/Settings/);
    }
  });

  it('throws key_unreadable when decryption fails, prompting re-entry', () => {
    fakeDb.rows.find(r => r.id === 'groq')!.api_key_encrypted = 'Y29ycnVwdGVkLWJsb2I=';
    try {
      getDecryptedApiKey('groq');
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(LLMProviderError);
      expect((err as LLMProviderError).kind).toBe('key_unreadable');
      expect((err as Error).message).toMatch(/re-enter/i);
    }
  });

  it('refuses to store keys when secure storage is unavailable', () => {
    safeStorageMock.isEncryptionAvailable.mockReturnValue(false);
    try {
      encryptAndStoreApiKey('groq', 'gsk_test');
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(LLMProviderError);
      expect((err as LLMProviderError).kind).toBe('key_unreadable');
      expect((err as Error).message).toMatch(/secure storage/i);
    }
    expect(hasApiKey('groq')).toBe(false);
  });
});

describe('model configuration', () => {
  beforeEach(seedDefaults);

  it('falls back to free-tier-friendly defaults when unset', () => {
    expect(DEFAULT_MODELS).toEqual({});
    expect(providerRegistry.getConfiguredModel('groq')).toBe('llama-3.3-70b-versatile');
    expect(providerRegistry.getConfiguredModel('openrouter')).toBe('openrouter/free');
  });

  it('persists a configured model that overrides the default', () => {
    setConfiguredModel('openrouter', 'google/gemma-3-27b-it:free');
    expect(getConfiguredModel('openrouter')).toBe('google/gemma-3-27b-it:free');
    expect(providerRegistry.get('openrouter')!.defaultModel).toBe('google/gemma-3-27b-it:free');
  });

  it('trims surrounding whitespace from model IDs', () => {
    setConfiguredModel('groq', '  llama-3.1-8b-instant  ');
    expect(getConfiguredModel('groq')).toBe('llama-3.1-8b-instant');
  });

  it('rejects empty model IDs', () => {
    expect(() => setConfiguredModel('groq', '   ')).toThrow(/empty/i);
  });

  it('rejects absurdly long model IDs', () => {
    expect(() => setConfiguredModel('groq', 'x'.repeat(201))).toThrow(/too long/i);
  });

  it('sets the active default and keeps a legacy mirror in user_config', () => {
    providerRegistry.setDefaultLlmProvider('openrouter');
    expect(providerRegistry.getDefaultLlmProviderId()).toBe('openrouter');
    expect(providerRegistry.get('groq')!.isDefault).toBe(false);
    expect(providerRegistry.get('openrouter')!.isDefault).toBe(true);
    expect(configStore.get('llm_provider')).toBe('openrouter');
  });
});

describe('N-08 cloud STT/TTS provider rows (voice capability)', () => {
  beforeEach(() => {
    configStore.clear();
    fakeDb.rows = [];
    // Earlier tests flip this mock; encryption must be available here.
    safeStorageMock.isEncryptionAvailable.mockReturnValue(true);
  });

  /** Mirrors what seedPresetRows() writes for custom voice presets. */
  function addVoice(): { sttId: string; ttsId: string } {
    const stt = providerRegistry.add({
      capability: 'stt',
      presetKey: 'custom_stt',
      displayName: 'My STT',
      baseUrl: 'https://stt.example.com/v1',
      defaultModel: 'whisper-1',
    });
    const tts = providerRegistry.add({
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
  function insertRawVoiceRows(): string[] {
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

  it('adds cloud voice rows dormant (no key, disabled, not default)', () => {
    const { sttId, ttsId } = addVoice();
    expect(providerRegistry.get(sttId)).toMatchObject({
      capability: 'stt',
      schema: 'cloud_stt',
      enabled: false,
      isDefault: false,
      hasKey: false,
    });
    expect(providerRegistry.get(ttsId)).toMatchObject({
      capability: 'tts',
      schema: 'cloud_tts',
      enabled: false,
      hasKey: false,
    });
  });

  it('reports NO default voice provider before any voice row exists', () => {
    expect(providerRegistry.getDefaultProviderId('stt')).toBe('');
    expect(providerRegistry.getDefaultProviderId('tts')).toBe('');
  });

  it('offers exactly the voice presets and no LLM presets through listPresets', () => {
    const ids = providerRegistry.listPresets('stt').map(p => p.presetKey);
    expect(ids).toEqual(['custom_stt']);
    const tts = providerRegistry.listPresets('tts').map(p => p.presetKey);
    expect(tts).toEqual(['custom_tts']);
  });

  it('recognizes voice rows as providers but never as LLM providers', () => {
    const { sttId, ttsId } = addVoice();
    expect(providerRegistry.isKnownProvider(sttId)).toBe(true);
    expect(providerRegistry.isKnownProvider(sttId, 'stt')).toBe(true);
    expect(providerRegistry.isKnownProvider(ttsId, 'tts')).toBe(true);
    expect(providerRegistry.isKnownProvider(sttId, 'llm')).toBe(false);
    expect(providerRegistry.isKnownProvider(ttsId, 'llm')).toBe(false);
    expect(providerRegistry.isKnownProvider('custom_stt', 'stt')).toBe(true);
    expect(providerRegistry.isKnownLlmProvider('custom_stt')).toBe(false);
  });

  it('setDefaultProvider is capability-scoped and leaves the LLM default alone', () => {
    seedDefaults();
    const { sttId, ttsId } = addVoice();
    providerRegistry.setDefaultProvider(sttId);
    expect(providerRegistry.getDefaultProviderId('stt')).toBe(sttId);
    providerRegistry.setDefaultProvider(ttsId);
    expect(providerRegistry.getDefaultProviderId('stt')).toBe(sttId);
    expect(providerRegistry.getDefaultProviderId('tts')).toBe(ttsId);
    expect(providerRegistry.getDefaultProviderId('llm')).toBe('groq');
    expect(providerRegistry.get('groq')!.isDefault).toBe(true);
    expect(providerRegistry.get(sttId)!.isDefault).toBe(true);
    expect(providerRegistry.get(ttsId)!.isDefault).toBe(true);
  });

  it('storing a key enables a voice row; removing it disables it again', () => {
    const { sttId } = addVoice();
    providerRegistry.setApiKey(sttId, 'sk-voice-secret');
    expect(providerRegistry.get(sttId)!.enabled).toBe(true);
    expect(providerRegistry.get(sttId)!.hasKey).toBe(true);
    providerRegistry.removeApiKey(sttId);
    expect(providerRegistry.get(sttId)!.hasKey).toBe(false);
    expect(providerRegistry.get(sttId)!.enabled).toBe(false);
  });

  it('removing the default voice row promotes another row of the same capability', () => {
    seedDefaults();
    const [aId, bId] = insertRawVoiceRows();
    providerRegistry.remove(aId);
    expect(providerRegistry.getDefaultProviderId('stt')).toBe(bId);
    expect(providerRegistry.getDefaultProviderId('llm')).toBe('groq');
    expect(providerRegistry.get(aId)).toBeUndefined();
    expect(providerRegistry.get(bId)!.isDefault).toBe(true);
  });

  it('removing the last voice row yields a clean no-cloud state, never a crash', () => {
    seedDefaults();
    const [aId, bId] = insertRawVoiceRows();
    providerRegistry.remove(aId);
    providerRegistry.remove(bId);
    expect(providerRegistry.getDefaultProviderId('stt')).toBe('');
    expect(providerRegistry.getDefaultProviderId('llm')).toBe('groq');
  });
});