import type { Point } from './types.mjs';
import type { PlayerSnapshot } from './snapshots.mjs';
import type { CollisionWorld } from './collision.mjs';
import type { Companion, CompanionSnapshot } from './companion-types.mjs';
import { interactionVisible } from './interactions.mjs';
import { attackProfile } from './combat-profiles.mjs';
import { characterModel } from './characters.mjs';
import { jumpProgress } from './jumping.mjs';
import { COMPANION_524 } from './companion-524.mjs';
import { RIMO_NEKO } from './rimo-neko.mjs';
import { FRIEND_TIMING, friendDefinition } from './friend-mascots.mjs';
export type { Companion, CompanionSnapshot } from './companion-types.mjs';

/** A dismissed companion waves goodbye for this long, then leaves the world. */
export const MASCOT_FAREWELL_MS = 1000;

type PetPlayer = Pick<
  PlayerSnapshot,
  | 'id'
  | 'x'
  | 'z'
  | 'facing'
  | 'radius'
  | 'speed'
  | 'downedUntil'
  | 'mountId'
  | 'boatId'
  | 'carrierId'
  | 'passengerId'
  | 'cookingEndsAt'
  | 'fishing'
  | 'coastalActivity'
  | 'attackAt'
  | 'attackSequence'
  | 'species'
  | 'gender'
  | 'jumpAt'
  | 'jumpSequence'
  | 'moving'
  | 'hurtAt'
  | 'warpSequence'
>;
export type CompanionRoom = {
  companions?: Companion[];
  collision: CollisionWorld;
  players: Map<string, PetPlayer>;
};

interface CompanionProfile {
  radius: number;
  /** Rest height of the stroked head: its contact socket, or 524's hover. */
  petHeight: number;
  petRange: number;
  petCooldownMs: number;
  petApproachMs: number;
  petStrokeMs: number;
  happyMs: number;
  /** The whole recoil (and the cat's hiss): no following and no hand meanwhile. */
  hitMs: number;
  impulse: number;
  damping: number;
  followDistance: number;
  followAcceleration: number;
  /** 524 floats in the dots formation; the others walk beside their person. */
  walks: boolean;
  /** 524 and りもねこ can be thrown, so the dots engine owns their squad state. */
  throwable: boolean;
  /** Where the offered hand waits for this petter: reach, side offset and height. */
  hand(player: PetPlayer): [number, number, number];
}

const PROFILE_524: CompanionProfile = {
  ...COMPANION_524,
  petHeight: COMPANION_524.hoverHeight,
  followDistance: 2.1,
  followAcceleration: 6,
  walks: false,
  throwable: true,
  // 524 comes down to the offered hand. The player's feet never move automatically.
  hand: (player) =>
    player.species === 'bear'
      ? [0.25, 0.1, 0.35]
      : player.species === 'ape'
        ? [0.7, 0.32, 1.02]
        : characterModel(player).bodyPlan === 'octopus'
          ? [1.08, 0.12, COMPANION_524.hoverHeight]
          : [0.52, 0.12, COMPANION_524.hoverHeight],
};
const PROFILE_RIMO: CompanionProfile = {
  ...RIMO_NEKO,
  petHeight: RIMO_NEKO.headHeight,
  hitMs: RIMO_NEKO.hitMs + RIMO_NEKO.hissMs,
  walks: true,
  throwable: true,
  // C2's crown sits 4 cm farther back and 5 cm toward the opposite cheek.
  // Bring it closer to the short-armed mage and align it with the right hand.
  hand: (player) =>
    player.species === 'bear'
      ? [0.26, 0.12, RIMO_NEKO.headHeight]
      : player.species === 'ape'
        ? [0.8, 0.25, RIMO_NEKO.headHeight]
        : characterModel(player).bodyPlan === 'octopus'
          ? [1.08, 0.12, RIMO_NEKO.headHeight]
          : player.species === 'howkey'
            ? [0.54, 0.12, RIMO_NEKO.headHeight]
            : [0.6, 0.12, RIMO_NEKO.headHeight],
};
const groundProfiles = new Map<string, CompanionProfile>();

/** Behaviour constants for a companion key; undefined for a dot or an unknown key. */
export function companionProfile(key: string): CompanionProfile | undefined {
  if (key === '524') return PROFILE_524;
  if (key === 'rimo-neko') return PROFILE_RIMO;
  const def = friendDefinition(key);
  if (!def) return undefined;
  let profile = groundProfiles.get(key);
  if (!profile) {
    profile = {
      ...FRIEND_TIMING,
      radius: def.radius,
      petHeight: def.headHeight,
      followDistance: def.followDistance ?? FRIEND_TIMING.followDistance,
      walks: true,
      throwable: false,
      // The mascot approaches the crouching hand; the person's feet stay planted.
      hand: (player) =>
        player.species === 'bear'
          ? [0.2, 0.12, def.headHeight]
          : player.species === 'ape'
            ? [0.8, 0.25, def.headHeight]
            : characterModel(player).bodyPlan === 'octopus'
              ? [1.08, 0.12, def.headHeight]
              : player.species === 'howkey'
                ? [0.4, 0.12, def.headHeight]
                : [0.48, 0.12, def.headHeight],
    };
    groundProfiles.set(key, profile);
  }
  return profile;
}

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);
const point = (p: Point): Point => ({ x: p.x, z: p.z });

export function createCompanion(
  key: string,
  id: string,
  owner: Pick<PetPlayer, 'id' | 'x' | 'z' | 'facing' | 'warpSequence'>,
  at: Point,
): Companion {
  const profile = companionProfile(key);
  if (!profile) throw new Error(`${key}: not a companion mascot`);
  return {
    ...point(at),
    id,
    key,
    ownerId: owner.id,
    radius: profile.radius,
    facing: owner.facing,
    squadMode: 'following',
    leavingAt: 0,
    petSequence: 0,
    petAt: 0,
    petPlayerId: null,
    petContactAt: 0,
    petHeight: profile.petHeight,
    petFacing: 0,
    hitSequence: 0,
    hitAt: 0,
    hitDirectionX: 0,
    hitDirectionZ: 1,
    velocityX: 0,
    velocityZ: 0,
    path: [],
    goal: null,
    nextPathAt: 0,
    followSpeed: 0,
    ownerPosition: null,
    lastOwner: point(owner),
    warpSequence: owner.warpSequence ?? 0,
    petOrigin: null,
    petGoal: null,
    petCharacter: '',
  };
}

/** Public data deliberately omits routing, velocities and the pet's planning. */
export function companionSnapshot(c: Companion): CompanionSnapshot {
  const {
    id,
    key,
    ownerId,
    x,
    z,
    facing,
    radius,
    squadMode,
    leavingAt,
    petSequence,
    petAt,
    petPlayerId,
    petContactAt,
    petHeight,
    petFacing,
    hitSequence,
    hitAt,
    hitDirectionX,
    hitDirectionZ,
  } = c;
  return {
    id,
    key,
    ownerId,
    x,
    z,
    facing,
    radius,
    squadMode,
    leavingAt,
    petSequence,
    petAt,
    petPlayerId,
    petContactAt,
    petHeight,
    petFacing,
    hitSequence,
    hitAt,
    hitDirectionX,
    hitDirectionZ,
  };
}

export function companionSnapshots(room: { companions?: Companion[] }): CompanionSnapshot[] {
  return (room.companions ?? []).map(companionSnapshot);
}

/** Held, thrown and stowed bodies have no ground-level hand or combat target. */
export function companionOnGround(c: Pick<CompanionSnapshot, 'squadMode'>) {
  return !['windup', 'airborne', 'landing', 'stowed'].includes(c.squadMode);
}

/** Still recoiling (or hissing): it neither follows nor accepts a hand. */
export function companionReacting(c: CompanionSnapshot, now: number) {
  const profile = companionProfile(c.key);
  return !!profile && c.hitSequence > 0 && now - c.hitAt < profile.hitMs;
}

/** Occupied by a hand or a recoil, so its squad stands still. */
export function companionBusy(c: CompanionSnapshot, now: number) {
  return !!c.petPlayerId || companionReacting(c, now);
}

/** Used for both the contextual pet prompt and authoritative action validation. */
export function nearCompanion(
  player: PetPlayer | null | undefined,
  c: CompanionSnapshot | undefined,
  collision: CollisionWorld,
  now: number,
): boolean {
  const profile = c && companionProfile(c.key);
  return (
    !!player &&
    !!c &&
    !!profile &&
    !c.leavingAt &&
    companionOnGround(c) &&
    !companionReacting(c, now) &&
    !player.downedUntil &&
    !player.mountId &&
    !player.boatId &&
    !player.carrierId &&
    !player.passengerId &&
    !player.cookingEndsAt &&
    !player.fishing &&
    !player.coastalActivity &&
    jumpProgress(player, now) === null &&
    !(player.attackSequence > 0 && now - player.attackAt < attackProfile(player).durationMs) &&
    distance(player, c) <= profile.petRange &&
    interactionVisible(collision, player, c)
  );
}

/** The companion this player is stroking, if any. */
export function pettingCompanion<T extends { petPlayerId: string | null }>(
  companions: readonly T[] | undefined,
  playerId: string | null | undefined,
) {
  return playerId ? companions?.find((c) => c.petPlayerId === playerId) : undefined;
}

export function cancelCompanionPet(c: Companion) {
  c.petPlayerId = null;
  c.petContactAt = 0;
  c.petOrigin = null;
  c.petGoal = null;
}

/** Steering away interrupts this player's stroke; ownership never depends on it. */
export function cancelCompanionPetsBy(room: { companions?: Companion[] }, playerId: string) {
  for (const c of room.companions ?? []) if (c.petPlayerId === playerId) cancelCompanionPet(c);
}

/**
 * Anyone may pet anyone's companion. It comes to the offered hand, enjoys the stroke
 * and is happy, then carries on with its own person.
 */
export function petCompanion(room: CompanionRoom, player: PetPlayer, c: Companion, now: number) {
  const profile = companionProfile(c.key);
  if (
    !profile ||
    !nearCompanion(player, c, room.collision, now) ||
    (c.petSequence > 0 && now - c.petAt < profile.petCooldownMs) ||
    (c.petPlayerId &&
      now <
        (c.petContactAt || c.petAt + profile.petApproachMs) +
          profile.petStrokeMs +
          profile.happyMs) ||
    (c.hitSequence > 0 && now - c.hitAt < 350)
  )
    return false;
  const facing = Math.atan2(c.x - player.x, c.z - player.z);
  const [reach, side, height] = profile.hand(player);
  const goal = {
    x: player.x + Math.sin(facing) * reach - Math.cos(facing) * side,
    z: player.z + Math.cos(facing) * reach + Math.sin(facing) * side,
  };
  if (!room.collision.segmentFree(c, goal, c.radius)) return false;
  c.petAt = now;
  c.petSequence++;
  c.petPlayerId = player.id;
  c.petContactAt = 0;
  c.petOrigin = point(player);
  c.petGoal = goal;
  c.petHeight = height;
  c.petFacing = facing;
  c.petCharacter = `${player.species}/${player.gender}`;
  player.facing = facing;
  c.facing = Math.atan2(player.x - c.x, player.z - c.z);
  c.path = [];
  c.nextPathAt = 0;
  c.followSpeed = 0;
  return true;
}

/** A real, repeatable recoil, without health, loot, retaliation or a death state. */
export function hitCompanion(c: Companion, dx: number, dz: number, now: number) {
  const profile = companionProfile(c.key);
  if (!profile) return;
  cancelCompanionPet(c);
  c.followSpeed = 0;
  const length = Math.hypot(dx, dz) || 1;
  c.hitDirectionX = dx / length;
  c.hitDirectionZ = dz / length;
  // Walkers turn to face the blow; 524 keeps its heading and tumbles.
  if (profile.walks) c.facing = Math.atan2(-c.hitDirectionX, -c.hitDirectionZ);
  c.velocityX += c.hitDirectionX * profile.impulse;
  c.velocityZ += c.hitDirectionZ * profile.impulse;
  const speed = Math.hypot(c.velocityX, c.velocityZ);
  if (speed > 8) {
    c.velocityX *= 8 / speed;
    c.velocityZ *= 8 / speed;
  }
  c.hitAt = now;
  c.hitSequence++;
  c.path = [];
  c.nextPathAt = 0;
}

/** A free spot behind the person, in reach and in sight, away from other companions. */
export function companionArrival(
  collision: CollisionWorld,
  owner: Point & { facing: number },
  radius: number,
  occupied: readonly (Point & { radius: number })[] = [],
): Point | null {
  const dynamic = occupied
    .filter((other) => distance(owner, other) < 5)
    .map((other) => ({
      id: 'companion',
      type: 'circle' as const,
      x: other.x,
      z: other.z,
      radius: other.radius,
    }));
  for (let step = 0; step < 9; step++) {
    const turn = (step % 2 ? 1 : -1) * Math.ceil(step / 2) * 0.55;
    const angle = owner.facing + Math.PI + turn;
    const desired = { x: owner.x + Math.sin(angle) * 1.6, z: owner.z + Math.cos(angle) * 1.6 };
    const near = collision.nearestFree(desired, radius, dynamic, 1.2);
    if (near && collision.segmentFree(owner, near, radius)) return near;
  }
  return null;
}

function stop(c: Companion) {
  c.path = [];
  c.goal = null;
  c.nextPathAt = 0;
  c.followSpeed = 0;
  c.velocityX = c.velocityZ = 0;
}

/** Approach the offered hand, stroke, and be happy. False once the hand is gone. */
function updatePet(
  room: CompanionRoom,
  c: Companion,
  profile: CompanionProfile,
  dt: number,
  now: number,
) {
  const petter = room.players.get(c.petPlayerId!);
  if (!petter || !c.petOrigin || !c.petGoal) {
    cancelCompanionPet(c);
    return false;
  }
  const stroking = !c.petContactAt || now < c.petContactAt + profile.petStrokeMs;
  if (
    stroking &&
    (petter.moving ||
      (petter.hurtAt ?? 0) > c.petAt ||
      distance(petter, c.petOrigin) > 0.25 ||
      `${petter.species}/${petter.gender}` !== c.petCharacter ||
      !nearCompanion(petter, c, room.collision, now) ||
      (!c.petContactAt && now - c.petAt > profile.petApproachMs))
  ) {
    cancelCompanionPet(c);
    return false;
  }
  if (!c.petContactAt) {
    const length = distance(c, c.petGoal);
    const amount = Math.min(length, 1.6 * dt);
    if (length > 0.001)
      Object.assign(
        c,
        room.collision.move(
          c,
          ((c.petGoal.x - c.x) / length) * amount,
          ((c.petGoal.z - c.z) / length) * amount,
          c.radius,
        ),
      );
    if (distance(c, c.petGoal) < 0.015) c.petContactAt = now;
    return true;
  }
  if (now < c.petContactAt + profile.petStrokeMs + profile.happyMs) return true;
  cancelCompanionPet(c);
  return false;
}

/**
 * A walker without a dots squad waits out of sight while its person rides, sails, is
 * carried or recovers, and rejoins beside them after that or a warp. False while stowed.
 */
function keepWithOwner(room: CompanionRoom, c: Companion, owner: PetPlayer) {
  const warped = (owner.warpSequence ?? 0) !== c.warpSequence || distance(owner, c.lastOwner) > 12;
  c.lastOwner = point(owner);
  c.warpSequence = owner.warpSequence ?? 0;
  if (owner.mountId || owner.boatId || owner.carrierId || owner.downedUntil) {
    if (c.squadMode !== 'stowed') {
      stop(c);
      c.squadMode = 'stowed';
    }
    return false;
  }
  if (c.squadMode === 'stowed' || warped || distance(owner, c) > 40) {
    const at = companionArrival(room.collision, owner, c.radius, room.companions);
    if (!at) {
      c.squadMode = 'stowed';
      return false;
    }
    Object.assign(c, at);
    c.facing = owner.facing;
    c.squadMode = 'following';
    stop(c);
  }
  return true;
}

/** Natural walking at a comfortable distance from the person, independent of their gaze. */
function follow(
  room: CompanionRoom,
  c: Companion,
  profile: CompanionProfile,
  owner: PetPlayer,
  dt: number,
  now: number,
) {
  const gap = profile.followDistance + Math.max(0, owner.radius - 0.32);
  const separation = distance(owner, c);
  const radialSpeed = c.ownerPosition
    ? Math.max(
        0,
        Math.min(
          owner.speed,
          ((owner.x - c.ownerPosition.x) * (owner.x - c.x) +
            (owner.z - c.ownerPosition.z) * (owner.z - c.z)) /
            (dt * Math.max(0.001, separation)),
        ),
      )
    : 0;
  c.ownerPosition = point(owner);
  // Walking toward it or turning to face it must never make it flee behind us.
  if (separation <= gap + 0.06) {
    c.path = [];
    c.followSpeed = 0;
    return;
  }
  const goal = {
    x: owner.x + ((c.x - owner.x) / separation) * gap,
    z: owner.z + ((c.z - owner.z) / separation) * gap,
  };
  const desired = Math.min(
    Math.min(3.8, Math.max(1.8, owner.speed + 0.3)),
    radialSpeed + (separation - gap) * 2.4,
  );
  c.followSpeed += Math.max(
    -profile.followAcceleration * dt,
    Math.min(profile.followAcceleration * dt, desired - c.followSpeed),
  );
  if (distance(c, goal) < 15 && room.collision.segmentFree(c, goal, c.radius)) {
    c.path = [point(goal)];
    c.goal = point(goal);
    c.nextPathAt = now + 600;
  } else if (now >= c.nextPathAt && (!c.goal || distance(c.goal, goal) > 0.55 || !c.path.length)) {
    const reachable = room.collision.nearestFree(goal, c.radius, [], 2);
    c.goal = point(goal);
    c.path = reachable ? room.collision.path(c, reachable, c.radius) : [];
    c.nextPathAt = now + 600;
  }
  while (c.path.length && distance(c, c.path[0]) < 0.04) c.path.shift();
  const target = c.path[0];
  if (!target) {
    c.followSpeed = 0;
    return;
  }
  const length = distance(c, target),
    amount = Math.min(length, c.followSpeed * dt);
  const dx = ((target.x - c.x) / length) * amount;
  const dz = ((target.z - c.z) / length) * amount;
  const next = room.collision.move(c, dx, dz, c.radius);
  if (distance(c, next) < amount * 0.2) {
    c.path = [];
    c.nextPathAt = Math.max(c.nextPathAt, now + 300);
  } else c.facing = Math.atan2(next.x - c.x, next.z - c.z);
  c.followSpeed = Math.min(c.followSpeed, distance(c, next) / dt);
  Object.assign(c, next);
}

function updateCompanion(room: CompanionRoom, c: Companion, dt: number, now: number) {
  const profile = companionProfile(c.key);
  if (!profile) return;
  const damping = Math.exp(-profile.damping * dt);
  if (Math.hypot(c.velocityX, c.velocityZ) > 0.015) {
    const step = (1 - damping) / profile.damping;
    Object.assign(c, room.collision.move(c, c.velocityX * step, c.velocityZ * step, c.radius));
    c.velocityX *= damping;
    c.velocityZ *= damping;
  } else {
    c.velocityX = 0;
    c.velocityZ = 0;
  }
  // A goodbye stands still where it was dismissed.
  if (c.leavingAt) {
    if (c.petPlayerId) cancelCompanionPet(c);
    c.followSpeed = 0;
    return;
  }
  if (companionReacting(c, now)) return;
  if (c.petPlayerId && updatePet(room, c, profile, dt, now)) return;
  const owner = room.players.get(c.ownerId);
  // 524 floats with its dots squad, which also throws, stows and recalls the cat.
  if (!owner || !profile.walks) return;
  if (profile.throwable ? c.squadMode !== 'following' : !keepWithOwner(room, c, owner)) return;
  // Unreachable behind a newly closed passage or left far behind: rejoin beside them.
  if (distance(owner, c) > 40) {
    const at = companionArrival(room.collision, owner, c.radius, room.companions);
    if (at) {
      Object.assign(c, at);
      c.facing = owner.facing;
      stop(c);
    }
    return;
  }
  follow(room, c, profile, owner, dt, now);
}

export function updateCompanions(room: CompanionRoom, dt: number, now: number) {
  if (!(dt > 0) || !Number.isFinite(dt)) return;
  for (const c of room.companions ?? []) updateCompanion(room, c, dt, now);
}
