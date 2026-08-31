import { describe, expect, it } from 'vitest';
import { encodePcm16Wav } from '../pcmWav';

describe('encodePcm16Wav', () => {
  it('produces a valid 16-bit mono PCM WAV header entirely in memory', () => {
    const pcm = new Float32Array([0, 0.5, -0.5, 1]);
    const wav = encodePcm16Wav(pcm, 16000);

    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.toString('ascii', 8, 12)).toBe('WAVE');
    expect(wav.readUInt32LE(24)).toBe(16000);
    expect(wav.readUInt16LE(22)).toBe(1);
    expect(wav.readUInt16LE(34)).toBe(16);
    expect(wav.readUInt32LE(40)).toBe(pcm.length * 2);
    expect(wav.length).toBe(44 + pcm.length * 2);
  });

  it('encodes sample values with clamping to the int16 range', () => {
    const wav = encodePcm16Wav(new Float32Array([0.5, -0.5, 2, -2]), 16000);
    expect(wav.readInt16LE(44)).toBe(Math.round(0.5 * 32767));
    expect(wav.readInt16LE(46)).toBe(Math.round(-0.5 * 32767));
    expect(wav.readInt16LE(48)).toBe(32767);
    expect(wav.readInt16LE(50)).toBe(-32767);
  });
});
