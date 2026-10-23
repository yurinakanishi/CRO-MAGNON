import { CAMP_CAVE, caveCentreOffset, caveLocal } from './camp-cave-layout.mjs';
import { CAMP_CAVE_SURFACE } from './camp-cave-surface.mjs';
import { CAMP_CAVE_SURFACE_DATA } from './camp-cave-surface-data.mjs';

// Shared by the waiting gallery and the live world, including fog and stone shading.
export const CAVE_LIGHT = Object.freeze({
  sky: '#c0ccd2',
  ground: '#69675c',
  sun: '#e4e9df',
  sunDirection: [-45, 47, -32] as const,
  background: '#1b2328',
  // A small lift to the diffuse fill keeps the stone readable without a stronger torch hotspot.
  // Characters and creatures are lit by the daylight outside instead (src/actor-daylight.ts).
  hemisphere: 1.4,
  directional: 0.22,
  stoneDaylight: 0.5,
  fogNear: 12,
  fogFar: 55,
});
export const CAVE_TORCH = Object.freeze({ distance: 5, intensity: 12, decay: 2 });

/** Where the cave's own lights burn (held torches, the hearth), in cave-local metres: every
 * place a torch can be lit (local Z 10.5 to -49.5, 9 m across, roofs up to 9.3 m) with room for
 * the flame above a tall traveler's hand. No outdoor fire is near it (the camp's is 33 m away).
 * A light inside never lights a character or creature (src/actor-daylight.ts). */
export const CAVE_LIGHT_VOLUME = Object.freeze({ mouth: 12, end: -56, across: 11, ceiling: 12 });

export function insideCaveLightVolume(p: { x: number; y: number; z: number }) {
  const local = caveLocal(p.x, p.z);
  return (
    local.z < CAVE_LIGHT_VOLUME.mouth &&
    local.z > CAVE_LIGHT_VOLUME.end &&
    Math.abs(local.x - caveCentreOffset(local.z)) < CAVE_LIGHT_VOLUME.across &&
    p.y < CAMP_CAVE.elevation + CAVE_LIGHT_VOLUME.ceiling
  );
}

/** Measured roof/floor exclude the open apron and the mountain above the cave. */
export function caveInteriorWeight(p: { x: number; z: number; y?: number }) {
  const local = caveLocal(p.x, p.z);
  if (local.z >= 11) return 0;
  const cell = CAMP_CAVE_SURFACE.cell(p.x, p.z);
  const floor = CAMP_CAVE_SURFACE.height(p.x, p.z);
  if (!cell || !Number.isFinite(floor)) return 0;
  const roof = CAMP_CAVE_SURFACE_DATA.roofs[cell.index];
  if (!Number.isFinite(roof) || roof - floor < 2) return 0;
  if (
    p.y !== undefined &&
    (p.y > CAMP_CAVE.elevation + roof - 0.2 || p.y < CAMP_CAVE.elevation + floor - 1)
  )
    return 0;
  const t = Math.max(0, Math.min(1, (11 - local.z) / 10));
  return t * t * (3 - 2 * t);
}

export function caveTorchAvailable(p) {
  return (
    !!p &&
    !p.downedUntil &&
    !p.mountId &&
    !p.boatId &&
    !p.carrierId &&
    !p.passengerId &&
    caveInteriorWeight(p) > 0
  );
}

export function caveTorchLit(p) {
  return caveTorchAvailable(p) && !p.caveTorchOff;
}

export function toggleCaveTorch(p) {
  if (!caveTorchAvailable(p)) return false;
  p.caveTorchOff = !p.caveTorchOff;
  return true;
}
