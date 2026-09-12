import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createGameCore } from '../dist/application/game-core.mjs';
import { createGulfState, ensureGulfPlayer } from '../dist/shared/gulf-life.mjs';
import {
  createResidents,
  updateResidents,
  residentSnapshots,
} from '../dist/shared/village-life.mjs';
import {
  foragingAssignment,
  updateForaging,
  normalizeResidentForage,
  FORAGING,
} from '../dist/shared/foraging.mjs';
import { updateSuppers, supperPlace } from '../dist/shared/supper.mjs';
import { pantryTotal, supperTotal } from '../dist/shared/pantry.mjs';
import { GULF_RESOURCES, MANY_HEARTHS, SETTLEMENTS } from '../dist/shared/gulf-region.mjs';
import { RESIDENTS, VILLAGE } from '../dist/shared/village-sites.mjs';
import { householdAssignment } from '../dist/shared/household-life.mjs';
import { HOUSEHOLDS } from '../dist/shared/household-sites.mjs';
import { CollisionWorld } from '../dist/shared/collision.mjs';
import { ridingObstacles } from '../dist/shared/riding.mjs';
import { stopActor } from '../dist/shared/combat.mjs';
const born = 100000,
  evening = born + 120000,
  collision = new CollisionWorld();
const stock = (r, id = MANY_HEARTHS.id) => r.gulf.pantries.find((p) => p.settlementId === id);
const berryTotal = (r) =>
  r.resources.filter((s) => s.type === 'berry').reduce((n, s) => n + s.amount, 0);
function fixture() {
  const p = { id: 'p', x: 50, z: 57, radius: 0.32, inventory: { berry: 0 }, path: [], energy: 100 };
  ensureGulfPlayer(p);
  const r = {
    createdAt: born,
    players: new Map([[p.id, p]]),
    animals: [],
    enemies: [],
    collision,
    resources: GULF_RESOURCES.map((s) => ({ ...s, regeneratedAt: born })),
    gulf: createGulfState(),
  };
  createResidents(r, [], born);
  return { r, p };
}
function atShrub(r, id = 'aru', now = born) {
  const n = r.residents.find((n) => n.id === id);
  const a = foragingAssignment(r, n, 0, now, ridingObstacles(r, null, n));
  assert.ok(a, 'reachable stocked shrub');
  stopActor(n);
  Object.assign(n, a.target, {
    phase: 0,
    destination: a.target,
    routineKey: a.key,
    forageWork: null,
    talkerId: null,
    talkUntil: 0,
  });
  return n;
}
function seated(r, id = 'aru') {
  const n = r.residents.find((n) => n.id === id),
    d = RESIDENTS.find((d) => d.id === id);
  const a = householdAssignment(r, id, 2),
    target = a?.target ?? d.routine[2];
  stopActor(n);
  const free = r.collision.nearestFree(target, n.radius, ridingObstacles(r, null, n), 4);
  assert.ok(free);
  Object.assign(n, free, {
    phase: 2,
    destination: { ...target, ...free },
    routineKey: a?.key ?? 'home:2',
    talkUntil: 0,
    talkerId: null,
  });
  return n;
}
function gather(r, n) {
  for (let i = 1; i <= 40; i++) updateForaging(r, 0.1, born + i * 100);
  assert.equal(n.forage?.carrying, true);
}
function guests(r) {
  r.households.forEach((h, i) =>
    Object.assign(h, {
      stage: 'visiting',
      visit: 1,
      leg: HOUSEHOLDS[i].route.length - 1,
      stayUntil: born + 600000,
    }),
  );
  for (const n of r.residents) {
    const target =
      householdAssignment(r, n.id, 3)?.target ?? RESIDENTS.find((d) => d.id === n.id).routine[3];
    const free = r.collision.nearestFree(target, n.radius, ridingObstacles(r, null, n), 4);
    assert.ok(free);
    Object.assign(n, free);
    n.routineKey = '';
    n.destination = null;
  }
}
for (const visiting of [false, true])
  test(`all eight ${visiting ? 'visiting' : 'native'} residents walk, gather actual stock, carry it back and eat without taking common food or crops`, () => {
    const { r, p } = fixture();
    if (visiting) guests(r);
    const plots = structuredClone(r.gulf.plots),
      inventory = structuredClone(p.inventory),
      initial = berryTotal(r);
    for (const pantry of r.gulf.pantries) pantry.food.cookedRoot = 1;
    const travelled = new Map(r.residents.map((n) => [n.id, 0]));
    const collected = new Set();
    for (let elapsed = 0; elapsed < 179900; elapsed += 100) {
      const before = r.residents.map((n) => ({ x: n.x, z: n.z }));
      updateResidents(r, 0.1, born + elapsed);
      updateForaging(r, 0.1, born + elapsed);
      updateSuppers(r, born + elapsed);
      for (const [i, n] of r.residents.entries()) {
        travelled.set(n.id, travelled.get(n.id) + Math.hypot(n.x - before[i].x, n.z - before[i].z));
        if (n.forage) collected.add(n.id);
        if (elapsed % 1000 === 0)
          assert.ok(
            r.collision.free(n, n.radius, ridingObstacles(r, null, n)),
            `${n.id} collision at ${elapsed}`,
          );
      }
    }
    assert.equal(
      collected.size,
      8,
      JSON.stringify(
        r.residents.map((n) => ({
          id: n.id,
          forage: n.forage,
          activity: n.activity,
          x: n.x,
          z: n.z,
        })),
      ),
    );
    for (const n of r.residents) {
      assert.equal(n.forage.carrying, false, n.id);
      assert.equal(n.supper?.day, 1, n.id);
      assert.equal(
        n.forage.deliveredTo,
        visiting ? MANY_HEARTHS.id : RESIDENTS.find((d) => d.id === n.id).settlementId,
      );
      assert.ok(travelled.get(n.id) > 20, n.id);
    }
    assert.equal(berryTotal(r), initial - 8);
    assert.equal(
      r.gulf.pantries.reduce((a, p) => a + supperTotal(p), 0),
      0,
    );
    assert.ok(r.gulf.pantries.every((p) => p.food.cookedRoot === 1));
    assert.deepEqual(r.gulf.plots, plots);
    assert.deepEqual(p.inventory, inventory);
  });

test('four simulated seconds are required; the source loses one only at completion and never more than once per day', () => {
  const { r } = fixture(),
    n = atShrub(r);
  r.residents = [n];
  const initial = berryTotal(r);
  for (let i = 1; i <= 39; i++) assert.equal(updateForaging(r, 0.1, born + i * 100), false);
  assert.equal(n.forage, null);
  assert.equal(berryTotal(r), initial);
  assert.equal(updateForaging(r, 0.1, born + 4000), true);
  assert.equal(berryTotal(r), initial - 1);
  for (let i = 41; i < 100; i++) updateForaging(r, 0.1, born + i * 100);
  assert.equal(berryTotal(r), initial - 1);
  assert.equal(n.forage.day, 1);
});

test('residents leave two berries per shrub and wait for actual regrowth instead of taking farm harvests', () => {
  const { r } = fixture();
  for (const s of r.resources) if (s.type === 'berry') s.amount = 2;
  for (let i = 0; i < 600; i++) {
    updateResidents(r, 0.1, born + i * 100);
    updateForaging(r, 0.1, born + i * 100);
  }
  assert.ok(r.residents.every((n) => n.forage === null));
  const source = r.resources.find((s) => s.id === 'gulf-many-hearths-6');
  source.amount = 3;
  const n = atShrub(r);
  r.residents = [n];
  gather(r, n);
  assert.equal(source.amount, 2);
});

test('movement, a conversation, day phase changes and departure cancel unfinished work without losing stock', () => {
  for (const interrupt of ['moving', 'talking', 'phase', 'journey']) {
    const { r, p } = fixture(),
      n = atShrub(r, 'mira');
    r.residents = [n];
    const before = berryTotal(r);
    updateForaging(r, 0.15, born);
    assert.equal(n.forageWork.elapsedMs, 150);
    let now = born + 100;
    if (interrupt === 'moving') n.moving = true;
    if (interrupt === 'talking') {
      n.talkerId = p.id;
      n.talkUntil = born + 20000;
    }
    if (interrupt === 'phase') now = born + 60000;
    if (interrupt === 'journey') r.households[0].stage = 'assembling';
    updateForaging(r, 0.15, now);
    assert.equal(n.forageWork, null, interrupt);
    assert.equal(n.forage, null);
    assert.equal(berryTotal(r), before);
  }
});

test('distance and intervening scenery prevent gathering even with a forged activity label', () => {
  const { r } = fixture(),
    n = atShrub(r);
  r.residents = [n];
  const before = berryTotal(r),
    resource = r.resources.find((s) => n.routineKey.endsWith(':' + s.id));
  n.x += 15;
  n.destination = { ...n.destination, x: n.x };
  for (let i = 0; i < 50; i++) updateForaging(r, 0.1, born + i * 100);
  assert.equal(n.forage, null);
  // A real obstacle between actor and source also rejects the interaction.
  r.collision = new CollisionWorld([
    { type: 'circle', id: 'test-block', x: resource.x, z: resource.z + 1.4, radius: 1 },
  ]);
  n.x = resource.x;
  n.z = resource.z + 2.8;
  n.destination = { ...n.destination, x: n.x, z: n.z };
  for (let i = 0; i < 50; i++) updateForaging(r, 0.1, born + i * 100);
  assert.equal(n.forage, null);
  assert.equal(berryTotal(r), before);
});

test('a full pantry preserves the carried berry through the next day and travel, then accepts it exactly once at the visited hearth', () => {
  const { r } = fixture(),
    n = atShrub(r, 'mira');
  r.residents = [n];
  gather(r, n);
  stock(r, 'long-valley').food.cookedRoot = 48;
  seated(r, n.id);
  updateForaging(r, 0.1, evening);
  assert.equal(n.forage.carrying, true);
  assert.equal(pantryTotal(stock(r, 'long-valley')), 48);
  assert.equal(foragingAssignment(r, n, 0, born + VILLAGE.dayMs, []), null);
  r.households[0].stage = 'outbound';
  assert.equal(supperPlace(r, n.id), null);
  updateForaging(r, 0.1, evening + VILLAGE.dayMs);
  assert.equal(n.forage.carrying, true);
  Object.assign(r.households[0], { stage: 'visiting', stayUntil: born + 999999 });
  seated(r, n.id);
  assert.equal(updateForaging(r, 0.1, evening + VILLAGE.dayMs), true);
  assert.equal(n.forage.carrying, false);
  assert.equal(n.forage.deliveredDay, 2);
  assert.equal(n.forage.deliveredTo, MANY_HEARTHS.id);
  assert.equal(stock(r).supper.berry, 1);
  assert.equal(updateForaging(r, 0.1, evening + VILLAGE.dayMs + 100), false);
  assert.equal(stock(r).supper.berry, 1);
  assert.equal(stock(r, 'long-valley').food.cookedRoot, 48);
});

test('legacy and malformed forage records cannot create a carried berry or a future daily exemption', () => {
  const valid = {
    day: 1,
    sourceId: 'gulf-many-hearths-6',
    carrying: true,
    deliveredDay: null,
    deliveredTo: null,
  };
  assert.deepEqual(normalizeResidentForage(valid, 2), valid);
  for (const bad of [
    undefined,
    {},
    { ...valid, day: 3 },
    { ...valid, day: NaN },
    { ...valid, carrying: 1 },
    { ...valid, sourceId: 'gulf-obsidian-1' },
    { ...valid, deliveredDay: 1 },
    { ...valid, carrying: false },
    { ...valid, carrying: false, deliveredDay: 2, deliveredTo: 'elsewhere' },
  ])
    assert.equal(normalizeResidentForage(bad, 2), null);
  const delivered = { ...valid, carrying: false, deliveredDay: 2, deliveredTo: 'reed-shore' };
  assert.deepEqual(normalizeResidentForage(delivered, 2), delivered);
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
    core.connect(s, new URLSearchParams({ room: 'FORAGE', name: `P${i}`, resume: '1' }));
    sockets.push(s);
  }
  return {
    core,
    sockets,
    r: core.rooms.get('FORAGE'),
    setNow: (n) => {
      now = n;
    },
  };
}
test('eight players and a resident conserve contested resource stock and the last pantry space; changes broadcast before 90 ms', () => {
  const f = coreFixture();
  try {
    const n = atShrub(f.r),
      resource = f.r.resources.find((s) => n.routineKey.endsWith(':' + s.id));
    resource.amount = 3;
    for (let i = 1; i <= 39; i++) updateForaging(f.r, 0.1, born + i * 100);
    for (const p of f.r.players.values()) Object.assign(p, { x: resource.x, z: resource.z + 3 });
    f.setNow(born + 4000);
    for (const s of f.sockets)
      s.command({
        type: 'action',
        action: 'gather',
        targetId: resource.id,
        amount: 99,
        forage: { carrying: true },
      });
    updateForaging(f.r, 0.1, born + 4000);
    assert.equal(resource.amount, 0);
    assert.equal(n.forage, null);
    assert.equal(
      [...f.r.players.values()].reduce((a, p) => a + p.inventory.berry, 0),
      3,
    );
    resource.amount = 8;
    atShrub(f.r);
    gather(f.r, n);
    const players = [...f.r.players.values()];
    players.forEach((p, i) =>
      Object.assign(p, { x: MANY_HEARTHS.x - 6 + i * 1.4, z: MANY_HEARTHS.z + 5 }),
    );
    for (const p of players) p.inventory.berry = 1;
    stock(f.r).food.cookedRoot = 47;
    f.setNow(evening);
    for (const s of f.sockets)
      s.command({ type: 'action', action: 'gulfSupperGive', targetId: 'many-hearths:berry' });
    seated(f.r);
    updateForaging(f.r, 0.1, evening);
    assert.equal(n.forage.carrying, true);
    assert.equal(pantryTotal(stock(f.r)), 48);
    assert.equal(
      players.reduce((a, p) => a + p.inventory.berry, 0),
      7,
    );
    updateSuppers(f.r, evening);
    assert.equal(pantryTotal(stock(f.r)), 47);
    f.setNow(evening + 20);
    f.r.lastBroadcast = evening;
    f.core.tick();
    assert.equal(n.forage.carrying, false);
    assert.equal(pantryTotal(stock(f.r)), 48);
    for (const s of f.sockets) {
      const snap = s.messages.findLast((m) => m.type === 'state');
      assert.ok(snap.resources);
      assert.equal(snap.serverTime, evening + 20);
      assert.equal(snap.gulf.pantries[0].supper.berry, 1);
    }
  } finally {
    f.core.close();
  }
});

test('carried and delivered berries survive export, reconnect and import once; progress and old missing records start empty', () => {
  const f = coreFixture(1);
  try {
    const n = atShrub(f.r);
    gather(f.r, n);
    f.setNow(born + 4000);
    const saved = f.core.exportState(),
      token = [...f.r.players.values()][0].sessionToken;
    const wire = residentSnapshots(f.r);
    wire[0].forage.carrying = false;
    assert.equal(n.forage.carrying, true);
    assert.ok(!('forageWork' in wire[0]));
    f.sockets[0].close();
    const reconnected = new Socket();
    f.core.connect(
      reconnected,
      new URLSearchParams({ room: 'FORAGE', resume: '1', session: token }),
    );
    assert.equal(n.forage.carrying, true);
    const restored = createGameCore({
      runtime: {
        now: () => evening,
        id: () => crypto.randomUUID(),
        token: () => crypto.randomUUID(),
      },
    });
    try {
      restored.importState(saved);
      const r = restored.rooms.get('FORAGE');
      const socket = new Socket();
      restored.connect(
        socket,
        new URLSearchParams({ room: 'FORAGE', resume: '1', session: token }),
      );
      assert.equal(r.residents[0].forage.carrying, true);
      assert.equal(r.residents[0].forageWork, null);
      assert.equal(berryTotal(r), berryTotal(f.r));
      seated(r);
      updateForaging(r, 0.1, evening);
      assert.equal(stock(r).supper.berry, 1);
      const delivered = restored.exportState();
      for (const n of saved.rooms[0].residents) delete n.forage;
      for (const [record, legacy] of [
        [delivered, false],
        [saved, true],
      ]) {
        const next = createGameCore({
          runtime: {
            now: () => evening,
            id: () => crypto.randomUUID(),
            token: () => crypto.randomUUID(),
          },
        });
        try {
          next.importState(record);
          const again = next.rooms.get('FORAGE');
          if (legacy) {
            assert.ok(again.residents.every((n) => n.forage === null));
            assert.deepEqual(again.gulf.plots, saved.rooms[0].gulf.plots);
          } else {
            assert.equal(again.residents[0].forage.carrying, false);
            assert.equal(stock(again).supper.berry, 1);
          }
        } finally {
          next.close();
        }
      }
    } finally {
      restored.close();
    }
  } finally {
    f.core.close();
  }
});

test('empty rooms and long clock gaps never complete old work or create missed daily harvests', () => {
  const f = coreFixture(1);
  try {
    const n = atShrub(f.r);
    updateForaging(f.r, 0.15, born);
    const before = berryTotal(f.r),
      token = [...f.r.players.values()][0].sessionToken;
    f.sockets[0].close();
    f.setNow(born + 1000);
    f.core.tick();
    assert.equal(n.forageWork, null);
    const socket = new Socket();
    f.core.connect(socket, new URLSearchParams({ room: 'FORAGE', resume: '1', session: token }));
    f.setNow(born + VILLAGE.dayMs * 2);
    f.core.tick();
    assert.equal(n.forage, null);
    assert.equal(berryTotal(f.r), before);
    assert.ok((n.forageWork?.elapsedMs ?? 0) <= 150);
    updateForaging(f.r, 10000, born + VILLAGE.dayMs * 2 + 100);
    assert.equal(n.forage, null);
    assert.ok((n.forageWork?.elapsedMs ?? 0) <= 300);
  } finally {
    f.core.close();
  }
});
