import { CAMP_CAVE, caveLocal } from './camp-cave-layout.mjs';
import { CAMP_CAVE_SURFACE } from './camp-cave-surface.mjs';
import { CAMP_CAVE_SURFACE_DATA } from './camp-cave-surface-data.mjs';

export const CAVE_TORCH = Object.freeze({ distance: 3.2, intensity: 9, decay: 2 });

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
