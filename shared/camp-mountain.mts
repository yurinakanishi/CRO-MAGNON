import { CAMP_MOUNTAIN } from './camp-cave-layout.mjs';
import { CAMP_MOUNTAIN_SURFACE_DATA as D } from './camp-mountain-surface-data.mjs';
export function mountainHeight(x: number, z: number) {
  const u = (CAMP_MOUNTAIN.x - x - D.minX) / D.step - 0.5;
  const v = (CAMP_MOUNTAIN.z - z - D.minZ) / D.step - 0.5;
  const ix = Math.floor(u),
    iz = Math.floor(v),
    fx = u - ix,
    fz = v - iz;
  if (ix < 0 || iz < 0 || ix + 1 >= D.nx || iz + 1 >= D.nz) return 0;
  const i = iz * D.nx + ix,
    h = D.heights;
  return (
    (h[i] * (1 - fx) + h[i + 1] * fx) * (1 - fz) +
    (h[i + D.nx] * (1 - fx) + h[i + D.nx + 1] * fx) * fz
  );
}
// Distance inside the measured convex footprint, shared by coast and physics.
export function mountainLandDistance(x: number, z: number) {
  const p = [CAMP_MOUNTAIN.x - x, CAMP_MOUNTAIN.z - z];
  let distance = Infinity;
  for (let i = 0; i < D.footprint.length; i++) {
    const a = D.footprint[i],
      b = D.footprint[(i + 1) % D.footprint.length];
    const dx = b[0] - a[0],
      dz = b[1] - a[1];
    distance = Math.min(distance, (dx * (p[1] - a[1]) - dz * (p[0] - a[0])) / Math.hypot(dx, dz));
  }
  return distance;
}
