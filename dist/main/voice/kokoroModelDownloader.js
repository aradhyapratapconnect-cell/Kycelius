"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureKokoroModel = ensureKokoroModel;
exports.isKokoroModelReady = isKokoroModelReady;
const electron_1 = require("electron");
const promises_1 = require("fs/promises");
const path_1 = require("path");
const fs_1 = require("fs");
const promises_2 = require("stream/promises");
const stream_1 = require("stream");
const KOKORO_REPO = 'onnx-community/Kokoro-82M-ONNX';
const BASE_URL = `https://huggingface.co/${KOKORO_REPO}/resolve/main`;
/** CMUdict lexicon for the G2P front-end (public domain, ~3.6 MB). */
const CMU_BASE_URL = 'https://raw.githubusercontent.com/cmusphinx/cmudict/master';
const FILES = [
    { path: 'onnx/model_quantized.onnx', localName: 'model.onnx' },
    { path: 'voices/af.bin', localName: 'voice_af.bin' },
    { path: 'tokenizer.json', localName: 'tokenizer.json' },
    { path: 'cmudict.dict', localName: 'cmudict.dict', base: CMU_BASE_URL },
];
function getKokoroDir() {
    return (0, path_1.join)(electron_1.app.getPath('userData'), 'kokoro');
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
            console.error(`[kokoro-model-download] attempt ${attempt}/${RETRY_COUNT} failed for ${url}:`, lastError.message);
            if (attempt < RETRY_COUNT) {
                const delay = RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }
    throw lastError ?? new Error(`Download failed after ${RETRY_COUNT} attempts: ${url}`);
}
async function downloadAttempt(url, destPath, onProgress) {
    console.log(`[kokoro-model-download] GET ${url}`);
    const response = await fetch(url, {
        headers: { 'User-Agent': 'kyclius-desktop/2.6.1' },
    });
    console.log(`[kokoro-model-download] ${response.status} ${response.statusText} for ${url}`);
    if (!response.ok) {
        if (response.status === 401) {
            throw new Error(`Couldn't download the model — the server refused the request (401). ` +
                `Check your connection or try again later. URL: ${url}`);
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
 * Downloads the Kokoro-82M ONNX model, default voice, tokenizer, and the
 * CMUdict G2P lexicon to the app's userData directory. Skips files that
 * already exist. Returns the local paths to the downloaded files.
 */
async function ensureKokoroModel(onProgress) {
    const dir = getKokoroDir();
    await (0, promises_1.mkdir)(dir, { recursive: true });
    const paths = {};
    for (const file of FILES) {
        const localPath = (0, path_1.join)(dir, file.localName);
        paths[file.localName] = localPath;
        if (await fileExists(localPath)) {
            continue;
        }
        const base = 'base' in file && typeof file.base === 'string' ? file.base : BASE_URL;
        const url = `${base}/${file.path}`;
        await downloadFile(url, localPath, (downloaded, total) => {
            onProgress?.({ file: file.localName, downloaded, total });
        });
    }
    return {
        modelPath: paths['model.onnx'],
        voicePath: paths['voice_af.bin'],
        tokenizerPath: paths['tokenizer.json'],
        lexiconPath: paths['cmudict.dict'],
    };
}
/**
 * Checks if the Kokoro model files are already downloaded locally.
 */
async function isKokoroModelReady() {
    const dir = getKokoroDir();
    for (const file of FILES) {
        if (!(await fileExists((0, path_1.join)(dir, file.localName))))
            return false;
    }
    return true;
}
