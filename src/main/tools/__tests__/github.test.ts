import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { userConfigMock, toolExecutionsMock, safeStorageMock, fetchMock } = vi.hoisted(() => ({
  userConfigMock: {
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
  },
  toolExecutionsMock: {
    create: vi.fn(),
    updateStatus: vi.fn(),
  },
  safeStorageMock: {
    isEncryptionAvailable: vi.fn(),
    encryptString: vi.fn(),
    decryptString: vi.fn(),
  },
  fetchMock: vi.fn(),
}));

vi.mock('electron', () => ({ safeStorage: safeStorageMock }));

vi.mock('../../db/db', () => ({
  userConfig: userConfigMock,
  toolExecutions: toolExecutionsMock,
}));

import '../github';
import {
  encryptAndStoreGithubToken,
  hasGithubToken,
} from '../github';
import { executeToolCall, getTool, setExecutionGate } from '../toolRegistry';

function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {}
) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    json: async () => body,
  };
}

function approvedGate() {
  return vi.fn(async (_context: unknown) => ({ decision: 'proceed' as const }));
}

/** Stored, decryptable token for happy-path tests. */
function withStoredToken(token = 'ghp_test_token') {
  userConfigMock.get.mockImplementation((key: string) =>
    key === 'github_token' ? Buffer.from('encrypted-blob').toString('base64') : null
  );
  safeStorageMock.decryptString.mockReturnValue(token);
}

beforeEach(() => {
  vi.clearAllMocks();
  setExecutionGate(null);
  safeStorageMock.isEncryptionAvailable.mockReturnValue(true);
});

afterEach(() => {
  setExecutionGate(null);
  vi.unstubAllGlobals();
});

describe('github token storage', () => {
  it('stores the token only after safeStorage encryption', () => {
    safeStorageMock.encryptString.mockReturnValue(Buffer.from('cipher'));
    encryptAndStoreGithubToken('ghp_plain');

    expect(safeStorageMock.encryptString).toHaveBeenCalledWith('ghp_plain');
    const [key, stored] = userConfigMock.set.mock.calls[0];
    expect(key).toBe('github_token');
    expect(stored).toBe(Buffer.from('cipher').toString('base64'));
    expect(stored).not.toContain('ghp_plain');
  });

  it('refuses to store a token when OS secure storage is unavailable', () => {
    safeStorageMock.isEncryptionAvailable.mockReturnValue(false);
    expect(() => encryptAndStoreGithubToken('ghp_x')).toThrow(/secure storage/i);
    expect(userConfigMock.set).not.toHaveBeenCalled();
  });

  it('reports token presence based on stored config', () => {
    userConfigMock.get.mockReturnValue(undefined);
    expect(hasGithubToken()).toBe(false);
    userConfigMock.get.mockReturnValue('blob');
    expect(hasGithubToken()).toBe(true);
  });
});

describe('github_read tool', () => {
  it('is registered with auto permission tier', () => {
    const tool = getTool('github_read')!;
    expect(tool).toBeDefined();
    expect(tool.permissionTier).toBe('auto');
  });

  it('lists and summarizes open issues without any confirmation', async () => {
    withStoredToken();
    fetchMock.mockResolvedValue(
      jsonResponse(200, [
        { number: 12, title: 'Fix login bug', user: { login: 'alice' }, labels: [{ name: 'bug' }] },
        { number: 7, title: 'Add dark mode', pull_request: {} },
        { number: 9, title: 'Update docs' },
      ])
    );
    vi.stubGlobal('fetch', fetchMock);

    const outcome = await executeToolCall('github_read', {
      owner: 'octocat',
      repo: 'hello-world',
    });

    expect(outcome.success).toBe(true);
    // PR-shaped entries are excluded when listing issues.
    expect(outcome.result).toContain('#12: Fix login bug');
    expect(outcome.result).toContain('[bug]');
    expect(outcome.result).toContain('(by alice)');
    expect(outcome.result).not.toContain('#7:');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.github.com/repos/octocat/hello-world/issues?state=open&per_page=10');
    expect(init.method).toBe('GET');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer ghp_test_token');
    expect((init.headers as Record<string, string>)['User-Agent']).toBe('Kyclius');
  });

  it('uses the pulls endpoint and reports an empty list clearly', async () => {
    withStoredToken();
    fetchMock.mockResolvedValue(jsonResponse(200, []));
    vi.stubGlobal('fetch', fetchMock);

    const outcome = await executeToolCall('github_read', {
      owner: 'octocat',
      repo: 'hello-world',
      kind: 'pulls',
      limit: 25,
    });

    expect(outcome.success).toBe(true);
    expect(outcome.result).toMatch(/No open pulls/i);
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe('https://api.github.com/repos/octocat/hello-world/pulls?state=open&per_page=25');
  });

  it('asks for a token instead of calling GitHub when none is stored', async () => {
    userConfigMock.get.mockReturnValue(null);
    vi.stubGlobal('fetch', fetchMock);

    const outcome = await executeToolCall('github_read', {
      owner: 'octocat',
      repo: 'hello-world',
    });

    expect(outcome.success).toBe(false);
    expect(outcome.error).toMatch(/No GitHub token is set/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects malformed owner/repo before any dialog or network call', async () => {
    vi.stubGlobal('fetch', fetchMock);

    const outcome = await executeToolCall('github_read', {
      owner: 'has space',
      repo: '../etc',
    });

    expect(outcome.success).toBe(false);
    expect(outcome.error).toMatch(/owner.*must be a valid GitHub username/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('github_write tool', () => {
  it('is registered with confirm_required permission tier', () => {
    const tool = getTool('github_write')!;
    expect(tool).toBeDefined();
    expect(tool.permissionTier).toBe('confirm_required');
  });

  it('posts the exact comment after approval and reports the URL', async () => {
    withStoredToken();
    const gate = approvedGate();
    setExecutionGate(gate);
    fetchMock.mockResolvedValue(
      jsonResponse(201, { html_url: 'https://github.com/octocat/hello-world/issues/42#issuecomment-1' })
    );
    vi.stubGlobal('fetch', fetchMock);

    const outcome = await executeToolCall('github_write', {
      owner: 'octocat',
      repo: 'hello-world',
      number: 42,
      comment: 'Looks fixed in v2. Closing.',
    });

    expect(outcome.success).toBe(true);
    expect(outcome.result).toContain('issues/42#issuecomment-1');
    // Dialog saw the exact comment text and target pre-approval.
    const gateContext = gate.mock.calls[0][0] as { params: Record<string, unknown> };
    expect(gateContext.params.comment).toBe('Looks fixed in v2. Closing.');
    expect(gateContext.params.number).toBe(42);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.github.com/repos/octocat/hello-world/issues/42/comments');
    expect(JSON.parse(String(init.body))).toEqual({ body: 'Looks fixed in v2. Closing.' });
    expect(toolExecutionsMock.updateStatus).toHaveBeenCalledWith(expect.any(String), 'success', expect.anything());
  });

  it('never reaches the dialog or network when required params are invalid', async () => {
    const gate = approvedGate();
    setExecutionGate(gate);
    vi.stubGlobal('fetch', fetchMock);

    const badNumber = await executeToolCall('github_write', {
      owner: 'o', repo: 'r', number: -3, comment: 'hi',
    });
    expect(badNumber.success).toBe(false);
    expect(badNumber.error).toMatch(/"number" must be a positive integer/i);

    const emptyComment = await executeToolCall('github_write', {
      owner: 'o', repo: 'r', number: 3, comment: '   ',
    });
    expect(emptyComment.success).toBe(false);
    expect(emptyComment.error).toMatch(/"comment" must be non-empty/i);

    expect(gate).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('distinguishes missing issue from missing repo on 404s', async () => {
    withStoredToken();

    fetchMock.mockResolvedValue(jsonResponse(404, { message: 'Not Found' }));
    vi.stubGlobal('fetch', fetchMock);
    setExecutionGate(approvedGate());
    const writeMiss = await executeToolCall('github_write', {
      owner: 'o', repo: 'r', number: 99, comment: 'x',
    });
    expect(writeMiss.error).toMatch(/#99 was not found in o\/r/i);

    fetchMock.mockClear();
    const readMiss = await executeToolCall('github_read', { owner: 'o', repo: 'r' });
    expect(readMiss.error).toMatch(/Repository "o\/r" was not found/i);
  });
});

describe('github error taxonomy', () => {
  beforeEach(() => {
    withStoredToken();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('invalid/expired token (401) has its own message', async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { message: 'Bad credentials' }));

    const outcome = await executeToolCall('github_read', { owner: 'o', repo: 'r' });
    expect(outcome.success).toBe(false);
    expect(outcome.error).toMatch(/rejected the stored token as invalid or expired \(401\)/i);
  });

  it('rate limiting (403 + exhausted header) has its own message with reset time', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        403,
        { message: 'API rate limit exceeded' },
        { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(1756000000) }
      )
    );

    const outcome = await executeToolCall('github_read', { owner: 'o', repo: 'r' });
    expect(outcome.success).toBe(false);
    expect(outcome.error).toMatch(/rate limit reached/i);
    expect(outcome.error).toMatch(/resets at/i);
  });

  it('a plain 403 forbidden is distinct from rate limiting and 404', async () => {
    fetchMock.mockResolvedValue(jsonResponse(403, { message: 'Resource not accessible' }));

    const outcome = await executeToolCall('github_read', { owner: 'o', repo: 'r' });
    expect(outcome.success).toBe(false);
    expect(outcome.error).toMatch(/missing the required scope/i);
  });

  it('network failure has its own message', async () => {
    fetchMock.mockRejectedValue(new TypeError('getaddrinfo ENOTFOUND api.github.com'));

    const outcome = await executeToolCall('github_read', { owner: 'o', repo: 'r' });
    expect(outcome.success).toBe(false);
    expect(outcome.error).toMatch(/Couldn't reach GitHub/i);
  });

  it('an unexpected status surfaces the GitHub error detail', async () => {
    fetchMock.mockResolvedValue(jsonResponse(500, { message: 'Server meltdown' }));

    const outcome = await executeToolCall('github_read', { owner: 'o', repo: 'r' });
    expect(outcome.success).toBe(false);
    expect(outcome.error).toMatch(/unexpected error: Server meltdown/i);
  });

  it('the three AC-mandated messages are pairwise distinguishable', async () => {
    const readFor = async (response: unknown) => {
      fetchMock.mockResolvedValue(response as never);
      return (await executeToolCall('github_read', { owner: 'o', repo: 'r' })).error ?? '';
    };
    const invalid = await readFor(jsonResponse(401, {}));
    const limited = await readFor(
      jsonResponse(403, {}, { 'x-ratelimit-remaining': '0' })
    );
    const missing = await readFor(jsonResponse(404, {}));

    expect(invalid).not.toEqual(limited);
    expect(limited).not.toEqual(missing);
    expect(invalid).not.toEqual(missing);
    expect(invalid).toMatch(/token/i);
    expect(limited).toMatch(/rate limit/i);
    expect(missing).toMatch(/not found/i);
  });
});
