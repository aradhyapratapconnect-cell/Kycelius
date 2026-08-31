export function encodePcm16Wav(pcm: Float32Array, sampleRate = 16000): Buffer {
  const numSamples = pcm.length;
  const dataSize = numSamples * 2;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataSize, 40);

  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const clamped = Math.max(-1, Math.min(1, pcm[i]));
    buffer.writeInt16LE(Math.round(clamped * 32767), offset);
    offset += 2;
  }

  return buffer;
}

export interface DecodedWav {
  pcm: Float32Array;
  sampleRate: number;
}

/**
 * Decodes a WAV buffer into mono Float32 PCM. Supports PCM16/PCM24/PCM32 and
 * IEEE-float formats at any channel count (channels are averaged to mono) —
 * cloud TTS (N-08) responses can come back at any rate/depth the endpoint
 * chooses, and the real sample rate is passed through so playback is correct.
 */
export function decodeWav(data: Buffer): DecodedWav {
  if (data.length < 44 || data.toString('ascii', 0, 4) !== 'RIFF') {
    throw new Error('Response was not a WAV audio file.');
  }

  let offset = 12;
  let format = -1;
  let channels = 1;
  let sampleRate = 0;
  let bitsPerSample = 16;
  let dataOffset = -1;
  let dataSize = 0;

  while (offset + 8 <= data.length) {
    const chunkId = data.toString('ascii', offset, offset + 4);
    const chunkSize = data.readUInt32LE(offset + 4);
    const bodyStart = offset + 8;

    if (chunkId === 'fmt ') {
      if (bodyStart + 16 > data.length) break;
      format = data.readUInt16LE(bodyStart);
      channels = data.readUInt16LE(bodyStart + 2);
      sampleRate = data.readUInt32LE(bodyStart + 4);
      bitsPerSample = data.readUInt16LE(bodyStart + 14);
    } else if (chunkId === 'data') {
      dataOffset = bodyStart;
      dataSize = Math.min(chunkSize, data.length - bodyStart);
    }

    // Chunks are word-aligned (2 bytes); pad odd sizes.
    offset = bodyStart + chunkSize + (chunkSize % 2);
  }

  if (dataOffset < 0 || dataSize === 0 || sampleRate <= 0) {
    throw new Error('Response was not a parseable WAV audio file.');
  }

  const bytesPerSample = Math.max(1, bitsPerSample / 8);
  const channelsNorm = Math.max(1, channels);
  const totalFrames = Math.floor(dataSize / (bytesPerSample * channelsNorm));
  const pcm = new Float32Array(totalFrames);

  for (let f = 0; f < totalFrames; f++) {
    let sampleSum = 0;
    for (let c = 0; c < channelsNorm; c++) {
      const idx = dataOffset + (f * channelsNorm + c) * bytesPerSample;
      let value = 0;
      if (format === 3 && bitsPerSample === 32) {
        value = data.readFloatLE(idx);
      } else if (bitsPerSample === 16) {
        value = data.readInt16LE(idx) / 0x8000;
      } else if (bitsPerSample === 24) {
        const raw = data[idx] | (data[idx + 1] << 8) | (data[idx + 2] << 16);
        value = (raw << 8) / 0x80000000; // sign-extend to 32-bit
      } else if (bitsPerSample === 32) {
        value = data.readInt32LE(idx) / 0x80000000;
      } else {
        value = (data[idx] - 128) / 128;
      }
      sampleSum += value;
    }
    pcm[f] = sampleSum / channelsNorm;
  }

  return { pcm, sampleRate };
}
