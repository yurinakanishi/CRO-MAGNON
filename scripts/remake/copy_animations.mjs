// Replace a remade GLB's animations with the delivered clips verbatim (channels mapped to the same-named nodes),
// for transfer-route assets whose armature is unchanged. Blender's re-export samples whole frames at one rate, so a
// clip authored off that grid (rimo-neko Hiss 2.1 s, desert-fennec-mage Run_Loop 0.76 s at ~119.7 Hz) came back
// shortened with an open loop; copying the authored keys restores exact durations, closure and curves.
// node scripts/remake/copy_animations.mjs <source.glb> <target.glb> <out.glb>
// The target's mesh, skin, material and image data are kept byte-for-byte; its own animation data is dropped and
// the buffer compacted. Fails if a source channel's node has no same-named node in the target.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const [srcPath, tgtPath, outPath] = process.argv.slice(2);
function parse(file) {
  const b = readFileSync(file),
    jl = b.readUInt32LE(12),
    doc = JSON.parse(b.subarray(20, 20 + jl)),
    bl = b.readUInt32LE(20 + jl),
    bin = b.subarray(28 + jl, 28 + jl + bl);
  return { doc, bin };
}
const S = parse(srcPath),
  T = parse(tgtPath);
const doc = T.doc;
const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const SIZE = { 5126: 4, 5125: 4, 5123: 2, 5121: 1, 5122: 2, 5120: 1 };

// Accessors still needed by the target outside its animations.
const keepAcc = new Set();
for (const mesh of doc.meshes ?? [])
  for (const p of mesh.primitives) {
    Object.values(p.attributes).forEach((i) => keepAcc.add(i));
    if (p.indices !== undefined) keepAcc.add(p.indices);
    for (const t of p.targets ?? []) Object.values(t).forEach((i) => keepAcc.add(i));
  }
for (const skin of doc.skins ?? []) if (skin.inverseBindMatrices !== undefined) keepAcc.add(skin.inverseBindMatrices);
const keepView = new Set([...keepAcc].map((i) => doc.accessors[i].bufferView));
for (const img of doc.images ?? []) if (img.bufferView !== undefined) keepView.add(img.bufferView);

const chunks = [];
let offset = 0;
const views = [];
const viewMap = new Map();
function pushBytes(bytes, extra = {}) {
  const pad = (4 - (offset % 4)) % 4;
  if (pad) {
    chunks.push(Buffer.alloc(pad));
    offset += pad;
  }
  views.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, ...extra });
  chunks.push(Buffer.from(bytes));
  offset += bytes.length;
  return views.length - 1;
}
[...keepView]
  .sort((a, b) => a - b)
  .forEach((vi) => {
    const v = doc.bufferViews[vi];
    const { byteOffset = 0, byteLength, buffer, ...rest } = v;
    viewMap.set(vi, pushBytes(T.bin.subarray(byteOffset, byteOffset + byteLength), rest));
  });
const accessors = [];
const accMap = new Map();
[...keepAcc]
  .sort((a, b) => a - b)
  .forEach((ai) => {
    accMap.set(ai, accessors.length);
    accessors.push({ ...doc.accessors[ai], bufferView: viewMap.get(doc.accessors[ai].bufferView) });
  });
for (const mesh of doc.meshes ?? [])
  for (const p of mesh.primitives) {
    for (const k of Object.keys(p.attributes)) p.attributes[k] = accMap.get(p.attributes[k]);
    if (p.indices !== undefined) p.indices = accMap.get(p.indices);
    for (const t of p.targets ?? []) for (const k of Object.keys(t)) t[k] = accMap.get(t[k]);
  }
for (const skin of doc.skins ?? [])
  if (skin.inverseBindMatrices !== undefined) skin.inverseBindMatrices = accMap.get(skin.inverseBindMatrices);
for (const img of doc.images ?? []) if (img.bufferView !== undefined) img.bufferView = viewMap.get(img.bufferView);

// Source clips, verbatim.
const nodeByName = new Map(doc.nodes.map((n, i) => [n.name, i]));
const copied = new Map();
function copyAccessor(ai) {
  if (copied.has(ai)) return copied.get(ai);
  const a = S.doc.accessors[ai],
    v = S.doc.bufferViews[a.bufferView];
  const n = COMPONENTS[a.type] * SIZE[a.componentType] * a.count;
  const start = (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
  if (v.byteStride && v.byteStride !== COMPONENTS[a.type] * SIZE[a.componentType]) throw new Error('strided animation data');
  const view = pushBytes(S.bin.subarray(start, start + n));
  const { bufferView, byteOffset, ...rest } = a;
  accessors.push({ ...rest, bufferView: view });
  copied.set(ai, accessors.length - 1);
  return accessors.length - 1;
}
const animations = (S.doc.animations ?? []).map((an) => ({
  name: an.name,
  samplers: an.samplers.map((s) => ({ ...s, input: copyAccessor(s.input), output: copyAccessor(s.output) })),
  channels: an.channels.map((c) => {
    const name = S.doc.nodes[c.target.node].name;
    if (!nodeByName.has(name)) throw new Error(`target has no node ${name}`);
    return { sampler: c.sampler, target: { ...c.target, node: nodeByName.get(name) } };
  }),
}));
doc.animations = animations;
doc.accessors = accessors;
doc.bufferViews = views;
const bin = Buffer.concat(chunks.concat(Buffer.alloc((4 - (offset % 4)) % 4)));
doc.buffers = [{ byteLength: bin.length }];
let js = Buffer.from(JSON.stringify(doc));
js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0);
header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + js.length + 8 + bin.length, 8);
const jh = Buffer.alloc(8);
jh.writeUInt32LE(js.length, 0);
jh.writeUInt32LE(0x4e4f534a, 4);
const bh = Buffer.alloc(8);
bh.writeUInt32LE(bin.length, 0);
bh.writeUInt32LE(0x004e4942, 4);
const out = Buffer.concat([header, jh, js, bh, bin]);
writeFileSync(outPath, out);
// Proof: every kept mesh/skin/image byte range is unchanged.
let same = 0;
for (const [oldI, newI] of accMap) {
  const a = T.doc.accessors[oldI];
  const ov = T.doc.bufferViews[a.bufferView];
  const nv = views[accessors[newI].bufferView];
  const len = ov.byteLength;
  if (Buffer.compare(T.bin.subarray(ov.byteOffset ?? 0, (ov.byteOffset ?? 0) + len), bin.subarray(nv.byteOffset, nv.byteOffset + len)) !== 0)
    throw new Error(`accessor ${oldI} changed`);
  same++;
}
console.log(
  JSON.stringify({
    out: outPath,
    sha256: createHash('sha256').update(out).digest('hex'),
    bytes: out.length,
    clips: animations.map((a) => a.name),
    geometryAccessorsVerified: same,
  }),
);
