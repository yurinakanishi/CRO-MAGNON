// Fictional creature tuning. Hind legs are vestigial; locomotion is forearm-driven.
// Rendered at 2.5x the delivered 6 m GLB (2026-09-12: the user asked for twice the
// previous 1.25 size); body radius and tail reach follow the scale.
import { HEARING } from './perception.mjs';

const SCALE = 2.5;
export const BEHEMOTH = Object.freeze({
  modelKey: 'violet-behemoth',
  name: '紫尾の巨獣',
  maxHealth: 300,
  scale: SCALE,
  radius: 2.1 * SCALE,
  walkSpeed: 1.35,
  // Only the great ape (6.4) and the kunoichi (5.8) outrun it; humans (5.6) cannot.
  chaseSpeed: 5.7,
  chargeSpeed: 6.0,
  visionRange: 23,
  visionHalfAngle: Math.PI / 2.5,
  // Footsteps behind it are heard, running further than walking.
  hearing: HEARING,
  territoryRadius: 30,
  alertMs: 700,
  // Every strike is announced by its own clip: Roar before the charge, Gape
  // before the bite, Tremble before the tail spin. The strike clip follows.
  roarMs: 1200,
  chargeMs: 2400,
  recoveryMs: 900,
  gapeMs: 600,
  biteMs: 1000,
  biteImpactMs: 500,
  biteReach: 0.3,
  trembleMs: 900,
  spinMs: 1500,
  spinWindupMs: 450,
  spinSweepMs: 850,
  tailReach: 4.35 * SCALE,
  chargeDamage: 25,
  biteDamage: 22,
  tailDamage: 20,
  hitDurationMs: 300,
  deathMs: 1600,
  respawnMs: 60000,
});
export const BEHEMOTH_GROUND = Object.freeze({
  id: 'violet-behemoth-1',
  modelKey: BEHEMOTH.modelKey,
  name: BEHEMOTH.name,
  // 2026-09-12: moved to the meadow west-south-west of the starting fire (50, 50),
  // 78 m away, so the three territorial creatures stand around the camp
  // (sabertooth north, crow shaman east at the castle gate, behemoth west).
  // The 40 m marsh footprint is dry land here; the shore lies just beyond it.
  x: -25,
  z: 70,
  radius: 32,
  roamRadius: 3,
});
export const inBehemothClearing = (x, z, margin = 0) =>
  Math.hypot(x - BEHEMOTH_GROUND.x, z - BEHEMOTH_GROUND.z) < BEHEMOTH_GROUND.radius + margin;

// The territory is a low marsh: a shallow basin with ankle-deep, tea-coloured
// pools lying on its floor. Server and client walk the same floor, so the drop
// is defined here and applied by terrain.mts; the client lowers and tints the
// drawn ground to match and floats each pool sheet just above the floor. The
// reconstructed ground tiles are too coarse to carve individual bowls, so pools
// are sheets on the flat floor, not depressions. Pools stay clear of the guard
// post and are wadeable, like the river.
export const BEHEMOTH_MARSH = Object.freeze({
  x: BEHEMOTH_GROUND.x,
  z: BEHEMOTH_GROUND.z,
  radius: BEHEMOTH_GROUND.radius,
  edge: 8,
  basinDepth: 0.22,
  waterLift: 0.06,
  // Pools are placed relative to the guard post so the marsh moves with it.
  pools: Object.freeze(
    [
      [-11, -6, 5.5],
      [13, 8, 6.5],
      [-7, 10, 4.5],
      [17, -8, 4],
      [-17, 4, 3.5],
      [6, -19, 3],
    ].map(([dx, dz, radius]) =>
      Object.freeze({ x: BEHEMOTH_GROUND.x + dx, z: BEHEMOTH_GROUND.z + dz, radius }),
    ),
  ),
});
const ease = (t) => {
  t = Math.max(0, Math.min(1, t));
  return t * t * (3 - 2 * t);
};
export const marshBasin = (x, z) =>
  ease(
    (BEHEMOTH_MARSH.radius - Math.hypot(x - BEHEMOTH_MARSH.x, z - BEHEMOTH_MARSH.z)) /
      BEHEMOTH_MARSH.edge,
  );
export const marshPoolFill = (x, z) => {
  let fill = 0;
  for (const pool of BEHEMOTH_MARSH.pools) {
    const d = Math.hypot(x - pool.x, z - pool.z);
    if (d < pool.radius) fill = Math.max(fill, ease((pool.radius - d) / (pool.radius * 0.55)));
  }
  return fill;
};
export const marshDrop = (x, z) => BEHEMOTH_MARSH.basinDepth * marshBasin(x, z);
export const inBehemothPool = (x, z, margin = 0) =>
  BEHEMOTH_MARSH.pools.some((pool) => Math.hypot(x - pool.x, z - pool.z) < pool.radius + margin);
