// Preserve source vertex attributes and UV seams while reducing head triangles.
import { writeFile, access } from 'node:fs/promises';
import { MeshoptSimplifier } from 'meshoptimizer';
import { readSurface } from './female-face-geometry.mjs';
import { pack } from './motion-glb.mjs';
const [source, destination, ratioText = '.12', errorText = '.005'] = process.argv.slice(2);
try {
  await access(destination);
  throw Error('Refusing to overwrite ' + destination);
} catch (e) {
  if (e.code !== 'ENOENT') throw e;
}
const s = await readSurface(source),
  { doc, binary } = s;
await MeshoptSimplifier.ready;
const positions = new Float32Array(s.vertices.flatMap((v) => v.p));
const attributes = new Float32Array(s.vertices.flatMap((v) => [...v.n, ...v.uv]));
const input = new Uint32Array(s.triangles.flatMap((t) => t.ids));
const locks = new Uint8Array(
  s.vertices.map((v) =>
    v.p[2] > 0.1 && v.p[1] > -0.24 && v.p[1] < 0.3 && Math.abs(v.p[0]) < 0.24 ? 1 : 0,
  ),
);
const permissive = process.argv.includes('--permissive'),
  weights = [0.5, 0.5, 0.5, ...(permissive ? [2, 2] : [10, 10])],
  flags = permissive ? ['LockBorder', 'Permissive'] : ['LockBorder'];
const [indices, error] = MeshoptSimplifier.simplifyWithAttributes(
  input,
  positions,
  3,
  attributes,
  5,
  weights,
  locks,
  Math.floor((input.length * Number(ratioText)) / 3) * 3,
  Number(errorText),
  flags,
);
const offset = Math.ceil(binary.length / 4) * 4,
  bytes = Buffer.from(indices.buffer);
doc.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, target: 34963 });
doc.accessors.push({
  bufferView: doc.bufferViews.length - 1,
  componentType: 5125,
  count: indices.length,
  type: 'SCALAR',
});
doc.meshes[0].primitives[0].indices = doc.accessors.length - 1;
doc.buffers[0].byteLength = offset + bytes.length;
await writeFile(
  destination,
  pack(doc, Buffer.concat([binary, Buffer.alloc(offset - binary.length), bytes])),
);
const report = {
  source,
  destination,
  engine: 'meshoptimizer 1.1.1',
  before: input.length / 3,
  after: indices.length / 3,
  error,
  flags,
  lockedFacialVertices: locks.reduce((s, n) => s + n, 0),
  attributeWeights: weights,
  retainedVertexAttributes: 'exact original values',
};
await writeFile(destination.replace(/\.glb$/, '.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
