// Position-only reduction of a dense TRELLIS GLB with meshoptimizer (robust on non-manifold hair/fur shells
// where Blender's collapse stalls). The output carries only welded positions + indices; remake_process.py
// --low <this> --rebake then unwraps it and bakes albedo/normal from the original dense surface.
// node scripts/remake/meshopt_reduce.mjs <dense.glb> <out.glb> <targetTriangles> [targetError=.01]
import { readFile, writeFile } from 'node:fs/promises';
import { MeshoptSimplifier } from 'meshoptimizer';
import { unpack, pack } from '../motion-glb.mjs';

const [src, dst, targetText, errorText = '.01', flagText = ''] = process.argv.slice(2);
// flagText 'LockBorder': keep open borders fixed (a part split from a larger mesh must meet its neighbour exactly).
const { doc, binary } = unpack(await readFile(src));
const read = (index) => {
  const a = doc.accessors[index], v = doc.bufferViews[a.bufferView];
  const offset = (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const comps = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type];
  const T = { 5126: Float32Array, 5125: Uint32Array, 5123: Uint16Array, 5121: Uint8Array }[a.componentType];
  const copy = Buffer.from(binary.subarray(offset, offset + a.count * comps * T.BYTES_PER_ELEMENT));
  return new T(copy.buffer, copy.byteOffset, a.count * comps);
};
const positions = [], indices = [];
let base = 0;
for (const mesh of doc.meshes)
  for (const p of mesh.primitives) {
    const pos = read(p.attributes.POSITION);
    const idx = p.indices !== undefined ? read(p.indices) : Uint32Array.from({ length: pos.length / 3 }, (_, i) => i);
    for (let k = 0; k < pos.length; k++) positions.push(pos[k]);
    for (const i of idx) indices.push(i + base);
    base += pos.length / 3;
  }
// Weld exactly coincident positions (UV seams split them in the source).
const key = new Map(), remap = new Uint32Array(positions.length / 3), welded = [];
for (let i = 0; i < remap.length; i++) {
  const k = `${positions[3 * i]},${positions[3 * i + 1]},${positions[3 * i + 2]}`;
  let j = key.get(k);
  if (j === undefined) {
    j = welded.length / 3;
    key.set(k, j);
    welded.push(positions[3 * i], positions[3 * i + 1], positions[3 * i + 2]);
  }
  remap[i] = j;
}
const P = new Float32Array(welded);
const I = Uint32Array.from(indices, (i) => remap[i]);
await MeshoptSimplifier.ready;
const target = Math.min(Math.floor(Number(targetText)) * 3, I.length); // never above the source count
const flags = flagText ? flagText.split(',') : [];
let [out, error] = MeshoptSimplifier.simplify(I, P, 3, target, Number(errorText), flags);
let method = 'meshopt simplify (topology-preserving quadric)' + (flags.length ? ' ' + flags.join('+') : '');
if (out.length > target * 1.15) {
  [out, error] = MeshoptSimplifier.simplifySloppy(I, P, 3, null, target, Number(errorText));
  method = 'meshopt simplifySloppy (topology-free, used because the quadric pass stalled above budget)';
}
// Compact vertices.
const used = new Int32Array(P.length / 3).fill(-1), compact = [];
const finalIdx = new Uint32Array(out.length);
for (let k = 0; k < out.length; k++) {
  const v = out[k];
  if (used[v] < 0) {
    used[v] = compact.length / 3;
    compact.push(P[3 * v], P[3 * v + 1], P[3 * v + 2]);
  }
  finalIdx[k] = used[v];
}
const posBuf = Buffer.from(new Float32Array(compact).buffer), idxBuf = Buffer.from(finalIdx.buffer);
const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
for (let i = 0; i < compact.length; i += 3) for (let c = 0; c < 3; c++) { min[c] = Math.min(min[c], compact[i + c]); max[c] = Math.max(max[c], compact[i + c]); }
const outDoc = {
  asset: { version: '2.0', generator: 'scripts/remake/meshopt_reduce.mjs' },
  scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name: 'Reduced' }],
  meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
  buffers: [{ byteLength: posBuf.length + idxBuf.length }],
  bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: posBuf.length, target: 34962 }, { buffer: 0, byteOffset: posBuf.length, byteLength: idxBuf.length, target: 34963 }],
  accessors: [{ bufferView: 0, componentType: 5126, count: compact.length / 3, type: 'VEC3', min, max }, { bufferView: 1, componentType: 5125, count: finalIdx.length, type: 'SCALAR' }],
};
await writeFile(dst, pack(outDoc, Buffer.concat([posBuf, idxBuf])));
console.log(JSON.stringify({ source: src, before: I.length / 3, welded: P.length / 3, after: finalIdx.length / 3, error, method }));
