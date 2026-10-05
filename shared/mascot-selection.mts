import type { CollisionWorld } from './collision.mjs';
import type { PlayerSnapshot } from './snapshots.mjs';
import type { OrbBot } from './orb-bot-types.mjs';
import type { Mae } from './mae-types.mjs';
import type { Kohaku } from './kohaku-types.mjs';
import type { RimoNeko } from './rimo-neko-types.mjs';
import type { Companion524 } from './companion-524-types.mjs';
import type { Point } from './types.mjs';
import { BOT_KINDS, botRadius, setOrbBotSelected, syncOrbBots } from './orb-bots.mjs';
import { cancelMaePet, returnMae } from './mae.mjs';
import { cancelKohakuPet, returnKohaku } from './kohaku.mjs';
import { cancelRimoNekoPet, returnRimoNeko } from './rimo-neko.mjs';
import { cancelCompanion524Pet, returnCompanion524 } from './companion-524.mjs';

export const MASCOT_KEYS = [...BOT_KINDS, 'rimo-neko', '524', 'mae', 'kohaku'] as const;
export type MascotKey = (typeof MASCOT_KEYS)[number];

type MascotBody = Mae | Kohaku | RimoNeko | Companion524;
type MascotRoom = {
  collision: CollisionWorld;
  players: Map<string, PlayerSnapshot>;
  orbBots?: OrbBot[];
  mae?: Mae;
  kohaku?: Kohaku;
  rimoNeko?: RimoNeko;
  companion524?: Companion524;
  sessions?: Map<string, { player: { id: string } }>;
};

const distance = (a: { x: number; z: number }, b: { x: number; z: number }) =>
  Math.hypot(a.x - b.x, a.z - b.z);

function mascotBody(room: MascotRoom, key: MascotKey) {
  if (BOT_KINDS.some((kind) => kind === key)) return room.orbBots?.find((bot) => bot.kind === key);
  if (key === 'mae') return room.mae;
  if (key === 'kohaku') return room.kohaku;
  if (key === 'rimo-neko') return room.rimoNeko;
  return room.companion524;
}

function reunionPoint(room: MascotRoom, p: PlayerSnapshot, key: MascotKey): Point | null {
  const body = mascotBody(room, key);
  if (!body) return null;
  const radius = 'kind' in body ? botRadius(body.kind) : body.radius;
  const occupied = [
    ...(room.orbBots ?? []),
    room.rimoNeko,
    room.companion524,
    room.mae,
    room.kohaku,
  ]
    .filter((other) => other && other !== body && distance(p, other) < 5)
    .map((other) => ({
      id: 'mascot',
      type: 'circle' as const,
      x: other!.x,
      z: other!.z,
      radius: 'kind' in other! ? botRadius(other!.kind) : other!.radius,
    }));
  const index = MASCOT_KEYS.indexOf(key);
  for (let step = 0; step < MASCOT_KEYS.length; step++) {
    const angle = p.facing + Math.PI + ((index + step) / MASCOT_KEYS.length) * Math.PI * 2;
    const desired = { x: p.x + Math.sin(angle) * 2.2, z: p.z + Math.cos(angle) * 2.2 };
    const near = room.collision.nearestFree(desired, radius, occupied, 1.2);
    if (near && room.collision.segmentFree(p, near, radius)) return near;
  }
  return null;
}

function setBodySelected(
  room: MascotRoom,
  p: PlayerSnapshot,
  key: Exclude<MascotKey, (typeof BOT_KINDS)[number]>,
  selected: boolean,
  near: Point | null,
) {
  const c =
    key === 'mae'
      ? room.mae
      : key === 'kohaku'
        ? room.kohaku
        : key === 'rimo-neko'
          ? room.rimoNeko
          : room.companion524;
  if (!c) return false;
  const squadOwner =
    key === 'rimo-neko'
      ? room.rimoNeko?.squadPlayerId
      : key === '524'
        ? room.companion524?.squadPlayerId
        : null;
  const owner = squadOwner || c.followPlayerId;
  if (!selected) {
    if (owner !== p.id) return false;
    if (key === 'mae') returnMae(room.mae!);
    else if (key === 'kohaku') returnKohaku(room.kohaku!);
    else if (key === 'rimo-neko') returnRimoNeko(room.rimoNeko!);
    else returnCompanion524(room.companion524!);
    return true;
  }
  if (owner && owner !== p.id && room.players.has(owner)) return false;
  if (c.petPlayerId && c.petPlayerId !== p.id && room.players.has(c.petPlayerId)) return false;
  const far = distance(p, c) > 8;
  if (far && !near) return false;
  if (
    owner === p.id &&
    c.mode === 'following' &&
    !c.petPlayerId &&
    !far &&
    (key === 'mae' ||
      key === 'kohaku' ||
      (key === 'rimo-neko' ? room.rimoNeko?.squadMode : room.companion524?.squadMode) ===
        'following')
  )
    return false;
  if (key === 'mae') cancelMaePet(room.mae!);
  else if (key === 'kohaku') cancelKohakuPet(room.kohaku!);
  else if (key === 'rimo-neko') cancelRimoNekoPet(room.rimoNeko!);
  else cancelCompanion524Pet(room.companion524!);
  if (near) Object.assign(c, near);
  c.followPlayerId = p.id;
  c.mode = 'following';
  c.path = [];
  c.goal = null;
  c.nextPathAt = 0;
  c.followSpeed = 0;
  c.velocityX = c.velocityZ = 0;
  c.ownerPosition = { x: p.x, z: p.z };
  c.facing = Math.atan2(p.x - c.x, p.z - c.z);
  if (near) c.trail = [{ x: c.x, z: c.z }];
  if (key === 'rimo-neko') {
    room.rimoNeko!.squadPlayerId = p.id;
    room.rimoNeko!.squadMode = 'following';
  } else if (key === '524') {
    room.companion524!.squadPlayerId = p.id;
    room.companion524!.squadMode = 'following';
  }
  return true;
}

/** Server-authoritative card selection; one bulk command applies to every available mascot. */
export function setMascotSelection(
  room: MascotRoom,
  p: PlayerSnapshot,
  target: unknown,
  selected: boolean,
  now: number,
) {
  if (p.downedUntil > now) return false;
  const keys = target === 'all' ? MASCOT_KEYS : MASCOT_KEYS.filter((key) => key === target);
  if (!keys.length) return false;
  syncOrbBots(room, now);
  let changed = false;
  for (const key of keys) {
    const body = mascotBody(room, key);
    const near = selected && body && distance(p, body) > 8 ? reunionPoint(room, p, key) : null;
    const applied = BOT_KINDS.some((kind) => kind === key)
      ? setOrbBotSelected(room, p, key, selected, now, near)
      : setBodySelected(
          room,
          p,
          key as Exclude<MascotKey, (typeof BOT_KINDS)[number]>,
          selected,
          near,
        );
    changed = applied || changed;
  }
  if (changed) syncOrbBots(room, now);
  return changed;
}
