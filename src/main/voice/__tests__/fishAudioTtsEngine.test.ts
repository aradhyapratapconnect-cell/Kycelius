import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createFishAudioTtsEngine,
  fishAudioTtsUrl,
} from '../engines/fishAudioTtsEngine';
import { encodePcm16Wav } from '../pcmWav';

function wavResponse(pcm: Float32Array, sampleRate: number, status = 200): Response {
  return new Response(new Blob([new Uint8Array(encodePcm16Wav(pcm, sampleRate))], { type: 'audio/wav' }), {
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

describe('createFishAudioTtsEngine (BYOK)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POSTs fish.audio /v1/tts with Bearer auth and returns decoded PCM', async () => {
    const pcm = new Float32Array([0, 0.25, -0.25]);
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValue(wavResponse(pcm, 44100));
    vi.stubGlobal('fetch', fetchMock);

    const engine = createFishAudioTtsEngine(CONFIG);
    await expect(engine.synthesize('hello')).resolves.toEqual(pcm);
    expect(engine.sampleRate).toBe(44100);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.fish.audio/v1/tts');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer fish-test-key',
      'Content-Type': 'application/json',
      model: 's2.1-pro',
    });
    expect(JSON.parse(init.body as string)).toEqual({
      text: 'hello',
      format: 'wav',
      normalize: true,
      reference_id: 'voice-ref-123',
    });
  });

  it('omits reference_id when no voice is configured (default voice)', async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValue(wavResponse(new Float32Array([0.1]), 44100));
    vi.stubGlobal('fetch', fetchMock);

    await createFishAudioTtsEngine({ ...CONFIG, referenceId: '' }).synthesize('hi');

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body).not.toHaveProperty('reference_id');
    expect(body.format).toBe('wav');
  });

  it('tolerates a base URL that already ends in /v1', () => {
    expect(fishAudioTtsUrl('https://api.fish.audio/v1')).toBe('https://api.fish.audio/v1/tts');
    expect(fishAudioTtsUrl('https://api.fish.audio')).toBe('https://api.fish.audio/v1/tts');
  });

  it('rejects with a readable key error on 401 and surfaces JSON error bodies', async () => {
    let fetchMock = vi.fn();
    fetchMock.mockResolvedValue(new Response('Unauthorized', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(createFishAudioTtsEngine(CONFIG).synthesize('hi')).rejects.toThrow(
      /rejected the API key/
    );

    fetchMock = vi.fn();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ message: 'insufficient credits' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);
    await expect(createFishAudioTtsEngine(CONFIG).synthesize('hi')).rejects.toThrow(
      /insufficient credits/
    );
  });

  it('rejects silent clips instead of playing nothing', async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValue(wavResponse(new Float32Array(0), 44100));
    vi.stubGlobal('fetch', fetchMock);

    await expect(createFishAudioTtsEngine(CONFIG).synthesize('hi')).rejects.toThrow(/silent|WAV/i);
  });
});
