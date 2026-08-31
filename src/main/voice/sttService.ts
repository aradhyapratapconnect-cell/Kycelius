import type { SpeechDetector } from './vad/sileroVad';

export type SttEngineId = 'whisper' | 'system';

export interface SttVoiceError {
  code: string;
  message: string;
}

export interface SttEngine {
  /** 'whisper' for the local engine, `cloud-stt-<rowId>` for N-08 cloud rows. */
  id: string;
  transcribe(pcm: Float32Array): Promise<string>;
}

export interface SttEventSink {
  onTranscript(text: string, isFinal: boolean): void;
  onVoiceError(error: SttVoiceError): void;
  /**
   * When present, receives every FINAL utterance (audio + text) *instead of*
   * onTranscript — lets the caller gate delivery (F-10 voice biometrics)
   * while keeping interim/error behavior unchanged.
   */
  onUtteranceFinalized?(pcm: Float32Array, text: string): void;
}

interface VadConfig {
  sampleRate: number;
  rmsSpeechThreshold: number;
  silenceMsToFinalize: number;
  minUtteranceMs: number;
  maxUtteranceMs: number;
  /**
   * Streaming partials (STT upgrade step 1c): minimum buffered-speech
   * duration before the first interim transcript is emitted, and the
   * minimum new audio required between interim emissions.
   */
  partialMinBufferedMs: number;
  partialMinNewMs: number;
}

const DEFAULT_VAD: VadConfig = {
  sampleRate: 16000,
  rmsSpeechThreshold: 0.008,
  silenceMsToFinalize: 700,
  minUtteranceMs: 250,
  maxUtteranceMs: 15000,
  partialMinBufferedMs: 1500,
  partialMinNewMs: 800,
};

/**
 * Audio kept from just before speech onset so the first syllable of a quiet
 * start is never clipped out of the utterance handed to the STT engine.
 */
const PRE_ROLL_MS = 300;

/** Frame size fed to a neural speech detector (Silero VAD v5 standard). */
export const DETECTOR_FRAME_SAMPLES = 512;

function rms(chunk: Float32Array): number {
  if (chunk.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < chunk.length; i++) sum += chunk[i] * chunk[i];
  return Math.sqrt(sum / chunk.length);
}

class SttService {
  private engines = new Map<string, SttEngine>();
  private activeEngineId: SttEngineId = 'whisper';
  /**
   * N-08: per-session engine override. beginCommandListening points this at a
   * registered cloud-STT engine id when a cloud provider is the active speech
   * engine; it never touches the user's saved local toggle (activeEngineId),
   * so the Settings toggle keeps reflecting the real choice.
   */
  private sessionEngineOverride: string | null = null;
  private sink: SttEventSink | null = null;

  private sessionActive = false;
  private captureConfirmed = false;

  private buffer: Float32Array[] = [];
  private bufferedSamples = 0;
  private speechStartedAt: number | null = null;
  private lastVoiceAt = 0;

  private vad: VadConfig = { ...DEFAULT_VAD };

  /**
   * Optional neural speech detector (Silero VAD). When null, the legacy
   * synchronous RMS energy threshold decides speech — which is also the
   * graceful fallback if the neural model fails to load or run.
   */
  private detector: SpeechDetector | null = null;

  // Neural-detector pipeline state (async pump over incoming chunks).
  private pendingChunks: Float32Array[] = [];
  private pumpRunning = false;
  private pumpSessionId = 0;
  private frameRemainder: Float32Array[] = [];
  private frameRemainderSamples = 0;

  // Pre-roll ring buffer: last PRE_ROLL_MS of audio, flushed into the
  // utterance buffer the moment the detector says speech started.
  private preRoll = new Float32Array(0);
  private preRollFill = 0;

  // Streaming partials: interim transcriptions of in-progress speech.
  private partialTranscribedSamples = 0;
  private partialInFlight = false;
  /** Bumped whenever an utterance ends/resets; stale partials are discarded. */
  private utteranceGeneration = 0;

  /**
   * Adaptive noise floor (RMS path): a slow EMA of ambient level measured
   * while no speech is active. The speech threshold floats above it, so the
   * same code works in a quiet room and next to a fan. Clamped so a dead-silent
   * room doesn't become hair-trigger and a loud room doesn't go deaf.
   */
  private noiseFloorRms = 0.005;
  private static readonly NOISE_FLOOR_MULTIPLIER = 3;
  private static readonly MIN_SPEECH_RMS = 0.02;
  private static readonly MAX_SPEECH_RMS = 0.12;

  // Loud-duration gate: an utterance must contain at least this much audio
  // above the speech threshold to be worth transcribing — kills the
  // "one noisy chunk triggered it, whisper hallucinated [BLANK_AUDIO]" class.
  private utteranceLoudSamples = 0;
  private static readonly MIN_LOUD_UTTERANCE_MS = 150;

  // EF-04 Symptom B: if the user opens the mic but never speaks, the session
  // must resolve to a clear "didn't catch that" state instead of hanging
  // indefinitely. This timer fires when no speech has started within the
  // window; once speech starts it is cancelled (the silence-to-finalize logic
  // takes over from there).
  private noSpeechTimer: NodeJS.Timeout | null = null;
  private static readonly NO_SPEECH_TIMEOUT_MS = 8000;

  configure(sink: SttEventSink, vad?: Partial<VadConfig>): void {
    this.sink = sink;
    this.vad = { ...DEFAULT_VAD, ...vad };
  }

  /**
   * Installs (or clears) the neural speech detector. Passing null reverts to
   * RMS energy detection. Safe to call mid-session; takes effect on the next
   * incoming chunk.
   */
  setSpeechDetector(detector: SpeechDetector | null): void {
    this.detector = detector;
    this.pendingChunks = [];
    this.frameRemainder = [];
    this.frameRemainderSamples = 0;
    if (!detector) this.preRollFill = 0;
  }

  hasNeuralVad(): boolean {
    return this.detector !== null;
  }

  registerEngine(engine: SttEngine): void {
    this.engines.set(engine.id, engine);
  }

  unregisterEngine(id: string): void {
    this.engines.delete(id);
  }

  setActiveEngine(id: SttEngineId): void {
    this.activeEngineId = id;
  }

  getActiveEngine(): SttEngineId {
    return this.activeEngineId;
  }

  /** Points the next session at a cloud engine id, or clears back to local. */
  setSessionEngine(id: string | null): void {
    this.sessionEngineOverride = id;
  }

  private effectiveEngineId(): string {
    return this.sessionEngineOverride ?? this.activeEngineId;
  }

  isSessionActive(): boolean {
    return this.sessionActive;
  }

  startSession(): { started: boolean; engine: SttEngineId } {
    this.resetBuffer();
    this.pumpSessionId++;
    this.preRoll = new Float32Array((this.vad.sampleRate * PRE_ROLL_MS) / 1000);
    this.preRollFill = 0;
    this.detector?.reset();
    this.sessionActive = true;
    this.captureConfirmed = false;
    this.scheduleNoSpeechTimeout();
    return { started: true, engine: this.activeEngineId };
  }

  stopSession(flushPending = true): void {
    const wasActive = this.sessionActive;
    this.sessionActive = false;
    this.pumpSessionId++;
    this.captureConfirmed = false;
    this.clearNoSpeechTimeout();
    this.sessionEngineOverride = null;
    if (wasActive && flushPending) {
      void this.finalizeUtterance();
    } else {
      this.resetBuffer();
    }
  }

  /**
   * EF-04 Symptom B: arms the "no speech" watchdog for the whole session. If
   * no speech has started before it fires, the session resolves to a clear
   * "didn't catch that" error and stops rather than hanging on silence.
   */
  private scheduleNoSpeechTimeout(): void {
    this.clearNoSpeechTimeout();
    this.noSpeechTimer = setTimeout(() => {
      this.noSpeechTimer = null;
      if (!this.sessionActive || this.speechStartedAt !== null) return;
      // Guard: an impartial backend may have reset the buffer right as the
      // timer fired — only stop if we're still in a live, silent session.
      if (!this.sessionActive) return;

      this.sessionActive = false;
      this.captureConfirmed = false;
      this.resetBuffer();
      this.sink?.onVoiceError({
        code: 'no_speech_detected',
        message:
          "Didn't catch that — I couldn't hear any speech. Try again, or type your request in the command bar.",
      });
    }, SttService.NO_SPEECH_TIMEOUT_MS);
  }

  private clearNoSpeechTimeout(): void {
    if (this.noSpeechTimer) {
      clearTimeout(this.noSpeechTimer);
      this.noSpeechTimer = null;
    }
  }

  handleCaptureStarted(): void {
    this.captureConfirmed = true;
  }

  handleCaptureFailed(error: SttVoiceError): void {
    this.sessionActive = false;
    this.captureConfirmed = false;
    this.clearNoSpeechTimeout();
    this.resetBuffer();
    this.sink?.onVoiceError(error);
  }

  isCaptureConfirmed(): boolean {
    return this.captureConfirmed;
  }

  feedAudioChunk(chunk: Float32Array): void {
    if (!this.sessionActive || chunk.length === 0) return;

    const now = Date.now();
    const level = rms(chunk);
    const threshold = this.effectiveSpeechThreshold();
    const loud = level >= threshold;

    // Track the ambient floor only while no speech is in progress, so the
    // user's own voice never raises the bar against themselves.
    if (this.speechStartedAt === null && !loud) {
      this.noiseFloorRms = 0.9 * this.noiseFloorRms + 0.1 * level;
    }

    // Rolling pre-speech audio, flushed into the utterance if the neural
    // detector later says speech started (covers quiet word onsets).
    this.writePreRoll(chunk);

    // Neural path: chunks are queued and processed frame-by-frame through the
    // detector by an async pump (inference is asynchronous).
    if (this.detector) {
      this.pendingChunks.push(chunk);
      if (!this.pumpRunning) void this.runDetectorPump();
      return;
    }

    // Legacy RMS path (synchronous, also the neural fallback): every chunk
    // during the session is buffered so nothing ahead of the trigger is lost.
    if (loud) {
      this.utteranceLoudSamples += chunk.length;
      if (this.speechStartedAt === null) {
        this.speechStartedAt = now;
        this.clearNoSpeechTimeout();
      }
      this.lastVoiceAt = now;
    }

    this.buffer.push(chunk);
    this.bufferedSamples += chunk.length;

    if (this.speechStartedAt === null) return;

    const bufferedMs = (this.bufferedSamples / this.vad.sampleRate) * 1000;
    const msSinceLastVoice = now - this.lastVoiceAt;

    this.maybeQueuePartialTranscription();

    if (
      msSinceLastVoice >= this.vad.silenceMsToFinalize ||
      bufferedMs >= this.vad.maxUtteranceMs
    ) {
      void this.finalizeUtterance();
    }
  }

  private effectiveSpeechThreshold(): number {
    const floating = this.noiseFloorRms * SttService.NOISE_FLOOR_MULTIPLIER;
    return Math.min(
      Math.max(floating, SttService.MIN_SPEECH_RMS, this.vad.rmsSpeechThreshold),
      SttService.MAX_SPEECH_RMS
    );
  }

  /**
   * Neural-detector pipeline: drains queued chunks in order, slicing them
   * into fixed-size frames for the detector. Only audio from speech onset
   * (+ pre-roll) is buffered, unlike the RMS path.
   */
  private async runDetectorPump(): Promise<void> {
    this.pumpRunning = true;
    const sessionId = this.pumpSessionId;
    try {
      while (this.pendingChunks.length > 0 && this.sessionActive) {
        const chunk = this.pendingChunks.shift()!;
        for (const frame of this.sliceIntoFrames(chunk)) {
          if (!this.sessionActive || sessionId !== this.pumpSessionId) {
            this.pendingChunks = [];
            this.frameRemainder = [];
            this.frameRemainderSamples = 0;
            return;
          }

          let isSpeech: boolean;
          try {
            // A rejected promise must land here too — async detectors never
            // throw synchronously, so the await has to be inside the try.
            const result = this.detector ? this.detector.process(frame) : true;
            isSpeech = typeof result === 'boolean' ? result : await result;
          } catch (err) {
            this.degradeToRms(err);
            return;
          }
          if (!this.sessionActive || sessionId !== this.pumpSessionId) {
            this.pendingChunks = [];
            return;
          }
          this.applyDetectorVerdict(isSpeech, frame);
        }
      }
    } finally {
      this.pumpRunning = false;
    }
  }

  private applyDetectorVerdict(isSpeech: boolean, frame: Float32Array): void {
    const now = Date.now();

    if (isSpeech && this.speechStartedAt === null) {
      this.speechStartedAt = now;
      this.clearNoSpeechTimeout();
      this.flushPreRollIntoBuffer();
    }
    if (isSpeech) {
      this.lastVoiceAt = now;
      this.utteranceLoudSamples += frame.length;
    }

    // Buffer only once speech has started; pre-roll covers the onset.
    if (this.speechStartedAt !== null) {
      this.buffer.push(frame);
      this.bufferedSamples += frame.length;
    }

    if (this.speechStartedAt === null) return;

    const bufferedMs = (this.bufferedSamples / this.vad.sampleRate) * 1000;
    const msSinceLastVoice = now - this.lastVoiceAt;

    this.maybeQueuePartialTranscription();

    if (
      msSinceLastVoice >= this.vad.silenceMsToFinalize ||
      bufferedMs >= this.vad.maxUtteranceMs
    ) {
      void this.finalizeUtterance();
    }
  }

  /**
   * Emits interim transcripts while speech is still in progress (STT
   * upgrade step 1c), so the command bar can show live text. Partials are
   * display-only: they never route through biometric gating or command
   * handling — only the final utterance does.
   */
  private maybeQueuePartialTranscription(): void {
    if (!this.sink || this.partialInFlight || this.bufferedSamples === 0) return;

    const bufferedMs = (this.bufferedSamples / this.vad.sampleRate) * 1000;
    const newMs =
      ((this.bufferedSamples - this.partialTranscribedSamples) / this.vad.sampleRate) * 1000;

    const firstPartialReady =
      this.partialTranscribedSamples === 0 && bufferedMs >= this.vad.partialMinBufferedMs;
    const nextPartialReady = this.partialTranscribedSamples > 0 && newMs >= this.vad.partialMinNewMs;
    if (!firstPartialReady && !nextPartialReady) return;

    void this.runPartialTranscription();
  }

  private async runPartialTranscription(): Promise<void> {
    const generation = this.utteranceGeneration;
    const parts = this.buffer.slice();
    const samples = this.bufferedSamples;

    this.partialInFlight = true;
    try {
      // Snapshot the buffer so ongoing capture isn't disturbed by the
      // transcription pass running on its own copy.
      const merged = new Float32Array(samples);
      let offset = 0;
      for (const part of parts) {
        merged.set(part, offset);
        offset += part.length;
      }

      const engine = this.engines.get(this.effectiveEngineId());
      if (!engine) return;

      const text = await engine.transcribe(merged);
      if (generation !== this.utteranceGeneration || !this.sessionActive) return;

      const trimmed = text.trim();
      if (trimmed.length === 0) return;

      this.partialTranscribedSamples = samples;
      this.sink?.onTranscript(trimmed, false);
    } catch {
      // Interim failures are non-fatal — the final pass surfaces real
      // errors through the normal channel.
    } finally {
      this.partialInFlight = false;
    }
  }

  /** Neural detection failed permanently — fall back to RMS and drain what's queued. */
  private degradeToRms(err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      `[sttService] neural voice-activity detector unavailable, falling back to volume-based detection: ${message}`
    );
    this.detector = null;
    this.pendingChunks = [];
    this.frameRemainder = [];
    this.frameRemainderSamples = 0;
    this.preRollFill = 0;
  }

  private *sliceIntoFrames(chunk: Float32Array): Generator<Float32Array> {
    let offset = 0;
    // Keep going while raw chunk data remains OR a complete frame is already
    // assembled — a ready frame must never wait for the next chunk.
    while (
      offset < chunk.length ||
      this.frameRemainderSamples >= DETECTOR_FRAME_SAMPLES
    ) {
      if (this.frameRemainderSamples >= DETECTOR_FRAME_SAMPLES) {
        yield this.takeFrame();
      } else {
        const space = DETECTOR_FRAME_SAMPLES - this.frameRemainderSamples;
        const take = Math.min(space, chunk.length - offset);
        this.frameRemainder.push(chunk.subarray(offset, offset + take));
        this.frameRemainderSamples += take;
        offset += take;
      }
    }
  }

  private takeFrame(): Float32Array {
    const frame = new Float32Array(DETECTOR_FRAME_SAMPLES);
    let filled = 0;
    while (filled < DETECTOR_FRAME_SAMPLES && this.frameRemainder.length > 0) {
      const part = this.frameRemainder[0];
      const take = Math.min(part.length, DETECTOR_FRAME_SAMPLES - filled);
      frame.set(part.subarray(0, take), filled);
      filled += take;
      if (take < part.length) {
        this.frameRemainder[0] = part.subarray(take);
      } else {
        this.frameRemainder.shift();
      }
      this.frameRemainderSamples -= take;
    }
    return frame;
  }

  private writePreRoll(chunk: Float32Array): void {
    if (this.preRoll.length === 0) return;
    if (chunk.length >= this.preRoll.length) {
      this.preRoll.set(chunk.subarray(chunk.length - this.preRoll.length));
      this.preRollFill = this.preRoll.length;
      return;
    }
    const overflow = this.preRollFill + chunk.length - this.preRoll.length;
    if (overflow > 0) {
      this.preRoll.copyWithin(0, overflow, this.preRollFill);
      this.preRollFill -= overflow;
    }
    this.preRoll.set(chunk, this.preRollFill);
    this.preRollFill += chunk.length;
  }

  private flushPreRollIntoBuffer(): void {
    if (this.preRoll.length === 0 || this.preRollFill === 0) return;
    const heldAudio = this.preRoll.slice(
      this.preRoll.length - this.preRollFill,
      this.preRoll.length
    );
    this.buffer.push(heldAudio);
    this.bufferedSamples += heldAudio.length;
    this.preRollFill = 0;
  }

  async finalizeUtterance(): Promise<void> {
    const parts = this.buffer;
    const samples = this.bufferedSamples;
    const speechStartedAt = this.speechStartedAt;
    this.resetBuffer();

    if (speechStartedAt === null || samples === 0) return;

    const durationMs = (samples / this.vad.sampleRate) * 1000;
    if (durationMs < this.vad.minUtteranceMs) {
      return;
    }

    const merged = new Float32Array(samples);
    let offset = 0;
    for (const part of parts) {
      merged.set(part, offset);
      offset += part.length;
    }

    const engine = this.engines.get(this.effectiveEngineId());
    if (!engine) {
      this.sink?.onVoiceError({
        code: 'stt_engine_unavailable',
        message:
          'The selected speech engine is not available. Pick another engine in Settings, or type your request in the command bar.',
      });
      return;
    }

    try {
      const text = await engine.transcribe(merged);
      const trimmed = text.trim();
      if (trimmed.length > 0) {
        if (this.sink?.onUtteranceFinalized) {
          this.sink.onUtteranceFinalized(merged, trimmed);
        } else {
          this.sink?.onTranscript(trimmed, true);
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.sink?.onVoiceError({ code: 'stt_engine_error', message });
    }
  }

  private resetBuffer(): void {
    this.buffer = [];
    this.bufferedSamples = 0;
    this.speechStartedAt = null;
    this.lastVoiceAt = 0;
    this.pendingChunks = [];
    this.frameRemainder = [];
    this.frameRemainderSamples = 0;
    // Any in-flight interim transcription now belongs to a dead utterance.
    this.utteranceGeneration++;
    this.partialTranscribedSamples = 0;
  }
}

export const sttService = new SttService();
