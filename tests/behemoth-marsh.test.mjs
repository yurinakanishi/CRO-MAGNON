import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BEHEMOTH,
  BEHEMOTH_GROUND,
  BEHEMOTH_MARSH,
  marshDrop,
  marshBasin,
  inBehemothPool,
  inBehemothClearing,
} from '../dist/shared/behemoth-rules.mjs';
import { installSourceTerrain, terrainHeight, walkHeight } from '../dist/shared/terrain.mjs';
import { SCENERY, grassForChunk } from '../dist/shared/scenery-layout.mjs';
import { WORLD } from '../dist/shared/world.mjs';

test('the marsh is a shallow basin with pools on its floor and a firm dry rim', () => {
  const M = BEHEMOTH_MARSH;
  assert.equal(marshDrop(M.x, M.z), M.basinDepth);
  assert.equal(marshDrop(M.x + M.radius + 0.01, M.z), 0);
  assert.equal(marshDrop(M.x, M.z - M.radius), 0);
  const rim = marshBasin(M.x + M.radius - 1, M.z);
  assert.ok(rim > 0 && rim < 0.1);
  assert.ok(M.waterLift > 0 && M.waterLift < 0.2);
  for (const pool of M.pools) {
    // Every pool lies on the level basin floor, fully inside the territory.
    for (const [x, z] of [
      [pool.x, pool.z],
      [pool.x + pool.radius, pool.z],
      [pool.x, pool.z - pool.radius],
    ])
      assert.ok(Math.abs(marshDrop(x, z) - M.basinDepth) < 1e-9, `level floor at ${x},${z}`);
    assert.ok(Math.hypot(pool.x - M.x, pool.z - M.z) + pool.radius < BEHEMOTH.territoryRadius);
  }
  // Continuous floor: nothing steps for the collision surface or the drawn terrain.
  for (let x = M.x - M.radius - 2; x <= M.x + M.radius + 2; x += 0.5)
    for (let z = M.z - M.radius - 2; z <= M.z + M.radius + 2; z += 0.5)
      assert.ok(Math.abs(marshDrop(x + 0.01, z) - marshDrop(x, z)) < 0.006);
});

test('the guard post and its body stay out of every pool', () => {
  const home = BEHEMOTH_GROUND;
  assert.equal(inBehemothPool(home.x, home.z, BEHEMOTH.radius + 1), false);
  assert.equal(inBehemothClearing(home.x, home.z), true);
});

test('the shared walk surface sinks into the marsh and the pools', () => {
  const restore = installSourceTerrain({
    resolution: 2,
    heights: [0, 0, 0, 0],
    tileSize: 20,
    origin: -90,
  });
  try {
    const M = BEHEMOTH_MARSH,
      pool = M.pools[0];
    assert.equal(terrainHeight(M.x, M.z), -M.basinDepth);
    assert.ok(Math.abs(terrainHeight(pool.x, pool.z) + M.basinDepth) < 1e-9);
    assert.equal(terrainHeight(M.x + M.radius + 5, M.z), 0);
    assert.equal(walkHeight(pool.x, pool.z), terrainHeight(pool.x, pool.z));
  } finally {
    restore();
  }
});

test('marsh grass stays as tufts between the pools; trees and rocks stay out', () => {
  const inside = (item, margin = 0) => inBehemothClearing(item.x, item.z, margin);
  assert.equal(SCENERY.trees.filter((t) => inside(t, 3)).length, 0);
  assert.equal(SCENERY.rocks.filter((r) => inside(r, 3)).length, 0);
  const tufts = SCENERY.grass.filter((g) => inside(g));
  assert.ok(tufts.length > 40, `marsh tufts ${tufts.length}`);
  assert.equal(tufts.filter((g) => inBehemothPool(g.x, g.z, 0.6)).length, 0);
  let generated = 0;
  for (const [x, z] of [
    [112, 118],
    [100, 120],
    [118, 100],
  ]) {
    const grass = grassForChunk(
      Math.floor((x - WORLD.minX) / 32),
      Math.floor((z - WORLD.minZ) / 32),
    ).filter((g) => inside(g));
    generated += grass.length;
    assert.equal(grass.filter((g) => inBehemothPool(g.x, g.z, 0.6)).length, 0);
  }
  assert.ok(generated > 0);
});
