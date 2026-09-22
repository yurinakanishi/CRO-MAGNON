import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createGameCore } from '../dist/application/game-core.mjs';
import { CollisionWorld } from '../dist/shared/collision.mjs';
import { mammothGroundFree, mammothNavigation } from '../dist/shared/mammoth-navigation.mjs';
import { createAnimals, updateAnimals, restoreAnimalGround } from '../dist/shared/animals.mjs';
import { updateHunting, HUNTING } from '../dist/shared/hunting.mjs';
import { LocalPrediction } from '../dist/src/local-prediction.js';

const cliff = { x: 21.318996305325786, z: 89.20510326981861 };
const radius = 2.8039486423381748;
const empty = () => new CollisionWorld([], { coast: false, walkSurfaces: [] });

test('the measured cliff that the old herd climbed is free for people but unsafe for a mammoth body', () => {
  const world = empty();
  assert.ok(world.free(cliff, radius));
  assert.equal(mammothGroundFree(cliff, radius), false);
  const navigation = mammothNavigation(world);
  assert.equal(navigation.free(cliff, radius), false);
  assert.equal(navigation.segmentFree({ x: 24, z: 60 }, cliff, radius), false);
  assert.ok(world.move({ x: 24, z: 60 }, 0, 40, radius).z > 99);
  const stopped = navigation.move({ x: 24, z: 60 }, 0, 40, radius);
  assert.ok(stopped.z > 61 && stopped.z < 75, JSON.stringify(stopped));
  assert.ok(mammothGroundFree(stopped, radius));
});

test('both grazing herds wander on safe ground for a full two-minute cycle', () => {
  const collision = new CollisionWorld();
  const animals = createAnimals(collision, 0);
  const room = { collision, animals, players: new Map() };
  const walked = new Set();
  for (let i = 0; i < 2400; i++) {
    updateAnimals(room, 0.05, i * 50);
    for (const animal of animals) {
      assert.ok(
        mammothGroundFree(animal, animal.radius),
        `${animal.id} at ${animal.x},${animal.z}`,
      );
      if (animal.moving) walked.add(animal.id);
    }
  }
  assert.equal(walked.size, animals.length);
});

test('mounted movement and local prediction stop at the same slope boundary', () => {
  const collision = empty(),
    animals = createAnimals(collision, 0),
    animal = animals[1];
  Object.assign(animal, {
    x: 24,
    z: 60,
    home: { x: 24, z: 60 },
    riderId: 'rider',
    dx: 0,
    dz: 1,
    runningRequested: true,
  });
  const player = {
    id: 'rider',
    x: 24,
    z: 60,
    mountId: animal.id,
    radius: animal.radius,
    facing: 0,
  };
  const room = { collision, animals: [animal], players: new Map([[player.id, player]]) };
  const prediction = new LocalPrediction();
  prediction.enabled = true;
  for (let i = 1; i <= 600; i++) {
    const now = i * 50;
    animal.lastInput = now;
    prediction.receive({ ...player }, now);
    prediction.setInput(0, 1, true, now);
    const shown = prediction.step(
      0.05,
      now,
      now,
      mammothNavigation(collision),
      [],
      2.25 * animal.scale,
    );
    updateAnimals(room, 0.05, now);
    assert.ok(mammothGroundFree(animal, animal.radius));
    assert.ok(mammothGroundFree(shown, animal.radius));
    assert.ok(Math.hypot(shown.x - animal.x, shown.z - animal.z) < 0.001);
    assert.equal(player.z, animal.z);
  }
  assert.ok(animal.z > 61 && animal.z < 75);
  assert.equal(animal.moving, false);
});

test('old cliff positions and homes migrate once while health and safe riding locations are preserved', () => {
  const collision = new CollisionWorld(),
    animals = createAnimals(collision, 0),
    animal = animals[1];
  const safePost = { x: animal.x, z: animal.z },
    room = { collision, animals, players: new Map() };
  Object.assign(animal, cliff, { home: { x: 24, z: 85 }, health: 41 });
  restoreAnimalGround(room, animal, safePost);
  assert.ok(mammothGroundFree(animal, animal.radius));
  assert.ok(mammothGroundFree(animal.home, animal.radius));
  assert.equal(animal.health, 41);
  const valid = { x: animal.x, z: animal.z };
  restoreAnimalGround(room, animal, { x: 25, z: 21 });
  assert.deepEqual({ x: animal.x, z: animal.z }, valid);
  animal.home = { x: 24, z: 57 }; // Ground is gentle, but a wood pile occupies the body footprint.
  restoreAnimalGround(room, animal, safePost);
  assert.deepEqual(animal.home, safePost);
  assert.deepEqual({ x: animal.x, z: animal.z }, valid);
  animal.phase = 'respawning';
  animal.phaseStartedAt = 0;
  Object.assign(animal, cliff);
  updateHunting(room, HUNTING.respawnMs + 1);
  assert.equal(animal.phase, 'alive');
  assert.ok(mammothGroundFree(animal, animal.radius));
});

test('loading an actual old room relocates only the unsafe mammoth and retains its health', () => {
  class Socket extends EventEmitter {
    readyState = 1;
    bufferedAmount = 0;
    send() {}
    close() {
      this.readyState = 3;
      this.emit('close');
    }
  }
  const core = createGameCore({ persistentSessions: true, keepEmptyRooms: true });
  const restored = createGameCore({ persistentSessions: true, keepEmptyRooms: true });
  try {
    core.connect(new Socket(), new URLSearchParams({ room: 'MAMMOTH-SAVE', name: '検査' }));
    const saved = core.exportState();
    const before = saved.rooms[0].animals[0];
    Object.assign(saved.rooms[0].animals[1], cliff, { home: { x: 24, z: 85 }, health: 41 });
    restored.importState(saved);
    const animals = restored.rooms.get('MAMMOTH-SAVE').animals;
    assert.equal(animals[0].x, before.x);
    assert.equal(animals[0].z, before.z);
    assert.equal(animals[1].health, 41);
    assert.ok(mammothGroundFree(animals[1], animals[1].radius));
    assert.ok(mammothGroundFree(animals[1].home, animals[1].radius));
    assert.equal(restored.exportState().rooms[0].animals[1].health, 41);
  } finally {
    core.close();
    restored.close();
  }
});
