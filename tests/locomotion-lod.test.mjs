import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadMotion } from '../scripts/motion-glb.mjs';
import { CharacterAnimation } from '../dist/src/character-animation.js';
import {
  configureActorPerformance,
  disposeActorPerformance,
  updateActorPerformance,
} from '../dist/src/performance-lod.js';

test('gait crossfades survive a distant player switching to fewer vertices and back', async () => {
  const asset = JSON.parse(await readFile('public/models/cro-magnon-woman/asset.json'));
  const high = await loadMotion(`public${asset.url}`),
    low = await loadMotion(`public${asset.lods[0].url}`);
  configureActorPerformance(high.scene, low.scene, asset);
  const animation = new CharacterAnimation(high.scene, high.animations, {
    walkSpeed: asset.locomotion.Walk_Loop.metresPerSecond,
    runSpeed: asset.locomotion.Run_Loop.metresPerSecond,
    groundLocomotion: true,
  });
  const meshes = [];
  high.scene.traverse((mesh) => {
    if (mesh.isSkinnedMesh && !mesh.userData.shadowOnly)
      meshes.push({ mesh, geometry: mesh.geometry });
  });
  try {
    for (const target of ['Walk_Loop', 'Run_Loop', 'Walk_Loop', 'Idle_Loop']) {
      const speed = target === 'Idle_Loop' ? 0 : asset.locomotion[target].metresPerSecond;
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
