"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const speakerVerificationService_1 = require("../speakerVerificationService");
const SAMPLE_RATE = 16000;
// Embeddings chosen so cosine similarities are exact and easy to reason about:
//   same voice -> 1.0, near-hit -> 0.75 (>= default threshold 0.7),
//   near-miss -> 0.65 (< 0.7), other voice -> 0.
const USER = [1, 0];
const OTHER = [0, 1];
const NEAR_HIT = [0.75, Math.sqrt(1 - 0.75 * 0.75)];
const NEAR_MISS = [0.65, Math.sqrt(1 - 0.65 * 0.65)];
const VOICE_VECTORS = {
    1: USER,
    2: OTHER,
    3: NEAR_HIT,
    4: NEAR_MISS,
};
function phrase(voiceId, seconds = 1) {
    // The fake embedder reads only pcm[0] as the "voice identity" marker.
    return new Float32Array(Math.round(SAMPLE_RATE * seconds)).fill(voiceId);
}
function shortPhrase(voiceId) {
    return phrase(voiceId, 0.5);
}
function makeFakes() {
    const embed = vitest_1.vi.fn(async (pcm) => [
        ...(VOICE_VECTORS[pcm[0]] ?? [0, 0]),
    ]);
    let storedBlob = null;
    let replaceCalls = 0;
    const repository = {
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
    const crypto = {
        encrypt: plainText => Buffer.from(`enc:${plainText}`, 'utf8'),
        decrypt: blob => {
            const text = Buffer.from(blob).toString('utf8');
            if (!text.startsWith('enc:'))
                throw new Error('undecryptable');
            return text.slice(4);
        },
    };
    const peekStored = () => storedBlob;
    return { embed, repository, crypto, peekStored, getReplaceCalls: () => replaceCalls };
}
(0, vitest_1.describe)('speakerVerificationService — enrollment', () => {
    (0, vitest_1.beforeEach)(() => {
        const fakes = makeFakes();
        speakerVerificationService_1.speakerVerificationService.configure({ embed: fakes.embed, repository: fakes.repository, crypto: fakes.crypto });
        speakerVerificationService_1.speakerVerificationService.setEnabled(true);
        speakerVerificationService_1.speakerVerificationService.removeEnrollment();
    });
    (0, vitest_1.it)(`rejects fewer than ${speakerVerificationService_1.MIN_ENROLLMENT_SAMPLES} samples`, async () => {
        const result = await speakerVerificationService_1.speakerVerificationService.enroll([phrase(1), phrase(1)]);
        (0, vitest_1.expect)(result.ok).toBe(false);
        (0, vitest_1.expect)(result.error).toMatch(/3-5 short phrases/);
    });
    (0, vitest_1.it)(`rejects more than ${speakerVerificationService_1.MAX_ENROLLMENT_SAMPLES} samples`, async () => {
        const samples = Array.from({ length: 6 }, () => phrase(1));
        const result = await speakerVerificationService_1.speakerVerificationService.enroll(samples);
        (0, vitest_1.expect)(result.ok).toBe(false);
    });
    (0, vitest_1.it)('rejects phrases that are too short', async () => {
        const result = await speakerVerificationService_1.speakerVerificationService.enroll([shortPhrase(1), shortPhrase(1), shortPhrase(1)]);
        (0, vitest_1.expect)(result.ok).toBe(false);
        (0, vitest_1.expect)(result.error).toMatch(/too short/i);
    });
    (0, vitest_1.it)('stores an encrypted numeric voiceprint — never raw audio', async () => {
        const fakes = makeFakes();
        speakerVerificationService_1.speakerVerificationService.configure({ embed: fakes.embed, repository: fakes.repository, crypto: fakes.crypto });
        const result = await speakerVerificationService_1.speakerVerificationService.enroll([phrase(1), phrase(1), phrase(1)]);
        (0, vitest_1.expect)(result.ok).toBe(true);
        (0, vitest_1.expect)(result.sampleCount).toBe(3);
        (0, vitest_1.expect)(fakes.embed).toHaveBeenCalledTimes(3);
        const stored = fakes.peekStored();
        (0, vitest_1.expect)(stored).toBeInstanceOf(Buffer);
        // Raw audio would be tens of thousands of floats; the blob is JSON text.
        (0, vitest_1.expect)(stored.length).toBeLessThan(1000);
        const payload = JSON.parse(fakes.crypto.decrypt(stored));
        (0, vitest_1.expect)(payload.embedding).toHaveLength(2);
        (0, vitest_1.expect)(payload.embedding[0]).toBeCloseTo(1);
        (0, vitest_1.expect)(payload.embedding[1]).toBeCloseTo(0);
    });
    (0, vitest_1.it)('re-enrolling replaces the previous voiceprint', async () => {
        const fakes = makeFakes();
        speakerVerificationService_1.speakerVerificationService.configure({ embed: fakes.embed, repository: fakes.repository, crypto: fakes.crypto });
        await speakerVerificationService_1.speakerVerificationService.enroll([phrase(1), phrase(1), phrase(1)]);
        await speakerVerificationService_1.speakerVerificationService.enroll([phrase(2), phrase(2), phrase(2)]);
        (0, vitest_1.expect)(fakes.getReplaceCalls()).toBe(2);
        // Verification now matches the newest voice, not the original enrollment.
        await (0, vitest_1.expect)(speakerVerificationService_1.speakerVerificationService.verify(phrase(2))).resolves.toMatchObject({ matched: true });
        await (0, vitest_1.expect)(speakerVerificationService_1.speakerVerificationService.verify(phrase(1))).resolves.toMatchObject({
            matched: false,
            reason: 'below_threshold',
        });
    });
});
(0, vitest_1.describe)('speakerVerificationService — verification', () => {
    (0, vitest_1.beforeEach)(async () => {
        const fakes = makeFakes();
        speakerVerificationService_1.speakerVerificationService.configure({ embed: fakes.embed, repository: fakes.repository, crypto: fakes.crypto });
        speakerVerificationService_1.speakerVerificationService.setEnabled(true);
        speakerVerificationService_1.speakerVerificationService.removeEnrollment();
        await speakerVerificationService_1.speakerVerificationService.enroll([phrase(1), phrase(1), phrase(1)]);
    });
    (0, vitest_1.it)('bypasses with matched:true when biometrics are disabled', async () => {
        speakerVerificationService_1.speakerVerificationService.setEnabled(false);
        await (0, vitest_1.expect)(speakerVerificationService_1.speakerVerificationService.verify(phrase(2))).resolves.toEqual({
            matched: true,
            confidence: 1,
            mode: 'bypassed',
            reason: 'disabled',
        });
    });
    (0, vitest_1.it)('bypasses when no enrollment exists (any voice accepted)', async () => {
        speakerVerificationService_1.speakerVerificationService.removeEnrollment();
        await (0, vitest_1.expect)(speakerVerificationService_1.speakerVerificationService.verify(phrase(2))).resolves.toMatchObject({
            matched: true,
            mode: 'bypassed',
            reason: 'not_enrolled',
        });
    });
    (0, vitest_1.it)('accepts a matching voice above the threshold', async () => {
        const verdict = await speakerVerificationService_1.speakerVerificationService.verify(phrase(1));
        (0, vitest_1.expect)(verdict.matched).toBe(true);
        (0, vitest_1.expect)(verdict.mode).toBe('gated');
        (0, vitest_1.expect)(verdict.confidence).toBeGreaterThan(speakerVerificationService_1.speakerVerificationService.getThreshold());
    });
    (0, vitest_1.it)('rejects a different voice below the threshold', async () => {
        const verdict = await speakerVerificationService_1.speakerVerificationService.verify(phrase(2));
        (0, vitest_1.expect)(verdict.matched).toBe(false);
        (0, vitest_1.expect)(verdict.reason).toBe('below_threshold');
        (0, vitest_1.expect)(verdict.confidence).toBeCloseTo((0, speakerVerificationService_1.cosineSimilarity)(OTHER, USER));
    });
    (0, vitest_1.it)('never resolves low confidence to matched:true', async () => {
        // Cosine 0.65 against the enrolled voiceprint, just under the 0.7 gate.
        const verdict = await speakerVerificationService_1.speakerVerificationService.verify(phrase(4));
        (0, vitest_1.expect)(verdict.confidence).toBeCloseTo(0.65);
        (0, vitest_1.expect)(verdict.confidence).toBeLessThan(speakerVerificationService_1.speakerVerificationService.getThreshold());
        (0, vitest_1.expect)(verdict.matched).toBe(false);
    });
    (0, vitest_1.it)('accepts borderline-but-above-threshold confidence', async () => {
        // Cosine 0.75, comfortably over the strict >= comparison.
        const verdict = await speakerVerificationService_1.speakerVerificationService.verify(phrase(3));
        (0, vitest_1.expect)(verdict.confidence).toBeCloseTo(0.75);
        (0, vitest_1.expect)(verdict.matched).toBe(true);
    });
    (0, vitest_1.it)('fails closed when the embedding engine errors mid-verification', async () => {
        const failing = makeFakes();
        speakerVerificationService_1.speakerVerificationService.configure({ embed: failing.embed, repository: failing.repository, crypto: failing.crypto });
        await speakerVerificationService_1.speakerVerificationService.enroll([phrase(1), phrase(1), phrase(1)]);
        failing.embed.mockRejectedValue(new Error('onnx exploded'));
        const verdict = await speakerVerificationService_1.speakerVerificationService.verify(phrase(1));
        (0, vitest_1.expect)(verdict.matched).toBe(false);
        (0, vitest_1.expect)(verdict.reason).toBe('engine_error');
    });
    (0, vitest_1.it)('fails closed when the stored profile cannot be decrypted', async () => {
        const corrupt = makeFakes();
        corrupt.repository.replace('primary user', Buffer.from('not-really-encrypted-garbage', 'utf8'));
        speakerVerificationService_1.speakerVerificationService.configure({ embed: corrupt.embed, repository: corrupt.repository, crypto: corrupt.crypto });
        const verdict = await speakerVerificationService_1.speakerVerificationService.verify(phrase(1));
        (0, vitest_1.expect)(verdict.matched).toBe(false);
        (0, vitest_1.expect)(verdict.reason).toBe('unreadable_profile');
    });
    (0, vitest_1.it)('fails closed on empty or malformed audio while gated', async () => {
        const verdict = await speakerVerificationService_1.speakerVerificationService.verify(new Float32Array(0));
        (0, vitest_1.expect)(verdict.matched).toBe(false);
        (0, vitest_1.expect)(verdict.reason).toBe('empty_sample');
    });
});
(0, vitest_1.describe)('speakerVerificationService — removal', () => {
    (0, vitest_1.it)('removeEnrollment deletes the print outright and reverts to accepting any voice', async () => {
        const fakes = makeFakes();
        speakerVerificationService_1.speakerVerificationService.configure({ embed: fakes.embed, repository: fakes.repository, crypto: fakes.crypto });
        speakerVerificationService_1.speakerVerificationService.setEnabled(true);
        await speakerVerificationService_1.speakerVerificationService.enroll([phrase(1), phrase(1), phrase(1)]);
        await (0, vitest_1.expect)(speakerVerificationService_1.speakerVerificationService.verify(phrase(2))).resolves.toMatchObject({ matched: false });
        speakerVerificationService_1.speakerVerificationService.removeEnrollment();
        await (0, vitest_1.expect)(speakerVerificationService_1.speakerVerificationService.verify(phrase(2))).resolves.toMatchObject({
            matched: true,
            mode: 'bypassed',
            reason: 'not_enrolled',
        });
    });
});
(0, vitest_1.describe)('cosineSimilarity helper', () => {
    (0, vitest_1.it)('computes expected similarities for the test vectors', () => {
        (0, vitest_1.expect)((0, speakerVerificationService_1.cosineSimilarity)(USER, USER)).toBeCloseTo(1);
        (0, vitest_1.expect)((0, speakerVerificationService_1.cosineSimilarity)(USER, OTHER)).toBeCloseTo(0);
        (0, vitest_1.expect)((0, speakerVerificationService_1.cosineSimilarity)(USER, NEAR_MISS)).toBeCloseTo(0.65);
        (0, vitest_1.expect)((0, speakerVerificationService_1.cosineSimilarity)([], [])).toBe(0);
    });
});
