// Walk atlas for the ruined castle (2026-09-12 rebuild). Unlike the old keep,
// the ruin has no hidden rooms or reused stair: every upward-facing surface
// measured from the exact GLB is a candidate floor, and the connected set that
// a body can reach from the surrounding ground (one measured step at a time)
// is the playable surface. The lowest reachable surface wins in a column, so
// the passage under the gate arch stays open while the arch top is unreachable.
// The reconstruction stands on a plinth. The placed model is lowered by
// CASTLE.groundOffset so the forecourt meets the valley floor, which means the
// surrounding ground sits at `ground` (= -groundOffset) in model space. The
// atlas is written in world terms (model height minus `ground`) so that open
// valley floor outside the atlas and inside it agree at 0; cells with no
// measured surface are that open ground, and surfaces buried below it are dropped.
// Usage: node scripts/build-ruin-walk-atlas.mjs columns.json output.json [rise] [ground]
import { readFile, writeFile } from 'node:fs/promises';
const [input, output, riseArg, groundArg] = process.argv.slice(2);
if (!output)
  throw new Error('Usage: build-ruin-walk-atlas.mjs columns.json output.json [rise] [ground]');
const source = JSON.parse(await readFile(input, 'utf8'));
const { step, minX, minZ, nx, nz, columns } = source;
const rise = Number(riseArg ?? process.env.CASTLE_STEP_RISE) || 0.6;
const ground = Number(groundArg) || 0;
// Surfaces closer together than a body's height are one slab: keep the top.
const headroom = 1.7;
const choices = columns.map((col) => {
  if (!col.length) return [ground];
  const kept = [];
  for (const h of col) {
    if (h < ground - 0.5) continue;
    if (kept.length && h - kept.at(-1) < headroom) kept[kept.length - 1] = h;
    else kept.push(h);
  }
  return kept;
});
const visited = choices.map((col) => col.map(() => false)),
  queue = [];
const seed = (i, j) => {
  if (!visited[i][j]) {
    visited[i][j] = true;
    queue.push([i, j]);
  }
};
for (let z = 0; z < nz; z++)
  for (let x = 0; x < nx; x++)
    if (x === 0 || x === nx - 1 || z === 0 || z === nz - 1) {
      const i = z * nx + x;
      choices[i].forEach((h, j) => {
        if (h < ground + 0.6) seed(i, j);
      });
    }
for (let cursor = 0; cursor < queue.length; cursor++) {
  const [i, j] = queue[cursor],
    x = i % nx,
    z = Math.floor(i / nx),
    h = choices[i][j];
  for (const [dx, dz] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]) {
    const xx = x + dx,
      zz = z + dz;
    if (xx < 0 || xx >= nx || zz < 0 || zz >= nz) continue;
    const ni = zz * nx + xx;
    for (let k = 0; k < choices[ni].length; k++)
      if (!visited[ni][k] && Math.abs(choices[ni][k] - h) <= rise) seed(ni, k);
  }
}
const heights = choices.map((col, i) => {
  const h = col.find((_, j) => visited[i][j]);
  return h === undefined ? null : Number((h - ground).toFixed(3));
});
// Holes inside reachable floors are ray misses in the reconstruction, not
// pillars: a stair riser steeper than the surface test leaves a whole tread row
// unmeasured, and a body ring test fails on it and strands players mid-stair.
// A null cell whose two opposite neighbours are floor within one riser of each
// other is bridged by their mean; three passes close lines up to three cells wide.
const holeFills = [];
const at = (x, z) => (x < 0 || z < 0 || x >= nx || z >= nz ? undefined : heights[z * nx + x]);
for (let pass = 0; pass < 3; pass++) {
  const fills = [];
  for (let z = 1; z < nz - 1; z++)
    for (let x = 1; x < nx - 1; x++) {
      const i = z * nx + x;
      if (heights[i] !== null) continue;
      for (const [a, b] of [
        [at(x, z - 1), at(x, z + 1)],
        [at(x - 1, z), at(x + 1, z)],
      ]) {
        if (typeof a !== 'number' || typeof b !== 'number') continue;
        const lo = Math.min(a, b),
          hi = Math.max(a, b);
        if (hi - lo > 1.2 || lo < 0.3) continue;
        fills.push({
          x: Number((minX + (x + 0.5) * step).toFixed(2)),
          z: Number((minZ + (z + 0.5) * step).toFixed(2)),
          h: Number(((lo + hi) / 2).toFixed(3)),
          pass,
        });
        break;
      }
    }
  for (const fill of fills)
    heights[
      Math.round((fill.z - minZ) / step - 0.5) * nx + Math.round((fill.x - minX) / step - 0.5)
    ] = fill.h;
  holeFills.push(...fills);
  if (!fills.length) break;
}
const buckets = {};
for (const h of heights)
  if (h !== null) {
    const bucket = Math.round(h);
    buckets[bucket] = (buckets[bucket] ?? 0) + 1;
  }
const result = {
  schemaVersion: 1,
  sourceSha256: source.sha256,
  step,
  minX,
  minZ,
  nx,
  nz,
  heights,
  measurement: {
    method:
      'Every upward-facing surface rasterized from the exact GLB; surfaces closer than a body height merge into their top. Floors are the set connected to the outer ground by steps no taller than maxStepRise, taking the lowest connected surface in a column (the gate passage, not the arch top). Single-cell holes inside floors are filled from their neighbours.',
    maxStepRise: rise,
    groundMetres: ground,
    bodyHeadroom: headroom,
    holeFills,
    reachable: heights.filter((h) => h !== null).length,
    blocked: heights.filter((h) => h === null).length,
    heightBuckets: buckets,
  },
};
await writeFile(output, JSON.stringify(result));
console.log(JSON.stringify(result.measurement));
