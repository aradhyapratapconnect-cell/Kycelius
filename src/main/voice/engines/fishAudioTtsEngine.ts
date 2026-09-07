/**
 * Fish Audio cloud TTS engine (BYOK, fish.audio).
 *
 * The user picks "Fish Audio" in Settings > Text-to-Speech and pastes their
 * own API key (stored encrypted, like every other provider). Synthesis posts
 * the assistant's reply text and plays the returned audio through the existing
 * `speakViaEngine` WAV playback path.
 *
 * API contract (Fish Audio docs):
 *   POST {baseUrl}/v1/tts
 *   Headers: Authorization: Bearer <key>, Content-Type: application/json,
 *            model: s2.1-pro
 *   Body: { text, format: 'wav', normalize: true, reference_id? }
 *   Response: WAV bytes (16-bit mono), decoded by the shared WAV decoder so
 *   the real sample rate is passed through to playback.
 *
 * `reference_id` (a cloned voice) is optional — when the row's Model / Voice
 * ID field is empty it is omitted and Fish Audio uses its default voice.
 */

import { decodeWav } from '../pcmWav';
import { fetchWithTimeout, CLOUD_VOICE_TIMEOUT_MS } from '../../utils/timeouts';
import { describeHttpError } from './cloudUtils';
import type { TtsEngine } from './kokoroTtsEngine';

export const FISHAUDIO_PRESET_KEY = 'fishaudio_tts';

/** Production TTS model sent in the `model` header (the API default). */
const FISHAUDIO_MODEL = 's2.1-pro';

export interface FishAudioTtsConfig {
  id: string;
  displayName: string;
  baseUrl: string;
  apiKey: string;
  /** Optional cloned-voice reference id; empty means the default voice. */
  referenceId: string;
}

export function fishAudioTtsUrl(baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  return base.endsWith('/v1') ? `${base}/tts` : `${base}/v1/tts`;
}

export function createFishAudioTtsEngine(config: FishAudioTtsConfig): TtsEngine {
  const label = config.displayName || 'Fish Audio';
  let lastSampleRate = 44_100;
  return {
    id: `cloud-tts-${config.id}`,

    get sampleRate() {
      return lastSampleRate;
    },

    async synthesize(text: string): Promise<Float32Array> {
      const referenceId = config.referenceId.trim();
      const res = await fetchWithTimeout(fishAudioTtsUrl(config.baseUrl), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
          model: FISHAUDIO_MODEL,
        },
        body: JSON.stringify({
          text,
          format: 'wav',
          normalize: true,
          ...(referenceId ? { reference_id: referenceId } : {}),
        }),
        timeoutMs: CLOUD_VOICE_TIMEOUT_MS,
      });

      if (!res.ok) {
        throw new Error(await describeHttpError(res, label));
      }

      const contentType = res.headers.get('content-type') ?? '';
      const buf = Buffer.from(await res.arrayBuffer());
      if (contentType.includes('application/json')) {
        let detail = '';
        try {
          const parsed = JSON.parse(buf.toString('utf8')) as { message?: unknown };
          detail = typeof parsed.message === 'string' ? `: ${parsed.message}` : '';
        } catch {
          // fall through to the generic error below
        }
        throw new Error(`${label} returned an error instead of audio${detail}.`);
      }

      const decoded = decodeWav(buf);
      if (decoded.pcm.length === 0) {
        throw new Error(`${label} returned a silent audio clip.`);
      }
      lastSampleRate = decoded.sampleRate;
      return decoded.pcm;
    },
  };
}
