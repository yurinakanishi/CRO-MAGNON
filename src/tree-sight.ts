import * as THREE from 'three';
import { isMesh } from './three-types.js';

/** Height of one band of a crown profile, in the tree model's metres. */
export const CROWN_BAND = 0.5;
/** How near the sight from the camera to its focus may pass a tree that stays drawn: more
 * than the camera's near-plane corners (about 0.22 m) and the 0.2 m sampling of the sight. */
export const SIGHT_MARGIN = 0.35;

const point = new THREE.Vector3();

/** Plants nothing collides with (the body walks through a berry bush): a view whose sight
 * would pass through one does not draw it, as with a tree. */
export const PASSABLE_PLANTS: ReadonlySet<string> = new Set(['berry-bush']);

/** A tree model's widest reach from its trunk axis in each CROWN_BAND of height, measured
 * from its drawn vertices. Each band is widened to its neighbours, so no height between two
 * samples of a sight line is underrated. */
export function crownProfile(root: THREE.Object3D): Float32Array {
  const radii: number[] = [];
  root.updateMatrixWorld(true);
  root.traverse((node) => {
    if (!isMesh(node)) return;
    const position = node.geometry.attributes.position;
    for (let i = 0; i < position.count; i++) {
      point.fromBufferAttribute(position, i).applyMatrix4(node.matrixWorld);
      const band = Math.max(0, Math.floor(point.y / CROWN_BAND));
      radii[band] = Math.max(radii[band] ?? 0, Math.hypot(point.x, point.z));
    }
  });
  return Float32Array.from({ length: radii.length }, (_, k) =>
    Math.max(radii[k - 1] ?? 0, radii[k] ?? 0, radii[k + 1] ?? 0),
  );
}

export interface TreePlacement {
  position: THREE.Vector3;
  scale: THREE.Vector3;
}

/**
 * Whether the segment from `a` to `b` passes within `margin` of the tree drawn at this
 * placement: its crown profile (widest `widest`) at the placement's scale. The segment is
 * sampled every 0.2 m along the stretch where it comes within the crown's widest reach.
 */
export function segmentNearTree(
  profile: Float32Array,
  widest: number,
  item: TreePlacement,
  a: THREE.Vector3,
  b: THREE.Vector3,
  margin = SIGHT_MARGIN,
) {
  const reach = Math.max(item.scale.x, item.scale.z),
    rise = item.scale.y,
    base = item.position.y,
    height = profile.length * CROWN_BAND;
  if (Math.max(a.y, b.y) < base - margin || Math.min(a.y, b.y) > base + height * rise + margin)
    return false;
  const wx = a.x - item.position.x,
    wz = a.z - item.position.z,
    dx = b.x - a.x,
    dz = b.z - a.z,
    limit = widest * reach + margin;
  // The stretch of the segment within the widest reach of the trunk's axis.
  const qa = dx * dx + dz * dz,
    qb = wx * dx + wz * dz,
    qc = wx * wx + wz * wz - limit * limit;
  let t0 = 0,
    t1 = 1;
  if (qa < 1e-12) {
    if (qc > 0) return false;
  } else {
    const disc = qb * qb - qa * qc;
    if (disc < 0) return false;
    const root = Math.sqrt(disc);
    t0 = Math.max(0, (-qb - root) / qa);
    t1 = Math.min(1, (-qb + root) / qa);
    if (t0 > t1) return false;
  }
  const steps = Math.max(1, Math.ceil((a.distanceTo(b) * (t1 - t0)) / 0.2));
  for (let i = 0; i <= steps; i++) {
    const t = t0 + ((t1 - t0) * i) / steps;
    // Heights beyond the model's top and foot keep its nearest band, within the margin.
    const y = (a.y + (b.y - a.y) * t - base) / rise;
    if (y < -margin / rise || y > height + margin / rise) continue;
    const band = Math.min(Math.max(Math.floor(y / CROWN_BAND), 0), profile.length - 1),
      r = profile[band] * reach + margin,
      x = wx + dx * t,
      z = wz + dz * t;
    if (x * x + z * z < r * r) return true;
  }
  return false;
}
