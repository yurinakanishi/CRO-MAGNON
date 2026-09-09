import { SETTLEMENTS } from './gulf-region.mjs';
import { interactionVisible } from './interactions.mjs';
import { attackProfile } from './combat-profiles.mjs';
import { stopActor } from './combat.mjs';
import { villageDay } from './village-sites.mjs';
import type { PantryFoodId, PantryState, PantryAllowance } from './pantry-types.mjs';

// Authored sharing rules and unlimited shelf life, not a reconstructed storage institution.
export const PANTRY = Object.freeze({ capacity: 48, dailyAllowance: 3, reach: 9 });
export const PANTRY_FOODS: readonly {
  id: PantryFoodId;
  name: string;
  energy: number;
  eatAction: string;
  use: string;
}[] = Object.freeze([
  {
    id: 'berry',
    name: 'ベリー',
    energy: 25,
    eatAction: 'eat',
    use: 'そのまま食べるほか、種・旅支度・宴の持ち寄りに。',
  },
  {
    id: 'cookedMeat',
    name: '焼き肉',
    energy: 45,
    eatAction: 'eatMeat',
    use: '狩りで得た肉を焼いた食事。長い旅の補給に。',
  },
  {
    id: 'cookedFish',
    name: '焼き魚',
    energy: 30,
    eatAction: 'eatFish',
    use: '釣った魚を焼いた食事。集い場の宴にも持ち寄れる。',
  },
  {
    id: 'cookedShellfish',
    name: '焼いた貝',
    energy: 20,
    eatAction: 'eatShellfish',
    use: '食べ終えた殻は貝塚へ。ネリの手伝いにも使える。',
  },
  {
    id: 'cookedRoot',
    name: '焼き根',
    energy: 35,
    eatAction: 'eatRoot',
    use: '共同の畑の火根を焼いた食事。宴にも持ち寄れる。',
  },
  {
    id: 'herbRoot',
    name: '香草焼き根',
    energy: 50,
    eatAction: 'eatHerbRoot',
    use: '火根と香草で作る食事。宴にも持ち寄れる。',
  },
]);
const bounded = (n: unknown, max: number) =>
  typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.min(max, Math.floor(n))) : 0;
export function createPantries(saved?: unknown): PantryState[] {
  return SETTLEMENTS.map((s) => {
    const old = Array.isArray(saved) ? saved.find((p) => p?.settlementId === s.id) : null;
    let remaining = PANTRY.capacity;
    const portion = (savedFood) =>
      Object.fromEntries(
        PANTRY_FOODS.map(({ id }) => {
          const n = bounded(savedFood?.[id], remaining);
          remaining -= n;
          return [id, n];
        }),
      ) as PantryState['food'];
    const food = portion(old?.food),
      supper = portion(old?.supper);
    return { settlementId: s.id, food, supper, supperShells: bounded(old?.supperShells, 99) };
  });
}
export const pantryTotal = (pantry?: PantryState) =>
  PANTRY_FOODS.reduce((n, f) => n + (pantry?.food[f.id] ?? 0) + (pantry?.supper?.[f.id] ?? 0), 0);
export const supperTotal = (pantry?: PantryState) =>
  PANTRY_FOODS.reduce((n, f) => n + (pantry?.supper?.[f.id] ?? 0), 0);
export function normalizePantryAllowance(value): PantryAllowance {
  return {
    day: bounded(value?.day, Number.MAX_SAFE_INTEGER),
    taken: bounded(value?.taken, PANTRY.dailyAllowance),
  };
}
export const pantryRemaining = (allowance: PantryAllowance | undefined, day: number) =>
  PANTRY.dailyAllowance -
  (allowance?.day === day ? bounded(allowance.taken, PANTRY.dailyAllowance) : 0);
export function pantryAvailable(player, now = Date.now()) {
  return (
    !!player &&
    !player.downedUntil &&
    !player.mountId &&
    !player.boatId &&
    !player.carrierId &&
    !player.passengerId &&
    !player.cookingEndsAt &&
    !player.coastalActivity &&
    !player.fishing &&
    !(player.attackSequence && now - player.attackAt < attackProfile(player).durationMs)
  );
}
export function handlePantryAction(room, player, message, now: number) {
  if (!['gulfPantryGive', 'gulfPantryTake'].includes(message.action)) return null;
  const fail = (text: string) => ({ ok: false, text });
  if (!pantryAvailable(player, now)) return fail('地上で作業を終えてから、食料を分けよう。');
  const parts = typeof message.targetId === 'string' ? message.targetId.split(':') : [];
  const settlement = parts.length === 2 && SETTLEMENTS.find((s) => s.id === parts[0]);
  const item = PANTRY_FOODS.find((f) => f.id === parts[1]);
  if (!settlement || !item) return fail('その場所や食べ物は見つかりません。');
  if (
    Math.hypot(player.x - settlement.x, player.z - settlement.z) > PANTRY.reach ||
    !interactionVisible(room.collision, player, settlement)
  )
    return fail(`${settlement.name}の炉へ近づいて、食料を分けよう。`);
  const pantry: PantryState = room.gulf.pantries.find((p) => p.settlementId === settlement.id);
  const inv = player.inventory;
  const count = inv[item.id] ?? 0;
  if (!Number.isSafeInteger(count) || count < 0 || count > 99)
    return fail('もちものを確認して、もう一度試そう。');
  if (message.action === 'gulfPantryGive') {
    if (count < 1) return fail(`${item.name}を1つ持ってこよう。`);
    if (pantryTotal(pantry) >= PANTRY.capacity)
      return fail('食料置き場はいっぱいです。食料はもちものに残っています。');
    inv[item.id] = count - 1;
    pantry.food[item.id]++;
    stopActor(player);
    return { ok: true, text: `${item.name}を1つ、みんなの食料置き場へ預けた。` };
  }
  const day = villageDay(now, room.createdAt);
  if (pantryRemaining(player.gulf.pantryAllowance, day) === 0)
    return fail('今日の受け取りは3つまで。また明日、炉へ来よう。');
  if (pantry.food[item.id] < 1) return fail('その食べ物は今、置き場にありません。');
  if (count >= 99) return fail('受け取れるよう、もちものを空けよう。食料は置き場に残っています。');
  const remaining = pantryRemaining(player.gulf.pantryAllowance, day);
  pantry.food[item.id]--;
  inv[item.id] = count + 1;
  player.gulf.pantryAllowance = { day, taken: PANTRY.dailyAllowance - remaining + 1 };
  stopActor(player);
  return { ok: true, text: `${item.name}を1つ受け取った。今日あと${remaining - 1}つ。` };
}
