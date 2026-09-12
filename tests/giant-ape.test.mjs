import test from 'node:test';
import assert from 'node:assert/strict';
import { characterModel, normalizeCharacter } from '../dist/shared/characters.mjs';
import { attackProfile } from '../dist/shared/combat-profiles.mjs';
import { startAttack, resolveAttack, withinAttackReach } from '../dist/shared/combat.mjs';
import { CollisionWorld } from '../dist/shared/collision.mjs';
import { movePlayer } from '../dist/shared/movement.mjs';

const ape = () => ({
  id: 'ape',
  species: 'ape',
  gender: 'male',
  x: 20,
  z: 20,
  radius: characterModel({ species: 'ape' }).radius,
  facing: 0,
  energy: 100,
  attackAt: 0,
  attackSequence: 0,
  inventory: { wood: 0, stone: 0, berry: 0, rawMeat: 0, cookedMeat: 0 },
});
const enemy = (id, z) => ({
  id,
  x: 20,
  z,
  radius: 0.4,
  health: 75,
  maxHealth: 75,
  hostile: true,
  phase: 'alive',
});

test('giant ape keeps its identity in old gender fields and cannot acquire spear upgrades', () => {
  for (const gender of [undefined, 'female', 'male', '<invalid>']) {
    const profile = { species: 'ape', gender, spearHead: 'obsidian' };
    assert.deepEqual(normalizeCharacter(profile), { species: 'ape', gender: 'male' });
    assert.equal(characterModel(profile).key, 'giant-ape');
    assert.equal(attackProfile(profile).key, 'unarmed');
    assert.equal(attackProfile(profile).modelKey, undefined);
  }
  assert.equal(characterModel({ species: 'bear' }).height, 0.78);
  assert.equal(characterModel({ species: 'cro', gender: 'male' }).key, 'cro-magnon-hunter');
});

test('ape strike uses server timing, one forward hostile and no client supplied weapon or damage', () => {
  const player = ape(),
    front = enemy('front', 21.3),
    rear = enemy('rear', 22.5);
  const peer = { ...enemy('peer', 21), energy: 100 };
  const room = {
    players: new Map([
      [player.id, player],
      [peer.id, peer],
    ]),
    animals: [],
    enemies: [front, rear],
    collision: new CollisionWorld([], { river: false }),
  };
  const profile = attackProfile(player);
  assert.equal(
    startAttack(room, player, { weapon: 'magic', damage: 999, reach: 999 }, 1000).accepted,
    true,
  );
  assert.equal(resolveAttack(room, player, 1000 + profile.impactMs - 1), null);
  const result = resolveAttack(room, player, 1000 + profile.impactMs);
  assert.equal(result.target, front);
  assert.equal(result.weapon, 'unarmed');
  assert.equal(front.health, 75 - profile.damage);
  assert.equal(rear.health, 75);
  assert.equal(peer.health, 75);
  assert.equal(resolveAttack(room, player, 1900), null);
  assert.equal(startAttack(room, player, {}, 1999).accepted, false);
  assert.equal(startAttack(room, player, {}, 2000).accepted, true);
  assert.equal(withinAttackReach(player, rear), false);
  room.collision = new CollisionWorld(
    [{ type: 'box', x: 20, z: 20.9, hx: 1, hz: 0.05, c: 1, s: 0, height: 2 }],
    { river: false },
  );
  assert.equal(resolveAttack(room, player, 2400).hit, false);
});

test('broad ape moves only from fresh manual input and uses its own walk/run speed', () => {
  const player = {
    ...ape(),
    dx: 0,
    dz: 1,
    lastInput: 1000,
    runningRequested: false,
    target: { x: 100, z: 100 },
    path: [{ x: 100, z: 100 }],
  };
  movePlayer(player, 0.1, 1050);
  assert.ok(Math.abs(player.z - 20.24) < 1e-8);
  assert.equal(player.x, 20);
  assert.equal(player.target, null);
  assert.deepEqual(player.path, []);
  player.runningRequested = true;
  movePlayer(player, 0.1, 1100);
  assert.ok(Math.abs(player.z - 20.88) < 1e-8);
  movePlayer(player, 0.1, 1700);
  assert.ok(Math.abs(player.z - 20.88) < 1e-8);
  assert.equal(player.moving, false);
});
