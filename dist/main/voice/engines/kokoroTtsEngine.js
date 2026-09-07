"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.KokoroEngineError = exports.KokoroModelNotConfiguredError = void 0;
exports.createKokoroTtsEngine = createKokoroTtsEngine;
const promises_1 = require("fs/promises");
const path_1 = require("path");
const kokoroG2p_1 = require("./kokoroG2p");
class KokoroModelNotConfiguredError extends Error {
    constructor() {
        super('Kokoro-82M TTS model is not configured. The app will fall back to OS-native speech.');
        this.name = 'KokoroModelNotConfiguredError';
    }
}
exports.KokoroModelNotConfiguredError = KokoroModelNotConfiguredError;
class KokoroEngineError extends Error {
    constructor(detail) {
        super(`Kokoro TTS engine error: ${detail}`);
        this.name = 'KokoroEngineError';
    }
}
exports.KokoroEngineError = KokoroEngineError;
const MAX_TOKENS = 512;
function loadOnnxRuntime() {
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        return require('onnxruntime-node');
    }
    catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        throw new KokoroEngineError(`Failed to load ONNX runtime: ${detail}`);
    }
}
/**
 * Loads a Kokoro voice file (.bin) containing Float32 embeddings.
 * The file is a flat Float32Array of shape [MAX_TOKENS, 1, 256].
 * We select the row corresponding to the actual token count.
 */
async function loadVoiceFile(voicePath) {
    const buf = await (0, promises_1.readFile)(voicePath);
    const float32 = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
    // Reshape into rows of 256 floats each
    const rows = [];
    const ROW_SIZE = 256;
    for (let i = 0; i < float32.length; i += ROW_SIZE) {
        rows.push(float32.slice(i, i + ROW_SIZE));
    }
    return rows;
}
function buildVocabFromTokenizerJson(tokenizerJson) {
    const vocab = new Map();
    const vocabObj = tokenizerJson.model?.vocab;
    if (vocabObj) {
        for (const [token, id] of Object.entries(vocabObj)) {
            vocab.set(token, id);
        }
    }
    // Also map added tokens (like special tokens)
    const added = tokenizerJson.added_tokens;
    if (added) {
        for (const tok of added) {
            vocab.set(tok.content, tok.id);
        }
    }
    return vocab;
}
/**
 * Tokenizes a phoneme string using the loaded vocabulary. Each symbol is
 * mapped to its token ID, or 0 (unknown/pad) if not found. The Kokoro model
 * expects pad token 0 at the start and end of the sequence.
 *
 * NOTE: the input must already be IPA phonemes (see phonemize()), NOT raw
 * text — feeding raw characters maps letters to unrelated phoneme slots and
 * produces garbled audio.
 */
function tokenize(text, vocab) {
    const ids = [];
    for (const ch of text) {
        ids.push(vocab.get(ch) ?? 0);
    }
    // Pad with 0 at start and end as per Kokoro convention
    return [0, ...ids, 0];
}
/**
 * Kokoro-82M ONNX TTS engine.
 *
 * Runs the Kokoro text-to-speech model locally via onnxruntime-node.
 * Expected ONNX model inputs: `input_ids` [1, <=512] int64, `style` [1, 256] float32, `speed` [1] float32.
 * Output: audio waveform at 24 000 Hz mono.
 *
 * The encoder's `/encoder/bert/Expand` node requires `input_ids` to be at
 * most 512 tokens; longer sequences fail with "invalid expand shape".
 *
 * Model files (Apache-2.0 license) are auto-downloaded to userData/kokoro/
 * on first launch, or can be pointed to manually via Settings.
 */
function createKokoroTtsEngine(getConfig) {
    let session = null;
    let sessionModelPath = '';
    let voiceRows = null;
    let voiceLoadedPath = '';
    let vocab = null;
    let vocabLoadedPath = '';
    let lexiconWarned = false;
    async function getLexiconPath(config) {
        return config.lexiconPath ?? (0, path_1.join)((0, path_1.dirname)(config.tokenizerPath), 'cmudict.dict');
    }
    async function getSession(config) {
        if (session && sessionModelPath === config.modelPath)
            return session;
        const ort = loadOnnxRuntime();
        try {
            // Pass the raw filesystem path. On this onnxruntime-node build, passing a
            // file:// URI (either file://C:\... or file:///C:/...) fails with the
            // generic "Load model ... failed" error, while the plain absolute path
            // loads the session correctly. onnxruntime-node resolves local paths
            // directly, so no URI encoding is needed here.
            session = (await ort.InferenceSession.create(config.modelPath));
            sessionModelPath = config.modelPath;
            return session;
        }
        catch (err) {
            const detail = err instanceof Error ? err.message : String(err);
            throw new KokoroEngineError(`Could not load ONNX model: ${detail}`);
        }
    }
    async function getVoice(config) {
        if (voiceRows && voiceLoadedPath === config.voicePath)
            return voiceRows;
        try {
            voiceRows = await loadVoiceFile(config.voicePath);
            voiceLoadedPath = config.voicePath;
            return voiceRows;
        }
        catch (err) {
            const detail = err instanceof Error ? err.message : String(err);
            throw new KokoroEngineError(`Could not load voice file: ${detail}`);
        }
    }
    async function getVocab(config) {
        if (vocab && vocabLoadedPath === config.tokenizerPath)
            return vocab;
        try {
            const raw = await (0, promises_1.readFile)(config.tokenizerPath, 'utf-8');
            const json = JSON.parse(raw);
            vocab = buildVocabFromTokenizerJson(json);
            vocabLoadedPath = config.tokenizerPath;
            return vocab;
        }
        catch (err) {
            const detail = err instanceof Error ? err.message : String(err);
            throw new KokoroEngineError(`Could not load tokenizer: ${detail}`);
        }
    }
    return {
        id: 'kokoro',
        sampleRate: 24_000, // Kokoro-82M outputs at 24 kHz.
        async synthesize(text) {
            if (!text || text.trim().length === 0)
                return new Float32Array(0);
            const config = await getConfig();
            const ortSession = await getSession(config);
            const ort = loadOnnxRuntime();
            const voice = await getVoice(config);
            const vocabMap = await getVocab(config);
            // G2P front-end: raw text -> IPA phonemes via the CMUdict lexicon. The
            // model is trained on phoneme sequences; feeding raw characters maps
            // letters to unrelated phoneme slots and produces garbled audio.
            const lexicon = await (0, kokoroG2p_1.loadLexicon)(await getLexiconPath(config));
            if (!lexicon && !lexiconWarned) {
                lexiconWarned = true;
                console.warn('[kokoroTtsEngine] cmudict.dict not found — falling back to character tokenization (pronunciation will be degraded).');
            }
            const phonemes = (0, kokoroG2p_1.phonemize)(text, lexicon);
            let tokenIds = tokenize(phonemes, vocabMap);
            if (tokenIds.length > MAX_TOKENS) {
                // The encoder's Expand node rejects input_ids longer than 512 with
                // "invalid expand shape". Truncate the content tokens while keeping the
                // leading/trailing pad-0 that Kokoro expects.
                tokenIds = [0, ...tokenIds.slice(1, MAX_TOKENS - 1), 0];
                console.log(`[kokoroTtsEngine] text exceeds model max length (${MAX_TOKENS - 2} tokens); truncating to ${MAX_TOKENS} tokens`);
            }
            if (tokenIds.length <= 2) {
                throw new KokoroEngineError('Text produced no tokens after normalization.');
            }
            // Select style vector based on token count (excluding pad tokens)
            const actualTokens = tokenIds.length - 2; // subtract start/end pads
            const styleIndex = Math.min(actualTokens, voice.length - 1);
            const styleVector = voice[styleIndex];
            const inputName = ortSession.inputNames[0];
            // Model may have multiple inputs; find style and speed by name
            const styleInput = ortSession.inputNames.find(n => n === 'style');
            const speedInput = ortSession.inputNames.find(n => n === 'speed');
            const feeds = {
                [inputName]: new ort.Tensor('int64', new BigInt64Array(tokenIds.map(id => BigInt(id))), [1, tokenIds.length]),
            };
            if (styleInput && styleVector) {
                // Style is a rank-2 tensor [1, 256] for this Kokoro ONNX model. (A
                // [1, 1, 256] rank-3 shape was rejected with "Invalid rank for input:
                // style Got: 3 Expected: 2".)
                feeds[styleInput] = new ort.Tensor('float32', new Float32Array(styleVector), [1, 256]);
            }
            if (speedInput) {
                feeds[speedInput] = new ort.Tensor('float32', new Float32Array([1.0]), [1]);
            }
            let outputs;
            try {
                outputs = (await ortSession.run(feeds));
            }
            catch (err) {
                const detail = err instanceof Error ? err.message : String(err);
                throw new KokoroEngineError(`ONNX inference failed: ${detail}`);
            }
            // Find the audio output (first output or named 'audio')
            const outputName = ortSession.outputNames.find(n => n === 'audio') ?? ortSession.outputNames[0];
            const raw = outputs[outputName]?.data;
            if (!raw || raw.length === 0) {
                throw new KokoroEngineError('Model produced empty audio output.');
            }
            return raw instanceof Float32Array ? raw : new Float32Array(raw);
        },
    };
}
