import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createGameCore } from '../dist/application/game-core.mjs';
import { CollisionWorld } from '../dist/shared/collision.mjs';
import { ALL_MASCOT_MODELS } from '../dist/shared/mascot-roster.mjs';
import { MASCOT_FAREWELL_MS, hitCompanion } from '../dist/shared/companions.mjs';
import { BOT_KINDS, ORB_BOTS } from '../dist/shared/orb-bots.mjs';
import {
  MASCOT_KEYS,
  activeMascot,
  formerMascotBonds,
  mascotKeyOf,
} from '../dist/shared/mascot-selection.mjs';
import { damageableTargets } from '../dist/shared/combat.mjs';

class Socket extends EventEmitter {
  readyState = 1;
  bufferedAmount = 0;
  messages = [];
  send(raw) {
    this.messages.push(JSON.parse(raw));
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

/** A real game core with a flat, open room and a controllable clock. */
function world({ mascotModels } = {}) {
  let now = 10000,
    serial = 0;
  const options = {
    ...(mascotModels ? { mascotModels } : {}),
    persistentSessions: true,
    keepEmptyRooms: true,
    runtime: { now: () => now, id: () => `id-${++serial}`, token: () => `token-${++serial}` },
  };
  let core = createGameCore(options);
  const room = () => core.rooms.get('PETS');
  const flat = () => {
    room().collision = new CollisionWorld([], { coast: false, river: false, walkSurfaces: [] });
    room().enemies = [];
    room().animals = [];
  };
  const join = (name, session = '', at = { x: 50, z: 50 }) => {
    const socket = new Socket();
    core.connect(socket, new URLSearchParams({ room: 'PETS', resume: '1', session, name }));
    const welcome = socket.messages.find((m) => m.type === 'welcome');
    assert.ok(welcome, `${name} joins`);
    if (room().collision.obstacles.length) flat();
    if (at) Object.assign(room().players.get(welcome.id), at, { facing: 0 });
    return {
      socket,
      welcome,
      id: welcome.id,
      session: welcome.session,
      player: () => room().players.get(welcome.id),
    };
  };
  const act = (who, action, targetId) => {
    now += 500;
    who.socket.emit(
      'message',
      JSON.stringify({ type: 'action', action, ...(targetId === undefined ? {} : { targetId }) }),
    );
  };
  const step = (ms = 50, times = 1) => {
    for (let i = 0; i < times; i++) {
      now += ms;
      core.tick();
    }
  };
  const state = (who) => who.socket.messages.filter((m) => m.type === 'state').at(-1);
  const bodies = () => [...(room().orbBots ?? []), ...(room().companions ?? [])];
  const restart = () => {
    const saved = core.exportState();
    core.close();
    core = createGameCore(options);
    core.importState(saved);
    return saved;
  };
  const load = (saved) => {
    core.close();
    core = createGameCore(options);
    core.importState(saved);
  };
  return {
    core: () => core,
    room,
    join,
    act,
    step,
    state,
    bodies,
    restart,
    load,
    now: () => now,
  };
}
const near = (a, b, range) => Math.hypot(a.x - b.x, a.z - b.z) <= range;
const activeCount = (room, id) =>
  [...room.orbBots, ...room.companions].filter(
    (body) => body.ownerId === id && !body.leavingAt && !body.companionId,
  ).length;

test('a newcomer travels alone: nothing waits at camp, and the welcome names every choice', () => {
  const w = world();
  const a = w.join('A');
  assert.equal(a.player().mascot, null);
  assert.deepEqual(w.bodies(), []);
  assert.deepEqual(a.welcome.mascots, ['rimo-neko', '524', ...BOT_KINDS]);
  w.step(50, 4);
  const snapshot = w.state(a);
  assert.deepEqual(snapshot.companions, []);
  assert.deepEqual(snapshot.orbBots, []);
  assert.equal(snapshot.players[0].mascot, null);
  for (const legacy of ['companion524', 'rimoNeko', 'mae', 'kohaku', 'maruimo', 'friends'])
    assert.ok(!(legacy in snapshot), `${legacy} is no longer a shared world body`);
});

test('each person brings one companion, and any number of people may bring the same one', () => {
  const w = world();
  const a = w.join('A'),
    b = w.join('B', '', { x: 56, z: 50 });
  for (const key of ['524', 'rimo-neko', 'white']) {
    w.act(a, 'selectMascot', key);
    w.act(b, 'selectMascot', key);
    const mine = activeMascot(w.room(), a.id),
      theirs = activeMascot(w.room(), b.id);
    assert.equal(mascotKeyOf(mine), key);
    assert.equal(mascotKeyOf(theirs), key);
    assert.notEqual(mine.id, theirs.id, `two separate ${key} bodies`);
    assert.ok(near(mine, a.player(), 2.5), `${key} arrives beside A`);
    assert.ok(near(theirs, b.player(), 2.5), `${key} arrives beside B`);
    assert.equal(activeCount(w.room(), a.id), 1);
    assert.equal(activeCount(w.room(), b.id), 1);
    assert.equal(a.player().mascot, key);
  }
  // Each throwable companion has exactly one squad entry of its own.
  w.act(a, 'selectMascot', '524');
  const own524 = activeMascot(w.room(), a.id);
  assert.equal(w.room().orbBots.filter((bot) => bot.companionId === own524.id).length, 1);
  w.step(50, 3);
  const snapshot = w.state(a);
  const shared = snapshot.companions.find((c) => c.id === own524.id);
  assert.equal(shared.ownerId, a.id);
  assert.ok(!('path' in shared) && !('velocityX' in shared) && !('petGoal' in shared));
  assert.ok(snapshot.orbBots.every((bot) => !('path' in bot) && !('lastOwner' in bot)));
  assert.equal(snapshot.players.find((p) => p.id === b.id).mascot, 'white');
});

test('a new choice waves the previous companion goodbye; it leaves after the farewell', () => {
  const w = world();
  const a = w.join('A');
  w.act(a, 'selectMascot', 'rimo-neko');
  const cat = activeMascot(w.room(), a.id);
  w.act(a, 'selectMascot', 'blue');
  assert.ok(cat.leavingAt > 0);
  assert.equal(mascotKeyOf(activeMascot(w.room(), a.id)), 'blue');
  assert.ok(!w.room().orbBots.some((bot) => bot.companionId === cat.id), 'no longer thrown');
  w.step(MASCOT_FAREWELL_MS - 100);
  assert.ok(w.room().companions.includes(cat), 'still waving');
  w.step(150);
  assert.ok(!w.room().companions.includes(cat), 'gone after the goodbye');
  w.act(a, 'deselectMascot');
  const dot = w.room().orbBots.find((bot) => bot.ownerId === a.id);
  assert.equal(dot.mode, 'leaving');
  assert.equal(a.player().mascot, null);
  assert.equal(activeMascot(w.room(), a.id), undefined);
  w.step(MASCOT_FAREWELL_MS + 50);
  assert.deepEqual(w.bodies(), []);
  // Choosing nothing again changes nothing.
  const before = a.socket.messages.length;
  w.act(a, 'deselectMascot');
  assert.equal(a.socket.messages.length, before);
});

test('choosing the same companion during its goodbye calls the same body back', () => {
  const w = world();
  const a = w.join('A');
  w.act(a, 'selectMascot', 'green');
  const dot = activeMascot(w.room(), a.id);
  w.act(a, 'deselectMascot');
  assert.equal(dot.mode, 'leaving');
  w.act(a, 'selectMascot', 'green');
  assert.equal(activeMascot(w.room(), a.id), dot);
  assert.equal(dot.leavingAt, 0);
  assert.equal(dot.mode, 'following');
  w.step(MASCOT_FAREWELL_MS + 100);
  assert.ok(w.room().orbBots.includes(dot));

  w.act(a, 'selectMascot', '524');
  const c = activeMascot(w.room(), a.id);
  w.act(a, 'deselectMascot');
  assert.ok(!w.room().orbBots.some((bot) => bot.companionId === c.id));
  w.act(a, 'selectMascot', '524');
  assert.equal(activeMascot(w.room(), a.id), c);
  assert.equal(w.room().orbBots.filter((bot) => bot.companionId === c.id).length, 1);
  assert.equal(activeCount(w.room(), a.id), 1);
});

test('rapid changes never leave a person with more than one travelling companion', () => {
  const w = world();
  const a = w.join('A');
  for (const key of ['white', '524', 'blue', 'rimo-neko', 'white', 'heart'])
    w.act(a, 'selectMascot', key);
  assert.equal(activeCount(w.room(), a.id), 1);
  assert.equal(mascotKeyOf(activeMascot(w.room(), a.id)), 'heart');
  w.step(MASCOT_FAREWELL_MS + 100);
  assert.equal(
    w.bodies().filter((body) => !body.companionId).length,
    1,
    'only the last choice remains',
  );
});

test('unknown, hidden and forged choices are refused, as is a choice while downed', () => {
  const w = world();
  const a = w.join('A');
  for (const key of ['__proto__', 'mae', 'kohaku', 'howkey-scientist', '', 'orb-bot-white'])
    w.act(a, 'selectMascot', key);
  assert.deepEqual(w.bodies(), []);
  assert.equal(a.player().mascot, null);
  a.player().downedUntil = w.now() + 60000;
  w.act(a, 'selectMascot', 'white');
  assert.deepEqual(w.bodies(), []);
  // With the retained roster enabled, the first mascots can be chosen like any other.
  const all = world({ mascotModels: ALL_MASCOT_MODELS });
  const b = all.join('B');
  assert.ok(b.welcome.mascots.includes('mae'));
  assert.deepEqual(b.welcome.mascots, [...MASCOT_KEYS]);
  all.act(b, 'selectMascot', 'mae');
  assert.equal(activeMascot(all.room(), b.id).key, 'mae');
});

for (const key of ['white', '524', 'rimo-neko']) {
  test(`petting another person's ${key} makes it happy and never changes whose it is`, () => {
    const w = world();
    const a = w.join('A'),
      b = w.join('B', '', { x: 54, z: 50 });
    w.act(a, 'selectMascot', key);
    w.step(50, 30);
    const body = activeMascot(w.room(), a.id);
    // B stands beside it, facing it.
    Object.assign(b.player(), { x: body.x + 1.2, z: body.z, facing: -Math.PI / 2 });
    w.act(b, 'petMascot', body.id);
    assert.equal(body.petPlayerId, b.id);
    assert.equal(body.ownerId, a.id);
    // Neither can start a second stroke meanwhile.
    w.act(a, 'petMascot', body.id);
    assert.equal(body.petPlayerId, b.id);
    let reached = false;
    for (let i = 0; i < 150; i++) {
      w.step(50);
      reached ||= body.petContactAt > 0;
      assert.equal(body.ownerId, a.id, 'the owner never changes during the stroke');
    }
    assert.ok(reached, 'it reached the hand');
    assert.equal(body.petPlayerId ?? null, null, 'the stroke finished');
    assert.equal(body.ownerId, a.id);
    assert.equal(activeMascot(w.room(), a.id), body);
    assert.equal(activeMascot(w.room(), b.id), undefined, 'B still travels alone');
    assert.equal(b.player().mascot, null);
    // It walks back to its own person.
    Object.assign(a.player(), { x: a.player().x - 4 });
    w.step(50, 120);
    assert.ok(near(body, a.player(), 3), `${key} rejoined its owner`);
  });
}

test('a thrown dot waits where it landed; others may pet it; only its owner calls it back', () => {
  const w = world();
  const a = w.join('A'),
    b = w.join('B', '', { x: 60, z: 50 });
  w.act(a, 'selectMascot', 'orange');
  w.step(50, 40);
  const dot = activeMascot(w.room(), a.id);
  w.act(a, 'throwBot');
  w.step(50, 40);
  assert.equal(dot.mode, 'waiting');
  const landing = { x: dot.x, z: dot.z };
  assert.ok(landing.z > a.player().z + 2, 'thrown forward');
  // The owner walks away; the dot stays.
  Object.assign(a.player(), { x: 20, z: 20 });
  w.step(50, 40);
  assert.equal(dot.mode, 'waiting');
  assert.ok(near(dot, landing, 0.01));
  // Someone else's recall does nothing to it.
  w.act(b, 'recallBots');
  w.step(50, 10);
  assert.equal(dot.mode, 'waiting');
  // Someone else may pet it; it keeps waiting there afterwards.
  Object.assign(b.player(), { x: dot.x + 1.2, z: dot.z, facing: -Math.PI / 2 });
  w.act(b, 'petMascot', dot.id);
  assert.equal(dot.petPlayerId, b.id);
  w.step(50, 120);
  assert.equal(dot.petPlayerId ?? null, null);
  assert.equal(dot.mode, 'waiting');
  assert.equal(dot.ownerId, a.id);
  assert.ok(near(dot, landing, 1.5));
  // Its owner calls it back from afar.
  w.act(a, 'recallBots');
  w.step(50, 400);
  assert.ok(['following', 'catching'].includes(dot.mode));
  assert.ok(near(dot, a.player(), ORB_BOTS.pickupRange));
});

test('a companion leaves with its person and returns beside them on every return', () => {
  const w = world();
  const a = w.join('A'),
    b = w.join('B', '', { x: 56, z: 50 });
  w.act(a, 'selectMascot', 'rimo-neko');
  w.act(b, 'selectMascot', 'white');
  const first = activeMascot(w.room(), a.id);
  a.socket.close();
  assert.equal(activeMascot(w.room(), a.id), undefined);
  assert.ok(!w.room().orbBots.some((bot) => bot.ownerId === a.id));
  assert.ok(activeMascot(w.room(), b.id), 'other people keep theirs');
  w.step(50, 5);
  const resumed = w.join('A', a.session, null);
  assert.equal(resumed.id, a.id);
  const again = activeMascot(w.room(), a.id);
  assert.equal(again.key, 'rimo-neko');
  assert.notEqual(again.id, first.id);
  assert.ok(near(again, resumed.player(), 2.5));
  // A restart keeps only the choice; the companion arrives on the next return.
  const saved = w.restart();
  for (const legacy of ['orbBots', 'companions', 'companion524', 'rimoNeko', 'friends'])
    assert.ok(!(legacy in saved.rooms[0]), `${legacy} is not saved`);
  assert.deepEqual(w.bodies(), []);
  const back = w.join('A', a.session, null);
  assert.equal(back.player().mascot, 'rimo-neko');
  assert.equal(activeMascot(w.room(), a.id).key, 'rimo-neko');
});

test('saves from shared camp companions give each owner one, in card order', () => {
  const w = world();
  const a = w.join('A'),
    b = w.join('B', '', { x: 54, z: 50 }),
    c = w.join('C', '', { x: 58, z: 50 }),
    d = w.join('D', '', { x: 62, z: 50 }),
    e = w.join('E', '', { x: 66, z: 50 });
  w.act(e, 'selectMascot', 'white');
  w.act(e, 'deselectMascot');
  const saved = w.core().exportState();
  const record = saved.rooms[0];
  record.rimoNeko = { followPlayerId: a.id, x: 1, z: 2 };
  record.companion524 = { squadPlayerId: b.id };
  record.mae = { followPlayerId: c.id };
  record.friends = [{ key: 'saber-mascot', followPlayerId: c.id }];
  record.orbBots = [
    { kind: 'white', ownerId: b.id },
    { kind: 'blue', ownerId: c.id },
    { kind: 'heart', ownerId: c.id },
    { kind: 'green', ownerId: e.id },
  ];
  for (const entry of record.sessions) if (entry.player.id !== e.id) delete entry.player.mascot;
  assert.deepEqual(formerMascotBonds(record).get(c.id), ['mae', 'saber-mascot', 'blue', 'heart']);
  w.load(saved);
  const choice = (id) =>
    [...w.core().rooms.get('PETS').sessions.values()].find((s) => s.player.id === id).player.mascot;
  assert.equal(choice(a.id), 'rimo-neko');
  assert.equal(choice(b.id), '524', '524 comes before a dot');
  assert.equal(choice(c.id), 'blue', 'retired mascots are skipped');
  assert.equal(choice(d.id), null, 'no bond, no companion');
  assert.equal(choice(e.id), null, 'an explicit choice to travel alone is kept');
  const again = w.core().exportState().rooms[0];
  for (const legacy of ['rimoNeko', 'companion524', 'mae', 'friends', 'orbBots'])
    assert.ok(!(legacy in again), `${legacy} is not written back`);
});

test('a walking friend waits out of sight while its person rides, and rejoins after a warp', () => {
  const w = world({ mascotModels: ALL_MASCOT_MODELS });
  const a = w.join('A');
  w.act(a, 'selectMascot', 'kohaku');
  const friend = activeMascot(w.room(), a.id);
  w.step(50, 20);
  assert.equal(friend.squadMode, 'following');
  a.player().mountId = 'mammoth-1';
  w.step(50);
  assert.equal(friend.squadMode, 'stowed');
  assert.ok(!damageableTargets(w.room()).some((t) => t.target === friend));
  Object.assign(a.player(), { x: 80, z: 80, mountId: null });
  w.step(50);
  assert.equal(friend.squadMode, 'following');
  assert.ok(near(friend, a.player(), 2.5));
  Object.assign(a.player(), { x: 30, z: 70, warpSequence: (a.player().warpSequence ?? 0) + 1 });
  w.step(50);
  assert.ok(near(friend, a.player(), 2.5), 'a warp brings it along');
  // It walks after its person.
  Object.assign(a.player(), { x: a.player().x + 5 });
  w.step(50, 80);
  assert.ok(near(friend, a.player(), 2.2));
});

test('a struck companion recoils without changing its owner; goodbyes cannot be struck', () => {
  const w = world();
  const a = w.join('A');
  w.act(a, 'selectMascot', 'rimo-neko');
  const cat = activeMascot(w.room(), a.id);
  assert.ok(damageableTargets(w.room()).some((t) => t.target === cat && t.kind === 'companion'));
  hitCompanion(cat, 1, 0, w.now());
  assert.ok(cat.velocityX > 0);
  assert.equal(cat.ownerId, a.id);
  w.act(a, 'deselectMascot');
  assert.ok(!damageableTargets(w.room()).some((t) => t.target === cat));
});
