"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const { userConfigMock, toolExecutionsMock, safeStorageMock, fetchMock } = vitest_1.vi.hoisted(() => ({
    userConfigMock: {
        get: vitest_1.vi.fn(),
        set: vitest_1.vi.fn(),
        delete: vitest_1.vi.fn(),
    },
    toolExecutionsMock: {
        create: vitest_1.vi.fn(),
        updateStatus: vitest_1.vi.fn(),
    },
    safeStorageMock: {
        isEncryptionAvailable: vitest_1.vi.fn(),
        encryptString: vitest_1.vi.fn(),
        decryptString: vitest_1.vi.fn(),
    },
    fetchMock: vitest_1.vi.fn(),
}));
vitest_1.vi.mock('electron', () => ({ safeStorage: safeStorageMock }));
vitest_1.vi.mock('../../db/db', () => ({
    userConfig: userConfigMock,
    toolExecutions: toolExecutionsMock,
}));
require("../github");
const github_1 = require("../github");
const toolRegistry_1 = require("../toolRegistry");
function jsonResponse(status, body, headers = {}) {
    return {
        ok: status >= 200 && status < 300,
        status,
        headers: { get: (name) => headers[name.toLowerCase()] ?? null },
        json: async () => body,
    };
}
function approvedGate() {
    return vitest_1.vi.fn(async (_context) => ({ decision: 'proceed' }));
}
/** Stored, decryptable token for happy-path tests. */
function withStoredToken(token = 'ghp_test_token') {
    userConfigMock.get.mockImplementation((key) => key === 'github_token' ? Buffer.from('encrypted-blob').toString('base64') : null);
    safeStorageMock.decryptString.mockReturnValue(token);
}
(0, vitest_1.beforeEach)(() => {
    vitest_1.vi.clearAllMocks();
    (0, toolRegistry_1.setExecutionGate)(null);
    safeStorageMock.isEncryptionAvailable.mockReturnValue(true);
});
(0, vitest_1.afterEach)(() => {
    (0, toolRegistry_1.setExecutionGate)(null);
    vitest_1.vi.unstubAllGlobals();
});
(0, vitest_1.describe)('github token storage', () => {
    (0, vitest_1.it)('stores the token only after safeStorage encryption', () => {
        safeStorageMock.encryptString.mockReturnValue(Buffer.from('cipher'));
        (0, github_1.encryptAndStoreGithubToken)('ghp_plain');
        (0, vitest_1.expect)(safeStorageMock.encryptString).toHaveBeenCalledWith('ghp_plain');
        const [key, stored] = userConfigMock.set.mock.calls[0];
        (0, vitest_1.expect)(key).toBe('github_token');
        (0, vitest_1.expect)(stored).toBe(Buffer.from('cipher').toString('base64'));
        (0, vitest_1.expect)(stored).not.toContain('ghp_plain');
    });
    (0, vitest_1.it)('refuses to store a token when OS secure storage is unavailable', () => {
        safeStorageMock.isEncryptionAvailable.mockReturnValue(false);
        (0, vitest_1.expect)(() => (0, github_1.encryptAndStoreGithubToken)('ghp_x')).toThrow(/secure storage/i);
        (0, vitest_1.expect)(userConfigMock.set).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('reports token presence based on stored config', () => {
        userConfigMock.get.mockReturnValue(undefined);
        (0, vitest_1.expect)((0, github_1.hasGithubToken)()).toBe(false);
        userConfigMock.get.mockReturnValue('blob');
        (0, vitest_1.expect)((0, github_1.hasGithubToken)()).toBe(true);
    });
});
(0, vitest_1.describe)('github_read tool', () => {
    (0, vitest_1.it)('is registered with auto permission tier', () => {
        const tool = (0, toolRegistry_1.getTool)('github_read');
        (0, vitest_1.expect)(tool).toBeDefined();
        (0, vitest_1.expect)(tool.permissionTier).toBe('auto');
    });
    (0, vitest_1.it)('lists and summarizes open issues without any confirmation', async () => {
        withStoredToken();
        fetchMock.mockResolvedValue(jsonResponse(200, [
            { number: 12, title: 'Fix login bug', user: { login: 'alice' }, labels: [{ name: 'bug' }] },
            { number: 7, title: 'Add dark mode', pull_request: {} },
            { number: 9, title: 'Update docs' },
        ]));
        vitest_1.vi.stubGlobal('fetch', fetchMock);
        const outcome = await (0, toolRegistry_1.executeToolCall)('github_read', {
            owner: 'octocat',
            repo: 'hello-world',
        });
        (0, vitest_1.expect)(outcome.success).toBe(true);
        // PR-shaped entries are excluded when listing issues.
        (0, vitest_1.expect)(outcome.result).toContain('#12: Fix login bug');
        (0, vitest_1.expect)(outcome.result).toContain('[bug]');
        (0, vitest_1.expect)(outcome.result).toContain('(by alice)');
        (0, vitest_1.expect)(outcome.result).not.toContain('#7:');
        (0, vitest_1.expect)(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0];
        (0, vitest_1.expect)(url).toBe('https://api.github.com/repos/octocat/hello-world/issues?state=open&per_page=10');
        (0, vitest_1.expect)(init.method).toBe('GET');
        (0, vitest_1.expect)(init.headers.Authorization).toBe('Bearer ghp_test_token');
        (0, vitest_1.expect)(init.headers['User-Agent']).toBe('Kyclius');
    });
    (0, vitest_1.it)('uses the pulls endpoint and reports an empty list clearly', async () => {
        withStoredToken();
        fetchMock.mockResolvedValue(jsonResponse(200, []));
        vitest_1.vi.stubGlobal('fetch', fetchMock);
        const outcome = await (0, toolRegistry_1.executeToolCall)('github_read', {
            owner: 'octocat',
            repo: 'hello-world',
            kind: 'pulls',
            limit: 25,
        });
        (0, vitest_1.expect)(outcome.success).toBe(true);
        (0, vitest_1.expect)(outcome.result).toMatch(/No open pulls/i);
        const [url] = fetchMock.mock.calls[0];
        (0, vitest_1.expect)(url).toBe('https://api.github.com/repos/octocat/hello-world/pulls?state=open&per_page=25');
    });
    (0, vitest_1.it)('asks for a token instead of calling GitHub when none is stored', async () => {
        userConfigMock.get.mockReturnValue(null);
        vitest_1.vi.stubGlobal('fetch', fetchMock);
        const outcome = await (0, toolRegistry_1.executeToolCall)('github_read', {
            owner: 'octocat',
            repo: 'hello-world',
        });
        (0, vitest_1.expect)(outcome.success).toBe(false);
        (0, vitest_1.expect)(outcome.error).toMatch(/No GitHub token is set/i);
        (0, vitest_1.expect)(fetchMock).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('rejects malformed owner/repo before any dialog or network call', async () => {
        vitest_1.vi.stubGlobal('fetch', fetchMock);
        const outcome = await (0, toolRegistry_1.executeToolCall)('github_read', {
            owner: 'has space',
            repo: '../etc',
        });
        (0, vitest_1.expect)(outcome.success).toBe(false);
        (0, vitest_1.expect)(outcome.error).toMatch(/owner.*must be a valid GitHub username/i);
        (0, vitest_1.expect)(fetchMock).not.toHaveBeenCalled();
    });
});
(0, vitest_1.describe)('github_write tool', () => {
    (0, vitest_1.it)('is registered with confirm_required permission tier', () => {
        const tool = (0, toolRegistry_1.getTool)('github_write');
        (0, vitest_1.expect)(tool).toBeDefined();
        (0, vitest_1.expect)(tool.permissionTier).toBe('confirm_required');
    });
    (0, vitest_1.it)('posts the exact comment after approval and reports the URL', async () => {
        withStoredToken();
        const gate = approvedGate();
        (0, toolRegistry_1.setExecutionGate)(gate);
        fetchMock.mockResolvedValue(jsonResponse(201, { html_url: 'https://github.com/octocat/hello-world/issues/42#issuecomment-1' }));
        vitest_1.vi.stubGlobal('fetch', fetchMock);
        const outcome = await (0, toolRegistry_1.executeToolCall)('github_write', {
            owner: 'octocat',
            repo: 'hello-world',
            number: 42,
            comment: 'Looks fixed in v2. Closing.',
        });
        (0, vitest_1.expect)(outcome.success).toBe(true);
        (0, vitest_1.expect)(outcome.result).toContain('issues/42#issuecomment-1');
        // Dialog saw the exact comment text and target pre-approval.
        const gateContext = gate.mock.calls[0][0];
        (0, vitest_1.expect)(gateContext.params.comment).toBe('Looks fixed in v2. Closing.');
        (0, vitest_1.expect)(gateContext.params.number).toBe(42);
        const [url, init] = fetchMock.mock.calls[0];
        (0, vitest_1.expect)(url).toBe('https://api.github.com/repos/octocat/hello-world/issues/42/comments');
        (0, vitest_1.expect)(JSON.parse(String(init.body))).toEqual({ body: 'Looks fixed in v2. Closing.' });
        (0, vitest_1.expect)(toolExecutionsMock.updateStatus).toHaveBeenCalledWith(vitest_1.expect.any(String), 'success', vitest_1.expect.anything());
    });
    (0, vitest_1.it)('never reaches the dialog or network when required params are invalid', async () => {
        const gate = approvedGate();
        (0, toolRegistry_1.setExecutionGate)(gate);
        vitest_1.vi.stubGlobal('fetch', fetchMock);
        const badNumber = await (0, toolRegistry_1.executeToolCall)('github_write', {
            owner: 'o', repo: 'r', number: -3, comment: 'hi',
        });
        (0, vitest_1.expect)(badNumber.success).toBe(false);
        (0, vitest_1.expect)(badNumber.error).toMatch(/"number" must be a positive integer/i);
        const emptyComment = await (0, toolRegistry_1.executeToolCall)('github_write', {
            owner: 'o', repo: 'r', number: 3, comment: '   ',
        });
        (0, vitest_1.expect)(emptyComment.success).toBe(false);
        (0, vitest_1.expect)(emptyComment.error).toMatch(/"comment" must be non-empty/i);
        (0, vitest_1.expect)(gate).not.toHaveBeenCalled();
        (0, vitest_1.expect)(fetchMock).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('distinguishes missing issue from missing repo on 404s', async () => {
        withStoredToken();
        fetchMock.mockResolvedValue(jsonResponse(404, { message: 'Not Found' }));
        vitest_1.vi.stubGlobal('fetch', fetchMock);
        (0, toolRegistry_1.setExecutionGate)(approvedGate());
        const writeMiss = await (0, toolRegistry_1.executeToolCall)('github_write', {
            owner: 'o', repo: 'r', number: 99, comment: 'x',
        });
        (0, vitest_1.expect)(writeMiss.error).toMatch(/#99 was not found in o\/r/i);
        fetchMock.mockClear();
        const readMiss = await (0, toolRegistry_1.executeToolCall)('github_read', { owner: 'o', repo: 'r' });
        (0, vitest_1.expect)(readMiss.error).toMatch(/Repository "o\/r" was not found/i);
    });
});
(0, vitest_1.describe)('github error taxonomy', () => {
    (0, vitest_1.beforeEach)(() => {
        withStoredToken();
        vitest_1.vi.stubGlobal('fetch', fetchMock);
    });
    (0, vitest_1.it)('invalid/expired token (401) has its own message', async () => {
        fetchMock.mockResolvedValue(jsonResponse(401, { message: 'Bad credentials' }));
        const outcome = await (0, toolRegistry_1.executeToolCall)('github_read', { owner: 'o', repo: 'r' });
        (0, vitest_1.expect)(outcome.success).toBe(false);
        (0, vitest_1.expect)(outcome.error).toMatch(/rejected the stored token as invalid or expired \(401\)/i);
    });
    (0, vitest_1.it)('rate limiting (403 + exhausted header) has its own message with reset time', async () => {
        fetchMock.mockResolvedValue(jsonResponse(403, { message: 'API rate limit exceeded' }, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(1756000000) }));
        const outcome = await (0, toolRegistry_1.executeToolCall)('github_read', { owner: 'o', repo: 'r' });
        (0, vitest_1.expect)(outcome.success).toBe(false);
        (0, vitest_1.expect)(outcome.error).toMatch(/rate limit reached/i);
        (0, vitest_1.expect)(outcome.error).toMatch(/resets at/i);
    });
    (0, vitest_1.it)('a plain 403 forbidden is distinct from rate limiting and 404', async () => {
        fetchMock.mockResolvedValue(jsonResponse(403, { message: 'Resource not accessible' }));
        const outcome = await (0, toolRegistry_1.executeToolCall)('github_read', { owner: 'o', repo: 'r' });
        (0, vitest_1.expect)(outcome.success).toBe(false);
        (0, vitest_1.expect)(outcome.error).toMatch(/missing the required scope/i);
    });
    (0, vitest_1.it)('network failure has its own message', async () => {
        fetchMock.mockRejectedValue(new TypeError('getaddrinfo ENOTFOUND api.github.com'));
        const outcome = await (0, toolRegistry_1.executeToolCall)('github_read', { owner: 'o', repo: 'r' });
        (0, vitest_1.expect)(outcome.success).toBe(false);
        (0, vitest_1.expect)(outcome.error).toMatch(/Couldn't reach GitHub/i);
    });
    (0, vitest_1.it)('an unexpected status surfaces the GitHub error detail', async () => {
        fetchMock.mockResolvedValue(jsonResponse(500, { message: 'Server meltdown' }));
        const outcome = await (0, toolRegistry_1.executeToolCall)('github_read', { owner: 'o', repo: 'r' });
        (0, vitest_1.expect)(outcome.success).toBe(false);
        (0, vitest_1.expect)(outcome.error).toMatch(/unexpected error: Server meltdown/i);
    });
    (0, vitest_1.it)('the three AC-mandated messages are pairwise distinguishable', async () => {
        const readFor = async (response) => {
            fetchMock.mockResolvedValue(response);
            return (await (0, toolRegistry_1.executeToolCall)('github_read', { owner: 'o', repo: 'r' })).error ?? '';
        };
        const invalid = await readFor(jsonResponse(401, {}));
        const limited = await readFor(jsonResponse(403, {}, { 'x-ratelimit-remaining': '0' }));
        const missing = await readFor(jsonResponse(404, {}));
        (0, vitest_1.expect)(invalid).not.toEqual(limited);
        (0, vitest_1.expect)(limited).not.toEqual(missing);
        (0, vitest_1.expect)(invalid).not.toEqual(missing);
        (0, vitest_1.expect)(invalid).toMatch(/token/i);
        (0, vitest_1.expect)(limited).toMatch(/rate limit/i);
        (0, vitest_1.expect)(missing).toMatch(/not found/i);
    });
});
