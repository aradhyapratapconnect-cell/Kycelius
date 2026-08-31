import { readFile } from 'fs/promises';

export interface KokoroTtsConfig {
  modelPath: string;
  voicePath: string;
  tokenizerPath: string;
}

export interface TtsEngine {
  readonly id: string;
  /** Sample rate of the PCM returned by synthesize(); OSS engines report real
   *  rates while local/cloud engines may differ. Absent means 24 kHz. */
  readonly sampleRate?: number;
  synthesize(text: string): Promise<Float32Array>;
}

export class KokoroModelNotConfiguredError extends Error {
  constructor() {
    super(
      'Kokoro-82M TTS model is not configured. The app will fall back to OS-native speech.'
    );
    this.name = 'KokoroModelNotConfiguredError';
  }
}

export class KokoroEngineError extends Error {
  constructor(detail: string) {
    super(`Kokoro TTS engine error: ${detail}`);
    this.name = 'KokoroEngineError';
  }
}

const MAX_TOKENS = 512;

interface OrtSessionLike {
  run(feeds: Record<string, unknown>): Promise<Record<string, { data: Float32Array | number[] }>>;
  outputNames: readonly string[];
  inputNames: readonly string[];
}

function loadOnnxRuntime(): {
  InferenceSession: {
    create(pathUri: string): Promise<OrtSessionLike>;
  };
  Tensor: new (type: string, data: Float32Array | BigInt64Array, dims: number[]) => unknown;
} {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('onnxruntime-node');
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new KokoroEngineError(`Failed to load ONNX runtime: ${detail}`);
  }
}

/**
 * Loads a Kokoro voice file (.bin) containing Float32 embeddings.
 * The file is a flat Float32Array of shape [MAX_TOKENS, 1, 256].
 * We select the row corresponding to the actual token count.
 */
async function loadVoiceFile(voicePath: string): Promise<Float32Array[]> {
  const buf = await readFile(voicePath);
  const float32 = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  // Reshape into rows of 256 floats each
  const rows: Float32Array[] = [];
  const ROW_SIZE = 256;
  for (let i = 0; i < float32.length; i += ROW_SIZE) {
    rows.push(float32.slice(i, i + ROW_SIZE));
  }
  return rows;
}

interface TokenizerJson {
  model?: {
    vocab?: Record<string, number>;
  };
  added_tokens?: Array<{ id: number; content: string }>;
}

function buildVocabFromTokenizerJson(tokenizerJson: TokenizerJson): Map<string, number> {
  const vocab = new Map<string, number>();
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

function normalizeText(text: string): string {
  let out = text.toLowerCase();

  out = out
    .replace(/\bcan't\b/g, 'cannot')
    .replace(/\bwon't\b/g, 'will not')
    .replace(/\bdon't\b/g, 'do not')
    .replace(/\bit's\b/g, 'it is')
    .replace(/\bi'm\b/g, 'i am')
    .replace(/\bthat's\b/g, 'that is')
    .replace(/\bwhat's\b/g, 'what is')
    .replace(/\bthere's\b/g, 'there is')
    .replace(/\bthey're\b/g, 'they are')
    .replace(/\byou're\b/g, 'you are')
    .replace(/\bwe're\b/g, 'we are')
    .replace(/\bhe's\b/g, 'he is')
    .replace(/\bshe's\b/g, 'she is')
    .replace(/\blet's\b/g, 'let us')
    .replace(/\bisn't\b/g, 'is not')
    .replace(/\baren't\b/g, 'are not')
    .replace(/\bwasn't\b/g, 'was not')
    .replace(/\bweren't\b/g, 'were not')
    .replace(/\bhasn't\b/g, 'has not')
    .replace(/\bhaven't\b/g, 'have not')
    .replace(/\bhadn't\b/g, 'had not')
    .replace(/\bdoesn't\b/g, 'does not')
    .replace(/\bdidn't\b/g, 'did not')
    .replace(/\bcouldn't\b/g, 'could not')
    .replace(/\bwouldn't\b/g, 'would not')
    .replace(/\bshouldn't\b/g, 'should not');

  out = out.replace(/\./g, '. ');
  out = out.replace(/\s+/g, ' ').trim();
  return out;
}

/**
 * Tokenizes text using the loaded vocabulary. Each character is mapped to
 * its token ID, or 0 (unknown) if not found. The Kokoro model expects
 * pad token 0 at the start and end of the sequence.
 */
function tokenize(text: string, vocab: Map<string, number>): number[] {
  const ids: number[] = [];
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
export function createKokoroTtsEngine(
  getConfig: () => Promise<KokoroTtsConfig>
): TtsEngine {
  let session: OrtSessionLike | null = null;
  let sessionModelPath = '';
  let voiceRows: Float32Array[] | null = null;
  let voiceLoadedPath = '';
  let vocab: Map<string, number> | null = null;
  let vocabLoadedPath = '';

  async function getSession(config: KokoroTtsConfig): Promise<OrtSessionLike> {
    if (session && sessionModelPath === config.modelPath) return session;

    const ort = loadOnnxRuntime();
    try {
      // Pass the raw filesystem path. On this onnxruntime-node build, passing a
      // file:// URI (either file://C:\... or file:///C:/...) fails with the
      // generic "Load model ... failed" error, while the plain absolute path
      // loads the session correctly. onnxruntime-node resolves local paths
      // directly, so no URI encoding is needed here.
      session = (await ort.InferenceSession.create(config.modelPath)) as OrtSessionLike;
      sessionModelPath = config.modelPath;
      return session;
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new KokoroEngineError(`Could not load ONNX model: ${detail}`);
    }
  }

  async function getVoice(config: KokoroTtsConfig): Promise<Float32Array[]> {
    if (voiceRows && voiceLoadedPath === config.voicePath) return voiceRows;
    try {
      voiceRows = await loadVoiceFile(config.voicePath);
      voiceLoadedPath = config.voicePath;
      return voiceRows;
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new KokoroEngineError(`Could not load voice file: ${detail}`);
    }
  }

  async function getVocab(config: KokoroTtsConfig): Promise<Map<string, number>> {
    if (vocab && vocabLoadedPath === config.tokenizerPath) return vocab;
    try {
      const raw = await readFile(config.tokenizerPath, 'utf-8');
      const json = JSON.parse(raw) as TokenizerJson;
      vocab = buildVocabFromTokenizerJson(json);
      vocabLoadedPath = config.tokenizerPath;
      return vocab;
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new KokoroEngineError(`Could not load tokenizer: ${detail}`);
    }
  }

  return {
    id: 'kokoro',
    sampleRate: 24_000, // Kokoro-82M outputs at 24 kHz.

    async synthesize(text: string): Promise<Float32Array> {
      if (!text || text.trim().length === 0) return new Float32Array(0);

      const config = await getConfig();
      const ortSession = await getSession(config);
      const ort = loadOnnxRuntime();
      const voice = await getVoice(config);
      const vocabMap = await getVocab(config);

      const normalized = normalizeText(text);
      let tokenIds = tokenize(normalized, vocabMap);

      if (tokenIds.length > MAX_TOKENS) {
        // The encoder's Expand node rejects input_ids longer than 512 with
        // "invalid expand shape". Truncate the content tokens while keeping the
        // leading/trailing pad-0 that Kokoro expects.
        tokenIds = [0, ...tokenIds.slice(1, MAX_TOKENS - 1), 0];
        console.log(
          `[kokoroTtsEngine] text exceeds model max length (${
            MAX_TOKENS - 2
          } chars); truncating to ${MAX_TOKENS} tokens`
        );
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

      const feeds: Record<string, unknown> = {
        [inputName]: new ort.Tensor(
          'int64',
          new BigInt64Array(tokenIds.map(id => BigInt(id))),
          [1, tokenIds.length]
        ),
      };

      if (styleInput && styleVector) {
        // Style is a rank-2 tensor [1, 256] for this Kokoro ONNX model. (A
        // [1, 1, 256] rank-3 shape was rejected with "Invalid rank for input:
        // style Got: 3 Expected: 2".)
        feeds[styleInput] = new ort.Tensor(
          'float32',
          new Float32Array(styleVector),
          [1, 256]
        );
      }

      if (speedInput) {
        feeds[speedInput] = new ort.Tensor('float32', new Float32Array([1.0]), [1]);
      }

      let outputs: Record<string, { data: Float32Array | number[] }>;
      try {
        outputs = (await ortSession.run(feeds)) as Record<string, { data: Float32Array | number[] }>;
      } catch (err) {
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
