// Geometry-only actor LODs with the exact source joint order and primitive order.
import { readFile, writeFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { MeshoptSimplifier } from 'meshoptimizer';
import { unpack, pack } from './motion-glb.mjs';
import { attribute, widths } from './female-face-geometry.mjs';
const revision = process.argv[2] || '10';
await MeshoptSimplifier.ready;
for (const key of process.argv[3] ? [process.argv[3]] : ['cro-magnon-woman', 'neanderthal-woman']) {
  const dir = `assets/female-face-repair/${key}/work/revision-${revision}`,
    file = `${dir}/lod.glb`,
    source = await readFile(`${dir}/model.glb`),
    { doc: a, binary } = unpack(source),
    build = JSON.parse(await readFile(`${dir}/build.json`));
  try {
    await access(file);
    throw Error('Refusing overwrite ' + file);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  const doc = {
      asset: { version: '2.0', generator: 'Source-derived meshoptimizer female face LOD' },
      scene: a.scene,
      scenes: a.scenes,
      nodes: a.nodes,
      skins: structuredClone(a.skins),
      meshes: [{ name: a.meshes[0].name, primitives: [] }],
      animations: [],
      materials: [{ name: 'Body geometry slot' }, { name: 'Head geometry slot' }],
      accessors: [],
      bufferViews: [],
      buffers: [{ byteLength: 0 }],
    },
    parts = [],
    records = [];
  let offset = 0;
  const add = (values, type, component = 5126) => {
    const array =
        component === 5125
          ? new Uint32Array(values)
          : component === 5123
            ? new Uint16Array(values)
            : new Float32Array(values),
      bytes = Buffer.from(array.buffer),
      padding = (4 - (offset % 4)) % 4;
    parts.push(Buffer.alloc(padding));
    offset += padding;
    const view = doc.bufferViews.length;
    doc.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length });
    parts.push(bytes);
    offset += bytes.length;
    const item = {
      bufferView: view,
      componentType: component,
      count: values.length / widths[type],
      type,
    };
    if (type === 'VEC3') {
      item.min = [Infinity, Infinity, Infinity];
      item.max = [-Infinity, -Infinity, -Infinity];
      values.forEach((v, i) => {
        item.min[i % 3] = Math.min(item.min[i % 3], v);
        item.max[i % 3] = Math.max(item.max[i % 3], v);
      });
    }
    doc.accessors.push(item);
    return doc.accessors.length - 1;
  };
  for (const skin of doc.skins)
    skin.inverseBindMatrices = add(attribute(a, binary, skin.inverseBindMatrices).flat(), 'MAT4');
  for (const [material, prim] of a.meshes[0].primitives.entries()) {
    const values = Object.fromEntries(
        Object.entries(prim.attributes).map(([k, id]) => [k, attribute(a, binary, id)]),
      ),
      input = new Uint32Array(attribute(a, binary, prim.indices).flat()),
      p = new Float32Array(values.POSITION.flat()),
      attrs = new Float32Array(
        values.POSITION.flatMap((_, i) => [...values.NORMAL[i], ...values.TEXCOORD_0[i]]),
      ),
      locks = new Uint8Array(
        values.POSITION.map((p) => (Math.abs(p[1] - build.config.cutY) < 1e-5 ? 1 : 0)),
      );
    const [indices, error] = MeshoptSimplifier.simplifyWithAttributes(
      input,
      p,
      3,
      attrs,
      5,
      [0.25, 0.25, 0.25, 1, 1],
      locks,
      Math.floor((input.length * 0.08) / 3) * 3,
      0.03,
      ['Permissive', 'LockBorder'],
    );
    const remap = new Map(),
      ids = [];
    for (const old of indices) {
      if (!remap.has(old)) remap.set(old, remap.size);
      ids.push(remap.get(old));
    }
    const attributes = {};
    for (const [name, rows] of Object.entries(values)) {
      const accessor = a.accessors[prim.attributes[name]];
      attributes[name] = add(
        [...remap.keys()].flatMap((i) => rows[i]),
        accessor.type,
        accessor.componentType,
      );
    }
    doc.meshes[0].primitives.push({ attributes, indices: add(ids, 'SCALAR', 5125), material });
    records.push({
      primitive: material,
      before: input.length / 3,
      after: indices.length / 3,
      error,
      lockedNeckVertices: locks.reduce((s, x) => s + x, 0),
    });
  }
  assert.ok(records.every((r) => r.after < r.before * 0.3));
  doc.buffers[0].byteLength = offset;
  const bytes = pack(doc, Buffer.concat(parts));
  await writeFile(file, bytes);
  const report = {
    key,
    revision,
    sourceSha256: createHash('sha256').update(source).digest('hex'),
    sha256: createHash('sha256').update(bytes).digest('hex'),
    bytes: bytes.length,
    records,
    jointOrder: 'identical to adopted model',
    primitiveOrder: 'body then head',
    clips: 0,
  };
  await writeFile(`${dir}/lod.json`, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
}
