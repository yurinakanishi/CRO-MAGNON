import type { Point } from './types.mjs';
import type { PlayerSnapshot } from './snapshots.mjs';
import type { CollisionWorld } from './collision.mjs';
import { CAMP } from './world.mjs';
import { interactionVisible } from './interactions.mjs';
import { attackProfile } from './combat-profiles.mjs';
import { characterModel } from './characters.mjs';
import { jumpProgress } from './jumping.mjs';
import type { RimoNeko, RimoNekoSnapshot } from './rimo-neko-types.mjs';
import type { OrbBotSnapshot } from './orb-bot-types.mjs';
export type { RimoNeko, RimoNekoSnapshot } from './rimo-neko-types.mjs';

export const RIMO_NEKO = Object.freeze({
  id: 'rimo-neko',
  modelKey: 'rimo-neko',
  home: { x: CAMP.x + 1, z: CAMP.z + 3 },
  radius: 0.3,
  bodyHeight: 0.52,
  headHeight: 0.47,
  petRange: 2.6,
  petCooldownMs: 1400,
  petApproachMs: 4000,
  petStrokeMs: 1600,
  happyMs: 1600,
  hitMs: 500,
  hissMs: 2100,
  impulse: 3.4,
  damping: 7,
  followDistance: 1.65,
  followAcceleration: 4,
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
  | 'moving'
>;
type CompanionRoom = {
  rimoNeko?: RimoNeko;
  collision: CollisionWorld;
  players: Map<string, PetPlayer & { facing: number; radius: number; speed: number }>;
  sessions?: Map<string, { player: { id: string } }>;
};
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);
const point = (p: Point): Point => ({ x: p.x, z: p.z });

export function createRimoNeko(collision: CollisionWorld): RimoNeko {
  const home = collision.nearestFree(RIMO_NEKO.home, RIMO_NEKO.radius, [], 3);
  if (!home) throw new Error('りもねこ: no safe position beside the initial camp');
  return {
    ...home,
    home,
    id: RIMO_NEKO.id,
    radius: RIMO_NEKO.radius,
    facing: 0,
    mode: 'idle',
    followPlayerId: null,
    squadPlayerId: null,
    squadMode: null,
    petSequence: 0,
    petAt: 0,
    petPlayerId: null,
    petContactAt: 0,
    petHeight: RIMO_NEKO.headHeight,
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
export function rimoNekoSnapshot(c?: RimoNeko): RimoNekoSnapshot | undefined {
  if (!c) return undefined;
  const {
    id,
    x,
    z,
    facing,
    radius,
    mode,
    followPlayerId,
    squadPlayerId,
    squadMode,
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
    squadPlayerId,
    squadMode,
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
export function nearRimoNeko(
  player: PetPlayer | null | undefined,
  c: RimoNekoSnapshot | undefined,
  collision: CollisionWorld,
  now: number,
): boolean {
  return (
    !!player &&
    !!c &&
    rimoNekoOnGround(c) &&
    !(c.hitSequence > 0 && now - c.hitAt < RIMO_NEKO.hitMs + RIMO_NEKO.hissMs) &&
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
    distance(player, c) <= RIMO_NEKO.petRange &&
    interactionVisible(collision, player, c)
  );
}

export function returnRimoNeko(c: RimoNeko, retainBond = false) {
  if (!retainBond) {
    c.followPlayerId = c.squadPlayerId = null;
    c.squadMode = null;
  }
  c.mode = 'returning';
  c.path = [];
  c.goal = null;
  c.nextPathAt = 0;
  c.followSpeed = 0;
  c.ownerPosition = null;
  cancelRimoNekoPet(c);
}

export function cancelRimoNekoPet(c: RimoNeko) {
  c.petPlayerId = null;
  c.petContactAt = 0;
  c.petOrigin = null;
  c.petGoal = null;
}

export function rimoNekoOnGround(c: RimoNekoSnapshot) {
  return !c.squadMode || !['windup', 'airborne', 'landing', 'stowed'].includes(c.squadMode);
}

/** The existing cat body and its return trail follow the one squad proxy. */
export function syncRimoNekoBot(c: RimoNeko, b: OrbBotSnapshot) {
  c.x = b.x;
  c.z = b.z;
  c.facing = b.facing;
  c.squadMode = b.mode;
  if (rimoNekoOnGround(c)) {
    if (c.mode !== 'returning') rememberRoute(c);
  } else c.velocityX = c.velocityZ = 0;
}

export function handleRimoNekoAction(
  room: CompanionRoom,
  player: PetPlayer,
  action: string,
  now: number,
): boolean {
  const c = room.rimoNeko;
  if (!c) return false;
  if (action === 'dismissRimo') {
    if (c.followPlayerId !== player.id) return false;
    returnRimoNeko(c);
    return true;
  }
  if (
    action !== 'petRimo' ||
    !nearRimoNeko(player, c, room.collision, now) ||
    (c.petSequence > 0 && now - c.petAt < RIMO_NEKO.petCooldownMs) ||
    (c.petPlayerId &&
      now <
        (c.petContactAt || c.petAt + RIMO_NEKO.petApproachMs) +
          RIMO_NEKO.petStrokeMs +
          RIMO_NEKO.happyMs) ||
    (c.hitSequence > 0 && now - c.hitAt < 350)
  )
    return false;
  // The cat approaches the crouching hand. Player navigation stays manual.
  // C2's crown sits 4 cm farther back and 5 cm toward the opposite cheek.
  // Bring it closer to the short-armed mage and align it with the right hand.
  const facing = Math.atan2(c.x - player.x, c.z - player.z);
  const [reach, side, height] =
    player.species === 'bear'
      ? [0.26, 0.12, RIMO_NEKO.headHeight]
      : player.species === 'ape'
        ? [0.8, 0.25, RIMO_NEKO.headHeight]
        : characterModel(player).bodyPlan === 'octopus'
          ? [1.08, 0.12, RIMO_NEKO.headHeight]
          : player.species === 'howkey'
            ? [0.54, 0.12, RIMO_NEKO.headHeight]
            : [0.6, 0.12, RIMO_NEKO.headHeight];
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
  // Trust begins as soon as the invitation is accepted, before the animation.
  c.mode = 'following';
  c.followPlayerId = player.id;
  c.squadPlayerId = player.id;
  c.squadMode = 'following';
  c.facing = Math.atan2(player.x - c.x, player.z - c.z);
  c.path = [];
  c.nextPathAt = 0;
  c.followSpeed = 0;
  c.ownerPosition = point(player);
  return true;
}

/** Recoil, then face the attacker and hiss; no health, death or counterattack. */
export function hitRimoNeko(c: RimoNeko, dx: number, dz: number, now: number) {
  cancelRimoNekoPet(c);
  c.mode = c.followPlayerId ? 'following' : 'idle';
  c.followSpeed = 0;
  const length = Math.hypot(dx, dz) || 1;
  c.hitDirectionX = dx / length;
  c.hitDirectionZ = dz / length;
  c.facing = Math.atan2(-c.hitDirectionX, -c.hitDirectionZ);
  c.velocityX += c.hitDirectionX * RIMO_NEKO.impulse;
  c.velocityZ += c.hitDirectionZ * RIMO_NEKO.impulse;
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

function rememberRoute(c: RimoNeko) {
  if (distance(c, c.trail.at(-1) ?? c.home) < 1.5) return;
  // Erase loops when passing a previously visited point. Keep an actual route
  // home, so a long trip around rocks or through a doorway can be reversed.
  const revisited = c.trail.findIndex((p) => distance(c, p) < 0.7);
  if (revisited >= 0) c.trail.length = revisited + 1;
  c.trail.push(point(c));
  if (c.trail.length > 4096) c.trail.splice(1, 1);
}

export function updateRimoNeko(room: CompanionRoom, dt: number, now: number) {
  const c = room.rimoNeko;
  if (!c || dt <= 0) return;
  const ownerId = c.petPlayerId || c.followPlayerId;
  const owner = ownerId ? room.players.get(ownerId) : null;
  const canFollow = owner && !owner.downedUntil && !owner.boatId && distance(owner, c) <= 60;
  const squadControlled = c.squadPlayerId && c.squadMode && c.squadMode !== 'following';
  if (
    !squadControlled &&
    c.followPlayerId &&
    !canFollow &&
    (c.mode === 'following' || c.petPlayerId)
  )
    returnRimoNeko(c, true);
  else if (!squadControlled && c.followPlayerId && canFollow && c.mode !== 'following') {
    c.mode = 'following';
    c.path = [];
    c.goal = null;
    c.nextPathAt = 0;
  }

  const damping = Math.exp(-RIMO_NEKO.damping * dt);
  if (Math.hypot(c.velocityX, c.velocityZ) > 0.015) {
    const step = (1 - damping) / RIMO_NEKO.damping;
    Object.assign(c, room.collision.move(c, c.velocityX * step, c.velocityZ * step, c.radius));
    c.velocityX *= damping;
    c.velocityZ *= damping;
    rememberRoute(c);
  } else {
    c.velocityX = 0;
    c.velocityZ = 0;
  }
  if (c.hitSequence > 0 && now - c.hitAt < RIMO_NEKO.hitMs + RIMO_NEKO.hissMs) return;
  // Keep natural walking while following; the shared dots solver owns throws,
  // deployed waiting and the explicit reunion gesture.
  if (squadControlled && !c.petPlayerId) return;
  if (c.mode === 'idle' && !c.petPlayerId) return;

  if (c.petPlayerId && c.petOrigin && c.petGoal) {
    const stroking = !c.petContactAt || now < c.petContactAt + RIMO_NEKO.petStrokeMs;
    if (
      stroking &&
      (!owner ||
        owner.moving ||
        distance(owner, c.petOrigin) > 0.25 ||
        `${owner.species}/${owner.gender}` !== c.petCharacter ||
        !nearRimoNeko(owner, c, room.collision, now) ||
        (!c.petContactAt && now - c.petAt > RIMO_NEKO.petApproachMs))
    ) {
      cancelRimoNekoPet(c);
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
      if (now >= c.petContactAt + RIMO_NEKO.petStrokeMs && owner) {
        c.mode = 'following';
        c.followPlayerId = owner.id;
      }
      if (now < c.petContactAt + RIMO_NEKO.petStrokeMs + RIMO_NEKO.happyMs) return;
      cancelRimoNekoPet(c);
    }
  }

  if (c.mode === 'idle') return;
  let goal: Point, speed: number;
  if (c.mode === 'following' && owner) {
    const gap = RIMO_NEKO.followDistance + Math.max(0, owner.radius - 0.32);
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
    // Walking toward りもねこ or turning to face it must never make it flee behind us.
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
      -RIMO_NEKO.followAcceleration * dt,
      Math.min(RIMO_NEKO.followAcceleration * dt, desired - c.followSpeed),
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

/** Persist a released cat at its landing, without replaying the airborne gesture. */
export function saveRimoNeko(c: RimoNeko | undefined, bot?: OrbBotSnapshot) {
  if (!c?.squadPlayerId) return c;
  const deployed = bot
    ? !bot.recall && ['airborne', 'landing', 'waiting'].includes(bot.mode)
    : c.squadMode === 'waiting';
  const position =
    bot?.mode === 'airborne' && bot.landing
      ? bot.landing
      : bot?.mode === 'windup' && bot.origin
        ? bot.origin
        : c;
  return { ...c, ...point(position), squadMode: deployed ? 'waiting' : 'following' };
}

/** Preserve a known saved owner, including bonds made before cat throwing existed. */
export function restoreRimoNeko(room: CompanionRoom, saved: unknown) {
  const c = createRimoNeko(room.collision);
  room.rimoNeko = c;
  if (!saved || typeof saved !== 'object') return;
  const record = saved as Partial<RimoNeko>;
  const ownerId = record.squadPlayerId || record.followPlayerId;
  if (
    typeof ownerId === 'string' &&
    ownerId &&
    (room.players.has(ownerId) ||
      [...(room.sessions?.values() ?? [])].some((s) => s.player.id === ownerId))
  )
    c.followPlayerId = c.squadPlayerId = ownerId;
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
  if (c.squadPlayerId) {
    c.squadMode = ['airborne', 'landing', 'waiting'].includes(record.squadMode ?? '')
      ? 'waiting'
      : 'following';
    if (c.squadMode === 'waiting') {
      c.mode = 'following';
      return;
    }
  }
  if (record.mode !== 'idle' || c.followPlayerId) returnRimoNeko(c, true);
}
