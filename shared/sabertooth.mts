import { SABERTOOTH as R, SABERTOOTH_GROUND } from './sabertooth-rules.mjs';
import { CAMP } from './world.mjs';
import { combatDistance as distance, enemyIsSolid, stopActor } from './combat.mjs';
import { attackProfile } from './combat-profiles.mjs';

const circle = (a) => ({ id: a.id, type: 'circle', x: a.x, z: a.z, radius: a.radius });
const obstacles = (room, enemy) =>
  [
    ...room.players.values(),
    ...(room.animals ?? []).filter((a) => ['alive', 'dying'].includes(a.phase)),
    ...(room.enemies ?? []).filter(enemyIsSolid),
    ...(room.residents ?? []),
  ]
    .filter((a) => a !== enemy && !a.carrierId)
    .map(circle);
const angleTo = (a, b) => Math.atan2(b.x - a.x, b.z - a.z);
const angleDifference = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const clear = (room, a, b) =>
  Math.abs((room.collision.surfaceHeight?.(a) ?? 0) - (room.collision.surfaceHeight?.(b) ?? 0)) <=
    1.4 && room.collision.segmentFree(a, b, 0.12);
const eligible = (room, e, p, now) =>
  p &&
  !p.downedUntil &&
  !p.mountId &&
  !p.boatId &&
  !p.carrierId &&
  now >= (p.invulnerableUntil ?? 0) &&
  distance(p, room.camp ?? CAMP) > 12 &&
  distance(p, e.home) <= R.territoryRadius;
const clawRange = (e, p) => e.radius + p.radius + R.clawReach;
const DURATION = {
  alert: R.alertMs,
  pounce: R.pounceCrouchMs + R.pounceLeapMs + R.pounceLandMs,
  claw: R.clawMs,
  step: R.stepMs,
};
const CLIP = { alert: 'Alert', pounce: 'Pounce', claw: 'Attack', step: 'Step' };

export function createSabertooth(collision, dynamic = [], now = Date.now()) {
  const position = collision.nearestFree(SABERTOOTH_GROUND, R.radius, dynamic.map(circle), 4);
  if (!position) throw new Error('No safe sabertooth spawn');
  return {
    id: SABERTOOTH_GROUND.id,
    modelKey: R.modelKey,
    name: R.name,
    hostile: true,
    ...position,
    home: { ...position },
    radius: R.radius,
    scale: R.scale,
    facing: Math.PI,
    health: R.maxHealth,
    maxHealth: R.maxHealth,
    alive: true,
    phase: 'alive',
    phaseStartedAt: now,
    clip: 'Idle_Loop',
    behavior: 'guard',
    targetId: null,
    returning: false,
    speed: 0,
    moving: false,
    running: false,
    runningRequested: false,
    dx: 0,
    dz: 0,
    lastInput: 0,
    path: [],
    target: null,
    nextPathAt: 0,
    roamRadius: SABERTOOTH_GROUND.roamRadius,
    roamIndex: 0,
    nextRoamAt: now + 2000,
    attackSequence: 0,
    attackAt: 0,
    attackLockUntil: 0,
    pendingAttack: null,
    hitSequence: 0,
    hitAt: 0,
    hitUntil: 0,
    hitDurationMs: R.hitDurationMs,
    aggroAfter: now + 1000,
    nextAttackAt: 0,
    nextPounceAt: 0,
    nextStepAt: 0,
    stepSide: 1,
    clawCount: 0,
    evading: false,
    superArmor: false,
  };
}

function clearFlags(e) {
  e.evading = false;
  e.superArmor = false;
}
function returnHome(e) {
  stopActor(e);
  clearFlags(e);
  e.targetId = null;
  e.pendingAttack = null;
  e.attackLockUntil = 0;
  e.returning = true;
  e.behavior = 'return';
  e.nextPathAt = 0;
}
function begin(e, kind, now, extra = {}) {
  stopActor(e);
  clearFlags(e);
  e.attackAt = now;
  e.attackSequence++;
  e.attackLockUntil = now + DURATION[kind];
  e.pendingAttack = { kind, facing: e.facing, hitIds: [], lastMoveAt: now, ...extra };
  e.clip = CLIP[kind];
  e.behavior = kind === 'pounce' ? 'crouch' : kind;
  if (kind === 'step') e.evading = true;
}
function finish(e, now, recovery) {
  stopActor(e);
  clearFlags(e);
  e.pendingAttack = null;
  e.attackLockUntil = 0;
  e.nextAttackAt = now + recovery;
  e.clip = 'Idle_Loop';
  e.behavior = 'recover';
}
// Straight, collision-checked travel in small steps so a fast body never tunnels.
function travel(e, room, heading, speed, seconds) {
  const dynamic = obstacles(room, e);
  let moved = 0,
    remaining = seconds;
  while (remaining > 1e-9) {
    const step = Math.min(0.025, remaining);
    remaining -= step;
    const d = speed * step;
    const next = room.collision.move(
      e,
      Math.sin(heading) * d,
      Math.cos(heading) * d,
      e.radius,
      dynamic,
    );
    if (distance(next, e.home) > R.territoryRadius) break;
    moved += distance(e, next);
    Object.assign(e, next);
  }
  e.speed = seconds > 0 ? moved / seconds : 0;
  return moved;
}
function move(e, room, goal, speed, dt, leash = true) {
  const d = distance(e, goal);
  if (d < 0.005 || dt <= 0) {
    e.moving = false;
    e.speed = 0;
    return;
  }
  const length = Math.min(d, speed * dt),
    dx = (goal.x - e.x) / d,
    dz = (goal.z - e.z) / d;
  const before = { x: e.x, z: e.z },
    steps = Math.max(1, Math.ceil(length / 0.15));
  const dynamic = obstacles(room, e);
  for (let i = 0; i < steps; i++) {
    const next = room.collision.move(
      e,
      (dx * length) / steps,
      (dz * length) / steps,
      e.radius,
      dynamic,
    );
    if (leash && distance(next, e.home) > R.territoryRadius) break;
    Object.assign(e, next);
  }
  e.speed = distance(before, e) / dt;
  e.moving = e.speed > 0.025;
  e.running = e.moving && speed > R.walkSpeed;
  if (e.moving) e.facing = Math.atan2(e.x - before.x, e.z - before.z);
}
function navigate(e, room, goal, speed, dt, now) {
  if (now >= e.nextPathAt || (!e.target && !e.path.length)) {
    e.path = room.collision.path(e, goal, e.radius);
    e.target = e.path.shift() ?? null;
    e.nextPathAt = now + 400;
  }
  if (e.target && distance(e, e.target) < 0.08) e.target = e.path.shift() ?? null;
  if (e.target) move(e, room, e.target, speed, dt, !e.returning);
  else {
    e.speed = 0;
    e.moving = false;
  }
  e.clip = e.moving ? (speed > R.walkSpeed ? 'Run_Loop' : 'Walk_Loop') : 'Idle_Loop';
}

// A strike the cat can see coming: a thrust or swing in windup aimed at it, or a
// light orb already flying toward its body.
function threat(room, e, now) {
  for (const p of room.players.values()) {
    const strike = p.pendingStrike;
    if (!strike || now >= strike.impactAt || p.downedUntil) continue;
    const magic = attackProfile(p).key === 'magic';
    if (distance(p, e) > (magic ? 9 : R.stepThreatRange)) continue;
    if (Math.abs(angleDifference(angleTo(p, e), strike.facing)) > Math.PI / 3) continue;
    if (Math.abs(angleDifference(angleTo(e, p), e.facing)) > R.visionHalfAngle) continue;
    return { x: p.x, z: p.z };
  }
  for (const orb of room.projectiles ?? []) {
    const rx = e.x - orb.x,
      rz = e.z - orb.z,
      along = rx * orb.dx + rz * orb.dz,
      lateral = Math.abs(rx * orb.dz - rz * orb.dx);
    if (along > 0 && along < R.stepProjectileRange && lateral < e.radius + 0.6)
      return { x: orb.x, z: orb.z };
  }
  return null;
}
// Side-step across the line of attack, alternating sides; back away if both sides are walled.
function beginStep(e, room, from, now, preferBack = false) {
  const away = angleTo(from, e);
  const options = preferBack
    ? [away, away + e.stepSide * 0.7, away - e.stepSide * 0.7]
    : [away + (e.stepSide * Math.PI) / 2, away - (e.stepSide * Math.PI) / 2, away];
  const heading =
    options.find((h) => {
      const end = {
        x: e.x + Math.sin(h) * R.stepDistance,
        z: e.z + Math.cos(h) * R.stepDistance,
      };
      return (
        distance(end, e.home) <= R.territoryRadius &&
        room.collision.free(end, e.radius, obstacles(room, e)) &&
        room.collision.segmentFree(e, end, e.radius * 0.5)
      );
    }) ?? options[options.length - 1];
  e.stepSide = -e.stepSide;
  e.facing = angleTo(e, from);
  begin(e, 'step', now, { heading, facing: e.facing });
  e.nextStepAt = now + R.stepCooldownMs;
}
function pounceGoal(e, target) {
  const lead = R.pounceLead;
  const goal = {
    x: target.x + (target.velocityX ?? 0) * lead,
    z: target.z + (target.velocityZ ?? 0) * lead,
  };
  const d = distance(e, goal);
  const reach = Math.max(R.pounceMinRange, Math.min(R.pounceMaxRange, d - e.radius * 0.5));
  return { facing: angleTo(e, goal), length: reach };
}

export function updateSabertooths(room, dt, now, damage) {
  let changed = false;
  for (const e of room.enemies ?? []) {
    if (e.modelKey !== R.modelKey) continue;
    if (e.phase === 'dead') {
      stopActor(e);
      clearFlags(e);
      e.pendingAttack = null;
      e.clip = 'Death';
      e.behavior = 'dead';
      if (now - e.phaseStartedAt >= R.deathMs) {
        e.phase = 'respawning';
        e.phaseStartedAt = now;
        e.clip = null;
        changed = true;
      }
      continue;
    }
    if (e.phase === 'respawning') {
      if (
        now - e.phaseStartedAt < R.respawnMs ||
        !room.collision.free(e.home, e.radius, obstacles(room, e))
      )
        continue;
      const fresh = createSabertooth(room.collision, [], now);
      Object.assign(fresh, e.home);
      fresh.home = { ...e.home };
      Object.assign(e, fresh);
      changed = true;
      continue;
    }
    let target = room.players.get(e.targetId);
    // Leash precedes every strike: players outside the territory are never hit.
    if (
      e.targetId &&
      (!eligible(room, e, target, now) || distance(e, e.home) > R.territoryRadius + 0.01)
    ) {
      returnHome(e);
      target = null;
      changed = true;
    }
    if (e.returning) {
      e.behavior = 'return';
      if (distance(e, e.home) < 0.08 && room.collision.free(e.home, e.radius, obstacles(room, e))) {
        Object.assign(e, e.home);
        stopActor(e);
        e.returning = false;
        e.facing = Math.PI;
        e.clip = 'Idle_Loop';
        e.behavior = 'guard';
        e.aggroAfter = now + 1200;
        e.nextRoamAt = now + 2000;
      } else navigate(e, room, e.home, R.walkSpeed, dt, now);
      continue;
    }
    if (now < e.hitUntil) {
      stopActor(e);
      clearFlags(e);
      e.pendingAttack = null;
      e.clip = 'Hit';
      e.behavior = 'hit';
      continue;
    }
    if (!target && now >= e.aggroAfter) {
      target = [...room.players.values()]
        .filter(
          (p) =>
            eligible(room, e, p, now) &&
            clear(room, e, p) &&
            (distance(e, p) <= R.hearingRange ||
              (distance(e, p) <= R.visionRange &&
                Math.abs(angleDifference(angleTo(e, p), e.facing)) <= R.visionHalfAngle)),
        )
        .sort((a, b) => distance(e, a) - distance(e, b))[0];
      if (target) {
        e.targetId = target.id;
        e.facing = angleTo(e, target);
        begin(e, 'alert', now);
        changed = true;
      }
    }
    if (!target) {
      e.behavior = 'guard';
      if (!e.target && !e.path.length && now >= e.nextRoamAt) {
        const angle = ++e.roamIndex * 2.39996;
        e.path = room.collision.path(
          e,
          {
            x: e.home.x + Math.sin(angle) * e.roamRadius,
            z: e.home.z + Math.cos(angle) * e.roamRadius,
          },
          e.radius,
        );
        e.target = e.path.shift() ?? null;
        e.nextRoamAt = now + 4500;
      }
      if (e.target && distance(e, e.target) < 0.08) e.target = e.path.shift() ?? null;
      if (e.target) move(e, room, e.target, R.walkSpeed, dt);
      else stopActor(e);
      e.clip = e.moving ? 'Walk_Loop' : 'Idle_Loop';
      continue;
    }
    const strike = e.pendingAttack;
    if (strike) {
      const elapsed = now - e.attackAt;
      const hit = (p, amount, label, ids = strike.hitIds) => {
        if (ids.includes(p.id) || !eligible(room, e, p, now) || !clear(room, e, p)) return;
        ids.push(p.id);
        damage(e, p, now, amount, label);
        changed = true;
      };
      if (strike.kind === 'alert') {
        e.clip = 'Alert';
        e.behavior = 'alert';
        e.facing = angleTo(e, target);
        if (elapsed >= R.alertMs) {
          finish(e, now, 0);
          e.behavior = 'chase';
        }
      } else if (strike.kind === 'step') {
        e.clip = 'Step';
        e.behavior = 'step';
        e.evading = true;
        const until = Math.min(now, e.attackAt + R.stepMs);
        const seconds = Math.max(0, until - strike.lastMoveAt) / 1000;
        strike.lastMoveAt = until;
        travel(e, room, strike.heading, R.stepDistance / (R.stepMs / 1000), seconds);
        e.facing = strike.facing;
        if (elapsed >= R.stepMs) {
          finish(e, now, 120);
          // The hop sets up the counter: a pounce is allowed straight away.
          e.nextPounceAt = Math.min(e.nextPounceAt, now);
        }
      } else if (strike.kind === 'claw') {
        e.clip = 'Attack';
        e.behavior = 'claw';
        strike.swings ??= R.clawImpactsMs.map(() => []);
        R.clawImpactsMs.forEach((at, i) => {
          if (elapsed < at - 120 && i === (strike.resolved ?? 0))
            e.facing = strike.facing = angleTo(e, target);
          if (elapsed < at || (strike.resolved ?? 0) > i) return;
          strike.resolved = i + 1;
          for (const p of room.players.values())
            if (
              distance(e, p) <= clawRange(e, p) &&
              Math.abs(angleDifference(angleTo(e, p), strike.facing)) <= R.clawHalfAngle
            )
              hit(p, R.clawDamage, i ? '爪の返し' : '爪', strike.swings[i]);
        });
        if (elapsed >= R.clawMs) {
          finish(e, now, R.clawRecoveryMs);
          // Hit and away: every other combo ends in a back-step.
          if (++e.clawCount % 2 === 0 && now >= e.nextStepAt) {
            beginStep(e, room, target, now, true);
            changed = true;
          }
        }
      } else {
        // Pounce.
        const crouchEnd = e.attackAt + R.pounceCrouchMs,
          leapEnd = crouchEnd + R.pounceLeapMs;
        if (now < crouchEnd) {
          e.clip = 'Pounce';
          e.behavior = 'crouch';
          Object.assign(strike, pounceGoal(e, target));
          e.facing = strike.facing;
          strike.lastMoveAt = crouchEnd;
        } else if (elapsed < R.pounceCrouchMs + R.pounceLeapMs + 100) {
          e.clip = 'Pounce';
          e.behavior = 'pounce';
          e.superArmor = now < leapEnd;
          const until = Math.min(now, leapEnd);
          const seconds = Math.min(Math.max(0, dt), Math.max(0, until - strike.lastMoveAt) / 1000);
          strike.lastMoveAt = until;
          travel(e, room, strike.facing, strike.length / (R.pounceLeapMs / 1000), seconds);
          e.facing = strike.facing;
          if (now >= crouchEnd + R.pounceLeapMs * 0.45)
            for (const p of room.players.values())
              if (distance(e, p) <= e.radius + p.radius + R.pounceReach)
                hit(p, R.pounceDamage, '飛びかかり');
        } else {
          // Landing: the opening to punish.
          e.clip = 'Pounce';
          e.behavior = 'land';
          e.superArmor = false;
          stopActor(e);
          if (elapsed >= DURATION.pounce) {
            finish(e, now, 0);
            e.nextPounceAt = now + R.pounceCooldownMs;
          }
        }
      }
      continue;
    }
    const danger = now >= e.nextStepAt ? threat(room, e, now) : null;
    if (danger) {
      beginStep(e, room, danger, now);
      changed = true;
      continue;
    }
    if (now < e.nextAttackAt) {
      stopActor(e);
      e.facing = angleTo(e, target);
      e.clip = 'Idle_Loop';
      e.behavior = 'recover';
      continue;
    }
    const d = distance(e, target),
      sight = clear(room, e, target);
    if (d <= clawRange(e, target) && sight) {
      e.facing = angleTo(e, target);
      begin(e, 'claw', now);
      changed = true;
    } else if (
      sight &&
      now >= e.nextPounceAt &&
      d >= R.pounceMinRange &&
      d <= R.pounceMaxRange + e.radius
    ) {
      e.facing = angleTo(e, target);
      begin(e, 'pounce', now, pounceGoal(e, target));
      changed = true;
    } else {
      e.behavior = 'chase';
      navigate(e, room, target, R.chaseSpeed, dt, now);
    }
  }
  return changed;
}
