import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import * as THREE from 'three';
import { geometryScene } from './measure-collision-bounds.mjs';
const root = 'output/model-generation/models/valley-castle';
const before = `${root}/work/low-poly/candidate-06/candidate.glb`;
const after = `${root}/work/low-poly/candidate-08/candidate.glb`;
const sha = (b) => createHash('sha256').update(b).digest('hex');
function appearance(bytes) {
  const length = bytes.readUInt32LE(12),
    doc = JSON.parse(bytes.subarray(20, 20 + length)),
    bin = bytes.subarray(28 + length);
  return {
    materials: doc.materials,
    textures: doc.textures,
    samplers: doc.samplers,
    images: doc.images.map((i) => {
      const v = doc.bufferViews[i.bufferView];
      return sha(bin.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength));
    }),
  };
}
assert.deepEqual(appearance(await readFile(after)), appearance(await readFile(before)));
const oldAtlas = JSON.parse(await readFile(`${root}/qa/walk-rev06.json`));
const atlas = JSON.parse(await readFile(`${root}/qa/walk-rev08.json`));
const changes = [];
for (let i = 0; i < atlas.heights.length; i++)
  if (atlas.heights[i] !== oldAtlas.heights[i]) {
    const x = atlas.minX + ((i % atlas.nx) + 0.5) * atlas.step,
      z = atlas.minZ + (Math.floor(i / atlas.nx) + 0.5) * atlas.step;
    assert.ok(Math.abs(x) < 1.66 && z > 19.1 && z < 19.9, 'only the extended landing changes');
    assert.ok(atlas.heights[i] > 7.4 && atlas.heights[i] < 7.55);
    changes.push({ x, z, before: oldAtlas.heights[i], after: atlas.heights[i] });
  }
assert.ok(changes.length > 0);
const gltf = await geometryScene(after);
gltf.scene.updateMatrixWorld(true);
gltf.scene.traverse((n) => {
  if (n.isMesh) n.material.side = THREE.DoubleSide;
});
const ray = new THREE.Raycaster();
let samples = 0,
  maxError = 0;
for (let x = -4; x <= 4; x += 0.2)
  for (let z = 18.7; z <= 19.89; z += 0.1) {
    ray.set(new THREE.Vector3(x, 8, z), new THREE.Vector3(0, -1, 0));
    const hits = ray.intersectObject(gltf.scene, true);
    assert.ok(hits.length, 'continuous visible landing');
    const error = Math.abs(hits[0].point.y - 7.474);
    maxError = Math.max(maxError, error);
    assert.ok(error < 0.06, `landing floor ${x},${z}: ${hits[0].point.y}`);
    samples++;
  }
const inspection = JSON.parse(
  execFileSync(process.execPath, ['scripts/inspect-glb.mjs', after], { encoding: 'utf8' }),
);
assert.equal(inspection.validation, 'passed');
assert.equal(inspection.sha256, atlas.sourceSha256);
await writeFile(`${root}/qa/revision-08-inspection.json`, JSON.stringify(inspection, null, 2));
const report = {
  sha256: inspection.sha256,
  unchangedMaterialsAndImages: true,
  changedAtlasCells: changes,
  landingRaySamples: samples,
  maxFloorError: maxError,
  inspection,
};
await writeFile(`${root}/qa/stairs-mesh-verification.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
