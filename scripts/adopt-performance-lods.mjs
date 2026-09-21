import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';

const ACTORS = [
  'cro-magnon-woman',
  'cro-magnon-hunter',
  'neanderthal-woman',
  'neanderthal-hunter',
  'cat-kunoichi',
  'desert-fennec-mage',
  'giant-ape',
  'crow-shaman',
  'violet-behemoth',
  'sabertooth-tiger',
  'woolly-mammoth',
];
const PROPS = ['berry-bush', 'hide-tent', 'firewood-pile', 'stone-firepit'];
const KEYS = [...ACTORS, ...PROPS, 'camp-mountain'];
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const save = (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n');

const worldPath = 'public/models/world-assets.json';
const world = JSON.parse(await readFile(worldPath, 'utf8'));
const records = [];

for (const key of KEYS) {
  const assetPath = `public/models/${key}/asset.json`;
  const asset = JSON.parse(await readFile(assetPath, 'utf8'));
  assert.equal(asset.modelKey, key);
  const file = `public/models/${key}/lod-performance.glb`;
  const bytes = await readFile(file);
  const inspection = JSON.parse(
    execFileSync(process.execPath, ['scripts/inspect-glb.mjs', file], { encoding: 'utf8' }),
  );
  assert.equal(inspection.validation, 'passed');
  assert.ok(inspection.triangles < asset.triangles / 4, `${key}: LOD must be below 25%`);
  assert.ok(inspection.triangles > asset.triangles / 14, `${key}: LOD is too coarse`);
  if (ACTORS.includes(key)) {
    assert.ok(inspection.skins.length > 0, `${key}: actor LOD lost its skin attributes`);
    assert.equal(inspection.animations.length, 0, `${key}: actor LOD must not duplicate clips`);
  } else assert.equal(inspection.animations.length, 0);
  const lod = {
    url: `/models/${key}/lod-performance.glb`,
    sha256: sha256(bytes),
    bytes: bytes.length,
    triangles: inspection.triangles,
    distanceMetres: key === 'camp-mountain' ? 100 : ACTORS.includes(key) ? 28 : 14,
    purpose: ACTORS.includes(key) ? 'animated-medium-lod-geometry' : 'medium-distance-lod',
  };
  asset.lods = [lod];
  asset.notes ??= [];
  const note = ACTORS.includes(key)
    ? `Source-derived ${lod.triangles.toLocaleString('en-US')}-triangle animated LOD is used beyond 28 m; the adopted close model, skeleton, clips, materials and collision are unchanged.`
    : key === 'camp-mountain'
      ? `Source-derived ${lod.triangles.toLocaleString('en-US')}-triangle LOD is used outside the camp/cave detail area, including views from the castle; the measured gameplay height field is unchanged.`
      : `Source-derived ${lod.triangles.toLocaleString('en-US')}-triangle medium LOD is used from 14 m; the adopted close model and collision are unchanged.`;
  if (!asset.notes.includes(note)) asset.notes.push(note);
  await save(assetPath, asset);
  const worldIndex = world.assets.findIndex((entry) => entry.modelKey === key);
  if (worldIndex >= 0) world.assets[worldIndex] = asset;
  records.push({ key, mainTriangles: asset.triangles, ...lod });
}

await save(worldPath, world);
await save('docs/performance-lods-2026-09-21.json', {
  status: 'generated-pending-runtime-verification',
  createdAt: new Date().toISOString(),
  method:
    'Blender 5.2 source-derived QEM on the adopted GLBs; close files retained byte-for-byte. Actor runtime reuses the adopted materials and animation skeleton with reduced geometry.',
  records,
});
console.log(JSON.stringify({ status: 'adopted', models: records.length, records }, null, 2));
