import { existsSync } from 'fs';
import { describe, expect, it } from 'vitest';
import { createKokoroTtsEngine } from '../engines/kokoroTtsEngine';

const MODEL_PATH = 'C:\\Users\\aradh\\AppData\\Roaming\\kyclius\\kokoro\\model.onnx';
const VOICE_PATH = 'C:\\Users\\aradh\\AppData\\Roaming\\kyclius\\kokoro\\voice_af.bin';
const TOKENIZER_PATH = 'C:\\Users\\aradh\\AppData\\Roaming\\kyclius\\kokoro\\tokenizer.json';

const modelPresent = existsSync(MODEL_PATH) && existsSync(VOICE_PATH) && existsSync(TOKENIZER_PATH);

describe('Kokoro TTS engine model loading', () => {
  // EF fix: onnxruntime-node@1.27 on this platform fails to load the model
  // when given a file:// URI (both file://C:\... and file:///C:/... produce
  // "Load model ... failed"), but loads it fine from the raw filesystem path.
  // This integration test loads the real session to guard against regressing
  // back to a file:// form, and skips if the model files aren't installed.
  it.skipIf(!modelPresent)('loads the real ONNX model from the raw path (no file:// URI)', async () => {
    const engine = createKokoroTtsEngine(async () => ({
      modelPath: MODEL_PATH,
      voicePath: VOICE_PATH,
      tokenizerPath: TOKENIZER_PATH,
    }));

    // 'hello' -> non-trivial token sequence; if session creation fails on the
    // path, we get the "Could not load ONNX model" error we're guarding against.
    const out = await engine.synthesize('hello');
    expect(out.length).toBeGreaterThan(0);
  }, 30000);

  it.skipIf(!modelPresent)('truncates over-long text instead of failing the Encoder Expand node', async () => {
    const engine = createKokoroTtsEngine(async () => ({
      modelPath: MODEL_PATH,
      voicePath: VOICE_PATH,
      tokenizerPath: TOKENIZER_PATH,
    }));

    // 600+ characters -> tokenizes to well over 512 tokens, which previously
    // crashed the /encoder/bert/Expand node with "invalid expand shape".
    const longText = 'repeat after me. '.repeat(45); // ~630 chars
    const out = await engine.synthesize(longText);
    expect(out.length).toBeGreaterThan(0);
  }, 30000);

  it('does not construct a file:// URI for the model path', async () => {
    // Guard the code shape: the engine must hand onnxruntime the raw path.
    const src = createKokoroTtsEngine.toString();
    expect(src).not.toMatch(/file:\/\/\$\{/);
    expect(src).not.toMatch(/toModelUrl|pathToFileURL/);
  });
});
