import { app, BrowserWindow, ipcMain } from 'electron';
import { existsSync } from 'fs';
import { join } from 'path';
import { sttService } from '../voice/sttService';
import { ttsService } from '../voice/ttsService';
import {
  createWhisperCppEngine,
  resolveWhisperConfig,
  WhisperNotConfiguredError,
} from '../voice/engines/whisperCppEngine';
import {
  createCloudSttEngine,
  type CloudSttConfig,
} from '../voice/engines/cloudSttEngine';
import {
  createCloudTtsEngine,
  type CloudTtsConfig,
} from '../voice/engines/cloudTtsEngine';
import { providerRegistry } from '../llm/providerRegistry';
import { userConfig } from '../db/db';
import type { SttEngineId, SttVoiceError } from '../voice/sttService';
import {
  DEFAULT_WAKE_PHRASE,
  validateWakePhrase,
  wakeWordService,
} from '../voice/wakeWordService';
import { publishTranscript, subscribeToTranscripts } from '../voice/transcriptBus';
import { voiceConfirmationListener } from '../voice/voiceConfirmationListener';
import { respondToConfirmation } from '../permissions/permissionEngine';
import { subscribeToQueue } from '../permissions/confirmationQueue';
import { updateTrayWakeState } from '../tray';
import { speakerVerificationService } from '../voice/speakerVerificationService';
import {
  createSileroVad,
  resolveSileroVadConfig,
} from '../voice/vad/sileroVad';
import { isBiometricsEnabled } from './biometrics.handlers';
import { isVoiceConfirmationEnabled } from '../config/settingsKeys';
import { broadcastAssistantState } from '../assistantState';
import { planner } from '../agent/planner';
import {
  WHISPER_MODELS,
  ensureWhisperModel,
  type WhisperModelId,
  getWhisperModelLocalPath,
} from '../voice/whisperModelDownloader';

const STT_ENGINE_KEY = 'stt_engine';
export { STT_ENGINE_KEY };
export const WAKE_PHRASE_KEY = 'wake_phrase';
export const WAKE_ENABLED_KEY = 'wake_word_enabled';

function broadcast(channel: string, ...payload: unknown[]): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, ...payload);
    }
  }
}

function getStoredWakePhrase(): string {
  return userConfig.get(WAKE_PHRASE_KEY) ?? DEFAULT_WAKE_PHRASE;
}
export { getStoredWakePhrase };

/**
 * While a voice-confirmation window is open, transcripts must reach the
 * confirmation listener but never leak to the renderer — otherwise whatever
 * the user says ("okay", "cancel") would also be submitted as a command by
 * the command bar.
 */
function isConfirmationWindowOpen(): boolean {
  return voiceConfirmationListener.getWindowConfirmationId() !== null;
}

function publishForBus(text: string, isFinal: boolean): void {
  publishTranscript(text, isFinal);
  if (!isConfirmationWindowOpen()) {
    broadcast('kyclius:transcript', text, isFinal);
  }
}

/**
 * Base path for the packaged vendor/ tree. In a packaged build the asar is
 * unpacked at <resources>/app.asar.unpacked, so vendored binaries (which must
 * stay real files on disk for child_process.spawn) live there.
 */
function getVendorBase(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'app.asar.unpacked')
    : app.getAppPath();
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
function resolveWhisperSetting(key: string): string | undefined {
  const stored = userConfig.get(key);
  if (stored) return stored;

  const base = getVendorBase();
  if (key === 'whisper_binary_path') {
    const exe = process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli';
    const candidate = join(base, 'vendor', 'whisper', 'bin', exe);
    if (existsSync(candidate)) return candidate;
  }
  if (key === 'whisper_model_path') {
    const modelId = userConfig.get('whisper_model') as WhisperModelId | undefined;
    if (modelId === 'large-v3-turbo' || modelId === 'small') {
      const downloaded = getWhisperModelLocalPath(modelId);
      if (downloaded && existsSync(downloaded)) return downloaded;
    }
    const candidate = join(base, 'vendor', 'whisper', 'models', 'ggml-base.en.bin');
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

function isBackgroundListeningEnabled(): boolean {
  return userConfig.get(WAKE_ENABLED_KEY) === 'true';
}

/**
 * Starts (or stops) background wake-word listening: persists the setting,
 * flips the service immediately, and tells the renderer to start/stop its
 * ambient microphone stream. Used by both the IPC handler and the tray menu.
 */
export function setBackgroundListening(enabled: boolean): void {
  userConfig.set(WAKE_ENABLED_KEY, enabled ? 'true' : 'false');
  wakeWordService.setEnabled(enabled);
  broadcast(
    enabled ? 'kyclius:wake:start-ambient-capture' : 'kyclius:wake:stop-ambient-capture'
  );
  updateTrayWakeState(wakeWordService.getState(), getStoredWakePhrase());
}

/**
 * Whether the whisper engine can actually run right now (binary + model both
 * resolvable on disk). EF-04 Symptom C: the local Whisper engine is the
 * preferred engine, but when it isn't configured/loaded the app must fall
 * back to the system engine rather than leave voice dead.
 */
export async function isWhisperReady(): Promise<boolean> {
  try {
    await resolveWhisperConfig(resolveWhisperSetting);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolves the engine a command-listening session should actually use,
 * applying the EF-04 automatic fallback: when the user selected `whisper`
 * but no whisper model/binary is usable, the session transparently falls
 * back to the `system` (Web Speech) engine.
 */
async function resolveEffectiveSttEngine(): Promise<{ engine: SttEngineId; fallback: boolean }> {
  const selected = sttService.getActiveEngine();
  if (selected === 'system') return { engine: 'system', fallback: false };
  if (await isWhisperReady()) return { engine: 'whisper', fallback: false };

  // Whisper is selected but not usable — fall back to system and tell the user.
  sttService.setActiveEngine('system');
  return { engine: 'system', fallback: true };
}

// ---------------------------------------------------------------------------
// N-08: cloud STT/TTS resolution from the shared `providers` table.
// A provider is used when it's the active default FOR ITS CAPABILITY and it is
// enabled, has a stored key, a base URL, and a model/voice id. Anything less
// (unset, disabled, key removed, no model) means local-first — never silent.
// ---------------------------------------------------------------------------

function cloudConfigFor(capability: 'stt' | 'tts'): CloudSttConfig | CloudTtsConfig | null {
  const id = providerRegistry.getDefaultProviderId(capability);
  if (!id) return null;
  const row = providerRegistry.get(id);
  if (!row || !row.enabled || !row.hasKey || !row.baseUrl) return null;
  const model = providerRegistry.getConfiguredModel(id);
  if (!model) return null;
  let apiKey: string;
  try {
    apiKey = providerRegistry.getDecryptedApiKey(id);
  } catch {
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

function resolveCloudSttProvider(): CloudSttConfig | null {
  return cloudConfigFor('stt') as CloudSttConfig | null;
}

function resolveCloudTtsProvider(): CloudTtsConfig | null {
  return cloudConfigFor('tts') as CloudTtsConfig | null;
}

/**
 * Registers (or unregisters) the cloud-STT engine for the current config and
 * returns the engine id to point the session at, or null when local-only.
 * Re-run on every listening session so edits propagate immediately.
 */
let activateCloudStt: () => string | null = () => null;

/** Shared entry point for the normal command-listening flow (used by T-01 and the wake hand-off). */
export async function beginCommandListening(): Promise<{ started: boolean; engine: SttEngineId }> {
  // N-08: a configured + enabled cloud STT provider that is the active default
  // takes over the session; otherwise the local whisper/system ladder applies.
  const cloudId = activateCloudStt();

  let engine: SttEngineId = 'whisper';
  let fallback = false;
  if (cloudId) {
    sttService.setSessionEngine(cloudId);
    // Cloud STT consumes the same audio-chunk stream as whisper, so the
    // renderer must capture mic audio rather than fall to Web Speech.
    engine = 'whisper';
  } else {
    sttService.setSessionEngine(null);
    const resolved = await resolveEffectiveSttEngine();
    engine = resolved.engine;
    fallback = resolved.fallback;
  }
  if (fallback) {
    broadcast('kyclius:voice-engine-notice', {
      message:
        "Using your system's voice engine until the local Whisper model finishes downloading. You can switch engines in Settings.",
    });
  }
  const result = sttService.startSession();
  if (result.started) {
    broadcastAssistantState('listening');
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
async function gateAndPublishTranscript(pcm: Float32Array, text: string): Promise<void> {
  // verify() bypasses instantly (matched:true) when disabled or unenrolled.
  const verdict = await speakerVerificationService.verify(pcm);
  if (!verdict.matched) {
    broadcast('kyclius:voice-error', {
      code: 'speaker_unverified',
      message:
        "That voice isn't verified against your enrolled profile, so Kyclius ignored this request. Use your enrolled voice, or type your request in the command bar.",
    } satisfies SttVoiceError);
    return;
  }

  // F-11: a verified spoken "stop" cancels a running multi-step plan.
  if (/\bstop\b/i.test(text) && planner.isPlanRunning()) {
    planner.cancelActivePlan('Stopped by voice command.');
  }

  publishTranscript(text, true);
  if (!isConfirmationWindowOpen()) {
    broadcast('kyclius:transcript', text, true);
  }
}

function focusMainWindow(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  }
}

export function registerVoiceHandlers() {
  // F-07: wire the TTS service to read user settings so the Kokoro-82M
  // ONNX model path (if set) is picked up lazily on first speak().
  ttsService.install(key => userConfig.get(key));

  const whisperEngine = createWhisperCppEngine(() =>
    resolveWhisperConfig(resolveWhisperSetting)
  );

  // N-08: cloud STT engine, swapped in per listening session. Its transcribe
  // falls back to local whisper.cpp on any cloud failure (per the ticket), so
  // a flaky provider degrades to the free local engine — never to silence.
  let lastCloudSttEngineId: string | null = null;
  activateCloudStt = () => {
    if (lastCloudSttEngineId) {
      sttService.unregisterEngine(lastCloudSttEngineId);
      lastCloudSttEngineId = null;
    }
    const config = resolveCloudSttProvider();
    if (!config) return null;
    const engineId = `cloud-stt-${config.id}`;
    sttService.registerEngine(
      createCloudSttEngine(
        { ...config, id: engineId },
        {
          fallback: pcm => whisperEngine.transcribe(pcm),
          onFallback: message => broadcast('kyclius:voice-engine-notice', { message }),
        }
      )
    );
    lastCloudSttEngineId = engineId;
    return engineId;
  };

  // N-08: cloud TTS engine, re-resolved per speak() so disabling/removing the
  // provider drops back to Kokoro/OS immediately. Failures surface a notice.
  ttsService.installCloud(
    () => resolveCloudTtsProvider(),
    message => broadcast('kyclius:voice-engine-notice', { message })
  );

  sttService.configure({
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
        } satisfies SttVoiceError);
      });
    },
    onVoiceError: error => {
      broadcast('kyclius:voice-error', error);
      // EF-04: an unrecoverable session error (no speech detected, engine
      // unavailable) must also release the renderer's mic and reset state —
      // otherwise the user is left in a hung "listening" state with no way out.
      if (error.code === 'no_speech_detected' || error.code === 'stt_engine_unavailable') {
        broadcast('kyclius:voice:stop-capture');
        broadcastAssistantState('idle');
        if (wakeWordService.isEnabled()) {
          broadcast('kyclius:wake:start-ambient-capture');
        }
      } else {
        broadcastAssistantState('error');
      }
    },
  });

  sttService.registerEngine(whisperEngine);

  // STT upgrade step 1a: prefer the neural Silero VAD for speech/silence
  // decisions when the user has supplied its ONNX model in Settings; the
  // service degrades to volume-based detection on its own if it can't load.
  sttService.setSpeechDetector(
    createSileroVad(() => resolveSileroVadConfig(key => userConfig.get(key)))
  );

  const storedEngine = userConfig.get(STT_ENGINE_KEY);
  if (storedEngine === 'whisper' || storedEngine === 'system') {
    sttService.setActiveEngine(storedEngine);
  }

  // F-09: configure the wake word service against the same local whisper engine.
  // Detection runs entirely in-memory; only transcripts are inspected.
  wakeWordService.configure({
    getPhrase: getStoredWakePhrase,
    transcribe: pcm => whisperEngine.transcribe(pcm),
    onWakeDetected: transcript => {
      broadcast('kyclius:wake-detected', transcript);
      focusMainWindow();
      void ttsService.speak('How can I help you?').catch(() => {});
      beginCommandListening();
    },
    onStateChanged: state => {
      broadcast('kyclius:wake-state-changed', state);
      updateTrayWakeState(state, getStoredWakePhrase());
    },
    onError: error => broadcast('kyclius:wake-error', error),
    isCommandSessionActive: () => sttService.isSessionActive(),
    isSpeaking: () => ttsService.isSpeaking(),
  });

  if (isBackgroundListeningEnabled()) {
    wakeWordService.setEnabled(true);
  }

  ipcMain.handle('kyclius:start-listening', async () => {
    return beginCommandListening();
  });

  ipcMain.handle('kyclius:stop-listening', async () => {
    broadcast('kyclius:voice:stop-capture');
    sttService.stopSession();
    broadcastAssistantState('idle');
    // Resume background listening right away if it is enabled.
    if (wakeWordService.isEnabled()) {
      broadcast('kyclius:wake:start-ambient-capture');
    }
  });

  ipcMain.handle('kyclius:speak', async (_event, text: string) => {
    try {
      await ttsService.speak(String(text ?? ''));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      broadcast('kyclius:voice-error', { code: 'tts_error', message } satisfies SttVoiceError);
    }
  });

  ipcMain.on('kyclius:stop-speaking', () => {
    ttsService.stopSpeaking();
  });

  ipcMain.handle('kyclius:get-active-stt-engine', async () => sttService.getActiveEngine());

  ipcMain.handle('kyclius:set-active-stt-engine', async (_event, engine: SttEngineId) => {
    if (engine !== 'whisper' && engine !== 'system') return;
    sttService.setActiveEngine(engine);
    userConfig.set(STT_ENGINE_KEY, engine);
  });

  // F-07: whisper model catalogue + one-click download (mirrors the Kokoro
  // model flow). Downloads land in userData/whisper and are picked up lazily
  // by resolveWhisperSetting on the next transcription.
  ipcMain.handle('kyclius:get-whisper-models', async () =>
    WHISPER_MODELS.map(model => ({
      id: model.id,
      label: model.label,
      description: model.description,
      ready: (() => {
        const p = getWhisperModelLocalPath(model.id);
        return !!p && existsSync(p);
      })(),
    }))
  );

  ipcMain.handle('kyclius:download-whisper-model', async (_event, id: WhisperModelId) => {
    try {
      const modelPath = await ensureWhisperModel(id, progress => {
        broadcast('kyclius:whisper-model-progress', progress);
      });
      userConfig.set('whisper_model', id);
      return { ok: true as const, path: modelPath };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false as const, message };
    }
  });

  ipcMain.handle('kyclius:get-whisper-model', async () => {
    const stored = userConfig.get('whisper_model');
    return stored === 'large-v3-turbo' || stored === 'small' ? stored : undefined;
  });

  ipcMain.handle('kyclius:set-whisper-model', async (_event, id: WhisperModelId) => {
    if (id !== 'large-v3-turbo' && id !== 'small') return;
    userConfig.set('whisper_model', id);
  });

  ipcMain.on('kyclius:voice-audio-chunk', (_event, data: ArrayBuffer) => {
    try {
      sttService.feedAudioChunk(new Float32Array(data));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      broadcast('kyclius:voice-error', { code: 'stt_engine_error', message } satisfies SttVoiceError);
    }
  });

  // F-09: ambient audio streamed in for wake word detection (in-memory only).
  ipcMain.on('kyclius:wake-audio-chunk', (_event, data: ArrayBuffer) => {
    try {
      wakeWordService.ingestChunk(new Float32Array(data));
    } catch {
      // Detection failures are surfaced through the service's error sink.
    }
  });

  ipcMain.on('kyclius:wake-capture-started', () => {
    wakeWordService.handleAmbientCaptureStarted();
  });

  // F-09: get/set the wake phrase and background-listening toggle.
  ipcMain.handle('kyclius:get-wake-word-config', async () => {
    const phrase = getStoredWakePhrase();
    return {
      phrase,
      enabled: isBackgroundListeningEnabled(),
      warnings: validateWakePhrase(phrase).warnings,
    };
  });

  ipcMain.handle('kyclius:set-wake-word', async (_event, phrase: string) => {
    const text = typeof phrase === 'string' ? phrase.trim() : '';
    const validation = validateWakePhrase(text);
    if (!validation.ok) return validation;

    userConfig.set(WAKE_PHRASE_KEY, text);
    // The service reads the phrase via deps.getPhrase(), so this takes
    // effect on the very next detection pass — no restart needed.
    return validation;
  });

  ipcMain.handle('kyclius:toggle-background-listening', async (_event, enabled: boolean) => {
    setBackgroundListening(enabled === true);
  });

  ipcMain.on('kyclius:voice-system-transcript', (_event, text: string, isFinal: boolean) => {
    if (!(typeof text === 'string' && text.trim().length > 0)) return;

    // F-10 fail-closed: Web Speech delivers text without audio we can verify
    // against the voiceprint, so it can't pass biometric gating.
    if (isBiometricsEnabled() && speakerVerificationService.isEnrolled()) {
      broadcast('kyclius:voice-error', {
        code: 'speaker_unverified',
        message:
          "Voice biometrics are on, but the system speech engine doesn't provide audio Kyclius can verify. Switch to the Whisper engine in Settings or type your request.",
      } satisfies SttVoiceError);
      return;
    }

    publishTranscript(text, Boolean(isFinal));
    if (!isConfirmationWindowOpen()) {
      broadcast('kyclius:transcript', text, Boolean(isFinal));
    }
  });

  ipcMain.on('kyclius:voice-capture-started', () => {
    sttService.handleCaptureStarted();
  });

  ipcMain.on(
    'kyclius:voice-capture-failed',
    (_event, error: SttVoiceError & { code?: string; message?: string }) => {
      const known = [
        'mic_permission_denied',
        'mic_not_found',
        'capture_failed',
        'stt_engine_unavailable',
        'stt_engine_error',
        'tts_error',
      ];
      const code = known.includes(error?.code ?? '') ? error.code : 'capture_failed';
      const voiceError: SttVoiceError = {
        code,
        message: typeof error?.message === 'string' ? error.message : 'Microphone capture failed.',
      };
      sttService.handleCaptureFailed(voiceError);
      // Surface mic problems to background listening too — never fail silently.
      wakeWordService.handleCaptureFailed(voiceError);
    }
  );

  voiceConfirmationListener.install({
    subscribeQueue: subscribeToQueue,
    subscribeTranscripts: subscribeToTranscripts,
    respond: respondToConfirmation,
    speak: text => ttsService.speak(text),
    startCapture: () =>
      broadcast('kyclius:voice:start-capture', { engine: sttService.getActiveEngine() }),
    stopCapture: () => broadcast('kyclius:voice:stop-capture'),
    isCapturing: () => sttService.isSessionActive(),
    // Click-only confirmation mode (Security doc §3): when disabled, pending
    // confirmations are never resolved by voice — no window, no capture.
    isEnabled: isVoiceConfirmationEnabled,
  });
}

export function describeWhisperSetupProblem(err: unknown): SttVoiceError {
  if (err instanceof WhisperNotConfiguredError) {
    return { code: 'stt_engine_unavailable', message: err.message };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { code: 'stt_engine_error', message };
}
