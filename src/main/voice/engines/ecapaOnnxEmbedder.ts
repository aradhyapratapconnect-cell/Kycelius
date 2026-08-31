// Speaker embedding engine (F-10): SpeechBrain's ECAPA-TDNN speaker-verification
// model exported to ONNX and executed locally via onnxruntime-node.
//
// Mirrors the whisper.cpp engine's configuration model: the user supplies the
// ONNX model file (Settings -> `speaker_model_path`) and everything runs fully
// offline, in-memory. Raw audio is never written to disk — samples arrive as
// Float32Array, go straight into the tensor, and only the numeric embedding
// comes back out.
//
// The runtime import is lazy: onnxruntime-node's native library is only loaded
// the first time an embedding is actually requested, so app startup, tests,
// and users who never enroll biometrics pay nothing for it.

import { access } from 'fs/promises';

export interface SpeakerEmbedder {
  embed(pcm: Float32Array): Promise<number[]>;
}

export interface EcapaEmbedderConfig {
  modelPath: string;
}

export class SpeakerModelNotConfiguredError extends Error {
  constructor() {
    super(
      'Voice recognition needs a local speaker model. Set the ECAPA-TDNN ONNX model path in Settings, or turn off voice biometrics.'
    );
    this.name = 'SpeakerModelNotConfiguredError';
  }
}

export class SpeakerEngineUnavailableError extends Error {
  constructor(detail: string) {
    super(`The local voice-recognition engine failed to start: ${detail}`);
    this.name = 'SpeakerEngineUnavailableError';
  }
}

/** Expected input length for standard ECAPA-TDNN VoxCeleb ONNX exports (3s @ 16kHz). */
const DEFAULT_INPUT_SAMPLES = 16000 * 3;

export async function resolveSpeakerModelConfig(
  getSetting: (key: string) => string | undefined
): Promise<EcapaEmbedderConfig> {
  const modelPath = getSetting('speaker_model_path');
  if (!modelPath) throw new SpeakerModelNotConfiguredError();

  try {
    await access(modelPath);
  } catch {
    throw new SpeakerModelNotConfiguredError();
  }

  return { modelPath };
}

interface OrtSessionLike {
  run(feeds: Record<string, unknown>): Promise<Record<string, { data: Float32Array | number[] }>>;
  outputNames: readonly string[];
  inputNames: readonly string[];
}

function loadOnnxRuntime(): {
  InferenceSession: {
    create(pathUri: string): Promise<OrtSessionLike>;
  };
  Tensor: new (type: 'float32', data: Float32Array, dims: number[]) => unknown;
} {
  try {
    // Lazy CommonJS require keeps the native addon out of app startup/tests.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('onnxruntime-node');
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new SpeakerEngineUnavailableError(detail);
  }
}

/**
 * Builds a local speaker embedder around an ECAPA-TDNN ONNX export.
 * `getConfig` is consulted lazily so a model added/changed in Settings takes
 * effect without an app restart; sessions are cached per resolved model path.
 */
export function createEcapaOnnxEmbedder(
  getConfig: () => Promise<EcapaEmbedderConfig>
): SpeakerEmbedder {
  let session: OrtSessionLike | null = null;
  let sessionModelPath = '';

  async function getSession(modelPath: string): Promise<OrtSessionLike> {
    if (session && sessionModelPath === modelPath) return session;

    const ort = loadOnnxRuntime();
    try {
      // Pass the raw filesystem path. This onnxruntime-node build rejects
      // file:// URIs ("Load model ... failed"); the plain absolute path loads
      // correctly. (Same fix as kokoroTtsEngine.ts.)
      session = (await ort.InferenceSession.create(modelPath)) as OrtSessionLike;
      sessionModelPath = modelPath;
      return session;
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new SpeakerEngineUnavailableError(detail);
    }
  }

  return {
    async embed(pcm: Float32Array): Promise<number[]> {
      const config = await getConfig();
      const ortSession = await getSession(config.modelPath);

      const ort = loadOnnxRuntime();

      // Standard exports expect [1, N] float32 raw waveform at 16kHz mono.
      const inputSamples = DEFAULT_INPUT_SAMPLES;
      const window = new Float32Array(inputSamples);
      window.set(pcm.subarray(0, Math.min(pcm.length, inputSamples)));

      const inputName = ortSession.inputNames[0];
      const outputName = ortSession.outputNames[0];

      let outputs: Record<string, { data: Float32Array | number[] }>;
      try {
        outputs = (await ortSession.run({
          [inputName]: new ort.Tensor('float32', window, [1, inputSamples]),
        })) as Record<string, { data: Float32Array | number[] }>;
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        throw new SpeakerEngineUnavailableError(detail);
      }

      const embedding = Array.from(outputs[outputName]?.data ?? []);
      if (embedding.length === 0) {
        throw new SpeakerEngineUnavailableError('model produced an empty embedding');
      }
      return l2Normalize(embedding);
    },
  };
}

export function l2Normalize(vector: number[]): number[] {
  const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
  if (magnitude === 0) return vector.map(() => 0);
  return vector.map(v => v / magnitude);
}
