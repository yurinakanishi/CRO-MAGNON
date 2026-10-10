// Header-only PNG, JPEG and WebP inspection. Nothing is decoded here; the format,
// dimensions, alpha presence and colour metadata are read with bounds checks.
import { asBuffer } from './glb.mjs';

export const MIME_BY_FORMAT = Object.freeze({ png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' });
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
// Chunks that change how decoders map stored values to colours; they must survive resizing.
export const PNG_COLOR_CHUNKS = Object.freeze(['iCCP', 'sRGB', 'gAMA', 'cHRM']);
const JPEG_FRAMES = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
const JPEG_PROGRESSIVE = new Set([0xc2, 0xc6, 0xca, 0xce]);

export function sniffImage(input) {
  const bytes = asBuffer(input);
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return sniffPng(bytes);
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return sniffJpeg(bytes);
  if (bytes.length >= 12 && bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP')
    return sniffWebp(bytes);
  throw new Error('unrecognised image data (expected PNG, JPEG or WebP)');
}

function sniffPng(b) {
  if (b.length < 33 || b.readUInt32BE(8) !== 13 || b.toString('latin1', 12, 16) !== 'IHDR')
    throw new Error('PNG does not start with an IHDR chunk');
  const width = b.readUInt32BE(16),
    height = b.readUInt32BE(20),
    bitDepth = b[24],
    colorType = b[25],
    interlace = b[28],
    chunks = new Set();
  let position = 8,
    ended = false;
  while (position + 12 <= b.length) {
    const length = b.readUInt32BE(position),
      type = b.toString('latin1', position + 4, position + 8);
    if (position + 12 + length > b.length) throw new Error(`PNG chunk ${type} exceeds the image data`);
    chunks.add(type);
    position += 12 + length;
    if (type === 'IEND') {
      ended = true;
      break;
    }
  }
  if (!ended) throw new Error('PNG has no IEND chunk');
  if (chunks.has('acTL')) throw new Error('animated PNG is not supported');
  if (!width || !height) throw new Error('PNG has zero dimensions');
  return {
    format: 'png',
    width,
    height,
    alpha: colorType === 4 || colorType === 6 || chunks.has('tRNS'),
    png: { bitDepth, colorType, interlace, colorChunks: PNG_COLOR_CHUNKS.filter((chunk) => chunks.has(chunk)) },
  };
}

function sniffJpeg(b) {
  let position = 2;
  while (position + 4 <= b.length) {
    if (b[position] !== 0xff) throw new Error(`JPEG marker expected at byte ${position}`);
    while (position < b.length && b[position] === 0xff) position++;
    if (position >= b.length) break;
    const marker = b[position++];
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    if (marker === 0xd9 || marker === 0xda) break;
    if (position + 2 > b.length) break;
    const length = b.readUInt16BE(position);
    if (length < 2 || position + length > b.length) throw new Error('JPEG segment exceeds the image data');
    if (JPEG_FRAMES.has(marker)) {
      if (length < 8) throw new Error('JPEG frame header is truncated');
      const height = b.readUInt16BE(position + 3),
        width = b.readUInt16BE(position + 5),
        components = b[position + 7];
      if (!width || !height) throw new Error('JPEG has zero or deferred dimensions');
      return { format: 'jpeg', width, height, alpha: false, jpeg: { components, progressive: JPEG_PROGRESSIVE.has(marker) } };
    }
    position += length;
  }
  throw new Error('JPEG has no frame header');
}

function sniffWebp(b) {
  const end = Math.min(b.length, 8 + b.readUInt32LE(4));
  let position = 12,
    size = null,
    alpha = false,
    animated = false,
    extended = false,
    lossless = null;
  while (position + 8 <= end) {
    const tag = b.toString('latin1', position, position + 4),
      length = b.readUInt32LE(position + 4),
      data = position + 8;
    if (data + length > b.length) throw new Error(`WebP chunk ${tag} exceeds the image data`);
    if (tag === 'VP8X') {
      if (length < 10) throw new Error('WebP VP8X chunk is truncated');
      extended = true;
      alpha = !!(b[data] & 0x10);
      animated ||= !!(b[data] & 0x02);
      size = { width: 1 + b.readUIntLE(data + 4, 3), height: 1 + b.readUIntLE(data + 7, 3) };
    } else if (tag === 'ANIM' || tag === 'ANMF') animated = true;
    else if (tag === 'VP8L') {
      if (length < 5 || b[data] !== 0x2f) throw new Error('WebP VP8L header is invalid');
      const bits = b.readUInt32LE(data + 1);
      lossless = true;
      if (!extended) {
        size = { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
        alpha = !!((bits >>> 28) & 1);
      }
    } else if (tag === 'VP8 ') {
      if (length < 10 || b[data + 3] !== 0x9d || b[data + 4] !== 0x01 || b[data + 5] !== 0x2a)
        throw new Error('WebP VP8 frame header is invalid');
      lossless = false;
      if (!extended) size = { width: b.readUInt16LE(data + 6) & 0x3fff, height: b.readUInt16LE(data + 8) & 0x3fff };
    }
    position = data + length + (length % 2);
  }
  if (animated) throw new Error('animated WebP is not supported');
  if (!size || lossless === null) throw new Error('WebP has no image bitstream');
  if (!size.width || !size.height) throw new Error('WebP has zero dimensions');
  return { format: 'webp', width: size.width, height: size.height, alpha, webp: { lossless, extended } };
}

/** Largest edge capped at `edge`, aspect preserved, never upscaled. */
export function targetDimensions(width, height, edge) {
  const longest = Math.max(width, height);
  if (longest <= edge) return { width, height, resized: false };
  const scale = edge / longest;
  return {
    width: Math.max(1, Math.min(edge, Math.round(width * scale))),
    height: Math.max(1, Math.min(edge, Math.round(height * scale))),
    resized: true,
  };
}
