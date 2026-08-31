"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const cloudSttEngine_1 = require("../engines/cloudSttEngine");
const pcmWav_1 = require("../pcmWav");
const PCM = new Float32Array([0, 0.125, -0.125, 0.5]);
function jsonResponse(body, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}
(0, vitest_1.describe)('createCloudSttEngine (N-08)', () => {
    (0, vitest_1.afterEach)(() => {
        vitest_1.vi.unstubAllGlobals();
    });
    (0, vitest_1.it)('posts the PCM as an in-memory WAV via multipart form and returns the text', async () => {
        const fetchMock = vitest_1.vi.fn();
        fetchMock.mockResolvedValue(jsonResponse({ text: '  hello world  ' }));
        vitest_1.vi.stubGlobal('fetch', fetchMock);
        const onFallback = vitest_1.vi.fn();
        const fallback = vitest_1.vi.fn(async () => 'local-result');
        const engine = (0, cloudSttEngine_1.createCloudSttEngine)({
            id: 'cloud-stt-row-1',
            displayName: 'My STT',
            baseUrl: 'https://stt.example.com/v1',
            apiKey: 'sk-test',
            model: 'whisper-1',
        }, { fallback, onFallback });
        await (0, vitest_1.expect)(engine.transcribe(PCM)).resolves.toBe('hello world');
        (0, vitest_1.expect)(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0];
        (0, vitest_1.expect)(url).toBe('https://stt.example.com/v1/audio/transcriptions');
        (0, vitest_1.expect)(init.method).toBe('POST');
        (0, vitest_1.expect)(init.headers).toEqual({ Authorization: 'Bearer sk-test' });
        const form = init.body;
        (0, vitest_1.expect)(form.get('model')).toBe('whisper-1');
        const file = form.get('file');
        (0, vitest_1.expect)(file.type).toBe('audio/wav');
        (0, vitest_1.expect)(file.size).toBe(44 + PCM.length * 2);
        (0, vitest_1.expect)(Buffer.from(await file.arrayBuffer()).equals((0, pcmWav_1.encodePcm16Wav)(PCM, 16000))).toBe(true);
        (0, vitest_1.expect)(onFallback).not.toHaveBeenCalled();
        (0, vitest_1.expect)(fallback).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('normalizes a base URL that lacks the /v1 suffix', async () => {
        const fetchMock = vitest_1.vi.fn();
        fetchMock.mockResolvedValue(jsonResponse({ text: 'ok' }));
        vitest_1.vi.stubGlobal('fetch', fetchMock);
        const engine = (0, cloudSttEngine_1.createCloudSttEngine)({
            id: 'cloud-stt-row-2',
            displayName: 'Host-root STT',
            baseUrl: 'https://voices.example.com',
            apiKey: 'sk-test',
            model: 'whisper-1',
        }, { fallback: async () => '', onFallback: () => undefined });
        await engine.transcribe(PCM);
        (0, vitest_1.expect)(fetchMock.mock.calls[0][0]).toBe('https://voices.example.com/v1/audio/transcriptions');
    });
    (0, vitest_1.it)('falls back to the local engine on HTTP failure and broadcasts a notice', async () => {
        const fetchMock = vitest_1.vi.fn();
        fetchMock.mockResolvedValue(new Response('nope', { status: 401 }));
        vitest_1.vi.stubGlobal('fetch', fetchMock);
        const onFallback = vitest_1.vi.fn();
        const fallback = vitest_1.vi.fn(async () => 'local-result');
        const engine = (0, cloudSttEngine_1.createCloudSttEngine)({
            id: 'cloud-stt-row-3',
            displayName: 'My STT',
            baseUrl: 'https://stt.example.com/v1',
            apiKey: 'sk-test',
            model: 'whisper-1',
        }, { fallback, onFallback });
        await (0, vitest_1.expect)(engine.transcribe(PCM)).resolves.toBe('local-result');
        (0, vitest_1.expect)(fallback).toHaveBeenCalledWith(PCM);
        (0, vitest_1.expect)(onFallback).toHaveBeenCalledTimes(1);
        (0, vitest_1.expect)(onFallback).toHaveBeenCalledWith(vitest_1.expect.stringContaining('My STT'));
        (0, vitest_1.expect)(onFallback).toHaveBeenCalledWith(vitest_1.expect.stringContaining('Falling back to the local Whisper engine'));
    });
    (0, vitest_1.it)('falls back when the endpoint returns an empty transcription', async () => {
        const fetchMock = vitest_1.vi.fn();
        fetchMock.mockResolvedValue(jsonResponse({ text: '   ' }));
        vitest_1.vi.stubGlobal('fetch', fetchMock);
        const onFallback = vitest_1.vi.fn();
        const fallback = vitest_1.vi.fn(async () => 'local-result');
        const engine = (0, cloudSttEngine_1.createCloudSttEngine)({
            id: 'cloud-stt-row-4',
            displayName: 'My STT',
            baseUrl: 'https://stt.example.com/v1',
            apiKey: 'sk-test',
            model: 'whisper-1',
        }, { fallback, onFallback });
        await (0, vitest_1.expect)(engine.transcribe(PCM)).resolves.toBe('local-result');
        (0, vitest_1.expect)(onFallback).toHaveBeenCalled();
    });
    (0, vitest_1.it)('falls back when the network request itself throws', async () => {
        const fetchMock = vitest_1.vi.fn();
        fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
        vitest_1.vi.stubGlobal('fetch', fetchMock);
        const onFallback = vitest_1.vi.fn();
        const fallback = vitest_1.vi.fn(async () => 'local-result');
        const engine = (0, cloudSttEngine_1.createCloudSttEngine)({
            id: 'cloud-stt-row-5',
            displayName: 'My STT',
            baseUrl: 'https://stt.example.com/v1',
            apiKey: 'sk-test',
            model: 'whisper-1',
        }, { fallback, onFallback });
        await (0, vitest_1.expect)(engine.transcribe(PCM)).resolves.toBe('local-result');
        (0, vitest_1.expect)(onFallback).toHaveBeenCalledWith(vitest_1.expect.stringContaining('ECONNREFUSED'));
    });
});
