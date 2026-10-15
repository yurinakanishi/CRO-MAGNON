// Repair skin weights on the ten adopted large-headed characters. Their TRELLIS
// surface, textures, bind skeleton and animation bytes remain exactly as authored.
// The chest-to-head-surface interval blends the neck seam into a rigid skull.
// node scripts/face-remake/stabilize-chibi-heads.mjs <new staging directory>
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import * as T from 'three';
import { loadMotion, unpack } from '../motion-glb.mjs';

export const CHIBI_FACE_KEYS = [
  'cro-magnon-woman',
  'cro-magnon-girl-feather',
  'cro-magnon-girl-bear',
  'cro-magnon-girl-wolf',
  'cro-magnon-girl-twintails',
  'cro-magnon-girl-reindeer',
  'cro-magnon-boy-headband',
  'cro-magnon-boy-lion',
  'cro-magnon-boy-braid',
  'cro-magnon-boy-topknot',
];
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const json = (value) => JSON.stringify(value, null, 2) + '\n';

/** Only write JOINTS_0 and WEIGHTS_0. Applying the same height rule to every
 * primitive keeps coincident neck vertices together across material seams. */
export function stabilizeHeadWeights(source, low, high) {
  assert.ok(Number.isFinite(low) && high > low, 'measured neck/head interval');
  const bytes = Buffer.from(source),
    { doc } = unpack(bytes);
  const binaryOffset = 28 + bytes.readUInt32LE(12);
  const allowed = new Uint8Array(bytes.length);
  const accessor = (id, width) => {
    const a = doc.accessors[id],
      view = doc.bufferViews[a.bufferView];
    assert.ok(!a.sparse && !view.extensions, 'uncompressed source accessor');
    const spec = {
      5121: [1, 'readUInt8', 'writeUInt8', 255],
      5123: [2, 'readUInt16LE', 'writeUInt16LE', 65535],
      5126: [4, 'readFloatLE', 'writeFloatLE', 1],
    }[a.componentType];
    assert.ok(spec, 'supported component type');
    const [size, read, write, maximum] = spec;
    const scale = a.normalized ? maximum : 1;
    const offset = binaryOffset + (view.byteOffset ?? 0) + (a.byteOffset ?? 0);
    const at = (i, k) => offset + i * (view.byteStride ?? width * size) + k * size;
    return {
      count: a.count,
      scale,
      read: (i, k) => bytes[read](at(i, k)) / scale,
      write: (i, k, v) => {
        bytes[write](a.normalized ? Math.round(v * scale) : v, at(i, k));
        allowed.fill(1, at(i, k), at(i, k) + size);
      },
    };
  };
  const changed = [];
  const visited = new Set();
  for (const node of doc.nodes.filter((n) => n.mesh !== undefined && n.skin !== undefined)) {
    const skin = doc.skins[node.skin];
    const head = skin.joints.findIndex((i) => doc.nodes[i].name === 'Head');
    assert.ok(head >= 0, 'Head joint');
    for (const primitive of doc.meshes[node.mesh].primitives) {
      const a = primitive.attributes;
      if (visited.has(a.WEIGHTS_0)) continue;
      visited.add(a.WEIGHTS_0);
      const p = accessor(a.POSITION, 3),
        j = accessor(a.JOINTS_0, 4),
        w = accessor(a.WEIGHTS_0, 4);
      let rigid = 0,
        blended = 0;
      for (let i = 0; i < p.count; i++) {
        const t = Math.min(1, Math.max(0, (p.read(i, 1) - low) / (high - low)));
        if (t === 0) continue;
        const h = t * t * (3 - 2 * t),
          weights = new Map([[head, h]]);
        for (let k = 0; k < 4; k++)
          weights.set(j.read(i, k), (weights.get(j.read(i, k)) ?? 0) + w.read(i, k) * (1 - h));
        const top = [...weights]
          .filter(([, weight]) => weight > 0)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 4);
        const sum = top.reduce((s, [, v]) => s + v, 0);
        const values = top.map(([, v]) => v / sum);
        if (w.scale > 1) {
          const q = values.map((v) => Math.round(v * w.scale));
          q[0] += w.scale - q.reduce((s, v) => s + v, 0);
          q.forEach((v, k) => (values[k] = v / w.scale));
        }
        for (let k = 0; k < 4; k++) {
          j.write(i, k, top[k]?.[0] ?? 0);
          w.write(i, k, values[k] ?? 0);
        }
        if (h === 1) rigid++;
        else blended++;
      }
      changed.push({
        material: doc.materials[primitive.material].name,
        vertices: p.count,
        rigid,
        blended,
      });
    }
  }
  for (let i = 0; i < bytes.length; i++)
    assert.ok(allowed[i] || bytes[i] === source[i], `only weights/joints may change (${i})`);
  return { bytes, changed };
}

async function stage(out) {
  assert.ok(out, 'new staging directory required');
  await mkdir(out, { recursive: true });
  const rows = [];
  for (const key of CHIBI_FACE_KEYS) {
    const manifestBytes = await readFile(`public/models/${key}/asset.json`);
    const asset = JSON.parse(manifestBytes),
      source = await readFile(`public${asset.url}`);
    assert.equal(hash(source), asset.sha256);
    assert.equal(source.length, asset.bytes);
    assert.equal(asset.lods?.length ?? 0, 0, 'current chibi source has one geometry level');
    const g = await loadMotion(source);
    const low = g.scene.getObjectByName('Chest').getWorldPosition(new T.Vector3()).y;
    // Hair and hoods extend below the Head joint. Keep the entire head surface
    // rigid; blending only above the neck leaves those lower triangles stretched.
    const { doc } = unpack(source);
    const headMaterial = doc.materials.findIndex((m) => m.name === 'HeadSurface');
    const headPrimitives = doc.meshes.flatMap((m) =>
      m.primitives.filter((p) => p.material === headMaterial),
    );
    assert.ok(headPrimitives.length, 'authored head surface');
    const high = Math.min(
      ...headPrimitives.map((p) => doc.accessors[p.attributes.POSITION].min[1]),
    );
    const { bytes, changed } = stabilizeHeadWeights(source, low, high);
    const dir = `${out}/${key}`;
    await mkdir(dir, { recursive: true });
    await writeFile(`${dir}/model.glb`, bytes, { flag: 'wx' });
    await writeFile(`${dir}/previous-manifest.json`, manifestBytes, { flag: 'wx' });
    const row = {
      key,
      candidate: asset.candidate,
      previous: {
        url: asset.url,
        sha256: asset.sha256,
        bytes: asset.bytes,
        revision: asset.revision,
      },
      low,
      high,
      changed,
      sha256: hash(bytes),
      bytes: bytes.length,
      sourcePreservedExceptSkinWeights: true,
    };
    await writeFile(`${dir}/repair.json`, json(row), { flag: 'wx' });
    rows.push(row);
    console.log(key, JSON.stringify({ low, high, sha256: row.sha256, changed }));
  }
  await writeFile(`${out}/repairs.json`, json(rows), { flag: 'wx' });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await stage(process.argv[2]);
