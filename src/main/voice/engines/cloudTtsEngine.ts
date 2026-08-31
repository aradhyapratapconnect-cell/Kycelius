/**
 * Cloud text-to-speech engine (N-08).
 *
 * A configured + enabled `custom_tts` provider (schema `cloud_tts`, OpenAI's
 * `/v1/audio/speech` shape) is used instead of the local Kokoro engine
 * whenever it's the active speech provider. The response is requested as WAV
 * and decoded in memory; the actual sample rate reported by the endpoint is
 * passed through so playback pitch/time is never distorted. On any failure
 * the ttsService falls back to the local Kokoro/OS chain (never silent).
 */

import { decodeWav } from '../pcmWav';
import type { TtsEngine } from './kokoroTtsEngine';
import { appendV1Url, describeHttpError, readJson } from './cloudUtils';

export interface CloudTtsConfig {
  id: string;
  displayName: string;
  baseUrl: string;
  apiKey: string;
  /** Model id (or named voice) the endpoint should synthesize with. */
  model: string;
}

export interface CloudTtsEngine extends TtsEngine {
  /** Sample rate of the PCM returned by synthesize(). */
  readonly sampleRate: number;
}

export function createCloudTtsEngine(config: CloudTtsConfig): CloudTtsEngine {
  let lastSampleRate = 24_000;

  return {
    id: `cloud-tts-${config.id}`,

    get sampleRate() {
      return lastSampleRate;
    },

    async synthesize(text: string): Promise<Float32Array> {
      const res = await fetch(appendV1Url(config.baseUrl, '/audio/speech'), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: config.model,
          input: text,
          response_format: 'wav',
        }),
      });

      if (!res.ok) {
        throw new Error(await describeHttpError(res, config.displayName));
      }

      const buf = Buffer.from(await res.arrayBuffer());
      const decoded = decodeWav(buf);
      if (decoded.pcm.length === 0) {
        throw new Error(`${config.displayName} returned a silent audio clip.`);
      }
      lastSampleRate = decoded.sampleRate;
      return decoded.pcm;
    },
  };
}

/** Fetch the `/v1/models` list so the Settings picker can offer voice names. */
export async function listCloudVoiceModels(
  config: Omit<CloudTtsConfig, 'id' | 'model'>
): Promise<string[]> {
  try {
    const res = await fetch(appendV1Url(config.baseUrl, '/models'), {
      headers: { Authorization: `Bearer ${config.apiKey}` },
    });
    if (!res.ok) return [];
    const json = await readJson<{ data?: Array<{ id: string }> }>(res, config.displayName);
    return Array.isArray(json.data) ? json.data.map(d => d.id).slice(0, 500) : [];
  } catch {
    return [];
  }
}