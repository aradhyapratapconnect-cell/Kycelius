"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = require("fs");
const vitest_1 = require("vitest");
const kokoroTtsEngine_1 = require("../engines/kokoroTtsEngine");
const MODEL_PATH = 'C:\\Users\\aradh\\AppData\\Roaming\\kyclius\\kokoro\\model.onnx';
const VOICE_PATH = 'C:\\Users\\aradh\\AppData\\Roaming\\kyclius\\kokoro\\voice_af.bin';
const TOKENIZER_PATH = 'C:\\Users\\aradh\\AppData\\Roaming\\kyclius\\kokoro\\tokenizer.json';
const modelPresent = (0, fs_1.existsSync)(MODEL_PATH) && (0, fs_1.existsSync)(VOICE_PATH) && (0, fs_1.existsSync)(TOKENIZER_PATH);
(0, vitest_1.describe)('Kokoro TTS engine model loading', () => {
    // EF fix: onnxruntime-node@1.27 on this platform fails to load the model
    // when given a file:// URI (both file://C:\... and file:///C:/... produce
    // "Load model ... failed"), but loads it fine from the raw filesystem path.
    // This integration test loads the real session to guard against regressing
    // back to a file:// form, and skips if the model files aren't installed.
    vitest_1.it.skipIf(!modelPresent)('loads the real ONNX model from the raw path (no file:// URI)', async () => {
        const engine = (0, kokoroTtsEngine_1.createKokoroTtsEngine)(async () => ({
            modelPath: MODEL_PATH,
            voicePath: VOICE_PATH,
            tokenizerPath: TOKENIZER_PATH,
        }));
        // 'hello' -> non-trivial token sequence; if session creation fails on the
        // path, we get the "Could not load ONNX model" error we're guarding against.
        const out = await engine.synthesize('hello');
        (0, vitest_1.expect)(out.length).toBeGreaterThan(0);
    }, 30000);
    vitest_1.it.skipIf(!modelPresent)('truncates over-long text instead of failing the Encoder Expand node', async () => {
        const engine = (0, kokoroTtsEngine_1.createKokoroTtsEngine)(async () => ({
            modelPath: MODEL_PATH,
            voicePath: VOICE_PATH,
            tokenizerPath: TOKENIZER_PATH,
        }));
        // 600+ characters -> tokenizes to well over 512 tokens, which previously
        // crashed the /encoder/bert/Expand node with "invalid expand shape".
        const longText = 'repeat after me. '.repeat(45); // ~630 chars
        const out = await engine.synthesize(longText);
        (0, vitest_1.expect)(out.length).toBeGreaterThan(0);
    }, 30000);
    (0, vitest_1.it)('does not construct a file:// URI for the model path', async () => {
        // Guard the code shape: the engine must hand onnxruntime the raw path.
        const src = kokoroTtsEngine_1.createKokoroTtsEngine.toString();
        (0, vitest_1.expect)(src).not.toMatch(/file:\/\/\$\{/);
        (0, vitest_1.expect)(src).not.toMatch(/toModelUrl|pathToFileURL/);
    });
});
