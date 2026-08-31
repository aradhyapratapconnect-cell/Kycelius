import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCloudSttEngine } from '../engines/cloudSttEngine';
import { encodePcm16Wav } from '../pcmWav';

const PCM = new Float32Array([0, 0.125, -0.125, 0.5]);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('createCloudSttEngine (N-08)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts the PCM as an in-memory WAV via multipart form and returns the text', async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValue(jsonResponse({ text: '  hello world  ' }));
    vi.stubGlobal('fetch', fetchMock);

    const onFallback = vi.fn();
    const fallback = vi.fn(async () => 'local-result');
    const engine = createCloudSttEngine(
      {
        id: 'cloud-stt-row-1',
        displayName: 'My STT',
        baseUrl: 'https://stt.example.com/v1',
        apiKey: 'sk-test',
        model: 'whisper-1',
      },
      { fallback, onFallback }
    );

    await expect(engine.transcribe(PCM)).resolves.toBe('hello world');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://stt.example.com/v1/audio/transcriptions');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ Authorization: 'Bearer sk-test' });

    const form = init.body as FormData;
    expect(form.get('model')).toBe('whisper-1');
    const file = form.get('file') as File;
    expect(file.type).toBe('audio/wav');
    expect(file.size).toBe(44 + PCM.length * 2);
    expect(Buffer.from(await file.arrayBuffer()).equals(encodePcm16Wav(PCM, 16000))).toBe(true);

    expect(onFallback).not.toHaveBeenCalled();
    expect(fallback).not.toHaveBeenCalled();
  });

  it('normalizes a base URL that lacks the /v1 suffix', async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValue(jsonResponse({ text: 'ok' }));
    vi.stubGlobal('fetch', fetchMock);

    const engine = createCloudSttEngine(
      {
        id: 'cloud-stt-row-2',
        displayName: 'Host-root STT',
        baseUrl: 'https://voices.example.com',
        apiKey: 'sk-test',
        model: 'whisper-1',
      },
      { fallback: async () => '', onFallback: () => undefined }
    );

    await engine.transcribe(PCM);
    expect(fetchMock.mock.calls[0][0]).toBe('https://voices.example.com/v1/audio/transcriptions');
  });

  it('falls back to the local engine on HTTP failure and broadcasts a notice', async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValue(new Response('nope', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);

    const onFallback = vi.fn();
    const fallback = vi.fn(async () => 'local-result');
    const engine = createCloudSttEngine(
      {
        id: 'cloud-stt-row-3',
        displayName: 'My STT',
        baseUrl: 'https://stt.example.com/v1',
        apiKey: 'sk-test',
        model: 'whisper-1',
      },
      { fallback, onFallback }
    );

    await expect(engine.transcribe(PCM)).resolves.toBe('local-result');
    expect(fallback).toHaveBeenCalledWith(PCM);
    expect(onFallback).toHaveBeenCalledTimes(1);
    expect(onFallback).toHaveBeenCalledWith(
      expect.stringContaining('My STT')
    );
    expect(onFallback).toHaveBeenCalledWith(
      expect.stringContaining('Falling back to the local Whisper engine')
    );
  });

  it('falls back when the endpoint returns an empty transcription', async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValue(jsonResponse({ text: '   ' }));
    vi.stubGlobal('fetch', fetchMock);

    const onFallback = vi.fn();
    const fallback = vi.fn(async () => 'local-result');
    const engine = createCloudSttEngine(
      {
        id: 'cloud-stt-row-4',
        displayName: 'My STT',
        baseUrl: 'https://stt.example.com/v1',
        apiKey: 'sk-test',
        model: 'whisper-1',
      },
      { fallback, onFallback }
    );

    await expect(engine.transcribe(PCM)).resolves.toBe('local-result');
    expect(onFallback).toHaveBeenCalled();
  });

  it('falls back when the network request itself throws', async () => {
    const fetchMock = vi.fn();
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    vi.stubGlobal('fetch', fetchMock);

    const onFallback = vi.fn();
    const fallback = vi.fn(async () => 'local-result');
    const engine = createCloudSttEngine(
      {
        id: 'cloud-stt-row-5',
        displayName: 'My STT',
        baseUrl: 'https://stt.example.com/v1',
        apiKey: 'sk-test',
        model: 'whisper-1',
      },
      { fallback, onFallback }
    );

    await expect(engine.transcribe(PCM)).resolves.toBe('local-result');
    expect(onFallback).toHaveBeenCalledWith(expect.stringContaining('ECONNREFUSED'));
  });
});