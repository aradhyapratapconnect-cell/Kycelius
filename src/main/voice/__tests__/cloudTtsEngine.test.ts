import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCloudTtsEngine, listCloudVoiceModels } from '../engines/cloudTtsEngine';
import { encodePcm16Wav } from '../pcmWav';

function wavResponse(pcm: Float32Array, sampleRate: number, status = 200): Response {
  return new Response(new Blob([new Uint8Array(encodePcm16Wav(pcm, sampleRate))], { type: 'audio/wav' }), {
    status,
  });
}

describe('createCloudTtsEngine (N-08)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POSTs the OpenAI speech request and returns decoded PCM with the real sample rate', async () => {
    const pcm = new Float32Array([0, 0.25, -0.25, 0.5]);
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValue(wavResponse(pcm, 22050));
    vi.stubGlobal('fetch', fetchMock);

    const engine = createCloudTtsEngine({
      id: 'row-1',
      displayName: 'My TTS',
      baseUrl: 'https://tts.example.com/v1',
      apiKey: 'sk-test',
      model: 'alloy',
    });

    await expect(engine.synthesize('hello')).resolves.toEqual(pcm);
    expect(engine.sampleRate).toBe(22050);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://tts.example.com/v1/audio/speech');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer sk-test' });
    expect(JSON.parse(init.body as string)).toEqual({
      model: 'alloy',
      input: 'hello',
      response_format: 'wav',
    });
  });

  it('normalizes a base URL without /v1 and defaults the sample rate until first response', async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValue(wavResponse(new Float32Array([0, 0.1]), 24000));
    vi.stubGlobal('fetch', fetchMock);

    const engine = createCloudTtsEngine({
      id: 'row-2',
      displayName: 'Host-root TTS',
      baseUrl: 'https://voices.example.com',
      apiKey: 'sk-test',
      model: 'echo',
    });

    expect(engine.sampleRate).toBe(24000);
    await engine.synthesize('hi');
    expect(fetchMock.mock.calls[0][0]).toBe('https://voices.example.com/v1/audio/speech');
    expect(engine.sampleRate).toBe(24000);
  });

  it('rejects with a readable message when the endpoint rejects the key', async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValue(new Response('unauthorized', { status: 403 }));
    vi.stubGlobal('fetch', fetchMock);

    const engine = createCloudTtsEngine({
      id: 'row-3',
      displayName: 'My TTS',
      baseUrl: 'https://tts.example.com/v1',
      apiKey: 'bad-key',
      model: 'alloy',
    });

    await expect(engine.synthesize('hello')).rejects.toThrow(/rejected the API key/);
  });

  it('rejects silent audio clips instead of playing nothing', async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValue(wavResponse(new Float32Array(0), 24000));
    vi.stubGlobal('fetch', fetchMock);

    const engine = createCloudTtsEngine({
      id: 'row-4',
      displayName: 'My TTS',
      baseUrl: 'https://tts.example.com/v1',
      apiKey: 'sk-test',
      model: 'alloy',
    });

    await expect(engine.synthesize('hello')).rejects.toThrow(/silent|WAV/i);
  });
});

describe('listCloudVoiceModels', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('maps the /v1/models payload to model ids', async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: 'alloy' }, { id: 'echo' }, { id: 'onyx' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      listCloudVoiceModels({ displayName: 'My TTS', baseUrl: 'https://tts.example.com/v1', apiKey: 'sk-test' })
    ).resolves.toEqual(['alloy', 'echo', 'onyx']);
  });

  it('returns an empty list on HTTP errors or malformed payloads without throwing', async () => {
    let fetchMock = vi.fn();
    fetchMock.mockResolvedValue(new Response('nope', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      listCloudVoiceModels({ displayName: 'My TTS', baseUrl: 'https://tts.example.com/v1', apiKey: 'sk-test' })
    ).resolves.toEqual([]);

    fetchMock = vi.fn();
    fetchMock.mockResolvedValue(new Response('not json', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      listCloudVoiceModels({ displayName: 'My TTS', baseUrl: 'https://tts.example.com/v1', apiKey: 'sk-test' })
    ).resolves.toEqual([]);
  });
});