import { BEHEMOTH as R, BEHEMOTH_GROUND } from './behemoth-rules.mjs';
import { CAMP } from './world.mjs';
import { combatDistance as distance, enemyIsSolid, stopActor } from './combat.mjs';

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

export function createBehemoth(collision, dynamic = [], now = Date.now()) {
  const position = collision.nearestFree(BEHEMOTH_GROUND, R.radius, dynamic.map(circle), 3);
  if (!position) throw new Error('No safe violet behemoth spawn');
  return {
    id: BEHEMOTH_GROUND.id,
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
    roamRadius: 3,
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
    meleeIndex: 0,
  };
}

function returnHome(e) {
  stopActor(e);
  e.targetId = null;
  e.pendingAttack = null;
  e.attackLockUntil = 0;
  e.returning = true;
  e.behavior = 'return';
  e.nextPathAt = 0;
}
function begin(e, kind, now) {
  stopActor(e);
  e.attackAt = now;
  e.attackSequence++;
  const duration =
    kind === 'charge' ? R.alertMs + R.chargeMs : kind === 'bite' ? R.biteMs : R.spinMs;
  e.attackLockUntil = now + duration;
  e.pendingAttack = {
    kind,
    facing: e.facing,
    hitIds: [],
    lastSweep: 0,
    lastMoveAt: now + R.alertMs,
  };
  e.clip = kind === 'charge' ? 'Alert' : kind === 'bite' ? 'Attack' : 'TailSpin';
  e.behavior = kind === 'charge' ? 'alert' : kind;
}
function finish(e, now) {
  stopActor(e);
  e.pendingAttack = null;
  e.attackLockUntil = 0;
  e.nextAttackAt = now + R.recoveryMs;
  e.clip = 'Idle_Loop';
  e.behavior = 'recover';
}
function move(e, room, goal, speed, dt, leash = true) {
  const d = distance(e, goal);
  if (d < 0.005 || dt <= 0) {
    e.moving = false;
    e.speed = 0;
    return;
  }
  const travel = Math.min(d, speed * dt),
    dx = (goal.x - e.x) / d,
    dz = (goal.z - e.z) / d;
  const before = { x: e.x, z: e.z },
    steps = Math.max(1, Math.ceil(travel / 0.15));
  const dynamic = obstacles(room, e);
  for (let i = 0; i < steps; i++) {
    const next = room.collision.move(
      e,
      (dx * travel) / steps,
      (dz * travel) / steps,
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
    e.nextPathAt = now + 600;
  }
  if (e.target && distance(e, e.target) < 0.08) e.target = e.path.shift() ?? null;
  if (e.target) move(e, room, e.target, speed, dt, !e.returning);
  else {
    e.speed = 0;
    e.moving = false;
  }
  e.clip = e.moving ? (speed > R.walkSpeed ? 'Run_Loop' : 'Walk_Loop') : 'Idle_Loop';
}

export function updateBehemoths(room, dt, now, damage) {
  let changed = false;
  for (const e of room.enemies ?? []) {
    if (e.modelKey !== R.modelKey) continue;
    if (e.phase === 'dead') {
      stopActor(e);
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
      const fresh = createBehemoth(room.collision, [], now);
      Object.assign(fresh, e.home);
      fresh.home = { ...e.home };
      Object.assign(e, fresh);
      changed = true;
      continue;
    }
    let target = room.players.get(e.targetId);
    // Leash precedes windup, impact and hit recovery: outside players are never struck.
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
      } else navigate(e, room, e.home, R.walkSpeed, dt, now);
      continue;
    }
    if (now < e.hitUntil) {
      stopActor(e);
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
            distance(e, p) <= R.visionRange &&
            Math.abs(angleDifference(angleTo(e, p), e.facing)) <= R.visionHalfAngle &&
            clear(room, e, p),
        )
        .sort((a, b) => distance(e, a) - distance(e, b))[0];
      if (target) {
        e.targetId = target.id;
        e.facing = angleTo(e, target);
        begin(e, 'charge', now);
        changed = true;
      }
    }
    if (!target) {
      stopActor(e);
      e.clip = 'Idle_Loop';
      e.behavior = 'guard';
      continue;
    }
    const strike = e.pendingAttack;
    if (strike) {
      const elapsed = now - e.attackAt;
      const hit = (p, amount, label) => {
        if (strike.hitIds.includes(p.id) || !eligible(room, e, p, now) || !clear(room, e, p))
          return;
        strike.hitIds.push(p.id);
        damage(e, p, now, amount, label);
        changed = true;
      };
      if (strike.kind === 'charge') {
        if (elapsed < R.alertMs) {
          e.clip = 'Alert';
          e.behavior = 'alert';
          continue;
        }
        e.clip = 'Charge';
        e.behavior = 'charge';
        // Fixed heading, small collision steps, and bounded elapsed time prevent tunneling.
        const activeUntil = Math.min(now, e.attackAt + R.alertMs + R.chargeMs);
        const seconds = Math.min(
          Math.max(0, dt),
          Math.max(0, activeUntil - strike.lastMoveAt) / 1000,
        );
        strike.lastMoveAt = activeUntil;
        let remaining = seconds;
        while (remaining > 1e-9) {
          const step = Math.min(0.025, remaining);
          remaining -= step;
          move(
            e,
            room,
            { x: e.x + Math.sin(strike.facing) * 10, z: e.z + Math.cos(strike.facing) * 10 },
            R.chargeSpeed,
            step,
          );
          e.facing = strike.facing;
          for (const p of room.players.values())
            if (
              distance(e, p) <= e.radius + p.radius + 0.15 &&
              Math.abs(angleDifference(angleTo(e, p), strike.facing)) < Math.PI / 2
            )
              hit(p, R.chargeDamage, '突進');
        }
        if (elapsed >= R.alertMs + R.chargeMs || (seconds > 0 && e.speed < 0.05)) finish(e, now);
      } else if (strike.kind === 'bite') {
        e.clip = 'Attack';
        e.behavior = 'bite';
        if (elapsed >= R.biteImpactMs && !strike.resolved) {
          strike.resolved = true;
          if (
            distance(e, target) <= e.radius + target.radius + R.biteReach &&
            Math.abs(angleDifference(angleTo(e, target), strike.facing)) < Math.PI / 3
          )
            hit(target, R.biteDamage, '噛みつき');
        }
        if (elapsed >= R.biteMs) finish(e, now);
      } else {
        e.clip = 'TailSpin';
        e.behavior = 'tail';
        const sweep =
          Math.max(0, Math.min(1, (elapsed - R.spinWindupMs) / R.spinSweepMs)) * Math.PI * 2;
        if (sweep > strike.lastSweep) {
          for (const p of room.players.values()) {
            const a = (angleTo(e, p) - strike.facing - Math.PI + Math.PI * 4) % (Math.PI * 2);
            // Sweep starts behind the body. The tail itself rotates in the animation.
            if (
              distance(e, p) <= R.tailReach + p.radius &&
              ((a >= strike.lastSweep - 0.16 && a <= sweep + 0.16) ||
                (sweep + 0.16 >= Math.PI * 2 && a < 0.16))
            )
              hit(p, R.tailDamage, '尾の回転攻撃');
          }
          strike.lastSweep = sweep;
        }
        if (elapsed >= R.spinMs) finish(e, now);
      }
      continue;
    }
    if (now < e.nextAttackAt) {
      stopActor(e);
      e.clip = 'Idle_Loop';
      e.behavior = 'recover';
      continue;
    }
    if (distance(e, target) <= R.tailReach + target.radius && clear(room, e, target)) {
      const rear = Math.abs(angleDifference(angleTo(e, target), e.facing)) > Math.PI / 2;
      const kind = rear || ++e.meleeIndex % 2 === 0 ? 'tail' : 'bite';
      if (kind === 'bite' && distance(e, target) > e.radius + target.radius + R.biteReach) {
        e.behavior = 'chase';
        navigate(e, room, target, R.chaseSpeed, dt, now);
      } else {
        if (kind === 'bite') e.facing = angleTo(e, target);
        begin(e, kind, now);
        changed = true;
      }
    } else {
      e.facing = angleTo(e, target);
      if (clear(room, e, target)) {
        begin(e, 'charge', now);
        changed = true;
      } else {
        e.behavior = 'chase';
        navigate(e, room, target, R.chaseSpeed, dt, now);
      }
    }
  }
  return changed;
}
