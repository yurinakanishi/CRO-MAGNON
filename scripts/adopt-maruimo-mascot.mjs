// Derive a small companion without changing source geometry, skin or motion buffers.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { unpack, pack, loadMotion } from './motion-glb.mjs';
const hash = (b) => createHash('sha256').update(b).digest('hex');
const save = (p, v) => writeFile(p, JSON.stringify(v, null, 2) + '\n');
const original = JSON.parse(await readFile('public/models/maruimo-octopus/asset.json'));
const scale = 0.55 / original.heightMetres;
const directory = 'public/models/maruimo-mascot';
await mkdir(directory, { recursive: true });
await mkdir('assets/maruimo-mascot', { recursive: true });
const source = await loadMotion('public' + original.url);
const head = source.scene.getObjectByName('Head');
assert.ok(head, 'Source must retain the animated Head bone');
const top = head.worldToLocal(new THREE.Vector3(0, original.heightMetres * 0.97, 0));
async function derive(record, file) {
  const bytes = await readFile('public' + record.url);
  assert.equal(hash(bytes), record.sha256);
  const { doc, binary } = unpack(bytes);
  for (const scene of doc.scenes) {
    const root = doc.nodes.length;
    doc.nodes.push({ name: 'MascotScale', scale: [scale, scale, scale], children: scene.nodes });
    scene.nodes = [root];
  }
  const headIndex = doc.nodes.findIndex((n) => n.name === 'Head');
  if (headIndex >= 0) {
    const socket = doc.nodes.length;
    doc.nodes.push({ name: 'PetContact', translation: top.toArray() });
    (doc.nodes[headIndex].children ??= []).push(socket);
  }
  const derived = pack(doc, binary);
  assert.deepEqual(unpack(derived).binary, binary);
  await writeFile(directory + '/' + file, derived);
  return {
    ...record,
    url: '/models/maruimo-mascot/' + file,
    sha256: hash(derived),
    bytes: derived.length,
  };
}
const main = await derive(original, 'model-r01.glb');
const lod = await derive(original.lods[0], 'lod-r01.glb');
await copyFile('public/models/maruimo-octopus/portrait.png', directory + '/portrait.png');
const portrait = await readFile(directory + '/portrait.png');
const asset = {
  modelKey: 'maruimo-mascot',
  name: 'まるぃも',
  kind: 'companion',
  revision: '01',
  status: 'integrated',
  gameQA: 'output/playwright/maruimo-mascot-20261007/mmo-assets-r03/summary.json',
  url: main.url,
  sha256: main.sha256,
  bytes: main.bytes,
  triangles: original.triangles,
  bones: original.bones,
  upAxis: 'Y',
  forwardAxis: '+Z',
  heightMetres: 0.55,
  widthMetres: original.widthMetres * scale,
  lengthMetres: (original.placement.max[2] - original.placement.min[2]) * scale,
  placement: { pivot: 'ground-centred', scale: 1 },
  portrait: { url: '/models/maruimo-mascot/portrait.png', sha256: hash(portrait) },
  clips: original.clips,
  locomotion: Object.fromEntries(
    Object.entries(original.locomotion).map(([key, value]) => [
      key,
      {
        ...value,
        metresPerSecond: value.metresPerSecond * scale,
        strideMetres: value.strideMetres * scale,
        stanceTravelMetres: value.stanceTravelMetres * scale,
      },
    ]),
  ),
  lods: [{ ...lod, distanceMetres: 8 }],
  provenance: {
    sourceSha256: original.sha256,
    sourceLodSha256: original.lods[0].sha256,
    uniformScale: scale,
    method:
      'One scene parent scale and an animated head contact socket. All source binary buffers are unchanged.',
  },
};
await save(directory + '/asset.json', asset);
await save('assets/maruimo-mascot/source-record.json', {
  source: original.url,
  sha256: original.sha256,
  scale,
  contact: top.toArray(),
});
const world = JSON.parse(await readFile('public/models/world-assets.json'));
const i = world.assets.findIndex((a) => a.modelKey === asset.modelKey);
if (i >= 0) world.assets[i] = asset;
else world.assets.push(asset);
await save('public/models/world-assets.json', world);
const catalog = JSON.parse(await readFile('assets/world-models.json'));
const entry = {
  key: asset.modelKey,
  name: asset.name,
  kind: asset.kind,
  height: asset.heightMetres,
  status: asset.status,
  delivery: asset.url,
  sha256: asset.sha256,
  triangles: asset.triangles,
};
const j = catalog.assets.findIndex((a) => a.key === asset.modelKey);
if (j >= 0) catalog.assets[j] = entry;
else catalog.assets.push(entry);
await save('assets/world-models.json', catalog);
console.log(
  JSON.stringify({ asset: asset.modelKey, scale, contact: top.toArray(), sha256: asset.sha256 }),
);
