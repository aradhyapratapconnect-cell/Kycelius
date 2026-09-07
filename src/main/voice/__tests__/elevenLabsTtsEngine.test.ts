import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createElevenLabsTtsEngine,
  decodePcm16Le,
  ELEVENLABS_SAMPLE_RATE,
} from '../engines/elevenLabsTtsEngine';

function pcm16Response(samples: number[]): Response {
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

describe('createElevenLabsTtsEngine (BYOK)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POSTs text to the voice endpoint and returns Float32 PCM at 16 kHz', async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValue(pcm16Response([0, 16384, -16384, 32767]));
    vi.stubGlobal('fetch', fetchMock);

    const engine = createElevenLabsTtsEngine(CONFIG);
    const pcm = await engine.synthesize('hello');

    expect(engine.sampleRate).toBe(ELEVENLABS_SAMPLE_RATE);
    expect(Array.from(pcm)).toEqual([0, 0.5, -0.5, 32767 / 32768]);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      'https://api.elevenlabs.io/v1/text-to-speech/21m00Tcm4TlvDq8ikWAM?output_format=pcm_16000'
    );
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      'xi-api-key': 'xi-test-key',
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(init.body as string)).toEqual({
      text: 'hello',
      model_id: 'eleven_multilingual_v2',
    });
  });

  it('rejects with a readable key error on 401 instead of playing nothing', async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValue(new Response('Unauthorized', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(createElevenLabsTtsEngine(CONFIG).synthesize('hi')).rejects.toThrow(
      /rejected the API key/
    );
  });

  it('rejects rate limits with a retryable message', async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValue(new Response('slow down', { status: 429 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(createElevenLabsTtsEngine(CONFIG).synthesize('hi')).rejects.toThrow(
      /rate-limited/
    );
  });

  it('rejects silent clips and requires a voice ID up front', async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValue(pcm16Response([0, 0, 0]));
    vi.stubGlobal('fetch', fetchMock);

    await expect(createElevenLabsTtsEngine(CONFIG).synthesize('hi')).rejects.toThrow(/silent/);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await expect(
      createElevenLabsTtsEngine({ ...CONFIG, voiceId: '  ' }).synthesize('hi')
    ).rejects.toThrow(/voice ID/);
  });
});

describe('decodePcm16Le', () => {
  it('rejects empty or odd-length payloads', () => {
    expect(() => decodePcm16Le(Buffer.alloc(0), 'ElevenLabs')).toThrow(/unparseable/);
    expect(() => decodePcm16Le(Buffer.alloc(3), 'ElevenLabs')).toThrow(/unparseable/);
  });
});
