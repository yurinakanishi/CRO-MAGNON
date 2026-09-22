import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createGameCore } from '../dist/application/game-core.mjs';
import { COAST_GRID, COAST_RUNS } from '../dist/shared/paleo-coast-data.mjs?pacific-test';
import {
  coastTextureData,
  EARTH,
  isLand,
  chunkHasLand,
  locationName,
} from '../dist/shared/paleo-geography.mjs';
import { mountainLandDistance } from '../dist/shared/camp-mountain.mjs';
import {
  GULF_SPINE,
  LANDINGS,
  SETTLEMENTS as OLD_SETTLEMENTS,
} from '../dist/shared/gulf-archive.mjs';
import * as live from '../dist/shared/gulf-region.mjs';
import { SCENERY } from '../dist/shared/scenery-layout.mjs';
import { INITIAL_RESOURCES } from '../dist/shared/world.mjs';
import { CollisionWorld, staticObstacles } from '../dist/shared/collision.mjs';
import { waterBodyFree } from '../dist/shared/boats.mjs';
import { WARP_POINTS } from '../dist/shared/warp-sites.mjs';
import { handleGulfAction } from '../dist/shared/gulf-life.mjs';
import { handleHuntingAction, updateHunting } from '../dist/shared/hunting.mjs';
import { handleCoastalAction } from '../dist/shared/coastal-craft.mjs';
import { ROOT_RECIPES } from '../dist/shared/crops.mjs';

class Socket extends EventEmitter {
  readyState = 1;
  bufferedAmount = 0;
  messages = [];
  send(s) {
    this.messages.push(JSON.parse(s));
  }
  ping() {}
  close() {
    this.readyState = 3;
    this.emit('close');
  }
  terminate() {
    this.close();
  }
}
const make = () => {
  const core = createGameCore({ persistentSessions: true, keepEmptyRooms: true });
  const socket = new Socket();
  core.connect(socket, new URLSearchParams({ room: 'RETIRE', name: 'preserved', resume: '1' }));
  const room = core.rooms.get('RETIRE'),
    player = [...room.players.values()][0];
  return { core, socket, room, player };
};

test('every shoreline byte matches the archived Earth source plus the unchanged camp mountain only', () => {
  const raw = new Uint8Array(COAST_GRID.width * COAST_GRID.height);
  let offset = 0;
  for (let i = 0; i < COAST_RUNS.length; i += 2) {
    raw.fill(COAST_RUNS[i + 1], offset, offset + COAST_RUNS[i]);
    offset += COAST_RUNS[i];
  }
  const grid = coastTextureData();
  let differing = 0;
  for (let z = 0; z < grid.height; z++)
    for (let x = 0; x < grid.width; x++) {
      const wx = grid.minX + (x + 0.5) * 2,
        wz = grid.minZ + (z + 0.5) * 2;
      const bx = (wx - EARTH.minX - 1) / 2,
        bz = (wz - EARTH.minZ - 1) / 2;
      let expected =
        bx >= 0 && bz >= 0 && bx < COAST_GRID.width && bz < COAST_GRID.height
          ? raw[bz * COAST_GRID.width + bx]
          : 0;
      if (wx >= -215 && wx <= 65 && wz >= 30 && wz < 316)
        expected = Math.max(
          expected,
          Math.max(0, Math.min(255, Math.round(128 + 4 * mountainLandDistance(wx, wz)))),
        );
      if (grid.data[z * grid.width + x] !== expected) differing++;
    }
  assert.equal(differing, 0, 'no synthetic island or change to other coast cells');
});

test('former island is navigable water with no land chunks, sites, resources, warp targets or colliders', () => {
  const collision = new CollisionWorld();
  for (const p of [...GULF_SPINE, ...OLD_SETTLEMENTS, ...LANDINGS]) {
    assert.equal(isLand(p.x, p.z), false);
    assert.ok(waterBodyFree(p.x, p.z, 2));
    assert.equal(chunkHasLand(p.x, p.z), false);
    assert.equal(collision.free(p, 0.32), false);
    assert.equal(locationName(p.x, p.z), '海');
  }
  for (const key of [
    'COUNTRIES',
    'SETTLEMENTS',
    'GULF_STOPS',
    'FARM_PLOTS',
    'LANDINGS',
    'GULF_LANDMARKS',
    'GULF_RESOURCES',
    'OBSIDIAN_OUTCROPS',
  ])
    assert.equal(live[key].length, 0, key);
  for (const list of [INITIAL_RESOURCES, WARP_POINTS, ...Object.values(SCENERY), staticObstacles()])
    assert.ok(list.every((p) => !String(p.id ?? p.landmarkId ?? '').startsWith('gulf-')));
});

for (const version of [1, 2])
  test(`version ${version} island saves move people and boats safely without changing other progress`, () => {
    const { core, room, player } = make();
    Object.assign(player.inventory, {
      wood: 17,
      rawRoot: 3,
      herb: 2,
      obsidianBlade: 2,
      cookedFish: 3,
    });
    room.resources[0].amount = 1;
    room.camp.wood = 7;
    const saved = core.exportState(),
      r = saved.rooms[0];
    r.gulf.version = version;
    const p = r.sessions[0].player,
      origin = version === 1 ? { x: -1770, z: 650 } : { x: -2270, z: 450 };
    Object.assign(p, origin, { energy: 63, boatId: 'old-boat' });
    const shore = version === 1 ? { x: -1499, z: 850 } : LANDINGS[2];
    r.boats = [0, 1].map((i) => ({
      id: i ? 'other-boat' : 'old-boat',
      x: shore.x - 7,
      z: shore.z,
      radius: 2,
      facing: 0,
      riderId: null,
      path: [],
      mooring: { x: shore.x - 7, z: shore.z },
      shore: { x: shore.x, z: shore.z },
    }));
    const other = structuredClone(r.sessions[0]);
    other.token = 'another-token';
    other.player.id = 'other-player';
    other.player.name = 'other';
    Object.assign(other.player, { x: 60, z: 59, boatId: null });
    r.sessions.push(other);
    const original = JSON.stringify(saved),
      inventory = { ...p.inventory };
    const next = createGameCore({ persistentSessions: true, keepEmptyRooms: true });
    next.importState(saved);
    const restored = next.rooms.get('RETIRE'),
      people = [...restored.sessions.values()].map((s) => s.player);
    assert.equal(JSON.stringify(saved), original, 'caller save unmodified');
    assert.deepEqual(people[0].inventory, inventory);
    assert.equal(people[0].energy, 63);
    assert.ok(restored.collision.free(people[0], people[0].radius));
    assert.ok(Math.hypot(people[0].x - 49, people[0].z - 52.4) < 8);
    assert.deepEqual({ x: people[1].x, z: people[1].z }, { x: 60, z: 59 });
    assert.equal(restored.camp.wood, 7);
    assert.equal(restored.resources[0].amount, 1);
    assert.equal(restored.residents.length, 0);
    assert.equal(restored.gulf.plots.length, 0);
    assert.deepEqual(
      restored.boats.map((b) => b.id),
      ['old-boat', 'other-boat'],
    );
    for (const b of restored.boats) {
      assert.ok(waterBodyFree(b.x, b.z, b.radius));
      assert.ok(restored.collision.free(b.shore, 0.32));
    }
    assert.ok(
      Math.hypot(
        restored.boats[0].x - restored.boats[1].x,
        restored.boats[0].z - restored.boats[1].z,
      ) >= 4,
    );
    core.close();
    next.close();
  });

test('forged retired warps and reward actions cannot move players or create free inventory', () => {
  const { core, room, player, socket } = make();
  const before = { x: player.x, z: player.z, inventory: { ...player.inventory } };
  socket.emit(
    'message',
    JSON.stringify({ type: 'action', action: 'warp', targetId: 'gulf-fire-many-hearths' }),
  );
  assert.deepEqual({ x: player.x, z: player.z, inventory: player.inventory }, before);
  Object.assign(player, { x: -2270, z: 455 });
  for (const action of ['gulfWelcome', 'gulfTrailReward', 'gulfFeast'])
    assert.equal(handleGulfAction(room, player, { action }, Date.now()).ok, false);
  assert.deepEqual(player.inventory, before.inventory);
  core.close();
});

test('saved root ingredients still cook at a surviving camp; removed workstations cannot consume saved blades', () => {
  const { core, room, player } = make();
  Object.assign(player, { x: 50, z: 52, energy: 30 });
  for (const recipe of ROOT_RECIPES) {
    for (const [key, n] of Object.entries(recipe.ingredients)) player.inventory[key] = n;
    player.inventory[recipe.output] = 0;
    const now = Date.now();
    const result = handleHuntingAction(room, player, { action: recipe.action }, now);
    assert.equal(result.changed, true, recipe.action);
    updateHunting(room, now + 3100, () => {});
    assert.equal(player.inventory[recipe.output], 1);
    for (const key of Object.keys(recipe.ingredients)) assert.equal(player.inventory[key], 0);
  }
  player.inventory.obsidianBlade = 1;
  player.inventory.wood = 3;
  player.species = 'cro';
  player.spearHead = 'wood';
  assert.equal(
    handleCoastalAction(room, player, { action: 'haftSpear' }, Date.now()).changed,
    false,
  );
  assert.equal(player.spearHead, 'wood');
  assert.equal(player.inventory.obsidianBlade, 1);
  core.close();
});
