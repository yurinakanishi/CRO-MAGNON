import test from 'node:test';
import assert from 'node:assert/strict';
import { CharacterAnimation } from '../dist/src/character-animation.js';
import {
  configureActorPerformance,
  disposeActorPerformance,
  updateActorPerformance,
} from '../dist/src/performance-lod.js';
import { deliveredWomanRig, originalWomanRig } from './cro-magnon-woman-rig.mjs';

const GAITS = ['Walk_Loop', 'Run_Loop', 'Walk_Loop', 'Idle_Loop'];

/** A gait animation of `rig` with the manifest's measured speeds. */
function gaits(rig, asset) {
  return new CharacterAnimation(rig.scene, rig.animations, {
    walkSpeed: asset.locomotion.Walk_Loop.metresPerSecond,
    runSpeed: asset.locomotion.Run_Loop.metresPerSecond,
    groundLocomotion: true,
  });
}

/** Each drawn skinned mesh of `scene` with the geometry and material it starts with. */
function bodies(scene) {
  const meshes = [];
  scene.traverse((mesh) => {
    if (mesh.isSkinnedMesh && !mesh.userData.shadowOnly)
      meshes.push({ mesh, geometry: mesh.geometry, material: mesh.material });
  });
  assert.ok(meshes.length > 0);
  return meshes;
}

const speedOf = (asset, target) =>
  target === 'Idle_Loop' ? 0 : asset.locomotion[target].metresPerSecond;

test('gait crossfades survive a distant player switching to fewer vertices and back', async () => {
  // The original full model and far LOD: the real HIGH/LOW pair (cro-magnon-woman-rig.mjs).
  const { asset, full: high, lod: low, levels } = await originalWomanRig();
  configureActorPerformance(high.scene, low.scene, levels);
  const animation = gaits(high, asset);
  const meshes = bodies(high.scene);
  try {
    for (const target of GAITS) {
      const speed = speedOf(asset, target);
      animation.update(1 / 60, speed, target === 'Run_Loop');
      assert.ok(
        [...animation.actions.values()].filter(
          (a) => a.enabled && a.isScheduled() && a.getEffectiveWeight() > 0.0001,
        ).length > 1,
        'the geometry switch must happen during a live gait crossfade',
      );
      assert.equal(updateActorPerformance(high.scene, 40), 1);
      assert.ok(meshes.every(({ mesh, geometry }) => mesh.geometry !== geometry));
      animation.update(1 / 60, speed, target === 'Run_Loop');
      assert.equal(updateActorPerformance(high.scene, 10), 0);
      assert.ok(meshes.every(({ mesh, geometry }) => mesh.geometry === geometry));
      for (let i = 0; i < 20; i++) animation.update(1 / 60, speed, target === 'Run_Loop');
      high.scene.updateMatrixWorld(true);
      high.scene.traverse((node) => {
        assert.ok(node.matrixWorld.elements.every(Number.isFinite));
      });
      assert.equal(animation.name, target);
    }
  } finally {
    animation.dispose();
    disposeActorPerformance(high.scene);
  }
});

// The body the game delivers now: before the r04 adoption the full model with its LOD;
// after it the sole primary, which lists no LOD and so draws the same body at every
// distance. No old far body may reappear.
test('the delivered player body changes level only as its manifest lists, through live gait crossfades', async () => {
  const { asset, primary, lod } = await deliveredWomanRig();
  assert.equal(!!lod, (asset.lods ?? []).length > 0, 'a LOD exactly when the manifest lists one');
  configureActorPerformance(primary.scene, lod?.scene, asset);
  const animation = gaits(primary, asset);
  const meshes = bodies(primary.scene);
  const same = ({ mesh, geometry, material }) =>
    mesh.geometry === geometry && mesh.material === material;
  try {
    for (const target of GAITS) {
      const speed = speedOf(asset, target);
      animation.update(1 / 60, speed, target === 'Run_Loop');
      updateActorPerformance(primary.scene, 400);
      if (lod) assert.ok(meshes.every(({ mesh, geometry }) => mesh.geometry !== geometry));
      else assert.ok(meshes.every(same), 'a sole primary keeps its own body far away');
      animation.update(1 / 60, speed, target === 'Run_Loop');
      assert.equal(updateActorPerformance(primary.scene, 1), 0);
      assert.ok(meshes.every(same), 'close by, the primary body and its materials');
      for (let i = 0; i < 20; i++) animation.update(1 / 60, speed, target === 'Run_Loop');
      primary.scene.updateMatrixWorld(true);
      primary.scene.traverse((node) => {
        assert.ok(node.matrixWorld.elements.every(Number.isFinite));
      });
      assert.equal(animation.name, target);
    }
  } finally {
    animation.dispose();
    disposeActorPerformance(primary.scene);
  }
});
