"use strict";
/**
 * EF-10: enforced, real timeouts for every main-process call reachable from a
 * single user action.
 *
 * A timeout value that is only "checked between already-completed steps" does
 * not fix a hang — the hung step itself must be abortable. These helpers give
 * every network call, spawned process, and multi-step turn a wall-clock
 * ceiling that can actually interrupt the in-flight work:
 *
 * - `withTimeout` races any promise against a timer (for CPU/pipeline work).
 * - `fetchWithTimeout` aborts the underlying HTTP request via AbortController
 *   (for fetch calls that would otherwise hang forever on a dead socket).
 * - `TimeoutError` lets callers distinguish "timed out" from other failures
 *   so the UI can show the "taking longer than expected" state / honest error.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TimeoutError = exports.FILE_READ_TIMEOUT_MS = exports.TOOL_STEP_TIMEOUT_MS = exports.TURN_TIMEOUT_MS = exports.TTS_SPAWN_TIMEOUT_MS = exports.WHISPER_SPAWN_TIMEOUT_MS = exports.MODEL_DOWNLOAD_TIMEOUT_MS = exports.CLOUD_VOICE_TIMEOUT_MS = exports.LLM_FETCH_TIMEOUT_MS = exports.LLM_STREAM_TIMEOUT_MS = void 0;
exports.withTimeout = withTimeout;
exports.fetchWithTimeout = fetchWithTimeout;
/** Wall-clock ceilings. Kept in one place so the audit is reviewable. */
exports.LLM_STREAM_TIMEOUT_MS = 90_000;
exports.LLM_FETCH_TIMEOUT_MS = 60_000;
exports.CLOUD_VOICE_TIMEOUT_MS = 30_000;
exports.MODEL_DOWNLOAD_TIMEOUT_MS = 120_000;
exports.WHISPER_SPAWN_TIMEOUT_MS = 60_000;
exports.TTS_SPAWN_TIMEOUT_MS = 60_000;
exports.TURN_TIMEOUT_MS = 120_000;
exports.TOOL_STEP_TIMEOUT_MS = 30_000;
exports.FILE_READ_TIMEOUT_MS = 15_000;
class TimeoutError extends Error {
    timeoutMs;
    constructor(message, timeoutMs) {
        super(message);
        this.name = 'TimeoutError';
        this.timeoutMs = timeoutMs;
    }
}
exports.TimeoutError = TimeoutError;
/**
 * Races `work` against a real timer. The timer fires even while `work` is
 * still pending — this is what makes it an enforced timeout rather than a
 * between-steps check. Note: for synchronous blocking work (readFileSync on a
 * huge file) the timer still cannot preempt the blocked event loop, which is
 * why file reads were also moved to async I/O alongside this helper.
 */
function withTimeout(work, ms, label = 'operation') {
    if (!(ms > 0))
        return work;
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
            reject(new TimeoutError(`${label} timed out after ${ms}ms`, ms));
        }, ms);
        // Never keep the process alive just for a timeout handle.
        if (typeof timer.unref === 'function') {
            timer.unref();
        }
    });
    return Promise.race([work, timeout]).finally(() => {
        if (timer)
            clearTimeout(timer);
    });
}
/**
 * fetch() with an AbortController deadline. Aborting the request is what
 * unblocks a hung socket — a Promise.race alone would leave the socket open.
 */
async function fetchWithTimeout(input, init = {}) {
    const { timeoutMs = exports.LLM_FETCH_TIMEOUT_MS, ...rest } = init;
    const controller = new AbortController();
    const incoming = rest.signal;
    // If the caller already passed a signal, propagate its abort.
    if (incoming) {
        if (incoming.aborted)
            controller.abort();
        else
            incoming.addEventListener('abort', () => controller.abort(), { once: true });
    }
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    if (typeof timer.unref === 'function') {
        timer.unref();
    }
    try {
        return await fetch(input, { ...rest, signal: controller.signal });
    }
    catch (err) {
        if (controller.signal.aborted && !incoming?.aborted) {
            throw new TimeoutError(`Request timed out after ${timeoutMs}ms: ${typeof input === 'string' ? input : String(input)}`, timeoutMs);
        }
        throw err;
    }
    finally {
        clearTimeout(timer);
    }
}
