// Pure helpers for the VoiceEnrollment flow (T-19). Kept DOM-free so the
// meter math and date formatting are unit-testable in a plain node env.

/**
 * RMS level (0..1) of a Uint8Array time-domain signal, as produced by
 * AnalyserNode.getByteTimeDomainData() (values centered on 128).
 */
export function rmsFromBytes(data: Uint8Array): number {
  if (data.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    const sample = (data[i] - 128) / 128;
    sum += sample * sample;
  }
  return Math.min(1, Math.sqrt(sum / data.length));
}

/** "January 2, 2025" from an ISO timestamp, or '' when unreadable. */
export function formatEnrolledDate(iso?: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}