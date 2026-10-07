// Adopt a normal-map-only upgrade of a delivered static GLB (scripts/remake/normal_upgrade.py +
// inject_normal_map.py). The geometry stays byte-identical, so measured data hashed from the GLB (walk
// atlases, camera grids, collision bounds) stays valid; this script re-proves that before swapping.
// node scripts/remake/adopt_normal_injection.mjs <key> <injected.glb> <normal-report.json> <fit-matrix.json>
//      [--hash-file shared/castle-surface-data.mts ...]
// Each --hash-file has its old GLB SHA-256 replaced by the new one, and gains "measuredFromSha256" (the GLB the
// data was measured from) when it is a JSON-literal "sourceSha256" record.
import { readFile, writeFile, copyFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';

const [key, injected, normalReport, fitMatrix, ...rest] = process.argv.slice(2);
const hashFiles = [];
for (let i = 0; i < rest.length; i++) if (rest[i] === '--hash-file') hashFiles.push(rest[++i]);
const root = path.resolve(import.meta.dirname, '../..');
const hash = (b) => createHash('sha256').update(b).digest('hex');
const exists = async (p) => access(p).then(() => true, () => false);

function parse(bytes) {
  const jlen = bytes.readUInt32LE(12);
  const doc = JSON.parse(bytes.subarray(20, 20 + jlen).toString());
  const blen = bytes.readUInt32LE(20 + jlen);
  const bin = bytes.subarray(28 + jlen, 28 + jlen + blen);
  return { doc, bin };
}
const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const SIZE = { 5126: 4, 5125: 4, 5123: 2, 5121: 1, 5122: 2, 5120: 1 };
function accessorBytes({ doc, bin }, i) {
  const a = doc.accessors[i];
  const v = doc.bufferViews[a.bufferView];
  const o = (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
  return bin.subarray(o, o + a.count * COMPONENTS[a.type] * SIZE[a.componentType]);
}

const manifestPath = path.join(root, 'public/models/world-assets.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const entry = manifest.assets.find((a) => a.modelKey === key);
assert.ok(entry, `no manifest entry for ${key}`);
const oldFile = path.join(root, 'public', entry.url.replace(/^\//, ''));
const oldBytes = await readFile(oldFile);
const newBytes = await readFile(injected);
const oldSha = hash(oldBytes);
const newSha = hash(newBytes);
assert.equal(oldSha, entry.sha256, 'the manifest must describe the delivered file');
const before = parse(oldBytes);
const after = parse(newBytes);
assert.deepEqual(after.doc.accessors, before.doc.accessors, 'accessor table unchanged');
assert.deepEqual(after.doc.meshes, before.doc.meshes, 'mesh primitives unchanged');
assert.deepEqual(after.doc.nodes, before.doc.nodes, 'node transforms unchanged');
let checked = 0;
for (const mesh of before.doc.meshes)
  for (const p of mesh.primitives)
    for (const idx of [...Object.values(p.attributes), ...(p.indices !== undefined ? [p.indices] : [])]) {
      assert.ok(accessorBytes(before, idx).equals(accessorBytes(after, idx)), `accessor ${idx} bytes differ`);
      checked++;
    }
assert.ok(after.doc.materials.every((m) => m.normalTexture), 'every material has the baked normal map');

const name = `model-${entry.revision ? `r${entry.revision}` : `c${entry.candidate ?? 1}`}-normal.glb`;
const target = path.join(path.dirname(oldFile), name);
if (await exists(target)) assert.equal(hash(await readFile(target)), newSha, `refusing to overwrite ${target}`);
else await copyFile(injected, target);
const report = JSON.parse(await readFile(normalReport, 'utf8'));
const fit = JSON.parse(await readFile(fitMatrix, 'utf8'));
const denseSha = hash(await readFile(report.dense));
const upgrade = {
  method:
    'Tangent-space normal map baked from the TRELLIS dense surface (similarity-ICP placed on the delivered mesh, scripts/remake/fit_to_delivered.py) onto the delivered UVs and normals (scripts/remake/normal_upgrade.py), injected as an appended WebP image + normalTexture (scripts/remake/inject_normal_map.py). Geometry bytes unchanged.',
  date: '2026-10-07',
  previousGlb: { url: entry.url, sha256: oldSha, bytes: oldBytes.length },
  dense: report.dense,
  denseSha256: denseSha,
  fit: { rmsMetres: fit.rms_m, p95Metres: fit.p95_m, scale: fit.scale },
  bake: {
    size: report.size,
    islandTexels: report.island_texels,
    firstPassMisses: report.first_pass_misses,
    neighbourFilled: report.neighbour_filled,
    flippedBackfacing: report.flipped_backfacing_normals,
    extrusionFrac: report.extrusion_frac,
  },
  geometryAccessorsCompared: checked,
  geometryIdentical: true,
};
const updated = {
  ...entry,
  url: `/models/${key}/${name}`,
  sha256: newSha,
  bytes: newBytes.length,
  status: 'remake-normal-upgrade-integrated',
  normalUpgrade: upgrade,
};
manifest.assets[manifest.assets.indexOf(entry)] = updated;
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
const perModelPath = path.join(path.dirname(oldFile), 'asset.json');
if (await exists(perModelPath)) {
  const perModel = JSON.parse(await readFile(perModelPath, 'utf8'));
  await writeFile(perModelPath, JSON.stringify({ ...perModel, ...updated }, null, 2) + '\n');
}
const boundsPath = path.join(root, 'shared/model-bounds.mts');
const bounds = await readFile(boundsPath, 'utf8');
if (bounds.includes(oldSha)) await writeFile(boundsPath, bounds.split(oldSha).join(newSha));
const hashUpdates = [];
for (const file of hashFiles) {
  const full = path.join(root, file);
  let text = await readFile(full, 'utf8');
  const count = text.split(oldSha).length - 1;
  assert.ok(count > 0, `${file} does not reference ${oldSha}`);
  const record = `"sourceSha256":"${oldSha}"`;
  text = text.includes(record)
    ? text.split(record).join(`"sourceSha256":"${newSha}","measuredFromSha256":"${oldSha}"`)
    : text.split(oldSha).join(newSha);
  await writeFile(full, text);
  hashUpdates.push({ file, references: count });
}
console.log(JSON.stringify({ key, url: updated.url, oldSha, newSha, bytes: newBytes.length, checked, hashUpdates }, null, 1));
