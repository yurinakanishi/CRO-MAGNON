import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CollisionWorld } from '../dist/shared/collision.mjs';
import {
  startAttack,
  resolveAttack,
  updateProjectiles,
  shoveablePlayers,
} from '../dist/shared/combat.mjs';
import { attackProfile, ATTACK_PROFILES } from '../dist/shared/combat-profiles.mjs';
import { handleHuntingAction, updateHunting } from '../dist/shared/hunting.mjs';
import { createCompanion } from '../dist/shared/companions.mjs';
import {
  KNOCKBACK,
  knockBack,
  knockbackLead,
  knockbackProgress,
  stepKnockback,
} from '../dist/shared/knockback.mjs';
import { DEFAULT_RULES, EXHIBITION_RULES } from '../dist/shared/room-rules.mjs';
import { WORLD } from '../dist/shared/world.mjs';
import { caveWorldAt } from '../dist/shared/camp-cave-layout.mjs';
import { caveInteriorWeight } from '../dist/shared/cave-light.mjs';
import { createGameCore } from '../dist/application/game-core.mjs';
import { LocalPrediction } from '../dist/src/local-prediction.js';
import { applyKnockbackTilt, knockbackTilt } from '../dist/src/knockback-tilt.js';
import { FoleyEvents, KNOCKBACK_SOUND_RANGE } from '../dist/src/nature-foley.js';

const near = (actual, expected, tolerance = 1e-6, label = '') =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label} ${actual} ≉ ${expected}`);
const person = (id, x, z, extra = {}) => ({
  id,
  name: id,
  species: 'cro',
  gender: 'female',
  x,
  z,
  radius: 0.32,
  facing: 0,
  energy: 70,
  attackSequence: 0,
  attackAt: 0,
  cookingEndsAt: 0,
  hurtSequence: 0,
  warpSequence: 0,
  inventory: { rawMeat: 0, cookedMeat: 0 },
  ...extra,
});
function scene(obstacles = []) {
  const attacker = person('attacker', 20, 20),
    victim = person('victim', 20, 21.4);
  const room = {
    players: new Map([
      [attacker.id, attacker],
      [victim.id, victim],
    ]),
    animals: [],
    enemies: [],
    collision: new CollisionWorld(obstacles, { river: false }),
    camp: { x: 0, z: 0 },
  };
  const move = (body, dx, dz) => room.collision.move(body, dx, dz, body.radius);
  /** Run the slide to its end at 50 ms server ticks; returns the positions seen. */
  const slide = (body, from = body.knockbackAt) => {
    const seen = [];
    for (let t = from; t <= from + KNOCKBACK.staggerMs + 50; t += 50) {
      stepKnockback(body, t, move);
      seen.push({ t, x: body.x, z: body.z });
    }
    return seen;
  };
  return { room, attacker, victim, move, slide };
}
function swing(room, attacker, now = 1000) {
  assert.equal(startAttack(room, attacker, {}, now).accepted, true);
  return resolveAttack(room, attacker, now + attackProfile(attacker).impactMs);
}

test('the slide curve starts fast, settles exactly at the end of the stagger and never runs backwards', () => {
  // A human-sized body is the full-distance reference.
  assert.equal(KNOCKBACK.referenceRadius, WORLD.playerRadius);
  assert.equal(knockbackProgress(-5), 0);
  assert.equal(knockbackProgress(0), 0);
  assert.equal(knockbackProgress(KNOCKBACK.staggerMs), 1);
  assert.equal(knockbackProgress(KNOCKBACK.staggerMs * 4), 1);
  let previous = 0;
  for (let t = 10; t <= KNOCKBACK.staggerMs; t += 10) {
    const p = knockbackProgress(t);
    assert.ok(p > previous && p <= 1, `${t} ms`);
    previous = p;
  }
  // Most of the distance is covered in the first 100 ms: it reads as a blow.
  assert.ok(knockbackProgress(100) > 0.55);
  assert.ok(
    knockbackProgress(50) - knockbackProgress(0) > knockbackProgress(450) - knockbackProgress(400),
  );
});

test('a spear blow slides the other player straight away from the attacker and costs no energy', () => {
  const { room, attacker, victim, slide } = scene();
  const result = swing(room, attacker);
  assert.equal(result.hit, true);
  assert.equal(result.kind, 'player');
  assert.equal(result.target, victim);
  assert.equal(result.knockedBack, true);
  assert.equal(victim.energy, 70);
  assert.equal(victim.hurtSequence, 0);
  assert.equal(victim.health, undefined);
  assert.equal(victim.knockbackSequence, 1);
  assert.equal(victim.knockbackAt, 1000 + ATTACK_PROFILES.spear.impactMs);
  near(victim.knockbackDistance, ATTACK_PROFILES.spear.knockback);
  near(victim.knockbackX, 0);
  near(victim.knockbackZ, 1);
  const seen = slide(victim);
  // Away from the attacker, monotonically, and the whole distance in open ground.
  for (let i = 1; i < seen.length; i++) assert.ok(seen[i].z >= seen[i - 1].z);
  near(victim.x, 20);
  near(victim.z, 21.4 + ATTACK_PROFILES.spear.knockback, 1e-9);
  assert.equal(victim.knockbackDone, 1);
  assert.equal(
    stepKnockback(victim, victim.knockbackAt + 5000, () => assert.fail('moved')),
    false,
  );
  // Attacker side: an ordinary swing (it pays its own energy as always).
  assert.equal(attacker.energy, 70 - ATTACK_PROFILES.spear.energy);
});

test('an off-centre player is driven radially; the nearest of creatures and players takes the blow', () => {
  const { room, attacker, victim } = scene();
  Object.assign(victim, { x: 20.8, z: 21.2 });
  swing(room, attacker);
  const length = Math.hypot(0.8, 1.2);
  near(victim.knockbackX, 0.8 / length);
  near(victim.knockbackZ, 1.2 / length);

  const second = scene();
  const mammoth = {
    id: 'm',
    x: 20,
    z: 21.1,
    radius: 0.5,
    phase: 'alive',
    health: 100,
    maxHealth: 100,
  };
  second.room.animals.push(mammoth);
  assert.equal(swing(second.room, second.attacker).target, mammoth);
  assert.equal(second.victim.knockbackSequence, undefined);
  mammoth.z = 22.4;
  assert.equal(swing(second.room, second.attacker, 3000).target, second.victim);
  assert.equal(mammoth.health, 100 - ATTACK_PROFILES.spear.damage);
});

test('a light orb hits the first player in its path, slides it along the flight and is spent', () => {
  const { room, attacker, victim, slide } = scene();
  Object.assign(attacker, { species: 'bear', radius: 0.32 });
  victim.z = 23;
  const crow = {
    id: 'crow',
    x: 20,
    z: 25,
    radius: 0.4,
    health: 75,
    maxHealth: 75,
    hostile: true,
    phase: 'alive',
    name: '呪術師',
  };
  room.enemies.push(crow);
  assert.equal(startAttack(room, attacker, {}, 1000).accepted, true);
  const impact = 1000 + ATTACK_PROFILES.magic.impactMs;
  assert.equal(resolveAttack(room, attacker, impact).launched, true);
  const hits = updateProjectiles(room, impact + 1000);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].target, victim);
  assert.equal(hits[0].knockedBack, true);
  assert.equal(room.projectiles.length, 0);
  assert.equal(room.projectileImpacts[0].hit, true);
  assert.equal(crow.health, 75);
  assert.equal(victim.energy, 70);
  near(victim.knockbackDistance, ATTACK_PROFILES.magic.knockback);
  slide(victim);
  near(victim.z, 23 + ATTACK_PROFILES.magic.knockback, 1e-9);
});

for (const species of ['cro', 'bear']) {
  test(`${species} attacks preserve companion recoil and player knockback in the same room`, () => {
    const { room, attacker, victim } = scene();
    attacker.species = species;
    victim.z = 21.8;
    const cat = createCompanion('rimo-neko', 'victim-cat', victim, { x: 20, z: 20.9 });
    room.companions = [cat];
    const notices = [];
    const attack = (now) => {
      assert.equal(startAttack(room, attacker, {}, now).accepted, true);
      updateHunting(room, now + attackProfile(attacker).impactMs + 500, (...args) =>
        notices.push(args),
      );
    };
    attack(1000);
    assert.equal(cat.hitSequence, 1);
    assert.equal(cat.ownerId, victim.id);
    assert.equal(cat.health, undefined);
    assert.equal(cat.knockbackSequence, undefined);
    assert.equal(victim.knockbackSequence, undefined);
    assert.ok(notices.some(([, text]) => text.includes('りもねこ')));

    cat.z = 26;
    notices.length = 0;
    attack(1000 + attackProfile(attacker).cooldownMs + 1000);
    assert.equal(victim.knockbackSequence, 1);
    assert.equal(victim.energy, 70);
    assert.equal(victim.hurtSequence, 0);
    assert.equal(cat.hitSequence, 1);
    assert.equal(cat.ownerId, victim.id);
    assert.equal(notices.length, 2);
    assert.ok(notices.every(([, , tone, popup]) => tone === 'info' && popup === false));
  });
}

test('walls and other bodies stop a slide where the walking collision would', () => {
  const wall = { id: 'wall', type: 'box', x: 20, z: 22.4, hx: 2, hz: 0.1, c: 1, s: 0, height: 2 };
  const { room, attacker, victim, slide } = scene([wall]);
  swing(room, attacker);
  slide(victim);
  assert.ok(victim.z < 22.4 - 0.1 - victim.radius + 1e-6, `${victim.z}`);
  assert.ok(victim.z > 21.4 + 0.5);
  assert.ok(room.collision.free(victim, victim.radius));
});

test('a broad body slides less: the ape about half as far, the octopus a little more', () => {
  for (const [species, radius, scale] of [
    ['ape', 0.76, 0.5],
    ['maruimo', 0.6, 0.32 / 0.6],
    ['cat', 0.32, 1],
  ]) {
    const { room, attacker, victim, slide } = scene();
    Object.assign(victim, { species, gender: species === 'cat' ? 'female' : 'male', radius });
    victim.z = 20 + attacker.radius + radius + 0.5;
    const start = victim.z;
    swing(room, attacker);
    slide(victim);
    near(victim.z - start, ATTACK_PROFILES.spear.knockback * scale, 1e-9, species);
  }
});

test('riders, passengers, the downed, the protected, cave visitors and a shoulder caster’s carrier are out of reach', () => {
  const now = 5000;
  const cave = caveWorldAt(-8);
  for (const [label, change] of [
    ['downed', { downedUntil: now + 4000 }],
    ['protected', { invulnerableUntil: now + 1000 }],
    ['mounted', { mountId: 'mammoth-1' }],
    ['aboard', { boatId: 'boat-1' }],
    ['carried', { carrierId: 'someone' }],
    ['in the cave', { x: cave.x, z: cave.z }],
  ]) {
    const { room, attacker, victim } = scene();
    Object.assign(victim, change);
    assert.deepEqual(shoveablePlayers(room, attacker, now), [], label);
  }
  const { room, attacker, victim } = scene();
  assert.deepEqual(
    shoveablePlayers(room, attacker, now).map(({ target, kind }) => [target.id, kind]),
    [['victim', 'player']],
  );
  // A mage on the ape's shoulder: its orb starts at the ape's centre and must not hit it.
  attacker.carrierId = victim.id;
  assert.deepEqual(shoveablePlayers(room, attacker, now), []);
  // Recovery protection ends; the player can be shoved again.
  delete attacker.carrierId;
  victim.invulnerableUntil = now;
  assert.equal(shoveablePlayers(room, attacker, now).length, 1);
});

test('the finished exhibition rules keep players out of each other’s blows', () => {
  const { room, attacker, victim } = scene();
  room.rules = EXHIBITION_RULES;
  assert.equal(EXHIBITION_RULES.playerKnockback, false);
  assert.equal(DEFAULT_RULES.playerKnockback, true);
  assert.deepEqual(swing(room, attacker), { hit: false });
  assert.equal(victim.knockbackSequence, undefined);
});

test('a sliding player absorbs further blows instead of being chained; cooking stops, food stays', () => {
  const { room, attacker, victim, move } = scene();
  const third = person('third', 20, 24.5, { facing: Math.PI });
  room.players.set(third.id, third);
  victim.inventory.rawMeat = 1;
  victim.cookingEndsAt = 99999;
  const first = swing(room, attacker);
  assert.equal(first.knockedBack, true);
  assert.equal(victim.cookingEndsAt, 0);
  assert.equal(victim.inventory.rawMeat, 1);
  const at = victim.knockbackAt;
  stepKnockback(victim, at + 50, move);
  // A second blow lands while the victim still slides (the cooldown is set aside here).
  attacker.attackAt = 0;
  attacker.attackSequence = 0;
  const second = swing(room, attacker, at + 50 - ATTACK_PROFILES.spear.impactMs);
  assert.equal(second.hit, true);
  assert.equal(second.target, victim);
  assert.equal(second.knockedBack, false);
  assert.equal(victim.knockbackSequence, 1);
  assert.equal(victim.knockbackAt, at);
  near(victim.knockbackZ, 1);
  // Once the slide has settled, the third player's blow lands and drives it back.
  stepKnockback(victim, at + KNOCKBACK.staggerMs, move);
  near(victim.z, 21.4 + ATTACK_PROFILES.spear.knockback, 1e-9);
  const third_ = swing(room, third, at + KNOCKBACK.staggerMs);
  assert.equal(third_.target, victim);
  assert.equal(third_.knockedBack, true);
  assert.equal(victim.knockbackSequence, 2);
  near(victim.knockbackZ, -1);
});

test('riding, being carried, being downed or warping ends a slide where it is', () => {
  for (const change of [
    { mountId: 'm' },
    { boatId: 'b' },
    { carrierId: 'c' },
    { downedUntil: 9000 },
    { warpSequence: 1 },
  ]) {
    const { room, attacker, victim, move } = scene();
    swing(room, attacker);
    stepKnockback(victim, victim.knockbackAt + 50, move);
    const z = victim.z;
    Object.assign(victim, change);
    assert.equal(stepKnockback(victim, victim.knockbackAt + 100, move), false);
    assert.equal(victim.z, z);
    assert.equal(victim.knockbackDone, 1);
  }
});

test('the lead continues a slide between snapshots and stops at the settled position', () => {
  const body = { x: 0, z: 0, radius: 0.32, warpSequence: 0 };
  knockBack(body, 1, 0, 2, 1000);
  assert.equal(knockbackLead(body, 1000), null);
  stepKnockback(body, 1050, (b, dx, dz) => ({ x: b.x + dx, z: b.z + dz }));
  const lead = knockbackLead(body, 1100);
  near(lead.x, 2 * (knockbackProgress(100) - knockbackProgress(50)));
  near(lead.z, 0);
  near(body.x + lead.x, 2 * knockbackProgress(100));
  body.knockbackDone = 1;
  assert.equal(knockbackLead(body, 1100), null);
});

class Socket {
  readyState = 1;
  bufferedAmount = 0;
  handlers = {};
  messages = [];
  on(name, fn) {
    this.handlers[name] = fn;
  }
  send(data) {
    this.messages.push(JSON.parse(data));
  }
  ping() {}
  terminate() {}
  close() {
    this.readyState = 3;
    this.handlers.close?.();
  }
  command(message) {
    this.handlers.message({ toString: () => JSON.stringify(message) }, false);
  }
}

/** Two players in a real game core on an open stretch away from the camp's companions. */
function server(speciesA = 'cro', speciesB = 'cro') {
  let now = 200000,
    id = 0;
  const runtime = { now: () => now, id: () => `kb-${++id}`, token: () => `token-${++id}` };
  const core = createGameCore({ runtime, keepEmptyRooms: true });
  const join = (name, species) => {
    const socket = new Socket();
    core.connect(socket, new URLSearchParams({ room: 'SHOVE', name, species, resume: '1' }));
    const welcome = socket.messages.find((m) => m.type === 'welcome');
    return { socket, player: core.rooms.get('SHOVE').players.get(welcome.id) };
  };
  const a = join('Ayu', speciesA),
    b = join('Bino', speciesB);
  const room = core.rooms.get('SHOVE');
  room.enemies = [];
  room.animals = [];
  room.residents = [];
  room.collision = new CollisionWorld([], { river: false });
  Object.assign(a.player, { x: 30, z: 30, facing: 0 });
  Object.assign(b.player, { x: 30, z: 31.4, facing: Math.PI });
  return {
    core,
    room,
    a,
    b,
    now: () => now,
    tick: (ms = 50) => {
      now += ms;
      core.tick();
    },
  };
}

test('in the game server a blow slides the other player, holds its steering, then steering resumes', () => {
  const f = server();
  const victim = f.b.player;
  const energy = victim.energy;
  f.a.socket.command({ type: 'action', action: 'attack' });
  let ticks = 0;
  while (!victim.knockbackSequence && ticks++ < 20) f.tick();
  assert.equal(victim.knockbackSequence, 1);
  const at = victim.knockbackAt,
    start = victim.z;
  // The victim keeps pushing toward the attacker; the slide wins until it settles.
  const track = [];
  while (f.now() + 50 < at + KNOCKBACK.staggerMs) {
    f.b.socket.command({ type: 'move', dx: 0, dz: -1, running: true });
    f.tick();
    track.push({ t: f.now() - at, z: victim.z, moving: victim.moving });
  }
  assert.equal(track.length, KNOCKBACK.staggerMs / 50 - 1);
  for (let i = 1; i < track.length; i++) assert.ok(track[i].z > track[i - 1].z, `${track[i].t} ms`);
  assert.ok(track.every((step) => !step.moving));
  assert.ok(victim.z - start > 0.9 * ATTACK_PROFILES.spear.knockback);
  // The last tick settles the slide; the stick is released first to measure the spot.
  f.b.socket.command({ type: 'move', dx: 0, dz: 0, running: false });
  f.tick();
  near(victim.z - start, ATTACK_PROFILES.spear.knockback, 1e-9);
  near(victim.x, 30, 1e-9);
  assert.equal(victim.energy, energy);
  assert.equal(victim.hurtSequence, 0);
  assert.equal(victim.downedUntil, 0);
  // Steering again: the next ticks walk back toward the attacker.
  const settled = victim.z;
  f.b.socket.command({ type: 'move', dx: 0, dz: -1, running: false });
  f.tick();
  f.b.socket.command({ type: 'move', dx: 0, dz: -1, running: false });
  f.tick();
  assert.ok(victim.z < settled - 0.1, `${victim.z} after ${settled}`);
  // Quiet notices on both sides; nothing pops up.
  const notice = (socket, text) =>
    socket.messages.find((m) => m.type === 'notice' && m.text.includes(text));
  assert.equal(notice(f.a.socket, 'Binoを押し返した').popup, false);
  assert.equal(notice(f.b.socket, 'Ayuに押し返された').popup, false);
  // Every client sees the slide; the warp bookkeeping stays private.
  const state = f.a.socket.messages.findLast((m) => m.type === 'state');
  const seen = state.players.find((p) => p.id === victim.id);
  assert.equal(seen.knockbackSequence, 1);
  assert.equal(seen.knockbackAt, at);
  near(seen.knockbackDistance, ATTACK_PROFILES.spear.knockback);
  assert.equal(seen.knockbackDone, 1);
  assert.equal('knockbackWarp' in seen, false);
  // A player who has never been knocked back sends none of it.
  const other = state.players.find((p) => p.id === f.a.player.id);
  assert.deepEqual(
    Object.keys(other).filter((key) => key.startsWith('knockback')),
    [],
  );
  // A slide is not saved: sessions restore standing still.
  const saved = JSON.stringify(f.core.exportState());
  assert.equal(/knockback/.test(saved), false);
});

test('in the game server a shoulder mage’s orb never shoves its own ape', () => {
  const f = server('ape', 'bear');
  const ape = f.a.player,
    mage = f.b.player;
  Object.assign(ape, { passengerId: mage.id, carryHurtSequence: 0, facing: 0 });
  Object.assign(mage, { carrierId: ape.id, carryHurtSequence: 0 });
  f.b.socket.command({ type: 'action', action: 'attack' });
  assert.equal(mage.attackSequence, 1);
  let launched = false;
  for (let i = 0; i < 40; i++) {
    f.tick();
    launched ||= f.room.projectiles.some((p) => p.ownerId === mage.id);
  }
  assert.ok(launched);
  assert.equal(ape.passengerId, mage.id);
  assert.equal(ape.knockbackSequence ?? 0, 0);
});

test('in the game server a player just inside the cave is out of reach from its mouth', () => {
  const f = server();
  let inside = null;
  for (let depth = 11; depth > -10 && !inside; depth -= 0.05)
    if (caveInteriorWeight(caveWorldAt(depth)) > 0) inside = depth;
  assert.ok(inside !== null);
  const victim = caveWorldAt(inside - 0.2),
    attacker = caveWorldAt(inside + 1.2);
  assert.equal(caveInteriorWeight(attacker), 0);
  Object.assign(f.b.player, victim);
  Object.assign(f.a.player, attacker, {
    facing: Math.atan2(victim.x - attacker.x, victim.z - attacker.z),
  });
  f.a.socket.command({ type: 'action', action: 'attack' });
  assert.equal(f.a.player.attackSequence, 1);
  for (let i = 0; i < 20; i++) f.tick();
  assert.equal(f.b.player.knockbackSequence ?? 0, 0);
  // The same two outside the cave: the blow lands.
  Object.assign(f.b.player, { x: 30, z: 31.4 });
  Object.assign(f.a.player, { x: 30, z: 30, facing: 0 });
  f.a.socket.command({ type: 'action', action: 'attack' });
  for (let i = 0; i < 20; i++) f.tick();
  assert.equal(f.b.player.knockbackSequence, 1);
});

test('the struck player’s own prediction slides along the curve, even during its own attack', () => {
  const prediction = new LocalPrediction();
  prediction.enabled = true;
  const collision = new CollisionWorld([], { river: false });
  const player = {
    ...person('me', 10, 10),
    attackSequence: 1,
    attackAt: 900,
    knockbackAt: 1000,
    knockbackSequence: 1,
    knockbackX: 1,
    knockbackZ: 0,
    knockbackDistance: 1.6,
    knockbackDone: 0,
  };
  prediction.receive(player, 0);
  prediction.setInput(-1, 0, true, 0);
  let shown = null;
  const xs = [];
  for (let t = 16; t <= 240; t += 16) {
    shown = prediction.step(0.016, t, 1000 + t, collision, []);
    xs.push(shown.x);
  }
  for (let i = 1; i < xs.length; i++) assert.ok(xs[i] > xs[i - 1]);
  near(shown.x, 10 + 1.6 * knockbackProgress(240), 0.02);
  assert.equal(shown.moving, false);
  // A snapshot mid-slide re-anchors on the server's applied share without a jump.
  const done = knockbackProgress(200);
  prediction.receive({ ...player, x: 10 + 1.6 * done, knockbackDone: done }, 250);
  const next = prediction.step(0.016, 256, 1256, collision, []);
  assert.ok(Math.abs(next.x - shown.x) < 0.1, `${next.x} after ${shown.x}`);
});

test('the body rocks along the slide at once and stands upright again as it settles', () => {
  const body = { knockbackAt: 1000, knockbackX: 1, knockbackZ: 0, knockbackDistance: 1.6 };
  assert.equal(knockbackTilt(body, 999), 0);
  assert.equal(knockbackTilt(body, 1000), 0);
  const peak = knockbackTilt(body, 1070);
  assert.ok(peak > 0.25 && peak <= 0.3);
  assert.ok(knockbackTilt(body, 1300) < peak);
  assert.equal(knockbackTilt(body, 1000 + KNOCKBACK.staggerMs + 200), 0);
  assert.ok(knockbackTilt({ ...body, knockbackDistance: 0.8 }, 1070) < peak);
  assert.equal(knockbackTilt({}, 1070), 0);
  // The top of the body leans toward the slide whatever way the body faces.
  for (const yaw of [0, 1.1, Math.PI, -2.4])
    for (const [x, z] of [
      [1, 0],
      [0, -1],
      [-0.6, 0.8],
    ]) {
      const model = new THREE.Group();
      model.rotation.order = 'YXZ';
      model.rotation.y = yaw;
      applyKnockbackTilt(model, { ...body, knockbackX: x, knockbackZ: z }, 1070);
      near(model.rotation.y, yaw);
      const top = new THREE.Vector3(0, 1, 0).applyQuaternion(model.quaternion);
      const horizontal = Math.hypot(top.x, top.z);
      near(horizontal, Math.sin(peak), 0.01, 'lean');
      near((top.x * x + top.z * z) / horizontal, 1, 1e-3, 'direction');
      applyKnockbackTilt(model, body, 5000);
      assert.equal(model.rotation.x, 0);
      assert.equal(model.rotation.z, 0);
    }
});

test('a blow sounds on our own body and on a player close beside us, once', () => {
  const gate = new FoleyEvents(),
    sounds = [];
  const me = { id: 'me', x: 0, z: 0, gathered: 0, inventory: {}, adventure: { regions: {} } };
  const close = { id: 'close', x: KNOCKBACK_SOUND_RANGE - 0.5, z: 0 },
    far = { id: 'far', x: KNOCKBACK_SOUND_RANGE + 2, z: 0 };
  const world = { state: { orbBots: [], players: [me, close, far] } };
  const update = (time, baseline = false) =>
    gate.update(world, me, time, baseline, (name) => sounds.push({ name, time }));
  update(1000, true);
  Object.assign(far, { knockbackAt: 1100, knockbackSequence: 1 });
  update(1110);
  assert.equal(sounds.length, 0);
  Object.assign(close, { knockbackAt: 1200, knockbackSequence: 1 });
  update(1210);
  update(1250);
  assert.deepEqual(sounds, [{ name: 'hurt', time: 1210 }]);
  Object.assign(me, { knockbackAt: 1600, knockbackSequence: 1 });
  update(1610);
  assert.deepEqual(
    sounds.map((s) => s.time),
    [1210, 1610],
  );
});
