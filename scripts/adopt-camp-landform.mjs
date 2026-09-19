import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { geometryScene } from './measure-collision-bounds.mjs';
const [key, revision] = process.argv.slice(2);
assert.ok(['camp-cave', 'camp-mountain'].includes(key) && /^\d\d$/.test(revision));
const source = `assets/${key}/work/revision-${revision}/model.glb`;
const bytes = await readFile(source),
  hash = (b) => createHash('sha256').update(b).digest('hex');
const sha256 = hash(bytes),
  reviewPath = `assets/${key}/qa/adoption-r${revision}.json`;
const review = JSON.parse(await readFile(reviewPath, 'utf8'));
assert.equal(review.sha256, sha256);
assert.equal(review.decision, 'adopt');
assert.equal(review.visualGate, 'passed');
assert.equal(review.browserGate, 'passed');
const inspection = JSON.parse(
  execFileSync(process.execPath, ['scripts/inspect-glb.mjs', source], { encoding: 'utf8' }),
);
assert.equal(inspection.validation, 'passed');
assert.equal(inspection.animations.length, 0);
const gltf = await geometryScene(source),
  box = new THREE.Box3().setFromObject(gltf.scene),
  size = box.getSize(new THREE.Vector3());
const name = key === 'camp-cave' ? 'はじまりの壁画洞窟' : '白羽の丘陵';
const massif = key === 'camp-mountain' && Number(revision) >= 6;
const referenceImage = `assets/${key}/source/reference-v${massif ? 2 : 1}.png`;
const sourceGeometry = `assets/${key}/work/trellis/${massif ? 'massif-v2' : 'reduced'}-res1024-seed42.glb`;
const manifest = {
  modelKey: key,
  name,
  kind: 'static',
  candidate: massif ? 2 : 1,
  revision,
  status: 'reviewed-prototype',
  url: `/models/${key}/model-r${revision}.glb`,
  sha256,
  bytes: bytes.length,
  triangles: inspection.triangles,
  upAxis: 'Y',
  forwardAxis: '+Z',
  heightMetres: size.y,
  widthMetres: size.x,
  placement: { pivot: 'ground-centred', min: box.min.toArray(), max: box.max.toArray() },
  clips: [],
  lods: [],
  notes: review.notes,
  provenance: {
    provider: 'Codex',
    claudeUsed: false,
    referenceGenerator: 'Built-in imagegen',
    referenceImage,
    referenceSha256: hash(await readFile(referenceImage)),
    reconstruction:
      'Local TRELLIS.2 (GGUF/C++), 1024 geometry, seed 42, 512 texture flow, 2048 atlas',
    sourceGeometry,
    sourceGeometrySha256: hash(await readFile(sourceGeometry)),
    visualReview: reviewPath,
    modelWorkspace: `assets/${key}`,
    workflow:
      'Source image → TRELLIS.2 → source-preserving QEM → terrain fitting/UV/materials → exact GLB QA',
  },
};
const save = (p, v) => writeFile(p, JSON.stringify(v, null, 2) + '\n');
if (key === 'camp-cave') {
  const pigment = await readFile('assets/camp-cave/source/mural-v1.png');
  manifest.pigment = {
    url: '/models/camp-cave/mural.png',
    sha256: hash(pigment),
    bytes: pigment.length,
    source: 'assets/camp-cave/source/mural-v1.png',
    generator: 'Built-in imagegen',
    application: 'Projected onto existing interior wall triangles',
  };
}
await mkdir(`public/models/${key}`, { recursive: true });
await copyFile(source, `public${manifest.url}`, constants.COPYFILE_EXCL);
if (key === 'camp-cave') await copyFile(manifest.pigment.source, `public${manifest.pigment.url}`);
await save(`public/models/${key}/asset.json`, manifest);
const world = JSON.parse(await readFile('public/models/world-assets.json', 'utf8'));
world.assets = world.assets.filter((a) => a.modelKey !== key);
world.assets.push(manifest);
await save('public/models/world-assets.json', world);
const catalog = JSON.parse(await readFile('assets/world-models.json', 'utf8'));
catalog.assets = catalog.assets.filter((a) => a.key !== key);
catalog.assets.push({
  key,
  name,
  kind: 'static',
  height: size.y,
  status: 'adopted-awaiting-game-qa',
  geometryResolution: 1024,
  sha256,
  triangles: inspection.triangles,
  delivery: manifest.url,
  gameQA: `assets/${key}/README.md`,
});
await save('assets/world-models.json', catalog);
console.log(
  JSON.stringify({
    key,
    sha256,
    triangles: inspection.triangles,
    size: size.toArray(),
    bytes: bytes.length,
  }),
);
