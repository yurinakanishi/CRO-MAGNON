import type { Point } from './types.mjs';
import type { PlayerSnapshot } from './snapshots.mjs';
import type { CollisionWorld } from './collision.mjs';
import { CAMP } from './world.mjs';
import { interactionVisible } from './interactions.mjs';
import { attackProfile } from './combat-profiles.mjs';
import { jumpProgress } from './jumping.mjs';
import type { Companion524, Companion524Snapshot } from './companion-524-types.mjs';
export type { Companion524, Companion524Snapshot } from './companion-524-types.mjs';

export const COMPANION_524 = Object.freeze({
  id: 'companion-524',
  modelKey: 'yellow-524-mascot',
  home: { x: CAMP.x - 4, z: CAMP.z + 3.5 },
  radius: 0.18,
  bodyHeight: 0.3,
  // Measured ear-to-tip rest height of the unchanged C13/C14 source mesh.
  scale: 0.3 / 0.9017686545848846,
  hoverHeight: 0.94,
  hoverAmplitude: 0.12,
  hoverPeriodMs: 4000,
  petRange: 2.6,
  petCooldownMs: 1200,
  petApproachMs: 3000,
  petStrokeMs: 1100,
  spinMs: 1000,
  happyMs: 1800,
  hitMs: 650,
  impulse: 5.2,
  damping: 7,
  followDistance: 2.1,
  followAcceleration: 6,
});

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
>;
type CompanionRoom = {
  companion524?: Companion524;
  collision: CollisionWorld;
  players: Map<string, PetPlayer & { facing: number; radius: number; speed: number }>;
};
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);
const point = (p: Point): Point => ({ x: p.x, z: p.z });

export function createCompanion524(collision: CollisionWorld): Companion524 {
  const home = collision.nearestFree(COMPANION_524.home, COMPANION_524.radius, [], 3);
  if (!home) throw new Error('524: no safe position beside the initial camp');
  return {
    ...home,
    home,
    id: COMPANION_524.id,
    radius: COMPANION_524.radius,
    facing: 0,
    mode: 'idle',
    followPlayerId: null,
    petSequence: 0,
    petAt: 0,
    petPlayerId: null,
    petContactAt: 0,
    petHeight: COMPANION_524.hoverHeight,
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

/** Public data deliberately omits routing, velocities and the return trail. */
export function companion524Snapshot(c?: Companion524): Companion524Snapshot | undefined {
  if (!c) return undefined;
  const {
    id,
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

/** Used for both the contextual Cross button and authoritative action validation. */
export function nearCompanion524(
  player: PetPlayer | null | undefined,
  c: Companion524Snapshot | undefined,
  collision: CollisionWorld,
  now: number,
): boolean {
  return (
    !!player &&
    !!c &&
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
    distance(player, c) <= COMPANION_524.petRange &&
    interactionVisible(collision, player, c)
  );
}

export function returnCompanion524(c: Companion524) {
  c.followPlayerId = null;
  c.mode = 'returning';
  c.path = [];
  c.goal = null;
  c.nextPathAt = 0;
  c.followSpeed = 0;
  c.ownerPosition = null;
  cancelPet(c);
}

function cancelPet(c: Companion524) {
  c.petPlayerId = null;
  c.petContactAt = 0;
  c.petOrigin = null;
  c.petGoal = null;
}

export function handleCompanion524Action(
  room: CompanionRoom,
  player: PetPlayer,
  action: string,
  now: number,
): boolean {
  const c = room.companion524;
  if (!c) return false;
  if (action === 'dismiss524') {
    if (c.followPlayerId !== player.id) return false;
    returnCompanion524(c);
    return true;
  }
  if (
    action !== 'pet524' ||
    !nearCompanion524(player, c, room.collision, now) ||
    (c.petSequence > 0 && now - c.petAt < COMPANION_524.petCooldownMs) ||
    (c.petPlayerId &&
      now <
        (c.petContactAt || c.petAt + COMPANION_524.petApproachMs) +
          COMPANION_524.petStrokeMs +
          COMPANION_524.happyMs) ||
    (c.hitSequence > 0 && now - c.hitAt < 350)
  )
    return false;
  // 524 comes to the offered hand. The player's feet never move automatically.
  const facing = Math.atan2(c.x - player.x, c.z - player.z);
  const [reach, side, height] =
    player.species === 'bear'
      ? [0.25, 0.1, 0.35]
      : player.species === 'ape'
        ? [0.7, 0.32, 1.02]
        : [0.52, 0.12, COMPANION_524.hoverHeight];
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
  c.mode = 'following';
  c.followPlayerId = player.id;
  c.facing = Math.atan2(player.x - c.x, player.z - c.z);
  c.path = [];
  c.nextPathAt = 0;
  c.followSpeed = 0;
  c.ownerPosition = point(player);
  return true;
}

/** A real, repeatable impact, without health, loot, retaliation or a death state. */
export function hitCompanion524(c: Companion524, dx: number, dz: number, now: number) {
  cancelPet(c);
  c.followSpeed = 0;
  const length = Math.hypot(dx, dz) || 1;
  c.hitDirectionX = dx / length;
  c.hitDirectionZ = dz / length;
  c.velocityX += c.hitDirectionX * COMPANION_524.impulse;
  c.velocityZ += c.hitDirectionZ * COMPANION_524.impulse;
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

function rememberRoute(c: Companion524) {
  if (distance(c, c.trail.at(-1) ?? c.home) < 1.5) return;
  // Erase loops when passing a previously visited point. Keep an actual route
  // home, so a long trip around rocks or through a doorway can be reversed.
  const revisited = c.trail.findIndex((p) => distance(c, p) < 0.7);
  if (revisited >= 0) c.trail.length = revisited + 1;
  c.trail.push(point(c));
}

export function updateCompanion524(room: CompanionRoom, dt: number, now: number) {
  const c = room.companion524;
  if (!c || dt <= 0) return;
  const owner = c.followPlayerId ? room.players.get(c.followPlayerId) : null;
  if (
    c.mode === 'following' &&
    (!owner ||
      owner.downedUntil ||
      owner.boatId ||
      distance(owner, c) > 60 ||
      c.trail.length >= 4096)
  )
    returnCompanion524(c);

  const damping = Math.exp(-COMPANION_524.damping * dt);
  if (Math.hypot(c.velocityX, c.velocityZ) > 0.015) {
    const step = (1 - damping) / COMPANION_524.damping;
    Object.assign(c, room.collision.move(c, c.velocityX * step, c.velocityZ * step, c.radius));
    c.velocityX *= damping;
    c.velocityZ *= damping;
    rememberRoute(c);
  } else {
    c.velocityX = 0;
    c.velocityZ = 0;
  }
  if (c.hitSequence > 0 && now - c.hitAt < COMPANION_524.hitMs) return;
  if (c.mode === 'idle') return;

  if (c.petPlayerId && c.petOrigin && c.petGoal) {
    const stroking = !c.petContactAt || now < c.petContactAt + COMPANION_524.petStrokeMs;
    if (
      stroking &&
      (!owner ||
        distance(owner, c.petOrigin) > 0.25 ||
        `${owner.species}/${owner.gender}` !== c.petCharacter ||
        !nearCompanion524(owner, c, room.collision, now) ||
        (!c.petContactAt && now - c.petAt > COMPANION_524.petApproachMs))
    ) {
      cancelPet(c);
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
    } else if (now < c.petContactAt + COMPANION_524.petStrokeMs + COMPANION_524.happyMs) {
      return;
    }
  }

  let goal: Point, speed: number;
  if (c.mode === 'following' && owner) {
    const gap = COMPANION_524.followDistance + Math.max(0, owner.radius - 0.32);
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
    // Walking toward 524 or turning to face it must never make it flee behind us.
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
      Math.max(2.8, owner.speed + 0.6),
      radialSpeed + (separation - gap) * 2.4,
    );
    c.followSpeed += Math.max(
      -COMPANION_524.followAcceleration * dt,
      Math.min(COMPANION_524.followAcceleration * dt, desired - c.followSpeed),
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
    speed = 4;
    if (c.trail.length <= 1 && distance(c, c.home) < 0.08) {
      Object.assign(c, point(c.home));
      c.mode = 'idle';
      c.path = [];
      c.facing = 0;
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

/** Old saves gain a camp companion. A restored follower returns along its saved route. */
export function restoreCompanion524(room: CompanionRoom, saved: unknown) {
  const c = createCompanion524(room.collision);
  room.companion524 = c;
  if (!saved || typeof saved !== 'object') return;
  const record = saved as Partial<Companion524>;
  if (!Number.isFinite(record.x) || !Number.isFinite(record.z)) return;
  const position = { x: record.x!, z: record.z! };
  if (!room.collision.free(position, c.radius)) return;
  Object.assign(c, position);
  if (Number.isFinite(record.facing)) c.facing = record.facing!;
  const trail = Array.isArray(record.trail)
    ? record.trail
        .slice(0, 4096)
        .filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.z))
        .map(point)
    : [];
  c.trail = [point(c.home), ...trail];
  if (record.mode !== 'idle') returnCompanion524(c);
}
