// Pack the Blender-edited surface into the original GLB, preserving the exact
// armature, inverse binds, five animation clips, and original binary prefix.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { unpack, pack } from './motion-glb.mjs';
const revision = process.argv[2] || '11';
const dir = `output/mammoth-tail/revision-${revision}`;
const source = await readFile('public/models/woolly-mammoth/model-motion-r04.glb');
const { doc, binary } = unpack(source);
const mesh = JSON.parse(await readFile(`${dir}/mesh.json`, 'utf8'));
const parts = [binary];
let offset = binary.length;
function view(bytes, target) {
  const pad = (4 - (offset % 4)) % 4;
  if (pad) {
    parts.push(Buffer.alloc(pad));
    offset += pad;
  }
  const index = doc.bufferViews.length;
  doc.bufferViews.push({
    buffer: 0,
    byteOffset: offset,
    byteLength: bytes.length,
    ...(target ? { target } : {}),
  });
  parts.push(bytes);
  offset += bytes.length;
  return index;
}
function accessor(array, type, componentType, target, bounds = false) {
  const a = {
    bufferView: view(Buffer.from(array.buffer), target),
    componentType,
    count: array.length / { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[type],
    type,
  };
  if (bounds) {
    a.min = [Infinity, Infinity, Infinity];
    a.max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < array.length; i++) {
      a.min[i % 3] = Math.min(a.min[i % 3], array[i]);
      a.max[i % 3] = Math.max(a.max[i % 3], array[i]);
    }
  }
  doc.accessors.push(a);
  return doc.accessors.length - 1;
}
const joint = new Map(doc.skins[0].joints.map((node, i) => [doc.nodes[node].name, i]));
const positions = [],
  normals = [],
  uv = [],
  joints = [],
  weights = [],
  indices = [[], []],
  seen = new Map();
for (const tri of mesh.triangles) {
  for (const [id, n, tex] of tri.corners) {
    const key = JSON.stringify([id, n, tex]);
    let index = seen.get(key);
    if (index === undefined) {
      index = positions.length / 3;
      seen.set(key, index);
      positions.push(...mesh.vertices[id].p);
      normals.push(...n);
      uv.push(...tex);
      const w = mesh.vertices[id].weights
        .filter(([, value]) => value > 1e-7)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4);
      const sum = w.reduce((s, v) => s + v[1], 0);
      assert.ok(sum > 0);
      for (let k = 0; k < 4; k++) {
        const bone = w[k] ? joint.get(mesh.groups[w[k][0]]) : 0;
        assert.ok(bone !== undefined, 'known original skin joint');
        joints.push(bone);
        weights.push(w[k] ? w[k][1] / sum : 0);
      }
    }
    indices[tri.material].push(index);
  }
}
const attributes = {
  POSITION: accessor(new Float32Array(positions), 'VEC3', 5126, 34962, true),
  NORMAL: accessor(new Float32Array(normals), 'VEC3', 5126, 34962),
  TEXCOORD_0: accessor(new Float32Array(uv), 'VEC2', 5126, 34962),
  JOINTS_0: accessor(new Uint16Array(joints), 'VEC4', 5123, 34962),
  WEIGHTS_0: accessor(new Float32Array(weights), 'VEC4', 5126, 34962),
};
const image = doc.images.length;
doc.images.push({
  bufferView: view(await readFile(`${dir}/fur-bake.png`)),
  mimeType: 'image/png',
  name: 'Blender fur bake from original mammoth flank',
});
const texture = doc.textures.length;
doc.textures.push({ source: image, sampler: doc.textures[0].sampler });
const material = structuredClone(doc.materials[0]);
material.name = 'Blender repaired rump and tail';
material.pbrMetallicRoughness.baseColorTexture.index = texture;
doc.materials.push(material);
doc.meshes[0].primitives = indices.map((list, i) => ({
  attributes,
  material: i,
  indices: accessor(new Uint32Array(list), 'SCALAR', 5125, 34963),
}));
doc.buffers[0].byteLength = offset;
const bytes = pack(doc, Buffer.concat(parts));
await writeFile(`${dir}/model.glb`, bytes);
const record = {
  revision,
  sha256: createHash('sha256').update(bytes).digest('hex'),
  bytes: bytes.length,
  sourceSha256: createHash('sha256').update(source).digest('hex'),
  vertices: positions.length / 3,
  triangles: indices.reduce((s, a) => s + a.length / 3, 0),
  originalBinaryPrefix: binary.length,
  unchanged: ['nodes', 'skins', 'animations'],
  changed: [
    'rear surface topology',
    'tail geometry',
    'local skin weights',
    'normals',
    'repair fur bake',
  ],
};
await writeFile(`${dir}/build.json`, JSON.stringify(record, null, 2) + '\n');
console.log(record);
