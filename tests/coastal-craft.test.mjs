import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createGameCore } from '../dist/application/game-core.mjs';
import { CollisionWorld } from '../dist/shared/collision.mjs';
import {
  COASTAL,
  SHELL_BEDS,
  MIDDEN_SITES,
  KNAPPING_SITES,
  createShellBeds,
  createMiddens,
} from '../dist/shared/coastal-sites.mjs';
import { handleCoastalAction, updateCoastal } from '../dist/shared/coastal-craft.mjs';
import { createGulfState, ensureGulfPlayer } from '../dist/shared/gulf-life.mjs';
import { handleHuntingAction, updateHunting } from '../dist/shared/hunting.mjs';
import { startAttack, resolveAttack, stopActor } from '../dist/shared/combat.mjs';
import { attackProfile } from '../dist/shared/combat-profiles.mjs';
import { MANY_HEARTHS, GULF_ENTRY } from '../dist/shared/gulf-region.mjs';
import { coastalInteraction } from '../dist/src/coastal-ui.js';
import { interactionVisible } from '../dist/shared/interactions.mjs';
import { activateMiddenObstacle, middenRadius } from '../dist/shared/coastal-sites.mjs';

const collision = new CollisionWorld();
const at = (p, s) => Object.assign(p, { x: s.x, z: s.z + 1.5 });
function player(id = 'p') {
  const p = {
    id,
    species: 'nea',
    gender: 'female',
    ...SHELL_BEDS[0],
    id,
    radius: 0.32,
    inventory: { wood: 3, stone: 1, obsidian: 4, berry: 0, rawMeat: 0, cookedMeat: 0 },
    energy: 50,
    path: [],
  };
  ensureGulfPlayer(p);
  return p;
}
const room = (...ps) => ({
  players: new Map(ps.map((p) => [p.id, p])),
  animals: [],
  enemies: [],
  gulf: createGulfState(),
  collision,
  camp: MANY_HEARTHS,
});
const act = (r, p, action = 'gatherShellfish', site = SHELL_BEDS[0], now = 100000) =>
  handleCoastalAction(
    r,
    p,
    { action, targetId: site.id, amount: 999, endsAt: 0, damage: 999 },
    now,
  );

test('all authored shell, midden and knapping approaches are walkable from the gathering camp', () => {
  for (const site of [...SHELL_BEDS, ...MIDDEN_SITES, ...KNAPPING_SITES]) {
    const approach = { x: site.x, z: site.z + 1.5 };
    assert.ok(collision.free(approach, 0.32), site.id);
    assert.ok(collision.path(GULF_ENTRY, approach, 0.32).length, site.id);
    assert.ok(interactionVisible(collision, approach, site), site.id);
  }
});
test('shellfish complete once, then cook, eat and produce one portable shell', () => {
  const p = player(),
    r = room(p);
  assert.equal(act(r, p).changed, true);
  updateCoastal(r, 102399);
  assert.equal(p.inventory.rawShellfish, 0);
  updateCoastal(r, 102400);
  updateCoastal(r, 105000);
  assert.equal(p.inventory.rawShellfish, 1);
  assert.equal(r.gulf.shellBeds[0].amount, 11);
  Object.assign(p, { x: MANY_HEARTHS.x, z: MANY_HEARTHS.z + 2 });
  assert.equal(handleHuntingAction(r, p, { action: 'cookShellfish' }, 105000).changed, true);
  updateHunting(r, 107999);
  assert.equal(p.inventory.rawShellfish, 1);
  updateHunting(r, 108000);
  assert.equal(p.inventory.rawShellfish, 0);
  assert.equal(p.inventory.cookedShellfish, 1);
  const before = p.energy;
  assert.equal(handleHuntingAction(r, p, { action: 'eatShellfish' }, 109000).changed, true);
  assert.equal(p.energy, before + 20);
  assert.equal(p.inventory.shells, 1);
  assert.equal(p.inventory.cookedShellfish, 0);
  at(p, MIDDEN_SITES[0]);
  assert.equal(act(r, p, 'depositShells', MIDDEN_SITES[0]).changed, true);
  assert.equal(r.gulf.middens[0].shells, 1);
  assert.equal(p.inventory.shells, 0);
  assert.equal(act(r, p, 'depositShells', MIDDEN_SITES[0]).changed, false);
});
test('eight players share the last shellfish without duplication; regeneration is bounded', () => {
  const ps = Array.from({ length: 8 }, (_, i) => player('p' + i)),
    r = room(...ps);
  r.gulf.shellBeds[0].amount = 1;
  r.gulf.shellBeds[0].recoveredAt = 100000;
  for (const p of ps) assert.equal(act(r, p).changed, true);
  updateCoastal(r, 102400);
  assert.equal(
    ps.reduce((n, p) => n + p.inventory.rawShellfish, 0),
    1,
  );
  updateCoastal(r, 159999);
  assert.equal(r.gulf.shellBeds[0].amount, 0);
  updateCoastal(r, 160000);
  assert.equal(r.gulf.shellBeds[0].amount, 1);
  updateCoastal(r, 9999999);
  assert.equal(r.gulf.shellBeds[0].amount, 12);
});
test('range, walls, movement, injury, transport and busy states reject or cancel work without costs', () => {
  for (const change of [
    (p) => (p.x += 0.3),
    (p) => (p.dx = 1),
    (p) => (p.hurtSequence = 1),
    (p) => (p.boatId = 'b'),
    (p) => (p.mountId = 'm'),
    (p) => (p.downedUntil = 150000),
  ]) {
    const p = player(),
      r = room(p);
    at(p, KNAPPING_SITES[0]);
    assert.equal(act(r, p, 'knapObsidian', KNAPPING_SITES[0]).changed, true);
    change(p);
    updateCoastal(r, 104000);
    assert.equal(p.inventory.obsidian, 4);
    assert.equal(p.inventory.obsidianBlade, 0);
    assert.equal(p.coastalActivity, null);
  }
  const p = player(),
    r = room(p);
  p.x += 20;
  assert.equal(act(r, p).changed, false);
  at(p, SHELL_BEDS[0]);
  r.collision = { segmentFree: () => false };
  assert.equal(act(r, p).changed, false);
  r.collision = collision;
  p.fishing = {};
  assert.equal(act(r, p).changed, false);
  p.fishing = null;
  assert.equal(act(r, p).changed, true);
  assert.equal(act(r, p).changed, false);
  r.collision = { segmentFree: () => false };
  updateCoastal(r, 102400);
  assert.equal(p.inventory.rawShellfish, 0);
});
test('full shell and food inventories never lose food or consume unavailable outputs', () => {
  const p = player(),
    r = room(p);
  p.inventory.rawShellfish = 99;
  assert.equal(act(r, p).changed, false);
  p.inventory.rawShellfish = 98;
  act(r, p);
  p.inventory.rawShellfish = 99;
  updateCoastal(r, 102400);
  assert.equal(r.gulf.shellBeds[0].amount, 12);
  p.inventory.cookedShellfish = 1;
  p.inventory.shells = 99;
  assert.equal(handleHuntingAction(r, p, { action: 'eatShellfish' }, 105000).changed, false);
  assert.equal(p.inventory.cookedShellfish, 1);
  assert.equal(p.energy, 50);
  at(p, MIDDEN_SITES[0]);
  r.gulf.middens[0].shells = COASTAL.maxMidden - 1;
  act(r, p, 'depositShells', MIDDEN_SITES[0]);
  assert.equal(p.inventory.shells, 98);
  assert.equal(r.gulf.middens[0].shells, COASTAL.maxMidden);
  assert.equal(act(r, p, 'depositShells', MIDDEN_SITES[0]).changed, false);
});
test('obsidian must be knapped before hafting; reusable hammer and consumed materials are exact', () => {
  const p = player(),
    r = room(p);
  at(p, KNAPPING_SITES[0]);
  assert.equal(p.spearHead, 'wood');
  assert.equal(attackProfile(p).damage, 15);
  assert.equal(act(r, p, 'haftSpear', KNAPPING_SITES[0]).changed, false);
  assert.equal(act(r, p, 'knapObsidian', KNAPPING_SITES[0]).changed, true);
  updateCoastal(r, 103999);
  assert.equal(p.inventory.obsidianBlade, 0);
  updateCoastal(r, 104000);
  assert.equal(p.inventory.obsidianBlade, 1);
  assert.equal(p.inventory.obsidian, 2);
  assert.equal(p.inventory.stone, 1);
  assert.equal(act(r, p, 'haftSpear', KNAPPING_SITES[0], 105000).changed, true);
  assert.equal(p.spearHead, 'obsidian');
  assert.equal(attackProfile(p).damage, 30);
  assert.equal(p.inventory.obsidianBlade, 0);
  assert.equal(p.inventory.wood, 2);
  assert.equal(act(r, p, 'haftSpear', KNAPPING_SITES[0], 106000).changed, false);
  assert.equal(p.inventory.wood, 2);
});
test('knapping completion rechecks materials and capacity, with no lost original stone on cancellation', () => {
  for (const change of [
    (p) => (p.inventory.obsidian = 1),
    (p) => (p.inventory.stone = 0),
    (p) => (p.inventory.obsidianBlade = 99),
  ]) {
    const p = player(),
      r = room(p);
    at(p, KNAPPING_SITES[0]);
    act(r, p, 'knapObsidian', KNAPPING_SITES[0]);
    change(p);
    const before = structuredClone(p.inventory);
    updateCoastal(r, 104000);
    assert.deepEqual(p.inventory, before);
  }
});
test('human species use bare wood; special characters keep their weapons and cannot consume blades for spears', () => {
  for (const species of ['cro', 'nea'])
    for (const gender of ['female', 'male'])
      assert.equal(attackProfile({ species, gender }).modelKey, 'wooden-spear');
  for (const [species, kind] of [
    ['cat', 'katana'],
    ['bear', 'magic'],
  ]) {
    const p = player(),
      r = room(p);
    at(p, KNAPPING_SITES[0]);
    p.species = species;
    p.inventory.obsidianBlade = 1;
    assert.equal(act(r, p, 'haftSpear', KNAPPING_SITES[0]).changed, false);
    assert.equal(p.inventory.obsidianBlade, 1);
    assert.equal(attackProfile(p).key, kind);
  }
});
test('damage is frozen at the accepted strike, rather than changing when equipment changes', () => {
  const p = player(),
    r = room(p);
  p.facing = 0;
  const a = { id: 'a', x: p.x, z: p.z + 2, radius: 1, health: 100, maxHealth: 100, phase: 'alive' };
  r.animals = [a];
  assert.equal(startAttack(r, p, {}, 100000).accepted, true);
  p.spearHead = 'obsidian';
  resolveAttack(r, p, 100333);
  assert.equal(a.health, 85);
  startAttack(r, p, {}, 101000);
  resolveAttack(r, p, 101333);
  assert.equal(a.health, 55);
});
class Socket extends EventEmitter {
  readyState = 1;
  messages = [];
  send(v) {
    this.messages.push(JSON.parse(v));
  }
  close() {
    this.readyState = 3;
    this.emit('close');
  }
  ping() {}
  terminate() {
    this.close();
  }
  command(v) {
    this.emit('message', Buffer.from(JSON.stringify(v)), false);
  }
}
test('core ignores forged gear; cancel-before-ack, travel, attack, reconnect and export/import are safe', () => {
  let now = 100000;
  const runtime = {
    now: () => now,
    id: () => crypto.randomUUID(),
    token: () => crypto.randomUUID(),
  };
  const core = createGameCore({ runtime }),
    s = new Socket();
  core.connect(
    s,
    new URLSearchParams({ room: 'CRAFT', resume: '1', spearHead: 'obsidian', damage: '999' }),
  );
  const r = core.rooms.get('CRAFT'),
    p = [...r.players.values()][0];
  assert.equal(p.spearHead, 'wood');
  at(p, KNAPPING_SITES[0]);
  Object.assign(p.inventory, { obsidian: 4, stone: 1, wood: 1 });
  const start = () => {
    now += 1000;
    s.command({ type: 'action', action: 'knapObsidian', targetId: KNAPPING_SITES[0].id });
    assert.ok(p.coastalActivity);
  };
  start();
  const actionAt = p.lastAction;
  s.command({ type: 'action', action: 'cancelCoastal' });
  assert.equal(p.coastalActivity, null);
  assert.equal(p.lastAction, actionAt);
  start();
  s.command({ type: 'move', dx: 1, dz: 0 });
  assert.equal(p.coastalActivity, null);
  stopActor(p);
  start();
  s.command({ type: 'action', action: 'attack' });
  assert.equal(p.coastalActivity, null);
  now += 2000;
  core.tick();
  stopActor(p);
  start();
  now += 4000;
  core.tick();
  assert.equal(p.inventory.obsidianBlade, 1);
  now += 500;
  s.command({ type: 'action', action: 'haftSpear', targetId: KNAPPING_SITES[0].id });
  assert.equal(p.spearHead, 'obsidian');
  p.inventory.shells = 3;
  r.gulf.middens[0].shells = 12;
  r.gulf.shellBeds[0].amount = 3;
  start();
  const token = p.sessionToken,
    saved = core.exportState(),
    pub = core.snapshot(r, true);
  assert.deepEqual(Object.keys(pub.players[0].coastalActivity).sort(), [
    'endsAt',
    'kind',
    'siteId',
    'startedAt',
  ]);
  s.close();
  assert.equal(p.coastalActivity, null);
  const restored = createGameCore({ runtime });
  restored.importState(saved);
  const rs = new Socket();
  restored.connect(rs, new URLSearchParams({ room: 'CRAFT', resume: '1', session: token }));
  const rr = restored.rooms.get('CRAFT'),
    rp = [...rr.players.values()][0];
  assert.equal(rp.coastalActivity, null);
  assert.equal(rp.spearHead, 'obsidian');
  assert.equal(rp.inventory.shells, 3);
  assert.equal(rr.gulf.middens[0].shells, 12);
  assert.equal(rr.gulf.shellBeds[0].amount, 3);
  now += 4000;
  restored.tick();
  assert.equal(rp.inventory.obsidianBlade, 0, 'unfinished knapping never completes on restore');
  const old = structuredClone(saved);
  for (const record of old.rooms) {
    delete record.gulf.shellBeds;
    delete record.gulf.middens;
    for (const e of record.sessions) {
      delete e.player.spearHead;
      delete e.player.coastalActivity;
      for (const k of ['shells', 'rawShellfish', 'cookedShellfish', 'obsidianBlade'])
        delete e.player.inventory[k];
    }
  }
  const migrated = createGameCore({ runtime });
  migrated.importState(old);
  const mp = migrated.rooms.get('CRAFT').sessions.get(token).player;
  assert.equal(mp.spearHead, 'wood');
  assert.equal(mp.inventory.shells, 0);
  assert.equal(mp.inventory.obsidian, 2);
  core.close();
  restored.close();
  migrated.close();
});
test('saved stocks are sanitized and nearby interaction offers shell gathering, midden donation and cancelling', () => {
  assert.equal(
    createShellBeds([{ id: SHELL_BEDS[0].id, amount: -1, recoveredAt: NaN }])[0].amount,
    0,
  );
  assert.equal(createMiddens([{ id: MIDDEN_SITES[0].id, shells: Infinity }])[0].shells, 0);
  const p = player(),
    r = room(p);
  assert.equal(coastalInteraction(r, p, collision).action, 'gatherShellfish');
  p.coastalActivity = {};
  assert.equal(coastalInteraction(r, p, collision).action, 'cancelCoastal');
  p.coastalActivity = null;
  at(p, MIDDEN_SITES[0]);
  p.inventory.shells = 1;
  assert.equal(coastalInteraction(r, p, collision).action, 'depositShells');
});
test('midden growth waits for a clear footprint and collision follows the shared stage', () => {
  const p = player(),
    other = player('other'),
    r = room(p, other),
    site = MIDDEN_SITES[0];
  at(p, site);
  p.inventory.shells = 40;
  Object.assign(other, { x: site.x, z: site.z });
  assert.equal(act(r, p, 'depositShells', site).changed, false);
  assert.equal(p.inventory.shells, 40);
  other.z += 3;
  assert.equal(act(r, p, 'depositShells', site).changed, true);
  const c = new CollisionWorld(undefined, {
    active: (o) => (o.middenId ? activateMiddenObstacle(o, r.gulf) : true),
  });
  assert.equal(c.free(site, 0.32), false);
  assert.equal(c.free({ x: site.x, z: site.z + 1 }, 0.32), true);
  r.gulf.middens[0].shells = 11;
  other.z = site.z + 0.7;
  assert.equal(
    act(r, p, 'depositShells', site).changed,
    false,
    'a growth stage cannot engulf another actor',
  );
  other.z += 3;
  assert.equal(act(r, p, 'depositShells', site).changed, true);
  assert.equal(c.free({ x: site.x, z: site.z + 1 }, 0.32), false);
  assert.ok(middenRadius(r.gulf.middens[0].shells) > 0.6);
});
