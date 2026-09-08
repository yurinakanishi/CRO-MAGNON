import { HOUSEHOLDS, JOURNEYS, householdFor, householdGoal } from './household-sites.mjs';
import { MANY_HEARTHS, SETTLEMENTS } from './gulf-region.mjs';
import { VILLAGE, bundleLabel } from './village-sites.mjs';
import { ensureGulfPlayer } from './gulf-life.mjs';
import { interactionVisible } from './interactions.mjs';
import { stopActor } from './combat.mjs';
import { attackProfile } from './combat-profiles.mjs';
import type { HouseholdState } from './household-types.mjs';

const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
export function createHouseholds(saved: unknown = [], now = 0): HouseholdState[] {
  return HOUSEHOLDS.map((d) => {
    const old = Array.isArray(saved) ? saved.find((h) => h?.id === d.id) : null;
    const visit =
      Number.isSafeInteger(old?.visit) && old.visit > 0 && old.visit < 1e9 ? old.visit : 0;
    const stage =
      visit && ['assembling', 'outbound', 'visiting', 'returning'].includes(old?.stage)
        ? old.stage
        : 'home';
    return {
      id: d.id,
      stage,
      visit,
      leg:
        stage === 'assembling' || stage === 'home'
          ? 0
          : stage === 'visiting'
            ? d.route.length - 1
            : Math.max(0, Math.min(d.route.length - 1, Number.isInteger(old?.leg) ? old.leg : 0)),
      stayUntil:
        stage === 'visiting' && Number.isFinite(old?.stayUntil)
          ? Math.max(0, Math.min(now + JOURNEYS.stayMs, old.stayUntil))
          : 0,
      readyAt:
        stage === 'home' && Number.isFinite(old?.readyAt)
          ? Math.max(0, Math.min(now + JOURNEYS.restMs, old.readyAt))
          : 0,
    };
  });
}
export const householdSnapshots = (room): HouseholdState[] =>
  (room.households ?? []).map((h) => ({ ...h }));
export function ensureHouseholdProgress(player) {
  const p = ensureGulfPlayer(player);
  p.householdWelcomes = Object.fromEntries(
    HOUSEHOLDS.flatMap((d) => {
      const visit = p.householdWelcomes?.[d.id];
      return Number.isSafeInteger(visit) && visit > 0 && visit < 1e9 ? [[d.id, visit]] : [];
    }),
  );
  return p;
}
export function householdAssignment(room, residentId: string, phase: number) {
  const d = householdFor(residentId),
    h: HouseholdState = room.households?.find((h) => h.id === d?.id);
  if (!h || h.stage === 'home') return null;
  const member = d.members.indexOf(residentId);
  if (h.stage === 'visiting')
    return {
      key: `${h.id}:guest:${phase}`,
      target: d.guestRoutine[member][phase],
      travelling: false,
    };
  return {
    key: `${h.id}:${h.stage}:${h.leg}`,
    target: {
      ...householdGoal(d, h, member),
      label: h.stage === 'returning' ? '帰り道で仲間を待っている' : '旅の仲間を待っている',
      clip: 'Idle_Loop' as const,
      facing: 0,
    },
    travelling: true,
  };
}
export function householdWaiting(room, resident) {
  const d = householdFor(resident.id),
    h: HouseholdState = room.households?.find((h) => h.id === d?.id);
  if (!h || !['assembling', 'outbound', 'returning'].includes(h.stage)) return false;
  const member = d.members.indexOf(resident.id),
    other = room.residents.find((r) => r.id === d.members[1 - member]);
  return (
    other &&
    distance(other, resident) > JOURNEYS.separation &&
    distance(resident, householdGoal(d, h, member)) <
      distance(other, householdGoal(d, h, 1 - member))
  );
}
export function updateHouseholds(room, now: number) {
  for (const h of (room.households ?? []) as HouseholdState[]) {
    const d = HOUSEHOLDS.find((d) => d.id === h.id)!;
    if (h.stage === 'home') continue;
    if (h.stage === 'visiting') {
      if (now >= h.stayUntil) {
        h.stage = 'returning';
        h.leg = d.route.length - 1;
        h.stayUntil = 0;
      }
      continue;
    }
    const arrived = d.members.every((id) => {
      const r = room.residents.find((r) => r.id === id);
      return (
        r?.routineKey === householdAssignment(room, id, 0)?.key &&
        r.destination &&
        distance(r, r.destination) <= 0.15
      );
    });
    if (!arrived) continue;
    if (h.stage === 'returning') {
      if (h.leg > 0) h.leg--;
      else {
        h.stage = 'home';
        h.readyAt = now + JOURNEYS.restMs;
      }
    } else if (h.leg < d.route.length - 1) {
      h.stage = 'outbound';
      h.leg++;
    } else {
      h.stage = 'visiting';
      h.stayUntil = now + JOURNEYS.stayMs;
    }
  }
}
// Accept saved travellers only on their authored route corridor; never trust arbitrary coordinates.
export function householdRestorePosition(room, id: string, old, fallback) {
  const d = householdFor(id),
    h: HouseholdState = room.households?.find((h) => h.id === d?.id);
  if (!h || h.stage === 'home') return fallback;
  const valid = old && Number.isFinite(old.x) && Number.isFinite(old.z);
  const points = h.stage === 'visiting' ? [MANY_HEARTHS] : d.route;
  const nearby =
    valid &&
    (points.some((p) => distance(p, old) < 65) ||
      (h.stage !== 'visiting' &&
        points.some((a, i) => {
          const b = points[i + 1];
          if (!b) return false;
          const t = Math.max(
            0,
            Math.min(
              1,
              ((old.x - a.x) * (b.x - a.x) + (old.z - a.z) * (b.z - a.z)) /
                ((b.x - a.x) ** 2 + (b.z - a.z) ** 2),
            ),
          );
          return distance(old, { x: a.x + t * (b.x - a.x), z: a.z + t * (b.z - a.z) }) < 45;
        })));
  return nearby ? old : householdGoal(d, h, d.members.indexOf(id));
}
export function handleHouseholdAction(room, player, message, now: number) {
  if (!['householdPrepare', 'householdWelcome'].includes(message.action)) return null;
  const fail = (text: string) => ({ ok: false, text });
  const d = HOUSEHOLDS.find((d) => d.id === message.targetId),
    h: HouseholdState = room.households?.find((h) => h.id === d?.id);
  if (!d || !h) return fail('その世帯は見つかりません。');
  if (
    player.downedUntil ||
    player.mountId ||
    player.boatId ||
    player.fishing ||
    player.coastalActivity ||
    player.cookingEndsAt ||
    (player.attackSequence && now - player.attackAt < attackProfile(player).durationMs)
  )
    return fail('地上で作業を終えてから声をかけよう。');
  const progress = ensureHouseholdProgress(player);
  if (message.action === 'householdPrepare') {
    const home = SETTLEMENTS.find((s) => s.id === d.homeId)!;
    if (
      distance(player, home) > JOURNEYS.reach ||
      !interactionVisible(room.collision, player, home)
    )
      return fail('この世帯の国の炉で旅支度を相談しよう。');
    if (h.stage !== 'home' || h.readyAt > now || h.visit >= 999999998)
      return fail('今は旅支度の途中か、旅先・帰着後の休息中です。');
    if (Object.entries(JOURNEYS.cost).some(([key, n]) => (player.inventory[key] ?? 0) < n))
      return fail(`旅支度には${bundleLabel(JOURNEYS.cost)}が必要です。`);
    for (const [key, n] of Object.entries(JOURNEYS.cost)) player.inventory[key] -= n;
    h.stage = 'assembling';
    h.visit++;
    h.leg = 0;
    h.stayUntil = 0;
    h.readyAt = 0;
    stopActor(player);
    return {
      ok: true,
      text: `${d.name}が炉に集まり、集い場へ旅立ちます。地図で道中を確かめよう。`,
    };
  }
  if (h.stage !== 'visiting' || now >= h.stayUntil)
    return fail('集い場への到着を待って、滞在中に迎えよう。');
  const visitor = room.residents.find(
    (r) =>
      d.members.includes(r.id) &&
      distance(player, r) <= VILLAGE.reach &&
      distance(r, MANY_HEARTHS) < 65 &&
      interactionVisible(room.collision, player, r),
  );
  if (!visitor) return fail('集い場に滞在中の二人のどちらかに近づこう。');
  if ((progress.householdWelcomes[h.id] ?? 0) >= h.visit)
    return fail('今回のお迎えは済んでいます。また次の訪問で声をかけよう。');
  if (Object.entries(JOURNEYS.reward).some(([key, n]) => (player.inventory[key] ?? 0) + n > 99))
    return fail('種を受け取れるよう、もちものを空けよう。');
  for (const [key, n] of Object.entries(JOURNEYS.reward))
    player.inventory[key] = (player.inventory[key] ?? 0) + n;
  progress.householdWelcomes[h.id] = h.visit;
  stopActor(player);
  stopActor(visitor);
  visitor.talkerId = player.id;
  visitor.talkUntil = now + VILLAGE.talkMs;
  return { ok: true, text: `${d.name}を迎えた。分けてもらった種：${bundleLabel(JOURNEYS.reward)}` };
}
