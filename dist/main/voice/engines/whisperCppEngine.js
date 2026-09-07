"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WhisperNotConfiguredError = void 0;
exports.resolveWhisperConfig = resolveWhisperConfig;
exports.createWhisperCppEngine = createWhisperCppEngine;
exports.cleanTranscript = cleanTranscript;
const child_process_1 = require("child_process");
const promises_1 = require("fs/promises");
const os_1 = require("os");
const path_1 = require("path");
const pcmWav_1 = require("../pcmWav");
const timeouts_1 = require("../../utils/timeouts");
class WhisperNotConfiguredError extends Error {
    constructor() {
        super('whisper.cpp is not configured. Set the whisper binary and model paths in Settings, switch to the system speech engine, or type your request instead.');
        this.name = 'WhisperNotConfiguredError';
    }
}
exports.WhisperNotConfiguredError = WhisperNotConfiguredError;
async function resolveWhisperConfig(getSetting) {
    const binaryPath = getSetting('whisper_binary_path');
    const modelPath = getSetting('whisper_model_path');
    if (!binaryPath || !modelPath) {
        throw new WhisperNotConfiguredError();
    }
    try {
        await (0, promises_1.access)(binaryPath);
        await (0, promises_1.access)(modelPath);
    }
    catch {
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
function createWhisperCppEngine(getConfig) {
    return {
        id: 'whisper',
        async transcribe(pcm) {
            const config = await getConfig();
            const wav = (0, pcmWav_1.encodePcm16Wav)(pcm);
            // whisper-cli's miniaudio decoder cannot transcribe from a non-seekable
            // stdin pipe (it reads the bytes but decodes nothing), so the utterance
            // is handed over as a transient temp file instead. It is deleted in the
            // `finally` below — audio is never persisted beyond a single transcription.
            const dir = await (0, promises_1.mkdtemp)((0, path_1.join)((0, os_1.tmpdir)(), 'kyclius-stt-'));
            const wavPath = (0, path_1.join)(dir, 'utterance.wav');
            await (0, promises_1.writeFile)(wavPath, wav);
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
                return await new Promise((resolve, reject) => {
                    let stdout = '';
                    let stderr = '';
                    let settled = false;
                    const child = (0, child_process_1.spawn)(config.binaryPath, args, {
                        stdio: ['ignore', 'pipe', 'pipe'],
                        windowsHide: true,
                    });
                    let killTimer;
                    const settle = (fn) => {
                        if (!settled) {
                            settled = true;
                            if (killTimer)
                                clearTimeout(killTimer);
                            fn();
                        }
                    };
                    // EF-10: enforced wall-clock ceiling — a hung whisper binary is
                    // killed instead of blocking the main process indefinitely.
                    killTimer = setTimeout(() => {
                        settle(() => {
                            try {
                                child.kill();
                            }
                            catch {
                                // already exited
                            }
                            reject(Object.assign(new Error(`Speech recognition timed out after ${timeouts_1.WHISPER_SPAWN_TIMEOUT_MS}ms and was killed`), { code: 'stt_engine_error' }));
                        });
                    }, timeouts_1.WHISPER_SPAWN_TIMEOUT_MS);
                    if (typeof killTimer.unref === 'function') {
                        killTimer.unref();
                    }
                    child.on('error', err => settle(() => reject(Object.assign(new Error(`Speech engine failed to start: ${err.message}`), { code: 'stt_engine_error' }))));
                    child.stdout?.on('data', chunk => (stdout += String(chunk)));
                    child.stderr?.on('data', chunk => (stderr += String(chunk)));
                    child.on('close', code => {
                        if (code !== 0 && stdout.trim().length === 0) {
                            settle(() => reject(Object.assign(new Error(`Speech recognition failed (exit ${code})${stderr ? `: ${stderr.trim()}` : ''}`), { code: 'stt_engine_error' })));
                            return;
                        }
                        settle(() => resolve(cleanTranscript(stdout)));
                    });
                });
            }
            finally {
                // Best-effort cleanup; a leaked temp file on crash is harmless.
                await Promise.allSettled([(0, promises_1.unlink)(wavPath), (0, promises_1.rmdir)(dir)]);
            }
        },
    };
}
// Whisper frequently "hallucinates" sound-effect annotations when fed
// silence/noise (e.g. "[BLANK_AUDIO]", "(beeping)"). These must never reach
// the command pipeline as if the user had spoken them.
const WHISPER_ARTIFACT_PATTERNS = [
    /\[(?:blank[\s_]?audio|inaudible|non[-\s]?speech|no\s+speech|silent|silence|noise|music|applause|laughter|whispers?|whispering|pause|crosstalk|distant\s+speak(?:ing|ers?)|farthest\s+mic|sound\s+effects?|blanks?)\]/gi,
    /\((?:beeps?|beeping|buzz(?:es|zing)?|clicks?|clicking|static|wind\s+blowing|typing|gunshots?|sighs?|breaths?|breathing|exhales?|inhales?|laughs?|laughter|chuckles?|clears?\s+throat|music|silence|pauses?|machinery\s+noise|school\s+bell\s+ringing|insects\s+chirping|mice\s+squeaking)\)/gi,
    /\bthanks\s+for\s+watching!?\.?/gi,
    /\bamara\.org\b.*$/gim,
];
function cleanTranscript(raw) {
    const joined = raw
        .split('\n')
        .map(line => line
        .replace(/\[\d{2}:\d{2}:\d{2}\.\d{3} --> \d{2}:\d{2}:\d{2}\.\d{3}\]\s*/g, '')
        .replace(/^\s*whisper_print_timings.*$/i, '')
        .trim())
        .filter(line => line.length > 0 && !/^(system_info|whisper_)/i.test(line))
        .join(' ');
    let cleaned = joined;
    for (const pattern of WHISPER_ARTIFACT_PATTERNS) {
        cleaned = cleaned.replace(pattern, ' ');
    }
    return cleaned.replace(/\s+/g, ' ').trim();
}
