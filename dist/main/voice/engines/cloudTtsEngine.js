"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ttsModelRequired = ttsModelRequired;
exports.createCloudTtsEngine = createCloudTtsEngine;
exports.listCloudVoiceModels = listCloudVoiceModels;
const pcmWav_1 = require("../pcmWav");
const cloudUtils_1 = require("./cloudUtils");
const timeouts_1 = require("../../utils/timeouts");
const fishAudioTtsEngine_1 = require("./fishAudioTtsEngine");
/**
 * Whether a TTS provider row needs a non-empty Model/Voice ID to resolve to
 * cloud. Fish Audio is the exception: its reference voice is optional and an
 * empty field means the default voice — still a usable cloud config. Every
 * other provider treats empty as "not configured" and stays local-first.
 * Pure so the resolution gate has direct unit coverage.
 */
function ttsModelRequired(presetKey) {
    return presetKey !== fishAudioTtsEngine_1.FISHAUDIO_PRESET_KEY;
}
function createCloudTtsEngine(config) {
    let lastSampleRate = 24_000;
    return {
        id: `cloud-tts-${config.id}`,
        get sampleRate() {
            return lastSampleRate;
        },
        async synthesize(text) {
            // EF-10: enforced timeout so a hung cloud TTS socket falls back locally.
            const res = await (0, timeouts_1.fetchWithTimeout)((0, cloudUtils_1.appendV1Url)(config.baseUrl, '/audio/speech'), {
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
                timeoutMs: timeouts_1.CLOUD_VOICE_TIMEOUT_MS,
            });
            if (!res.ok) {
                throw new Error(await (0, cloudUtils_1.describeHttpError)(res, config.displayName));
            }
            const buf = Buffer.from(await res.arrayBuffer());
            const decoded = (0, pcmWav_1.decodeWav)(buf);
            if (decoded.pcm.length === 0) {
                throw new Error(`${config.displayName} returned a silent audio clip.`);
            }
            lastSampleRate = decoded.sampleRate;
            return decoded.pcm;
        },
    };
}
/** Fetch the `/v1/models` list so the Settings picker can offer voice names. */
async function listCloudVoiceModels(config) {
    try {
        const res = await fetch((0, cloudUtils_1.appendV1Url)(config.baseUrl, '/models'), {
            headers: { Authorization: `Bearer ${config.apiKey}` },
        });
        if (!res.ok)
            return [];
        const json = await (0, cloudUtils_1.readJson)(res, config.displayName);
        return Array.isArray(json.data) ? json.data.map(d => d.id).slice(0, 500) : [];
    }
    catch {
        return [];
    }
}
