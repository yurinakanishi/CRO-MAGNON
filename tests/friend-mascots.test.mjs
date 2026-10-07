import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
const { createGameCore } = await import('../dist/application/game-core.mjs');
import { CollisionWorld } from '../dist/shared/collision.mjs';
import { CAMP } from '../dist/shared/world.mjs';
import {
  FRIEND_MASCOTS,
  FRIEND_TIMING,
  createFriendMascots,
  friendSnapshot,
} from '../dist/shared/friend-mascots.mjs';
import { MASCOT_KEYS } from '../dist/shared/mascot-selection.mjs';
import { mascotMenuMarkup } from '../dist/src/mascot-menu.js';
import { titleContributors, CONTRIBUTOR_CHARACTERS } from '../dist/src/title-credits.js';
import { CAVE_EXTRA_PIGMENTS, CAVE_MURALS } from '../dist/src/cave-gallery-layout.js';

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
  ping() {
    this.emit('pong');
  }
}
function fixture(key = 'saber-mascot') {
  let now = 10000,
    id = 0;
  const options = {
    runtime: { now: () => now, id: () => `f-${++id}`, token: () => `s-${++id}` },
    persistentSessions: true,
    keepEmptyRooms: true,
  };
  let core = createGameCore(options);
  const join = () => {
    const socket = new Socket();
    core.connect(socket, new URLSearchParams({ room: 'FRIENDS', resume: '1' }));
    return { socket, welcome: socket.messages.find((m) => m.type === 'welcome') };
  };
  const owner = join(),
    observer = join();
  const room = () => core.rooms.get('FRIENDS');
  room().collision = new CollisionWorld([], { coast: false, river: false, walkSurfaces: [] });
  room().animals = [];
  room().enemies = [];
  const friend = () => room().friends.find((f) => f.key === key);
  const player = () => room().players.get(owner.welcome.id);
  Object.assign(player(), { x: friend().x, z: friend().z - 1, facing: 0 });
  const action = (action, targetId, actor = owner) => {
    now += 200;
    actor.socket.emit(
      'message',
      Buffer.from(JSON.stringify({ type: 'action', action, targetId })),
      false,
    );
  };
  const step = (seconds) => {
    for (let i = 0; i < seconds * 20; i++) {
      now += 50;
      core.tick();
    }
  };
  return {
    room,
    friend,
    player,
    owner,
    observer,
    action,
    step,
    get core() {
      return core;
    },
    restore(saved) {
      core = createGameCore(options);
      core.importState(saved);
    },
  };
}

test('every contributor friend stands apart at the first camp in the real world', () => {
  let now = 10000;
  const core = createGameCore({ runtime: { now: () => now, id: () => 'w', token: () => 't' } });
  core.connect(new Socket(), new URLSearchParams({ room: 'CAMPFRIENDS' }));
  const room = core.rooms.get('CAMPFRIENDS');
  const collision = room.collision;
  const friends = room.friends;
  assert.deepEqual(
    createFriendMascots(collision).map((f) => [f.key, f.x, f.z]),
    friends.map((f) => [f.key, f.x, f.z]),
  );
  assert.equal(friends.length, FRIEND_MASCOTS.length);
  for (const f of friends) {
    assert.ok(collision.free(f, f.radius), f.key);
    assert.ok(Math.hypot(f.x - CAMP.x, f.z - CAMP.z) < 8, f.key);
    for (const g of friends)
      if (f !== g) assert.ok(Math.hypot(f.x - g.x, f.z - g.z) > f.radius + g.radius, f.key);
  }
  assert.deepEqual(
    Object.keys(friendSnapshot(friends[0])).sort(),
    [
      'facing',
      'followPlayerId',
      'hitAt',
      'hitDirectionX',
      'hitDirectionZ',
      'hitSequence',
      'id',
      'key',
      'mode',
      'petAt',
      'petContactAt',
      'petFacing',
      'petHeight',
      'petPlayerId',
      'petSequence',
      'radius',
      'x',
      'z',
    ].sort(),
    'the public snapshot omits routes and velocities',
  );
});

test('petting bonds a friend, it follows its person, and dismissing walks it home', () => {
  const f = fixture();
  const c = f.friend();
  f.action('petFriend', 'saber-mascot');
  assert.equal(c.petPlayerId, f.owner.welcome.id);
  assert.equal(c.followPlayerId, f.owner.welcome.id);
  f.step(0.8);
  assert.ok(c.petContactAt > 0, 'reaches the hand');
  f.step((FRIEND_TIMING.petStrokeMs + FRIEND_TIMING.happyMs) / 1000 + 0.2);
  assert.equal(c.petPlayerId, null);
  assert.equal(c.mode, 'following');
  const before = c.x;
  f.player().x += 5;
  f.step(3);
  assert.ok(c.x > before + 1, 'follows');
  f.action('dismissFriend', 'saber-mascot');
  f.step(15);
  assert.equal(c.followPlayerId, null);
  assert.equal(c.mode, 'idle');
  assert.ok(Math.hypot(c.x - c.home.x, c.z - c.home.z) < 0.08);
  assert.equal(c.facing, c.homeFacing);
});

test("another player's friend and a second simultaneous pet are refused", () => {
  const f = fixture();
  const c = f.friend();
  f.action('selectMascot', 'saber-mascot');
  assert.equal(c.followPlayerId, f.owner.welcome.id);
  const q = f.room().players.get(f.observer.welcome.id);
  Object.assign(q, { x: c.x, z: c.z - 1 });
  f.action('petFriend', 'saber-mascot', f.observer);
  assert.equal(c.petPlayerId, null);
  f.action('petFriend', 'saber-mascot');
  assert.equal(c.petPlayerId, f.owner.welcome.id);
  const other = f.room().friends.find((g) => g.key === 'otani-mascot');
  Object.assign(other, { x: f.player().x + 0.5, z: f.player().z });
  f.action('petFriend', 'otani-mascot');
  assert.equal(other.petPlayerId, null, 'one stroke at a time');
  f.action('petFriend', 'no-such-friend');
  f.action('petFriend', '__proto__');
});

test('a strike makes a friend recoil without health or loot, and saves restore its owner', () => {
  const f = fixture();
  const c = f.friend();
  f.action('selectMascot', 'saber-mascot');
  Object.assign(f.player(), { x: c.x, z: c.z - 0.9, facing: 0 });
  f.action('attack', c.id);
  f.step(1);
  assert.equal(c.hitSequence, 1, 'recoils once');
  assert.equal(c.followPlayerId, f.owner.welcome.id, 'keeps the bond');
  assert.ok(!('health' in c));
  const saved = JSON.parse(JSON.stringify(f.core.exportState()));
  f.restore(saved);
  const restored = f.core.rooms.get('FRIENDS').friends.find((g) => g.key === 'saber-mascot');
  assert.equal(restored.followPlayerId, f.owner.welcome.id);
  assert.equal(restored.petPlayerId, null);
  // Older saves without friends still create every friend at home.
  delete saved.rooms[0].friends;
  f.restore(saved);
  assert.equal(f.core.rooms.get('FRIENDS').friends.length, FRIEND_MASCOTS.length);
});

test('friends are selectable cards, credited, painted, and delivered as verified GLBs', async () => {
  for (const def of FRIEND_MASCOTS) assert.ok(MASCOT_KEYS.includes(def.key));
  const f = fixture();
  const markup = mascotMenuMarkup(f.core.snapshot(f.room()));
  for (const def of FRIEND_MASCOTS) assert.match(markup, new RegExp(`data-mascot="${def.key}"`));
  const people = new Map(titleContributors().map((p) => [p.key, p]));
  for (const def of FRIEND_MASCOTS) {
    const person = people.get(def.credit);
    assert.ok(person?.profile.startsWith('https://x.com/'), def.credit);
    assert.equal(CONTRIBUTOR_CHARACTERS[def.credit].name, def.name);
    assert.ok(
      Object.values(CAVE_EXTRA_PIGMENTS).some((p) => p.subjects.includes(def.key)),
      `${def.key} is painted`,
    );
    const assetPath = `public/models/${def.key}/asset.json`;
    if (!existsSync(assetPath)) continue;
    const asset = JSON.parse(await readFile(assetPath, 'utf8'));
    assert.equal(asset.kind, 'companion');
    for (const record of [asset, ...asset.lods]) {
      const bytes = await readFile('public' + record.url);
      assert.equal(createHash('sha256').update(bytes).digest('hex'), record.sha256);
    }
    assert.ok(Math.abs(asset.heightMetres - def.bodyHeight) < 0.02, def.key);
  }
  for (const key of ['friendsMeadow', 'friendsRiver'])
    assert.ok(CAVE_MURALS.some((m) => m.motif === key && m.wall === 'west'));
  assert.ok(people.get('risa')?.mural === 'こはくちゃん');
  assert.ok(people.get('hawkie')?.mural === 'Howkey');
});
