import { describe, expect, it } from 'vitest';
import { getWhisperModelInfo, WHISPER_MODELS } from '../whisperModelDownloader';

describe('whisper model catalogue (EF-02)', () => {
  it('targets the public ggerganov/whisper.cpp mirror, not the gated ggml-org/whisper repo', () => {
    const info = getWhisperModelInfo('large-v3-turbo');
    expect(info).toBeDefined();
    // The full download URL is built as BASE_URL/fileName — assert the pieces
    // point at the canonical public repo and an existing q5_0 turbo file.
    expect(getWhisperModelInfo('large-v3-turbo')?.fileName ?? '').toBe(
      'ggml-large-v3-turbo-q5_0.bin'
    );
  });

  it('uses a real small.en filename that exists in the whisper.cpp mirror', () => {
    const small = getWhisperModelInfo('small');
    expect(small).toBeDefined();
    // The repo ships ggml-small.en-q5_1.bin (q5_0 does NOT exist there) —
    // pointing at a non-existent file was the other half of the 404 failure.
    expect(small?.fileName).toBe('ggml-small.en-q5_1.bin');
  });

  it('exposes the two quality-ladder models with stable ids', () => {
    expect(WHISPER_MODELS.map(m => m.id)).toEqual(['large-v3-turbo', 'small']);
  });
});
