/**
 * T-10 — Tool: GitHub Integration (read + basic write)
 *
 * Two tools over the GitHub REST API:
 *
 * - `github_read` (auto): list/summarize open issues or PRs for a repo.
 * - `github_write` (confirm_required): post a comment on an issue/PR. The
 *   confirmation dialog shows the exact comment text and target because the
 *   registry hands the raw params to the dialog pre-approval.
 *
 * The Personal Access Token is stored with the same safeStorage-encrypted
 * pattern as LLM API keys (F-04): encrypted at rest in user_config, decrypted
 * only in-memory, never logged, never returned to the renderer.
 *
 * Error taxonomy (each a distinct, specific user-facing message):
 *   no_token        – nothing stored yet
 *   token_unreadable– stored blob failed decryption
 *   invalid_token   – 401 from GitHub
 *   rate_limited    – 403 with exhausted rate-limit headers
 *   forbidden       – 403 without rate-limit headers (e.g. missing scopes)
 *   not_found       – 404 (repo vs issue distinguished by context)
 *   network         – fetch itself failed (DNS/offline/timeout)
 */

import { safeStorage } from 'electron';
import { userConfig } from '../db/db';
import { registerTool, type ToolResult } from './toolRegistry';

const GITHUB_API_BASE = 'https://api.github.com';
const TOKEN_CONFIG_KEY = 'github_token';
const REQUEST_TIMEOUT_MS = 15000;

// ---------------------------------------------------------------------------
// Token storage (same mechanism as LLM provider API keys)
// ---------------------------------------------------------------------------

export class GithubToolError extends Error {
  readonly kind: string;
  constructor(kind: string, message: string) {
    super(message);
    this.kind = kind;
  }
}

function assertEncryptionAvailable(): void {
  let available = false;
  try {
    available = safeStorage.isEncryptionAvailable();
  } catch {
    available = false;
  }
  if (!available) {
    throw new GithubToolError(
      'encryption_unavailable',
      "Your operating system's secure storage isn't available, so Kyclius can't save a GitHub token safely. Start your system keyring service (Windows Credential Manager, macOS Keychain, or kwallet/libsecret on Linux) and try again."
    );
  }
}

export function hasGithubToken(): boolean {
  return !!userConfig.get(TOKEN_CONFIG_KEY);
}

/** Encrypts via safeStorage before writing; plain text never touches SQLite. */
export function encryptAndStoreGithubToken(token: string): void {
  assertEncryptionAvailable();
  const encrypted = safeStorage.encryptString(token).toString('base64');
  userConfig.set(TOKEN_CONFIG_KEY, encrypted);
}

export function removeGithubToken(): void {
  userConfig.delete(TOKEN_CONFIG_KEY);
}

function resolveGithubToken(): { ok: true; token: string } | { ok: false; error: string } {
  if (!hasGithubToken()) {
    return {
      ok: false,
      error:
        'No GitHub token is set. Add a Personal Access Token in Settings so Kyclius can talk to GitHub on your behalf.',
    };
  }
  const encrypted = userConfig.get(TOKEN_CONFIG_KEY)!;
  try {
    return { ok: true, token: safeStorage.decryptString(Buffer.from(encrypted, 'base64')) };
  } catch {
    return {
      ok: false,
      error:
        "Your saved GitHub token couldn't be decrypted. Re-enter it in Settings.",
    };
  }
}

// ---------------------------------------------------------------------------
// HTTP plumbing + error taxonomy
// ---------------------------------------------------------------------------

interface JsonErrorBody {
  message?: string;
}

async function githubApiRequest(
  method: 'GET' | 'POST',
  path: string,
  token: string,
  body?: Record<string, unknown>
): Promise<{ status: number; headers: Headers; json: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${GITHUB_API_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        // GitHub requires a User-Agent on every API request.
        'User-Agent': 'Kyclius',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch {
    throw new GithubToolError(
      'network',
      "Couldn't reach GitHub (network failure or timeout). Check your internet connection and try again."
    );
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 401) {
    throw new GithubToolError(
      'invalid_token',
      'GitHub rejected the stored token as invalid or expired (401). Generate a new Personal Access Token and update it in Settings.'
    );
  }
  if (response.status === 403) {
    if (response.headers.get('x-ratelimit-remaining') === '0') {
      const resetEpoch = Number(response.headers.get('x-ratelimit-reset') ?? 0);
      const resetAt =
        resetEpoch > 0 ? new Date(resetEpoch * 1000).toLocaleTimeString() : 'soon';
      throw new GithubToolError(
        'rate_limited',
        `GitHub API rate limit reached for your token. The limit resets at ${resetAt}; until then GitHub requests can't go through.`
      );
    }
    throw new GithubToolError(
      'forbidden',
      'GitHub refused this action (403). Your token may be missing the required scope (read needs `repo`; commenting needs `repo` too).'
    );
  }
  if (response.status === 404) {
    throw new GithubToolError('not_found', path);
  }

  let json: unknown = null;
  try {
    json = await response.json();
  } catch {
    json = null;
  }
  if (!response.ok) {
    const detail = (json as JsonErrorBody)?.message ?? `HTTP ${response.status}`;
    throw new GithubToolError(
      'unexpected',
      `GitHub returned an unexpected error: ${detail}`
    );
  }
  return { status: response.status, headers: response.headers, json };
}

/** Turns a 404 into the right "repo" vs "issue" message for the context. */
function notFoundMessage(context: { kind: 'repo' | 'issue'; owner: string; repo: string; number?: number }): string {
  return context.kind === 'repo'
    ? `Repository "${context.owner}/${context.repo}" was not found (or the token can't see it). Check the spelling and whether it's private.`
    : `Issue/PR #${context.number} was not found in ${context.owner}/${context.repo}. It may be closed, deleted, or belong to a different repo.`;
}

const OWNER_REPO_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

function validateOwnerRepo(owner: unknown, repo: unknown): string | null {
  if (typeof owner !== 'string' || !OWNER_REPO_PATTERN.test(owner.trim())) {
    return `"owner" must be a valid GitHub username/org, got: ${JSON.stringify(owner)}`;
  }
  if (typeof repo !== 'string' || !OWNER_REPO_PATTERN.test(repo.trim())) {
    return `"repo" must be a valid repository name, got: ${JSON.stringify(repo)}`;
  }
  return null;
}

function runGithubTool(fn: () => Promise<ToolResult>): Promise<ToolResult> {
  return fn().catch((err: unknown) =>
    err instanceof GithubToolError
      ? { success: false, error: err.message }
      : {
          success: false,
          error: `GitHub tool failed unexpectedly: ${err instanceof Error ? err.message : String(err)}`,
        }
  );
}

// ---------------------------------------------------------------------------
// github_read (auto tier)
// ---------------------------------------------------------------------------

interface GhItem {
  number: number;
  title: string;
  state?: string;
  html_url?: string;
  user?: { login?: string };
  labels?: Array<{ name?: string }>;
  pull_request?: unknown;
  draft?: boolean;
}

registerTool({
  name: 'github_read',
  description:
    'List and summarize open issues or pull requests for a GitHub repository ' +
    '(public or one the stored token can access). No confirmation needed.',
  parameters: {
    type: 'object',
    properties: {
      owner: { type: 'string', description: 'Repository owner (username or org)' },
      repo: { type: 'string', description: 'Repository name' },
      kind: {
        type: 'string',
        description: 'What to list: "issues" (default) or "pulls"',
      },
      limit: {
        type: 'number',
        description: 'Max items to list (1-50, default 10)',
      },
    },
    required: ['owner', 'repo'],
  },
  permissionTier: 'auto',
  validate: params => validateOwnerRepo(params.owner, params.repo),
  handler: async params =>
    runGithubTool(async () => {
      const tokenResolution = resolveGithubToken();
      if (!tokenResolution.ok) {
        return { success: false, error: tokenResolution.error };
      }
      const owner = String(params.owner).trim();
      const repo = String(params.repo).trim();
      const kind = params.kind === 'pulls' ? 'pulls' : 'issues';
      const requested = Number(params.limit);
      const limit = Math.min(Math.max(Number.isFinite(requested) ? requested : 10, 1), 50);

      const path = `/repos/${owner}/${repo}/${kind}?state=open&per_page=${limit}`;
      let data: { status: number; json: unknown };
      try {
        data = await githubApiRequest('GET', path, tokenResolution.token);
      } catch (err) {
        if (err instanceof GithubToolError && err.kind === 'not_found') {
          throw new GithubToolError('not_found', notFoundMessage({ kind: 'repo', owner, repo }));
        }
        throw err;
      }

      const items = (Array.isArray(data.json) ? data.json : []) as GhItem[];
      const filtered =
        kind === 'issues' ? items.filter(item => !item.pull_request) : items;

      if (filtered.length === 0) {
        return { success: true, result: `No open ${kind} found in ${owner}/${repo}.` };
      }

      const lines = filtered.map(item => {
        const author = item.user?.login ? ` (by ${item.user.login})` : '';
        const labels = item.labels?.map(l => l.name).filter(Boolean) ?? [];
        const labelTag = labels.length > 0 ? ` [${labels.join(', ')}]` : '';
        const prMarker = kind === 'pulls' && item.draft ? ' [draft]' : '';
        return `#${item.number}: ${item.title}${prMarker}${labelTag}${author}`;
      });
      return {
        success: true,
        result: `${filtered.length} open ${kind} in ${owner}/${repo}:\n${lines.join('\n')}`,
      };
    }),
});

// ---------------------------------------------------------------------------
// github_write (confirm_required tier) — posting an issue/PR comment
// ---------------------------------------------------------------------------

registerTool({
  name: 'github_write',
  description:
    'Post a comment on a GitHub issue or pull request. Always asks the user ' +
    'for confirmation first; the dialog shows the exact comment text and target.',
  parameters: {
    type: 'object',
    properties: {
      owner: { type: 'string', description: 'Repository owner (username or org)' },
      repo: { type: 'string', description: 'Repository name' },
      number: {
        type: 'number',
        description: 'Issue or pull request number to comment on (e.g. 42)',
      },
      comment: {
        type: 'string',
        description: 'The exact full text of the comment to post',
      },
    },
    required: ['owner', 'repo', 'number', 'comment'],
  },
  permissionTier: 'confirm_required',
  validate: params => {
    const ownerRepoError = validateOwnerRepo(params.owner, params.repo);
    if (ownerRepoError) return ownerRepoError;
    const number = params.number;
    if (
      typeof number !== 'number' ||
      !Number.isInteger(number) ||
      number < 1
    ) {
      return `"number" must be a positive integer issue/PR number, got: ${JSON.stringify(number)}`;
    }
    if (typeof params.comment !== 'string' || params.comment.trim().length === 0) {
      return '"comment" must be non-empty text to post.';
    }
    return null;
  },
  handler: async params =>
    runGithubTool(async () => {
      const tokenResolution = resolveGithubToken();
      if (!tokenResolution.ok) {
        return { success: false, error: tokenResolution.error };
      }
      const owner = String(params.owner).trim();
      const repo = String(params.repo).trim();
      const number = Number(params.number);
      const comment = String(params.comment);

      const path = `/repos/${owner}/${repo}/issues/${number}/comments`;
      let data: { json: unknown };
      try {
        data = await githubApiRequest('POST', path, tokenResolution.token, {
          body: comment,
        });
      } catch (err) {
        if (err instanceof GithubToolError && err.kind === 'not_found') {
          throw new GithubToolError(
            'not_found',
            notFoundMessage({ kind: 'issue', owner, repo, number })
          );
        }
        throw err;
      }

      const url = (data.json as { html_url?: string })?.html_url;
      return {
        success: true,
        result: url
          ? `Comment posted on ${owner}/${repo}#${number}. View it at: ${url}`
          : `Comment posted on ${owner}/${repo}#${number}.`,
      };
    }),
});
