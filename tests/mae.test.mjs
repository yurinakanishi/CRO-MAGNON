import test from 'node:test';
import assert from 'node:assert/strict';
import { CollisionWorld } from '../dist/shared/collision.mjs';
import {
  MAE,
  createMae,
  handleMaeAction,
  updateMae,
  hitMae,
  restoreMae,
  maeSnapshot,
} from '../dist/shared/mae.mjs';
import { createRimoNeko } from '../dist/shared/rimo-neko.mjs';
import { createCompanion524 } from '../dist/shared/companion-524.mjs';
import { startAttack, resolveAttack } from '../dist/shared/combat.mjs';
import { createGameCore as createCore } from '../dist/application/game-core.mjs';
import { ALL_MASCOT_MODELS } from '../dist/shared/mascot-roster.mjs';
import { syncOrbBots } from '../dist/shared/orb-bots.mjs';
import { EventEmitter } from 'node:events';

const createGameCore = (options) => createCore({ mascotModels: ALL_MASCOT_MODELS, ...options });

const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
function fixture() {
  const collision = new CollisionWorld([], { coast: false, river: false, walkSurfaces: [] });
  const c = createMae(collision);
  const p = {
    id: 'p',
    x: c.x,
    z: c.z - 2,
    facing: 0,
    radius: 0.32,
    species: 'cro',
    gender: 'female',
    speed: 0,
    energy: 100,
    inventory: {},
    attackAt: 0,
    attackSequence: 0,
    jumpAt: 0,
    jumpSequence: 0,
    hurtAt: 0,
  };
  const room = { collision, mae: c, players: new Map([[p.id, p]]), animals: [], enemies: [] };
  return { c, p, room };
}
function advance(room, from, seconds) {
  for (let t = 0.025; t <= seconds + 0.001; t += 0.025) {
    updateMae(room, 0.025, from + t * 1000);
    assert.ok(room.collision.free(room.mae, room.mae.radius));
  }
}
test('mae has a safe independent camp home and a minimal public snapshot', () => {
  const collision = new CollisionWorld();
  const c = createMae(collision);
  assert.ok(collision.free(c, c.radius));
  for (const pet of [createRimoNeko(collision), createCompanion524(collision)])
    assert.ok(distance(c, pet) > c.radius + pet.radius);
  const snap = maeSnapshot(c);
  assert.equal(snap.id, 'mae');
  for (const key of ['path', 'home', 'petGoal', 'ownerPosition', 'velocityX'])
    assert.ok(!(key in snap));
  assert.equal(snap.followPlayerId, null);
});
test('completed strokes produce one shared happy phase before following', () => {
  const { c, p, room } = fixture();
  assert.ok(handleMaeAction(room, p, 'petMae', 10000));
  advance(room, 10000, 1.5);
  assert.ok(c.petContactAt > 0);
  assert.equal(c.followPlayerId, p.id);
  const happyAt = c.petContactAt + MAE.petStrokeMs;
  updateMae(room, 0.025, happyAt);
  assert.equal(c.followPlayerId, p.id);
  const at = { ...c };
  p.z -= 5;
  p.moving = true;
  p.speed = 3;
  updateMae(room, 0.025, happyAt + MAE.happyMs - 1);
  assert.equal(distance(c, at), 0);
  updateMae(room, 0.025, happyAt + MAE.happyMs + 1);
  assert.equal(c.petPlayerId, null);
  assert.ok(distance(c, at) > 0);
});
for (const [label, interrupt] of [
  [
    'movement',
    ({ p }) => {
      p.moving = true;
    },
  ],
  [
    'attack',
    ({ p }) => {
      p.attackAt = 11000;
      p.attackSequence = 1;
    },
  ],
  [
    'hurt',
    ({ p }) => {
      p.hurtAt = 11000;
    },
  ],
  [
    'character switch',
    ({ p }) => {
      p.gender = 'male';
    },
  ],
  [
    'warp',
    ({ p }) => {
      p.x += 80;
    },
  ],
  [
    'disconnect',
    ({ p, room }) => {
      room.players.delete(p.id);
    },
  ],
])
  test(`interrupted ${label} keeps the new bond established at the start`, () => {
    for (const alreadyOwned of [false, true]) {
      const f = fixture();
      if (alreadyOwned) {
        f.room.players.set('earlier', { ...f.p, id: 'earlier', x: f.c.x, z: f.c.z });
        f.c.mode = 'following';
        f.c.followPlayerId = 'earlier';
      }
      assert.ok(handleMaeAction(f.room, f.p, 'petMae', 10000));
      advance(f.room, 10000, 1);
      interrupt(f);
      updateMae(f.room, 0.025, 11000);
      assert.equal(f.c.petPlayerId, null);
      assert.equal(f.c.petContactAt, 0);
      assert.equal(f.c.followPlayerId, f.p.id);
    }
  });
test('range, visibility, busy players and repeated requests are authoritative', () => {
  const { c, p, room } = fixture();
  assert.equal(handleMaeAction(room, { ...p, z: p.z - 5 }, 'petMae', 10000), false);
  for (const patch of [
    { mountId: 'm' },
    { boatId: 'b' },
    { downedUntil: 20000 },
    { carrierId: 'a' },
    { fishing: {} },
    { jumpSequence: 1, jumpAt: 10000 },
  ])
    assert.equal(handleMaeAction(room, { ...p, ...patch }, 'petMae', 10000), false);
  assert.ok(handleMaeAction(room, p, 'petMae', 10000));
  assert.equal(handleMaeAction(room, { ...p, id: 'q' }, 'petMae', 10001), false);
  assert.equal(c.petSequence, 1);
  const wall = fixture();
  wall.room.collision = new CollisionWorld(
    [{ type: 'box', id: 'wall', x: wall.c.x, z: wall.c.z - 1, hx: 3, hz: 0.15, c: 1, s: 0 }],
    { coast: false, river: false, walkSurfaces: [] },
  );
  assert.equal(handleMaeAction(wall.room, wall.p, 'petMae', 10000), false);
});
test('following has a stable stopping distance and returns along the real route', () => {
  const { c, p, room } = fixture();
  handleMaeAction(room, p, 'petMae', 10000);
  advance(room, 10000, 5);
  const at = { ...c };
  p.facing = Math.PI;
  advance(room, 15000, 2);
  assert.equal(distance(c, at), 0);
  p.z += 10;
  p.speed = 3;
  advance(room, 17000, 8);
  assert.ok(distance(c, p) < MAE.followDistance + 0.15);
  assert.equal(handleMaeAction(room, { ...p, id: 'stranger' }, 'dismissMae', 25000), false);
  assert.ok(handleMaeAction(room, p, 'dismissMae', 25000));
  advance(room, 25000, 15);
  assert.equal(c.mode, 'idle');
  assert.ok(distance(c, c.home) < 0.1);
});
test('melee recoil interrupts petting without health, loot or cat hissing', () => {
  const { c, p, room } = fixture();
  p.z = c.z - 1.2;
  assert.ok(startAttack(room, p, {}, 10000).accepted);
  const result = resolveAttack(room, p, 10333);
  assert.equal(result.kind, 'mae');
  assert.equal(result.killed, false);
  assert.equal(c.hitSequence, 1);
  assert.equal(c.health, undefined);
  advance(room, 10333, 1);
  assert.ok(handleMaeAction(room, p, 'petMae', 12000));
  hitMae(c, 1, 0, 12500);
  assert.equal(c.petPlayerId, null);
  assert.equal(c.followPlayerId, p.id);
});
test('old saves add mae; restoring a follower preserves position and returns home', () => {
  const { room } = fixture();
  restoreMae(room, undefined);
  assert.equal(room.mae.id, MAE.id);
  const saved = {
    ...room.mae,
    z: room.mae.z + 8,
    mode: 'following',
    followPlayerId: 'old',
    trail: [{ x: room.mae.x, z: room.mae.z + 4 }],
  };
  restoreMae(room, saved);
  assert.equal(room.mae.z, saved.z);
  assert.equal(room.mae.mode, 'returning');
  assert.equal(room.mae.followPlayerId, null);
  advance(room, 10000, 12);
  assert.equal(room.mae.mode, 'idle');
});

class Socket extends EventEmitter {
  readyState = 1;
  sent = [];
  send(text) {
    this.sent.push(JSON.parse(text));
  }
  close() {
    this.readyState = 3;
    this.emit('close');
  }
}
test('real action routing excludes simultaneous petting, Q cancels, and saves mae independently', () => {
  const core = createGameCore({ keepEmptyRooms: true, persistentSessions: true });
  const socket = new Socket();
  core.connect(
    socket,
    new URLSearchParams({
      room: 'MAE-TEST',
      name: 'mae-test',
      species: 'cro',
      gender: 'female',
      resume: '1',
    }),
  );
  const room = core.rooms.get('MAE-TEST');
  const p = [...room.players.values()][0];
  syncOrbBots(room, Date.now());
  p.x = room.mae.x;
  p.z = room.mae.z - 1;
  const send = (action) => socket.emit('message', JSON.stringify({ type: 'action', action }));
  send('petMae');
  assert.equal(room.mae.petPlayerId, p.id);
  const bot = room.orbBots.find((b) => b.kind !== '524');
  send('petBots');
  assert.equal(bot.petPlayerId, null);
  send('pet524');
  assert.notEqual(room.companion524.petPlayerId, p.id);
  send('petRimo');
  assert.notEqual(room.rimoNeko.petPlayerId, p.id);
  send('recallBots');
  assert.equal(room.mae.petPlayerId, null);
  assert.ok(socket.sent.some((m) => m.type === 'state' && m.mae?.id === 'mae'));
  p.inventory.wood = 3;
  room.mae.mode = 'following';
  room.mae.followPlayerId = p.id;
  socket.close();
  const saved = core.exportState(),
    untouched = structuredClone(saved);
  const restored = createGameCore();
  restored.importState(saved);
  assert.equal(restored.rooms.get('MAE-TEST').mae.mode, 'returning');
  assert.ok(restored.rooms.get('MAE-TEST').rimoNeko);
  assert.ok(restored.rooms.get('MAE-TEST').companion524);
  assert.equal([...restored.rooms.get('MAE-TEST').sessions.values()][0].player.inventory.wood, 3);
  assert.deepEqual(saved, untouched);
  delete saved.rooms[0].mae;
  const legacy = createGameCore();
  legacy.importState(saved);
  assert.equal(legacy.rooms.get('MAE-TEST').mae.mode, 'idle');
});
