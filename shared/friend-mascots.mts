import type { Point } from './types.mjs';
import type { PlayerSnapshot } from './snapshots.mjs';
import type { CollisionWorld } from './collision.mjs';
import { CAMP } from './world.mjs';
import { interactionVisible } from './interactions.mjs';
import { attackProfile } from './combat-profiles.mjs';
import { characterModel } from './characters.mjs';
import { jumpProgress } from './jumping.mjs';
import type { FriendMascot, FriendMascotSnapshot } from './friend-mascot-types.mjs';
export type { FriendMascot, FriendMascotSnapshot } from './friend-mascot-types.mjs';

export interface FriendMascotDefinition {
  /** Model key under public/models, also the mascot selection key. */
  key: string;
  /** Contributor key (the credit's `qr` id) whose character this is. */
  credit: string;
  name: string;
  /** Offset from the first camp fire: open ground with a clear view of the fire,
   * at least 1.3 m from every other camp companion (output of a collision sweep). */
  home: Point;
  radius: number;
  bodyHeight: number;
  /** Height of the rigged PetContact socket. */
  headHeight: number;
  /** Selection card accent. */
  color: string;
}

/**
 * Contributors' companions. They share one behaviour: petting starts the bond,
 * they follow their person, recoil when struck and walk home when dismissed.
 * Heights come from each adopted model's rig record (asset.json).
 */
export const FRIEND_MASCOTS: readonly FriendMascotDefinition[] = Object.freeze([
  {
    key: 'saber-mascot',
    credit: 'saber',
    name: 'Saber',
    home: { x: 3.13, z: -0.67 },
    radius: 0.24,
    bodyHeight: 0.52,
    headHeight: 0.494,
    color: '#f1d27a',
  },
  {
    key: 'fairy-mascot',
    credit: 'fairy',
    name: 'フェアリー',
    home: { x: 1.75, z: -3.03 },
    radius: 0.22,
    bodyHeight: 0.52,
    headHeight: 0.508,
    color: '#cdb6e6',
  },
  {
    key: 'sagasa-mascot',
    credit: 'sagasa',
    name: 'さが',
    home: { x: -1.67, z: -3.75 },
    radius: 0.24,
    bodyHeight: 0.52,
    headHeight: 0.498,
    color: '#5d7fd0',
  },
  {
    key: 'nukonuko-mascot',
    credit: 'nukonuko',
    name: 'ぬこぬこ',
    home: { x: 3.56, z: -2.59 },
    radius: 0.24,
    bodyHeight: 0.52,
    headHeight: 0.477,
    color: '#b88a63',
  },
  {
    key: 'otani-mascot',
    credit: 'otani',
    name: 'オータニ',
    home: { x: -2.25, z: 1.3 },
    radius: 0.25,
    bodyHeight: 0.52,
    headHeight: 0.487,
    color: '#7fc46a',
  },
  {
    key: 'urata-mascot',
    credit: 'urata',
    name: 'うらた',
    home: { x: 2.41, z: 3.32 },
    radius: 0.24,
    bodyHeight: 0.52,
    headHeight: 0.508,
    color: '#7d7a76',
  },
  {
    key: 'rei-mascot',
    credit: 'asahina',
    name: '怜ちゃん',
    home: { x: 0, z: 4.1 },
    radius: 0.24,
    bodyHeight: 0.52,
    headHeight: 0.508,
    color: '#ff8c00',
  },
]);
export const FRIEND_MASCOT_KEYS = FRIEND_MASCOTS.map((f) => f.key);

export const FRIEND_TIMING = Object.freeze({
  petRange: 2.6,
  petCooldownMs: 1400,
  petApproachMs: 4000,
  petStrokeMs: 1400,
  happyMs: 1400,
  hitMs: 650,
  impulse: 2.4,
  damping: 7,
  followDistance: 1.65,
  followAcceleration: 4,
});

export function friendDefinition(key: string): FriendMascotDefinition | undefined {
  return FRIEND_MASCOTS.find((f) => f.key === key);
}

type PetPlayer = Pick<
  PlayerSnapshot,
  | 'id'
  | 'x'
  | 'z'
  | 'facing'
  | 'radius'
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
>;
export type FriendRoom = {
  friends?: FriendMascot[];
  collision: CollisionWorld;
  players: Map<string, PetPlayer & { facing: number; radius: number; speed: number }>;
  sessions?: Map<string, { player: { id: string } }>;
};
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);
const point = (p: Point): Point => ({ x: p.x, z: p.z });

function createFriend(def: FriendMascotDefinition, collision: CollisionWorld): FriendMascot {
  const home = collision.nearestFree(
    { x: CAMP.x + def.home.x, z: CAMP.z + def.home.z },
    def.radius,
    [],
    3,
  );
  if (!home) throw new Error(`${def.key}: no safe position beside the initial camp`);
  const homeFacing = Math.atan2(CAMP.x - home.x, CAMP.z - home.z);
  return {
    ...home,
    home,
    homeFacing,
    id: def.key,
    key: def.key,
    radius: def.radius,
    facing: homeFacing,
    mode: 'idle',
    followPlayerId: null,
    petSequence: 0,
    petAt: 0,
    petPlayerId: null,
    petContactAt: 0,
    petHeight: def.headHeight,
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
    trail: [point(home)],
    followSpeed: 0,
    ownerPosition: null,
    petOrigin: null,
    petGoal: null,
    petCharacter: '',
  };
}

export function createFriendMascots(collision: CollisionWorld): FriendMascot[] {
  return FRIEND_MASCOTS.map((def) => createFriend(def, collision));
}

/** Public data deliberately omits routing, velocities and the return trail. */
export function friendSnapshot(c: FriendMascot): FriendMascotSnapshot {
  const {
    id,
    key,
    x,
    z,
    facing,
    radius,
    mode,
    followPlayerId,
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
    x,
    z,
    facing,
    radius,
    mode,
    followPlayerId,
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

export function friendSnapshots(friends?: FriendMascot[]): FriendMascotSnapshot[] | undefined {
  return friends?.map(friendSnapshot);
}

export function friendByKey<T extends { key: string }>(
  friends: readonly T[] | undefined,
  key: unknown,
) {
  return typeof key === 'string' ? friends?.find((f) => f.key === key) : undefined;
}

/** The friend this player is currently petting, if any. */
export function pettingFriend<T extends { petPlayerId: string | null }>(
  friends: readonly T[] | undefined,
  playerId: string | null | undefined,
) {
  return playerId ? friends?.find((f) => f.petPlayerId === playerId) : undefined;
}

/** Used for both the contextual Cross button and authoritative action validation. */
export function nearFriend(
  player: PetPlayer | null | undefined,
  c: FriendMascotSnapshot | undefined,
  collision: CollisionWorld,
  now: number,
): boolean {
  return (
    !!player &&
    !!c &&
    !(c.hitSequence > 0 && now - c.hitAt < FRIEND_TIMING.hitMs) &&
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
    distance(player, c) <= FRIEND_TIMING.petRange &&
    interactionVisible(collision, player, c)
  );
}

export function returnFriend(c: FriendMascot, retainBond = false) {
  if (!retainBond) c.followPlayerId = null;
  c.mode = 'returning';
  c.path = [];
  c.goal = null;
  c.nextPathAt = 0;
  c.followSpeed = 0;
  c.ownerPosition = null;
  cancelFriendPet(c);
}

export function cancelFriendPet(c: FriendMascot) {
  c.petPlayerId = null;
  c.petContactAt = 0;
  c.petOrigin = null;
  c.petGoal = null;
}

/** Interrupts any friend this player is stroking; the bond itself is kept. */
export function cancelFriendPetsBy(room: { friends?: FriendMascot[] }, playerId: string) {
  for (const c of room.friends ?? []) if (c.petPlayerId === playerId) cancelFriendPet(c);
}

/** Every friend following this player walks home. */
export function dismissFriendsOf(room: { friends?: FriendMascot[] }, playerId: string) {
  let changed = false;
  for (const c of room.friends ?? []) {
    if (c.petPlayerId === playerId) cancelFriendPet(c);
    if (c.followPlayerId === playerId) {
      returnFriend(c);
      changed = true;
    }
  }
  return changed;
}

export function handleFriendAction(
  room: FriendRoom,
  player: PetPlayer,
  action: string,
  key: unknown,
  now: number,
): boolean {
  const c = friendByKey(room.friends, key);
  const def = c && friendDefinition(c.key);
  if (!c || !def) return false;
  if (action === 'dismissFriend') {
    if (c.followPlayerId !== player.id) return false;
    returnFriend(c);
    return true;
  }
  if (
    action !== 'petFriend' ||
    (c.followPlayerId !== null &&
      c.followPlayerId !== player.id &&
      room.players.has(c.followPlayerId)) ||
    !nearFriend(player, c, room.collision, now) ||
    (c.petSequence > 0 && now - c.petAt < FRIEND_TIMING.petCooldownMs) ||
    (c.petPlayerId &&
      now <
        (c.petContactAt || c.petAt + FRIEND_TIMING.petApproachMs) +
          FRIEND_TIMING.petStrokeMs +
          FRIEND_TIMING.happyMs) ||
    (c.hitSequence > 0 && now - c.hitAt < 350)
  )
    return false;
  // The mascot approaches the crouching hand; the person's feet stay planted.
  const facing = Math.atan2(c.x - player.x, c.z - player.z);
  const [reach, side] =
    player.species === 'bear'
      ? [0.2, 0.12]
      : player.species === 'ape'
        ? [0.8, 0.25]
        : characterModel(player).bodyPlan === 'octopus'
          ? [1.08, 0.12]
          : player.species === 'howkey'
            ? [0.4, 0.12]
            : [0.48, 0.12];
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
  c.petHeight = def.headHeight;
  c.petFacing = facing;
  c.petCharacter = `${player.species}/${player.gender}`;
  player.facing = facing;
  // An accepted invitation establishes trust before the approach and strokes.
  c.mode = 'following';
  c.followPlayerId = player.id;
  c.facing = Math.atan2(player.x - c.x, player.z - c.z);
  c.path = [];
  c.nextPathAt = 0;
  c.followSpeed = 0;
  c.ownerPosition = point(player);
  return true;
}

/** A soft recoil, without health, death, loot or a counterattack. */
export function hitFriend(c: FriendMascot, dx: number, dz: number, now: number) {
  cancelFriendPet(c);
  c.mode = c.followPlayerId ? 'following' : 'idle';
  c.followSpeed = 0;
  const length = Math.hypot(dx, dz) || 1;
  c.hitDirectionX = dx / length;
  c.hitDirectionZ = dz / length;
  c.facing = Math.atan2(-c.hitDirectionX, -c.hitDirectionZ);
  c.velocityX += c.hitDirectionX * FRIEND_TIMING.impulse;
  c.velocityZ += c.hitDirectionZ * FRIEND_TIMING.impulse;
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

function rememberRoute(c: FriendMascot) {
  if (distance(c, c.trail.at(-1) ?? c.home) < 1.5) return;
  // Erase loops when passing a previously visited point. Keep an actual route
  // home, so a long trip around rocks or through a doorway can be reversed.
  const revisited = c.trail.findIndex((p) => distance(c, p) < 0.7);
  if (revisited >= 0) c.trail.length = revisited + 1;
  c.trail.push(point(c));
  if (c.trail.length > 4096) c.trail.splice(1, 1);
}

function updateFriend(room: FriendRoom, c: FriendMascot, dt: number, now: number) {
  const ownerId = c.petPlayerId || c.followPlayerId;
  const owner = ownerId ? room.players.get(ownerId) : null;
  const canFollow = owner && !owner.downedUntil && !owner.boatId && distance(owner, c) <= 60;
  if (c.followPlayerId && !canFollow && (c.mode === 'following' || c.petPlayerId))
    returnFriend(c, true);
  else if (c.followPlayerId && canFollow && c.mode !== 'following') {
    c.mode = 'following';
    c.path = [];
    c.goal = null;
    c.nextPathAt = 0;
  }

  const damping = Math.exp(-FRIEND_TIMING.damping * dt);
  if (Math.hypot(c.velocityX, c.velocityZ) > 0.015) {
    const step = (1 - damping) / FRIEND_TIMING.damping;
    Object.assign(c, room.collision.move(c, c.velocityX * step, c.velocityZ * step, c.radius));
    c.velocityX *= damping;
    c.velocityZ *= damping;
    rememberRoute(c);
  } else {
    c.velocityX = 0;
    c.velocityZ = 0;
  }
  if (c.hitSequence > 0 && now - c.hitAt < FRIEND_TIMING.hitMs) return;
  if (c.mode === 'idle' && !c.petPlayerId) return;

  if (c.petPlayerId && c.petOrigin && c.petGoal) {
    if (!owner) {
      cancelFriendPet(c);
      return;
    }
    const stroking = !c.petContactAt || now < c.petContactAt + FRIEND_TIMING.petStrokeMs;
    if (
      stroking &&
      (owner.moving ||
        owner.hurtAt > c.petAt ||
        distance(owner, c.petOrigin) > 0.25 ||
        `${owner.species}/${owner.gender}` !== c.petCharacter ||
        !nearFriend(owner, c, room.collision, now) ||
        (!c.petContactAt && now - c.petAt > FRIEND_TIMING.petApproachMs))
    ) {
      cancelFriendPet(c);
      return;
    } else if (!c.petContactAt) {
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
      rememberRoute(c);
      if (distance(c, c.petGoal) < 0.015) c.petContactAt = now;
      return;
    } else {
      if (now >= c.petContactAt + FRIEND_TIMING.petStrokeMs) {
        c.mode = 'following';
        c.followPlayerId = owner.id;
      }
      if (now < c.petContactAt + FRIEND_TIMING.petStrokeMs + FRIEND_TIMING.happyMs) return;
      cancelFriendPet(c);
    }
  }

  if (c.mode === 'idle') return;
  let goal: Point, speed: number;
  if (c.mode === 'following' && owner) {
    const gap = FRIEND_TIMING.followDistance + Math.max(0, owner.radius - 0.32);
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
    // Keep a comfortable distance from the person, independent of their gaze.
    if (separation <= gap + 0.06) {
      c.path = [];
      c.followSpeed = 0;
      return;
    }
    goal = {
      x: owner.x + ((c.x - owner.x) / separation) * gap,
      z: owner.z + ((c.z - owner.z) / separation) * gap,
    };
    const desired = Math.min(
      Math.min(3.8, Math.max(1.8, owner.speed + 0.3)),
      radialSpeed + (separation - gap) * 2.4,
    );
    c.followSpeed += Math.max(
      -FRIEND_TIMING.followAcceleration * dt,
      Math.min(FRIEND_TIMING.followAcceleration * dt, desired - c.followSpeed),
    );
    speed = c.followSpeed;
  } else {
    // Gathered resources can regrow after we passed them. Discard a newly
    // obstructed breadcrumb so pathfinding can route around it toward home.
    while (
      c.trail.length > 1 &&
      (distance(c, c.trail.at(-1)!) < 0.4 || !room.collision.free(c.trail.at(-1)!, c.radius))
    )
      c.trail.pop();
    goal = c.trail.at(-1) ?? c.home;
    speed = 2.0;
    if (c.trail.length <= 1 && distance(c, c.home) < 0.08) {
      Object.assign(c, point(c.home));
      c.mode = 'idle';
      c.path = [];
      c.facing = c.homeFacing;
      return;
    }
  }
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
    amount = Math.min(length, speed * dt);
  const dx = ((target.x - c.x) / length) * amount;
  const dz = ((target.z - c.z) / length) * amount;
  const next = room.collision.move(c, dx, dz, c.radius);
  if (distance(c, next) < amount * 0.2) {
    c.path = [];
    c.nextPathAt = Math.max(c.nextPathAt, now + 300);
  } else c.facing = Math.atan2(next.x - c.x, next.z - c.z);
  if (c.mode === 'following') c.followSpeed = Math.min(c.followSpeed, distance(c, next) / dt);
  Object.assign(c, next);
  if (c.mode === 'following') rememberRoute(c);
}

export function updateFriendMascots(room: FriendRoom, dt: number, now: number) {
  if (dt <= 0) return;
  for (const c of room.friends ?? []) updateFriend(room, c, dt, now);
}

/** Preserve known saved owners without replaying an unfinished pet animation. */
export function restoreFriendMascots(room: FriendRoom, saved: unknown) {
  room.friends = createFriendMascots(room.collision);
  if (!Array.isArray(saved)) return;
  for (const c of room.friends) {
    const record = saved.find(
      (entry): entry is Partial<FriendMascot> =>
        !!entry && typeof entry === 'object' && (entry as { key?: unknown }).key === c.key,
    );
    if (!record) continue;
    const ownerId = record.followPlayerId;
    if (
      typeof ownerId === 'string' &&
      ownerId &&
      (room.players.has(ownerId) ||
        [...(room.sessions?.values() ?? [])].some((s) => s.player.id === ownerId))
    )
      c.followPlayerId = ownerId;
    if (!Number.isFinite(record.x) || !Number.isFinite(record.z)) continue;
    const position = { x: record.x!, z: record.z! };
    if (!room.collision.free(position, c.radius)) continue;
    Object.assign(c, position);
    if (Number.isFinite(record.facing)) c.facing = record.facing!;
    const trail = Array.isArray(record.trail)
      ? record.trail
          .slice(0, 4096)
          .filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.z))
          .map(point)
      : [];
    c.trail = [point(c.home), ...trail];
    if (record.mode !== 'idle' || c.followPlayerId) returnFriend(c, true);
  }
}
