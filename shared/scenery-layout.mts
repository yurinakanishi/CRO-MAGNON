// The scenery the renderer and the authoritative server share. The global scatter
// (shared/scenery-scatter.mts) replays the answers baked by scripts/bake-world-data.mjs
// (shared/scenery-answers-baked.mts): the same placements as answering live, without evaluating
// biome weights and distances for every candidate on every load. tests/world-bake.test.mjs
// compares both.
import { riverX, riverHalfWidth } from './terrain.mjs';
import { biomeAt, biomeWeights, chunkDescription, roadDistance } from './biomes.mjs';
import { nearLandmark } from './landmarks.mjs';
import { nearCastle } from './castle-layout.mjs';
import { campLandformReserved } from './camp-cave-layout.mjs';
import { mountainRiverContains } from './mountain-river.mjs';
import { BIOME_SCENERY } from './biome-scenery.mjs';
import { isLand, EARTH } from './paleo-geography.mjs';
import { adventureReserved } from './adventure-regions.mjs';
import { gulfActivitySpace } from './gulf-region.mjs';
import { inBehemothClearing, inBehemothPool } from './behemoth-rules.mjs';
import { decodeBits, decodeIndices } from './baked-data.mjs';
import { SCENERY_ANSWERS } from './scenery-answers-baked.mjs';
import {
  scatterScenery,
  seededRandom,
  SCENERY_QUESTION_NAMES,
  TAU,
  GRASS_KEEP,
  GRASS_TUFT,
  GROUNDCOVER_HEIGHT,
  type SceneryQuestions,
} from './scenery-scatter.mjs';
export {
  HUNTING_GROUNDS,
  ENEMY_GROUNDS,
  GROUNDCOVER_TUFT_SHARE,
  inSabertoothClearing,
  inSabertoothTreeClearing,
  seededRandom,
} from './scenery-scatter.mjs';

type BakedAnswers = {
  ids: readonly string[];
  answers: Record<string, { count: number; bits?: string; ids?: string }>;
};
/** The scatter with every question answered from `baked`, which must hold exactly its answers. */
export function replayScenery(baked: BakedAnswers) {
  const answers: Record<string, (boolean | string)[]> = {};
  for (const [name, entry] of Object.entries(baked.answers))
    answers[name] =
      entry.bits !== undefined
        ? decodeBits(entry.bits, entry.count)
        : decodeIndices(entry.ids, entry.count, baked.ids);
  const asked: Record<string, number> = {};
  const ask = Object.fromEntries(
    SCENERY_QUESTION_NAMES.map((name) => {
      const list = answers[name];
      if (!list) throw new Error(`Baked scenery holds no answers for ${name}`);
      asked[name] = 0;
      return [
        name,
        () => {
          if (asked[name] >= list.length)
            throw new Error(`Baked scenery ran out of ${name} answers`);
          return list[asked[name]++];
        },
      ];
    }),
  ) as unknown as SceneryQuestions;
  const scenery = scatterScenery(ask);
  for (const name of SCENERY_QUESTION_NAMES)
    if (asked[name] !== answers[name].length)
      throw new Error(
        `Baked scenery answers for ${name} do not match the scatter; run scripts/bake-world-data.mjs`,
      );
  return scenery;
}
// Renderer and authoritative server use precisely the same placements and scales.
export const SCENERY = replayScenery(SCENERY_ANSWERS);
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
      !campLandformReserved(item.x, item.z) &&
      !mountainRiverContains(item.x, item.z, 2.5) &&
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
