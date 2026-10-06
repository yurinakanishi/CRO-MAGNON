import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import * as THREE from 'three';
import { WorldAssets } from '../dist/src/world-assets.js';
import { buildStonePile } from '../dist/src/stone-pile.js';
import { WorldRenderer } from '../dist/src/world3d.js';
import { RegionalScenery } from '../dist/src/regional-scenery.js';
import {
  stonePileBounds,
  stonePileLayout,
  STONE_PIECE_SCALE,
} from '../dist/shared/stone-pile-layout.mjs';
import { MODEL_BOUNDS } from '../dist/shared/model-bounds.mjs';
import { INITIAL_RESOURCES } from '../dist/shared/world.mjs';
import { resourceAppearance } from '../dist/shared/biome-scenery.mjs';
import { staticObstacles } from '../dist/shared/collision.mjs';
import { GATHER_RANGE, interactionVisible } from '../dist/shared/interactions.mjs';
import { createGameCore } from '../dist/application/game-core.mjs';

function fixture() {
  const source = MODEL_BOUNDS['valley-boulder'];
  const scene = new THREE.Group();
  const geometry = new THREE.BoxGeometry(...source.max.map((n, axis) => n - source.min[axis]));
  const material = new THREE.MeshStandardMaterial();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.fromArray(source.max.map((n, axis) => (n + source.min[axis]) / 2));
  scene.add(mesh);
  const assets = new WorldAssets();
  assets.templates.set('valley-boulder', {
    gltf: { scene },
    lods: [{ scene: scene.clone(true) }, { scene: scene.clone(true) }],
    asset: { modelKey: 'valley-boulder', heightMetres: 1.7 },
  });
  return { assets, geometry, material };
}
function batches(root) {
  const list = [];
  root.traverse((node) => {
    if (node.isInstancedMesh) list.push(node);
  });
  return list;
}
function renderer(assets, resources) {
  return Object.assign(Object.create(WorldRenderer.prototype), {
    assetsReady: true,
    worldAssets: assets,
    state: { resources },
    resources: new Map(),
    scene: new THREE.Scene(),
    regionalScenery: { wants: () => true },
  });
}

test('collection removes whole stones at every LOD without shrinking or moving surviving stones', () => {
  const { assets, geometry, material } = fixture();
  const stone = buildStonePile(assets, 8, null),
    other = buildStonePile(assets, 8, null);
  const list = batches(stone.root),
    original = list.map((batch) => [...batch.instanceMatrix.array]);
  assert.equal(list.length, 3);
  list.forEach((batch) => {
    assert.equal(batch.geometry, geometry);
    assert.equal(batch.material, material);
  });
  const world = Object.create(WorldRenderer.prototype);
  for (let amount = 8; amount >= 0; amount--) {
    world.applyResourceAmount(
      { stone, model: stone.root },
      { type: 'stone', amount, maxAmount: 8 },
    );
    assert.equal(stone.root.visible, amount > 0);
    assert.deepEqual(stone.root.scale.toArray(), [1, 1, 1]);
    list.forEach((batch, i) => {
      assert.equal(batch.count, amount);
      assert.deepEqual([...batch.instanceMatrix.array], original[i]);
    });
    batches(other.root).forEach((batch) => assert.equal(batch.count, 8));
  }
  for (const amount of [1, 3, 8, 99, -2, 2.8]) {
    stone.setAmount(amount);
    list.forEach((batch, i) => {
      assert.equal(batch.count, Math.max(0, Math.min(Math.floor(amount), 8)));
      assert.deepEqual([...batch.instanceMatrix.array], original[i]);
    });
  }
  stone.dispose();
  other.dispose();
});

test('real stone capacities have supported layers and the same client/server footprint', () => {
  const base = MODEL_BOUNDS['valley-boulder'];
  const spacing = (base.max[0] - base.min[0]) * STONE_PIECE_SCALE * 0.88;
  for (const total of new Set(
    INITIAL_RESOURCES.filter((r) => r.type === 'stone').map((r) => r.maxAmount),
  )) {
    const slots = stonePileLayout(total),
      bounds = stonePileBounds(total);
    assert.equal(slots.length, total);
    assert.ok(Math.abs(bounds.min[1]) < 1e-9, 'bottom stones touch the ground');
    slots.forEach((slot, index) => {
      assert.equal(slot.scale, STONE_PIECE_SCALE);
      if (index)
        assert.ok(slot.y >= slots[index - 1].y, 'top stones disappear before their supports');
      if (slot.y > slots[0].y) {
        const supports = slots.filter(
          (s) => s.y < slot.y && Math.abs(Math.abs(s.x - slot.x) - spacing / 2) < 1e-7,
        );
        assert.ok(supports.some((s) => s.x < slot.x) && supports.some((s) => s.x > slot.x));
      }
      const transform = new THREE.Matrix4()
        .makeRotationY(slot.yaw)
        .scale(new THREE.Vector3().setScalar(slot.scale))
        .setPosition(slot.x, slot.y, slot.z);
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
  for (const resource of INITIAL_RESOURCES.filter((r) => r.type === 'stone')) {
    const appearance = resourceAppearance(resource);
    assert.equal(appearance.key, 'valley-boulder');
    assert.equal(appearance.scale, 1);
    const collider = colliders.find((o) => o.resourceId === resource.id),
      bounds = stonePileBounds(resource.maxAmount);
    assert.ok(collider);
    assert.ok(Math.abs(collider.hx - (bounds.max[0] - bounds.min[0]) / 2) < 1e-9);
    assert.ok(Math.abs(collider.hz - (bounds.max[2] - bounds.min[2]) / 2) < 1e-9);
    assert.ok(Math.abs(collider.height - bounds.max[1]) < 1e-9);
  }
  assert.deepEqual(stonePileLayout(0), []);
  assert.deepEqual(stonePileBounds(0), { min: [0, 0, 0], max: [0, 0, 0] });
});

test('syncResources restores regenerated stones in place and retains regional appearance', () => {
  const { assets } = fixture();
  const resource = {
    id: 'snow-stone-test',
    type: 'stone',
    x: 0,
    z: 0,
    maxAmount: 7,
    amount: 7,
    appearanceBiome: 'snow',
  };
  const world = renderer(assets, [resource]);
  world.syncResources();
  const item = world.resources.get(resource.id),
    list = batches(item.model);
  const original = list.map((batch) => [...batch.instanceMatrix.array]);
  assert.equal(item.surface, 'snow');
  assert.equal(item.model.userData.regionalSurface, 'snow');
  assert.ok(item.stone);
  for (const amount of [6, 1, 0, 1, 7]) {
    resource.amount = amount;
    world.syncResources();
    assert.equal(world.resources.get(resource.id), item);
    assert.equal(item.model.visible, amount > 0);
    assert.deepEqual(item.model.scale.toArray(), [1, 1, 1]);
    list.forEach((batch, i) => {
      assert.equal(batch.count, amount);
      assert.deepEqual([...batch.instanceMatrix.array], original[i]);
    });
  }
  item.stone.dispose();
});

test('regional eviction frees stone instances while retaining shared asset geometry and material', () => {
  const { assets } = fixture();
  const stone = buildStonePile(assets, 7, 'snow');
  let buffers = 0,
    geometryDisposals = 0,
    materialDisposals = 0;
  for (const batch of batches(stone.root)) {
    batch.addEventListener('dispose', () => buffers++);
    batch.geometry.addEventListener('dispose', () => geometryDisposals++);
    batch.material.addEventListener('dispose', () => materialDisposals++);
  }
  const world = {
    scene: new THREE.Scene(),
    resources: new Map([
      ['snow-stone', { key: 'valley-boulder', surface: 'snow', model: stone.root, stone }],
    ]),
    landscapes: [],
    staticScenery: [],
  };
  world.scene.add(stone.root);
  RegionalScenery.prototype.evict.call(
    { world, landscapes: new Map(), props: new Map() },
    'valley-boulder:snow',
  );
  assert.equal(buffers, 3);
  assert.equal(geometryDisposals, 0);
  assert.equal(materialDisposals, 0);
  assert.equal(world.resources.size, 0);
  assert.equal(stone.root.parent, null);
});

test('stone piles select their near, middle and far LODs without changing the remaining count', () => {
  const { assets } = fixture(),
    stone = buildStonePile(assets, 8, null);
  stone.setAmount(3);
  const camera = new THREE.PerspectiveCamera();
  for (const [distance, expected] of [
    [9, 0],
    [12, 1],
    [26, 2],
    [24, 2],
    [17, 1],
    [8, 0],
  ]) {
    camera.position.set(0, 0, distance);
    camera.updateMatrixWorld(true);
    stone.root.update(camera);
    assert.equal(stone.root.getCurrentLevel(), expected);
    batches(stone.root).forEach((batch) => assert.equal(batch.count, 3));
  }
  stone.dispose();
});

class Socket extends EventEmitter {
  readyState = 1;
  bufferedAmount = 0;
  send() {}
  close() {
    this.readyState = 3;
    this.emit('close');
  }
  command(message) {
    this.emit('message', Buffer.from(JSON.stringify(message)), false);
  }
}
test('authoritative hand and tool gathering remove exactly the number of stones added to inventory', () => {
  for (const tool of [false, true]) {
    let now = 100000,
      id = 0;
    const core = createGameCore({
      runtime: { now: () => now, id: () => 'stone-' + ++id, token: () => 'stone-session-' + ++id },
    });
    const socket = new Socket();
    core.connect(socket, new URLSearchParams({ room: 'STONE', name: '旅人' }));
    const room = core.rooms.get('STONE'),
      player = [...room.players.values()][0];
    const resource = room.resources.find((r) => r.type === 'stone');
    const spot = Array.from({ length: 16 }, (_, n) => ({
      x: resource.x + Math.sin((n * Math.PI) / 8) * 2.5,
      z: resource.z + Math.cos((n * Math.PI) / 8) * 2.5,
    })).find(
      (p) =>
        room.collision.free(p, player.radius) && interactionVisible(room.collision, p, resource),
    );
    assert.ok(spot);
    assert.ok(Math.hypot(spot.x - resource.x, spot.z - resource.z) < GATHER_RANGE);
    Object.assign(player, spot, { tool });
    const { assets } = fixture(),
      world = renderer(assets, [resource]);
    world.syncResources();
    const item = world.resources.get(resource.id),
      list = batches(item.model),
      original = list.map((b) => [...b.instanceMatrix.array]);
    while (resource.amount > 0) {
      const before = resource.amount,
        inventory = player.inventory.stone;
      socket.command({ type: 'action', action: 'gather', targetId: resource.id });
      const collected = Math.min(before, tool ? 2 : 1);
      assert.equal(player.inventory.stone, inventory + collected);
      assert.equal(resource.amount, before - collected);
      world.syncResources();
      list.forEach((batch, i) => {
        assert.equal(batch.count, resource.amount);
        assert.deepEqual([...batch.instanceMatrix.array], original[i]);
      });
      now += 1000;
    }
    assert.equal(item.model.visible, false);
    item.stone.dispose();
    core.close();
  }
});
