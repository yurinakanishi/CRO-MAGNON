// Pure decisions behind the "resources visibly deplete" feedback (plan §12 items
// 4–6). No three.js here so the rules can be unit tested in Node: berry fruit
// anchors are chosen from a plain vertex list, and the wood / stone / meat rules
// return numbers and booleans that world3d.ts applies to the scene objects.

export type Point = readonly [number, number, number];

export const FRUIT_RADIUS = 0.06;
export const FRUIT_SECTORS = 5;
export const FRUIT_UPPER_FRACTION = 0.55;
export const FRUIT_FALLBACK_HEIGHT = 0.75;
export const FRUIT_FALLBACK_RADIUS = 0.35;
export const STONE_MIN_SCALE = 0.55;
export const MEAT_RING_RADIUS = 0.45;

/** FNV-1a hash of a resource id: a stable, cheap seed for per-resource variety. */
export function seedFromId(id: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < id.length; index++) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** Deterministic unit-interval generator (mulberry32) for a seed. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function fruitCount(amount: number, maxAmount: number): number {
  const total = Math.max(0, Math.floor(maxAmount || 0));
  return Math.min(total, Math.max(0, Math.floor(amount || 0)));
}

function ringAnchors(count: number, phase: number, height: number, radius: number): Point[] {
  return Array.from({ length: count }, (_, index) => {
    const angle = phase + (index / Math.max(1, count)) * Math.PI * 2;
    return [Math.cos(angle) * radius, height, Math.sin(angle) * radius] as const;
  });
}

/**
 * Picks `count` fruit anchor points on a bush from its vertices (model space,
 * y up, trunk on the y axis). Candidates are the vertices in the upper
 * `upperFraction` of the bush height; the compass is divided into `sectors`
 * wedges (rotated by a seeded phase so two bushes never match) and each wedge
 * contributes its outermost vertex first, round-robin, so the fruit surrounds
 * the bush instead of clustering. Anchors are nudged outward by half a fruit
 * radius so the spheres sit on the foliage. Falls back to an evenly spaced ring
 * when no usable vertex is available.
 */
export function berryAnchors(
  points: ReadonlyArray<Point>,
  count: number,
  seed = 0,
  {
    sectors = FRUIT_SECTORS,
    upperFraction = FRUIT_UPPER_FRACTION,
    fallbackHeight = FRUIT_FALLBACK_HEIGHT,
    fallbackRadius = FRUIT_FALLBACK_RADIUS,
    minimumSpacing = FRUIT_RADIUS * 1.5,
  } = {},
): Point[] {
  const wanted = Math.max(0, Math.floor(count));
  const random = seededRandom(seed);
  const phase = random() * Math.PI * 2;
  if (wanted === 0) return [];
  let yMin = Infinity,
    yMax = -Infinity;
  for (const [, y] of points) {
    if (!Number.isFinite(y)) continue;
    yMin = Math.min(yMin, y);
    yMax = Math.max(yMax, y);
  }
  const usable = points.length > 0 && Number.isFinite(yMin) && yMax > yMin;
  if (!usable) return ringAnchors(wanted, phase, fallbackHeight, fallbackRadius);
  const threshold = yMin + (1 - upperFraction) * (yMax - yMin);
  const wedges: Array<Array<{ point: Point; radius: number }>> = Array.from(
    { length: Math.max(1, sectors) },
    () => [],
  );
  for (const point of points) {
    const [x, y, z] = point;
    if (!(y >= threshold)) continue;
    const radius = Math.hypot(x, z);
    if (!(radius > 1e-4)) continue;
    const angle = (Math.atan2(z, x) + Math.PI + phase) % (Math.PI * 2);
    const wedge = Math.min(wedges.length - 1, Math.floor((angle / (Math.PI * 2)) * wedges.length));
    wedges[wedge].push({ point, radius });
  }
  for (const wedge of wedges) {
    wedge.sort((a, b) => b.radius - a.radius);
    // Rotate the outermost few so neighbouring bushes do not share one pattern.
    const outer = wedge.splice(0, Math.min(3, wedge.length)),
      turn = Math.floor(random() * Math.max(1, outer.length));
    wedge.unshift(...outer.slice(turn), ...outer.slice(0, turn));
  }
  const chosen: Point[] = [];
  const cursors = wedges.map(() => 0);
  const start = Math.floor(random() * wedges.length);
  let exhausted = false;
  while (chosen.length < wanted && !exhausted) {
    exhausted = true;
    for (let step = 0; step < wedges.length && chosen.length < wanted; step++) {
      const wedgeIndex = (start + step) % wedges.length;
      const wedge = wedges[wedgeIndex];
      while (cursors[wedgeIndex] < wedge.length) {
        const candidate = wedge[cursors[wedgeIndex]++];
        const [x, y, z] = candidate.point;
        const tooClose = chosen.some(
          ([cx, cy, cz]) => Math.hypot(cx - x, cy - y, cz - z) < minimumSpacing,
        );
        if (tooClose) continue;
        const push = 1 + (FRUIT_RADIUS * 0.5) / candidate.radius;
        chosen.push([x * push, y, z * push]);
        exhausted = false;
        break;
      }
    }
  }
  if (chosen.length < wanted) {
    const height = yMin + (yMax - yMin) * 0.7;
    for (const anchor of ringAnchors(wanted - chosen.length, phase, height, fallbackRadius))
      chosen.push(anchor);
  }
  return chosen;
}

/** Visible pile height (metres, model space) for the remaining wood. */
export function woodClipHeight(heightMetres: number, amount: number, maxAmount: number): number {
  const ratio = maxAmount > 0 ? Math.min(1, Math.max(0, amount / maxAmount)) : 0;
  return heightMetres * ratio;
}

/**
 * World-space clipping plane that removes the top of a firewood pile: normal
 * −y, so everything above `baseY + visible height × scale` is clipped (three.js
 * discards points with a negative signed distance).
 */
export function woodClipPlane(
  baseY: number,
  scale: number,
  heightMetres: number,
  amount: number,
  maxAmount: number,
): { normal: Point; constant: number } {
  // Leave a hair above the geometric height so a full pile is never clipped.
  const extra = amount >= maxAmount ? 0.05 : 0;
  return {
    normal: [0, -1, 0],
    constant: baseY + (woodClipHeight(heightMetres, amount, maxAmount) + extra) * scale,
  };
}

/** Boulder scale for the remaining stone: volume follows the amount, never below 55 %. */
export function stoneScale(baseScale: number, amount: number, maxAmount: number): number {
  const ratio = maxAmount > 0 ? Math.min(1, Math.max(0, amount / maxAmount)) : 1;
  return baseScale * Math.max(STONE_MIN_SCALE, Math.cbrt(ratio));
}

/** Which of the `total` meat pieces around a carcass are still there. */
export function meatPieceVisibility(remaining: number | undefined, total: number): boolean[] {
  const left = remaining == null ? total : Math.max(0, Math.min(total, Math.floor(remaining)));
  return Array.from({ length: total }, (_, index) => index < left);
}

/** Ring layout for the meat pieces: evenly spaced, each with its own seeded yaw. */
export function meatRingLayout(
  total: number,
  radius = MEAT_RING_RADIUS,
): Array<{ x: number; z: number; yaw: number }> {
  return Array.from({ length: total }, (_, index) => {
    const angle = (index / Math.max(1, total)) * Math.PI * 2;
    const yaw = seededRandom(index + 1)() * Math.PI * 2;
    return { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius, yaw };
  });
}
