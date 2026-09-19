import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { CAMP, WORLD } from '../dist/shared/world.mjs';
import {
  CAMP_CAVE,
  CAVE_MURAL_VIEW,
  CAVE_APPROACH,
  CAMP_MOUNTAIN_TRAIL,
} from '../dist/shared/camp-cave-layout.mjs';
import { CAMP_CAVE_SURFACE } from '../dist/shared/camp-cave-surface.mjs';
import { CAMP_MOUNTAIN_SURFACE_DATA } from '../dist/shared/camp-mountain-surface-data.mjs';
import { mountainHeight } from '../dist/shared/camp-mountain.mjs';
import { walkHeight, cameraFloorHeight, riverX } from '../dist/shared/terrain.mjs';
import { CASTLE, CASTLE_GATE } from '../dist/shared/castle-layout.mjs';
import { CHARACTER_MODELS } from '../dist/shared/characters.mjs';
import { CollisionWorld } from '../dist/shared/collision.mjs';
import { moveActor } from '../dist/shared/movement.mjs';
import { isLand } from '../dist/shared/paleo-geography.mjs';
import { BEHEMOTH_GROUND, BEHEMOTH_MARSH } from '../dist/shared/behemoth-rules.mjs';
import { createGameCore } from '../dist/application/game-core.mjs';
import { EventEmitter } from 'node:events';
import { waterBodyFree } from '../dist/shared/boats.mjs';

test('cave and hill physics describe the exact delivered source meshes', async () => {
  for (const [key, data] of [
    ['camp-cave', CAMP_CAVE_SURFACE.data],
    ['camp-mountain', CAMP_MOUNTAIN_SURFACE_DATA],
  ]) {
    const asset = JSON.parse(await readFile(`public/models/${key}/asset.json`));
    const sha = createHash('sha256')
      .update(await readFile(`public${asset.url}`))
      .digest('hex');
    assert.equal(sha, data.sourceSha256 ?? data.sha256);
  }
});
test('outdoor camp and northern route stay level while the southern castle sits uphill', () => {
  assert.deepEqual([CAMP.x, CAMP.z], [50, 50]);
  for (let z = -110; z <= 58; z += 2) assert.equal(mountainHeight(50, z), 0, `north route z=${z}`);
  for (let x = 39; x <= 61; x += 2)
    for (let z = 39; z <= 59; z += 2) assert.ok(mountainHeight(x, z) < 0.03);
  assert.ok(CAMP_CAVE.z > CAMP.z && CAMP_CAVE.elevation >= 8);
  assert.ok(mountainHeight(CASTLE.x, CASTLE.z) >= 34);
  assert.ok(CASTLE.z > CAMP_CAVE.z);
  assert.ok(walkHeight(CASTLE_GATE.x, CASTLE_GATE.z) >= 34);
  for (let z = -64; z <= 184; z += 1)
    for (let dx = -6; dx <= 6; dx += 1)
      assert.equal(mountainHeight(riverX(z) + dx, z), 0, `river ${z}/${dx}`);
});
test('all seven characters walk into and out of the cave, then the full gentle trail to the castle', () => {
  const collision = new CollisionWorld();
  const goals = [
    ...CAVE_APPROACH,
    { x: CAMP_CAVE.x, z: CAMP_CAVE.z - 5 },
    CAVE_MURAL_VIEW,
    { x: CAMP_CAVE.x, z: CAMP_CAVE.z - 5 },
    ...CAMP_MOUNTAIN_TRAIL.slice(4),
    CASTLE_GATE,
    ...CAMP_MOUNTAIN_TRAIL.slice(0, -1).reverse(),
    { x: 48, z: 57 },
  ];
  for (const model of CHARACTER_MODELS) {
    const actor = {
      id: 'walker',
      species: model.species,
      gender: model.gender,
      x: 48,
      z: 57,
      radius: model.radius ?? WORLD.playerRadius,
      dx: 0,
      dz: 0,
      lastInput: 0,
    };
    let time = 1000;
    for (const goal of goals) {
      for (
        let step = 0;
        Math.hypot(actor.x - goal.x, actor.z - goal.z) > 0.08 && step < 1500;
        step++
      ) {
        const dx = goal.x - actor.x,
          dz = goal.z - actor.z,
          len = Math.hypot(dx, dz);
        actor.dx = dx / len;
        actor.dz = dz / len;
        actor.lastInput = time;
        moveActor(actor, 0.025, time, (p, x, z) => collision.move(p, x, z, p.radius));
        time += 25;
      }
      assert.ok(
        Math.hypot(actor.x - goal.x, actor.z - goal.z) < 0.1,
        `${model.key}: failed ${JSON.stringify(goal)} at ${actor.x},${actor.z}`,
      );
      assert.ok(collision.free(actor, actor.radius));
    }
  }
  for (let i = 1; i < CAMP_MOUNTAIN_TRAIL.length; i++) {
    const a = CAMP_MOUNTAIN_TRAIL[i - 1],
      b = CAMP_MOUNTAIN_TRAIL[i],
      length = Math.hypot(b.x - a.x, b.z - a.z),
      count = Math.ceil(length / 0.2);
    let previous = mountainHeight(a.x, a.z);
    for (let j = 1; j <= count; j++) {
      const x = a.x + ((b.x - a.x) * j) / count,
        z = a.z + ((b.z - a.z) * j) / count,
        h = mountainHeight(x, z);
      assert.ok(Math.abs(h - previous) / (length / count) < 0.35, `trail slope ${i}/${j}`);
      assert.ok(isLand(x, z, 0.8));
      previous = h;
    }
  }
});
test('automatic routes leave the cave by its entrance and follow the uphill trail both ways', () => {
  const collision = new CollisionWorld();
  for (const lower of [{ x: 48, z: 57 }, CAVE_MURAL_VIEW]) {
    for (const [start, goal] of [
      [lower, CASTLE_GATE],
      [CASTLE_GATE, lower],
    ]) {
      const path = collision.path(start, goal, 0.32);
      assert.ok(path.length, `route ${JSON.stringify(start)} -> ${JSON.stringify(goal)}`);
      let previous = start;
      for (const p of path) {
        assert.ok(collision.segmentFree(previous, p, 0.32));
        previous = p;
      }
      assert.ok(Math.hypot(previous.x - goal.x, previous.z - goal.z) < 0.1);
      assert.ok(
        path.some((p) => Math.hypot(p.x - 35, p.z - 104) < 2),
        'passes the cave ledge',
      );
    }
  }
});
test('cave walls stop walking out sideways and the roof has room over the main aisle', () => {
  const collision = new CollisionWorld(),
    p = { x: CAMP_CAVE.x, z: CAMP_CAVE.z - 3 };
  for (let i = 0; i < 120; i++) Object.assign(p, collision.move(p, 0.1, 0, 0.32));
  assert.ok(p.x < CAMP_CAVE.x + 6, JSON.stringify(p));
  for (let z = CAMP_CAVE.z - 8; z <= CAMP_CAVE.z; z += 0.2)
    assert.ok(CAMP_CAVE_SURFACE.free(CAMP_CAVE.x, z, 0.76));
  assert.equal(
    collision.free({ x: CAMP_CAVE.x, z: CAMP_CAVE.z + 12 }, 0.32),
    false,
    'buried cave end is solid',
  );
  let walls = 0;
  for (let x = CAMP_CAVE.x - 6; x <= CAMP_CAVE.x + 6; x += 0.3)
    for (let z = CAMP_CAVE.z - 5; z <= CAMP_CAVE.z + 3; z += 0.3)
      if (CAMP_CAVE_SURFACE.height(x, z) === null) {
        assert.ok(
          cameraFloorHeight(x, z) < CAMP_CAVE.elevation + 1,
          'wall cells cannot push the camera onto the hill',
        );
        walls++;
      }
  assert.ok(walls > 20);
});
test('the relocated marsh remains low grassland beside the mountain and clear of the river', () => {
  for (let r = 0; r <= BEHEMOTH_MARSH.radius + 7; r += 3)
    for (let a = 0; a < Math.PI * 2; a += 0.1) {
      const x = BEHEMOTH_GROUND.x + Math.cos(a) * r,
        z = BEHEMOTH_GROUND.z + Math.sin(a) * r;
      assert.equal(mountainHeight(x, z), 0);
      assert.ok(isLand(x, z, 0.8));
      assert.ok(x - riverX(z) > 7);
    }
});
test('old mountain-area saves retain boats and move the giant beast to its current marsh', () => {
  const original = createGameCore({ keepEmptyRooms: true }),
    restored = createGameCore();
  const socket = new EventEmitter();
  Object.assign(socket, { readyState: 1, bufferedAmount: 0, send() {}, close() {} });
  try {
    original.connect(
      socket,
      new URLSearchParams({ room: 'LAND-MIGRATION', name: 'test', resume: '1' }),
    );
    const saved = original.exportState(),
      record = saved.rooms[0];
    const beast = record.enemies.find((e) => e.modelKey === 'violet-behemoth');
    Object.assign(beast, { x: -25, z: 70, home: { x: -25, z: 70 }, health: 123 });
    record.boats = [
      {
        id: 'boat-old',
        x: 21,
        z: 129,
        radius: 2,
        riderId: null,
        shore: { x: 21, z: 125 },
        mooring: { x: 21, z: 129 },
      },
    ];
    record.sessions[0].player.boatId = 'boat-old';
    record.sessions[0].player.inventory.wood = 17;
    restored.importState(saved);
    const room = restored.rooms.get('LAND-MIGRATION'),
      boat = room.boats[0];
    assert.ok(waterBodyFree(boat.x, boat.z, boat.radius));
    assert.ok(room.collision.free(boat.shore, 0.32));
    const player = [...room.sessions.values()][0].player;
    assert.equal(player.inventory.wood, 17);
    assert.equal(player.boatId, null);
    assert.deepEqual([player.x, player.z], [boat.shore.x, boat.shore.z]);
    const moved = room.enemies.find((e) => e.modelKey === 'violet-behemoth');
    assert.ok(Math.hypot(moved.x - BEHEMOTH_GROUND.x, moved.z - BEHEMOTH_GROUND.z) < 3);
    assert.equal(moved.health, 123);
  } finally {
    original.close();
    restored.close();
  }
});
