import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import * as THREE from 'three';
import { geometryScene } from './measure-collision-bounds.mjs';

const model = 'output/model-generation/models/firewood-log';
const folder = `${model}/work/low-poly/candidate-02`;
const json = async (path) => JSON.parse(await readFile(path, 'utf8'));
const save = (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n');
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const candidate = `${folder}/candidate.glb`,
  bytes = await readFile(candidate),
  hash = sha(bytes);
const gltf = await geometryScene(candidate);
const box = new THREE.Box3().setFromObject(gltf.scene, true),
  size = box.getSize(new THREE.Vector3());
const bounds = {
  min: box.min.toArray(),
  max: box.max.toArray(),
  radius: Math.hypot(size.x, size.z) / 2,
  sha256: hash,
};
assert.ok(size.x > 1.18 && size.x < 1.22, 'log is 1.2 metres long');
assert.ok(size.y > 0.15 && size.y < 0.6 && size.z > 0.15 && size.z < 0.6);
assert.ok(Math.abs(box.min.y) < 0.005, 'ground pivot');
const inspections = [];
for (const name of ['candidate', 'lod1', 'lod2']) {
  const path = `${folder}/${name}.glb`,
    data = await readFile(path);
  const result = JSON.parse(
    execFileSync(process.execPath, ['scripts/inspect-glb.mjs', path], { encoding: 'utf8' }),
  );
  assert.equal(result.validation, 'passed');
  assert.equal(result.animations.length, 0);
  inspections.push({
    name,
    sha256: sha(data),
    bytes: data.length,
    triangles: result.triangles,
    inspection: result,
  });
}
await save('assets/firewood-log/geometry-inspection.json', {
  bounds,
  size: size.toArray(),
  inspections,
});
if (process.argv.includes('--measure')) {
  const path = 'shared/model-bounds.mts',
    source = await readFile(path, 'utf8');
  assert.ok(
    !JSON.parse(await readFile('public/models/world-assets.json', 'utf8')).assets.some(
      (a) => a.modelKey === 'firewood-log',
    ),
    'measurement must precede adoption',
  );
  await writeFile(
    path,
    source
      .replace(/\n  'firewood-log': [^\n]+/, '')
      .replace(
        'export const MODEL_BOUNDS = {',
        `export const MODEL_BOUNDS = {\n  'firewood-log': ${JSON.stringify(bounds)},`,
      ),
  );
  console.log(JSON.stringify({ bounds, size: size.toArray() }));
} else {
  const review = await json('assets/firewood-log/adoption-review.json');
  assert.equal(review.sha256, hash);
  assert.equal(review.decision, 'adopt');
  assert.equal(review.visualGate, 'passed');
  assert.equal(review.browserGate, 'passed');
  const destination = 'public/models/firewood-log';
  await mkdir(destination, { recursive: true });
  for (const entry of inspections)
    await copyFile(
      `${folder}/${entry.name}.glb`,
      `${destination}/${entry.name === 'candidate' ? 'model' : entry.name}.glb`,
      constants.COPYFILE_EXCL,
    );
  const reference = `${model}/source/original/reference-v1.png`;
  await copyFile(reference, 'assets/firewood-log/reference-v1.png', constants.COPYFILE_EXCL);
  const manifest = {
    modelKey: 'firewood-log',
    name: '丸太1本',
    kind: 'static',
    candidate: 1,
    status: 'reviewed-prototype',
    url: '/models/firewood-log/model.glb',
    sha256: hash,
    bytes: bytes.length,
    triangles: inspections[0].triangles,
    upAxis: 'Y',
    forwardAxis: '+X',
    heightMetres: size.y,
    widthMetres: size.x,
    placement: { pivot: 'ground-centred', min: bounds.min, max: bounds.max, longAxis: '+X' },
    clips: [],
    lods: inspections.slice(1).map(({ name, sha256, bytes, triangles }) => ({
      url: `/models/firewood-log/${name}.glb`,
      sha256,
      bytes,
      triangles,
    })),
    notes: review.notes,
    provenance: {
      provider: 'Codex',
      claudeUsed: false,
      referenceGenerator: 'Built-in imagegen',
      referenceImage: 'assets/firewood-log/reference-v1.png',
      referenceSha256: sha(await readFile(reference)),
      reconstruction:
        'Local TRELLIS-2, 1024, seed 42. Source-derived QEM with retained UVs and bark/cut-end textures.',
      candidateFile: candidate,
      visualReview: 'assets/firewood-log/adoption-review.json',
    },
  };
  await save(`${destination}/asset.json`, manifest);
  const world = await json('public/models/world-assets.json');
  assert.ok(!world.assets.some((a) => a.modelKey === 'firewood-log'));
  world.assets.push(manifest);
  await save('public/models/world-assets.json', world);
  const catalog = await json('assets/world-models.json');
  assert.ok(!catalog.assets.some((a) => a.key === 'firewood-log'));
  catalog.assets.push({
    key: 'firewood-log',
    name: manifest.name,
    kind: 'static',
    height: size.y,
    width: size.x,
    geometryResolution: 1024,
    referenceVersion: 1,
    status: 'adopted-awaiting-game-QA',
    sha256: hash,
    delivery: manifest.url,
    subject: (await json('assets/firewood-log/request-spec.json')).subject,
  });
  await save('assets/world-models.json', catalog);
  await copyFile(
    `${folder}/process-report.json`,
    'assets/firewood-log/process-report.json',
    constants.COPYFILE_EXCL,
  );
  await copyFile(
    `${model}/work/trellis/dense-res1024-seed0042.json`,
    'assets/firewood-log/reconstruction.json',
    constants.COPYFILE_EXCL,
  );
  console.log(JSON.stringify(manifest));
}
