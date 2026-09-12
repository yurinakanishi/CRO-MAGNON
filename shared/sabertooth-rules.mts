// Sabre-toothed cat tuning. 2026-09-12: weakened at the user's request (less
// health and damage, slower chase so the great ape can outrun it, longer
// cooldowns) and every strike is announced: a Crouch clip before the pounce and
// a Snarl clip before the claw combo, both interruptible. It still side-steps
// attacks it sees coming; the pounce landing is its opening.
import { HEARING } from './perception.mjs';

export const SABERTOOTH = Object.freeze({
  modelKey: 'sabertooth-tiger',
  name: '剣牙の大虎',
  maxHealth: 220,
  scale: 1,
  radius: 0.8,
  walkSpeed: 1.5,
  // Humans (5.6) and the kunoichi (5.8) cannot outrun it; the great ape (6.4) can.
  chaseSpeed: 6.0,
  visionRange: 24,
  visionHalfAngle: (75 * Math.PI) / 180,
  // A cat hears footsteps all around it; running carries further, standing still less.
  hearing: HEARING,
  territoryRadius: 24,
  alertMs: 600,
  // Pounce: Crouch clip (interruptible telegraph), final dip, leap (super
  // armour), landing (opening).
  pounceWindupMs: 800,
  pounceCrouchMs: 200,
  pounceLeapMs: 600,
  pounceLandMs: 700,
  pounceMinRange: 3.5,
  pounceMaxRange: 9,
  pounceLead: 0.35,
  pounceReach: 0.35,
  pounceCooldownMs: 4500,
  pounceDamage: 20,
  // Snarl clip (interruptible telegraph), then the two-swipe claw combo.
  snarlMs: 700,
  clawMs: 1000,
  clawImpactsMs: Object.freeze([320, 620]),
  clawReach: 0.9,
  clawHalfAngle: (70 * Math.PI) / 180,
  clawDamage: 10,
  clawRecoveryMs: 900,
  // Quick evasive hop; the body cannot be struck while it lasts.
  stepMs: 350,
  stepDistance: 3.4,
  stepCooldownMs: 3200,
  stepThreatRange: 4.2,
  stepProjectileRange: 6,
  hitDurationMs: 200,
  deathMs: 1500,
  respawnMs: 90000,
});
// On the snow plain just south of the starting camp (85 m), east of the river
// that runs south through it: the nearest snow post whose pounce ground (14 m)
// stays dry, clear of the coast and outside the castle grounds. No warp fire
// lands inside its territory.
export const SABERTOOTH_GROUND = Object.freeze({
  id: 'sabertooth-tiger-1',
  modelKey: SABERTOOTH.modelKey,
  name: SABERTOOTH.name,
  x: 80,
  z: -30,
  radius: 4,
  roamRadius: 6,
});
export const SABERTOOTH_ONE_SHOTS = Object.freeze([
  'Attack',
  'Alert',
  'Crouch',
  'Pounce',
  'Snarl',
  'Step',
]);
