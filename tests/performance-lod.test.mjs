import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  attachSimplifiedShadow,
  configureActorPerformance,
  disposeActorPerformance,
  disposeSimplifiedShadow,
  updateActorPerformance,
  updateSimplifiedShadow,
} from '../dist/src/performance-lod.js';
import {
  CAMP_CAVE,
  CAMP_MOUNTAIN,
  campMountainVisualLod,
} from '../dist/shared/camp-cave-layout.mjs';
import { CASTLE } from '../dist/shared/castle-layout.mjs';

test('actors switch only geometry at distance and use a tiny shadow proxy', () => {
  const high = new THREE.BoxGeometry(1, 2, 0.6),
    low = new THREE.BoxGeometry(0.9, 1.9, 0.55),
    root = new THREE.Group(),
    lowRoot = new THREE.Group(),
    mesh = new THREE.Mesh(high, new THREE.MeshStandardMaterial());
  mesh.name = 'body';
  root.add(mesh);
  const reduced = new THREE.Mesh(low, new THREE.MeshBasicMaterial());
  reduced.name = 'body';
  lowRoot.add(reduced);
  configureActorPerformance(root, lowRoot, {
    modelKey: 'test-actor',
    kind: 'humanoid',
    lods: [{ distanceMetres: 28 }],
  });
  const proxy = root.getObjectByName('actor-simplified-shadow');
  assert.ok(proxy);
  assert.equal(mesh.castShadow, false);
  assert.ok(proxy.geometry.index.count / 3 < 200);
  assert.equal(updateActorPerformance(root, 29), 0, 'near side of hysteresis stays detailed');
  assert.equal(updateActorPerformance(root, 31), 1);
  assert.equal(mesh.geometry, low);
  assert.equal(updateActorPerformance(root, 27), 1, 'far side of hysteresis stays reduced');
  assert.equal(updateActorPerformance(root, 25), 0);
  assert.equal(mesh.geometry, high);
  updateActorPerformance(root, 40);
  assert.equal(proxy.castShadow, false);
  disposeActorPerformance(root);
  assert.equal(root.getObjectByName('actor-simplified-shadow'), undefined);
});

test('camp props use source-independent shadow meshes and stop shadowing at distance', () => {
  const root = new THREE.Group(),
    source = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), new THREE.MeshStandardMaterial());
  root.add(source);
  const proxy = attachSimplifiedShadow(root, 'berry-bush');
  assert.ok(proxy.geometry.index.count < source.geometry.index.count / 5);
  assert.equal(source.castShadow, false);
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 0, 17);
  camera.updateMatrixWorld(true);
  root.updateMatrixWorld(true);
  updateSimplifiedShadow(root, camera);
  assert.equal(proxy.castShadow, true);
  camera.position.z = 19;
  camera.updateMatrixWorld(true);
  updateSimplifiedShadow(root, camera);
  assert.equal(proxy.castShadow, false);
  disposeSimplifiedShadow(root);
});

test('camp mountain keeps detail at camp and cave but uses its light LOD from the castle', () => {
  assert.equal(campMountainVisualLod(50, 50), 0);
  assert.equal(campMountainVisualLod(CAMP_CAVE.x, CAMP_CAVE.z), 0);
  assert.equal(campMountainVisualLod(CASTLE.x, CASTLE.z), 1);
  const edge = CAMP_MOUNTAIN.detail;
  assert.equal(campMountainVisualLod(edge.x + edge.radius + 1, edge.z, 0), 0);
  assert.equal(campMountainVisualLod(edge.x + edge.radius + 1, edge.z, 1), 1);
});
