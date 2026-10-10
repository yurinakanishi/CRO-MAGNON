import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { CharacterAnimation } from '../dist/src/character-animation.js';
import { configureActorPerformance, disposeActorPerformance } from '../dist/src/performance-lod.js';
import { deliveredWomanRig, originalWomanRig } from './cro-magnon-woman-rig.mjs';

/** Live gait crossfades of `g` (configured with `lowScene` as its LOD, none for a sole
 * primary) keep its skinned soles above a translated, rotated and scaled actor floor. */
function assertGrounded(g, lowScene, levels, asset) {
  const container = new T.Group();
  configureActorPerformance(g.scene, lowScene, levels);
  container.position.set(31, 4, -19);
  container.rotation.y = 1.2;
  container.scale.setScalar(1.4);
  container.add(g.scene);
  container.updateMatrixWorld(true);
  const inverse = new T.Matrix4().copy(g.scene.matrixWorld).invert(),
    point = new T.Vector3(),
    soles = [];
  g.scene.traverse((mesh) => {
    if (!mesh.isSkinnedMesh || mesh.userData.shadowOnly) return;
    const a = mesh.geometry.attributes;
    for (let i = 0; i < a.position.count; i++) {
      let w = 0;
      for (let j = 0; j < 4; j++)
        if (/^(Foot|Toe)[LR]$/.test(mesh.skeleton.bones[a.skinIndex.array[i * 4 + j]].name))
          w += a.skinWeight.array[i * 4 + j];
      if (w > 0.7) {
        mesh.getVertexPosition(i, point).applyMatrix4(mesh.matrixWorld).applyMatrix4(inverse);
        if (point.y < 0.05) soles.push({ mesh, i });
      }
    }
  });
  assert.ok(soles.length > 50);
  const animation = new CharacterAnimation(g.scene, g.animations, {
    walkSpeed: asset.locomotion.Walk_Loop.metresPerSecond,
    runSpeed: asset.locomotion.Run_Loop.metresPerSecond,
    groundLocomotion: true,
  });
  let minimum = Infinity;
  for (const [from, to] of [
    ['Idle_Loop', 'Walk_Loop'],
    ['Walk_Loop', 'Run_Loop'],
    ['Run_Loop', 'Walk_Loop'],
    ['Run_Loop', 'Idle_Loop'],
  ])
    for (let phase = 0; phase < 1; phase += 1 / 12) {
      animation.change(from, 0);
      animation.current.time = animation.current.getClip().duration * phase;
      animation.mixer.update(0);
      for (let f = 0; f < 14; f++) {
        const speed = to === 'Idle_Loop' ? 0 : asset.locomotion[to].metresPerSecond;
        animation.update(1 / 60, speed, to === 'Run_Loop');
        container.updateMatrixWorld(true);
        g.scene.traverse((n) => {
          if (n.isSkinnedMesh) n.skeleton.update();
        });
        for (const s of soles) {
          s.mesh
            .getVertexPosition(s.i, point)
            .applyMatrix4(s.mesh.matrixWorld)
            .applyMatrix4(inverse);
          minimum = Math.min(minimum, point.y);
        }
      }
    }
  assert.ok(minimum > -0.002, 'no foot penetration during live crossfades: ' + minimum);
  assert.deepEqual(container.position.toArray(), [31, 4, -19]);
  assert.equal(container.rotation.y, 1.2);
  animation.update(0.2, 0, false);
  const hips = g.scene.getObjectByName('Hips'),
    idle = hips.position.clone();
  animation.mixer.update(0);
  assert.ok(hips.position.distanceTo(idle) < 1e-7, 'no retained lift after the gait transition');
  animation.dispose();
  disposeActorPerformance(g.scene);
}

test('human gait transitions keep skinned soles above a translated, rotated and scaled actor floor', async () => {
  // The original full model with its far LOD bound (cro-magnon-woman-rig.mjs).
  const { asset, full, lod, levels } = await originalWomanRig();
  assertGrounded(full, lod.scene, levels, asset);
});

test('the delivered body, a sole primary after the r04 adoption, keeps its soles grounded too', async () => {
  // The body the game delivers now, bound to its LOD only while the manifest lists one.
  const { asset, primary, lod } = await deliveredWomanRig();
  assertGrounded(primary, lod?.scene, asset, asset);
});
