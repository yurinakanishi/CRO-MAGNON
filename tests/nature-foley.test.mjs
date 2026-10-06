import test from 'node:test';
import assert from 'node:assert/strict';
import { FoleyEvents } from '../dist/src/nature-foley.js';
import { ORB_BOTS } from '../dist/shared/orb-bots.mjs';
import { RIMO_NEKO } from '../dist/shared/rimo-neko.mjs';

function fixture() {
  const gate = new FoleyEvents(),
    sounds = [];
  const p = {
    id: 'p',
    x: 0,
    z: 0,
    gathered: 0,
    inventory: { wood: 0, stone: 0 },
    adventure: { regions: {} },
  };
  const world = { state: { orbBots: [] } };
  const update = (time, baseline = false) =>
    gate.update(world, p, time, baseline, (name, volume, point) =>
      sounds.push({ name, volume, point }),
    );
  update(1000, true);
  return { gate, sounds, p, world, update };
}
test('fresh actions play once; old snapshots and reconnect baselines never replay', () => {
  const { gate, sounds, p, update } = fixture();
  Object.assign(p, { attackAt: 1100, attackSequence: 1, jumpAt: 400, jumpSequence: 1 });
  update(1110);
  update(1120);
  assert.deepEqual(
    sounds.map((s) => s.name),
    ['attack'],
  );
  gate.reset();
  update(1140, true);
  update(1150);
  assert.equal(sounds.length, 1);
  Object.assign(p, { hurtAt: 1200, hurtSequence: 1 });
  update(1200);
  assert.equal(sounds.at(-1).name, 'hurt');
});
test('in-place inventory, riding, torch, discoveries use copied state and material-specific contacts', () => {
  const { sounds, p, update } = fixture();
  p.gathered += 2;
  p.inventory.stone += 2;
  update(1100);
  update(1110);
  p.gathered++;
  p.inventory.wood++;
  update(1400);
  p.gathered++;
  p.inventory.berries = 1;
  update(1700);
  p.caveTorchOff = true;
  p.boatId = 'b';
  p.adventure.regions.valley = { visited: ['river'] };
  update(2000);
  assert.deepEqual(
    sounds.map((s) => s.name),
    ['gather-stone', 'gather-wood', 'gather-plant', 'torch-switch', 'mount', 'discovery'],
  );
  p.adventure.regions.valley.visited.push('cave');
  update(2200);
  assert.equal(sounds.length, 6);
});
test('many companions produce one recall / throw / pet, delayed throws wait for launch', () => {
  const { sounds, p, world, update } = fixture();
  world.state.orbBots = Array.from({ length: 9 }, (_, i) => ({
    id: 'b' + i,
    ownerId: p.id,
    recallAt: 1100,
    throwAt: 1200,
    petAt: 0,
  }));
  update(1100);
  assert.deepEqual(
    sounds.map((s) => s.name),
    ['recall'],
  );
  update(1200 + ORB_BOTS.windupMs);
  update(1201 + ORB_BOTS.windupMs);
  assert.equal(sounds.filter((s) => s.name === 'throw').length, 1);
  for (const b of world.state.orbBots) Object.assign(b, { petPlayerId: p.id, petAt: 2000 });
  update(2010);
  assert.equal(sounds.filter((s) => s.name === 'pet').length, 1);
  world.state.orbBots = [];
  update(2100);
  world.state.orbBots = [{ id: 'b0', ownerId: p.id, petPlayerId: p.id, petAt: 2000 }];
  update(2550);
  assert.equal(sounds.filter((s) => s.name === 'pet').length, 1);
});
test('cat hiss follows impact, respects distance and cannot repeat on unchanged state', () => {
  const { sounds, world, update } = fixture();
  world.state.rimoNeko = { id: 'cat', x: 4, z: 0, hitAt: 1100, hitSequence: 1 };
  update(1100);
  assert.equal(sounds.length, 0);
  update(1100 + RIMO_NEKO.hitMs);
  update(1110 + RIMO_NEKO.hitMs);
  assert.equal(sounds.length, 1);
  assert.equal(sounds[0].name, 'hiss');
  assert.ok(sounds[0].volume < 0.6);
  Object.assign(world.state.rimoNeko, { x: 20, hitAt: 4000, hitSequence: 2 });
  update(4000 + RIMO_NEKO.hitMs);
  assert.equal(sounds.length, 1);
});
test('joining during an old throw windup does not replay it at its scheduled release', () => {
  const { gate, sounds, p, world, update } = fixture();
  world.state.orbBots = [{ id: 'b', ownerId: p.id, throwAt: 1200 }];
  gate.reset();
  update(1201, true);
  update(1200 + ORB_BOTS.windupMs);
  assert.equal(sounds.length, 0);
});
