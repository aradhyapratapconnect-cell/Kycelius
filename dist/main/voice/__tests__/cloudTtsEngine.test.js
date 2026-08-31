"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const cloudTtsEngine_1 = require("../engines/cloudTtsEngine");
const pcmWav_1 = require("../pcmWav");
function wavResponse(pcm, sampleRate, status = 200) {
    return new Response(new Blob([new Uint8Array((0, pcmWav_1.encodePcm16Wav)(pcm, sampleRate))], { type: 'audio/wav' }), {
        status,
    });
}
(0, vitest_1.describe)('createCloudTtsEngine (N-08)', () => {
    (0, vitest_1.afterEach)(() => {
        vitest_1.vi.unstubAllGlobals();
    });
    (0, vitest_1.it)('POSTs the OpenAI speech request and returns decoded PCM with the real sample rate', async () => {
        const pcm = new Float32Array([0, 0.25, -0.25, 0.5]);
        const fetchMock = vitest_1.vi.fn();
        fetchMock.mockResolvedValue(wavResponse(pcm, 22050));
        vitest_1.vi.stubGlobal('fetch', fetchMock);
        const engine = (0, cloudTtsEngine_1.createCloudTtsEngine)({
            id: 'row-1',
            displayName: 'My TTS',
            baseUrl: 'https://tts.example.com/v1',
            apiKey: 'sk-test',
            model: 'alloy',
        });
        await (0, vitest_1.expect)(engine.synthesize('hello')).resolves.toEqual(pcm);
        (0, vitest_1.expect)(engine.sampleRate).toBe(22050);
        const [url, init] = fetchMock.mock.calls[0];
        (0, vitest_1.expect)(url).toBe('https://tts.example.com/v1/audio/speech');
        (0, vitest_1.expect)(init.method).toBe('POST');
        (0, vitest_1.expect)(init.headers).toMatchObject({ Authorization: 'Bearer sk-test' });
        (0, vitest_1.expect)(JSON.parse(init.body)).toEqual({
            model: 'alloy',
            input: 'hello',
            response_format: 'wav',
        });
    });
    (0, vitest_1.it)('normalizes a base URL without /v1 and defaults the sample rate until first response', async () => {
        const fetchMock = vitest_1.vi.fn();
        fetchMock.mockResolvedValue(wavResponse(new Float32Array([0, 0.1]), 24000));
        vitest_1.vi.stubGlobal('fetch', fetchMock);
        const engine = (0, cloudTtsEngine_1.createCloudTtsEngine)({
            id: 'row-2',
            displayName: 'Host-root TTS',
            baseUrl: 'https://voices.example.com',
            apiKey: 'sk-test',
            model: 'echo',
        });
        (0, vitest_1.expect)(engine.sampleRate).toBe(24000);
        await engine.synthesize('hi');
        (0, vitest_1.expect)(fetchMock.mock.calls[0][0]).toBe('https://voices.example.com/v1/audio/speech');
        (0, vitest_1.expect)(engine.sampleRate).toBe(24000);
    });
    (0, vitest_1.it)('rejects with a readable message when the endpoint rejects the key', async () => {
        const fetchMock = vitest_1.vi.fn();
        fetchMock.mockResolvedValue(new Response('unauthorized', { status: 403 }));
        vitest_1.vi.stubGlobal('fetch', fetchMock);
        const engine = (0, cloudTtsEngine_1.createCloudTtsEngine)({
            id: 'row-3',
            displayName: 'My TTS',
            baseUrl: 'https://tts.example.com/v1',
            apiKey: 'bad-key',
            model: 'alloy',
        });
        await (0, vitest_1.expect)(engine.synthesize('hello')).rejects.toThrow(/rejected the API key/);
    });
    (0, vitest_1.it)('rejects silent audio clips instead of playing nothing', async () => {
        const fetchMock = vitest_1.vi.fn();
        fetchMock.mockResolvedValue(wavResponse(new Float32Array(0), 24000));
        vitest_1.vi.stubGlobal('fetch', fetchMock);
        const engine = (0, cloudTtsEngine_1.createCloudTtsEngine)({
            id: 'row-4',
            displayName: 'My TTS',
            baseUrl: 'https://tts.example.com/v1',
            apiKey: 'sk-test',
            model: 'alloy',
        });
        await (0, vitest_1.expect)(engine.synthesize('hello')).rejects.toThrow(/silent|WAV/i);
    });
});
(0, vitest_1.describe)('listCloudVoiceModels', () => {
    (0, vitest_1.afterEach)(() => {
        vitest_1.vi.unstubAllGlobals();
    });
    (0, vitest_1.it)('maps the /v1/models payload to model ids', async () => {
        const fetchMock = vitest_1.vi.fn();
        fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: [{ id: 'alloy' }, { id: 'echo' }, { id: 'onyx' }] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        }));
        vitest_1.vi.stubGlobal('fetch', fetchMock);
        await (0, vitest_1.expect)((0, cloudTtsEngine_1.listCloudVoiceModels)({ displayName: 'My TTS', baseUrl: 'https://tts.example.com/v1', apiKey: 'sk-test' })).resolves.toEqual(['alloy', 'echo', 'onyx']);
    });
    (0, vitest_1.it)('returns an empty list on HTTP errors or malformed payloads without throwing', async () => {
        let fetchMock = vitest_1.vi.fn();
        fetchMock.mockResolvedValue(new Response('nope', { status: 500 }));
        vitest_1.vi.stubGlobal('fetch', fetchMock);
        await (0, vitest_1.expect)((0, cloudTtsEngine_1.listCloudVoiceModels)({ displayName: 'My TTS', baseUrl: 'https://tts.example.com/v1', apiKey: 'sk-test' })).resolves.toEqual([]);
        fetchMock = vitest_1.vi.fn();
        fetchMock.mockResolvedValue(new Response('not json', { status: 200 }));
        vitest_1.vi.stubGlobal('fetch', fetchMock);
        await (0, vitest_1.expect)((0, cloudTtsEngine_1.listCloudVoiceModels)({ displayName: 'My TTS', baseUrl: 'https://tts.example.com/v1', apiKey: 'sk-test' })).resolves.toEqual([]);
    });
});
