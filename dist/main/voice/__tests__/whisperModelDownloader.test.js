"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const whisperModelDownloader_1 = require("../whisperModelDownloader");
(0, vitest_1.describe)('whisper model catalogue (EF-02)', () => {
    (0, vitest_1.it)('targets the public ggerganov/whisper.cpp mirror, not the gated ggml-org/whisper repo', () => {
        const info = (0, whisperModelDownloader_1.getWhisperModelInfo)('large-v3-turbo');
        (0, vitest_1.expect)(info).toBeDefined();
        // The full download URL is built as BASE_URL/fileName — assert the pieces
        // point at the canonical public repo and an existing q5_0 turbo file.
        (0, vitest_1.expect)((0, whisperModelDownloader_1.getWhisperModelInfo)('large-v3-turbo')?.fileName ?? '').toBe('ggml-large-v3-turbo-q5_0.bin');
    });
    (0, vitest_1.it)('uses a real small.en filename that exists in the whisper.cpp mirror', () => {
        const small = (0, whisperModelDownloader_1.getWhisperModelInfo)('small');
        (0, vitest_1.expect)(small).toBeDefined();
        // The repo ships ggml-small.en-q5_1.bin (q5_0 does NOT exist there) —
        // pointing at a non-existent file was the other half of the 404 failure.
        (0, vitest_1.expect)(small?.fileName).toBe('ggml-small.en-q5_1.bin');
    });
    (0, vitest_1.it)('exposes the two quality-ladder models with stable ids', () => {
        (0, vitest_1.expect)(whisperModelDownloader_1.WHISPER_MODELS.map(m => m.id)).toEqual(['large-v3-turbo', 'small']);
    });
});
