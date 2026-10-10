// Offline runtime-optimization tooling. Every fixture here is tiny synthetic test data
// generated in this file; none of it is, or becomes, a visible game asset.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import zlib from 'node:zlib';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { runtimeIndexOf } from '../scripts/optimization/contract.mjs';
import { assertGuardedHistoryStep } from './fixtures/guarded/lineage.mjs';
import {
  MESHOPT,
  accessorElements,
  jsonDifference,
  packGlb,
  parseGlb,
  sha256,
  storedViewBytes,
  triangleCount,
  validateDocument,
} from '../scripts/optimization/glb.mjs';
import { checkExtensions } from '../scripts/optimization/gltf-usage.mjs';
import { sniffImage, targetDimensions } from '../scripts/optimization/images.mjs';
import {
  buildInventory,
  classifyModel,
  loadEligibilityRules,
  readVerifiedSource,
} from '../scripts/optimization/inventory.mjs';
import { MESHOPT_HEADER, compressViews } from '../scripts/optimization/meshopt-pack.mjs';
import {
  REPO_ROOT,
  imageCandidateLocation,
  resolveRevisionDirectory,
  resolveSourceFile,
} from '../scripts/optimization/paths.mjs';
import {
  SOURCE_SIMPLIFY,
  prepareSourceSimplifier,
  simplifySourcePrimitive,
} from '../scripts/optimization/source-simplify.mjs';
import { planStandaloneImages } from '../scripts/optimization/standalone-images.mjs';
import { STARTUP_TOLERANCE, buildStartupActor } from '../scripts/optimization/startup-actor.mjs';
import {
  applyTextures,
  planTextures,
  resizeJob,
  runTextureJobs,
  sourceSummary,
  stageTextureInput,
  textureEdges,
} from '../scripts/optimization/textures.mjs';
import {
  decodeViews,
  verifyDerived,
  verifyStandaloneImage,
  verifyStartup,
} from '../scripts/optimization/verify.mjs';

await prepareSourceSimplifier();

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes) {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const head = Buffer.alloc(8),
    crc = Buffer.alloc(4);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}
function encodePng(width, height, channels, pixel) {
  const header = Buffer.alloc(13),
    stride = 1 + width * channels,
    rows = Buffer.alloc(height * stride);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = channels === 4 ? 6 : 2;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const value = pixel(x, y);
      for (let c = 0; c < channels; c++) rows[y * stride + 1 + x * channels + c] = value[c];
    }
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', header),
    pngChunk('IDAT', zlib.deflateSync(rows)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}
// Header-only PNG: enough for planning, never decoded.
function pngHeader(width, height, colorType = 2) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = colorType;
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', header),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}
const paeth = (a, b, c) => {
  const p = a + b - c,
    pa = Math.abs(p - a),
    pb = Math.abs(p - b),
    pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};
function decodePng(bytes) {
  let position = 8,
    width,
    height,
    colorType;
  const idat = [];
  while (position < bytes.length) {
    const length = bytes.readUInt32BE(position),
      type = bytes.toString('latin1', position + 4, position + 8),
      data = bytes.subarray(position + 8, position + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      colorType = data[9];
      assert.equal(data[8], 8);
      assert.equal(data[12], 0, 'non-interlaced');
    }
    if (type === 'IDAT') idat.push(data);
    position += 12 + length;
    if (type === 'IEND') break;
  }
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType],
    stride = width * channels,
    raw = zlib.inflateSync(Buffer.concat(idat)),
    pixels = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)],
      row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? pixels[y * stride + x - channels] : 0,
        b = y ? pixels[(y - 1) * stride + x] : 0,
        c = x >= channels && y ? pixels[(y - 1) * stride + x - channels] : 0,
        predictor = [0, a, b, (a + b) >> 1, paeth(a, b, c)][filter];
      pixels[y * stride + x] = (row[x] + predictor) & 0xff;
    }
  }
  return { width, height, channels, pixels };
}
function riff(chunks) {
  const body = Buffer.concat(
      chunks.map(([tag, data]) => {
        const head = Buffer.alloc(8);
        head.write(tag, 0, 'latin1');
        head.writeUInt32LE(data.length, 4);
        return Buffer.concat([head, data, Buffer.alloc(data.length % 2)]);
      }),
    ),
    head = Buffer.alloc(12);
  head.write('RIFF', 0, 'latin1');
  head.writeUInt32LE(4 + body.length, 4);
  head.write('WEBP', 8, 'latin1');
  return Buffer.concat([head, body]);
}

/** Pack views into a fresh single-buffer GLB document. */
function documentFrom(json, views) {
  const parts = [];
  let length = 0;
  json.bufferViews = views.map((view) => {
    const bytes = Buffer.from(view.bytes.buffer, view.bytes.byteOffset, view.bytes.byteLength),
      pad = (4 - (length % 4)) % 4;
    if (pad) {
      parts.push(Buffer.alloc(pad));
      length += pad;
    }
    const entry = { buffer: 0, byteOffset: length, byteLength: bytes.length };
    if (view.byteStride) entry.byteStride = view.byteStride;
    if (view.target) entry.target = view.target;
    parts.push(bytes);
    length += bytes.length;
    return entry;
  });
  json.buffers = [{ byteLength: length }];
  const bin = Buffer.concat(parts, length);
  return { json, bin, glb: packGlb(json, bin) };
}
function minMax(values, width) {
  const min = new Array(width).fill(Infinity),
    max = new Array(width).fill(-Infinity);
  values.forEach((value, i) => {
    min[i % width] = Math.min(min[i % width], value);
    max[i % width] = Math.max(max[i % width], value);
  });
  return { min, max };
}
const bytesOf = (array) => Buffer.from(array.buffer, array.byteOffset, array.byteLength);
const arrayBufferOf = (bytes) =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

function grid(columns, rows) {
  const count = columns * rows,
    g = {
      count,
      position: new Float32Array(count * 3),
      normal: new Float32Array(count * 3),
      uv: new Float32Array(count * 2),
      tangent: new Float32Array(count * 4),
      color: new Uint8Array(count * 4),
      uv1: new Uint16Array(count * 2),
      joints8: new Uint8Array(count * 4),
      joints16: new Uint16Array(count * 4),
      weights: new Float32Array(count * 4),
      weights8: new Uint8Array(count * 4),
    },
    triangles = [];
  for (let i = 0; i < count; i++) {
    const x = i % columns,
      y = Math.floor(i / columns),
      w = y / (rows - 1);
    g.position.set([x * 0.1, y * 0.1, 0], i * 3);
    g.normal.set([0, 0, 1], i * 3);
    g.uv.set([x / (columns - 1), y / (rows - 1)], i * 2);
    g.tangent.set([1, 0, 0, 1], i * 4);
    g.color.set([x * 8, y * 8, 128, 255], i * 4);
    g.uv1.set([x * 256, y * 256], i * 2);
    g.joints8.set([0, 1, 2, 0], i * 4);
    g.joints16.set([0, 1, 2, 0], i * 4);
    g.weights.set([1 - w, w, 0, 0], i * 4);
    g.weights8.set([255 - Math.round(w * 255), Math.round(w * 255), 0, 0], i * 4);
  }
  for (let y = 0; y + 1 < rows; y++)
    for (let x = 0; x + 1 < columns; x++) {
      const a = y * columns + x;
      triangles.push(a, a + 1, a + columns, a + 1, a + columns + 1, a + columns);
    }
  g.indices = Uint32Array.from(triangles);
  return g;
}

/** Index order the triangle codec reproduces exactly (one encode/decode round trip). */
async function canonicalTriangles(indices) {
  await MeshoptEncoder.ready;
  await MeshoptDecoder.ready;
  const source = new Uint8Array(Uint32Array.from(indices).buffer),
    encoded = MeshoptEncoder.encodeGltfBuffer(source, indices.length, 4, 'TRIANGLES'),
    decoded = new Uint8Array(indices.length * 4);
  MeshoptDecoder.decodeGltfBuffer(decoded, indices.length, 4, encoded, 'TRIANGLES');
  return new Uint32Array(decoded.buffer);
}

async function staticFixture() {
  const g = grid(16, 16),
    canonical = await canonicalTriangles(g.indices),
    rotated = Uint32Array.from(canonical),
    interleaved = new Float32Array(g.count * 6),
    odd = Uint16Array.of(0, 1, 16, 1, 17, 16, 2, 3, 18);
  // Same triangle, different first vertex: TRIANGLES would decode it rotated.
  [rotated[0], rotated[1], rotated[2]] = [canonical[1], canonical[2], canonical[0]];
  for (let i = 0; i < g.count; i++) {
    interleaved.set(g.position.subarray(3 * i, 3 * i + 3), 6 * i);
    interleaved.set(g.normal.subarray(3 * i, 3 * i + 3), 6 * i + 3);
  }
  const views = [
      { bytes: g.position, target: 34962 }, // 0
      { bytes: g.normal, target: 34962 }, // 1
      { bytes: g.uv, target: 34962 }, // 2
      { bytes: g.tangent, target: 34962 }, // 3
      { bytes: g.color, target: 34962 }, // 4
      { bytes: g.uv1, target: 34962 }, // 5
      { bytes: g.joints8, target: 34962 }, // 6
      { bytes: g.weights, target: 34962 }, // 7
      { bytes: g.joints16, target: 34962 }, // 8
      { bytes: g.weights8, target: 34962 }, // 9
      { bytes: Uint16Array.from(canonical), target: 34963 }, // 10
      { bytes: rotated, target: 34963 }, // 11
      { bytes: interleaved, byteStride: 24, target: 34962 }, // 12
      { bytes: odd, target: 34963 }, // 13: 18 bytes, not a multiple of 4
      { bytes: Uint32Array.from(canonical), target: 34963 }, // 14
    ],
    accessor = (bufferView, componentType, count, type, extra = {}) => ({
      bufferView,
      componentType,
      count,
      type,
      ...extra,
    }),
    json = {
      asset: { version: '2.0', generator: 'synthetic optimization test data' },
      scene: 0,
      scenes: [{ nodes: [0, 1, 2] }],
      nodes: [
        { name: 'Canonical', mesh: 0 },
        { name: 'Rotated', mesh: 1 },
        { name: 'Interleaved', mesh: 2 },
      ],
      meshes: [
        {
          name: 'canonical',
          primitives: [
            {
              attributes: {
                POSITION: 0,
                NORMAL: 1,
                TEXCOORD_0: 2,
                TANGENT: 3,
                COLOR_0: 4,
                TEXCOORD_1: 5,
                JOINTS_0: 6,
                WEIGHTS_0: 7,
                JOINTS_1: 8,
                WEIGHTS_1: 9,
              },
              indices: 10,
            },
            { attributes: { POSITION: 0 }, indices: 15 },
          ],
        },
        {
          name: 'rotated',
          primitives: [
            { attributes: { POSITION: 0, NORMAL: 1 }, indices: 11 },
            { attributes: { POSITION: 0 }, indices: 14 },
          ],
        },
        {
          name: 'interleaved',
          primitives: [{ attributes: { POSITION: 12, NORMAL: 13 }, indices: 10 }],
        },
      ],
      accessors: [
        accessor(0, 5126, g.count, 'VEC3', minMax(g.position, 3)),
        accessor(1, 5126, g.count, 'VEC3'),
        accessor(2, 5126, g.count, 'VEC2'),
        accessor(3, 5126, g.count, 'VEC4'),
        accessor(4, 5121, g.count, 'VEC4', { normalized: true }),
        accessor(5, 5123, g.count, 'VEC2', { normalized: true }),
        accessor(6, 5121, g.count, 'VEC4'),
        accessor(7, 5126, g.count, 'VEC4'),
        accessor(8, 5123, g.count, 'VEC4'),
        accessor(9, 5121, g.count, 'VEC4', { normalized: true }),
        accessor(10, 5123, canonical.length, 'SCALAR'),
        accessor(11, 5125, rotated.length, 'SCALAR'),
        accessor(12, 5126, g.count, 'VEC3', minMax(g.position, 3)),
        accessor(12, 5126, g.count, 'VEC3', { byteOffset: 12 }),
        accessor(13, 5123, odd.length, 'SCALAR'),
        accessor(14, 5125, canonical.length, 'SCALAR'),
      ],
    };
  return { ...documentFrom(json, views), g, canonical, rotated, interleaved, odd };
}

function sheet(columns, rows, [x0, x1], [y0, y1], z, joint) {
  const count = columns * rows,
    part = {
      count,
      position: new Float32Array(count * 3),
      normal: new Float32Array(count * 3),
      uv: new Float32Array(count * 2),
      joints: new Uint8Array(count * 4),
      weights: new Float32Array(count * 4),
    },
    indices = [];
  for (let i = 0; i < count; i++) {
    const c = i % columns,
      r = Math.floor(i / columns);
    part.position.set(
      [x0 + ((x1 - x0) * c) / (columns - 1), y0 + ((y1 - y0) * r) / (rows - 1), z],
      i * 3,
    );
    part.normal.set([0, 0, 1], i * 3);
    part.uv.set([c / (columns - 1), r / (rows - 1)], i * 2);
    part.joints.set([joint, 0, 0, 0], i * 4);
    part.weights.set([1, 0, 0, 0], i * 4);
  }
  for (let r = 0; r + 1 < rows; r++)
    for (let c = 0; c + 1 < columns; c++) {
      const a = r * columns + c;
      indices.push(a, a + 1, a + columns, a + 1, a + columns + 1, a + columns);
    }
  part.indices = Uint16Array.from(indices);
  return part;
}

// Unit quaternions up to float32 rounding, as exported rigs use.
const TURN = [0, 0, 0, 1, 0, 0.6, 0, 0.8, 0, 0, 0, 1],
  SWAY = [0, 0, 0, 1, 0, 0.28, 0, 0.96, 0, 0, 0, 1, 0, -0.28, 0, 0.96];

/** Root > Hips > Head skeleton with a body and a head primitive; the full model has two clips.
 * LOD sheets are exact vertex subsets of the full sheets, like the adopted sloppy LODs. */
function actorFixture({
  lod = false,
  jointOrder = [0, 1, 2],
  rename = null,
  inverseBindOffset = 0,
  inverseBindNoise = [],
  meshOffset = 0,
  hipsRest = 1,
  rigShift = 0,
  reparent = false,
  swap = false,
  slotNames = true,
  dropNormal = false,
  dropUv = false,
  tangent = false,
  tuck = 0,
  headShift = 0,
  raise = 0,
  image = false,
  normalMap = false,
  rootMatrix = null,
  scaleTrack = null,
  secondJointSet = false,
  morph = false,
  restScales = {},
  headUvScale = 1,
  lodUvScramble = false,
  seam = false,
  bodyOnly = false,
} = {}) {
  const nodes = [
      {
        name: 'Root',
        children: reparent ? [1, 2] : [1],
        ...(rootMatrix ? { matrix: rootMatrix } : {}),
      },
      { name: 'Hips', translation: [0, hipsRest, 0], ...(reparent ? {} : { children: [2] }) },
      { name: rename ?? 'Head', translation: [0, 0.5 + rigShift, 0] },
      {
        name: 'Actor',
        mesh: 0,
        skin: 0,
        ...(meshOffset ? { translation: [0, meshOffset, 0] } : {}),
      },
      { name: 'Armature', children: [3, 0] },
    ],
    slot = (node) => jointOrder.indexOf(node),
    body = {
      label: 'Body',
      ...(lod
        ? sheet(4, 8, [-0.3, 0.3], [0, 1.4], 0.05, slot(1))
        : sheet(7, 15, [-0.3, 0.3], [0, 1.4], 0.05, slot(1))),
    },
    // `seam`: the head's bottom row coincides with the body's top row, like a grafted neck.
    head = {
      label: 'Head',
      ...(seam
        ? lod
          ? sheet(4, 5, [-0.3, 0.3], [1.4, 1.8], 0.05, slot(2))
          : sheet(7, 9, [-0.3, 0.3], [1.4, 1.8], 0.05, slot(2))
        : lod
          ? sheet(3, 5, [-0.1, 0.1], [1.4, 1.8], 0.06, slot(2))
          : sheet(5, 9, [-0.1, 0.1], [1.4, 1.8], 0.06, slot(2))),
    },
    // `bodyOnly`: a single-primitive actor, like the fennec and the ape.
    parts = bodyOnly ? [body] : swap ? [head, body] : [body, head],
    views = [],
    accessors = [];
  for (const [node, scale] of Object.entries(restScales)) nodes[node].scale = scale;
  // A small head UV chart; a scrambled LOD head joins vertices across the atlas like simplifySloppy.
  for (let i = 0; i < head.count; i++) {
    head.uv[2 * i] = lod && lodUvScramble ? (i * 0.37) % 1 : head.uv[2 * i] * headUvScale;
    head.uv[2 * i + 1] = lod && lodUvScramble ? (i * 0.61) % 1 : head.uv[2 * i + 1] * headUvScale;
  }
  // Like the adopted remade heads: the LOD neck seam row is pushed down into the body.
  for (let i = 0; i < 3; i++) head.position[3 * i + 1] -= tuck;
  for (let i = 0; i < head.count; i++) head.position[3 * i + 1] -= headShift;
  // Geometry posed away from its (unchanged, now stale) binds: the body's top row lifted.
  for (let i = body.count - 4; i < body.count; i++) body.position[3 * i + 1] += raise;
  const add = (bytes, componentType, count, type, target, extra = {}) => {
    views.push({ bytes, target });
    accessors.push({ bufferView: views.length - 1, componentType, count, type, ...extra });
    return accessors.length - 1;
  };
  const primitives = parts.map((part, index) => {
    const attributes = {
      POSITION: add(part.position, 5126, part.count, 'VEC3', 34962, minMax(part.position, 3)),
    };
    if (!dropNormal) attributes.NORMAL = add(part.normal, 5126, part.count, 'VEC3', 34962);
    if (tangent && part.label === 'Body')
      attributes.TANGENT = add(
        new Float32Array(part.count * 4).map((_, i) => (i % 4 === 0 || i % 4 === 3 ? 1 : 0)),
        5126,
        part.count,
        'VEC4',
        34962,
      );
    if (!dropUv) attributes.TEXCOORD_0 = add(part.uv, 5126, part.count, 'VEC2', 34962);
    attributes.JOINTS_0 = add(part.joints, 5121, part.count, 'VEC4', 34962);
    attributes.WEIGHTS_0 = add(part.weights, 5126, part.count, 'VEC4', 34962);
    if (secondJointSet) {
      attributes.JOINTS_1 = add(new Uint8Array(part.count * 4), 5121, part.count, 'VEC4', 34962);
      attributes.WEIGHTS_1 = add(new Float32Array(part.count * 4), 5126, part.count, 'VEC4', 34962);
    }
    const targets = morph
      ? [
          {
            POSITION: add(new Float32Array(part.count * 3), 5126, part.count, 'VEC3', 34962, {
              min: [0, 0, 0],
              max: [0, 0, 0],
            }),
          },
        ]
      : undefined;
    return {
      attributes,
      indices: add(part.indices, 5123, part.indices.length, 'SCALAR', 34963),
      material: index,
      ...(targets ? { targets } : {}),
    };
  });
  const materials = parts.map((part, index) => ({
      name: lod ? (slotNames ? `LODGeometrySlot_${part.label}` : `Slot ${index}`) : part.label,
      pbrMetallicRoughness: {
        baseColorFactor: part.label === 'Body' ? [0.75, 0.5, 0.25, 1] : [1, 0.75, 0.5, 1],
        metallicFactor: 0,
      },
      doubleSided: true,
    })),
    // Bind pose: independent of the rest pose unless the rig itself moves (rigShift).
    worldY = [0, 1, 1.5 + rigShift],
    inverseBinds = new Float32Array(16 * jointOrder.length);
  jointOrder.forEach((node, i) =>
    inverseBinds.set(
      [
        1,
        0,
        0,
        0,
        0,
        1,
        0,
        0,
        0,
        0,
        1,
        0,
        0,
        -worldY[node] - (node === 2 ? inverseBindOffset : 0),
        0,
        1,
      ],
      16 * i,
    ),
  );
  for (const { joint, element, delta } of inverseBindNoise)
    inverseBinds[16 * jointOrder.indexOf(joint) + element] += delta;
  const skins = [
      {
        joints: jointOrder,
        inverseBindMatrices: add(inverseBinds, 5126, jointOrder.length, 'MAT4'),
        name: 'Armature',
      },
    ],
    json = {
      asset: { version: '2.0', generator: 'synthetic actor test data' },
      scene: 0,
      scenes: [{ nodes: [4] }],
      nodes,
      meshes: [{ name: 'ActorMesh', primitives }],
      materials,
      skins,
      accessors,
    };
  if (!lod) {
    const idle = add(Float32Array.of(0, 0.5, 1), 5126, 3, 'SCALAR', undefined, {
        min: [0],
        max: [1],
      }),
      turn = add(Float32Array.from(TURN), 5126, 3, 'VEC4'),
      bob = add(Float32Array.of(0, 1, 0, 0, 1.25, 0, 0, 1, 0), 5126, 3, 'VEC3'),
      walk = add(Float32Array.of(0, 0.25, 0.5, 0.75), 5126, 4, 'SCALAR', undefined, {
        min: [0],
        max: [0.75],
      }),
      sway = add(Float32Array.from(SWAY), 5126, 4, 'VEC4');
    json.animations = [
      {
        name: 'Idle_Loop',
        channels: [
          { sampler: 0, target: { node: 2, path: 'rotation' } },
          { sampler: 1, target: { node: 1, path: 'translation' } },
        ],
        samplers: [
          { input: idle, output: turn, interpolation: 'LINEAR' },
          { input: idle, output: bob, interpolation: 'LINEAR' },
        ],
      },
      {
        name: 'Walk_Loop',
        channels: [{ sampler: 0, target: { node: 1, path: 'rotation' } }],
        samplers: [{ input: walk, output: sway, interpolation: 'LINEAR' }],
      },
    ];
    if (scaleTrack) {
      const times = add(Float32Array.of(0, 1), 5126, 2, 'SCALAR', undefined, {
          min: [0],
          max: [1],
        }),
        values = add(
          Float32Array.from(scaleTrack.values),
          5126,
          scaleTrack.values.length / 3,
          'VEC3',
        );
      json.animations.push({
        name: 'Breathe_Loop',
        channels: [{ sampler: 0, target: { node: scaleTrack.node, path: 'scale' } }],
        samplers: [{ input: times, output: values, interpolation: scaleTrack.interpolation }],
      });
    }
  }
  const texture = (bytes, name) => {
    views.push({ bytes });
    json.images = [
      ...(json.images ?? []),
      { bufferView: views.length - 1, mimeType: 'image/png', name },
    ];
    json.textures = [...(json.textures ?? []), { source: json.images.length - 1 }];
    return json.textures.length - 1;
  };
  if (image)
    json.materials[0].pbrMetallicRoughness.baseColorTexture = {
      index: texture(
        encodePng(4, 4, 3, () => [200, 120, 80]),
        'BodyAlbedo',
      ),
    };
  if (normalMap)
    json.materials[0].normalTexture = {
      index: texture(
        encodePng(4, 4, 3, () => [128, 128, 255]),
        'BodyNormal',
      ),
      scale: 0.8,
    };
  return documentFrom(json, views);
}

// Node cannot decode images, so GLTFLoader gets an empty texture for each one; materials,
// normalScale and the derivative-tangent clone are still GLTFLoader's own.
const textureStub = () => ({
  name: 'TEST_texture_stub',
  loadTexture: () => Promise.resolve(new THREE.Texture()),
});
const loader = () => new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).register(textureStub);

/** The same GLB with texture extensions removed, so the stub supplies every texture. */
function loadableGlb(doc) {
  const json = structuredClone(doc.json);
  for (const texture of json.textures ?? []) delete texture.extensions;
  for (const key of ['extensionsUsed', 'extensionsRequired']) {
    if (!json[key]) continue;
    json[key] = json[key].filter(
      (name) => !name.startsWith('EXT_texture_') && name !== 'KHR_texture_basisu',
    );
    if (!json[key].length) delete json[key];
  }
  return packGlb(json, doc.bin);
}

function skinnedMeshes(gltf) {
  const meshes = [];
  gltf.scene.traverse((object) => {
    if (object.isSkinnedMesh) meshes.push(object);
  });
  return meshes;
}

/** The binding the game renders today, built by performance-lod.ts itself (from dist/): the full
 * model's scene, skeleton and material instances with the LOD file's geometry swapped in. */
async function existingLodBinding(fullGlb, lodGlb, modelKey) {
  const runtime = await import(
      pathToFileURL(path.join(REPO_ROOT, 'dist/src/performance-lod.js')).href
    ),
    full = await loader().parseAsync(arrayBufferOf(fullGlb), ''),
    lod = await loader().parseAsync(arrayBufferOf(lodGlb), '');
  runtime.configureActorPerformance(full.scene, lod.scene, { modelKey });
  assert.equal(
    runtime.updateActorPerformance(full.scene, 1e6),
    1,
    `${modelKey}: distance LOD active`,
  );
  return full;
}

/** What three.js will shade with: the tangent frame and the material's normalScale. */
const observedFrame = (mesh) => ({
  tangents: mesh.geometry.attributes.tangent ? 'vertex' : 'derivative',
  normalScale: mesh.material.normalScale.toArray(),
});
const recordedFrame = ({ tangents, normalScale }) => ({ tangents, normalScale });
const sameFrame = (a, b) => JSON.stringify(recordedFrame(a)) === JSON.stringify(recordedFrame(b));
/** The frame GLTFLoader gives a geometry under its own material: derivative tangents negate
 * normalScale.y. Today's performance-lod.ts gives the shown LOD geometry the same. */
const loaderFrame = (mesh, scale) => ({
  tangents: mesh.geometry.attributes.tangent ? 'vertex' : 'derivative',
  normalScale: [scale, mesh.geometry.attributes.tangent ? scale : -scale],
});

const sameArray = (a, b) =>
  a.constructor === b.constructor &&
  Buffer.from(a.buffer, a.byteOffset, a.byteLength).equals(
    Buffer.from(b.buffer, b.byteOffset, b.byteLength),
  );

async function derive(doc, label) {
  const plan = planTextures(doc.json, doc.bin, { label, edge: 1024 }),
    textured = applyTextures(doc.json, doc.bin, plan.images, new Map(), label),
    packed = await compressViews(textured.json, textured.bin, label);
  return { glb: packGlb(packed.json, packed.bin), textures: textured.images, packed };
}

function textureDocument(images, textures, materials) {
  const positions = Float32Array.of(0, 0, 0, 1, 0, 0, 0, 1, 0);
  return documentFrom(
    {
      asset: { version: '2.0' },
      meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }],
      accessors: [
        {
          bufferView: 0,
          componentType: 5126,
          count: 3,
          type: 'VEC3',
          min: [0, 0, 0],
          max: [1, 1, 0],
        },
      ],
      images: images.map((image, index) => ({ bufferView: index + 1, mimeType: image.mimeType })),
      textures,
      materials,
    },
    [{ bytes: positions, target: 34962 }, ...images.map((image) => ({ bytes: image.bytes }))],
  );
}

test('meshopt compression is lossless for every attribute layout and preserves index order', async () => {
  const fixture = await staticFixture(),
    { json, bin } = fixture,
    binHash = sha256(bin),
    jsonCopy = structuredClone(json),
    result = await compressViews(json, bin, 'static');
  assert.equal(sha256(bin), binHash, 'source bytes untouched');
  assert.deepEqual(json, jsonCopy, 'source JSON untouched');
  const output = parseGlb(packGlb(result.json, result.bin), 'static output');
  validateDocument(output.json, output.bin, 'static output', { allowMeshopt: true });
  const { views } = await decodeViews(output, 'static output');
  json.bufferViews.forEach((_, index) =>
    assert.ok(
      views[index].equals(storedViewBytes(json, bin, index)),
      `view ${index} decodes to its exact bytes`,
    ),
  );
  const ext = (index) => output.json.bufferViews[index].extensions?.[MESHOPT],
    // float VEC3/VEC3/VEC2/VEC4, u8n VEC4, u16n VEC2, u8 VEC4, float VEC4, u16 VEC4, u8n VEC4
    elementBytes = [12, 12, 8, 16, 4, 4, 4, 16, 8, 4];
  elementBytes.forEach((stride, index) => {
    assert.equal(ext(index)?.mode, 'ATTRIBUTES', `attribute view ${index}`);
    assert.equal(ext(index).byteStride, stride, `attribute view ${index} element size`);
    assert.equal(ext(index).count, fixture.g.count);
  });
  assert.equal(ext(10)?.mode, 'TRIANGLES', 'codec-stable u16 triangles use the triangle codec');
  assert.equal(ext(14)?.mode, 'TRIANGLES', 'codec-stable u32 triangles use the triangle codec');
  assert.equal(
    ext(11)?.mode,
    'INDICES',
    'a rotation-sensitive triangle order falls back to the sequence codec',
  );
  assert.equal(ext(12), undefined, 'interleaved views stay stored');
  assert.equal(result.report.keptViews['interleaved-or-strided'], 1);
  assert.ok(result.report.triangleRotationFallbacks >= 1);
  for (const view of output.json.bufferViews) {
    const compressed = view.extensions?.[MESHOPT];
    if (!compressed) continue;
    assert.equal(view.buffer, 1, 'logical range lives in the fallback buffer');
    assert.equal(output.bin[compressed.byteOffset], MESHOPT_HEADER[compressed.mode]);
    assert.equal(compressed.filter, undefined, 'no lossy filter');
  }
  assert.deepEqual(output.json.extensionsUsed, [MESHOPT]);
  assert.deepEqual(output.json.extensionsRequired, [MESHOPT]);
  assert.equal(output.json.buffers.length, 2);
  assert.deepEqual(output.json.buffers[1], {
    byteLength: output.json.buffers[1].byteLength,
    extensions: { [MESHOPT]: { fallback: true } },
  });
  assert.ok(output.bin.length < bin.length, 'compressed GLB buffer is smaller');
  const again = await compressViews(json, bin, 'static');
  assert.ok(
    packGlb(again.json, again.bin).equals(packGlb(result.json, result.bin)),
    'deterministic output',
  );
  const verification = await verifyDerived({
    source: { json, bin },
    output,
    textures: [],
    edge: 1024,
    label: 'static',
  });
  assert.equal(verification.nonImageViewsByteIdentical, json.bufferViews.length);
  assert.equal(verification.compressedViews, result.report.compressedViews);
});

test('three.js GLTFLoader rejects the candidate without a decoder and reads exact values with one', async () => {
  const fixture = await staticFixture(),
    result = await compressViews(fixture.json, fixture.bin, 'loader'),
    glb = packGlb(result.json, result.bin);
  await assert.rejects(new GLTFLoader().parseAsync(arrayBufferOf(glb), ''), /setMeshoptDecoder/);
  const gltf = await new GLTFLoader()
      .setMeshoptDecoder(MeshoptDecoder)
      .parseAsync(arrayBufferOf(glb), ''),
    meshes = [];
  gltf.scene.traverse((object) => {
    if (object.isMesh) meshes.push(object);
  });
  assert.equal(meshes.length, 5);
  assert.ok(
    bytesOf(meshes[0].geometry.attributes.position.array).equals(bytesOf(fixture.g.position)),
  );
  assert.ok(bytesOf(meshes[0].geometry.attributes.color.array).equals(bytesOf(fixture.g.color)));
  assert.ok(
    bytesOf(meshes[0].geometry.attributes.skinIndex.array).equals(bytesOf(fixture.g.joints8)),
  );
  assert.deepEqual(Array.from(meshes[0].geometry.index.array), Array.from(fixture.canonical));
  assert.deepEqual(
    Array.from(meshes[2].geometry.index.array),
    Array.from(fixture.rotated),
    'triangle order survives',
  );
  assert.deepEqual(Array.from(meshes[3].geometry.index.array), Array.from(fixture.odd));
  assert.ok(
    bytesOf(meshes[4].geometry.attributes.position.data.array).equals(bytesOf(fixture.interleaved)),
  );
});

test('malformed containers, ranges, resources and padding are rejected precisely', async () => {
  const { json, bin, glb } = await staticFixture(),
    lengthMismatch = Buffer.from(glb),
    longChunk = Buffer.from(glb),
    mutate = (change) => {
      const copy = structuredClone(json);
      change(copy);
      return copy;
    };
  lengthMismatch.writeUInt32LE(glb.length + 4, 8);
  assert.throws(() => parseGlb(lengthMismatch, 'probe'), /header length/);
  longChunk.writeUInt32LE(glb.length, 12);
  assert.throws(() => parseGlb(longChunk, 'probe'), /exceeds the file/);
  assert.throws(
    () =>
      validateDocument(
        mutate((doc) => (doc.bufferViews[0].byteLength = bin.length + 4)),
        bin,
        'probe',
      ),
    /exceeds buffer 0/,
  );
  assert.throws(
    () =>
      validateDocument(
        mutate((doc) => (doc.accessors[0].count += 1)),
        bin,
        'probe',
      ),
    /exceeds buffer view 0/,
  );
  assert.throws(
    () =>
      validateDocument(
        mutate((doc) => (doc.buffers[0].uri = 'model.bin')),
        bin,
        'probe',
      ),
    /URI/,
  );
  assert.throws(
    () =>
      validateDocument(
        mutate((doc) => (doc.images = [{ uri: 'albedo.png' }])),
        bin,
        'probe',
      ),
    /URI/,
  );
  const packed = await compressViews(json, bin, 'probe'),
    source = { json, bin },
    tampered = { json: packed.json, bin: Buffer.from(packed.bin) },
    attribute = packed.json.bufferViews.find(
      (view) => view.extensions?.[MESHOPT]?.mode === 'ATTRIBUTES',
    );
  // 0xa1 decodes as meshopt v1 (KHR) but is not a valid EXT_meshopt_compression stream.
  tampered.bin[attribute.extensions[MESHOPT].byteOffset] = 0xa1;
  await assert.rejects(decodeViews(tampered, 'probe'), /header 0xa1/);
  const outside = structuredClone(packed.json);
  outside.bufferViews.find((view) => view.extensions?.[MESHOPT]).extensions[MESHOPT].byteLength =
    packed.bin.length + 8;
  assert.throws(
    () => validateDocument(outside, packed.bin, 'probe', { allowMeshopt: true }),
    /compressed range/,
  );
  const leaked = structuredClone(packed.json),
    stored = leaked.bufferViews.find((view) => !view.extensions);
  stored.buffer = 1;
  stored.byteOffset = 0;
  assert.throws(
    () => validateDocument(leaked, packed.bin, 'probe', { allowMeshopt: true }),
    /fallback buffer/,
  );
  const changed = structuredClone(packed.json);
  changed.accessors[1].normalized = true;
  await assert.rejects(
    verifyDerived({
      source,
      output: { json: changed, bin: packed.bin },
      textures: [],
      edge: 1024,
      label: 'probe',
    }),
    /accessors\[1\]\.normalized/,
  );
  const keptIndex = packed.json.bufferViews.findIndex((view) => !view.extensions),
    flipped = Buffer.from(packed.bin);
  flipped[packed.json.bufferViews[keptIndex].byteOffset] ^= 0xff;
  await assert.rejects(
    verifyDerived({
      source,
      output: { json: packed.json, bin: flipped },
      textures: [],
      edge: 1024,
      label: 'probe',
    }),
    new RegExp(`buffer view ${keptIndex} differs after decoding`),
  );
  const padded = {
    json: structuredClone(packed.json),
    bin: Buffer.concat([packed.bin, Buffer.alloc(64)]),
  };
  padded.json.buffers[0].byteLength += 64;
  await assert.rejects(
    verifyDerived({ source, output: padded, textures: [], edge: 1024, label: 'probe' }),
    /unreferenced trailing bytes/,
  );
});

test('startup actor: LOD body remapped by name, full-model head retained byte for byte, every clip unchanged', async () => {
  const highFixture = actorFixture({ image: true }),
    high = parseGlb(highFixture.glb, 'high'),
    lod = parseGlb(actorFixture({ lod: true, jointOrder: [2, 0, 1] }).glb, 'lod'),
    highHash = sha256(highFixture.glb),
    // The r03 hybrid, kept as a diagnostic policy: it still exercises the adopted-LOD binding.
    merged = buildStartupActor(high, lod, 'actor', { geometryPolicy: 'retain-face-primitives' }),
    { geometry } = merged.report;
  assert.equal(sha256(highFixture.glb), highHash);
  assert.equal(merged.report.skins[0].jointOrder, 'remapped-by-name');
  assert.deepEqual(merged.report.skins[0].remap, [2, 0, 1]);
  // The body (Hips-weighted) shows the LOD; the head (100% Head weight) keeps the full geometry.
  assert.equal(geometry.policy, 'retain-face-primitives');
  assert.deepEqual(
    geometry.primitives.map(({ source, retention, vertices, triangles, rawBytes }) => [
      source,
      retention,
      vertices,
      triangles,
      rawBytes,
    ]),
    [
      ['adopted-lod', null, 32, 42, 32 * 52 + 126 * 2],
      ['full-model', 'head-primitive', 45, 64, 45 * 52 + 192 * 2],
    ],
  );
  assert.deepEqual(
    merged.report.primitives.map(({ geometry: g }) => [g.headWeightShare, g.reason]),
    [
      [0, 'not a head primitive'],
      [1, 'head primitive: the full model keeps its own geometry, UVs and weights at startup'],
    ],
  );
  // Costs are explicit: 45 vertices x (12 + 12 + 8 + 4 + 16) bytes + 192 uint16 indices, against
  // the LOD head's 15 vertices + 48 indices.
  const headCost = {
      primitives: 1,
      vertices: 45,
      triangles: 64,
      rawBytes: 45 * 52 + 192 * 2,
      replacedLodVertices: 15,
      replacedLodTriangles: 16,
      replacedLodRawBytes: 15 * 52 + 48 * 2,
    },
    none = {
      primitives: 0,
      vertices: 0,
      triangles: 0,
      rawBytes: 0,
      replacedLodVertices: 0,
      replacedLodTriangles: 0,
      replacedLodRawBytes: 0,
    };
  assert.deepEqual(geometry.retained, {
    ...headCost,
    byRetention: {
      'head-primitive': headCost,
      'whole-single-primitive': none,
      'unreduced-whole-primitive': none,
      'unsupported-whole-primitive': none,
    },
  });
  assert.equal(geometry.simplified.primitives, 0, 'the diagnostic policy derives nothing');
  assert.deepEqual(geometry.startup, { vertices: 32 + 45, triangles: 42 + 64 });
  assert.deepEqual(geometry.lodOnly, { vertices: 32 + 15, triangles: 42 + 16 });
  assert.match(
    geometry.lowLevel,
    /must not use the adopted LOD file for any primitive.*may swap retained primitives back to the adopted LOD/,
  );
  assert.equal(
    merged.report.removedFullModelAccessors,
    6,
    'only the full body geometry is dropped',
  );
  assert.deepEqual(merged.report.triangles, { full: 168 + 64, lod: 42 + 16, startup: 42 + 64 });
  assert.equal(merged.report.primitives[0].materialSlot, 'name-matched');
  assert.equal(merged.report.skins[0].hierarchy, 'identical parent joints');
  assert.equal(
    merged.report.skins[0].skinnedDisplacementBoundMetres,
    0,
    'identical binds move nothing',
  );
  assert.equal(merged.report.primitives[0].exactVertexReuse, 1);
  assert.equal(
    merged.report.primitives[1].surfaceAgreement,
    1,
    'the LOD head is still checked: it proves the primitive order',
  );
  assert.equal(
    merged.report.primitives[1].skinnedDisplacementBoundMetres,
    null,
    'the retained head is the full model, not a binding',
  );
  const startup = await derive(merged, 'startup'),
    full = await derive(high, 'full'),
    output = parseGlb(startup.glb, 'startup'),
    highOutput = parseGlb(full.glb, 'full'),
    report = await verifyStartup({
      high,
      lod,
      output,
      highOutput,
      edge: 1024,
      label: 'actor',
      startup: merged.report,
    });
  assert.equal(report.status, 'passed');
  assert.deepEqual(
    [report.retainedFullPrimitives, report.lodPrimitives, report.triangles],
    [1, 1, 106],
  );
  // The stored (compressed) cost of each primitive, measured in the packed startup file.
  assert.deepEqual(
    report.storedGeometryBytes.primitives.map(({ source }) => source),
    ['adopted-lod', 'full-model'],
  );
  assert.ok(
    report.storedGeometryBytes.retainedFull > 0 && report.storedGeometryBytes.adoptedLod > 0,
  );
  assert.equal(
    report.storedGeometryBytes.retainedFull + report.storedGeometryBytes.adoptedLod,
    report.storedGeometryBytes.primitives.reduce((sum, item) => sum + item.storedBytes, 0),
  );
  assert.equal(report.clips, 2);
  assert.equal(report.keyframes, 3 + 3 + 4);
  assert.ok(report.remappedJointComponents > 0);
  const { views } = await decodeViews(output, 'startup'),
    highViews = (await decodeViews(high, 'high')).views,
    [body, head] = output.json.meshes[0].primitives,
    fullHead = high.json.meshes[0].primitives[1],
    joints = accessorElements(output.json, views, body.attributes.JOINTS_0);
  assert.deepEqual(
    [...joints.subarray(0, 4)],
    [1, 2, 2, 2],
    'Hips, then unused slots that named Head in the LOD',
  );
  assert.equal(output.json.accessors[body.attributes.POSITION].count, 32, 'LOD vertex count');
  for (const key of Object.keys(fullHead.attributes))
    assert.ok(
      accessorElements(output.json, views, head.attributes[key]).equals(
        accessorElements(high.json, highViews, fullHead.attributes[key]),
      ),
      `retained head ${key} equals the original full model's`,
    );
  assert.ok(
    accessorElements(output.json, views, head.indices).equals(
      accessorElements(high.json, highViews, fullHead.indices),
    ),
  );
  assert.deepEqual(output.json.skins[0].joints, [0, 1, 2], 'full-model joint order');
  assert.deepEqual(
    output.json.animations.map((clip) => clip.name),
    ['Idle_Loop', 'Walk_Loop'],
  );
  // The contract cannot be satisfied by LOD geometry where it records the full model.
  const lodOnly = buildStartupActor(high, lod, 'actor', { geometryPolicy: 'adopted-lod-only' }),
    lodOutput = parseGlb((await derive(lodOnly, 'lod-only')).glb, 'lod-only');
  assert.equal(lodOnly.report.geometry.retained.primitives, 0);
  await assert.rejects(
    verifyStartup({
      high,
      lod,
      output: lodOutput,
      highOutput,
      edge: 1024,
      label: 'actor',
      startup: merged.report,
    }),
    /mesh 0 primitive 1 .*full model/,
  );
  await assert.rejects(
    verifyStartup({ high, lod, output, highOutput, edge: 1024, label: 'actor' }),
    /no recorded geometry source/,
  );
  assert.throws(
    () => buildStartupActor(high, lod, 'actor', { geometryPolicy: 'whole-model' }),
    /unknown geometry policy/,
  );
});

test('startup actor loads in GLTFLoader with the full skeleton and exact clip samples', async () => {
  const high = parseGlb(actorFixture().glb, 'high'),
    lod = parseGlb(actorFixture({ lod: true, jointOrder: [2, 0, 1] }).glb, 'lod'),
    // The diagnostic r03 policy: the LOD body with joints remapped by name.
    startup = await derive(
      buildStartupActor(high, lod, 'actor', { geometryPolicy: 'retain-face-primitives' }),
      'startup',
    ),
    gltf = await new GLTFLoader()
      .setMeshoptDecoder(MeshoptDecoder)
      .parseAsync(arrayBufferOf(startup.glb), ''),
    skinned = [];
  gltf.scene.traverse((object) => {
    if (object.isSkinnedMesh) skinned.push(object);
  });
  assert.equal(skinned.length, 2);
  assert.deepEqual(
    skinned[0].skeleton.bones.map((bone) => bone.name),
    ['Root', 'Hips', 'Head'],
  );
  assert.deepEqual(
    Array.from(skinned[0].geometry.attributes.skinIndex.array.slice(0, 4)),
    [1, 2, 2, 2],
  );
  assert.equal(skinned[0].geometry.attributes.position.count, 32, 'LOD body');
  assert.equal(skinned[1].geometry.attributes.position.count, 45, 'retained full-model head');
  assert.deepEqual(
    skinned[1].skeleton.bones.map((bone) => bone.name),
    ['Root', 'Hips', 'Head'],
    'the retained head is bound to the same full skeleton',
  );
  assert.deepEqual(
    gltf.animations.map((clip) => clip.name),
    ['Idle_Loop', 'Walk_Loop'],
  );
  const turn = gltf.animations[0].tracks.find((track) => track.name === 'Head.quaternion'),
    sway = gltf.animations[1].tracks.find((track) => track.name === 'Hips.quaternion');
  assert.deepEqual(Array.from(turn.times), [0, 0.5, 1]);
  assert.deepEqual(Array.from(turn.values), Array.from(Float32Array.from(TURN)));
  assert.deepEqual(Array.from(sway.values), Array.from(Float32Array.from(SWAY)));
});

test('a LOD without the optional TANGENT keeps every required attribute and loads with derived tangents', async () => {
  const high = parseGlb(actorFixture({ tangent: true }).glb, 'high'),
    lod = parseGlb(actorFixture({ lod: true }).glb, 'lod'),
    // The LOD body is what lacks TANGENT, so this uses the diagnostic r03 policy.
    merged = buildStartupActor(high, lod, 'actor', { geometryPolicy: 'retain-face-primitives' }),
    body = merged.json.meshes[0].primitives[0];
  assert.deepEqual(merged.report.primitives[0].omittedAttributes, ['TANGENT']);
  assert.deepEqual(merged.report.primitives[1].omittedAttributes, []);
  assert.deepEqual(Object.keys(body.attributes), [
    'POSITION',
    'NORMAL',
    'TEXCOORD_0',
    'JOINTS_0',
    'WEIGHTS_0',
  ]);
  assert.equal(
    merged.report.removedFullModelAccessors,
    7,
    'the unused full-model body data, TANGENT included, is dropped',
  );
  const startup = await derive(merged, 'startup'),
    full = await derive(high, 'full'),
    report = await verifyStartup({
      high,
      lod,
      output: parseGlb(startup.glb, 'startup'),
      highOutput: parseGlb(full.glb, 'full'),
      edge: 1024,
      label: 'actor',
      startup: merged.report,
    });
  assert.equal(report.omittedOptionalAttributes, 1);
  const gltf = await new GLTFLoader()
      .setMeshoptDecoder(MeshoptDecoder)
      .parseAsync(arrayBufferOf(startup.glb), ''),
    skinned = [];
  gltf.scene.traverse((object) => {
    if (object.isSkinnedMesh) skinned.push(object);
  });
  assert.equal(
    skinned[0].geometry.attributes.tangent,
    undefined,
    'GLTFLoader takes its derivative-tangent path',
  );
  for (const name of ['position', 'normal', 'uv', 'skinIndex', 'skinWeight'])
    assert.ok(skinned[0].geometry.attributes[name], `${name} kept`);
  for (const [options, pattern] of [
    [{ dropUv: true }, /only TANGENT may be absent/],
    [{ dropNormal: true }, /only TANGENT may be absent/],
    [{ tangent: true }, /attributes differ/],
  ])
    assert.throws(
      () =>
        buildStartupActor(
          parseGlb(actorFixture().glb, 'high'),
          parseGlb(actorFixture({ lod: true, ...options }).glb, 'lod'),
          'actor',
        ),
      pattern,
      JSON.stringify(options),
    );
});

test('only the binding matters: the LOD rest pose is discarded, binds are bounded per vertex', async () => {
  // These cases bind LOD head geometry, so they use the LOD for every primitive.
  const high = parseGlb(actorFixture().glb, 'high'),
    lodOf = (options) => parseGlb(actorFixture({ lod: true, ...options }).glb, 'lod'),
    merge = (options) =>
      buildStartupActor(high, lodOf(options), 'actor', { geometryPolicy: 'adopted-lod-only' });
  // A different LOD rest pose with the same bind pose cannot change skinning: the full model's
  // nodes, inverse binds and clips are used, exactly as performance-lod.ts renders the LOD today.
  const rested = merge({ hipsRest: 1.1 });
  assert.ok(Math.abs(rested.report.skins[0].restPoseDifference - 0.1) < 1e-6);
  assert.equal(rested.report.skins[0].skinnedDisplacementBoundMetres, 0);
  assert.deepEqual(rested.json.nodes, high.json.nodes, 'full-model rest pose kept exactly');
  const output = parseGlb(packGlb(rested.json, rested.bin), 'rested'),
    views = (await decodeViews(output, 'rested')).views,
    sourceViews = (await decodeViews(high, 'high')).views;
  assert.ok(
    accessorElements(output.json, views, output.json.skins[0].inverseBindMatrices).equals(
      accessorElements(high.json, sourceViews, high.json.skins[0].inverseBindMatrices),
    ),
    'full-model inverse binds kept exactly',
  );
  // Export-noise-sized bind differences, like the measured 1.47e-5 and 1.65e-5, are accepted
  // with the displacement they cause recorded.
  const noisy = merge({ inverseBindNoise: [{ joint: 2, element: 13, delta: 1.6e-5 }] });
  assert.ok(noisy.report.skins[0].inverseBindDifference > 1.5e-5);
  assert.ok(Math.abs(noisy.report.skins[0].skinnedDisplacementBoundMetres - 1.6e-5) < 1e-6);
  // Dangerous mismatches stay errors.
  for (const [options, pattern] of [
    // Under the per-element cap, yet head vertices would move 0.27 mm.
    [
      {
        inverseBindNoise: [
          { joint: 2, element: 4, delta: 9.5e-5 },
          { joint: 2, element: 12, delta: 9.5e-5 },
        ],
      },
      /skinned displacement/,
    ],
    [{ rigShift: 0.05 }, /inverse bind matrices differ/],
    [{ reparent: true }, /joint hierarchy differs/],
    [
      { jointOrder: [0, 1, 2], rename: 'Neck' },
      /LOD joint "Neck" is not in the full-model skeleton/,
    ],
    // Same binds, but part of the LOD is posed 35 cm away from the bind-pose surface.
    [{ raise: 0.35 }, /bind pose: 4 LOD vertices/],
  ])
    assert.throws(() => merge(options), pattern, JSON.stringify(options));
  // With the default policy the head shows the full model's own geometry and skin, so LOD head
  // binds cannot move anything; the structural checks above still apply to every LOD primitive.
  const hybrid = buildStartupActor(
    high,
    lodOf({ inverseBindNoise: [{ joint: 2, element: 13, delta: 1.6e-5 }] }),
    'actor',
  );
  assert.equal(hybrid.report.skins[0].skinnedDisplacementBoundMetres, 0);
  assert.equal(hybrid.report.primitives[1].geometry.source, 'full-model');
  assert.throws(
    () => buildStartupActor(high, lodOf({ raise: 0.35 }), 'actor'),
    /bind pose: 4 LOD vertices/,
  );
  assert.throws(
    () => buildStartupActor(high, lodOf({ reparent: true }), 'actor'),
    /joint hierarchy differs/,
  );
});

test('the binding bound holds for every pose three.js blends from the clips and rejects what it cannot bound', async () => {
  // Hips scale up to 1.3 on x (LINEAR); Head binds differ by export-noise-sized amounts, including
  // the bottom row, whose effect grows with the joint's distance from the mesh origin.
  const highFixture = actorFixture({
      scaleTrack: { node: 1, interpolation: 'LINEAR', values: [1, 1, 1, 1.3, 1, 1] },
    }),
    high = parseGlb(highFixture.glb, 'high'),
    noise = [
      { joint: 2, element: 4, delta: 3e-5 },
      { joint: 2, element: 12, delta: 3e-5 },
      { joint: 2, element: 7, delta: 2e-5 },
    ],
    lod = parseGlb(actorFixture({ lod: true, inverseBindNoise: noise }).glb, 'lod'),
    // The LOD head is bound here (as on single-primitive actors), so every primitive uses the LOD.
    merged = buildStartupActor(high, lod, 'actor', { geometryPolicy: 'adopted-lod-only' }),
    skin = merged.report.skins[0],
    head = merged.report.primitives[1];
  assert.deepEqual(skin.poseBound.channels, { translation: 1, rotation: 2, scale: 1 });
  assert.deepEqual(skin.poseBound.interpolation, { LINEAR: 4, STEP: 0 });
  assert.ok(Math.abs(skin.poseBound.scaleRange[1] - 1.3) < 1e-6);
  assert.ok(Math.abs(skin.inverseBindBottomRowDifference - 2e-5) < 1e-7);
  // three.js's own poses (each clip, then half/half and three-way blends), skinned with its
  // shader's arithmetic and GLTFLoader's identity bind matrix: s.xyz + (1 − s.w)·t_mesh.
  const gltf = await new GLTFLoader().parseAsync(arrayBufferOf(highFixture.glb), ''),
    bones = ['Root', 'Hips', 'Head'].map((name) => gltf.scene.getObjectByName(name)),
    mesh = skinnedMeshes(gltf)[0],
    lodViews = (await decodeViews(lod, 'lod')).views,
    floatsOf = (doc, views, accessor) =>
      new Float32Array(arrayBufferOf(accessorElements(doc.json, views, accessor))),
    binds = [
      floatsOf(
        high,
        (await decodeViews(high, 'high')).views,
        high.json.skins[0].inverseBindMatrices,
      ),
      floatsOf(lod, lodViews, lod.json.skins[0].inverseBindMatrices),
    ].map((values) => bones.map((_, joint) => new THREE.Matrix4().fromArray(values, 16 * joint))),
    parts = lod.json.meshes[0].primitives.map((primitive) => ({
      position: floatsOf(lod, lodViews, primitive.attributes.POSITION),
      joints: accessorElements(lod.json, lodViews, primitive.attributes.JOINTS_0),
      weights: floatsOf(lod, lodViews, primitive.attributes.WEIGHTS_0),
    })),
    matrix = new THREE.Matrix4(),
    point = new THREE.Vector4(),
    origin = new THREE.Vector3();
  let worst = 0;
  const measure = () => {
    gltf.scene.updateMatrixWorld(true);
    origin.setFromMatrixPosition(mesh.matrixWorld);
    for (const { position, joints, weights } of parts)
      for (let v = 0; v < position.length / 3; v++) {
        let total = 0;
        for (let k = 0; k < 4; k++) total += weights[4 * v + k];
        const [full, reduced] = binds.map((inverses) => {
          const sum = new THREE.Vector4();
          for (let k = 0; k < 4; k++) {
            const joint = joints[4 * v + k],
              weight = weights[4 * v + k] / total;
            if (!weight) continue;
            matrix.multiplyMatrices(bones[joint].matrixWorld, inverses[joint]);
            sum.addScaledVector(
              point
                .set(position[3 * v], position[3 * v + 1], position[3 * v + 2], 1)
                .applyMatrix4(matrix),
              weight,
            );
          }
          return new THREE.Vector3(sum.x, sum.y, sum.z).addScaledVector(origin, 1 - sum.w);
        });
        worst = Math.max(worst, full.distanceTo(reduced));
      }
  };
  const mixer = new THREE.AnimationMixer(gltf.scene),
    actions = gltf.animations.map((clip) => mixer.clipAction(clip)),
    poseAt = (time) => {
      mixer.setTime(time);
      measure();
    };
  for (const action of actions) {
    action.play();
    for (let i = 0; i <= 40; i++) poseAt((action.getClip().duration * Math.min(i, 39.99)) / 40);
    action.stop();
  }
  for (const blend of [
    [0, 2],
    [1, 2],
    [0, 1, 2],
  ]) {
    for (const index of blend)
      actions[index]
        .reset()
        .setEffectiveWeight(1 / blend.length)
        .play();
    for (let i = 0; i < 40; i++) poseAt(i / 40);
    for (const index of blend) actions[index].stop();
  }
  assert.ok(
    worst > 1.2 * head.bindDistanceMetres,
    `scaled poses (${worst} m) exceed the rigid bind distance (${head.bindDistanceMetres} m)`,
  );
  assert.ok(
    worst <= skin.skinnedDisplacementBoundMetres,
    `three.js poses (${worst} m) stay within the bound (${skin.skinnedDisplacementBoundMetres} m)`,
  );
  assert.ok(skin.skinnedDisplacementBoundMetres <= STARTUP_TOLERANCE.skinnedDisplacement);
  // Cubic tangents overshoot their keys: both keys are 1, yet three.js scales the Head by 1.5.
  const cubic = actorFixture({
      scaleTrack: {
        node: 2,
        interpolation: 'CUBICSPLINE',
        values: [0, 0, 0, 1, 1, 1, 2, 2, 2, -2, -2, -2, 1, 1, 1, 0, 0, 0],
      },
    }),
    cubicGltf = await new GLTFLoader().parseAsync(arrayBufferOf(cubic.glb), ''),
    cubicMixer = new THREE.AnimationMixer(cubicGltf.scene);
  cubicMixer.clipAction(cubicGltf.animations.find((clip) => clip.name === 'Breathe_Loop')).play();
  cubicMixer.setTime(0.5);
  assert.ok(Math.abs(cubicGltf.scene.getObjectByName('Head').scale.x - 1.5) < 1e-6);
  assert.throws(
    () =>
      buildStartupActor(
        parseGlb(cubic.glb, 'high'),
        parseGlb(actorFixture({ lod: true }).glb, 'lod'),
        'actor',
      ),
    /clip "Breathe_Loop" animates node 2 "Head" scale with CUBICSPLINE; the binding bound covers LINEAR and STEP keys only/,
  );
  // A node matrix may shear: this one stretches (0.6, 0.8, 0) to 1.28 although its longest
  // column is 1.12, so column norms do not bound it (and three.js's TRS decomposition drops it).
  const SHEAR = [1, 0, 0, 0, 0.5, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    column = (c) => Math.hypot(SHEAR[4 * c], SHEAR[4 * c + 1], SHEAR[4 * c + 2]);
  assert.ok(Math.hypot(0.6 + 0.5 * 0.8, 0.8) > Math.max(column(0), column(1), column(2)) + 0.15);
  // These bind LOD geometry, so they use the LOD for every primitive.
  for (const [options, pattern] of [
    [{ rootMatrix: SHEAR }, /node 0 "Root" on a joint or mesh chain uses a matrix/],
    [{ morph: true }, /is skinned and has morph targets/],
    [{ secondJointSet: true }, /three\.js skins with JOINTS_0\/WEIGHTS_0 only/],
  ])
    assert.throws(
      () =>
        buildStartupActor(
          parseGlb(actorFixture(options).glb, 'high'),
          parseGlb(actorFixture({ lod: true, ...options }).glb, 'lod'),
          'actor',
          {
            geometryPolicy: 'adopted-lod-only',
          },
        ),
      pattern,
      JSON.stringify(options),
    );
  // The default shows no LOD geometry: such bodies are not simplified but kept whole, as recorded.
  const kept = (options) =>
    buildStartupActor(
      parseGlb(actorFixture(options).glb, 'high'),
      parseGlb(actorFixture({ lod: true, ...options }).glb, 'lod'),
      'actor',
    ).report.primitives[0].geometry;
  assert.deepEqual(
    [kept({ morph: true }), kept({ secondJointSet: true })].map(({ source, retention, reason }) => [
      source,
      retention,
      reason,
    ]),
    [
      [
        'full-model',
        'unsupported-whole-primitive',
        'not simplified (has morph targets); the whole original primitive is kept, which is not a geometry optimization',
      ],
      [
        'full-model',
        'unsupported-whole-primitive',
        'not simplified (attribute JOINTS_1); the whole original primitive is kept, which is not a geometry optimization',
      ],
    ],
  );
});

test('finite but extreme transforms that overflow the proof are rejected, never turned into a zero bound', () => {
  const huge = [1e308, 1e308, 1e308];
  for (const [options, pattern] of [
    // Codex's probe shape: the scene root and its children scaled to 1e308. The rest-pose world
    // matrices overflow, which used to leave NaN differences that passed every limit.
    [{ restScales: { 4: huge, 0: huge, 3: huge } }, /world transform is not finite/],
    // Finite rest pose (Root at 1e300), but a clip scale key of 3e38 on Hips overflows the pose
    // factor; with identical binds the old bound became Infinity · 0 = NaN and was reported as 0.
    [
      {
        restScales: { 0: [1e300, 1e300, 1e300] },
        scaleTrack: { node: 1, interpolation: 'LINEAR', values: [1, 1, 1, 3e38, 3e38, 3e38] },
      },
      /node 1 "Hips" pose bound factor is not finite/,
    ],
    // A keyframe that is already infinite in float32.
    [
      { scaleTrack: { node: 1, interpolation: 'LINEAR', values: [1, 1, 1, Infinity, 1, 1] } },
      /keyframe is not finite/,
    ],
  ])
    assert.throws(
      () =>
        buildStartupActor(
          parseGlb(actorFixture(options).glb, 'high'),
          parseGlb(actorFixture({ lod: true, restScales: options.restScales }).glb, 'lod'),
          'actor',
        ),
      pattern,
      JSON.stringify(options),
    );
});

test('startup shading is recorded against the existing performance-lod binding, not inferred from the pose', async () => {
  const highFixture = actorFixture({ tangent: true, normalMap: true }),
    lodFixture = actorFixture({ lod: true }),
    high = parseGlb(highFixture.glb, 'high'),
    // Shading of tangent-less LOD geometry, so the diagnostic r03 policy.
    merged = buildStartupActor(high, parseGlb(lodFixture.glb, 'lod'), 'actor', {
      geometryPolicy: 'retain-face-primitives',
    }),
    [body, head] = merged.report.primitives;
  assert.deepEqual(body.shading, {
    normalMap: true,
    normalScale: 0.8,
    upgrade: { tangents: 'vertex', normalScale: [0.8, 0.8], loaderConvention: true },
    startup: { tangents: 'derivative', normalScale: [0.8, -0.8], loaderConvention: true },
    existingLod: { tangents: 'derivative', normalScale: [0.8, 0.8], loaderConvention: false },
    sameAsExistingLod: false,
  });
  assert.deepEqual(head.shading, { normalMap: false, sameAsExistingLod: true });
  assert.deepEqual(merged.report.shading.differsFromExistingLod, [
    { mesh: 0, primitive: 0, material: 'Body' },
  ]);
  // What three.js builds for each binding: the startup file alone, the upgrade alone, and the
  // game's current distance LOD (performance-lod.ts swapping the LOD geometry in).
  const startup = await derive(merged, 'startup'),
    [standalone, upgrade] = await Promise.all(
      [startup.glb, highFixture.glb].map((glb) => loader().parseAsync(arrayBufferOf(glb), '')),
    ),
    existing = await existingLodBinding(highFixture.glb, lodFixture.glb, 'actor');
  assert.deepEqual(
    observedFrame(skinnedMeshes(standalone)[0]),
    recordedFrame(body.shading.startup),
  );
  assert.deepEqual(observedFrame(skinnedMeshes(upgrade)[0]), recordedFrame(body.shading.upgrade));
  // `existingLod` and `sameAsExistingLod` are historical. They record the binding
  // performance-lod.ts had when r04 was generated: LOD geometry under the full mesh's authored
  // material, normalScale.y not negated. verify-candidates re-derives exactly this record from
  // the sources, so it stays as recorded.
  assert.deepEqual(recordedFrame(body.shading.existingLod), {
    tangents: 'derivative',
    normalScale: body.shading.upgrade.normalScale,
  });
  assert.equal(
    body.shading.sameAsExistingLod,
    sameFrame(body.shading.startup, body.shading.existingLod),
  );
  // Today performance-lod.ts finalises the material for the geometry it shows, as GLTFLoader
  // does. Tangent-less LOD geometry now gets the loader's derivative-tangent convention: the
  // frame of the standalone startup file.
  assert.deepEqual(observedFrame(skinnedMeshes(existing)[0]), {
    tangents: 'derivative',
    normalScale: [0.8, -0.8],
  });
  assert.deepEqual(observedFrame(skinnedMeshes(existing)[0]), recordedFrame(body.shading.startup));
  // Same geometry under both bindings; only the material instance differs.
  assert.ok(
    sameArray(
      skinnedMeshes(existing)[0].geometry.attributes.position.array,
      skinnedMeshes(standalone)[0].geometry.attributes.position.array,
    ),
  );
  const index = runtimeIndexOf({
    revision: 'test',
    files: [
      {
        role: 'startup-actor',
        uses: [{ modelKey: 'actor' }],
        source: {
          geometry: { url: '/lod.glb', sha256: 'l' },
          full: { url: '/full.glb', sha256: 'f' },
        },
        output: {
          url: '/startup.glb',
          sha256: 's',
          bytes: 1,
          maximumTextureEdge: 1024,
          extensionsRequired: [],
        },
        upgrade: { url: '/full.opt.glb', sha256: 'u', bytes: 2 },
        lodDistanceMetres: 28,
        derivation: { startup: merged.report },
      },
    ],
  });
  assert.deepEqual(index.startupActors.actor.materialPairing.primitives, [
    {
      mesh: 0,
      primitive: 0,
      material: 'Body',
      startup: body.shading.startup,
      upgrade: body.shading.upgrade,
    },
  ]);
});

test('hybrid startup: UV-chart breaks are measured per primitive, the retained head seam is recorded', async () => {
  // A small head chart, and a LOD head whose vertices take UVs from all over the atlas, as the
  // cross-chart clustering of simplifySloppy does in the face-remake LOD heads.
  const high = parseGlb(actorFixture({ headUvScale: 0.1 }).glb, 'high'),
    sloppy = parseGlb(
      actorFixture({ lod: true, headUvScale: 0.1, lodUvScramble: true }).glb,
      'lod',
    ),
    clean = parseGlb(actorFixture({ lod: true, headUvScale: 0.1 }).glb, 'lod'),
    hybrid = buildStartupActor(high, sloppy, 'actor'),
    shown = buildStartupActor(high, sloppy, 'actor', { geometryPolicy: 'adopted-lod-only' }),
    tidy = buildStartupActor(high, clean, 'actor'),
    charts = (merged, p) => merged.report.primitives[p].geometry.uvCharts;
  assert.ok(
    charts(hybrid, 1).lodCrossChartAreaShare > 0.5,
    'the scrambled LOD head spans atlas charts',
  );
  assert.equal(charts(hybrid, 1).fullCrossChartAreaShare, 0);
  assert.equal(
    charts(tidy, 1).lodCrossChartAreaShare,
    0,
    'an attribute-preserving LOD keeps its charts',
  );
  assert.equal(charts(hybrid, 0).lodCrossChartAreaShare, 0, 'the LOD body keeps its charts');
  assert.deepEqual(
    charts(shown, 1),
    charts(hybrid, 1),
    'measured the same whichever geometry is shown',
  );
  assert.deepEqual(
    [hybrid, shown].map((merged) => merged.report.primitives[1].geometry.source),
    ['full-model', 'adopted-lod'],
  );
  // The startup file carries the full head, so the broken LOD head never reaches the screen.
  const full = await derive(high, 'full'),
    output = parseGlb((await derive(hybrid, 'startup')).glb, 'startup'),
    verification = await verifyStartup({
      high,
      lod: sloppy,
      output,
      highOutput: parseGlb(full.glb, 'full'),
      edge: 1024,
      label: 'actor',
      startup: hybrid.report,
    });
  // The default policy: full head, source-derived body; the LOD is never shown.
  assert.deepEqual(
    [
      verification.retainedFullPrimitives,
      verification.sourceSimplifiedPrimitives,
      verification.lodPrimitives,
    ],
    [1, 1, 0],
  );
  // Where a full head meets the body: 7 neck positions shared with the full body. The adopted LOD
  // body (diagnostic r03 policy) keeps 4 of them, the others 0.1 m from its nearest vertex; the
  // source-derived body locks and keeps all 7.
  const seamHigh = parseGlb(actorFixture({ seam: true }).glb, 'high'),
    seamLod = parseGlb(actorFixture({ lod: true, seam: true }).glb, 'lod'),
    seamOf = (policy) =>
      buildStartupActor(seamHigh, seamLod, 'actor', policy ? { geometryPolicy: policy } : {}).report
        .primitives[1].geometry.seam,
    lodSeam = seamOf('retain-face-primitives'),
    derivedSeam = seamOf(null);
  assert.equal(lodSeam.positionsSharedWithFullNeighbours, 7);
  assert.equal(lodSeam.stillSharedWithLodNeighbours, 4);
  assert.ok(Math.abs(lodSeam.nearestLodNeighbourVertexMetres.max - 0.1) < 1e-6);
  assert.deepEqual(
    [
      derivedSeam.positionsSharedWithFullNeighbours,
      derivedSeam.stillSharedWithLodNeighbours,
      derivedSeam.nearestLodNeighbourVertexMetres.max,
    ],
    [7, 7, 0],
  );
  assert.equal(
    buildStartupActor(seamHigh, seamLod, 'actor').report.primitives[0].geometry.seam,
    undefined,
    'only retained primitives have a seam',
  );
  // Downstream contract: per-primitive provenance and the low-level rule reach the runtime index.
  const index = runtimeIndexOf({
    revision: 'probe',
    files: [
      {
        role: 'startup-actor',
        uses: [{ modelKey: 'actor' }],
        source: {
          geometry: { url: '/lod.glb', sha256: 'l' },
          full: { url: '/full.glb', sha256: 'f' },
        },
        output: {
          url: '/startup.glb',
          sha256: 's',
          bytes: 1,
          maximumTextureEdge: 1024,
          extensionsRequired: [],
        },
        upgrade: { url: '/full.opt.glb', sha256: 'u', bytes: 2 },
        lodDistanceMetres: 28,
        derivation: { startup: hybrid.report },
      },
    ],
  });
  assert.deepEqual(index.startupActors.actor.geometry, [
    { mesh: 0, primitive: 0, material: 'Body', source: 'source-simplified', retention: null },
    { mesh: 0, primitive: 1, material: 'Head', source: 'full-model', retention: 'head-primitive' },
  ]);
  assert.match(
    index.startupActors.actor.lowLevel,
    /must not use the adopted LOD file for any primitive/,
  );
});

test('single-primitive actor: the whole primitive keeps the full model, and LOD geometry cannot stand in for it', async () => {
  // Like the fennec and the ape: one primitive, so there is no separable head to retain.
  const high = parseGlb(actorFixture({ bodyOnly: true }).glb, 'high'),
    lod = parseGlb(actorFixture({ lod: true, bodyOnly: true }).glb, 'lod'),
    merged = buildStartupActor(high, lod, 'actor'),
    [record] = merged.report.primitives,
    { geometry } = merged.report;
  assert.deepEqual(
    [record.geometry.source, record.geometry.retention],
    ['full-model', 'whole-single-primitive'],
  );
  assert.match(
    record.geometry.reason,
    /whole primitive keeps the full model geometry, a whole-model cost/,
  );
  // The whole full body: 105 vertices x 52 bytes + 504 uint16 indices, against the LOD's 32 + 126.
  assert.deepEqual(geometry.retained.byRetention['whole-single-primitive'], {
    primitives: 1,
    vertices: 105,
    triangles: 168,
    rawBytes: 105 * 52 + 504 * 2,
    replacedLodVertices: 32,
    replacedLodTriangles: 42,
    replacedLodRawBytes: 32 * 52 + 126 * 2,
  });
  assert.equal(geometry.retained.byRetention['head-primitive'].primitives, 0);
  assert.deepEqual(
    [geometry.startup, geometry.lodOnly],
    [
      { vertices: 105, triangles: 168 },
      { vertices: 32, triangles: 42 },
    ],
  );
  assert.deepEqual(merged.report.triangles, { full: 168, lod: 42, startup: 168 });
  assert.equal(merged.report.removedFullModelAccessors, 0, 'all full geometry is kept');
  assert.equal(merged.report.lodAccessors, 0, 'no LOD geometry is copied');
  const highOutput = parseGlb((await derive(high, 'full')).glb, 'full'),
    output = parseGlb((await derive(merged, 'startup')).glb, 'startup'),
    verification = await verifyStartup({
      high,
      lod,
      output,
      highOutput,
      edge: 1024,
      label: 'actor',
      startup: merged.report,
    });
  assert.deepEqual(
    [verification.retainedFullPrimitives, verification.lodPrimitives, verification.triangles],
    [1, 0, 168],
  );
  assert.equal(verification.storedGeometryBytes.adoptedLod, 0);
  assert.ok(
    verification.storedGeometryBytes.retainedFull > 0,
    'compressed cost measured in the startup file',
  );
  // An independent reference cannot silently use the old single-primitive LOD: a startup file
  // carrying it fails against the recorded provenance.
  const lodOnly = buildStartupActor(high, lod, 'actor', { geometryPolicy: 'adopted-lod-only' });
  assert.equal(lodOnly.report.primitives[0].geometry.reason, 'policy adopted-lod-only');
  await assert.rejects(
    verifyStartup({
      high,
      lod,
      output: parseGlb((await derive(lodOnly, 'lod-only')).glb, 'lod-only'),
      highOutput,
      edge: 1024,
      label: 'actor',
      startup: merged.report,
    }),
    /mesh 0 primitive 0 POSITION \(full model\)/,
  );
  const index = runtimeIndexOf({
    revision: 'probe',
    files: [
      {
        role: 'startup-actor',
        uses: [{ modelKey: 'actor' }],
        source: {
          geometry: { url: '/lod.glb', sha256: 'l' },
          full: { url: '/full.glb', sha256: 'f' },
        },
        output: {
          url: '/startup.glb',
          sha256: 's',
          bytes: 1,
          maximumTextureEdge: 1024,
          extensionsRequired: [],
        },
        upgrade: { url: '/full.opt.glb', sha256: 'u', bytes: 2 },
        lodDistanceMetres: 28,
        derivation: { startup: merged.report },
      },
    ],
  });
  assert.deepEqual(index.startupActors.actor.geometry, [
    {
      mesh: 0,
      primitive: 0,
      material: 'Body',
      source: 'full-model',
      retention: 'whole-single-primitive',
    },
  ]);
  assert.match(
    index.startupActors.actor.lowLevel,
    /distance or far level must not use the adopted LOD file.*whole primitive of single-primitive actors/,
  );
});

test('source-derived startup body: byte-exact source vertices, kept seams and borders; wrong provenance is rejected', async () => {
  const high = parseGlb(actorFixture({ seam: true }).glb, 'high'),
    lod = parseGlb(actorFixture({ lod: true, seam: true }).glb, 'lod'),
    merged = buildStartupActor(high, lod, 'actor'),
    [body, head] = merged.report.primitives,
    s = body.geometry.simplification,
    map = s.sourceVertexIndices;
  assert.equal(merged.report.geometry.policy, 'source-derived');
  assert.deepEqual(
    [body.geometry.source, head.geometry.source, head.geometry.retention],
    ['source-simplified', 'full-model', 'head-primitive'],
  );
  assert.equal(s.method, SOURCE_SIMPLIFY.method);
  assert.deepEqual(s.flags, ['LockBorder', 'ErrorAbsolute'], 'no Sloppy, Permissive or Prune');
  assert.deepEqual(
    s.attributeColumns,
    ['NORMAL.x', 'NORMAL.y', 'NORMAL.z', 'TEXCOORD_0.u', 'TEXCOORD_0.v', 'weight:Hips'],
    'normals, UVs and per-bone weights; joint indices are never used as values',
  );
  assert.equal(s.sourceTriangles, 168);
  assert.ok(
    s.achievedTriangles < s.sourceTriangles && s.achievedVertices < s.sourceVertexCount,
    'the flat body reduces',
  );
  assert.ok(s.resultErrorMetres <= SOURCE_SIMPLIFY.targetErrorMetres);
  assert.deepEqual(
    [map.length, body.geometry.startupVertices, body.geometry.startupTriangles],
    [s.achievedVertices, s.achievedVertices, s.achievedTriangles],
  );
  // The 7 neck positions shared with the full head are locked and kept, so is the whole outline.
  assert.deepEqual([s.locks.crossPrimitivePositions, s.lockedVerticesKept], [7, 7]);
  const outline = [];
  for (let r = 0; r < 15; r++)
    for (let c = 0; c < 7; c++)
      if (r === 0 || r === 14 || c === 0 || c === 6) outline.push(r * 7 + c);
  assert.ok(
    outline.every((v) => map.includes(v)),
    'LockBorder keeps every border vertex',
  );
  assert.deepEqual(
    [
      head.geometry.seam.positionsSharedWithFullNeighbours,
      head.geometry.seam.stillSharedWithLodNeighbours,
      head.geometry.seam.nearestLodNeighbourVertexMetres.max,
    ],
    [7, 7, 0],
  );
  assert.deepEqual(merged.report.geometry.simplified, {
    primitives: 1,
    sourceVertices: 105,
    sourceTriangles: 168,
    sourceRawBytes: 105 * 52 + 504 * 2,
    vertices: s.achievedVertices,
    triangles: s.achievedTriangles,
    rawBytes: s.achievedVertices * 52 + s.achievedTriangles * 3 * 2,
  });
  // The packed candidate: every vertex is the recorded source vertex; all clips are the full model's.
  const highOutput = parseGlb((await derive(high, 'full')).glb, 'full'),
    output = parseGlb((await derive(merged, 'startup')).glb, 'startup'),
    verify = (overrides) =>
      verifyStartup({
        high,
        lod,
        output,
        highOutput,
        edge: 1024,
        label: 'actor',
        startup: merged.report,
        ...overrides,
      }),
    verification = await verify({});
  assert.deepEqual(
    [
      verification.retainedFullPrimitives,
      verification.sourceSimplifiedPrimitives,
      verification.lodPrimitives,
      verification.triangles,
      verification.clips,
    ],
    [1, 1, 0, s.achievedTriangles + 96, 2],
  );
  assert.ok(verification.storedGeometryBytes.sourceSimplified > 0);
  // Wrong UV, skin or index data in the candidate, or a wrong source map, is rejected.
  const tamper = async (pick, edit) => {
    const json = structuredClone(merged.json),
      bin = Buffer.from(merged.bin),
      accessor = json.accessors[pick(json.meshes[0].primitives[0])];
    edit(bin, json.bufferViews[accessor.bufferView].byteOffset + (accessor.byteOffset ?? 0));
    return parseGlb((await derive({ json, bin }, 'tampered')).glb, 'tampered');
  };
  await assert.rejects(
    verify({
      output: await tamper(
        (p) => p.attributes.TEXCOORD_0,
        (bytes, at) => bytes.writeFloatLE(0.123, at),
      ),
    }),
    /TEXCOORD_0: vertex 0 differs from source vertex/,
  );
  await assert.rejects(
    verify({
      output: await tamper(
        (p) => p.attributes.WEIGHTS_0,
        (bytes, at) => bytes.writeFloatLE(0.5, at),
      ),
    }),
    /WEIGHTS_0: vertex 0 differs from source vertex/,
  );
  await assert.rejects(
    verify({
      output: await tamper(
        (p) => p.indices,
        (bytes, at) => {
          const first = bytes.readUInt16LE(at);
          bytes.writeUInt16LE(bytes.readUInt16LE(at + 2), at);
          bytes.writeUInt16LE(first, at + 2);
        },
      ),
    }),
    /indices differ from the recorded simplifier output/,
  );
  const unhashed = structuredClone(merged.report);
  unhashed.primitives[0].geometry.simplification.sourceVertexIndices.reverse();
  await assert.rejects(
    verify({ startup: unhashed }),
    /source vertex map does not match its SHA-256/,
  );
  const swapped = structuredClone(merged.report),
    entry = swapped.primitives[0].geometry.simplification;
  [entry.sourceVertexIndices[0], entry.sourceVertexIndices[1]] = [
    entry.sourceVertexIndices[1],
    entry.sourceVertexIndices[0],
  ];
  entry.sourceVertexSha256 = sha256(
    Buffer.from(Uint32Array.from(entry.sourceVertexIndices).buffer),
  );
  await assert.rejects(
    verify({ startup: swapped }),
    /POSITION: vertex 0 differs from source vertex/,
  );
  // The adopted LOD body cannot pass as source-derived geometry.
  const lodBody = parseGlb(
    (
      await derive(
        buildStartupActor(high, lod, 'actor', { geometryPolicy: 'retain-face-primitives' }),
        'lod',
      )
    ).glb,
    'lod',
  );
  await assert.rejects(
    verify({ output: lodBody }),
    /mesh 0 primitive 0 POSITION: 32 vertices, the map has/,
  );
  // Deterministic: the same sources give the same reduction.
  assert.deepEqual(
    buildStartupActor(high, lod, 'actor').report.primitives[0].geometry.simplification,
    merged.report.primitives[0].geometry.simplification,
  );
});

/** A flat 9 x 9 grid split into two UV charts along column 4 (duplicated vertices with other UVs),
 * skinned with a linear blend from joint 0 (left) to joint 1 (right). */
function seamSheet({ targets = false, indexed = true } = {}) {
  const position = [],
    normal = [],
    uv = [],
    joints = [],
    weights = [],
    add = (c, r, u, v) => {
      position.push(c * 0.1, r * 0.1, 0);
      normal.push(0, 0, 1);
      uv.push(u, v);
      joints.push(0, 1, 0, 0);
      weights.push(1 - c / 8, c / 8, 0, 0);
    };
  for (let r = 0; r < 9; r++) for (let c = 0; c <= 4; c++) add(c, r, c / 16, r / 8);
  for (let r = 0; r < 9; r++) for (let c = 4; c <= 8; c++) add(c, r, 0.6 + (c - 4) / 16, r / 8);
  const left = (c, r) => r * 5 + c,
    right = (c, r) => 45 + r * 5 + (c - 4),
    triangles = [];
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++) {
      const at = c < 4 ? left : right;
      triangles.push(
        at(c, r),
        at(c + 1, r),
        at(c, r + 1),
        at(c + 1, r),
        at(c + 1, r + 1),
        at(c, r + 1),
      );
    }
  const views = [],
    accessors = [],
    add32 = (array, componentType, count, type, extra = {}) => {
      views.push({ bytes: array, target: 34962 });
      accessors.push({ bufferView: views.length - 1, componentType, count, type, ...extra });
      return accessors.length - 1;
    },
    positions = Float32Array.from(position),
    attributes = {
      POSITION: add32(positions, 5126, 90, 'VEC3', minMax(positions, 3)),
      NORMAL: add32(Float32Array.from(normal), 5126, 90, 'VEC3'),
      TEXCOORD_0: add32(Float32Array.from(uv), 5126, 90, 'VEC2'),
      JOINTS_0: add32(Uint8Array.from(joints), 5121, 90, 'VEC4'),
      WEIGHTS_0: add32(Float32Array.from(weights), 5126, 90, 'VEC4'),
    },
    primitive = { attributes };
  if (indexed) {
    views.push({ bytes: Uint16Array.from(triangles), target: 34963 });
    accessors.push({
      bufferView: views.length - 1,
      componentType: 5123,
      count: triangles.length,
      type: 'SCALAR',
    });
    primitive.indices = accessors.length - 1;
  }
  if (targets)
    primitive.targets = [
      {
        POSITION: add32(new Float32Array(270), 5126, 90, 'VEC3', {
          min: [0, 0, 0],
          max: [0, 0, 0],
        }),
      },
    ];
  const built = documentFrom(
    { asset: { version: '2.0' }, meshes: [{ primitives: [primitive] }], accessors },
    views,
  );
  return parseGlb(built.glb, 'seam sheet');
}

test('source simplification keeps UV charts apart and treats skin weights per bone, never joint ids as values', async () => {
  const doc = seamSheet(),
    { views } = await decodeViews(doc, 'seam sheet'),
    primitive = doc.json.meshes[0].primitives[0],
    run = (options = {}) =>
      simplifySourcePrimitive({
        doc,
        views,
        primitive,
        lockedPositions: new Set(),
        jointNames: ['A', 'B'],
        ...options,
      }),
    result = run();
  assert.equal(result.supported, true);
  assert.equal(result.reduced, true, 'linear UVs, weights and normals on a flat grid reduce');
  assert.deepEqual(result.record.attributeColumns, [
    'NORMAL.x',
    'NORMAL.y',
    'NORMAL.z',
    'TEXCOORD_0.u',
    'TEXCOORD_0.v',
    'weight:A',
    'weight:B',
  ]);
  // The two charts never share a triangle: vertices 0-44 are the left chart, 45-89 the right.
  for (let t = 0; t < result.indices.length; t += 3) {
    const corners = [0, 1, 2].map((k) => result.sourceVertices[result.indices[t + k]] < 45);
    assert.ok(
      corners.every((side) => side === corners[0]),
      `triangle ${t / 3} spans the UV seam`,
    );
  }
  // Index-only: every output vertex is a source vertex, each at most once.
  assert.equal(new Set(result.sourceVertices).size, result.sourceVertices.length);
  assert.ok(Array.from(result.sourceVertices).every((v) => v < 90));
  assert.deepEqual(run().record, result.record, 'deterministic');
  // With room for one bone column only, vertices weighted to the other bone are locked instead of
  // averaging joint ids; nothing else can move here, so the primitive is honestly not reduced.
  const tight = run({ maxAttributes: 6 });
  assert.deepEqual(tight.record.attributeColumns.slice(5), ['weight:A']);
  assert.equal(tight.record.locks.jointBudget, 81, 'every vertex with weight on joint B');
  assert.equal(tight.reduced, false);
  // Locked shared positions survive.
  const locked = run({ lockedPositions: new Set(['0.4000000059604645,0.4000000059604645,0']) });
  assert.equal(locked.record.locks.crossPrimitivePositions, 2, 'both copies of the seam vertex');
  assert.equal(locked.record.lockedVerticesKept, 2);
  // Unsupported input is kept whole rather than forced.
  const withTargets = seamSheet({ targets: true }),
    unindexed = seamSheet({ indexed: false });
  assert.deepEqual(
    [withTargets, unindexed].map((other) =>
      // Refused before any data is read.
      simplifySourcePrimitive({
        doc: other,
        views: null,
        primitive: other.json.meshes[0].primitives[0],
        lockedPositions: new Set(),
      }),
    ),
    [
      { supported: false, reason: 'has morph targets' },
      { supported: false, reason: 'not indexed' },
    ],
  );
});

test('primitive correspondence uses surface agreement and accepts the adopted seam tuck', () => {
  const high = parseGlb(actorFixture().glb, 'high'),
    merge = (options) =>
      buildStartupActor(
        high,
        parseGlb(actorFixture({ lod: true, ...options }).glb, 'lod'),
        'actor',
      );
  // The remade LOD heads push their neck seam up to 5 cm below the full head into the body.
  const tucked = merge({ tuck: 0.05 }),
    head = tucked.report.primitives[1];
  assert.ok(Math.abs(head.overhangBeyondFullPrimitiveMetres - 0.05) < 1e-6);
  assert.ok(head.surfaceAgreement >= 0.8);
  assert.ok(head.competingSurfaceAgreement < head.surfaceAgreement);
  for (const [options, pattern] of [
    [{ headShift: 0.5 }, /surface agreement/],
    [{ swap: true, slotNames: false }, /surface agreement/],
    [{ swap: true }, /names full-model primitive 1/],
  ])
    assert.throws(() => merge(options), pattern, JSON.stringify(options));
});

test('startup merge rejects incompatible skeletons, transforms and primitive order explicitly', () => {
  const high = parseGlb(actorFixture().glb, 'high');
  for (const [options, pattern] of [
    [{ rename: 'Skull' }, /LOD joint "Skull" is not in the full-model skeleton/],
    [{ inverseBindOffset: 0.01 }, /inverse bind matrices differ/],
    [{ meshOffset: 0.2 }, /world transform differs/],
    [{ swap: true }, /names full-model primitive 1/],
    [{ swap: true, slotNames: false }, /surface agreement/],
    [{ dropNormal: true }, /attributes differ/],
  ])
    assert.throws(
      () =>
        buildStartupActor(
          high,
          parseGlb(actorFixture({ lod: true, ...options }).glb, 'lod'),
          'actor',
        ),
      pattern,
      JSON.stringify(options),
    );
  const clipless = parseGlb(actorFixture({ lod: true }).glb, 'no clips');
  assert.throws(() => buildStartupActor(clipless, clipless, 'actor'), /no animation clips/);
});

const fileIdentity = ({ url, sha256: hash, bytes }) => ({ url, sha256: hash, bytes });

/**
 * The original sources of the public characters' startup actors. Before an adoption they are the
 * current manifests. Once one is applied, the character manifests serve the sole-primary startup
 * files, so the originals come from that adoption's saved pre-apply bytes. Each saved file's
 * SHA-256 is checked against three records: the candidate revision's recorded input, the plan's
 * inputs, and the plan's before bytes. Its records must be the revision's own source records.
 * The current manifests are never read as originals. Ordinary and exact-repack chains retain
 * startup entries; a reviewed guarded chain may reduce them while retaining their lineage and
 * rejected-LOD records. Each step is checked, and originals still come from the chain's root.
 */
async function startupActorSources() {
  const read = (relative) => readFile(path.join(REPO_ROOT, ...relative.split('/'))),
    catalog = JSON.parse(await read('public/models/world-assets.json')),
    ids = new Set(
      catalog.assets.map((asset) => asset.runtimeOptimization?.adoption).filter(Boolean),
    );
  assert.ok(ids.size <= 1, `the catalog names more than one adoption: ${[...ids].join(', ')}`);
  if (!ids.size) {
    const rules = await loadEligibilityRules(REPO_ROOT),
      inventory = await buildInventory(REPO_ROOT, rules);
    return {
      adoption: null,
      actors: inventory.models
        .filter((model) => model.eligible && model.publicCharacter)
        .map(({ modelKey, files }) => ({ modelKey, files })),
    };
  }
  const appliedRecord = async (adoption) => {
    const where = `assets/runtime-adoption/${adoption}`,
      planBytes = await read(`${where}/plan.json`),
      journal = JSON.parse(await read(`${where}/journal.json`));
    assert.equal(
      journal.planSha256,
      sha256(planBytes),
      `${where}: the journal belongs to the plan`,
    );
    assert.equal(journal.state, 'applied', `${where}: applied`);
    return { record: where, planSha256: sha256(planBytes), plan: JSON.parse(planBytes) };
  };
  const [id] = ids,
    active = await appliedRecord(id);
  let origin = active;
  while (origin.plan.base) {
    const base = await appliedRecord(origin.plan.base.adoption);
    assert.equal(base.planSha256, origin.plan.base.planSha256, `${origin.record}: its base plan`);
    if (origin.plan.recipe === 'guarded-surface@1') {
      assert.deepEqual(await assertGuardedHistoryStep(REPO_ROOT, origin.plan), base.plan);
      origin = base;
      continue;
    }
    for (const [key, entry] of Object.entries(base.plan.graph.models)) {
      if (entry.selection !== 'startup-sole-primary') continue;
      const { candidateRevision, adoptedBy, ...rest } = origin.plan.graph.models[key],
        { candidateRevision: was, adoptedBy: by, ...expected } = entry;
      assert.deepEqual(
        rest,
        expected,
        `${origin.record} keeps ${key} exactly as its base adopted it`,
      );
      assert.deepEqual(
        [candidateRevision, adoptedBy],
        [was ?? base.plan.graph.candidateRevision, by ?? base.plan.adoption],
        key,
      );
    }
    origin = base;
  }
  const { record, plan } = origin,
    [manifestFile, indexFile] = plan.candidateRevision.files,
    revisionBytes = await read(manifestFile.path),
    indexBytes = await read(indexFile.path);
  assert.equal(sha256(revisionBytes), manifestFile.sha256, manifestFile.path);
  assert.equal(sha256(indexBytes), indexFile.sha256, indexFile.path);
  const revision = JSON.parse(revisionBytes),
    runtimeIndex = JSON.parse(indexBytes),
    recorded = (inputs, relative) => inputs.find((input) => input.path === relative)?.sha256,
    actors = [];
  for (const model of revision.models.filter((item) => item.eligible && item.publicCharacter)) {
    const saved = await read(`${record}/before/${model.manifest}`),
      digest = sha256(saved),
      operation = plan.operations.manifests.find((item) => item.path === model.manifest);
    assert.equal(
      digest,
      recorded(revision.inputs.manifests, model.manifest),
      `${model.manifest}: the revision's input`,
    );
    assert.equal(
      digest,
      recorded(plan.inputs.manifests, model.manifest),
      `${model.manifest}: the plan's input`,
    );
    assert.equal(digest, operation?.before.sha256, `${model.manifest}: the plan's before bytes`);
    const asset = JSON.parse(saved);
    assert.deepEqual(
      [asset, ...(asset.lods ?? [])].map(fileIdentity),
      model.files.map(fileIdentity),
      `${model.modelKey}: the saved records are the revision's sources`,
    );
    actors.push({
      modelKey: model.modelKey,
      files: model.files,
      saved: asset,
      startup: revision.files.find((file) => file.id === `startup:${model.modelKey}`),
      index: runtimeIndex.startupActors[model.modelKey],
    });
  }
  assert.deepEqual(
    actors.map((actor) => actor.modelKey).sort(),
    Object.entries(plan.graph.models)
      .filter(([, entry]) => entry.selection === 'startup-sole-primary')
      .map(([key]) => key)
      .sort(),
    'the revision and the adoption name the same startup actors',
  );
  // The active adoption: the served records name it, and its graph serves the actors.
  return { adoption: { id, plan: active.plan, originalPlan: plan }, actors };
}

// Real original sources, read-only and hash-checked: the current manifests before an adoption,
// the adoption's saved pre-apply manifests after it. Images keep their source size here;
// resizing is covered by the texture tests and the generator.
test('every eligible public character merges its adopted LOD into a verified startup actor', async (t) => {
  const { adoption, actors } = await startupActorSources(),
    load = async (record) => {
      const doc = parseGlb(await readVerifiedSource(REPO_ROOT, record), record.url);
      validateDocument(doc.json, doc.bin, record.url);
      checkExtensions(doc.json, record.url);
      return doc;
    };
  assert.ok(actors.length > 0, 'no public characters to re-derive');
  for (const model of actors) {
    const [fullRecord, lodRecord] = model.files,
      label = `${model.modelKey} startup actor`;
    assert.ok(lodRecord, `${model.modelKey} has no adopted LOD`);
    const full = await load(fullRecord),
      lod = await load(lodRecord),
      fullHash = sha256(full.bytes),
      merged = buildStartupActor(full, lod, label),
      startup = await compressViews(merged.json, merged.bin, label),
      upgrade = await compressViews(full.json, full.bin, `${model.modelKey} full`),
      output = parseGlb(packGlb(startup.json, startup.bin), label),
      report = await verifyStartup({
        high: full,
        lod,
        output,
        highOutput: parseGlb(packGlb(upgrade.json, upgrade.bin), `${model.modelKey} full`),
        edge: Infinity,
        label,
        startup: merged.report,
      }),
      { geometry } = merged.report,
      geometryOf = (index) => merged.report.primitives[index].geometry;
    assert.equal(sha256(full.bytes), fullHash, 'source untouched');
    assert.equal(report.triangles, geometry.startup.triangles, `${label} triangles`);
    assert.equal(report.clips, full.json.animations.length, `${label} clips`);
    if (adoption) {
      // Re-derived from the saved originals, the proofs are exactly the ones r04 recorded.
      assert.ok(model.startup, `${model.modelKey}: r04 has a startup record`);
      assert.equal(
        jsonDifference(model.startup.derivation.startup, merged.report),
        null,
        `${label}: r04's recorded startup proofs`,
      );
      // The root keeps r04's verified startup. The active graph may serve a reviewed reduction,
      // linked back to that root by the history checks above, with no old LOD restored.
      const served = JSON.parse(
          await readFile(
            path.join(REPO_ROOT, 'public', 'models', model.modelKey, 'asset.json'),
            'utf8',
          ),
        ),
        entry = adoption.plan.graph.models[model.modelKey],
        originalEntry = adoption.originalPlan.graph.models[model.modelKey],
        file = await readFile(path.join(REPO_ROOT, 'public', ...served.url.slice(1).split('/')));
      assert.equal(entry.selection, 'startup-sole-primary', model.modelKey);
      assert.deepEqual(
        fileIdentity(originalEntry.primary),
        fileIdentity(model.startup.output),
        `${label}: original adopted startup`,
      );
      assert.deepEqual(
        fileIdentity(originalEntry.primary),
        fileIdentity(model.index),
        `${label}: r04 runtime index`,
      );
      assert.deepEqual(
        fileIdentity(served),
        fileIdentity(entry.primary),
        `${label}: adoption graph`,
      );
      assert.deepEqual([file.length, sha256(file)], [served.bytes, served.sha256], served.url);
      assert.deepEqual(served.lods, [], `${label}: old LODs cleared`);
      assert.equal(served.runtimeOptimization?.adoption, adoption.id, model.modelKey);
      assert.deepEqual(
        fileIdentity(served.runtimeOptimization.original),
        fileIdentity(model.saved),
        `${label}: the original identity it replaced`,
      );
      assert.deepEqual(served.runtimeOptimization.original.lods, model.saved.lods);
    }
    // Every separable head (human women and men, the cat) keeps the full model's geometry. The
    // single-primitive fennec and ape (damaged LOD faces in the r02 review) keep their whole
    // primitive: the full model's geometry cost, recorded as such.
    const retainedIndices = merged.report.primitives
      .filter((p) => p.geometry.source === 'full-model')
      .map((p) => p.primitive);
    if (merged.report.primitives.length === 1) {
      assert.deepEqual(retainedIndices, [0], `${label}: the whole single primitive is retained`);
      assert.equal(geometryOf(0).retention, 'whole-single-primitive');
      assert.deepEqual(geometry.startup, {
        vertices: merged.report.primitives[0].fullVertices,
        triangles: geometryOf(0).fullTriangles,
      });
      assert.equal(geometry.retained.byRetention['whole-single-primitive'].primitives, 1);
    } else {
      assert.ok(
        retainedIndices.includes(1),
        `${label}: the head primitive keeps the full model's geometry`,
      );
      assert.equal(geometryOf(1).retention, 'head-primitive');
      assert.equal(geometry.retained.byRetention['whole-single-primitive'].primitives, 0);
    }
    assert.equal(report.retainedFullPrimitives, retainedIndices.length);
    assert.equal(
      report.storedGeometryBytes.retainedFull,
      report.storedGeometryBytes.primitives
        .filter((item) => item.source === 'full-model')
        .reduce((sum, item) => sum + item.storedBytes, 0),
    );
    // No primitive shows the adopted LOD: every other primitive is derived from its own original
    // full primitive, or kept whole (recorded as not an optimization) when that finds nothing.
    assert.equal(merged.report.geometry.policy, 'source-derived');
    assert.equal(report.lodPrimitives, 0, `${label}: no adopted LOD geometry`);
    for (const primitive of merged.report.primitives) {
      const { source, retention, simplification } = primitive.geometry;
      assert.ok(
        source === 'source-simplified' || source === 'full-model',
        `${label} primitive ${primitive.primitive}: ${source}`,
      );
      if (
        source === 'full-model' &&
        !['head-primitive', 'whole-single-primitive'].includes(retention)
      )
        assert.ok(
          ['unreduced-whole-primitive', 'unsupported-whole-primitive'].includes(retention),
          `${label}: ${retention}`,
        );
      if (source !== 'source-simplified') continue;
      assert.deepEqual(simplification.flags, ['LockBorder', 'ErrorAbsolute']);
      assert.ok(
        simplification.resultErrorMetres <= SOURCE_SIMPLIFY.targetErrorMetres,
        `${label} simplifier error`,
      );
      assert.ok(simplification.achievedTriangles < simplification.sourceTriangles);
      assert.equal(
        simplification.lockedVerticesKept,
        simplification.lockedVertices,
        `${label}: every locked vertex survives`,
      );
      assert.ok(
        !simplification.attributeColumns.some((name) => /JOINTS/.test(name)),
        'joint ids are never attribute values',
      );
    }
    assert.equal(report.sourceSimplifiedPrimitives, merged.report.geometry.simplified.primitives);
    for (const skin of merged.report.skins) {
      assert.equal(skin.hierarchy, 'identical parent joints');
      // performance-lod.ts does not remap joints, so it is only a valid reference for this order.
      assert.equal(skin.jointOrder, 'identical', `${label} joint order`);
      assert.ok(skin.skinnedDisplacementBoundMetres <= STARTUP_TOLERANCE.skinnedDisplacement);
    }
    for (const primitive of merged.report.primitives)
      assert.ok(
        primitive.omittedAttributes.every((name) => name === 'TANGENT'),
        `${label} keeps required attributes`,
      );
    t.diagnostic(
      JSON.stringify({
        modelKey: model.modelKey,
        skins: merged.report.skins.map((skin) => ({
          jointOrder: skin.jointOrder,
          inverseBindDifference: skin.inverseBindDifference,
          inverseBindBottomRowDifference: skin.inverseBindBottomRowDifference,
          skinnedDisplacementBoundMetres: skin.skinnedDisplacementBoundMetres,
          restPoseDifference: skin.restPoseDifference,
          poseBound: skin.poseBound,
        })),
        primitives: merged.report.primitives.map((primitive) => ({
          material: primitive.material,
          omitted: primitive.omittedAttributes,
          surfaceAgreement: Number(primitive.surfaceAgreement.toFixed(4)),
          competing: Number(primitive.competingSurfaceAgreement.toFixed(4)),
          overhangMetres: Number(primitive.overhangBeyondFullPrimitiveMetres.toFixed(4)),
          exactVertexReuse: Number(primitive.exactVertexReuse.toFixed(4)),
          materialSlot: primitive.materialSlot,
          bindDistanceMetres: primitive.bindDistanceMetres,
          sameShadingAsExistingLod: primitive.shading.sameAsExistingLod,
          // The census without the per-vertex source map.
          geometry: {
            ...primitive.geometry,
            simplification: primitive.geometry.simplification && {
              ...primitive.geometry.simplification,
              sourceVertexIndices: `${primitive.geometry.simplification.sourceVertexIndices?.length ?? 0} entries`,
            },
          },
        })),
        retained: geometry.retained,
        simplified: geometry.simplified,
        startupGeometry: geometry.startup,
        storedGeometryBytes: {
          retainedFull: report.storedGeometryBytes.retainedFull,
          sourceSimplified: report.storedGeometryBytes.sourceSimplified,
          adoptedLod: report.storedGeometryBytes.adoptedLod,
        },
        lodOnlyGeometry: geometry.lodOnly,
        bytes: { full: full.bytes.length, startup: packGlb(startup.json, startup.bin).length },
      }),
    );
    // The cause, measured: the face-remake LOD heads (simplifySloppy) put far more of their area
    // on triangles spanning UV charts than the attribute-aware LOD body of the same actor.
    merged.report.primitives
      .filter((primitive) => /^C2 face remake head/.test(primitive.material ?? ''))
      .forEach((head) =>
        assert.ok(
          head.geometry.uvCharts.lodCrossChartAreaShare >
            geometryOf(0).uvCharts.lodCrossChartAreaShare,
          `${label}: sloppy LOD head ${head.geometry.uvCharts.lodCrossChartAreaShare} vs LOD body ${geometryOf(0).uvCharts.lodCrossChartAreaShare}`,
        ),
      );
    // three.js reads it with the full skeleton, clips and materials (texture images stubbed).
    const glb = loadableGlb(output);
    await assert.rejects(
      new GLTFLoader().register(textureStub).parseAsync(arrayBufferOf(glb), ''),
      /setMeshoptDecoder/,
    );
    const gltf = await loader().parseAsync(arrayBufferOf(glb), ''),
      skinned = skinnedMeshes(gltf);
    const lodPrimitives = lod.json.meshes.flatMap((mesh) => mesh.primitives),
      fullPrimitives = full.json.meshes.flatMap((mesh) => mesh.primitives),
      fullSkin = full.json.skins[full.json.nodes.find((node) => node.skin !== undefined).skin];
    assert.equal(skinned.length, lodPrimitives.length, `${label} skinned meshes`);
    skinned.forEach((mesh, index) => {
      const { source, simplification } = geometryOf(index),
        [doc, primitive] =
          source === 'adopted-lod' ? [lod, lodPrimitives[index]] : [full, fullPrimitives[index]];
      assert.equal(
        mesh.geometry.attributes.position.count,
        source === 'source-simplified'
          ? simplification.sourceVertexIndices.length
          : doc.json.accessors[primitive.attributes.POSITION].count,
      );
      assert.equal(!!mesh.geometry.attributes.tangent, primitive.attributes.TANGENT !== undefined);
      assert.deepEqual(
        mesh.skeleton.bones.map((bone) => bone.userData.name ?? bone.name),
        fullSkin.joints.map((joint) => full.json.nodes[joint].name),
      );
    });
    assert.deepEqual(
      gltf.animations.map((clip) => clip.name),
      full.json.animations.map((animation, index) => animation.name ?? `animation_${index}`),
    );
    // The independent reference is built from the sources by the game's own loader. Retained
    // primitives must equal the full geometry performance-lod.ts keeps for near range, and
    // source-simplified ones must equal it vertex for vertex through the recorded source map;
    // performance-lod.ts's distance LOD shows other (adopted LOD) geometry for both.
    const existingGltf = await existingLodBinding(
        loadableGlb(full),
        loadableGlb(lod),
        model.modelKey,
      ),
      existing = skinnedMeshes(existingGltf),
      detail = existingGltf.scene.userData.actorDetail;
    assert.equal(existing.length, skinned.length, `${label} existing LOD meshes`);
    existing.forEach((mesh, index) => {
      const own = skinned[index],
        { shading } = merged.report.primitives[index],
        { source, simplification } = geometryOf(index),
        fromFull = source !== 'adopted-lod',
        reference = fromFull
          ? detail.meshes.find((entry) => entry.mesh === mesh).high
          : mesh.geometry,
        sourceVertex =
          source === 'source-simplified' ? (i) => simplification.sourceVertexIndices[i] : (i) => i,
        where = `${label} primitive ${index} (${source})`;
      if (fromFull)
        assert.notEqual(
          mesh.geometry,
          reference,
          `${where}: today's distance LOD shows other geometry here`,
        );
      assert.deepEqual(
        Object.keys(own.geometry.attributes).sort(),
        Object.keys(reference.attributes).sort(),
        `${where} attributes`,
      );
      for (const [name, attribute] of Object.entries(own.geometry.attributes)) {
        const other = reference.attributes[name];
        assert.equal(attribute.itemSize, other.itemSize, `${where} ${name} item size`);
        if (source !== 'source-simplified')
          assert.equal(attribute.count, other.count, `${where} ${name} count`);
        for (let i = 0; i < attribute.count; i++)
          for (let c = 0; c < attribute.itemSize; c++)
            if (attribute.getComponent(i, c) !== other.getComponent(sourceVertex(i), c))
              assert.fail(
                `${where} ${name} vertex ${i} differs from source vertex ${sourceVertex(i)} at ${c}`,
              );
      }
      assert.deepEqual(
        own.skeleton.boneInverses.map((matrix) => matrix.elements),
        mesh.skeleton.boneInverses.map((matrix) => matrix.elements),
        `${where} inverse binds`,
      );
      if (shading.normalMap) {
        assert.deepEqual(
          observedFrame(own),
          recordedFrame(shading.startup),
          `${where} standalone material`,
        );
        // Historical r04 record: the LOD geometry under the full model's authored material.
        assert.deepEqual(
          recordedFrame(shading.existingLod),
          { tangents: observedFrame(mesh).tangents, normalScale: shading.upgrade.normalScale },
          `${where}: the r04 record of the old performance-lod binding`,
        );
        assert.equal(
          shading.sameAsExistingLod,
          sameFrame(shading.startup, shading.existingLod),
          `${where}: sameAsExistingLod compares with the r04-era binding`,
        );
        // Today's performance-lod.ts: the loader's convention for the LOD geometry it shows.
        assert.deepEqual(
          observedFrame(mesh),
          loaderFrame(mesh, shading.normalScale),
          `${where}: today's distance LOD material is finalised for its own geometry`,
        );
      }
    });
  }
});

test('sources come only from public/models and must match the manifest hash and length', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cro-optimization-'));
  try {
    const bytes = Buffer.from('synthetic source bytes'),
      record = { url: '/models/probe/model.glb', sha256: sha256(bytes), bytes: bytes.length };
    await mkdir(path.join(root, 'public', 'models', 'probe'), { recursive: true });
    await writeFile(path.join(root, 'public', 'models', 'probe', 'model.glb'), bytes);
    assert.ok((await readVerifiedSource(root, record)).equals(bytes));
    await assert.rejects(
      readVerifiedSource(root, { ...record, sha256: '0'.repeat(64) }),
      /SHA-256/,
    );
    await assert.rejects(
      readVerifiedSource(root, { ...record, bytes: bytes.length + 1 }),
      /bytes on disk/,
    );
    for (const url of [
      '/models/../server.mjs',
      '/models/probe/../../x.glb',
      'https://example.com/models/a.glb',
      '/public/models/probe/model.glb',
      '/models/probe/model.txt',
      '/models/model.glb',
    ])
      assert.throws(() => resolveSourceFile(root, url), /Unsafe model URL/, url);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('revision directories must be new folders under the approved output roots', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cro-optimization-'));
  try {
    assert.equal(
      resolveRevisionDirectory(root, 'assets/optimized-runtime/20261009-r01').relative,
      'assets/optimized-runtime/20261009-r01',
    );
    assert.equal(
      resolveRevisionDirectory(root, 'output/optimization/r02').relative,
      'output/optimization/r02',
    );
    for (const unsafe of [
      '../outside',
      'public/models/derived',
      'assets/optimized-runtime',
      'assets/optimized-runtime/../../public/models',
      'src/derived',
      'output/../.git/candidates',
      'assets/optimized-runtime/ space',
      path.join(os.tmpdir(), 'elsewhere'),
    ])
      assert.throws(
        () => resolveRevisionDirectory(root, unsafe),
        /outside|must be a new folder|unsafe/,
        unsafe,
      );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('eligibility follows the active roster, groundcover switch and public character list', () => {
  const rules = {
      mascotModelReleased: (key) => key !== 'sleeping-mascot',
      groundcoverVisible: (key) => key !== 'grass',
      characterModels: [
        { key: 'hero', species: 'cro' },
        { key: 'helper', species: 'howkey', playable: false },
        { key: 'octopus', species: 'maruimo' },
      ],
      excludedSpecies: ['maruimo'],
    },
    reason = (key, world) => classifyModel(key, world, rules);
  assert.deepEqual(reason('tree', true), {
    eligible: true,
    reason: 'active-world-catalog',
    publicCharacter: false,
  });
  assert.equal(reason('sleeping-mascot', true).reason, 'dormant-mascot-roster-entry');
  assert.equal(reason('grass', true).reason, 'decorative-groundcover-disabled');
  assert.deepEqual(reason('hero', false), {
    eligible: true,
    reason: 'public-player-character',
    publicCharacter: true,
  });
  assert.equal(reason('helper', false).reason, 'character-not-playable');
  assert.equal(reason('octopus', false).reason, 'excluded-from-public-release');
  assert.equal(reason('retired', false).reason, 'not-in-world-catalog-or-character-roster');
});

test('image headers report format, dimensions and alpha for PNG, JPEG and WebP', () => {
  const pick = ({ format, width, height, alpha }) => ({ format, width, height, alpha }),
    jpeg = Buffer.from([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00,
      0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xc2, 0x00, 0x11, 0x08, 0x00, 0x30, 0x00, 0x40, 0x03,
      0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01, 0xff, 0xd9,
    ]),
    vp8l = Buffer.alloc(5),
    vp8 = (width, height) => {
      const data = Buffer.alloc(10);
      data[3] = 0x9d;
      data[4] = 0x01;
      data[5] = 0x2a;
      data.writeUInt16LE(width, 6);
      data.writeUInt16LE(height, 8);
      return data;
    },
    vp8x = (width, height, flags) => {
      const data = Buffer.alloc(10);
      data[0] = flags;
      data.writeUIntLE(width - 1, 4, 3);
      data.writeUIntLE(height - 1, 7, 3);
      return data;
    };
  vp8l[0] = 0x2f;
  vp8l.writeUInt32LE(((5 - 1) | ((7 - 1) << 14) | (1 << 28)) >>> 0, 1);
  assert.deepEqual(pick(sniffImage(encodePng(3, 2, 4, () => [1, 2, 3, 4]))), {
    format: 'png',
    width: 3,
    height: 2,
    alpha: true,
  });
  assert.deepEqual(pick(sniffImage(pngHeader(2048, 2064))), {
    format: 'png',
    width: 2048,
    height: 2064,
    alpha: false,
  });
  assert.deepEqual(sniffImage(jpeg), {
    format: 'jpeg',
    width: 64,
    height: 48,
    alpha: false,
    jpeg: { components: 3, progressive: true },
  });
  assert.deepEqual(sniffImage(riff([['VP8L', vp8l]])), {
    format: 'webp',
    width: 5,
    height: 7,
    alpha: true,
    webp: { lossless: true, extended: false },
  });
  assert.deepEqual(
    pick(
      sniffImage(
        riff([
          ['VP8X', vp8x(300, 200, 0x10)],
          ['ALPH', Buffer.alloc(3)],
          ['VP8 ', vp8(300, 200)],
        ]),
      ),
    ),
    { format: 'webp', width: 300, height: 200, alpha: true },
  );
  assert.equal(sniffImage(riff([['VP8 ', vp8(10, 12)]])).webp.lossless, false);
  assert.throws(
    () =>
      sniffImage(
        riff([
          ['VP8X', vp8x(4, 4, 0x02)],
          ['ANIM', Buffer.alloc(6)],
        ]),
      ),
    /animated/,
  );
  assert.throws(() => sniffImage(Buffer.from('not an image')), /unrecognised/);
});

test('texture plans keep formats, never upscale and refuse mislabeled or ambiguous images', () => {
  assert.deepEqual(targetDimensions(2048, 2064, 1024), {
    width: 1016,
    height: 1024,
    resized: true,
  });
  assert.deepEqual(targetDimensions(1254, 1254, 1024), {
    width: 1024,
    height: 1024,
    resized: true,
  });
  assert.deepEqual(targetDimensions(2048, 2048, 512), { width: 512, height: 512, resized: true });
  assert.deepEqual(targetDimensions(512, 256, 1024), { width: 512, height: 256, resized: false });
  const doc = textureDocument(
      [
        { bytes: pngHeader(2048, 2064), mimeType: 'image/png' },
        { bytes: pngHeader(512, 256, 6), mimeType: 'image/png' },
      ],
      [{ source: 0 }, { source: 1 }],
      [
        {
          normalTexture: { index: 0 },
          pbrMetallicRoughness: { baseColorTexture: { index: 1 } },
          alphaMode: 'MASK',
        },
      ],
    ),
    plan = planTextures(doc.json, doc.bin, { label: 'probe', edge: 1024 });
  assert.equal(plan.images[0].treatment, 'normal');
  assert.equal(plan.images[0].filter, 'box-renormalized');
  assert.deepEqual(plan.images[0].target, { width: 1016, height: 1024 });
  assert.equal(plan.images[0].job.format, 'png', 'PNG stays PNG');
  assert.equal(plan.images[1].treatment, 'color-alpha');
  assert.equal(plan.images[1].job, null, 'images within the edge are never re-encoded');
  assert.equal(
    planTextures(doc.json, doc.bin, { label: 'probe', edge: 1024 }).images[0].job.key,
    plan.images[0].job.key,
  );
  assert.notEqual(
    planTextures(doc.json, doc.bin, { label: 'probe', edge: 512 }).images[0].job.key,
    plan.images[0].job.key,
  );
  assert.throws(
    () => planTextures(doc.json, doc.bin, { label: 'probe', edge: 2048 }),
    /must be 1024 or 512/,
  );
  const material = [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
    webpOnPng = textureDocument(
      [{ bytes: pngHeader(64, 64), mimeType: 'image/png' }],
      [{ extensions: { EXT_texture_webp: { source: 0 } } }],
      material,
    ),
    mislabeled = textureDocument(
      [{ bytes: pngHeader(64, 64), mimeType: 'image/jpeg' }],
      [{ source: 0 }],
      material,
    ),
    ambiguous = textureDocument(
      [{ bytes: pngHeader(64, 64), mimeType: 'image/png' }],
      [{ source: 0 }],
      [{ normalTexture: { index: 0 }, pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
    );
  assert.throws(
    () => planTextures(webpOnPng.json, webpOnPng.bin, { label: 'probe', edge: 1024 }),
    /EXT_texture_webp source 0 is not WebP/,
  );
  assert.throws(
    () => planTextures(mislabeled.json, mislabeled.bin, { label: 'probe', edge: 1024 }),
    /declared image\/jpeg but holds png/,
  );
  assert.throws(
    () => planTextures(ambiguous.json, ambiguous.bin, { label: 'probe', edge: 1024 }),
    /incompatible semantics/,
  );
});

test('per-treatment edges halve only normal and data maps, and each image is verified against its own edge', async () => {
  const maps512 = { color: 1024, normal: 512, data: 512 },
    pixels = (seed) => (x, y) => [x & 255, y & 255, seed],
    doc = textureDocument(
      [
        { bytes: encodePng(600, 600, 3, pixels(10)), mimeType: 'image/png' },
        { bytes: encodePng(800, 400, 3, pixels(20)), mimeType: 'image/png' },
        { bytes: encodePng(1100, 550, 3, pixels(30)), mimeType: 'image/png' },
      ],
      [{ source: 0 }, { source: 1 }, { source: 2 }],
      [
        {
          normalTexture: { index: 0 },
          pbrMetallicRoughness: {
            baseColorTexture: { index: 1 },
            metallicRoughnessTexture: { index: 2 },
          },
        },
      ],
    ),
    edges = textureEdges(maps512),
    plan = planTextures(doc.json, doc.bin, { label: 'probe', edge: edges });
  assert.deepEqual(
    plan.images.map((image) => [
      image.treatment,
      image.maximumEdge,
      image.target.width,
      image.target.height,
      image.resized,
    ]),
    [
      ['normal', 512, 512, 512, true],
      ['color-opaque', 1024, 800, 400, false],
      ['data', 512, 512, 256, true],
    ],
  );
  // One edge still applies to every image.
  assert.deepEqual(
    planTextures(doc.json, doc.bin, { label: 'probe', edge: 512 }).images.map(
      (image) => image.maximumEdge,
    ),
    [512, 512, 512],
  );
  assert.throws(() => textureEdges({ color: 1024, normal: 256, data: 512 }), /must be 1024 or 512/);
  assert.throws(
    () => textureEdges({ color: 1024, normal: 512 }),
    /one edge or \{ color, normal, data \}/,
  );

  // Stand-ins for the worker's output at a given size (the worker is tested with Pillow below).
  const source = parseGlb(doc.glb, 'probe'),
    derive = async (sizes = {}) => {
      const outputs = new Map(
          plan.images
            .filter((image) => image.job)
            .map((image) => {
              const { width, height } = sizes[image.index] ?? image.target;
              return [image.job.key, encodePng(width, height, 3, pixels(image.index + 40))];
            }),
        ),
        textured = applyTextures(doc.json, doc.bin, plan.images, outputs, 'probe'),
        packed = await compressViews(textured.json, textured.bin, 'probe');
      return {
        output: parseGlb(packGlb(packed.json, packed.bin), 'probe output'),
        textures: textured.images,
      };
    },
    good = await derive(),
    verify = (candidate, textures, options = {}) =>
      verifyDerived({
        source,
        output: candidate.output,
        textures,
        edge: 1024,
        edges,
        label: 'probe',
        ...options,
      }),
    edit = (index, change) =>
      good.textures.map((image) => (image.index === index ? { ...image, ...change } : image));
  const verification = await verify(good, good.textures);
  assert.deepEqual(verification.textureEdges, maps512);
  assert.deepEqual([verification.imagesResized, verification.imagesUnchanged], [2, 1]);
  // Records written before per-image edges keep the single-edge check and its exact result.
  const legacy = await verifyDerived({
    source,
    output: good.output,
    textures: good.textures,
    edge: 1024,
    label: 'probe',
  });
  assert.equal(Object.hasOwn(legacy, 'textureEdges'), false);
  await assert.rejects(
    verify(good, edit(0, { maximumEdge: 1024 })),
    /maximum edge 1024 is not the 512 the policy gives normal images/,
  );
  await assert.rejects(
    verify(good, edit(2, { treatment: 'color-opaque' })),
    /recorded as color-opaque, but the source samples it as data/,
  );
  await assert.rejects(
    verify(good, edit(1, { source: { ...good.textures[1].source, sha256: '0'.repeat(64) } })),
    /the recorded source differs from the original image/,
  );
  // The colour map kept at 1024 is outside an all-512 policy; the file maximum must be the largest edge.
  await assert.rejects(
    verify(good, good.textures, { edge: 512, edges: textureEdges(512) }),
    /maximum edge 1024 is not the 512 the policy gives color-opaque images/,
  );
  await assert.rejects(
    verify(good, good.textures, { edge: 512 }),
    /not the largest of the texture edges/,
  );
  // Smaller than planned passes a bare edge check, but it is not the planned resize.
  const shrunk = await derive({ 0: { width: 256, height: 256 } });
  await assert.rejects(
    verify(shrunk, shrunk.textures),
    /256x256 is not the planned 512x512 at edge 512/,
  );
});

test('the runtime index adds per-file edges, base and scope only for manifests that record them', () => {
  const record = {
      role: 'model',
      uses: [{ modelKey: 'tent', role: 'model', lodIndex: null }],
      source: { url: '/models/tent/model.glb', sha256: 'a'.repeat(64), bytes: 10 },
      output: {
        url: `/models/tent/model.opt-${'b'.repeat(16)}.glb`,
        sha256: 'b'.repeat(64),
        bytes: 8,
        maximumTextureEdge: 1024,
        extensionsRequired: [MESHOPT],
      },
    },
    legacy = runtimeIndexOf({ revision: 'r04', files: [record], images: [] });
  assert.equal(Object.hasOwn(legacy, 'base'), false);
  assert.equal(Object.hasOwn(legacy, 'scope'), false);
  assert.equal(Object.hasOwn(legacy.files['/models/tent/model.glb'], 'textureEdges'), false);
  const edges = { color: 1024, normal: 512, data: 512 },
    index = runtimeIndexOf({
      revision: 'r05',
      scope: { complete: false, only: ['tent'] },
      base: {
        adoption: 'r04-a01',
        planSha256: 'c'.repeat(64),
        candidateRevision: { directory: 'assets/optimized-runtime/r04' },
      },
      files: [{ ...record, output: { ...record.output, textureEdges: edges } }],
      images: [],
    });
  assert.deepEqual(index.base, {
    adoption: 'r04-a01',
    planSha256: 'c'.repeat(64),
    candidateRevision: 'assets/optimized-runtime/r04',
  });
  assert.deepEqual(index.scope, { complete: false, only: ['tent'] });
  assert.deepEqual(index.files['/models/tent/model.glb'].textureEdges, edges);
});

// A miniature camp-cave configuration in a temporary root: both manifests, the runtime files the
// plan is read from (syntax only) and real PNGs.
const caveLayoutText = ({
  atlasSize = '[600, 600]',
  friezeUrl = "'/models/camp-cave/frieze-a.png'",
  extra = '',
} = {}) => `
export const CAVE_MOTIFS = {
  friezeA: [0, 0, 600, 200],
  comingSoon: [0, 0, 2048, 512],
  bison: [10, 10, 300, 200],
  deer: [304, 10, 590, 200],
} as const;
export const CAVE_EXTRA_PIGMENTS = {
  friezeA: { url: ${friezeUrl}, subjects: ['someone'] },${extra}
} as const;
export const caveMuralShader = CAVE_MURALS.map((m) => {
  const [x0, y0, x1, y1] = CAVE_MOTIFS[m.motif];
  const extra = m.motif in CAVE_EXTRA_PIGMENTS || m.motif === 'comingSoon';
  const [imageWidth, imageHeight] =
    extra || m.motif === 'creature524' ? [x1, y1] : m.motif === 'rimoFrieze' ? [2172, 724] : ${atlasSize};
  return '';
});
`;
const CAVE_LOADER_TEXT = Object.freeze({
  'src/loading-cave.ts':
    'const all = [load(template.asset.pigment.url), load(template.asset.rockSurface.url), ...Object.values(CAVE_EXTRA_PIGMENTS).map((p) => load(p.url))];',
  'src/world-landmarks.ts':
    'load(template.asset.rockSurface.url);\nload(template.asset.pigment.url);\nfor (const [key, p] of Object.entries(CAVE_EXTRA_PIGMENTS)) load(p.url);',
});
const caveImages = () => ({
  'mural-atlas.png': encodePng(600, 600, 4, (x, y) => [x & 255, y & 255, 40, x < 300 ? 255 : 0]),
  'limestone.png': encodePng(600, 600, 3, (x) => [200, 190 + (x % 7), 180]),
  'frieze-a.png': encodePng(600, 200, 4, (x, y) => [120, 60, 30, (x + y) % 3 ? 255 : 0]),
  'old-mural.png': encodePng(8, 8, 3, () => [1, 2, 3]),
  'unconfigured.png': encodePng(700, 700, 3, () => [9, 9, 9]),
});
const caveRecord = (images, name) => {
  const info = sniffImage(images[name]);
  return {
    url: `/models/camp-cave/${name}`,
    sha256: sha256(images[name]),
    bytes: images[name].length,
    image: { width: info.width, height: info.height },
  };
};
const caveAsset = (images) => ({
  modelKey: 'camp-cave',
  pigment: {
    ...caveRecord(images, 'mural-atlas.png'),
    previous: { url: '/models/camp-cave/old-mural.png', sha256: sha256(images['old-mural.png']) },
  },
  rockSurface: caveRecord(images, 'limestone.png'),
  mascotPigments: { friezeA: caveRecord(images, 'frieze-a.png') },
});
async function writeCaveFixture(
  root,
  {
    images = caveImages(),
    asset = caveAsset(images),
    catalogAsset = asset,
    layout = caveLayoutText(),
    loaders = CAVE_LOADER_TEXT,
  } = {},
) {
  const write = async (relative, data) => {
    const file = path.join(root, ...relative.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, data);
  };
  for (const [name, bytes] of Object.entries(images))
    await write(`public/models/camp-cave/${name}`, bytes);
  await write('public/models/camp-cave/asset.json', JSON.stringify(asset));
  await write('public/models/world-assets.json', JSON.stringify({ assets: [catalogAsset] }));
  await write('src/cave-gallery-layout.ts', layout);
  for (const [relative, text] of Object.entries(loaders)) await write(relative, text);
}
const caveContext = (overrides = {}) => ({
  inventory: {
    models: [{ modelKey: 'camp-cave', eligible: true, reason: 'active-world-catalog' }],
  },
  rules: {
    characterModels: [{ key: 'octopus', species: 'maruimo' }],
    excludedSpecies: ['maruimo'],
  },
  edges: new Map([['camp-cave', 512]]),
  ...overrides,
});

test('standalone cave textures come only from configured, audited runtime entries, with UVs kept normalised', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cro-cave-'));
  try {
    await writeCaveFixture(root);
    const plan = await planStandaloneImages(root, caveContext()),
      [atlas, limestone, frieze] = plan.images;
    assert.deepEqual(
      plan.images.map((item) => item.id),
      [
        'image:/models/camp-cave/mural-atlas.png',
        'image:/models/camp-cave/limestone.png',
        'image:/models/camp-cave/frieze-a.png',
      ],
      'an unconfigured PNG in the folder is never planned',
    );
    assert.deepEqual(plan.skipped, [
      {
        entry: 'pigment.previous',
        url: '/models/camp-cave/old-mural.png',
        reason: 'declared in the manifest but not loaded by the runtime',
      },
    ]);
    assert.deepEqual(
      plan.images.map(({ plan: p }) => [
        p.target.width,
        p.target.height,
        p.treatment,
        p.wrap,
        p.resized,
      ]),
      [
        [512, 512, 'color-alpha', 'clamp', true],
        [512, 512, 'color-opaque', 'repeat', true],
        [512, 171, 'color-alpha', 'clamp', true],
      ],
    );
    assert.equal(limestone.job.wrap, 'repeat');
    assert.equal(
      'wrap' in atlas.job,
      false,
      'clamp-to-edge jobs keep the embedded-texture job shape',
    );
    assert.equal(frieze.plan.manifestEntry, 'mascotPigments.friezeA');
    assert.equal(frieze.plan.runtimeEntry, 'CAVE_EXTRA_PIGMENTS.friezeA.url');
    assert.deepEqual(atlas.plan.configuredBy, [
      'src/loading-cave.ts template.asset.pigment.url',
      'src/world-landmarks.ts template.asset.pigment.url',
    ]);
    // Rectangles are normalised by the source size, and the candidate keeps those coordinates.
    const bison = atlas.plan.uv.motifs.find((motif) => motif.motif === 'bison');
    assert.deepEqual(atlas.plan.uv.normalizedBy, { width: 600, height: 600 });
    assert.deepEqual(bison.normalized, [10 / 600, 10 / 600, 300 / 600, 200 / 600]);
    bison.candidatePixels.forEach((value, i) =>
      assert.ok(Math.abs(value / 512 - bison.normalized[i]) < 1e-12),
    );
    // The trap: old pixel rectangles over the smaller candidate would shift and crop the art.
    assert.ok(Math.abs(bison.rect[2] / 512 - bison.normalized[2]) > 0.08);
    assert.ok(Math.abs(bison.nearestOtherMotifSourcePixels - 4) < 1e-9);
    assert.ok(Math.abs(bison.nearestOtherMotifCandidatePixels - (4 * 512) / 600) < 1e-9);
    assert.deepEqual(
      frieze.plan.uv.motifs.map(({ motif, nearestOtherMotifSourcePixels }) => [
        motif,
        nearestOtherMotifSourcePixels,
      ]),
      [['friezeA', null]],
    );
    assert.ok(atlas.risks.some((risk) => /others sit as close as 4\.0 source px/.test(risk)));
    assert.ok(limestone.risks.some((risk) => /tile seams/.test(risk)));
    assert.ok(frieze.risks.some((risk) => /premultiplied alpha/.test(risk)));
    // Owners that are not eligible or not selected contribute nothing; an excluded owner is an error.
    const ineligible = caveContext({
      inventory: { models: [{ modelKey: 'camp-cave', eligible: false, reason: 'probe' }] },
    });
    assert.deepEqual((await planStandaloneImages(root, ineligible)).images, []);
    assert.deepEqual(
      (await planStandaloneImages(root, caveContext({ edges: new Map() }))).images,
      [],
    );
    await assert.rejects(
      planStandaloneImages(
        root,
        caveContext({
          rules: {
            characterModels: [{ key: 'camp-cave', species: 'maruimo' }],
            excludedSpecies: ['maruimo'],
          },
        }),
      ),
      /camp-cave belongs to an excluded character/,
    );
    const images = caveImages(),
      asset = caveAsset(images),
      outside = {
        ...asset,
        mascotPigments: {
          friezeA: { ...asset.mascotPigments.friezeA, url: '/models/octopus/frieze-a.png' },
        },
      };
    for (const [variant, pattern] of [
      [
        { images: { ...images, 'limestone.png': encodePng(600, 600, 3, () => [1, 1, 1]) }, asset },
        /limestone\.png: .*(bytes on disk|does not match the manifest)/,
      ],
      [
        { layout: caveLayoutText({ friezeUrl: "'/models/camp-cave/unconfigured.png'" }) },
        /CAVE_EXTRA_PIGMENTS\.friezeA loads \/models\/camp-cave\/unconfigured\.png, the manifest audits/,
      ],
      [
        {
          layout: caveLayoutText({
            extra: "\n  friezeB: { url: '/models/camp-cave/unconfigured.png', subjects: [] },",
          }),
        },
        /CAVE_EXTRA_PIGMENTS \(friezeA, friezeB\) and .* mascotPigments \(friezeA\) differ/,
      ],
      [
        { layout: caveLayoutText({ friezeUrl: "'/models/camp-cave/' + 'frieze-a.png'" }) },
        /is not a literal/,
      ],
      [
        { layout: caveLayoutText({ atlasSize: '[700, 700]' }) },
        /is normalised by 700x700 but \/models\/camp-cave\/mural-atlas\.png is 600x600/,
      ],
      [{ layout: caveLayoutText({ atlasSize: 'atlasSize()' }) }, /atlas size is not a literal/],
      [
        {
          catalogAsset: { ...asset, rockSurface: { ...asset.rockSurface, sha256: '0'.repeat(64) } },
        },
        /disagree on rockSurface/,
      ],
      [
        {
          asset: outside,
          catalogAsset: outside,
          layout: caveLayoutText({ friezeUrl: "'/models/octopus/frieze-a.png'" }),
        },
        /outside \/models\/camp-cave\//,
      ],
      [
        {
          loaders: {
            ...CAVE_LOADER_TEXT,
            'src/world-landmarks.ts':
              'load(template.asset.rockSurface.url);\nload(template.asset.pigment.url);',
          },
        },
        /world-landmarks\.ts does not load every CAVE_EXTRA_PIGMENTS entry/,
      ],
      [
        {
          loaders: {
            ...CAVE_LOADER_TEXT,
            'src/world-landmarks.ts':
              'load(template.asset.pigment.url);\nObject.entries(CAVE_EXTRA_PIGMENTS);',
          },
        },
        /world-landmarks\.ts loads cave textures pigment, src\/loading-cave\.ts pigment, rockSurface/,
      ],
    ]) {
      await writeCaveFixture(root, variant);
      await assert.rejects(planStandaloneImages(root, caveContext()), pattern, String(pattern));
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// The verified loader (loadCaveTextures → caveImageRecords → caveMuralImages) in miniature, in
// the shape of src/verified-texture.ts today: the settings are built inside the map callback,
// from a `const repeat`.
const VERIFIED_SETTINGS = `    const repeat = key === 'rockSurface';
    const settings = { colorSpace: THREE.SRGBColorSpace, anisotropy, repeat };`;
const verifiedTextureModule = (settings = VERIFIED_SETTINGS) => `
export function caveImageRecords(asset): Record<CaveTextureKey, VerifiedImageRecord> {
  const murals = caveMuralImages(asset);
  const rock: CaveImageRecord = asset?.rockSurface;
  return { pigment: murals.pigment, rockSurface: rock, ...murals.extras };
}
export function loadCaveTextures(asset, anisotropy: number, options: VerifiedTextureOptions = {}) {
  const records = caveImageRecords(asset);
  const entries = (Object.keys(records) as CaveTextureKey[]).map((key) => {
${settings}
    return [key, records[key], settings] as const;
  });
  return new VerifiedTextureBatch(entries, options);
}
`;
const VERIFIED_CAVE_LOADERS = Object.freeze({
  'src/loading-cave.ts':
    'const images = (this.images = loadCaveTextures(template.asset, anisotropy, this.imageOptions));',
  'src/world-landmarks.ts':
    'images = loadCaveTextures(template.asset, anisotropy, this.imageOptions);',
  'src/verified-texture.ts': verifiedTextureModule(),
});
const VERIFIED_CAVE_LAYOUT = `${caveLayoutText()}
export function caveMuralImages(asset) {
  const extras = {};
  for (const key of Object.keys(CAVE_EXTRA_PIGMENTS)) extras[key] = asset?.mascotPigments?.[key];
  return { pigment: asset?.pigment, extras };
}
`;

test('the verified cave loader plans the same images, sizes and UVs as the direct reads it replaced', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cro-cave-'));
  try {
    await writeCaveFixture(root);
    const direct = await planStandaloneImages(root, caveContext());
    await writeCaveFixture(root, { layout: VERIFIED_CAVE_LAYOUT, loaders: VERIFIED_CAVE_LOADERS });
    const verified = await planStandaloneImages(root, caveContext()),
      // Only the description of where the runtime reads each record may differ.
      derivation = ({ runtimeEntry, configuredBy, ...rest }) => rest;
    assert.deepEqual(
      verified.images.map((item) => item.id),
      direct.images.map((item) => item.id),
    );
    verified.images.forEach((item, index) => {
      assert.deepEqual(derivation(item.plan), derivation(direct.images[index].plan), item.id);
      assert.deepEqual(item.job, direct.images[index].job, item.id);
    });
    const [atlas, limestone, frieze] = verified.images;
    assert.equal(atlas.plan.runtimeEntry, 'caveImageRecords(template.asset).pigment');
    assert.ok(
      limestone.plan.configuredBy.includes(
        'src/verified-texture.ts caveImageRecords asset.rockSurface',
      ),
    );
    assert.equal(limestone.plan.wrap, 'repeat');
    assert.equal(frieze.plan.manifestEntry, 'mascotPigments.friezeA');
    assert.ok(verified.inputs.some((input) => input.path === 'src/verified-texture.ts'));
    // The earlier inline form of the same settings plans identically.
    await writeCaveFixture(root, {
      layout: VERIFIED_CAVE_LAYOUT,
      loaders: {
        ...VERIFIED_CAVE_LOADERS,
        'src/verified-texture.ts': verifiedTextureModule(
          "    const settings = { colorSpace: THREE.SRGBColorSpace, anisotropy, repeat: key === 'rockSurface' };",
        ),
      },
    });
    assert.deepEqual(
      (await planStandaloneImages(root, caveContext())).images.map((item) => item.plan),
      verified.images.map((item) => item.plan),
    );
    // Settings and image selection the syntax cannot pin down fail closed.
    const settingsVariant = (from, to) => ({
      'src/verified-texture.ts': verifiedTextureModule(VERIFIED_SETTINGS.replace(from, to)),
    });
    for (const [variant, pattern] of [
      [
        settingsVariant("key === 'rockSurface';", "key === 'rockSurface' || key === 'pigment';"),
        /repeats pigment, rockSurface, the plan repeats rockSurface/,
      ],
      [settingsVariant('const repeat', 'let repeat'), /repeat is not one const of the callback/],
      [
        settingsVariant("key === 'rockSurface';", 'REPEATED.has(key);'),
        /repeat is not a literal test of the record key \(REPEATED\.has\(key\)\)/,
      ],
      [
        settingsVariant('anisotropy, repeat }', 'anisotropy, repeat, ...extra }'),
        /settings hold \.\.\.extra/,
      ],
      [
        settingsVariant('anisotropy, repeat }', 'anisotropy, repeat, flipY: false }'),
        /settings hold flipY: false/,
      ],
      [
        settingsVariant('THREE.SRGBColorSpace', 'THREE.LinearSRGBColorSpace'),
        /colorSpace is THREE\.LinearSRGBColorSpace, not THREE\.SRGBColorSpace/,
      ],
      [
        settingsVariant(
          '{ colorSpace: THREE.SRGBColorSpace, anisotropy, repeat }',
          '{ anisotropy, repeat }',
        ),
        /not one object literal with a colorSpace/,
      ],
      [
        {
          'src/verified-texture.ts': verifiedTextureModule().replace(
            'asset?.rockSurface',
            "pick(asset, 'rockSurface')",
          ),
        },
        /caveImageRecords: the cave asset is used indirectly/,
      ],
    ]) {
      await writeCaveFixture(root, {
        layout: VERIFIED_CAVE_LAYOUT,
        loaders: { ...VERIFIED_CAVE_LOADERS, ...variant },
      });
      await assert.rejects(planStandaloneImages(root, caveContext()), pattern, String(pattern));
    }
    await writeCaveFixture(root, {
      layout: VERIFIED_CAVE_LAYOUT.replace('?.[key]', "?.['frieze' + 'A']"),
      loaders: VERIFIED_CAVE_LOADERS,
    });
    await assert.rejects(
      planStandaloneImages(root, caveContext()),
      /caveMuralImages: mascotPigments is read with a computed key/,
    );
    for (const [variant, pattern] of [
      [
        {
          'src/verified-texture.ts': VERIFIED_CAVE_LOADERS['src/verified-texture.ts'].replace(
            "key === 'rockSurface'",
            "key === 'pigment'",
          ),
        },
        /repeats pigment, the plan repeats rockSurface/,
      ],
      [{ 'src/world-landmarks.ts': 'load(template.asset.pigment.url);' }, /loads cave textures/],
      [
        {
          'src/verified-texture.ts': VERIFIED_CAVE_LOADERS['src/verified-texture.ts'].replace(
            'caveMuralImages(asset)',
            '{}',
          ),
        },
        /does not take the murals from caveMuralImages/,
      ],
    ]) {
      await writeCaveFixture(root, {
        layout: VERIFIED_CAVE_LAYOUT,
        loaders: { ...VERIFIED_CAVE_LOADERS, ...variant },
      });
      await assert.rejects(planStandaloneImages(root, caveContext()), pattern, String(pattern));
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a standalone texture candidate must be exactly the planned whole-image resize of its original', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cro-cave-'));
  try {
    await writeCaveFixture(root);
    const frieze = (await planStandaloneImages(root, caveContext())).images[2],
      source = caveImages()['frieze-a.png'],
      draw = (width, height, channels) =>
        encodePng(width, height, channels, (x, y) => [120, 60, 30, (x + y) % 3 ? 255 : 0]),
      outputOf = (bytes) => {
        const info = sniffImage(bytes),
          sha = sha256(bytes);
        return {
          ...imageCandidateLocation(frieze.plan.source.url, sha),
          sha256: sha,
          bytes: bytes.length,
          format: info.format,
          mimeType: 'image/png',
          width: info.width,
          height: info.height,
          alpha: info.alpha,
          maximumTextureEdge: 512,
        };
      },
      candidate = draw(512, 171, 4),
      output = outputOf(candidate),
      verify = (overrides) =>
        verifyStandaloneImage({
          source,
          candidate,
          plan: frieze.plan,
          output,
          label: 'frieze',
          ...overrides,
        });
    assert.match(output.file, /^models\/camp-cave\/frieze-a\.opt-[0-9a-f]{16}\.png$/);
    const verification = verify({});
    assert.equal(verification.status, 'passed');
    assert.ok(verification.aspectError < 0.002, 'only pixel rounding moves the aspect ratio');
    for (const [bytes, pattern] of [
      [draw(512, 170, 4), /differs from the planned 512x171/],
      [draw(512, 171, 3), /alpha/],
      [draw(600, 200, 4), /exceeds 512/],
    ])
      assert.throws(
        () => verify({ candidate: bytes, output: outputOf(bytes) }),
        pattern,
        String(pattern),
      );
    assert.throws(
      () => verify({ output: { ...output, sha256: '0'.repeat(64) } }),
      /candidate differs from the recorded SHA-256/,
    );
    assert.throws(() => verify({ source: caveImages()['limestone.png'] }), /original differs/);
    // The typed runtime-index record: verified loading, UVs normalised by the source size.
    const record = {
        id: frieze.id,
        role: 'standalone-texture',
        plan: frieze.plan,
        output,
        verification,
        status: 'candidate-pending-visual-qa',
      },
      index = runtimeIndexOf({
        revision: 'probe',
        files: [],
        images: [record, { ...record, id: 'kept', output: null }],
      });
    assert.deepEqual(index.textures, {
      '/models/camp-cave/frieze-a.png': {
        owner: 'camp-cave',
        manifestEntry: 'mascotPigments.friezeA',
        sourceSha256: frieze.plan.source.sha256,
        sourceBytes: frieze.plan.source.bytes,
        url: output.url,
        sha256: output.sha256,
        bytes: output.bytes,
        mimeType: 'image/png',
        width: 512,
        height: 171,
        uvSource: { width: 600, height: 200 },
        alpha: true,
        colorSpace: 'srgb',
        wrap: 'clamp-to-edge',
      },
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// The real configuration, read-only and hash-checked: exactly the ten images the cave loads.
// Once an adoption is applied, the manifests name the candidates. The sources then come from that
// adoption's saved pre-apply bytes, never from the rewritten records.
/** The adoption whose before/ holds the pre-adoption manifests: `id` itself, or for a chained
 * adoption (`plan.base`) its base, followed by the plan hashes each chain recorded. */
async function preAdoptionRecord(id) {
  const plan = JSON.parse(
    await readFile(path.join(REPO_ROOT, 'assets', 'runtime-adoption', id, 'plan.json'), 'utf8'),
  );
  if (!plan.base) return id;
  const bytes = await readFile(
    path.join(REPO_ROOT, 'assets', 'runtime-adoption', plan.base.adoption, 'plan.json'),
  );
  assert.equal(sha256(bytes), plan.base.planSha256, `${id}: its recorded base plan`);
  return preAdoptionRecord(plan.base.adoption);
}

test('the current camp-cave plan covers the ten runtime textures with their audited hashes and source UV sizes', async (t) => {
  const current = JSON.parse(
      await readFile(path.join(REPO_ROOT, 'public', 'models', 'camp-cave', 'asset.json'), 'utf8'),
    ),
    stamped = current.pigment?.provenance?.runtimeOptimization?.adoption,
    // Once adopted, the originals are the saved pre-adoption manifests (a chain's base's).
    adoption = stamped ? await preAdoptionRecord(stamped) : undefined,
    readManifest = adoption
      ? (relative) =>
          readFile(
            path.join(
              REPO_ROOT,
              'assets',
              'runtime-adoption',
              adoption,
              'before',
              ...relative.split('/'),
            ),
          )
      : undefined,
    rules = await loadEligibilityRules(REPO_ROOT),
    inventory = await buildInventory(REPO_ROOT, rules),
    plan = await planStandaloneImages(REPO_ROOT, {
      inventory,
      rules,
      edges: new Map([['camp-cave', 1024]]),
      ...(readManifest ? { readManifest } : {}),
    }),
    asset = readManifest
      ? JSON.parse(await readManifest('public/models/camp-cave/asset.json'))
      : current,
    audited = [
      ...['pigment', 'rockSurface', 'characterPigment', 'rimoPigment'].map((key) => asset[key]),
      ...Object.values(asset.mascotPigments),
    ];
  assert.equal(plan.owner.eligible, true);
  // Today's runtime loads them through the verified loader, read from its actual syntax.
  assert.ok(plan.inputs.some((input) => input.path === 'src/verified-texture.ts'));
  for (const item of plan.images)
    assert.match(item.plan.runtimeEntry, /^caveImageRecords\(template\.asset\)\.\w+$/, item.id);
  assert.deepEqual(
    plan.images.map((item) => item.plan.source.url).sort(),
    audited.map((record) => record.url).sort(),
  );
  assert.equal(plan.images.length, 10);
  for (const item of plan.images) {
    const record = audited.find((candidate) => candidate.url === item.plan.source.url),
      { width, height } = record.image;
    assert.equal(item.plan.source.sha256, record.sha256, item.id);
    assert.equal(item.plan.source.bytes, record.bytes, item.id);
    assert.deepEqual(item.plan.uv.normalizedBy, { width, height }, `${item.id} UV source size`);
    assert.ok(item.job, `${item.id} exceeds 1024 px`);
    assert.deepEqual(
      item.plan.target,
      width === height ? { width: 1024, height: 1024 } : { width: 1024, height: 341 },
    );
    assert.equal(
      item.plan.wrap,
      item.plan.manifestEntry === 'rockSurface' ? 'repeat' : 'clamp',
      item.id,
    );
    assert.ok(
      item.plan.source.url.startsWith('/models/camp-cave/'),
      'no file from another model folder',
    );
  }
  assert.deepEqual(
    plan.skipped.map((entry) => entry.url),
    ['/models/camp-cave/mural-side-r04.png'],
  );
  const atlas = plan.images.find((item) => item.plan.manifestEntry === 'pigment'),
    gapOf = (name) =>
      atlas.plan.uv.motifs.find((motif) => motif.motif === name).nearestOtherMotifSourcePixels;
  assert.deepEqual(atlas.plan.uv.motifs.map((motif) => motif.motif).sort(), [
    'bison',
    'deer',
    'hands',
    'mammoth',
    'ochreHorse',
    'redHorse',
    'signs',
  ]);
  // The original layout: ochreHorse and mammoth already overlap; redHorse and deer are 3 px apart.
  assert.deepEqual(
    [gapOf('ochreHorse'), gapOf('mammoth'), gapOf('redHorse'), gapOf('deer')],
    [0, 0, 3, 3],
  );
  assert.ok(
    atlas.risks.some(
      (risk) =>
        /ochreHorse, mammoth overlap a neighbour/.test(risk) &&
        /as close as 3\.0 source px/.test(risk),
    ),
  );
  t.diagnostic(
    JSON.stringify(
      plan.images.map(({ plan: p }) => ({
        url: p.source.url,
        source: [p.source.width, p.source.height, p.source.bytes],
        target: [p.target.width, p.target.height],
        wrap: p.wrap,
        tightestMotifGap: Math.min(
          ...p.uv.motifs.map((motif) => motif.nearestOtherMotifCandidatePixels ?? Infinity),
        ),
      })),
    ),
  );
});

test(
  'Pillow worker downsizes without upscaling and keeps format, alpha and normal direction',
  {
    skip: process.env.OPTIMIZATION_PYTHON
      ? false
      : 'set OPTIMIZATION_PYTHON to a Python with Pillow to run',
  },
  async () => {
    const work = await mkdtemp(path.join(os.tmpdir(), 'cro-texture-'));
    try {
      const tilted = [191, 128, 238],
        flat = [128, 128, 255],
        doc = textureDocument(
          [
            {
              bytes: encodePng(1024, 1024, 3, (x, y) => (x < 512 || (x + y) % 2 ? tilted : flat)),
              mimeType: 'image/png',
            },
            {
              bytes: encodePng(1030, 600, 4, (x, y) => [x & 255, y & 255, 90, (x * 7) & 255]),
              mimeType: 'image/png',
            },
          ],
          [{ source: 0 }, { source: 1 }],
          [
            {
              normalTexture: { index: 0 },
              pbrMetallicRoughness: { baseColorTexture: { index: 1 } },
              alphaMode: 'MASK',
            },
          ],
        ),
        plan = planTextures(doc.json, doc.bin, { label: 'probe', edge: 512 });
      for (const image of plan.images)
        await stageTextureInput(
          work,
          image.job,
          storedViewBytes(doc.json, doc.bin, image.bufferView),
        );
      const run = await runTextureJobs(
          plan.images.map((image) => image.job),
          { python: process.env.OPTIMIZATION_PYTHON, workDir: work },
        ),
        textured = applyTextures(doc.json, doc.bin, plan.images, run.outputs, 'probe');
      assert.deepEqual(
        textured.images.map((image) => [image.output.width, image.output.height]),
        [
          [512, 512],
          [512, 298],
        ],
      );
      const normal = decodePng(run.outputs.get(plan.images[0].job.key)),
        colour = decodePng(run.outputs.get(plan.images[1].job.key)),
        unit = (value) => value / 127.5 - 1,
        pixelAt = (x, y) => [...normal.pixels.subarray((y * 512 + x) * 3, (y * 512 + x) * 3 + 3)];
      assert.equal(normal.channels, 3);
      assert.equal(colour.channels, 4, 'alpha channel kept');
      for (let y = 0; y < 512; y += 37)
        for (let x = 0; x < 256; x += 29) assert.deepEqual(pixelAt(x, y), tilted);
      const mean = [0, 1, 2].map((c) => unit(tilted[c]) + unit(flat[c])),
        meanLength = Math.hypot(...mean);
      for (let y = 0; y < 512; y += 41)
        for (let x = 256; x < 512; x += 23) {
          const vector = pixelAt(x, y).map(unit),
            length = Math.hypot(...vector),
            cosine = vector.reduce(
              (sum, value, c) => sum + (value * mean[c]) / (length * meanLength),
              0,
            );
          assert.ok(Math.abs(length - 1) < 0.02, `renormalized at ${x},${y}`);
          assert.ok(cosine > Math.cos((1 * Math.PI) / 180), `mean direction kept at ${x},${y}`);
        }
      const verification = await verifyDerived({
        source: parseGlb(doc.glb, 'probe'),
        output: parseGlb(packGlb(textured.json, textured.bin), 'probe output'),
        textures: textured.images,
        edge: 512,
        label: 'probe',
      });
      assert.equal(verification.imagesResized, 2);
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  },
);

test(
  'Pillow worker resizes standalone textures as they are sampled: premultiplied alpha, repeat-wrapped edges',
  {
    skip: process.env.OPTIMIZATION_PYTHON
      ? false
      : 'set OPTIMIZATION_PYTHON to a Python with Pillow to run',
  },
  async () => {
    const work = await mkdtemp(path.join(os.tmpdir(), 'cro-standalone-'));
    try {
      // Only the last column is light: a repeat-wrapped resize must see it next to column 0.
      const tile = encodePng(600, 600, 3, (x) => (x === 599 ? [230, 230, 230] : [20, 20, 20])),
        // Opaque red beside fully transparent green: the hidden green must not tint the edge.
        frieze = encodePng(600, 200, 4, (x) => (x < 300 ? [255, 0, 0, 255] : [0, 255, 0, 0])),
        jobOf = (bytes, target, treatment, wrap) =>
          resizeJob(sniffImage(bytes), sourceSummary(sniffImage(bytes), bytes), target, {
            treatment,
            colorFilter: 'lanczos',
            webpQuality: 90,
            wrap,
          }),
        jobs = [
          jobOf(tile, { width: 512, height: 512 }, 'color-opaque', 'repeat'),
          jobOf(tile, { width: 512, height: 512 }, 'color-opaque', 'clamp'),
          jobOf(frieze, { width: 512, height: 171 }, 'color-alpha', 'clamp'),
        ];
      assert.notEqual(jobs[0].key, jobs[1].key, 'the wrap mode is part of the job identity');
      await stageTextureInput(work, jobs[0], tile);
      await stageTextureInput(work, jobs[1], tile);
      await stageTextureInput(work, jobs[2], frieze);
      const run = await runTextureJobs(jobs, {
          python: process.env.OPTIMIZATION_PYTHON,
          workDir: work,
        }),
        [wrapped, clamped, resized] = jobs.map((job) => decodePng(run.outputs.get(job.key))),
        pixel = (image, x, y) => [
          ...image.pixels.subarray(
            (y * image.width + x) * image.channels,
            (y * image.width + x + 1) * image.channels,
          ),
        ];
      assert.deepEqual(
        [wrapped.width, wrapped.height, resized.width, resized.height],
        [512, 512, 512, 171],
      );
      assert.ok(
        pixel(wrapped, 0, 200)[0] >= pixel(clamped, 0, 200)[0] + 6,
        'repeat wrap filters across the opposite edge',
      );
      assert.equal(pixel(clamped, 0, 200)[0], 20, 'clamp-to-edge sees only its own side');
      for (let y = 0; y < 171; y += 17)
        for (let x = 240; x < 272; x++) {
          const [r, g, , a] = pixel(resized, x, y);
          if (a >= 32)
            assert.ok(g <= 8 && r >= 200, `premultiplied edge at ${x},${y}: ${[r, g, a]}`);
        }
      const plan = {
          edge: 512,
          source: {
            url: '/models/camp-cave/probe.png',
            mimeType: 'image/png',
            format: 'png',
            ...sourceSummary(sniffImage(frieze), frieze),
          },
        },
        bytes = run.outputs.get(jobs[2].key),
        verification = verifyStandaloneImage({
          source: frieze,
          candidate: bytes,
          plan,
          output: {
            sha256: sha256(bytes),
            bytes: bytes.length,
            mimeType: 'image/png',
            width: 512,
            height: 171,
            alpha: true,
          },
          label: 'probe',
        });
      assert.equal(verification.status, 'passed');
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  },
);
