import type { CollisionWorld } from './collision.mjs';
import type { PlayerSnapshot } from './snapshots.mjs';
import type { OrbBot, OrbBotSnapshot } from './orb-bot-types.mjs';
import {
  BOT_DESIGNS,
  BOT_KINDS,
  botRadius,
  cancelBotFarewell,
  cancelPlayerBotPet,
  createOrbBot,
  isCompanionBot,
  petOrbBot,
  pettingOrbBot,
  startBotFarewell,
  updateOrbBots,
} from './orb-bots.mjs';
import {
  MASCOT_FAREWELL_MS,
  cancelCompanionPet,
  cancelCompanionPetsBy,
  companionArrival,
  companionProfile,
  createCompanion,
  petCompanion,
  pettingCompanion,
  updateCompanions,
  type Companion,
  type CompanionSnapshot,
} from './companions.mjs';
import { GROUND_MASCOT_KEYS, friendDefinition } from './friend-mascots.mjs';

/** Every mascot a person can choose, in selection card order. */
export const MASCOT_KEYS = ['rimo-neko', '524', ...GROUND_MASCOT_KEYS, ...BOT_KINDS] as const;
export type MascotKey = (typeof MASCOT_KEYS)[number];

type MascotPlayer = PlayerSnapshot & {
  /** The chosen companion, kept with the player's save; null travels alone. */
  mascot?: string | null;
};
export type MascotRoom = {
  collision: CollisionWorld;
  players: Map<string, MascotPlayer>;
  orbBots?: OrbBot[];
  companions?: Companion[];
  /** The keys this build offers, in card order (all of MASCOT_KEYS by default). */
  mascotKeys?: readonly string[];
  mascotSerial?: number;
};
type MascotBodies<B extends OrbBotSnapshot, C extends CompanionSnapshot> = {
  orbBots?: readonly B[];
  companions?: readonly C[];
};

const isDot = (key: string) => BOT_KINDS.some((kind) => kind === key);
const finished = (leavingAt: number, now: number) =>
  leavingAt > 0 && now - leavingAt >= MASCOT_FAREWELL_MS;
/** Arrival waits a moment after finding no room beside the person. */
const nextArrival = new WeakMap<object, number>();

/** The name a mascot goes by on its card, in prompts, above its head and on profiles. */
export function mascotName(key: string) {
  return friendDefinition(key)?.name ?? BOT_DESIGNS[key as keyof typeof BOT_DESIGNS]?.name ?? key;
}

export function mascotSelectable(room: Pick<MascotRoom, 'mascotKeys'>, key: unknown) {
  return typeof key === 'string' && (room.mascotKeys ?? MASCOT_KEYS).includes(key);
}

export function mascotKeyOf(body: OrbBotSnapshot | CompanionSnapshot) {
  return 'kind' in body ? body.kind : body.key;
}

/** The companion travelling with this person, if any. A goodbye no longer counts. */
export function activeMascot<B extends OrbBotSnapshot, C extends CompanionSnapshot>(
  bodies: MascotBodies<B, C>,
  playerId: string | null | undefined,
): B | C | undefined {
  if (!playerId) return undefined;
  return (
    bodies.orbBots?.find(
      (b) => b.ownerId === playerId && !isCompanionBot(b.kind) && !b.leavingAt,
    ) ?? bodies.companions?.find((c) => c.ownerId === playerId && !c.leavingAt)
  );
}

/** The body this person is stroking, whoever it travels with. */
export function pettingMascot<B extends OrbBotSnapshot, C extends CompanionSnapshot>(
  bodies: MascotBodies<B, C>,
  playerId: string | null | undefined,
): B | C | undefined {
  const dot = pettingOrbBot(bodies.orbBots, playerId ?? undefined) as B | undefined;
  return dot ?? pettingCompanion(bodies.companions, playerId);
}

/** Every companion a person can see and touch: dots, and the bodies of the others. */
export function mascotBodies<B extends OrbBotSnapshot, C extends CompanionSnapshot>(
  bodies: MascotBodies<B, C>,
): (B | C)[] {
  return [
    ...(bodies.orbBots ?? []).filter((b) => !isCompanionBot(b.kind)),
    ...(bodies.companions ?? []),
  ];
}

/** The companion waves goodbye where it is and leaves after the farewell. */
function bidFarewell(room: MascotRoom, playerId: string, now: number) {
  for (const b of room.orbBots ?? [])
    if (b.ownerId === playerId && !isCompanionBot(b.kind)) startBotFarewell(b, now);
  for (const c of room.companions ?? [])
    if (c.ownerId === playerId && !c.leavingAt) {
      cancelCompanionPet(c);
      c.leavingAt = now;
      // Out of the hand or the air, it says goodbye on the ground where it is.
      if (c.squadMode !== 'stowed') c.squadMode = 'following';
    }
  // A body saying goodbye is no longer thrown or called.
  room.orbBots = room.orbBots?.filter(
    (b) => !b.companionId || room.companions?.some((c) => c.id === b.companionId && !c.leavingAt),
  );
}

/** The chosen companion arrives beside its person on foot. A goodbye of the same
 * companion still in progress turns back instead of a second body appearing. */
function arrive(room: MascotRoom, p: MascotPlayer, key: string, now: number) {
  const leavingDot = room.orbBots?.find((b) => b.ownerId === p.id && b.kind === key && b.leavingAt);
  if (leavingDot) {
    cancelBotFarewell(leavingDot, now);
    return true;
  }
  const leaving = room.companions?.find((c) => c.ownerId === p.id && c.key === key && c.leavingAt);
  if (leaving) {
    leaving.leavingAt = 0;
    leaving.squadMode = 'following';
    if (companionProfile(key)?.throwable)
      (room.orbBots ??= []).push(
        createOrbBot(
          leaving.key as OrbBot['kind'],
          `orb:${leaving.id}`,
          p,
          leaving,
          now,
          leaving.id,
        ),
      );
    return true;
  }
  if (p.mountId || p.boatId || p.carrierId || p.downedUntil) return false;
  const profile = companionProfile(key);
  const radius = isDot(key) ? botRadius(key as OrbBot['kind']) : profile?.radius;
  if (radius === undefined) return false;
  const occupied = [
    ...(room.orbBots ?? [])
      .filter((b) => !isCompanionBot(b.kind))
      .map((b) => ({ x: b.x, z: b.z, radius: botRadius(b.kind) })),
    ...(room.companions ?? []),
  ];
  const at = companionArrival(room.collision, p, radius, occupied);
  if (!at) return false;
  room.mascotSerial = (room.mascotSerial ?? 0) + 1;
  const id = `${key}@${p.id}#${room.mascotSerial}`;
  if (isDot(key)) {
    (room.orbBots ??= []).push(createOrbBot(key as OrbBot['kind'], id, p, at, now));
    return true;
  }
  const c = createCompanion(key, id, p, at);
  (room.companions ??= []).push(c);
  if (profile?.throwable)
    (room.orbBots ??= []).push(createOrbBot(key as OrbBot['kind'], `orb:${id}`, p, at, now, id));
  return true;
}

/**
 * One companion per person, any of them, however many others chose the same one.
 * A new choice sends the previous companion off with a goodbye; null travels alone.
 */
export function chooseMascot(room: MascotRoom, p: MascotPlayer, key: unknown, now: number) {
  if (p.downedUntil > now) return false;
  if (key !== null && !mascotSelectable(room, key)) return false;
  const next = key as string | null;
  const current = activeMascot(room, p.id);
  const travelling = current ? mascotKeyOf(current) : null;
  if ((p.mascot ?? null) === next && travelling === next) return false;
  p.mascot = next;
  if (travelling !== next) bidFarewell(room, p.id, now);
  nextArrival.delete(p);
  if (next && travelling !== next) arrive(room, p, next, now);
  return true;
}

/**
 * Bodies follow the choices: goodbyes end, a companion leaves with its person's
 * connection, and a connected person's choice arrives (on joining, or once on foot).
 */
export function syncMascots(room: MascotRoom, now: number) {
  room.companions = (room.companions ?? []).filter(
    (c) => room.players.has(c.ownerId) && !finished(c.leavingAt, now),
  );
  const companions = room.companions;
  room.orbBots = (room.orbBots ?? []).filter(
    (b) =>
      room.players.has(b.ownerId) &&
      !finished(b.leavingAt, now) &&
      (!b.companionId || companions.some((c) => c.id === b.companionId && !c.leavingAt)),
  );
  for (const p of room.players.values()) {
    if (!p.mascot || !mascotSelectable(room, p.mascot) || activeMascot(room, p.id)) continue;
    if ((nextArrival.get(p) ?? 0) > now) continue;
    if (!arrive(room, p, p.mascot, now)) nextArrival.set(p, now + 500);
  }
}

export function updateMascots(room: MascotRoom, dt: number, now: number) {
  syncMascots(room, now);
  updateCompanions(room, dt, now);
  updateOrbBots(room, dt, now);
}

/** Anyone may pet any companion within reach; it never changes whose it is. */
export function petMascot(room: MascotRoom, p: MascotPlayer, id: unknown, now: number) {
  if (pettingMascot(room, p.id)) return false;
  const c = room.companions?.find((candidate) => candidate.id === id);
  return c ? petCompanion(room, p, c, now) : petOrbBot(room, p, id, now);
}

/** Steering away or calling interrupts this person's stroke. */
export function cancelMascotPets(room: MascotRoom, playerId: string, now: number) {
  cancelCompanionPetsBy(room, playerId);
  cancelPlayerBotPet(room, playerId, now);
}

/**
 * Saves made before companions belonged to one person recorded shared camp bodies with
 * owners. Each such owner keeps one of them, preferring the selection card order.
 */
export function formerMascotBonds(record: unknown): Map<string, string[]> {
  const bonds = new Map<string, string[]>();
  if (!record || typeof record !== 'object') return bonds;
  const saved = record as Record<string, unknown>;
  const bond = (owner: unknown, key: unknown) => {
    if (typeof owner !== 'string' || !owner || typeof key !== 'string') return;
    bonds.set(owner, [...(bonds.get(owner) ?? []), key]);
  };
  const body = (value: unknown) =>
    value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
  const cat = body(saved.rimoNeko);
  bond(cat?.squadPlayerId || cat?.followPlayerId, 'rimo-neko');
  bond(body(saved.companion524)?.squadPlayerId, '524');
  for (const [field, key] of [
    ['mae', 'mae'],
    ['kohaku', 'kohaku'],
    ['maruimo', 'maruimo-mascot'],
  ])
    bond(body(saved[field])?.followPlayerId, key);
  for (const friend of Array.isArray(saved.friends) ? saved.friends : [])
    bond(body(friend)?.followPlayerId, body(friend)?.key);
  for (const dot of Array.isArray(saved.orbBots) ? saved.orbBots : [])
    bond(body(dot)?.ownerId, body(dot)?.kind);
  for (const [owner, keys] of bonds)
    bonds.set(
      owner,
      [...new Set(keys)].sort(
        (a, b) =>
          (MASCOT_KEYS as readonly string[]).indexOf(a) -
          (MASCOT_KEYS as readonly string[]).indexOf(b),
      ),
    );
  return bonds;
}
