import {
  HUNTING,
  huntingDistance,
  nearestHuntTarget,
  usableCookingFire,
} from '../shared/hunting.mjs';
import { WORLD } from '../shared/world.mjs';
import { withinAttackReach } from '../shared/combat.mjs';
import { caveInteriorWeight } from '../shared/cave-light.mjs';

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
      'boat',
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

// The nearest visible meat, chosen by nearestHuntTarget as before but without tracing visibility
// (a stepped collision walk) to animals that cannot be harvested. Only meat is ever chosen, and
// when meat within harvestRange is visible the nearest visible meat is within it, so with every
// distance a number the result for the range check below is unchanged.
function nearestVisibleMeat(animals, player, collision) {
  const meat = animals.filter((animal) => animal.phase === 'meat');
  // A NaN distance chosen first is never replaced (x < NaN is false) and then fails the range
  // check; all meat is traced when one occurs, so that order-dependent result is kept too.
  const candidates = meat.some((animal) => Number.isNaN(huntingDistance(player, animal)))
    ? meat
    : meat.filter((animal) => huntingDistance(player, animal) <= HUNTING.harvestRange);
  return nearestHuntTarget(
    candidates.filter((animal) => !collision || collision.segmentFree(player, animal, 0.12)),
    player,
    'meat',
  );
}

export function huntInteraction(state, player, collision) {
  if (!player || player.mountId || player.downedUntil) return null;
  if (player.cookingEndsAt) return { action: 'cancelCook', label: '調理を中止する' };
  const meat = nearestVisibleMeat(state.animals || [], player, collision);
  if (meat && huntingDistance(player, meat) <= HUNTING.harvestRange) {
    return {
      action: 'harvest',
      targetId: meat.id,
      label: `生肉を採る（残り${meat.meatRemaining}個）`,
    };
  }
  const fire = usableCookingFire(state, player, collision);
  const inv = inventoryCounts(player.inventory);
  if (inv.rawRoot && fire) return { action: 'cropFoodOpen', label: '火根の焼き方を選ぶ' };
  if (
    (inventoryCounts(player.inventory).rawMeat ||
      inventoryCounts(player.inventory).rawFish ||
      inventoryCounts(player.inventory).rawShellfish) &&
    fire
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
    caveInteriorWeight(player) === 0 &&
    !player.mountId &&
    !player.downedUntil &&
    !animal?.riderId &&
    animal?.phase === 'alive' &&
    withinAttackReach({ ...player, radius: player.radius ?? WORLD.playerRadius }, animal)
  );
}
