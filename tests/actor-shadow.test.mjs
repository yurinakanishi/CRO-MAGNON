import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { loadMotion } from '../scripts/motion-glb.mjs';
import {
  configureActorPerformance,
  updateActorPerformance,
  disposeActorPerformance,
} from '../dist/src/performance-lod.js';
import { installSkinnedBounds } from '../dist/src/skinned-bounds.js';
import { CHARACTER_MODELS } from '../dist/shared/characters.mjs';

for (const key of [
  ...new Set(CHARACTER_MODELS.map((asset) => asset.key)),
  'crow-shaman',
  'woolly-mammoth',
  'sabertooth-tiger',
  'violet-behemoth',
]) {
  test(`${key}: shadow LOD matches independently animated low geometry in every delivered clip`, async () => {
    const asset = JSON.parse(await readFile(`public/models/${key}/asset.json`, 'utf8'));
    const high = await loadMotion('public' + asset.url);
    const low = await loadMotion('public' + asset.lods[0].url);
    const detail = configureActorPerformance(high.scene, low.scene, asset);
    installSkinnedBounds(high.scene);
    updateActorPerformance(high.scene, 24);
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
      for (const phase of [0, 0.37, 0.83]) {
        a.time = b.time = phase * clip.duration;
        highMixer.update(0);
        lowMixer.update(0);
        parent.updateMatrixWorld(true);
        for (const [i, entry] of detail.meshes.entries()) {
          const shadow = entry.shadow;
          const reference = lowMeshes.find((m) => m.name === entry.mesh.name) ?? lowMeshes[i];
          shadow.skeleton?.update();
          reference.skeleton?.update();
          shadow.computeBoundingSphere?.();
          for (let v = 0; v < shadow.geometry.attributes.position.count; v++) {
            shadow.getVertexPosition(v, actual);
            if (shadow.boundingSphere)
              assert.ok(
                actual.distanceTo(shadow.boundingSphere.center) <=
                  shadow.boundingSphere.radius + 1e-5,
                'low shadow remains in its culling bounds',
              );
            actual.applyMatrix4(shadow.matrixWorld);
            reference.getVertexPosition(v, expected).applyMatrix4(reference.matrixWorld);
            assert.ok(
              actual.distanceTo(expected) < 1e-4,
              `${key}/${clip.name}/${phase}: shadow vertex ${v} follows the animation`,
            );
          }
        }
      }
    }
    disposeActorPerformance(high.scene);
  });
}
