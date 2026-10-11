// The baked world data (scripts/bake-world-data.mjs) must decode to exactly what its sources
// give: rebuilding from the source data and code and comparing catches a stale bake.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCoastGrids } from '../dist/shared/paleo-coast-build.mjs';
import { COAST_RUNS } from '../dist/shared/paleo-coast-data.mjs';
import { COAST_BAKED } from '../dist/shared/paleo-coast-baked.mjs';
import { decodeRuns, decodeScaledDeltas, patchGrid } from '../dist/shared/baked-data.mjs';
import { coastTextureData, legacySceneryLand, EARTH } from '../dist/shared/paleo-geography.mjs';
import { CAMP_MOUNTAIN_SURFACE_DATA as MOUNTAIN_SOURCE } from '../dist/shared/camp-mountain-surface-data.mjs';
import { CAMP_MOUNTAIN_SURFACE_DATA as MOUNTAIN_BAKED } from '../dist/shared/camp-mountain-surface-baked.mjs';
import { CASTLE_SURFACE_DATA as CASTLE_SOURCE } from '../dist/shared/castle-surface-data.mjs';
import { CASTLE_SURFACE_DATA as CASTLE_BAKED } from '../dist/shared/castle-surface-baked.mjs';

const same = (a, b) =>
  a.length === b.length && Array.prototype.every.call(a, (v, i) => Object.is(v, b[i]));

test('the baked shoreline grids are the bytes the source runs derive', () => {
  assert.ok(COAST_RUNS.length > 0, 'the runtime no longer consumes the source runs');
  const grids = buildCoastGrids(),
    base = decodeRuns(COAST_BAKED.base.runs, grids.base.data.length),
    world = new Uint8Array(grids.coast.data.length);
  assert.deepEqual(
    [COAST_BAKED.cell, COAST_BAKED.world.baseX, COAST_BAKED.world.baseZ],
    [grids.cell, grids.offset.x, grids.offset.z],
  );
  for (let row = 0; row < grids.base.height; row++)
    world.set(
      base.subarray(row * grids.base.width, (row + 1) * grids.base.width),
      (row + grids.offset.z) * grids.coast.width + grids.offset.x,
    );
  if (COAST_BAKED.basePatch) patchGrid(base, grids.base.width, COAST_BAKED.basePatch);
  if (COAST_BAKED.worldPatch) patchGrid(world, grids.coast.width, COAST_BAKED.worldPatch);
  assert.ok(same(base, grids.base.data), 'Earth grid');
  assert.ok(same(world, grids.coast.data), 'world grid');
  // What paleo-geography serves at runtime is that world grid, and its legacy scatter test reads
  // that Earth grid.
  assert.ok(same(coastTextureData().data, grids.coast.data), 'runtime world grid');
  const B = grids.base;
  let compared = 0;
  for (let iz = 0; iz < B.height - 1; iz += 7)
    for (let ix = 0; ix < B.width - 1; ix += 7) {
      const x = EARTH.minX + (ix + 0.8) * grids.cell,
        z = EARTH.minZ + (iz + 0.3) * grids.cell;
      const u = (x - EARTH.minX) / grids.cell - 0.5,
        v = (z - EARTH.minZ) / grids.cell - 0.5,
        jx = Math.min(B.width - 2, Math.floor(u)),
        jz = Math.min(B.height - 2, Math.floor(v)),
        fx = u - jx,
        fz = v - jz,
        i = jz * B.width + jx,
        d = B.data;
      const value =
        ((d[i] * (1 - fx) + d[i + 1] * fx) * (1 - fz) +
          (d[i + B.width] * (1 - fx) + d[i + B.width + 1] * fx) * fz -
          128) /
        4;
      for (const margin of [0, 3, 5]) assert.equal(legacySceneryLand(x, z, margin), value > margin);
      compared++;
    }
  assert.ok(compared > 40000);
});

test('the baked walk surfaces hold every source value exactly, nulls included', () => {
  for (const [label, source, baked] of [
    ['camp mountain', MOUNTAIN_SOURCE, MOUNTAIN_BAKED],
    ['castle', CASTLE_SOURCE, CASTLE_BAKED],
  ]) {
    assert.deepEqual(Object.keys(baked), Object.keys(source), `${label} keys and order`);
    for (const key of Object.keys(source)) {
      if (key === 'heights') {
        assert.ok(Array.isArray(baked.heights), `${label} heights stay an array`);
        assert.ok(same(baked.heights, source.heights), `${label} heights`);
      } else assert.deepEqual(baked[key], source[key], `${label} ${key}`);
    }
  }
});

test('exact-decimal deltas round-trip nulls, signs and runs of equal values', () => {
  const values = [0, 0, 1.25, -0.5, null, null, 30.528, 30.528, -2, null, 12.3];
  const scale = 1000,
    codes = [];
  let previous = 0;
  for (const v of values) {
    if (v === null) {
      codes.push(0);
      continue;
    }
    const k = Math.round(v * scale),
      delta = k - previous;
    previous = k;
    let code = (delta >= 0 ? 2 * delta : -2 * delta - 1) + 1;
    do {
      let byte = code % 128;
      code = Math.floor(code / 128);
      if (code) byte |= 0x80;
      codes.push(byte);
    } while (code);
  }
  const text = Buffer.from(codes).toString('hex');
  assert.ok(same(decodeScaledDeltas(text, values.length, scale), values));
  assert.throws(() => decodeScaledDeltas(text, values.length - 1, scale), /exceed/);
  assert.throws(() => decodeRuns('0105', 6), /fill/);
});

test('the baked scenery answers replay to exactly the live scatter', async () => {
  const { recordSceneryAnswers, SCENERY_QUESTION_NAMES } =
    await import('../dist/shared/scenery-scatter.mjs');
  const { SCENERY } = await import('../dist/shared/scenery-layout.mjs');
  const { SCENERY_ANSWERS } = await import('../dist/shared/scenery-answers-baked.mjs');
  const { scenery, answers } = recordSceneryAnswers();
  // The baked answers are the live ones, question by question (a stale bake fails here).
  for (const name of SCENERY_QUESTION_NAMES) {
    const entry = SCENERY_ANSWERS.answers[name];
    assert.ok(entry, `${name} is baked`);
    const baked =
      entry.bits !== undefined
        ? (await import('../dist/shared/baked-data.mjs')).decodeBits(entry.bits, entry.count)
        : (await import('../dist/shared/baked-data.mjs')).decodeIndices(
            entry.ids,
            entry.count,
            SCENERY_ANSWERS.ids,
          );
    assert.ok(same(baked, answers[name]), `${name} answers`);
  }
  // And the served scenery is the live scatter, key for key (undefined-valued keys included).
  assert.deepEqual(Object.keys(SCENERY), Object.keys(scenery));
  for (const category of Object.keys(scenery)) {
    assert.equal(SCENERY[category].length, scenery[category].length, category);
    scenery[category].forEach((item, i) => {
      const served = SCENERY[category][i];
      assert.deepEqual(Object.keys(served), Object.keys(item), `${category} ${i} keys`);
      for (const key of Object.keys(item))
        if (Array.isArray(item[key]))
          assert.ok(same(served[key], item[key]), `${category} ${i} ${key}`);
        else assert.ok(Object.is(served[key], item[key]), `${category} ${i} ${key}`);
    });
  }
});
