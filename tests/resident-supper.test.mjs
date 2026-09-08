import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createGameCore } from '../dist/application/game-core.mjs';
import { createGulfState, ensureGulfPlayer } from '../dist/shared/gulf-life.mjs';
import {
  createPantries,
  PANTRY_FOODS,
  pantryTotal,
  supperTotal,
  handlePantryAction,
} from '../dist/shared/pantry.mjs';
import {
  handleSupperAction,
  updateSuppers,
  normalizeResidentSupper,
  supperPlace,
  SUPPER,
} from '../dist/shared/supper.mjs';
import {
  createResidents,
  updateResidents,
  residentSnapshots,
  handleVillageAction,
} from '../dist/shared/village-life.mjs';
import { RESIDENTS, VILLAGE } from '../dist/shared/village-sites.mjs';
import { MANY_HEARTHS, SETTLEMENTS } from '../dist/shared/gulf-region.mjs';
import { householdAssignment } from '../dist/shared/household-life.mjs';
import { HOUSEHOLDS } from '../dist/shared/household-sites.mjs';
import { CollisionWorld } from '../dist/shared/collision.mjs';
import { ridingObstacles } from '../dist/shared/riding.mjs';
import { stopActor } from '../dist/shared/combat.mjs';
const collision = new CollisionWorld(),
  born = 100000,
  evening = born + 120000;
function player(id = 'p') {
  const p = {
    id,
    name: id,
    species: 'cro',
    gender: 'female',
    radius: 0.32,
    x: 50,
    z: 57,
    path: [],
    inventory: { wood: 0, stone: 0, berry: 0, cookedMeat: 0 },
    energy: 100,
  };
  ensureGulfPlayer(p);
  return p;
}
function fixture() {
  const p = player(),
    r = {
      createdAt: born,
      players: new Map([[p.id, p]]),
      animals: [],
      enemies: [],
      collision,
      gulf: createGulfState(),
    };
  createResidents(r, [], born);
  return { p, r };
}
const stock = (r, id = MANY_HEARTHS.id) => r.gulf.pantries.find((p) => p.settlementId === id);
function placePlayer(r, p, s = MANY_HEARTHS) {
  stopActor(p);
  Object.assign(
    p,
    r.collision.nearestFree({ x: s.x, z: s.z + 5 }, p.radius, ridingObstacles(r, null, p), 3),
  );
}
function seated(r, id = 'aru') {
  const n = r.residents.find((n) => n.id === id),
    d = RESIDENTS.find((d) => d.id === id),
    a = householdAssignment(r, id, 2),
    target = a?.target ?? d.routine[2];
  stopActor(n);
  const free = r.collision.nearestFree(target, n.radius, ridingObstacles(r, null, n), 4);
  assert.ok(free);
  Object.assign(n, free, {
    phase: 2,
    destination: { ...target, ...free },
    routineKey: a?.key ?? 'home:2',
    talkerId: null,
    talkUntil: 0,
  });
  return n;
}
const act = (r, p, action = 'gulfSupperGive', food = 'berry', id = MANY_HEARTHS.id, now = born) =>
  handleSupperAction(
    r,
    p,
    { action, targetId: `${id}:${food}`, amount: 99, day: 999, inventory: { berry: 99 } },
    now,
  );
const foodTotal = (r) =>
  r.gulf.pantries.reduce((n, p) => n + pantryTotal(p), 0) +
  [...r.players.values()].reduce(
    (n, p) => n + PANTRY_FOODS.reduce((a, f) => a + (p.inventory[f.id] ?? 0), 0),
    0,
  );

test('legacy pantry food is preserved before supper capacity, and malformed meal records grant no food or future meals', () => {
  const old = {
    settlementId: MANY_HEARTHS.id,
    food: { berry: 47.9, cookedMeat: 3 },
    supper: { berry: 90 },
    supperShells: 1000,
  };
  const normalized = createPantries([old]);
  assert.equal(normalized[0].food.berry, 47);
  assert.equal(normalized[0].food.cookedMeat, 1);
  assert.equal(supperTotal(normalized[0]), 0);
  assert.equal(normalized[0].supperShells, 99);
  const empty = createPantries([{ settlementId: MANY_HEARTHS.id, food: { berry: 4 } }]);
  assert.equal(empty[0].food.berry, 4);
  assert.equal(supperTotal(empty[0]), 0);
  assert.equal(empty[0].supperShells, 0);
  for (const value of [
    null,
    { day: 2, settlementId: MANY_HEARTHS.id, foodId: 'berry' },
    { day: 1, settlementId: 'fake', foodId: 'berry' },
    { day: 1.5, settlementId: MANY_HEARTHS.id, foodId: 'berry' },
    { day: 1, settlementId: MANY_HEARTHS.id, foodId: 'rawMeat' },
  ])
    assert.equal(normalizeResidentSupper(value, 1), null);
  const source = { day: 1, settlementId: MANY_HEARTHS.id, foodId: 'berry' },
    copy = normalizeResidentSupper(source, 1);
  copy.day = 0;
  assert.equal(source.day, 1);
});
test('six foods can be earmarked and released at all four hearths; returns do not bypass the player daily allowance', () => {
  const { p, r } = fixture();
  let day = 0;
  for (const [i, s] of SETTLEMENTS.entries())
    for (const f of PANTRY_FOODS) {
      p.species = ['cro', 'nea', 'cat', 'bear'][i];
      placePlayer(r, p, s);
      p.inventory[f.id] = 2;
      const before = foodTotal(r),
        now = born + day++ * VILLAGE.dayMs;
      assert.equal(act(r, p, 'gulfSupperGive', f.id, s.id, now).ok, true);
      assert.equal(stock(r, s.id).supper[f.id], 1);
      assert.equal(p.inventory[f.id], 1);
      assert.equal(act(r, p, 'gulfSupperRelease', f.id, s.id, now).ok, true);
      assert.equal(stock(r, s.id).food[f.id], 1);
      assert.equal(p.inventory[f.id], 1);
      assert.equal(foodTotal(r), before);
      assert.equal(
        handlePantryAction(r, p, { action: 'gulfPantryTake', targetId: `${s.id}:${f.id}` }, now).ok,
        true,
      );
      assert.equal(p.gulf.pantryAllowance.taken, 1);
    }
  p.gulf.pantryAllowance = { day: day, taken: 3 };
  const s = SETTLEMENTS.at(-1);
  stock(r, s.id).supper.berry = 1;
  assert.equal(
    act(r, p, 'gulfSupperRelease', 'berry', s.id, born + (day - 1) * VILLAGE.dayMs).ok,
    true,
  );
  assert.equal(
    handlePantryAction(
      r,
      p,
      { action: 'gulfPantryTake', targetId: `${s.id}:berry` },
      born + (day - 1) * VILLAGE.dayMs,
    ).ok,
    false,
  );
});
test('invalid, distant, obstructed, busy and full storage actions leave all possessions and portions unchanged', () => {
  const { p, r } = fixture();
  p.inventory.berry = 3;
  assert.equal(act(r, p).ok, false);
  placePlayer(r, p);
  assert.equal(act(r, p, 'gulfSupperGive', '__proto__').ok, false);
  assert.equal(act(r, p, 'gulfSupperGive', 'rawFish').ok, false);
  assert.equal(act(r, p, 'gulfSupperGive', 'berry', 'fake').ok, false);
  for (const key of [
    'downedUntil',
    'mountId',
    'boatId',
    'cookingEndsAt',
    'fishing',
    'coastalActivity',
  ]) {
    p[key] = 1;
    assert.equal(act(r, p).ok, false);
    p[key] = null;
  }
  r.collision = { segmentFree: () => false };
  assert.equal(act(r, p).ok, false);
  r.collision = collision;
  stock(r).food.berry = 47;
  stock(r).supper.cookedMeat = 1;
  const before = JSON.stringify([p.inventory, r.gulf]);
  assert.equal(act(r, p).ok, false);
  assert.equal(act(r, p, 'gulfSupperRelease', 'berry').ok, false);
  assert.equal(act(r, p, 'gulfSupperShells', 'shells').ok, false);
  assert.equal(JSON.stringify([p.inventory, r.gulf]), before);
});
test('all eight residents walk their ordinary evening routes and consume one reserved meal each, preserving common food', () => {
  const { r } = fixture();
  for (const s of r.gulf.pantries) {
    s.food.berry = 6;
    s.supper.cookedRoot = 4;
  }
  const before = foodTotal(r);
  for (let step = 0; step < 590; step++) {
    const now = evening + step * 100;
    updateResidents(r, 0.1, now);
    updateSuppers(r, now);
  }
  assert.equal(r.residents.filter((n) => n.supper?.day === 1).length, 8);
  assert.equal(foodTotal(r), before - 8);
  assert.ok(r.gulf.pantries.every((p) => p.food.berry === 6 && p.supper.cookedRoot === 2));
  assert.ok(r.residents.every((n) => collision.free(n, n.radius, ridingObstacles(r, null, n))));
});
test('meal timing does not eat common stock, duplicate a day, backfill missed days, or consume in an empty room', () => {
  const { r } = fixture(),
    n = seated(r);
  r.residents = [n];
  stock(r).food.berry = 20;
  assert.equal(updateSuppers(r, evening), false);
  stock(r).supper.berry = 8;
  assert.equal(updateSuppers(r, evening - 1), false);
  assert.equal(updateSuppers(r, born + 180000), false);
  assert.equal(updateSuppers(r, evening), true);
  assert.equal(updateSuppers(r, evening + 500), false);
  r.players.clear();
  assert.equal(updateSuppers(r, evening + 10 * VILLAGE.dayMs), false);
  assert.equal(stock(r).supper.berry, 7);
  const p = player();
  r.players.set(p.id, p);
  assert.equal(updateSuppers(r, evening + 10 * VILLAGE.dayMs), true);
  assert.equal(stock(r).supper.berry, 6);
  assert.equal(n.supper.day, 11);
  assert.equal(stock(r).food.berry, 20);
});
test('meal waits for arrival, conversation and a clear hearth; eight-second rest yields to conversation, night and departure', () => {
  const { p, r } = fixture(),
    n = seated(r);
  r.residents = [n];
  stock(r).supper.berry = 5;
  for (const mutate of [
    () => {
      n.moving = true;
    },
    () => {
      n.x += 4;
    },
    () => {
      n.phase = 1;
    },
    () => {
      n.talkerId = p.id;
      n.talkUntil = evening + 20000;
    },
    () => {
      r.collision = { segmentFree: () => false };
    },
  ]) {
    const original = { x: n.x, z: n.z, phase: n.phase };
    mutate();
    assert.equal(updateSuppers(r, evening), false);
    Object.assign(n, original, { moving: false, talkerId: null, talkUntil: 0 });
    r.collision = collision;
  }
  assert.equal(updateSuppers(r, evening), true);
  updateResidents(r, 0.1, evening + 100);
  assert.ok(n.activity.includes('ベリー'));
  assert.equal(n.clip, 'Idle_Loop');
  Object.assign(
    p,
    collision.nearestFree({ x: n.x, z: n.z + 1.3 }, p.radius, ridingObstacles(r, null, p), 3),
  );
  assert.equal(
    handleVillageAction(r, p, { action: 'residentTalk', targetId: n.id }, evening + 200).ok,
    true,
  );
  updateResidents(r, 0.1, evening + 300);
  assert.equal(n.activity, '旅人と話している');
  n.talkerId = null;
  n.talkUntil = 0;
  updateResidents(r, 0.1, born + 180000);
  assert.equal(n.phase, 3);
  assert.ok(!n.activity.includes('ベリー'));
});
test('visiting households eat at the gathering place and never twice across relocation; travellers do not eat', () => {
  const { r } = fixture();
  for (const [i, h] of r.households.entries())
    Object.assign(h, {
      stage: 'visiting',
      visit: 1,
      leg: HOUSEHOLDS[i].route.length - 1,
      stayUntil: evening + VILLAGE.dayMs,
    });
  for (const n of r.residents) seated(r, n.id);
  stock(r).supper.cookedFish = 12;
  assert.equal(updateSuppers(r, evening), true);
  assert.equal(
    r.residents.filter((n) => n.supper?.settlementId === MANY_HEARTHS.id).length,
    8,
    JSON.stringify(
      r.residents.map((n) => ({ id: n.id, meal: n.supper, x: n.x, z: n.z, phase: n.phase })),
    ),
  );
  assert.equal(stock(r).supper.cookedFish, 4);
  for (const h of r.households) h.stage = 'home';
  for (const n of r.residents) seated(r, n.id);
  for (const p of r.gulf.pantries) p.supper.cookedFish = 4;
  assert.equal(updateSuppers(r, evening + 1000), false);
  const n = r.residents.find((n) => n.id === 'mira'),
    h = r.households[0];
  n.supper = null;
  h.stage = 'outbound';
  assert.equal(supperPlace(r, 'mira'), null);
  assert.equal(updateSuppers(r, evening + 2000), false);
  h.stage = 'visiting';
  h.stayUntil = evening + 200000;
  seated(r, 'mira');
  assert.equal(updateSuppers(r, evening + 3000), true);
  h.stage = 'returning';
  updateResidents(r, 0.1, evening + 3100);
  assert.ok(!n.activity.includes('焼き魚'));
});
test('a scarce meal rotates between the two home residents across days', () => {
  const { r } = fixture();
  r.residents = r.residents.filter((n) => ['aru', 'seno'].includes(n.id));
  const served = [];
  for (let day = 1; day <= 8; day++) {
    for (const n of r.residents) seated(r, n.id);
    stock(r).supper.berry = 1;
    updateSuppers(r, evening + (day - 1) * VILLAGE.dayMs);
    served.push(r.residents.find((n) => n.supper?.day === day).id);
  }
  assert.deepEqual(served, ['aru', 'seno', 'aru', 'seno', 'aru', 'seno', 'aru', 'seno']);
});
test('shellfish leaves exactly one recoverable shell; full shell stock keeps shellfish and chooses other food', () => {
  const { p, r } = fixture(),
    n = seated(r);
  r.residents = [n];
  placePlayer(r, p);
  stock(r).supper.cookedShellfish = 2;
  stock(r).supperShells = 99;
  assert.equal(updateSuppers(r, evening), false);
  stock(r).supper.berry = 1;
  assert.equal(updateSuppers(r, evening), true);
  assert.equal(n.supper.foodId, 'berry');
  assert.equal(stock(r).supper.cookedShellfish, 2);
  p.inventory.shells = 99;
  assert.equal(act(r, p, 'gulfSupperShells', 'shells').ok, false);
  p.inventory.shells = 0;
  assert.equal(act(r, p, 'gulfSupperShells', 'shells').ok, true);
  assert.equal(p.inventory.shells, 1);
  assert.equal(stock(r).supperShells, 98);
  assert.equal(updateSuppers(r, evening + VILLAGE.dayMs), true);
  assert.equal(n.supper.foodId, 'cookedShellfish');
  assert.equal(stock(r).supperShells, 99);
  assert.equal(stock(r).supper.cookedShellfish, 1);
});

class Socket extends EventEmitter {
  readyState = 1;
  bufferedAmount = 0;
  messages = [];
  send(data) {
    this.messages.push(JSON.parse(data));
  }
  command(data) {
    this.emit('message', Buffer.from(JSON.stringify(data)), false);
  }
  close() {
    this.readyState = 3;
    this.emit('close');
  }
  terminate() {
    this.close();
  }
  ping() {
    this.emit('pong');
  }
}
function coreFixture(count = 8) {
  let now = born,
    id = 0;
  const core = createGameCore({
      playerLimit: count,
      runtime: { now: () => now, id: () => `id-${++id}`, token: () => `token-${++id}` },
    }),
    sockets = [];
  for (let i = 0; i < count; i++) {
    const s = new Socket();
    core.connect(s, new URLSearchParams({ room: 'SUPPER', name: `P${i}`, resume: '1' }));
    sockets.push(s);
  }
  const r = core.rooms.get('SUPPER'),
    players = [...r.players.values()];
  return {
    core,
    r,
    players,
    sockets,
    setNow: (n) => {
      now = n;
    },
    now: () => now,
  };
}
test('eight-player wire races preserve the last space, portion and shell; meal changes broadcast inside the usual interval', () => {
  const f = coreFixture();
  try {
    for (const [i, p] of f.players.entries()) {
      Object.assign(p, { x: MANY_HEARTHS.x - 6 + i * 1.4, z: MANY_HEARTHS.z + 5 });
      p.inventory.berry = 1;
    }
    stock(f.r).food.cookedMeat = 47;
    for (const s of f.sockets)
      s.command({
        type: 'action',
        action: 'gulfSupperGive',
        targetId: 'many-hearths:berry',
        quantity: 99,
      });
    assert.equal(stock(f.r).supper.berry, 1);
    assert.equal(
      f.players.reduce((n, p) => n + p.inventory.berry, 0),
      7,
    );
    f.setNow(born + 500);
    for (const s of f.sockets)
      s.command({ type: 'action', action: 'gulfSupperRelease', targetId: 'many-hearths:berry' });
    assert.equal(stock(f.r).supper.berry, 0);
    assert.equal(stock(f.r).food.berry, 1);
    stock(f.r).supperShells = 1;
    f.setNow(born + 1000);
    for (const s of f.sockets)
      s.command({ type: 'action', action: 'gulfSupperShells', targetId: 'many-hearths:shells' });
    assert.equal(stock(f.r).supperShells, 0);
    assert.equal(
      f.players.reduce((n, p) => n + p.inventory.shells, 0),
      1,
    );
    stock(f.r).food.berry = 0;
    stock(f.r).supper.berry = 1;
    f.setNow(evening);
    const n = seated(f.r);
    f.r.lastBroadcast = evening - 20;
    f.core.tick();
    assert.equal(n.supper.day, 1);
    assert.equal(stock(f.r).supper.berry, 0);
    for (const s of f.sockets) {
      const state = s.messages.findLast((m) => m.type === 'state');
      assert.equal(state.playerLimit, 8);
      assert.equal(state.gulf.pantries[0].supper.berry, 0);
      assert.equal(state.residents.find((r) => r.id === 'aru').supper.day, 1);
    }
    f.setNow(evening + 500);
    for (const s of f.sockets)
      s.command({ type: 'action', action: 'gulfSupperRelease', targetId: 'many-hearths:berry' });
    assert.equal(stock(f.r).food.berry, 0);
  } finally {
    f.core.close();
  }
});
test('completed meals, portions and shells survive export, reconnect and restore without replaying a meal or persisting its animation', () => {
  const f = coreFixture(2);
  try {
    f.setNow(evening);
    const n = seated(f.r);
    stock(f.r).supper.cookedShellfish = 2;
    assert.equal(updateSuppers(f.r, evening), true);
    const snap = residentSnapshots(f.r);
    snap[0].supper.day = 99;
    assert.equal(n.supper.day, 1);
    assert.ok(!('supperUntil' in snap[0]));
    const saved = f.core.exportState(),
      old = structuredClone(saved),
      token = f.players[0].sessionToken;
    f.sockets[0].close();
    const reconnect = new Socket();
    f.core.connect(reconnect, new URLSearchParams({ room: 'SUPPER', resume: '1', session: token }));
    assert.equal(n.supper.day, 1);
    const restored = createGameCore({
      runtime: {
        now: () => evening + 1000,
        id: () => crypto.randomUUID(),
        token: () => crypto.randomUUID(),
      },
    });
    try {
      restored.importState(saved);
      const r = restored.rooms.get('SUPPER');
      assert.equal(r.residents[0].supper.day, 1);
      assert.equal(r.residents[0].supperUntil, 0);
      assert.equal(stock(r).supper.cookedShellfish, 1);
      assert.equal(stock(r).supperShells, 1);
      const p = new Socket();
      restored.connect(p, new URLSearchParams({ room: 'SUPPER', resume: '1', session: token }));
      seated(r);
      updateSuppers(r, evening + 1100);
      assert.equal(stock(r).supper.cookedShellfish, 1);
    } finally {
      restored.close();
    }
    for (const p of old.rooms[0].gulf.pantries) {
      delete p.supper;
      delete p.supperShells;
    }
    for (const r of old.rooms[0].residents) delete r.supper;
    const legacy = createGameCore({
      runtime: {
        now: () => evening,
        id: () => crypto.randomUUID(),
        token: () => crypto.randomUUID(),
      },
    });
    try {
      legacy.importState(old);
      const r = legacy.rooms.get('SUPPER');
      assert.ok(r.residents.every((n) => n.supper === null));
      assert.ok(r.gulf.pantries.every((p) => supperTotal(p) === 0 && p.supperShells === 0));
      assert.deepEqual(r.gulf.plots, old.rooms[0].gulf.plots);
      assert.deepEqual(r.households, old.rooms[0].households);
    } finally {
      legacy.close();
    }
  } finally {
    f.core.close();
  }
});
