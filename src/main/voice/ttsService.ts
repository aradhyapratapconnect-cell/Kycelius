import { spawn, type ChildProcess } from 'child_process';
import { writeFile, unlink, mkdtemp } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  createKokoroTtsEngine,
  type TtsEngine,
} from './engines/kokoroTtsEngine';
import { createCloudTtsEngine, type CloudTtsConfig } from './engines/cloudTtsEngine';
import { encodePcm16Wav } from './pcmWav';

function isElectronAvailable(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electron = require('electron') as Record<string, unknown>; // eslint-disable-line @typescript-eslint/no-var-requires
    const app = electron?.app as Record<string, unknown> | undefined;
    return typeof app?.getPath === 'function';
  } catch {
    return false;
  }
}

export interface TtsCommand {
  file: string;
  args: string[];
}

export type PlatformId = 'win32' | 'darwin' | 'linux';

export function buildSpeakCommand(platform: PlatformId, text: string): TtsCommand {
  const guardDash = (args: string[]): string[] =>
    text.startsWith('-') ? ['--', ...args] : args;

  if (platform === 'darwin') {
    return { file: 'say', args: guardDash([text]) };
  }

  if (platform === 'linux') {
    return { file: 'spd-say', args: guardDash(['-w', '-l', '0', text]) };
  }

  const script =
    "Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.Speak([Console]::In.ReadToEnd()); $s.Dispose()";
  return {
    file: 'powershell.exe',
    args: [
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      Buffer.from(script, 'utf16le').toString('base64'),
    ],
  };
}

function buildOsPlayerCommand(platform: PlatformId, wavPath: string): TtsCommand {
  if (platform === 'darwin') {
    return { file: 'afplay', args: [wavPath] };
  }
  if (platform === 'linux') {
    return { file: 'aplay', args: [wavPath] };
  }
  const script = `(New-Object System.Media.SoundPlayer '${wavPath.replace(/'/g, "''")}').PlaySync()`;
  return {
    file: 'powershell.exe',
    args: [
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      Buffer.from(script, 'utf16le').toString('base64'),
    ],
  };
}

/** Kokoro-82M outputs at 24 000 Hz; engines that report their own rate win. */
const KOKORO_SAMPLE_RATE = 24_000;

class TtsService {
  private currentProcess: ChildProcess | null = null;
  private kokoroEngine: TtsEngine | null = null;
  private kokoroChecked = false;
  private kokoroDownloading = false;
  private modelPaths: { modelPath: string; voicePath: string; tokenizerPath: string } | null = null;
  private settingGetter: ((key: string) => string | undefined) | null = null;

  // N-08: optional cloud TTS provider, re-resolved per speak() so config
  // edits take effect immediately. onFallback throttles its notices.
  private resolveCloudTts: (() => CloudTtsConfig | null) | null = null;
  private noticeSender: ((message: string) => void) | null = null;
  private cloudNoticeAt = 0;

  install(getSetting: (key: string) => string | undefined): void {
    this.settingGetter = getSetting;
  }

  /** N-08: supply the cloud-TTS resolution callback + notice broadcaster. */
  installCloud(
    resolveCloudTts: () => CloudTtsConfig | null,
    sendNotice: (message: string) => void
  ): void {
    this.resolveCloudTts = resolveCloudTts;
    this.noticeSender = sendNotice;
  }

  /**
   * Ensures the Kokoro model is downloaded, then returns the engine.
   * On first call, triggers an async download if files aren't present.
   * Returns null if download fails or isn't ready yet (caller falls back to OS TTS).
   */
  private async resolveKokoroEngine(): Promise<TtsEngine | null> {
    if (this.kokoroEngine) return this.kokoroEngine;
    if (this.kokoroChecked) return null;

    // Check for manual override in settings first
    const manualModelPath = this.settingGetter?.('kokoro_tts_model_path');
    const manualVoicePath = this.settingGetter?.('kokoro_tts_voice_path');
    const manualTokenizerPath = this.settingGetter?.('kokoro_tts_tokenizer_path');

    if (manualModelPath && manualVoicePath && manualTokenizerPath) {
      try {
        this.modelPaths = {
          modelPath: manualModelPath,
          voicePath: manualVoicePath,
          tokenizerPath: manualTokenizerPath,
        };
        this.kokoroEngine = createKokoroTtsEngine(async () => this.modelPaths!);
        this.kokoroChecked = true;
        return this.kokoroEngine;
      } catch {
        // Fall through to auto-download
      }
    }

    // Auto-download path — only when running inside Electron
    if (!isElectronAvailable()) {
      this.kokoroChecked = true;
      return null;
    }

    if (this.kokoroDownloading) return null;

    try {
      this.kokoroDownloading = true;

      // Lazy-import so tests that don't mock Electron aren't affected
      const { ensureKokoroModel: ensureModel, isKokoroModelReady: isReady } =
        await import('./kokoroModelDownloader');

      // If files already exist locally, this is instant
      if (!(await isReady())) {
        console.log('[TTS] Kokoro model not found locally, downloading (~92 MB)...');
      }

      this.modelPaths = await ensureModel((progress) => {
        const pct = progress.total > 0
          ? Math.round((progress.downloaded / progress.total) * 100)
          : 0;
        console.log(`[TTS] Downloading ${progress.file}: ${pct}%`);
      });

      this.kokoroEngine = createKokoroTtsEngine(async () => this.modelPaths!);
      this.kokoroChecked = true;
      console.log('[TTS] Kokoro-82M engine ready.');
      return this.kokoroEngine;
    } catch (err) {
      console.error('[TTS] Failed to initialize Kokoro engine:', err);
      this.kokoroChecked = true;
      return null;
    } finally {
      this.kokoroDownloading = false;
    }
  }

  async speak(text: string): Promise<void> {
    if (!text || text.trim().length === 0) return;

    this.stopSpeaking();

    // N-08: cloud-first. A configured + enabled cloud TTS provider speaks the
    // utterance; on any failure we fall through to the local chain below.
    const cloud = this.resolveCloudTts?.() ?? null;
    if (cloud) {
      try {
        await this.speakViaEngine(createCloudTtsEngine(cloud), text);
        return;
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        if (Date.now() - this.cloudNoticeAt > 30_000) {
          this.cloudNoticeAt = Date.now();
          this.noticeSender?.(
            `Cloud TTS (${cloud.displayName}) failed (${reason}). Using the local voice instead.`
          );
        }
      }
    }

    if (this.kokoroEngine) {
      await this.speakViaEngine(this.kokoroEngine, text);
    } else if (this.kokoroChecked || !isElectronAvailable()) {
      if (!this.kokoroChecked) this.kokoroChecked = true;
      await this.speakViaOs(text);
    } else {
      const kokoro = await this.resolveKokoroEngine();
      if (kokoro) {
        await this.speakViaEngine(kokoro, text);
      } else {
        await this.speakViaOs(text);
      }
    }
  }

  private async speakViaEngine(engine: TtsEngine, text: string): Promise<void> {
    const pcm = await engine.synthesize(text);
    if (pcm.length === 0) return;

    // An OSS engine reports its own sample rate; older engines default to the
    // Kokoro rate so the WAV header always matches what we wrote.
    const wav = encodePcm16Wav(pcm, engine.sampleRate ?? KOKORO_SAMPLE_RATE);
    const dir = await mkdtemp(join(tmpdir(), 'kyclius-tts-'));
    const wavPath = join(dir, 'utterance.wav');

    try {
      await writeFile(wavPath, wav);

      const platform = process.platform as PlatformId;
      const command = buildOsPlayerCommand(platform, wavPath);

      await new Promise<void>((resolve, reject) => {
        let settled = false;

        const child = spawn(command.file, command.args, {
          stdio: ['ignore', 'ignore', 'ignore'],
          windowsHide: true,
        });
        this.currentProcess = child;

        const settle = (fn: () => void) => {
          if (!settled) {
            settled = true;
            if (this.currentProcess === child) this.currentProcess = null;
            fn();
          }
        };

        child.on('error', err =>
          settle(() =>
            reject(
              Object.assign(new Error(`Audio playback failed: ${err.message}`), {
                code: 'tts_error',
              })
            )
          )
        );

        child.on('close', code => {
          if (code === 0) {
            settle(() => resolve());
          } else {
            settle(() =>
              reject(
                Object.assign(new Error(`Audio player exited with code ${code}`), {
                  code: 'tts_error',
                })
              )
            );
          }
        });
      });
    } finally {
      await Promise.allSettled([unlink(wavPath)]);
      await import('fs/promises').then(fs => fs.rmdir(dir).catch(() => {}));
    }
  }

  private async speakViaOs(text: string): Promise<void> {
    const platform = process.platform as PlatformId;
    const command = buildSpeakCommand(platform, text);

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let stderrOutput = '';

      const child = spawn(command.file, command.args, {
        stdio: ['pipe', 'ignore', 'pipe'],
        windowsHide: true,
      });
      this.currentProcess = child;

      const settle = (fn: () => void) => {
        if (!settled) {
          settled = true;
          if (this.currentProcess === child) this.currentProcess = null;
          fn();
        }
      };

      child.on('error', err => {
        settle(() =>
          reject(
            Object.assign(new Error(`Text-to-speech engine could not be started: ${err.message}`), {
              code: 'tts_error',
            })
          )
        );
      });

      child.stderr?.on('data', chunk => {
        stderrOutput += String(chunk);
      });

      child.on('close', code => {
        if (code === 0) {
          settle(() => resolve());
        } else {
          settle(() =>
            reject(
              Object.assign(
                new Error(
                  `Text-to-speech failed (exit ${code})${stderrOutput ? `: ${stderrOutput.trim()}` : ''}`
                ),
                { code: 'tts_error' }
              )
            )
          );
        }
      });

      if (platform === 'win32' && child.stdin) {
        child.stdin.write(text);
        child.stdin.end();
      }
    });
  }

  stopSpeaking(): void {
    if (this.currentProcess) {
      try {
        this.currentProcess.kill();
      } catch {
        // process may have already exited
      }
      this.currentProcess = null;
    }
  }

  isSpeaking(): boolean {
    return this.currentProcess !== null;
  }
}

export const ttsService = new TtsService();
