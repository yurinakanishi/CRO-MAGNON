// Low-poly head revision, step 3 of 3: write the character GLB with the new head.
//
//   node scripts/face-remake/assemble-head.mjs --master <startup glb> --work <dir> --out <glb>
//     [--texture-size 1024]
//
// Everything but the head primitive is the master's, byte for byte in decoded form: body
// primitives, skin, inverse binds, nodes, every clip, materials and the body textures. The head
// primitive gets the low vertices (each an adopted head vertex: position, joints and weights
// copied; the welded normal), the baked UVs, and the baked albedo (downscaled with Lanczos). The
// file is written with lossless meshopt streams for vertex, index and animation data.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { createHash } from 'node:crypto';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';
import { MESHOPT } from '../delivery/cook-glb.mjs';
import { readPrimitives } from './lowpoly-head.mjs';

const { values: args } = parseArgs({
  options: {
    master: { type: 'string' },
    work: { type: 'string' },
    out: { type: 'string' },
    'texture-size': { type: 'string', default: '1024' },
  },
});
for (const key of ['master', 'work', 'out'])
  if (!args[key]) throw new Error(`--${key} is required`);
await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const align4 = (n) => (n + 3) & ~3;

const masterBytes = await readFile(args.master);
const master = readPrimitives(masterBytes, args.master);
const geometry = JSON.parse(await readFile(path.join(args.work, 'geometry.json'), 'utf8'));
const unwrap = JSON.parse(await readFile(path.join(args.work, 'low-uv.json'), 'utf8'));
const head = master.primitives.find(
  (p) => p.mesh === geometry.headPrimitive.mesh && p.index === geometry.headPrimitive.index,
);
if (!head || head.material !== geometry.headPrimitive.material)
  throw new Error('Head primitive mismatch');

// Blender keeps the OBJ vertex order: Blender vertex i is low vertex i. Proven by position (the
// seam may hold two low vertices at one position, so order, not position, is the identity).
const reps = geometry.lowRepresentatives;
if (unwrap.vertices.length !== reps.length) throw new Error('Blender changed the low vertex count');
const blenderToLow = unwrap.vertices.map(([x, y, z], i) => {
  const r = reps[i];
  const d = Math.hypot(
    head.positions[r * 3] - x,
    head.positions[r * 3 + 1] - y,
    head.positions[r * 3 + 2] - z,
  );
  if (!(d < 1e-5)) throw new Error(`Blender vertex ${i} is ${d} m from low vertex ${i}`);
  return i;
});

// One output vertex per distinct (low vertex, UV) pair.
const vertexOf = new Map(),
  vertices = [],
  indices = [];
let rewound = 0;
for (const corners of unwrap.faces) {
  if (corners.length !== 3) throw new Error('The low head must stay triangulated');
  // Wind each triangle to agree with the adopted normals (lowpoly-head.mjs did; Blender may not
  // keep it): the material is double-sided, and a back face is lit with its normal reversed.
  const at = (c) => {
    const r = reps[blenderToLow[c[0]]];
    return [head.positions[r * 3], head.positions[r * 3 + 1], head.positions[r * 3 + 2]];
  };
  const [pa, pb, pc] = corners.map(at);
  const e1 = [0, 1, 2].map((k) => pb[k] - pa[k]),
    e2 = [0, 1, 2].map((k) => pc[k] - pa[k]);
  const g = [
    e1[1] * e2[2] - e1[2] * e2[1],
    e1[2] * e2[0] - e1[0] * e2[2],
    e1[0] * e2[1] - e1[1] * e2[0],
  ];
  let dot = 0;
  for (const c of corners)
    for (let k = 0; k < 3; k++) dot += g[k] * geometry.lowNormals[blenderToLow[c[0]] * 3 + k];
  const face = dot < 0 ? [corners[0], corners[2], corners[1]] : corners;
  if (dot < 0) rewound++;
  for (const [b, u, v] of face) {
    const j = blenderToLow[b];
    const k = `${j},${Math.round(u * 1e6)},${Math.round(v * 1e6)}`;
    let id = vertexOf.get(k);
    if (id === undefined) {
      id = vertices.length;
      vertexOf.set(k, id);
      vertices.push({ j, u, v });
    }
    indices.push(id);
  }
}
const n = vertices.length;
const positions = new Float32Array(n * 3),
  normals = new Float32Array(n * 3),
  uvs = new Float32Array(n * 2),
  joints = new head.joints.constructor(n * 4),
  weights = new Float32Array(n * 4);
vertices.forEach(({ j, u, v }, i) => {
  const r = reps[j];
  positions.set(head.positions.subarray(r * 3, r * 3 + 3), i * 3);
  normals.set(geometry.lowNormals.slice(j * 3, j * 3 + 3), i * 3);
  uvs.set([u, 1 - v], i * 2);
  joints.set(head.joints.subarray(r * 4, r * 4 + 4), i * 4);
  weights.set(head.weights.subarray(r * 4, r * 4 + 4), i * 4);
});
const indexArray = n < 65536 ? new Uint16Array(indices) : new Uint32Array(indices);
const size = Number(args['texture-size']);
const albedo = await sharp(path.join(args.work, 'low-albedo.png'))
  .removeAlpha()
  .resize(size, size, { kernel: 'lanczos3' })
  .png({ compressionLevel: 9 })
  .toBuffer();

// New document: the master's JSON with the head accessors and image pointing at new views.
const json = structuredClone(master.json);
const views = master.views.map((v) => v.bytes);
const newViews = [];
const viewFor = (data, target, stride) => {
  views.push(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  newViews.push({ target, stride });
  return views.length - 1;
};
const attrs = head.json.attributes;
const set = (accessorIndex, data, extra = {}) => {
  const accessor = json.accessors[accessorIndex];
  const T = data.constructor;
  const width = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[accessor.type];
  accessor.bufferView = viewFor(
    data,
    extra.target,
    extra.target === 34962 ? width * T.BYTES_PER_ELEMENT : undefined,
  );
  accessor.byteOffset = 0;
  accessor.count = data.length / width;
  if (extra.componentType) accessor.componentType = extra.componentType;
  delete accessor.min;
  delete accessor.max;
  if (extra.bounds) Object.assign(accessor, extra.bounds);
};
const min = [Infinity, Infinity, Infinity],
  max = [-Infinity, -Infinity, -Infinity];
for (let i = 0; i < positions.length; i++) {
  min[i % 3] = Math.min(min[i % 3], positions[i]);
  max[i % 3] = Math.max(max[i % 3], positions[i]);
}
set(attrs.POSITION, positions, { target: 34962, bounds: { min, max } });
set(attrs.NORMAL, normals, { target: 34962 });
set(attrs.TEXCOORD_0, uvs, { target: 34962 });
set(attrs.JOINTS_0, joints, { target: 34962 });
set(attrs.WEIGHTS_0, weights, { target: 34962 });
set(head.json.indices, indexArray, { target: 34963, componentType: n < 65536 ? 5123 : 5125 });
if (attrs.TANGENT !== undefined)
  throw new Error('The head carries tangents; recompute them for the new UVs');
const material = json.materials[head.json.material];
const textureIndex = material.pbrMetallicRoughness.baseColorTexture.index;
const texture = json.textures[textureIndex];
const imageIndex = texture.extensions?.EXT_texture_webp?.source ?? texture.source;
const shared = json.textures.some(
  (t, i) =>
    i !== textureIndex && (t.extensions?.EXT_texture_webp?.source ?? t.source) === imageIndex,
);
if (shared) throw new Error('The head albedo image is shared with another texture');
json.images[imageIndex] = {
  ...json.images[imageIndex],
  bufferView: viewFor(albedo),
  mimeType: 'image/png',
  name: 'HeadAlbedoLowpolyBake',
};
delete texture.extensions?.EXT_texture_webp;
if (texture.extensions && !Object.keys(texture.extensions).length) delete texture.extensions;
texture.source = imageIndex;

// Keep only the views something still reads, then write lossless meshopt streams.
const used = new Map();
const viewTargets = new Map();
json.accessors.forEach((a) => {
  if (a.bufferView !== undefined) used.set(a.bufferView, true);
});
json.images.forEach((im) => im.bufferView !== undefined && used.set(im.bufferView, true));
const order = [...used.keys()].sort((a, b) => a - b);
const remap = new Map(order.map((v, i) => [v, i]));
for (const a of json.accessors)
  if (a.bufferView !== undefined) a.bufferView = remap.get(a.bufferView);
for (const im of json.images)
  if (im.bufferView !== undefined) im.bufferView = remap.get(im.bufferView);
const imageViews = new Set(json.images.map((im) => im.bufferView));
const accessorOf = new Map(json.accessors.map((a) => [a.bufferView, a]));
const chunks = [];
let binLength = 0,
  fallbackLength = 0;
const push = (bytes) => {
  const offset = binLength;
  chunks.push({ offset, bytes });
  binLength = align4(binLength + bytes.length);
  return offset;
};
const indexAccessors = new Set(json.meshes.flatMap((m) => m.primitives.map((p) => p.indices)));
json.bufferViews = order.map((oldIndex, i) => {
  const bytes = views[oldIndex];
  const previous =
    oldIndex < master.json.bufferViews.length ? master.json.bufferViews[oldIndex] : null;
  const added =
    oldIndex >= master.json.bufferViews.length
      ? newViews[oldIndex - master.json.bufferViews.length]
      : null;
  const target = previous?.target ?? added?.target;
  const accessor = accessorOf.get(i);
  if (imageViews.has(i) || !accessor)
    return { buffer: 0, byteOffset: push(bytes), byteLength: bytes.length };
  const width = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[accessor.type];
  const elementBytes =
    width * { 5121: 1, 5123: 2, 5125: 4, 5126: 4, 5122: 2, 5120: 1 }[accessor.componentType];
  const isIndices = indexAccessors.has(json.accessors.indexOf(accessor));
  const stride = isIndices ? elementBytes : elementBytes;
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  let stream, mode, count;
  if (isIndices && (elementBytes === 2 || elementBytes === 4)) {
    mode = 'INDICES';
    count = accessor.count;
    stream = MeshoptEncoder.encodeGltfBuffer(copy, count, elementBytes, mode);
  } else if (stride % 4 === 0 && copy.byteLength === accessor.count * stride) {
    mode = 'ATTRIBUTES';
    count = accessor.count;
    stream = MeshoptEncoder.encodeGltfBuffer(copy, count, stride, mode);
  } else
    return {
      buffer: 0,
      byteOffset: push(bytes),
      byteLength: bytes.length,
      ...(target ? { target } : {}),
    };
  const decoded = new Uint8Array(copy.byteLength);
  MeshoptDecoder.decodeGltfBuffer(decoded, count, isIndices ? elementBytes : stride, stream, mode);
  if (Buffer.compare(Buffer.from(decoded), Buffer.from(copy)) !== 0)
    throw new Error(`Lossless stream ${i} did not round-trip`);
  const view = {
    buffer: 1,
    byteOffset: fallbackLength,
    byteLength: copy.byteLength,
    ...(target === 34962 ? { byteStride: stride } : {}),
    ...(target ? { target } : {}),
    extensions: {
      [MESHOPT]: {
        buffer: 0,
        byteOffset: push(stream),
        byteLength: stream.length,
        byteStride: isIndices ? elementBytes : stride,
        count,
        mode,
      },
    },
  };
  fallbackLength = align4(fallbackLength + copy.byteLength);
  void viewTargets;
  return view;
});
json.buffers = [
  { byteLength: binLength },
  { byteLength: fallbackLength, extensions: { [MESHOPT]: { fallback: true } } },
];
json.extensionsUsed = [...new Set([...(json.extensionsUsed ?? []), MESHOPT])];
json.extensionsRequired = [...new Set([...(json.extensionsRequired ?? []), MESHOPT])];
const stillWebp = json.textures.some((t) => t.extensions?.EXT_texture_webp);
if (!stillWebp) {
  json.extensionsUsed = json.extensionsUsed.filter((x) => x !== 'EXT_texture_webp');
  json.extensionsRequired = json.extensionsRequired.filter((x) => x !== 'EXT_texture_webp');
}
const bin = Buffer.alloc(binLength);
for (const { offset, bytes } of chunks) bin.set(bytes, offset);
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
const glb = Buffer.concat([header, jsonChunk, binHeader, bin]);
await mkdir(path.dirname(path.resolve(args.out)), { recursive: true });
await writeFile(args.out, glb);

// Proof: every other primitive, the skin, nodes and every clip decode exactly as the master's.
const written = readPrimitives(glb, args.out);
for (const p of master.primitives) {
  if (p === head) continue;
  const q = written.primitives.find((x) => x.mesh === p.mesh && x.index === p.index);
  for (const key of ['positions', 'normals', 'uvs', 'joints', 'weights', 'indices'])
    if (p[key] && Buffer.compare(Buffer.from(p[key].buffer), Buffer.from(q[key].buffer)) !== 0)
      throw new Error(`Body primitive ${p.index} ${key} changed`);
}
for (const key of ['nodes', 'skins', 'animations', 'scenes', 'samplers'])
  if (JSON.stringify(master.json[key]) !== JSON.stringify(written.json[key]))
    throw new Error(`${key} changed`);
// Texture use: the share of the atlas each region covers and its texel density on the surface,
// at the delivered size (the face region is face-faces.json).
const faceFaces = new Set(
  JSON.parse(await readFile(path.join(args.work, 'face-faces.json'), 'utf8')),
);
const use = { face: { uv: 0, mm2: 0 }, rest: { uv: 0, mm2: 0 } };
unwrap.faces.forEach((corners, i) => {
  const [a, b, c] = corners;
  const uv = Math.abs((b[1] - a[1]) * (c[2] - a[2]) - (c[1] - a[1]) * (b[2] - a[2])) / 2;
  const [pa, pb, pc] = corners.map((corner) => unwrap.vertices[corner[0]]);
  const e1 = [0, 1, 2].map((k) => pb[k] - pa[k]),
    e2 = [0, 1, 2].map((k) => pc[k] - pa[k]);
  const area =
    Math.hypot(
      e1[1] * e2[2] - e1[2] * e2[1],
      e1[2] * e2[0] - e1[0] * e2[2],
      e1[0] * e2[1] - e1[1] * e2[0],
    ) / 2;
  const region = use[faceFaces.has(i) ? 'face' : 'rest'];
  region.uv += uv;
  region.mm2 += area * 1e6;
});
const atlas = Object.fromEntries(
  Object.entries(use).map(([name, { uv, mm2 }]) => [
    name,
    {
      atlasShare: Number(uv.toFixed(4)),
      texelsPerMm2: Number(((uv * size * size) / mm2).toFixed(3)),
    },
  ]),
);
const summary = {
  out: args.out,
  sha256: sha256(glb),
  bytes: glb.length,
  head: {
    triangles: indices.length / 3,
    vertices: n,
    lowVertices: reps.length,
    rewoundTriangles: rewound,
    texture: `${size}x${size} PNG ${albedo.length} B`,
    atlas,
    uvRepair: unwrap.uvRepair,
  },
  master: {
    sha256: sha256(masterBytes),
    headTriangles: head.indices.length / 3,
    headVertices: head.positions.length / 3,
  },
};
await writeFile(`${args.out}.json`, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
