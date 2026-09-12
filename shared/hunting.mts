import { FISHING } from './fishing-sites.mjs';
import { respawnDelay } from './room-rules.mjs';
import { COASTAL } from './coastal-sites.mjs';
import { ROOT_RECIPES } from './crops.mjs';
import { CAMP } from './world.mjs';
import {
  COMBAT,
  combatDistance,
  startAttack,
  resolveAttack,
  stopActor,
  enemyIsSolid,
  updateProjectiles,
} from './combat.mjs';
import { attackProfile } from './combat-profiles.mjs';
import { interactionVisible } from './interactions.mjs';
export { withinSpearReach, stopActor } from './combat.mjs';

// Distances use the same body radii as authoritative movement collision.
export const HUNTING = Object.freeze({
  ...COMBAT,
  maxHealth: 100,
  deathDurationMs: 1200,
  meatPerAnimal: 4,
  harvestRange: 2.2,
  respawnMs: 90000,
  cookRange: 3.4,
  cookDurationMs: 3000,
  cookedMeatEnergy: 45,
  inventoryLimit: 99,
});

export const huntingDistance = combatDistance;
export function nearestCookingFire(state, player) {
  const fires = state.cookingFires?.length ? state.cookingFires : [state.camp || CAMP];
  return fires.reduce(
    (nearest, fire) =>
      !nearest || huntingDistance(player, fire) < huntingDistance(player, nearest) ? fire : nearest,
    null,
  );
}
export const animalIsSolid = (animal) => animal.phase === 'alive' || animal.phase === 'dying';
export function nearestHuntTarget(animals, player, phase = 'alive') {
  return animals
    .filter((animal) => animal.phase === phase)
    .reduce(
      (nearest, animal) =>
        !nearest || huntingDistance(player, animal) < huntingDistance(player, nearest)
          ? animal
          : nearest,
      null,
    );
}
export function initialHuntState(now = Date.now()) {
  return {
    phase: 'alive',
    health: HUNTING.maxHealth,
    maxHealth: HUNTING.maxHealth,
    meatRemaining: 0,
    phaseStartedAt: now,
    hitUntil: 0,
  };
}
const response = (text, tone = 'error', changed = false) => ({ text, tone, changed });
const obstacles = (actors) =>
  actors.map((actor) => ({
    id: actor.id,
    type: 'circle',
    x: actor.x,
    z: actor.z,
    radius: actor.radius,
  }));

// Called only by the server. Client input chooses an action and optional target,
// never damage, inventory, phase, position, or completion time.
export function handleHuntingAction(room, player, message, now = Date.now()) {
  const { action, targetId } = message;
  if (
    ![
      'attack',
      'harvest',
      'cook',
      'eatMeat',
      'cookFish',
      'eatFish',
      'cookShellfish',
      'eatShellfish',
      ...ROOT_RECIPES.flatMap((recipe) => [recipe.action, recipe.eatAction]),
      'cancelCook',
    ].includes(action)
  )
    return null;
  const fish = action === 'cookFish' || action === 'eatFish';
  const shellfish = action === 'cookShellfish' || action === 'eatShellfish';
  const recipe = ROOT_RECIPES.find((r) => r.action === action || r.eatAction === action);
  const raw = recipe ? 'rawRoot' : shellfish ? 'rawShellfish' : fish ? 'rawFish' : 'rawMeat',
    cooked = recipe
      ? recipe.output
      : shellfish
        ? 'cookedShellfish'
        : fish
          ? 'cookedFish'
          : 'cookedMeat';
  const label = recipe ? '火根' : shellfish ? '貝' : fish ? '魚' : '肉',
    foodName = recipe ? recipe.name : `焼いた${label}`,
    energy = recipe
      ? recipe.energy
      : shellfish
        ? COASTAL.shellEnergy
        : fish
          ? FISHING.energy
          : HUNTING.cookedMeatEnergy;
  if (action === 'attack') {
    const result = startAttack(room, player, message, now);
    const profile = attackProfile(player);
    if (!result.accepted)
      return response(
        profile.key === 'spear' ? '槍を構え直しています。' : '次の攻撃を準備しています。',
        'info',
      );
    return response(
      result.interruptedCooking
        ? `調理を中止。${profile.startText}食材は手元に残っています。`
        : profile.startText,
      'info',
      true,
    );
  }
  if (action === 'cancelCook') {
    if (!player.cookingEndsAt) return response('今は調理していません。', 'info');
    player.cookingEndsAt = 0;
    return response('調理を中止した。食材は手元に残っています。', 'info', true);
  }
  if (player.cookingEndsAt) return response('調理中です。火から離れると中止します。', 'info');
  if (player.attackSequence && now - player.attackAt < attackProfile(player).durationMs)
    return response('攻撃が終わってから行おう。', 'info');
  if (action === 'harvest') {
    const animal =
      targetId === undefined
        ? nearestHuntTarget(room.animals, player, 'meat')
        : typeof targetId === 'string'
          ? room.animals.find((item) => item.id === targetId && item.phase === 'meat')
          : null;
    if (!animal) return response('拾える肉がありません。');
    if (huntingDistance(player, animal) > HUNTING.harvestRange)
      return response('肉に近づいてから拾おう。');
    if (!room.collision.segmentFree(player, animal, 0.12))
      return response('岩や小屋に遮られています。回り込もう。');
    if (player.inventory.rawMeat >= HUNTING.inventoryLimit)
      return response('生肉の持ち物がいっぱいです。');
    if (animal.meatRemaining <= 0) return response('この肉はもう拾われました。');
    // This mutation is serialized in the room; five clients share one pile.
    animal.meatRemaining -= 1;
    player.inventory.rawMeat += 1;
    if (!animal.meatRemaining) {
      animal.phase = 'respawning';
      animal.phaseStartedAt = now;
    }
    return response('生肉 +1。焚き火で焼くと食べられます。', 'success', true);
  }
  if (
    action === 'cook' ||
    action === 'cookFish' ||
    action === 'cookShellfish' ||
    recipe?.action === action
  ) {
    const fire = nearestCookingFire(room, player);
    if (huntingDistance(player, fire) > HUNTING.cookRange)
      return response(`焚き火に近づいて${label}を焼こう。`);
    if (!interactionVisible(room.collision, player, fire))
      return response('火までの間がふさがれています。回り込もう。');
    if (!player.inventory[raw]) return response(`焼くための生${label}を持っていません。`);
    if (
      recipe &&
      Object.entries(recipe.ingredients).some(([key, n]) => (player.inventory[key] ?? 0) < n)
    )
      return response(`${recipe.name}には${recipe.costText}が必要です。`);
    if ((player.inventory[cooked] ?? 0) >= HUNTING.inventoryLimit)
      return response(`${foodName}の持ち物がいっぱいです。`);
    stopActor(player);
    player.cookingKind = recipe ? recipe.kind : shellfish ? 'shellfish' : fish ? 'fish' : 'meat';
    player.cookingEndsAt = now + HUNTING.cookDurationMs;
    return response(
      `${recipe ? recipe.name : label}を${recipe ? '作って' : '焼いて'}います。火のそばで3秒待とう。`,
      'info',
      true,
    );
  }
  if (!player.inventory[cooked]) return response(`${foodName}を持っていません。焚き火で焼こう。`);
  if (player.energy >= 100) return response('元気いっぱいです。', 'info');
  if (shellfish && (player.inventory.shells ?? 0) >= HUNTING.inventoryLimit)
    return response('貝殻の持ち物がいっぱいです。集落の貝塚へ殻を積んでから食べよう。');
  player.inventory[cooked] -= 1;
  if (shellfish) player.inventory.shells = (player.inventory.shells ?? 0) + 1;
  const restored = Math.min(energy, 100 - player.energy);
  player.energy += restored;
  return response(
    `${foodName}を食べた。元気 +${restored}${shellfish ? '・貝殻 +1' : ''}`,
    'success',
    true,
  );
}

export function updateHunting(
  room,
  now = Date.now(),
  notify = (_player, _text: string, _tone?: string, _popup?: boolean) => {},
) {
  let changed = false;
  const reportHit = (player, strike) => {
    changed = true;
    const label = strike.kind === 'animal' ? 'マンモス' : strike.target.name || '敵';
    if (strike.killed)
      notify(
        player,
        strike.kind === 'animal'
          ? 'マンモスを倒した！ 肉になったら近づいて拾おう。'
          : `${label}を倒した！`,
        'success',
      );
    else
      notify(
        player,
        `${attackProfile(player).noun}が命中！ ${label} ${strike.target.health} / ${strike.target.maxHealth}`,
        'success',
      );
  };
  for (const player of room.players.values()) {
    const strike = resolveAttack(room, player, now);
    if (strike?.hit) reportHit(player, strike);
    if (strike && 'launched' in strike && strike.launched) changed = true;
    if (!player.cookingEndsAt) continue;
    const fire = nearestCookingFire(room, player);
    if (
      player.downedUntil ||
      player.boatId ||
      player.mountId ||
      huntingDistance(player, fire) > HUNTING.cookRange ||
      !interactionVisible(room.collision, player, fire)
    ) {
      player.cookingEndsAt = 0;
      changed = true;
      notify(
        player,
        '火から離れたか、火を使えなくなったので調理を中止した。食材は手元に残っています。',
        'info',
        false,
      );
    } else if (now >= player.cookingEndsAt) {
      player.cookingEndsAt = 0;
      changed = true;
      const fish = player.cookingKind === 'fish';
      const shellfish = player.cookingKind === 'shellfish';
      const recipe = ROOT_RECIPES.find((r) => r.kind === player.cookingKind);
      const raw = recipe ? 'rawRoot' : shellfish ? 'rawShellfish' : fish ? 'rawFish' : 'rawMeat',
        cooked = recipe
          ? recipe.output
          : shellfish
            ? 'cookedShellfish'
            : fish
              ? 'cookedFish'
              : 'cookedMeat';
      if (
        player.inventory[raw] > 0 &&
        (player.inventory[cooked] ?? 0) < HUNTING.inventoryLimit &&
        (!recipe ||
          Object.entries(recipe.ingredients).every(([key, n]) => (player.inventory[key] ?? 0) >= n))
      ) {
        player.inventory[raw] -= 1;
        if (recipe?.ingredients.herb) player.inventory.herb -= recipe.ingredients.herb;
        player.inventory[cooked] = (player.inventory[cooked] ?? 0) + 1;
        notify(
          player,
          recipe
            ? `${recipe.name} +1。食べると元気+${recipe.energy}。宴へも持ち寄れます。`
            : shellfish
              ? '焼いた貝 +1。食べると元気+20、残った殻は貝塚へ持ち帰ろう。'
              : fish
                ? '焼き魚 +1。食べると元気+30。宴へも持ち寄れます。'
                : '焼いた肉 +1。食べると元気が45回復します。',
          'success',
        );
      } else notify(player, '調理を中止した。持ち物を確認してください。', 'error');
    }
  }
  for (const strike of updateProjectiles(room, now)) reportHit(strike.owner, strike);
  for (const animal of room.animals) {
    if (animal.phase === 'dying' && now - animal.phaseStartedAt >= HUNTING.deathDurationMs) {
      animal.phase = 'meat';
      animal.phaseStartedAt = now;
      animal.meatRemaining = HUNTING.meatPerAnimal;
      animal.clip = null;
      changed = true;
    } else if (
      animal.phase === 'meat' &&
      room.rules?.meatLingerMs != null &&
      now - animal.phaseStartedAt >= room.rules.meatLingerMs - HUNTING.deathDurationMs
    ) {
      // Exhibition floor: the pile is cleared and the herd returns right away,
      // one linger period after the kill.
      animal.meatRemaining = 0;
      animal.phase = 'respawning';
      animal.phaseStartedAt = now - respawnDelay(room, HUNTING.respawnMs);
      changed = true;
    }
    if (
      animal.phase === 'respawning' &&
      now - animal.phaseStartedAt >= respawnDelay(room, HUNTING.respawnMs)
    ) {
      const dynamic = obstacles([
        ...room.players.values(),
        ...room.animals.filter((other) => other !== animal && animalIsSolid(other)),
        ...(room.enemies || []).filter(enemyIsSolid),
        ...(room.residents || []),
      ]);
      const spawn = room.collision.nearestFree(
        animal.home,
        animal.radius,
        dynamic,
        animal.roamRadius,
      );
      if (!spawn) continue;
      Object.assign(animal, spawn, initialHuntState(now));
      stopActor(animal);
      animal.nextRoam = animal.age + 1;
      animal.clip = 'Idle_Loop';
      changed = true;
    }
  }
  return changed;
}
