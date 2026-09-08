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
import { RESIDENTS, VILLAGE, villageDay, villagePhase } from '../dist/shared/village-sites.mjs';
import { SETTLEMENTS } from '../dist/shared/gulf-region.mjs';
import { residentInteraction } from '../dist/src/village-ui.js';
import { ridingObstacles } from '../dist/shared/riding.mjs';
import { startAttack, resolveAttack } from '../dist/shared/combat.mjs';

const collision = new CollisionWorld();
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
function player(id = 'p') {
  const p = {
    id,
    species: 'cro',
    gender: 'female',
    x: 50,
    z: 57,
    radius: 0.32,
    path: [],
    inventory: {
      wood: 9,
      berry: 9,
      stone: 9,
      water: 6,
      seed: 6,
      obsidian: 4,
      cookedShellfish: 4,
      shells: 0,
      rawMeat: 0,
      cookedMeat: 0,
    },
    energy: 100,
  };
  ensureVillageProgress(p);
  return p;
}
function room(...ps) {
  const r = {
    players: new Map(ps.map((p) => [p.id, p])),
    animals: [],
    enemies: [],
    createdAt: 100000,
    collision,
  };
  createResidents(r);
  return r;
}
function approach(r, p, id = 'aru') {
  const n = r.residents.find((n) => n.id === id);
  const at = collision.nearestFree(
    { x: n.x, z: n.z + 1.4 },
    p.radius,
    ridingObstacles(r, null, p),
    2,
  );
  assert.ok(at);
  Object.assign(p, at);
  return n;
}
const act = (r, p, action = 'residentHelp', id = 'aru', now = 110000) =>
  handleVillageAction(r, p, { action, targetId: id, day: 99999, reward: 99999 }, now);

test('eight residents span four camps and both human populations without fixed economic classes', () => {
  assert.equal(RESIDENTS.length, 8);
  for (const s of SETTLEMENTS) {
    const group = RESIDENTS.filter((d) => d.settlementId === s.id);
    assert.equal(group.length, 2);
    assert.deepEqual(new Set(group.map((d) => d.species)), new Set(['cro', 'nea']));
    assert.ok(group.every((d) => d.routine.some((p) => p.clip === 'Gather')));
    assert.ok(group.every((d) => d.routine.every((p) => distance(p, s) < 50)));
  }
  assert.equal(villageDay(99999, 100000), 1);
  assert.equal(villagePhase(99999, 100000), 0);
  assert.equal(villageDay(340000, 100000), 2);
});

test('two full days of routines reach all workplaces without static or resident overlap', () => {
  const r = room(),
    seen = new Map(RESIDENTS.map((d) => [d.id, new Set()]));
  for (let i = 0; i < 4800; i++) {
    const now = r.createdAt + i * 100;
    updateResidents(r, 0.1, now);
    for (const n of r.residents) {
      assert.ok(collision.free(n, n.radius, ridingObstacles(r, null, n)), `${n.id} at ${i}`);
      if (n.activity === RESIDENTS.find((d) => d.id === n.id).routine[n.phase].label)
        seen.get(n.id).add(n.phase);
    }
  }
  for (const [id, phases] of seen) assert.equal(phases.size, 4, `${id}: ${[...phases]}`);
});

test('conversation holds a nearby resident then releases on departure or disconnect', () => {
  const p = player(),
    r = room(p),
    n = approach(r, p);
  assert.equal(act(r, p, 'residentTalk').ok, true);
  const before = { x: n.x, z: n.z };
  updateResidents(r, 0.1, 110100);
  assert.deepEqual({ x: n.x, z: n.z }, before);
  assert.equal(n.activity, '旅人と話している');
  assert.deepEqual(p.gulf.metResidents, ['aru']);
  r.players.clear();
  updateResidents(r, 0.1, 160100);
  assert.equal(n.talkerId, null);
  assert.ok(n.moving);
});

test('every request consumes its stated bundle and gives exactly its stated reward', () => {
  const p = player(),
    r = room(p);
  for (const d of RESIDENTS) {
    approach(r, p, d.id);
    const before = { ...p.inventory };
    assert.equal(act(r, p, 'residentHelp', d.id).ok, true, d.id);
    for (const key of Object.keys(before))
      assert.equal(
        p.inventory[key],
        before[key] - (d.cost[key] ?? 0) + (d.reward[key] ?? 0),
        `${d.id}/${key}`,
      );
    assert.equal(p.gulf.residentHelp[d.id], 1);
    const after = { ...p.inventory };
    assert.equal(act(r, p, 'residentHelp', d.id).ok, false);
    assert.deepEqual(p.inventory, after);
  }
});

test('missing supplies, full rewards, remote/occluded and invalid targets never spend materials', () => {
  const p = player(),
    r = room(p);
  assert.equal(act(r, p).ok, false);
  assert.equal(act(r, p, 'residentHelp', '__proto__').ok, false);
  approach(r, p);
  p.inventory.berry = 1;
  assert.equal(act(r, p).ok, false);
  p.inventory.berry = 3;
  p.inventory.wood = 99;
  assert.equal(act(r, p).ok, false);
  assert.equal(p.inventory.berry, 3);
  p.inventory.wood = 0;
  const clear = r.collision;
  r.collision = { interactionVisible: () => false, segmentFree: () => false };
  assert.equal(act(r, p).ok, false);
  r.collision = clear;
  assert.equal(p.inventory.berry, 3);
});

test('day boundary is authoritative and each player has an independent daily allowance', () => {
  const a = player('a'),
    b = player('b'),
    r = room(a, b);
  approach(r, a);
  approach(r, b);
  assert.equal(act(r, a, 'residentHelp', 'aru', 339999).ok, true);
  assert.equal(act(r, b, 'residentHelp', 'aru', 339999).ok, true);
  assert.equal(act(r, a, 'residentHelp', 'aru', 339999).ok, false);
  assert.equal(act(r, a, 'residentHelp', 'aru', 340000).ok, true);
  assert.equal(a.gulf.residentHelp.aru, 2);
});

test('busy states refuse both talk and delivery; residents are not attack targets', () => {
  const p = player(),
    r = room(p),
    n = approach(r, p);
  for (const key of [
    'mountId',
    'boatId',
    'downedUntil',
    'cookingEndsAt',
    'fishing',
    'coastalActivity',
  ]) {
    p[key] = true;
    assert.equal(act(r, p).ok, false, key);
    assert.equal(residentInteraction({ residents: r.residents }, p, collision), null);
    p[key] = null;
  }
  p.facing = Math.atan2(n.x - p.x, n.z - p.z);
  assert.ok(startAttack(r, p, { targetId: n.id }, 150000).accepted);
  resolveAttack(r, p, 151000);
  assert.equal(n.health, undefined);
  assert.equal(r.residents.length, 8);
});

class Socket extends EventEmitter {
  readyState = 1;
  bufferedAmount = 0;
  messages = [];
  send(message) {
    this.messages.push(JSON.parse(message));
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
  command(message) {
    this.emit('message', Buffer.from(JSON.stringify(message)), false);
  }
}
function coreFixture(limit = 5) {
  let now = 100000,
    id = 0;
  const core = createGameCore({
    playerLimit: limit,
    runtime: { now: () => now, id: () => `id-${++id}`, token: () => `token-${++id}` },
  });
  const join = (session) => {
    const s = new Socket();
    core.connect(
      s,
      new URLSearchParams({
        room: 'VILLAGE',
        name: '旅人',
        resume: '1',
        ...(session ? { session } : {}),
      }),
    );
    return s;
  };
  return {
    core,
    join,
    time: (n) => {
      now = n;
    },
  };
}

test('eight active players coexist with residents; wire state excludes navigation and conversation internals', () => {
  const { core, join } = coreFixture(8);
  try {
    const sockets = Array.from({ length: 8 }, () => join());
    const r = core.rooms.get('VILLAGE');
    assert.equal(r.players.size, 8);
    assert.equal(r.residents.length, 8);
    const snap = core.snapshot(r, true);
    assert.equal(snap.playerLimit, 8);
    assert.equal(snap.residents.length, 8);
    assert.ok(sockets.every((s) => s.messages.some((m) => m.type === 'welcome')));
    assert.deepEqual(
      Object.keys(snap.residents[0]).sort(),
      ['id', 'x', 'z', 'facing', 'radius', 'speed', 'moving', 'activity', 'clip'].sort(),
    );
    assert.ok(snap.residents.every((n) => !snap.players.some((p) => p.id === n.id)));
  } finally {
    core.close();
  }
});

test('save, reconnect and legacy records preserve progress without restoring an old conversation', () => {
  const f = coreFixture();
  let restored;
  try {
    const socket = f.join(),
      r = f.core.rooms.get('VILLAGE'),
      p = [...r.players.values()][0];
    p.inventory.berry = 3;
    approach(r, p);
    socket.command({ type: 'action', action: 'residentHelp', targetId: 'aru' });
    const saved = f.core.exportState();
    const token = socket.messages.find((m) => m.type === 'welcome').session;
    assert.ok(token);
    restored = coreFixture();
    restored.core.importState(saved);
    const joined = restored.join(token),
      current = restored.core.rooms.get('VILLAGE');
    assert.equal(joined.messages.find((m) => m.type === 'welcome').resumed, true);
    const resumed = [...current.players.values()][0];
    assert.deepEqual(resumed.inventory, p.inventory);
    assert.equal(resumed.gulf.residentHelp.aru, 1);
    assert.equal(current.residents[0].talkerId, null);
    approach(current, resumed);
    assert.equal(act(current, resumed).ok, false);
    assert.deepEqual(saved.rooms[0].residents, f.core.exportState().rooms[0].residents);
    restored.core.close();
    delete saved.rooms[0].residents;
    delete saved.rooms[0].sessions[0].player.gulf.residentHelp;
    delete saved.rooms[0].sessions[0].player.gulf.metResidents;
    restored = coreFixture();
    restored.core.importState(saved);
    restored.join(token);
    const old = restored.core.rooms.get('VILLAGE');
    assert.equal(old.residents.length, 8);
    assert.deepEqual([...old.players.values()][0].gulf.residentHelp, {});
  } finally {
    f.core.close();
    restored?.core.close();
  }
});

test('player movement respects a resident body, while live proximity UI selects that person', () => {
  const f = coreFixture();
  try {
    const socket = f.join(),
      r = f.core.rooms.get('VILLAGE'),
      p = [...r.players.values()][0];
    const n = approach(r, p);
    assert.equal(residentInteraction(f.core.snapshot(r), p, r.collision).targetId, n.id);
    act(r, p, 'residentTalk');
    for (let i = 1; i <= 80; i++) {
      f.time(110000 + i * 50);
      socket.command({ type: 'move', dx: n.x - p.x, dz: n.z - p.z, running: true });
      f.core.tick();
      assert.ok(distance(p, n) >= p.radius + n.radius - 1e-6);
    }
  } finally {
    f.core.close();
  }
});
