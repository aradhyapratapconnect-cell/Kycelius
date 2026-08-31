"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.ttsService = void 0;
exports.buildSpeakCommand = buildSpeakCommand;
const child_process_1 = require("child_process");
const promises_1 = require("fs/promises");
const path_1 = require("path");
const os_1 = require("os");
const kokoroTtsEngine_1 = require("./engines/kokoroTtsEngine");
const cloudTtsEngine_1 = require("./engines/cloudTtsEngine");
const pcmWav_1 = require("./pcmWav");
function isElectronAvailable() {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const electron = require('electron'); // eslint-disable-line @typescript-eslint/no-var-requires
        const app = electron?.app;
        return typeof app?.getPath === 'function';
    }
    catch {
        return false;
    }
}
function buildSpeakCommand(platform, text) {
    const guardDash = (args) => text.startsWith('-') ? ['--', ...args] : args;
    if (platform === 'darwin') {
        return { file: 'say', args: guardDash([text]) };
    }
    if (platform === 'linux') {
        return { file: 'spd-say', args: guardDash(['-w', '-l', '0', text]) };
    }
    const script = "Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.Speak([Console]::In.ReadToEnd()); $s.Dispose()";
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
function buildOsPlayerCommand(platform, wavPath) {
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
    currentProcess = null;
    kokoroEngine = null;
    kokoroChecked = false;
    kokoroDownloading = false;
    modelPaths = null;
    settingGetter = null;
    // N-08: optional cloud TTS provider, re-resolved per speak() so config
    // edits take effect immediately. onFallback throttles its notices.
    resolveCloudTts = null;
    noticeSender = null;
    cloudNoticeAt = 0;
    install(getSetting) {
        this.settingGetter = getSetting;
    }
    /** N-08: supply the cloud-TTS resolution callback + notice broadcaster. */
    installCloud(resolveCloudTts, sendNotice) {
        this.resolveCloudTts = resolveCloudTts;
        this.noticeSender = sendNotice;
    }
    /**
     * Ensures the Kokoro model is downloaded, then returns the engine.
     * On first call, triggers an async download if files aren't present.
     * Returns null if download fails or isn't ready yet (caller falls back to OS TTS).
     */
    async resolveKokoroEngine() {
        if (this.kokoroEngine)
            return this.kokoroEngine;
        if (this.kokoroChecked)
            return null;
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
                this.kokoroEngine = (0, kokoroTtsEngine_1.createKokoroTtsEngine)(async () => this.modelPaths);
                this.kokoroChecked = true;
                return this.kokoroEngine;
            }
            catch {
                // Fall through to auto-download
            }
        }
        // Auto-download path — only when running inside Electron
        if (!isElectronAvailable()) {
            this.kokoroChecked = true;
            return null;
        }
        if (this.kokoroDownloading)
            return null;
        try {
            this.kokoroDownloading = true;
            // Lazy-import so tests that don't mock Electron aren't affected
            const { ensureKokoroModel: ensureModel, isKokoroModelReady: isReady } = await Promise.resolve().then(() => __importStar(require('./kokoroModelDownloader')));
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
            this.kokoroEngine = (0, kokoroTtsEngine_1.createKokoroTtsEngine)(async () => this.modelPaths);
            this.kokoroChecked = true;
            console.log('[TTS] Kokoro-82M engine ready.');
            return this.kokoroEngine;
        }
        catch (err) {
            console.error('[TTS] Failed to initialize Kokoro engine:', err);
            this.kokoroChecked = true;
            return null;
        }
        finally {
            this.kokoroDownloading = false;
        }
    }
    async speak(text) {
        if (!text || text.trim().length === 0)
            return;
        this.stopSpeaking();
        // N-08: cloud-first. A configured + enabled cloud TTS provider speaks the
        // utterance; on any failure we fall through to the local chain below.
        const cloud = this.resolveCloudTts?.() ?? null;
        if (cloud) {
            try {
                await this.speakViaEngine((0, cloudTtsEngine_1.createCloudTtsEngine)(cloud), text);
                return;
            }
            catch (err) {
                const reason = err instanceof Error ? err.message : String(err);
                if (Date.now() - this.cloudNoticeAt > 30_000) {
                    this.cloudNoticeAt = Date.now();
                    this.noticeSender?.(`Cloud TTS (${cloud.displayName}) failed (${reason}). Using the local voice instead.`);
                }
            }
        }
        if (this.kokoroEngine) {
            await this.speakViaEngine(this.kokoroEngine, text);
        }
        else if (this.kokoroChecked || !isElectronAvailable()) {
            if (!this.kokoroChecked)
                this.kokoroChecked = true;
            await this.speakViaOs(text);
        }
        else {
            const kokoro = await this.resolveKokoroEngine();
            if (kokoro) {
                await this.speakViaEngine(kokoro, text);
            }
            else {
                await this.speakViaOs(text);
            }
        }
    }
    async speakViaEngine(engine, text) {
        const pcm = await engine.synthesize(text);
        if (pcm.length === 0)
            return;
        // An OSS engine reports its own sample rate; older engines default to the
        // Kokoro rate so the WAV header always matches what we wrote.
        const wav = (0, pcmWav_1.encodePcm16Wav)(pcm, engine.sampleRate ?? KOKORO_SAMPLE_RATE);
        const dir = await (0, promises_1.mkdtemp)((0, path_1.join)((0, os_1.tmpdir)(), 'kyclius-tts-'));
        const wavPath = (0, path_1.join)(dir, 'utterance.wav');
        try {
            await (0, promises_1.writeFile)(wavPath, wav);
            const platform = process.platform;
            const command = buildOsPlayerCommand(platform, wavPath);
            await new Promise((resolve, reject) => {
                let settled = false;
                const child = (0, child_process_1.spawn)(command.file, command.args, {
                    stdio: ['ignore', 'ignore', 'ignore'],
                    windowsHide: true,
                });
                this.currentProcess = child;
                const settle = (fn) => {
                    if (!settled) {
                        settled = true;
                        if (this.currentProcess === child)
                            this.currentProcess = null;
                        fn();
                    }
                };
                child.on('error', err => settle(() => reject(Object.assign(new Error(`Audio playback failed: ${err.message}`), {
                    code: 'tts_error',
                }))));
                child.on('close', code => {
                    if (code === 0) {
                        settle(() => resolve());
                    }
                    else {
                        settle(() => reject(Object.assign(new Error(`Audio player exited with code ${code}`), {
                            code: 'tts_error',
                        })));
                    }
                });
            });
        }
        finally {
            await Promise.allSettled([(0, promises_1.unlink)(wavPath)]);
            await Promise.resolve().then(() => __importStar(require('fs/promises'))).then(fs => fs.rmdir(dir).catch(() => { }));
        }
    }
    async speakViaOs(text) {
        const platform = process.platform;
        const command = buildSpeakCommand(platform, text);
        await new Promise((resolve, reject) => {
            let settled = false;
            let stderrOutput = '';
            const child = (0, child_process_1.spawn)(command.file, command.args, {
                stdio: ['pipe', 'ignore', 'pipe'],
                windowsHide: true,
            });
            this.currentProcess = child;
            const settle = (fn) => {
                if (!settled) {
                    settled = true;
                    if (this.currentProcess === child)
                        this.currentProcess = null;
                    fn();
                }
            };
            child.on('error', err => {
                settle(() => reject(Object.assign(new Error(`Text-to-speech engine could not be started: ${err.message}`), {
                    code: 'tts_error',
                })));
            });
            child.stderr?.on('data', chunk => {
                stderrOutput += String(chunk);
            });
            child.on('close', code => {
                if (code === 0) {
                    settle(() => resolve());
                }
                else {
                    settle(() => reject(Object.assign(new Error(`Text-to-speech failed (exit ${code})${stderrOutput ? `: ${stderrOutput.trim()}` : ''}`), { code: 'tts_error' })));
                }
            });
            if (platform === 'win32' && child.stdin) {
                child.stdin.write(text);
                child.stdin.end();
            }
        });
    }
    stopSpeaking() {
        if (this.currentProcess) {
            try {
                this.currentProcess.kill();
            }
            catch {
                // process may have already exited
            }
            this.currentProcess = null;
        }
    }
    isSpeaking() {
        return this.currentProcess !== null;
    }
}
exports.ttsService = new TtsService();
