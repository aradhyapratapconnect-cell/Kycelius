import { describe, expect, it } from 'vitest';
import { formatEnrolledDate, rmsFromBytes } from './voiceEnrollmentUtils';

describe('rmsFromBytes', () => {
  it('is 0 for silence', () => {
    expect(rmsFromBytes(new Uint8Array([128, 128, 128, 128, 128]))).toBe(0);
  });

  it('is ~max for full-amplitude signal', () => {
    // 0 -> -1.0, 255 -> 127/128; RMS of alternating extremes ~0.9961
    const level = rmsFromBytes(new Uint8Array([0, 255, 0, 255, 0, 255]));
    expect(level).toBeCloseTo(0.9961, 3);
  });

  it('is 0 for an empty buffer', () => {
    expect(rmsFromBytes(new Uint8Array())).toBe(0);
  });

  it('is proportional for mid-level signals', () => {
    // Steady +/-0.375 amplitude -> RMS 0.375
    expect(rmsFromBytes(new Uint8Array([80, 176, 80, 176]))).toBeCloseTo(0.375, 3);
  });

  it('never exceeds 1', () => {
    const data = new Uint8Array(256);
    let level = -1;
    for (let i = 0; i < 256; i++) level = Math.max(level, rmsFromBytes(data.fill(i)));
    expect(level).toBeLessThanOrEqual(1);
  });
});

describe('formatEnrolledDate', () => {
  it('formats an ISO timestamp as a readable date', () => {
    expect(formatEnrolledDate('2025-01-02T03:04:05.000Z')).toBe('January 2, 2025');
  });

  it('handles local-tz ISO strings from npm-level db rows', () => {
    const plain = '2025-06-15 12:30:00';
    const formatted = formatEnrolledDate(plain);
    expect(formatted).toMatch(/\d{1,2}, 2025/);
    expect(formatted).toContain('June');
  });

  it('returns "" for undefined, empty, and garbage input', () => {
    expect(formatEnrolledDate(undefined)).toBe('');
    expect(formatEnrolledDate('')).toBe('');
    expect(formatEnrolledDate('not-a-date')).toBe('');
  });
});