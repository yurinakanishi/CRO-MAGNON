import { GULF_RESOURCES, SETTLEMENTS } from './gulf-region.mjs';
import { RESIDENTS, villageDay, villagePhase } from './village-sites.mjs';
import { supperPlace, atSupperHearth } from './supper.mjs';
import { PANTRY, pantryTotal } from './pantry.mjs';
import { interactionVisible } from './interactions.mjs';
import type { Resident } from './village-types.mjs';
import type { ResidentForage } from './foraging-types.mjs';

// Authored small-scale foraging, not a complete subsistence or nutrition model.
export const FORAGING = Object.freeze({ workMs: 4000, reach: 4, reserve: 2 });
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const sources = new Map(
  SETTLEMENTS.map((s) => [
    s.id,
    GULF_RESOURCES.filter((r) => r.type === 'berry' && distance(r, s) < 40),
  ]),
);
const validSourceIds = new Set([...sources.values()].flat().map((r) => r.id));
export function normalizeResidentForage(value, day: number): ResidentForage | null {
  if (
    !Number.isSafeInteger(value?.day) ||
    value.day < 1 ||
    value.day > day ||
    !validSourceIds.has(value.sourceId) ||
    typeof value.carrying !== 'boolean'
  )
    return null;
  if (value.carrying) {
    if (value.deliveredDay != null || value.deliveredTo != null) return null;
    return {
      day: value.day,
      sourceId: value.sourceId,
      carrying: true,
      deliveredDay: null,
      deliveredTo: null,
    };
  }
  if (
    !Number.isSafeInteger(value.deliveredDay) ||
    value.deliveredDay < value.day ||
    value.deliveredDay > day ||
    !SETTLEMENTS.some((s) => s.id === value.deliveredTo)
  )
    return null;
  return {
    day: value.day,
    sourceId: value.sourceId,
    carrying: false,
    deliveredDay: value.deliveredDay,
    deliveredTo: value.deliveredTo,
  };
}
export function forageLabel(forage: ResidentForage | null | undefined, day: number) {
  if (!forage) return '夕食に届ける実は、まだ採っていない';
  if (forage.carrying)
    return `${forage.day === day ? '今日' : forage.day + '日目に'}採ったベリー1を運んでいる · 夕べの炉へ`;
  const place = SETTLEMENTS.find((s) => s.id === forage.deliveredTo);
  return `${forage.deliveredDay === day ? '今日' : forage.deliveredDay + '日目に'}、${place?.name ?? '炉'}の夕食へベリー1を届けた`;
}

export function foragingAssignment(room, resident: Resident, phase: number, now: number, dynamic) {
  const day = villageDay(now, room.createdAt),
    placeId = supperPlace(room, resident.id);
  if (
    !room.players.size ||
    phase > 1 ||
    !placeId ||
    resident.forage?.carrying ||
    resident.forage?.day >= day
  )
    return null;
  const candidates = sources.get(placeId) ?? [],
    index = RESIDENTS.findIndex((r) => r.id === resident.id);
  for (let i = 0; i < candidates.length; i++) {
    const definition = candidates[(index + day - 1 + i) % candidates.length];
    const resource = room.resources?.find((r) => r.id === definition.id && r.type === 'berry');
    if (!resource || resource.amount <= FORAGING.reserve) continue;
    const key = `forage:${day}:${phase}:${resource.id}`;
    if (resident.routineKey === key && resident.destination)
      return { key, target: resident.destination, travelling: false };
    // Separate approach positions around the existing shrubs keep visitors from
    // all targeting one point. Positions still pass the normal collision check.
    for (let side = 0; side < 3; side++) {
      const angle = [Math.PI / 2, -Math.PI / 2, 0][(Math.floor(index / 3) + side) % 3];
      const desired = {
        x: resource.x + Math.cos(angle) * 2.8,
        z: resource.z + Math.sin(angle) * 2.8,
      };
      const free = room.collision.nearestFree(desired, resident.radius, dynamic, 0.8);
      if (
        !free ||
        distance(free, resource) > FORAGING.reach ||
        !interactionVisible(room.collision, free, resource)
      )
        continue;
      return {
        key,
        target: {
          ...free,
          label: '夕食のベリーを採っている',
          clip: 'Gather' as const,
          facing: Math.atan2(resource.x - free.x, resource.z - free.z),
        },
        travelling: false,
      };
    }
  }
  return null;
}

export function updateForaging(room, dt: number, now: number) {
  const phase = villagePhase(now, room.createdAt),
    day = villageDay(now, room.createdAt);
  let changed = false;
  for (const resident of (room.residents ?? []) as Resident[]) {
    const placeId = supperPlace(room, resident.id);
    if (room.players.size && resident.forage?.carrying && atSupperHearth(room, resident, now)) {
      const pantry = room.gulf.pantries.find((p) => p.settlementId === placeId);
      if (pantry && pantryTotal(pantry) < PANTRY.capacity) {
        pantry.supper.berry++;
        resident.forage = {
          ...resident.forage,
          carrying: false,
          deliveredDay: day,
          deliveredTo: placeId,
        };
        changed = true;
      } else resident.activity = 'ベリー1を持って、夕食の置き場が空くのを待っている';
    }
    const source = (sources.get(placeId) ?? []).find(
      (r) => resident.routineKey === `forage:${day}:${phase}:${r.id}`,
    );
    const resource =
      source && room.resources?.find((r) => r.id === source.id && r.type === 'berry');
    if (
      !room.players.size ||
      phase > 1 ||
      resident.phase !== phase ||
      resident.forage?.carrying ||
      resident.forage?.day >= day ||
      !resource ||
      resource.amount <= FORAGING.reserve ||
      resident.moving ||
      !resident.destination ||
      distance(resident, resident.destination) > 0.15 ||
      distance(resident, resource) > FORAGING.reach ||
      (resident.talkerId && resident.talkUntil > now && room.players.has(resident.talkerId)) ||
      !interactionVisible(room.collision, resident, resource)
    ) {
      resident.forageWork = null;
      continue;
    }
    if (resident.forageWork?.key !== resident.routineKey)
      resident.forageWork = { key: resident.routineKey, elapsedMs: 0 };
    // Only time actually simulated at the shrub counts; no offline catch-up.
    resident.forageWork.elapsedMs +=
      Math.max(0, Math.min(Number.isFinite(dt) ? dt : 0, 0.15)) * 1000;
    if (resident.forageWork.elapsedMs < FORAGING.workMs) continue;
    resource.amount--;
    resource.regeneratedAt = now;
    resident.forage = {
      day,
      sourceId: resource.id,
      carrying: true,
      deliveredDay: null,
      deliveredTo: null,
    };
    resident.forageWork = null;
    resident.activity = '夕食のベリーを1つ採った';
    changed = true;
  }
  return changed;
}
