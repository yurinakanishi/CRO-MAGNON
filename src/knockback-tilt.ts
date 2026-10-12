import type * as THREE from 'three';
import { KNOCKBACK, type Knockback } from '../shared/knockback.mjs';

// The whole body rocks along the slide of a blow from another player: the tilt
// peaks almost at once, then eases out as the slide settles. It is a transform of
// the actor wrapper (yaw outermost, rotation order YXZ), so every body plan and
// skin shows it the same way without a separate clip.
const PEAK_MS = 70;
const SETTLE_MS = KNOCKBACK.staggerMs + 200;
const MAX_TILT = 0.3;
/** A spear blow on a human slides about this far; shorter slides rock less. */
const NOMINAL_DISTANCE = 1.6;

/** Tilt in radians toward the slide direction, `now` (server time) after the blow. */
export function knockbackTilt(body: Knockback, now: number): number {
  const at = body.knockbackAt ?? 0,
    elapsed = now - at;
  if (!(at > 0) || !(elapsed >= 0) || elapsed >= SETTLE_MS) return 0;
  const size = Math.min(1, Math.max(0.5, (body.knockbackDistance ?? 0) / NOMINAL_DISTANCE));
  if (elapsed < PEAK_MS) return MAX_TILT * size * Math.sin(((elapsed / PEAK_MS) * Math.PI) / 2);
  const t = (elapsed - PEAK_MS) / (SETTLE_MS - PEAK_MS);
  return MAX_TILT * size * (1 - t * t * (3 - 2 * t));
}

/** Rock `model` (already turned to its yaw) along the slide; upright when there is none. */
export function applyKnockbackTilt(model: THREE.Object3D, body: Knockback, now: number) {
  const tilt = knockbackTilt(body, now);
  if (!tilt) {
    model.rotation.x = model.rotation.z = 0;
    return;
  }
  const yaw = model.rotation.y,
    x = body.knockbackX ?? 0,
    z = body.knockbackZ ?? 0;
  // The slide direction in the body's own frame: +Z forward, +X to its left side.
  const forward = x * Math.sin(yaw) + z * Math.cos(yaw),
    side = x * Math.cos(yaw) - z * Math.sin(yaw);
  model.rotation.x = tilt * forward;
  model.rotation.z = -tilt * side;
}
