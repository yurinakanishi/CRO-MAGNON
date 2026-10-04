import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { CollisionWorld } from '../dist/shared/collision.mjs';
import { createGameCore } from '../dist/application/game-core.mjs';
import {
  createRimoNeko,
  handleRimoNekoAction,
  updateRimoNeko,
  nearRimoNeko,
  hitRimoNeko,
  restoreRimoNeko,
  saveRimoNeko,
  RIMO_NEKO,
} from '../dist/shared/rimo-neko.mjs';
import { createCompanion524, updateCompanion524 } from '../dist/shared/companion-524.mjs';
import {
  syncOrbBots,
  updateOrbBots,
  handleOrbBotAction,
  ownedBotKinds,
  nearbyOrbBotsForWhistle,
  botRadius,
  ORB_BOTS,
  BOT_ORDER,
  saveOrbBots,
} from '../dist/shared/orb-bots.mjs';
import { damageableTargets } from '../dist/shared/combat.mjs';
const gap = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
function fixture() {
  const collision = new CollisionWorld([], { coast: false, river: false, walkSurfaces: [] });
  const p = {
    id: 'p',
    x: 48,
    z: 54,
    facing: 0,
    radius: 0.32,
    speed: 0,
    species: 'cro',
    gender: 'female',
    attackAt: 0,
    attackSequence: 0,
    jumpAt: 0,
    jumpSequence: 0,
  };
  const q = { ...p, id: 'q', x: 50 };
  const room = {
    collision,
    players: new Map([
      [p.id, p],
      [q.id, q],
    ]),
    sessions: new Map([
      ['p', { player: p }],
      ['q', { player: q }],
    ]),
    animals: [],
    enemies: [],
    rimoNeko: createRimoNeko(collision),
    companion524: createCompanion524(collision),
  };
  let now = 10000;
  syncOrbBots(room, now);
  return {
    p,
    q,
    room,
    get now() {
      return now;
    },
    get c() {
      return room.rimoNeko;
    },
    get bot() {
      return room.orbBots.find((b) => b.kind === 'rimo-neko');
    },
    act(action, kind, player = p) {
      return handleOrbBotAction(room, player, action, kind, now);
    },
    step(seconds) {
      for (let i = 0; i < Math.round(seconds / 0.05); i++) {
        now += 50;
        updateRimoNeko(room, 0.05, now);
        updateCompanion524(room, 0.05, now);
        updateOrbBots(room, 0.05, now);
        for (const b of room.orbBots) {
          assert.ok([b.x, b.y, b.z].every(Number.isFinite));
          if (!['windup', 'airborne', 'stowed'].includes(b.mode))
            assert.ok(collision.free(b, botRadius(b.kind)));
        }
      }
    },
    pet() {
      Object.assign(p, { x: room.rimoNeko.x, z: room.rimoNeko.z + 1.5 });
      assert.ok(handleRimoNekoAction(room, p, 'petRimo', now));
      this.step(6);
    },
  };
}

test('zero companions: one whistle invites nine dots, 524 and the cat without petting', () => {
  const f = fixture();
  assert.equal(ownedBotKinds(f.room.orbBots, f.p.id).length, 0);
  assert.equal(
    nearbyOrbBotsForWhistle(f.room.orbBots, f.p, f.room.collision, f.now, new Set(['p', 'q']))
      .length,
    9,
  );
  assert.ok(f.act('recallBots'));
  assert.deepEqual(ownedBotKinds(f.room.orbBots, f.p.id), BOT_ORDER);
  assert.ok(f.room.orbBots.every((b) => b.recallAt === f.now));
  assert.equal(f.c.petSequence, 0);
  f.step(7);
  assert.ok(f.room.orbBots.every((b) => gap(b, f.p) < ORB_BOTS.pickupRange));
  assert.equal(f.room.orbBots.length, 11);
  assert.equal(saveOrbBots(f.room).length, 9, 'cat and 524 stay in their own save records');
});

test('whistle retains active owners, invites absent-owner dots and respects range and walls', () => {
  const f = fixture(),
    b = f.room.orbBots;
  b[0].ownerId = 'q';
  b[1].ownerId = 'offline';
  b[2].x = f.p.x + ORB_BOTS.whistleRange + 1;
  b[3].busy = true;
  const blocked = b[4];
  const segment = f.room.collision.segmentFree.bind(f.room.collision);
  f.room.collision.segmentFree = (a, d, ...args) =>
    d === blocked ? false : segment(a, d, ...args);
  f.c.followPlayerId = f.c.squadPlayerId = 'q';
  f.c.squadMode = 'following';
  f.act('recallBots');
  assert.equal(b[0].ownerId, 'q');
  assert.equal(b[1].ownerId, 'p');
  for (const i of [2, 3, 4]) assert.equal(b[i].ownerId, '');
  assert.equal(f.c.squadPlayerId, 'q');
  f.p.downedUntil = 20000;
  b[3].busy = false;
  f.act('recallBots');
  assert.equal(b[3].ownerId, '');
});

test('eleven consecutive throws include the cat once, share the queue and all wait until called', () => {
  const f = fixture();
  f.act('recallBots');
  f.step(7);
  for (let i = 0; i < 11; i++) {
    assert.ok(f.act('throwBot'), `throw ${i + 1}`);
    f.step(0.05);
  }
  assert.equal(f.bot.mode, 'queued');
  assert.equal(f.act('throwBot'), false);
  f.step(7);
  assert.ok(f.room.orbBots.every((b) => b.mode === 'waiting' && b.sequence === 1));
  f.act('recallBots');
  f.step(9);
  assert.ok(f.room.orbBots.every((b) => b.mode === 'following' && gap(b, f.p) < 3));
});

test('disconnect during cat flight lands and waits; disconnect before release returns home without losing friendship', () => {
  for (const released of [false, true]) {
    const f = fixture();
    f.pet();
    f.act('throwBot', 'rimo-neko');
    f.step(released ? 0.5 : 0.1);
    const landing = f.bot.landing;
    f.room.players.delete('p');
    f.step(20);
    assert.equal(f.c.squadPlayerId, 'p');
    if (released) {
      assert.equal(f.bot.mode, 'waiting');
      assert.ok(gap(f.c, landing) < 0.001);
    } else assert.ok(gap(f.c, f.c.home) < 0.08);
    f.room.players.set('p', f.p);
    f.act('recallBots');
    f.step(9);
    assert.ok(f.act('throwBot', 'rimo-neko'));
  }
});

test('started cat pet becomes one throwable companion, interruption does not remove it', () => {
  const f = fixture();
  Object.assign(f.p, { x: f.c.x, z: f.c.z + 1.5 });
  assert.ok(handleRimoNekoAction(f.room, f.p, 'petRimo', f.now));
  f.step(0.2);
  assert.equal(f.bot.ownerId, 'p');
  assert.equal(f.bot.busy, true);
  assert.equal(f.act('throwBot', 'rimo-neko'), false);
  f.p.x += 0.6;
  f.step(1);
  assert.equal(f.c.petPlayerId, null);
  assert.equal(f.bot.ownerId, 'p');
  assert.ok(f.act('throwBot', 'rimo-neko'));
  f.step(0.1);
  assert.equal(nearRimoNeko(f.p, f.c, f.room.collision, f.now), false);
  assert.ok(!damageableTargets(f.room).some((t) => t.target === f.c));
  f.step(0.35);
  assert.equal(f.bot.mode, 'airborne');
  assert.equal(gap(f.bot, f.c), 0);
  f.step(2);
  assert.equal(f.bot.mode, 'waiting');
  const landing = { x: f.c.x, z: f.c.z };
  f.p.x += 120;
  f.p.warpSequence = 1;
  f.step(5);
  assert.equal(gap(f.c, landing), 0);
  f.p.boatId = 'boat';
  f.step(1);
  assert.equal(gap(f.c, landing), 0);
  f.p.boatId = null;
  f.act('recallBots');
  f.step(20);
  assert.ok(gap(f.c, f.p) < 3);
  assert.equal(f.bot.mode, 'following');
});

test('cat hit/hiss, transfer and explicit dismissal retain their established behavior', () => {
  const f = fixture();
  f.pet();
  hitRimoNeko(f.c, 1, 0, f.now);
  f.step(0.1);
  assert.equal(f.act('throwBot', 'rimo-neko'), false);
  f.step((RIMO_NEKO.hitMs + RIMO_NEKO.hissMs) / 1000 + 1);
  Object.assign(f.q, { x: f.c.x, z: f.c.z + 1.5 });
  assert.ok(handleRimoNekoAction(f.room, f.q, 'petRimo', f.now));
  f.step(0.1);
  assert.equal(f.bot.ownerId, 'q');
  assert.equal(f.act('throwBot', 'rimo-neko'), false);
  f.q.x += 0.6;
  f.step(1);
  assert.ok(f.act('dismissBot', 'rimo-neko', f.q));
  assert.equal(f.bot, undefined);
  assert.equal(f.c.followPlayerId, null);
  f.step(15);
  assert.ok(gap(f.c, f.c.home) < 0.08);
});

for (const phase of ['windup', 'airborne', 'waiting', 'returning'])
  test(`cat ${phase}: save/restart keeps bond and waiting landing without mutating source`, () => {
    const f = fixture();
    f.pet();
    assert.ok(f.act('throwBot', 'rimo-neko'));
    f.step(phase === 'windup' ? 0.1 : phase === 'airborne' ? 0.5 : 2);
    if (phase === 'returning') f.act('recallBots');
    assert.equal(f.bot.mode, phase);
    const before = structuredClone(f.c),
      b = structuredClone(f.bot),
      saved = saveRimoNeko(f.c, f.bot);
    assert.deepEqual(f.c, before);
    assert.deepEqual(f.bot, b);
    f.room.players.clear();
    f.room.orbBots = [];
    restoreRimoNeko(f.room, saved);
    syncOrbBots(f.room, f.now);
    assert.equal(f.c.followPlayerId, 'p');
    if (['airborne', 'waiting'].includes(phase)) {
      assert.equal(f.bot.mode, 'waiting');
      const at = structuredClone(f.c);
      f.step(10);
      assert.equal(gap(f.c, at), 0);
      assert.ok(gap(f.c, b.landing ?? b) < 0.001);
    } else {
      f.step(30);
      assert.ok(gap(f.c, f.c.home) < 0.08);
    }
    f.room.players.set('p', f.p);
    f.step(0.1);
    assert.equal(f.bot.ownerId, 'p');
    f.act('recallBots');
    f.step(7);
    assert.ok(f.act('throwBot', 'rimo-neko'));
  });

test('legacy cat following saves migrate to the same throwable cat; unknown owners are cleared', () => {
  const f = fixture();
  const saved = { ...f.c, followPlayerId: 'p', squadPlayerId: undefined, squadMode: undefined };
  restoreRimoNeko(f.room, saved);
  f.step(3);
  assert.equal(f.bot.ownerId, 'p');
  assert.equal(f.room.orbBots.filter((b) => b.kind === 'rimo-neko').length, 1);
  restoreRimoNeko(f.room, { ...saved, followPlayerId: 'missing' });
  f.step(0.1);
  assert.equal(f.bot, undefined);
  assert.equal(f.c.followPlayerId, null);
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
  ping() {
    this.emit('pong');
  }
  terminate() {
    this.close();
  }
}
test('real command and checkpoint roundtrip retain cat waiting, same-session identity and inventory', () => {
  let now = 10000,
    id = 0;
  const options = {
    persistentSessions: true,
    keepEmptyRooms: true,
    runtime: { now: () => now, id: () => `p-${++id}`, token: () => `t-${++id}` },
  };
  let core = createGameCore(options);
  const join = (session = '') => {
    const s = new Socket();
    core.connect(s, new URLSearchParams({ room: 'CAT', resume: '1', session }));
    return s;
  };
  let s = join(),
    welcome = s.messages.find((m) => m.type === 'welcome');
  const action = (name, targetId) => {
    now += 200;
    s.emit(
      'message',
      Buffer.from(JSON.stringify({ type: 'action', action: name, targetId })),
      false,
    );
  };
  const tick = (seconds) => {
    for (let i = 0; i < seconds / 0.05; i++) {
      now += 50;
      core.tick();
    }
  };
  let room = core.rooms.get('CAT'),
    p = room.players.get(welcome.id);
  Object.assign(p, { x: 48, z: 54, facing: 0 });
  p.inventory.wood = 7;
  action('recallBots');
  tick(7);
  action('throwBot', 'rimo-neko');
  tick(0.5);
  assert.equal(room.orbBots.find((b) => b.kind === 'rimo-neko').mode, 'airborne');
  const saved = core.exportState();
  const catSaved = saved.rooms[0].rimoNeko;
  assert.equal(catSaved.squadMode, 'waiting');
  s.close();
  core = createGameCore(options);
  core.importState(saved);
  tick(5);
  room = core.rooms.get('CAT');
  assert.equal(gap(room.rimoNeko, catSaved), 0);
  s = join(welcome.session);
  const next = s.messages.find((m) => m.type === 'welcome');
  assert.equal(next.id, welcome.id);
  assert.equal(next.resumed, true);
  p = room.players.get(next.id);
  assert.equal(p.inventory.wood, 7);
  tick(3);
  assert.equal(gap(room.rimoNeko, catSaved), 0);
  action('recallBots');
  tick(8);
  assert.ok(gap(room.rimoNeko, p) < 3);
  action('throwBot', 'rimo-neko');
  tick(2);
  assert.equal(room.orbBots.find((b) => b.kind === 'rimo-neko').mode, 'waiting');
});
