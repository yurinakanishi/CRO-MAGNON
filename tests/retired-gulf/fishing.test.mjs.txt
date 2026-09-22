import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createGameCore } from '../dist/application/game-core.mjs';
import { CollisionWorld } from '../dist/shared/collision.mjs';
import { FISHING, FISHING_SITES, createShoals } from '../dist/shared/fishing-sites.mjs';
import { handleFishingAction, updateFishing, cancelFishing } from '../dist/shared/fishing.mjs';
import { createGulfState, ensureGulfPlayer, handleGulfAction } from '../dist/shared/gulf-life.mjs';
import { MANY_HEARTHS, GULF_ENTRY } from '../dist/shared/gulf-region.mjs';
import {
  initializeBoats,
  handleBoatAction,
  BOATING,
  waterBodyFree,
  launchPoint,
} from '../dist/shared/boats.mjs';
import { handleHuntingAction, updateHunting } from '../dist/shared/hunting.mjs';
import { stopActor } from '../dist/shared/combat.mjs';
import { fishingInteraction } from '../dist/src/fishing-ui.js';

const collision = new CollisionWorld();
function player(id = 'p') {
  const p = {
    id,
    species: 'nea',
    radius: 0.32,
    ...FISHING_SITES[0].shore,
    energy: 50,
    inventory: { wood: 3, stone: 1, berry: 0, rawMeat: 0, cookedMeat: 0 },
    path: [],
  };
  ensureGulfPlayer(p);
  return p;
}
function room(...players) {
  const r = {
    players: new Map(players.map((p) => [p.id, p])),
    animals: [],
    enemies: [],
    collision,
    gulf: createGulfState(),
    camp: MANY_HEARTHS,
  };
  initializeBoats(r);
  return r;
}
const act = (r, p, action = 'fish', targetId = FISHING_SITES[0].id, now = 100000) =>
  handleFishingAction(r, p, { action, targetId, amount: 999, endsAt: 0 }, now);
const kit = (r, p) => assert.equal(act(r, p, 'craftFishingKit').changed, true);

test('all fishing grounds are actual water with clear shore approaches or boat routes', () => {
  const p = player(),
    r = room(p),
    launch = launchPoint(r, p);
  for (const site of FISHING_SITES) {
    assert.ok(waterBodyFree(site.x, site.z, BOATING.radius), site.id);
    if (site.shore) {
      assert.ok(collision.free(site.shore, p.radius), site.id);
      assert.ok(collision.path(GULF_ENTRY, site.shore, p.radius).length, site.id);
      assert.ok(r.shoreCollision.segmentFree(site.shore, site, 0.12), site.id);
      assert.ok(Math.hypot(site.x - site.shore.x, site.z - site.shore.z) <= FISHING.range);
    }
    const path = r.seaCollision.path(launch, site, BOATING.radius);
    assert.ok(path.length, site.id);
    let prev = launch;
    for (const next of path) {
      assert.ok(r.seaCollision.segmentFree(prev, next, BOATING.radius), site.id);
      prev = next;
    }
  }
});
test('kit costs once; target, timing and quantity come from server, with no automatic repeat', () => {
  const p = player(),
    r = room(p);
  assert.equal(act(r, p).changed, false);
  kit(r, p);
  assert.equal(p.inventory.wood, 0);
  assert.equal(p.inventory.stone, 0);
  assert.equal(act(r, p, 'craftFishingKit').changed, false);
  assert.equal(act(r, p, 'fish', 'missing').changed, false);
  assert.equal(act(r, p).changed, true);
  assert.equal(p.fishing.endsAt, 106000);
  assert.equal(act(r, p).changed, false);
  updateFishing(r, 105999);
  assert.equal(p.inventory.rawFish, 0);
  updateFishing(r, 106000);
  assert.equal(p.inventory.rawFish, 1);
  assert.equal(p.gulf.fishCaught, 1);
  assert.equal(p.fishing, null);
  updateFishing(r, 120000);
  assert.equal(p.inventory.rawFish, 1);
  assert.equal(r.gulf.shoals[0].amount, 5);
});
test('eight players contest the last shared fish without duplicate catches or negative stock', () => {
  const players = Array.from({ length: 8 }, (_, i) => player('p' + i)),
    r = room(...players);
  r.gulf.shoals[0].amount = 1;
  r.gulf.shoals[0].recoveredAt = 100000;
  for (const p of players) {
    kit(r, p);
    assert.equal(act(r, p).changed, true);
  }
  updateFishing(r, 106000);
  assert.equal(
    players.reduce((n, p) => n + p.inventory.rawFish, 0),
    1,
  );
  assert.equal(r.gulf.shoals[0].amount, 0);
  assert.ok(players.every((p) => !p.fishing));
  assert.equal(act(r, players[0]).changed, false);
  updateFishing(r, 144999);
  assert.equal(r.gulf.shoals[0].amount, 0);
  updateFishing(r, 145000);
  assert.equal(r.gulf.shoals[0].amount, 1);
  updateFishing(r, 1000000);
  assert.equal(r.gulf.shoals[0].amount, 6);
});
test('walking, boat movement, injury, defeat, blockers and range cancel without consuming stock', () => {
  const changes = [
    (p) => (p.dx = 1),
    (p) => (p.x += 0.3),
    (p) => (p.hurtSequence = 1),
    (p) => (p.downedUntil = 110000),
    (p) => (p.mountId = 'mammoth'),
  ];
  for (const change of changes) {
    const p = player(),
      r = room(p);
    kit(r, p);
    act(r, p);
    change(p);
    updateFishing(r, 106000);
    assert.equal(p.inventory.rawFish, 0);
    assert.equal(r.gulf.shoals[0].amount, 6);
    assert.equal(p.fishing, null);
  }
  const p = player(),
    r = room(p);
  kit(r, p);
  r.shoreCollision = { segmentFree: () => false };
  assert.equal(act(r, p).changed, false);
  r.shoreCollision = { segmentFree: () => true };
  act(r, p);
  r.shoreCollision = { segmentFree: () => false };
  updateFishing(r, 106000);
  assert.equal(p.inventory.rawFish, 0);
  p.x += 100;
  assert.equal(act(r, p).changed, false);
});
test('inventory limits and explicit cancellation preserve fish and reusable kit', () => {
  const p = player(),
    r = room(p);
  kit(r, p);
  p.inventory.rawFish = 99;
  assert.equal(act(r, p).changed, false);
  p.inventory.rawFish = 98;
  act(r, p);
  p.inventory.rawFish = 99;
  updateFishing(r, 106000);
  assert.equal(r.gulf.shoals[0].amount, 6);
  p.inventory.rawFish = 0;
  act(r, p);
  assert.equal(act(r, p, 'cancelFishing').changed, true);
  updateFishing(r, 106000);
  assert.equal(p.inventory.rawFish, 0);
  assert.equal(p.gulf.fishingKit, true);
});
test('stationary occupied canoes can fish; moving, disembarking and invalid occupancy cannot', () => {
  const p = player(),
    r = room(p);
  kit(r, p);
  p.inventory.wood = 12;
  assert.equal(handleBoatAction(r, p, { action: 'craftBoat' }, 100000).changed, true);
  assert.equal(handleBoatAction(r, p, { action: 'boardBoat' }, 100500).changed, true);
  const boat = r.boats[0];
  assert.equal(act(r, p).changed, true);
  updateFishing(r, 106000);
  assert.equal(p.inventory.rawFish, 1);
  boat.dx = 1;
  assert.equal(act(r, p).changed, false);
  stopActor(boat);
  act(r, p);
  boat.target = { x: boat.x + 20, z: boat.z };
  updateFishing(r, 106000);
  assert.equal(p.inventory.rawFish, 1);
  stopActor(boat);
  act(r, p);
  p.boatId = null;
  updateFishing(r, 106000);
  assert.equal(p.inventory.rawFish, 1);
  Object.assign(p, FISHING_SITES[5]);
  p.id = 'p';
  assert.equal(act(r, p, 'fish', FISHING_SITES[5].id).changed, false);
});
test('fish cooking retains raw food until completion, cancels safely, and never consumes meat', () => {
  const p = player(),
    r = room(p);
  Object.assign(p, { x: MANY_HEARTHS.x, z: MANY_HEARTHS.z + 2.4 });
  p.inventory.rawFish = 2;
  p.inventory.rawMeat = 3;
  assert.equal(handleHuntingAction(r, p, { action: 'cookFish' }, 100000).changed, true);
  updateHunting(r, 102999);
  assert.equal(p.inventory.rawFish, 2);
  updateHunting(r, 103000);
  assert.equal(p.inventory.cookedFish, 1);
  assert.equal(p.inventory.rawFish, 1);
  assert.equal(p.inventory.rawMeat, 3);
  handleHuntingAction(r, p, { action: 'cookFish' }, 104000);
  handleHuntingAction(r, p, { action: 'cancelCook' }, 104100);
  updateHunting(r, 107000);
  assert.equal(p.inventory.rawFish, 1);
  handleHuntingAction(r, p, { action: 'cookFish' }, 108000);
  r.collision = { segmentFree: () => false };
  updateHunting(r, 111000);
  assert.equal(p.inventory.rawFish, 1);
  r.collision = collision;
  handleHuntingAction(r, p, { action: 'cookFish' }, 112000);
  p.inventory.cookedFish = 99;
  updateHunting(r, 115000);
  assert.equal(p.inventory.rawFish, 1);
  p.inventory.cookedFish = 1;
  p.energy = 90;
  assert.equal(handleHuntingAction(r, p, { action: 'eatFish' }, 116000).changed, true);
  assert.equal(p.energy, 100);
  assert.equal(p.inventory.cookedFish, 0);
  assert.equal(handleHuntingAction(r, p, { action: 'eatFish' }, 117000).changed, false);
});
test('fish and berries both complete the food requirement, while distant or duplicate donations fail safely', () => {
  const p = player(),
    r = room(p);
  p.inventory.cookedFish = 4;
  const offer = () => handleGulfAction(r, p, { action: 'gulfOfferFish' }, 100000);
  assert.equal(offer().ok, false);
  assert.equal(p.inventory.cookedFish, 4);
  Object.assign(p, { x: MANY_HEARTHS.x, z: MANY_HEARTHS.z + 2.4 });
  r.gulf.stores = { wood: 0, berry: 9, obsidian: 0 };
  assert.equal(offer().ok, true);
  assert.equal(r.gulf.stores.berry, 12);
  assert.equal(offer().ok, false);
  assert.equal(p.inventory.cookedFish, 3);
  r.gulf.stores = { wood: 8, berry: 9, obsidian: 4 };
  assert.equal(offer().ok, true);
  assert.equal(r.gulf.festivals, 1);
  assert.equal(p.gulf.fishShared, 2);
  assert.deepEqual(r.gulf.stores, { wood: 0, berry: 0, obsidian: 0 });
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
test('core commands cancel fishing on travel, attack and disconnect; snapshots and saves preserve supplies only', () => {
  let now = 100000;
  const runtime = {
    now: () => now,
    id: () => crypto.randomUUID(),
    token: () => crypto.randomUUID(),
  };
  const core = createGameCore({ runtime }),
    s = new Socket();
  core.connect(s, new URLSearchParams({ room: 'FISH', resume: '1' }));
  const r = core.rooms.get('FISH'),
    p = [...r.players.values()][0];
  Object.assign(p, FISHING_SITES[0].shore);
  p.gulf.fishingKit = true;
  const cast = () => {
    now += 1000;
    s.command({
      type: 'action',
      action: 'fish',
      targetId: FISHING_SITES[0].id,
      amount: 99,
      endsAt: 0,
    });
    assert.ok(p.fishing);
  };
  cast();
  const actionAt = p.lastAction;
  s.command({ type: 'action', action: 'cancelFishing' });
  assert.equal(p.fishing, null, 'menu cancellation works before a state acknowledgement');
  assert.equal(p.lastAction, actionAt, 'a stop does not throttle the next menu action');
  cast();
  s.command({ type: 'move', dx: 1, dz: 0 });
  assert.equal(p.fishing, null);
  stopActor(p);
  cast();
  s.command({ type: 'target', x: p.x, z: p.z + 1 });
  assert.ok(p.fishing, 'retired target commands cannot interrupt an ongoing activity');
  s.command({ type: 'action', action: 'cancelFishing' });
  stopActor(p);
  cast();
  s.command({ type: 'action', action: 'attack' });
  assert.equal(p.fishing, null);
  now += 2000;
  core.tick();
  stopActor(p);
  cast();
  now += 6000;
  core.tick();
  assert.equal(p.inventory.rawFish, 1);
  assert.equal(r.gulf.shoals[0].amount, 5);
  cast();
  const token = p.sessionToken,
    saved = core.exportState(),
    publicState = core.snapshot(r, true);
  assert.deepEqual(Object.keys(publicState.players[0].fishing).sort(), [
    'endsAt',
    'spotId',
    'startedAt',
  ]);
  assert.ok(!JSON.stringify(publicState).includes(token));
  s.close();
  assert.equal(p.fishing, null);
  const again = new Socket();
  core.connect(again, new URLSearchParams({ room: 'FISH', resume: '1', session: token }));
  assert.equal([...r.players.values()][0].inventory.rawFish, 1);
  const restored = createGameCore({ runtime });
  restored.importState(saved);
  const rs = new Socket();
  restored.connect(rs, new URLSearchParams({ room: 'FISH', resume: '1', session: token }));
  const rr = restored.rooms.get('FISH'),
    rp = [...rr.players.values()][0];
  assert.equal(rp.fishing, null);
  assert.equal(rp.gulf.fishingKit, true);
  assert.equal(rp.inventory.rawFish, 1);
  assert.equal(rr.gulf.shoals[0].amount, 5);
  now += 6000;
  restored.tick();
  assert.equal(rp.inventory.rawFish, 1);
  const old = structuredClone(saved);
  for (const r of old.rooms) {
    delete r.gulf.shoals;
    for (const e of r.sessions) {
      delete e.player.inventory.rawFish;
      delete e.player.inventory.cookedFish;
      delete e.player.gulf.fishingKit;
      delete e.player.gulf.fishCaught;
      delete e.player.fishing;
    }
  }
  const migrated = createGameCore({ runtime });
  migrated.importState(old);
  const ms = new Socket();
  migrated.connect(ms, new URLSearchParams({ room: 'FISH', resume: '1', session: token }));
  const mr = migrated.rooms.get('FISH'),
    mp = [...mr.players.values()][0];
  assert.equal(mp.inventory.rawFish, 0);
  assert.equal(mp.gulf.fishingKit, false);
  assert.equal(mr.gulf.shoals.length, 7);
  core.close();
  restored.close();
  migrated.close();
});
test('shoal restoration clamps corrupt counts and UI offers fishing while aboard, with cancel taking priority', () => {
  const shoals = createShoals([
    { id: FISHING_SITES[0].id, amount: -10, recoveredAt: NaN },
    { id: FISHING_SITES[1].id, amount: 999, recoveredAt: 0 },
  ]);
  assert.equal(shoals[0].amount, 0);
  assert.equal(shoals[0].recoveredAt, 0);
  assert.equal(shoals[1].amount, 6);
  const p = player();
  p.gulf.fishingKit = true;
  p.boatId = 'boat-1';
  assert.equal(fishingInteraction(p).action, 'fish');
  p.fishing = { spotId: FISHING_SITES[0].id, endsAt: 106000 };
  assert.equal(fishingInteraction(p).action, 'cancelFishing');
  p.downedUntil = 120000;
  assert.equal(fishingInteraction(p), null);
});
