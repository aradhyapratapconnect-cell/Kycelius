"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const fishAudioTtsEngine_1 = require("../engines/fishAudioTtsEngine");
const pcmWav_1 = require("../pcmWav");
function wavResponse(pcm, sampleRate, status = 200) {
    return new Response(new Blob([new Uint8Array((0, pcmWav_1.encodePcm16Wav)(pcm, sampleRate))], { type: 'audio/wav' }), {
        status,
    });
}
const CONFIG = {
    id: 'fishaudio_tts',
    displayName: 'Fish Audio',
    baseUrl: 'https://api.fish.audio',
    apiKey: 'fish-test-key',
    referenceId: 'voice-ref-123',
};
(0, vitest_1.describe)('createFishAudioTtsEngine (BYOK)', () => {
    (0, vitest_1.afterEach)(() => {
        vitest_1.vi.unstubAllGlobals();
    });
    (0, vitest_1.it)('POSTs fish.audio /v1/tts with Bearer auth and returns decoded PCM', async () => {
        const pcm = new Float32Array([0, 0.25, -0.25]);
        const fetchMock = vitest_1.vi.fn();
        fetchMock.mockResolvedValue(wavResponse(pcm, 44100));
        vitest_1.vi.stubGlobal('fetch', fetchMock);
        const engine = (0, fishAudioTtsEngine_1.createFishAudioTtsEngine)(CONFIG);
        await (0, vitest_1.expect)(engine.synthesize('hello')).resolves.toEqual(pcm);
        (0, vitest_1.expect)(engine.sampleRate).toBe(44100);
        const [url, init] = fetchMock.mock.calls[0];
        (0, vitest_1.expect)(url).toBe('https://api.fish.audio/v1/tts');
        (0, vitest_1.expect)(init.method).toBe('POST');
        (0, vitest_1.expect)(init.headers).toMatchObject({
            Authorization: 'Bearer fish-test-key',
            'Content-Type': 'application/json',
            model: 's2.1-pro',
        });
        (0, vitest_1.expect)(JSON.parse(init.body)).toEqual({
            text: 'hello',
            format: 'wav',
            normalize: true,
            reference_id: 'voice-ref-123',
        });
    });
    (0, vitest_1.it)('omits reference_id when no voice is configured (default voice)', async () => {
        const fetchMock = vitest_1.vi.fn();
        fetchMock.mockResolvedValue(wavResponse(new Float32Array([0.1]), 44100));
        vitest_1.vi.stubGlobal('fetch', fetchMock);
        await (0, fishAudioTtsEngine_1.createFishAudioTtsEngine)({ ...CONFIG, referenceId: '' }).synthesize('hi');
        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        (0, vitest_1.expect)(body).not.toHaveProperty('reference_id');
        (0, vitest_1.expect)(body.format).toBe('wav');
    });
    (0, vitest_1.it)('tolerates a base URL that already ends in /v1', () => {
        (0, vitest_1.expect)((0, fishAudioTtsEngine_1.fishAudioTtsUrl)('https://api.fish.audio/v1')).toBe('https://api.fish.audio/v1/tts');
        (0, vitest_1.expect)((0, fishAudioTtsEngine_1.fishAudioTtsUrl)('https://api.fish.audio')).toBe('https://api.fish.audio/v1/tts');
    });
    (0, vitest_1.it)('rejects with a readable key error on 401 and surfaces JSON error bodies', async () => {
        let fetchMock = vitest_1.vi.fn();
        fetchMock.mockResolvedValue(new Response('Unauthorized', { status: 401 }));
        vitest_1.vi.stubGlobal('fetch', fetchMock);
        await (0, vitest_1.expect)((0, fishAudioTtsEngine_1.createFishAudioTtsEngine)(CONFIG).synthesize('hi')).rejects.toThrow(/rejected the API key/);
        fetchMock = vitest_1.vi.fn();
        fetchMock.mockResolvedValue(new Response(JSON.stringify({ message: 'insufficient credits' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        }));
        vitest_1.vi.stubGlobal('fetch', fetchMock);
        await (0, vitest_1.expect)((0, fishAudioTtsEngine_1.createFishAudioTtsEngine)(CONFIG).synthesize('hi')).rejects.toThrow(/insufficient credits/);
    });
    (0, vitest_1.it)('rejects silent clips instead of playing nothing', async () => {
        const fetchMock = vitest_1.vi.fn();
        fetchMock.mockResolvedValue(wavResponse(new Float32Array(0), 44100));
        vitest_1.vi.stubGlobal('fetch', fetchMock);
        await (0, vitest_1.expect)((0, fishAudioTtsEngine_1.createFishAudioTtsEngine)(CONFIG).synthesize('hi')).rejects.toThrow(/silent|WAV/i);
    });
});
