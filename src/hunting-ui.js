import { HUNTING, huntingDistance, nearestHuntTarget, nearestCookingFire } from '../shared/hunting.mjs';
import { WORLD } from '../shared/world.mjs';
import { withinAttackReach } from '../shared/combat.mjs';

export function inventoryCounts(inventory = {}) {
  return Object.fromEntries(['wood', 'stone', 'berry', 'rawMeat', 'cookedMeat'].map(key => [key, Math.max(0, Number(inventory[key]) || 0)]));
}

export function selectedHuntTarget(animals, player, selectedId) {
  if (!player) return null;
  return animals.find(animal => animal.id === selectedId && animal.phase !== 'respawning')
    || nearestHuntTarget(animals, player, 'alive') || nearestHuntTarget(animals, player, 'meat');
}

export function selectedCombatTarget(state, player, selectedId) {
  if (!player) return null;
  const enemies = (state.enemies || []).filter(enemy => enemy.hostile === true && enemy.phase !== 'respawning');
  const threat = enemies.filter(enemy => enemy.phase === 'alive' && huntingDistance(player, enemy) <= 10)
    .sort((a, b) => huntingDistance(player, a) - huntingDistance(player, b))[0];
  // A nearby hostile must remain visible even while a distant mammoth is selected.
  return threat || enemies.find(enemy => enemy.id === selectedId)
    || selectedHuntTarget(state.animals || [], player, selectedId);
}

export function huntInteraction(state, player) {
  if (!player) return null;
  if (player.cookingEndsAt) return { action: 'cancelCook', label: '肉を焼くのを中止する' };
  const meat = nearestHuntTarget(state.animals || [], player, 'meat');
  if (meat && huntingDistance(player, meat) <= HUNTING.harvestRange) {
    return { action: 'harvest', targetId: meat.id, label: `生肉を採る（残り${meat.meatRemaining}個）` };
  }
  if (inventoryCounts(player.inventory).rawMeat && huntingDistance(player, nearestCookingFire(state,player)) <= HUNTING.cookRange) {
    return { action: 'cook', label: '焚き火で生肉を焼く（3秒）' };
  }
  return null;
}

export function attackReady(player, animal) {
  return !!player && animal?.phase === 'alive' && withinAttackReach({ ...player, radius: player.radius ?? WORLD.playerRadius }, animal);
}

export function approachAnimal(player, animal) {
  const dx = player.x - animal.x, dz = player.z - animal.z, length = Math.hypot(dx, dz);
  const radius = animal.phase === 'meat' ? 1 : animal.radius + (player.radius ?? WORLD.playerRadius) + .9;
  return { x: animal.x + (length ? dx / length : 0) * radius, z: animal.z + (length ? dz / length : 1) * radius };
}

export function approachEnemyGround(player, ground) {
  const dx=player.x-ground.x,dz=player.z-ground.z,length=Math.hypot(dx,dz);
  // Three metres from home stays inside aggro even if the enemy completes its
  // full 3.2 m roam while the player is walking from camp.
  return { x:ground.x+(length?dx/length:0)*3, z:ground.z+(length?dz/length:1)*3 };
}
