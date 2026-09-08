import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { CROPS, CROP_INVENTORY, ROOT_RECIPES, cropById } from '../dist/shared/crops.mjs';
import {
  createGulfState,
  ensureGulfPlayer,
  handleGulfAction,
  updateGulf,
  SEASONS,
} from '../dist/shared/gulf-life.mjs';
import { FARM_PLOTS, SETTLEMENTS, MANY_HEARTHS, SPRINGS } from '../dist/shared/gulf-region.mjs';
import { CollisionWorld } from '../dist/shared/collision.mjs';
import { handleHuntingAction, updateHunting } from '../dist/shared/hunting.mjs';
import { createGameCore } from '../dist/application/game-core.mjs';
import { decodeCommand } from '../dist/application/protocol.mjs';
import { gulfInteraction } from '../dist/src/gulf-ui.js';
import { huntInteraction } from '../dist/src/hunting-ui.js';

const collision = new CollisionWorld();
function player(id = 'p') {
  const p = {
    id,
    species: 'cro',
    gender: 'female',
    radius: 0.32,
    x: MANY_HEARTHS.x,
    z: MANY_HEARTHS.z + 2,
    energy: 10,
    inventory: { wood: 0, stone: 0, berry: 0, rawMeat: 0, cookedMeat: 0 },
    path: [],
  };
  ensureGulfPlayer(p);
  return p;
}
function room(...players) {
  return {
    createdAt: 10000,
    players: new Map(players.map((p) => [p.id, p])),
    gulf: createGulfState(),
    collision,
    animals: [],
    enemies: [],
    projectiles: [],
    cookingFires: [MANY_HEARTHS],
  };
}
const at = (p, point) => Object.assign(p, { x: point.x, z: point.z + 1.3 });
const act = (r, p, action, targetId, cropId, now = 10000) =>
  handleGulfAction(r, p, { action, targetId, cropId, yield: 99, water: 0, readyAt: 0 }, now);
const cook = (r, p, action, now = 10000) =>
  handleHuntingAction(r, p, { action, energy: 999, endsAt: 0 }, now);

test('every settlement supplies all crop seeds; invalid choices, distance, walls and capacity preserve payment', () => {
  const p = player(),
    r = room(p);
  for (const s of SETTLEMENTS)
    for (const c of CROPS) {
      at(p, s);
      p.inventory.berry = 2;
      p.inventory[c.seed] = 0;
      assert.equal(act(r, p, 'gulfSeeds', undefined, c.id).ok, true);
      assert.equal(p.inventory.berry, 0);
      assert.equal(p.inventory[c.seed], 2);
      p.inventory.berry = 2;
      p.inventory[c.seed] = 98;
      assert.equal(act(r, p, 'gulfSeeds', undefined, c.id).ok, false);
      assert.equal(p.inventory.berry, 2);
    }
  for (const invalid of ['__proto__', 'maize', 'constructor', {}, null])
    assert.equal(act(r, p, 'gulfSeeds', undefined, invalid).ok, false);
  p.inventory.rootSeed = 0;
  p.x += 20;
  assert.equal(act(r, p, 'gulfSeeds', undefined, 'root').ok, false);
  at(p, MANY_HEARTHS);
  r.collision = { segmentFree: () => false };
  assert.equal(act(r, p, 'gulfSeeds', undefined, 'root').ok, false);
  assert.equal(p.inventory.berry, 2);
});

test('three crops use authoritative species, water and seasonal growth with repeatable seed returns', () => {
  for (let season = 0; season < 4; season++)
    for (const c of CROPS) {
      const p = player(),
        r = room(p),
        spec = FARM_PLOTS[0],
        plot = r.gulf.plots[0],
        now = 10000 + season * 720000;
      at(p, spec);
      p.inventory[c.seed] = 1;
      p.inventory.water = 6;
      assert.equal(act(r, p, 'gulfPlant', spec.id, c.id, now).ok, true);
      assert.equal(plot.cropId, c.id);
      assert.equal(p.inventory[c.seed], 0);
      assert.equal(act(r, p, 'gulfPlant', spec.id, 'berry', now).ok, false);
      assert.equal(
        act(r, p, 'gulfTend', spec.id, 'berry', now).ok,
        true,
        'watering cannot change the planted crop',
      );
      assert.equal(p.inventory.water, 6 - c.water);
      const durations = {
        berry: [180000, 150000, 180000, 240000],
        root: [240000, 200000, 240000, 320000],
        herb: [120000, 100000, 120000, 160000],
      };
      assert.equal(plot.readyAt, now + durations[c.id][season]);
      assert.equal(act(r, p, 'gulfTend', spec.id, c.id, now).ok, false);
      assert.equal(act(r, p, 'gulfHarvest', spec.id, c.id, plot.readyAt - 1).ok, false);
      updateGulf(r, plot.readyAt);
      assert.equal(act(r, p, 'gulfHarvest', spec.id, 'berry', plot.readyAt).ok, true);
      assert.equal(p.inventory[c.harvest], c.yield);
      assert.equal(p.inventory[c.seed], 2);
      assert.equal(p.gulf.harvested, 1);
      assert.equal(plot.stage, 'empty');
    }
});

test('crop failures keep seeds, water and a ripe shared harvest intact; only one of eight visitors collects it', () => {
  for (const c of CROPS) {
    const ps = Array.from({ length: 8 }, (_, i) => player('p' + i)),
      p = ps[0],
      r = room(...ps),
      spec = FARM_PLOTS[0],
      plot = r.gulf.plots[0];
    ps.forEach((p) => at(p, spec));
    p.inventory[c.seed] = 1;
    assert.equal(act(r, p, 'gulfPlant', 'invalid', c.id).ok, false);
    assert.equal(act(r, p, 'gulfPlant', spec.id, '__proto__').ok, false);
    r.collision = { segmentFree: () => false };
    assert.equal(act(r, p, 'gulfPlant', spec.id, c.id).ok, false);
    r.collision = collision;
    assert.equal(p.inventory[c.seed], 1);
    assert.equal(act(r, p, 'gulfPlant', spec.id, c.id).ok, true);
    p.inventory.water = c.water - 1;
    assert.equal(act(r, p, 'gulfTend', spec.id, c.id).ok, false);
    assert.equal(p.inventory.water, c.water - 1);
    assert.equal(plot.stage, 'planted');
    p.inventory.water = c.water;
    act(r, p, 'gulfTend', spec.id, c.id);
    updateGulf(r, plot.readyAt);
    p.inventory[c.harvest] = 99;
    assert.equal(act(r, p, 'gulfHarvest', spec.id, c.id).ok, false);
    p.inventory[c.harvest] = 0;
    p.inventory[c.seed] = 98;
    assert.equal(act(r, p, 'gulfHarvest', spec.id, c.id).ok, false);
    p.inventory[c.seed] = 0;
    for (const field of ['downedUntil', 'boatId', 'mountId', 'cookingEndsAt']) {
      p[field] = 1;
      assert.equal(act(r, p, 'gulfHarvest', spec.id, c.id).ok, false);
      p[field] = 0;
    }
    const results = ps.map((p) => act(r, p, 'gulfHarvest', spec.id, c.id));
    assert.equal(results.filter((v) => v.ok).length, 1);
    assert.equal(
      ps.reduce((n, p) => n + p.inventory[c.harvest], 0),
      c.yield,
    );
    assert.equal(plot.stage, 'empty');
  }
});

test('old plots remain berries; missing or malformed new stocks are bounded and water remains shared', () => {
  const plots = FARM_PLOTS.slice(0, 3).map((p, i) => ({
    id: p.id,
    stage: ['planted', 'growing', 'ripe'][i],
    readyAt: 12345,
  }));
  const legacy = createGulfState({ plots });
  assert.ok(legacy.plots.every((p) => p.cropId === 'berry'));
  assert.deepEqual(
    legacy.plots.slice(0, 3).map((p) => p.stage),
    ['planted', 'growing', 'ripe'],
  );
  plots[0].cropId = '__proto__';
  assert.equal(createGulfState({ plots }).plots[0].cropId, 'berry');
  const p = player(),
    r = room(p);
  p.inventory.rootSeed = -1;
  p.inventory.rawRoot = 999;
  p.inventory.herb = NaN;
  p.inventory.cookedRoot = 2.9;
  ensureGulfPlayer(p);
  assert.equal(p.inventory.rootSeed, 0);
  assert.equal(p.inventory.rawRoot, 99);
  assert.equal(p.inventory.herb, 0);
  assert.equal(p.inventory.cookedRoot, 2);
  at(p, SPRINGS[0]);
  assert.equal(act(r, p, 'gulfWater').ok, true);
  assert.equal(p.inventory.water, 6);
});

test('both root recipes complete once, consume every ingredient together and restore capped energy', () => {
  for (const recipe of ROOT_RECIPES) {
    const p = player(),
      r = room(p);
    p.inventory.rawRoot = 2;
    p.inventory.herb = 2;
    assert.equal(cook(r, p, recipe.action).changed, true);
    assert.equal(p.cookingKind, recipe.kind);
    assert.equal(p.cookingEndsAt, 13000);
    updateHunting(r, 12999);
    assert.equal(p.inventory.rawRoot, 2);
    updateHunting(r, 13000);
    updateHunting(r, 14000);
    assert.equal(p.inventory.rawRoot, 1);
    assert.equal(p.inventory.herb, 2 - recipe.ingredients.herb);
    assert.equal(p.inventory[recipe.output], 1);
    assert.equal(cook(r, p, recipe.eatAction, 14000).changed, true);
    assert.equal(p.energy, 10 + recipe.energy);
    p.inventory[recipe.output] = 2;
    p.energy = 95;
    cook(r, p, recipe.eatAction, 15000);
    assert.equal(p.energy, 100);
    assert.equal(p.inventory[recipe.output], 1);
    assert.equal(cook(r, p, recipe.eatAction, 16000).changed, false);
    assert.equal(p.inventory[recipe.output], 1);
  }
});

test('root cooking cannot bypass ingredient/capacity/visibility checks and cancellation loses no food', () => {
  const p = player(),
    r = room(p);
  p.inventory.rawRoot = 2;
  assert.equal(cook(r, p, 'cookHerbRoot').changed, false);
  p.inventory.herb = 1;
  p.x += 10;
  assert.equal(cook(r, p, 'cookHerbRoot').changed, false);
  at(p, MANY_HEARTHS);
  r.collision = { segmentFree: () => false };
  assert.equal(cook(r, p, 'cookRoot').changed, false);
  r.collision = collision;
  p.inventory.herbRoot = 99;
  assert.equal(cook(r, p, 'cookHerbRoot').changed, false);
  p.inventory.herbRoot = 0;
  cook(r, p, 'cookHerbRoot');
  cook(r, p, 'cancelCook', 11000);
  updateHunting(r, 15000);
  assert.equal(p.inventory.rawRoot, 2);
  assert.equal(p.inventory.herb, 1);
  assert.equal(p.inventory.herbRoot, 0);
  cook(r, p, 'cookHerbRoot', 16000);
  p.x += 10;
  updateHunting(r, 17000);
  assert.equal(p.cookingEndsAt, 0);
  assert.equal(p.inventory.herb, 1);
  at(p, MANY_HEARTHS);
  cook(r, p, 'cookHerbRoot', 18000);
  p.inventory.herb = 0;
  updateHunting(r, 21000);
  assert.equal(p.inventory.rawRoot, 2);
  assert.equal(p.inventory.herbRoot, 0, 'no partial consumption');
  p.inventory.herb = 1;
  cook(r, p, 'cookHerbRoot', 22000);
  p.inventory.herbRoot = 99;
  updateHunting(r, 25000);
  assert.equal(p.inventory.rawRoot, 2);
  assert.equal(p.inventory.herb, 1);
});

test('root meals fill the existing feast food requirement and are never spent on an already full store', () => {
  const p = player(),
    r = room(p);
  for (const recipe of ROOT_RECIPES) {
    p.inventory[recipe.output] = 2;
    r.gulf.stores.berry = 12;
    assert.equal(act(r, p, recipe.offerAction).ok, false);
    assert.equal(p.inventory[recipe.output], 2);
    r.gulf.stores = { wood: 8, berry: 9, obsidian: 4 };
    assert.equal(act(r, p, recipe.offerAction).ok, true);
    assert.equal(p.inventory[recipe.output], 1);
    assert.deepEqual(r.gulf.stores, { wood: 0, berry: 0, obsidian: 0 });
  }
  assert.equal(r.gulf.festivals, 2);
  assert.equal(p.gulf.delivered, 2);
  assert.equal(act(r, p, 'gulfFeast').ok, true);
  assert.equal(act(r, p, 'gulfFeast').ok, false);
});

class Socket extends EventEmitter {
  readyState = 1;
  bufferedAmount = 0;
  messages = [];
  send(s) {
    this.messages.push(JSON.parse(s));
  }
  close() {
    this.readyState = 3;
    this.emit('close');
  }
  ping() {}
  terminate() {
    this.close();
  }
  command(value) {
    this.emit('message', Buffer.from(JSON.stringify(value)), false);
  }
}
test('crop maturation broadcasts full world state even between ordinary 90 ms sends', () => {
  let now = 10000;
  const core = createGameCore({
    runtime: { now: () => now, id: () => crypto.randomUUID(), token: () => crypto.randomUUID() },
  });
  const socket = new Socket();
  core.connect(socket, new URLSearchParams({ room: 'MATURATION' }));
  const r = core.rooms.get('MATURATION');
  core.tick();
  socket.messages.length = 0;
  Object.assign(r.gulf.plots[0], { stage: 'growing', cropId: 'root', readyAt: now + 20 });
  now += 20;
  core.tick();
  const full = socket.messages.find((m) => m.type === 'state' && m.gulf);
  assert.ok(full, 'the sole maturation event must not be lost by the broadcast throttle');
  assert.equal(full.gulf.plots[0].stage, 'ripe');
  assert.equal(full.gulf.plots[0].cropId, 'root');
  core.close();
});
test('eight-player commands, reconnect and save/restore retain crop species, growth and inventories', () => {
  let now = 10000;
  const runtime = {
    now: () => now,
    id: () => crypto.randomUUID(),
    token: () => crypto.randomUUID(),
  };
  const core = createGameCore({ runtime, playerLimit: 8 }),
    sockets = [];
  for (let i = 0; i < 8; i++) {
    const s = new Socket();
    core.connect(s, new URLSearchParams({ room: 'CROPS', resume: '1' }));
    sockets.push(s);
  }
  const r = core.rooms.get('CROPS'),
    ps = [...r.players.values()],
    p = ps[0],
    spec = FARM_PLOTS[0];
  assert.equal(ps.length, 8);
  assert.equal(r.gulf.plots.length, 48);
  at(p, spec);
  p.inventory.rootSeed = 2;
  p.inventory.water = 6;
  sockets[0].command({
    type: 'action',
    action: 'gulfPlant',
    targetId: spec.id,
    cropId: 'root',
    readyAt: 0,
  });
  now += 500;
  sockets[0].command({ type: 'action', action: 'gulfTend', targetId: spec.id, cropId: 'herb' });
  assert.equal(r.gulf.plots[0].cropId, 'root');
  assert.equal(r.gulf.plots[0].readyAt, now + 240000);
  const saved = core.exportState(),
    token = p.sessionToken;
  sockets[0].close();
  const rs = new Socket();
  core.connect(rs, new URLSearchParams({ room: 'CROPS', resume: '1', session: token }));
  assert.deepEqual(r.players.get(p.id).inventory, p.inventory);
  const restored = createGameCore({ runtime, playerLimit: 8 });
  restored.importState(saved);
  const s = new Socket();
  restored.connect(s, new URLSearchParams({ room: 'CROPS', resume: '1', session: token }));
  const rr = restored.rooms.get('CROPS'),
    rp = rr.players.get(p.id);
  assert.deepEqual(rp.inventory, p.inventory);
  assert.equal(rr.gulf.plots[0].cropId, 'root');
  now = rr.gulf.plots[0].readyAt + 1;
  restored.tick();
  assert.equal(rr.gulf.plots[0].stage, 'ripe');
  s.command({ type: 'action', action: 'gulfHarvest', targetId: spec.id, cropId: 'berry' });
  assert.equal(rp.inventory.rawRoot, 3);
  assert.equal(rp.inventory.berry, 0);
  const snapshot = restored.snapshot(rr, true);
  assert.ok(!JSON.stringify(snapshot).includes(token));
  core.close();
  restored.close();
});

test('invalid crop payloads do not become default berry planting, and nearby controls identify planted varieties', () => {
  for (const cropId of [{}, [], null, 1, 'x'.repeat(25)])
    assert.equal(
      decodeCommand(JSON.stringify({ type: 'action', action: 'gulfPlant', cropId })),
      null,
    );
  assert.equal(
    decodeCommand('{"type":"action","action":"gulfPlant","cropId":"root"}').cropId,
    'root',
  );
  const p = player(),
    r = room(p),
    spec = FARM_PLOTS[0];
  at(p, spec);
  assert.equal(gulfInteraction(r, p, collision).action, 'gulfOpen');
  assert.equal(gulfInteraction(r, p, collision).targetId, spec.id);
  r.gulf.plots[0].cropId = 'root';
  r.gulf.plots[0].stage = 'planted';
  assert.match(gulfInteraction(r, p, collision).label, /火根草.*水2/);
  at(p, MANY_HEARTHS);
  p.inventory.rawRoot = 1;
  assert.equal(huntInteraction(r, p, collision).action, 'cropFoodOpen');
});
