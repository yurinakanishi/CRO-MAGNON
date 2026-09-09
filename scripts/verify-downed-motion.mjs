import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { loadMotion } from './motion-glb.mjs';
import { CHARACTER_MODELS } from '../dist/shared/characters.mjs';
import { CharacterAnimation } from '../dist/src/character-animation.js';
const results = [];
const hash = (b) => createHash('sha256').update(b).digest('hex');
for (const { key } of CHARACTER_MODELS) {
  const folder = `output/downed-motion/${key}`;
  const asset = JSON.parse(await readFile(`${folder}/asset.json`, 'utf8'));
  const before = await loadMotion(`${folder}/source.glb`),
    after = await loadMotion(`${folder}/model-downed-r01.glb`);
  assert.equal(hash(after.bytes), asset.sha256);
  assert.equal(hash(before.bytes), asset.downedMotion.sourceSha256);
  for (const field of ['nodes', 'meshes', 'skins', 'materials', 'textures', 'images'])
    assert.deepEqual(after.doc[field], before.doc[field], key + ' ' + field);
  assert.deepEqual(after.binary.subarray(0, before.binary.length), before.binary);
  assert.deepEqual(after.doc.animations.slice(0, -1), before.doc.animations);
  const animation = new CharacterAnimation(after.scene, after.animations, {
    walkSpeed: 1,
    runSpeed: 3,
  });
  const joints = [];
  const meshes = [];
  after.scene.traverse((n) => {
    if (n.isBone) joints.push(n);
    if (n.isSkinnedMesh) meshes.push(n);
  });
  const rests = new Map(joints.map((b) => [b.name, b.position.clone()]));
  let minY = Infinity,
    maxStep = 0;
  let previous = null;
  const phases = [];
  const point = new THREE.Vector3();
  // Half-frame offsets independently exercise interpolated GLB output, not authoring samples.
  for (let i = 0; i <= 216; i++) {
    const t = i / 120;
    animation.updateDowned(1 / 120, t);
    after.scene.updateMatrixWorld(true);
    let min = Infinity,
      max = -Infinity;
    for (const mesh of meshes) {
      mesh.skeleton.update();
      for (let v = 0; v < mesh.geometry.attributes.position.count; v++) {
        mesh.getVertexPosition(v, point).applyMatrix4(mesh.matrixWorld);
        assert.ok(Number.isFinite(point.y));
        min = Math.min(min, point.y);
        max = Math.max(max, point.y);
      }
    }
    for (const bone of joints) {
      assert.ok(Math.abs(bone.quaternion.length() - 1) < 2e-6, key + ' unit rotation');
      if (bone.name !== 'Hips')
        assert.ok(
          bone.position.distanceTo(rests.get(bone.name)) < 1e-5,
          key + ' bone length ' + bone.name,
        );
    }
    const hips = after.scene.getObjectByName('Hips').getWorldPosition(new THREE.Vector3());
    if (previous) maxStep = Math.max(maxStep, hips.distanceTo(previous));
    previous = hips;
    minY = Math.min(minY, min);
    assert.ok(min > -0.008, key + ' penetrates flat floor: ' + min);
    assert.ok(min < 0.009, key + ' floats: ' + min);
    if ([0, 78, 108, 162, 216].includes(i)) phases.push({ t, min, max, hips: hips.toArray() });
  }
  assert.ok(phases[1].max < phases[0].max * 0.94, key + ' knees must drop first');
  assert.ok(phases.at(-1).max < asset.heightMetres * 0.48, key + ' must lie down');
  assert.ok(maxStep < asset.heightMetres * 0.05, key + ' discontinuity');
  animation.updateDowned(0.016, 9);
  const held = joints.map((b) => b.quaternion.toArray());
  animation.update(4, 5, true);
  assert.equal(animation.name, 'Downed');
  assert.deepEqual(
    joints.map((b) => b.quaternion.toArray()),
    held,
  );
  assert.equal(animation.play('Wave'), false);
  assert.equal(animation.playAttack(0), false);
  animation.leaveDowned();
  animation.update(0.2, 1, false);
  assert.equal(animation.name, 'Walk_Loop');
  animation.dispose();
  results.push({
    key,
    sha256: asset.sha256,
    preservedClips: before.animations.map((a) => a.name),
    samples: 217,
    minY,
    maxHipStepAt120Hz: maxStep,
    phases,
  });
  console.log(key + ' passed');
}
await writeFile(
  'output/downed-motion/validation.json',
  JSON.stringify({ samplingHz: 120, results }, null, 2) + '\n',
);
