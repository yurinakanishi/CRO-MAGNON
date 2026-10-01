import { CAMP_MOUNTAIN } from './camp-cave-layout.mjs';
import { CAMP_MOUNTAIN_SURFACE_DATA as D } from './camp-mountain-surface-data.mjs';
import {
  expandedMountainZ,
  expandedMountainX,
  sourceMountainZ,
  sourceMountainX,
  MOUNTAIN_EXPANSION,
} from './mountain-expansion.mjs';
export function mountainHeight(x: number, z: number) {
  z = sourceMountainZ(z);
  x = sourceMountainX(x, z);
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
// Transform the measured source boundary along with the visual mesh. Subdivide
// only edges crossing the nonlinear expansion; the resulting polygon need not
// be convex, so signed distance uses crossings instead of convex half-planes.
const footprint: { x: number; z: number }[] = [];
for (let i = 0; i < D.footprint.length; i++) {
  const a = D.footprint[i],
    b = D.footprint[(i + 1) % D.footprint.length];
  const za = CAMP_MOUNTAIN.z - a[1],
    zb = CAMP_MOUNTAIN.z - b[1];
  const curved =
    Math.max(za, zb) > MOUNTAIN_EXPANSION.start && Math.min(za, zb) < MOUNTAIN_EXPANSION.end;
  const count = curved ? Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 2)) : 1;
  for (let j = 0; j < count; j++) {
    const t = j / count;
    footprint.push({
      x: expandedMountainX(CAMP_MOUNTAIN.x - a[0] - (b[0] - a[0]) * t, za + (zb - za) * t),
      z: expandedMountainZ(za + (zb - za) * t),
    });
  }
}
export const MOUNTAIN_FOOTPRINT = Object.freeze(footprint);
export const MOUNTAIN_BOUNDS = Object.freeze({
  minX: Math.min(...footprint.map((p) => p.x)),
  maxX: Math.max(...footprint.map((p) => p.x)),
  minZ: Math.min(...footprint.map((p) => p.z)),
  maxZ: Math.max(...footprint.map((p) => p.z)),
});
export function mountainLandDistance(x: number, z: number) {
  let squared = Infinity,
    inside = false;
  for (let i = 0; i < footprint.length; i++) {
    const a = footprint[i],
      b = footprint[(i + 1) % footprint.length];
    const dx = b.x - a.x,
      dz = b.z - a.z;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz)));
    squared = Math.min(squared, (x - a.x - dx * t) ** 2 + (z - a.z - dz * t) ** 2);
    if (a.z > z !== b.z > z && x < a.x + ((z - a.z) * dx) / dz) inside = !inside;
  }
  return Math.sqrt(squared) * (inside ? 1 : -1);
}
