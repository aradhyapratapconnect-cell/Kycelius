"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WHISPER_MODELS = void 0;
exports.getWhisperModelInfo = getWhisperModelInfo;
exports.getWhisperModelLocalPath = getWhisperModelLocalPath;
exports.ensureWhisperModel = ensureWhisperModel;
const electron_1 = require("electron");
const promises_1 = require("fs/promises");
const path_1 = require("path");
const fs_1 = require("fs");
const promises_2 = require("stream/promises");
const stream_1 = require("stream");
const timeouts_1 = require("../utils/timeouts");
// EF-02: the old `ggml-org/whisper` repo is gated and now returns 401 to
// unauthenticated requests. The public mirror that hosts the whisper.cpp models
// is `ggerganov/whisper.cpp` (canonical home for ggml Whisper weights). Verified
// note included in the fix report.
// Fallback: whisper.cpp release assets on GitHub (always public, no auth)
const WHISPER_REPO = 'ggerganov/whisper.cpp';
const BASE_URL = `https://huggingface.co/${WHISPER_REPO}/resolve/main`;
const GITHUB_BASE_URL = 'https://github.com/ggerganov/whisper.cpp/releases/download';
exports.WHISPER_MODELS = [
    {
        id: 'large-v3-turbo',
        label: 'Large v3 Turbo',
        fileName: 'ggml-large-v3-turbo-q5_0.bin',
        description: 'Default. Highest accuracy, ~500 MB download.',
        // Primary: Hugging Face mirror; fallback: GitHub releases
        urls: [
            `${BASE_URL}/ggml-large-v3-turbo-q5_0.bin`,
            `${GITHUB_BASE_URL}/v1.6.0/ggml-large-v3-turbo-q5_0.bin`,
        ],
    },
    {
        id: 'small',
        label: 'Small',
        // EF-02: repo ships `ggml-small.en-q5_1.bin`, not `q5_0` — the old name 404'd.
        fileName: 'ggml-small.en-q5_1.bin',
        description: 'Step-down fallback. Faster, English-optimized, ~46 MB download.',
        urls: [
            `${BASE_URL}/ggml-small.en-q5_1.bin`,
            `${GITHUB_BASE_URL}/v1.6.0/ggml-small.en-q5_1.bin`,
        ],
    },
];
function getWhisperModelInfo(id) {
    return exports.WHISPER_MODELS.find(m => m.id === id);
}
function getWhisperDir() {
    return (0, path_1.join)(electron_1.app.getPath('userData'), 'whisper');
}
function getWhisperModelLocalPath(id) {
    const info = getWhisperModelInfo(id);
    return info ? (0, path_1.join)(getWhisperDir(), info.fileName) : '';
}
async function fileExists(path) {
    try {
        await (0, promises_1.access)(path);
        return true;
    }
    catch {
        return false;
    }
}
const RETRY_COUNT = 3;
const RETRY_BASE_DELAY_MS = 500;
async function downloadFile(url, destPath, onProgress) {
    let lastError;
    for (let attempt = 1; attempt <= RETRY_COUNT; attempt++) {
        try {
            await downloadAttempt(url, destPath, onProgress);
            return;
        }
        catch (err) {
            lastError = err instanceof Error ? err : new Error(String(err));
            console.error(`[whisper-model-download] attempt ${attempt}/${RETRY_COUNT} failed for ${url}:`, lastError.message);
            if (attempt < RETRY_COUNT) {
                const delay = RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }
    throw lastError ?? new Error(`Download failed after ${RETRY_COUNT} attempts: ${url}`);
}
async function downloadAttempt(url, destPath, onProgress) {
    // EF-02: log the exact outgoing request (URL + headers). A public download
    // must not carry an Authorization header — if one ever appears, that's the
    // first place to hunt for the 401.
    console.log(`[whisper-model-download] GET ${url}`);
    // EF-10: enforced per-attempt timeout so a stalled mirror cannot hang the app.
    const response = await (0, timeouts_1.fetchWithTimeout)(url, {
        headers: { 'User-Agent': 'kyclius-desktop/2.6.1' },
        timeoutMs: timeouts_1.MODEL_DOWNLOAD_TIMEOUT_MS,
    });
    console.log(`[whisper-model-download] ${response.status} ${response.statusText} for ${url}` +
        (response.headers.has('authorization') ? ' (NOTE: response Authorization present)' : ''));
    if (!response.ok) {
        if (response.status === 401) {
            throw new Error(`Couldn't download the model — the server refused the request (401). ` +
                `This usually means the model URL is no longer public. Check your connection or try again later. ` +
                `URL: ${url}`);
        }
        throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
    }
    const total = Number(response.headers.get('content-length')) || 0;
    if (!response.body) {
        throw new Error(`No response body for ${url}`);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nodeStream = stream_1.Readable.fromWeb(response.body);
    const fileStream = (0, fs_1.createWriteStream)(destPath);
    let downloaded = 0;
    nodeStream.on('data', (chunk) => {
        downloaded += chunk.length;
        onProgress?.(downloaded, total);
    });
    await (0, promises_2.pipeline)(nodeStream, fileStream);
}
/**
 * Downloads the selected whisper.cpp model from HuggingFace into
 * userData/whisper. Skips the download if the file already exists locally.
 * Returns the absolute path to the model file.
 */
async function ensureWhisperModel(id, onProgress) {
    const info = getWhisperModelInfo(id);
    if (!info)
        throw new Error(`Unknown whisper model: ${id}`);
    const dir = getWhisperDir();
    await (0, promises_1.mkdir)(dir, { recursive: true });
    const localPath = (0, path_1.join)(dir, info.fileName);
    if (await fileExists(localPath)) {
        return localPath;
    }
    // Try multiple URLs in order until one succeeds
    let lastError;
    for (const url of info.urls) {
        try {
            await downloadFile(url, localPath, (downloaded, total) => {
                onProgress?.({ model: id, downloaded, total });
            });
            return localPath;
        }
        catch (err) {
            lastError = err instanceof Error ? err : new Error(String(err));
            console.error(`[whisper-model-download] failed for ${url}:`, lastError.message);
        }
    }
    throw lastError ?? new Error(`All download mirrors failed for ${info.fileName}`);
}
