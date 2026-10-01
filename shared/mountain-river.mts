import { riverX } from './river-profile.mjs';
import {
  mountainLakeAt,
  mountainLakeBed,
  mountainLakeIntersects,
  mountainLakePoint,
} from './mountain-lake.mjs';

// A lake beyond the castle, its eastern outlet, a 15.3 m fall, a plunge pool,
// then the existing valley river. Metres, upstream -> downstream. This single
// profile drives the source-mesh fitting, water, collision and map.
export const MOUNTAIN_RIVER = Object.freeze(
  [
    { ...mountainLakePoint(-0.42, 0.86), width: 1.8 },
    { x: -35, z: 299, y: 34.1, width: 2.2 },
    { x: -21, z: 281, y: 34.1, width: 2.1 },
    { x: -12, z: 261, y: 34.1, width: 2.0 },
    { x: -11, z: 253, y: 34.1, width: 2.2 },
    { x: -7, z: 246, y: 34.09, width: 1.9 },
    { x: -6, z: 234, y: 34.06, width: 1.9 },
    { x: -5, z: 229, y: 34.04, width: 1.8 },
    { x: -6, z: 221, y: 33.98, width: 1.7 },
    { x: -4, z: 212, y: 33.8, width: 1.8 },
    { x: -2, z: 204, y: 33.3, width: 2.0 },
    { x: 3, z: 198, y: 31.2, width: 2.3 },
    { x: 5, z: 198, y: 30.8, width: 2.4 },
    { x: 7.4, z: 198, y: 15.5, width: 2.7 },
    { x: 12, z: 198, y: 15.35, width: 5.2 },
    { x: 18, z: 194, y: 15.1, width: 4.8 },
    { x: 24, z: 191, y: 13.3, width: 2.8 },
    { x: 30, z: 187, y: 10.0, width: 2.4 },
    { x: 38, z: 182, y: 5.1, width: 2.3 },
    { x: 45, z: 177, y: 0.6, width: 2.0 },
    { x: 50, z: 172, y: -0.38, width: 2.0 },
    { x: 53, z: 165, y: -0.42, width: 2.1 },
    { x: 57, z: 157, y: -0.44, width: 2.3 },
    { x: riverX(150), z: 150, y: -0.45, width: 2.8 },
  ].map((p) => Object.freeze(p)),
);
export const MOUNTAIN_WATERFALL = Object.freeze({
  lip: MOUNTAIN_RIVER[12],
  foot: MOUNTAIN_RIVER[13],
  pool: MOUNTAIN_RIVER[14],
});
const clamp = (n: number, a = 0, b = 1) => Math.max(a, Math.min(b, n));
const smooth = (t: number) => ((t = clamp(t)), t * t * (3 - 2 * t));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
export type RiverSample = { x: number; z: number; y: number; width: number; s: number };

// Smooth horizontal bends, monotonically descending water heights. The fall
// retains its short horizontal run instead of a Catmull-Rom height overshoot.
const samples: RiverSample[] = [];
for (let i = 0; i < MOUNTAIN_RIVER.length - 1; i++) {
  const a = MOUNTAIN_RIVER[i],
    b = MOUNTAIN_RIVER[i + 1];
  const before = MOUNTAIN_RIVER[Math.max(0, i - 1)],
    after = MOUNTAIN_RIVER[Math.min(MOUNTAIN_RIVER.length - 1, i + 2)];
  const steps = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z, b.y - a.y) / 0.35);
  for (let j = 0; j <= steps; j++) {
    if (i && j === 0) continue;
    const t = j / steps,
      t2 = t * t,
      t3 = t2 * t;
    const bend = (key: 'x' | 'z') =>
      (2 * t3 - 3 * t2 + 1) * a[key] +
      (t3 - 2 * t2 + t) * (b[key] - before[key]) * 0.22 +
      (-2 * t3 + 3 * t2) * b[key] +
      (t3 - t2) * (after[key] - a[key]) * 0.22;
    const point = {
      x: bend('x'),
      z: bend('z'),
      y: mix(a.y, b.y, t),
      width: mix(a.width, b.width, smooth(t)),
      s: 0,
    };
    const previous = samples.at(-1);
    if (previous)
      point.s =
        previous.s + Math.hypot(point.x - previous.x, point.z - previous.z, point.y - previous.y);
    samples.push(point);
  }
}
export const MOUNTAIN_RIVER_SAMPLES: readonly RiverSample[] = Object.freeze(samples);
export const MOUNTAIN_RIVER_LENGTH = samples.at(-1)!.s;
const BANK = 10.2,
  CELL = 8;
const grid = new Map<string, number[]>();
for (let i = 0; i < samples.length - 1; i++) {
  const a = samples[i],
    b = samples[i + 1],
    radius = Math.max(a.width, b.width) + BANK + 2;
  for (
    let ix = Math.floor((Math.min(a.x, b.x) - radius) / CELL);
    ix <= Math.floor((Math.max(a.x, b.x) + radius) / CELL);
    ix++
  )
    for (
      let iz = Math.floor((Math.min(a.z, b.z) - radius) / CELL);
      iz <= Math.floor((Math.max(a.z, b.z) + radius) / CELL);
      iz++
    ) {
      const key = `${ix},${iz}`;
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key)!.push(i);
    }
}
export function mountainRiverAt(x: number, z: number) {
  const candidates = grid.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`);
  if (!candidates) return null;
  let best: (RiverSample & { distance: number; nx: number; nz: number }) | null = null;
  let closest = Infinity;
  for (const i of candidates) {
    const a = samples[i],
      b = samples[i + 1],
      dx = b.x - a.x,
      dz = b.z - a.z;
    const squared = dx * dx + dz * dz;
    const t = clamp(((x - a.x) * dx + (z - a.z) * dz) / squared);
    const px = mix(a.x, b.x, t),
      pz = mix(a.z, b.z, t);
    const distance = Math.hypot(x - px, z - pz);
    if (distance >= closest) continue;
    closest = distance;
    const length = Math.sqrt(squared);
    best = {
      x: px,
      z: pz,
      y: mix(a.y, b.y, t),
      width: mix(a.width, b.width, t),
      s: mix(a.s, b.s, t),
      distance,
      nx: -dz / length,
      nz: dx / length,
    };
  }
  return best && best.distance <= best.width + BANK + 2 ? best : null;
}
export function mountainRiverContains(x: number, z: number, margin = 0) {
  const lake = mountainLakeAt(x, z);
  if (lake && lake.shore < margin) return true;
  const p = mountainRiverAt(x, z);
  return !!p && p.distance < p.width + margin;
}
export function mountainRiverBed(x: number, z: number, originalY: number) {
  const lakeBed = mountainLakeBed(x, z, originalY);
  const candidates = grid.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`);
  if (!candidates) return lakeBed;
  const nearest = mountainRiverAt(x, z);
  // Rounded joins cover the narrow wedges between adjacent transverse strips.
  let result = nearest
    ? riverSectionBed(originalY, nearest.y, nearest.width, nearest.distance)
    : originalY;
  // On the inside of a bend, the nearest centreline can belong to the higher
  // upstream reach. Carve the union of the actual transverse water sections,
  // so rock cannot poke through the lower falling sheet.
  for (const i of candidates) {
    const a = samples[i],
      b = samples[i + 1],
      dx = b.x - a.x,
      dz = b.z - a.z;
    const projection = ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz);
    if ((projection < 0 && i !== 0) || (projection > 1 && i !== samples.length - 2)) continue;
    const t = clamp(projection),
      distance = Math.hypot(x - mix(a.x, b.x, t), z - mix(a.z, b.z, t));
    const width = mix(a.width, b.width, t);
    if (distance >= width + BANK) continue;
    result = Math.min(result, riverSectionBed(originalY, mix(a.y, b.y, t), width, distance));
  }
  return Math.min(result, lakeBed);
}
export function mountainWaterHeight(x: number, z: number) {
  const lake = mountainLakeAt(x, z);
  if (lake && lake.shore < 0) return lake.y;
  const river = mountainRiverAt(x, z);
  return river && river.distance < river.width ? river.y : -Infinity;
}
function riverSectionBed(originalY: number, waterY: number, width: number, distance: number) {
  const bed = waterY - (width > 3 ? 1.15 : 0.65);
  // Deep sides fan out into the hillside; shallow reaches have narrow banks.
  const bankWidth = 2.2 + Math.min(8, Math.max(0, originalY - bed - 1) * 0.5);
  const bank = smooth((distance - width - 0.15) / (bankWidth - 0.15));
  return mix(Math.min(originalY, bed), originalY, bank);
}
export function mountainRiverIntersects(minX: number, maxX: number, minZ: number, maxZ: number) {
  if (mountainLakeIntersects(minX, maxX, minZ, maxZ)) return true;
  return MOUNTAIN_RIVER.some((p, i) => {
    const q = MOUNTAIN_RIVER[Math.min(i + 1, MOUNTAIN_RIVER.length - 1)],
      r = Math.max(p.width, q.width) + BANK + 1;
    return (
      maxX >= Math.min(p.x, q.x) - r &&
      minX <= Math.max(p.x, q.x) + r &&
      maxZ >= Math.min(p.z, q.z) - r &&
      minZ <= Math.max(p.z, q.z) + r
    );
  });
}
export function mountainRiverSample(s: number) {
  s = clamp(s, 0, MOUNTAIN_RIVER_LENGTH);
  let lo = 0,
    hi = samples.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (samples[m].s < s) lo = m;
    else hi = m;
  }
  const a = samples[lo],
    b = samples[hi],
    t = (s - a.s) / (b.s - a.s);
  const dx = b.x - a.x,
    dz = b.z - a.z,
    horizontal = Math.hypot(dx, dz);
  return {
    x: mix(a.x, b.x, t),
    z: mix(a.z, b.z, t),
    y: mix(a.y, b.y, t),
    width: mix(a.width, b.width, t),
    s,
    nx: -dz / horizontal,
    nz: dx / horizontal,
    dy: (b.y - a.y) / (b.s - a.s),
    fall: clamp((a.y - b.y) / (b.s - a.s)),
  };
}
