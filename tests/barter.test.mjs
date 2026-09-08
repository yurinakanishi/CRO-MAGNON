import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createGameCore } from '../dist/application/game-core.mjs';
import { decodeCommand } from '../dist/application/protocol.mjs';
import { BARTER, BARTER_ITEMS, barterSnapshots, updateBarters } from '../dist/shared/barter.mjs';
import { MANY_HEARTHS } from '../dist/shared/gulf-region.mjs';
import { KNAPPING_SITES } from '../dist/shared/coastal-sites.mjs';
import { ridingObstacles } from '../dist/shared/riding.mjs';

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
  terminate() {
    this.close();
  }
  ping() {
    this.emit('pong');
  }
  command(m) {
    this.emit('message', Buffer.from(JSON.stringify(m)), false);
  }
}
function fixture(count = 2) {
  let now = 100000,
    serial = 0;
  const core = createGameCore({
    playerLimit: Math.max(5, count),
    runtime: { now: () => now, id: () => `id-${++serial}`, token: () => `token-${++serial}` },
  });
  const sockets = [],
    players = [];
  const join = (session, room = 'BARTER') => {
    const s = new Socket();
    core.connect(
      s,
      new URLSearchParams({
        room,
        name: `P${serial}`,
        resume: '1',
        ...(session ? { session } : {}),
      }),
    );
    return s;
  };
  for (let i = 0; i < count; i++) {
    sockets.push(join());
    players.push([...core.rooms.get('BARTER').players.values()].at(-1));
  }
  const r = core.rooms.get('BARTER');
  for (let i = 0; i < count; i++) {
    const p = players[i];
    Object.assign(
      p,
      r.collision.nearestFree(
        { x: MANY_HEARTHS.x - 10 + Math.floor(i / 2) * 6 + (i % 2) * 1.6, z: MANY_HEARTHS.z + 11 },
        p.radius,
        ridingObstacles(r, null, p),
        3,
      ),
    );
    Object.assign(p.inventory, { obsidian: 10, berry: 10, wood: 10, obsidianBlade: 2 });
  }
  const command = (i, m) => {
    now += 500;
    sockets[i].command(m);
    return r.barters.at(-1);
  };
  const invite = (a = 0, b = 1) =>
    command(a, { type: 'barter', kind: 'invite', targetId: players[b].id });
  const act = (i, kind, extra = {}, t = r.barters.at(-1)) =>
    command(i, { type: 'barter', kind, tradeId: t.id, revision: t.revision, ...extra });
  const opened = (a = 0, b = 1) => {
    const t = invite(a, b);
    act(b, 'join', {}, t);
    return t;
  };
  const offer = (i, item = 'obsidian', quantity = 2, t = r.barters.at(-1)) =>
    act(i, 'offer', { item, quantity }, t);
  const prepare = (a = 0, b = 1) => {
    const t = opened(a, b);
    offer(a, 'obsidian', 2, t);
    offer(b, 'berry', 3, t);
    return t;
  };
  return {
    core,
    r,
    sockets,
    players,
    join,
    command,
    invite,
    act,
    opened,
    offer,
    prepare,
    advance: (n) => (now += n),
    now: () => now,
  };
}
const inventories = (f) => structuredClone(f.players.map((p) => p.inventory));
const total = (f) =>
  Object.fromEntries(
    BARTER_ITEMS.map(({ id }) => [id, f.players.reduce((n, p) => n + (p.inventory[id] ?? 0), 0)]),
  );

test('barter wire commands reject malformed IDs, revisions and quantities and ignore forged consent fields', () => {
  const decode = (m) => decodeCommand(JSON.stringify(m));
  assert.deepEqual(
    decode({ type: 'barter', kind: 'invite', targetId: 'p2', accepted: [true, true] }),
    { type: 'barter', kind: 'invite', targetId: 'p2' },
  );
  assert.deepEqual(decode({ type: 'barter', kind: 'cancel' }), { type: 'barter', kind: 'cancel' });
  for (const value of [
    null,
    {},
    [],
    { kind: 'nope' },
    { kind: 'invite', targetId: '' },
    { kind: 'invite', targetId: 'x'.repeat(81) },
    { kind: 'accept', tradeId: 'id', revision: -1 },
    { kind: 'accept', tradeId: 'id', revision: 0.5 },
    { kind: 'offer', tradeId: 'id', revision: 1, item: 'wood', quantity: 0 },
    { kind: 'offer', tradeId: 'id', revision: 1, item: 'wood', quantity: 21 },
    { kind: 'offer', tradeId: 'id', revision: 1, item: 'wood', quantity: '2' },
    { kind: 'offer', tradeId: 'id', revision: 1, item: {}, quantity: 2 },
  ])
    assert.equal(decode({ type: 'barter', ...value }), null);
});

test('only the invited partner may join; no self, remote, busy, cross-room or overlapping trade', () => {
  const f = fixture(3);
  try {
    const before = inventories(f);
    f.command(0, { type: 'barter', kind: 'invite', targetId: f.players[0].id });
    assert.equal(f.r.barters.length, 0);
    const away = f.join(null, 'OTHER'),
      outsider = [...f.core.rooms.get('OTHER').players.values()][0];
    f.command(0, { type: 'barter', kind: 'invite', targetId: outsider.id });
    assert.equal(f.r.barters.length, 0);
    away.close();
    const t = f.invite();
    assert.equal(t.status, 'invited');
    f.act(0, 'join');
    assert.equal(t.status, 'invited');
    f.act(2, 'join');
    assert.equal(t.status, 'invited');
    f.invite(1, 0);
    assert.equal(f.r.barters.length, 1);
    f.act(1, 'join');
    assert.equal(t.status, 'open');
    assert.deepEqual(inventories(f), before);
    f.act(2, 'cancel');
    assert.equal(t.status, 'open');
  } finally {
    f.core.close();
  }
});

test('each changed offer revokes both approvals; old consent and repeat delivery cannot transfer items', () => {
  const f = fixture();
  try {
    const before = inventories(f),
      amounts = total(f),
      progress = f.players.map((p) => structuredClone(p.gulf));
    const t = f.prepare();
    f.act(0, 'accept');
    assert.deepEqual(t.accepted, [true, false]);
    const oldRevision = t.revision;
    f.offer(1, 'berry', 4);
    assert.deepEqual(t.accepted, [false, false]);
    f.act(0, 'accept', { revision: oldRevision });
    assert.deepEqual(t.accepted, [false, false]);
    assert.deepEqual(inventories(f), before);
    f.act(0, 'accept');
    f.act(1, 'accept');
    assert.equal(t.status, 'complete');
    assert.deepEqual(total(f), amounts);
    assert.equal(f.players[0].inventory.obsidian, 8);
    assert.equal(f.players[0].inventory.berry, 14);
    assert.equal(f.players[1].inventory.obsidian, 12);
    assert.equal(f.players[1].inventory.berry, 6);
    const delivered = inventories(f);
    f.act(0, 'accept');
    f.act(1, 'accept');
    f.act(0, 'cancel');
    assert.deepEqual(inventories(f), delivered);
    assert.deepEqual(
      f.players.map((p) => p.gulf),
      progress,
      'barter does not change pantry allowance, country or procurement credit',
    );
  } finally {
    f.core.close();
  }
});

test('same-revision concurrent edits cannot replace an unseen offer and private simulation data is not broadcast', () => {
  const f = fixture();
  try {
    const t = f.opened(),
      revision = t.revision;
    f.offer(0, 'obsidian', 2);
    f.act(1, 'offer', { revision, item: 'berry', quantity: 3 });
    assert.equal(t.offers[1], null);
    f.offer(1, 'berry', 3);
    const publicTrade = barterSnapshots(f.r)[0];
    assert.deepEqual(
      Object.keys(publicTrade).sort(),
      ['id', 'players', 'offers', 'accepted', 'revision', 'status', 'expiresAt', 'reason'].sort(),
    );
    publicTrade.offers[0].quantity = 99;
    publicTrade.players[0] = 'forged';
    assert.equal(t.offers[0].quantity, 2);
    assert.equal(t.players[0], f.players[0].id);
  } finally {
    f.core.close();
  }
});

test('inventory and quantity failures preserve every item, and final consent revalidates both sides', () => {
  const f = fixture();
  try {
    const t = f.prepare();
    let before = inventories(f);
    for (const item of ['water', 'tool', 'spearHead', '__proto__', 'constructor', 'sessionToken'])
      f.offer(0, item, 1);
    f.offer(0, 'obsidian', 20);
    assert.deepEqual(t.offers[0], { item: 'obsidian', quantity: 2 });
    assert.deepEqual(inventories(f), before);
    f.act(0, 'accept');
    f.players[1].inventory.berry = 1;
    before = inventories(f);
    f.act(1, 'accept');
    assert.deepEqual(inventories(f), before);
    assert.deepEqual(t.accepted, [false, false]);
    assert.equal(t.status, 'open');
    f.players[1].inventory.berry = 10;
    f.players[0].inventory.berry = 98;
    f.act(0, 'accept');
    assert.equal(t.status, 'open');
    assert.match(t.reason, /いっぱい/);
    assert.equal(f.players[0].inventory.berry, 98);
    f.players[0].inventory.berry = 96;
    f.act(0, 'accept');
    f.act(1, 'accept');
    assert.equal(t.status, 'complete');
    assert.equal(f.players[0].inventory.berry, 99);
  } finally {
    f.core.close();
  }
});

test('same-item exchange checks net capacity and conserves total amounts', () => {
  const f = fixture();
  try {
    f.players[0].inventory.berry = 99;
    f.players[1].inventory.berry = 80;
    const before = total(f),
      t = f.opened();
    f.offer(0, 'berry', 20);
    f.offer(1, 'berry', 1);
    f.act(0, 'accept');
    f.act(1, 'accept');
    assert.equal(t.status, 'complete');
    assert.deepEqual(
      f.players.map((p) => p.inventory.berry),
      [80, 99],
    );
    assert.deepEqual(total(f), before);
  } finally {
    f.core.close();
  }
});

test('moving, targets, expeditions, other actions and cancellation stop pending barter without escrow', () => {
  for (const command of [
    { type: 'move', dx: 1, dz: 0 },
    { type: 'target', x: MANY_HEARTHS.x, z: MANY_HEARTHS.z + 15 },
    { type: 'expedition', destination: 'invalid' },
    { type: 'action', action: 'attack' },
    { type: 'action', action: 'gulfPantryTake', targetId: 'many-hearths:berry' },
    { type: 'barter', kind: 'cancel' },
  ]) {
    const f = fixture();
    try {
      const t = f.prepare(),
        before = inventories(f);
      f.act(0, 'accept');
      f.command(1, command);
      assert.equal(t.status, 'cancelled', JSON.stringify(command));
      assert.deepEqual(inventories(f), before);
    } finally {
      f.core.close();
    }
  }
  const f = fixture();
  try {
    const t = f.prepare();
    for (const action of ['cancelFishing', 'cancelCoastal'])
      f.command(0, { type: 'action', action });
    f.command(0, { type: 'move', dx: 0, dz: 0 });
    assert.equal(t.status, 'open', 'menu input reset does not cancel a newly opened conversation');
  } finally {
    f.core.close();
  }
});

test('server tick cancels on injury, work, movement, distance, missing partner and obstruction', () => {
  for (const mutate of [
    (f) => f.players[0].hurtSequence++,
    (f) => (f.players[0].cookingEndsAt = f.now() + 3000),
    (f) => (f.players[0].fishing = { siteId: 'fixture', endsAt: f.now() + 3000 }),
    (f) => (f.players[0].mountId = 'fixture'),
    (f) => (f.players[0].boatId = 'fixture'),
    (f) => (f.players[0].downedUntil = f.now() + 5000),
    (f) => (f.players[0].x += 20),
    (f) => f.r.players.delete(f.players[1].id),
    (f) => (f.r.collision = { segmentFree: () => false }),
  ]) {
    const f = fixture();
    try {
      const t = f.prepare(),
        before = inventories(f);
      mutate(f);
      // Use the domain tick to isolate barter validation from unrelated mounted/cooking simulation fixtures.
      f.advance(10);
      updateBarters(f.r, f.now());
      assert.equal(t.status, 'cancelled');
      assert.deepEqual(inventories(f), before);
    } finally {
      f.core.close();
    }
  }
});

test('expiry, cooldown and bounded terminal results prevent old invitations remaining actionable', () => {
  const f = fixture();
  try {
    let t = f.invite();
    f.act(0, 'cancel');
    f.invite();
    assert.equal(f.r.barters.length, 1);
    f.advance(BARTER.inviteGapMs);
    t = f.prepare();
    const before = inventories(f);
    f.advance(BARTER.lifetimeMs);
    f.act(0, 'accept');
    assert.equal(t.status, 'cancelled');
    assert.deepEqual(inventories(f), before);
    f.advance(BARTER.resultMs + 1);
    f.core.tick();
    assert.equal(f.r.barters.length, 0);
  } finally {
    f.core.close();
  }
});

test('four pairs among eight players exchange independently with authoritative snapshots', () => {
  const f = fixture(8);
  try {
    const before = total(f),
      trades = [];
    for (let i = 0; i < 8; i += 2) trades.push(f.prepare(i, i + 1));
    for (let i = 0; i < 8; i += 2) {
      f.act(i, 'accept', {}, trades[i / 2]);
      f.act(i + 1, 'accept', {}, trades[i / 2]);
    }
    assert.equal(trades.filter((t) => t.status === 'complete').length, 4);
    assert.deepEqual(total(f), before);
    for (const socket of f.sockets) {
      const s = socket.messages.findLast((m) => m.type === 'state');
      assert.equal(s.playerLimit, 8);
      assert.equal(s.barters.filter((t) => t.status === 'complete').length, 4);
    }
  } finally {
    f.core.close();
  }
});

test('disconnect/replacement/restore remove agreements, while completed inventories survive and received blades remain usable', () => {
  const f = fixture();
  try {
    let t = f.prepare(),
      before = inventories(f);
    const token = f.players[1].sessionToken;
    f.sockets[1].close();
    assert.equal(t.status, 'cancelled');
    assert.deepEqual(inventories(f), before);
    f.sockets[1] = f.join(token);
    f.advance(5000);
    t = f.opened();
    f.offer(0, 'obsidianBlade', 1);
    f.offer(1, 'berry', 3);
    f.act(0, 'accept');
    f.act(1, 'accept');
    assert.equal(t.status, 'complete');
    const received = f.players[1].inventory.obsidianBlade;
    const recipient = f.players[1],
      originalPosition = { x: recipient.x, z: recipient.z },
      worksite = KNAPPING_SITES.find((site) => site.id === `knap-${MANY_HEARTHS.id}`);
    Object.assign(
      recipient,
      f.r.collision.nearestFree(
        { x: worksite.x, z: worksite.z + 1.5 },
        recipient.radius,
        ridingObstacles(f.r, null, recipient),
        3,
      ),
    );
    f.command(1, { type: 'action', action: 'haftSpear', targetId: worksite.id });
    assert.equal(f.players[1].spearHead, 'obsidian');
    assert.equal(f.players[1].inventory.obsidianBlade, received - 1);
    Object.assign(recipient, originalPosition);
    f.advance(5000);
    t = f.prepare();
    before = inventories(f);
    f.sockets[0] = f.join(f.players[0].sessionToken);
    assert.equal(t.status, 'cancelled');
    f.advance(5000);
    t = f.prepare();
    const saved = f.core.exportState();
    assert.ok(!('barters' in saved.rooms[0]));
    const copy = structuredClone(saved);
    copy.rooms[0].barters = [{ ...t, accepted: [true, true] }];
    const restored = createGameCore({
      runtime: { now: f.now, id: () => crypto.randomUUID(), token: () => crypto.randomUUID() },
    });
    try {
      restored.importState(copy);
      const room = restored.rooms.get('BARTER');
      assert.deepEqual(room.barters, []);
      assert.deepEqual(
        [...room.sessions.values()].map((e) => e.player.inventory),
        before,
      );
      assert.deepEqual(
        saved,
        f.core.exportState(),
        'export does not mutate the live agreement or inventory',
      );
    } finally {
      restored.close();
    }
  } finally {
    f.core.close();
  }
});
