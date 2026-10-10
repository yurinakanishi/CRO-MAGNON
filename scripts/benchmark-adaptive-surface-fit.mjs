// Read-only benchmark for the adaptive source surface fit (src/source-surface-fit.ts). It reads
// the delivered camp-mountain GLBs and the meadow ground tile through the existing geometryScene
// helper (accessor geometry only, no textures), places them in world space as
// prepareMountainRiverBed and OpenWorldTerrain do, fits every mesh and prints JSON. Nothing is
// written or adopted.
//
//   npm run build
//   node scripts/benchmark-adaptive-surface-fit.mjs [--repeat 3] [--baseline <module.js>]
//
// The previous fit's triangle count is always reported by replaying its subdivision rule without
// building its mesh. --baseline additionally runs another build of the fitter (any module that
// exports fitSourceRiverBank and resolves the same relative imports, e.g. the previous fit compiled
// beside dist/src) for timing, buffer bytes and height comparisons. That fit can need several GB:
// run node with --max-old-space-size if it stops for memory.
//
// Heights are vertical-ray samples against the exact deformed source surface and the gameplay
// height, split by the exact slope (a vertical ray height is ill-defined on walls and at steps of
// the deformation), with the worst points listed. `layering` compares, on a 0.1 m grid over the
// camp approach, whether the hill or the streamed meadow is on top against the exact surfaces.
// Heap and arrayBuffer deltas include garbage collection and are not peaks; peakTypedArrayBytes
// is the fitter's own typed array accounting.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as THREE from 'three';
import { geometryScene } from './measure-collision-bounds.mjs';
import {
  fitSourceRiverBank,
  measureSourceRiverBankFit,
} from '../dist/src/source-surface-fit.js';
import { mountainHeight } from '../dist/shared/camp-mountain.mjs';
import {
  CAMP_CAVE,
  CAMP_MOUNTAIN,
  CAVE_APPROACH,
  CAVE_FOOT,
  CAVE_HILL,
  caveFootHeight,
  caveWorldAt,
} from '../dist/shared/camp-cave-layout.mjs';
import {
  expandedMountainX,
  expandedMountainZ,
  MOUNTAIN_EXPANSION,
  sourceMountainX,
  sourceMountainZ,
} from '../dist/shared/mountain-expansion.mjs';
import {
  MOUNTAIN_RIVER_SAMPLES,
  mountainRiverBed,
  mountainRiverIntersects,
} from '../dist/shared/mountain-river.mjs';
import { mountainLakePoint } from '../dist/shared/mountain-lake.mjs';
import { RIVER_BOUNDS, riverBankDrop, riverX } from '../dist/shared/river-profile.mjs';
import { biomeById, chunkAt, chunkDescription } from '../dist/shared/biomes.mjs';

// Topmost surface height along a vertical ray, as the continuity tests' downward raycasts see it.
// Triangles are bucketed by their horizontal bounds; vertical faces present no top surface.
export function verticalSurface(geometry, cell = 1) {
  const position = geometry.attributes.position,
    index = geometry.index;
  const triangles = (index ? index.count : position.count) / 3;
  const corner = (t, k) => (index ? index.getX(t * 3 + k) : t * 3 + k);
  let minX = Infinity,
    minZ = Infinity,
    maxX = -Infinity,
    maxZ = -Infinity;
  for (let i = 0; i < position.count; i++) {
    minX = Math.min(minX, position.getX(i));
    maxX = Math.max(maxX, position.getX(i));
    minZ = Math.min(minZ, position.getZ(i));
    maxZ = Math.max(maxZ, position.getZ(i));
  }
  const nx = Math.max(1, Math.ceil((maxX - minX) / cell) + 1),
    nz = Math.max(1, Math.ceil((maxZ - minZ) / cell) + 1);
  const bounds = (t) => {
    let x0 = Infinity,
      x1 = -Infinity,
      z0 = Infinity,
      z1 = -Infinity;
    for (let k = 0; k < 3; k++) {
      const v = corner(t, k);
      x0 = Math.min(x0, position.getX(v));
      x1 = Math.max(x1, position.getX(v));
      z0 = Math.min(z0, position.getZ(v));
      z1 = Math.max(z1, position.getZ(v));
    }
    return [
      Math.max(0, Math.floor((x0 - minX) / cell)),
      Math.min(nx - 1, Math.floor((x1 - minX) / cell)),
      Math.max(0, Math.floor((z0 - minZ) / cell)),
      Math.min(nz - 1, Math.floor((z1 - minZ) / cell)),
    ];
  };
  const first = new Int32Array(nx * nz + 1);
  for (let t = 0; t < triangles; t++) {
    const [a, b, c, d] = bounds(t);
    for (let iz = c; iz <= d; iz++) for (let ix = a; ix <= b; ix++) first[iz * nx + ix + 1]++;
  }
  for (let i = 0; i < nx * nz; i++) first[i + 1] += first[i];
  const items = new Int32Array(first[nx * nz]),
    cursor = first.slice(0, nx * nz);
  for (let t = 0; t < triangles; t++) {
    const [a, b, c, d] = bounds(t);
    for (let iz = c; iz <= d; iz++)
      for (let ix = a; ix <= b; ix++) items[cursor[iz * nx + ix]++] = t;
  }
  return (x, z) => {
    const ix = Math.floor((x - minX) / cell),
      iz = Math.floor((z - minZ) / cell);
    if (ix < 0 || iz < 0 || ix >= nx || iz >= nz) return undefined;
    let best;
    for (let k = first[iz * nx + ix]; k < first[iz * nx + ix + 1]; k++) {
      const t = items[k],
        a = corner(t, 0),
        b = corner(t, 1),
        c = corner(t, 2);
      const ax = position.getX(a),
        az = position.getZ(a),
        bx = position.getX(b),
        bz = position.getZ(b),
        cx = position.getX(c),
        cz = position.getZ(c);
      const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (Math.abs(d) < 1e-12) continue;
      const u = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d,
        v = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d,
        w = 1 - u - v;
      if (u < -1e-7 || v < -1e-7 || w < -1e-7) continue;
      const y = u * position.getY(a) + v * position.getY(b) + w * position.getY(c);
      if (best === undefined || y > best) best = y;
    }
    return best;
  };
}

// Edges used by exactly one triangle, after welding vertices with identical positions. In a
// conforming refinement only the source boundary is open; a T-junction opens interior edges.
export function openEdges(geometry) {
  const position = geometry.attributes.position,
    index = geometry.index;
  const triangles = (index ? index.count : position.count) / 3;
  const weld = new Map(),
    ids = new Int32Array(position.count);
  for (let i = 0; i < position.count; i++) {
    const key = `${position.getX(i)},${position.getY(i)},${position.getZ(i)}`;
    let id = weld.get(key);
    if (id === undefined) weld.set(key, (id = weld.size));
    ids[i] = id;
  }
  const uses = new Map();
  for (let t = 0; t < triangles; t++)
    for (let k = 0; k < 3; k++) {
      const a = ids[index ? index.getX(t * 3 + k) : t * 3 + k],
        b = ids[index ? index.getX(t * 3 + ((k + 1) % 3)) : t * 3 + ((k + 1) % 3)];
      if (a === b) continue;
      const key = Math.min(a, b) * 4194304 + Math.max(a, b);
      uses.set(key, (uses.get(key) ?? 0) + 1);
    }
  const open = [];
  let shared = 0,
    crowded = 0;
  for (const [key, count] of uses) {
    if (count === 1) open.push([Math.floor(key / 4194304), key % 4194304]);
    else if (count === 2) shared++;
    else crowded++;
  }
  const points = [...weld.keys()].map((key) => key.split(',').map(Number));
  return { open: open.map(([a, b]) => [points[a], points[b]]), shared, crowded };
}

// The previous fit's subdivision, replayed on source positions to count the triangles it built.
export function legacyTriangles(source, maximumEdge = 0.5, mountainOnly = false) {
  const position = source.attributes.position,
    index = source.index;
  const triangles = (index ? index.count : position.count) / 3;
  const projectX = mountainOnly ? expandedMountainX : (x) => x;
  const projectZ = mountainOnly ? expandedMountainZ : (z) => z;
  const overlaps = (minX, maxX, minZ, maxZ) =>
    mountainRiverIntersects(minX, maxX, minZ, maxZ) ||
    (!mountainOnly &&
      maxX >= RIVER_BOUNDS.minX &&
      minX <= RIVER_BOUNDS.maxX &&
      maxZ >= RIVER_BOUNDS.minZ &&
      minZ <= RIVER_BOUNDS.maxZ);
  source.computeBoundingBox();
  const box = source.boundingBox;
  if (
    !overlaps(box.min.x, box.max.x, projectZ(box.min.z), projectZ(box.max.z)) &&
    !(
      mountainOnly &&
      (box.max.z > MOUNTAIN_EXPANSION.start ||
        (box.max.z >= CAVE_HILL.minZ && box.min.z <= CAVE_HILL.maxZ))
    )
  )
    return triangles;
  const stack = [];
  for (let t = 0; t < triangles; t++)
    for (let k = 0; k < 3; k++) {
      const v = index ? index.getX(t * 3 + k) : t * 3 + k;
      stack.push(position.getX(v), position.getZ(v));
      if (k === 2) stack.push(0);
    }
  let leaves = 0;
  const x = [0, 0, 0],
    z = [0, 0, 0],
    X = [0, 0, 0],
    Z = [0, 0, 0];
  while (stack.length) {
    const depth = stack.pop();
    for (let k = 2; k >= 0; k--) {
      z[k] = stack.pop();
      x[k] = stack.pop();
    }
    for (let k = 0; k < 3; k++) {
      X[k] = projectX(x[k], z[k]);
      Z[k] = projectZ(z[k]);
    }
    const distances = [0, 1, 2].map(
      (k) => (X[k] - X[(k + 1) % 3]) ** 2 + (Z[k] - Z[(k + 1) % 3]) ** 2,
    );
    const longest = Math.max(...distances),
      edge = distances.indexOf(longest);
    const minX = Math.min(...X),
      maxX = Math.max(...X),
      minZ = Math.min(...Z),
      maxZ = Math.max(...Z);
    const fitWater = overlaps(minX, maxX, minZ, maxZ);
    const fitFoot =
      mountainOnly &&
      [CAVE_FOOT, CAVE_HILL].some(
        (b) => maxX >= b.minX && minX <= b.maxX && maxZ >= b.minZ && minZ <= b.maxZ,
      );
    const expand =
      mountainOnly &&
      Math.max(...z) > MOUNTAIN_EXPANSION.start &&
      Math.min(...z) < MOUNTAIN_EXPANSION.end;
    const fitMouth =
      fitFoot &&
      maxX >= CAMP_CAVE.x - 8 &&
      minX <= CAMP_CAVE.x + 8 &&
      maxZ >= CAMP_CAVE.z - 10 &&
      minZ <= CAMP_CAVE.z - 7.5;
    const footEdge = fitMouth
      ? 0.1
      : fitFoot && [0, 1, 2].some((k) => Math.abs(X[k] - riverX(Z[k])) < 6)
        ? 0.2
        : 0.6;
    const limit = fitFoot ? Math.min(footEdge, maximumEdge) : fitWater ? maximumEdge : 2;
    if ((fitWater || expand || fitFoot) && longest > limit ** 2 && depth < 18) {
      const p = edge,
        q = (edge + 1) % 3,
        r = (edge + 2) % 3;
      const mx = (x[p] + x[q]) * 0.5,
        mz = (z[p] + z[q]) * 0.5;
      stack.push(x[p], z[p], mx, mz, x[r], z[r], depth + 1);
      stack.push(mx, mz, x[q], z[q], x[r], z[r], depth + 1);
    } else leaves++;
  }
  return leaves;
}

function triangleCount(geometry) {
  return (geometry.index ? geometry.index.count : geometry.attributes.position.count) / 3;
}

function bufferBytes(geometry) {
  let bytes = geometry.index?.array.byteLength ?? 0;
  for (const attribute of Object.values(geometry.attributes)) bytes += attribute.array.byteLength;
  return bytes;
}

function summary(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return {
    max: sorted.at(-1),
    mean: values.reduce((sum, v) => sum + v, 0) / values.length,
    p95: sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)],
  };
}

// Gradient of the exact surface over +-5 cm. A vertical wall or a step in the deformation (such
// as caveFootHeight's edge at z=58) reads as steep: a vertical ray height is ill-defined there.
function exactSlope(exact, x, z, h = 0.05) {
  const a = exact(x + h, z),
    b = exact(x - h, z),
    c = exact(x, z + h),
    d = exact(x, z - h);
  if ([a, b, c, d].some((v) => v === undefined)) return Infinity;
  return Math.hypot((a - b) / (2 * h), (c - d) / (2 * h));
}

// Visible height against the exact deformed source surface, and against the gameplay height,
// split by the exact slope: level (<=0.25), walkable (<=1) and steep or discontinuous (>1).
function heightErrors(sets, surface, exact, physics) {
  const result = {};
  for (const [name, points] of Object.entries(sets)) {
    const fit = [],
      play = [],
      classes = { level: [], walkable: [], steep: [] },
      worst = [];
    let missing = 0,
      outside = 0;
    for (const { x, z } of points) {
      const expected = exact(x, z);
      if (expected === undefined) {
        outside++;
        continue;
      }
      const y = surface(x, z);
      if (y === undefined) {
        missing++;
        continue;
      }
      const error = Math.abs(y - expected),
        slope = exactSlope(exact, x, z),
        kind = slope <= 0.25 ? 'level' : slope <= 1 ? 'walkable' : 'steep';
      fit.push(error);
      classes[kind].push(error);
      const record = { x, z, exact: expected, fitted: y, error, slope, kind };
      if (physics) {
        record.physics = physics(x, z);
        play.push(Math.abs(y - record.physics));
      }
      worst.push(record);
      worst.sort((a, b) => b.error - a.error);
      if (worst.length > 3) worst.pop();
    }
    result[name] = {
      points: points.length,
      outside,
      missing,
      exact: summary(fit),
      byExactSlope: Object.fromEntries(
        Object.entries(classes).map(([kind, values]) => [
          kind,
          { points: values.length, error: summary(values) },
        ]),
      ),
      ...(physics ? { physics: summary(play) } : {}),
      worst,
    };
  }
  return result;
}

// Which of two layered surfaces is on top, cell by cell, against the exact surfaces: the hill
// with its approach/trail tint against the streamed ground. Cells where even the exact surfaces
// lie within 0.5 mm of each other (z-fighting) and the submerged river are not compared.
function layeringReport(region, mountain, ground) {
  const step = 0.1;
  let cells = 0,
    ambiguous = 0,
    candidate = 0,
    previous = 0,
    between = 0;
  for (let x = region.minX; x <= region.maxX; x += step)
    for (let z = region.minZ; z <= region.maxZ; z += step) {
      const me = mountain.exact(x, z),
        ge = ground.exact(x, z);
      if (me === undefined || ge === undefined || Math.max(me, ge) < -0.45) continue;
      cells++;
      if (Math.abs(me - ge) < 0.0005) {
        ambiguous++;
        continue;
      }
      const truth = me > ge,
        mf = mountain.fitted(x, z),
        gf = ground.fitted(x, z);
      const shown = mf !== undefined && gf !== undefined ? mf > gf : null;
      if (shown !== truth) candidate++;
      if (mountain.baseline) {
        const mb = mountain.baseline(x, z),
          gb = ground.baseline(x, z);
        const old = mb !== undefined && gb !== undefined ? mb > gb : null;
        if (old !== truth) previous++;
        if (old !== shown) between++;
      }
    }
  const area = (count) => count * step * step;
  return {
    region,
    step,
    comparedArea: area(cells),
    ambiguousArea: area(ambiguous),
    flippedArea: {
      candidate: area(candidate),
      ...(mountain.baseline ? { baseline: area(previous), betweenVersions: area(between) } : {}),
    },
  };
}

function mountainSamples() {
  const mouth = [],
    approach = [],
    caveHill = [],
    valley = [],
    river = [],
    lake = [];
  for (let across = -8; across <= 8; across += 0.5)
    for (let z = CAMP_CAVE.z - 11; z <= CAMP_CAVE.z - 7 + 1e-9; z += 0.1)
      mouth.push({ x: CAMP_CAVE.x + across, z });
  for (let i = 1; i < CAVE_APPROACH.length; i++) {
    const a = CAVE_APPROACH[i - 1],
      b = CAVE_APPROACH[i],
      length = Math.hypot(b.x - a.x, b.z - a.z);
    for (let s = 0; s <= length; s += 0.5)
      for (const offset of [-6, -3, 0, 3, 6]) {
        const t = s / length;
        approach.push({
          x: a.x + (b.x - a.x) * t + ((b.z - a.z) / length) * offset,
          z: a.z + (b.z - a.z) * t - ((b.x - a.x) / length) * offset,
        });
      }
  }
  // The points of tests/cave-hill.test.mjs.
  for (const z of [80, 83, 84.6, 84.9, 85.2, 85.5, 85.8, 86, 90, 98, 110, 122, 130])
    for (const dx of [-6, 0, 6]) caveHill.push(caveWorldAt(CAMP_CAVE.z - z, dx));
  for (let z = 60; z <= 182; z += 2)
    for (const offset of [-6, -4, -3, -2, -1, 0, 1, 2, 3, 4, 6])
      valley.push({ x: riverX(z) + offset, z });
  for (let i = 0; i < MOUNTAIN_RIVER_SAMPLES.length - 1; i += 8) {
    const a = MOUNTAIN_RIVER_SAMPLES[i],
      b = MOUNTAIN_RIVER_SAMPLES[i + 1],
      length = Math.hypot(b.x - a.x, b.z - a.z) || 1,
      nx = -(b.z - a.z) / length,
      nz = (b.x - a.x) / length;
    for (const across of [-1.5, -1, -0.5, 0, 0.5, 1, 1.5])
      river.push({ x: a.x + nx * a.width * across, z: a.z + nz * a.width * across });
    for (const bank of [1, 3, 6])
      for (const side of [-1, 1])
        river.push({
          x: a.x + nx * side * (a.width + bank),
          z: a.z + nz * side * (a.width + bank),
        });
  }
  for (let degrees = 0; degrees < 360; degrees += 10)
    for (const radius of [0.2, 0.6, 0.9, 1.05, 1.2])
      lake.push(mountainLakePoint((degrees * Math.PI) / 180, radius));
  return {
    caveMouth: mouth,
    caveApproach: approach,
    caveHill,
    valleyRiver: valley,
    mountainRiver: river,
    lake,
  };
}

async function measureMesh(job) {
  const { label, source, maximumEdge, mountainOnly, repeat, baseline, sets, exact, physics } = job;
  const runs = [];
  let fitted = null,
    stats = null;
  for (let i = 0; i < repeat; i++) {
    const input = source.clone();
    const before = process.memoryUsage();
    const start = performance.now();
    const result = measureSourceRiverBankFit(input, maximumEdge, mountainOnly);
    const elapsedMs = performance.now() - start;
    const after = process.memoryUsage();
    runs.push({
      elapsedMs,
      heapUsedDelta: after.heapUsed - before.heapUsed,
      arrayBuffersDelta: after.arrayBuffers - before.arrayBuffers,
    });
    if (result.geometry !== input) input.dispose();
    fitted?.dispose();
    ({ geometry: fitted, stats } = result);
  }
  const surface = verticalSurface(fitted);
  const sourceEdges = openEdges(source),
    fittedEdges = openEdges(fitted);
  const report = {
    label,
    maximumEdge,
    mountainOnly,
    sourceTriangles: triangleCount(source),
    previousFitTriangles: legacyTriangles(source, maximumEdge, mountainOnly),
    triangles: triangleCount(fitted),
    vertices: fitted.attributes.position.count,
    bufferBytes: bufferBytes(fitted),
    runs,
    stats,
    openEdges: {
      source: sourceEdges.open.length,
      sourceCrowded: sourceEdges.crowded,
      fitted: fittedEdges.open.length,
      expected: sourceEdges.open.length + (stats.noOp ? 0 : stats.boundaryEdgeSplits),
      crowded: fittedEdges.crowded,
    },
    heights: heightErrors(sets, surface, exact, physics),
  };
  let previousSurface = null;
  if (baseline) {
    const input = source.clone();
    const start = performance.now();
    const previous = baseline.fitSourceRiverBank(input, maximumEdge, mountainOnly);
    const elapsedMs = performance.now() - start;
    previousSurface = verticalSurface(previous);
    const difference = [];
    for (const points of Object.values(sets))
      for (const { x, z } of points) {
        const a = surface(x, z),
          b = previousSurface(x, z);
        if (a !== undefined && b !== undefined) difference.push(Math.abs(a - b));
      }
    report.baseline = {
      elapsedMs,
      triangles: triangleCount(previous),
      vertices: previous.attributes.position.count,
      bufferBytes: bufferBytes(previous),
      openEdges: openEdges(previous).open.length,
      heights: heightErrors(sets, previousSurface, exact, physics),
      visibleDifference: summary(difference),
    };
    if (previous !== input) previous.dispose();
    input.dispose();
  }
  if (job.layering)
    report.layering = layeringReport(
      job.layering.region,
      { fitted: surface, baseline: previousSurface, exact },
      job.layering.ground,
    );
  fitted.dispose();
  return report;
}

// OpenWorldTerrain.prepare: each biome's ground tile, centred and scaled to a 32 m chunk.
const groundTemplates = new Map();
async function groundTemplate(key) {
  if (!groundTemplates.has(key)) {
    const asset = JSON.parse(await readFile(`public/models/${key}/asset.json`, 'utf8'));
    const { scene } = await geometryScene(`public${asset.url}`);
    scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(scene),
      size = box.getSize(new THREE.Vector3()),
      centre = box.getCenter(new THREE.Vector3());
    const parts = [];
    scene.traverse((node) => {
      if (node.isMesh)
        parts.push(
          node.geometry
            .clone()
            .applyMatrix4(node.matrixWorld)
            .translate(-centre.x, -(asset.placement.surfaceHeightMetres ?? 0), -centre.z)
            .scale(32 / size.x, 1, 32 / size.z),
        );
    });
    groundTemplates.set(key, { asset, parts });
  }
  return groundTemplates.get(key);
}

// The streamed ground over a region as OpenWorldTerrain.admit shows it: every land chunk's tile,
// fitted on bank chunks by the current fit, the baseline fit, or exactly.
async function groundLayer(region, baseline) {
  const layers = { fitted: [], baseline: [], exact: [] },
    seen = new Set();
  for (let x = region.minX; x <= region.maxX + 16; x += 16)
    for (let z = region.minZ; z <= region.maxZ + 16; z += 16) {
      const cell = chunkAt(Math.min(x, region.maxX), Math.min(z, region.maxZ));
      if (seen.has(`${cell.x},${cell.z}`)) continue;
      seen.add(`${cell.x},${cell.z}`);
      const chunk = chunkDescription(cell.x, cell.z);
      if (!chunk.land) continue;
      const bank =
        (chunk.x + 16 >= 57 && chunk.x - 16 <= 73 && chunk.z + 16 >= -64 && chunk.z - 16 <= 184) ||
        mountainRiverIntersects(chunk.x - 16, chunk.x + 16, chunk.z - 16, chunk.z + 16);
      const { parts } = await groundTemplate(biomeById(chunk.biome).ground);
      for (const part of parts) {
        const source = part.clone().rotateY(chunk.yaw).translate(chunk.x, 0, chunk.z);
        const sourceSurface = verticalSurface(source);
        if (!bank) {
          for (const list of Object.values(layers)) list.push(sourceSurface);
          continue;
        }
        layers.fitted.push(verticalSurface(fitSourceRiverBank(source.clone())));
        if (baseline)
          layers.baseline.push(verticalSurface(baseline.fitSourceRiverBank(source.clone())));
        layers.exact.push((px, pz) => {
          const y = sourceSurface(px, pz);
          return y === undefined ? undefined : mountainRiverBed(px, pz, y - riverBankDrop(px, pz));
        });
      }
    }
  const top = (list) => (x, z) => {
    let best;
    for (const surface of list) {
      const y = surface(x, z);
      if (y !== undefined && (best === undefined || y > best)) best = y;
    }
    return best;
  };
  return {
    fitted: top(layers.fitted),
    baseline: baseline ? top(layers.baseline) : null,
    exact: top(layers.exact),
  };
}

async function attributionTriangles() {
  try {
    const file = 'output/playwright/optimization-20261009/baseline-attribution/perf.json';
    const perf = JSON.parse(await readFile(file, 'utf8'));
    const found = [];
    JSON.stringify(perf, (key, value) => {
      if (value && typeof value === 'object' && value.key === 'camp-mountain' && value.triangles)
        found.push(value.triangles);
      return value;
    });
    return found.length ? found[0] : null;
  } catch {
    return null;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const option = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const repeat = Math.max(1, Number(option('--repeat') ?? 1) || 1);
  const baselinePath = option('--baseline');
  const baseline = baselinePath
    ? await import(pathToFileURL(path.resolve(baselinePath)).href)
    : null;
  const report = {
    date: new Date().toISOString(),
    node: process.version,
    three: THREE.REVISION,
    repeat,
    baseline: baselinePath ?? null,
    attributedCampMountainTriangles: await attributionTriangles(),
    mountain: [],
    ground: [],
  };

  const asset = JSON.parse(await readFile('public/models/camp-mountain/asset.json', 'utf8'));
  const placement = new THREE.Matrix4()
    .makeRotationY(CAMP_MOUNTAIN.yaw)
    .setPosition(CAMP_MOUNTAIN.x, 0, CAMP_MOUNTAIN.z);
  const physics = (x, z) => mountainRiverBed(x, z, mountainHeight(x, z));
  // The camp end of the cave approach and the mountain trail, where the tinted hill and the
  // streamed meadow overlap. Only the full-detail mountain is drawn there.
  const region = { minX: 14, maxX: 66, minZ: 56, maxZ: 84 };
  const layering = { region, ground: await groundLayer(region, baseline) };
  for (const record of [asset, ...asset.lods]) {
    const { scene } = await geometryScene(`public${record.url}`);
    scene.updateMatrixWorld(true);
    const meshes = [];
    scene.traverse((node) => {
      if (node.isMesh) meshes.push(node);
    });
    for (const node of meshes) {
      // prepareMountainRiverBed: the fit runs in world space before the inverse transform.
      const matrix = placement.clone().multiply(node.matrixWorld);
      const source = node.geometry.clone().applyMatrix4(matrix);
      const sourceSurface = verticalSurface(source);
      const exact = (x, z) => {
        const sourceZ = sourceMountainZ(z),
          y = sourceSurface(sourceMountainX(x, sourceZ), sourceZ);
        return y === undefined ? undefined : mountainRiverBed(x, z, caveFootHeight(x, z, y));
      };
      report.mountain.push(
        await measureMesh({
          label: `${record.url} ${node.name}`,
          source,
          maximumEdge: 0.45,
          mountainOnly: true,
          repeat,
          baseline,
          sets: mountainSamples(),
          exact,
          physics,
          layering: record === asset ? layering : null,
        }),
      );
      source.dispose();
    }
  }

  // OpenWorldTerrain.admit: the 32 m meadow tile, rotated and placed on a bank chunk.
  const { asset: meadow, parts } = await groundTemplate('meadow-ground');
  for (const at of [
    { x: 64, z: 50 },
    { x: 66, z: 18 },
  ]) {
    const cell = chunkAt(at.x, at.z),
      chunk = chunkDescription(cell.x, cell.z);
    for (const part of parts) {
      const source = part.clone().rotateY(chunk.yaw).translate(chunk.x, 0, chunk.z);
      const sourceSurface = verticalSurface(source);
      const exact = (x, z) => {
        const y = sourceSurface(x, z);
        return y === undefined ? undefined : mountainRiverBed(x, z, y - riverBankDrop(x, z));
      };
      const bank = [];
      for (let z = chunk.z - 15.5; z <= chunk.z + 15.5; z += 1)
        for (let offset = -6; offset <= 6; offset += 0.5) bank.push({ x: riverX(z) + offset, z });
      report.ground.push({
        chunk: {
          x: chunk.x,
          z: chunk.z,
          yaw: chunk.yaw,
          biome: chunk.biome,
          template: meadow.modelKey,
        },
        ...(await measureMesh({
          label: `${meadow.url} at ${chunk.x},${chunk.z}`,
          source,
          maximumEdge: 0.5,
          mountainOnly: false,
          repeat,
          baseline,
          sets: { valleyBank: bank },
          exact,
          physics: null,
        })),
      });
      source.dispose();
    }
  }
  console.log(JSON.stringify(report, null, 2));
}

if (process.argv[1]?.endsWith('benchmark-adaptive-surface-fit.mjs')) await main();
