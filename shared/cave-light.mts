import { CAMP_CAVE, caveLocal } from './camp-cave-layout.mjs';
import { CAMP_CAVE_SURFACE } from './camp-cave-surface.mjs';
import { CAMP_CAVE_SURFACE_DATA } from './camp-cave-surface-data.mjs';

// Shared by the waiting gallery and the live world, including fog and stone shading.
export const CAVE_LIGHT = Object.freeze({
  sky: '#c0ccd2',
  ground: '#b8b6aa',
  sun: '#e4e9df',
  sunDirection: [-45, 47, -32] as const,
  background: '#1b2328',
  // Soft, neutral bounce reaches faces and the underside of brows even with the torch off.
  hemisphere: 3,
  directional: 0.22,
  // Keep the chamber dim while giving characters enough diffuse fill.
  stoneDaylight: 0.18,
  fogNear: 12,
  fogFar: 55,
});
// A bounded warm accent: inverse-square falloff burned out skin/hair close to the flame,
// especially on small characters. The distance cutoff still fades it smoothly to zero.
export const CAVE_TORCH = Object.freeze({ distance: 4, intensity: 2.5, decay: 0 });

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
