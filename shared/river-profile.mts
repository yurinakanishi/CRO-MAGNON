// Dependency-free river profile, also used by the terrain construction worker.
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const smooth = (t: number) => ((t = clamp(t, 0, 1)), t * t * (3 - 2 * t));
// A broad bend leaves room for the mountain's cave foothill. The camp bridge
// and the northern river stay fixed; the lower tributary shares this offset.
export const riverDiversion = (z: number) =>
  18 * smooth((z - 58) / 38) * (1 - smooth((z - 120) / 62)) +
  14 * smooth((z - 98) / 22) * (1 - smooth((z - 125) / 50));
export const riverX = (z: number) => 65 + Math.sin(z * 0.065) * 3.5 + riverDiversion(z);
export const RIVER_BOUNDS = Object.freeze({ minX: 57, maxX: 110, minZ: -64, maxZ: 184 });
export const riverFade = (z: number) => smooth((z + 64) / 24) * smooth((184 - z) / 24);
export const riverHalfWidth = (z: number) => 3.05 * riverFade(z);
export const riverBankDrop = (x: number, z: number) =>
  clamp((3.8 * riverFade(z) - Math.abs(x - riverX(z))) / 1.25, 0, 1) * 0.72;
