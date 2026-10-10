import { caveCentreOffset } from './camp-cave-layout.mjs';

/** The shallow basin sculpted into the existing TRELLIS shell in model-r27. */
export const CAVE_SPRING = Object.freeze({
  x: caveCentreOffset(-33),
  z: -33,
  radiusX: 3.45,
  radiusZ: 3.05,
  waterY: 1.0,
  bottomY: 0.25,
});

// The same irregular shoreline is used by the source-mesh refinement and water.
export function caveSpringEdge(angle: number) {
  return 1 + 0.055 * Math.sin(angle * 3 + 0.4) + 0.03 * Math.sin(angle * 5 - 0.8);
}

export function caveSpringRadius(x: number, z: number) {
  const u = (x - CAVE_SPRING.x) / CAVE_SPRING.radiusX;
  const v = (z - CAVE_SPRING.z) / CAVE_SPRING.radiusZ;
  return Math.hypot(u, v) / caveSpringEdge(Math.atan2(v, u));
}
