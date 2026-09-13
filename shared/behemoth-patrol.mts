import { BEHEMOTH as R } from './behemoth-rules.mjs';
import { combatDistance as distance, stopActor } from './combat.mjs';

const difference = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const noise = (n) => {
  const value = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return value - Math.floor(value);
};

export function resetBehemothPatrol(e, pauseUntil = 0) {
  e.patrolGoal = null;
  e.patrolPauseUntil = pauseUntil;
  e.patrolBlockedMs = 0;
}

// Short, unobstructed walks with broad turns. The inset keeps the whole collision
// body inside its territory, including while rounding a corner toward a new goal.
export function patrolBehemoth(e, room, dt, now, dynamic) {
  const radius = R.territoryRadius - e.radius - 1;
  if (now < (e.patrolPauseUntil ?? 0)) {
    stopActor(e);
    e.clip = 'Idle_Loop';
    e.behavior = 'guard';
    return;
  }
  if (!e.patrolGoal) {
    e.patrolStep = (e.patrolStep ?? 0) + 1;
    for (let i = 0; i < 18; i++) {
      const seed = e.patrolStep * 23 + i;
      const angle =
        i < 6
          ? e.facing + (noise(seed) * 2 - 1) * 0.95
          : Math.atan2(e.home.x - e.x, e.home.z - e.z) + (i - 6) * 2.399963;
      const length = 7 + noise(seed + 91) * 6;
      const goal = { x: e.x + Math.sin(angle) * length, z: e.z + Math.cos(angle) * length };
      if (distance(goal, e.home) > radius) continue;
      if (!room.collision.segmentFree(e, goal, e.radius, dynamic)) continue;
      e.patrolGoal = goal;
      e.patrolBlockedMs = 0;
      break;
    }
    if (!e.patrolGoal) {
      // A temporary crowd must not leave the creature permanently frozen, or
      // trigger expensive navigation searches every simulation tick.
      resetBehemothPatrol(e, now + 1000);
      stopActor(e);
      e.clip = 'Idle_Loop';
      e.behavior = 'guard';
      return;
    }
  }
  const remaining = distance(e, e.patrolGoal);
  if (remaining < 0.65) {
    resetBehemothPatrol(e, now + 1500 + noise(e.patrolStep + 53) * 1800);
    stopActor(e);
    e.clip = 'Idle_Loop';
    e.behavior = 'guard';
    return;
  }
  const seconds = Math.max(0, dt);
  const turn = difference(Math.atan2(e.patrolGoal.x - e.x, e.patrolGoal.z - e.z), e.facing);
  e.facing += Math.max(-0.7 * seconds, Math.min(0.7 * seconds, turn));
  const desired =
    Math.min(1.05, Math.sqrt(1.2 * Math.max(0, remaining - 0.5))) *
    (0.2 + 0.8 * Math.max(0, Math.cos(turn)));
  const speed = Math.max(0, Math.min(desired, e.speed + 0.6 * seconds));
  const from = { x: e.x, z: e.z };
  const travel = speed * seconds;
  const steps = Math.max(1, Math.ceil(travel / 0.12));
  for (let i = 0; i < steps; i++) {
    const next = room.collision.move(
      e,
      (Math.sin(e.facing) * travel) / steps,
      (Math.cos(e.facing) * travel) / steps,
      e.radius,
      dynamic,
    );
    // A chase may finish outside the patrol inset. Allow only inward progress
    // there; never let idle wandering carry the body farther beyond it.
    if (distance(next, e.home) > Math.max(radius, distance(e, e.home)) + 1e-6) break;
    Object.assign(e, next);
  }
  e.speed = seconds > 0 ? distance(from, e) / seconds : 0;
  e.moving = e.speed > 0.025;
  e.running = false;
  e.clip = e.moving ? 'Walk_Loop' : 'Idle_Loop';
  e.behavior = e.moving ? 'patrol' : 'guard';
  e.patrolBlockedMs = e.moving ? 0 : (e.patrolBlockedMs ?? 0) + seconds * 1000;
  if (e.patrolBlockedMs > 1500) resetBehemothPatrol(e, now + 500);
}
