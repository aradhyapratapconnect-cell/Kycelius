"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.SpeakerEngineUnavailableError = exports.SpeakerModelNotConfiguredError = void 0;
exports.resolveSpeakerModelConfig = resolveSpeakerModelConfig;
exports.createEcapaOnnxEmbedder = createEcapaOnnxEmbedder;
exports.l2Normalize = l2Normalize;
const promises_1 = require("fs/promises");
class SpeakerModelNotConfiguredError extends Error {
    constructor() {
        super('Voice recognition needs a local speaker model. Set the ECAPA-TDNN ONNX model path in Settings, or turn off voice biometrics.');
        this.name = 'SpeakerModelNotConfiguredError';
    }
}
exports.SpeakerModelNotConfiguredError = SpeakerModelNotConfiguredError;
class SpeakerEngineUnavailableError extends Error {
    constructor(detail) {
        super(`The local voice-recognition engine failed to start: ${detail}`);
        this.name = 'SpeakerEngineUnavailableError';
    }
}
exports.SpeakerEngineUnavailableError = SpeakerEngineUnavailableError;
/** Expected input length for standard ECAPA-TDNN VoxCeleb ONNX exports (3s @ 16kHz). */
const DEFAULT_INPUT_SAMPLES = 16000 * 3;
async function resolveSpeakerModelConfig(getSetting) {
    const modelPath = getSetting('speaker_model_path');
    if (!modelPath)
        throw new SpeakerModelNotConfiguredError();
    try {
        await (0, promises_1.access)(modelPath);
    }
    catch {
        throw new SpeakerModelNotConfiguredError();
    }
    return { modelPath };
}
function loadOnnxRuntime() {
    try {
        // Lazy CommonJS require keeps the native addon out of app startup/tests.
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        return require('onnxruntime-node');
    }
    catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        throw new SpeakerEngineUnavailableError(detail);
    }
}
/**
 * Builds a local speaker embedder around an ECAPA-TDNN ONNX export.
 * `getConfig` is consulted lazily so a model added/changed in Settings takes
 * effect without an app restart; sessions are cached per resolved model path.
 */
function createEcapaOnnxEmbedder(getConfig) {
    let session = null;
    let sessionModelPath = '';
    async function getSession(modelPath) {
        if (session && sessionModelPath === modelPath)
            return session;
        const ort = loadOnnxRuntime();
        try {
            // Pass the raw filesystem path. This onnxruntime-node build rejects
            // file:// URIs ("Load model ... failed"); the plain absolute path loads
            // correctly. (Same fix as kokoroTtsEngine.ts.)
            session = (await ort.InferenceSession.create(modelPath));
            sessionModelPath = modelPath;
            return session;
        }
        catch (err) {
            const detail = err instanceof Error ? err.message : String(err);
            throw new SpeakerEngineUnavailableError(detail);
        }
    }
    return {
        async embed(pcm) {
            const config = await getConfig();
            const ortSession = await getSession(config.modelPath);
            const ort = loadOnnxRuntime();
            // Standard exports expect [1, N] float32 raw waveform at 16kHz mono.
            const inputSamples = DEFAULT_INPUT_SAMPLES;
            const window = new Float32Array(inputSamples);
            window.set(pcm.subarray(0, Math.min(pcm.length, inputSamples)));
            const inputName = ortSession.inputNames[0];
            const outputName = ortSession.outputNames[0];
            let outputs;
            try {
                outputs = (await ortSession.run({
                    [inputName]: new ort.Tensor('float32', window, [1, inputSamples]),
                }));
            }
            catch (err) {
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
function l2Normalize(vector) {
    const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
    if (magnitude === 0)
        return vector.map(() => 0);
    return vector.map(v => v / magnitude);
}
