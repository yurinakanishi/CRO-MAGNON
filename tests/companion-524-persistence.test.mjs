import test from 'node:test';
import assert from 'node:assert/strict';
import { mascotCore, distance } from './mascot-fixture.mjs';
import { mascotKeyOf, formerMascotBonds } from '../dist/shared/mascot-selection.mjs';

for (const key of ['524', 'rimo-neko', 'white'])
  for (const mode of [
    'following',
    'windup',
    'airborne',
    'waiting',
    'returning',
    'stowed',
    'petting',
  ])
    test(
      key + ' ' + mode + ': checkpoint keeps only selection and a fresh body arrives on resume',
      (t) => {
        const w = mascotCore(t),
          a = w.join();
        w.act(a, 'selectMascot', key);
        a.player().inventory.wood = 7;
        const body = w.active(a),
          bot = w.room().orbBots.find((b) => b.ownerId === a.id);
        // A checkpoint boundary may arrive in any transient presentation/flight phase.
        Object.assign(bot, {
          mode,
          x: 80,
          z: 80,
          petPlayerId: mode === 'petting' ? a.id : null,
          petAt: w.now(),
        });
        if (body !== bot)
          Object.assign(body, {
            squadMode: mode,
            x: 80,
            z: 80,
            petPlayerId: mode === 'petting' ? a.id : null,
          });
        const saved = w.core().exportState(),
          copy = structuredClone(saved);
        for (const field of ['companions', 'orbBots', 'companion524', 'rimoNeko', 'mae', 'friends'])
          assert.ok(!(field in saved.rooms[0]), field);
        assert.equal(saved.rooms[0].sessions[0].player.mascot, key);
        w.load(saved);
        assert.deepEqual(saved, copy);
        assert.deepEqual(w.room().companions, []);
        assert.deepEqual(w.room().orbBots, []);
        const back = w.join('A', a.session, null),
          fresh = w.active(back);
        assert.equal(back.id, a.id);
        assert.equal(back.player().inventory.wood, 7);
        assert.equal(mascotKeyOf(fresh), key);
        assert.ok(distance(fresh, back.player()) < 2.5);
        assert.equal(fresh.petPlayerId, null);
        assert.equal('kind' in fresh ? fresh.mode : fresh.squadMode, 'following');
      },
    );
for (const key of ['524', 'rimo-neko', 'white'])
  test(key + ': explicit goodbye stays alone through restart', (t) => {
    const w = mascotCore(t),
      a = w.join();
    w.act(a, 'selectMascot', key);
    w.act(a, 'deselectMascot');
    const saved = w.core().exportState();
    w.load(saved);
    const back = w.join('A', a.session, null);
    assert.equal(back.player().mascot, null);
    assert.equal(w.active(back), undefined);
    assert.deepEqual(w.room().companions, []);
    assert.deepEqual(w.room().orbBots, []);
  });
test('old shared bodies migrate known owners in card order; absent owners and invalid keys do not create bodies', (t) => {
  const w = mascotCore(t),
    a = w.join('A'),
    b = w.join('B');
  const saved = w.core().exportState(),
    r = saved.rooms[0];
  for (const s of r.sessions) delete s.player.mascot;
  r.rimoNeko = { followPlayerId: a.id };
  r.companion524 = { squadPlayerId: a.id, radius: 0.58, x: 99999, z: 99999 };
  r.orbBots = [
    { ownerId: a.id, kind: 'white' },
    { ownerId: b.id, kind: 'green' },
    { ownerId: b.id, kind: '__proto__' },
    { ownerId: 'offline-without-session', kind: 'heart' },
  ];
  const copy = structuredClone(saved);
  assert.deepEqual(formerMascotBonds(null), new Map());
  w.load(saved);
  assert.deepEqual(saved, copy);
  const aa = w.join('A', a.session),
    bb = w.join('B', b.session);
  assert.equal(aa.player().mascot, 'rimo-neko');
  assert.equal(bb.player().mascot, 'green');
  assert.equal(w.room().companions.length, 1);
  assert.ok(w.room().orbBots.every((c) => [a.id, b.id].includes(c.ownerId)));
});
