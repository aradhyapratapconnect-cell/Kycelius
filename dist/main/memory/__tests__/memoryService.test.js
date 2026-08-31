"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const { memoryFactsMock } = vitest_1.vi.hoisted(() => ({
    memoryFactsMock: {
        getAll: vitest_1.vi.fn(),
        getByKey: vitest_1.vi.fn(),
        set: vitest_1.vi.fn(),
        delete: vitest_1.vi.fn(),
        deleteByKey: vitest_1.vi.fn(),
    },
}));
vitest_1.vi.mock('../../db/db', () => ({
    memoryFacts: memoryFactsMock,
}));
const memoryService_1 = require("../memoryService");
function fact(key, value, source = 'auto_learned', id = `id-${key}`) {
    return { id, key, value, source, created_at: '2026-01-01', updated_at: '2026-01-01' };
}
(0, vitest_1.beforeEach)(() => {
    vitest_1.vi.clearAllMocks();
});
(0, vitest_1.describe)('core CRUD (ticket API)', () => {
    (0, vitest_1.it)('getFact normalizes the key and reads through to the store', () => {
        memoryFactsMock.getByKey.mockReturnValue(fact('default editor', 'VS Code'));
        (0, vitest_1.expect)((0, memoryService_1.getFact)('  Default   Editor ')).toEqual(fact('default editor', 'VS Code'));
        (0, vitest_1.expect)(memoryFactsMock.getByKey).toHaveBeenCalledWith('default editor');
        (0, vitest_1.expect)((0, memoryService_1.getFact)('')).toBeUndefined();
    });
    (0, vitest_1.it)('setFact defaults to user_added and upserts by key without duplicating rows', () => {
        memoryFactsMock.set.mockReturnValue(fact('city', 'Berlin'));
        (0, memoryService_1.setFact)('City', 'Berlin');
        (0, vitest_1.expect)(memoryFactsMock.set).toHaveBeenCalledWith('city', 'Berlin', 'user_added');
        (0, memoryService_1.setFact)('city', 'Munich', 'auto_learned');
        (0, vitest_1.expect)(memoryFactsMock.set).toHaveBeenLastCalledWith('city', 'Munich', 'auto_learned');
        // The store itself implements overwrite-on-same-key; the service never
        // bypasses it with an insert.
        (0, vitest_1.expect)(memoryFactsMock.set).toHaveBeenCalledTimes(2);
    });
    (0, vitest_1.it)('setFact rejects empty or oversized input instead of writing junk rows', () => {
        (0, vitest_1.expect)((0, memoryService_1.setFact)('', 'x')).toBe(null);
        (0, vitest_1.expect)((0, memoryService_1.setFact)('k', '   ')).toBe(null);
        (0, vitest_1.expect)((0, memoryService_1.setFact)('k', 'x'.repeat(201))).toBe(null);
        (0, vitest_1.expect)((0, memoryService_1.setFact)('k'.repeat(61), 'x')).toBe(null);
        (0, vitest_1.expect)(memoryFactsMock.set).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('listFacts returns everything; deleteFact removes by id only when valid', () => {
        const all = [fact('a', '1'), fact('b', '2')];
        memoryFactsMock.getAll.mockReturnValue(all);
        (0, vitest_1.expect)((0, memoryService_1.listFacts)()).toEqual(all);
        (0, memoryService_1.deleteFact)('some-id');
        (0, vitest_1.expect)(memoryFactsMock.delete).toHaveBeenCalledWith('some-id');
        (0, memoryService_1.deleteFact)('');
        (0, vitest_1.expect)(memoryFactsMock.delete).toHaveBeenCalledTimes(1);
    });
});
(0, vitest_1.describe)('relevant-fact retrieval (context assembly)', () => {
    (0, vitest_1.it)('returns only facts matching the request text, ranked by relevance', () => {
        memoryFactsMock.getAll.mockReturnValue([
            fact('default editor', 'VS Code'),
            fact('home city', 'Berlin'),
            fact('preferred name', 'Ari'),
        ]);
        const relevant = (0, memoryService_1.getRelevantFacts)('which editor should I open today?');
        (0, vitest_1.expect)(relevant.map(f => f.key)).toEqual(['default editor']);
    });
    (0, vitest_1.it)('caps the subset size and prefers stronger matches first', () => {
        memoryFactsMock.getAll.mockReturnValue([
            fact('home city', 'Berlin'), // no overlap
            fact('default editor', 'VS Code'), // one key hit
            fact('editor theme', 'dark'), // two key hits, strongest match
        ]);
        const relevant = (0, memoryService_1.getRelevantFacts)('my editor needs a new editor theme', 2);
        (0, vitest_1.expect)(relevant.map(f => f.key)).toEqual(['editor theme', 'default editor']);
    });
    (0, vitest_1.it)('returns nothing relevant for unrelated requests — never the whole table', () => {
        memoryFactsMock.getAll.mockReturnValue([fact('default editor', 'VS Code')]);
        (0, vitest_1.expect)((0, memoryService_1.getRelevantFacts)('what is the weather in Tokyo?')).toEqual([]);
        (0, vitest_1.expect)((0, memoryService_1.getRelevantFacts)('')).toEqual([]);
    });
    (0, vitest_1.it)('renders the context block only when there are facts to include', () => {
        (0, vitest_1.expect)((0, memoryService_1.buildMemoryContextBlock)([])).toBe(null);
        const block = (0, memoryService_1.buildMemoryContextBlock)([fact('default editor', 'VS Code')]);
        (0, vitest_1.expect)(block).toContain('- default editor: VS Code');
        (0, vitest_1.expect)(block).toMatch(/Durable facts/i);
    });
});
(0, vitest_1.describe)('fact detection from user messages', () => {
    vitest_1.it.each([
        ['my default editor is VS Code.', [{ key: 'default editor', value: 'VS Code' }]],
        ['Actually my home city is now Berlin', [{ key: 'home city', value: 'Berlin' }]],
        ['remember that my timezone is CET', [{ key: 'timezone', value: 'CET' }]],
        ['call me Ari', []],
    ])('%s -> %j', (input, expected) => {
        (0, vitest_1.expect)((0, memoryService_1.extractFactCandidates)(input)).toEqual(expected);
    });
    (0, vitest_1.it)('detects preference phrasing with swapped capture order', () => {
        const candidates = (0, memoryService_1.extractFactCandidates)('I prefer VS Code as my default editor');
        (0, vitest_1.expect)(candidates).toEqual([{ key: 'default editor', value: 'VS Code' }]);
    });
    (0, vitest_1.it)('does not store ordinary commands or chatter', () => {
        for (const text of [
            'open vscode',
            'run echo hello',
            'delete the file at ~/notes.txt',
            'what is the weather',
            '',
        ]) {
            (0, vitest_1.expect)((0, memoryService_1.extractFactCandidates)(text)).toEqual([]);
        }
    });
    (0, vitest_1.it)('learnFromUserMessage persists detected facts as auto_learned', () => {
        memoryFactsMock.set.mockImplementation((key, value) => fact(key, value));
        const learned = (0, memoryService_1.learnFromUserMessage)('my default editor is VS Code');
        (0, vitest_1.expect)(learned).toEqual(['default editor']);
        (0, vitest_1.expect)(memoryFactsMock.set).toHaveBeenCalledWith('default editor', 'VS Code', 'auto_learned');
    });
    (0, vitest_1.it)('corrections overwrite the same key rather than adding a second row', () => {
        memoryFactsMock.set.mockReturnValue(fact('default editor', 'JetBrains'));
        (0, memoryService_1.learnFromUserMessage)('remember that my default editor is JetBrains');
        (0, memoryService_1.learnFromUserMessage)('actually my default editor is Neovim');
        const keys = memoryFactsMock.set.mock.calls.map(call => call[0]);
        (0, vitest_1.expect)(keys).toEqual(['default editor', 'default editor']);
        (0, vitest_1.expect)(keys.filter(k => k === 'default editor')).toHaveLength(2);
        (0, vitest_1.expect)(new Set(keys).size).toBe(1);
    });
    (0, vitest_1.it)('never throws even if the store explodes — replies must not break', () => {
        memoryFactsMock.set.mockImplementation(() => {
            throw new Error('db locked');
        });
        (0, vitest_1.expect)(() => (0, memoryService_1.learnFromUserMessage)('my favorite color is teal')).not.toThrow();
    });
    (0, vitest_1.it)('tags sources correctly end-to-end per AC', () => {
        memoryFactsMock.set.mockReturnValue(fact('k', 'v'));
        // Explicit user-added path:
        (0, memoryService_1.setFact)('favorite color', 'teal', 'user_added');
        (0, vitest_1.expect)(memoryFactsMock.set).toHaveBeenLastCalledWith('favorite color', 'teal', 'user_added');
        // Auto-learned path:
        (0, memoryService_1.learnFromUserMessage)('my favorite color is blue');
        (0, vitest_1.expect)(memoryFactsMock.set).toHaveBeenLastCalledWith('favorite color', 'blue', 'auto_learned');
    });
});
