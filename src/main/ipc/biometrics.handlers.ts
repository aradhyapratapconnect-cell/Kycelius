// Voice biometrics IPC surface (F-10).
//
// Owns the production wiring for speaker verification: the local ECAPA-TDNN
// ONNX embedder and a safeStorage-encrypted voiceprint stored in the
// voice_profiles table. Only the encrypted numeric embedding ever touches
// disk — enrollment audio stays in memory for the lifetime of the request.

import { ipcMain, safeStorage } from 'electron';
import { userConfig, voiceProfiles } from '../db/db';
import {
  createEcapaOnnxEmbedder,
  resolveSpeakerModelConfig,
} from '../voice/engines/ecapaOnnxEmbedder';
import {
  speakerVerificationService,
  type SpeakerVerificationDeps,
} from '../voice/speakerVerificationService';

export const BIOMETRICS_ENABLED_KEY = 'voice_biometrics_enabled';
export const SPEAKER_THRESHOLD_KEY = 'speaker_threshold';

const PRIMARY_LABEL = 'primary user';

export function isBiometricsEnabled(): boolean {
  return userConfig.get(BIOMETRICS_ENABLED_KEY) === 'true';
}

/** Persists the toggle and flips verification immediately — no restart needed. */
export function setBiometricsEnabled(enabled: boolean): void {
  userConfig.set(BIOMETRICS_ENABLED_KEY, enabled ? 'true' : 'false');
  speakerVerificationService.setEnabled(enabled);
}

export function getSpeakerThreshold(): number | undefined {
  const raw = Number(userConfig.get(SPEAKER_THRESHOLD_KEY));
  return Number.isFinite(raw) && raw > 0 && raw <= 1 ? raw : undefined;
}

// The embedder resolves its model lazily, so a model added or changed in
// Settings takes effect on the next utterance without a restart.
const embedder = createEcapaOnnxEmbedder(() =>
  resolveSpeakerModelConfig(key => userConfig.get(key))
);

const verificationDeps: SpeakerVerificationDeps = {
  embed: pcm => embedder.embed(pcm),
  repository: {
    hasPrimary: () => voiceProfiles.getAll().length > 0,
    getPrimaryBlob: () => voiceProfiles.getAll()[0]?.embedding ?? null,
    replace: (_label, encryptedVoiceprint) => {
      voiceProfiles.deleteAll();
      voiceProfiles.create(PRIMARY_LABEL, encryptedVoiceprint);
    },
    removeAll: () => voiceProfiles.deleteAll(),
  },
  crypto: {
    encrypt: plainText => safeStorage.encryptString(plainText),
    decrypt: blob => safeStorage.decryptString(blob),
  },
};

function applySpeakerThreshold(): void {
  speakerVerificationService.configure(verificationDeps, {
    threshold: getSpeakerThreshold(),
  });
}

/** Persists a new similarity threshold and applies it to the live service. */
export function setSpeakerThreshold(value: unknown): void {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0 || num > 1) return;
  userConfig.set(SPEAKER_THRESHOLD_KEY, String(num));
  applySpeakerThreshold();
}

export function registerBiometricsHandlers(): void {
  applySpeakerThreshold();
  speakerVerificationService.setEnabled(isBiometricsEnabled());

  ipcMain.handle('kyclius:enroll-voice', async (_event, samples: unknown) => {
    if (!Array.isArray(samples) || samples.length === 0) {
      return { ok: false, error: 'No enrollment audio was received.' };
    }
    try {
      const phrases = samples.map(sample => new Float32Array(sample as ArrayBuffer));
      return await speakerVerificationService.enroll(phrases);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: `Enrollment failed: ${message}` };
    }
  });

  ipcMain.handle('kyclius:remove-voice-enrollment', async () => {
    speakerVerificationService.removeEnrollment();
    return { ok: true };
  });

  ipcMain.handle('kyclius:get-biometrics-status', async () => {
    const profiles = voiceProfiles.getAll();
    return {
      enabled: isBiometricsEnabled(),
      enrolled: profiles.length > 0,
      // T-19: surface the enrollment date so the UI can show "enrolled on <date>".
      enrolledAt: profiles[0]?.enrolled_at ?? undefined,
    };
  });

  ipcMain.handle('kyclius:set-biometrics-enabled', async (_event, enabled: boolean) => {
    setBiometricsEnabled(enabled === true);
    return { enabled: enabled === true };
  });
}
