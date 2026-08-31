"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const pcmWav_1 = require("../pcmWav");
(0, vitest_1.describe)('encodePcm16Wav', () => {
    (0, vitest_1.it)('produces a valid 16-bit mono PCM WAV header entirely in memory', () => {
        const pcm = new Float32Array([0, 0.5, -0.5, 1]);
        const wav = (0, pcmWav_1.encodePcm16Wav)(pcm, 16000);
        (0, vitest_1.expect)(wav.toString('ascii', 0, 4)).toBe('RIFF');
        (0, vitest_1.expect)(wav.toString('ascii', 8, 12)).toBe('WAVE');
        (0, vitest_1.expect)(wav.readUInt32LE(24)).toBe(16000);
        (0, vitest_1.expect)(wav.readUInt16LE(22)).toBe(1);
        (0, vitest_1.expect)(wav.readUInt16LE(34)).toBe(16);
        (0, vitest_1.expect)(wav.readUInt32LE(40)).toBe(pcm.length * 2);
        (0, vitest_1.expect)(wav.length).toBe(44 + pcm.length * 2);
    });
    (0, vitest_1.it)('encodes sample values with clamping to the int16 range', () => {
        const wav = (0, pcmWav_1.encodePcm16Wav)(new Float32Array([0.5, -0.5, 2, -2]), 16000);
        (0, vitest_1.expect)(wav.readInt16LE(44)).toBe(Math.round(0.5 * 32767));
        (0, vitest_1.expect)(wav.readInt16LE(46)).toBe(Math.round(-0.5 * 32767));
        (0, vitest_1.expect)(wav.readInt16LE(48)).toBe(32767);
        (0, vitest_1.expect)(wav.readInt16LE(50)).toBe(-32767);
    });
});
