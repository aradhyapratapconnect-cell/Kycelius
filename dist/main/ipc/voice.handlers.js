"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WAKE_ENABLED_KEY = exports.WAKE_PHRASE_KEY = exports.STT_ENGINE_KEY = void 0;
exports.getStoredWakePhrase = getStoredWakePhrase;
exports.setBackgroundListening = setBackgroundListening;
exports.isWhisperReady = isWhisperReady;
exports.beginCommandListening = beginCommandListening;
exports.registerVoiceHandlers = registerVoiceHandlers;
exports.describeWhisperSetupProblem = describeWhisperSetupProblem;
const electron_1 = require("electron");
const fs_1 = require("fs");
const path_1 = require("path");
const sttService_1 = require("../voice/sttService");
const ttsService_1 = require("../voice/ttsService");
const whisperCppEngine_1 = require("../voice/engines/whisperCppEngine");
const cloudSttEngine_1 = require("../voice/engines/cloudSttEngine");
const providerRegistry_1 = require("../llm/providerRegistry");
const db_1 = require("../db/db");
const wakeWordService_1 = require("../voice/wakeWordService");
const transcriptBus_1 = require("../voice/transcriptBus");
const voiceConfirmationListener_1 = require("../voice/voiceConfirmationListener");
const permissionEngine_1 = require("../permissions/permissionEngine");
const confirmationQueue_1 = require("../permissions/confirmationQueue");
const tray_1 = require("../tray");
const speakerVerificationService_1 = require("../voice/speakerVerificationService");
const sileroVad_1 = require("../voice/vad/sileroVad");
const biometrics_handlers_1 = require("./biometrics.handlers");
const settingsKeys_1 = require("../config/settingsKeys");
const assistantState_1 = require("../assistantState");
const planner_1 = require("../agent/planner");
const whisperModelDownloader_1 = require("../voice/whisperModelDownloader");
const STT_ENGINE_KEY = 'stt_engine';
exports.STT_ENGINE_KEY = STT_ENGINE_KEY;
exports.WAKE_PHRASE_KEY = 'wake_phrase';
exports.WAKE_ENABLED_KEY = 'wake_word_enabled';
function broadcast(channel, ...payload) {
    for (const win of electron_1.BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) {
            win.webContents.send(channel, ...payload);
        }
    }
}
function getStoredWakePhrase() {
    return db_1.userConfig.get(exports.WAKE_PHRASE_KEY) ?? wakeWordService_1.DEFAULT_WAKE_PHRASE;
}
/**
 * While a voice-confirmation window is open, transcripts must reach the
 * confirmation listener but never leak to the renderer — otherwise whatever
 * the user says ("okay", "cancel") would also be submitted as a command by
 * the command bar.
 */
function isConfirmationWindowOpen() {
    return voiceConfirmationListener_1.voiceConfirmationListener.getWindowConfirmationId() !== null;
}
function publishForBus(text, isFinal) {
    (0, transcriptBus_1.publishTranscript)(text, isFinal);
    if (!isConfirmationWindowOpen()) {
        broadcast('kyclius:transcript', text, isFinal);
    }
}
/**
 * Base path for the packaged vendor/ tree. In a packaged build the asar is
 * unpacked at <resources>/app.asar.unpacked, so vendored binaries (which must
 * stay real files on disk for child_process.spawn) live there.
 */
function getVendorBase() {
    return electron_1.app.isPackaged
        ? (0, path_1.join)(process.resourcesPath, 'app.asar.unpacked')
        : electron_1.app.getAppPath();
}
/**
 * Resolves whisper.cpp settings, falling back to the runtime bundled under
 * vendor/ so local STT works out of the box; explicit Settings paths win.
 *
 * F-07 quality ladder for the model:
 *   1. an explicit whisper_model_path in Settings always wins;
 *   2. otherwise the WhisperModelId chosen under whisper_model (default
 *      large-v3-turbo) is used if its file has been downloaded to userData;
 *   3. the vendored ggml-base.en.bin is the last-resort offline fallback so
 *      STT decodes on first run even before any download finishes.
 */
function resolveWhisperSetting(key) {
    const stored = db_1.userConfig.get(key);
    if (stored)
        return stored;
    const base = getVendorBase();
    if (key === 'whisper_binary_path') {
        const exe = process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli';
        const candidate = (0, path_1.join)(base, 'vendor', 'whisper', 'bin', exe);
        if ((0, fs_1.existsSync)(candidate))
            return candidate;
    }
    if (key === 'whisper_model_path') {
        const modelId = db_1.userConfig.get('whisper_model');
        if (modelId === 'large-v3-turbo' || modelId === 'small') {
            const downloaded = (0, whisperModelDownloader_1.getWhisperModelLocalPath)(modelId);
            if (downloaded && (0, fs_1.existsSync)(downloaded))
                return downloaded;
        }
        const candidate = (0, path_1.join)(base, 'vendor', 'whisper', 'models', 'ggml-base.en.bin');
        if ((0, fs_1.existsSync)(candidate))
            return candidate;
    }
    return undefined;
}
function isBackgroundListeningEnabled() {
    return db_1.userConfig.get(exports.WAKE_ENABLED_KEY) === 'true';
}
/**
 * Starts (or stops) background wake-word listening: persists the setting,
 * flips the service immediately, and tells the renderer to start/stop its
 * ambient microphone stream. Used by both the IPC handler and the tray menu.
 */
function setBackgroundListening(enabled) {
    db_1.userConfig.set(exports.WAKE_ENABLED_KEY, enabled ? 'true' : 'false');
    wakeWordService_1.wakeWordService.setEnabled(enabled);
    broadcast(enabled ? 'kyclius:wake:start-ambient-capture' : 'kyclius:wake:stop-ambient-capture');
    (0, tray_1.updateTrayWakeState)(wakeWordService_1.wakeWordService.getState(), getStoredWakePhrase());
}
/**
 * Whether the whisper engine can actually run right now (binary + model both
 * resolvable on disk). EF-04 Symptom C: the local Whisper engine is the
 * preferred engine, but when it isn't configured/loaded the app must fall
 * back to the system engine rather than leave voice dead.
 */
async function isWhisperReady() {
    try {
        await (0, whisperCppEngine_1.resolveWhisperConfig)(resolveWhisperSetting);
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Resolves the engine a command-listening session should actually use,
 * applying the EF-04 automatic fallback: when the user selected `whisper`
 * but no whisper model/binary is usable, the session transparently falls
 * back to the `system` (Web Speech) engine.
 */
async function resolveEffectiveSttEngine() {
    const selected = sttService_1.sttService.getActiveEngine();
    if (selected === 'system')
        return { engine: 'system', fallback: false };
    if (await isWhisperReady())
        return { engine: 'whisper', fallback: false };
    // Whisper is selected but not usable — fall back to system and tell the user.
    sttService_1.sttService.setActiveEngine('system');
    return { engine: 'system', fallback: true };
}
// ---------------------------------------------------------------------------
// N-08: cloud STT/TTS resolution from the shared `providers` table.
// A provider is used when it's the active default FOR ITS CAPABILITY and it is
// enabled, has a stored key, a base URL, and a model/voice id. Anything less
// (unset, disabled, key removed, no model) means local-first — never silent.
// ---------------------------------------------------------------------------
function cloudConfigFor(capability) {
    const id = providerRegistry_1.providerRegistry.getDefaultProviderId(capability);
    if (!id)
        return null;
    const row = providerRegistry_1.providerRegistry.get(id);
    if (!row || !row.enabled || !row.hasKey || !row.baseUrl)
        return null;
    const model = providerRegistry_1.providerRegistry.getConfiguredModel(id);
    if (!model)
        return null;
    let apiKey;
    try {
        apiKey = providerRegistry_1.providerRegistry.getDecryptedApiKey(id);
    }
    catch {
        return null;
    }
    return {
        id: row.id,
        displayName: row.displayName,
        baseUrl: row.baseUrl,
        apiKey,
        model,
    };
}
function resolveCloudSttProvider() {
    return cloudConfigFor('stt');
}
function resolveCloudTtsProvider() {
    return cloudConfigFor('tts');
}
/**
 * Registers (or unregisters) the cloud-STT engine for the current config and
 * returns the engine id to point the session at, or null when local-only.
 * Re-run on every listening session so edits propagate immediately.
 */
let activateCloudStt = () => null;
/** Shared entry point for the normal command-listening flow (used by T-01 and the wake hand-off). */
async function beginCommandListening() {
    // N-08: a configured + enabled cloud STT provider that is the active default
    // takes over the session; otherwise the local whisper/system ladder applies.
    const cloudId = activateCloudStt();
    let engine = 'whisper';
    let fallback = false;
    if (cloudId) {
        sttService_1.sttService.setSessionEngine(cloudId);
        // Cloud STT consumes the same audio-chunk stream as whisper, so the
        // renderer must capture mic audio rather than fall to Web Speech.
        engine = 'whisper';
    }
    else {
        sttService_1.sttService.setSessionEngine(null);
        const resolved = await resolveEffectiveSttEngine();
        engine = resolved.engine;
        fallback = resolved.fallback;
    }
    if (fallback) {
        broadcast('kyclius:voice-engine-notice', {
            message: "Using your system's voice engine until the local Whisper model finishes downloading. You can switch engines in Settings.",
        });
    }
    const result = sttService_1.sttService.startSession();
    if (result.started) {
        (0, assistantState_1.broadcastAssistantState)('listening');
    }
    broadcast('kyclius:voice:start-capture', { engine });
    return { started: result.started, engine };
}
/**
 * F-10: the single choke point through which every final whisper-engine
 * utterance reaches the rest of the app. When biometrics are active it
 * verifies the speaker first; a failed check is never published, so BOTH
 * command issuance and spoken confirmations are gated at once.
 */
async function gateAndPublishTranscript(pcm, text) {
    // verify() bypasses instantly (matched:true) when disabled or unenrolled.
    const verdict = await speakerVerificationService_1.speakerVerificationService.verify(pcm);
    if (!verdict.matched) {
        broadcast('kyclius:voice-error', {
            code: 'speaker_unverified',
            message: "That voice isn't verified against your enrolled profile, so Kyclius ignored this request. Use your enrolled voice, or type your request in the command bar.",
        });
        return;
    }
    // F-11: a verified spoken "stop" cancels a running multi-step plan.
    if (/\bstop\b/i.test(text) && planner_1.planner.isPlanRunning()) {
        planner_1.planner.cancelActivePlan('Stopped by voice command.');
    }
    (0, transcriptBus_1.publishTranscript)(text, true);
    if (!isConfirmationWindowOpen()) {
        broadcast('kyclius:transcript', text, true);
    }
}
function focusMainWindow() {
    for (const win of electron_1.BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) {
            if (win.isMinimized())
                win.restore();
            win.show();
            win.focus();
        }
    }
}
function registerVoiceHandlers() {
    // F-07: wire the TTS service to read user settings so the Kokoro-82M
    // ONNX model path (if set) is picked up lazily on first speak().
    ttsService_1.ttsService.install(key => db_1.userConfig.get(key));
    const whisperEngine = (0, whisperCppEngine_1.createWhisperCppEngine)(() => (0, whisperCppEngine_1.resolveWhisperConfig)(resolveWhisperSetting));
    // N-08: cloud STT engine, swapped in per listening session. Its transcribe
    // falls back to local whisper.cpp on any cloud failure (per the ticket), so
    // a flaky provider degrades to the free local engine — never to silence.
    let lastCloudSttEngineId = null;
    activateCloudStt = () => {
        if (lastCloudSttEngineId) {
            sttService_1.sttService.unregisterEngine(lastCloudSttEngineId);
            lastCloudSttEngineId = null;
        }
        const config = resolveCloudSttProvider();
        if (!config)
            return null;
        const engineId = `cloud-stt-${config.id}`;
        sttService_1.sttService.registerEngine((0, cloudSttEngine_1.createCloudSttEngine)({ ...config, id: engineId }, {
            fallback: pcm => whisperEngine.transcribe(pcm),
            onFallback: message => broadcast('kyclius:voice-engine-notice', { message }),
        }));
        lastCloudSttEngineId = engineId;
        return engineId;
    };
    // N-08: cloud TTS engine, re-resolved per speak() so disabling/removing the
    // provider drops back to Kokoro/OS immediately. Failures surface a notice.
    ttsService_1.ttsService.installCloud(() => resolveCloudTtsProvider(), message => broadcast('kyclius:voice-engine-notice', { message }));
    sttService_1.sttService.configure({
        onTranscript: (text, isFinal) => {
            publishForBus(text, isFinal);
        },
        // F-10: final utterances route through the biometric gate (a no-op pass-
        // through while biometrics are off or unenrolled). onTranscript remains
        // as the ungated fallback for callers that don't install the hook.
        onUtteranceFinalized: (pcm, text) => {
            gateAndPublishTranscript(pcm, text).catch(err => {
                const message = err instanceof Error ? err.message : String(err);
                broadcast('kyclius:voice-error', {
                    code: 'speaker_unverified',
                    message,
                });
            });
        },
        onVoiceError: error => {
            broadcast('kyclius:voice-error', error);
            // EF-04: an unrecoverable session error (no speech detected, engine
            // unavailable) must also release the renderer's mic and reset state —
            // otherwise the user is left in a hung "listening" state with no way out.
            if (error.code === 'no_speech_detected' || error.code === 'stt_engine_unavailable') {
                broadcast('kyclius:voice:stop-capture');
                (0, assistantState_1.broadcastAssistantState)('idle');
                if (wakeWordService_1.wakeWordService.isEnabled()) {
                    broadcast('kyclius:wake:start-ambient-capture');
                }
            }
            else {
                (0, assistantState_1.broadcastAssistantState)('error');
            }
        },
    });
    sttService_1.sttService.registerEngine(whisperEngine);
    // STT upgrade step 1a: prefer the neural Silero VAD for speech/silence
    // decisions when the user has supplied its ONNX model in Settings; the
    // service degrades to volume-based detection on its own if it can't load.
    sttService_1.sttService.setSpeechDetector((0, sileroVad_1.createSileroVad)(() => (0, sileroVad_1.resolveSileroVadConfig)(key => db_1.userConfig.get(key))));
    const storedEngine = db_1.userConfig.get(STT_ENGINE_KEY);
    if (storedEngine === 'whisper' || storedEngine === 'system') {
        sttService_1.sttService.setActiveEngine(storedEngine);
    }
    // F-09: configure the wake word service against the same local whisper engine.
    // Detection runs entirely in-memory; only transcripts are inspected.
    wakeWordService_1.wakeWordService.configure({
        getPhrase: getStoredWakePhrase,
        transcribe: pcm => whisperEngine.transcribe(pcm),
        onWakeDetected: transcript => {
            broadcast('kyclius:wake-detected', transcript);
            focusMainWindow();
            void ttsService_1.ttsService.speak('How can I help you?').catch(() => { });
            beginCommandListening();
        },
        onStateChanged: state => {
            broadcast('kyclius:wake-state-changed', state);
            (0, tray_1.updateTrayWakeState)(state, getStoredWakePhrase());
        },
        onError: error => broadcast('kyclius:wake-error', error),
        isCommandSessionActive: () => sttService_1.sttService.isSessionActive(),
        isSpeaking: () => ttsService_1.ttsService.isSpeaking(),
    });
    if (isBackgroundListeningEnabled()) {
        wakeWordService_1.wakeWordService.setEnabled(true);
    }
    electron_1.ipcMain.handle('kyclius:start-listening', async () => {
        return beginCommandListening();
    });
    electron_1.ipcMain.handle('kyclius:stop-listening', async () => {
        broadcast('kyclius:voice:stop-capture');
        sttService_1.sttService.stopSession();
        (0, assistantState_1.broadcastAssistantState)('idle');
        // Resume background listening right away if it is enabled.
        if (wakeWordService_1.wakeWordService.isEnabled()) {
            broadcast('kyclius:wake:start-ambient-capture');
        }
    });
    electron_1.ipcMain.handle('kyclius:speak', async (_event, text) => {
        try {
            await ttsService_1.ttsService.speak(String(text ?? ''));
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            broadcast('kyclius:voice-error', { code: 'tts_error', message });
        }
    });
    electron_1.ipcMain.on('kyclius:stop-speaking', () => {
        ttsService_1.ttsService.stopSpeaking();
    });
    electron_1.ipcMain.handle('kyclius:get-active-stt-engine', async () => sttService_1.sttService.getActiveEngine());
    electron_1.ipcMain.handle('kyclius:set-active-stt-engine', async (_event, engine) => {
        if (engine !== 'whisper' && engine !== 'system')
            return;
        sttService_1.sttService.setActiveEngine(engine);
        db_1.userConfig.set(STT_ENGINE_KEY, engine);
    });
    // F-07: whisper model catalogue + one-click download (mirrors the Kokoro
    // model flow). Downloads land in userData/whisper and are picked up lazily
    // by resolveWhisperSetting on the next transcription.
    electron_1.ipcMain.handle('kyclius:get-whisper-models', async () => whisperModelDownloader_1.WHISPER_MODELS.map(model => ({
        id: model.id,
        label: model.label,
        description: model.description,
        ready: (() => {
            const p = (0, whisperModelDownloader_1.getWhisperModelLocalPath)(model.id);
            return !!p && (0, fs_1.existsSync)(p);
        })(),
    })));
    electron_1.ipcMain.handle('kyclius:download-whisper-model', async (_event, id) => {
        try {
            const modelPath = await (0, whisperModelDownloader_1.ensureWhisperModel)(id, progress => {
                broadcast('kyclius:whisper-model-progress', progress);
            });
            db_1.userConfig.set('whisper_model', id);
            return { ok: true, path: modelPath };
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { ok: false, message };
        }
    });
    electron_1.ipcMain.handle('kyclius:get-whisper-model', async () => {
        const stored = db_1.userConfig.get('whisper_model');
        return stored === 'large-v3-turbo' || stored === 'small' ? stored : undefined;
    });
    electron_1.ipcMain.handle('kyclius:set-whisper-model', async (_event, id) => {
        if (id !== 'large-v3-turbo' && id !== 'small')
            return;
        db_1.userConfig.set('whisper_model', id);
    });
    electron_1.ipcMain.on('kyclius:voice-audio-chunk', (_event, data) => {
        try {
            sttService_1.sttService.feedAudioChunk(new Float32Array(data));
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            broadcast('kyclius:voice-error', { code: 'stt_engine_error', message });
        }
    });
    // F-09: ambient audio streamed in for wake word detection (in-memory only).
    electron_1.ipcMain.on('kyclius:wake-audio-chunk', (_event, data) => {
        try {
            wakeWordService_1.wakeWordService.ingestChunk(new Float32Array(data));
        }
        catch {
            // Detection failures are surfaced through the service's error sink.
        }
    });
    electron_1.ipcMain.on('kyclius:wake-capture-started', () => {
        wakeWordService_1.wakeWordService.handleAmbientCaptureStarted();
    });
    // F-09: get/set the wake phrase and background-listening toggle.
    electron_1.ipcMain.handle('kyclius:get-wake-word-config', async () => {
        const phrase = getStoredWakePhrase();
        return {
            phrase,
            enabled: isBackgroundListeningEnabled(),
            warnings: (0, wakeWordService_1.validateWakePhrase)(phrase).warnings,
        };
    });
    electron_1.ipcMain.handle('kyclius:set-wake-word', async (_event, phrase) => {
        const text = typeof phrase === 'string' ? phrase.trim() : '';
        const validation = (0, wakeWordService_1.validateWakePhrase)(text);
        if (!validation.ok)
            return validation;
        db_1.userConfig.set(exports.WAKE_PHRASE_KEY, text);
        // The service reads the phrase via deps.getPhrase(), so this takes
        // effect on the very next detection pass — no restart needed.
        return validation;
    });
    electron_1.ipcMain.handle('kyclius:toggle-background-listening', async (_event, enabled) => {
        setBackgroundListening(enabled === true);
    });
    electron_1.ipcMain.on('kyclius:voice-system-transcript', (_event, text, isFinal) => {
        if (!(typeof text === 'string' && text.trim().length > 0))
            return;
        // F-10 fail-closed: Web Speech delivers text without audio we can verify
        // against the voiceprint, so it can't pass biometric gating.
        if ((0, biometrics_handlers_1.isBiometricsEnabled)() && speakerVerificationService_1.speakerVerificationService.isEnrolled()) {
            broadcast('kyclius:voice-error', {
                code: 'speaker_unverified',
                message: "Voice biometrics are on, but the system speech engine doesn't provide audio Kyclius can verify. Switch to the Whisper engine in Settings or type your request.",
            });
            return;
        }
        (0, transcriptBus_1.publishTranscript)(text, Boolean(isFinal));
        if (!isConfirmationWindowOpen()) {
            broadcast('kyclius:transcript', text, Boolean(isFinal));
        }
    });
    electron_1.ipcMain.on('kyclius:voice-capture-started', () => {
        sttService_1.sttService.handleCaptureStarted();
    });
    electron_1.ipcMain.on('kyclius:voice-capture-failed', (_event, error) => {
        const known = [
            'mic_permission_denied',
            'mic_not_found',
            'capture_failed',
            'stt_engine_unavailable',
            'stt_engine_error',
            'tts_error',
        ];
        const code = known.includes(error?.code ?? '') ? error.code : 'capture_failed';
        const voiceError = {
            code,
            message: typeof error?.message === 'string' ? error.message : 'Microphone capture failed.',
        };
        sttService_1.sttService.handleCaptureFailed(voiceError);
        // Surface mic problems to background listening too — never fail silently.
        wakeWordService_1.wakeWordService.handleCaptureFailed(voiceError);
    });
    voiceConfirmationListener_1.voiceConfirmationListener.install({
        subscribeQueue: confirmationQueue_1.subscribeToQueue,
        subscribeTranscripts: transcriptBus_1.subscribeToTranscripts,
        respond: permissionEngine_1.respondToConfirmation,
        speak: text => ttsService_1.ttsService.speak(text),
        startCapture: () => broadcast('kyclius:voice:start-capture', { engine: sttService_1.sttService.getActiveEngine() }),
        stopCapture: () => broadcast('kyclius:voice:stop-capture'),
        isCapturing: () => sttService_1.sttService.isSessionActive(),
        // Click-only confirmation mode (Security doc §3): when disabled, pending
        // confirmations are never resolved by voice — no window, no capture.
        isEnabled: settingsKeys_1.isVoiceConfirmationEnabled,
    });
}
function describeWhisperSetupProblem(err) {
    if (err instanceof whisperCppEngine_1.WhisperNotConfiguredError) {
        return { code: 'stt_engine_unavailable', message: err.message };
    }
    const message = err instanceof Error ? err.message : String(err);
    return { code: 'stt_engine_error', message };
}
