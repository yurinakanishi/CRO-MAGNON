import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameCore } from '../dist/application/game-core.mjs';
import { JUMP, jumpHeight, jumpProgress } from '../dist/shared/jumping.mjs';
import { CHARACTER_MODELS } from '../dist/shared/characters.mjs';
import { CollisionWorld } from '../dist/shared/collision.mjs';
import { GamepadInput, PAD } from '../dist/src/gamepad-input.js';
import { LocalPrediction } from '../dist/src/local-prediction.js';
import { canStartAttack } from '../dist/src/combat-input.js';

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
  close() {
    this.readyState = 3;
    this.handlers.close?.();
  }
  command(message) {
    this.handlers.message({ toString: () => JSON.stringify(message) }, false);
  }
}
function fixture(profile = {}) {
  let now = 100000,
    id = 0;
  const runtime = { now: () => now, id: () => `jump-${++id}`, token: () => `token-${++id}` };
  const core = createGameCore({ runtime, keepEmptyRooms: true });
  const socket = new Socket();
  core.connect(socket, new URLSearchParams({ room: 'JUMP', resume: '1', ...profile }));
  const welcome = socket.messages.find((m) => m.type === 'welcome');
  const room = core.rooms.get('JUMP'),
    player = room.players.get(welcome.id);
  return {
    core,
    room,
    player,
    socket,
    runtime,
    welcome,
    now: () => now,
    advance: (ms) => {
      now += ms;
      core.tick();
    },
    jump: (extra = {}) => socket.command({ type: 'action', action: 'jump', ...extra }),
  };
}

test('all six profiles jump with server time, ignore forged physics and reject midair/recovery repeats', () => {
  for (const profile of CHARACTER_MODELS) {
    const f = fixture({ species: profile.species, gender: profile.gender });
    const before = {
      x: f.player.x,
      z: f.player.z,
      inventory: structuredClone(f.player.inventory),
      energy: f.player.energy,
    };
    f.jump({ jumpAt: 1, height: 999, y: 400, x: -4000, jumpSequence: 900 });
    assert.equal(f.player.jumpAt, f.now());
    assert.equal(f.player.jumpSequence, 1);
    assert.equal(jumpHeight(f.player, f.now()), 0);
    assert.equal(jumpHeight(f.player, f.now() + JUMP.durationMs / 2), JUMP.height);
    f.advance(100);
    f.jump();
    assert.equal(f.player.jumpSequence, 1);
    f.advance(JUMP.durationMs - 100);
    f.jump();
    assert.equal(f.player.jumpSequence, 1);
    assert.equal(jumpProgress(f.player, f.now()), null);
    assert.equal(jumpHeight(f.player, f.now()), 0);
    f.advance(JUMP.cooldownMs - JUMP.durationMs);
    f.jump();
    assert.equal(f.player.jumpSequence, 2);
    assert.deepEqual(
      { x: f.player.x, z: f.player.z, inventory: f.player.inventory, energy: f.player.energy },
      before,
    );
  }
});

test('jump broadcasts one timestamp to peers and legacy / delayed snapshots stay grounded', () => {
  const f = fixture(),
    peer = new Socket();
  f.core.connect(peer, new URLSearchParams({ room: 'JUMP', name: 'observer' }));
  f.jump();
  const snapshots = [f.socket, peer].map((s) =>
    s.messages.filter((m) => m.type === 'state').at(-1),
  );
  for (const snap of snapshots) {
    const p = snap.players.find((p) => p.id === f.player.id);
    assert.equal(p.jumpAt, f.now());
    assert.equal(p.jumpSequence, 1);
    assert.equal(jumpHeight(p, snap.serverTime + 360), 1);
    assert.equal(jumpHeight(p, snap.serverTime + 10000), 0);
  }
  assert.equal(jumpProgress({}, f.now()), null);
  assert.equal(jumpProgress({ jumpAt: NaN, jumpSequence: 1 }, f.now()), null);
  assert.equal(jumpProgress({ jumpAt: f.now() + 1, jumpSequence: 1 }, f.now()), null);
});

test('riding, boating, defeat and an ongoing attack reject jump without canceling work', () => {
  for (const state of [
    { mountId: 'mount' },
    { boatId: 'boat' },
    { downedUntil: 105000 },
    { attackAt: 100000, attackSequence: 1 },
  ]) {
    const f = fixture();
    Object.assign(f.player, state, { cookingEndsAt: 103000 });
    f.jump();
    assert.equal(f.player.jumpSequence, 0);
    assert.equal(f.player.cookingEndsAt, 103000);
  }
});

test('jump cancels unfinished cooking, fishing and coastal work without consuming materials', () => {
  const f = fixture();
  const inventory = structuredClone(f.player.inventory);
  f.player.cookingEndsAt = f.now() + 3000;
  f.player.fishing = { spotId: 'test', startedAt: f.now(), endsAt: f.now() + 6000 };
  f.player.coastalActivity = {
    kind: 'knap',
    siteId: 'test',
    startedAt: f.now(),
    endsAt: f.now() + 4000,
  };
  f.jump();
  assert.equal(f.player.cookingEndsAt, 0);
  assert.equal(f.player.fishing, null);
  assert.equal(f.player.coastalActivity, null);
  assert.deepEqual(f.player.inventory, inventory);
  f.advance(6000);
  assert.deepEqual(f.player.inventory, inventory);
});

test('airborne actions, expeditions and barter cannot bypass ground interactions; attack resumes after landing', () => {
  const f = fixture();
  f.player.inventory.wood = 9;
  f.player.inventory.stone = 9;
  f.jump();
  const origin = { x: f.player.x, z: f.player.z };
  for (const action of ['craft', 'ride', 'boardBoat', 'rift', 'attack']) {
    f.player.lastAction = 0;
    f.socket.command({ type: 'action', action });
  }
  f.socket.command({ type: 'expedition', destination: 'gulf-hearth' });
  f.socket.command({ type: 'barter', kind: 'invite', targetId: 'peer' });
  assert.equal(f.player.tool, false);
  assert.equal(f.player.attackSequence, 0);
  assert.equal(f.player.inventory.wood, 9);
  assert.equal(f.player.inventory.stone, 9);
  assert.deepEqual({ x: f.player.x, z: f.player.z }, origin);
  assert.equal(canStartAttack(f.player, f.now()), false);
  f.advance(JUMP.durationMs);
  f.socket.command({ type: 'action', action: 'attack' });
  assert.equal(f.player.attackSequence, 1);
});

test('moving jump preserves run speed, follows terrain collision and stops at walls', () => {
  for (const running of [false, true]) {
    const f = fixture();
    f.room.collision = new CollisionWorld(
      [{ type: 'box', x: 49.5, z: 57, hx: 0.1, hz: 3, c: 1, s: 0, height: 3 }],
      { river: false },
    );
    f.socket.command({ type: 'move', dx: 1, dz: 0, running });
    f.jump();
    const start = f.player.x;
    for (let i = 0; i < 14; i++) {
      f.socket.command({ type: 'move', dx: 1, dz: 0, running });
      f.advance(50);
      assert.ok(f.player.x <= 49.4 - f.player.radius + 0.001);
      assert.ok(f.room.collision.free(f.player, f.player.radius));
    }
    assert.ok(f.player.x > start);
    f.socket.command({ type: 'move', dx: 0, dz: 0 });
    f.advance(100);
    assert.equal(f.player.speed, 0);
    assert.equal(jumpHeight(f.player, f.now()), 0);
  }
});

test('jump does not cancel a click route and menu stop still lands', () => {
  const f = fixture();
  f.player.target = { x: f.player.x + 0.5, z: f.player.z };
  f.player.path = [];
  const target = f.player.target;
  f.jump();
  assert.equal(f.player.target, target);
  const notices = f.socket.messages.filter((m) => m.type === 'notice').length;
  for (const action of ['cancelFishing', 'cancelCoastal', 'cancelCook'])
    f.socket.command({ type: 'action', action });
  assert.equal(f.socket.messages.filter((m) => m.type === 'notice').length, notices);
  f.advance(50);
  assert.ok(f.player.x > target.x - 0.5);
  f.socket.command({ type: 'move', dx: 0, dz: 0 });
  f.advance(50);
  assert.equal(f.player.target, null);
  assert.ok(jumpHeight(f.player, f.now()) > 0);
  f.advance(1000);
  assert.equal(jumpHeight(f.player, f.now()), 0);
});

test('LAN display prediction retains the authoritative arc during horizontal movement', () => {
  const f = fixture();
  f.jump();
  const p = f.core.snapshot(f.room).players[0],
    prediction = new LocalPrediction();
  prediction.enabled = true;
  prediction.receive(p, 0);
  prediction.setInput(1, 0, true, 0);
  const actor = prediction.step(
    0.05,
    50,
    f.now() + 50,
    new CollisionWorld([], { river: false }),
    [],
  );
  assert.ok(actor.x > p.x);
  assert.equal(actor.jumpAt, p.jumpAt);
  assert.equal(jumpHeight(actor, f.now() + 360), 1);
});

test('reconnect and export/import restore on the ground without mutating live jumping', () => {
  const f = fixture();
  f.jump();
  const save = f.core.exportState();
  assert.equal(save.rooms[0].sessions[0].player.jumpAt, undefined);
  assert.equal(f.player.jumpSequence, 1);
  const restored = createGameCore({ runtime: f.runtime });
  restored.importState(save);
  const fresh = new Socket();
  restored.connect(
    fresh,
    new URLSearchParams({ room: 'JUMP', resume: '1', session: f.welcome.session }),
  );
  assert.equal(restored.rooms.get('JUMP').players.get(f.player.id).jumpSequence, 0);
  f.socket.close();
  const resume = new Socket();
  f.core.connect(
    resume,
    new URLSearchParams({ room: 'JUMP', resume: '1', session: f.welcome.session }),
  );
  assert.equal(f.player.jumpSequence, 0);
});

test('L2 jumps once per press, ignores menus and requires release across focus changes', () => {
  const input = new GamepadInput(),
    pad = {
      id: 'standard',
      index: 0,
      connected: true,
      mapping: 'standard',
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 18 }, () => ({ pressed: false, value: 0 })),
    };
  const sample = (mode = 'game') => input.sample([pad], mode, 0).actions;
  const press = (value) => {
    pad.buttons[PAD.l2] = { pressed: value, value: value ? 1 : 0 };
  };
  sample();
  press(true);
  assert.deepEqual(sample(), ['jump']);
  assert.deepEqual(sample(), []);
  press(false);
  sample();
  press(true);
  assert.deepEqual(sample(), ['jump']);
  sample('menu');
  assert.deepEqual(sample('menu'), []);
  assert.deepEqual(sample('game'), []);
  press(false);
  sample();
  press(true);
  assert.deepEqual(sample(), ['jump']);
  input.suspend();
  assert.deepEqual(sample(), []);
});
