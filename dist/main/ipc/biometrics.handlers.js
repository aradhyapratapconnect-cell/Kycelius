"use strict";
// Voice biometrics IPC surface (F-10).
//
// Owns the production wiring for speaker verification: the local ECAPA-TDNN
// ONNX embedder and a safeStorage-encrypted voiceprint stored in the
// voice_profiles table. Only the encrypted numeric embedding ever touches
// disk — enrollment audio stays in memory for the lifetime of the request.
Object.defineProperty(exports, "__esModule", { value: true });
exports.SPEAKER_THRESHOLD_KEY = exports.BIOMETRICS_ENABLED_KEY = void 0;
exports.isBiometricsEnabled = isBiometricsEnabled;
exports.setBiometricsEnabled = setBiometricsEnabled;
exports.getSpeakerThreshold = getSpeakerThreshold;
exports.setSpeakerThreshold = setSpeakerThreshold;
exports.registerBiometricsHandlers = registerBiometricsHandlers;
const electron_1 = require("electron");
const db_1 = require("../db/db");
const ecapaOnnxEmbedder_1 = require("../voice/engines/ecapaOnnxEmbedder");
const speakerVerificationService_1 = require("../voice/speakerVerificationService");
exports.BIOMETRICS_ENABLED_KEY = 'voice_biometrics_enabled';
exports.SPEAKER_THRESHOLD_KEY = 'speaker_threshold';
const PRIMARY_LABEL = 'primary user';
function isBiometricsEnabled() {
    return db_1.userConfig.get(exports.BIOMETRICS_ENABLED_KEY) === 'true';
}
/** Persists the toggle and flips verification immediately — no restart needed. */
function setBiometricsEnabled(enabled) {
    db_1.userConfig.set(exports.BIOMETRICS_ENABLED_KEY, enabled ? 'true' : 'false');
    speakerVerificationService_1.speakerVerificationService.setEnabled(enabled);
}
function getSpeakerThreshold() {
    const raw = Number(db_1.userConfig.get(exports.SPEAKER_THRESHOLD_KEY));
    return Number.isFinite(raw) && raw > 0 && raw <= 1 ? raw : undefined;
}
// The embedder resolves its model lazily, so a model added or changed in
// Settings takes effect on the next utterance without a restart.
const embedder = (0, ecapaOnnxEmbedder_1.createEcapaOnnxEmbedder)(() => (0, ecapaOnnxEmbedder_1.resolveSpeakerModelConfig)(key => db_1.userConfig.get(key)));
const verificationDeps = {
    embed: pcm => embedder.embed(pcm),
    repository: {
        hasPrimary: () => db_1.voiceProfiles.getAll().length > 0,
        getPrimaryBlob: () => db_1.voiceProfiles.getAll()[0]?.embedding ?? null,
        replace: (_label, encryptedVoiceprint) => {
            db_1.voiceProfiles.deleteAll();
            db_1.voiceProfiles.create(PRIMARY_LABEL, encryptedVoiceprint);
        },
        removeAll: () => db_1.voiceProfiles.deleteAll(),
    },
    crypto: {
        encrypt: plainText => electron_1.safeStorage.encryptString(plainText),
        decrypt: blob => electron_1.safeStorage.decryptString(blob),
    },
};
function applySpeakerThreshold() {
    speakerVerificationService_1.speakerVerificationService.configure(verificationDeps, {
        threshold: getSpeakerThreshold(),
    });
}
/** Persists a new similarity threshold and applies it to the live service. */
function setSpeakerThreshold(value) {
    const num = Number(value);
    if (!Number.isFinite(num) || num <= 0 || num > 1)
        return;
    db_1.userConfig.set(exports.SPEAKER_THRESHOLD_KEY, String(num));
    applySpeakerThreshold();
}
function registerBiometricsHandlers() {
    applySpeakerThreshold();
    speakerVerificationService_1.speakerVerificationService.setEnabled(isBiometricsEnabled());
    electron_1.ipcMain.handle('kyclius:enroll-voice', async (_event, samples) => {
        if (!Array.isArray(samples) || samples.length === 0) {
            return { ok: false, error: 'No enrollment audio was received.' };
        }
        try {
            const phrases = samples.map(sample => new Float32Array(sample));
            return await speakerVerificationService_1.speakerVerificationService.enroll(phrases);
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { ok: false, error: `Enrollment failed: ${message}` };
        }
    });
    electron_1.ipcMain.handle('kyclius:remove-voice-enrollment', async () => {
        speakerVerificationService_1.speakerVerificationService.removeEnrollment();
        return { ok: true };
    });
    electron_1.ipcMain.handle('kyclius:get-biometrics-status', async () => {
        const profiles = db_1.voiceProfiles.getAll();
        return {
            enabled: isBiometricsEnabled(),
            enrolled: profiles.length > 0,
            // T-19: surface the enrollment date so the UI can show "enrolled on <date>".
            enrolledAt: profiles[0]?.enrolled_at ?? undefined,
        };
    });
    electron_1.ipcMain.handle('kyclius:set-biometrics-enabled', async (_event, enabled) => {
        setBiometricsEnabled(enabled === true);
        return { enabled: enabled === true };
    });
}
