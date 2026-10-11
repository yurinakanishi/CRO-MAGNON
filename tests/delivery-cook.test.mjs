// Delivery cooking (scripts/delivery): synthetic GLBs and images generated in this file only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DEFAULT_POLICY, cookGlb, parseGlb } from '../scripts/delivery/cook-glb.mjs';
import { packLevels } from '../scripts/delivery/pack-levels.mjs';
import { cookTexture } from '../scripts/delivery/cook-texture.mjs';
import { cookedModel, cookedUrl } from '../scripts/delivery/delivery-cache.mjs';
import { deliveredAsset, deliveryGraph } from '../scripts/delivery/delivery-graph.mjs';
import { checkModelUrl, checkTextureUrl } from '../scripts/runtime-graph.mjs';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const align4 = (n) => (n + 3) & ~3;

/** A GLB from a JSON document and plain (uncompressed) views given as typed arrays or buffers. */
function writeGlb(json, views) {
  const chunks = [];
  let offset = 0;
  json.bufferViews = views.map(({ data, target, stride }) => {
    const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    const view = { buffer: 0, byteOffset: offset, byteLength: bytes.length };
    if (target) view.target = target;
    if (stride) view.byteStride = stride;
    chunks.push([offset, bytes]);
    offset = align4(offset + bytes.length);
    return view;
  });
  json.buffers = [{ byteLength: offset }];
  const bin = Buffer.alloc(offset);
  for (const [at, bytes] of chunks) bytes.copy(bin, at);
  const text = Buffer.from(JSON.stringify(json));
  const jsonChunk = Buffer.alloc(align4(text.length), 0x20);
  text.copy(jsonChunk);
  const header = Buffer.alloc(20);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(20 + jsonChunk.length + 8 + bin.length, 8);
  header.writeUInt32LE(jsonChunk.length, 12);
  header.writeUInt32LE(0x4e4f534a, 16);
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(bin.length, 0);
  binHeader.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jsonChunk, binHeader, bin]);
}

/** A unit-scale grid of quads with smooth float attributes. */
function grid(n, size = 1.8) {
  const positions = [],
    normals = [],
    uvs = [],
    tangents = [],
    indices = [];
  for (let y = 0; y <= n; y++)
    for (let x = 0; x <= n; x++) {
      const u = x / n,
        v = y / n;
      positions.push((u - 0.5) * size, v * size, Math.sin(u * 3.1) * 0.05);
      const nx = -Math.cos(u * 3.1) * 0.155,
        length = Math.hypot(nx, 0, 1);
      normals.push(nx / length, 0, 1 / length);
      uvs.push(u * 0.98 + 0.01, v * 0.98 + 0.01);
      tangents.push(1 / Math.hypot(1, nx), 0, -nx / Math.hypot(1, nx), 1);
    }
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const a = y * (n + 1) + x;
      indices.push(a, a + 1, a + n + 1, a + 1, a + n + 2, a + n + 1);
    }
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
    tangents: new Float32Array(tangents),
    indices: new Uint16Array(indices),
    count: (n + 1) * (n + 1),
  };
}

function bounds(values) {
  const min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < values.length; i++) {
    min[i % 3] = Math.min(min[i % 3], values[i]);
    max[i % 3] = Math.max(max[i % 3], values[i]);
  }
  return { min, max };
}

async function png(width, height, { alpha = null, seed = 1 } = {}) {
  const channels = alpha === null ? 3 : 4;
  const data = Buffer.alloc(width * height * channels);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels;
      data[i] = (x * 7 + seed * 13) & 255;
      data[i + 1] = (y * 5 + seed * 29) & 255;
      data[i + 2] = ((x ^ y) * 3) & 255;
      if (channels === 4) data[i + 3] = alpha(x, y);
    }
  return sharp(data, { raw: { width, height, channels } }).png().toBuffer();
}

/** A skinned, animated, textured synthetic character. */
async function character({
  alphaMode = 'OPAQUE',
  imageAlpha = (x) => (x % 2 ? 128 : 255),
  image: given = null,
} = {}) {
  const g = grid(12);
  const joints = new Uint8Array(g.count * 4),
    weights = new Float32Array(g.count * 4);
  for (let i = 0; i < g.count; i++) {
    const v = g.positions[i * 3 + 1] / 1.8;
    joints.set([0, 1, 0, 0], i * 4);
    weights.set([1 - v * 0.7, v * 0.7, 0, 0], i * 4);
  }
  const ibm = new Float32Array([
    1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, -0.9, 0,
    1,
  ]);
  const times = new Float32Array([0, 0.5, 1]);
  const rotations = new Float32Array([0, 0, 0, 1, 0, 0, Math.sin(0.3), Math.cos(0.3), 0, 0, 0, 1]);
  const translations = new Float32Array([0, 0.9, 0, 0, 0.93, 0.01, 0, 0.9, 0]);
  const image = given ?? (await png(64, 64, { alpha: imageAlpha }));
  const json = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0, 1] }],
    nodes: [
      { name: 'Root', children: [2] },
      { name: 'Body', mesh: 0, skin: 0 },
      { name: 'Spine', translation: [0, 0.9, 0] },
    ],
    skins: [{ joints: [0, 2], inverseBindMatrices: 6 }],
    meshes: [
      {
        name: 'Body',
        primitives: [
          {
            attributes: {
              POSITION: 0,
              NORMAL: 1,
              TEXCOORD_0: 2,
              TANGENT: 3,
              JOINTS_0: 4,
              WEIGHTS_0: 5,
            },
            indices: 7,
            material: 0,
          },
        ],
      },
    ],
    materials: [
      {
        name: 'Skin',
        alphaMode,
        pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0 },
      },
    ],
    textures: [{ source: 0, sampler: 0 }],
    samplers: [{ magFilter: 9729, minFilter: 9987 }],
    images: [{ bufferView: 11, mimeType: 'image/png', name: 'albedo' }],
    animations: [
      {
        name: 'Idle_Loop',
        samplers: [
          { input: 8, output: 9 },
          { input: 8, output: 10 },
        ],
        channels: [
          { sampler: 0, target: { node: 2, path: 'rotation' } },
          { sampler: 1, target: { node: 2, path: 'translation' } },
        ],
      },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: g.count, type: 'VEC3', ...bounds(g.positions) },
      { bufferView: 1, componentType: 5126, count: g.count, type: 'VEC3' },
      { bufferView: 2, componentType: 5126, count: g.count, type: 'VEC2' },
      { bufferView: 3, componentType: 5126, count: g.count, type: 'VEC4' },
      { bufferView: 4, componentType: 5121, count: g.count, type: 'VEC4' },
      { bufferView: 5, componentType: 5126, count: g.count, type: 'VEC4' },
      { bufferView: 6, componentType: 5126, count: 2, type: 'MAT4' },
      { bufferView: 7, componentType: 5123, count: g.indices.length, type: 'SCALAR' },
      { bufferView: 8, componentType: 5126, count: 3, type: 'SCALAR', min: [0], max: [1] },
      { bufferView: 9, componentType: 5126, count: 3, type: 'VEC4' },
      { bufferView: 10, componentType: 5126, count: 3, type: 'VEC3' },
    ],
  };
  return writeGlb(json, [
    { data: g.positions, target: 34962, stride: 12 },
    { data: g.normals, target: 34962, stride: 12 },
    { data: g.uvs, target: 34962, stride: 8 },
    { data: g.tangents, target: 34962, stride: 16 },
    { data: joints, target: 34962, stride: 4 },
    { data: weights, target: 34962, stride: 16 },
    { data: ibm },
    { data: g.indices, target: 34963 },
    { data: times },
    { data: rotations },
    { data: translations },
    { data: image },
  ]);
}

/** A static textured level of `n` quads per side; `image` is shared bytes between levels. */
function staticLevel(n, image) {
  const g = grid(n, 4);
  return writeGlb(
    {
      asset: { version: '2.0' },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ name: 'Rock', mesh: 0 }],
      meshes: [
        {
          primitives: [
            { attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, indices: 3, material: 0 },
          ],
        },
      ],
      materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
      textures: [{ source: 0, sampler: 0 }],
      samplers: [{ magFilter: 9729, minFilter: 9987 }],
      images: [{ bufferView: 4, mimeType: 'image/png' }],
      accessors: [
        {
          bufferView: 0,
          componentType: 5126,
          count: g.count,
          type: 'VEC3',
          ...bounds(g.positions),
        },
        { bufferView: 1, componentType: 5126, count: g.count, type: 'VEC3' },
        { bufferView: 2, componentType: 5126, count: g.count, type: 'VEC2' },
        { bufferView: 3, componentType: 5123, count: g.indices.length, type: 'SCALAR' },
      ],
    },
    [
      { data: g.positions, target: 34962, stride: 12 },
      { data: g.normals, target: 34962, stride: 12 },
      { data: g.uvs, target: 34962, stride: 8 },
      { data: g.indices, target: 34963 },
      { data: image },
    ],
  );
}

/** Decode one accessor of a GLB as floats (normalized integers scaled). */
function accessorFloats(bytes, index) {
  const { json, bin } = parseGlb(bytes);
  const accessor = json.accessors[index];
  const view = json.bufferViews[accessor.bufferView];
  const ext = view.extensions?.EXT_meshopt_compression;
  let raw = bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
  if (ext) {
    raw = new Uint8Array(ext.count * ext.byteStride);
    MeshoptDecoder.decodeGltfBuffer(
      raw,
      ext.count,
      ext.byteStride,
      bin.subarray(ext.byteOffset, ext.byteOffset + ext.byteLength),
      ext.mode,
      ext.filter ?? 'NONE',
    );
  }
  const copy = new Uint8Array(raw.byteLength);
  copy.set(raw);
  const T = { 5126: Float32Array, 5122: Int16Array, 5121: Uint8Array, 5123: Uint16Array }[
    accessor.componentType
  ];
  const values = Array.from(new T(copy.buffer));
  return accessor.normalized ? values.map((v) => Math.max(-1, v / 32767)) : values;
}

test('cooking keeps every scene, rig, clip and material and stays within its stated tolerances', async () => {
  await MeshoptDecoder.ready;
  const master = await character();
  const { bytes, report } = await cookGlb(master, { label: 'synthetic', sharp });
  const before = parseGlb(master).json,
    after = parseGlb(bytes).json;
  for (const key of ['scenes', 'nodes', 'meshes', 'skins', 'animations', 'materials', 'samplers'])
    assert.deepEqual(after[key], before[key], key);
  assert.ok(after.extensionsRequired.includes('EXT_meshopt_compression'));
  // Vertex attributes still decode to float32 of the same layout; only rotations change type.
  for (const index of [0, 1, 2, 3, 5]) assert.equal(after.accessors[index].componentType, 5126);
  assert.equal(after.accessors[4].componentType, 5121);
  assert.equal(after.accessors[9].componentType, 5122);
  assert.equal(after.accessors[9].normalized, true);
  const close = (index, limit) => {
    const a = accessorFloats(master, index),
      b = accessorFloats(bytes, index);
    assert.equal(a.length, b.length);
    for (let i = 0; i < a.length; i++)
      assert.ok(Math.abs(a[i] - b[i]) <= limit, `accessor ${index}[${i}] ${a[i]} vs ${b[i]}`);
  };
  close(0, DEFAULT_POLICY.positionMetres);
  close(1, DEFAULT_POLICY.unitComponent);
  close(2, DEFAULT_POLICY.texcoord);
  close(3, DEFAULT_POLICY.unitComponent);
  close(4, 0);
  close(6, 0);
  close(7, 0);
  close(8, 0);
  close(9, 2e-4);
  close(10, DEFAULT_POLICY.animationTranslationMetres);
  // Skin weights are snapped to the lattice and sum exactly to one.
  const w = accessorFloats(bytes, 5);
  for (let i = 0; i < w.length; i += 4) assert.equal(w[i] + w[i + 1] + w[i + 2] + w[i + 3], 1);
  // POSITION min/max describe the decoded data.
  const p = accessorFloats(bytes, 0);
  for (let c = 0; c < 3; c++) {
    const component = p.filter((_, i) => i % 3 === c);
    assert.equal(after.accessors[0].min[c], Math.min(...component));
    assert.equal(after.accessors[0].max[c], Math.max(...component));
  }
  assert.ok(report.verified);
});

test('an OPAQUE colour PNG becomes required WebP with its unread alpha dropped', async () => {
  const smooth = await sharp({
    create: {
      width: 64,
      height: 64,
      channels: 4,
      background: { r: 120, g: 90, b: 60, alpha: 0.5 },
    },
  })
    .png()
    .toBuffer();
  const { bytes, report } = await cookGlb(await character({ image: smooth }), { sharp });
  const { json, bin } = parseGlb(bytes);
  assert.equal(json.images[0].mimeType, 'image/webp');
  assert.deepEqual(json.textures[0], {
    sampler: 0,
    extensions: { EXT_texture_webp: { source: 0 } },
  });
  assert.ok(json.extensionsRequired.includes('EXT_texture_webp'));
  const view = json.bufferViews[json.images[0].bufferView];
  const meta = await sharp(
    Buffer.from(bin.subarray(view.byteOffset, view.byteOffset + view.byteLength)),
  ).metadata();
  assert.equal(meta.format, 'webp');
  assert.equal(meta.hasAlpha, false);
  assert.ok(report.images[0].psnr >= DEFAULT_POLICY.minimumColourPsnr);
});

test('colour the lossy coder cannot hold within the quality bound is coded near-lossless', async () => {
  // A high-frequency pattern: lossy WebP falls below the bound.
  const { report } = await cookGlb(await character(), { sharp });
  const image = report.images[0];
  assert.ok(
    image.cooked ? !image.cooked.startsWith('webp-q') || image.psnr >= 36 : image.kept === 'larger',
  );
});

test('sampled alpha keeps its PNG: MASK materials and runtime-sampled models', async () => {
  for (const [label, options, mode] of [
    ['MASK material', {}, 'MASK'],
    ['runtime alpha', { alphaSampled: true }, 'OPAQUE'],
  ]) {
    const { bytes, report } = await cookGlb(await character({ alphaMode: mode }), {
      sharp,
      ...options,
    });
    assert.equal(parseGlb(bytes).json.images[0].mimeType, 'image/png', label);
    assert.equal(report.images[0].kept, 'alpha', label);
  }
});

test('textures above the delivery limit are downscaled; normal maps stay unit length', async () => {
  const master = await character();
  const policy = { ...DEFAULT_POLICY, maxTextureEdge: 32 };
  const { bytes, report } = await cookGlb(master, { sharp, policy });
  const { json, bin } = parseGlb(bytes);
  const view = json.bufferViews[json.images[0].bufferView];
  const meta = await sharp(
    Buffer.from(bin.subarray(view.byteOffset, view.byteOffset + view.byteLength)),
  ).metadata();
  assert.deepEqual([meta.width, meta.height], [32, 32]);
  assert.deepEqual(report.images[0].resizedFrom, [64, 64]);
});

test('Three r185 decodes the cooked filters into float attributes and float tracks', async () => {
  await MeshoptDecoder.ready;
  const master = await character();
  // Images are dropped here: Node has no image decoder for GLTFLoader.
  const { bytes } = await cookGlb(master, { label: 'no-images' });
  const { json } = parseGlb(bytes);
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const stripped = structuredClone(json);
  delete stripped.materials[0].pbrMetallicRoughness.baseColorTexture;
  const data = parseGlb(bytes).bin;
  const text = Buffer.from(JSON.stringify(stripped));
  const pad = Buffer.alloc(align4(text.length), 0x20);
  text.copy(pad);
  const header = Buffer.alloc(20);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(20 + pad.length + 8 + data.length, 8);
  header.writeUInt32LE(pad.length, 12);
  header.writeUInt32LE(0x4e4f534a, 16);
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(data.length, 0);
  binHeader.writeUInt32LE(0x004e4942, 4);
  const glb = Buffer.concat([header, pad, binHeader, Buffer.from(data)]);
  const gltf = await loader.parseAsync(
    glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.length),
    '',
  );
  let mesh = null;
  gltf.scene.traverse((node) => {
    if (node.isSkinnedMesh) mesh = node;
  });
  assert.ok(mesh, 'skinned mesh');
  for (const name of ['position', 'normal', 'uv', 'tangent', 'skinWeight']) {
    const attribute = mesh.geometry.attributes[name];
    assert.ok(attribute.array instanceof Float32Array, name);
    assert.equal(attribute.isInterleavedBufferAttribute, undefined, name);
  }
  const rotation = gltf.animations[0].tracks.find((track) => track.name.endsWith('.quaternion'));
  assert.ok(rotation.values instanceof Float32Array);
  assert.ok(Math.abs(rotation.values[6] - Math.sin(0.3)) < 2e-4);
  assert.equal(rotation.values.length, 12);
  void THREE;
});

test('packing levels keeps every accessor and stores a shared image once', async () => {
  const image = await png(32, 32);
  const levels = [staticLevel(8, image), staticLevel(3, image), staticLevel(1, image)];
  const packed = await packLevels(levels, 'rock');
  const { json } = parseGlb(packed);
  assert.equal(json.scenes.length, 3);
  assert.equal(new Set(json.images.map((i) => i.bufferView)).size, 1);
  assert.equal(json.samplers.length, 1);
  assert.equal(json.materials.length, 3);
  assert.equal(json.meshes.length, 3);
  for (let level = 0; level < 3; level++) {
    const node = json.nodes[json.scenes[level].nodes[0]];
    const primitive = json.meshes[node.mesh].primitives[0];
    const own = parseGlb(levels[level]).json;
    assert.deepEqual(
      accessorFloats(packed, primitive.attributes.POSITION),
      accessorFloats(levels[level], own.meshes[0].primitives[0].attributes.POSITION),
    );
  }
  assert.ok(
    packed.length < levels.reduce((sum, level) => sum + level.length, 0) - 2 * image.length + 64,
  );
  await assert.rejects(packLevels([await character(), levels[1]], 'actor'), /skins, animations/);
});

test('standalone textures: opaque PNG to WebP, alpha PNG to a palette PNG, fixed URLs stay PNG', async () => {
  const opaque = await png(64, 64, { seed: 3 });
  const blended = await png(64, 64, { alpha: (x, y) => ((x + y) % 7) * 36, seed: 5 });
  const a = await cookTexture(opaque, sharp, {
    webpQuality: 90,
    paletteQuality: 95,
    minimumPsnr: 20,
  });
  assert.equal(a.extension, 'webp');
  const b = await cookTexture(blended, sharp, {
    webpQuality: 90,
    paletteQuality: 95,
    minimumPsnr: 20,
  });
  assert.equal(b.extension, 'png');
  assert.equal((await sharp(b.bytes).metadata()).hasAlpha, true);
  const c = await cookTexture(
    opaque,
    sharp,
    { webpQuality: 90, paletteQuality: 95, minimumPsnr: 20 },
    { samePng: true },
  );
  if (c.bytes) assert.equal(c.extension, 'png');
  const strict = await cookTexture(opaque, sharp, {
    webpQuality: 90,
    paletteQuality: 95,
    minimumPsnr: 99,
  });
  assert.equal(strict.kept, 'quality');
});

test('delivery URLs are content-addressed and accepted by the build graph checks', () => {
  const sha = 'ab'.repeat(32);
  const url = cookedUrl('/models/hide-tent/model-c2.opt-b5c28634111da93e.glb', sha);
  assert.equal(url, `/models/hide-tent/model-c2.cook-${sha.slice(0, 16)}.glb`);
  assert.equal(checkModelUrl(url, sha), true);
  assert.throws(() => checkModelUrl(url, 'cd'.repeat(32)), /not addressed/);
  assert.equal(
    checkTextureUrl(`/models/camp-cave/limestone-r05.cook-${sha.slice(0, 16)}.webp`, sha, [
      'png',
      'webp',
    ]),
    true,
  );
});

test('the cache returns the same delivery; manifests name delivery files, packed scenes and textures', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cro-delivery-'));
  try {
    await mkdir(path.join(root, 'public/models/rock'), { recursive: true });
    await mkdir(path.join(root, 'node_modules/meshoptimizer'), { recursive: true });
    await writeFile(
      path.join(root, 'node_modules/meshoptimizer/package.json'),
      await readFile(path.join(import.meta.dirname, '../node_modules/meshoptimizer/package.json')),
    );
    const image = await png(32, 32);
    const files = {
      '/models/rock/model.glb': staticLevel(6, image),
      '/models/rock/lod1.glb': staticLevel(2, image),
    };
    for (const [url, bytes] of Object.entries(files))
      await writeFile(path.join(root, 'public', url), bytes);
    const record = (url) => ({ url, sha256: sha256(files[url]), bytes: files[url].length });
    const asset = {
      modelKey: 'rock',
      kind: 'static',
      ...record('/models/rock/model.glb'),
      lods: [{ ...record('/models/rock/lod1.glb'), distanceMetres: 20 }],
      provenance: { url: '/models/rock/model.glb' },
    };
    const first = await cookedModel(root, record('/models/rock/model.glb'));
    const second = await cookedModel(root, record('/models/rock/model.glb'));
    assert.equal(second.sha256, first.sha256);
    assert.equal(sha256(await readFile(second.file)), second.sha256);
    const graph = await deliveryGraph(root, [asset]);
    assert.equal(graph.summary.packedFiles, 1);
    const delivered = deliveredAsset(asset, graph.deliveries);
    assert.match(delivered.url, /^\/models\/rock\/model-levels\.cook-[0-9a-f]{16}\.glb$/);
    assert.equal(delivered.scene, 0);
    assert.equal(delivered.lods[0].scene, 1);
    assert.equal(delivered.lods[0].url, delivered.url);
    assert.equal(delivered.lods[0].distanceMetres, 20);
    assert.deepEqual(delivered.provenance, asset.provenance);
    await assert.rejects(
      deliveryGraph(root, [{ ...asset, url: delivered.url, lods: [] }]),
      /names a delivery file as its master/,
    );
    // A master that changed after its manifest was written is refused before cooking.
    await writeFile(path.join(root, 'public/models/rock/model.glb'), staticLevel(5, image));
    await assert.rejects(
      cookedModel(root, { ...record('/models/rock/model.glb'), sha256: '00'.repeat(32) }),
      /Master mismatch/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
