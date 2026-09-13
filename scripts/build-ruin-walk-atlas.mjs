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
// 2026-09-13 stepped fortress: the reconstruction carries an internal floor at
// forecourt level under every terrace, so "lowest connected surface" would put
// players inside the pyramid. The `highest` mode takes the highest connected
// surface in a column instead (a terrace over its internal floor, a stair
// tread over it); wall tops and the gate arch are never connected, so they
// still lose to the passage beneath them.
// Usage: node scripts/build-ruin-walk-atlas.mjs columns.json output.json [rise] [ground] [lowest|highest]
import { readFile, writeFile } from 'node:fs/promises';
const [input, output, riseArg, groundArg, modeArg] = process.argv.slice(2);
const mode = modeArg === 'highest' ? 'highest' : 'lowest';
if (!output)
  throw new Error('Usage: build-ruin-walk-atlas.mjs columns.json output.json [rise] [ground]');
const source = JSON.parse(await readFile(input, 'utf8'));
const { step, minX, minZ, nx, nz, columns } = source,
  ceilings = source.ceilings ?? columns.map(() => []);
const rise = Number(riseArg ?? process.env.CASTLE_STEP_RISE) || 0.6;
const ground = Number(groundArg) || 0;
// Surfaces closer together than a body's height are one slab: keep the top.
const headroom = 1.7;
// In `highest` mode a column with no surface near the ground gets a virtual
// ground node so the search can pass under the gate arch; it is remembered so
// that the arch overhead is not mistaken for a wall top.
const overhead = 2.5;
const virtualGround = columns.map(() => false);
const choices = columns.map((col, i) => {
  const kept = [];
  for (const h of col) {
    if (h < ground - 0.5) continue;
    if (kept.length && h - kept.at(-1) < headroom) kept[kept.length - 1] = h;
    else kept.push(h);
  }
  if (mode !== 'highest') return kept.length ? kept : [ground];
  // Judge the passage by the lowest surface actually measured near or above
  // the ground, before the headroom merge (rubble on a wall merges upward into
  // one high surface, but the wall still has its internal floor at ground).
  const lowest = col.find((h) => h >= ground - 0.5);
  if (lowest === undefined) {
    virtualGround[i] = true;
    return [ground];
  }
  // A high surface with an underside (ceiling) above head height between the
  // ground and it is an arch; the same surface with no underside is a wall.
  if (
    lowest >= ground + overhead &&
    ceilings[i].some((c) => c >= ground + overhead && c <= lowest + 0.05)
  ) {
    virtualGround[i] = true;
    return [ground, ...kept];
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
// In `highest` mode a column is solid when an unreached surface stands above
// the reached one (a wall top over the internal floor that runs under the
// walls, a parapet over its terrace), and a column with no reached surface but
// only surfaces well above head height is open ground (the passage under the
// gate arch, whose own apron floor lies below the surrounding ground).
const heights = choices.map((col, i) => {
  if (mode !== 'highest') {
    const h = col.find((_, j) => visited[i][j]);
    return h === undefined ? null : Number((h - ground).toFixed(3));
  }
  const measured = col.map((h, j) => ({ h, j })).filter(({ j }) => !(virtualGround[i] && j === 0)),
    reached = measured.filter(({ j }) => visited[i][j]),
    unreached = measured.filter(({ j }) => !visited[i][j]);
  if (reached.length) {
    const h = reached.at(-1).h;
    // Any unreached surface above the reached floor makes the column solid
    // (wall tops over the internal floor, parapets over their terrace, the
    // throne over the summit). The gate passage has no internal floor, so it
    // is handled by the virtual-ground rule above instead.
    if (unreached.some((u) => u.h > h + 0.3)) return null;
    return Number((h - ground).toFixed(3));
  }
  // Only the virtual ground was reached: open ground, or a passage under an arch.
  if (virtualGround[i] && visited[i][0]) return 0;
  return null;
});
// Holes inside reachable floors are ray misses in the reconstruction, not
// pillars: a stair riser steeper than the surface test leaves a whole tread row
// unmeasured, and a body ring test fails on it and strands players mid-stair.
// A null cell whose two opposite neighbours are floor within one riser of each
// other is bridged by their mean; three passes close lines up to three cells wide.
const holeFills = [];
let riserCells = 0;
const at = (x, z) => (x < 0 || z < 0 || x >= nx || z >= nz ? undefined : heights[z * nx + x]);
for (let pass = 0; pass < 3; pass++) {
  const fills = [];
  for (let z = 1; z < nz - 1; z++)
    for (let x = 1; x < nx - 1; x++) {
      const i = z * nx + x;
      // A missed riser row reads as solid, or (stepped fortress) as the
      // internal floor far below the treads on either side: both are holes.
      for (const [a, b] of [
        [at(x, z - 1), at(x, z + 1)],
        [at(x - 1, z), at(x + 1, z)],
      ]) {
        if (typeof a !== 'number' || typeof b !== 'number') continue;
        const lo = Math.min(a, b),
          hi = Math.max(a, b);
        if (hi - lo > 1.2 || lo < 0.3) continue;
        if (heights[i] !== null && heights[i] > lo - 1.5) continue;
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
// Pits: an unmeasured cell, or one reading the internal floor far below its
// surroundings, with at least three of its four neighbours on one floor.
for (let pass = 0; pass < 6; pass++) {
  const fills = [];
  for (let z = 1; z < nz - 1; z++)
    for (let x = 1; x < nx - 1; x++) {
      const i = z * nx + x,
        around = [at(x, z - 1), at(x, z + 1), at(x - 1, z), at(x + 1, z)].filter(
          (h) => typeof h === 'number',
        );
      if (around.length < 3) continue;
      const lo = Math.min(...around),
        hi = Math.max(...around);
      if (hi - lo > 1.2 || lo < 0.3) continue;
      if (heights[i] !== null && heights[i] > lo - 1.5) continue;
      fills.push({
        x: Number((minX + (x + 0.5) * step).toFixed(2)),
        z: Number((minZ + (z + 0.5) * step).toFixed(2)),
        h: Number((around.reduce((s, h) => s + h, 0) / around.length).toFixed(3)),
        pass: 10 + pass,
      });
    }
  for (const fill of fills)
    heights[
      Math.round((fill.z - minZ) / step - 0.5) * nx + Math.round((fill.x - minX) / step - 0.5)
    ] = fill.h;
  holeFills.push(...fills);
  if (!fills.length) break;
}
// Slits: a run of up to four unmeasured (or internal-floor) cells between two
// cells of one floor along either axis is bridged linearly, the way the
// riser rows are; a wider gap stays open.
{
  const fills = [];
  const low = (i, lo) => heights[i] === null || heights[i] <= lo - 1.5;
  for (const axis of ['x', 'z']) {
    const outer = axis === 'x' ? nz : nx,
      inner = axis === 'x' ? nx : nz,
      index = (o, k) => (axis === 'x' ? o * nx + k : k * nx + o);
    for (let o = 0; o < outer; o++)
      for (let k = 1; k < inner - 1; k++) {
        const a = heights[index(o, k - 1)];
        if (typeof a !== 'number' || a < 0.3) continue;
        let n = 0;
        while (k + n < inner - 1 && n < 4 && low(index(o, k + n), a)) n++;
        if (!n) continue;
        const b = heights[index(o, k + n)];
        // One riser per bridged interval at most (a steep flight's missed
        // rows), never a whole storey.
        if (typeof b !== 'number' || Math.abs(a - b) > Math.min(3.2, n + 1) || b < 0.3) continue;
        for (let m = 0; m < n; m++) {
          const i = index(o, k + m),
            ix = i % nx,
            iz = Math.floor(i / nx);
          fills.push({
            x: Number((minX + (ix + 0.5) * step).toFixed(2)),
            z: Number((minZ + (iz + 0.5) * step).toFixed(2)),
            h: Number((a + ((b - a) * (m + 1)) / (n + 1)).toFixed(3)),
            pass: 20,
          });
        }
        k += n;
      }
  }
  for (const fill of fills)
    heights[
      Math.round((fill.z - minZ) / step - 0.5) * nx + Math.round((fill.x - minX) / step - 0.5)
    ] = fill.h;
  holeFills.push(...fills);
}
// Risers: the stepped fortress's flights climb about a metre per tread, and a
// whole riser can land in one 0.35 m cell. A body's ring test reads that as a
// ledge, so each riser is spread over its two cells (a third of the rise moved
// onto each side) into the ramp the smoothing already assumes between cells.
// Physics data only: the drawn stair keeps its steps.
{
  const adjust = new Map();
  for (const axis of ['x', 'z']) {
    const outer = axis === 'x' ? nz : nx,
      inner = axis === 'x' ? nx : nz,
      index = (o, k) => (axis === 'x' ? o * nx + k : k * nx + o);
    for (let o = 0; o < outer; o++)
      for (let k = 0; k < inner - 1; k++) {
        const i = index(o, k),
          j = index(o, k + 1),
          a = heights[i],
          b = heights[j];
        if (typeof a !== 'number' || typeof b !== 'number') continue;
        const rise = b - a;
        if (Math.abs(rise) < 0.6 || Math.abs(rise) > 1.6) continue;
        adjust.set(i, (adjust.get(i) ?? 0) + rise / 3);
        adjust.set(j, (adjust.get(j) ?? 0) - rise / 3);
      }
  }
  for (const [i, delta] of adjust) heights[i] = Number((heights[i] + delta).toFixed(3));
  riserCells = adjust.size;
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
    columnChoice: mode,
    groundMetres: ground,
    bodyHeadroom: headroom,
    holeFills,
    riserCells,
    reachable: heights.filter((h) => h !== null).length,
    blocked: heights.filter((h) => h === null).length,
    heightBuckets: buckets,
  },
};
await writeFile(output, JSON.stringify(result));
console.log(JSON.stringify(result.measurement));
