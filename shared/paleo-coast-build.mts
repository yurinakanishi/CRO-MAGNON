// Build time only (scripts/bake-world-data.mjs and its test): the shoreline grids derived from
// the NOAA runs, exactly as paleo-geography computed them on every load before they were baked.
import { COAST_GRID, COAST_RUNS } from './paleo-coast-data.mjs';
import { EARTH } from './paleo-earth.mjs';
import { WORLD_BOUNDS } from './world-bounds.mjs';
import { mountainLandDistance, MOUNTAIN_BOUNDS } from './camp-mountain.mjs';
import { LEGACY_GULF, legacyGulfDistance } from './gulf-legacy.mjs';

export function buildCoastGrids() {
  const { cell } = COAST_GRID;
  const width = WORLD_BOUNDS.width / cell,
    height = WORLD_BOUNDS.depth / cell;
  const base = new Uint8Array(COAST_GRID.width * COAST_GRID.height);
  let cursor = 0;
  for (let i = 0; i < COAST_RUNS.length; i += 2) {
    base.fill(COAST_RUNS[i + 1], cursor, cursor + COAST_RUNS[i]);
    cursor += COAST_RUNS[i];
  }
  if (cursor !== base.length) throw new Error('Incomplete verified Earth shoreline');
  const coast = new Uint8Array(width * height);
  const baseX = (EARTH.minX - WORLD_BOUNDS.minX) / cell,
    baseZ = (EARTH.minZ - WORLD_BOUNDS.minZ) / cell;
  for (let row = 0; row < COAST_GRID.height; row++)
    coast.set(
      base.subarray(row * COAST_GRID.width, (row + 1) * COAST_GRID.width),
      (row + baseZ) * width + baseX,
    );
  // Preserve the old global scatter's exact inputs while the playable gulf moves.
  for (
    let iz = (LEGACY_GULF.minZ - EARTH.minZ) / cell;
    iz < (LEGACY_GULF.maxZ - EARTH.minZ) / cell;
    iz++
  )
    for (
      let ix = (LEGACY_GULF.minX - EARTH.minX) / cell;
      ix < (LEGACY_GULF.maxX - EARTH.minX) / cell;
      ix++
    ) {
      const i = iz * COAST_GRID.width + ix;
      const value = Math.max(
        0,
        Math.min(
          255,
          Math.round(
            128 +
              4 *
                legacyGulfDistance(EARTH.minX + (ix + 0.5) * cell, EARTH.minZ + (iz + 0.5) * cell),
          ),
        ),
      );
      if (base[i] <= 128) base[i] = Math.max(base[i], value);
    }
  // Join the new source-derived southern foothill to the existing shoreline.
  // This same grid controls sea rendering, walking, boats and the map.
  for (
    let iz = Math.floor((MOUNTAIN_BOUNDS.minZ - 5 - WORLD_BOUNDS.minZ) / cell);
    iz < Math.ceil((MOUNTAIN_BOUNDS.maxZ + 5 - WORLD_BOUNDS.minZ) / cell);
    iz++
  )
    for (
      let ix = Math.floor((MOUNTAIN_BOUNDS.minX - 5 - WORLD_BOUNDS.minX) / cell);
      ix < Math.ceil((MOUNTAIN_BOUNDS.maxX + 5 - WORLD_BOUNDS.minX) / cell);
      ix++
    ) {
      const d = mountainLandDistance(
        WORLD_BOUNDS.minX + (ix + 0.5) * cell,
        WORLD_BOUNDS.minZ + (iz + 0.5) * cell,
      );
      const value = Math.max(0, Math.min(255, Math.round(128 + 4 * d)));
      coast[iz * width + ix] = Math.max(coast[iz * width + ix], value);
    }
  return {
    cell,
    // The verified Earth grid (the legacy gulf's scatter inputs folded in), the world grid, and
    // where the Earth grid's first cell lies in the world grid.
    base: { width: COAST_GRID.width, height: COAST_GRID.height, data: base },
    coast: { width, height, data: coast },
    offset: { x: baseX, z: baseZ },
  };
}
