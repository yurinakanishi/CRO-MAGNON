import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createGameCore } from '../dist/application/game-core.mjs';
import { CollisionWorld } from '../dist/shared/collision.mjs';
import {
  createResidents,
  updateResidents,
  handleVillageAction,
  ensureVillageProgress,
} from '../dist/shared/village-life.mjs';
import { createHouseholds, householdAssignment } from '../dist/shared/household-life.mjs';
import { HOUSEHOLDS, JOURNEYS } from '../dist/shared/household-sites.mjs';
import { MANY_HEARTHS, SETTLEMENTS } from '../dist/shared/gulf-region.mjs';
import { createGulfState } from '../dist/shared/gulf-life.mjs';
import { ridingObstacles } from '../dist/shared/riding.mjs';
import { VILLAGE } from '../dist/shared/village-sites.mjs';

const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const collision = new CollisionWorld();
function player(id = 'p') {
  const p = {
    id,
    species: 'cro',
    gender: 'female',
    x: 50,
    z: 57,
    radius: 0.32,
    path: [],
    inventory: { wood: 10, berry: 10, water: 6, seed: 0, rootSeed: 0, herbSeed: 0 },
    energy: 100,
  };
  ensureVillageProgress(p);
  return p;
}
function room(...players) {
  const r = {
    createdAt: 100000,
    players: new Map(players.map((p) => [p.id, p])),
    animals: [],
    enemies: [],
    collision,
    gulf: createGulfState(),
  };
  createResidents(r);
  return r;
}
function near(r, p, point, offset = 1.5) {
  const at = collision.nearestFree(
    { x: point.x, z: point.z + offset },
    p.radius,
    ridingObstacles(r, null, p),
    3,
  );
  assert.ok(at);
  Object.assign(p, at);
}
const act = (r, p, action = 'householdPrepare', id = HOUSEHOLDS[0].id, now = 100000) =>
  handleVillageAction(r, p, { action, targetId: id, visit: 9999, reward: 9999 }, now);
function prepare(r, p, d = HOUSEHOLDS[0], now = 100000) {
  near(
    r,
    p,
    SETTLEMENTS.find((s) => s.id === d.homeId),
    5,
  );
  assert.equal(act(r, p, 'householdPrepare', d.id, now).ok, true);
}
function guestFixture(r, d = HOUSEHOLDS[0], now = 100000) {
  const h = r.households.find((h) => h.id === d.id);
  Object.assign(h, {
    stage: 'visiting',
    visit: 1,
    leg: d.route.length - 1,
    stayUntil: now + JOURNEYS.stayMs,
  });
  for (const id of d.members) {
    const n = r.residents.find((n) => n.id === id);
    Object.assign(
      n,
      collision.nearestFree(
        d.guestRoutine[d.members.indexOf(id)][0],
        0.32,
        ridingObstacles(r, null, n),
        4,
      ),
    );
  }
  return h;
}

test('journeys are optional shared households, with no idle resource consumption or permanent five-player dependency', () => {
  const r = room(),
    before = structuredClone(r.gulf);
  assert.equal(HOUSEHOLDS.length, 3);
  assert.equal(new Set(HOUSEHOLDS.flatMap((d) => d.members)).size, 6);
  for (let i = 0; i < 100; i++) updateResidents(r, 0.1, 100000 + i * 10000);
  assert.ok(r.households.every((h) => h.stage === 'home' && h.visit === 0));
  assert.deepEqual(r.gulf, before);
});
test('preparation charges exactly once and rejects remote, occluded, busy, missing and invalid requests', () => {
  const p = player(),
    r = room(p),
    start = { ...p.inventory };
  assert.equal(act(r, p).ok, false);
  assert.equal(act(r, p, 'householdPrepare', '__proto__').ok, false);
  near(r, p, SETTLEMENTS[1], 5);
  const real = r.collision;
  r.collision = { segmentFree: () => false };
  assert.equal(act(r, p).ok, false);
  r.collision = real;
  for (const key of [
    'downedUntil',
    'boatId',
    'mountId',
    'fishing',
    'coastalActivity',
    'cookingEndsAt',
  ]) {
    p[key] = 1;
    assert.equal(act(r, p).ok, false);
    delete p[key];
  }
  p.inventory.water = 0;
  assert.equal(act(r, p).ok, false);
  p.inventory.water = start.water;
  assert.deepEqual(p.inventory, start);
  assert.equal(act(r, p).ok, true);
  for (const [key, n] of Object.entries(JOURNEYS.cost))
    assert.equal(p.inventory[key], start[key] - n);
  const after = { ...p.inventory };
  assert.equal(act(r, p).ok, false);
  assert.deepEqual(p.inventory, after);
  assert.equal(r.households[0].visit, 1);
});
test('all three households walk every leg, visit all daily routines, stay two days and return through real collision', () => {
  const r = room(),
    p = player(),
    seen = new Map(HOUSEHOLDS.map((d) => [d.id, new Set()])),
    phases = new Map(HOUSEHOLDS.flatMap((d) => d.members.map((id) => [id, new Set()]))),
    arrivals = new Map(),
    returns = new Map();
  for (const d of HOUSEHOLDS) prepare(r, p, d);
  const before = structuredClone(r.gulf);
  for (let i = 1; i <= 24500; i++) {
    const now = 100000 + i * 100;
    updateResidents(r, 0.1, now);
    for (const h of r.households) {
      seen.get(h.id).add(h.stage + ':' + h.leg);
      if (h.stage === 'visiting' && !arrivals.has(h.id)) arrivals.set(h.id, now);
      if (h.stage === 'returning') assert.ok(now - arrivals.get(h.id) >= JOURNEYS.stayMs);
      if (h.stage === 'home' && h.visit && !returns.has(h.id)) returns.set(h.id, now);
    }
    for (const n of r.residents) {
      if (i % 10 === 0)
        assert.ok(collision.free(n, n.radius, ridingObstacles(r, null, n)), `${n.id}/${i}`);
      const assignment = householdAssignment(r, n.id, n.phase);
      if (assignment && !assignment.travelling && n.activity === assignment.target.label)
        phases.get(n.id).add(n.phase);
    }
    if (returns.size === 3) break;
  }
  assert.equal(returns.size, 3);
  assert.deepEqual(r.gulf, before);
  for (const d of HOUSEHOLDS) {
    for (let leg = 1; leg < d.route.length; leg++) {
      assert.ok(seen.get(d.id).has('outbound:' + leg));
      assert.ok(seen.get(d.id).has('returning:' + leg));
    }
    for (const id of d.members) assert.deepEqual([...phases.get(id)].sort(), [0, 1, 2, 3], id);
    const h = r.households.find((h) => h.id === d.id);
    assert.equal(h.readyAt, returns.get(d.id) + JOURNEYS.restMs);
  }
});
test('a held conversation stops its traveller and the companion waits, then both resume without a day or season cancelling travel', () => {
  const p = player(),
    r = room(p),
    d = HOUSEHOLDS[0];
  prepare(r, p);
  r.players.clear();
  for (let i = 1; i <= 1000; i++) updateResidents(r, 0.1, 100000 + i * 100);
  const h = r.households[0];
  assert.equal(h.stage, 'outbound');
  const n = r.residents.find((n) => n.id === d.members[0]),
    other = r.residents.find((n) => n.id === d.members[1]);
  r.players.set(p.id, p);
  near(r, p, n);
  assert.equal(
    handleVillageAction(r, p, { action: 'residentTalk', targetId: n.id }, 200000).ok,
    true,
  );
  const before = { x: n.x, z: n.z };
  let waited = false;
  for (let i = 1; i < 200; i++) {
    updateResidents(r, 0.1, 200000 + i * 100);
    if (other.activity === '旅の仲間を待っている') waited = true;
  }
  assert.ok(waited);
  assert.equal(distance(n, before), 0);
  assert.ok(distance(n, other) <= JOURNEYS.separation + 0.2);
  r.players.clear();
  const key = h.stage;
  updateResidents(r, 0.1, 100000 + VILLAGE.dayMs * 40);
  assert.equal(h.stage, key);
  assert.ok(distance(n, before) <= 0.101);
  assert.ok(n.moving);
  for (let i = 1; i <= 150; i++) updateResidents(r, 0.1, 100000 + VILLAGE.dayMs * 40 + i * 100);
  assert.ok(distance(n, before) > 5);
});
test('temporary crowd leaves a destination pending and travel resumes when the obstruction clears', () => {
  const p = player(),
    r = room();
  prepare(r, p);
  for (let i = 1; i < 1000; i++) updateResidents(r, 0.1, 100000 + i * 100);
  const n = r.residents.find((n) => n.id === 'mira'),
    before = { x: n.x, z: n.z };
  for (let i = 0; i < 16; i++) {
    const angle = (i / 16) * Math.PI * 2;
    const b = player('block-' + i);
    Object.assign(b, {
      x: n.x + Math.cos(angle) * 1.25,
      z: n.z + Math.sin(angle) * 1.25,
      radius: 0.3,
    });
    r.players.set(b.id, b);
  }
  for (let i = 0; i < 100; i++) updateResidents(r, 0.1, 200000 + i * 100);
  assert.ok(distance(n, before) < 1);
  assert.equal(r.households[0].stage, 'outbound');
  r.players.clear();
  for (let i = 0; i < 150; i++) updateResidents(r, 0.1, 210000 + i * 100);
  assert.ok(distance(n, before) > 5);
});
test('welcome is personal once per actual visit, validates arrival and capacity, and preserves daily help', () => {
  const a = player('a'),
    b = player('b'),
    r = room(a, b),
    d = HOUSEHOLDS[0];
  assert.equal(act(r, a, 'householdWelcome').ok, false);
  const h = guestFixture(r);
  const n = r.residents.find((n) => n.id === 'mira');
  near(r, a, n);
  a.inventory.rootSeed = 99;
  assert.equal(act(r, a, 'householdWelcome').ok, false);
  assert.deepEqual(a.gulf.householdWelcomes, {});
  a.inventory.rootSeed = 0;
  a.gulf.residentHelp.mira = 1;
  assert.equal(act(r, a, 'householdWelcome').ok, true);
  assert.equal(a.gulf.residentHelp.mira, 1);
  assert.equal(a.inventory.seed, 1);
  assert.equal(a.inventory.rootSeed, 1);
  assert.equal(a.inventory.herbSeed, 1);
  assert.equal(act(r, a, 'householdWelcome').ok, false);
  near(r, b, n);
  b.species = 'bear';
  assert.equal(act(r, b, 'householdWelcome').ok, true);
  assert.equal(b.gulf.householdWelcomes[d.id], 1);
  assert.equal(act(r, b, 'householdWelcome', d.id, h.stayUntil).ok, false);
  h.visit++;
  assert.equal(act(r, b, 'householdWelcome').ok, true);
  assert.equal(b.inventory.seed, 2);
});
test('rest after returning is enforced and a later preparation advances the visit number', () => {
  const p = player(),
    r = room(p),
    h = r.households[0];
  Object.assign(h, { visit: 1, readyAt: 120000 });
  near(r, p, SETTLEMENTS[1], 5);
  assert.equal(act(r, p).ok, false);
  assert.equal(act(r, p, 'householdPrepare', h.id, 120000).ok, true);
  assert.equal(h.visit, 2);
});
class Socket extends EventEmitter {
  readyState = 1;
  bufferedAmount = 0;
  messages = [];
  send(m) {
    this.messages.push(JSON.parse(m));
  }
  ping() {
    this.emit('pong');
  }
  close() {
    this.readyState = 3;
    this.emit('close');
  }
  terminate() {
    this.close();
  }
  command(m) {
    this.emit('message', Buffer.from(JSON.stringify(m)), false);
  }
}
function fixture(now = 100000) {
  let id = 0;
  const core = createGameCore({
    playerLimit: 8,
    runtime: { now: () => now, id: () => `id-${++id}`, token: () => `token-${++id}` },
  });
  const join = (session) => {
    const s = new Socket();
    core.connect(
      s,
      new URLSearchParams({ room: 'HOUSEHOLDS', resume: '1', ...(session ? { session } : {}) }),
    );
    return s;
  };
  return { core, join, time: (n) => (now = n) };
}
test('eight players share one prepared departure, snapshots and save/reconnect preserve travellers and welcome claims', () => {
  const f = fixture();
  let restored;
  try {
    const sockets = Array.from({ length: 8 }, () => f.join()),
      r = f.core.rooms.get('HOUSEHOLDS');
    assert.equal(r.players.size, 8);
    const players = [...r.players.values()];
    for (const p of players) {
      near(r, p, SETTLEMENTS[1], 5);
      Object.assign(p.inventory, { wood: 8, berry: 8, water: 6 });
    }
    for (const s of sockets)
      s.command({ type: 'action', action: 'householdPrepare', targetId: HOUSEHOLDS[0].id });
    assert.equal(r.households[0].visit, 1);
    assert.equal(
      players.reduce((sum, p) => sum + p.inventory.wood, 0),
      8 * 8 - 2,
    );
    // Move players aside; physical NPC movement remains the normal simulation.
    for (const p of players) Object.assign(p, { x: 50, z: 60 });
    for (let i = 1; i <= 2200; i++) {
      f.time(100000 + i * 100);
      updateResidents(r, 0.1, 100000 + i * 100);
    }
    assert.equal(r.households[0].stage, 'outbound');
    const p = players[0];
    p.gulf.householdWelcomes[HOUSEHOLDS[1].id] = 2;
    const token = sockets[0].messages.find((m) => m.type === 'welcome').session,
      saved = f.core.exportState(),
      snapshot = f.core.snapshot(r);
    assert.deepEqual(snapshot.households, r.households);
    assert.deepEqual(
      Object.keys(snapshot.households[0]).sort(),
      ['id', 'stage', 'visit', 'leg', 'stayUntil', 'readyAt'].sort(),
    );
    restored = fixture(320000);
    restored.core.importState(saved);
    restored.join(token);
    const rr = restored.core.rooms.get('HOUSEHOLDS');
    assert.deepEqual(rr.households, r.households);
    assert.deepEqual(
      rr.residents.map((n) => ({ id: n.id, x: n.x, z: n.z })),
      r.residents.map((n) => ({ id: n.id, x: n.x, z: n.z })),
    );
    assert.deepEqual([...rr.players.values()][0].gulf.householdWelcomes, p.gulf.householdWelcomes);
    const copied = structuredClone(saved);
    updateResidents(rr, 0.1, 320100);
    assert.deepEqual(saved, copied);
    restored.core.close();
    delete saved.rooms[0].households;
    delete saved.rooms[0].residents;
    delete saved.rooms[0].sessions[0].player.gulf.householdWelcomes;
    restored = fixture(320000);
    restored.core.importState(saved);
    restored.join(token);
    assert.ok(restored.core.rooms.get('HOUSEHOLDS').households.every((h) => h.stage === 'home'));
    assert.deepEqual(
      [...restored.core.rooms.get('HOUSEHOLDS').players.values()][0].gulf.householdWelcomes,
      {},
    );
  } finally {
    f.core.close();
    restored?.core.close();
  }
});
test('visiting and returning save positions stay at the current destination, and invalid saves normalize safely', () => {
  for (const stage of ['visiting', 'returning']) {
    const r = room(),
      h = guestFixture(r);
    h.stage = stage;
    const saved = r.residents.map((n) => ({ id: n.id, x: n.x, z: n.z }));
    r.households = createHouseholds(r.households, 100000);
    createResidents(r, saved);
    for (const id of HOUSEHOLDS[0].members)
      assert.ok(
        distance(
          r.residents.find((n) => n.id === id),
          MANY_HEARTHS,
        ) < 65,
      );
  }
  const bad = createHouseholds([
    { id: HOUSEHOLDS[0].id, stage: 'outbound', visit: -1, leg: Infinity, readyAt: Infinity },
    { id: HOUSEHOLDS[1].id, stage: 'visiting', visit: 1, leg: 999, stayUntil: Infinity },
  ]);
  assert.equal(bad[0].stage, 'home');
  assert.equal(bad[0].leg, 0);
  assert.equal(bad[1].stayUntil, 0);
  const r = room();
  guestFixture(r);
  createResidents(r, [{ id: 'mira', x: 0, z: 0 }]);
  assert.ok(
    distance(
      r.residents.find((n) => n.id === 'mira'),
      MANY_HEARTHS,
    ) < 65,
  );
});
