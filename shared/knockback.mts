import type { Point } from './types.mjs';

/**
 * A blow from another player (room rule `playerKnockback`, 2026-10-12) never costs
 * energy: it slides the struck body away and holds its steering until the slide
 * settles. The server, the struck player's own prediction and every renderer
 * follow this one curve.
 */
export const KNOCKBACK = Object.freeze({
  /** The slide lasts this long; the struck player's own steering waits for it. */
  staggerMs: 450,
  /** Exponential decay of the slide speed (1/s): a quick pop that settles. */
  decayPerSecond: 9,
  /** A body this broad (a human's radius) slides the full distance of the blow... */
  referenceRadius: 0.32,
  /** ...and a broader one less: the 2 m ape about half as far. */
  minimumScale: 0.5,
});

/** Public part of a slide (in the snapshot). `knockbackDone` is the share already applied. */
export interface Knockback {
  knockbackAt?: number;
  knockbackSequence?: number;
  knockbackX?: number;
  knockbackZ?: number;
  knockbackDistance?: number;
  knockbackDone?: number;
}
export interface KnockbackBody extends Knockback, Point {
  radius: number;
  /** The warp the slide began in; a warp ends it. */
  knockbackWarp?: number;
  warpSequence?: number;
  downedUntil?: number;
  mountId?: string | null;
  boatId?: string | null;
  carrierId?: string | null;
}

/** Share of the slide covered `elapsed` ms after the blow: 0 at the blow, exactly 1 when it settles. */
export function knockbackProgress(elapsed: number): number {
  if (!(elapsed > 0)) return 0;
  if (elapsed >= KNOCKBACK.staggerMs) return 1;
  const rate = KNOCKBACK.decayPerSecond / 1000;
  return (1 - Math.exp(-rate * elapsed)) / (1 - Math.exp(-rate * KNOCKBACK.staggerMs));
}

/** A slide is under way: started and not yet fully applied. */
export const knockbackSliding = (body: Knockback) =>
  (body.knockbackAt ?? 0) > 0 && (body.knockbackDone ?? 1) < 1;

export const knockbackScale = (radius: number) =>
  Math.min(1, Math.max(KNOCKBACK.minimumScale, KNOCKBACK.referenceRadius / Math.max(radius, 1e-3)));

/**
 * Start a slide of `distance` metres along (dx, dz). A body still sliding from an
 * earlier blow absorbs the next one, so several players cannot chain one victim.
 */
export function knockBack(
  body: KnockbackBody,
  dx: number,
  dz: number,
  distance: number,
  now: number,
): boolean {
  const length = Math.hypot(dx, dz);
  if (knockbackSliding(body) || !(length > 1e-9) || !(distance > 0)) return false;
  body.knockbackX = dx / length;
  body.knockbackZ = dz / length;
  body.knockbackDistance = distance * knockbackScale(body.radius);
  body.knockbackAt = now;
  body.knockbackSequence = (body.knockbackSequence ?? 0) + 1;
  body.knockbackDone = 0;
  body.knockbackWarp = body.warpSequence ?? 0;
  return true;
}

/**
 * Advance a slide to `now` through `move` (the walking collision, so a wall, water,
 * the world's edge or another body stops it). Returns true while the slide still
 * holds the steering. Riding, being carried, being downed or warping ends a slide
 * where it is.
 */
export function stepKnockback(
  body: KnockbackBody,
  now: number,
  move: (body: KnockbackBody, dx: number, dz: number) => Point,
): boolean {
  if (!knockbackSliding(body)) return false;
  if (
    body.downedUntil ||
    body.mountId ||
    body.boatId ||
    body.carrierId ||
    (body.warpSequence ?? 0) !== (body.knockbackWarp ?? body.warpSequence ?? 0)
  ) {
    body.knockbackDone = 1;
    return false;
  }
  const done = body.knockbackDone ?? 0,
    progress = Math.max(done, knockbackProgress(now - (body.knockbackAt ?? 0))),
    distance = (progress - done) * (body.knockbackDistance ?? 0);
  if (distance > 0) {
    const next = move(body, (body.knockbackX ?? 0) * distance, (body.knockbackZ ?? 0) * distance);
    body.x = next.x;
    body.z = next.z;
  }
  body.knockbackDone = progress;
  return progress < 1;
}

/** The part of a slide that the last snapshot has not reached, for drawing between snapshots. */
export function knockbackLead(body: Knockback, now: number): Point | null {
  if (!knockbackSliding(body)) return null;
  const share = knockbackProgress(now - (body.knockbackAt ?? 0)) - (body.knockbackDone ?? 0);
  if (!(share > 0)) return null;
  const distance = share * (body.knockbackDistance ?? 0);
  return { x: (body.knockbackX ?? 0) * distance, z: (body.knockbackZ ?? 0) * distance };
}
