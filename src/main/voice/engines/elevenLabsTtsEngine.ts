/**
 * ElevenLabs cloud TTS engine (BYOK).
 *
 * The user picks "ElevenLabs" in Settings > Text-to-Speech and pastes their
 * own API key (stored encrypted, like every other provider). Synthesis posts
 * the assistant's reply text and plays the returned audio through the existing
 * `speakViaEngine` WAV playback path.
 *
 * API contract (ElevenLabs docs):
 *   POST {baseUrl}/text-to-speech/{voice_id}?output_format=pcm_16000
 *   Headers: xi-api-key, Content-Type: application/json
 *   Body: { text, model_id }
 *   Response: raw s16le PCM, mono, 16 kHz (no container to decode).
 *
 * `pcm_16000` is available on every tier and needs no post-decode step, so a
 * missing mp3 decoder can never break this path.
 */

import { fetchWithTimeout, CLOUD_VOICE_TIMEOUT_MS } from '../../utils/timeouts';
import { describeHttpError } from './cloudUtils';
import type { TtsEngine } from './kokoroTtsEngine';

export const ELEVENLABS_PRESET_KEY = 'elevenlabs_tts';

/** Rachel — ElevenLabs' documented default voice; the user can paste any voice ID. */
export const ELEVENLABS_DEFAULT_VOICE_ID = '21m00Tcm4TlvDq8ikWAM';

export const ELEVENLABS_SAMPLE_RATE = 16_000;

/** Model used for synthesis; multilingual v2 is also the API-side default. */
const ELEVENLABS_MODEL_ID = 'eleven_multilingual_v2';

export interface ElevenLabsTtsConfig {
  id: string;
  displayName: string;
  baseUrl: string;
  apiKey: string;
  /** Voice ID from elevenlabs.io/app/voices (path param, not a model name). */
  voiceId: string;
}

export function elevenLabsTtsUrl(baseUrl: string, voiceId: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/text-to-speech/${encodeURIComponent(voiceId)}?output_format=pcm_16000`;
}

/** Converts raw s16le mono PCM bytes to the Float32 PCM the playback path plays. */
export function decodePcm16Le(data: Buffer, label: string): Float32Array {
  if (data.length === 0 || data.length % 2 !== 0) {
    throw new Error(`${label} returned an unparseable audio clip.`);
  }
  const ints = new Int16Array(data.buffer, data.byteOffset, Math.floor(data.length / 2));
  const pcm = new Float32Array(ints.length);
  let peak = 0;
  for (let i = 0; i < ints.length; i++) {
    const sample = ints[i] / 32768;
    pcm[i] = sample;
    const abs = Math.abs(sample);
    if (abs > peak) peak = abs;
  }
  if (peak === 0) {
    throw new Error(`${label} returned a silent audio clip.`);
  }
  return pcm;
}

export function createElevenLabsTtsEngine(config: ElevenLabsTtsConfig): TtsEngine {
  const label = config.displayName || 'ElevenLabs';
  return {
    id: `cloud-tts-${config.id}`,

    get sampleRate() {
      return ELEVENLABS_SAMPLE_RATE;
    },

    async synthesize(text: string): Promise<Float32Array> {
      const voiceId = config.voiceId.trim();
      if (!voiceId) {
        throw new Error(`${label} needs a voice ID — paste one from ElevenLabs > Voices into the Model / Voice ID field in Settings.`);
      }
      const res = await fetchWithTimeout(elevenLabsTtsUrl(config.baseUrl, voiceId), {
        method: 'POST',
        headers: {
          'xi-api-key': config.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text,
          model_id: ELEVENLABS_MODEL_ID,
        }),
        timeoutMs: CLOUD_VOICE_TIMEOUT_MS,
      });

      if (!res.ok) {
        throw new Error(await describeHttpError(res, label));
      }

      return decodePcm16Le(Buffer.from(await res.arrayBuffer()), label);
    },
  };
}
