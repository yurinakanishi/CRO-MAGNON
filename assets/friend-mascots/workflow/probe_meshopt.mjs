import { readFile } from 'node:fs/promises';
import { MeshoptSimplifier } from 'meshoptimizer';
import { unpack } from '../../../scripts/motion-glb.mjs';
const { doc, binary } = unpack(await readFile(process.argv[2]));
const read = (i) => {
  const a = doc.accessors[i],
    v = doc.bufferViews[a.bufferView];
  const T = { 5126: Float32Array, 5125: Uint32Array }[a.componentType];
  const n = a.count * { VEC3: 3, VEC2: 2, SCALAR: 1 }[a.type];
  return new T(
    binary.buffer.slice(
      binary.byteOffset + (v.byteOffset ?? 0) + (a.byteOffset ?? 0),
      binary.byteOffset + (v.byteOffset ?? 0) + (a.byteOffset ?? 0) + n * T.BYTES_PER_ELEMENT,
    ),
  );
};
const p = doc.meshes[0].primitives[0];
const P = read(p.attributes.POSITION),
  U = read(p.attributes.TEXCOORD_0),
  I = read(p.indices);
await MeshoptSimplifier.ready;
for (const t of [30000, 50000, 80000])
  for (const err of [0.01, 0.05]) {
    const [out, e] = MeshoptSimplifier.simplify(I, P, 3, t * 3, err, []);
    console.log('plain', t, err, out.length / 3, e.toFixed(4));
  }
const [o2, e2] = MeshoptSimplifier.simplifyWithAttributes(
  I,
  P,
  3,
  U,
  2,
  [1, 1],
  null,
  30000 * 3,
  0.01,
  [],
);
console.log('attr-strict', o2.length / 3, e2);
