"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.createCloudSttEngine = createCloudSttEngine;
const pcmWav_1 = require("../pcmWav");
const cloudUtils_1 = require("./cloudUtils");
const timeouts_1 = require("../../utils/timeouts");
const STT_SAMPLE_RATE = 16_000;
function createCloudSttEngine(config, deps) {
    return {
        id: config.id,
        async transcribe(pcm) {
            try {
                const wav = (0, pcmWav_1.encodePcm16Wav)(pcm, STT_SAMPLE_RATE);
                const form = new FormData();
                form.append('file', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), 'audio.wav');
                form.append('model', config.model);
                const res = await (0, timeouts_1.fetchWithTimeout)((0, cloudUtils_1.appendV1Url)(config.baseUrl, '/audio/transcriptions'), {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${config.apiKey}` },
                    body: form,
                    timeoutMs: timeouts_1.CLOUD_VOICE_TIMEOUT_MS,
                });
                if (!res.ok) {
                    throw new Error(await (0, cloudUtils_1.describeHttpError)(res, config.displayName));
                }
                const json = (await res.json().catch(() => null));
                const text = typeof json?.text === 'string' ? json.text.trim() : '';
                if (text.length === 0) {
                    throw new Error(`${config.displayName} returned an empty transcription.`);
                }
                return text;
            }
            catch (err) {
                const reason = err instanceof Error ? err.message : String(err);
                deps.onFallback(`Cloud STT (${config.displayName}) failed (${reason}). Falling back to the local Whisper engine.`);
                return deps.fallback(pcm);
            }
        },
    };
}
