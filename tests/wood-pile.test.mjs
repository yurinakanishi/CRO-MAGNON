import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WorldAssets } from '../dist/src/world-assets.js';
import { buildWoodPile } from '../dist/src/wood-pile.js';
import { WorldRenderer } from '../dist/src/world3d.js';
import { woodPileBounds, woodPileLayout } from '../dist/shared/wood-pile-layout.mjs';
import { MODEL_BOUNDS } from '../dist/shared/model-bounds.mjs';
import { INITIAL_RESOURCES } from '../dist/shared/world.mjs';
import { resourceAppearance } from '../dist/shared/biome-scenery.mjs';
import { staticObstacles } from '../dist/shared/collision.mjs';
import { RegionalScenery } from '../dist/src/regional-scenery.js';

function fixture() {
  const scene = new THREE.Group();
  const geometry = new THREE.BoxGeometry(1.2, 0.28, 0.28);
  const material = new THREE.MeshStandardMaterial();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = 0.14;
  scene.add(mesh);
  const assets = new WorldAssets();
  assets.templates.set('firewood-log', {
    gltf: { scene },
    lods: [{ scene: scene.clone(true) }],
    asset: { modelKey: 'firewood-log', heightMetres: 0.28 },
  });
  return { assets, geometry, material };
}

test('each collection removes exactly one whole log at every LOD, leaving other transforms unchanged', () => {
  const { assets, geometry, material } = fixture();
  const wood = buildWoodPile(assets, 8, null),
    other = buildWoodPile(assets, 8, null);
  const batches = [];
  wood.root.traverse((n) => {
    if (n.isInstancedMesh) batches.push(n);
  });
  assert.equal(batches.length, 2);
  const original = batches.map((b) => [...b.instanceMatrix.array]);
  for (const batch of batches) {
    assert.equal(batch.geometry, geometry);
    assert.equal(batch.material, material);
    assert.ok(!batch.material.clippingPlanes?.length);
  }
  const world = Object.create(WorldRenderer.prototype);
  for (let amount = 8; amount >= 0; amount--) {
    world.applyResourceAmount({ wood }, { type: 'wood', amount, maxAmount: 8 });
    assert.equal(wood.root.visible, amount > 0);
    batches.forEach((b, i) => {
      assert.equal(b.count, amount);
      assert.deepEqual([...b.instanceMatrix.array], original[i]);
    });
    assert.equal(other.root.levels[0].object.children[0].count, 8);
  }
  for (const amount of [3, 8, 99, -2]) {
    wood.setAmount(amount);
    batches.forEach((b) => assert.equal(b.count, Math.max(0, Math.min(amount, 8))));
  }
  wood.dispose();
  other.dispose();
});

test('all actual wood capacities form supported layers inside their authoritative footprint', () => {
  const base = MODEL_BOUNDS['firewood-log'];
  const diameter = base.max[2] - base.min[2];
  for (const total of new Set(
    INITIAL_RESOURCES.filter((r) => r.type === 'wood').map((r) => r.maxAmount),
  )) {
    const slots = woodPileLayout(total),
      bounds = woodPileBounds(total);
    assert.equal(slots.length, total);
    slots.forEach((p, i) => {
      if (i) assert.ok(p.y >= slots[i - 1].y, 'upper logs are removed before their supports');
      if (p.y > 0) {
        const supports = slots.filter(
          (q) => q.y < p.y && Math.abs(Math.abs(q.z - p.z) - diameter / 2) < 1e-7,
        );
        assert.ok(
          supports.some((q) => q.z < p.z) && supports.some((q) => q.z > p.z),
          'each upper log lies between two lower logs',
        );
      }
      const transform = new THREE.Matrix4().makeRotationY(p.yaw).setPosition(p.x, p.y, p.z);
      const box = new THREE.Box3(
        new THREE.Vector3(...base.min),
        new THREE.Vector3(...base.max),
      ).applyMatrix4(transform);
      for (let axis = 0; axis < 3; axis++) {
        assert.ok(box.min.getComponent(axis) >= bounds.min[axis] - 1e-7);
        assert.ok(box.max.getComponent(axis) <= bounds.max[axis] + 1e-7);
      }
    });
  }
  const colliders = staticObstacles();
  for (const resource of INITIAL_RESOURCES.filter((r) => r.type === 'wood')) {
    assert.equal(resourceAppearance(resource).key, 'firewood-log');
    const collider = colliders.find((o) => o.resourceId === resource.id),
      bounds = woodPileBounds(resource.maxAmount);
    assert.ok(collider);
    assert.ok(Math.abs(collider.hx - (bounds.max[0] - bounds.min[0]) / 2) < 1e-9);
    assert.ok(Math.abs(collider.hz - (bounds.max[2] - bounds.min[2]) / 2) < 1e-9);
  }
});

test('regional eviction releases instance buffers without disposing the shared log asset', () => {
  const { assets, geometry, material } = fixture();
  const wood = buildWoodPile(assets, 7, 'snow');
  let buffers = 0,
    geometryDisposals = 0,
    materialDisposals = 0;
  wood.root.traverse((n) => {
    if (n.isInstancedMesh) n.addEventListener('dispose', () => buffers++);
  });
  geometry.addEventListener('dispose', () => geometryDisposals++);
  material.addEventListener('dispose', () => materialDisposals++);
  const world = {
    scene: new THREE.Scene(),
    resources: new Map([
      ['snow-wood', { key: 'firewood-log', surface: 'snow', model: wood.root, wood }],
    ]),
    landscapes: [],
    staticScenery: [],
  };
  world.scene.add(wood.root);
  RegionalScenery.prototype.evict.call(
    { world, landscapes: new Map(), props: new Map() },
    'firewood-log:snow',
  );
  assert.equal(buffers, 2);
  assert.equal(geometryDisposals, 0);
  assert.equal(materialDisposals, 0);
  assert.equal(world.resources.size, 0);
  assert.equal(wood.root.parent, null);
});

test('a newly created pile starts with the correct LOD before hysteresis applies', () => {
  const { assets } = fixture(),
    wood = buildWoodPile(assets, 7, null);
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 0, 9);
  camera.updateMatrixWorld(true);
  wood.root.update(camera);
  assert.equal(wood.root.getCurrentLevel(), 0);
  camera.position.z = 12;
  camera.updateMatrixWorld(true);
  wood.root.update(camera);
  assert.equal(wood.root.getCurrentLevel(), 1);
  camera.position.z = 9;
  camera.updateMatrixWorld(true);
  wood.root.update(camera);
  assert.equal(
    wood.root.getCurrentLevel(),
    1,
    'retain the current level within the hysteresis band',
  );
  camera.position.z = 8;
  camera.updateMatrixWorld(true);
  wood.root.update(camera);
  assert.equal(wood.root.getCurrentLevel(), 0);
  wood.dispose();
});
