import test from 'node:test';
import assert from 'node:assert/strict';
import { throwableMascot } from './throwable-mascot.mjs';
import { mascotCore } from './mascot-fixture.mjs';
throwableMascot('rimo-neko');
test('recall while travelling alone recruits nobody; recall with a choice calls only that person’s cat', (t) => {
  const w = mascotCore(t),
    a = w.join('A'),
    b = w.join('B', '', { x: 56, z: 50 });
  w.act(a, 'recallBots');
  assert.deepEqual(w.room().companions, []);
  assert.deepEqual(w.room().orbBots, []);
  w.act(b, 'selectMascot', 'rimo-neko');
  w.act(a, 'recallBots');
  assert.equal(w.active(a), undefined);
  const cat = w.active(b);
  w.act(b, 'throwBot', 'rimo-neko');
  w.step(50, 50);
  assert.equal(cat.squadMode, 'waiting');
  w.act(a, 'recallBots');
  w.step(50, 10);
  assert.equal(cat.squadMode, 'waiting');
  assert.equal(w.active(a), undefined);
  w.act(b, 'recallBots');
  w.step(50, 200);
  assert.equal(cat.squadMode, 'following');
  assert.equal(cat.ownerId, b.id);
});
