/**
 * Shared helpers for the cloud voice engines (N-08).
 *
 * Both cloud STT and cloud TTS speak OpenAI's audio API shape: the endpoint
 * is `<base>/v1/audio/...`. Users can paste a base URL either with a trailing
 * `/v1` (standard) or without it (host root), so the engines normalize it.
 */

/**
 * Joins an OpenAI-shaped audio path onto a base URL, tolerating a base that
 * already ends in `/v1` (e.g. `https://api.openai.com/v1`).
 */
export function appendV1Url(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  return base.endsWith('/v1') ? `${base}${path}` : `${base}/v1${path}`;
}

/**
 * Turns a failed HTTP response into a human-readable error, reusing the same
 * tone as the LLM provider errors so Settings copy stays actionable.
 */
export async function describeHttpError(
  res: Response,
  label: string
): Promise<string> {
  const status = res.status;

  if (status === 401 || status === 403) {
    return `${label} rejected the API key (HTTP ${status}). Check the key in Settings.`;
  }
  if (status === 404 || status === 405) {
    return `${label} returned HTTP ${status} — the base URL doesn't point at an audio endpoint. Check "Base URL" in Settings.`;
  }
  if (status === 429) {
    return `${label} is rate-limited right now (HTTP 429). Try again shortly.`;
  }
  if (status >= 500) {
    return `${label} had an error on their side (HTTP ${status}). Try again shortly.`;
  }

  let body = '';
  try {
    body = (await res.text()).trim().slice(0, 200);
  } catch {
    body = '';
  }
  return `${label} returned HTTP ${status}${body ? `: ${body}` : ''}.`;
}

/** Reads the JSON body and throws a clean error when it isn't parseable. */
export async function readJson<T>(res: Response, label: string): Promise<T> {
  try {
    return (await res.json()) as T;
  } catch {
    throw new Error(`${label} returned an unparseable response.`);
  }
}