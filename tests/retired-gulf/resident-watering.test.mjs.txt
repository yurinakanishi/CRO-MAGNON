import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createGameCore } from '../dist/application/game-core.mjs';
import {
  createGulfState,
  ensureGulfPlayer,
  handleGulfAction,
  updateGulf,
  gulfSeason,
} from '../dist/shared/gulf-life.mjs';
import {
  createResidents,
  updateResidents,
  residentSnapshots,
} from '../dist/shared/village-life.mjs';
import {
  assignWatering,
  wateringAssignment,
  updateWatering,
  normalizeWatering,
  WATERING,
} from '../dist/shared/watering.mjs';
import { updateForaging } from '../dist/shared/foraging.mjs';
import { updateSuppers } from '../dist/shared/supper.mjs';
import {
  FARM_PLOTS,
  SETTLEMENTS,
  MANY_HEARTHS,
  GULF_RESOURCES,
} from '../dist/shared/gulf-region.mjs';
import { CROPS, cropGrowMs } from '../dist/shared/crops.mjs';
import { RESIDENTS, VILLAGE, villagePhase } from '../dist/shared/village-sites.mjs';
import { householdAssignment } from '../dist/shared/household-life.mjs';
import { HOUSEHOLDS } from '../dist/shared/household-sites.mjs';
import { CollisionWorld } from '../dist/shared/collision.mjs';
import { ridingObstacles } from '../dist/shared/riding.mjs';
import { stopActor } from '../dist/shared/combat.mjs';

const born = 100000,
  collision = new CollisionWorld();
const at = (p, point) => Object.assign(p, { x: point.x, z: point.z + 1.3 });
const act = (r, p, action, targetId = FARM_PLOTS[0].id, now = born, cropId = 'berry') =>
  handleGulfAction(
    r,
    p,
    { action, targetId, cropId, water: 99, readyAt: 1, watering: { water: 99 } },
    now,
  );
function fixture() {
  const p = {
    id: 'p',
    x: 50,
    z: 57,
    radius: 0.32,
    inventory: { berry: 0, seed: 20, water: 6 },
    path: [],
    energy: 100,
  };
  ensureGulfPlayer(p);
  const r = {
    createdAt: born,
    players: new Map([[p.id, p]]),
    animals: [],
    enemies: [],
    collision,
    gulf: createGulfState(),
  };
  createResidents(r, [], born);
  return { r, p };
}
function request(r, p, spec = FARM_PLOTS[0], crop = CROPS[0], now = born) {
  at(p, spec);
  p.inventory[crop.seed] = 1;
  assert.equal(act(r, p, 'gulfPlant', spec.id, now, crop.id).ok, true);
  assert.equal(act(r, p, 'gulfWaterRequest', spec.id, now).ok, true);
  return r.gulf.plots.find((p) => p.id === spec.id);
}
function atWork(r, n, now = born) {
  assignWatering(r, now);
  const phase = villagePhase(now, r.createdAt);
  const a = wateringAssignment(r, n, phase, now, ridingObstacles(r, null, n));
  assert.ok(a, n.id + ' has a reachable task');
  stopActor(n);
  Object.assign(n, a.target, {
    phase,
    destination: a.target,
    routineKey: a.key,
    wateringWork: null,
    talkerId: null,
    talkUntil: 0,
  });
}
function work(r, start = born, steps = 30) {
  for (let i = 1; i <= steps; i++) updateWatering(r, 0.1, start + i * 100);
}
function guests(r) {
  r.households.forEach((h, i) =>
    Object.assign(h, {
      stage: 'visiting',
      visit: 1,
      leg: HOUSEHOLDS[i].route.length - 1,
      stayUntil: born + 700000,
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

test('a nearby player requests only a planted crop; distance, walls, busy state and duplicates preserve supplies', () => {
  const { r, p } = fixture(),
    spec = FARM_PLOTS[0],
    plot = r.gulf.plots[0];
  at(p, spec);
  assert.equal(act(r, p, 'gulfWaterRequest').ok, false);
  assert.equal(act(r, p, 'gulfWaterRequest', 'missing').ok, false);
  assert.equal(act(r, p, 'gulfPlant').ok, true);
  const inventory = structuredClone(p.inventory),
    progress = structuredClone(p.gulf);
  p.x += 10;
  assert.equal(act(r, p, 'gulfWaterRequest').ok, false);
  at(p, spec);
  r.collision = { segmentFree: () => false };
  assert.equal(act(r, p, 'gulfWaterRequest').ok, false);
  r.collision = collision;
  for (const field of ['downedUntil', 'mountId', 'boatId', 'cookingEndsAt']) {
    p[field] = 1;
    assert.equal(act(r, p, 'gulfWaterRequest').ok, false);
    p[field] = 0;
  }
  assert.equal(plot.waterRequestAt, 0);
  assert.equal(act(r, p, 'gulfWaterRequest').ok, true);
  assert.equal(act(r, p, 'gulfWaterRequest').ok, false);
  assert.equal(plot.waterRequestAt, born);
  p.x += 10;
  assert.equal(act(r, p, 'gulfWaterCancel').ok, false);
  at(p, spec);
  assert.equal(act(r, p, 'gulfWaterCancel').ok, true);
  assert.equal(act(r, p, 'gulfWaterCancel').ok, false);
  assert.equal(plot.stage, 'planted');
  assert.equal(plot.waterRequestAt, 0);
  assert.deepEqual(p.inventory, inventory);
  assert.deepEqual(p.gulf, progress);
});

test('all three crops require three seconds at the spring and three at the plot, with exact seasonal water costs and growth', () => {
  for (let season = 0; season < 4; season++)
    for (const crop of CROPS) {
      const { r, p } = fixture(),
        n = r.residents[0],
        now = born + season * 720000;
      r.residents = [n];
      const plot = request(r, p, FARM_PLOTS[0], crop, now),
        inventory = structuredClone(p.inventory);
      atWork(r, n, now);
      work(r, now, 29);
      assert.equal(n.watering.water, 0);
      assert.equal(plot.stage, 'planted');
      updateWatering(r, 0.1, now + 3000);
      assert.equal(n.watering.water, 2);
      assert.equal(n.watering.last, null);
      n.destination = null;
      atWork(r, n, now + 3000);
      work(r, now + 3000, 29);
      assert.equal(plot.stage, 'planted');
      assert.equal(n.watering.water, 2);
      updateWatering(r, 0.1, now + 6000);
      assert.equal(plot.stage, 'growing');
      assert.equal(plot.waterRequestAt, 0);
      assert.equal(plot.readyAt, now + 6000 + cropGrowMs(crop, gulfSeason(now, born).growMs));
      assert.equal(n.watering.water, 2 - crop.water);
      assert.equal(n.watering.last.cropId, crop.id);
      work(r, now + 6000, 50);
      assert.equal(n.watering.water, 2 - crop.water);
      updateGulf(r, plot.readyAt);
      assert.equal(plot.stage, 'ripe');
      updateResidents(r, 0.1, plot.readyAt);
      updateWatering(r, 0.1, plot.readyAt);
      assert.equal(plot.stage, 'ripe', 'residents never harvest');
      assert.deepEqual(p.inventory, inventory);
      assert.equal(p.gulf.harvested, 0);
    }
});

for (const visiting of [false, true])
  test(`all eight ${visiting ? 'visiting' : 'native'} residents forage, walk to springs and requested farms, water and return to supper without collisions`, () => {
    const { r, p } = fixture();
    r.resources = GULF_RESOURCES.map((s) => ({ ...s, regeneratedAt: born }));
    if (visiting) guests(r);
    const requested = [];
    for (const place of visiting ? [MANY_HEARTHS] : SETTLEMENTS) {
      const plots = FARM_PLOTS.filter((s) => s.settlementId === place.id);
      for (let i = 0; i < (visiting ? 8 : 2); i++)
        requested.push(request(r, p, plots[i], CROPS[i % 3]));
      // This planted crop has no permission, even though a neighbour has a request.
      at(p, plots[10]);
      p.inventory.seed = 1;
      assert.equal(act(r, p, 'gulfPlant', plots[10].id).ok, true);
    }
    Object.assign(p, { x: 50, z: 57 });
    const untouched = r.gulf.plots.filter((s) => !requested.includes(s)).map((s) => ({ ...s }));
    const inventory = structuredClone(p.inventory),
      pantries = r.gulf.pantries;
    pantries.forEach((s) => (s.food.cookedRoot = 1));
    const total = new Map(r.residents.map((n) => [n.id, 0]));
    for (let elapsed = 0; elapsed < (visiting ? 420000 : 180000); elapsed += 100) {
      const before = r.residents.map((n) => ({ x: n.x, z: n.z }));
      updateResidents(r, 0.1, born + elapsed);
      updateForaging(r, 0.1, born + elapsed);
      updateWatering(r, 0.1, born + elapsed);
      updateSuppers(r, born + elapsed);
      const claims = r.residents.map((n) => n.wateringTarget?.plotId).filter(Boolean);
      assert.equal(new Set(claims).size, claims.length, 'each plot has one helper');
      for (const [i, n] of r.residents.entries()) {
        total.set(n.id, total.get(n.id) + Math.hypot(n.x - before[i].x, n.z - before[i].z));
        if (elapsed % 1000 === 0)
          assert.ok(
            r.collision.free(n, n.radius, ridingObstacles(r, null, n)),
            `${n.id} collision at ${elapsed}`,
          );
      }
    }
    for (const n of r.residents) {
      assert.ok(
        n.watering.last?.day >= 1 && n.watering.last.day <= (visiting ? 2 : 1),
        JSON.stringify({ id: n.id, activity: n.activity, watering: n.watering }),
      );
      assert.equal(n.supper?.day, visiting ? 2 : 1, n.id);
      assert.equal(n.forage?.carrying, false, n.id);
      assert.ok(total.get(n.id) > 50, n.id + ' travels between jobs');
    }
    assert.ok(requested.every((s) => s.stage === 'growing'));
    assert.deepEqual(
      r.gulf.plots.filter((s) => !requested.includes(s)),
      untouched,
    );
    assert.deepEqual(p.inventory, inventory);
    assert.ok(pantries.every((s) => s.food.cookedRoot === 1));
  });

test('one plot per resident per day, rotating local priority and water carried into the following day and another settlement', () => {
  const { r, p } = fixture(),
    n = r.residents[2]; // Mira, a travelling household member
  r.residents = [n];
  const home = FARM_PLOTS.filter((s) => s.settlementId === 'long-valley');
  const first = request(r, p, home[0]),
    second = request(r, p, home[1]);
  n.watering.water = 2;
  atWork(r, n);
  work(r);
  assert.equal(first.stage, 'growing');
  assert.equal(n.watering.water, 1);
  assignWatering(r, born + 5000);
  assert.equal(n.wateringTarget, null);
  assert.equal(second.stage, 'planted');
  const nextDay = born + VILLAGE.dayMs;
  request(r, p, FARM_PLOTS[0], CROPS[2], nextDay);
  r.households[0].stage = 'visiting';
  r.households[0].stayUntil = nextDay + 600000;
  n.destination = null;
  atWork(r, n, nextDay);
  assert.ok(n.routineKey.endsWith(':plot'), 'remaining water is used without another fill');
  work(r, nextDay);
  assert.equal(n.watering.water, 0);
  assert.equal(n.watering.last.plotId, FARM_PLOTS[0].id);
  assert.equal(n.watering.last.day, 2);
  assert.equal(second.stage, 'planted');
  const g = fixture();
  request(g.r, g.p);
  assignWatering(g.r, born);
  assert.ok(g.r.residents.find((s) => s.id === 'aru').wateringTarget);
  assignWatering(g.r, born + 120000);
  assert.ok(
    g.r.residents.find((s) => s.id === 'aru').wateringTarget,
    'unfinished delivery stays assigned overnight',
  );
  act(g.r, g.p, 'gulfWaterCancel', FARM_PLOTS[0].id, nextDay);
  act(g.r, g.p, 'gulfWaterRequest', FARM_PLOTS[0].id, nextDay);
  assignWatering(g.r, nextDay);
  assert.ok(g.r.residents.find((s) => s.id === 'seno').wateringTarget);
});

test('cancel/re-request in the same clock tick and manual watering discard old work without losing a resident’s carried water', () => {
  for (const change of ['cancel', 'manual']) {
    const { r, p } = fixture(),
      n = r.residents[0];
    r.residents = [n];
    const plot = request(r, p);
    n.watering.water = 2;
    atWork(r, n);
    work(r, born, 29);
    assert.equal(n.wateringWork.elapsedMs, 2900);
    if (change === 'cancel') {
      assert.equal(act(r, p, 'gulfWaterCancel').ok, true);
      assert.equal(act(r, p, 'gulfWaterRequest').ok, true);
      assignWatering(r, born);
      updateWatering(r, 0.1, born);
      assert.equal(plot.stage, 'planted');
      assert.equal(n.watering.water, 2);
      work(r, born, 28);
      assert.equal(plot.stage, 'planted');
      updateWatering(r, 0.1, born + 3000);
      assert.equal(plot.stage, 'growing');
    } else {
      const before = p.inventory.water;
      assert.equal(act(r, p, 'gulfTend', plot.id, born + 3000).ok, true);
      updateWatering(r, 0.1, born + 3000);
      assert.equal(p.inventory.water, before - 1);
      assert.equal(n.watering.water, 2);
      assert.equal(n.watering.last, null);
      assert.equal(n.wateringWork, null);
      updateGulf(r, plot.readyAt);
      assert.equal(act(r, p, 'gulfHarvest', plot.id, plot.readyAt).ok, true);
      assert.equal(act(r, p, 'gulfPlant', plot.id, plot.readyAt).ok, true);
      updateWatering(r, 0.15, plot.readyAt);
      assert.equal(plot.stage, 'planted');
      assert.equal(plot.waterRequestAt, 0);
      assert.equal(n.watering.water, 2);
    }
  }
});

test('movement, conversation, obstruction, departure, evening and cancelled work reset both fill and pour progress', () => {
  for (const pouring of [false, true])
    for (const interrupt of ['moving', 'talking', 'blocked', 'journey', 'phase', 'request']) {
      const { r, p } = fixture(),
        n = r.residents[2];
      r.residents = [n];
      const spec = FARM_PLOTS.find((s) => s.settlementId === 'long-valley'),
        plot = request(r, p, spec);
      n.watering.water = pouring ? 2 : 0;
      atWork(r, n);
      work(r, born, 29);
      let now = born + 3000;
      if (interrupt === 'moving') n.moving = true;
      if (interrupt === 'talking') {
        n.talkerId = p.id;
        n.talkUntil = born + 20000;
      }
      if (interrupt === 'blocked') r.collision = { segmentFree: () => false };
      if (interrupt === 'journey') r.households[0].stage = 'assembling';
      if (interrupt === 'phase') now = born + 120000;
      if (interrupt === 'request') act(r, p, 'gulfWaterCancel', plot.id, now);
      updateWatering(r, 0.1, now);
      assert.equal(n.wateringWork, null, `${pouring}/${interrupt}`);
      assert.equal(n.watering.water, pouring ? 2 : 0);
      assert.equal(plot.stage, 'planted');
      assert.equal(n.watering.last, null);
    }
});

test('legacy and malformed saved records cannot grant excess water, future work or requests on empty or growing fields', () => {
  const valid = { water: 1, last: { day: 2, plotId: FARM_PLOTS[0].id, cropId: 'root' } };
  assert.deepEqual(normalizeWatering(valid, 2), valid);
  for (const water of [-1, 3, 1.5, Infinity, '2', NaN])
    assert.equal(normalizeWatering({ water }, 2).water, 0);
  for (const last of [
    { ...valid.last, day: 3 },
    { ...valid.last, day: 0 },
    { ...valid.last, plotId: 'fake' },
    { ...valid.last, cropId: '__proto__' },
  ])
    assert.equal(normalizeWatering({ water: 2, last }, 2).last, null);
  for (const stage of ['empty', 'growing', 'ripe'])
    assert.equal(
      createGulfState({ plots: [{ id: FARM_PLOTS[0].id, stage, waterRequestAt: born }] }).plots[0]
        .waterRequestAt,
      0,
    );
  for (const waterRequestAt of [-1, 1.5, Infinity, '1', NaN])
    assert.equal(
      createGulfState({ plots: [{ id: FARM_PLOTS[0].id, stage: 'planted', waterRequestAt }] })
        .plots[0].waterRequestAt,
      0,
    );
  assert.deepEqual(normalizeWatering(undefined, 2), { water: 0, last: null });
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
    core.connect(s, new URLSearchParams({ room: 'WATER', name: `P${i}`, resume: '1' }));
    sockets.push(s);
  }
  return { core, sockets, r: core.rooms.get('WATER'), setNow: (n) => (now = n) };
}
const command = (s, action, targetId = FARM_PLOTS[0].id) =>
  s.command({ type: 'action', action, targetId });

test('eight players contest the same request and manual watering once; all receive the completed plot immediately', () => {
  const f = coreFixture();
  try {
    const ps = [...f.r.players.values()],
      n = f.r.residents[0],
      spec = FARM_PLOTS[0];
    request(f.r, ps[0]);
    act(f.r, ps[0], 'gulfWaterCancel');
    ps.forEach((p) => {
      at(p, spec);
      p.inventory.water = 6;
    });
    f.sockets.forEach((s) => command(s, 'gulfWaterRequest'));
    assert.equal(f.r.gulf.plots[0].waterRequestAt, born);
    assert.equal(
      f.sockets.reduce(
        (n, s) =>
          n +
          s.messages.filter(
            (m) => m.type === 'notice' && m.text?.startsWith('住人に水やりを頼んだ'),
          ).length,
        0,
      ),
      1,
    );
    n.watering.water = 2;
    atWork(f.r, n);
    work(f.r, born, 29);
    f.setNow(born + 3000);
    f.sockets.forEach((s) => command(s, 'gulfTend'));
    updateWatering(f.r, 0.1, born + 3000);
    assert.equal(
      ps.reduce((sum, p) => sum + p.inventory.water, 0),
      47,
    );
    assert.equal(n.watering.water, 2);
    assert.equal(n.watering.last, null);
    for (const s of f.sockets)
      assert.equal(s.messages.findLast((m) => m.type === 'state').gulf.plots[0].stage, 'growing');
    // Another requested field finishes through the actual game tick, not the action handler.
    const second = request(f.r, ps[0], FARM_PLOTS[1], CROPS[2], born + 4000);
    ps.forEach((p) => Object.assign(p, { x: 50, z: 57 }));
    n.destination = null;
    atWork(f.r, n, born + 4000);
    n.forage = {
      day: 1,
      resourceId: 'gulf-many-hearths-6',
      carrying: true,
      deliveredDay: 0,
      deliveredTo: null,
    };
    work(f.r, born + 4000, 29);
    f.setNow(born + 7020);
    f.r.lastBroadcast = born + 7000;
    f.core.tick();
    assert.equal(second.stage, 'growing');
    for (const s of f.sockets) {
      const m = s.messages.findLast((m) => m.type === 'state');
      assert.equal(m.serverTime, born + 7020);
      assert.ok(m.gulf);
      assert.equal(m.gulf.plots[1].stage, 'growing');
    }
  } finally {
    f.core.close();
  }
});

test('carried water, requests and daily records survive save/reconnect; transient work is discarded and legacy saves start empty', () => {
  const f = coreFixture(1);
  try {
    const p = [...f.r.players.values()][0],
      n = f.r.residents[0],
      token = p.sessionToken;
    request(f.r, p);
    n.watering.water = 1;
    atWork(f.r, n);
    work(f.r, born, 12);
    const other = f.r.residents[1];
    other.watering = { water: 0, last: { day: 1, plotId: FARM_PLOTS[1].id, cropId: 'root' } };
    const wire = residentSnapshots(f.r);
    wire[0].watering.water = 99;
    wire[1].watering.last.day = 99;
    assert.equal(n.watering.water, 1);
    assert.equal(other.watering.last.day, 1);
    assert.ok(!('wateringWork' in wire[0]));
    f.setNow(born + 1500);
    const saved = f.core.exportState();
    f.sockets[0].close();
    assert.equal(n.wateringWork, null);
    assert.equal(n.wateringTarget, null);
    const reconnect = new Socket();
    f.core.connect(reconnect, new URLSearchParams({ room: 'WATER', resume: '1', session: token }));
    assert.equal(n.watering.water, 1);
    for (const legacy of [false, true]) {
      const data = structuredClone(saved);
      if (legacy) {
        data.rooms[0].residents.forEach((s) => delete s.watering);
        data.rooms[0].gulf.plots.forEach((s) => delete s.waterRequestAt);
      }
      const next = createGameCore({
        runtime: {
          now: () => born + 2000,
          id: () => crypto.randomUUID(),
          token: () => crypto.randomUUID(),
        },
      });
      try {
        next.importState(data);
        const r = next.rooms.get('WATER');
        assert.equal(r.residents[0].watering.water, legacy ? 0 : 1);
        assert.equal(r.residents[1].watering.last?.day ?? 0, legacy ? 0 : 1);
        assert.equal(r.residents[0].wateringWork, null);
        assert.equal(r.residents[0].wateringTarget, null);
        assert.equal(r.gulf.plots[0].waterRequestAt, legacy ? 0 : born);
        const s = new Socket();
        next.connect(s, new URLSearchParams({ room: 'WATER', resume: '1', session: token }));
        next.tick();
        assert.equal(r.gulf.plots[0].stage, 'planted');
      } finally {
        next.close();
      }
    }
  } finally {
    f.core.close();
  }
});

test('no occupants or a long clock gap never fill old work or produce missed daily watering', () => {
  const f = coreFixture(1);
  try {
    const p = [...f.r.players.values()][0],
      token = p.sessionToken,
      n = f.r.residents[0];
    request(f.r, p);
    atWork(f.r, n);
    work(f.r, born, 29);
    f.sockets[0].close();
    f.setNow(born + 1000);
    f.core.tick();
    assert.equal(n.watering.water, 0);
    assert.equal(n.wateringWork, null);
    assert.equal(f.r.gulf.plots[0].stage, 'planted');
    const socket = new Socket();
    f.core.connect(socket, new URLSearchParams({ room: 'WATER', resume: '1', session: token }));
    f.setNow(born + VILLAGE.dayMs * 8);
    atWork(f.r, n, born + VILLAGE.dayMs * 8);
    updateWatering(f.r, 10000, born + VILLAGE.dayMs * 8);
    assert.equal(n.watering.water, 0);
    assert.equal(n.watering.last, null);
    assert.ok(n.wateringWork.elapsedMs <= 150);
  } finally {
    f.core.close();
  }
});

test('wire requests respect jump and unfinished player activities', () => {
  for (const field of ['jumpAt', 'fishing', 'coastalActivity', 'cookingEndsAt']) {
    const f = coreFixture(1);
    try {
      const p = [...f.r.players.values()][0];
      request(f.r, p);
      act(f.r, p, 'gulfWaterCancel');
      p[field] = field === 'jumpAt' ? born : { endsAt: born + 10000 };
      if (field === 'jumpAt') p.jumpSequence = 1;
      command(f.sockets[0], 'gulfWaterRequest');
      assert.equal(f.r.gulf.plots[0].waterRequestAt, 0, field);
    } finally {
      f.core.close();
    }
  }
});
