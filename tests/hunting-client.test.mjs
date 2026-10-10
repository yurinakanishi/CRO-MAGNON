import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { HUNTING } from '../dist/shared/hunting.mjs';
import {
  inventoryCounts,
  selectedHuntTarget,
  huntInteraction,
  attackReady,
} from '../dist/src/hunting-ui.js';
import { orientSpear } from '../dist/src/spear-pose.js';
import { WorldAssets } from '../dist/src/world-assets.js';
import { buildMeatPile } from '../dist/src/world-scenery.js';
import {
  berryAnchors,
  fruitCount,
  meatPieceVisibility,
  seedFromId,
} from '../dist/src/resource-visuals.js';
import { WorldRenderer } from '../dist/src/world3d.js';

test('hunting controls normalize legacy inventory and prioritize harvest or cooking', () => {
  assert.deepEqual(inventoryCounts({ wood: 2 }), {
    boat: 0,
    wood: 2,
    stone: 0,
    berry: 0,
    rawMeat: 0,
    cookedMeat: 0,
    obsidian: 0,
    seed: 0,
    water: 0,
    rawFish: 0,
    cookedFish: 0,
    rawShellfish: 0,
    cookedShellfish: 0,
    shells: 0,
    obsidianBlade: 0,
    rootSeed: 0,
    herbSeed: 0,
    rawRoot: 0,
    herb: 0,
    cookedRoot: 0,
    herbRoot: 0,
  });
  const me = { x: 50, z: 52, inventory: { rawMeat: 1 } },
    meat = { id: 'm', phase: 'meat', x: 50, z: 52, meatRemaining: 3 },
    state = { camp: { x: 50, z: 50 }, animals: [meat] };
  assert.deepEqual(huntInteraction(state, me), {
    action: 'harvest',
    targetId: 'm',
    label: '生肉を採る（残り3個）',
  });
  assert.equal(huntInteraction({ ...state, animals: [] }, me).action, 'cook');
  assert.equal(huntInteraction({ ...state, animals: [] }, { ...me, x: 80 }), null);
  assert.equal(huntInteraction(state, { ...me, cookingEndsAt: 1000 }).action, 'cancelCook');
});

test('target selection and nearby attack readiness never change the player position', () => {
  const me = { x: 0, z: 0, radius: 0.32 },
    a = { id: 'a', x: 10, z: 12, radius: 1.9, phase: 'alive' },
    b = { id: 'b', x: 20, z: 20, radius: 2, phase: 'alive' };
  assert.equal(selectedHuntTarget([a, b], me).id, 'a');
  assert.equal(selectedHuntTarget([a, b], me, 'b').id, 'b');
  assert.equal(selectedHuntTarget([a, { ...b, phase: 'respawning' }], me, 'b').id, 'a');
  assert.equal(attackReady(me, a), false);
  assert.equal(attackReady({ ...me, x: 10, z: 15 }, a), true);
  assert.deepEqual(me, { x: 0, z: 0, radius: 0.32 });
});

test('spear stays at animated grip and aims forward at every character heading', () => {
  const root = new THREE.Group(),
    grip = new THREE.Bone(),
    weapon = new THREE.Group();
  root.add(grip);
  grip.add(weapon);
  grip.position.set(0.3, 1.2, 0.5);
  grip.rotation.set(0.8, -0.4, 1.1);
  const initial = weapon.quaternion.clone();
  for (const heading of [0, Math.PI / 2, Math.PI, -Math.PI / 3]) {
    root.rotation.y = heading;
    root.updateMatrixWorld(true);
    const at = weapon.getWorldPosition(new THREE.Vector3());
    orientSpear(weapon, root, true, initial);
    root.updateMatrixWorld(true);
    const direction = new THREE.Vector3(0, 1, 0).applyQuaternion(
      weapon.getWorldQuaternion(new THREE.Quaternion()),
    );
    const expected = new THREE.Vector3(Math.sin(heading), 0, Math.cos(heading));
    assert.ok(direction.distanceTo(expected) < 1e-6);
    assert.ok(weapon.getWorldPosition(new THREE.Vector3()).distanceTo(at) < 1e-6);
  }
  orientSpear(weapon, root, false, initial);
  assert.deepEqual(weapon.quaternion.toArray(), initial.toArray());
});

test('animal death seeks to server phase time, clamps, and resets after respawn', () => {
  const root = new THREE.Group(),
    joint = new THREE.Bone();
  joint.name = 'Body';
  root.add(joint);
  const clips = ['Idle_Loop', 'Walk_Loop', 'Death'].map(
    (name, index) =>
      new THREE.AnimationClip(name, 1, [
        new THREE.NumberKeyframeTrack('Body.position[y]', [0, 1], [0, index]),
      ]),
  );
  const assets = new WorldAssets();
  assets.templates.set('test', { gltf: { scene: root, animations: clips }, asset: {} });
  const actor = assets.createAnimal('test');
  actor.play('Walk_Loop');
  actor.update(0.6);
  actor.sampleOnce('Death', 0.5);
  assert.equal(actor.name, 'Death');
  assert.ok(Math.abs(actor.root.getObjectByName('Body').position.y - 1) < 1e-6);
  actor.sampleOnce('Death', 3);
  assert.equal(actor.root.getObjectByName('Body').position.y, 2);
  actor.stop();
  assert.equal(actor.name, null);
  actor.play('Idle_Loop');
  actor.update(0.1);
  assert.equal(actor.root.getObjectByName('Body').position.y, 0);
  actor.dispose();
});

test('resource models deplete visibly: fruit count and boulder scale', async (t) => {
  const bush = new THREE.Group(),
    leaves = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 8), new THREE.MeshStandardMaterial());
  leaves.position.y = 0.7;
  bush.add(leaves);
  const assets = new WorldAssets();
  t.after(() => assets.dispose());
  assets.templates.set('berry-bush', {
    gltf: { scene: bush },
    lods: [{ scene: bush.clone(true) }],
    asset: { heightMetres: 1.2 },
  });
  const points = assets.modelPoints('berry-bush');
  assert.ok(points.length > 50 && points.every(([, y]) => y >= 0.19), 'points are in model space');
  assert.deepEqual(assets.modelPoints('missing'), []);
  // Test-only stand-in for the verified TRELLIS berry-cluster prop. Like the
  // delivered GLB, its pivot is the bottom centre. Power-of-two extents are exact
  // in the Float32 position buffer, so the pivot is exactly y = 0. (A 0.06 radius
  // stores its bottom as float32(-0.06) + 0.06 = 1.34e-9, raising every centre.)
  const clusterGeometry = new THREE.BoxGeometry(0.125, 0.125, 0.125).translate(0, 0.0625, 0),
    clusterScene = new THREE.Group();
  clusterScene.add(new THREE.Mesh(clusterGeometry, new THREE.MeshStandardMaterial()));
  // The shared in-flight equipment load that createEquipment awaits. It stays pending
  // until released, then installs the template as the verified loader does.
  let release;
  assets.equipmentLoads.set(
    'berry-cluster',
    new Promise((resolve) => (release = resolve)).then(() => {
      assets.templates.set('berry-cluster', {
        gltf: { scene: clusterScene },
        lods: [],
        asset: { modelKey: 'berry-cluster', kind: 'prop' },
      });
    }),
  );
  const attachments = [];
  const renderer = () => {
    const world = Object.create(WorldRenderer.prototype);
    world.worldAssets = assets;
    world.disposed = false;
    // Reject the tracked attachment instead of reaching browser-only failWorld state.
    world.failWorld = (message, error) => {
      throw new Error(message, { cause: error });
    };
    world.attachBerryClusters = (...args) => {
      const attached = WorldRenderer.prototype.attachBerryClusters.apply(world, args);
      attachments.push(attached);
      return attached;
    };
    return world;
  };
  const bushItem = () => ({
    model: assets.createResource('berry-bush'),
    key: 'berry-bush',
    surface: null,
    baseScale: 1,
  });
  const world = renderer();
  const full = { id: 'berry-1', type: 'berry', amount: 5, maxAmount: 5 };
  const berry = { ...bushItem(), resource: full },
    berryModel = berry.model;
  assert.ok(berryModel.isLOD);
  world.decorateResource(berry, full);
  assert.equal(berry.fruit.parent, berryModel, 'fruit hangs off the LOD root, not a level');
  // Harvests that arrive while the prop is still loading.
  for (const amount of [4, 2]) {
    berry.resource = { ...full, amount };
    world.applyResourceAmount(berry, berry.resource);
  }
  assert.equal(berry.fruit.children.length, 0, 'no fruit is drawn before the verified prop loads');
  // A fruit target replaced during the load, and a renderer disposed during it.
  const replaced = bushItem();
  world.decorateResource(replaced, { id: 'berry-2', type: 'berry', amount: 5, maxAmount: 5 });
  const stale = replaced.fruit;
  world.decorateResource(replaced, { id: 'berry-2', type: 'berry', amount: 5, maxAmount: 5 });
  const closed = renderer(),
    orphan = bushItem();
  closed.decorateResource(orphan, { id: 'berry-3', type: 'berry', amount: 5, maxAmount: 5 });
  closed.disposed = true;
  assert.equal(attachments.length, 4);
  release();
  await Promise.all(attachments);
  assert.equal(berry.fruit.children.length, 5, 'one verified cluster per berry');
  assert.deepEqual(
    berry.fruit.children.map((f) => f.visible),
    [true, true, false, false, false],
    'the latest amount applies once the clusters attach',
  );
  const anchors = berryAnchors(
    assets.modelPoints('berry-bush'),
    fruitCount(full.maxAmount, full.maxAmount),
    seedFromId(full.id),
  );
  berryModel.updateMatrixWorld(true);
  berry.fruit.children.forEach((cluster, index) => {
    const meshes = [];
    cluster.traverse((node) => {
      if (node.isMesh) meshes.push(node);
    });
    assert.ok(
      meshes.length > 0 && meshes.every((mesh) => mesh.geometry === clusterGeometry),
      'each berry is an instance of the verified prop, not a substitute',
    );
    // Anchors are fruit centres on the upper, outer foliage.
    const centre = new THREE.Box3().setFromObject(cluster).getCenter(new THREE.Vector3());
    assert.ok(centre.distanceTo(new THREE.Vector3(...anchors[index])) < 1e-9);
    assert.ok(centre.y > 0.45 && Math.hypot(centre.x, centre.z) > 0.3);
  });
  assert.equal(stale.children.length, 0, 'a replaced fruit target never receives late clusters');
  assert.equal(replaced.fruit.children.length, 5);
  assert.equal(orphan.fruit.children.length, 0, 'a disposed renderer attaches nothing');
  // Obsidian is the boulder whose volume follows its amount (resourceAppearance:
  // valley-boulder at 0.55). Gathered stones remove whole pieces instead
  // (tests/stone-pile.test.mjs).
  const boulder = {
    model: new THREE.Group(),
    key: 'valley-boulder',
    surface: 'obsidian',
    baseScale: 0.55,
  };
  world.decorateResource(boulder, { id: 'obsidian-1', type: 'obsidian', amount: 8, maxAmount: 8 });
  world.applyResourceAmount(boulder, { type: 'obsidian', amount: 1, maxAmount: 8 });
  assert.ok(Math.abs(boulder.model.scale.x - 0.55 * 0.55) < 1e-9);
  world.applyResourceAmount(boulder, { type: 'obsidian', amount: 8, maxAmount: 8 });
  assert.ok(Math.abs(boulder.model.scale.x - 0.55) < 1e-9);
  assert.equal(attachments.length, 4, 'only berries load clusters');
});

test('a carcass leaves one meat piece per serving, hidden from the end and clickable', () => {
  const chunk = new THREE.Group();
  chunk.add(
    new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.13, 0.2), new THREE.MeshStandardMaterial()),
  );
  const assets = new WorldAssets();
  assets.templates.set('mammoth-meat', { gltf: { scene: chunk }, lods: [], asset: {} });
  const meat = buildMeatPile(assets, 'mammoth-2');
  assert.equal(meat.visible, false, 'the pile only appears once the animal is harvestable');
  assert.equal(meat.children.length, HUNTING.meatPerAnimal);
  assert.equal(meat.userData.animalId, 'mammoth-2');
  const angles = new Set(),
    yaws = new Set();
  for (const piece of meat.children) {
    assert.equal(piece.userData.animalId, 'mammoth-2', 'every piece answers the raycast');
    assert.ok(Math.abs(Math.hypot(piece.position.x, piece.position.z) - 0.45) < 1e-9);
    assert.equal(piece.position.y, 0);
    angles.add(Math.atan2(piece.position.z, piece.position.x).toFixed(3));
    yaws.add(piece.rotation.y.toFixed(3));
  }
  assert.equal(angles.size, HUNTING.meatPerAnimal, 'pieces are spread around the ring');
  assert.equal(yaws.size, HUNTING.meatPerAnimal, 'each piece faces its own way');
  // The click raycast hits a mesh deep inside a piece and walks up to the id.
  let root = meat.children[2].children[0].children[0] ?? meat.children[2].children[0];
  while (root && !root.userData.animalId) root = root.parent;
  assert.equal(root.userData.animalId, 'mammoth-2');
  // Taking two servings hides the last two pieces; the pile itself stays.
  const shown = meatPieceVisibility(2, meat.children.length);
  meat.children.forEach((piece, index) => (piece.visible = shown[index]));
  assert.deepEqual(
    meat.children.map((piece) => piece.visible),
    [true, true, false, false],
  );
});
