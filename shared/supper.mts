import { PANTRY, PANTRY_FOODS, pantryAvailable, pantryTotal } from './pantry.mjs';
import { MANY_HEARTHS, SETTLEMENTS, GULF_SCENERY } from './gulf-region.mjs';
import { RESIDENTS, villageDay, villagePhase } from './village-sites.mjs';
import { householdFor } from './household-sites.mjs';
import { interactionVisible } from './interactions.mjs';
import { stopActor } from './combat.mjs';
import type { ResidentSupper } from './supper-types.mjs';
import type { Resident } from './village-types.mjs';
import type { PantryState } from './pantry-types.mjs';

// An authored shared supper, not all resident subsistence or an archaeological ration.
export const SUPPER = Object.freeze({ reach: 22, pauseMs: 8000, shellCapacity: 99 });
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
// Guests also sit around the existing smaller hearth. Its stones may block the
// central hearth, so validate the clear view to either actual gathering hearth.
const supperHearths = new Map(
  SETTLEMENTS.map((s) => [
    s.id,
    [...GULF_SCENERY.fires, ...GULF_SCENERY.props].filter(
      (p) => p.key === 'stone-firepit' && distance(p, s) <= SUPPER.reach,
    ),
  ]),
);
export function supperPlace(world, residentId: string) {
  const definition = RESIDENTS.find((r) => r.id === residentId);
  if (!definition) return null;
  const household = householdFor(residentId),
    journey = world.households?.find((h) => h.id === household?.id);
  if (journey && journey.stage !== 'home' && journey.stage !== 'visiting') return null;
  return journey?.stage === 'visiting' ? MANY_HEARTHS.id : definition.settlementId;
}
export function normalizeResidentSupper(value, day: number): ResidentSupper | null {
  return Number.isSafeInteger(value?.day) &&
    value.day > 0 &&
    value.day <= day &&
    SETTLEMENTS.some((s) => s.id === value.settlementId) &&
    PANTRY_FOODS.some((f) => f.id === value.foodId)
    ? { day: value.day, settlementId: value.settlementId, foodId: value.foodId }
    : null;
}
export function supperLabel(meal: ResidentSupper | null | undefined, day: number) {
  const food = PANTRY_FOODS.find((f) => f.id === meal?.foodId),
    place = SETTLEMENTS.find((s) => s.id === meal?.settlementId);
  return meal?.day === day && food && place
    ? `今日の持ち寄り：${food.name}を${place.name}で食べた`
    : '今日の持ち寄りの夕食はまだ';
}
export function restingAfterSupper(room, resident: Resident, now: number) {
  return (
    villagePhase(now, room.createdAt) === 2 &&
    now < resident.supperUntil &&
    resident.supper?.day === villageDay(now, room.createdAt) &&
    resident.supper.settlementId === supperPlace(room, resident.id)
  );
}
export function atSupperHearth(room, resident: Resident, now: number) {
  const placeId = supperPlace(room, resident.id),
    place = SETTLEMENTS.find((s) => s.id === placeId);
  return (
    !!place &&
    villagePhase(now, room.createdAt) === 2 &&
    resident.phase === 2 &&
    !resident.moving &&
    !!resident.destination &&
    distance(resident, resident.destination) <= 0.15 &&
    distance(resident, place) <= SUPPER.reach &&
    !(resident.talkerId && resident.talkUntil > now && room.players.has(resident.talkerId)) &&
    supperHearths
      .get(placeId)
      .some((hearth) => interactionVisible(room.collision, resident, hearth))
  );
}
export function updateSuppers(room, now: number) {
  if (!room.players.size || villagePhase(now, room.createdAt) !== 2) return false;
  const day = villageDay(now, room.createdAt);
  const order = SETTLEMENTS.flatMap((place) => {
    const diners = RESIDENTS.filter((r) => supperPlace(room, r.id) === place.id);
    if (!diners.length) return [];
    const first = (day - 1) % diners.length;
    return [...diners.slice(first), ...diners.slice(0, first)];
  });
  let changed = false;
  for (const definition of order) {
    const resident: Resident = room.residents?.find((r) => r.id === definition.id),
      placeId = supperPlace(room, definition.id);
    if (!resident || resident.supper?.day >= day || !atSupperHearth(room, resident, now)) continue;
    const pantry: PantryState = room.gulf.pantries.find((p) => p.settlementId === placeId);
    const firstFood = (day - 1 + RESIDENTS.indexOf(definition)) % PANTRY_FOODS.length;
    const food = Array.from(
      { length: PANTRY_FOODS.length },
      (_, i) => PANTRY_FOODS[(firstFood + i) % PANTRY_FOODS.length],
    ).find(
      (f) =>
        (pantry?.supper?.[f.id] ?? 0) > 0 &&
        (f.id !== 'cookedShellfish' || pantry.supperShells < SUPPER.shellCapacity),
    );
    if (!food) continue;
    pantry.supper[food.id]--;
    if (food.id === 'cookedShellfish') pantry.supperShells++;
    resident.supper = { day, foodId: food.id, settlementId: placeId };
    resident.supperUntil = now + SUPPER.pauseMs;
    stopActor(resident);
    resident.activity = `炉で${food.name}を分け合っている`;
    resident.clip = 'Idle_Loop';
    changed = true;
  }
  return changed;
}
export function handleSupperAction(room, player, message, now: number) {
  if (!['gulfSupperGive', 'gulfSupperRelease', 'gulfSupperShells'].includes(message.action))
    return null;
  const fail = (text: string) => ({ ok: false, text });
  if (!pantryAvailable(player, now)) return fail('地上で作業を終えてから、夕食を用意しよう。');
  const parts = typeof message.targetId === 'string' ? message.targetId.split(':') : [],
    place = parts.length === 2 && SETTLEMENTS.find((s) => s.id === parts[0]),
    food = PANTRY_FOODS.find((f) => f.id === parts[1]);
  if (!place || (message.action === 'gulfSupperShells' ? parts[1] !== 'shells' : !food))
    return fail('その夕食の場所や食べ物は見つかりません。');
  if (distance(player, place) > PANTRY.reach || !interactionVisible(room.collision, player, place))
    return fail('選んだ集落の炉のそばへ来よう。');
  const pantry: PantryState = room.gulf.pantries.find((p) => p.settlementId === place.id);
  if (message.action === 'gulfSupperShells') {
    const owned = player.inventory.shells ?? 0;
    if (!Number.isSafeInteger(owned) || owned < 0 || owned >= 99)
      return fail('貝殻のもちものを空けてから受け取ろう。');
    if (pantry.supperShells < 1) return fail('食べ終えた殻はまだありません。');
    pantry.supperShells--;
    player.inventory.shells = owned + 1;
  } else if (message.action === 'gulfSupperRelease') {
    if (pantry.supper[food.id] < 1) return fail('その食べ物は、夕食には残っていません。');
    pantry.supper[food.id]--;
    pantry.food[food.id]++;
  } else {
    const owned = player.inventory[food.id] ?? 0;
    if (!Number.isSafeInteger(owned) || owned < 1 || owned > 99)
      return fail(`${food.name}を1つ持ってこよう。`);
    if (pantryTotal(pantry) >= PANTRY.capacity)
      return fail('共同食料と夕食で48個です。今は置き場がいっぱいです。');
    player.inventory[food.id] = owned - 1;
    pantry.supper[food.id]++;
  }
  stopActor(player);
  return {
    ok: true,
    text:
      message.action === 'gulfSupperGive'
        ? `${food.name}を住人の夕食へ取り分けた。`
        : message.action === 'gulfSupperRelease'
          ? `${food.name}を共同食料へ戻した。`
          : '夕食の貝殻を受け取った。貝塚へ持っていこう。',
  };
}
