import type { SceneryPlacement, EnemyGround } from './types.mjs';
import { WORLD, INITIAL_RESOURCES } from './world.mjs';
import { riverX, riverHalfWidth } from './terrain.mjs';
import {
  biomeAt,
  biomeById,
  biomeWeights,
  chunkDescription,
  JOURNEY_STOPS,
  roadDistance,
} from './biomes.mjs';
import { nearLandmark } from './landmarks.mjs';
import { CASTLE_SORCERER_POST, nearCastle } from './castle-layout.mjs';
import { BIOME_SCENERY } from './biome-scenery.mjs';
import {
  isLand,
  legacySceneryLand,
  legacySceneryBiome,
  EARTH,
  EXPEDITION_STOPS,
  worldToGeo,
} from './paleo-geography.mjs';
import { inLegacyGulf, LEGACY_RESOURCE_POINTS } from './gulf-legacy.mjs';
import { ADVENTURE_ENEMIES, adventureReserved } from './adventure-regions.mjs';
import { ADVENTURE_SCENERY } from './adventure-layout.mjs';
import { inGulf, GULF_SCENERY, gulfLandDistance, gulfActivitySpace } from './gulf-region.mjs';
import { inBehemothClearing, inBehemothPool } from './behemoth-rules.mjs';
import { SABERTOOTH, SABERTOOTH_GROUND } from './sabertooth-rules.mjs';
// Body-sized animals need a continuous clearing, not just a free spawn point.
// Existing harvestable resources sit outside the five-metre roaming footprint.
export const HUNTING_GROUNDS = Object.freeze([
  Object.freeze({ x: 25, z: 21, radius: 10, roamRadius: 5 }),
  Object.freeze({ x: 24, z: 85, radius: 10, roamRadius: 5 }),
]);
export const ENEMY_GROUNDS: readonly EnemyGround[] = Object.freeze([
  // 2026-09-12 (later the same day): the sorcerer stands in the roofless great
  // hall on top of the rebuilt ruin, where the fight takes place.
  Object.freeze({
    id: 'crow-shaman-1',
    x: CASTLE_SORCERER_POST.x,
    z: CASTLE_SORCERER_POST.z,
    radius: 6,
    roamRadius: 3.2,
  }),
  ...ADVENTURE_ENEMIES,
]);
const inHuntingGround = (x, z, margin = 0) =>
  HUNTING_GROUNDS.some((ground) => Math.hypot(x - ground.x, z - ground.z) < ground.radius + margin);
export const inSabertoothClearing = (x, z, margin = 0) =>
  Math.hypot(x - SABERTOOTH_GROUND.x, z - SABERTOOTH_GROUND.z) <
  SABERTOOTH_GROUND.radius + SABERTOOTH_GROUND.roamRadius + 4 + margin;
// Trees are cleared from the whole territory and a little beyond it.
export const inSabertoothTreeClearing = (x, z, margin = 0) =>
  Math.hypot(x - SABERTOOTH_GROUND.x, z - SABERTOOTH_GROUND.z) <
  SABERTOOTH.territoryRadius + 4 + margin;
const inEnemyGround = (x, z, margin = 0) =>
  ENEMY_GROUNDS.some((ground) => Math.hypot(x - ground.x, z - ground.z) < ground.radius + margin);
export function seededRandom(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const TAU = Math.PI * 2;
// 2026-09-10: keep 60% of the previous ground-cover spots; of those, 35 points
// stay tufts and 25 points become sparse sprigs (grassland only).
const GRASS_KEEP = 0.6,
  GRASS_TUFT = 0.35,
  GROUNDCOVER_HEIGHT = { 'meadow-grass': 0.55, 'meadow-sprig': 0.45 };
// Share of grassland cover spots that are tufts (the rest are sprigs); the
// ground colour match in src/paleo-materials.ts weights the two blade greens by it.
export const GROUNDCOVER_TUFT_SHARE = GRASS_TUFT / GRASS_KEEP;
const SCATTER_RESOURCES = [
  ...INITIAL_RESOURCES.filter((r) => !r.id.startsWith('gulf-')),
  ...LEGACY_RESOURCE_POINTS,
];
const scatterBiomeAt = (x, z) => biomeById(legacySceneryBiome(x, z));
function layout() {
  // 2026-09-10: the user asked for a much sparser forest. Thinning draws from
  // its own seeded stream so grass, rocks and every other placement keep their
  // previous positions.
  const TREE_KEEP = 0.4,
    thin = seededRandom(20260910);
  // Ground cover is thinned the same way; some surviving spots become a lone
  // one-or-two-blade sprig instead of a tuft so the meadow reads as scattered.
  const grassThin = seededRandom(20260911);
  const rng = seededRandom(404),
    trees = [],
    grass = [],
    rocks = [],
    ridges = [];
  for (let i = 0; i < 840; i++) {
    const x = -35 + rng() * 170,
      z = -35 + rng() * 170;
    if (!legacySceneryLand(x, z, 3)) continue;
    if (
      Math.hypot(x - 50, z - 50) < 14 ||
      Math.hypot(x - 70, z - 41) < 7 ||
      Math.abs(x - riverX(z)) < 9 ||
      Math.abs(x - 49 - Math.sin(z * 0.16) * 2) < 2.7 ||
      (x > 43 && x < 80 && Math.abs(z - 43.5) < 2.8)
    )
      continue;
    if (SCATTER_RESOURCES.some((r) => Math.hypot(r.x - x, r.z - z) < 2)) continue;
    const height = 6 + rng() * 7,
      width = 0.75 + rng() * 0.5,
      yaw = rng() * TAU;
    if (inHuntingGround(x, z, 1.5) || inEnemyGround(x, z, 1.5)) continue;
    const biome = scatterBiomeAt(x, z).id,
      palette = BIOME_SCENERY[biome];
    if (palette.tree && thin() < TREE_KEEP)
      trees.push({
        key: palette.tree,
        x,
        z,
        height,
        yaw,
        scale: [(width * height) / 10, height / 10, (width * height) / 10],
        biome,
        surface: palette.surface ?? null,
      });
  }
  for (let i = 0; i < 13500; i++) {
    const x = rng() * 115 - 7,
      z = rng() * 115 - 7;
    if (!isLand(x, z, 1) || biomeAt(x, z).id !== 'grassland') continue;
    if (
      Math.hypot(x - 50, z - 50) < 10 ||
      Math.hypot(x - 70, z - 41) < 5 ||
      Math.abs(x - riverX(z)) < 3.4 ||
      Math.abs(x - 49 - Math.sin(z * 0.16) * 2) < 1.8 ||
      (x > 45 && x < 78 && Math.abs(z - 43.5) < 1.9)
    )
      continue;
    const scale = 0.65 + rng() * 0.65,
      yaw = rng() * TAU,
      roll = grassThin();
    if (roll >= GRASS_KEEP) continue;
    const key = roll < GRASS_TUFT ? 'meadow-grass' : 'meadow-sprig';
    grass.push({ key, x, z, scale, height: GROUNDCOVER_HEIGHT[key] * scale, yaw });
  }
  for (let i = 0; i < 65; i++) {
    const x = rng() * 140 - 20,
      z = rng() * 140 - 20;
    if (!isLand(x, z, 5)) continue;
    if (
      Math.hypot(x - 50, z - 50) < 16 ||
      Math.hypot(x - 70, z - 41) < 7 ||
      Math.abs(x - riverX(z)) < 10
    )
      continue;
    const scale = (0.4 + rng() * 2.6) / 1.7,
      yaw = rng() * TAU;
    if (inHuntingGround(x, z, 3.5) || inEnemyGround(x, z, 3.5)) continue;
    const biome = biomeAt(x, z).id;
    rocks.push({
      key: 'valley-boulder',
      x,
      z,
      yaw,
      scale,
      biome,
      surface: BIOME_SCENERY[biome].surface ?? null,
    });
  }
  // Remove the old enclosing ring of giant rocks. Outlying regions are physically
  // connected, with deterministic colliders shared by server and client.
  const distant = seededRandom(902107);
  for (let i = 0; i < 38000; i++) {
    const x = EARTH.minX + 12 + distant() * (EARTH.width - 24),
      z = EARTH.minZ + 12 + distant() * (EARTH.height - 24);
    if (!legacySceneryLand(x, z, 5)) continue;
    if (x > -36 && x < 136 && z > -36 && z < 136) continue;
    if (nearLandmark(x, z, 2) || adventureReserved(x, z, 4)) continue;
    const biome = scatterBiomeAt(x, z),
      roll = distant();
    if (
      roadDistance(x, z) < 5 ||
      EXPEDITION_STOPS.some((stop) => Math.hypot(x - stop.x, z - stop.z) < 16)
    )
      continue;
    if (SCATTER_RESOURCES.some((r) => Math.hypot(x - r.x, z - r.z) < 3)) continue;
    if (riverHalfWidth(z) > 0.7 && Math.abs(x - riverX(z)) < 9) continue;
    const lat = worldToGeo(x, z).latitude;
    if (
      (biome.id === 'grassland' && Math.abs(lat) > 34 && roll < 0.6) ||
      (biome.id === 'snow' && lat < 65 && roll < 0.42)
    ) {
      const height = 5 + distant() * 7,
        width = 0.75 + distant() * 0.45;
      if (thin() >= TREE_KEEP) continue;
      trees.push({
        key: 'valley-pine',
        x,
        z,
        height,
        yaw: distant() * TAU,
        scale: [(width * height) / 10, height / 10, (width * height) / 10],
        biome: biome.id,
        surface: BIOME_SCENERY[biome.id].surface ?? null,
      });
    } else if (roll > 0.88) {
      const scale = 0.35 + distant() * 1.6;
      rocks.push({
        key: 'valley-boulder',
        x,
        z,
        yaw: distant() * TAU,
        scale,
        biome: biome.id,
        surface: BIOME_SCENERY[biome.id].surface ?? null,
      });
    }
  }
  const tents: SceneryPlacement[] = [
    [45, 46, 0.4, 1],
    [54.5, 44, -0.55, 0.85],
    [54, 55, -2, 0.65],
    [73, 37, -0.7, 0.85],
  ].map(([x, z, yaw, scale]) => ({ key: 'hide-tent', x, z, yaw, scale }));
  const props: SceneryPlacement[] = [
    { key: 'drying-rack', x: 55.8, z: 50, yaw: 0, scale: 1 },
    { key: 'firewood-pile', x: 47, z: 49, yaw: 0, scale: 1.25 },
  ];
  const fires: SceneryPlacement[] = [
    { key: 'stone-firepit', x: 50, z: 50, yaw: 0, scale: 1 },
    // Kept clear of the footbridge's east landing (x≈71, z 42–45) so the crossing stays open.
    { key: 'stone-firepit', x: 75, z: 40, yaw: 0, scale: 0.65 },
  ];
  for (const stop of EXPEDITION_STOPS.filter((s) => s.id !== 'grassland')) {
    const biome = biomeAt(stop.x, stop.z).id,
      palette = BIOME_SCENERY[biome];
    tents.push({
      key: palette.shelter,
      x: stop.x - 6,
      z: stop.z - 5,
      yaw: 0.55,
      scale: biome === 'desert' ? [1.05, 0.62, 1] : biome === 'ice' ? 0.72 : 0.85,
      biome,
      surface: palette.surface,
    });
    fires.push({
      key: palette.hearth,
      id: `fire-${stop.id}`,
      x: stop.x + 2,
      z: stop.z - 1,
      yaw: 0,
      scale: 0.8,
      biome,
      surface: palette.surface,
    });
  }
  // The dry regions use weathered fallen wood, not living valley conifers.
  const dry = seededRandom(6090701);
  for (let i = 0; i < 360; i++) {
    const x = EARTH.minX + 40 + dry() * (EARTH.width - 80),
      z = EARTH.minZ + 40 + dry() * (EARTH.height - 80),
      biome = scatterBiomeAt(x, z).id;
    if (!legacySceneryLand(x, z, 3) || adventureReserved(x, z, 4)) continue;
    if (!['desert', 'volcano'].includes(biome) || roadDistance(x, z) < 4 || nearLandmark(x, z, 3))
      continue;
    if (
      EXPEDITION_STOPS.some((p) => Math.hypot(x - p.x, z - p.z) < 16) ||
      SCATTER_RESOURCES.some((p) => Math.hypot(x - p.x, z - p.z) < 4)
    )
      continue;
    if (
      rocks.some((p) => Math.hypot(x - p.x, z - p.z) < 3 + 2.5 * p.scale) ||
      props.some((p) => Math.hypot(x - p.x, z - p.z) < 4)
    )
      continue;
    props.push({
      key: 'firewood-pile',
      x,
      z,
      yaw: dry() * TAU,
      scale: 0.65 + dry() * 0.5,
      biome,
      surface: BIOME_SCENERY[biome].surface,
    });
  }
  // One size up from the delivered 3.6 m GLB; collision radius and speed follow the scale.
  const animals = HUNTING_GROUNDS.map((ground, index) => ({
    id: `mammoth-${index + 1}`,
    x: ground.x,
    z: ground.z,
    scale: (index ? 0.76 : 1) * 1.25,
    roamRadius: ground.roamRadius,
  }));
  trees.push(...ADVENTURE_SCENERY.trees);
  props.push(...ADVENTURE_SCENERY.props);
  fires.push(...ADVENTURE_SCENERY.fires);
  // Reserve the authored settlement and footpaths from global random scenery.
  for (const items of [trees, grass, rocks, ridges, tents, props, fires])
    for (let i = items.length - 1; i >= 0; i--)
      if (inGulf(items[i].x, items[i].z) || inLegacyGulf(items[i].x, items[i].z))
        items.splice(i, 1);
  for (const [category, items] of Object.entries(GULF_SCENERY)) {
    const target = { trees, props, fires }[category];
    target.push(...items.filter((item) => gulfLandDistance(item.x, item.z) > 8));
  }
  // A continuous open marsh near the European camp. Preserve deterministic
  // placements outside it; existing tufts stay inside as marsh grass, thinned
  // and never standing in a pool.
  for (const items of [trees, rocks, ridges])
    for (let i = items.length - 1; i >= 0; i--)
      if (inBehemothClearing(items[i].x, items[i].z, 3)) items.splice(i, 1);
  // The sabertooth's snow-plain hunting ground is open: rocks are cleared
  // around its post so a pounce has room to land, and at the user's request
  // (2026-09-11) no tree stands anywhere in its territory.
  for (const items of [rocks, ridges])
    for (let i = items.length - 1; i >= 0; i--)
      if (inSabertoothClearing(items[i].x, items[i].z, 2)) items.splice(i, 1);
  for (let i = trees.length - 1; i >= 0; i--)
    if (inSabertoothTreeClearing(trees[i].x, trees[i].z)) trees.splice(i, 1);
  for (let i = grass.length - 1; i >= 0; i--)
    if (
      inBehemothClearing(grass[i].x, grass[i].z) &&
      (i % 4 !== 0 || inBehemothPool(grass[i].x, grass[i].z, 0.6))
    )
      grass.splice(i, 1);
  return Object.fromEntries(
    Object.entries({ trees, grass, rocks, ridges, tents, props, fires, animals }).map(
      ([key, items]) => [key, items.filter((item) => !nearCastle(item.x, item.z, 3))],
    ),
  );
}
// Renderer and authoritative server use precisely the same placements and scales.
export const SCENERY = layout();
export function grassForChunk(ix, iz) {
  const chunk = chunkDescription(ix, iz),
    rng = seededRandom(
      Math.imul(Math.floor((chunk.x - EARTH.minX) / 32) + 31, 73856093) ^
        Math.imul(Math.floor((chunk.z - EARTH.minZ) / 32) + 31, 19349663),
    ),
    grass = [],
    thin = seededRandom(
      Math.imul(Math.floor((chunk.x - EARTH.minX) / 32) + 7, 83492791) ^
        Math.imul(Math.floor((chunk.z - EARTH.minZ) / 32) + 7, 2654435761),
    );
  for (let i = 0; i < 250; i++) {
    const x = chunk.x + (rng() - 0.5) * 32,
      z = chunk.z + (rng() - 0.5) * 32;
    if (!isLand(x, z, 0.8)) continue;
    if (gulfActivitySpace(x, z)) continue;
    if (x >= -7 && x <= 108 && z >= -7 && z <= 108) continue;
    const biome = biomeAt(x, z).id,
      palette = BIOME_SCENERY[biome];
    const weight =
      biome === 'grassland'
        ? biomeWeights(x, z)[0]
        : biome === 'snow'
          ? 0.025
          : biome === 'desert'
            ? 0.1
            : 0;
    if (!palette.groundcover) continue;
    if (nearLandmark(x, z, 1) || adventureReserved(x, z, 0)) continue;
    if (
      rng() > weight ||
      roadDistance(x, z) < 1.5 ||
      (riverHalfWidth(z) > 0.7 && Math.abs(x - riverX(z)) < 4)
    )
      continue;
    const scale = 0.6 + rng() * 0.65,
      yaw = rng() * TAU,
      roll = thin();
    if (roll >= GRASS_KEEP) continue;
    const key =
      palette.groundcover === 'meadow-grass' && biome === 'grassland' && roll >= GRASS_TUFT
        ? 'meadow-sprig'
        : palette.groundcover;
    grass.push({
      key,
      x,
      z,
      scale,
      height: (biome === 'snow' ? 0.9 : (GROUNDCOVER_HEIGHT[key] ?? 0.55)) * scale,
      yaw,
      biome,
      surface: palette.surface ?? null,
    });
  }
  return grass.filter(
    (item, i) =>
      !nearCastle(item.x, item.z, 1) &&
      (!inBehemothClearing(item.x, item.z) ||
        (i % 4 === 0 && !inBehemothPool(item.x, item.z, 0.6))),
  );
}
export const BRIDGE = {
  x: riverX(43.5),
  z: 43.5,
  minX: -5.121252209981283,
  maxX: 4.988082171758016,
  minZ: -1.2622603230953215,
  maxZ: 1.3524676167488099,
};
