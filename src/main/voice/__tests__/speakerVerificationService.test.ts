import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_ENROLLMENT_SAMPLES,
  MIN_ENROLLMENT_SAMPLES,
  cosineSimilarity,
  speakerVerificationService as svc,
  type SpeakerCrypto,
  type SpeakerProfileRepository,
} from '../speakerVerificationService';

const SAMPLE_RATE = 16000;

// Embeddings chosen so cosine similarities are exact and easy to reason about:
//   same voice -> 1.0, near-hit -> 0.75 (>= default threshold 0.7),
//   near-miss -> 0.65 (< 0.7), other voice -> 0.
const USER = [1, 0];
const OTHER = [0, 1];
const NEAR_HIT = [0.75, Math.sqrt(1 - 0.75 * 0.75)];
const NEAR_MISS = [0.65, Math.sqrt(1 - 0.65 * 0.65)];

const VOICE_VECTORS: Record<number, number[]> = {
  1: USER,
  2: OTHER,
  3: NEAR_HIT,
  4: NEAR_MISS,
};

function phrase(voiceId: number, seconds = 1): Float32Array {
  // The fake embedder reads only pcm[0] as the "voice identity" marker.
  return new Float32Array(Math.round(SAMPLE_RATE * seconds)).fill(voiceId);
}

function shortPhrase(voiceId: number): Float32Array {
  return phrase(voiceId, 0.5);
}

function makeFakes() {
  const embed = vi.fn(async (pcm: Float32Array): Promise<number[]> => [
    ...(VOICE_VECTORS[pcm[0]] ?? [0, 0]),
  ]);

  let storedBlob: Buffer | null = null;
  let replaceCalls = 0;
  const repository: SpeakerProfileRepository = {
    hasPrimary: () => storedBlob !== null,
    getPrimaryBlob: () => storedBlob,
    replace: (_label, blob) => {
      replaceCalls += 1;
      storedBlob = blob;
    },
    removeAll: () => {
      storedBlob = null;
    },
  };

  const crypto: SpeakerCrypto = {
    encrypt: plainText => Buffer.from(`enc:${plainText}`, 'utf8'),
    decrypt: blob => {
      const text = Buffer.from(blob).toString('utf8');
      if (!text.startsWith('enc:')) throw new Error('undecryptable');
      return text.slice(4);
    },
  };

  const peekStored = () => storedBlob;

  return { embed, repository, crypto, peekStored, getReplaceCalls: () => replaceCalls };
}

describe('speakerVerificationService — enrollment', () => {
  beforeEach(() => {
    const fakes = makeFakes();
    svc.configure({ embed: fakes.embed, repository: fakes.repository, crypto: fakes.crypto });
    svc.setEnabled(true);
    svc.removeEnrollment();
  });

  it(`rejects fewer than ${MIN_ENROLLMENT_SAMPLES} samples`, async () => {
    const result = await svc.enroll([phrase(1), phrase(1)]);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/3-5 short phrases/);
  });

  it(`rejects more than ${MAX_ENROLLMENT_SAMPLES} samples`, async () => {
    const samples = Array.from({ length: 6 }, () => phrase(1));
    const result = await svc.enroll(samples);
    expect(result.ok).toBe(false);
  });

  it('rejects phrases that are too short', async () => {
    const result = await svc.enroll([shortPhrase(1), shortPhrase(1), shortPhrase(1)]);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/too short/i);
  });

  it('stores an encrypted numeric voiceprint — never raw audio', async () => {
    const fakes = makeFakes();
    svc.configure({ embed: fakes.embed, repository: fakes.repository, crypto: fakes.crypto });

    const result = await svc.enroll([phrase(1), phrase(1), phrase(1)]);

    expect(result.ok).toBe(true);
    expect(result.sampleCount).toBe(3);
    expect(fakes.embed).toHaveBeenCalledTimes(3);

    const stored = fakes.peekStored();
    expect(stored).toBeInstanceOf(Buffer);
    // Raw audio would be tens of thousands of floats; the blob is JSON text.
    expect(stored!.length).toBeLessThan(1000);

    const payload = JSON.parse(fakes.crypto.decrypt(stored!)) as { embedding: number[] };
    expect(payload.embedding).toHaveLength(2);
    expect(payload.embedding[0]).toBeCloseTo(1);
    expect(payload.embedding[1]).toBeCloseTo(0);
  });

  it('re-enrolling replaces the previous voiceprint', async () => {
    const fakes = makeFakes();
    svc.configure({ embed: fakes.embed, repository: fakes.repository, crypto: fakes.crypto });

    await svc.enroll([phrase(1), phrase(1), phrase(1)]);
    await svc.enroll([phrase(2), phrase(2), phrase(2)]);

    expect(fakes.getReplaceCalls()).toBe(2);

    // Verification now matches the newest voice, not the original enrollment.
    await expect(svc.verify(phrase(2))).resolves.toMatchObject({ matched: true });
    await expect(svc.verify(phrase(1))).resolves.toMatchObject({
      matched: false,
      reason: 'below_threshold',
    });
  });
});

describe('speakerVerificationService — verification', () => {
  beforeEach(async () => {
    const fakes = makeFakes();
    svc.configure({ embed: fakes.embed, repository: fakes.repository, crypto: fakes.crypto });
    svc.setEnabled(true);
    svc.removeEnrollment();
    await svc.enroll([phrase(1), phrase(1), phrase(1)]);
  });

  it('bypasses with matched:true when biometrics are disabled', async () => {
    svc.setEnabled(false);
    await expect(svc.verify(phrase(2))).resolves.toEqual({
      matched: true,
      confidence: 1,
      mode: 'bypassed',
      reason: 'disabled',
    });
  });

  it('bypasses when no enrollment exists (any voice accepted)', async () => {
    svc.removeEnrollment();
    await expect(svc.verify(phrase(2))).resolves.toMatchObject({
      matched: true,
      mode: 'bypassed',
      reason: 'not_enrolled',
    });
  });

  it('accepts a matching voice above the threshold', async () => {
    const verdict = await svc.verify(phrase(1));
    expect(verdict.matched).toBe(true);
    expect(verdict.mode).toBe('gated');
    expect(verdict.confidence).toBeGreaterThan(svc.getThreshold());
  });

  it('rejects a different voice below the threshold', async () => {
    const verdict = await svc.verify(phrase(2));
    expect(verdict.matched).toBe(false);
    expect(verdict.reason).toBe('below_threshold');
    expect(verdict.confidence).toBeCloseTo(cosineSimilarity(OTHER, USER));
  });

  it('never resolves low confidence to matched:true', async () => {
    // Cosine 0.65 against the enrolled voiceprint, just under the 0.7 gate.
    const verdict = await svc.verify(phrase(4));
    expect(verdict.confidence).toBeCloseTo(0.65);
    expect(verdict.confidence).toBeLessThan(svc.getThreshold());
    expect(verdict.matched).toBe(false);
  });

  it('accepts borderline-but-above-threshold confidence', async () => {
    // Cosine 0.75, comfortably over the strict >= comparison.
    const verdict = await svc.verify(phrase(3));
    expect(verdict.confidence).toBeCloseTo(0.75);
    expect(verdict.matched).toBe(true);
  });

  it('fails closed when the embedding engine errors mid-verification', async () => {
    const failing = makeFakes();
    svc.configure({ embed: failing.embed, repository: failing.repository, crypto: failing.crypto });
    await svc.enroll([phrase(1), phrase(1), phrase(1)]);

    failing.embed.mockRejectedValue(new Error('onnx exploded'));

    const verdict = await svc.verify(phrase(1));
    expect(verdict.matched).toBe(false);
    expect(verdict.reason).toBe('engine_error');
  });

  it('fails closed when the stored profile cannot be decrypted', async () => {
    const corrupt = makeFakes();
    corrupt.repository.replace(
      'primary user',
      Buffer.from('not-really-encrypted-garbage', 'utf8')
    );
    svc.configure({ embed: corrupt.embed, repository: corrupt.repository, crypto: corrupt.crypto });

    const verdict = await svc.verify(phrase(1));
    expect(verdict.matched).toBe(false);
    expect(verdict.reason).toBe('unreadable_profile');
  });

  it('fails closed on empty or malformed audio while gated', async () => {
    const verdict = await svc.verify(new Float32Array(0));
    expect(verdict.matched).toBe(false);
    expect(verdict.reason).toBe('empty_sample');
  });
});

describe('speakerVerificationService — removal', () => {
  it('removeEnrollment deletes the print outright and reverts to accepting any voice', async () => {
    const fakes = makeFakes();
    svc.configure({ embed: fakes.embed, repository: fakes.repository, crypto: fakes.crypto });
    svc.setEnabled(true);

    await svc.enroll([phrase(1), phrase(1), phrase(1)]);
    await expect(svc.verify(phrase(2))).resolves.toMatchObject({ matched: false });

    svc.removeEnrollment();

    await expect(svc.verify(phrase(2))).resolves.toMatchObject({
      matched: true,
      mode: 'bypassed',
      reason: 'not_enrolled',
    });
  });
});

describe('cosineSimilarity helper', () => {
  it('computes expected similarities for the test vectors', () => {
    expect(cosineSimilarity(USER, USER)).toBeCloseTo(1);
    expect(cosineSimilarity(USER, OTHER)).toBeCloseTo(0);
    expect(cosineSimilarity(USER, NEAR_MISS)).toBeCloseTo(0.65);
    expect(cosineSimilarity([], [])).toBe(0);
  });
});
