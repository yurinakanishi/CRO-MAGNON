import { MODEL_BOUNDS } from './model-bounds.mjs';

/** A gathered unit is one complete, fixed-size stone from the verified boulder asset. */
export const STONE_PIECE_SCALE = 0.22;

/** Supporting stones come first, so collection removes the top of the pile first. */
export function stonePileLayout(total: number) {
  const count = Math.max(0, Math.floor(total));
  const bounds = MODEL_BOUNDS['valley-boulder'];
  const width = (bounds.max[0] - bounds.min[0]) * STONE_PIECE_SCALE;
  const height = (bounds.max[1] - bounds.min[1]) * STONE_PIECE_SCALE;
  const bottom = Math.ceil((Math.sqrt(8 * count + 1) - 1) / 2);
  const slots: Array<{ x: number; y: number; z: number; yaw: number; scale: number }> = [];
  for (let row = 0; slots.length < count; row++) {
    const columns = Math.min(bottom - row, count - slots.length);
    for (let column = 0; column < columns; column++) {
      slots.push({
        x: (column - (bottom - row - 1) / 2) * width * 0.88,
        y: row * height * 0.7 - bounds.min[1] * STONE_PIECE_SCALE,
        z: 0,
        yaw: row % 2 ? Math.PI : 0,
        scale: STONE_PIECE_SCALE,
      });
    }
  }
  return slots;
}

/** Client meshes and server collision use the same assembled footprint. */
export function stonePileBounds(total: number) {
  const source = MODEL_BOUNDS['valley-boulder'];
  const slots = stonePileLayout(total);
  if (!slots.length) return { min: [0, 0, 0], max: [0, 0, 0] };
  const lows = slots.map((p) => [
    p.x + (p.yaw ? -source.max[0] : source.min[0]) * p.scale,
    p.y + source.min[1] * p.scale,
    p.z + (p.yaw ? -source.max[2] : source.min[2]) * p.scale,
  ]);
  const highs = slots.map((p) => [
    p.x + (p.yaw ? -source.min[0] : source.max[0]) * p.scale,
    p.y + source.max[1] * p.scale,
    p.z + (p.yaw ? -source.min[2] : source.max[2]) * p.scale,
  ]);
  return {
    min: [0, 1, 2].map((axis) => Math.min(...lows.map((p) => p[axis]))),
    max: [0, 1, 2].map((axis) => Math.max(...highs.map((p) => p[axis]))),
  };
}
