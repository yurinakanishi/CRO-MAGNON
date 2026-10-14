// Keeps the scattered scenery off steep ground and apart (user request 2026-10-14: nothing on a
// mountain's side, nothing too close to, overlapping or inside another object). It runs on the
// scatter's result, so it asks no baked question: its inputs are positions, scales, the measured
// model bounds and the server terrain, the same wherever the scatter is replayed.
import type { SceneryPlacement } from './types.mjs';
import { MODEL_BOUNDS } from './model-bounds.mjs';
import { mountainHeight, MOUNTAIN_BOUNDS } from './camp-mountain.mjs';
import { CAVE_HILL } from './camp-cave-layout.mjs';
import { mountainRiverBed } from './mountain-river.mjs';
import { woodPileBounds } from './wood-pile-layout.mjs';
import { stonePileBounds } from './stone-pile-layout.mjs';

type Placement = Pick<SceneryPlacement, 'key' | 'x' | 'z' | 'scale'>;
type Resource = { type: string; x: number; z: number; maxAmount?: number; amount?: number };
interface Disc {
  x: number;
  z: number;
  radius: number;
}

/** The steepest ground each kind may stand on: the rise across its footprint over its width. */
export const MAX_GRADE = Object.freeze({
  tree: 0.3,
  rock: 0.25,
  prop: 0.25,
  grass: 0.45,
});
/** Clear space between footprints, in metres, and how much of two crowns may meet. */
export const SPACING = Object.freeze({
  rockFromObject: 0.5,
  rockFromRock: 0.3,
  trunkFromObject: 0.8,
  /** A crown keeps this share of its radius off a tent, fire, prop or harvest pile. */
  crownOverObject: 0.7,
  trunkFromRock: 0.4,
  /** Two trees stand at least this share of their crown radii apart. */
  crowns: 0.8,
  /** Ground cover stays this far outside any solid footprint (pile, tent, rock or trunk). */
  grassFromSolid: 0.25,
});

const across = (scale: SceneryPlacement['scale']) =>
  Array.isArray(scale) ? Math.max(scale[0], scale[2]) : (scale ?? 1);
/** Horizontal reach of a model, from its measured bounds. */
export function footprintRadius(item: Placement) {
  const bounds = MODEL_BOUNDS[item.key as keyof typeof MODEL_BOUNDS];
  return (bounds ? bounds.radius : 0.8) * across(item.scale);
}
const trunk = MODEL_BOUNDS['valley-pine'].trunk;
const TRUNK_RADIUS = Math.max(-trunk.min[0], trunk.max[0], -trunk.min[2], trunk.max[2]);
export const trunkRadius = (item: Placement) => TRUNK_RADIUS * across(item.scale);

function boundsRadius(bounds: { min: number[]; max: number[] }) {
  return Math.hypot(
    Math.max(-bounds.min[0], bounds.max[0]),
    Math.max(-bounds.min[2], bounds.max[2]),
  );
}
/** The reach of a harvest pile at its fullest. */
export function resourceRadius(resource: Resource) {
  const total = resource.maxAmount ?? resource.amount ?? 1;
  if (resource.type === 'wood') return boundsRadius(woodPileBounds(total));
  if (resource.type === 'stone') return boundsRadius(stonePileBounds(total));
  return 0.9; // a berry bush
}

const ground = (x: number, z: number) => mountainRiverBed(x, z, mountainHeight(x, z));
const ring = (n: number) =>
  Array.from({ length: n }, (_, k) => [
    Math.cos((k / n) * Math.PI * 2),
    Math.sin((k / n) * Math.PI * 2),
  ]);
const RING8 = ring(8),
  RING4 = ring(4);
// The server ground rises only over the camp mountain and the cave's foothill; beyond, it is flat.
const RELIEF = Object.freeze({
  minX: Math.min(MOUNTAIN_BOUNDS.minX, CAVE_HILL.minX) - 10,
  maxX: Math.max(MOUNTAIN_BOUNDS.maxX, CAVE_HILL.maxX) + 10,
  minZ: Math.min(MOUNTAIN_BOUNDS.minZ, CAVE_HILL.minZ) - 10,
  maxZ: Math.max(MOUNTAIN_BOUNDS.maxZ, CAVE_HILL.maxZ) + 10,
});
/** The rise of the ground across a footprint over its width: the centre and two rings of eight,
 * or one ring of four for a `light` check. */
export function footprintGrade(x: number, z: number, radius: number, light = false) {
  const r = Math.max(radius, 0.5);
  if (x + r < RELIEF.minX || x - r > RELIEF.maxX || z + r < RELIEF.minZ || z - r > RELIEF.maxZ)
    return 0;
  let low = ground(x, z),
    high = low;
  for (const fraction of light ? [1] : [0.5, 1])
    for (const [cx, cz] of light ? RING4 : RING8) {
      const y = ground(x + cx * r * fraction, z + cz * r * fraction);
      low = Math.min(low, y);
      high = Math.max(high, y);
    }
  return (high - low) / (2 * r);
}

/** A coarse grid of footprints already kept, for neighbour queries. */
class Discs {
  private cells = new Map<number, Disc[]>();
  private reach = 0;
  constructor(private size = 8) {}
  private static key(i: number, j: number) {
    return (i + 32768) * 65536 + (j + 32768);
  }
  add(disc: Disc) {
    const key = Discs.key(Math.floor(disc.x / this.size), Math.floor(disc.z / this.size));
    const list = this.cells.get(key);
    if (list) list.push(disc);
    else this.cells.set(key, [disc]);
    this.reach = Math.max(this.reach, disc.radius);
  }
  /** Whether any kept disc is closer to (x, z) than `gap(disc)`. */
  crowds(x: number, z: number, own: number, gap: (disc: Disc) => number) {
    if (!this.cells.size) return false;
    // No rule asks for more than both reaches and 1.5 m of clear ground.
    const span = Math.ceil((own + this.reach + 1.5) / this.size);
    const cx = Math.floor(x / this.size),
      cz = Math.floor(z / this.size);
    for (let i = cx - span; i <= cx + span; i++)
      for (let j = cz - span; j <= cz + span; j++) {
        const list = this.cells.get(Discs.key(i, j));
        if (list)
          for (const disc of list) {
            const dx = x - disc.x,
              dz = z - disc.z,
              g = gap(disc);
            if (dx * dx + dz * dz < g * g) return true;
          }
      }
    return false;
  }
}

interface Scenery {
  trees: (Placement & object)[];
  grass: (Placement & object)[];
  rocks: (Placement & object)[];
  ridges: (Placement & object)[];
  tents: (Placement & object)[];
  props: (Placement & object)[];
  fires: (Placement & object)[];
}

/**
 * Drops what stands on steep ground, then keeps each boulder, tree and tuft only where it is
 * clear of everything kept before it: harvest piles, tents, fires and authored props first
 * (they are never moved), then boulders, then trees, then ground cover. Order is the scatter's
 * own, so the result is deterministic.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function spaceScenery<T extends Record<string, any>>(
  source: T,
  resources: readonly Resource[],
): T {
  const scenery = source as unknown as Scenery;
  const steep = (kind: keyof typeof MAX_GRADE, item: Placement, radius: number) =>
    footprintGrade(item.x, item.z, radius, kind === 'grass') > MAX_GRADE[kind];
  // Every solid footprint once more, for the ground cover's single check.
  const fixed = new Discs(),
    solids = new Discs();
  const fix = (disc: Disc) => {
    fixed.add(disc);
    solids.add(disc);
  };
  for (const r of resources) fix({ x: r.x, z: r.z, radius: resourceRadius(r) });
  const props = scenery.props.filter((item) => !steep('prop', item, footprintRadius(item)));
  for (const item of [...scenery.tents, ...scenery.fires, ...props])
    fix({ x: item.x, z: item.z, radius: footprintRadius(item) });
  const rocks = new Discs();
  const keptRocks = scenery.rocks.filter((item) => {
    const radius = footprintRadius(item);
    if (steep('rock', item, radius)) return false;
    if (fixed.crowds(item.x, item.z, radius, (d) => d.radius + radius + SPACING.rockFromObject))
      return false;
    if (rocks.crowds(item.x, item.z, radius, (d) => d.radius + radius + SPACING.rockFromRock))
      return false;
    rocks.add({ x: item.x, z: item.z, radius });
    solids.add({ x: item.x, z: item.z, radius });
    return true;
  });
  const crowns = new Discs();
  const keptTrees = scenery.trees.filter((item) => {
    const stem = trunkRadius(item),
      crown = footprintRadius(item);
    if (steep('tree', item, Math.max(1, stem * 3))) return false;
    const gap = (d: Disc) =>
      Math.max(
        d.radius + stem + SPACING.trunkFromObject,
        d.radius + crown * SPACING.crownOverObject,
      );
    if (fixed.crowds(item.x, item.z, crown, gap)) return false;
    if (rocks.crowds(item.x, item.z, stem, (d) => d.radius + stem + SPACING.trunkFromRock))
      return false;
    if (crowns.crowds(item.x, item.z, crown, (d) => (d.radius + crown) * SPACING.crowns))
      return false;
    crowns.add({ x: item.x, z: item.z, radius: crown });
    solids.add({ x: item.x, z: item.z, radius: stem });
    return true;
  });
  const outside = (d: Disc) => d.radius + SPACING.grassFromSolid;
  const keptGrass = scenery.grass.filter((item) => {
    const radius = footprintRadius(item);
    return !steep('grass', item, radius) && !solids.crowds(item.x, item.z, radius, outside);
  });
  return { ...source, trees: keptTrees, grass: keptGrass, rocks: keptRocks, props };
}
