import test from 'node:test';
import assert from 'node:assert/strict';
import { mascotCore, person, flatCollision, advanceMascots } from './mascot-fixture.mjs';
import {
  chooseMascots,
  mascotBodies,
  mascotKeyOf,
  selectedMascotKeys,
  syncMascots,
} from '../dist/shared/mascot-selection.mjs';
import { handleOrbBotAction, ORB_BOTS } from '../dist/shared/orb-bots.mjs';
import { STARTING_MASCOTS, startingMascotMarkup } from '../dist/src/starting-mascot.js';
import { mascotMenuMarkup } from '../dist/src/mascot-menu.js';
import { SoloRuntime } from '../dist/infrastructure/browser/solo-runtime.mjs';

test('solo add/remove/all keeps every selected body, cancels only its farewell, and saves the whole party', (t) => {
  const w = mascotCore(t, { multiMascots: true });
  let a = w.join();
  w.act(a, 'selectMascot', '524');
  const first = w.active(a);
  w.act(a, 'selectMascot', 'rimo-neko');
  w.act(a, 'selectMascot', 'heart');
  assert.deepEqual(selectedMascotKeys(a.player()), ['524', 'rimo-neko', 'heart']);
  assert.ok(mascotBodies(w.room()).includes(first));
  w.act(a, 'deselectMascot', '524');
  assert.ok(first.leavingAt);
  w.act(a, 'selectMascot', '524');
  assert.equal(first.leavingAt, 0);
  assert.equal(mascotBodies(w.room()).filter((c) => mascotKeyOf(c) === '524').length, 1);
  w.act(a, 'selectAllMascots');
  w.step(50, 20);
  assert.equal(selectedMascotKeys(a.player()).length, 11);
  assert.equal(mascotBodies(w.room()).filter((c) => !c.leavingAt).length, 11);
  const saved = w.core().exportState();
  const session = a.session;
  w.load(saved);
  a = w.join('A', session);
  assert.equal(w.state(a).players[0].mascots.length, 11);
  assert.equal(mascotBodies(w.room()).length, 11);
  const before = selectedMascotKeys(a.player());
  w.act(a, 'selectMascot', 'mae');
  assert.deepEqual(selectedMascotKeys(a.player()), before);
  w.act(a, 'deselectMascot');
  // Bulk selection must stay responsive alongside ordinary card toggles, even
  // inside the general world-action cooldown (the real menu can be clicked fast).
  for (const action of [
    'selectAllMascots',
    'deselectMascot',
    'selectAllMascots',
    'deselectMascot',
  ]) {
    a.socket.emit('message', JSON.stringify({ type: 'action', action }));
    assert.equal(selectedMascotKeys(a.player()).length, action === 'selectAllMascots' ? 11 : 0);
  }
  w.step(50, 25);
  assert.deepEqual(a.player().mascots, []);
  assert.equal(mascotBodies(w.room()).length, 0);
  w.load(w.core().exportState());
  a = w.join('A', session);
  assert.deepEqual(selectedMascotKeys(a.player()), []);
  assert.equal(mascotBodies(w.room()).length, 0);
});

test('all eleven companions queue distinct consecutive throws, land, stay, and answer recall', () => {
  const p = person();
  const room = {
    collision: flatCollision(),
    players: new Map([[p.id, p]]),
    multiMascots: true,
    mascotKeys: STARTING_MASCOTS,
  };
  assert.equal(chooseMascots(room, p, STARTING_MASCOTS, 10000), true);
  assert.equal(mascotBodies(room).length, 11);
  for (let i = 0; i < 11; i++)
    assert.equal(handleOrbBotAction(room, p, 'throwBot', '524', 10100 + i * 20), true);
  assert.equal(handleOrbBotAction(room, p, 'throwBot', '524', 10400), false);
  const throws = [...room.orbBots].sort((a, b) => a.throwAt - b.throwAt);
  assert.equal(throws[0].kind, '524');
  assert.equal(new Set(throws.map((b) => b.id)).size, 11);
  assert.ok(throws.every((b) => b.sequence === 1));
  for (let i = 1; i < 11; i++)
    assert.ok(throws[i].throwAt - throws[i - 1].throwAt >= ORB_BOTS.throwIntervalMs);
  advanceMascots(room, 10400, 8);
  assert.ok(room.orbBots.every((b) => b.mode === 'waiting'));
  assert.equal(mascotBodies(room).length, 11);
  handleOrbBotAction(room, p, 'recallBots', undefined, 19000);
  advanceMascots(room, 19000, 8);
  assert.ok(room.orbBots.every((b) => b.mode === 'following'));
});

test('pending solo companions retry independently and deselected pending choices never appear', () => {
  const p = person();
  const room = { collision: flatCollision(), players: new Map([[p.id, p]]), multiMascots: true };
  chooseMascots(room, p, ['524'], 10000);
  p.mountId = 'm';
  chooseMascots(room, p, ['524', 'rimo-neko', 'heart'], 10100);
  assert.equal(mascotBodies(room).length, 1);
  chooseMascots(room, p, ['524', 'heart'], 10200);
  p.mountId = null;
  syncMascots(room, 11000);
  assert.deepEqual(new Set(mascotBodies(room).map(mascotKeyOf)), new Set(['524', 'heart']));
  assert.equal(chooseMascots(room, p, ['524', 'bad'], 12000), false);
  assert.deepEqual(p.mascots, ['524', 'heart']);
});

test('browser runtime migrates a single choice, persists multi selection immediately and restores explicit none', async () => {
  const save = {
    data: null,
    async load(validate) {
      if (this.data) validate(this.data);
      return { data: this.data, recovered: false };
    },
    async write(data) {
      this.data = structuredClone(data);
    },
    close() {},
  };
  let game = new SoloRuntime(save, () => {});
  await game.start({ name: 'Solo', mascot: '524' });
  await game.close();
  delete save.data.game.rooms[0].sessions[0].player.mascots; // A fixture of the former save format.
  const out = [];
  game = new SoloRuntime(save, (event) => out.push(event));
  await game.start({ name: 'Solo', mascot: 'keep' });
  assert.deepEqual(save.data.game.rooms[0].sessions[0].player.mascots, ['524']);
  await game.command(JSON.stringify({ type: 'action', action: 'selectMascot', targetId: 'heart' }));
  assert.deepEqual(save.data.game.rooms[0].sessions[0].player.mascots, ['524', 'heart']);
  await game.close();
  game = new SoloRuntime(save, () => {});
  await game.start({ name: 'Solo', mascot: 'keep' });
  assert.deepEqual(save.data.game.rooms[0].sessions[0].player.mascots, ['524', 'heart']);
  await game.close();
  game = new SoloRuntime(save, () => {});
  await game.start({ name: 'Solo', mascot: 'none' });
  assert.deepEqual(save.data.game.rooms[0].sessions[0].player.mascots, []);
  await game.close();
});

test('solo pickers offer bulk controls and multiple pressed photos without changing online pickers', () => {
  const markup = startingMascotMarkup(STARTING_MASCOTS, '524,heart', false, true);
  assert.equal((markup.match(/aria-pressed="true"/g) || []).length, 2);
  assert.match(markup, /data-starting-mascot-all/);
  assert.match(markup, /data-starting-mascot-none/);
  assert.match(mascotMenuMarkup(STARTING_MASCOTS, true), /data-mascot-all/);
  assert.doesNotMatch(mascotMenuMarkup(STARTING_MASCOTS), /data-mascot-all/);
});
