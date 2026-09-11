// Fictional creature tuning. Hind legs are vestigial; locomotion is forearm-driven.
// Rendered one size up from the delivered 6 m GLB; body radius and tail reach follow.
const SCALE = 1.25;
export const BEHEMOTH = Object.freeze({
  modelKey: 'violet-behemoth',
  name: '紫尾の巨獣',
  maxHealth: 300,
  scale: SCALE,
  radius: 2.1 * SCALE,
  walkSpeed: 1.35,
  chaseSpeed: 4.9,
  chargeSpeed: 5.15,
  visionRange: 23,
  visionHalfAngle: Math.PI / 2.5,
  territoryRadius: 26,
  alertMs: 700,
  chargeMs: 2400,
  recoveryMs: 650,
  biteMs: 1000,
  biteImpactMs: 500,
  biteReach: 0.15,
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
  x: 95,
  z: 110,
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
  pools: Object.freeze(
    [
      [84, 104, 5.5],
      [108, 118, 6.5],
      [88, 120, 4.5],
      [112, 102, 4],
      [78, 114, 3.5],
      [101, 91, 3],
    ].map(([x, z, radius]) => Object.freeze({ x, z, radius })),
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
