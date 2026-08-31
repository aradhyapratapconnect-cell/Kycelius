import { beforeEach, describe, expect, it, vi } from 'vitest';

const { memoryFactsMock } = vi.hoisted(() => ({
  memoryFactsMock: {
    getAll: vi.fn(),
    getByKey: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
    deleteByKey: vi.fn(),
  },
}));

vi.mock('../../db/db', () => ({
  memoryFacts: memoryFactsMock,
}));

import {
  buildMemoryContextBlock,
  deleteFact,
  extractFactCandidates,
  getFact,
  getRelevantFacts,
  learnFromUserMessage,
  listFacts,
  setFact,
} from '../memoryService';

function fact(
  key: string,
  value: string,
  source: 'auto_learned' | 'user_added' = 'auto_learned',
  id = `id-${key}`
) {
  return { id, key, value, source, created_at: '2026-01-01', updated_at: '2026-01-01' };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('core CRUD (ticket API)', () => {
  it('getFact normalizes the key and reads through to the store', () => {
    memoryFactsMock.getByKey.mockReturnValue(fact('default editor', 'VS Code'));
    expect(getFact('  Default   Editor ')).toEqual(fact('default editor', 'VS Code'));
    expect(memoryFactsMock.getByKey).toHaveBeenCalledWith('default editor');
    expect(getFact('')).toBeUndefined();
  });

  it('setFact defaults to user_added and upserts by key without duplicating rows', () => {
    memoryFactsMock.set.mockReturnValue(fact('city', 'Berlin'));

    setFact('City', 'Berlin');
    expect(memoryFactsMock.set).toHaveBeenCalledWith('city', 'Berlin', 'user_added');

    setFact('city', 'Munich', 'auto_learned');
    expect(memoryFactsMock.set).toHaveBeenLastCalledWith('city', 'Munich', 'auto_learned');

    // The store itself implements overwrite-on-same-key; the service never
    // bypasses it with an insert.
    expect(memoryFactsMock.set).toHaveBeenCalledTimes(2);
  });

  it('setFact rejects empty or oversized input instead of writing junk rows', () => {
    expect(setFact('', 'x')).toBe(null);
    expect(setFact('k', '   ')).toBe(null);
    expect(setFact('k', 'x'.repeat(201))).toBe(null);
    expect(setFact('k'.repeat(61), 'x')).toBe(null);
    expect(memoryFactsMock.set).not.toHaveBeenCalled();
  });

  it('listFacts returns everything; deleteFact removes by id only when valid', () => {
    const all = [fact('a', '1'), fact('b', '2')];
    memoryFactsMock.getAll.mockReturnValue(all);
    expect(listFacts()).toEqual(all);

    deleteFact('some-id');
    expect(memoryFactsMock.delete).toHaveBeenCalledWith('some-id');
    deleteFact('');
    expect(memoryFactsMock.delete).toHaveBeenCalledTimes(1);
  });
});

describe('relevant-fact retrieval (context assembly)', () => {
  it('returns only facts matching the request text, ranked by relevance', () => {
    memoryFactsMock.getAll.mockReturnValue([
      fact('default editor', 'VS Code'),
      fact('home city', 'Berlin'),
      fact('preferred name', 'Ari'),
    ]);

    const relevant = getRelevantFacts('which editor should I open today?');
    expect(relevant.map(f => f.key)).toEqual(['default editor']);
  });

  it('caps the subset size and prefers stronger matches first', () => {
    memoryFactsMock.getAll.mockReturnValue([
      fact('home city', 'Berlin'), // no overlap
      fact('default editor', 'VS Code'), // one key hit
      fact('editor theme', 'dark'), // two key hits, strongest match
    ]);

    const relevant = getRelevantFacts('my editor needs a new editor theme', 2);
    expect(relevant.map(f => f.key)).toEqual(['editor theme', 'default editor']);
  });

  it('returns nothing relevant for unrelated requests — never the whole table', () => {
    memoryFactsMock.getAll.mockReturnValue([fact('default editor', 'VS Code')]);
    expect(getRelevantFacts('what is the weather in Tokyo?')).toEqual([]);
    expect(getRelevantFacts('')).toEqual([]);
  });

  it('renders the context block only when there are facts to include', () => {
    expect(buildMemoryContextBlock([])).toBe(null);
    const block = buildMemoryContextBlock([fact('default editor', 'VS Code')])!;
    expect(block).toContain('- default editor: VS Code');
    expect(block).toMatch(/Durable facts/i);
  });
});

describe('fact detection from user messages', () => {
  it.each([
    ['my default editor is VS Code.', [{ key: 'default editor', value: 'VS Code' }]],
    ['Actually my home city is now Berlin', [{ key: 'home city', value: 'Berlin' }]],
    ['remember that my timezone is CET', [{ key: 'timezone', value: 'CET' }]],
    ['call me Ari', []],
  ])('%s -> %j', (input, expected) => {
    expect(extractFactCandidates(input)).toEqual(expected);
  });

  it('detects preference phrasing with swapped capture order', () => {
    const candidates = extractFactCandidates('I prefer VS Code as my default editor');
    expect(candidates).toEqual([{ key: 'default editor', value: 'VS Code' }]);
  });

  it('does not store ordinary commands or chatter', () => {
    for (const text of [
      'open vscode',
      'run echo hello',
      'delete the file at ~/notes.txt',
      'what is the weather',
      '',
    ]) {
      expect(extractFactCandidates(text)).toEqual([]);
    }
  });

  it('learnFromUserMessage persists detected facts as auto_learned', () => {
    memoryFactsMock.set.mockImplementation((key: string, value: string) =>
      fact(key, value)
    );

    const learned = learnFromUserMessage('my default editor is VS Code');

    expect(learned).toEqual(['default editor']);
    expect(memoryFactsMock.set).toHaveBeenCalledWith(
      'default editor',
      'VS Code',
      'auto_learned'
    );
  });

  it('corrections overwrite the same key rather than adding a second row', () => {
    memoryFactsMock.set.mockReturnValue(fact('default editor', 'JetBrains'));
    learnFromUserMessage('remember that my default editor is JetBrains');
    learnFromUserMessage('actually my default editor is Neovim');

    const keys = memoryFactsMock.set.mock.calls.map(call => call[0]);
    expect(keys).toEqual(['default editor', 'default editor']);
    expect(keys.filter(k => k === 'default editor')).toHaveLength(2);
    expect(new Set(keys).size).toBe(1);
  });

  it('never throws even if the store explodes — replies must not break', () => {
    memoryFactsMock.set.mockImplementation(() => {
      throw new Error('db locked');
    });
    expect(() => learnFromUserMessage('my favorite color is teal')).not.toThrow();
  });

  it('tags sources correctly end-to-end per AC', () => {
    memoryFactsMock.set.mockReturnValue(fact('k', 'v'));
    // Explicit user-added path:
    setFact('favorite color', 'teal', 'user_added');
    expect(memoryFactsMock.set).toHaveBeenLastCalledWith('favorite color', 'teal', 'user_added');
    // Auto-learned path:
    learnFromUserMessage('my favorite color is blue');
    expect(memoryFactsMock.set).toHaveBeenLastCalledWith('favorite color', 'blue', 'auto_learned');
  });
});
