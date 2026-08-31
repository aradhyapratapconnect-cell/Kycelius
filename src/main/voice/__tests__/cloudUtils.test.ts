import { describe, expect, it } from 'vitest';
import { appendV1Url, describeHttpError, readJson } from '../engines/cloudUtils';

describe('appendV1Url', () => {
  it('appends the /v1 segment when the base lacks it', () => {
    expect(appendV1Url('https://a.example.com', '/audio/speech')).toBe(
      'https://a.example.com/v1/audio/speech'
    );
  });

  it('does not duplicate /v1 when the base already has it', () => {
    expect(appendV1Url('https://a.example.com/v1', '/audio/speech')).toBe(
      'https://a.example.com/v1/audio/speech'
    );
  });

  it('handles trailing slashes', () => {
    expect(appendV1Url('https://a.example.com/v1/', '/audio/transcriptions')).toBe(
      'https://a.example.com/v1/audio/transcriptions'
    );
    expect(appendV1Url('https://a.example.com/', '/audio/transcriptions')).toBe(
      'https://a.example.com/v1/audio/transcriptions'
    );
  });
});

describe('describeHttpError', () => {
  it('explains key rejection for 401/403', async () => {
    const msg = await describeHttpError(new Response('no', { status: 401 }), 'My STT');
    expect(msg).toContain('rejected the API key');
  });

  it('points at the base URL for 404/405', async () => {
    const msg = await describeHttpError(new Response('no', { status: 404 }), 'My TTS');
    expect(msg).toMatch(/base URL/i);
  });

  it('mentions rate limiting for 429', async () => {
    const msg = await describeHttpError(new Response('slow down', { status: 429 }), 'My STT');
    expect(msg).toMatch(/rate-limited/i);
  });

  it('attributes 5xx to the provider side', async () => {
    const msg = await describeHttpError(new Response('boom', { status: 503 }), 'My TTS');
    expect(msg).toMatch(/on their side/i);
  });
});

describe('readJson', () => {
  it('parses a valid JSON body', async () => {
    await expect(readJson<{ ok: boolean }>(new Response('{"ok":true}', { status: 200 }), 'X')).resolves.toEqual({
      ok: true,
    });
  });

  it('throws a clean error on an unparseable body', async () => {
    await expect(readJson(new Response('<html>oops</html>', { status: 200 }), 'X')).rejects.toThrow(
      /unparseable response/
    );
  });
});