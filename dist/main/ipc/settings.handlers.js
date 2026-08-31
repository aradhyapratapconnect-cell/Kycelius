"use strict";
/**
 * General settings IPC. The renderer-facing UserSettings shape deliberately
 * carries no API keys — keys are write-only from the UI and only ever read
 * back as a boolean via has-llm-api-key (Security doc §8).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerSettingsHandlers = registerSettingsHandlers;
const electron_1 = require("electron");
const db_1 = require("../db/db");
const llmRouter_1 = require("../llm/llmRouter");
const providerConfig_1 = require("../llm/providerConfig");
const autonomous_handlers_1 = require("./autonomous.handlers");
const voice_handlers_1 = require("./voice.handlers");
const wakeWordService_1 = require("../voice/wakeWordService");
const biometrics_handlers_1 = require("./biometrics.handlers");
const settingsKeys_1 = require("../config/settingsKeys");
// S-01: first-run onboarding gate. Absent or falsy means onboarding still needs
// to run; set to "1" when the flow completes so it never appears again.
const ONBOARDING_COMPLETE_KEY = 'onboarding_complete';
// Only these URLs may ever be opened in the system browser — the renderer
// cannot ask for an arbitrary one (Security: no open-redirect surface).
const ALLOWED_EXTERNAL_URLS = new Set([
    'https://console.groq.com/keys',
    'https://openrouter.ai/settings/keys',
]);
// Whisper model metadata keys that are plain string settings we just persist.
const WHISPER_PATH_KEYS = [
    'whisper_binary_path',
    'whisper_model_path',
    'whisper_language',
    'whisper_initial_prompt',
];
const KOKORO_PATH_KEYS = [
    'kokoro_tts_model_path',
    'kokoro_tts_voice_path',
    'kokoro_tts_tokenizer_path',
];
function persistStringSetting(key, value) {
    // undefined clears the override (rendered input emptied → auto-download resumes)
    if (value === undefined) {
        db_1.userConfig.delete(key);
        return;
    }
    if (typeof value !== 'string')
        return;
    const trimmed = value.trim();
    if (trimmed.length === 0) {
        db_1.userConfig.delete(key);
    }
    else {
        db_1.userConfig.set(key, trimmed);
    }
}
function registerSettingsHandlers() {
    electron_1.ipcMain.handle('kyclius:get-settings', async () => {
        await llmRouter_1.llmRouter.initialize();
        return {
            llmProvider: llmRouter_1.llmRouter.getActiveProviderName(),
            wakeWord: (0, voice_handlers_1.getStoredWakePhrase)(),
            backgroundListeningEnabled: db_1.userConfig.get(voice_handlers_1.WAKE_ENABLED_KEY) === 'true',
            voiceConfirmationEnabled: (0, settingsKeys_1.isVoiceConfirmationEnabled)(),
            voiceBiometricsEnabled: (0, biometrics_handlers_1.isBiometricsEnabled)(),
            autonomousModeEnabled: db_1.autonomousModeConfig.get().enabled,
            // T-07: Kokoro manual overrides (read back so the panel can show state)
            kokoro_tts_model_path: db_1.userConfig.get('kokoro_tts_model_path') || undefined,
            kokoro_tts_voice_path: db_1.userConfig.get('kokoro_tts_voice_path') || undefined,
            kokoro_tts_tokenizer_path: db_1.userConfig.get('kokoro_tts_tokenizer_path') || undefined,
            // F-07: STT engine + whisper settings
            sttEngine: db_1.userConfig.get(voice_handlers_1.STT_ENGINE_KEY) || 'whisper',
            whisper_model: db_1.userConfig.get('whisper_model'),
            whisper_binary_path: db_1.userConfig.get('whisper_binary_path') || undefined,
            whisper_model_path: db_1.userConfig.get('whisper_model_path') || undefined,
            whisper_language: db_1.userConfig.get('whisper_language') || undefined,
            whisper_initial_prompt: db_1.userConfig.get('whisper_initial_prompt') || undefined,
            // F-10: speaker verification
            speaker_model_path: db_1.userConfig.get('speaker_model_path') || undefined,
            speaker_threshold: (0, biometrics_handlers_1.getSpeakerThreshold)(),
            // F-09: neural VAD model
            vad_model_path: db_1.userConfig.get('vad_model_path') || undefined,
        };
    });
    electron_1.ipcMain.handle('kyclius:update-settings', async (_event, settings) => {
        if (!settings || typeof settings !== 'object')
            return;
        if (typeof settings.llmProvider === 'string' &&
            (0, providerConfig_1.isProviderId)(settings.llmProvider)) {
            llmRouter_1.llmRouter.setActiveProvider(settings.llmProvider);
        }
        if (typeof settings.wakeWord === 'string') {
            const trimmed = settings.wakeWord.trim();
            const validation = (0, wakeWordService_1.validateWakePhrase)(trimmed);
            if (validation.ok) {
                db_1.userConfig.set(voice_handlers_1.WAKE_PHRASE_KEY, trimmed);
            }
        }
        if (typeof settings.backgroundListeningEnabled === 'boolean') {
            (0, voice_handlers_1.setBackgroundListening)(settings.backgroundListeningEnabled);
        }
        if (typeof settings.voiceConfirmationEnabled === 'boolean') {
            (0, settingsKeys_1.setVoiceConfirmationEnabled)(settings.voiceConfirmationEnabled);
        }
        if (typeof settings.voiceBiometricsEnabled === 'boolean') {
            (0, biometrics_handlers_1.setBiometricsEnabled)(settings.voiceBiometricsEnabled);
        }
        if (typeof settings.autonomousModeEnabled === 'boolean') {
            db_1.autonomousModeConfig.set({ enabled: settings.autonomousModeEnabled });
            // T-20: keep the composer badge + any open Settings panel live.
            (0, autonomous_handlers_1.broadcastAutonomousModeChange)();
        }
        // T-07: Kokoro manual TTS overrides
        for (const key of KOKORO_PATH_KEYS) {
            if (key in settings)
                persistStringSetting(key, settings[key]);
        }
        // F-07: STT engine + whisper model/paths
        if (settings.sttEngine === 'whisper' || settings.sttEngine === 'system') {
            db_1.userConfig.set(voice_handlers_1.STT_ENGINE_KEY, settings.sttEngine);
        }
        if (settings.whisper_model === 'large-v3-turbo' ||
            settings.whisper_model === 'small') {
            db_1.userConfig.set('whisper_model', settings.whisper_model);
        }
        for (const key of WHISPER_PATH_KEYS) {
            if (key in settings)
                persistStringSetting(key, settings[key]);
        }
        // F-10: speaker model + threshold
        if ('speaker_model_path' in settings) {
            persistStringSetting('speaker_model_path', settings.speaker_model_path);
        }
        if (typeof settings.speaker_threshold === 'number') {
            (0, biometrics_handlers_1.setSpeakerThreshold)(settings.speaker_threshold);
        }
        // F-09: neural VAD model
        if ('vad_model_path' in settings) {
            persistStringSetting('vad_model_path', settings.vad_model_path);
        }
    });
    // S-01: first-run onboarding state.
    electron_1.ipcMain.handle('kyclius:get-onboarding-complete', async () => {
        return db_1.userConfig.get(ONBOARDING_COMPLETE_KEY) === '1';
    });
    electron_1.ipcMain.handle('kyclius:set-onboarding-complete', async () => {
        db_1.userConfig.set(ONBOARDING_COMPLETE_KEY, '1');
    });
    electron_1.ipcMain.handle('kyclius:open-external-url', async (_event, url) => {
        if (typeof url !== 'string' || !ALLOWED_EXTERNAL_URLS.has(url)) {
            throw new Error(`URL is not on the allowlist: ${String(url)}`);
        }
        await electron_1.shell.openExternal(url);
    });
}
