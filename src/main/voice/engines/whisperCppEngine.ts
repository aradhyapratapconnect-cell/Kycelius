import { spawn } from 'child_process';
import { access, mkdtemp, writeFile, unlink, rmdir } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { encodePcm16Wav } from '../pcmWav';
import type { SttEngine } from '../sttService';
import { WHISPER_SPAWN_TIMEOUT_MS } from '../../utils/timeouts';

export interface WhisperCppConfig {
  binaryPath: string;
  modelPath: string;
  /** Whisper language code ('en', 'de', …, or 'auto'). Defaults to 'en'. */
  language?: string;
  /**
   * Optional context/biasing text passed as whisper's --prompt. Used to bias
   * decoding toward personal vocabulary (names, jargon) — see STT upgrade
   * step 3 (personal dictionary), which will feed this automatically.
   */
  initialPrompt?: string;
}

export class WhisperNotConfiguredError extends Error {
  constructor() {
    super(
      'whisper.cpp is not configured. Set the whisper binary and model paths in Settings, switch to the system speech engine, or type your request instead.'
    );
    this.name = 'WhisperNotConfiguredError';
  }
}

export async function resolveWhisperConfig(getSetting: (key: string) => string | undefined): Promise<WhisperCppConfig> {
  const binaryPath = getSetting('whisper_binary_path');
  const modelPath = getSetting('whisper_model_path');

  if (!binaryPath || !modelPath) {
    throw new WhisperNotConfiguredError();
  }

  try {
    await access(binaryPath);
    await access(modelPath);
  } catch {
    throw new WhisperNotConfiguredError();
  }

  return {
    binaryPath,
    modelPath,
    // 'auto' mislabels short utterances and wastes decode time on detection;
    // default to English unless the user explicitly picks otherwise.
    language: getSetting('whisper_language') ?? 'en',
    initialPrompt: getSetting('whisper_initial_prompt')?.trim() || undefined,
  };
}

export function createWhisperCppEngine(
  getConfig: () => Promise<WhisperCppConfig>
): SttEngine {
  return {
    id: 'whisper',

    async transcribe(pcm: Float32Array): Promise<string> {
      const config = await getConfig();
      const wav = encodePcm16Wav(pcm);

      // whisper-cli's miniaudio decoder cannot transcribe from a non-seekable
      // stdin pipe (it reads the bytes but decodes nothing), so the utterance
      // is handed over as a transient temp file instead. It is deleted in the
      // `finally` below — audio is never persisted beyond a single transcription.
      const dir = await mkdtemp(join(tmpdir(), 'kyclius-stt-'));
      const wavPath = join(dir, 'utterance.wav');
      await writeFile(wavPath, wav);

      try {
        const args = [
          '-m',
          config.modelPath,
          '-f',
          wavPath,
          '-nt',
          '--no-prints',
          '-l',
          config.language ?? 'en',
        ];

        // Vocabulary biasing: whisper conditions its decode on this text,
        // sharply improving recognition of names/jargon listed here.
        if (config.initialPrompt) {
          args.push('--prompt', config.initialPrompt);
        }

        return await new Promise<string>((resolve, reject) => {
          let stdout = '';
          let stderr = '';
          let settled = false;

          const child = spawn(config.binaryPath, args, {
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
          });

          let killTimer: ReturnType<typeof setTimeout> | undefined;
          const settle = (fn: () => void) => {
            if (!settled) {
              settled = true;
              if (killTimer) clearTimeout(killTimer);
              fn();
            }
          };

          // EF-10: enforced wall-clock ceiling — a hung whisper binary is
          // killed instead of blocking the main process indefinitely.
          killTimer = setTimeout(() => {
            settle(() => {
              try {
                child.kill();
              } catch {
                // already exited
              }
              reject(
                Object.assign(
                  new Error(
                    `Speech recognition timed out after ${WHISPER_SPAWN_TIMEOUT_MS}ms and was killed`
                  ),
                  { code: 'stt_engine_error' }
                )
              );
            });
          }, WHISPER_SPAWN_TIMEOUT_MS);
          if (typeof (killTimer as unknown as { unref?: () => void }).unref === 'function') {
            (killTimer as unknown as { unref: () => void }).unref();
          }

          child.on('error', err =>
            settle(() =>
              reject(Object.assign(new Error(`Speech engine failed to start: ${err.message}`), { code: 'stt_engine_error' }))
            )
          );

          child.stdout?.on('data', chunk => (stdout += String(chunk)));
          child.stderr?.on('data', chunk => (stderr += String(chunk)));

          child.on('close', code => {
            if (code !== 0 && stdout.trim().length === 0) {
              settle(() =>
                reject(
                  Object.assign(
                    new Error(`Speech recognition failed (exit ${code})${stderr ? `: ${stderr.trim()}` : ''}`),
                    { code: 'stt_engine_error' }
                  )
                )
              );
              return;
            }
            settle(() => resolve(cleanTranscript(stdout)));
          });
        });
      } finally {
        // Best-effort cleanup; a leaked temp file on crash is harmless.
        await Promise.allSettled([unlink(wavPath), rmdir(dir)]);
      }
    },
  };
}

// Whisper frequently "hallucinates" sound-effect annotations when fed
// silence/noise (e.g. "[BLANK_AUDIO]", "(beeping)"). These must never reach
// the command pipeline as if the user had spoken them.
const WHISPER_ARTIFACT_PATTERNS: RegExp[] = [
  /\[(?:blank[\s_]?audio|inaudible|non[-\s]?speech|no\s+speech|silent|silence|noise|music|applause|laughter|whispers?|whispering|pause|crosstalk|distant\s+speak(?:ing|ers?)|farthest\s+mic|sound\s+effects?|blanks?)\]/gi,
  /\((?:beeps?|beeping|buzz(?:es|zing)?|clicks?|clicking|static|wind\s+blowing|typing|gunshots?|sighs?|breaths?|breathing|exhales?|inhales?|laughs?|laughter|chuckles?|clears?\s+throat|music|silence|pauses?|machinery\s+noise|school\s+bell\s+ringing|insects\s+chirping|mice\s+squeaking)\)/gi,
  /\bthanks\s+for\s+watching!?\.?/gi,
  /\bamara\.org\b.*$/gim,
];

export function cleanTranscript(raw: string): string {
  const joined = raw
    .split('\n')
    .map(line =>
      line
        .replace(/\[\d{2}:\d{2}:\d{2}\.\d{3} --> \d{2}:\d{2}:\d{2}\.\d{3}\]\s*/g, '')
        .replace(/^\s*whisper_print_timings.*$/i, '')
        .trim()
    )
    .filter(line => line.length > 0 && !/^(system_info|whisper_)/i.test(line))
    .join(' ');

  let cleaned = joined;
  for (const pattern of WHISPER_ARTIFACT_PATTERNS) {
    cleaned = cleaned.replace(pattern, ' ');
  }

  return cleaned.replace(/\s+/g, ' ').trim();
}
