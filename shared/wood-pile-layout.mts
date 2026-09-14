import { MODEL_BOUNDS } from './model-bounds.mjs';

/** Whole logs, stored from the supporting bottom row to the top of the pile. */
export function woodPileLayout(total: number) {
  const count = Math.max(0, Math.floor(total));
  const bounds = MODEL_BOUNDS['firewood-log'];
  const diameter = bounds.max[2] - bounds.min[2];
  const height = bounds.max[1] - bounds.min[1];
  const bottom = Math.ceil((Math.sqrt(8 * count + 1) - 1) / 2);
  const slots: Array<{ x: number; y: number; z: number; yaw: number }> = [];
  for (let row = 0; slots.length < count; row++) {
    const width = Math.min(bottom - row, count - slots.length);
    for (let column = 0; column < width; column++) {
      slots.push({
        x: 0,
        y: (row * height * Math.sqrt(3)) / 2,
        z: (column - (bottom - row - 1) / 2) * diameter,
        yaw: row % 2 ? Math.PI : 0,
      });
    }
  }
  return slots;
}

/** The same assembled footprint is used by client and server collision. */
export function woodPileBounds(total: number) {
  const source = MODEL_BOUNDS['firewood-log'];
  const slots = woodPileLayout(total);
  if (!slots.length) return { min: [0, 0, 0], max: [0, 0, 0] };
  const lows = slots.map((p) => [
    p.x + (p.yaw ? -source.max[0] : source.min[0]),
    p.y + source.min[1],
    p.z + (p.yaw ? -source.max[2] : source.min[2]),
  ]);
  const highs = slots.map((p) => [
    p.x + (p.yaw ? -source.min[0] : source.max[0]),
    p.y + source.max[1],
    p.z + (p.yaw ? -source.min[2] : source.max[2]),
  ]);
  return {
    min: [0, 1, 2].map((axis) => Math.min(...lows.map((p) => p[axis]))),
    max: [0, 1, 2].map((axis) => Math.max(...highs.map((p) => p[axis]))),
  };
}
