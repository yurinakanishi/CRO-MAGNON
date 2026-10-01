// A basin in the middle of the enlarged summit, well inside every hillside.
// The same irregular shore drives water, the source-mesh fit and gameplay.
export const MOUNTAIN_LAKE = Object.freeze({
  x: -75,
  z: 320,
  y: 34.1,
  radiusX: 28,
  radiusZ: 18,
  depth: 1.25,
  bank: 4,
});
export const LAKE_SHORE_HARMONICS = Object.freeze([
  Object.freeze({ amplitude: 0.065, frequency: 3, phase: 0.7 }),
  Object.freeze({ amplitude: 0.035, frequency: 5, phase: -1.1 }),
  Object.freeze({ amplitude: 0.045, frequency: 2, phase: Math.PI / 2 }),
  Object.freeze({ amplitude: 0.022, frequency: 9, phase: 1.6 }),
]);
const maxRadius = 1 + LAKE_SHORE_HARMONICS.reduce((sum, h) => sum + h.amplitude, 0);
const boundX = MOUNTAIN_LAKE.radiusX * maxRadius + MOUNTAIN_LAKE.bank;
const boundZ = MOUNTAIN_LAKE.radiusZ * maxRadius + MOUNTAIN_LAKE.bank;
export function mountainLakeShape(angle: number) {
  return (
    1 +
    LAKE_SHORE_HARMONICS.reduce(
      (sum, h) => sum + h.amplitude * Math.sin(angle * h.frequency + h.phase),
      0,
    )
  );
}
export function mountainLakePoint(angle: number, radius = 1) {
  const r = mountainLakeShape(angle) * radius;
  return {
    x: MOUNTAIN_LAKE.x + Math.cos(angle) * MOUNTAIN_LAKE.radiusX * r,
    z: MOUNTAIN_LAKE.z + Math.sin(angle) * MOUNTAIN_LAKE.radiusZ * r,
    y: MOUNTAIN_LAKE.y,
  };
}
// Signed distance along the radial section; negative values are in the lake.
export function mountainLakeAt(x: number, z: number) {
  const dx = x - MOUNTAIN_LAKE.x,
    dz = z - MOUNTAIN_LAKE.z;
  if (Math.abs(dx) > boundX || Math.abs(dz) > boundZ) return null;
  const u = dx / MOUNTAIN_LAKE.radiusX,
    v = dz / MOUNTAIN_LAKE.radiusZ;
  const angle = Math.atan2(v, u);
  const scale = Math.hypot(
    Math.cos(angle) * MOUNTAIN_LAKE.radiusX,
    Math.sin(angle) * MOUNTAIN_LAKE.radiusZ,
  );
  return { y: MOUNTAIN_LAKE.y, shore: (Math.hypot(u, v) - mountainLakeShape(angle)) * scale };
}
export function mountainLakeBed(x: number, z: number, originalY: number) {
  const lake = mountainLakeAt(x, z);
  if (!lake || lake.shore >= MOUNTAIN_LAKE.bank) return originalY;
  const d = lake.shore;
  // A shallow shelf meets the waterline, then slopes into a rounded basin.
  // Outside the shore, the existing hill is recovered without a retaining lip.
  const basin =
    MOUNTAIN_LAKE.y - 0.06 + (d < 0 ? -MOUNTAIN_LAKE.depth * (1 - Math.exp(d / 3.8)) : d * 0.32);
  const t = Math.max(0, d / MOUNTAIN_LAKE.bank);
  const feather = t * t * (3 - 2 * t);
  return Math.min(originalY, basin * (1 - feather) + originalY * feather);
}
export function mountainLakeIntersects(minX: number, maxX: number, minZ: number, maxZ: number) {
  return (
    maxX >= MOUNTAIN_LAKE.x - boundX &&
    minX <= MOUNTAIN_LAKE.x + boundX &&
    maxZ >= MOUNTAIN_LAKE.z - boundZ &&
    minZ <= MOUNTAIN_LAKE.z + boundZ
  );
}
