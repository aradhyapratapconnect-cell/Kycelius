import type { KycliusAPI, SttEngineId, VoiceError } from '@shared/types/ipc';

const TARGET_SAMPLE_RATE = 16000;

interface SpeechRecognitionAlternativeLike {
  transcript: string;
  confidence: number;
}

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: SpeechRecognitionAlternativeLike;
  length: number;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: { length: number; [index: number]: SpeechRecognitionResultLike };
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function downsampleTo16k(input: Float32Array, inputSampleRate: number): Float32Array {
  if (inputSampleRate === TARGET_SAMPLE_RATE) return input;
  const ratio = inputSampleRate / TARGET_SAMPLE_RATE;
  const outputLength = Math.floor(input.length / ratio);
  const output = new Float32Array(outputLength);
  for (let i = 0; i < outputLength; i++) {
    const srcIndex = i * ratio;
    const low = Math.floor(srcIndex);
    const high = Math.min(low + 1, input.length - 1);
    const weight = srcIndex - low;
    output[i] = input[low] * (1 - weight) + input[high] * weight;
  }
  return output;
}

type CaptureMode = 'idle' | 'session' | 'ambient';

class VoiceCaptureController {
  private api: KycliusAPI | null = null;
  private mode: CaptureMode = 'idle';
  // Guards async setup against overlapping start/stop requests: anything
  // belonging to an older generation is discarded when it resolves.
  private generation = 0;

  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private processor: ScriptProcessorNode | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;

  private recognition: SpeechRecognitionLike | null = null;

  initialize(api: KycliusAPI): () => void {
    this.api = api;
    const offStart = api.onVoiceStartCapture(({ engine }) => {
      void this.beginCapture(engine);
    });
    const offStop = api.onVoiceStopCapture(() => {
      this.endCapture();
    });
    const offWakeStart = api.onWakeStartAmbientCapture(() => {
      void this.startAmbient();
    });
    const offWakeStop = api.onWakeStopAmbientCapture(() => {
      if (this.mode === 'ambient') this.teardown();
    });
    return () => {
      offStart();
      offStop();
      offWakeStart();
      offWakeStop();
      this.teardown();
      this.api = null;
    };
  }

  private async beginCapture(engine: SttEngineId): Promise<void> {
    const gen = ++this.generation;
    this.releaseMediaResources();

    // A command session always preempts ambient wake-word streaming.
    if (this.audioContext && this.audioContext.state !== 'closed') {
      void this.audioContext.close().catch(() => {});
    }
    this.audioContext = null;
    this.mode = 'session';

    if (engine === 'system') {
      this.startSystemRecognition();
      return;
    }

    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });

      if (gen !== this.generation) {
        for (const track of mediaStream.getTracks()) track.stop();
        return;
      }

      this.mediaStream = mediaStream;

      const Ctx = window.AudioContext;
      const audioContext = new Ctx();
      this.audioContext = audioContext;
      const inputSampleRate = audioContext.sampleRate;

      this.sourceNode = audioContext.createMediaStreamSource(mediaStream);
      this.processor = audioContext.createScriptProcessor(4096, 1, 1);

      this.processor.onaudioprocess = event => {
        if (this.mode !== 'session' || gen !== this.generation) return;
        const input = event.inputBuffer.getChannelData(0);
        const chunk = downsampleTo16k(new Float32Array(input), inputSampleRate);
        if (chunk.length > 0) {
          this.api?.sendAudioChunk(chunk.buffer as ArrayBuffer);
        }
      };

      this.sourceNode.connect(this.processor);
      this.processor.connect(audioContext.destination);

      this.api?.notifyVoiceCaptureStarted();
    } catch (err) {
      if (gen !== this.generation) return;
      this.mode = 'idle';
      this.releaseMediaResources();
      this.api?.notifyVoiceCaptureFailed(toVoiceError(err));
    }
  }

  /**
   * Continuous low-cost mic streaming that feeds the main process's wake word
   * detector. Runs while background listening is enabled and no command
   * session is active — including when the window is hidden or minimized.
   */
  private async startAmbient(): Promise<void> {
    const gen = ++this.generation;
    this.endSystemRecognition();
    this.releaseMediaResources();
    if (this.audioContext && this.audioContext.state !== 'closed') {
      void this.audioContext.close().catch(() => {});
    }
    this.audioContext = null;
    this.mode = 'ambient';

    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });

      if (gen !== this.generation) {
        for (const track of mediaStream.getTracks()) track.stop();
        return;
      }

      this.mediaStream = mediaStream;

      const Ctx = window.AudioContext;
      const audioContext = new Ctx();
      this.audioContext = audioContext;
      const inputSampleRate = audioContext.sampleRate;

      this.sourceNode = audioContext.createMediaStreamSource(mediaStream);
      this.processor = audioContext.createScriptProcessor(4096, 1, 1);

      this.processor.onaudioprocess = event => {
        if (this.mode !== 'ambient' || gen !== this.generation) return;
        const input = event.inputBuffer.getChannelData(0);
        const chunk = downsampleTo16k(new Float32Array(input), inputSampleRate);
        if (chunk.length > 0) {
          this.api?.sendWakeAudioChunk(chunk.buffer as ArrayBuffer);
        }
      };

      this.sourceNode.connect(this.processor);
      this.processor.connect(audioContext.destination);

      this.api?.notifyWakeCaptureStarted();
    } catch (err) {
      if (gen !== this.generation) return;
      this.mode = 'idle';
      this.releaseMediaResources();
      this.api?.notifyVoiceCaptureFailed(toVoiceError(err));
    }
  }

  private endCapture(): void {
    this.teardown();
  }

  private startSystemRecognition(): void {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      this.api?.notifyVoiceCaptureFailed({
        code: 'stt_engine_unavailable',
        message:
          'System speech recognition is not available in this environment. Switch to the whisper engine in Settings or type your request.',
      });
      return;
    }

    try {
      const recognition = new Ctor();
      recognition.lang = navigator.language || 'en-US';
      recognition.continuous = true;
      recognition.interimResults = true;

      recognition.onresult = event => {
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          const text = result[0]?.transcript ?? '';
          if (text.trim().length > 0) {
            this.api?.submitSystemTranscript(text, result.isFinal);
          }
        }
      };

      recognition.onerror = event => {
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
          this.teardown();
          this.api?.notifyVoiceCaptureFailed({
            code: 'mic_permission_denied',
            message:
              'Microphone access was denied. Allow microphone access for Kyclius in your system settings, then try again — or type your request instead.',
          });
        }
      };

      recognition.onend = () => {
        if (this.mode === 'session' && this.recognition === recognition) {
          recognition.start();
        }
      };

      recognition.start();
      this.recognition = recognition;
      this.api?.notifyVoiceCaptureStarted();
    } catch (err) {
      this.mode = 'idle';
      this.api?.notifyVoiceCaptureFailed(toVoiceError(err));
    }
  }

  private endSystemRecognition(): void {
    if (this.recognition) {
      try {
        this.recognition.onend = null;
        this.recognition.abort();
      } catch {
        // already stopped
      }
      this.recognition = null;
    }
  }

  /** Full stop of whatever capture is running (session, ambient, or system). */
  private teardown(): void {
    ++this.generation;
    this.mode = 'idle';

    this.endSystemRecognition();
    this.releaseMediaResources();

    if (this.audioContext && this.audioContext.state !== 'closed') {
      void this.audioContext.close().catch(() => {});
    }
    this.audioContext = null;
  }

  private releaseMediaResources(): void {
    if (this.processor) {
      this.processor.onaudioprocess = null;
      try {
        this.processor.disconnect();
      } catch {
        // not connected
      }
      this.processor = null;
    }
    if (this.sourceNode) {
      try {
        this.sourceNode.disconnect();
      } catch {
        // not connected
      }
      this.sourceNode = null;
    }
    if (this.mediaStream) {
      for (const track of this.mediaStream.getTracks()) track.stop();
      this.mediaStream = null;
    }
  }
}

function toVoiceError(err: unknown): VoiceError {
  const name = err instanceof Error ? err.name : '';
  const message = err instanceof Error ? err.message : String(err);

  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return {
      code: 'mic_permission_denied',
      message:
        'Microphone access was denied. Allow microphone access for Kyclius in your system settings, then try again — or type your request instead.',
    };
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') {
    return {
      code: 'mic_not_found',
      message: 'No microphone was found. Connect a microphone to speak to Kyclius, or type your request instead.',
    };
  }
  return { code: 'capture_failed', message: `Microphone capture failed: ${message}` };
}

export const voiceCapture = new VoiceCaptureController();
