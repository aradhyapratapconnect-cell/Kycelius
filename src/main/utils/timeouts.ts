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

/** Wall-clock ceilings. Kept in one place so the audit is reviewable. */
export const LLM_STREAM_TIMEOUT_MS = 90_000;
export const LLM_FETCH_TIMEOUT_MS = 60_000;
export const CLOUD_VOICE_TIMEOUT_MS = 30_000;
export const MODEL_DOWNLOAD_TIMEOUT_MS = 120_000;
export const WHISPER_SPAWN_TIMEOUT_MS = 60_000;
export const TTS_SPAWN_TIMEOUT_MS = 60_000;
export const TURN_TIMEOUT_MS = 120_000;
export const TOOL_STEP_TIMEOUT_MS = 30_000;
export const FILE_READ_TIMEOUT_MS = 15_000;

export class TimeoutError extends Error {
  readonly timeoutMs: number;
  constructor(message: string, timeoutMs: number) {
    super(message);
    this.name = 'TimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Races `work` against a real timer. The timer fires even while `work` is
 * still pending — this is what makes it an enforced timeout rather than a
 * between-steps check. Note: for synchronous blocking work (readFileSync on a
 * huge file) the timer still cannot preempt the blocked event loop, which is
 * why file reads were also moved to async I/O alongside this helper.
 */
export function withTimeout<T>(work: Promise<T>, ms: number, label = 'operation'): Promise<T> {
  if (!(ms > 0)) return work;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new TimeoutError(`${label} timed out after ${ms}ms`, ms));
    }, ms);
    // Never keep the process alive just for a timeout handle.
    if (typeof (timer as unknown as { unref?: () => void }).unref === 'function') {
      (timer as unknown as { unref: () => void }).unref();
    }
  });
  return Promise.race([work, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  }) as Promise<T>;
}

export interface FetchWithTimeoutOptions extends RequestInit {
  timeoutMs?: number;
}

/**
 * fetch() with an AbortController deadline. Aborting the request is what
 * unblocks a hung socket — a Promise.race alone would leave the socket open.
 */
export async function fetchWithTimeout(
  input: string | URL | Request,
  init: FetchWithTimeoutOptions = {}
): Promise<Response> {
  const { timeoutMs = LLM_FETCH_TIMEOUT_MS, ...rest } = init;
  const controller = new AbortController();
  const incoming = rest.signal;
  // If the caller already passed a signal, propagate its abort.
  if (incoming) {
    if (incoming.aborted) controller.abort();
    else incoming.addEventListener('abort', () => controller.abort(), { once: true });
  }
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (typeof (timer as unknown as { unref?: () => void }).unref === 'function') {
    (timer as unknown as { unref: () => void }).unref();
  }
  try {
    return await fetch(input, { ...rest, signal: controller.signal });
  } catch (err) {
    if (controller.signal.aborted && !incoming?.aborted) {
      throw new TimeoutError(
        `Request timed out after ${timeoutMs}ms: ${typeof input === 'string' ? input : String(input)}`,
        timeoutMs
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
