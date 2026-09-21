import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { installSkinnedBounds } from '../dist/src/skinned-bounds.js';
import { loadMotion } from '../scripts/motion-glb.mjs';
import { CHARACTER_MODELS } from '../dist/shared/characters.mjs';

function verify(root, label) {
  root.updateMatrixWorld(true);
  const point = new THREE.Vector3();
  root.traverse((mesh) => {
    if (!mesh.isSkinnedMesh) return;
    mesh.computeBoundingSphere();
    const sphere = mesh.boundingSphere;
    assert.ok(Number.isFinite(sphere.radius) && sphere.radius > 0, label);
    for (let i = 0; i < mesh.geometry.attributes.position.count; i++) {
      mesh.getVertexPosition(i, point);
      assert.ok(
        point.distanceTo(sphere.center) <= sphere.radius + 1e-5,
        `${label}: vertex ${i} excluded`,
      );
    }
  });
}

for (const key of [
  ...new Set(CHARACTER_MODELS.map((p) => p.key)),
  'crow-shaman',
  'woolly-mammoth',
  'violet-behemoth',
  'sabertooth-tiger',
]) {
  test(`${key}: bone bounds contain every skinned vertex across all delivered clips`, async () => {
    const asset = JSON.parse(await readFile(`public/models/${key}/asset.json`, 'utf8'));
    const gltf = await loadMotion('public' + asset.url);
    const parent = new THREE.Group();
    parent.position.set(120, 8, -64);
    parent.rotation.set(0.1, 0.7, 0.2);
    parent.scale.set(1.2, 0.8, 1.6);
    parent.add(gltf.scene);
    installSkinnedBounds(gltf.scene);
    const mixer = new THREE.AnimationMixer(gltf.scene);
    for (const clip of gltf.animations) {
      mixer.stopAllAction();
      const action = mixer.clipAction(clip).play();
      for (const phase of [0, 0.37, 0.83]) {
        action.time = clip.duration * phase;
        mixer.update(0);
        verify(parent, `${key}/${clip.name}/${phase}`);
      }
    }
    // Skeleton clones share static influence data but own their animated bound.
    const other = clone(gltf.scene);
    installSkinnedBounds(other);
    other.position.set(-5, 3, 7);
    parent.add(other);
    verify(parent, `${key}/clone`);
    const meshes = [];
    parent.traverse((m) => {
      if (m.isSkinnedMesh) meshes.push(m);
    });
    if (meshes.length >= 2) assert.notEqual(meshes[0].boundingSphere, meshes.at(-1).boundingSphere);
  });
}
