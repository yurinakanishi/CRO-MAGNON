// Follow the existing braid's authored skin weights below the moving head.
import { readFile, writeFile, mkdir, access, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { unpack, pack } from './motion-glb.mjs';
import { readSurface, attribute, mixVertex } from './female-face-geometry.mjs';
const from = process.argv[2] || '08',
  revision = process.argv[3] || '10';
const hash = (b) => createHash('sha256').update(b).digest('hex');
for (const key of ['cro-magnon-woman', 'neanderthal-woman']) {
  const base = `assets/female-face-repair/${key}/work`,
    out = `${base}/revision-${revision}`;
  await mkdir(out, { recursive: true });
  const file = `${out}/model.glb`;
  try {
    await access(file);
    throw Error('Refusing overwrite ' + file);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  const bytes = await readFile(`${base}/revision-${from}/model.glb`),
    { doc, binary } = unpack(bytes),
    build = JSON.parse(await readFile(`${base}/revision-${from}/build.json`));
  let changed = 0,
    result = bytes;
  if (key === 'cro-magnon-woman') {
    const source = await readSurface(build.source),
      prim = doc.meshes[0].primitives[1],
      p = attribute(doc, binary, prim.attributes.POSITION),
      j = attribute(doc, binary, prim.attributes.JOINTS_0),
      w = attribute(doc, binary, prim.attributes.WEIGHTS_0),
      hair = source.vertices.filter(
        (v) => v.p[2] < -0.18 && v.p[1] > 1.3 && v.p[1] < 1.54 && Math.abs(v.p[0]) < 0.09,
      );
    for (let i = 0; i < p.length; i++) {
      if (p[i][2] >= -0.19 || p[i][1] >= 1.5) continue;
      let closest,
        minimum = Infinity;
      for (const v of hair) {
        const d = v.p.reduce((s, x, k) => s + (x - p[i][k]) ** 2, 0);
        if (d < minimum) {
          minimum = d;
          closest = v;
        }
      }
      let t = Math.max(0, Math.min(1, (1.5 - p[i][1]) / 0.07));
      t = t * t * (3 - 2 * t);
      const v = mixVertex({ p: p[i], n: [0, 1, 0], uv: [0, 0], j: j[i], w: w[i] }, closest, t);
      j[i] = v.j;
      w[i] = v.w;
      changed++;
    }
    const parts = [binary];
    let offset = binary.length;
    for (const [name, values, type] of [
      ['JOINTS_0', j, 5123],
      ['WEIGHTS_0', w, 5126],
    ]) {
      const pad = (4 - (offset % 4)) % 4;
      parts.push(Buffer.alloc(pad));
      offset += pad;
      const array =
          type === 5123 ? new Uint16Array(values.flat()) : new Float32Array(values.flat()),
        data = Buffer.from(array.buffer);
      doc.bufferViews.push({
        buffer: 0,
        byteOffset: offset,
        byteLength: data.length,
        target: 34962,
      });
      doc.accessors.push({
        bufferView: doc.bufferViews.length - 1,
        componentType: type,
        count: values.length,
        type: 'VEC4',
      });
      prim.attributes[name] = doc.accessors.length - 1;
      parts.push(data);
      offset += data.length;
    }
    doc.buffers[0].byteLength = offset;
    result = pack(doc, Buffer.concat(parts));
  }
  await writeFile(file, result);
  await copyFile(`${base}/revision-${from}/portrait.png`, `${out}/portrait.png`);
  Object.assign(build, {
    revision,
    sha256: hash(result),
    bytes: result.length,
    hairBinding: {
      sourceRevision: from,
      sourceSha256: hash(bytes),
      vertices: changed,
      method:
        'Existing nearest braid skin weights below 1.5 m; smooth transition over 7 cm. No positions, normals, UVs, materials or clips changed.',
    },
  });
  await writeFile(`${out}/build.json`, JSON.stringify(build, null, 2) + '\n');
  console.log(JSON.stringify({ key, revision, sha256: build.sha256, vertices: changed }));
}
