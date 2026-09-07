import { describe, expect, it, vi } from 'vitest';
import {
  TimeoutError,
  fetchWithTimeout,
  withTimeout,
} from '../../utils/timeouts';

describe('withTimeout', () => {
  it('resolves fast work normally', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 1000, 'fast')).resolves.toBe('ok');
  });

  it('rejects with TimeoutError when work hangs (enforced, not between-steps)', async () => {
    const hanging = new Promise<string>(() => {});
    const start = Date.now();
    await expect(withTimeout(hanging, 30, 'hanging step')).rejects.toBeInstanceOf(TimeoutError);
    expect(Date.now() - start).toBeLessThan(1000);
  });

  it('carries the timeout budget on the error', async () => {
    const hanging = new Promise<string>(() => {});
    const err = await withTimeout(hanging, 25, 'budget').catch(e => e);
    expect(err).toBeInstanceOf(TimeoutError);
    expect((err as TimeoutError).timeoutMs).toBe(25);
  });
});

describe('fetchWithTimeout', () => {
  it('aborts a hung request instead of waiting forever', async () => {
    const hangingFetch = vi.fn(
      (_url: unknown, init?: { signal?: AbortSignal }) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        })
    );
    vi.stubGlobal('fetch', hangingFetch);
    try {
      await expect(fetchWithTimeout('https://example.test/stuck', { timeoutMs: 30 })).rejects.toBeInstanceOf(
        TimeoutError
      );
      expect(hangingFetch).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('returns fast responses untouched', async () => {
    const ok = new Response('{}', { status: 200 });
    vi.stubGlobal('fetch', vi.fn(async () => ok));
    try {
      await expect(fetchWithTimeout('https://example.test/ok', { timeoutMs: 1000 })).resolves.toBe(ok);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
