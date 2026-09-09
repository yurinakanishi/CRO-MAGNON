import {
  HUNTING,
  huntingDistance,
  nearestHuntTarget,
  nearestCookingFire,
} from '../shared/hunting.mjs';
import { WORLD } from '../shared/world.mjs';
import { withinAttackReach } from '../shared/combat.mjs';

import { interactionVisible } from '../shared/interactions.mjs';
import { CROP_INVENTORY } from '../shared/crops.mjs';

export function inventoryCounts(inventory = {}) {
  return Object.fromEntries(
    [
      ...CROP_INVENTORY,
      'wood',
      'stone',
      'berry',
      'rawMeat',
      'cookedMeat',
      'obsidian',
      'seed',
      'water',
      'rawFish',
      'cookedFish',
      'rawShellfish',
      'cookedShellfish',
      'shells',
      'obsidianBlade',
    ].map((key) => [key, Math.max(0, Number(inventory[key]) || 0)]),
  );
}

export function selectedHuntTarget(animals, player, selectedId) {
  if (!player) return null;
  animals = animals.filter((animal) => !animal.riderId);
  return (
    animals.find((animal) => animal.id === selectedId && animal.phase !== 'respawning') ||
    animals
      .filter((animal) => ['alive', 'dying', 'meat'].includes(animal.phase))
      .reduce(
        (nearest, animal) =>
          !nearest || huntingDistance(player, animal) < huntingDistance(player, nearest)
            ? animal
            : nearest,
        null,
      )
  );
}

export function selectedCombatTarget(state, player, selectedId) {
  if (!player) return null;
  const enemies = (state.enemies || []).filter(
    (enemy) => enemy.hostile === true && enemy.phase !== 'respawning',
  );
  const threat = enemies
    .filter((enemy) => enemy.phase === 'alive' && huntingDistance(player, enemy) <= 10)
    .sort((a, b) => huntingDistance(player, a) - huntingDistance(player, b))[0];
  // A nearby hostile must remain visible even while a distant mammoth is selected.
  return (
    threat ||
    enemies.find((enemy) => enemy.id === selectedId) ||
    selectedHuntTarget(state.animals || [], player, selectedId)
  );
}

export function huntInteraction(state, player, collision) {
  if (!player || player.mountId || player.downedUntil) return null;
  if (player.cookingEndsAt) return { action: 'cancelCook', label: '調理を中止する' };
  const meat = nearestHuntTarget(
    (state.animals || []).filter(
      (animal) => !collision || collision.segmentFree(player, animal, 0.12),
    ),
    player,
    'meat',
  );
  if (meat && huntingDistance(player, meat) <= HUNTING.harvestRange) {
    return {
      action: 'harvest',
      targetId: meat.id,
      label: `生肉を採る（残り${meat.meatRemaining}個）`,
    };
  }
  const fire = nearestCookingFire(state, player);
  const inv = inventoryCounts(player.inventory);
  if (
    inv.rawRoot &&
    huntingDistance(player, fire) <= HUNTING.cookRange &&
    (!collision || interactionVisible(collision, player, fire))
  )
    return { action: 'cropFoodOpen', label: '火根の焼き方を選ぶ' };
  if (
    (inventoryCounts(player.inventory).rawMeat ||
      inventoryCounts(player.inventory).rawFish ||
      inventoryCounts(player.inventory).rawShellfish) &&
    huntingDistance(player, fire) <= HUNTING.cookRange &&
    (!collision || interactionVisible(collision, player, fire))
  ) {
    return inventoryCounts(player.inventory).rawMeat
      ? { action: 'cook', label: '焚き火で生肉を焼く（3秒）' }
      : inventoryCounts(player.inventory).rawFish
        ? { action: 'cookFish', label: '焚き火で生魚を焼く（3秒）' }
        : { action: 'cookShellfish', label: '焚き火で貝を焼く（3秒）' };
  }
  return null;
}

export function attackReady(player, animal) {
  return (
    !!player &&
    !player.mountId &&
    !player.downedUntil &&
    !animal?.riderId &&
    animal?.phase === 'alive' &&
    withinAttackReach({ ...player, radius: player.radius ?? WORLD.playerRadius }, animal)
  );
}
