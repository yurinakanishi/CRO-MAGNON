import type { Point } from './types.mjs';
import { CollisionWorld } from './collision.mjs';
import { mountainHeight } from './camp-mountain.mjs';

// Use the measured mountain surface shared by every host and client. Render-only
// biome texture relief must not make mounted prediction disagree with the server.
const MAX_GRADE = 0.2;
const SAMPLE_STEP = 0.5;
const directions = Array.from({ length: 16 }, (_, i) => ({
  x: Math.cos((i * Math.PI) / 8),
  z: Math.sin((i * Math.PI) / 8),
}));

/** A mammoth needs gentle ground under its whole body, in every facing. */
export function mammothGroundFree(point: Point, radius: number): boolean {
  if (![point.x, point.z, radius].every(Number.isFinite) || radius <= 0) return false;
  const h = mountainHeight(point.x, point.z);
  const dx =
    (mountainHeight(point.x + SAMPLE_STEP, point.z) -
      mountainHeight(point.x - SAMPLE_STEP, point.z)) /
    (2 * SAMPLE_STEP);
  const dz =
    (mountainHeight(point.x, point.z + SAMPLE_STEP) -
      mountainHeight(point.x, point.z - SAMPLE_STEP)) /
    (2 * SAMPLE_STEP);
  if (Math.hypot(dx, dz) > MAX_GRADE) return false;
  for (const fraction of [0.5, 1]) {
    const distance = radius * fraction;
    for (const direction of directions) {
      const ground = mountainHeight(
        point.x + direction.x * distance,
        point.z + direction.z * distance,
      );
      if (Math.abs(ground - h) > distance * MAX_GRADE) return false;
    }
  }
  return true;
}

class MammothNavigation extends CollisionWorld {
  constructor(base: CollisionWorld) {
    super([], {
      active: (obstacle) => base.active(obstacle),
      river: base.river,
      coast: base.coast,
      walkSurfaces: base.walkSurfaces,
    });
    // The index and activation rules remain shared with the room's resources.
    this.grid = base.grid;
    this.obstacles = base.obstacles;
  }

  override free(...args: Parameters<CollisionWorld['free']>): boolean {
    return mammothGroundFree(args[0], args[1]) && super.free(...args);
  }

  override stepAllowed(...args: Parameters<CollisionWorld['stepAllowed']>): boolean {
    return mammothGroundFree(args[1], args[2]) && super.stepAllowed(...args);
  }
}

const navigation = new WeakMap<CollisionWorld, MammothNavigation>();
export function mammothNavigation(base: CollisionWorld): CollisionWorld {
  let scoped = navigation.get(base);
  if (!scoped) {
    scoped = new MammothNavigation(base);
    navigation.set(base, scoped);
  }
  return scoped;
}
