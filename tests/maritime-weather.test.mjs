import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MARITIME,
  maritimeWeather,
  maritimeWeight,
  seaConditions,
  seaBoatSpeed,
} from '../dist/shared/maritime-weather.mjs';
import { CollisionWorld } from '../dist/shared/collision.mjs';
import {
  initializeBoats,
  updateBoats,
  waterBodyFree,
  handleBoatAction,
} from '../dist/shared/boats.mjs';
import { stopActor } from '../dist/shared/combat.mjs';
import { createGulfState, ensureGulfPlayer } from '../dist/shared/gulf-life.mjs';
import { handleFishingAction, updateFishing } from '../dist/shared/fishing.mjs';
import { FISHING_SITES } from '../dist/shared/fishing-sites.mjs';
import { createGameCore } from '../dist/application/game-core.mjs';
const started = 1_000_000;
const atPhase = (phase) => started + phase * MARITIME.periodMs;
const weather = (phase) => maritimeWeather(atPhase(phase), started);
function fixture(count = 1) {
  const room = {
    createdAt: started,
    collision: new CollisionWorld(),
    players: new Map(),
    animals: [],
    enemies: [],
    gulf: createGulfState(),
  };
  initializeBoats(room);
  for (let i = 0; i < count; i++) {
    const id = 'p' + i,
      x = -2220 + i * 8,
      z = 1145;
    const boat = {
      id: 'boat' + i,
      x,
      z,
      radius: 2,
      facing: 0,
      riderId: id,
      path: [],
      target: null,
      dx: 0,
      dz: 0,
      lastInput: 0,
      speed: 0,
      mooring: { x, z },
      shore: { x: -2516.5, z: 1150 },
    };
    const p = {
      id,
      x,
      z,
      radius: 0.32,
      species: 'cro',
      gender: 'female',
      boatId: boat.id,
      inventory: {},
      energy: 100,
      path: [],
    };
    ensureGulfPlayer(p);
    room.boats.push(boat);
    room.players.set(id, p);
    assert.ok(waterBodyFree(x, z, 2));
  }
  return room;
}
test('forecast switches at the shared boundary and includes the next weather without per-player clocks', () => {
  assert.equal(maritimeWeather(atPhase(1) - 1, started).kind, 'calm');
  assert.equal(weather(1).kind, 'breeze');
  assert.equal(weather(1).next, 'rain');
  assert.equal(weather(1).changesAt, atPhase(2));
  assert.equal(weather(6).kind, 'calm');
  assert.ok(weather(3).currentX < 0);
});
test('head of gulf and shoreline shelter boats; original continents and regional edges retain old speeds', () => {
  const rain = weather(2),
    outer = seaConditions(rain, -2200, 1145);
  assert.ok(outer.exposure > 0.99);
  assert.ok(seaConditions(rain, -2200, 600).exposure < 0.4);
  assert.ok(seaConditions(rain, -2526, 850).exposure < 0.3);
  for (const p of [
    { x: 21, z: 130 },
    { x: -1700, z: 220 },
    { x: -2950, z: 1150 },
  ]) {
    assert.equal(maritimeWeight(p.x, p.z), 0);
    assert.equal(seaBoatSpeed({ ...p, dx: 1, dz: 0 }, 7, rain), 7);
  }
});
test('with and against current differ, all phases allow headway, old snapshots have calm movement', () => {
  const b = { x: -2200, z: 1145, dx: 1, dz: 0 };
  assert.ok(seaBoatSpeed(b, 4, weather(1)) > seaBoatSpeed({ ...b, dx: -1 }, 4, weather(1)) + 1);
  assert.equal(seaBoatSpeed(b, 4), 4);
  for (let phase = 0; phase < 6; phase++)
    for (let angle = 0; angle < 6.3; angle += 0.2)
      for (const base of [4, 7]) {
        const speed = seaBoatSpeed(
          { ...b, dx: Math.cos(angle), dz: Math.sin(angle) },
          base,
          weather(phase),
        );
        assert.ok(speed >= base * 0.55 && speed <= base * 1.25);
      }
});
test('assisted paddling preserves analog input and stops after release or stale input', () => {
  const r = fixture(),
    b = r.boats[0],
    now = atPhase(2);
  b.dx = 1;
  b.lastInput = now;
  updateBoats(r, 0.1, now);
  const speed = b.speed;
  b.dx = 0.4;
  updateBoats(r, 0.1, now);
  assert.ok(Math.abs(b.speed - speed * 0.4) < 0.001);
  let point = { x: b.x, z: b.z };
  updateBoats(r, 0.1, now + 501);
  assert.deepEqual({ x: b.x, z: b.z }, point);
  stopActor(b);
  b.lastInput = now + 1000;
  updateBoats(r, 0.1, now + 1000);
  assert.deepEqual({ x: b.x, z: b.z }, point);
  b.riderId = null;
  updateBoats(r, 0.1, atPhase(3));
  assert.deepEqual({ x: b.x, z: b.z }, point);
});
test('targeted travel arrives without overshoot or lateral drift across a weather change', () => {
  const r = fixture(),
    b = r.boats[0],
    goal = { x: b.x + 8, z: b.z };
  b.target = { ...goal };
  for (let t = 0; t < 100; t++) updateBoats(r, 0.1, atPhase(2) - 500 + t * 100);
  assert.ok(Math.hypot(b.x - goal.x, b.z - goal.z) < 0.02);
  assert.equal(b.moving, false);
});
test('eight opposing hulls and riders remain synchronized without overlap in rain and current', () => {
  const r = fixture(8);
  for (let t = 0; t < 140; t++) {
    r.boats.forEach((b, i) => {
      b.dx = i % 2 ? -1 : 1;
      b.runningRequested = true;
      b.lastInput = atPhase(2) + t * 100;
    });
    updateBoats(r, 0.1, atPhase(2) + t * 100);
    for (let i = 0; i < 8; i++) {
      const b = r.boats[i],
        p = r.players.get(b.riderId);
      assert.equal(p.x, b.x);
      assert.equal(p.z, b.z);
      assert.ok(waterBodyFree(b.x, b.z, 2));
      for (let j = i + 1; j < 8; j++)
        assert.ok(Math.hypot(b.x - r.boats[j].x, b.z - r.boats[j].z) >= 4 - 0.0001);
    }
  }
});
test('a boat can return against rain current to the shore and cannot drive through land', () => {
  const r = fixture(),
    b = r.boats[0],
    p = r.players.get(b.riderId);
  Object.assign(b, { x: -2505, z: 1150, dx: -1, dz: 0, runningRequested: true });
  for (let t = 0; t < 120; t++) {
    b.lastInput = atPhase(2) + t * 100;
    updateBoats(r, 0.1, b.lastInput);
    assert.ok(waterBodyFree(b.x, b.z, 2));
  }
  assert.equal(handleBoatAction(r, p, { action: 'boardBoat' }, atPhase(2) + 12000).changed, true);
  assert.equal(p.boatId, null);
  assert.ok(r.collision.free(p, p.radius));
});
test('stopped offshore fishing completes through a weather transition without drift', () => {
  const r = fixture(),
    b = r.boats[0],
    p = r.players.get(b.riderId),
    site = FISHING_SITES.at(-1),
    now = atPhase(2) - 3000;
  Object.assign(b, { x: site.x, z: site.z });
  Object.assign(p, { x: site.x, z: site.z });
  p.gulf.fishingKit = true;
  assert.equal(handleFishingAction(r, p, { action: 'fish', targetId: site.id }, now).changed, true);
  for (let t = 0; t <= 60; t++) {
    updateBoats(r, 0.1, now + t * 100);
    updateFishing(r, now + t * 100);
  }
  assert.equal(p.inventory.rawFish, 1);
  assert.equal(p.fishing, null);
  assert.equal(b.x, site.x);
  assert.equal(b.z, site.z);
});
class Socket {
  readyState = 1;
  bufferedAmount = 0;
  messages = [];
  handlers = {};
  on(k, f) {
    this.handlers[k] = f;
  }
  send(s) {
    this.messages.push(JSON.parse(s));
  }
  ping() {
    this.handlers.pong?.();
  }
  close() {
    this.readyState = 3;
    this.handlers.close?.();
  }
  input(m) {
    this.handlers.message(Buffer.from(JSON.stringify(m)), false);
  }
}
test('eight clients share forecast; forged weather cannot change it; old export/restores preserve shared phase', () => {
  let now = started;
  const config = {
    playerLimit: 8,
    keepEmptyRooms: true,
    runtime: { now: () => now, id: () => crypto.randomUUID(), token: () => crypto.randomUUID() },
  };
  const core = createGameCore(config),
    peers = [];
  let restored;
  try {
    for (let i = 0; i < 8; i++) {
      const peer = new Socket();
      core.connect(peer, new URLSearchParams({ room: 'SEA-QA', name: 'P' + i, resume: '1' }));
      peers.push(peer);
    }
    now = atPhase(2);
    core.tick();
    const room = core.rooms.get('SEA-QA'),
      expected = core.snapshot(room).maritime;
    assert.equal(expected.kind, 'rain');
    for (const peer of peers)
      assert.deepEqual(peer.messages.filter((m) => m.type === 'state').at(-1).maritime, expected);
    peers[0].input({
      type: 'move',
      dx: 0,
      dz: 0,
      maritime: { kind: 'calm', currentX: 999 },
      currentX: 999,
    });
    assert.deepEqual(core.snapshot(room).maritime, expected);
    const saved = JSON.parse(JSON.stringify(core.exportState()));
    // Pre-weather records never contained a weather field; existing createdAt is sufficient.
    assert.equal(saved.rooms[0].maritime, undefined);
    restored = createGameCore(config);
    restored.importState(saved);
    assert.deepEqual(restored.snapshot(restored.rooms.get('SEA-QA')).maritime, expected);
    now = atPhase(3);
    assert.equal(restored.snapshot(restored.rooms.get('SEA-QA')).maritime.kind, 'breeze');
    assert.ok(restored.snapshot(restored.rooms.get('SEA-QA')).maritime.currentX < 0);
  } finally {
    core.close();
    restored?.close();
  }
});
