import { LOAD_TIER, loadPriority } from './asset-load-queue.js';

/** Distances in metres from the arrival point (startup) or the camera (streaming).
 * The world fogs from 45 m to 118 m, and terrain is drawn at LOD0 within 44 m,
 * LOD1 within 82 m and LOD2 beyond, so 82 m is where the view is already half fog. */
export const STARTUP = Object.freeze({
  /** Ground templates of land chunks whose centre lies this close are required
   * for arrival: with 32 m chunks this covers all ground within 59 m. */
  floorRadius: 82,
  /** Chunks admitted before arrival (the existing nearest floor); farther loaded
   * chunks join within a few frames through the per-frame admission budget. */
  admitRadius: 55,
  /** Landmarks whose footprint edge lies this close are required for arrival. */
  viewRadius: 82,
  /** The world fog is opaque from here. */
  fogFar: 118,
  /** No point of a 32 m chunk centred farther than this (the fog plus half the
   * chunk's diagonal) is ever visible. */
  visibleRadius: 118 + 16 * Math.SQRT2,
  /** A camera move longer than one chunk between plans is a warp or a spawn. */
  jumpMetres: 32,
});

/** Ground under and around the camera first, then the visible band, then
 * fogged ground. The local floor outranks every streamed actor but the self. */
export function terrainPriority(distance: number): number {
  if (distance <= STARTUP.floorRadius) return loadPriority(LOAD_TIER.essential, distance);
  if (distance <= STARTUP.visibleRadius) return loadPriority(LOAD_TIER.scene, distance);
  return loadPriority(LOAD_TIER.prefetch, distance);
}

/** Landmarks by the distance to their footprint edge: those framing the view
 * load with nearby actors, visible ones with the scenery, fogged ones last. */
export function landmarkPriority(edge: number): number {
  const distance = Math.max(0, edge);
  if (distance <= STARTUP.viewRadius) return loadPriority(LOAD_TIER.near, distance);
  if (distance <= STARTUP.fogFar) return loadPriority(LOAD_TIER.scene, distance);
  return loadPriority(LOAD_TIER.prefetch, distance);
}

type Point = { x: number; z: number };
type Chunk = { distance: number; land: boolean; ground: string };
type Placement = { id: string; key: string; x: number; z: number; clearance: number };

/** Ground keys required for arrival: those of land chunks within `floorRadius`. */
export function criticalFloorKeys(chunks: readonly Chunk[], radius = STARTUP.floorRadius) {
  return [...new Set(chunks.filter((c) => c.land && c.distance <= radius).map((c) => c.ground))];
}

/** Landmarks required for arrival: footprint within `viewRadius` of `focus`. */
export function criticalLandmarks<T extends Placement>(
  placements: readonly T[],
  focus: Point,
  radius = STARTUP.viewRadius,
): T[] {
  return placements.filter(
    (item) => Math.hypot(item.x - focus.x, item.z - focus.z) - item.clearance <= radius,
  );
}

export type CriticalStartup = {
  focus: Point;
  /** Every template awaited before the world is offered, without duplicates, in request
   * order: the fitted camp mountain and the floor first. */
  keys: string[];
  floorKeys: string[];
  sceneryKeys: string[];
  landmarkIds: string[];
  /** Camp mountain LOD levels whose river bed is fitted before arrival. */
  mountainLevels: number[];
};

/** The bounded set a world must hold before arrival. Farther ground, landmarks
 * and every actor stream afterwards, nearest first. */
export function criticalStartup({
  focus,
  chunks,
  placements,
  sceneryKeys,
  mountainKey,
  mountainLevel,
}: {
  focus: Point;
  chunks: readonly Chunk[];
  placements: readonly Placement[];
  sceneryKeys: readonly string[];
  mountainKey: string;
  /** The camp mountain LOD seen from `focus`. */
  mountainLevel: number;
}): CriticalStartup {
  const floorKeys = criticalFloorKeys(chunks);
  const landmarks = criticalLandmarks(placements, focus);
  const mountainLevels = landmarks.some((item) => item.key === mountainKey) ? [mountainLevel] : [];
  // The same set; only the order of its requests (first in, first out within one tier) changes.
  // The camp mountain, whose river bed is fitted as soon as it arrives, and the floor go first.
  const keys = [
    ...new Set([
      ...(mountainLevels.length ? [mountainKey] : []),
      ...floorKeys,
      ...landmarks.map((item) => item.key),
      ...sceneryKeys,
    ]),
  ];
  return {
    focus: { x: focus.x, z: focus.z },
    keys,
    floorKeys,
    sceneryKeys: [...sceneryKeys],
    landmarkIds: landmarks.map((item) => item.id),
    mountainLevels,
  };
}
