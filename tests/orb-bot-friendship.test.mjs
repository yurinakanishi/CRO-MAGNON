import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { CollisionWorld } from '../dist/shared/collision.mjs';
import { createGameCore } from '../dist/application/game-core.mjs';
import { createActionHandler } from '../dist/application/actions.mjs';
import { createCompanion524 } from '../dist/shared/companion-524.mjs';
import { createRimoNeko } from '../dist/shared/rimo-neko.mjs';
import {
  BOT_KINDS,
  ORB_BOTS,
  syncOrbBots,
  updateOrbBots,
  handleOrbBotAction,
  orbBotSnapshots,
  ownedBotKinds,
  saveOrbBots,
  restoreOrbBots,
  nearOrbBot,
  nearbyOrbBotsForPetting,
  pettingOrbBot,
} from '../dist/shared/orb-bots.mjs';
import { motionTarget } from '../dist/src/motion-interaction.js';
import * as THREE from 'three';
import { CHARACTER_MODELS } from '../dist/shared/characters.mjs';
import { GroundPettingPose } from '../dist/src/ground-petting-pose.js';
import { OctopusPettingPose } from '../dist/src/octopus-pose.js';
import { loadMotion } from '../scripts/motion-glb.mjs';
import { deliveredModel } from './delivered-model.mjs';

const gap = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
function fixture() {
  const collision = new CollisionWorld([], { coast: false, river: false, walkSurfaces: [] });
  const p = {
    id: 'p',
    x: 44,
    z: 54,
    facing: 0,
    radius: 0.32,
    species: 'cro',
    gender: 'female',
    speed: 0,
    moving: false,
    attackAt: 0,
    attackSequence: 0,
    jumpAt: 0,
    jumpSequence: 0,
  };
  const q = { ...p, id: 'q' };
  const room = {
    collision,
    players: new Map([
      [p.id, p],
      [q.id, q],
    ]),
  };
  let now = 10000;
  syncOrbBots(room, now);
  const step = (seconds) => {
    for (let i = 0; i < Math.round(seconds / 0.05); i++) {
      now += 50;
      updateOrbBots(room, 0.05, now);
    }
  };
  const action = (name, target, player = p) => handleOrbBotAction(room, player, name, target, now);
  const recruit = (b, player = p) => {
    Object.assign(player, { x: b.x, z: b.z - 1.3, moving: false });
    assert.ok(action('petBot', b.id, player));
    step(4);
    assert.equal(b.ownerId, player.id);
  };
  return {
    room,
    p,
    q,
    step,
    action,
    recruit,
    get now() {
      return now;
    },
    get b() {
      return room.orbBots[0];
    },
  };
}

test('one group action recruits all nine at the start with shared contact and hearts', () => {
  const f = fixture();
  const invited = nearbyOrbBotsForPetting(f.room.orbBots, f.p, f.room.collision, f.now);
  assert.equal(invited.length, 9);
  const start = { x: f.p.x, z: f.p.z };
  const started = f.now;
  assert.ok(f.action('petBots'));
  assert.equal(f.room.orbBots.filter((b) => b.busy).length, 9);
  assert.equal(f.room.orbBots.filter((b) => b.ownerId === f.p.id).length, 9);
  assert.ok(f.room.orbBots.every((b) => b.petAt === started));
  for (const a of f.room.orbBots)
    for (const b of f.room.orbBots)
      if (a !== b) assert.ok(gap(a.petGoal, b.petGoal) >= ORB_BOTS.diameter);
  assert.equal(f.action('petBots'), false, 'repeat input does not restart the group');
  assert.equal(f.action('petBot', invited[1].id), false);
  assert.equal(
    f.action('petBots', undefined, f.q),
    false,
    'a concurrent player cannot reserve the same dots',
  );
  f.step(0.05);
  assert.ok(
    f.room.orbBots.every((b) => gap(b, b.home) > 0.01),
    'all approach in the same tick',
  );
  const contacts = new Set();
  for (let i = 0; i < 150; i++) {
    const pets = f.room.orbBots.filter((b) => b.petPlayerId === f.p.id);
    if (!pets.length) break;
    assert.equal(pets.length, 9);
    assert.equal(pettingOrbBot(orbBotSnapshots(f.room), f.p.id).id, invited[0].id);
    assert.equal(new Set(pets.map((b) => b.petGroupLeaderId)).size, 1);
    assert.equal(new Set(pets.map((b) => b.petContactAt)).size, 1);
    if (pets[0].petContactAt) contacts.add(pets[0].petContactAt);
    assert.equal(f.room.orbBots.filter((b) => b.ownerId === f.p.id).length, 9);
    f.step(0.05);
  }
  assert.equal(contacts.size, 1, 'one shared stroke and reaction for the whole group');
  assert.ok(f.now - started < 7500);
  assert.deepEqual(ownedBotKinds(f.room.orbBots, f.p.id), BOT_KINDS);
  assert.ok(f.room.orbBots.every((b) => !b.busy && !b.petGroupLeaderId));
  assert.equal(new Set(f.room.orbBots.map((b) => b.phaseAt)).size, 1);
  assert.deepEqual({ x: f.p.x, z: f.p.z }, start, 'the invitation never moves the player');
});

for (const reason of ['movement', 'attack', 'character', 'disconnect', 'hurt', 'warp'])
  test(`group ${reason} interruption retains every accepted bond`, () => {
    const f = fixture();
    f.b.ownerId = f.p.id;
    const completed = f.room.orbBots.map((b) => b.id);
    f.action('petBots');
    for (let i = 0; i < 100 && !f.b.petContactAt; i++) f.step(0.05);
    assert.ok(f.b.petContactAt, 'interrupt during the shared stroke');
    f.step(0.4);
    if (reason === 'movement') f.p.moving = true;
    if (reason === 'attack') Object.assign(f.p, { attackAt: f.now, attackSequence: 1 });
    if (reason === 'character') f.p.species = 'ape';
    if (reason === 'disconnect') f.room.players.delete(f.p.id);
    if (reason === 'hurt') f.p.hurtAt = f.now + 1;
    if (reason === 'warp') f.p.warpSequence = 1;
    f.step(10);
    assert.ok(f.room.orbBots.every((b) => !b.petPlayerId && !b.busy && !b.petGroupLeaderId));
    assert.deepEqual(
      f.room.orbBots.filter((b) => b.ownerId === f.p.id).map((b) => b.id),
      completed,
    );
  });

test('group selection rejects other owners, occupied or flying dots, distant dots and walls', () => {
  const f = fixture();
  const [foreign, busy, airborne, distant, blocked] = f.room.orbBots;
  foreign.ownerId = f.q.id;
  busy.busy = true;
  airborne.mode = 'airborne';
  distant.x += 20;
  const originalVisible = f.room.collision.segmentFree.bind(f.room.collision);
  f.room.collision.segmentFree = (a, b, radius) =>
    gap(a, blocked) < 0.01 || gap(b, blocked) < 0.01 ? false : originalVisible(a, b, radius);
  const eligible = nearbyOrbBotsForPetting(f.room.orbBots, f.p, f.room.collision, f.now);
  assert.equal(eligible.length, 4);
  assert.ok(f.action('petBots', foreign.id));
  assert.deepEqual(
    f.room.orbBots
      .filter((b) => b.petPlayerId)
      .map((b) => b.id)
      .sort(),
    eligible.map((b) => b.id).sort(),
  );
  assert.equal(foreign.ownerId, f.q.id);
  assert.equal(airborne.mode, 'airborne');
  assert.equal(f.action('throwBot', eligible[0].kind), false);
});

test('one blocked approach cancels the group gesture while retaining every accepted bond', () => {
  const f = fixture();
  const blocked = nearbyOrbBotsForPetting(f.room.orbBots, f.p, f.room.collision, f.now)[1];
  assert.ok(f.action('petBots'));
  const move = f.room.collision.move.bind(f.room.collision);
  f.room.collision.move = (b, ...args) => (b === blocked ? { x: b.x, z: b.z } : move(b, ...args));
  f.step(8);
  assert.ok(f.room.orbBots.every((b) => b.ownerId === f.p.id));
  assert.ok(f.room.orbBots.every((b) => !b.petPlayerId && !b.busy));
});

for (const action of ['recallBots', 'dismissBots'])
  test(`${action} cancels the gesture; only explicit dismissal removes the bonds`, () => {
    const f = fixture();
    f.action('petBots');
    f.step(0.1);
    assert.ok(f.action(action));
    f.step(50);
    assert.ok(
      f.room.orbBots.every(
        (b) => b.ownerId === (action === 'dismissBots' ? '' : f.p.id) && !b.petPlayerId && !b.busy,
      ),
    );
    assert.ok(f.action('petBots'), 'cancellation releases the group for another invitation');
  });

test('dismissing one participating companion cancels the gesture but keeps the other accepted bonds', () => {
  const f = fixture();
  const existing = f.room.orbBots[5];
  existing.ownerId = f.p.id;
  assert.ok(f.action('petBots'));
  f.step(0.2);
  assert.ok(f.action('dismissBot', existing.kind));
  f.step(8);
  assert.ok(
    f.room.orbBots.every(
      (b) => b.ownerId === (b === existing ? '' : f.p.id) && !b.busy && !b.petPlayerId,
    ),
  );
});

test('save and reconnect preserve all accepted group bonds without replaying an unfinished gesture', () => {
  const f = fixture();
  assert.ok(f.action('petBots'));
  for (let i = 0; i < 100 && !f.b.petContactAt; i++) f.step(0.05);
  assert.ok(f.b.petContactAt);
  const pending = saveOrbBots(f.room);
  assert.ok(
    pending.every(
      (b) => b.ownerId === f.p.id && !('petGroupLeaderId' in b) && !('petPlayerId' in b),
    ),
  );
  assert.ok(orbBotSnapshots(f.room).every((b) => !('petWarpSequence' in b)));
  restoreOrbBots(f.room, pending, f.now);
  f.step(8);
  assert.ok(f.room.orbBots.every((b) => b.ownerId === f.p.id && !b.petPlayerId && !b.busy));
  assert.ok(f.action('petBots'));
  f.step(8);
  assert.equal(ownedBotKinds(f.room.orbBots, f.p.id).length, 9);
  const saved = saveOrbBots(f.room);
  restoreOrbBots(f.room, saved, f.now);
  f.step(8);
  assert.equal(ownedBotKinds(f.room.orbBots, f.p.id).length, 9);
  assert.ok(f.room.orbBots.every((b) => !b.petPlayerId && !b.busy && !b.petGroupLeaderId));
});

test('a group invitation and the existing cat or 524 pet cannot share the player hand', () => {
  const f = fixture();
  f.room.rimoNeko = createRimoNeko(f.room.collision);
  f.room.companion524 = createCompanion524(f.room.collision);
  for (const companion of [f.room.rimoNeko, f.room.companion524]) {
    companion.petPlayerId = f.p.id;
    assert.equal(f.action('petBots'), false);
    companion.petPlayerId = null;
  }
  Object.assign(f.room.companion524, { squadPlayerId: f.p.id, followPlayerId: f.p.id });
  syncOrbBots(f.room, f.now);
  assert.ok(f.action('petBots'));
  assert.equal(f.room.orbBots.filter((b) => b.petPlayerId === f.p.id).length, 9);
  assert.equal(f.room.orbBots.find((b) => b.kind === '524').petPlayerId, undefined);
});

test('five connections share nine visible home dots, and a character can walk alone', () => {
  const f = fixture();
  for (let i = 2; i < 5; i++) f.room.players.set(`p${i}`, { ...f.p, id: `p${i}` });
  syncOrbBots(f.room, f.now);
  const homes = f.room.orbBots.map((b) => [b.id, b.x, b.z]);
  f.p.x += 20;
  f.step(5);
  assert.equal(f.room.orbBots.length, 9);
  assert.deepEqual(
    f.room.orbBots.map((b) => [b.id, b.x, b.z]),
    homes,
  );
  assert.deepEqual(ownedBotKinds(orbBotSnapshots(f.room), f.p.id), []);
  assert.equal(f.action('throwBot', 'white'), false);
  f.action('recallBots');
  f.step(3);
  assert.ok(f.room.orbBots.every((b) => !b.ownerId && b.mode === 'home'));
  assert.equal(orbBotSnapshots(f.room).length, 9);
});

test('each of the nine dots joins at the start while approach, strokes and happiness keep their timing', () => {
  const f = fixture();
  for (const b of f.room.orbBots) {
    const home = { ...b.home };
    Object.assign(f.p, { x: b.x, z: b.z - 1.3 });
    assert.ok(f.action('petBot', b.id));
    assert.equal(b.ownerId, f.p.id);
    assert.equal(f.action('petBot', f.room.orbBots.find((x) => x !== b).id), false);
    while (!b.petContactAt) f.step(0.05);
    while (f.now < b.petContactAt + ORB_BOTS.petStrokeMs + ORB_BOTS.happyMs - 50) f.step(0.05);
    assert.equal(b.ownerId, f.p.id);
    assert.equal(b.busy, true);
    f.step(0.1);
    assert.equal(b.ownerId, f.p.id);
    assert.equal(b.petPlayerId, null);
    assert.deepEqual(b.home, home);
  }
  f.step(4);
  assert.deepEqual(ownedBotKinds(orbBotSnapshots(f.room), f.p.id), BOT_KINDS);
  assert.ok(f.room.orbBots.every((b) => gap(f.p, b) < ORB_BOTS.pickupRange));
});

for (const reason of ['movement', 'attack', 'character', 'disconnect', 'hurt'])
  test(`unfinished pet is cancelled on ${reason} while retaining recruitment`, () => {
    const f = fixture(),
      b = f.b;
    assert.ok(f.action('petBot', b.id));
    f.step(0.3);
    if (reason === 'movement') f.p.x += 0.5;
    if (reason === 'attack') Object.assign(f.p, { attackAt: f.now, attackSequence: 1 });
    if (reason === 'character') f.p.species = 'ape';
    if (reason === 'disconnect') f.room.players.delete(f.p.id);
    if (reason === 'hurt') f.p.hurtAt = f.now;
    f.step(8);
    assert.equal(b.ownerId, f.p.id);
    assert.equal(b.petPlayerId, null);
    assert.equal(b.mode, reason === 'disconnect' ? 'home' : 'following');
  });

test('distant, obstructed and airborne dots cannot be petted; foreign dismiss is rejected', () => {
  const f = fixture(),
    b = f.b;
  f.p.x += 10;
  assert.equal(f.action('petBot', b.id), false);
  Object.assign(f.p, { x: b.x, z: b.z - 1.3 });
  f.room.collision = new CollisionWorld(
    [{ id: 'wall', type: 'circle', x: b.x, z: b.z - 0.65, radius: 0.3 }],
    { coast: false, river: false, walkSurfaces: [] },
  );
  assert.equal(f.action('petBot', b.id), false);
  f.room.collision = new CollisionWorld([], { coast: false, river: false, walkSurfaces: [] });
  f.recruit(b);
  assert.equal(f.action('dismissBot', b.kind, f.q), false);
  f.step(2);
  assert.ok(f.action('throwBot', b.kind));
  f.step(0.4);
  assert.equal(b.mode, 'airborne');
  Object.assign(f.q, { x: b.x, z: b.z });
  assert.equal(nearOrbBot(f.q, b, f.room.collision, f.now), false);
});

test('another accepted pet transfers one dot immediately and survives cancellation or reconnect', () => {
  const f = fixture(),
    b = f.b,
    id = b.id;
  f.recruit(b);
  Object.assign(f.q, { x: b.x, z: b.z - 1.3 });
  assert.ok(f.action('petBot', b.id, f.q));
  f.step(0.3);
  f.q.x += 0.5;
  f.step(3);
  assert.equal(b.ownerId, f.q.id);
  f.room.players.delete(f.p.id);
  f.step(2);
  f.recruit(b, f.q);
  f.room.players.set(f.p.id, f.p);
  f.step(1);
  assert.equal(b.id, id);
  assert.equal(b.ownerId, f.q.id);
  assert.deepEqual(ownedBotKinds(f.room.orbBots, f.p.id), []);
  assert.equal(f.room.orbBots.length, 9);
});

test('dismiss one or all preserves the landing then returns to original homes, and allows recruitment again', () => {
  const f = fixture(),
    b = f.b,
    other = f.room.orbBots[1];
  f.recruit(b);
  f.recruit(other);
  f.step(3);
  assert.ok(f.action('throwBot', b.kind));
  f.step(0.4);
  const landing = { ...b.landing };
  assert.ok(f.action('dismissBot', b.kind));
  assert.equal(b.ownerId, '');
  assert.equal(b.mode, 'airborne');
  while (b.mode === 'airborne') f.step(0.05);
  assert.equal(b.mode, 'landing');
  assert.ok(gap(b, landing) < 0.001);
  assert.equal(other.ownerId, f.p.id);
  f.step(20);
  assert.equal(b.mode, 'home');
  assert.ok(gap(b, b.home) < 0.001);
  assert.ok(f.action('dismissBots'));
  f.p.x += 30;
  f.step(25);
  assert.ok(f.room.orbBots.every((b) => !b.ownerId && b.mode === 'home' && gap(b, b.home) < 0.001));
  f.recruit(b);
  assert.equal(b.ownerId, f.p.id);
});

test('home return navigates around obstacles and recovers from a blocked route', () => {
  for (const blocked of [false, true]) {
    const f = fixture(),
      b = f.b;
    f.recruit(b);
    Object.assign(b, { x: b.home.x, z: b.home.z + 6 });
    const rock = { id: 'rock', type: 'circle', x: b.home.x, z: b.home.z + 3, radius: 1 };
    f.room.collision = new CollisionWorld([rock], { coast: false, river: false, walkSurfaces: [] });
    if (blocked) f.room.collision.path = () => [];
    f.action('dismissBots');
    for (let i = 0; i < 400; i++) {
      f.step(0.05);
      assert.ok(f.room.collision.free(b, ORB_BOTS.radius));
    }
    assert.equal(b.mode, 'home');
    assert.ok(gap(b, b.home) < 0.001);
  }
});

test('offline followers return visibly to camp and resume their bonds when their owner rejoins', () => {
  const f = fixture();
  assert.ok(f.action('petBots'));
  f.p.moving = true;
  f.p.x -= 85;
  f.step(3);
  f.p.moving = false;
  assert.ok(f.room.orbBots.every((b) => gap(b, b.home) > 70));
  f.room.players.delete(f.p.id);
  f.step(70);
  assert.ok(f.room.orbBots.every((b) => b.mode === 'home' && gap(b, b.home) < 0.06));
  assert.deepEqual(ownedBotKinds(orbBotSnapshots(f.room), f.p.id), BOT_KINDS);
  const phase = f.b.phaseAt;
  f.step(1);
  assert.equal(f.b.phaseAt, phase, 'waiting at camp does not restart the arrival each tick');
  f.room.players.set(f.p.id, f.p);
  f.step(15);
  assert.ok(f.room.orbBots.every((b) => b.mode === 'following' && gap(b, f.p) < 3));
  assert.deepEqual(ownedBotKinds(orbBotSnapshots(f.room), f.p.id), BOT_KINDS);
  assert.ok(f.action('throwBot', 'white'), 'rejoining needs no further petting');
});

test('offline home return keeps its route around a wall and can be interrupted by reconnecting', () => {
  const f = fixture();
  f.recruit(f.b);
  Object.assign(f.b, { x: f.b.home.x, z: f.b.home.z + 6 });
  f.room.collision = new CollisionWorld(
    [{ id: 'rock', type: 'circle', x: f.b.home.x, z: f.b.home.z + 3, radius: 1 }],
    { coast: false, river: false, walkSurfaces: [] },
  );
  f.room.players.delete(f.p.id);
  f.step(0.2);
  assert.equal(f.b.mode, 'goingHome');
  let largestStep = 0;
  for (let i = 0; i < 200; i++) {
    const before = { x: f.b.x, z: f.b.z };
    f.step(0.05);
    largestStep = Math.max(largestStep, gap(before, f.b));
    assert.ok(f.room.collision.free(f.b, ORB_BOTS.radius));
  }
  assert.ok(largestStep <= 0.151, 'walks the route without a fallback teleport');
  assert.equal(f.b.mode, 'home');
  assert.equal(f.b.ownerId, f.p.id);
  Object.assign(f.b, { x: f.b.home.x + 10, mode: 'following' });
  f.step(0.2);
  assert.equal(f.b.mode, 'goingHome');
  f.room.players.set(f.p.id, f.p);
  f.step(4);
  assert.equal(f.b.mode, 'following');
  assert.ok(gap(f.b, f.p) < 3);
});

test('offline pending and stowed dots return home while deployed dots retain their landing positions', () => {
  for (const mode of ['following', 'queued', 'windup', 'stowed', 'airborne']) {
    const f = fixture();
    f.recruit(f.b);
    f.step(2);
    assert.ok(f.action('throwBot', f.b.kind));
    if (mode === 'airborne') f.step(0.4);
    else {
      f.b.mode = mode;
      if (mode === 'stowed') f.p.mountId = 'mammoth';
    }
    const landing = f.b.landing && { ...f.b.landing };
    f.room.players.delete(f.p.id);
    f.step(30);
    assert.equal(f.b.ownerId, f.p.id);
    assert.equal(f.b.mode, mode === 'airborne' ? 'waiting' : 'home');
    assert.ok(gap(f.b, mode === 'airborne' ? landing : f.b.home) < 0.06);
    assert.equal(f.room.orbBots.length, 9);
  }
});

test('restored offline followers return home; the old owner still has nine companions at any distance', () => {
  const f = fixture();
  f.action('petBots');
  f.p.x -= 85;
  f.step(3);
  const saved = saveOrbBots(f.room);
  f.room.sessions = new Map([['saved-owner', { player: { id: f.p.id } }]]);
  f.room.players.delete(f.p.id);
  restoreOrbBots(f.room, saved, f.now);
  f.step(70);
  assert.ok(f.room.orbBots.every((b) => b.mode === 'home' && gap(b, b.home) < 0.06));
  for (const distance of [0, 65, 125, 800]) {
    f.p.x = f.b.home.x - distance;
    assert.deepEqual(ownedBotKinds(orbBotSnapshots(f.room), f.p.id), BOT_KINDS);
  }
  restoreOrbBots(f.room, saveOrbBots(f.room), f.now);
  f.room.players.set(f.p.id, f.p);
  f.action('recallBots');
  f.step(15);
  assert.ok(f.room.orbBots.every((b) => b.ownerId === f.p.id && gap(b, f.p) < 3));
});

test('one group pet can transfer available offline companions but never those of a connected owner', () => {
  const f = fixture();
  f.action('petBots');
  f.step(8);
  assert.equal(f.action('petBots', undefined, f.q), false);
  f.room.players.delete(f.p.id);
  f.step(10);
  Object.assign(f.q, { x: 44, z: 54 });
  const present = new Set(f.room.players.keys());
  assert.equal(
    nearbyOrbBotsForPetting(f.room.orbBots, f.q, f.room.collision, f.now, present).length,
    9,
  );
  assert.ok(f.action('petBots', undefined, f.q));
  assert.ok(f.room.orbBots.every((b) => b.ownerId === f.q.id));
  f.q.moving = true;
  f.step(0.1);
  f.room.players.set(f.p.id, f.p);
  f.step(2);
  assert.deepEqual(ownedBotKinds(orbBotSnapshots(f.room), f.q.id), BOT_KINDS);
  assert.deepEqual(ownedBotKinds(orbBotSnapshots(f.room), f.p.id), []);
});

test('save/load retains accepted bonds and landed positions without replaying partial pets or flights', () => {
  const f = fixture(),
    b = f.b;
  f.recruit(b);
  f.step(2);
  f.action('throwBot', b.kind);
  f.step(0.4);
  const landing = { ...b.landing },
    saved = saveOrbBots(f.room),
    before = structuredClone(saved);
  restoreOrbBots(f.room, saved, f.now);
  assert.deepEqual(saved, before);
  assert.equal(f.b.ownerId, f.p.id);
  assert.equal(f.b.mode, 'waiting');
  assert.ok(gap(f.b, landing) < 0.001);
  const unowned = f.room.orbBots[1];
  Object.assign(f.q, { x: unowned.x, z: unowned.z - 1.3 });
  f.action('petBot', unowned.id, f.q);
  f.step(0.5);
  const partial = saveOrbBots(f.room);
  restoreOrbBots(f.room, partial, f.now);
  f.step(10);
  assert.equal(f.room.orbBots[1].ownerId, f.q.id);
  assert.equal(f.room.orbBots[1].mode, 'following');
  restoreOrbBots(f.room, [{ kind: 'white', ownerId: 'stranger', x: NaN, z: Infinity }], f.now);
  f.step(1);
  assert.ok(f.room.orbBots.every((b) => !b.ownerId && Number.isFinite(b.y)));
  restoreOrbBots(f.room, undefined, f.now);
  assert.equal(f.room.orbBots.length, 9);
});

test('solo command dismisses dots, 524 and cat; other players keep their companions', () => {
  const f = fixture();
  f.recruit(f.b);
  f.recruit(f.room.orbBots[1], f.q);
  f.room.companion524 = createCompanion524(f.room.collision);
  Object.assign(f.room.companion524, { followPlayerId: f.p.id, squadPlayerId: f.p.id });
  f.room.rimoNeko = createRimoNeko(f.room.collision);
  f.room.rimoNeko.followPlayerId = f.p.id;
  const act = createActionHandler({
    notice() {},
    broadcast() {},
    snapshot() {
      return {};
    },
    systemChat() {},
    runtime: {},
  });
  act(f.room, f.p, { action: 'travelAlone' }, f.now);
  assert.deepEqual(ownedBotKinds(f.room.orbBots, f.p.id), []);
  assert.equal(f.room.companion524.followPlayerId, null);
  assert.equal(f.room.rimoNeko.followPlayerId, null);
  assert.equal(f.room.orbBots[1].ownerId, f.q.id);
  f.room.rimoNeko.petPlayerId = f.p.id;
  act(f.room, f.p, { action: 'travelAlone' }, f.now);
  assert.equal(f.room.rimoNeko.petPlayerId, null, 'solo also cancels an unfinished cat invitation');
  const target = { action: 'petBot', targetId: f.b.id, label: 'しろbotを撫でる' };
  assert.deepEqual(motionTarget(target, null), target);
});

test('command transport broadcasts one recruitment and restores it through the saved player session', () => {
  class Socket extends EventEmitter {
    readyState = 1;
    bufferedAmount = 0;
    messages = [];
    send(raw) {
      this.messages.push(JSON.parse(raw));
    }
    ping() {
      this.emit('pong');
    }
    close() {
      this.readyState = 3;
      this.emit('close');
    }
  }
  let now = 10000,
    id = 0;
  const options = {
    runtime: { now: () => now, id: () => `friend-${++id}`, token: () => `friend-token-${++id}` },
    persistentSessions: true,
    keepEmptyRooms: true,
  };
  let core = createGameCore(options);
  const join = (session = '') => {
    const s = new Socket();
    core.connect(s, new URLSearchParams({ room: 'FRIENDS', resume: '1', session }));
    return s;
  };
  const sockets = Array.from({ length: 5 }, () => join());
  const welcome = sockets[0].messages.find((m) => m.type === 'welcome');
  const room = core.rooms.get('FRIENDS'),
    p = room.players.get(welcome.id);
  now += 50;
  core.tick();
  const b = room.orbBots[0];
  Object.assign(p, { x: b.x, z: b.z - 1.3 });
  p.inventory.wood = 7;
  sockets[0].emit(
    'message',
    Buffer.from(JSON.stringify({ type: 'action', action: 'petBot', targetId: b.id })),
    false,
  );
  for (let i = 0; i < 100; i++) {
    now += 50;
    core.tick();
  }
  assert.equal(b.ownerId, p.id);
  for (const s of sockets)
    assert.equal(
      s.messages
        .filter((m) => m.type === 'state')
        .at(-1)
        .orbBots.find((x) => x.id === b.id).ownerId,
      p.id,
    );
  const saved = core.exportState();
  core = createGameCore(options);
  core.importState(saved);
  const resumed = join(welcome.session),
    r = core.rooms.get('FRIENDS');
  now += 50;
  core.tick();
  assert.equal(resumed.messages.find((m) => m.type === 'welcome').id, p.id);
  assert.equal(r.players.get(p.id).inventory.wood, 7);
  assert.equal(r.orbBots.filter((x) => x.ownerId === p.id).length, 1);
  assert.equal(r.orbBots.length, 9);
  const next = r.orbBots[1],
    player = r.players.get(p.id);
  const command = (action, targetId) =>
    resumed.emit(
      'message',
      Buffer.from(JSON.stringify({ type: 'action', action, targetId })),
      false,
    );
  Object.assign(player, { x: next.x, z: next.z - 1.3 });
  now += 1000;
  command('petBot', next.id);
  for (let i = 0; i < 100; i++) {
    now += 50;
    core.tick();
  }
  assert.equal(next.ownerId, p.id);
  command('dismissBot', 'white');
  now += 50;
  command('dismissBots');
  assert.equal(
    r.orbBots.filter((x) => x.ownerId === p.id).length,
    0,
    'rapid individual then all-home commands are not dropped',
  );
});

test('all nine character rigs reach the dot crown at the authoritative pet position and restore their bones', async () => {
  for (const character of CHARACTER_MODELS) {
    const f = fixture();
    Object.assign(f.p, character, { x: f.b.x, z: f.b.z - 1.3 });
    assert.ok(f.action('petBot', f.b.id));
    const gltf = await loadMotion(await deliveredModel(character.key));
    const outer = new THREE.Group();
    outer.add(gltf.scene);
    const pose =
      character.bodyPlan === 'octopus'
        ? new OctopusPettingPose(gltf.scene)
        : new GroundPettingPose(gltf.scene);
    const mixer = new THREE.AnimationMixer(gltf.scene);
    mixer.clipAction(gltf.animations.find((c) => c.name === 'Idle_Loop')).play();
    for (const yaw of [0, Math.PI / 2, Math.PI]) {
      outer.rotation.y = yaw;
      for (const stroke of [0, 0.25, 0.5, 0.75, 1]) {
        pose.restore();
        mixer.update(1 / 30);
        outer.updateMatrixWorld(true);
        const bones = [];
        gltf.scene.traverse((b) => {
          if (b.isBone) bones.push([b, b.position.clone(), b.quaternion.clone()]);
        });
        const feet = ['FootL', 'FootR']
          .map((n) => gltf.scene.getObjectByName(n))
          .filter(Boolean)
          .map((b) => [b, b.getWorldPosition(new THREE.Vector3())]);
        const target = outer.localToWorld(
          new THREE.Vector3(f.b.petGoal.x - f.p.x, ORB_BOTS.diameter * 0.9, f.b.petGoal.z - f.p.z),
        );
        pose.update(target, 1, stroke, true);
        assert.ok(
          pose.contact.distanceTo(pose.requested) < 0.045,
          `${character.key}: hand gap ${pose.contact.distanceTo(pose.requested)}`,
        );
        for (const [b, at] of feet)
          assert.ok(
            b.getWorldPosition(new THREE.Vector3()).distanceTo(at) < 0.006,
            `${character.key}: feet slide`,
          );
        pose.restore();
        for (const [b, pos, q] of bones) {
          assert.ok(b.position.distanceTo(pos) < 1e-9);
          assert.deepEqual(b.quaternion.toArray(), q.toArray());
        }
      }
    }
    mixer.stopAllAction();
    mixer.uncacheRoot(gltf.scene);
  }
});
