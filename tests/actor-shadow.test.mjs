import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { loadMotion } from '../scripts/motion-glb.mjs';
import {
  configureActorPerformance,
  updateActorPerformance,
  disposeActorPerformance,
} from '../dist/src/performance-lod.js';
import { installSkinnedBounds } from '../dist/src/skinned-bounds.js';
import { CHARACTER_MODELS } from '../dist/shared/characters.mjs';
import { deliveredActor, originalPair } from './original-actor-pairs.mjs';

const PHASES = [0, 0.37, 0.83];

// There is no sun shadow map, so the reduced geometry is only ever drawn as the
// visible distant actor. It must follow the animation like the delivered low GLB.
function assertDistantFollows(key, high, low, levels) {
  const detail = configureActorPerformance(high.scene, low.scene, levels);
  installSkinnedBounds(high.scene);
  assert.equal(updateActorPerformance(high.scene, 100), 1);
  const parent = new THREE.Group();
  parent.position.set(32, 7, -21);
  parent.rotation.set(0.15, 0.7, -0.1);
  parent.scale.set(1.3, 0.8, 1.1);
  parent.add(high.scene, low.scene);
  const highMixer = new THREE.AnimationMixer(high.scene);
  const lowMixer = new THREE.AnimationMixer(low.scene);
  const lowMeshes = [];
  low.scene.traverse((n) => {
    if (n.isMesh) lowMeshes.push(n);
  });
  const actual = new THREE.Vector3(),
    expected = new THREE.Vector3();
  for (const clip of high.animations) {
    highMixer.stopAllAction();
    lowMixer.stopAllAction();
    const a = highMixer.clipAction(clip).play();
    const b = lowMixer.clipAction(clip).play();
    for (const phase of PHASES) {
      a.time = b.time = phase * clip.duration;
      highMixer.update(0);
      lowMixer.update(0);
      parent.updateMatrixWorld(true);
      for (const [i, entry] of detail.meshes.entries()) {
        const mesh = entry.mesh;
        assert.equal(mesh.geometry, entry.low);
        const reference = lowMeshes.find((m) => m.name === mesh.name) ?? lowMeshes[i];
        mesh.skeleton?.update();
        reference.skeleton?.update();
        for (let v = 0; v < mesh.geometry.attributes.position.count; v++) {
          mesh.getVertexPosition(v, actual).applyMatrix4(mesh.matrixWorld);
          reference.getVertexPosition(v, expected).applyMatrix4(reference.matrixWorld);
          assert.ok(
            actual.distanceTo(expected) < 1e-4,
            `${key}/${clip.name}/${phase}: distant vertex ${v} follows the animation`,
          );
        }
      }
    }
  }
  disposeActorPerformance(high.scene);
}

// A sole primary (a manifest listing no LOD) draws its own skinned body far away: the same
// geometry and materials in every clip, never a low file and never a material variant.
function assertSoleBody(key, body, asset) {
  const detail = configureActorPerformance(body.scene, null, asset);
  installSkinnedBounds(body.scene);
  const drawn = detail.meshes.map(({ mesh }) => ({
    mesh,
    geometry: mesh.geometry,
    material: mesh.material,
  }));
  assert.ok(drawn.length > 0);
  assert.equal(updateActorPerformance(body.scene, 100), 1);
  assert.deepEqual(detail.variants, [], `${key}: no far material variant`);
  const mixer = new THREE.AnimationMixer(body.scene),
    point = new THREE.Vector3();
  for (const clip of body.animations) {
    mixer.stopAllAction();
    const action = mixer.clipAction(clip).play();
    for (const phase of PHASES) {
      action.time = phase * clip.duration;
      mixer.update(0);
      body.scene.updateMatrixWorld(true);
      for (const { mesh, geometry, material } of drawn) {
        assert.equal(mesh.geometry, geometry, `${key}/${clip.name}: the served geometry far away`);
        assert.equal(mesh.material, material, `${key}/${clip.name}: the served materials`);
        mesh.skeleton?.update();
        const count = geometry.attributes.position.count,
          step = Math.max(1, Math.floor(count / 512));
        for (let v = 0; v < count; v += step)
          assert.ok(
            mesh.getVertexPosition(v, point).toArray().every(Number.isFinite),
            `${key}/${clip.name}/${phase}: vertex ${v}`,
          );
      }
    }
  }
  mixer.stopAllAction();
  mixer.uncacheRoot(body.scene);
  disposeActorPerformance(body.scene);
}

for (const key of [
  ...new Set(CHARACTER_MODELS.map((asset) => asset.key)),
  'crow-shaman',
  'woolly-mammoth',
  'sabertooth-tiger',
  'violet-behemoth',
]) {
  // The original full model and far LOD, verified (original-actor-pairs.mjs): the real pair.
  test(`${key}: the distant LOD matches independently animated low geometry in every delivered clip`, async () => {
    const { full, lod, levels } = await originalPair(key, loadMotion);
    assertDistantFollows(key, full, lod, levels);
  });
  // What the game delivers now: a (compressed) pair follows the same rule; a sole primary,
  // as the player bodies and the behemoth after r04, draws its own body at every distance.
  test(`${key}: the delivered body far away is exactly the levels its manifest lists`, async (t) => {
    const delivery = await deliveredActor(key);
    if (delivery.original) {
      t.diagnostic(`${key} is delivered as its original pair, proven above`);
      return;
    }
    const { primary, lod } = await delivery.load(loadMotion);
    if (lod) assertDistantFollows(key, primary, lod, delivery.asset);
    else assertSoleBody(key, primary, delivery.asset);
  });
}
