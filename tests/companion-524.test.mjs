import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { CollisionWorld } from '../dist/shared/collision.mjs';
import { createGameCore } from '../dist/application/game-core.mjs';
import {
  startAttack,
  resolveAttack,
  updateProjectiles,
  damageableTargets,
} from '../dist/shared/combat.mjs';
import { attackProfile } from '../dist/shared/combat-profiles.mjs';
import {
  COMPANION_524,
  createCompanion524,
  nearCompanion524,
  handleCompanion524Action,
  updateCompanion524,
  companion524Snapshot,
  hitCompanion524,
  restoreCompanion524,
} from '../dist/shared/companion-524.mjs';

const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
function fixture(obstacles = []) {
  const collision = new CollisionWorld(obstacles, { coast: false, river: false, walkSurfaces: [] });
  const c = createCompanion524(collision);
  const p = {
    id: 'p',
    x: c.x,
    z: c.z + 2,
    facing: Math.PI,
    radius: 0.32,
    speed: 0,
    species: 'cro',
    gender: 'female',
    energy: 100,
    inventory: {},
    attackAt: 0,
    attackSequence: 0,
    jumpSequence: 0,
    jumpAt: 0,
    cookingEndsAt: 0,
    downedUntil: 0,
    mountId: null,
    boatId: null,
  };
  const room = {
    collision,
    companion524: c,
    players: new Map([[p.id, p]]),
    animals: [],
    enemies: [],
  };
  return { c, p, room };
}
function advance(room, from, seconds, dt = 0.05) {
  for (let elapsed = dt; elapsed < seconds + dt / 2; elapsed += dt) {
    updateCompanion524(room, dt, from + elapsed * 1000);
    assert.ok(
      room.collision.free(room.companion524, room.companion524.radius),
      '524 never crosses a static obstacle',
    );
  }
}

test('524 spawns within six metres of the real camp on a safe surface', () => {
  const collision = new CollisionWorld(),
    c = createCompanion524(collision);
  assert.ok(distance(c, { x: 50, z: 50 }) < 6);
  assert.ok(collision.free(c, c.radius));
  assert.equal(c.mode, 'idle');
  assert.equal(c.followPlayerId, null);
  assert.equal(c.radius, 0.18, 'the small body uses its matching navigation/hit radius');
});

test('petting verifies range, visibility and every incompatible activity', () => {
  const { room, c, p } = fixture();
  assert.equal(nearCompanion524(p, c, room.collision, 10000), true);
  for (const patch of [
    { x: c.x + 20 },
    { downedUntil: 20000 },
    { mountId: 'm' },
    { boatId: 'b' },
    { carrierId: 'q' },
    { passengerId: 'q' },
    { fishing: {} },
    { coastalActivity: {} },
    { cookingEndsAt: 20000 },
    { attackSequence: 1, attackAt: 9900 },
    { jumpSequence: 1, jumpAt: 9900 },
  ]) {
    assert.equal(
      handleCompanion524Action(room, { ...p, ...patch }, 'pet524', 10000),
      false,
      JSON.stringify(patch),
    );
  }
  room.collision = new CollisionWorld(
    [{ type: 'box', id: 'wall', x: c.x, z: c.z + 1, hx: 4, hz: 0.2, c: 1, s: 0 }],
    { coast: false, walkSurfaces: [] },
  );
  assert.equal(handleCompanion524Action(room, p, 'pet524', 10000), false);
  assert.equal(c.petSequence, 0);
});

test('pet event is rate limited, latest valid pet chooses one owner and only that owner may dismiss', () => {
  const { room, c, p } = fixture(),
    q = { ...p, id: 'q' };
  room.players.set(q.id, q);
  assert.ok(handleCompanion524Action(room, p, 'pet524', 10000));
  assert.equal(c.followPlayerId, p.id);
  assert.equal(handleCompanion524Action(room, q, 'pet524', 10100), false);
  assert.equal(handleCompanion524Action(room, q, 'dismiss524', 10100), false);
  assert.ok(handleCompanion524Action(room, q, 'pet524', 11200));
  assert.equal(c.petSequence, 2);
  assert.equal(c.followPlayerId, q.id);
  assert.equal(handleCompanion524Action(room, p, 'dismiss524', 12000), false);
  assert.ok(handleCompanion524Action(room, q, 'dismiss524', 12000));
  assert.equal(c.mode, 'returning');
});

test('real melee impact moves 524 in the strike direction and repeat blows accumulate displacement without death', () => {
  const { room, c, p } = fixture();
  assert.deepEqual(
    damageableTargets(room).map((r) => r.kind),
    ['companion524'],
  );
  let now = 10000;
  for (const [dx, dz] of [
    [0, -1],
    [0, -1],
    [1, 0],
    [-1, 0],
    [0, 1],
  ]) {
    const before = { x: c.x, z: c.z };
    Object.assign(p, { x: c.x - dx * 1.5, z: c.z - dz * 1.5, facing: Math.atan2(dx, dz) });
    assert.ok(startAttack(room, p, {}, now).accepted);
    assert.equal(resolveAttack(room, p, now + 332), null);
    const strike = resolveAttack(room, p, now + 333);
    assert.equal(strike?.kind, 'companion524');
    assert.equal(strike.killed, false);
    assert.equal(c.x, before.x);
    advance(room, now + 333, 0.65);
    assert.ok((c.x - before.x) * dx + (c.z - before.z) * dz > 0.65);
    assert.equal(c.health, undefined);
    assert.equal(c.phase, undefined);
    assert.equal(c.followPlayerId, null);
    now += 1400;
  }
  assert.equal(c.hitSequence, 5);
  const after = { x: c.x, z: c.z };
  advance(room, now, 10);
  assert.ok(distance(c, after) < 0.02, 'idle companion stays where successive hits moved it');
});

test('attack arc, reach, walls and magic projectile direction remain authoritative', () => {
  const { room, c, p } = fixture();
  p.facing = 0;
  startAttack(room, p, {}, 10000);
  assert.equal(resolveAttack(room, p, 10333).hit, false);
  p.facing = Math.PI;
  p.z = c.z + 8;
  startAttack(room, p, {}, 12000);
  assert.equal(resolveAttack(room, p, 12333).hit, false);
  p.species = 'bear';
  startAttack(room, p, {}, 20000);
  resolveAttack(room, p, 20400);
  const events = updateProjectiles(room, 21600);
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'companion524');
  assert.ok(c.hitDirectionZ < -0.99);
  assert.equal(c.hitSequence, 1);
  room.collision = new CollisionWorld(
    [{ type: 'box', id: 'wall', x: c.x, z: c.z + 1, hx: 4, hz: 0.2, c: 1, s: 0 }],
    { coast: false, walkSurfaces: [] },
  );
  p.species = 'cro';
  p.z = c.z + 2;
  startAttack(room, p, { targetId: c.id }, 30000);
  assert.equal(resolveAttack(room, p, 30333).hit, false);
});

test('knockback is independent of tick rate, stops at walls and remains hittable', () => {
  const fine = fixture(),
    coarse = fixture();
  for (const f of [fine, coarse]) hitCompanion524(f.c, 1, 0, 10000);
  advance(fine.room, 10000, 0.6, 0.01);
  advance(coarse.room, 10000, 0.6, 0.15);
  assert.ok(distance(fine.c, coarse.c) < 0.001);
  const wall = {
    type: 'box',
    id: 'rock',
    x: fine.c.home.x + 1,
    z: fine.c.z,
    hx: 0.2,
    hz: 4,
    c: 1,
    s: 0,
  };
  const f = fixture([wall]);
  for (let i = 0; i < 20; i++) {
    hitCompanion524(f.c, 1, 0, 10000 + i * 700);
    advance(f.room, 10000 + i * 700, 0.7);
    assert.ok(f.c.x < wall.x - wall.hx);
  }
  assert.equal(f.c.hitSequence, 20);
});

test('follower stays behind a moving player and returns through its route around an obstacle', () => {
  const f = fixture();
  const { c, p, room } = f;
  handleCompanion524Action(room, p, 'pet524', 10000);
  p.facing = 0;
  p.speed = 3;
  let now = 12000;
  for (let i = 0; i < 140; i++) {
    p.z += 0.15;
    now += 50;
    updateCompanion524(room, 0.05, now);
  }
  assert.ok(c.z < p.z);
  assert.ok(distance(c, p) < 3);
  assert.ok(c.trail.length > 8);
  assert.ok(handleCompanion524Action(room, p, 'dismiss524', now));
  advance(room, now, 20);
  assert.equal(c.mode, 'idle');
  assert.ok(distance(c, c.home) < 0.01);

  // A wall separates the companion from a follower who walked around its end.
  room.collision = new CollisionWorld(
    [{ type: 'box', id: 'rock', x: c.x, z: c.z + 5, hx: 3, hz: 0.4, c: 1, s: 0 }],
    { coast: false, walkSurfaces: [] },
  );
  p.x = c.x;
  p.z = c.z + 1.8;
  p.facing = 0;
  p.speed = 0;
  handleCompanion524Action(room, p, 'pet524', now + 21000);
  p.z = c.z + 11;
  advance(room, now + 23000, 15);
  assert.ok(c.z > c.home.z + 7, 'route goes around wall');
  handleCompanion524Action(room, p, 'dismiss524', now + 40000);
  advance(room, now + 40000, 25);
  assert.equal(c.mode, 'idle');
  assert.ok(distance(c, c.home) < 0.01);
});

for (const reason of ['disconnect', 'downed', 'boat', 'warp'])
  test(`${reason} releases ownership and returns without teleporting 524`, () => {
    const { room, c, p } = fixture();
    handleCompanion524Action(room, p, 'pet524', 10000);
    p.facing = 0;
    p.z += 8;
    advance(room, 12000, 5);
    if (reason === 'disconnect') room.players.clear();
    if (reason === 'downed') p.downedUntil = 99999;
    if (reason === 'boat') p.boatId = 'boat';
    if (reason === 'warp') p.x += 200;
    const before = { x: c.x, z: c.z };
    updateCompanion524(room, 0.05, 18000);
    assert.equal(c.followPlayerId, null);
    assert.ok(distance(before, c) < 0.3);
    advance(room, 18000, 12);
    assert.equal(c.mode, 'idle');
  });

test('a resource that regrows on the remembered route does not strand the returning companion', () => {
  const { room, c, p } = fixture();
  handleCompanion524Action(room, p, 'pet524', 10000);
  p.facing = 0;
  p.z += 12;
  advance(room, 12000, 8);
  const blocked = c.trail[2];
  assert.ok(blocked && distance(blocked, c) > 3);
  room.collision = new CollisionWorld(
    [{ type: 'circle', id: 'regrown-wood', ...blocked, radius: 0.75 }],
    { coast: false, river: false, walkSurfaces: [] },
  );
  handleCompanion524Action(room, p, 'dismiss524', 20000);
  advance(room, 20000, 25);
  assert.equal(c.mode, 'idle');
  assert.ok(distance(c, c.home) < 0.01);
});

test('wire snapshots expose no routing internals; old and malformed saves restore safely', () => {
  const { room, c } = fixture();
  const s = companion524Snapshot(c);
  for (const key of ['trail', 'path', 'goal', 'velocityX', 'velocityZ', 'home'])
    assert.equal(key in s, false);
  s.x = 999;
  assert.notEqual(c.x, 999);
  for (const bad of [null, {}, { x: NaN, z: 50 }, { x: Infinity, z: 1 }]) {
    restoreCompanion524(room, bad);
    assert.deepEqual({ x: room.companion524.x, z: room.companion524.z }, room.companion524.home);
  }
});

test('two clients see one pet and hit state; current and pre-524 persistent saves load', () => {
  let now = 10000,
    id = 0;
  class Socket extends EventEmitter {
    readyState = 1;
    bufferedAmount = 0;
    messages = [];
    send(data) {
      this.messages.push(JSON.parse(data));
    }
    close() {
      this.readyState = 3;
      this.emit('close');
    }
  }
  const runtime = { now: () => now, id: () => `524-${++id}`, token: () => `token-${++id}` };
  const core = createGameCore({ runtime, keepEmptyRooms: true, persistentSessions: true });
  const a = new Socket(),
    b = new Socket();
  for (const s of [a, b]) core.connect(s, new URLSearchParams({ room: 'MASCOT' }));
  const room = core.rooms.get('MASCOT'),
    p = [...room.players.values()][0],
    c = room.companion524;
  Object.assign(p, { x: c.x, z: c.z + 1.5 });
  a.emit('message', Buffer.from(JSON.stringify({ type: 'action', action: 'pet524' })), false);
  assert.equal(c.petSequence, 1);
  assert.deepEqual(a.messages.at(-1).companion524, b.messages.at(-1).companion524);
  assert.equal(b.messages.at(-1).companion524.followPlayerId, p.id);
  now += 1500;
  Object.assign(p, { facing: Math.PI });
  a.emit('message', Buffer.from(JSON.stringify({ type: 'action', action: 'attack' })), false);
  now += attackProfile(p).impactMs;
  core.tick();
  assert.equal(c.hitSequence, 1);
  assert.deepEqual(a.messages.at(-1).companion524, b.messages.at(-1).companion524);
  const saved = core.exportState();
  const restored = createGameCore({ runtime });
  restored.importState(saved);
  assert.equal(restored.rooms.get('MASCOT').companion524.mode, 'returning');
  assert.equal(saved.rooms[0].companion524.mode, 'following', 'restore never mutates checkpoint');
  delete saved.rooms[0].companion524;
  const legacy = createGameCore({ runtime });
  legacy.importState(saved);
  assert.equal(legacy.rooms.get('MASCOT').companion524.mode, 'idle');
});

test('retained original C14 keeps its exact hash, four-second floating clip and twenty bones', async () => {
  const b = await readFile('public/models/yellow-524-mascot/model-c14.glb');
  assert.equal(
    createHash('sha256').update(b).digest('hex'),
    '2652765f480973f6d974d0c51b2bd294c6e4c81e32e369814e09ba6c03c3e418',
  );
  const j = JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)));
  assert.equal(j.skins[0].joints.length, 20);
  assert.deepEqual(
    j.animations.map((a) => a.name),
    ['Floating_Ripple'],
  );
  assert.equal(Math.max(...j.animations[0].samplers.map((s) => j.accessors[s.input].max[0])), 4);
});

test('the selected midpoint delivery keeps all C14 geometry, skin and animation buffers at a 30cm game scale', async () => {
  const manifest = JSON.parse(await readFile('public/models/yellow-524-mascot/asset.json', 'utf8'));
  assert.equal(manifest.revision, 'midpoint-r01');
  assert.equal(manifest.heightMetres, 0.3);
  assert.equal(manifest.placement.scale, COMPANION_524.scale);
  const data = await readFile(`public${manifest.url}`);
  assert.equal(createHash('sha256').update(data).digest('hex'), manifest.sha256);
  const original = await readFile('public/models/yellow-524-mascot/model-c14.glb');
  const parse = (b) => {
    const length = b.readUInt32LE(12),
      doc = JSON.parse(b.subarray(20, 20 + length));
    return {
      doc,
      view(i) {
        const v = doc.bufferViews[i],
          start = 28 + length + (v.byteOffset ?? 0);
        return b.subarray(start, start + v.byteLength);
      },
    };
  };
  const a = parse(original),
    b = parse(data),
    image = a.doc.images[0].bufferView;
  for (let i = 0; i < a.doc.bufferViews.length; i++)
    if (i !== image) assert.deepEqual(a.view(i), b.view(i), `unchanged non-image buffer ${i}`);
  assert.notDeepEqual(a.view(image), b.view(image), 'the selected color is actually delivered');
  for (const key of ['nodes', 'meshes', 'skins', 'accessors', 'animations'])
    assert.deepEqual(a.doc[key], b.doc[key]);
  const position = b.doc.accessors[b.doc.meshes[0].primitives[0].attributes.POSITION];
  assert.ok(Math.abs((position.max[1] - position.min[1]) * COMPANION_524.scale - 0.3) < 1e-8);
});

test('restoring an older metre-tall 524 keeps its position but uses the new small-body radius', () => {
  const { room, c } = fixture();
  const saved = { ...c, x: c.x + 2, radius: 0.58 };
  restoreCompanion524(room, saved);
  assert.equal(room.companion524.x, saved.x);
  assert.equal(room.companion524.radius, COMPANION_524.radius);
  assert.equal(saved.radius, 0.58);
});
