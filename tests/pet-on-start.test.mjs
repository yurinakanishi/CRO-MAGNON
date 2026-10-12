import test from 'node:test';
import assert from 'node:assert/strict';
import { mascotCore } from './mascot-fixture.mjs';
import { ALL_MASCOT_MODELS } from '../dist/shared/mascot-roster.mjs';
import { mascotBodies } from '../dist/shared/mascot-selection.mjs';

for (const key of ['rimo-neko', '524', 'mae', 'white']) {
  test(
    key + ': the first pet broadcast names the visitor without transferring the companion',
    (t) => {
      const w = mascotCore(t, { mascotModels: ALL_MASCOT_MODELS }),
        owner = w.join('Owner'),
        visitor = w.join('Visitor');
      w.act(owner, 'selectMascot', key);
      const c = w.active(owner);
      Object.assign(visitor.player(), { x: c.x, z: c.z - 1.3 });
      w.act(visitor, 'petMascot', c.id);
      assert.equal(c.petPlayerId, visitor.id);
      assert.equal(c.ownerId, owner.id);
      assert.equal(visitor.player().mascot, null);
      for (const who of [owner, visitor]) {
        const sent = mascotBodies(w.state(who)).find((b) => b.id === c.id);
        assert.equal(sent.petPlayerId, visitor.id);
        assert.equal(sent.ownerId, owner.id);
      }
      w.act(visitor, 'recallBots');
      assert.equal(c.petPlayerId, null);
      assert.equal(c.ownerId, owner.id);
      assert.equal(w.active(visitor), undefined);
      assert.equal(w.active(owner), c);
    },
  );
  test(
    key +
      ': disconnect and restart during a visitor stroke preserve the owner selection and both inventories',
    (t) => {
      const w = mascotCore(t, { mascotModels: ALL_MASCOT_MODELS }),
        owner = w.join('Owner'),
        visitor = w.join('Visitor');
      owner.player().inventory.wood = 8;
      visitor.player().inventory.berry = 5;
      w.act(owner, 'selectMascot', key);
      const c = w.active(owner);
      Object.assign(visitor.player(), { x: c.x, z: c.z - 1.3 });
      w.act(visitor, 'petMascot', c.id);
      visitor.socket.close();
      w.step();
      assert.equal(c.petPlayerId, null);
      assert.equal(c.ownerId, owner.id);
      const saved = w.core().exportState();
      w.load(saved);
      const a = w.join('Owner', owner.session),
        b = w.join('Visitor', visitor.session);
      assert.equal(a.player().inventory.wood, 8);
      assert.equal(b.player().inventory.berry, 5);
      assert.equal(a.player().mascot, key);
      assert.equal(b.player().mascot, null);
      assert.equal(w.active(a).petPlayerId, null);
      assert.equal(w.active(b), undefined);
      assert.equal(mascotBodies(w.room()).length, 1);
    },
  );
}
