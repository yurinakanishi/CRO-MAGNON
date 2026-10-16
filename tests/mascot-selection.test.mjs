import test from 'node:test';
import assert from 'node:assert/strict';
import { mascotFixture, mascotCore, person, flatCollision, distance } from './mascot-fixture.mjs';
import { ALL_MASCOT_MODELS } from '../dist/shared/mascot-roster.mjs';
import {
  MASCOT_KEYS,
  chooseMascot,
  activeMascot,
  mascotBodies,
  mascotKeyOf,
  syncMascots,
} from '../dist/shared/mascot-selection.mjs';
import { mascotMenuMarkup } from '../dist/src/mascot-menu.js';

test('every available card selects one personal body; replacing it dismisses only the previous choice', (t) => {
  const w = mascotCore(t, { mascotModels: ALL_MASCOT_MODELS }),
    a = w.join('A'),
    b = w.join('B', '', { x: 56, z: 50 });
  assert.deepEqual(w.room().companions, []);
  assert.deepEqual(w.room().orbBots, []);
  for (const key of MASCOT_KEYS) {
    w.act(a, 'selectMascot', key);
    w.act(b, 'selectMascot', key);
    const mine = w.active(a),
      theirs = w.active(b);
    assert.equal(mascotKeyOf(mine), key);
    assert.equal(mascotKeyOf(theirs), key);
    assert.notEqual(mine.id, theirs.id);
    assert.equal(mine.ownerId, a.id);
    assert.equal(theirs.ownerId, b.id);
    for (const who of [a, b])
      assert.equal(
        mascotBodies(w.room()).filter((c) => c.ownerId === who.id && !c.leavingAt).length,
        1,
      );
    w.step(50, 25);
    assert.equal(mascotBodies(w.room()).length, 2);
  }
  const other = w.active(b);
  w.act(a, 'deselectMascot');
  w.step(50, 25);
  assert.equal(w.active(a), undefined);
  assert.equal(w.active(b), other);
  assert.equal(a.player().mascot, null);
  const markup = mascotMenuMarkup(w.room().mascotKeys);
  assert.deepEqual(
    [...markup.matchAll(/data-mascot="([^"]+)"/g)].map((m) => m[1]),
    ['524', 'rimo-neko', ...MASCOT_KEYS.slice(2)],
  );
  assert.doesNotMatch(markup, /data-mascot="all"|data-mascot-all/);
  assert.match(markup, /data-mascot-none/);
});
test('invalid, hidden and bulk choices leave the current choice and body intact', (t) => {
  const w = mascotCore(t),
    a = w.join();
  w.act(a, 'selectMascot', '524');
  const before = w.active(a);
  for (const value of ['all', 'mae', '__proto__', '', {}, [], true]) {
    w.act(a, 'selectMascot', value);
    assert.equal(w.active(a), before);
    assert.equal(a.player().mascot, '524');
  }
  a.player().downedUntil = w.now() + 20000;
  w.act(a, 'selectMascot', 'blue');
  assert.equal(w.active(a), before);
});
test('a selected mascot waits for room beside its person and retries after the obstruction clears', () => {
  const p = person(),
    room = {
      players: new Map([[p.id, p]]),
      companions: [],
      orbBots: [],
      collision: flatCollision([{ id: 'blocked', type: 'circle', x: 50, z: 50, radius: 8 }]),
    };
  assert.equal(chooseMascot(room, p, '524', 10000), true);
  assert.equal(p.mascot, '524');
  assert.equal(activeMascot(room, p.id), undefined);
  syncMascots(room, 10010);
  assert.deepEqual(room.companions, []);
  room.collision = flatCollision();
  syncMascots(room, 10510);
  assert.equal(activeMascot(room, p.id).key, '524');
  assert.ok(distance(activeMascot(room, p.id), p) < 2.5);
});
test('a pending choice arrives after dismount; a cancelled pending choice never appears', () => {
  const { room, p } = mascotFixture('white');
  chooseMascot(room, p, null, 10000);
  syncMascots(room, 11000);
  p.mountId = 'm';
  chooseMascot(room, p, 'rimo-neko', 12000);
  assert.equal(activeMascot(room, p.id), undefined);
  p.mountId = null;
  syncMascots(room, 12550);
  assert.equal(activeMascot(room, p.id).key, 'rimo-neko');
  chooseMascot(room, p, null, 13000);
  syncMascots(room, 14000);
  p.mountId = 'm';
  chooseMascot(room, p, '524', 14010);
  chooseMascot(room, p, null, 14020);
  p.mountId = null;
  syncMascots(room, 15000);
  assert.deepEqual(mascotBodies(room), []);
});
