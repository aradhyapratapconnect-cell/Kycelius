/**
 * General settings IPC. The renderer-facing UserSettings shape deliberately
 * carries no API keys — keys are write-only from the UI and only ever read
 * back as a boolean via has-llm-api-key (Security doc §8).
 */

import { ipcMain, shell } from 'electron';
import { userConfig, autonomousModeConfig } from '../db/db';
import { llmRouter } from '../llm/llmRouter';
import { isProviderId } from '../llm/providerConfig';
import { broadcastAutonomousModeChange } from './autonomous.handlers';
import {
  setBackgroundListening,
  STT_ENGINE_KEY,
  WAKE_PHRASE_KEY,
  WAKE_ENABLED_KEY,
  getStoredWakePhrase,
} from './voice.handlers';
import { validateWakePhrase } from '../voice/wakeWordService';
import {
  isBiometricsEnabled,
  setBiometricsEnabled,
  getSpeakerThreshold,
  setSpeakerThreshold,
} from './biometrics.handlers';
import {
  setVoiceConfirmationEnabled,
  isVoiceConfirmationEnabled,
} from '../config/settingsKeys';
import type { SttEngineId } from '../voice/sttService';
import type { WhisperModelId } from '../voice/whisperModelDownloader';

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
] as const;

const KOKORO_PATH_KEYS = [
  'kokoro_tts_model_path',
  'kokoro_tts_voice_path',
  'kokoro_tts_tokenizer_path',
] as const;

function persistStringSetting(key: string, value: unknown): void {
  // undefined clears the override (rendered input emptied → auto-download resumes)
  if (value === undefined) {
    userConfig.delete(key);
    return;
  }
  if (typeof value !== 'string') return;
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    userConfig.delete(key);
  } else {
    userConfig.set(key, trimmed);
  }
}

export function registerSettingsHandlers() {
  ipcMain.handle('kyclius:get-settings', async () => {
    await llmRouter.initialize();
    return {
      llmProvider: llmRouter.getActiveProviderName(),
      wakeWord: getStoredWakePhrase(),
      backgroundListeningEnabled: userConfig.get(WAKE_ENABLED_KEY) === 'true',
      voiceConfirmationEnabled: isVoiceConfirmationEnabled(),
      voiceBiometricsEnabled: isBiometricsEnabled(),
      autonomousModeEnabled: autonomousModeConfig.get().enabled,
      // T-07: Kokoro manual overrides (read back so the panel can show state)
      kokoro_tts_model_path: userConfig.get('kokoro_tts_model_path') || undefined,
      kokoro_tts_voice_path: userConfig.get('kokoro_tts_voice_path') || undefined,
      kokoro_tts_tokenizer_path: userConfig.get('kokoro_tts_tokenizer_path') || undefined,
      // F-07: STT engine + whisper settings
      sttEngine: (userConfig.get(STT_ENGINE_KEY) as SttEngineId) || 'whisper',
      whisper_model: userConfig.get('whisper_model') as WhisperModelId | undefined,
      whisper_binary_path: userConfig.get('whisper_binary_path') || undefined,
      whisper_model_path: userConfig.get('whisper_model_path') || undefined,
      whisper_language: userConfig.get('whisper_language') || undefined,
      whisper_initial_prompt: userConfig.get('whisper_initial_prompt') || undefined,
      // F-10: speaker verification
      speaker_model_path: userConfig.get('speaker_model_path') || undefined,
      speaker_threshold: getSpeakerThreshold(),
      // F-09: neural VAD model
      vad_model_path: userConfig.get('vad_model_path') || undefined,
    };
  });

  ipcMain.handle(
    'kyclius:update-settings',
    async (_event, settings: Record<string, unknown>) => {
      if (!settings || typeof settings !== 'object') return;

      if (
        typeof settings.llmProvider === 'string' &&
        isProviderId(settings.llmProvider)
      ) {
        llmRouter.setActiveProvider(settings.llmProvider);
      }

      if (typeof settings.wakeWord === 'string') {
        const trimmed = settings.wakeWord.trim();
        const validation = validateWakePhrase(trimmed);
        if (validation.ok) {
          userConfig.set(WAKE_PHRASE_KEY, trimmed);
        }
      }

      if (typeof settings.backgroundListeningEnabled === 'boolean') {
        setBackgroundListening(settings.backgroundListeningEnabled);
      }

      if (typeof settings.voiceConfirmationEnabled === 'boolean') {
        setVoiceConfirmationEnabled(settings.voiceConfirmationEnabled);
      }

      if (typeof settings.voiceBiometricsEnabled === 'boolean') {
        setBiometricsEnabled(settings.voiceBiometricsEnabled);
      }

      if (typeof settings.autonomousModeEnabled === 'boolean') {
        autonomousModeConfig.set({ enabled: settings.autonomousModeEnabled });
        // T-20: keep the composer badge + any open Settings panel live.
        broadcastAutonomousModeChange();
      }

      // T-07: Kokoro manual TTS overrides
      for (const key of KOKORO_PATH_KEYS) {
        if (key in settings) persistStringSetting(key, settings[key]);
      }

      // F-07: STT engine + whisper model/paths
      if (settings.sttEngine === 'whisper' || settings.sttEngine === 'system') {
        userConfig.set(STT_ENGINE_KEY, settings.sttEngine);
      }
      if (
        settings.whisper_model === 'large-v3-turbo' ||
        settings.whisper_model === 'small'
      ) {
        userConfig.set('whisper_model', settings.whisper_model);
      }
      for (const key of WHISPER_PATH_KEYS) {
        if (key in settings) persistStringSetting(key, settings[key]);
      }

      // F-10: speaker model + threshold
      if ('speaker_model_path' in settings) {
        persistStringSetting('speaker_model_path', settings.speaker_model_path);
      }
      if (typeof settings.speaker_threshold === 'number') {
        setSpeakerThreshold(settings.speaker_threshold);
      }

      // F-09: neural VAD model
      if ('vad_model_path' in settings) {
        persistStringSetting('vad_model_path', settings.vad_model_path);
      }
    }
  );

  // S-01: first-run onboarding state.
  ipcMain.handle('kyclius:get-onboarding-complete', async (): Promise<boolean> => {
    return userConfig.get(ONBOARDING_COMPLETE_KEY) === '1';
  });

  ipcMain.handle('kyclius:set-onboarding-complete', async (): Promise<void> => {
    userConfig.set(ONBOARDING_COMPLETE_KEY, '1');
  });

  ipcMain.handle('kyclius:open-external-url', async (_event, url: string) => {
    if (typeof url !== 'string' || !ALLOWED_EXTERNAL_URLS.has(url)) {
      throw new Error(`URL is not on the allowlist: ${String(url)}`);
    }
    await shell.openExternal(url);
  });
}
