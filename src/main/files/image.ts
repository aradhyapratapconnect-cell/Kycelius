/**
 * N-06 — Image metadata extraction.
 *
 * The LLM bridge in Kyclius is text-only: image pixels cannot reach the
 * model, and there is no bundled OCR engine. So an image reference resolves
 * to its format + dimensions + size, surfaced with an explicit note that
 * pixel content isn't readable yet — never a silent no-op.
 *
 * Dimensions are read from each format's own header bytes (no decoder lib):
 * PNG IHDR fields, JPEG SOFn segments, GIF logical-screen descriptors, and
 * the common WebP chunk layouts.
 */

export interface ImageMetadata {
  format: string;
  width: number | null;
  height: number | null;
  byteSize: number;
}

function detectFormat(buffer: Buffer): string | null {
  if (buffer.length >= 8 && buffer.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') {
    return 'PNG';
  }
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    return 'JPEG';
  }
  if (buffer.length >= 6 && buffer.subarray(0, 6).toString('latin1') === 'GIF87a') {
    return 'GIF';
  }
  if (buffer.subarray(0, 6).toString('latin1') === 'GIF89a') {
    return 'GIF';
  }
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('latin1') === 'RIFF' && buffer.subarray(8, 12).toString('latin1') === 'WEBP') {
    return 'WebP';
  }
  if (buffer.length >= 2 && buffer[0] === 0x42 && buffer[1] === 0x4d) {
    return 'BMP';
  }
  return null;
}

function pngDimensions(buffer: Buffer): [number, number] {
  return [buffer.readUInt32BE(16), buffer.readUInt32BE(20)];
}

function jpegDimensions(buffer: Buffer): [number, number] | null {
  let i = 2;
  while (i + 9 < buffer.length) {
    if (buffer[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = buffer[i + 1];
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      i += 2;
      continue;
    }
    const length = buffer.readUInt16BE(i + 2);
    if (length < 2) return null;
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      return [buffer.readUInt16BE(i + 7), buffer.readUInt16BE(i + 5)];
    }
    i += 2 + length;
  }
  return null;
}

function webpDimensions(buffer: Buffer): [number, number] | null {
  const chunk = buffer.subarray(12, 16).toString('latin1');
  if (chunk === 'VP8X') {
    const w = (buffer[24] | (buffer[25] << 8) | (buffer[26] << 16)) + 1;
    const h = (buffer[27] | (buffer[28] << 8) | (buffer[29] << 16)) + 1;
    return [w, h];
  }
  if (chunk === 'VP8 ') {
    const bits = buffer.readUInt32LE(26);
    return [bits & 0x3fff, (bits >> 14) & 0x3fff];
  }
  if (chunk === 'VP8L') {
    const bits = buffer.readUInt32LE(21);
    return [(bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1];
  }
  return null;
}

export function extractImageMetadata(buffer: Buffer): ImageMetadata {
  const format = detectFormat(buffer);
  if (!format) {
    return { format: 'Unknown', width: null, height: null, byteSize: buffer.length };
  }
  let width: number | null = null;
  let height: number | null = null;
  if (format === 'PNG' && buffer.length >= 24) {
    [width, height] = pngDimensions(buffer);
  } else if (format === 'JPEG') {
    const dims = jpegDimensions(buffer);
    if (dims) [width, height] = dims;
  } else if (format === 'GIF' && buffer.length >= 10) {
    width = buffer.readUInt16LE(6);
    height = buffer.readUInt16LE(8);
  } else if (format === 'WebP') {
    const dims = webpDimensions(buffer);
    if (dims) [width, height] = dims;
  }
  return { format, width, height, byteSize: buffer.length };
}

/** Renders the metadata as the text block handed to the LLM. */
export function describeImageMetadata(meta: ImageMetadata): string {
  const sizeKb = (meta.byteSize / 1024).toFixed(meta.byteSize < 1024 ? 0 : 1);
  const dims =
    meta.width !== null && meta.height !== null ? `${meta.width} x ${meta.height}px` : 'dimensions unknown';
  return (
    `Image: ${meta.format}, ${dims}, ${sizeKb} KB.\n` +
    `Note: Kyclius can't read image pixels yet (no OCR/vision support), so the image's actual content is not included. ` +
    `If you need this image's contents described, convert it to text or reference a PDF/spreadsheet instead.`
  );
}