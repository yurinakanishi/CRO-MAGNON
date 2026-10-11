// Bake the world data the runtime used to rebuild on every load: the shoreline grids
// (shared/paleo-coast-build.mts), the measured walk surfaces of the camp mountain and the castle,
// and the answers the global scenery scatter asks (shared/scenery-scatter.mts). Each baked module
// holds hexadecimal payloads that shared/baked-data.mts decodes to exactly the bytes, numbers and
// answers of its source; this script proves the round trip before writing.
//
//   node scripts/build.mjs && node scripts/bake-world-data.mjs [--check]
//
// --check writes nothing and fails when a baked module differs from what its sources give
// (tests/world-bake.test.mjs runs the same comparison).
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const dist = (file) => import(new URL(`../dist/${file}`, import.meta.url).href);
const check = process.argv.includes('--check');
const sha256 = async (file) =>
  createHash('sha256')
    .update(await readFile(path.join(root, file)))
    .digest('hex');

// The builder first: the pre-bake paleo-geography cleared the shared runs once it decoded them.
const { buildCoastGrids } = await dist('shared/paleo-coast-build.mjs');
const coastGrids = buildCoastGrids();
const { decodeRuns, decodeScaledDeltas, patchGrid, decodeBits, decodeIndices } =
  await dist('shared/baked-data.mjs');
const { recordSceneryAnswers, scatterScenery, SCENERY_QUESTION_NAMES } = await dist(
  'shared/scenery-scatter.mjs',
);
const { COAST_RUNS } = await dist('shared/paleo-coast-data.mjs');
const { CAMP_MOUNTAIN_SURFACE_DATA } = await dist('shared/camp-mountain-surface-data.mjs');
const { CASTLE_SURFACE_DATA } = await dist('shared/castle-surface-data.mjs');

const leb128 = (out, value) => {
  assert.ok(Number.isSafeInteger(value) && value >= 0, `varint ${value}`);
  do {
    let byte = value % 128;
    value = Math.floor(value / 128);
    if (value) byte |= 0x80;
    out.push(byte);
  } while (value);
};
const hex = (bytes) => Buffer.from(bytes).toString('hex');
/** The rectangle of `to` that differs from `from` (row-major grids of one width), or null. */
function patchOf(from, to, width) {
  let x0 = Infinity,
    z0 = Infinity,
    x1 = -1,
    z1 = -1;
  for (let i = 0; i < to.length; i++)
    if (from[i] !== to[i]) {
      const x = i % width,
        z = Math.floor(i / width);
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      z0 = Math.min(z0, z);
      z1 = Math.max(z1, z);
    }
  if (x1 < 0) return null;
  const values = [];
  for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) values.push(to[z * width + x]);
  return { x: x0, z: z0, width: x1 - x0 + 1, height: z1 - z0 + 1, values: hex(values) };
}
/** The smallest power of ten that holds every value exactly as an integer over it. */
function decimalScale(values) {
  for (let p = 0; p <= 6; p++) {
    const scale = 10 ** p;
    if (
      values.every(
        (v) =>
          v === null ||
          (Number.isSafeInteger(Math.round(v * scale)) && Math.round(v * scale) / scale === v),
      )
    )
      return scale;
  }
  throw new Error('Values are not exact decimals within six places');
}
/** Zigzag deltas of value * scale plus one (LEB128); zero is null. */
function encodeScaledDeltas(values, scale) {
  const out = [];
  let previous = 0;
  for (const v of values) {
    if (v === null) {
      out.push(0);
      continue;
    }
    const k = Math.round(v * scale),
      delta = k - previous;
    previous = k;
    leb128(out, (delta >= 0 ? 2 * delta : -2 * delta - 1) + 1);
  }
  return hex(out);
}
const literal = (value) => JSON.stringify(value);
const identical = (a, b) => a.length === b.length && a.every((value, i) => Object.is(value, b[i]));

const outputs = [];
// 1. The shoreline grids: the source runs once, the world grid built from them as
// paleo-geography does, and the final values of the two rectangles the derivation changes.
{
  const { cell, base, coast, offset } = coastGrids;
  const runBytes = [];
  for (let i = 0; i < COAST_RUNS.length; i += 2) {
    runBytes.push(COAST_RUNS[i + 1]);
    leb128(runBytes, COAST_RUNS[i]);
  }
  const runs = hex(runBytes),
    sourceBase = decodeRuns(runs, base.data.length),
    sourceWorld = new Uint8Array(coast.data.length);
  for (let row = 0; row < base.height; row++)
    sourceWorld.set(
      sourceBase.subarray(row * base.width, (row + 1) * base.width),
      (row + offset.z) * coast.width + offset.x,
    );
  const basePatch = patchOf(sourceBase, base.data, base.width),
    worldPatch = patchOf(sourceWorld, coast.data, coast.width);
  if (basePatch) patchGrid(sourceBase, base.width, basePatch);
  if (worldPatch) patchGrid(sourceWorld, coast.width, worldPatch);
  assert.ok(identical(sourceBase, base.data), 'base grid round trip');
  assert.ok(identical(sourceWorld, coast.data), 'world grid round trip');
  const record = (value) => (value ? `Object.freeze(${literal(value)})` : 'null');
  outputs.push({
    file: 'shared/paleo-coast-baked.mts',
    text: `// Generated by scripts/bake-world-data.mjs; do not edit. The shoreline grids that
// shared/paleo-coast-build.mts derives from shared/paleo-coast-data.mts (SHA-256
// ${await sha256('shared/paleo-coast-data.mts')}): its runs, where the Earth grid sits in the
// world grid, and the final values of the rectangles the derivation changes (decoded by
// shared/baked-data.mts). tests/world-bake.test.mjs rebuilds and compares them.
export const COAST_BAKED = Object.freeze({
  cell: ${cell},
  base: Object.freeze({ width: ${base.width}, height: ${base.height}, runs: ${literal(runs)} }),
  world: Object.freeze({ width: ${coast.width}, height: ${coast.height}, baseX: ${offset.x}, baseZ: ${offset.z} }),
  basePatch: ${record(basePatch)},
  worldPatch: ${record(worldPatch)},
});
`,
  });
}
// 2. Measured walk surfaces: every key in its source order; the height grid as exact decimals.
async function bakeSurface({ file, source, name, data }) {
  const fields = [];
  for (const [key, value] of Object.entries(data)) {
    if (key !== 'heights') {
      fields.push(`  ${literal(key)}: ${literal(value)},`);
      continue;
    }
    const scale = decimalScale(value),
      text = encodeScaledDeltas(value, scale),
      nulls = value.some((v) => v === null);
    assert.ok(
      identical(decodeScaledDeltas(text, value.length, scale), value),
      `${name} heights round trip`,
    );
    fields.push(
      `  "heights": decodeScaledDeltas(${literal(text)}, ${value.length}, ${scale})${nulls ? '' : ' as number[]'},`,
    );
  }
  outputs.push({
    file,
    text: `// Generated by scripts/bake-world-data.mjs; do not edit. ${name} of ${source}
// (SHA-256 ${await sha256(source)}) with its height grid as exact decimal deltas.
import { decodeScaledDeltas } from './baked-data.mjs';
export const ${name} = {
${fields.join('\n')}
};
`,
  });
}
await bakeSurface({
  file: 'shared/camp-mountain-surface-baked.mts',
  source: 'shared/camp-mountain-surface-data.mts',
  name: 'CAMP_MOUNTAIN_SURFACE_DATA',
  data: CAMP_MOUNTAIN_SURFACE_DATA,
});
await bakeSurface({
  file: 'shared/castle-surface-baked.mts',
  source: 'shared/castle-surface-data.mts',
  name: 'CASTLE_SURFACE_DATA',
  data: CASTLE_SURFACE_DATA,
});

// 3. The scenery scatter's answers, in call order: yes/no answers as bits, biome ids as bytes.
{
  const { scenery, answers } = recordSceneryAnswers();
  const ids = [
    ...new Set(
      Object.values(answers)
        .flat()
        .filter((a) => typeof a === 'string'),
    ),
  ].sort();
  assert.ok(ids.length < 256);
  const entries = {};
  for (const name of SCENERY_QUESTION_NAMES) {
    const list = answers[name];
    const kinds = new Set(list.map((a) => typeof a));
    assert.ok(kinds.size <= 1, `${name} answers are all of one kind`);
    if (kinds.has('string'))
      entries[name] = { count: list.length, ids: hex(list.map((a) => ids.indexOf(a))) };
    else {
      const bytes = new Uint8Array(Math.ceil(list.length / 8));
      list.forEach((a, i) => {
        if (a) bytes[i >> 3] |= 1 << (i & 7);
      });
      entries[name] = { count: list.length, bits: hex(bytes) };
    }
  }
  // Replay the encoded answers through the scatter: the same placements, key for key.
  const decoded = Object.fromEntries(
    Object.entries(entries).map(([name, e]) => [
      name,
      e.bits !== undefined ? decodeBits(e.bits, e.count) : decodeIndices(e.ids, e.count, ids),
    ]),
  );
  const asked = Object.fromEntries(SCENERY_QUESTION_NAMES.map((name) => [name, 0]));
  const replay = scatterScenery(
    Object.fromEntries(
      SCENERY_QUESTION_NAMES.map((name) => [name, () => decoded[name][asked[name]++]]),
    ),
  );
  for (const name of SCENERY_QUESTION_NAMES) assert.equal(asked[name], answers[name].length, name);
  const sameItem = (a, b) =>
    Object.keys(a).join() === Object.keys(b).join() &&
    Object.keys(a).every((k) =>
      Array.isArray(a[k]) ? Array.isArray(b[k]) && identical(a[k], b[k]) : Object.is(a[k], b[k]),
    );
  assert.equal(Object.keys(replay).join(), Object.keys(scenery).join());
  for (const category of Object.keys(scenery)) {
    assert.equal(replay[category].length, scenery[category].length, category);
    scenery[category].forEach((item, i) =>
      assert.ok(sameItem(replay[category][i], item), `${category} ${i}`),
    );
  }
  const counts = Object.entries(entries)
    .map(([name, e]) => `${name} ${e.count}`)
    .join(', ');
  outputs.push({
    file: 'shared/scenery-answers-baked.mts',
    text: `// Generated by scripts/bake-world-data.mjs; do not edit. The answers the global scenery scatter
// (shared/scenery-scatter.mts) receives, in the order it asks: ${counts}.
// shared/scenery-layout.mts replays them; tests/world-bake.test.mjs answers live and compares.
export const SCENERY_ANSWERS = Object.freeze({
  ids: Object.freeze(${literal(ids)}),
  answers: Object.freeze({
${Object.entries(entries)
  .map(([name, e]) => `    ${name}: Object.freeze(${literal(e)}),`)
  .join('\n')}
  }),
});
`,
  });
}

let stale = 0;
for (const { file, text } of outputs) {
  const current = await readFile(path.join(root, file), 'utf8').catch(() => null);
  const state = current === text ? 'unchanged' : current === null ? 'new' : 'changed';
  console.log(`${file}: ${Buffer.byteLength(text)} B, ${state}`);
  if (state === 'unchanged') continue;
  stale++;
  if (!check) await writeFile(path.join(root, file), text);
}
if (check && stale) {
  console.error(
    `${stale} baked module(s) differ from their sources; run node scripts/bake-world-data.mjs`,
  );
  process.exitCode = 1;
}
