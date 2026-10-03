import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createGameCore } from '../dist/application/game-core.mjs';
import { ownedBotKinds } from '../dist/shared/orb-bots.mjs';

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
  terminate() {
    this.close();
  }
}

function fixture() {
  let now = 10000,
    id = 0;
  const runtime = { now: () => now, id: () => `pet-${++id}`, token: () => `session-${++id}` };
  const options = { runtime, persistentSessions: true, keepEmptyRooms: true };
  let core = createGameCore(options);
  function join(session = '') {
    const socket = new Socket();
    core.connect(socket, new URLSearchParams({ room: 'BOND', resume: '1', session }));
    const welcome = socket.messages.find((m) => m.type === 'welcome');
    assert.ok(welcome);
    return { socket, welcome };
  }
  const owner = join();
  const observer = join();
  const step = (seconds) => {
    for (let i = 0; i < Math.round(seconds / 0.05); i++) {
      now += 50;
      core.tick();
    }
  };
  const room = () => core.rooms.get('BOND');
  const player = () => room().players.get(owner.welcome.id);
  Object.assign(player(), { x: room().companion524.x, z: room().companion524.z + 1.5 });
  player().inventory.wood = 7;
  function action(name, kind, socket = owner.socket) {
    now += 200;
    socket.emit(
      'message',
      Buffer.from(JSON.stringify({ type: 'action', action: name, targetId: kind })),
      false,
    );
  }
  return {
    owner,
    observer,
    room,
    player,
    join,
    step,
    action,
    get core() {
      return core;
    },
    get bot() {
      return room().orbBots.find((b) => b.kind === '524');
    },
    elapse(ms) {
      now += ms;
      core.tick();
    },
    recruit() {
      action('pet524');
      step(5);
      assert.equal(room().companion524.squadPlayerId, owner.welcome.id);
      assert.equal(this.bot.ownerId, owner.welcome.id);
    },
    restart() {
      const saved = core.exportState();
      const before = structuredClone(saved);
      core = createGameCore(options);
      core.importState(saved);
      assert.deepEqual(saved, before, 'loading never mutates the checkpoint');
      return saved;
    },
  };
}

test('a completed bond has no online or offline time limit and remains throwable after session resume', () => {
  const f = fixture();
  f.recruit();
  for (const days of [1, 7, 365]) {
    f.elapse(days * 86400000);
    assert.equal(f.room().companion524.squadPlayerId, f.owner.welcome.id);
    assert.equal(ownedBotKinds(f.core.snapshot(f.room()).orbBots, f.owner.welcome.id).length, 1);
  }
  f.owner.socket.close();
  f.elapse(365 * 86400000);
  assert.equal(f.room().companion524.squadPlayerId, f.owner.welcome.id);
  const next = f.join(f.owner.welcome.session);
  assert.equal(next.welcome.id, f.owner.welcome.id);
  assert.equal(next.welcome.resumed, true);
  assert.equal(f.player().inventory.wood, 7);
  f.step(2);
  f.action('throwBot', '524', next.socket);
  f.step(2);
  assert.equal(f.bot.mode, 'waiting');
  f.action('recallBots', undefined, next.socket);
  f.step(5);
  assert.equal(f.bot.mode, 'following');
});

for (const phase of ['following', 'airborne', 'waiting', 'returning'])
  test(`saved ${phase} 524 stays recruited after restart; deployed bodies wait for a call`, () => {
    const f = fixture();
    f.recruit();
    if (phase !== 'following') {
      f.action('throwBot', '524');
      f.step(phase === 'airborne' ? 0.4 : 2);
      if (phase === 'returning') {
        f.action('recallBots');
        f.step(0.1);
      }
      assert.equal(f.bot.mode, phase);
    }
    const deployed = ['airborne', 'waiting'].includes(phase);
    const destination = phase === 'airborne' ? { ...f.bot.landing } : { ...f.bot };
    const saved = f.restart();
    const savedCompanion = saved.rooms[0].companion524;
    assert.equal(savedCompanion.squadPlayerId, f.owner.welcome.id);
    assert.equal(savedCompanion.squadMode, deployed ? 'waiting' : 'following');
    f.elapse(86400000 * 365);
    const c = f.room().companion524;
    assert.equal(c.squadPlayerId, f.owner.welcome.id);
    assert.equal(c.petPlayerId, null);
    const next = f.join(f.owner.welcome.session);
    assert.equal(next.welcome.resumed, true);
    f.step(3);
    assert.equal(f.room().orbBots.filter((b) => b.kind === '524').length, 1);
    assert.equal(f.player().inventory.wood, 7);
    assert.equal(f.bot.mode, deployed ? 'waiting' : 'following');
    if (deployed) {
      assert.deepEqual({ x: c.x, z: c.z }, { x: destination.x, z: destination.z });
      f.action('recallBots', undefined, next.socket);
      f.step(5);
    }
    f.action('throwBot', '524', next.socket);
    f.step(2);
    assert.equal(f.bot.mode, 'waiting');
    const wire = f.core.snapshot(f.room(), true);
    assert.ok(!JSON.stringify(wire).includes(f.owner.welcome.session));
    assert.equal(wire.orbBots.filter((b) => b.kind === '524').length, 1);
  });

test('an explicit goodbye persists, and an interrupted pet never becomes a saved bond', () => {
  for (const complete of [false, true]) {
    const f = fixture();
    if (complete) {
      f.recruit();
      f.action('dismiss524');
    } else {
      f.action('pet524');
      f.step(0.1);
    }
    f.restart();
    const next = f.join(f.owner.welcome.session);
    f.step(5);
    assert.equal(f.room().companion524.squadPlayerId, null);
    f.action('throwBot', '524', next.socket);
    f.step(2);
    assert.equal(f.bot, undefined);
    assert.equal(ownedBotKinds(f.core.snapshot(f.room()).orbBots, next.welcome.id).length, 0);
  }
});
