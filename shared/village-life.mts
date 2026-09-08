import { RESIDENTS, VILLAGE, villageDay, villagePhase, bundleLabel } from './village-sites.mjs';
import { SETTLEMENTS } from './gulf-region.mjs';
import { interactionVisible } from './interactions.mjs';
import { stopActor } from './combat.mjs';
import { ridingObstacles } from './riding.mjs';
import { movePlayer } from './movement.mjs';
import { planNavigation, updateNavigation } from './navigation.mjs';
import type { Resident, ResidentSnapshot } from './village-types.mjs';
import {
  createHouseholds,
  ensureHouseholdProgress,
  householdAssignment,
  householdWaiting,
  updateHouseholds,
  householdRestorePosition,
  handleHouseholdAction,
} from './household-life.mjs';

const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
export function ensureVillageProgress(player) {
  const progress = ensureHouseholdProgress(player);
  const met = Array.isArray(progress.metResidents) ? progress.metResidents : [];
  progress.metResidents = RESIDENTS.filter((d) => met.includes(d.id)).map((d) => d.id);
  progress.residentHelp = Object.fromEntries(
    RESIDENTS.flatMap((d) => {
      const day = progress.residentHelp?.[d.id];
      return Number.isSafeInteger(day) && day > 0 ? [[d.id, day]] : [];
    }),
  );
  return progress;
}

export function createResidents(room, saved = []): Resident[] {
  room.households ??= createHouseholds();
  room.residents = [];
  for (const definition of RESIDENTS) {
    const old = Array.isArray(saved) ? saved.find((r) => r?.id === definition.id) : null;
    const home = SETTLEMENTS.find((s) => s.id === definition.settlementId)!;
    const homePosition =
      old && Number.isFinite(old.x) && Number.isFinite(old.z) && distance(old, home) < 65
        ? old
        : definition.routine[0];
    const position = householdRestorePosition(room, definition.id, old, homePosition);
    const free = room.collision.nearestFree(position, 0.32, ridingObstacles(room, null, null), 8);
    if (!free) throw new Error(`No safe resident position: ${definition.id}`);
    const resident: Resident = {
      id: definition.id,
      species: definition.species,
      gender: definition.gender,
      ...free,
      radius: 0.32,
      facing: Number.isFinite(old?.facing) ? old.facing : definition.routine[0].facing,
      speed: 0,
      moving: false,
      running: false,
      runningRequested: false,
      dx: 0,
      dz: 0,
      lastInput: 0,
      path: [],
      target: null,
      phase: -1,
      routineKey: '',
      destination: null,
      activity: '集落で過ごしている',
      clip: 'Idle_Loop',
      talkUntil: 0,
      talkerId: null,
    };
    room.residents.push(resident);
  }
  return room.residents;
}

export const residentSnapshots = (room): ResidentSnapshot[] =>
  (room.residents ?? []).map(({ id, x, z, facing, radius, speed, moving, activity, clip }) => ({
    id,
    x,
    z,
    facing,
    radius,
    speed,
    moving,
    activity,
    clip,
  }));

export function updateResidents(room, dt: number, now: number) {
  const phase = villagePhase(now, room.createdAt);
  updateHouseholds(room, now);
  for (const resident of (room.residents ?? []) as Resident[]) {
    const definition = RESIDENTS.find((d) => d.id === resident.id)!;
    const talker = room.players.get(resident.talkerId);
    if (
      now < resident.talkUntil &&
      talker &&
      !talker.downedUntil &&
      distance(talker, resident) <= VILLAGE.reach + 1
    ) {
      stopActor(resident);
      resident.activity = '旅人と話している';
      resident.clip = 'Idle_Loop';
      resident.facing = Math.atan2(talker.x - resident.x, talker.z - resident.z);
      continue;
    }
    resident.talkerId = null;
    const dynamic = ridingObstacles(room, null, resident);
    const assignment = householdAssignment(room, resident.id, phase);
    const routineKey = assignment?.key ?? `home:${phase}`;
    if (resident.routineKey !== routineKey || !resident.destination) {
      stopActor(resident);
      resident.phase = phase;
      resident.routineKey = routineKey;
      const target = assignment?.target ?? definition.routine[phase];
      const free = room.collision.nearestFree(target, resident.radius, dynamic, 4);
      resident.destination = free ? { ...target, ...free } : null;
    }
    const destination = resident.destination;
    if (!destination) {
      resident.activity = '道が空くのを待っている';
      resident.clip = 'Idle_Loop';
      continue;
    }
    if (distance(resident, destination) > 0.12) {
      if (householdWaiting(room, resident)) {
        stopActor(resident);
        resident.activity = '旅の仲間を待っている';
        resident.clip = 'Idle_Loop';
        continue;
      }
      if (!resident.navigationGoal)
        planNavigation(resident, destination, room.collision, dynamic, now);
      else updateNavigation(resident, room.collision, dynamic, now);
      movePlayer(
        resident,
        dt,
        now,
        (p, dx, dz) => room.collision.move(p, dx, dz, resident.radius, dynamic),
        VILLAGE.walkSpeed,
      );
      resident.activity = resident.moving
        ? assignment?.travelling
          ? '世帯の仲間と道を歩いている'
          : ['採集場所へ歩いている', '仕事場へ歩いている', '炉へ歩いている', '天幕へ歩いている'][
              phase
            ]
        : '道が空くのを待っている';
      resident.clip = resident.moving ? 'Walk_Loop' : 'Idle_Loop';
    } else {
      stopActor(resident);
      resident.activity = destination.label;
      resident.clip = destination.clip;
      resident.facing = destination.facing;
    }
  }
}

export function handleVillageAction(room, player, message, now: number) {
  const household = handleHouseholdAction(room, player, message, now);
  if (household) return household;
  if (!['residentTalk', 'residentHelp'].includes(message.action)) return null;
  const fail = (text) => ({ ok: false, text });
  const resident = room.residents?.find((r) => r.id === message.targetId);
  const definition = RESIDENTS.find((d) => d.id === resident?.id);
  if (!resident || !definition) return fail('その住人は見つかりません。');
  if (
    player.downedUntil ||
    player.mountId ||
    player.boatId ||
    player.fishing ||
    player.coastalActivity ||
    player.cookingEndsAt
  )
    return fail('作業を終えて地上で話しかけよう。');
  if (
    distance(player, resident) > VILLAGE.reach ||
    !interactionVisible(room.collision, player, resident)
  )
    return fail(`${definition.name}のそばに近づいて、顔を合わせよう。`);
  const progress = ensureVillageProgress(player);
  const day = villageDay(now, room.createdAt);
  if (message.action === 'residentHelp') {
    if ((progress.residentHelp[resident.id] ?? 0) >= day)
      return fail('今日の手伝いは済んでいます。また明日、顔を見せよう。');
    if (Object.entries(definition.cost).some(([key, n]) => (player.inventory[key] ?? 0) < n))
      return fail(`${definition.name}「${bundleLabel(definition.cost)}を持ってきてね」`);
    if (
      Object.entries(definition.reward).some(
        ([key, n]) => (player.inventory[key] ?? 0) - (definition.cost[key] ?? 0) + n > 99,
      )
    )
      return fail('お礼を受け取れるよう、もちものを空けよう。材料はまだ渡していません。');
    for (const [key, n] of Object.entries(definition.cost)) player.inventory[key] -= n;
    for (const [key, n] of Object.entries(definition.reward))
      player.inventory[key] = (player.inventory[key] ?? 0) + n;
    progress.residentHelp[resident.id] = day;
  }
  if (!progress.metResidents.includes(resident.id)) progress.metResidents.push(resident.id);
  stopActor(player);
  stopActor(resident);
  resident.talkerId = player.id;
  resident.talkUntil = now + VILLAGE.talkMs;
  resident.activity = '旅人と話している';
  resident.clip = 'Idle_Loop';
  resident.facing = Math.atan2(player.x - resident.x, player.z - resident.z);
  return {
    ok: true,
    text:
      message.action === 'residentHelp'
        ? `${definition.name}の手伝いを済ませた。お礼：${bundleLabel(definition.reward)}`
        : `${definition.name}と話している。`,
  };
}
