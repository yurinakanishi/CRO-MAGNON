import { WORLD } from './world.mjs';
import { attackProfile, ATTACK_PROFILES, shoulderMagic } from './combat-profiles.mjs';

export const COMBAT = Object.freeze({
  attackDamage: 15,
  attackCooldownMs: 850,
  attackDurationMs: 700,
  attackImpactMs: 333,
  spearReach: 1.65,
  halfAngleRadians: (55 * Math.PI) / 180,
});
export const combatDistance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
export const withinSpearReach = (player, target) =>
  combatDistance(player, target) <=
  (player.radius ?? WORLD.playerRadius) + target.radius + COMBAT.spearReach;
export const withinAttackReach = (player, target, profile = attackProfile(player)) => {
  return (
    combatDistance(player, target) <=
    target.radius +
      profile.reach +
      (profile.projectileRadius ?? player.radius ?? WORLD.playerRadius)
  );
};
export const enemyIsSolid = (enemy) =>
  enemy.hostile === true && (enemy.phase === 'alive' || enemy.phase === 'dead');
export function stopActor(actor) {
  actor.dx = 0;
  actor.dz = 0;
  actor.target = null;
  actor.path = [];
  actor.navigationGoal = null;
  actor.navigationEnd = null;
  actor.moving = false;
  actor.running = false;
  actor.speed = 0;
  actor.velocityX = 0;
  actor.velocityZ = 0;
}
const alive = (actor) =>
  Number.isFinite(actor.health) &&
  actor.health > 0 &&
  actor.alive !== false &&
  (actor.phase === undefined || actor.phase === 'alive');
const actors = (collection) =>
  collection instanceof Map ? [...collection.values()] : collection || [];

// Only server-owned damageable collections participate. Other players and the
// friendly village NPC are never searched or selected by a client-supplied ID.
export function damageableTargets(room) {
  const playerIds = new Set(room.players.keys());
  return [
    ...actors(room.animals)
      .filter((target) => !target.riderId)
      .map((target) => ({ target, kind: 'animal' })),
    ...actors(room.enemies)
      // An enemy mid-evasion (the sabertooth's step) cannot be struck.
      .filter((target) => target.hostile === true && target.evading !== true)
      .map((target) => ({ target, kind: 'enemy' })),
  ].filter(
    ({ target }) =>
      !playerIds.has(target.id) &&
      alive(target) &&
      Number.isFinite(target.x) &&
      Number.isFinite(target.z) &&
      Number.isFinite(target.radius) &&
      target.radius >= 0,
  );
}
export function inAttackArc(
  player,
  target,
  facing = player.facing,
  profile = attackProfile(player),
) {
  const angle = Math.atan2(target.x - player.x, target.z - player.z);
  const delta = Math.atan2(Math.sin(angle - facing), Math.cos(angle - facing));
  return Math.abs(delta) <= profile.halfAngle;
}
const sameReachableHeight = (room, a, b) =>
  Math.abs((room.collision.surfaceHeight?.(a) ?? 0) - (room.collision.surfaceHeight?.(b) ?? 0)) <=
  1.4;
const clearLine = (room, player, target) =>
  sameReachableHeight(room, player, target) && room.collision.segmentFree(player, target, 0.12);

export function startAttack(room, player, message: { targetId?: string } = {}, now = Date.now()) {
  const profile = attackProfile(player);
  if (player.downedUntil) return { accepted: false, reason: 'downed' };
  const carrier = player.carrierId && room.players.get(player.carrierId);
  const seatedMagic =
    shoulderMagic(player) &&
    carrier?.species === 'ape' &&
    carrier.passengerId === player.id &&
    !carrier.downedUntil &&
    !carrier.mountId &&
    !carrier.boatId;
  if (player.mountId || player.boatId || (player.carrierId && !seatedMagic) || player.passengerId)
    return { accepted: false, reason: 'mounted' };
  if (player.attackSequence && now - player.attackAt < profile.cooldownMs)
    return { accepted: false, reason: 'cooldown' };
  if (seatedMagic) {
    player.x = carrier.x;
    player.z = carrier.z;
    player.facing = carrier.facing;
  }
  const aimed =
    typeof message.targetId === 'string'
      ? damageableTargets(room).find(({ target }) => target.id === message.targetId)?.target
      : null;
  // A nearby visible click target may turn the actor. F without a target, a stale
  // click, and invalid IDs all retain the actor's authoritative forward heading.
  if (aimed && withinAttackReach(player, aimed) && clearLine(room, player, aimed))
    player.facing = Math.atan2(aimed.x - player.x, aimed.z - player.z);
  if (!Number.isFinite(player.facing)) player.facing = 0;
  const interruptedCooking = !!player.cookingEndsAt;
  player.cookingEndsAt = 0;
  stopActor(player);
  player.attackAt = now;
  player.attackSequence = (player.attackSequence || 0) + 1;
  player.pendingStrike = {
    facing: player.facing,
    impactAt: now + profile.impactMs,
    kind: profile.id,
  };
  player.energy = Math.max(0, player.energy - profile.energy);
  return { accepted: true, interruptedCooking };
}

export function resolveAttack(room, player, now = Date.now()) {
  const strike = player.pendingStrike;
  if (!strike || now < strike.impactAt) return null;
  player.pendingStrike = null;
  const profile = ATTACK_PROFILES[strike.kind || 'spear'];
  if (profile.key === 'magic') {
    // Start at the body centre and sweep the first segment too, so casting next
    // to a wall cannot spawn the orb on the wall's far side.
    const carrier = player.carrierId && room.players.get(player.carrierId);
    const inherit =
      shoulderMagic(player) &&
      carrier?.species === 'ape' &&
      carrier.passengerId === player.id &&
      !carrier.downedUntil;
    // Capture the carrier's actual movement on the release frame. Later turns
    // and stops must not steer a projectile that has already left the hands.
    const vx =
      Math.sin(strike.facing) * profile.projectileSpeed + (inherit ? (carrier.velocityX ?? 0) : 0);
    const vz =
      Math.cos(strike.facing) * profile.projectileSpeed + (inherit ? (carrier.velocityZ ?? 0) : 0);
    const speed = Math.hypot(vx, vz);
    room.projectiles ??= [];
    room.projectiles.push({
      id: `${player.id}:${player.attackSequence}`,
      ownerId: player.id,
      x: player.x,
      z: player.z,
      dx: speed > 0 ? vx / speed : Math.sin(strike.facing),
      dz: speed > 0 ? vz / speed : Math.cos(strike.facing),
      speed,
      elevation: room.collision.surfaceHeight?.(player) ?? 0,
      createdAt: strike.impactAt,
      updatedAt: strike.impactAt,
      travelled: 0,
      kind: 'magic',
    });
    return { hit: false, launched: true };
  }
  // Resolve against the world on the thrust frame, allowing a creature to enter
  // or leave the attack during windup. A swing can damage only one forward target.
  const hit = damageableTargets(room)
    .filter(
      ({ target }) =>
        withinAttackReach(player, target, profile) &&
        inAttackArc(player, target, strike.facing, profile) &&
        clearLine(room, player, target),
    )
    .sort((a, b) => combatDistance(player, a.target) - combatDistance(player, b.target))[0];
  if (!hit) return { hit: false };
  return applyHit(hit, profile, now, player.id);
}

function applyHit({ target, kind }, profile, now, attackerId = null) {
  target.health = Math.max(0, target.health - profile.damage);
  const killed = target.health === 0;
  // Super armour (a sabertooth in mid-leap) takes the damage without flinching.
  const armoured = kind === 'enemy' && target.superArmor === true && !killed;
  if (!armoured) {
    target.hitUntil = now + (target.hitDurationMs ?? profile.durationMs - profile.impactMs);
    stopActor(target);
    target.clip = killed ? 'Death' : kind === 'enemy' ? 'Hit' : 'Idle_Loop';
  }
  if (kind === 'enemy') {
    target.hitSequence = (target.hitSequence || 0) + 1;
    target.hitAt = now;
    // Struck from anywhere, the creature knows who did it.
    if (attackerId && !killed) {
      target.provokedBy = attackerId;
      target.provokedAt = now;
    }
    if (!armoured) {
      target.pendingAttack = null;
      target.attackLockUntil = 0;
    }
  }
  if (killed) {
    target.phase = kind === 'animal' ? 'dying' : 'dead';
    target.phaseStartedAt = now;
    if (kind === 'enemy') target.alive = false;
  }
  return { hit: true, target, kind, killed, weapon: profile.key };
}

// Exact segment-circle entry, used for continuous projectile collision. It
// detects a target even when a slow server tick crosses its whole body.
export function circleEntry(a, b, centre, radius) {
  const dx = b.x - a.x,
    dz = b.z - a.z,
    ox = a.x - centre.x,
    oz = a.z - centre.z;
  const c = ox * ox + oz * oz - radius * radius;
  if (c <= 0) return 0;
  const length2 = dx * dx + dz * dz;
  if (length2 < 1e-12) return Infinity;
  const dot = ox * dx + oz * dz,
    discriminant = dot * dot - length2 * c;
  if (discriminant < 0) return Infinity;
  const t = (-dot - Math.sqrt(discriminant)) / length2;
  return t >= 0 && t <= 1 ? t : Infinity;
}

function boxEntry(a, b, box, radius) {
  const x = box.c * (a.x - box.x) - box.s * (a.z - box.z),
    z = box.s * (a.x - box.x) + box.c * (a.z - box.z);
  const dx = box.c * (b.x - a.x) - box.s * (b.z - a.z),
    dz = box.s * (b.x - a.x) + box.c * (b.z - a.z);
  let lo = 0,
    hi = 1;
  for (const [p, d, half] of [
    [x, dx, box.hx + radius],
    [z, dz, box.hz + radius],
  ]) {
    if (Math.abs(d) < 1e-12) {
      if (Math.abs(p) > half) return Infinity;
    } else {
      const u = (-half - p) / d,
        v = (half - p) / d;
      lo = Math.max(lo, Math.min(u, v));
      hi = Math.min(hi, Math.max(u, v));
    }
  }
  return lo <= hi && hi >= 0 ? lo : Infinity;
}

export function projectileWallEntry(collision, a, b, radius) {
  const middle = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
  let first = Infinity;
  // A horizontal orb cannot follow stairs upward or pass through a terrace.
  const steps = Math.max(1, Math.ceil(combatDistance(a, b) / 0.1));
  for (const surface of collision.walkSurfaces ?? [])
    for (let i = 1; i <= steps; i++) {
      const t = i / steps,
        h = surface.height(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t);
      if (h === null || (Number.isFinite(h) && h > (a.elevation ?? 0) + 0.4 - radius)) {
        first = Math.min(first, (i - 1) / steps);
        break;
      }
    }
  for (const obstacle of collision.nearby(middle, combatDistance(a, b) / 2 + radius)) {
    first = Math.min(
      first,
      obstacle.type === 'circle'
        ? circleEntry(a, b, obstacle, obstacle.radius + radius)
        : boxEntry(a, b, obstacle, radius),
    );
  }
  // Flight can cross water; world edges still stop a projectile.
  for (const axis of ['x', 'z']) {
    const min = WORLD[axis === 'x' ? 'minX' : 'minZ'] + WORLD.edgeMargin,
      max = WORLD[axis === 'x' ? 'maxX' : 'maxZ'] - WORLD.edgeMargin;
    if (b[axis] < min || b[axis] > max) {
      const edge = b[axis] < min ? min : max,
        delta = b[axis] - a[axis];
      first = Math.min(first, Math.max(0, delta ? (edge - a[axis]) / delta : 0));
    }
  }
  return first;
}

export function updateProjectiles(room, now = Date.now()) {
  const events = [],
    remaining = [];
  room.projectileImpacts = (room.projectileImpacts || []).filter((effect) => now - effect.at < 600);
  for (const projectile of room.projectiles || []) {
    const owner = room.players.get(projectile.ownerId);
    if (!owner || owner.downedUntil) continue;
    const profile = ATTACK_PROFILES.magic;
    const speed = projectile.speed ?? profile.projectileSpeed;
    // Retain the spell's original lifetime (8 / 7 seconds). Inherited motion
    // adds world distance without reducing its forward travel relative to the ape.
    const range = (profile.reach * speed) / profile.projectileSpeed;
    const travel = Math.min(
      range - projectile.travelled,
      (Math.max(0, now - projectile.updatedAt) * speed) / 1000,
    );
    const end = {
      x: projectile.x + projectile.dx * travel,
      z: projectile.z + projectile.dz * travel,
    };
    const wall = projectileWallEntry(room.collision, projectile, end, profile.projectileRadius);
    const hit = damageableTargets(room)
      .map((target) => ({
        ...target,
        t: circleEntry(
          projectile,
          end,
          target.target,
          target.target.radius + profile.projectileRadius,
        ),
      }))
      .filter(
        (target) =>
          Number.isFinite(target.t) &&
          target.t < wall &&
          Math.abs(
            (projectile.elevation ?? 0) - (room.collision.surfaceHeight?.(target.target) ?? 0),
          ) <= 1.4,
      )
      .sort((a, b) => a.t - b.t)[0];
    const t = hit?.t ?? wall;
    if (Number.isFinite(t)) {
      const impact = {
        id: projectile.id,
        x: projectile.x + (end.x - projectile.x) * t,
        z: projectile.z + (end.z - projectile.z) * t,
        elevation: projectile.elevation ?? 0,
        at: now,
        hit: !!hit,
      };
      room.projectileImpacts.push(impact);
      if (hit) events.push({ ...applyHit(hit, profile, now, owner.id), owner });
      continue;
    }
    Object.assign(projectile, end, { updatedAt: now, travelled: projectile.travelled + travel });
    if (projectile.travelled < range) remaining.push(projectile);
  }
  room.projectiles = remaining;
  return events;
}
