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
  if (!['attack', 'harvest', 'cook', 'eatMeat', 'cancelCook'].includes(action)) return null;
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
        ? `調理を中止。${profile.startText}生肉は手元に残っています。`
        : profile.startText,
      'info',
      true,
    );
  }
  if (action === 'cancelCook') {
    if (!player.cookingEndsAt) return response('今は肉を焼いていません。', 'info');
    player.cookingEndsAt = 0;
    return response('調理を中止した。生肉は手元に残っています。', 'info', true);
  }
  if (player.cookingEndsAt) return response('肉を焼いています。火から離れると中止します。', 'info');
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
  if (action === 'cook') {
    const fire = nearestCookingFire(room, player);
    if (huntingDistance(player, fire) > HUNTING.cookRange)
      return response('焚き火に近づいて肉を焼こう。');
    if (!interactionVisible(room.collision, player, fire))
      return response('火までの間がふさがれています。回り込もう。');
    if (!player.inventory.rawMeat) return response('焼くための生肉を持っていません。');
    if (player.inventory.cookedMeat >= HUNTING.inventoryLimit)
      return response('焼いた肉の持ち物がいっぱいです。');
    stopActor(player);
    player.cookingEndsAt = now + HUNTING.cookDurationMs;
    return response('肉を焼いています。火のそばで3秒待とう。', 'info', true);
  }
  if (!player.inventory.cookedMeat)
    return response('焼いた肉を持っていません。生肉は焚き火で焼こう。');
  if (player.energy >= 100) return response('元気いっぱいです。', 'info');
  player.inventory.cookedMeat -= 1;
  const restored = Math.min(HUNTING.cookedMeatEnergy, 100 - player.energy);
  player.energy += restored;
  return response(`焼いた肉を食べた。元気 +${restored}`, 'success', true);
}

export function updateHunting(
  room,
  now = Date.now(),
  notify = (_player, _text: string, _tone?: string) => {},
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
    if (huntingDistance(player, nearestCookingFire(room, player)) > HUNTING.cookRange) {
      player.cookingEndsAt = 0;
      changed = true;
      notify(player, '火から離れたので調理を中止した。生肉は手元に残っています。', 'info');
    } else if (now >= player.cookingEndsAt) {
      player.cookingEndsAt = 0;
      changed = true;
      if (player.inventory.rawMeat > 0 && player.inventory.cookedMeat < HUNTING.inventoryLimit) {
        player.inventory.rawMeat -= 1;
        player.inventory.cookedMeat += 1;
        notify(player, '焼いた肉 +1。食べると元気が45回復します。', 'success');
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
    } else if (animal.phase === 'respawning' && now - animal.phaseStartedAt >= HUNTING.respawnMs) {
      const dynamic = obstacles([
        ...room.players.values(),
        ...room.animals.filter((other) => other !== animal && animalIsSolid(other)),
        ...(room.enemies || []).filter(enemyIsSolid),
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
