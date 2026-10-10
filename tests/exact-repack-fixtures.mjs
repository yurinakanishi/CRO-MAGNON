// Tiny synthetic fixtures for the exact-repack tests: real PNGs and real static GLBs, made here.
// None of them is, or becomes, a game asset.
import zlib from 'node:zlib';
import { packGlb, padding4, parseGlb } from '../scripts/optimization/glb.mjs';
import { compressViews } from '../scripts/optimization/meshopt-pack.mjs';
import { pngChunk } from '../scripts/optimization/png-idat.mjs';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// Ancillary chunks as [type, data]: colour, EXIF, offset, density and text.
export const CHUNKS = Object.freeze({
  sRGB: ['sRGB', [0]],
  gAMA: ['gAMA', [0x00, 0x00, 0xb1, 0x8f]],
  cHRM: [
    'cHRM',
    [
      0, 0, 0x7a, 0x26, 0, 0, 0x80, 0x84, 0, 0, 0xfa, 0, 0, 0, 0x80, 0xe8, 0, 0, 0x75, 0x30, 0, 0,
      0xea, 0x60, 0, 0, 0x3a, 0x98, 0, 0, 0x17, 0x70,
    ],
  ],
  eXIf: ['eXIf', [0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 8, 0, 0, 0, 0, 0, 0]],
  oFFs: ['oFFs', [0, 0, 0, 3, 0, 0, 0, 5, 0]],
  pHYs: ['pHYs', [0, 0, 0x0b, 0x13, 0, 0, 0x0b, 0x13, 1]],
  tEXt: ['tEXt', [...Buffer.from('Comment\0exact repack fixture', 'latin1')]],
});

const pattern = (seed) => (x, y) => [
  (x * 13 + seed) & 255,
  (y * 7 + seed) & 255,
  (x ^ y) & 255,
  255,
];

/**
 * A real 8-bit PNG. Scanlines use filter 0 (None) or 1 (Sub); the stream is deflated at `level`
 * (0 = stored, so a level-9 rewrite is smaller) and split into `idatChunks` IDATs. `before`
 * chunks come between IHDR and the IDATs, `after` chunks between the IDATs and IEND.
 */
export function pngFile({
  width = 16,
  height = 16,
  alpha = true,
  pixel = pattern(0),
  filter = 0,
  level = 0,
  idatChunks = 2,
  before = [],
  after = [],
} = {}) {
  const channels = alpha ? 4 : 3,
    stride = 1 + width * channels,
    raw = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = filter;
    const row = Buffer.alloc(width * channels);
    for (let x = 0; x < width; x++) {
      const value = pixel(x, y);
      for (let c = 0; c < channels; c++) row[x * channels + c] = value[c];
    }
    for (let i = 0; i < row.length; i++)
      raw[y * stride + 1 + i] =
        filter === 1 ? (row[i] - (i >= channels ? row[i - channels] : 0)) & 255 : row[i];
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = alpha ? 6 : 2;
  const stream = zlib.deflateSync(raw, { level }),
    size = Math.ceil(stream.length / idatChunks),
    idats = Array.from({ length: idatChunks }, (_, i) =>
      pngChunk('IDAT', stream.subarray(i * size, (i + 1) * size)),
    ),
    chunk = ([type, data]) => pngChunk(type, Buffer.from(data));
  return Buffer.concat([
    SIGNATURE,
    pngChunk('IHDR', header),
    ...before.map(chunk),
    ...idats,
    ...after.map(chunk),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

export const patternPng = (seed, options = {}) => pngFile({ pixel: pattern(seed), ...options });

/**
 * A real static GLB: one indexed triangle mesh (`triangles` triangles on a grid, shifted by
 * `offset`), a base-colour texture with a sampler and the embedded PNG `image`.
 */
export function sceneGlb({ name, triangles = 256, image, offset = 0, translation }) {
  const positions = new Float32Array(triangles * 9),
    indices = new Uint16Array(triangles * 3);
  for (let t = 0; t < triangles; t++) {
    const x = t % 16,
      z = Math.floor(t / 16);
    positions.set([x + offset, 0, z, x + 1 + offset, 0, z, x + offset, 0, z + 1], t * 9);
    indices.set([3 * t, 3 * t + 1, 3 * t + 2], t * 3);
  }
  const min = [0, 1, 2].map((c) => Math.min(...positions.filter((_, i) => i % 3 === c))),
    max = [0, 1, 2].map((c) => Math.max(...positions.filter((_, i) => i % 3 === c))),
    views = [
      { bytes: Buffer.from(positions.buffer), target: 34962 },
      { bytes: Buffer.from(indices.buffer), target: 34963 },
      { bytes: image },
    ],
    parts = [];
  let length = 0;
  const bufferViews = views.map((view) => {
    const pad = padding4(length);
    if (pad) {
      parts.push(Buffer.alloc(pad));
      length += pad;
    }
    const entry = {
      buffer: 0,
      byteOffset: length,
      byteLength: view.bytes.length,
      ...(view.target ? { target: view.target } : {}),
    };
    parts.push(view.bytes);
    length += view.bytes.length;
    return entry;
  });
  const json = {
    asset: { version: '2.0', generator: 'exact-repack fixture' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name, mesh: 0, ...(translation ? { translation } : {}) }],
    meshes: [{ name, primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: triangles * 3, type: 'VEC3', min, max },
      { bufferView: 1, componentType: 5123, count: triangles * 3, type: 'SCALAR' },
    ],
    bufferViews,
    buffers: [{ byteLength: length }],
    materials: [
      {
        name: `${name} surface`,
        pbrMetallicRoughness: {
          baseColorTexture: { index: 0 },
          metallicFactor: 0,
          roughnessFactor: 1,
        },
      },
    ],
    textures: [{ sampler: 0, source: 0 }],
    samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }],
    images: [{ bufferView: 2, mimeType: 'image/png', name: `${name} image` }],
  };
  return packGlb(json, Buffer.concat(parts, length));
}

/** The production lossless meshopt candidate of `bytes`, as the r04 generator made them. */
export async function compressedGlb(bytes, label) {
  const doc = parseGlb(bytes, label),
    packed = await compressViews(doc.json, doc.bin, label);
  return packGlb(packed.json, packed.bin);
}
