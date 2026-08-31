/**
 * Cloud speech-to-text engine (N-08).
 *
 * A configured + enabled `custom_stt` provider (schema `cloud_stt`, OpenAI's
 * `/v1/audio/transcriptions` shape) is used instead of the local whisper
 * engine whenever it's the active speech provider. PCM audio is encoded to a
 * WAV strictly in memory and posted as multipart/form-data — nothing touches
 * disk. If the request fails for any reason, the engine transparently falls
 * back to the local engine it was given (per N-08): the user hears results,
 * never a dead/silent state, and a notice explains which engine answered.
 */

import { encodePcm16Wav } from '../pcmWav';
import type { SttEngine } from '../sttService';
import { appendV1Url, describeHttpError } from './cloudUtils';

const STT_SAMPLE_RATE = 16_000;

export interface CloudSttConfig {
  /** Engine id registered with sttService, e.g. `cloud-stt-<rowId>`. */
  id: string;
  displayName: string;
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface CloudSttDeps {
  /** Local engine that takes over when the cloud call fails (whisper.cpp). */
  fallback(pcm: Float32Array): Promise<string>;
  /** Broadcast a readable notice so the user knows cloud was skipped. */
  onFallback(message: string): void;
}

export function createCloudSttEngine(
  config: CloudSttConfig,
  deps: CloudSttDeps
): SttEngine {
  return {
    id: config.id,

    async transcribe(pcm: Float32Array): Promise<string> {
      try {
        const wav = encodePcm16Wav(pcm, STT_SAMPLE_RATE);

        const form = new FormData();
        form.append('file', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), 'audio.wav');
        form.append('model', config.model);

        const res = await fetch(
          appendV1Url(config.baseUrl, '/audio/transcriptions'),
          {
            method: 'POST',
            headers: { Authorization: `Bearer ${config.apiKey}` },
            body: form,
          }
        );

        if (!res.ok) {
          throw new Error(await describeHttpError(res, config.displayName));
        }

        const json = (await res.json().catch(() => null)) as { text?: unknown } | null;
        const text = typeof json?.text === 'string' ? json.text.trim() : '';
        if (text.length === 0) {
          throw new Error(`${config.displayName} returned an empty transcription.`);
        }
        return text;
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        deps.onFallback(
          `Cloud STT (${config.displayName}) failed (${reason}). Falling back to the local Whisper engine.`
        );
        return deps.fallback(pcm);
      }
    },
  };
}