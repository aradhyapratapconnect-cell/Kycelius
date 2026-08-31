"use strict";
// Neural voice-activity detector (STT upgrade, step 1a): runs Silero VAD
// (ONNX export) locally via onnxruntime-node, replacing the naive RMS energy
// threshold as the speech/silence decision inside sttService.
//
// Mirrors the ecapaOnnxEmbedder's configuration model: the user supplies the
// ONNX model file (Settings -> `vad_model_path`) and everything runs fully
// offline, in-memory — audio frames go straight into the tensor and only a
// speech probability comes back out. No audio is ever persisted or sent
// anywhere.
//
// The runtime import is lazy: onnxruntime-node's native library is only
// loaded the first time detection actually runs, so app startup, tests, and
// users who stay on the RMS fallback pay nothing for it.
Object.defineProperty(exports, "__esModule", { value: true });
exports.SILERO_VAD_FRAME_SAMPLES = exports.VadEngineUnavailableError = exports.VadModelNotConfiguredError = void 0;
exports.resolveSileroVadConfig = resolveSileroVadConfig;
exports.createSileroVad = createSileroVad;
const promises_1 = require("fs/promises");
class VadModelNotConfiguredError extends Error {
    constructor() {
        super('Neural voice activity detection is not configured. Set the Silero VAD ONNX model path in Settings to enable it; Kyclius will use basic volume-based detection until then.');
        this.name = 'VadModelNotConfiguredError';
    }
}
exports.VadModelNotConfiguredError = VadModelNotConfiguredError;
class VadEngineUnavailableError extends Error {
    constructor(detail) {
        super(`The neural voice-activity detector failed to run: ${detail}`);
        this.name = 'VadEngineUnavailableError';
    }
}
exports.VadEngineUnavailableError = VadEngineUnavailableError;
/** Standard Silero VAD v5 frame size at 16 kHz. */
exports.SILERO_VAD_FRAME_SAMPLES = 512;
/** Hidden-state size of Silero VAD's LSTM (2 layers x 128 units). */
const STATE_ELEMENTS = 2 * 1 * 128;
async function resolveSileroVadConfig(getSetting) {
    const modelPath = getSetting('vad_model_path');
    if (!modelPath)
        throw new VadModelNotConfiguredError();
    try {
        await (0, promises_1.access)(modelPath);
    }
    catch {
        throw new VadModelNotConfiguredError();
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
        throw new VadEngineUnavailableError(detail);
    }
}
/**
 * Builds a local speech detector around a Silero VAD ONNX export (v5 layout:
 * inputs `input` [1, N] float32 @16kHz, `state` [2, 1, 128] float32,
 * `sr` int64 scalar; outputs `output` [1, 1] probability, `stateN`).
 * `getConfig` is consulted lazily so adding/changing the model in Settings
 * takes effect without an app restart.
 */
function createSileroVad(getConfig) {
    let session = null;
    let sessionModelPath = '';
    let cachedOrt = null;
    let state = new Float32Array(STATE_ELEMENTS);
    let threshold = 0.5;
    function getOrt() {
        if (!cachedOrt)
            cachedOrt = loadOnnxRuntime();
        return cachedOrt;
    }
    async function getSession(modelPath) {
        if (session && sessionModelPath === modelPath)
            return session;
        const ort = getOrt();
        try {
            session = (await ort.InferenceSession.create(`file://${modelPath}`));
            sessionModelPath = modelPath;
            state = new Float32Array(STATE_ELEMENTS);
            return session;
        }
        catch (err) {
            const detail = err instanceof Error ? err.message : String(err);
            throw new VadEngineUnavailableError(detail);
        }
    }
    return {
        async process(frame) {
            const config = await getConfig();
            threshold = config.threshold ?? threshold;
            const ortSession = await getSession(config.modelPath);
            const ort = getOrt();
            const inputName = ortSession.inputNames.includes('input')
                ? 'input'
                : ortSession.inputNames[0];
            const outputName = ortSession.outputNames.includes('output')
                ? 'output'
                : ortSession.outputNames[0];
            const nextStateName = ortSession.outputNames.includes('stateN')
                ? 'stateN'
                : ortSession.outputNames[1];
            const feeds = {
                [inputName]: new ort.Tensor('float32', frame.slice(), [1, frame.length]),
                state: new ort.Tensor('float32', state, [2, 1, 128]),
                sr: new ort.Tensor('int64', BigInt64Array.from([16000n]), [1]),
            };
            let outputs;
            try {
                outputs = (await ortSession.run(feeds));
            }
            catch (err) {
                const detail = err instanceof Error ? err.message : String(err);
                throw new VadEngineUnavailableError(detail);
            }
            const nextState = outputs[nextStateName]?.data ?? [];
            for (let i = 0; i < Math.min(STATE_ELEMENTS, nextState.length); i++) {
                state[i] = Number(nextState[i]);
            }
            const probability = Number(outputs[outputName]?.data?.[0] ?? 0);
            return probability >= threshold;
        },
        reset() {
            state.fill(0);
        },
    };
}
