// Sabre-toothed cat tuning. Faster than every playable sprint (great ape 5.4 m/s),
// so the territory edge is the only way to shake it off. It side-steps attacks
// it sees coming and pounces from mid range; the landing is its opening.
export const SABERTOOTH = Object.freeze({
  modelKey: 'sabertooth-tiger',
  name: '剣牙の大虎',
  maxHealth: 340,
  scale: 1,
  radius: 0.8,
  walkSpeed: 1.5,
  chaseSpeed: 6.2,
  visionRange: 24,
  visionHalfAngle: (75 * Math.PI) / 180,
  // A cat hears footsteps right behind it.
  hearingRange: 7,
  territoryRadius: 24,
  alertMs: 600,
  // Pounce: crouch (interruptible), leap (super armour), landing (opening).
  pounceCrouchMs: 450,
  pounceLeapMs: 600,
  pounceLandMs: 500,
  pounceMinRange: 3.5,
  pounceMaxRange: 10,
  pounceLead: 0.35,
  pounceReach: 0.35,
  pounceCooldownMs: 2600,
  pounceDamage: 30,
  // Two-swipe claw combo.
  clawMs: 1000,
  clawImpactsMs: Object.freeze([320, 620]),
  clawReach: 0.9,
  clawHalfAngle: (70 * Math.PI) / 180,
  clawDamage: 16,
  clawRecoveryMs: 350,
  // Quick evasive hop; the body cannot be struck while it lasts.
  stepMs: 350,
  stepDistance: 3.4,
  stepCooldownMs: 1800,
  stepThreatRange: 4.2,
  stepProjectileRange: 6,
  hitDurationMs: 200,
  deathMs: 1500,
  respawnMs: 90000,
});
// North of the Siberian snow-plain fire, far enough that arriving by warp is safe.
export const SABERTOOTH_GROUND = Object.freeze({
  id: 'sabertooth-tiger-1',
  modelKey: SABERTOOTH.modelKey,
  name: SABERTOOTH.name,
  x: 493,
  z: -19,
  radius: 4,
  roamRadius: 6,
});
export const SABERTOOTH_ONE_SHOTS = Object.freeze(['Attack', 'Alert', 'Pounce', 'Step']);
