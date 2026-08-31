import { useCallback, useEffect, useRef, useState } from 'react';
import { formatEnrolledDate, rmsFromBytes } from './voiceEnrollmentUtils';

const PHRASE_COUNT = 3;
const PHRASE_MS = 1500;

const PHRASE_LABELS = [
  'Say a short phrase — sample 1 of 3',
  'Say another short phrase — sample 2 of 3',
  'Say one more short phrase — sample 3 of 3',
];

/**
 * T-19: Voice enrollment card. Shows enrollment status ("enrolled on <date>"),
 * a guided 3-phrase enrollment with a live input level meter, a remove action,
 * and a plain-language privacy note. The flow can be exited at any point
 * without persisting a partial voiceprint (samples only reach the DB in the
 * single enroll() call after all phrases are captured).
 */
export function VoiceEnrollment() {
  const [enrolled, setEnrolled] = useState(false);
  const [enrolledAt, setEnrolledAt] = useState<string | undefined>(undefined);
  const [phase, setPhase] = useState<number | null>(null);
  const [level, setLevel] = useState(0);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; message?: string } | null>(
    null
  );

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const samplesRef = useRef<Float32Array[]>([]);
  const cancelledRef = useRef(false);

  const refreshStatus = useCallback(async () => {
    try {
      const status = await window.kyclius.getBiometricsStatus();
      setEnrolled(status.enrolled);
      setEnrolledAt(status.enrolledAt);
    } catch {
      // IPC not ready yet; keep current values.
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
    return () => {
      cancelledRef.current = true;
      releaseResources();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshStatus]);

  function releaseResources() {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
    recorderRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (audioCtxRef.current) void audioCtxRef.current.close();
    audioCtxRef.current = null;
    analyserRef.current = null;
    setLevel(0);
  }

  const startMeter = useCallback(() => {
    const analyser = analyserRef.current;
    if (!analyser) return;
    const data = new Uint8Array(analyser.fftSize);
    const tick = () => {
      const a = analyserRef.current;
      if (!a) return;
      a.getByteTimeDomainData(data);
      setLevel(rmsFromBytes(data));
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const startEnrollment = useCallback(async () => {
    if (busy) return;
    setFeedback(null);
    cancelledRef.current = false;
    samplesRef.current = [];
    setBusy(true);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const audioCtx = new AudioContext();
      audioCtxRef.current = audioCtx;
      if (audioCtx.state === 'suspended') await audioCtx.resume();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.55;
      source.connect(analyser);
      analyserRef.current = analyser;
      startMeter();
    } catch {
      releaseResources();
      setBusy(false);
      setFeedback({
        ok: false,
        message: 'Microphone access denied or unavailable.',
      });
      return;
    }

    const recordOne = (): Promise<void> =>
      new Promise<void>((resolve) => {
        const stream = streamRef.current;
        if (!stream) {
          resolve();
          return;
        }
        const recorder = new MediaRecorder(stream, {
          mimeType: 'audio/webm;codecs=opus',
        });
        recorderRef.current = recorder;
        const chunks: Blob[] = [];
        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) chunks.push(event.data);
        };
        recorder.onstop = () => {
          void (async () => {
            if (cancelledRef.current) {
              resolve();
              return;
            }
            const blob = new Blob(chunks, { type: 'audio/webm' });
            samplesRef.current.push(await decodeToPcm16k(blob));
            resolve();
          })();
        };
        recorder.start();
        setTimeout(() => {
          if (recorderRef.current?.state === 'recording') {
            recorderRef.current.stop();
          }
        }, PHRASE_MS);
      });

    for (let i = 0; i < PHRASE_COUNT; i++) {
      if (cancelledRef.current) break;
      setPhase(i);
      await recordOne();
      if (cancelledRef.current) break;
      if (i < PHRASE_COUNT - 1) {
        await new Promise((resolve) => setTimeout(resolve, 450));
      }
    }

    releaseResources();

    if (cancelledRef.current) {
      setBusy(false);
      setPhase(null);
      setFeedback({
        ok: true,
        message: 'Enrollment cancelled — nothing was saved.',
      });
      return;
    }

    const pcm = samplesRef.current;
    try {
      const result = await window.kyclius.enrollVoice(
        pcm.map((sample) => sample.buffer as ArrayBuffer)
      );
      if (result.ok) {
        await refreshStatus();
        setFeedback({
          ok: true,
          message: `Voice enrolled (${pcm.length} samples) — only a numeric voiceprint is kept.`,
        });
      } else {
        setFeedback({
          ok: false,
          message: result.error ?? 'Enrollment failed.',
        });
      }
    } catch (error) {
      setFeedback({
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    setBusy(false);
    setPhase(null);
  }, [busy, refreshStatus, startMeter]);

  const handleExit = useCallback(() => {
    cancelledRef.current = true;
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
  }, []);

  const handleRemove = useCallback(async () => {
    setBusy(true);
    setFeedback(null);
    try {
      await window.kyclius.removeVoiceEnrollment();
      await refreshStatus();
      setFeedback({
        ok: true,
        message: 'Voice profile removed — Kyclius accepts any voice again.',
      });
    } catch (error) {
      setFeedback({
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    setBusy(false);
  }, [refreshStatus]);

  const isRecording = phase !== null;
  const pct = Math.round(Math.min(1, Math.max(0, level)) * 100);

  return (
    <div className="space-y-3">
      <p
        className={
          enrolled
            ? 'text-[11px] font-medium text-leaf-primary'
            : 'text-[11px] font-medium text-bark'
        }
      >
        {enrolled ? '● Enrolled' : '○ Not enrolled'}
        {enrolled && enrolledAt
          ? ` — voice enrolled on ${formatEnrolledDate(enrolledAt)}`
          : ''}
      </p>

      {!isRecording && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void startEnrollment()}
            className="rounded-lg bg-primary-container px-3 py-1.5 text-[11px] font-medium text-on-primary-container transition-colors hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? 'Working…' : enrolled ? 'Re-enroll voice' : 'Enroll voice'}
          </button>
          {enrolled && !busy && (
            <button
              type="button"
              onClick={() => void handleRemove()}
              className="rounded-lg border border-bark/20 px-3 py-1.5 text-[11px] font-medium text-bark transition-colors hover:text-danger"
            >
              Remove my voice data
            </button>
          )}
        </div>
      )}

      {isRecording && (
        <div className="space-y-2">
          <p className="text-[11px] font-medium text-blossom-deep animate-pulse-soft">
            {PHRASE_LABELS[phase as number]}
          </p>
          <div
            aria-hidden
            className="h-2 w-full overflow-hidden rounded-full border border-bark/10 bg-stone"
          >
            <div
              className="h-full bg-blossom-deep/80"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] text-bark">
              Speak clearly into your microphone…
            </p>
            <button
              type="button"
              onClick={handleExit}
              className="rounded-lg border border-bark/20 px-2.5 py-1 text-[10px] font-medium text-bark transition-colors hover:text-danger"
            >
              Exit
            </button>
          </div>
        </div>
      )}

      <p className="text-[11px] leading-relaxed text-bark">
        Only a numeric voiceprint is stored — the audio you record is never kept
        as a sound clip, so re-enrolling is just as easy as removing it.
      </p>

      {feedback?.message && (
        <p
          role="status"
          className={
            feedback.ok
              ? 'text-[11px] font-medium text-leaf-primary'
              : 'text-[11px] font-medium text-danger'
          }
        >
          {feedback.message}
        </p>
      )}
    </div>
  );
}

async function decodeToPcm16k(blob: Blob): Promise<Float32Array> {
  const buffer = await blob.arrayBuffer();
  const audioCtx = new AudioContext();
  const decoded = await audioCtx.decodeAudioData(buffer);
  await audioCtx.close();
  const offlineCtx = new OfflineAudioContext(1, decoded.length, 16000);
  const source = offlineCtx.createBufferSource();
  source.buffer = decoded;
  source.connect(offlineCtx.destination);
  source.start();
  const rendered = await offlineCtx.startRendering();
  return rendered.getChannelData(0);
}