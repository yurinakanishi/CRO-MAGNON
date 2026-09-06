import test from 'node:test';
import assert from 'node:assert/strict';
import { CollisionWorld } from '../shared/collision.mjs';
import { COMBAT, startAttack, resolveAttack, inAttackArc, withinSpearReach } from '../shared/combat.mjs';
import { handleHuntingAction, updateHunting, HUNTING } from '../shared/hunting.mjs';

const creature = (id, x = 20, z = 22) => ({ id, x, z, radius: .7, phase: 'alive', health: 100, maxHealth: 100 });
function fixture() {
  const player = { id: 'hunter', x: 20, z: 20, radius: .32, facing: 0, energy: 90, attackSequence: 0, attackAt: 0, cookingEndsAt: 0, inventory: { rawMeat: 1, cookedMeat: 0 } };
  const room = { animals: [], enemies: [], players: new Map([[player.id, player]]), collision: new CollisionWorld([], { river: false }), camp: { x: 20, z: 18 } };
  return { room, player };
}
function swing(room, player, message = {}, now = 1000) {
  const began = startAttack(room, player, message, now);
  return { began, strike: resolveAttack(room, player, now + COMBAT.attackImpactMs) };
}

test('air swings start without any animals and always preserve forward facing despite forged payloads', () => {
  const { room, player } = fixture(); player.facing = 1.2;
  const { began, strike } = swing(room, player, { facing: Math.PI, health: 0, damage: 9000, attackAt: 1, x: 99, z: 99 });
  assert.equal(began.accepted, true); assert.deepEqual(strike, { hit: false });
  assert.equal(player.attackSequence, 1); assert.equal(player.attackAt, 1000); assert.equal(player.facing, 1.2);
  assert.equal(player.x, 20); assert.equal(player.z, 20); assert.equal(player.energy, 88); assert.equal(player.pendingStrike, null);
  assert.equal(startAttack(room, player, {}, 1000 + COMBAT.attackCooldownMs - 1).accepted, false);
  assert.equal(startAttack(room, player, {}, 1000 + COMBAT.attackCooldownMs).accepted, true);
  assert.equal(player.attackSequence, 2);
});

test('missing, invalid, remote and dead IDs do not block swings or redirect them behind the player', () => {
  for (const targetId of [undefined, 'missing', null, 42, {}, ['front'], 'remote', 'dead']) {
    const { room, player } = fixture();
    const front = creature('front'), behind = creature('behind', 20, 18), remote = creature('remote', 20, 80), dead = { ...creature('dead', 20, 18), phase: 'dead', health: 0 };
    room.animals.push(front, behind, remote, dead);
    const { began, strike } = swing(room, player, { targetId, damage: 1000 });
    assert.equal(began.accepted, true); assert.equal(strike.target, front); assert.equal(front.health, 75);
    assert.equal(behind.health, 100); assert.equal(remote.health, 100); assert.equal(player.facing, 0);
  }
});

test('a visible nearby click target can aim, while unrequested targets outside the forward arc remain unharmed', () => {
  const { room, player } = fixture(); const behind = creature('behind', 20, 18); room.animals.push(behind);
  assert.equal(swing(room, player).strike.hit, false); assert.equal(behind.health, 100);
  assert.equal(swing(room, player, { targetId: behind.id }, 2000).strike.target, behind);
  assert.equal(Math.abs(player.facing), Math.PI); assert.equal(behind.health, 75);
  const side = creature('side', 22, 20); player.facing = 0;
  assert.equal(inAttackArc(player, side), false);
  const angle = COMBAT.halfAngleRadians;
  assert.equal(inAttackArc(player, creature('inside', 20 + Math.sin(angle - .01) * 2, 20 + Math.cos(angle - .01) * 2)), true);
  assert.equal(inAttackArc(player, creature('outside', 20 + Math.sin(angle + .01) * 2, 20 + Math.cos(angle + .01) * 2)), false);
});

test('impact selects one nearest target in reach and rechecks moving targets and new occlusion after windup', () => {
  const { room, player } = fixture(); const far = creature('far', 20, 22.6), near = creature('near', 20, 21.8); room.animals.push(far, near);
  assert.equal(swing(room, player).strike.target, near); assert.equal(near.health, 75); assert.equal(far.health, 100);
  room.animals = [near]; near.z = 30;
  startAttack(room, player, {}, 2000); near.z = 22;
  assert.equal(resolveAttack(room, player, 2332), null); assert.equal(near.health, 75);
  assert.equal(resolveAttack(room, player, 2333).target, near); assert.equal(near.health, 50);
  startAttack(room, player, {}, 3000); near.z = 30;
  assert.equal(resolveAttack(room, player, 3333).hit, false); assert.equal(near.health, 50);
  near.z = 22; startAttack(room, player, {}, 4000);
  room.collision = new CollisionWorld([{ id: 'wall', type: 'box', x: 20, z: 21, hx: 1, hz: .1, c: 1, s: 0, height: 3 }], { river: false });
  assert.equal(resolveAttack(room, player, 4333).hit, false); assert.equal(near.health, 50);
  player.facing = Math.PI;
  const blockedClick = startAttack(room, player, { targetId: near.id }, 5000);
  assert.equal(blockedClick.accepted, true); assert.equal(player.facing, Math.PI);
  assert.equal(resolveAttack(room, player, 5333).hit, false);
  near.z = 20 + player.radius + near.radius + COMBAT.spearReach + .001;
  assert.equal(withinSpearReach(player, near), false);
});

test('explicit hostile enemies take damage and die without mammoth meat; friendlies cannot be targeted', () => {
  const { room, player } = fixture();
  const enemy = { ...creature('enemy'), hostile: true, name: '敵', health: 25, maxHealth: 25 };
  const friendly = { ...creature('orl', 20, 21), hostile: false };
  const peer = { ...creature('peer', 20, 21.4), inventory: {}, energy: 100 }; room.players.set(peer.id, peer);
  room.enemies.push(enemy, friendly); room.npc = friendly;
  const result = swing(room, player, { targetId: friendly.id });
  assert.equal(result.strike.target, enemy); assert.equal(result.strike.kind, 'enemy'); assert.equal(enemy.health, 0);
  assert.equal(enemy.phase, 'dead'); assert.equal(enemy.alive, false); assert.equal(friendly.health, 100); assert.equal(peer.health, 100);
  updateHunting(room, 1000 + COMBAT.attackImpactMs + HUNTING.deathDurationMs + HUNTING.respawnMs);
  assert.equal(enemy.phase, 'dead'); assert.equal(enemy.meatRemaining, undefined); assert.equal(player.inventory.rawMeat, 1);
  assert.equal(swing(room, player, { targetId: peer.id }, 100000).strike.hit, false);
  assert.equal(peer.health, 100);
});

test('attacking immediately interrupts cooking without consuming raw meat', () => {
  const { room, player } = fixture();
  handleHuntingAction(room, player, { action: 'cook' }, 1000);
  assert.equal(player.cookingEndsAt, 4000);
  const result = handleHuntingAction(room, player, { action: 'attack' }, 1001);
  assert.equal(result.changed, true); assert.equal(player.cookingEndsAt, 0); assert.equal(player.attackSequence, 1);
  updateHunting(room, 5000); assert.equal(player.inventory.rawMeat, 1); assert.equal(player.inventory.cookedMeat, 0);
});
