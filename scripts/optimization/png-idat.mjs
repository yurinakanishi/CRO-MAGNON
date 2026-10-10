// Lossless PNG transport: the same PNG with a smaller zlib stream. Promoted from the executed
// lossless-png-safe-r21 proof (output/optimization-audit-20261009/lossless-png-safe-r21.md),
// which passed Pillow and native Chrome/WebKit ImageLoader, ImageBitmap and GPU equality.
//
// A PNG is accepted only after strict validation:
//   - CRC, chunk order and multiplicity;
//   - contiguous IDATs;
//   - one zlib stream inflating to exactly the size IHDR implies, with nothing after it;
//   - valid filter bytes.
// The filtered scanline stream is deflated again (level 9, a bounded set of strategies), each
// attempt twice: identical bytes and an exact inflate back are required. The rebuilt PNG keeps
// every non-IDAT chunk byte for byte (length, type, data, CRC) in its original order, with one IDAT
// in place of the IDAT run. IHDR, filters, samples, palette, transparency, colour chunks, eXIf,
// oFFs, pHYs and text never change. A candidate is offered only when strictly smaller. Pure: no IO.
import zlib from 'node:zlib';
import { jsonDifference, sha256 } from './glb.mjs';

export const PNG_SIGNATURE = Object.freeze([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
export const IDAT_SETTINGS = Object.freeze({
  level: 9,
  windowBits: 15,
  strategies: Object.freeze(['DEFAULT', 'FILTERED', 'RLE', 'FIXED']),
  memLevels: Object.freeze([9, 8]),
});
const SIGNATURE = Buffer.from(PNG_SIGNATURE);
const MAX_RAW_BYTES = 512 * 1024 * 1024;
const CHANNELS = Object.freeze({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 });
const DEPTHS = Object.freeze({
  0: [1, 2, 4, 8, 16],
  2: [8, 16],
  3: [1, 2, 4, 8],
  4: [8, 16],
  6: [8, 16],
});
const ADAM7 = Object.freeze([
  [0, 0, 8, 8],
  [4, 0, 8, 8],
  [0, 4, 4, 8],
  [2, 0, 4, 4],
  [0, 2, 2, 4],
  [1, 0, 2, 2],
  [0, 1, 1, 2],
]);
// Registered ancillary chunks: at most once unless `repeat`, where the PNG specification places
// them. Unknown ancillary chunks are kept only when safe to copy.
const ANCILLARY = Object.freeze({
  cHRM: { before: 'PLTE' },
  gAMA: { before: 'PLTE' },
  iCCP: { before: 'PLTE' },
  sBIT: { before: 'PLTE' },
  sRGB: { before: 'PLTE' },
  cICP: { before: 'PLTE' },
  mDCV: { before: 'PLTE' },
  cLLI: { before: 'PLTE' },
  bKGD: { after: 'PLTE', before: 'IDAT' },
  hIST: { after: 'PLTE', before: 'IDAT' },
  tRNS: { after: 'PLTE', before: 'IDAT' },
  pHYs: { before: 'IDAT' },
  sPLT: { before: 'IDAT', repeat: true },
  eXIf: { before: 'IDAT' },
  oFFs: { before: 'IDAT' },
  pCAL: { before: 'IDAT' },
  sCAL: { before: 'IDAT' },
  sTER: { before: 'IDAT' },
  tIME: {},
  tEXt: { repeat: true },
  zTXt: { repeat: true },
  iTXt: { repeat: true },
});

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(...parts) {
  let c = 0xffffffff;
  for (const part of parts) for (const byte of part) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** One PNG chunk: length, type, data and CRC. */
export function pngChunk(type, data) {
  const head = Buffer.alloc(8),
    tail = Buffer.alloc(4),
    kind = Buffer.from(type, 'latin1');
  head.writeUInt32BE(data.length, 0);
  kind.copy(head, 4);
  tail.writeUInt32BE(crc32(kind, data), 0);
  return Buffer.concat([head, data, tail]);
}

/** Scanline layout of the filtered stream: one entry per (sub)image. */
function scanlines(ihdr) {
  const bits = CHANNELS[ihdr.colourType] * ihdr.bitDepth,
    rowBytes = (width) => 1 + Math.ceil((width * bits) / 8);
  if (!ihdr.interlace) return [{ pass: null, rows: ihdr.height, rowBytes: rowBytes(ihdr.width) }];
  return ADAM7.map(([x0, y0, dx, dy], pass) => {
    const width = ihdr.width > x0 ? Math.ceil((ihdr.width - x0) / dx) : 0,
      height = ihdr.height > y0 ? Math.ceil((ihdr.height - y0) / dy) : 0;
    return {
      pass,
      rows: width && height ? height : 0,
      rowBytes: width && height ? rowBytes(width) : 0,
    };
  });
}

/** Every chunk validated; the chunks with their raw byte ranges, and the IDAT payload. */
export function parsePng(bytes, label) {
  const problem = (message) => {
    throw new Error(`${label}: ${message}`);
  };
  if (bytes.length < 8 || !bytes.subarray(0, 8).equals(SIGNATURE)) problem('not a PNG signature');
  const chunks = [];
  let position = 8;
  for (;;) {
    if (position + 12 > bytes.length) problem(`truncated chunk at byte ${position} (no IEND)`);
    const length = bytes.readUInt32BE(position),
      type = bytes.toString('latin1', position + 4, position + 8);
    if (length > 0x7fffffff) problem(`chunk at byte ${position} declares ${length} bytes`);
    if (!/^[A-Za-z]{4}$/.test(type)) problem(`invalid chunk type at byte ${position}`);
    if (type[2] !== type[2].toUpperCase()) problem(`chunk ${type} has the reserved bit set`);
    const dataStart = position + 8,
      dataEnd = dataStart + length;
    if (dataEnd + 4 > bytes.length) problem(`chunk ${type} at byte ${position} exceeds the data`);
    const stored = bytes.readUInt32BE(dataEnd);
    if (crc32(bytes.subarray(position + 4, dataEnd)) !== stored)
      problem(`CRC mismatch in chunk ${type}`);
    chunks.push({ type, start: position, end: dataEnd + 4, dataStart, dataEnd, length });
    position = dataEnd + 4;
    if (type === 'IEND') break;
  }
  if (position !== bytes.length) problem(`${bytes.length - position} bytes after IEND`);
  const types = chunks.map((chunk) => chunk.type),
    count = (type) => types.filter((item) => item === type).length;
  if (types[0] !== 'IHDR' || chunks[0].length !== 13)
    problem('the first chunk is not a 13-byte IHDR');
  if (count('IHDR') !== 1 || count('IEND') !== 1 || chunks.at(-1).length !== 0)
    problem('IHDR/IEND multiplicity or IEND length is invalid');
  if (types.some((type) => ['acTL', 'fcTL', 'fdAT'].includes(type)))
    problem('animated PNG (APNG) is not supported');
  const critical = types.find(
    (type) => type[0] === type[0].toUpperCase() && !['IHDR', 'PLTE', 'IDAT', 'IEND'].includes(type),
  );
  if (critical) problem(`unknown critical chunk ${critical}`);
  // An unknown chunk that is not safe to copy may depend on the image data (e.g. a dSIG
  // signature): refused rather than carried or dropped.
  const unsafe = types.find(
    (type) =>
      type[0] !== type[0].toUpperCase() &&
      !Object.hasOwn(ANCILLARY, type) &&
      type[3] === type[3].toUpperCase(),
  );
  if (unsafe) problem(`unknown unsafe-to-copy chunk ${unsafe}`);
  const idatAt = types.flatMap((type, index) => (type === 'IDAT' ? [index] : []));
  if (!idatAt.length) problem('no IDAT');
  if (idatAt.at(-1) - idatAt[0] + 1 !== idatAt.length) problem('IDAT chunks are not contiguous');
  const header = bytes.subarray(chunks[0].dataStart, chunks[0].dataEnd),
    ihdr = {
      width: header.readUInt32BE(0),
      height: header.readUInt32BE(4),
      bitDepth: header[8],
      colourType: header[9],
      compression: header[10],
      filter: header[11],
      interlace: header[12],
    };
  if (!ihdr.width || !ihdr.height || ihdr.width > 0x7fffffff || ihdr.height > 0x7fffffff)
    problem('invalid size');
  if (!DEPTHS[ihdr.colourType]?.includes(ihdr.bitDepth))
    problem(`invalid bit depth ${ihdr.bitDepth} for colour type ${ihdr.colourType}`);
  if (ihdr.compression !== 0 || ihdr.filter !== 0 || ![0, 1].includes(ihdr.interlace))
    problem('unknown compression, filter or interlace method');
  const plte = types.indexOf('PLTE');
  if (count('PLTE') > 1) problem('more than one PLTE');
  if (plte !== -1) {
    if (plte > idatAt[0]) problem('PLTE after IDAT');
    if ([0, 4].includes(ihdr.colourType)) problem(`PLTE in colour type ${ihdr.colourType}`);
    const entries = chunks[plte].length / 3;
    if (!Number.isInteger(entries) || entries < 1 || entries > 256) problem('invalid PLTE length');
    if (ihdr.colourType === 3 && entries > 2 ** ihdr.bitDepth)
      problem('PLTE has more entries than the bit depth allows');
  } else if (ihdr.colourType === 3) problem('colour type 3 without PLTE');
  for (const [index, type] of types.entries()) {
    const rule = ANCILLARY[type];
    if (!rule) continue;
    if (!rule.repeat && count(type) > 1) problem(`more than one ${type}`);
    if (rule.before === 'PLTE' && ((plte !== -1 && index > plte) || index > idatAt[0]))
      problem(`${type} after PLTE or IDAT`);
    if (rule.before === 'IDAT' && index > idatAt[0]) problem(`${type} after IDAT`);
    if (rule.after === 'PLTE' && plte !== -1 && index < plte) problem(`${type} before PLTE`);
  }
  const idat = Buffer.concat(
    idatAt.map((index) => bytes.subarray(chunks[index].dataStart, chunks[index].dataEnd)),
  );
  return { ihdr, chunks, types, idatAt, idat };
}

/** The filtered scanline stream: exactly `expected` bytes, nothing after the zlib stream. */
function inflateExact(data, expected, label) {
  const problem = (message) => {
    throw new Error(`${label}: ${message}`);
  };
  if (data.length < 6) problem('the zlib stream is shorter than its header and checksum');
  const cmf = data[0],
    flg = data[1];
  if ((cmf & 0x0f) !== 8 || cmf >> 4 > 7 || (cmf * 256 + flg) % 31)
    problem('not a deflate zlib header');
  if (flg & 0x20) problem('the zlib stream needs a preset dictionary');
  let result;
  try {
    result = zlib.inflateSync(data, { info: true, maxOutputLength: expected });
  } catch (error) {
    problem(`the zlib stream does not inflate within ${expected} bytes (${error.message})`);
  }
  const { buffer, engine } = result;
  if (buffer.length !== expected)
    problem(`the stream inflates to ${buffer.length} bytes, not ${expected}`);
  if (!Number.isSafeInteger(engine?.bytesWritten))
    problem('the consumed input length cannot be established');
  if (engine.bytesWritten !== data.length)
    problem(`${data.length - engine.bytesWritten} bytes follow the zlib stream`);
  return buffer;
}

/** Strict structure plus the exact stream and its filter counts. */
export function pngStream(bytes, label) {
  const parsed = parsePng(bytes, label),
    layout = scanlines(parsed.ihdr),
    expected = layout.reduce((sum, pass) => sum + pass.rows * pass.rowBytes, 0);
  if (expected > MAX_RAW_BYTES)
    throw new Error(`${label}: ${expected} raw bytes exceed the ${MAX_RAW_BYTES}-byte bound`);
  const raw = inflateExact(parsed.idat, expected, label),
    counts = [0, 0, 0, 0, 0];
  let offset = 0;
  for (const pass of layout)
    for (let row = 0; row < pass.rows; row++) {
      if (raw[offset] > 4)
        throw new Error(`${label}: scanline ${row} has filter type ${raw[offset]}`);
      counts[raw[offset]]++;
      offset += pass.rowBytes;
    }
  return {
    parsed,
    raw,
    filters: {
      none: counts[0],
      sub: counts[1],
      up: counts[2],
      average: counts[3],
      paeth: counts[4],
    },
  };
}

/**
 * What decoding depends on: IHDR, every non-IDAT chunk before and after the IDAT run (raw bytes,
 * in order) and the filtered scanline stream. Two PNGs with equal identities decode identically;
 * one is a lossless IDAT rewrite of the other.
 */
export function pngIdentity(bytes, label) {
  const { parsed, raw } = pngStream(bytes, label),
    chunkHash = (chunk) => ({
      type: chunk.type,
      sha256: sha256(bytes.subarray(chunk.start, chunk.end)),
    });
  return {
    kind: 'png',
    ihdr: parsed.ihdr,
    before: parsed.chunks.slice(0, parsed.idatAt[0]).map(chunkHash),
    after: parsed.chunks.slice(parsed.idatAt.at(-1) + 1).map(chunkHash),
    rawBytes: raw.length,
    rawSha256: sha256(raw),
  };
}

/** Throws unless `candidate` is a lossless IDAT rewrite of `original` (same identity). */
export function checkLosslessRewrite(original, candidate, label) {
  const difference = jsonDifference(
    pngIdentity(original, `${label} original`),
    pngIdentity(candidate, `${label} candidate`),
  );
  if (difference) throw new Error(`${label}: not a lossless IDAT rewrite (${difference})`);
}

/** The PNG with its IDAT run replaced by one IDAT of `stream`; every other chunk byte for byte. */
function rebuild(bytes, parsed, stream) {
  const parts = [SIGNATURE];
  for (const [index, chunk] of parsed.chunks.entries()) {
    if (chunk.type !== 'IDAT') parts.push(bytes.subarray(chunk.start, chunk.end));
    else if (index === parsed.idatAt[0]) parts.push(pngChunk('IDAT', stream));
  }
  return Buffer.concat(parts);
}

const strategyOf = (name) => zlib.constants[`Z_${name}${name === 'DEFAULT' ? '_STRATEGY' : ''}`];

/**
 * Recompress one PNG. Returns { record, candidate, status, reason }. `candidate` is the rebuilt PNG
 * only when it is strictly smaller and every check passed. `status` is 'candidate',
 * 'original-retained' (not smaller) or 'rejected-original-retained' (unsupported or not exact).
 * `settings` defaults to IDAT_SETTINGS. Timings are recorded but never decide anything.
 */
export function recompressPng(bytes, label, settings = IDAT_SETTINGS) {
  let stream;
  try {
    stream = pngStream(bytes, label);
  } catch (error) {
    return {
      record: null,
      candidate: null,
      status: 'rejected-original-retained',
      reason: error.message,
    };
  }
  const { parsed, raw, filters } = stream,
    attempts = [];
  for (const strategy of settings.strategies)
    for (const memLevel of settings.memLevels) {
      const options = {
        level: settings.level,
        strategy: strategyOf(strategy),
        memLevel,
        windowBits: settings.windowBits,
      };
      if (!Number.isInteger(options.strategy)) throw new Error(`zlib has no strategy ${strategy}`);
      const outputs = [],
        runs = [];
      for (let run = 0; run < 2; run++) {
        const start = process.hrtime.bigint(),
          output = zlib.deflateSync(raw, options);
        runs.push({
          ms: Number((Number(process.hrtime.bigint() - start) / 1e6).toFixed(3)),
          bytes: output.length,
          sha256: sha256(output),
        });
        outputs.push(output);
      }
      let exact = false;
      try {
        exact = inflateExact(outputs[0], raw.length, `${label} ${strategy}/${memLevel}`).equals(
          raw,
        );
      } catch {
        exact = false;
      }
      attempts.push({
        strategy,
        memLevel,
        bytes: outputs[0].length,
        runs,
        identical: outputs[0].equals(outputs[1]),
        exact,
        data: outputs[0],
      });
    }
  const usable = attempts.filter((item) => item.identical && item.exact),
    best = usable.reduce(
      (smallest, item) => (!smallest || item.bytes < smallest.bytes ? item : smallest),
      null,
    ),
    record = {
      sha256: sha256(bytes),
      bytes: bytes.length,
      ihdr: parsed.ihdr,
      idat: {
        chunks: parsed.idatAt.length,
        compressedBytes: parsed.idat.length,
        rawBytes: raw.length,
        rawSha256: sha256(raw),
        filters,
      },
      settings: {
        level: settings.level,
        windowBits: settings.windowBits,
        zlib: process.versions.zlib,
      },
      attempts: attempts.map(({ data, ...item }) => item),
    };
  if (!best)
    return {
      record,
      candidate: null,
      status: 'rejected-original-retained',
      reason: 'no attempt was deterministic and exact',
    };
  const candidate = rebuild(bytes, parsed, best.data);
  record.selected = {
    strategy: best.strategy,
    memLevel: best.memLevel,
    streamBytes: best.bytes,
    streamSha256: sha256(best.data),
  };
  try {
    if (!candidate.equals(rebuild(bytes, parsed, best.data)))
      throw new Error('the rebuild is not deterministic');
    checkLosslessRewrite(bytes, candidate, label);
  } catch (error) {
    return { record, candidate: null, status: 'rejected-original-retained', reason: error.message };
  }
  record.rebuilt = { sha256: sha256(candidate), bytes: candidate.length };
  if (candidate.length >= bytes.length)
    return {
      record,
      candidate: null,
      status: 'original-retained',
      reason: `the rebuilt PNG (${candidate.length} B) is not smaller`,
    };
  return { record, candidate, status: 'candidate', reason: null };
}
