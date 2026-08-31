"use strict";
/**
 * Shared helpers for the cloud voice engines (N-08).
 *
 * Both cloud STT and cloud TTS speak OpenAI's audio API shape: the endpoint
 * is `<base>/v1/audio/...`. Users can paste a base URL either with a trailing
 * `/v1` (standard) or without it (host root), so the engines normalize it.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.appendV1Url = appendV1Url;
exports.describeHttpError = describeHttpError;
exports.readJson = readJson;
/**
 * Joins an OpenAI-shaped audio path onto a base URL, tolerating a base that
 * already ends in `/v1` (e.g. `https://api.openai.com/v1`).
 */
function appendV1Url(baseUrl, path) {
    const base = baseUrl.replace(/\/+$/, '');
    return base.endsWith('/v1') ? `${base}${path}` : `${base}/v1${path}`;
}
/**
 * Turns a failed HTTP response into a human-readable error, reusing the same
 * tone as the LLM provider errors so Settings copy stays actionable.
 */
async function describeHttpError(res, label) {
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
    }
    catch {
        body = '';
    }
    return `${label} returned HTTP ${status}${body ? `: ${body}` : ''}.`;
}
/** Reads the JSON body and throws a clean error when it isn't parseable. */
async function readJson(res, label) {
    try {
        return (await res.json());
    }
    catch {
        throw new Error(`${label} returned an unparseable response.`);
    }
}
