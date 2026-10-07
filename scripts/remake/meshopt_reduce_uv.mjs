// UV-preserving reduction of a dense TRELLIS GLB with meshoptimizer. Unlike meshopt_reduce.mjs (positions only,
// re-unwrapped and re-baked later), every kept vertex is an original TRELLIS vertex with its original UV, so the
// TRELLIS albedo/PBR atlas is reused without resampling; remake_process.py --low <this> (without --rebake) then
// bakes only the tangent-space normal map on that same atlas.
// meshopt classifies UV-seam vertices (same position, different UV) and collapses them only along the seam.
// node scripts/remake/meshopt_reduce_uv.mjs <dense.glb> <out.glb> <targetTriangles> [targetError=.01]
import { readFile, writeFile } from 'node:fs/promises';
import { MeshoptSimplifier } from 'meshoptimizer';
import { unpack, pack } from '../motion-glb.mjs';

const [src, dst, targetText, errorText = '.01'] = process.argv.slice(2);
const { doc, binary } = unpack(await readFile(src));
const read = (index) => {
  const a = doc.accessors[index], v = doc.bufferViews[a.bufferView];
  const offset = (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const comps = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type];
  const T = { 5126: Float32Array, 5125: Uint32Array, 5123: Uint16Array, 5121: Uint8Array }[a.componentType];
  const stride = v.byteStride ? v.byteStride / T.BYTES_PER_ELEMENT : comps;
  const raw = Buffer.from(binary.subarray(offset, offset + ((a.count - 1) * stride + comps) * T.BYTES_PER_ELEMENT));
  const all = new T(raw.buffer, raw.byteOffset, (a.count - 1) * stride + comps);
  if (stride === comps) return all;
  const out = new T(a.count * comps);
  for (let i = 0; i < a.count; i++) for (let c = 0; c < comps; c++) out[i * comps + c] = all[i * stride + c];
  return out;
};
const positions = [], uvs = [], indices = [];
let base = 0;
for (const mesh of doc.meshes)
  for (const p of mesh.primitives) {
    if (p.attributes.TEXCOORD_0 === undefined) throw new Error('primitive without TEXCOORD_0');
    const pos = read(p.attributes.POSITION), uv = read(p.attributes.TEXCOORD_0);
    const idx = p.indices !== undefined ? read(p.indices) : Uint32Array.from({ length: pos.length / 3 }, (_, i) => i);
    for (let k = 0; k < pos.length; k++) positions.push(pos[k]);
    for (let k = 0; k < uv.length; k++) uvs.push(uv[k]);
    for (const i of idx) indices.push(i + base);
    base += pos.length / 3;
  }
// Merge only vertices identical in position AND uv (exact duplicates); seams stay split.
const key = new Map(), remap = new Uint32Array(positions.length / 3), P = [], U = [];
for (let i = 0; i < remap.length; i++) {
  const k = `${positions[3 * i]},${positions[3 * i + 1]},${positions[3 * i + 2]},${uvs[2 * i]},${uvs[2 * i + 1]}`;
  let j = key.get(k);
  if (j === undefined) {
    j = P.length / 3;
    key.set(k, j);
    P.push(positions[3 * i], positions[3 * i + 1], positions[3 * i + 2]);
    U.push(uvs[2 * i], uvs[2 * i + 1]);
  }
  remap[i] = j;
}
const Pf = new Float32Array(P), Uf = new Float32Array(U);
const I = Uint32Array.from(indices, (i) => remap[i]);
await MeshoptSimplifier.ready;
const target = Math.min(Math.floor(Number(targetText)) * 3, I.length), maxError = Number(errorText);  // never above the source count
let [out, error] = MeshoptSimplifier.simplify(I, Pf, 3, target, maxError, []);
let method = 'meshopt simplify (UV seams preserved, collapses along seams only)';
if (out.length > target * 1.15) {
  // Seams block the budget: allow seam collapses where the UV error stays small (attribute-weighted, Permissive).
  [out, error] = MeshoptSimplifier.simplifyWithAttributes(I, Pf, 3, Uf, 2, [0.5, 0.5], null, target, maxError, ['Permissive']);
  method = 'meshopt simplifyWithAttributes Permissive (UV-weighted seam collapses; plain pass stalled above budget)';
}
const used = new Int32Array(Pf.length / 3).fill(-1), cp = [], cu = [];
const finalIdx = new Uint32Array(out.length);
for (let k = 0; k < out.length; k++) {
  const v = out[k];
  if (used[v] < 0) {
    used[v] = cp.length / 3;
    cp.push(Pf[3 * v], Pf[3 * v + 1], Pf[3 * v + 2]);
    cu.push(Uf[2 * v], Uf[2 * v + 1]);
  }
  finalIdx[k] = used[v];
}
const posBuf = Buffer.from(new Float32Array(cp).buffer), uvBuf = Buffer.from(new Float32Array(cu).buffer), idxBuf = Buffer.from(finalIdx.buffer);
const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
for (let i = 0; i < cp.length; i += 3) for (let c = 0; c < 3; c++) { min[c] = Math.min(min[c], cp[i + c]); max[c] = Math.max(max[c], cp[i + c]); }
const outDoc = {
  asset: { version: '2.0', generator: 'scripts/remake/meshopt_reduce_uv.mjs' },
  scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name: 'Reduced' }],
  meshes: [{ primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1 }, indices: 2 }] }],
  buffers: [{ byteLength: posBuf.length + uvBuf.length + idxBuf.length }],
  bufferViews: [
    { buffer: 0, byteOffset: 0, byteLength: posBuf.length, target: 34962 },
    { buffer: 0, byteOffset: posBuf.length, byteLength: uvBuf.length, target: 34962 },
    { buffer: 0, byteOffset: posBuf.length + uvBuf.length, byteLength: idxBuf.length, target: 34963 },
  ],
  accessors: [
    { bufferView: 0, componentType: 5126, count: cp.length / 3, type: 'VEC3', min, max },
    { bufferView: 1, componentType: 5126, count: cu.length / 2, type: 'VEC2' },
    { bufferView: 2, componentType: 5125, count: finalIdx.length, type: 'SCALAR' },
  ],
};
await writeFile(dst, pack(outDoc, Buffer.concat([posBuf, uvBuf, idxBuf])));
console.log(JSON.stringify({ source: src, before: I.length / 3, vertices: Pf.length / 3, after: finalIdx.length / 3, error, method }));
