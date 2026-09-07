"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const timeouts_1 = require("../../utils/timeouts");
(0, vitest_1.describe)('withTimeout', () => {
    (0, vitest_1.it)('resolves fast work normally', async () => {
        await (0, vitest_1.expect)((0, timeouts_1.withTimeout)(Promise.resolve('ok'), 1000, 'fast')).resolves.toBe('ok');
    });
    (0, vitest_1.it)('rejects with TimeoutError when work hangs (enforced, not between-steps)', async () => {
        const hanging = new Promise(() => { });
        const start = Date.now();
        await (0, vitest_1.expect)((0, timeouts_1.withTimeout)(hanging, 30, 'hanging step')).rejects.toBeInstanceOf(timeouts_1.TimeoutError);
        (0, vitest_1.expect)(Date.now() - start).toBeLessThan(1000);
    });
    (0, vitest_1.it)('carries the timeout budget on the error', async () => {
        const hanging = new Promise(() => { });
        const err = await (0, timeouts_1.withTimeout)(hanging, 25, 'budget').catch(e => e);
        (0, vitest_1.expect)(err).toBeInstanceOf(timeouts_1.TimeoutError);
        (0, vitest_1.expect)(err.timeoutMs).toBe(25);
    });
});
(0, vitest_1.describe)('fetchWithTimeout', () => {
    (0, vitest_1.it)('aborts a hung request instead of waiting forever', async () => {
        const hangingFetch = vitest_1.vi.fn((_url, init) => new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
                reject(new DOMException('aborted', 'AbortError'));
            });
        }));
        vitest_1.vi.stubGlobal('fetch', hangingFetch);
        try {
            await (0, vitest_1.expect)((0, timeouts_1.fetchWithTimeout)('https://example.test/stuck', { timeoutMs: 30 })).rejects.toBeInstanceOf(timeouts_1.TimeoutError);
            (0, vitest_1.expect)(hangingFetch).toHaveBeenCalledOnce();
        }
        finally {
            vitest_1.vi.unstubAllGlobals();
        }
    });
    (0, vitest_1.it)('returns fast responses untouched', async () => {
        const ok = new Response('{}', { status: 200 });
        vitest_1.vi.stubGlobal('fetch', vitest_1.vi.fn(async () => ok));
        try {
            await (0, vitest_1.expect)((0, timeouts_1.fetchWithTimeout)('https://example.test/ok', { timeoutMs: 1000 })).resolves.toBe(ok);
        }
        finally {
            vitest_1.vi.unstubAllGlobals();
        }
    });
});
