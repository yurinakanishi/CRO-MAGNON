import { caveCentreOffset } from './camp-cave-layout.mjs';

const BASIN = { radiusX: 3.45, radiusZ: 3.05, waterY: 1.0, bottomY: 0.25 };
/** The shallow basin as model-r27 sculpted it into the existing TRELLIS shell
 * (assets/camp-cave/workflow/refine-spring.mjs). */
export const CAVE_SPRING_R27 = Object.freeze({ x: caveCentreOffset(-33), z: -33, ...BASIN });
/** model-r28-deep carried the rear chamber and its basin 7.9 m deeper along the bend
 * (assets/camp-cave/workflow/deepen-gallery.mjs). */
export const CAVE_SPRING = Object.freeze({ x: caveCentreOffset(-40.9), z: -40.9, ...BASIN });

// The same irregular shoreline is used by the source-mesh refinement and water.
export function caveSpringEdge(angle: number) {
  return 1 + 0.055 * Math.sin(angle * 3 + 0.4) + 0.03 * Math.sin(angle * 5 - 0.8);
}

export function caveSpringRadius(x: number, z: number, spring = CAVE_SPRING) {
  const u = (x - spring.x) / spring.radiusX;
  const v = (z - spring.z) / spring.radiusZ;
  return Math.hypot(u, v) / caveSpringEdge(Math.atan2(v, u));
}
