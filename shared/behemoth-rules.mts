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
