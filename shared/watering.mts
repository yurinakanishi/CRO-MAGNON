import { FARM_PLOTS, SETTLEMENTS, SPRINGS } from './gulf-region.mjs';
import { RESIDENTS, villageDay, villagePhase } from './village-sites.mjs';
import { supperPlace } from './supper.mjs';
import { cropById, plotCrop, startCropGrowth } from './crops.mjs';
import { gulfSeason } from './gulf-season.mjs';
import { interactionVisible } from './interactions.mjs';
import type { Resident } from './village-types.mjs';
import type { ResidentWatering } from './watering-types.mjs';

// Fictional, requested assistance; not a reconstruction of ancient irrigation.
export const WATERING = Object.freeze({ capacity: 2, workMs: 3000, reach: 3.6 });
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
export function normalizeWatering(value, day: number): ResidentWatering {
  const water =
    Number.isSafeInteger(value?.water) && value.water >= 0 && value.water <= WATERING.capacity
      ? value.water
      : 0;
  const last = value?.last;
  return {
    water,
    last:
      Number.isSafeInteger(last?.day) &&
      last.day > 0 &&
      last.day <= day &&
      FARM_PLOTS.some((p) => p.id === last.plotId) &&
      cropById(last.cropId)
        ? { day: last.day, plotId: last.plotId, cropId: last.cropId }
        : null,
  };
}
export function wateringLabel(value: ResidentWatering | undefined, day: number) {
  const prefix = `持ち水 ${value?.water ?? 0}/2`;
  const last = value?.last,
    plot = FARM_PLOTS.find((p) => p.id === last?.plotId);
  if (!last || !plot) return `${prefix} · まだ畑の水やりはしていない`;
  const place = SETTLEMENTS.find((s) => s.id === plot.settlementId);
  const number =
    FARM_PLOTS.filter((p) => p.settlementId === place.id).findIndex((p) => p.id === plot.id) + 1;
  return `${prefix} · ${last.day === day ? '今日' : last.day + '日目に'}、${place.name}の畑${number}（${cropById(last.cropId)?.name}）に水をやった`;
}
function eligible(room, resident: Resident, now: number) {
  return (
    room.players.size > 0 &&
    villagePhase(now, room.createdAt) < 2 &&
    (resident.watering?.last?.day ?? 0) < villageDay(now, room.createdAt) &&
    !!supperPlace(room, resident.id)
  );
}
function requestedPlot(room, resident: Resident) {
  if (!resident.wateringTarget) return null;
  const placeId = supperPlace(room, resident.id),
    target = resident.wateringTarget;
  const spec = FARM_PLOTS.find((p) => p.id === target.plotId && p.settlementId === placeId);
  const plot = room.gulf?.plots.find((p) => p.id === spec?.id);
  return plot?.stage === 'planted' &&
    plot.waterRequestAt > 0 &&
    plot.waterRequestAt === target.requestedAt
    ? plot
    : null;
}
function assignedPlot(room, resident: Resident, now: number) {
  return eligible(room, resident, now) ? requestedPlot(room, resident) : null;
}
export function assignWatering(room, now: number) {
  const residents = (room.residents ?? []) as Resident[],
    day = villageDay(now, room.createdAt);
  const used = new Set<string>();
  for (const resident of residents) {
    // Keep unfinished deliveries through the evening; water already carried is useful tomorrow.
    const plot = requestedPlot(room, resident);
    if (plot && (resident.watering.last?.day ?? 0) < day && !used.has(plot.id)) used.add(plot.id);
    else resident.wateringTarget = null;
  }
  for (const place of SETTLEMENTS) {
    const locals = RESIDENTS.map((d) => residents.find((n) => n.id === d.id)).filter(
      (n) => n && eligible(room, n, now) && supperPlace(room, n.id) === place.id,
    );
    if (!locals.length) continue;
    const first = (day - 1) % locals.length,
      order = [...locals.slice(first), ...locals.slice(0, first)];
    const requests = (room.gulf?.plots ?? [])
      .filter(
        (p) =>
          p.stage === 'planted' &&
          p.waterRequestAt > 0 &&
          FARM_PLOTS.some((s) => s.id === p.id && s.settlementId === place.id) &&
          !used.has(p.id),
      )
      .sort((a, b) => a.waterRequestAt - b.waterRequestAt || a.id.localeCompare(b.id));
    for (const resident of order) {
      if (resident.wateringTarget) continue;
      const plot = requests.shift();
      if (!plot) break;
      resident.wateringTarget = { plotId: plot.id, requestedAt: plot.waterRequestAt };
      used.add(plot.id);
    }
  }
}
export function wateringAssignment(room, resident: Resident, phase: number, now: number, dynamic) {
  const plot = assignedPlot(room, resident, now);
  if (!plot) return null;
  const spec = FARM_PLOTS.find((p) => p.id === plot.id),
    filling = resident.watering.water < plotCrop(plot).water;
  const point = filling ? SPRINGS.find((s) => s.id === `spring-${spec.settlementId}`) : spec;
  const key = `watering:${phase}:${plot.id}:${plot.waterRequestAt}:${filling ? 'spring' : 'plot'}`;
  if (resident.routineKey === key && resident.destination)
    return { key, target: resident.destination, travelling: false };
  const index = RESIDENTS.findIndex((d) => d.id === resident.id);
  for (let i = 0; i < 8; i++) {
    const angle = ((index + i) * Math.PI) / 4;
    const desired = { x: point.x + Math.cos(angle) * 2, z: point.z + Math.sin(angle) * 2 };
    const free = room.collision.nearestFree(desired, resident.radius, dynamic, 0.6);
    if (
      !free ||
      distance(free, point) > WATERING.reach ||
      !interactionVisible(room.collision, free, point)
    )
      continue;
    return {
      key,
      target: {
        ...free,
        label: filling ? '畑のために水を汲んでいる' : '頼まれた作物に水をやっている',
        clip: 'Gather' as const,
        facing: Math.atan2(point.x - free.x, point.z - free.z),
      },
      travelling: false,
    };
  }
  return null;
}
export function updateWatering(room, dt: number, now: number) {
  let changed = false;
  for (const resident of (room.residents ?? []) as Resident[]) {
    const plot = assignedPlot(room, resident, now),
      phase = villagePhase(now, room.createdAt);
    const spec = plot && FARM_PLOTS.find((p) => p.id === plot.id),
      filling = plot && resident.watering.water < plotCrop(plot).water;
    const point =
      spec && (filling ? SPRINGS.find((s) => s.id === `spring-${spec.settlementId}`) : spec);
    const key =
      plot && `watering:${phase}:${plot.id}:${plot.waterRequestAt}:${filling ? 'spring' : 'plot'}`;
    if (
      !plot ||
      resident.routineKey !== key ||
      resident.phase !== phase ||
      resident.moving ||
      !resident.destination ||
      distance(resident, resident.destination) > 0.15 ||
      distance(resident, point) > WATERING.reach ||
      (resident.talkerId && resident.talkUntil > now && room.players.has(resident.talkerId)) ||
      !interactionVisible(room.collision, resident, point)
    ) {
      resident.wateringWork = null;
      continue;
    }
    if (resident.wateringWork?.key !== key) resident.wateringWork = { key, elapsedMs: 0 };
    resident.wateringWork.elapsedMs +=
      Math.max(0, Math.min(Number.isFinite(dt) ? dt : 0, 0.15)) * 1000;
    if (resident.wateringWork.elapsedMs < WATERING.workMs) continue;
    if (filling) resident.watering.water = WATERING.capacity;
    else {
      resident.watering.water -= plotCrop(plot).water;
      resident.watering.last = {
        day: villageDay(now, room.createdAt),
        plotId: plot.id,
        cropId: plot.cropId,
      };
      startCropGrowth(plot, now, gulfSeason(now, room.createdAt).growMs);
      resident.wateringTarget = null;
    }
    resident.wateringWork = null;
    changed = true;
  }
  return changed;
}
