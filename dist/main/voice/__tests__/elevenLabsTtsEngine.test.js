"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const elevenLabsTtsEngine_1 = require("../engines/elevenLabsTtsEngine");
function pcm16Response(samples) {
    const buf = Buffer.alloc(samples.length * 2);
    samples.forEach((s, i) => buf.writeInt16LE(s, i * 2));
    return new Response(new Blob([new Uint8Array(buf)], { type: 'audio/pcm' }), { status: 200 });
}
const CONFIG = {
    id: 'elevenlabs_tts',
    displayName: 'ElevenLabs',
    baseUrl: 'https://api.elevenlabs.io/v1',
    apiKey: 'xi-test-key',
    voiceId: '21m00Tcm4TlvDq8ikWAM',
};
(0, vitest_1.describe)('createElevenLabsTtsEngine (BYOK)', () => {
    (0, vitest_1.afterEach)(() => {
        vitest_1.vi.unstubAllGlobals();
    });
    (0, vitest_1.it)('POSTs text to the voice endpoint and returns Float32 PCM at 16 kHz', async () => {
        const fetchMock = vitest_1.vi.fn();
        fetchMock.mockResolvedValue(pcm16Response([0, 16384, -16384, 32767]));
        vitest_1.vi.stubGlobal('fetch', fetchMock);
        const engine = (0, elevenLabsTtsEngine_1.createElevenLabsTtsEngine)(CONFIG);
        const pcm = await engine.synthesize('hello');
        (0, vitest_1.expect)(engine.sampleRate).toBe(elevenLabsTtsEngine_1.ELEVENLABS_SAMPLE_RATE);
        (0, vitest_1.expect)(Array.from(pcm)).toEqual([0, 0.5, -0.5, 32767 / 32768]);
        const [url, init] = fetchMock.mock.calls[0];
        (0, vitest_1.expect)(url).toBe('https://api.elevenlabs.io/v1/text-to-speech/21m00Tcm4TlvDq8ikWAM?output_format=pcm_16000');
        (0, vitest_1.expect)(init.method).toBe('POST');
        (0, vitest_1.expect)(init.headers).toMatchObject({
            'xi-api-key': 'xi-test-key',
            'Content-Type': 'application/json',
        });
        (0, vitest_1.expect)(JSON.parse(init.body)).toEqual({
            text: 'hello',
            model_id: 'eleven_multilingual_v2',
        });
    });
    (0, vitest_1.it)('rejects with a readable key error on 401 instead of playing nothing', async () => {
        const fetchMock = vitest_1.vi.fn();
        fetchMock.mockResolvedValue(new Response('Unauthorized', { status: 401 }));
        vitest_1.vi.stubGlobal('fetch', fetchMock);
        await (0, vitest_1.expect)((0, elevenLabsTtsEngine_1.createElevenLabsTtsEngine)(CONFIG).synthesize('hi')).rejects.toThrow(/rejected the API key/);
    });
    (0, vitest_1.it)('rejects rate limits with a retryable message', async () => {
        const fetchMock = vitest_1.vi.fn();
        fetchMock.mockResolvedValue(new Response('slow down', { status: 429 }));
        vitest_1.vi.stubGlobal('fetch', fetchMock);
        await (0, vitest_1.expect)((0, elevenLabsTtsEngine_1.createElevenLabsTtsEngine)(CONFIG).synthesize('hi')).rejects.toThrow(/rate-limited/);
    });
    (0, vitest_1.it)('rejects silent clips and requires a voice ID up front', async () => {
        const fetchMock = vitest_1.vi.fn();
        fetchMock.mockResolvedValue(pcm16Response([0, 0, 0]));
        vitest_1.vi.stubGlobal('fetch', fetchMock);
        await (0, vitest_1.expect)((0, elevenLabsTtsEngine_1.createElevenLabsTtsEngine)(CONFIG).synthesize('hi')).rejects.toThrow(/silent/);
        (0, vitest_1.expect)(fetchMock).toHaveBeenCalledTimes(1);
        await (0, vitest_1.expect)((0, elevenLabsTtsEngine_1.createElevenLabsTtsEngine)({ ...CONFIG, voiceId: '  ' }).synthesize('hi')).rejects.toThrow(/voice ID/);
    });
});
(0, vitest_1.describe)('decodePcm16Le', () => {
    (0, vitest_1.it)('rejects empty or odd-length payloads', () => {
        (0, vitest_1.expect)(() => (0, elevenLabsTtsEngine_1.decodePcm16Le)(Buffer.alloc(0), 'ElevenLabs')).toThrow(/unparseable/);
        (0, vitest_1.expect)(() => (0, elevenLabsTtsEngine_1.decodePcm16Le)(Buffer.alloc(3), 'ElevenLabs')).toThrow(/unparseable/);
    });
});
