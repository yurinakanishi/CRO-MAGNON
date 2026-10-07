// Give a UV-preserving meshopt reduction the dense TRELLIS material: the same
// albedo and metallic-roughness PNG bytes, addressed by the unchanged UVs.
// node attach_dense_material.mjs <dense.glb> <low.glb> <out.glb>
import { readFile, writeFile } from 'node:fs/promises';
import { unpack, pack } from '../../../scripts/motion-glb.mjs';

const [densePath, lowPath, outPath] = process.argv.slice(2);
const dense = unpack(await readFile(densePath));
const low = unpack(await readFile(lowPath));
const doc = low.doc;
const pad = (b) => Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4)]);
let binary = pad(Buffer.from(low.binary.subarray(0, doc.buffers[0].byteLength)));
const images = [];
for (const image of dense.doc.images) {
  const view = dense.doc.bufferViews[image.bufferView];
  const bytes = dense.binary.subarray(
    view.byteOffset ?? 0,
    (view.byteOffset ?? 0) + view.byteLength,
  );
  doc.bufferViews.push({ buffer: 0, byteOffset: binary.length, byteLength: bytes.length });
  images.push({ bufferView: doc.bufferViews.length - 1, mimeType: image.mimeType });
  binary = pad(Buffer.concat([binary, bytes]));
}
doc.images = images;
doc.samplers = structuredClone(dense.doc.samplers ?? [{}]);
doc.textures = structuredClone(dense.doc.textures);
doc.materials = structuredClone(dense.doc.materials);
for (const mesh of doc.meshes) for (const p of mesh.primitives) p.material = 0;
doc.buffers[0].byteLength = binary.length;
await writeFile(outPath, pack(doc, binary));
console.log(JSON.stringify({ out: outPath, images: images.length, bytes: binary.length }));
