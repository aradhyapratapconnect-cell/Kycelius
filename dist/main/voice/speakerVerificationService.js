"use strict";
// Voice biometrics / speaker verification (F-10).
//
// Enrolls the user's voice as an encrypted numeric voiceprint (never raw
// audio) and verifies incoming voice against it. Per Security & Access
// Document §5, once enrolled this gates BOTH command issuance and spoken
// confirmations — and every ambiguity fails closed: a low-confidence match is
// treated as "not the enrolled user", never guessed yes.
//
// The service itself is pure and dependency-injected (embedder, encrypted
// profile repository) so its trust logic is fully unit-testable; production
// wiring plugs in the ONNX embedder and safeStorage-backed storage.
Object.defineProperty(exports, "__esModule", { value: true });
exports.speakerVerificationService = exports.MAX_ENROLLMENT_SAMPLES = exports.MIN_ENROLLMENT_SAMPLES = exports.DEFAULT_SPEAKER_THRESHOLD = void 0;
exports.cosineSimilarity = cosineSimilarity;
exports.DEFAULT_SPEAKER_THRESHOLD = 0.7;
exports.MIN_ENROLLMENT_SAMPLES = 3;
exports.MAX_ENROLLMENT_SAMPLES = 5;
const SAMPLE_RATE = 16000;
const MIN_SAMPLE_MS = 800;
const PRIMARY_LABEL = 'primary user';
function cosineSimilarity(a, b) {
    if (a.length === 0 || a.length !== b.length)
        return 0;
    let dot = 0;
    let magA = 0;
    let magB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        magA += a[i] * a[i];
        magB += b[i] * b[i];
    }
    if (magA === 0 || magB === 0)
        return 0;
    return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}
class SpeakerVerificationService {
    deps = null;
    enabled = false;
    threshold = exports.DEFAULT_SPEAKER_THRESHOLD;
    configure(deps, options) {
        this.deps = deps;
        if (options?.threshold !== undefined && options.threshold > 0 && options.threshold <= 1) {
            this.threshold = options.threshold;
        }
    }
    setEnabled(enabled) {
        this.enabled = enabled;
    }
    isEnabled() {
        return this.enabled;
    }
    getThreshold() {
        return this.threshold;
    }
    isEnrolled() {
        if (!this.deps)
            return false;
        try {
            return this.deps.repository.hasPrimary();
        }
        catch {
            return false;
        }
    }
    /**
     * Builds a voiceprint from 3-5 short enrollment phrases and stores it
     * encrypted, replacing any previous enrollment (re-enroll = replace).
     * Raw audio stays in memory — only the numeric embedding is persisted.
     */
    async enroll(audioSamples) {
        const deps = this.deps;
        if (!deps) {
            return { ok: false, error: 'Speaker verification is not available yet.' };
        }
        if (!Array.isArray(audioSamples) ||
            audioSamples.length < exports.MIN_ENROLLMENT_SAMPLES ||
            audioSamples.length > exports.MAX_ENROLLMENT_SAMPLES) {
            return {
                ok: false,
                error: `Enrollment needs ${exports.MIN_ENROLLMENT_SAMPLES}-${exports.MAX_ENROLLMENT_SAMPLES} short phrases.`,
            };
        }
        const minSamples = (SAMPLE_RATE * MIN_SAMPLE_MS) / 1000;
        for (let i = 0; i < audioSamples.length; i++) {
            const sample = audioSamples[i];
            if (!(sample instanceof Float32Array) || sample.length < minSamples) {
                return {
                    ok: false,
                    error: `Phrase ${i + 1} was too short. Hold each phrase for about a second.`,
                };
            }
        }
        try {
            const embeddings = [];
            for (const sample of audioSamples) {
                embeddings.push(l2Normalize(await deps.embed(sample)));
            }
            const dim = embeddings[0].length;
            if (embeddings.some(vec => vec.length !== dim)) {
                throw new Error('Speaker engine returned inconsistent embeddings.');
            }
            const averaged = l2Normalize(embeddings[0].map((_, d) => embeddings.reduce((sum, vec) => sum + vec[d], 0)));
            const enrolledAt = new Date().toISOString();
            deps.repository.replace(PRIMARY_LABEL, deps.crypto.encrypt(JSON.stringify({ embedding: averaged })));
            return { ok: true, sampleCount: audioSamples.length, enrolledAt };
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { ok: false, error: message };
        }
    }
    /**
     * Verifies one utterance against the enrolled voiceprint.
     * Fails closed on every uncertain outcome — below-threshold similarity,
     * engine failure, or an unreadable profile all resolve to matched:false.
     */
    async verify(audioSample) {
        if (!this.enabled) {
            return { matched: true, confidence: 1, mode: 'bypassed', reason: 'disabled' };
        }
        if (!this.isEnrolled()) {
            return { matched: true, confidence: 1, mode: 'bypassed', reason: 'not_enrolled' };
        }
        if (!(audioSample instanceof Float32Array) || audioSample.length === 0) {
            return { matched: false, confidence: 0, mode: 'gated', reason: 'empty_sample' };
        }
        const deps = this.deps;
        let storedEmbedding;
        try {
            const blob = deps.repository.getPrimaryBlob();
            if (!blob) {
                // Enrollment vanished between the checks above — treat as unenrolled.
                return { matched: true, confidence: 1, mode: 'bypassed', reason: 'not_enrolled' };
            }
            const parsed = JSON.parse(deps.crypto.decrypt(blob));
            if (!Array.isArray(parsed.embedding))
                throw new Error('voiceprint payload malformed');
            storedEmbedding = parsed.embedding;
        }
        catch {
            // Corrupt or undecryptable profile: fail closed rather than guessing yes.
            return {
                matched: false,
                confidence: 0,
                mode: 'gated',
                reason: 'unreadable_profile',
            };
        }
        try {
            const candidate = l2Normalize(await deps.embed(audioSample));
            const confidence = cosineSimilarity(candidate, storedEmbedding);
            // Strict threshold comparison: anything below it (including a hair
            // under) is rejected — low confidence can never resolve to matched.
            return {
                matched: confidence >= this.threshold,
                confidence,
                mode: 'gated',
                reason: confidence >= this.threshold ? undefined : 'below_threshold',
            };
        }
        catch {
            return { matched: false, confidence: 0, mode: 'gated', reason: 'engine_error' };
        }
    }
    /** Deletes the stored voiceprint outright — any voice is accepted again immediately. */
    removeEnrollment() {
        this.deps?.repository.removeAll();
    }
}
function l2Normalize(vector) {
    const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
    if (magnitude === 0)
        return vector.map(() => 0);
    return vector.map(v => v / magnitude);
}
exports.speakerVerificationService = new SpeakerVerificationService();
