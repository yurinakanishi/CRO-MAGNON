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

test('actor shadows retain their silhouette nearby, reduce at distance and stop beyond 34 m', () => {
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
  const shadow = root.userData.actorDetail.meshes[0].shadow;
  assert.equal(root.getObjectByName('actor-simplified-shadow'), undefined);
  assert.equal(mesh.castShadow, true, 'the actual animated surface casts the close shadow');
  assert.equal(shadow.visible, false);
  assert.equal(shadow.geometry, low);
  assert.equal(shadow.material.colorWrite, false);
  assert.equal(shadow.material.depthWrite, false);
  updateActorPerformance(root, 19);
  assert.equal(mesh.castShadow, true, 'shadow hysteresis keeps the close shape');
  updateActorPerformance(root, 21);
  assert.equal(mesh.geometry, high, 'shadow LOD is independent of visible LOD');
  assert.equal(mesh.castShadow, false);
  assert.equal(shadow.visible, true);
  root.updateMatrixWorld(true);
  const hits = new THREE.Raycaster(
    new THREE.Vector3(0, 0, 4),
    new THREE.Vector3(0, 0, -1),
  ).intersectObject(mesh, true);
  assert.ok(hits.length > 0);
  assert.ok(
    hits.every((hit) => hit.object === mesh),
    'shadow helpers cannot intercept animal picking',
  );
  updateActorPerformance(root, 17);
  assert.equal(shadow.visible, true);
  updateActorPerformance(root, 15);
  assert.equal(shadow.visible, false);
  assert.equal(mesh.castShadow, true);
  assert.equal(updateActorPerformance(root, 29), 0, 'near side of hysteresis stays detailed');
  assert.equal(updateActorPerformance(root, 31), 1);
  assert.equal(mesh.geometry, low);
  assert.equal(mesh.castShadow, true, 'the visible low mesh casts directly');
  assert.equal(shadow.visible, false, 'never duplicate the low shadow');
  assert.equal(updateActorPerformance(root, 27), 1, 'far side of hysteresis stays reduced');
  assert.equal(updateActorPerformance(root, 25), 0);
  assert.equal(mesh.geometry, high);
  assert.equal(shadow.visible, true);
  updateActorPerformance(root, 34);
  assert.equal(mesh.castShadow, false);
  assert.equal(shadow.visible, false);
  updateActorPerformance(root, 40);
  assert.equal(mesh.castShadow, false);
  assert.equal(shadow.visible, false);
  let disposedMaterials = 0,
    disposedGeometry = 0;
  shadow.material.addEventListener('dispose', () => disposedMaterials++);
  low.addEventListener('dispose', () => disposedGeometry++);
  disposeActorPerformance(root);
  assert.equal(shadow.parent, null);
  assert.equal(mesh.geometry, high);
  assert.equal(mesh.castShadow, false, 'restore the original mesh flag on disposal');
  assert.equal(disposedMaterials, 1);
  assert.equal(disposedGeometry, 0, 'shared template geometry remains alive');
});

test('actors without a low mesh still cast their real silhouette and obey the distance limit', () => {
  const root = new THREE.Group(),
    mesh = new THREE.Mesh(new THREE.SphereGeometry());
  root.add(mesh);
  configureActorPerformance(root, null, { modelKey: 'no-low' });
  updateActorPerformance(root, 25);
  assert.equal(mesh.castShadow, true);
  assert.equal(root.userData.actorDetail.meshes[0].shadow, null);
  updateActorPerformance(root, 35);
  assert.equal(mesh.castShadow, false);
  updateActorPerformance(root, 5);
  assert.equal(mesh.castShadow, true);
  disposeActorPerformance(root);
});

test('reduced skinned shadows follow bones and transformed mesh parents without a second skeleton', () => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 2, 0], 3),
  );
  geometry.setAttribute(
    'skinIndex',
    new THREE.Uint16BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0], 4),
  );
  geometry.setAttribute(
    'skinWeight',
    new THREE.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4),
  );
  const root = new THREE.Group(),
    parent = new THREE.Group(),
    base = new THREE.Bone(),
    tip = new THREE.Bone();
  tip.position.y = 1;
  base.add(tip);
  const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshStandardMaterial());
  mesh.name = 'body';
  parent.add(mesh, base);
  root.add(parent);
  root.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton([base, tip]));
  const lowRoot = new THREE.Group(),
    low = mesh.clone(false);
  low.geometry = geometry.clone();
  lowRoot.add(low);
  configureActorPerformance(root, lowRoot, { modelKey: 'skinned-test' });
  updateActorPerformance(root, 24);
  const shadow = root.userData.actorDetail.meshes[0].shadow;
  assert.equal(shadow.skeleton, mesh.skeleton);
  root.position.set(19, 4, -11);
  root.rotation.y = 0.8;
  root.scale.set(1.2, 1.6, 0.8);
  parent.rotation.z = 0.2;
  mesh.position.x = 0.25;
  mesh.rotation.y = 0.1;
  for (const angle of [-0.6, 0, 0.7]) {
    tip.rotation.z = angle;
    root.updateMatrixWorld(true);
    mesh.skeleton.update();
    for (let i = 0; i < 3; i++) {
      const real = mesh.getVertexPosition(i, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld);
      const projected = shadow
        .getVertexPosition(i, new THREE.Vector3())
        .applyMatrix4(shadow.matrixWorld);
      assert.ok(real.distanceTo(projected) < 1e-6, 'shadow and source share the same posed space');
    }
  }
  let skeletonDisposed = false;
  mesh.skeleton.dispose = () => {
    skeletonDisposed = true;
  };
  disposeActorPerformance(root);
  assert.equal(skeletonDisposed, false);
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
