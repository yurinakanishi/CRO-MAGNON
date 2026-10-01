// Broaden the existing summit behind the castle. The inhabited approach and
// all castle/cave coordinates stay fixed; only source terrain beyond z=248 moves.
export const MOUNTAIN_EXPANSION = Object.freeze({
  start: 248,
  end: 276,
  extra: 120,
  centreX: -75,
  width: 1.7,
});
function expansionWidth(z: number) {
  const { start, end, width } = MOUNTAIN_EXPANSION;
  const t = Math.max(0, Math.min(1, (z - start) / (end - start)));
  return 1 + (width - 1) * t * t * (3 - 2 * t);
}
export function expandedMountainX(sourceX: number, sourceZ: number) {
  return (
    MOUNTAIN_EXPANSION.centreX + (sourceX - MOUNTAIN_EXPANSION.centreX) * expansionWidth(sourceZ)
  );
}
export function sourceMountainX(worldX: number, sourceZ: number) {
  return (
    MOUNTAIN_EXPANSION.centreX + (worldX - MOUNTAIN_EXPANSION.centreX) / expansionWidth(sourceZ)
  );
}
export function expandedMountainZ(sourceZ: number) {
  const { start, end, extra } = MOUNTAIN_EXPANSION;
  if (sourceZ <= start) return sourceZ;
  if (sourceZ >= end) return sourceZ + extra;
  const t = (sourceZ - start) / (end - start);
  return sourceZ + extra * t * t * (3 - 2 * t);
}
export function sourceMountainZ(worldZ: number) {
  const { start, end, extra } = MOUNTAIN_EXPANSION;
  if (worldZ <= start) return worldZ;
  if (worldZ >= end + extra) return worldZ - extra;
  let lo: number = start,
    hi: number = end;
  let z = start + ((worldZ - start) * (end - start)) / (end + extra - start);
  for (let i = 0; i < 16; i++) {
    const error = expandedMountainZ(z) - worldZ;
    if (Math.abs(error) < 1e-9) return z;
    if (error > 0) hi = z;
    else lo = z;
    const t = (z - start) / (end - start);
    const next = z - error / (1 + (extra * 6 * t * (1 - t)) / (end - start));
    z = next > lo && next < hi ? next : (lo + hi) * 0.5;
  }
  return z;
}
