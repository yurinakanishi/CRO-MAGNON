import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { WARP_POINTS, warpUnavailable } from '../dist/shared/warp-sites.mjs';
import { handleWarpAction } from '../dist/shared/warping.mjs';
import { CHARACTER_MODELS } from '../dist/shared/characters.mjs';
import { WORLD } from '../dist/shared/world.mjs';
import { SCENERY } from '../dist/shared/scenery-layout.mjs';
import { ADVENTURE_REGIONS } from '../dist/shared/adventure-regions.mjs';
import { CollisionWorld, overlap } from '../dist/shared/collision.mjs';
import { ridingObstacles } from '../dist/shared/riding.mjs';
import { createGameCore } from '../dist/application/game-core.mjs';
import { LocalPrediction } from '../dist/src/local-prediction.js';
import { RegionalScenery } from '../dist/src/regional-scenery.js';
import { mapProjection, setWorldMapMode } from '../dist/src/world-map.js';

test('world overview keeps every selectable fire on screen and round trips its coordinates', () => {
  setWorldMapMode('earth');
  const projection = mapProjection({ width: 960, height: 480 }, true);
  for (const point of WARP_POINTS) {
    const [x, y] = projection.point(point.x, point.z);
    assert.ok(x > 12 && x < 948 && y > 12 && y < 468, point.id);
    const back = projection.world(x, y);
    assert.ok(Math.hypot(back.x - point.x, back.z - point.z) < 1e-8);
  }
});

test('leaving a distant region and disposing it frees label-free resources without removing other labels', () => {
  const removed = [],
    label = { element: {} },
    model = {};
  const owner = Object.create(RegionalScenery.prototype);
  Object.assign(owner, {
    landscapes: new Map(),
    props: new Map(),
    lastUsed: new Map([['rock:sand', 1]]),
    world: {
      scene: { remove: (o) => removed.push(o) },
      resources: new Map([
        ['one', { key: 'rock', surface: 'sand', model }],
        ['two', { key: 'rock', surface: 'snow', model: {} }],
      ]),
      labels: [label],
    },
  });
  owner.dispose();
  assert.deepEqual(removed, [model]);
  assert.deepEqual(owner.world.labels, [label]);
  assert.deepEqual([...owner.world.resources.keys()], ['two']);
  owner.dispose();
  assert.equal(removed.length, 1);
});

const collision = new CollisionWorld();
const seals = () => ({
  regions: Object.fromEntries(ADVENTURE_REGIONS.slice(0, 3).map((r) => [r.id, { claimed: true }])),
});
const player = (id = 'p') => ({
  id,
  x: 48,
  z: 57,
  radius: WORLD.playerRadius,
  species: 'cro',
  gender: 'female',
  energy: 73,
  inventory: { wood: 8, berry: 2 },
  adventure: seals(),
  facing: 1,
  path: [],
});
const room = (p) => ({
  players: new Map([[p.id, p]]),
  animals: [],
  enemies: [],
  residents: [],
  projectiles: [],
  collision,
});
const warp = (r, p, targetId = 'fire-snow', now = 10000) =>
  handleWarpAction(r, p, { action: 'warp', targetId }, now);

test('all 30 fire points match rendered cooking fires and land every selectable body without collision', () => {
  assert.equal(WARP_POINTS.length, 30);
  assert.equal(new Set(WARP_POINTS.map((p) => p.id)).size, WARP_POINTS.length);
  for (const site of WARP_POINTS) {
    assert.ok(
      SCENERY.fires.some((f) => f.x === site.x && f.z === site.z),
      site.id,
    );
    for (const character of CHARACTER_MODELS) {
      const p = { ...player(), ...character, radius: character.radius ?? WORLD.playerRadius },
        r = room(p);
      const inventory = { ...p.inventory };
      assert.equal(warp(r, p, site.id).ok, true, `${site.id}/${character.key}`);
      assert.ok(collision.free(p, p.radius), `${site.id}/${character.key}`);
      assert.ok(Math.hypot(p.x - site.x, p.z - site.z) <= 8);
      assert.deepEqual(p.inventory, inventory);
      assert.equal(p.energy, 73);
    }
  }
});

test('forged destination IDs and coordinates never move a player', () => {
  for (const targetId of [undefined, '', 'fire-unknown', '__proto__', { x: 0, z: 0 }]) {
    const p = player(),
      r = room(p),
      before = structuredClone(p);
    assert.equal(handleWarpAction(r, p, { targetId, x: 100, z: 100 }, 10000).ok, false);
    assert.deepEqual(p, before);
  }
});

test('server rejects unavailable action states without changing position or inventory', () => {
  for (const state of [
    { downedUntil: 20000 },
    { boatId: 'b' },
    { mountId: 'm' },
    { carrierId: 'a' },
    { passengerId: 'b' },
    { jumpSequence: 1, jumpAt: 10000 },
    { attackSequence: 1, attackAt: 10000 },
    { cookingEndsAt: 20000 },
    { fishing: {} },
    { coastalActivity: {} },
  ]) {
    const p = { ...player(), ...state },
      r = room(p),
      before = structuredClone(p);
    assert.equal(warp(r, p).ok, false, JSON.stringify(state));
    assert.deepEqual(p, before);
  }
});

test('shadow realm keeps its three-seal gate; ordinary unvisited continents are available', () => {
  const p = player(),
    r = room(p);
  p.adventure = { regions: {} };
  assert.equal(warp(r, p, 'adventure-fire-shadow-realm').ok, false);
  assert.equal(warp(r, p, 'fire-antarctica').ok, true);
  p.adventure = seals();
  assert.equal(warp(r, p, 'adventure-fire-shadow-realm', 13000).ok, true);
});

test('warp clears movement and outstanding attacks, keeps other projectiles, and throttles repeated travel', () => {
  const p = {
      ...player(),
      dx: 1,
      dz: 1,
      moving: true,
      runningRequested: true,
      pendingStrike: {},
      velocityX: 1,
      velocityZ: 1,
      target: { x: 1, z: 1 },
    },
    r = room(p);
  r.projectiles = [{ ownerId: p.id }, { ownerId: 'other' }];
  assert.equal(warp(r, p).ok, true);
  assert.equal(p.warpSequence, 1);
  assert.equal(p.dx, 0);
  assert.equal(p.velocityX, 0);
  assert.equal(p.pendingStrike, null);
  assert.equal(p.target, null);
  assert.equal(p.moving, false);
  assert.equal(p.runningRequested, false);
  assert.deepEqual(r.projectiles, [{ ownerId: 'other' }]);
  const before = { x: p.x, z: p.z };
  assert.equal(warp(r, p, 'fire-ice', 12999).ok, false);
  assert.deepEqual({ x: p.x, z: p.z }, before);
  assert.equal(warp(r, p, 'fire-ice', 13000).ok, true);
  assert.equal(p.warpSequence, 2);
});

test('five arrivals find separate free positions and a blocked arrival leaves all state intact', () => {
  const first = player(),
    r = room(first);
  for (let i = 0; i < 5; i++) {
    const p = { ...player(`p${i}`), radius: 0.76 };
    r.players.set(p.id, p);
    assert.equal(warp(r, p).ok, true);
    assert.ok(collision.free(p, p.radius, ridingObstacles(r, null, p)));
  }
  const p = player('blocked');
  r.players.set(p.id, p);
  r.collision = { nearestFree: () => null };
  const before = structuredClone(p);
  assert.equal(warp(r, p).ok, false);
  assert.deepEqual(p, before);
});

test('even a short warp resets displayed prediction instead of sliding through the fire', () => {
  const prediction = new LocalPrediction();
  prediction.enabled = true;
  const p = { ...player(), warpSequence: 0 };
  const free = { move: (p, dx, dz) => ({ x: p.x + dx, z: p.z + dz }) };
  prediction.receive(p, 0);
  prediction.step(0.016, 0, 10000, free, []);
  prediction.setInput(1, 0, true, 16);
  prediction.receive({ ...p, x: p.x + 2, warpSequence: 1 }, 16);
  const shown = prediction.step(0.016, 16, 10016, free, []);
  assert.equal(shown.x, p.x + 2);
  assert.equal(shown.z, p.z);
  assert.equal(shown.moving, false);
});

class Socket extends EventEmitter {
  readyState = 1;
  bufferedAmount = 0;
  messages = [];
  send(text) {
    this.messages.push(JSON.parse(text));
  }
  close() {
    this.readyState = 3;
    this.emit('close');
  }
}
test('wire action broadcasts arrival to both players and checkpoint resume preserves location and possessions', () => {
  let now = 10000,
    serial = 0;
  const core = createGameCore({
    persistentSessions: true,
    keepEmptyRooms: true,
    runtime: { now: () => now, id: () => `warp-${++serial}`, token: () => `token-${++serial}` },
  });
  const a = new Socket(),
    b = new Socket();
  core.connect(a, new URLSearchParams({ room: 'WARP', name: 'a', resume: '1' }));
  core.connect(b, new URLSearchParams({ room: 'WARP', name: 'b', resume: '1' }));
  const r = core.rooms.get('WARP'),
    p = [...r.players.values()][0],
    other = [...r.players.values()][1];
  const otherPosition = { x: other.x, z: other.z },
    inventory = { ...p.inventory };
  now += 1000;
  a.emit(
    'message',
    JSON.stringify({
      type: 'action',
      action: 'warp',
      targetId: 'gulf-fire-many-hearths',
      x: 99999,
      z: 99999,
    }),
  );
  assert.equal(p.warpSequence, 1);
  for (const socket of [a, b]) {
    const snapshot = socket.messages.filter((m) => m.type === 'state').at(-1);
    const visible = snapshot.players.find((v) => v.id === p.id);
    assert.equal(visible.x, p.x);
    assert.equal(visible.warpSequence, 1);
  }
  assert.deepEqual({ x: other.x, z: other.z }, otherPosition);
  assert.deepEqual(p.inventory, inventory);
  const token = a.messages.find((m) => m.type === 'welcome').session,
    destination = { x: p.x, z: p.z };
  const saved = core.exportState();
  const restored = createGameCore({
    persistentSessions: true,
    keepEmptyRooms: true,
    runtime: { now: () => now, id: () => `resumed-${++serial}`, token: () => `token-${++serial}` },
  });
  restored.importState(saved);
  const c = new Socket();
  restored.connect(c, new URLSearchParams({ room: 'WARP', resume: '1', session: token }));
  assert.equal(c.messages.find((m) => m.type === 'welcome').resumed, true);
  const resumed = [...restored.rooms.get('WARP').players.values()][0];
  assert.deepEqual({ x: resumed.x, z: resumed.z }, destination);
  assert.deepEqual(resumed.inventory, inventory);
});
