import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { characterModel, normalizeCharacter, isCarryable } from '../dist/shared/characters.mjs';
import { attackProfile } from '../dist/shared/combat-profiles.mjs';
import { startAttack, resolveAttack, updateProjectiles } from '../dist/shared/combat.mjs';
import { CollisionWorld } from '../dist/shared/collision.mjs';
import { handleCharacterSwitch } from '../dist/shared/character-switching.mjs';
import { characterChoicesMarkup, parseCharacterValue } from '../dist/src/character-selection.js';
import { SpellEffects } from '../dist/src/spell-effects.js';

function fixture(obstacles = []) {
  const p = {
    id: 'howkey',
    species: 'howkey',
    gender: 'female',
    x: 20,
    z: 20,
    radius: 0.32,
    facing: 0,
    energy: 90,
    attackAt: 0,
    attackSequence: 0,
    inventory: { wood: 7, stone: 8, berry: 3 },
  };
  const room = {
    players: new Map([[p.id, p]]),
    animals: [],
    enemies: [],
    collision: new CollisionWorld(obstacles, { river: false }),
    camp: { x: 10, z: 10 },
    projectiles: [],
  };
  return { p, room };
}
function cast(room, p, time = 1000) {
  assert.equal(
    startAttack(room, p, { weapon: 'magic', damage: 999, impactMs: 0 }, time).accepted,
    true,
  );
  assert.equal(resolveAttack(room, p, time + 399), null);
  assert.equal(resolveAttack(room, p, time + 400).launched, true);
  return time + 400;
}
const target = (id, x, z) => ({
  id,
  x,
  z,
  radius: 0.4,
  health: 75,
  maxHealth: 75,
  hostile: true,
  phase: 'alive',
});

test('Howkey is a distinct selectable scientist and normalizes through saved profile values', () => {
  assert.deepEqual(normalizeCharacter({ species: 'howkey', gender: 'male' }), {
    species: 'howkey',
    gender: 'female',
  });
  assert.deepEqual(parseCharacterValue('howkey-female'), { species: 'howkey', gender: 'female' });
  assert.equal(characterModel({ species: 'howkey' }).key, 'howkey-scientist');
  assert.equal(isCarryable({ species: 'howkey' }), false);
  assert.equal(attackProfile({ species: 'howkey', spearHead: 'obsidian' }).key, 'science');
  assert.match(characterChoicesMarkup(), /value="howkey-female"/);
  assert.match(characterChoicesMarkup(), /models\/howkey-scientist\/portrait.png/);
});

test('science pulse obeys server windup, damage, one hit, energy and recharge', () => {
  const { p, room } = fixture(),
    front = target('front', 20, 23),
    back = target('back', 20, 25);
  room.enemies.push(front, back);
  const at = cast(room, p);
  assert.equal(room.projectiles[0].kind, 'science');
  assert.equal(p.energy, 87);
  assert.equal(startAttack(room, p, {}, 2599).reason, 'cooldown');
  assert.equal(updateProjectiles(room, at + 100).length, 0);
  const hit = updateProjectiles(room, at + 500);
  assert.equal(hit.length, 1);
  assert.equal(front.health, 51);
  assert.equal(back.health, 75);
  assert.equal(hit[0].weapon, 'science');
  assert.equal(room.projectileImpacts[0].kind, 'science');
  assert.equal(room.projectiles.length, 0);
  assert.equal(startAttack(room, p, {}, 2600).accepted, true);
});

test('a released pulse keeps its profile independently of the owner appearance', () => {
  const { p, room } = fixture(),
    enemy = target('enemy', 20, 24);
  room.enemies.push(enemy);
  const at = cast(room, p);
  p.species = 'bear';
  updateProjectiles(room, at + 650);
  assert.equal(enemy.health, 51);
});

test('science cannot pass thin walls, hurt players, or survive its maximum range', () => {
  const { p, room } = fixture([
    { type: 'box', x: 20, z: 22, hx: 2, hz: 0.02, c: 1, s: 0, height: 2 },
  ]);
  const enemy = target('enemy', 20, 24),
    friend = target('friend', 20, 21);
  room.enemies.push(enemy);
  room.players.set(friend.id, friend);
  const at = cast(room, p);
  assert.equal(updateProjectiles(room, at + 1000).length, 0);
  assert.equal(enemy.health, 75);
  assert.equal(friend.health, 75);
  assert.equal(room.projectiles.length, 0);
  const clear = fixture();
  cast(clear.room, clear.p);
  updateProjectiles(clear.room, 3000);
  assert.equal(clear.room.projectiles.length, 0);
});

test('changing to and from Howkey retains inventory and returns to the proper attack profile', () => {
  const { p, room } = fixture();
  p.species = 'cro';
  p.tool = true;
  p.spearHead = 'obsidian';
  const inventory = p.inventory;
  assert.equal(handleCharacterSwitch(room, p, { targetId: 'howkey-scientist' }, 10000).ok, true);
  assert.equal(p.inventory, inventory);
  assert.equal(p.species, 'howkey');
  assert.equal(attackProfile(p).key, 'science');
  assert.equal(handleCharacterSwitch(room, p, { targetId: 'cro-magnon-woman' }, 11000).ok, true);
  assert.equal(attackProfile(p).id, 'obsidianSpear');
  assert.equal(p.inventory, inventory);
});

test('science windup and released pulse use bounded, finite orbital particles', () => {
  const scene = new THREE.Scene(),
    effect = new SpellEffects(scene),
    model = new THREE.Group();
  const left = new THREE.Object3D(),
    right = new THREE.Object3D();
  left.position.set(-0.1, 1, 0.3);
  right.position.set(0.1, 1, 0.3);
  model.add(left, right);
  scene.add(model);
  const p = { id: 'howkey', species: 'howkey', attackAt: 1000, attackSequence: 1 };
  const players = new Map([[p.id, { state: p, model, gripLeft: left, gripRight: right }]]);
  effect.update({ projectiles: [] }, players, 1200, 1 / 60, 800);
  assert.ok(effect.count > 40 && effect.count < 1024);
  effect.update(
    {
      projectiles: [
        {
          id: 'pulse',
          ownerId: p.id,
          kind: 'science',
          x: 0,
          z: 1,
          dx: 0,
          dz: 1,
          elevation: 0,
          travelled: 1,
        },
      ],
    },
    players,
    1500,
    1 / 60,
    800,
  );
  assert.ok(effect.count > 40 && effect.count < 1024);
  assert.ok([...effect.xyz.slice(0, effect.count * 3)].every(Number.isFinite));
  effect.dispose();
  assert.equal(effect.points.parent, null);
});
