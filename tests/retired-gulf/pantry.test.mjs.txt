import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createGameCore } from '../dist/application/game-core.mjs';
import {
  createGulfState,
  ensureGulfPlayer,
  handleGulfAction,
  updateGulf,
} from '../dist/shared/gulf-life.mjs';
import {
  PANTRY,
  PANTRY_FOODS,
  createPantries,
  pantryTotal,
  pantryRemaining,
} from '../dist/shared/pantry.mjs';
import { SETTLEMENTS, MANY_HEARTHS } from '../dist/shared/gulf-region.mjs';
import { VILLAGE } from '../dist/shared/village-sites.mjs';
import {
  createResidents,
  updateResidents,
  handleVillageAction,
} from '../dist/shared/village-life.mjs';
import { handleHuntingAction } from '../dist/shared/hunting.mjs';
import { CollisionWorld } from '../dist/shared/collision.mjs';
import { ridingObstacles } from '../dist/shared/riding.mjs';

const collision = new CollisionWorld();
function player(id = 'p') {
  const p = {
    id,
    name: id,
    species: 'cro',
    gender: 'female',
    radius: 0.32,
    x: MANY_HEARTHS.x,
    z: MANY_HEARTHS.z + 5,
    path: [],
    inventory: { wood: 0, stone: 0, berry: 0, rawMeat: 0, cookedMeat: 0 },
    energy: 10,
  };
  ensureGulfPlayer(p);
  return p;
}
function room(...players) {
  return {
    createdAt: 100000,
    players: new Map(players.map((p) => [p.id, p])),
    animals: [],
    enemies: [],
    residents: [],
    gulf: createGulfState(),
    collision,
  };
}
const at = (p, s = MANY_HEARTHS) => Object.assign(p, { x: s.x, z: s.z + 5 });
const stock = (r, s = MANY_HEARTHS) => r.gulf.pantries.find((p) => p.settlementId === s.id);
const act = (r, p, action = 'gulfPantryGive', food = 'berry', s = MANY_HEARTHS, now = 100000) =>
  handleGulfAction(
    r,
    p,
    { action, targetId: `${s.id}:${food}`, amount: 999, day: 999, inventory: 99 },
    now,
  );
const accounting = (r) =>
  Object.fromEntries(
    PANTRY_FOODS.map((f) => [
      f.id,
      r.gulf.pantries.reduce((n, p) => n + p.food[f.id], 0) +
        [...r.players.values()].reduce((n, p) => n + (p.inventory[f.id] ?? 0), 0),
    ]),
  );

test('four separate empty pantries preserve bounded food-only data and legacy worlds gain no free food', () => {
  const empty = createPantries();
  assert.equal(empty.length, 4);
  assert.ok(empty.every((p) => pantryTotal(p) === 0));
  const bad = createPantries([
    {
      settlementId: MANY_HEARTHS.id,
      food: {
        berry: 47.9,
        cookedMeat: 8,
        cookedFish: -9,
        cookedShellfish: NaN,
        rawMeat: 99,
        wood: 99,
      },
    },
    { settlementId: 'fake', food: { berry: 48 } },
  ]);
  assert.equal(bad[0].food.berry, 47);
  assert.equal(bad[0].food.cookedMeat, 1);
  assert.equal(pantryTotal(bad[0]), PANTRY.capacity);
  assert.equal(bad[0].food.rawMeat, undefined);
  assert.equal(bad[0].food.wood, undefined);
  const copied = createPantries(bad);
  copied[0].food.berry = 0;
  assert.equal(bad[0].food.berry, 47);
  const old = createGulfState({ stores: { wood: 4, berry: 6, obsidian: 2 }, festivals: 7 });
  assert.deepEqual(old.stores, { wood: 4, berry: 6, obsidian: 2 });
  assert.equal(old.festivals, 7);
  assert.ok(old.pantries.every((p) => pantryTotal(p) === 0));
});
test('all six foods move unchanged between players at all four hearths, independently of affiliation or species', () => {
  const a = player('a'),
    b = player('b'),
    r = room(a, b);
  let day = 0;
  for (const [i, s] of SETTLEMENTS.entries())
    for (const f of PANTRY_FOODS) {
      at(a, s);
      at(b, s);
      a.species = ['cro', 'nea', 'cat', 'bear'][i];
      b.species = ['bear', 'cat', 'nea', 'cro'][i];
      a.gulf.countryId = null;
      b.gulf.countryId = 'another-country';
      a.inventory[f.id] = 2;
      const before = accounting(r);
      const now = 100000 + day++ * VILLAGE.dayMs;
      assert.equal(act(r, a, 'gulfPantryGive', f.id, s, now).ok, true);
      assert.equal(stock(r, s).food[f.id], 1);
      assert.equal(a.inventory[f.id], 1);
      assert.deepEqual(accounting(r), before);
      assert.equal(act(r, b, 'gulfPantryTake', f.id, s, now).ok, true);
      assert.equal(stock(r, s).food[f.id], 0);
      assert.deepEqual(accounting(r), before);
    }
});
test('one daily allowance covers every pantry, resets only by server day and belongs to each player', () => {
  const a = player('a'),
    b = player('b'),
    r = room(a, b);
  for (const s of SETTLEMENTS) stock(r, s).food.berry = 8;
  for (const s of SETTLEMENTS.slice(0, 3)) {
    at(a, s);
    assert.equal(act(r, a, 'gulfPantryTake', 'berry', s).ok, true);
  }
  at(a, SETTLEMENTS[3]);
  const before = accounting(r);
  assert.equal(act(r, a, 'gulfPantryTake', 'berry', SETTLEMENTS[3]).ok, false);
  assert.deepEqual(accounting(r), before);
  assert.equal(pantryRemaining(a.gulf.pantryAllowance, 1), 0);
  at(b, SETTLEMENTS[3]);
  assert.equal(act(r, b, 'gulfPantryTake', 'berry', SETTLEMENTS[3]).ok, true);
  assert.equal(b.gulf.pantryAllowance.taken, 1);
  assert.equal(
    act(r, a, 'gulfPantryTake', 'berry', SETTLEMENTS[3], 100000 + VILLAGE.dayMs - 1).ok,
    false,
  );
  assert.equal(
    act(r, a, 'gulfPantryTake', 'berry', SETTLEMENTS[3], 100000 + VILLAGE.dayMs).ok,
    true,
  );
  assert.deepEqual(a.gulf.pantryAllowance, { day: 2, taken: 1 });
  // Returning food does not refund that day's allowance, and donations need no allowance.
  assert.equal(
    act(r, a, 'gulfPantryGive', 'berry', SETTLEMENTS[3], 100000 + VILLAGE.dayMs).ok,
    true,
  );
  assert.deepEqual(a.gulf.pantryAllowance, { day: 2, taken: 1 });
});
test('bad places/items, busy actors, occlusion, missing food, total capacity and inventory limits are atomic failures', () => {
  const p = player(),
    r = room(p);
  p.inventory.berry = 1;
  stock(r).food.berry = 1;
  const unchanged = (fn) => {
    const before = structuredClone({
      inventory: p.inventory,
      pantries: r.gulf.pantries,
      allowance: p.gulf.pantryAllowance,
    });
    assert.equal(fn().ok, false);
    assert.deepEqual(
      { inventory: p.inventory, pantries: r.gulf.pantries, allowance: p.gulf.pantryAllowance },
      before,
    );
  };
  for (const targetId of [
    undefined,
    '__proto__',
    'many-hearths:constructor',
    'many-hearths:rawMeat',
    'many-hearths:wood',
    'many-hearths:berry:2',
    'fake:berry',
    {},
    'many-hearths:berry\u0000',
  ])
    unchanged(() => handleGulfAction(r, p, { action: 'gulfPantryTake', targetId }));
  p.x += 15;
  unchanged(() => act(r, p));
  at(p);
  r.collision = { segmentFree: () => false };
  unchanged(() => act(r, p));
  r.collision = collision;
  for (const field of [
    'downedUntil',
    'mountId',
    'boatId',
    'cookingEndsAt',
    'fishing',
    'coastalActivity',
  ]) {
    p[field] = 1;
    unchanged(() => act(r, p));
    delete p[field];
  }
  p.attackSequence = 1;
  p.attackAt = 100000;
  unchanged(() => act(r, p));
  p.attackSequence = 0;
  p.inventory.berry = 0;
  unchanged(() => act(r, p));
  p.inventory.berry = 1;
  stock(r).food.cookedMeat = 47;
  unchanged(() => act(r, p));
  stock(r).food.cookedMeat = 0;
  p.inventory.berry = 99;
  unchanged(() => act(r, p, 'gulfPantryTake'));
  p.inventory.berry = 1;
  stock(r).food.berry = 0;
  unchanged(() => act(r, p, 'gulfPantryTake'));
});
test('time, crops, household routines and seasons never consume a shared pantry automatically', () => {
  const p = player(),
    r = room(p);
  createResidents(r);
  stock(r).food.cookedMeat = 20;
  stock(r).food.berry = 10;
  const before = structuredClone(r.gulf.pantries);
  for (let i = 0; i < 32; i++) {
    updateGulf(r, 100000 + i * 720000);
    updateResidents(r, 0.1, 100000 + i * 720000);
  }
  assert.deepEqual(r.gulf.pantries, before);
  assert.equal(p.inventory.cookedMeat, 0);
});
test('received food retains cooking effects, shells, daily help, household preparation and feast uses', () => {
  for (const f of PANTRY_FOODS.filter((f) => f.id !== 'berry')) {
    const p = player(),
      r = room(p);
    stock(r).food[f.id] = 1;
    assert.equal(act(r, p, 'gulfPantryTake', f.id).ok, true);
    const result = handleHuntingAction(r, p, { action: f.eatAction }, 101000);
    assert.equal(result.changed, true);
    assert.equal(p.inventory[f.id], 0);
    assert.equal(p.energy, 10 + f.energy);
    if (f.id === 'cookedShellfish') assert.equal(p.inventory.shells, 1);
  }
  const p = player(),
    r = room(p);
  createResidents(r);
  const n = r.residents.find((n) => n.id === 'neri');
  stock(r).food.cookedShellfish = 1;
  assert.equal(act(r, p, 'gulfPantryTake', 'cookedShellfish').ok, true);
  Object.assign(
    p,
    collision.nearestFree({ x: n.x, z: n.z + 1.4 }, p.radius, ridingObstacles(r, null, p), 2),
  );
  assert.equal(
    handleVillageAction(r, p, { action: 'residentHelp', targetId: n.id }, 100000).ok,
    true,
  );
  assert.equal(p.inventory.cookedShellfish, 0);
  assert.equal(p.inventory.seed, 2);
  at(p, SETTLEMENTS[1]);
  stock(r, SETTLEMENTS[1]).food.berry = 3;
  for (let i = 0; i < 3; i++)
    assert.equal(act(r, p, 'gulfPantryTake', 'berry', SETTLEMENTS[1], 340000).ok, true);
  p.inventory.wood = 2;
  p.inventory.water = 1;
  assert.equal(
    handleVillageAction(r, p, { action: 'householdPrepare', targetId: 'valley-hearth' }, 340000).ok,
    true,
  );
  assert.equal(p.inventory.berry, 0);
  at(p);
  stock(r).food.cookedFish = 1;
  assert.equal(act(r, p, 'gulfPantryTake', 'cookedFish', MANY_HEARTHS, 580000).ok, true);
  r.gulf.stores = { wood: 8, berry: 9, obsidian: 4 };
  assert.equal(handleGulfAction(r, p, { action: 'gulfOfferFish' }, 580500).ok, true);
  assert.equal(r.gulf.festivals, 1);
  assert.equal(stock(r).food.cookedFish, 0);
});
class Socket extends EventEmitter {
  readyState = 1;
  bufferedAmount = 0;
  messages = [];
  send(s) {
    this.messages.push(JSON.parse(s));
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
  command(value) {
    this.emit('message', Buffer.from(JSON.stringify(value)), false);
  }
}
function fixture() {
  let now = 100000,
    id = 0;
  const core = createGameCore({
    playerLimit: 8,
    runtime: { now: () => now, id: () => `id-${++id}`, token: () => `token-${++id}` },
  });
  const join = (session) => {
    const s = new Socket();
    core.connect(
      s,
      new URLSearchParams({ room: 'PANTRY', resume: '1', ...(session ? { session } : {}) }),
    );
    return s;
  };
  return { core, join, time: (n) => (now = n) };
}
test('eight clients serialize the final item and final slot, preserve total food, and all receive full pantry state', () => {
  const f = fixture();
  try {
    const sockets = Array.from({ length: 8 }, () => f.join()),
      r = f.core.rooms.get('PANTRY'),
      ps = [...r.players.values()];
    for (const p of ps) at(p);
    stock(r).food.berry = 1;
    const before = accounting(r);
    for (const s of sockets)
      s.command({
        type: 'action',
        action: 'gulfPantryTake',
        targetId: 'many-hearths:berry',
        amount: 99,
      });
    assert.equal(
      ps.reduce((n, p) => n + p.inventory.berry, 0),
      1,
    );
    assert.equal(stock(r).food.berry, 0);
    assert.deepEqual(accounting(r), before);
    assert.equal(
      ps.reduce((n, p) => n + p.gulf.pantryAllowance.taken, 0),
      1,
    );
    for (const s of sockets) {
      const state = s.messages.findLast((m) => m.type === 'state' && m.gulf);
      assert.equal(state.playerLimit, 8);
      assert.equal(state.gulf.pantries[0].food.berry, 0);
    }
    f.time(100500);
    stock(r).food.cookedMeat = 47;
    for (const p of ps) p.inventory.berry = 1;
    const total = accounting(r);
    for (const s of sockets)
      s.command({ type: 'action', action: 'gulfPantryGive', targetId: 'many-hearths:berry' });
    assert.equal(pantryTotal(stock(r)), 48);
    assert.equal(
      ps.reduce((n, p) => n + p.inventory.berry, 0),
      7,
    );
    assert.deepEqual(accounting(r), total);
  } finally {
    f.core.close();
  }
});
test('save/reconnect carries stock and daily use; legacy saves and malformed allowance normalize without mutating checkpoints', () => {
  const f = fixture();
  let restored;
  try {
    const socket = f.join(),
      r = f.core.rooms.get('PANTRY'),
      p = [...r.players.values()][0];
    at(p);
    stock(r).food.berry = 5;
    socket.command({ type: 'action', action: 'gulfPantryTake', targetId: 'many-hearths:berry' });
    const token = socket.messages.find((m) => m.type === 'welcome').session,
      saved = f.core.exportState(),
      copy = structuredClone(saved);
    socket.close();
    f.join(token);
    assert.equal(p.gulf.pantryAllowance.taken, 1);
    restored = fixture();
    restored.core.importState(saved);
    restored.join(token);
    const rr = restored.core.rooms.get('PANTRY'),
      rp = [...rr.players.values()][0];
    assert.deepEqual(rr.gulf.pantries, r.gulf.pantries);
    assert.deepEqual(rp.inventory, p.inventory);
    assert.deepEqual(rp.gulf.pantryAllowance, { day: 1, taken: 1 });
    at(rp);
    assert.equal(act(rr, rp, 'gulfPantryTake').ok, true);
    assert.deepEqual(saved, copy);
    assert.equal(rp.gulf.pantryAllowance.taken, 2);
    restored.core.close();
    delete saved.rooms[0].gulf.pantries;
    delete saved.rooms[0].sessions[0].player.gulf.pantryAllowance;
    restored = fixture();
    restored.core.importState(saved);
    restored.join(token);
    assert.ok(restored.core.rooms.get('PANTRY').gulf.pantries.every((p) => pantryTotal(p) === 0));
    assert.deepEqual(
      [...restored.core.rooms.get('PANTRY').players.values()][0].gulf.pantryAllowance,
      { day: 0, taken: 0 },
    );
    assert.deepEqual(
      [...restored.core.rooms.get('PANTRY').players.values()][0].inventory,
      p.inventory,
    );
    const malformed = player();
    malformed.gulf.pantryAllowance = { day: Infinity, taken: -3 };
    ensureGulfPlayer(malformed);
    assert.deepEqual(malformed.gulf.pantryAllowance, { day: 0, taken: 0 });
  } finally {
    f.core.close();
    restored?.core.close();
  }
});
