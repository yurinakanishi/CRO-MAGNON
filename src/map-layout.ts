/** Pure geometry for the atlas pointer, its labels and its zoom tiers. No DOM. */
export interface Point {
  x: number;
  y: number;
}
export interface LabelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Zoom tiers of the seamless atlas: what appears as the player zooms in. */
export const MAP_TIERS = Object.freeze({ places: 2, fires: 4, sites: 8 });
export const MAP_ZOOM = Object.freeze({ min: 1, max: 32, open: 4, step: 1.5 });
/**
 * The player arrow shared by the atlas DOM marker and the minimap canvas: a pointed arrow with
 * a notched tail in a 24 × 24 box, tip up at rotation 0.
 */
export const MAP_ARROW_SIZE = 24;
export const MAP_ARROW_POINTS: readonly (readonly [number, number])[] = Object.freeze([
  [12, 2],
  [21, 21],
  [12, 16],
  [3, 21],
]);
export const MAP_ARROW_PATH =
  MAP_ARROW_POINTS.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join(' ') + ' Z';
/**
 * Clockwise screen rotation that turns the tip-up arrow toward a facing. North (−z) is up on
 * both maps and `facing` 0 means moving toward +z (`Math.atan2(dx, dz)`), so a half turn faces
 * down the screen; facing π points up.
 */
export const markerRotation = (facing: number) => Math.PI - (facing ?? 0);
/** The former name of {@link markerRotation}, kept for the atlas and the minimap callers. */
export const mapArrowRotation = markerRotation;
/** Unit screen direction of the arrow tip for a facing (y grows downward). */
export function mapArrowTip(facing: number): Point {
  const rotation = mapArrowRotation(facing);
  return { x: Math.sin(rotation), y: -Math.cos(rotation) };
}
/** Radius around the pointer inside which a fire counts as chosen. */
export const PICK_RADIUS = 22;
/** The fraction of the canvas at each edge where the pointer drags the map along. */
export const EDGE_BAND = 0.15;
export const POINTER_SPEED = 600;

/**
 * Moves the pointer by the stick displacement over `dt` seconds. Inside the outer band the
 * pointer stops and the overshoot becomes a map pan, so the map scrolls under the pointer.
 */
export function movePointer(
  pointer: Point,
  stick: Point,
  dt: number,
  size: { width: number; height: number },
  band = EDGE_BAND,
): { pointer: Point; pan: Point } {
  const magnitude = Math.min(1, Math.hypot(stick.x, stick.y));
  if (!magnitude || dt <= 0) return { pointer: { ...pointer }, pan: { x: 0, y: 0 } };
  const speed = POINTER_SPEED * magnitude * magnitude * dt;
  const target = {
    x: pointer.x + (stick.x / magnitude) * speed,
    y: pointer.y + (stick.y / magnitude) * speed,
  };
  return clampPointer(target, size, band);
}

/** Keeps the pointer inside the band and returns the pan needed to honour the overshoot. */
export function clampPointer(
  target: Point,
  size: { width: number; height: number },
  band = EDGE_BAND,
): { pointer: Point; pan: Point } {
  const left = size.width * band,
    right = size.width * (1 - band),
    top = size.height * band,
    bottom = size.height * (1 - band);
  const clamped = {
    x: Math.max(left, Math.min(right, target.x)),
    y: Math.max(top, Math.min(bottom, target.y)),
  };
  return { pointer: clamped, pan: { x: clamped.x - target.x, y: clamped.y - target.y } };
}

/** Repeated d-pad nudges start at one pixel and grow, so fine aiming and long trips both work. */
export function nudgeStep(repeat: number): number {
  return repeat < 4 ? 1 : repeat < 8 ? 2 : repeat < 12 ? 4 : 8;
}

/** The nearest candidate within `radius` pixels of the pointer, or null. */
export function nearestWithin<T extends Point>(
  candidates: readonly T[],
  pointer: Point,
  radius = PICK_RADIUS,
): T | null {
  let best: T | null = null,
    bestDistance = radius;
  for (const candidate of candidates) {
    const distance = Math.hypot(candidate.x - pointer.x, candidate.y - pointer.y);
    if (distance <= bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

export const rectsOverlap = (a: LabelRect, b: LabelRect, gap = 2) =>
  a.x < b.x + b.width + gap &&
  a.x + a.width + gap > b.x &&
  a.y < b.y + b.height + gap &&
  a.y + a.height + gap > b.y;

/**
 * Simple declutter: requests are placed in priority order (lower first) and a label whose
 * rectangle overlaps an already placed one is skipped.
 */
export function placeLabels<T extends { priority: number; rect: LabelRect }>(
  requests: readonly T[],
): T[] {
  const placed: T[] = [];
  const ordered = requests
    .map((r, i) => [r, i] as const)
    .sort((a, b) => a[0].priority - b[0].priority || a[1] - b[1]);
  for (const [request] of ordered)
    if (!placed.some((p) => rectsOverlap(p.rect, request.rect))) placed.push(request);
  return placed;
}
