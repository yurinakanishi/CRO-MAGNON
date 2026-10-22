import type { Resource, ResourceKind } from './types.mjs';
import { characterSpeciesReleased } from './character-roster.mjs';
import { EARTH, EXPEDITION_STOPS, geographicBiome } from './paleo-geography.mjs';
import { ADVENTURE_RESOURCES } from './adventure-regions.mjs';
import { GULF_RESOURCES, OBSIDIAN_OUTCROPS } from './gulf-region.mjs';
import { WORLD_BOUNDS } from './world-bounds.mjs';
export const WORLD = Object.freeze({
  version: 4,
  size: WORLD_BOUNDS.width,
  ...WORLD_BOUNDS,
  chunkSize: 32,
  edgeMargin: 2,
  // Human tribes. 2026-09-11: everyone moves faster; the order stays
  // great ape > kunoichi > humans > mage (see shared/characters.mts).
  walkSpeed: 2.0,
  runSpeed: 5.6,
  playerRadius: 0.32,
  maxPlayers: 5,
});
export const worldClamp = (value, axis = 'x') =>
  Math.max(
    WORLD[axis === 'x' ? 'minX' : 'minZ'] + WORLD.edgeMargin,
    Math.min(WORLD[axis === 'x' ? 'maxX' : 'maxZ'] - WORLD.edgeMargin, value),
  );

export const CAMP = Object.freeze({
  x: 50,
  z: 50,
  wood: 0,
  stone: 0,
  level: 0,
  goalWood: 12,
  goalStone: 6,
  caveFireLit: false,
});

export const RETAINED_TRADER = Object.freeze({
  x: 70,
  z: 41,
  name: 'オル',
  species: 'nea',
  gender: 'male',
  greeting: '火は、ひとりでは守れない。木か石を2つ、ベリー3つと交換しよう。',
});
export const NPC = characterSpeciesReleased(RETAINED_TRADER.species) ? RETAINED_TRADER : undefined;

// 2026-10-14: piles that stood in the valley river, on its bank or on the mountain's foothill
// slopes moved to the nearest dry, flat, clear ground (ids and stock kept; saves match by id).
const nodes: [ResourceKind, number, number, number][] = [
  ['wood', 56, 62, 7],
  ['wood', 58.5, 69.5, 7],
  ['wood', 68, 58, 6],
  ['wood', 30, 54, 7],
  ['wood', 26, 60, 6],
  ['wood', 25, 42, 8],
  // Keep the mammoth arrival view clear; the same wood node sits farther behind it.
  ['wood', 35, 43, 6],
  ['wood', 39, 23, 7],
  ['wood', 57, 24, 7],
  ['wood', 77, 29, 6],
  ['wood', 82, 54, 8],
  ['wood', 64, 77.5, 6],
  ['wood', 33.5, 57, 7],
  ['wood', 15.5, 64.5, 8],
  ['wood', 86, 75, 7],
  ['stone', 43, 63, 6],
  ['stone', 37, 60, 6],
  ['stone', 60, 37, 7],
  ['stone', 20, 33, 8],
  ['stone', 79, 68, 6],
  ['stone', 21.5, 59, 7],
  ['stone', 82, 19, 8],
  ['stone', 16, 51, 6],
  ['berry', 71, 53, 5],
  ['berry', 40, 41, 5],
  ['berry', 26.5, 56, 5],
  ['berry', 72, 49, 5],
  ['berry', 49, 28, 5],
  ['berry', 80, 80, 5],
];
for (const stop of EXPEDITION_STOPS.slice(1)) {
  const biome = geographicBiome(stop.x, stop.z);
  nodes.push(['stone', stop.x + 7, stop.z + 6, 8]);
  if (biome !== 'ice') nodes.push(['wood', stop.x - 8, stop.z + 5, 7]);
  if (biome === 'grassland' || biome === 'snow') nodes.push(['berry', stop.x - 4, stop.z + 8, 5]);
}
// 2026-10-22: obsidian just south of the West Asian volcanic fire (+z is south), beside that
// stop's stone and wood, so one visit gathers a whole obsidian spear. Named apart, after every
// older node's id.
const volcano = EXPEDITION_STOPS.find((stop) => stop.id === 'volcano')!;
export const VOLCANO_OBSIDIAN: readonly Resource[] = Object.freeze(
  [
    [1, 12.5],
    [-3, 10.5],
    [-3, 14.5],
  ].map(([dx, dz], i) =>
    Object.freeze({
      id: `obsidian-volcano-${i + 1}`,
      type: 'obsidian' as const,
      x: volcano.x + dx,
      z: volcano.z + dz,
      amount: 8,
      maxAmount: 8,
    }),
  ),
);

export const INITIAL_RESOURCES: readonly Resource[] = Object.freeze([
  ...nodes.map(([type, x, z, amount], index) =>
    Object.freeze({ id: `${type}-${index + 1}`, type, x, z, amount, maxAmount: amount }),
  ),
  ...ADVENTURE_RESOURCES,
  ...GULF_RESOURCES,
  ...OBSIDIAN_OUTCROPS,
  ...VOLCANO_OBSIDIAN,
]);
