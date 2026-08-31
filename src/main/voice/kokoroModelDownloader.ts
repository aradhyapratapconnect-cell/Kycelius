import { app } from 'electron';
import { access, mkdir } from 'fs/promises';
import { join } from 'path';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';

const KOKORO_REPO = 'onnx-community/Kokoro-82M-ONNX';
const BASE_URL = `https://huggingface.co/${KOKORO_REPO}/resolve/main`;

const FILES = [
  { path: 'onnx/model_quantized.onnx', localName: 'model.onnx' },
  { path: 'voices/af.bin', localName: 'voice_af.bin' },
  { path: 'tokenizer.json', localName: 'tokenizer.json' },
] as const;

export interface DownloadProgress {
  file: string;
  downloaded: number;
  total: number;
}

function getKokoroDir(): string {
  return join(app.getPath('userData'), 'kokoro');
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

const RETRY_COUNT = 3;
const RETRY_BASE_DELAY_MS = 500;

async function downloadFile(
  url: string,
  destPath: string,
  onProgress?: (downloaded: number, total: number) => void
): Promise<void> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= RETRY_COUNT; attempt++) {
    try {
      await downloadAttempt(url, destPath, onProgress);
      return;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.error(
        `[kokoro-model-download] attempt ${attempt}/${RETRY_COUNT} failed for ${url}:`,
        lastError.message
      );
      if (attempt < RETRY_COUNT) {
        const delay = RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError ?? new Error(`Download failed after ${RETRY_COUNT} attempts: ${url}`);
}

async function downloadAttempt(
  url: string,
  destPath: string,
  onProgress?: (downloaded: number, total: number) => void
): Promise<void> {
  console.log(`[kokoro-model-download] GET ${url}`);
  const response = await fetch(url, {
    headers: { 'User-Agent': 'kyclius-desktop/2.6.1' },
  });
  console.log(`[kokoro-model-download] ${response.status} ${response.statusText} for ${url}`);

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error(
        `Couldn't download the model — the server refused the request (401). ` +
          `Check your connection or try again later. URL: ${url}`
      );
    }
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
  }

  const total = Number(response.headers.get('content-length')) || 0;
  if (!response.body) {
    throw new Error(`No response body for ${url}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nodeStream = Readable.fromWeb(response.body as any);
  const fileStream = createWriteStream(destPath);

  let downloaded = 0;
  nodeStream.on('data', (chunk: Buffer) => {
    downloaded += chunk.length;
    onProgress?.(downloaded, total);
  });

  await pipeline(nodeStream, fileStream);
}

export interface KokoroModelPaths {
  modelPath: string;
  voicePath: string;
  tokenizerPath: string;
}

/**
 * Downloads the Kokoro-82M ONNX model, default voice, and tokenizer from
 * HuggingFace to the app's userData directory. Skips files that already exist.
 * Returns the local paths to the downloaded files.
 */
export async function ensureKokoroModel(
  onProgress?: (progress: DownloadProgress) => void
): Promise<KokoroModelPaths> {
  const dir = getKokoroDir();
  await mkdir(dir, { recursive: true });

  const paths: Record<string, string> = {};

  for (const file of FILES) {
    const localPath = join(dir, file.localName);
    paths[file.localName] = localPath;

    if (await fileExists(localPath)) {
      continue;
    }

    const url = `${BASE_URL}/${file.path}`;
    await downloadFile(url, localPath, (downloaded, total) => {
      onProgress?.({ file: file.localName, downloaded, total });
    });
  }

  return {
    modelPath: paths['model.onnx'],
    voicePath: paths['voice_af.bin'],
    tokenizerPath: paths['tokenizer.json'],
  };
}

/**
 * Checks if the Kokoro model files are already downloaded locally.
 */
export async function isKokoroModelReady(): Promise<boolean> {
  const dir = getKokoroDir();
  for (const file of FILES) {
    if (!(await fileExists(join(dir, file.localName)))) return false;
  }
  return true;
}
