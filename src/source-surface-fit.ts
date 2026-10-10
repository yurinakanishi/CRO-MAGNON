import * as THREE from 'three';
import { riverBankDrop, riverX, RIVER_BOUNDS } from '../shared/river-profile.mjs';
import {
  MOUNTAIN_RIVER_SAMPLES,
  mountainRiverBed,
  mountainRiverIntersects,
} from '../shared/mountain-river.mjs';
import { mountainLakeIntersects } from '../shared/mountain-lake.mjs';
import { CAMP_CAVE, CAVE_FOOT, CAVE_HILL, caveFootHeight } from '../shared/camp-cave-layout.mjs';
import {
  expandedMountainZ,
  expandedMountainX,
  MOUNTAIN_EXPANSION,
} from '../shared/mountain-expansion.mjs';

// Fit accepted TRELLIS source surfaces to the shared terrain deformation: expanded mountain
// x/z, then caveFootHeight (mountain) or riverBankDrop (ground), then mountainRiverBed. Every
// output vertex is the exact deformation of a point on a source triangle, carrying linearly
// interpolated source UVs and attributes. No other geometry is made.
//
// The GPU interpolates linearly between vertices, so a source triangle is bisected only where
// that departs from the exact deformed source surface:
// - Longest-edge bisection, limited by the previous fit's finest edge per region (maximumEdge
//   by water and over the cave hill, 0.2 m beside the valley river, 0.1 m in the cave mouth, 2 m
//   on the summit). The previous fit split every triangle in those regions down to that limit;
//   here it is a floor, reached only where the measured error requires it.
// - A triangle is split when it is wider than a narrow feature band it may touch (valley bank,
//   mountain river/lake bank, cave-mouth rim), so samples cannot step over a river crossing it
//   between vertices; or when the exact deformed surface at its edge midpoints or an interior
//   point lies more than FIT_TOLERANCE from its facet, or riverCut differs by that much.
// - Layered ground: where the fitted surface lies within LAYER_BAND of the streamed ground it
//   overlaps (both carry -riverBankDrop), the two nearly coplanar surfaces decide which one is
//   seen by millimetres: their crossing moves by error/slope, 1 m per 5 mm at a 0.5% slope. There
//   the facet tolerance is LAYER_TOLERANCE, so curved layered zones keep the previous fit's
//   resolution and the visible hill/meadow edge stays where it was. Planar zones stay coarse.
// - Conforming: vertices are welded by exact position (UV seams included) and split decisions
//   are kept per welded edge. Every triangle containing a split edge is split there too, so a
//   shared edge gets one midpoint and no T-junctions remain. Mesh-boundary edges are refined by
//   an edge-only test, so meshes sharing such an edge meet within the tolerance.
// - Typed working arrays are counted against an explicit byte budget (an accounting bound, not a
//   process, JS heap or GPU peak); the rare non-manifold adjacency list has its own reference
//   limit. Invalid input, or work beyond either limit, throws instead of returning a partial mesh.

// Visible-ground error (m) a coarse triangle may leave against the exact deformed surface. The
// continuity tests allow 0.045 m; unsampled error of a quadratic or a single kink is at most
// twice the sampled midpoint error.
const FIT_TOLERANCE = 0.015;
// The streamed meadow lies within 0.02 m of its placement height; together with FIT_TOLERANCE's
// worst unsampled error a surface beyond 0.1 m of the ground cannot change which one shows.
const LAYER_BAND = 0.1;
const LAYER_TOLERANCE = 0.0001;
// Error is measured vertically; facets steeper than this normal component use 4x their normal
// distance instead of an unbounded vertical one.
const STEEP_NORMAL = 0.25;
// riverBankDrop is zero beyond 3.8 * riverFade(z) of riverX(z); its slopes are 1.25 m wide.
const VALLEY_REACH = 3.8;
const VALLEY_WIDTH = 1.25;
// |d riverX/dz| <= 0.23 (meander) + 2.52 (diversion).
const RIVER_X_SLOPE = 3;
// riverSectionBed leaves the hill unchanged beyond the water width plus its widest bank.
const MOUNTAIN_RIVER_REACH = 2.2 + 8;
const MOUNTAIN_RIVER_WIDTH = 2;
// caveFootHeight's narrow approach term: 4.2 + 3.8 m across, a 1.2 m rim at the rock mouth
// (local Z=9.4), and its crossings with the broad term after z=75.
const MOUTH_BAND = Object.freeze({
  minX: CAMP_CAVE.x - 8.5,
  maxX: CAMP_CAVE.x + 8.5,
  minZ: 74.5,
  maxZ: CAMP_CAVE.z - 9.4 + 1.2 + 0.5,
});
const MOUTH_WIDTH = 1.2;
const NARROWEST = Math.min(VALLEY_WIDTH, MOUNTAIN_RIVER_WIDTH, MOUTH_WIDTH);
const COVERAGE_MARGIN = 0.25;
// The previous fit never bisected deeper than this; conforming splits may.
const LEGACY_DEPTH = 18;
const MAXIMUM_DEPTH = 60;
// Budget for typed working arrays; the non-manifold adjacency list is limited separately.
const TYPED_ARRAY_BYTES = 512 * 1024 * 1024;
const CROWDED_LIMIT = 1 << 20;
const UNDEFORMED = 1e-6;
const SPLIT = 1,
  BOUNDARY = 2,
  DECIDED = 4;
const POINT_KEY = 67108864;

export type SourceSurfaceFitStats = {
  noOp: boolean;
  sourceTriangles: number;
  sourceVertices: number;
  triangles: number;
  vertices: number;
  splits: number;
  coverageSplits: number;
  errorSplits: number;
  layerSplits: number;
  conformingSplits: number;
  boundarySplits: number;
  boundaryEdgeSplits: number;
  samplePoints: number;
  // Accounted typed working arrays only; not a process, JS heap or GPU measurement.
  peakTypedArrayBytes: number;
  crowdedReferences: number;
  outputBytes: number;
};

// Runs of the measured river centreline, bounded by their reach, for conservative band tests.
const RIVER_RUN = 32;
const riverRuns: {
  start: number;
  end: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}[] = [];
for (let start = 0; start < MOUNTAIN_RIVER_SAMPLES.length - 1; start += RIVER_RUN) {
  const end = Math.min(MOUNTAIN_RIVER_SAMPLES.length - 1, start + RIVER_RUN);
  let minX = Infinity,
    maxX = -Infinity,
    minZ = Infinity,
    maxZ = -Infinity,
    reach = 0;
  for (let i = start; i <= end; i++) {
    const p = MOUNTAIN_RIVER_SAMPLES[i];
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
    reach = Math.max(reach, p.width + MOUNTAIN_RIVER_REACH);
  }
  riverRuns.push({
    start,
    end,
    minX: minX - reach,
    maxX: maxX + reach,
    minZ: minZ - reach,
    maxZ: maxZ + reach,
  });
}

// Whether a box can reach water deformed by mountainRiverBed (lake basin or river banks).
function mountainWaterNear(minX, maxX, minZ, maxZ) {
  if (mountainLakeIntersects(minX, maxX, minZ, maxZ)) return true;
  const cx = (minX + maxX) * 0.5,
    cz = (minZ + maxZ) * 0.5,
    half = Math.hypot(maxX - minX, maxZ - minZ) * 0.5;
  for (const run of riverRuns) {
    if (maxX < run.minX || minX > run.maxX || maxZ < run.minZ || minZ > run.maxZ) continue;
    for (let i = run.start; i < run.end; i++) {
      const a = MOUNTAIN_RIVER_SAMPLES[i],
        b = MOUNTAIN_RIVER_SAMPLES[i + 1],
        dx = b.x - a.x,
        dz = b.z - a.z,
        squared = dx * dx + dz * dz;
      const t =
        squared > 0 ? Math.max(0, Math.min(1, ((cx - a.x) * dx + (cz - a.z) * dz) / squared)) : 0;
      const distance = Math.hypot(cx - a.x - dx * t, cz - a.z - dz * t) - half;
      if (distance < Math.max(a.width, b.width) + MOUNTAIN_RIVER_REACH) return true;
    }
  }
  return false;
}

// Whether a box can reach the valley river banks. The mountain applies them in caveFootHeight,
// which only acts within CAVE_HILL's z range. Every z lies within step/2 of a sample.
function valleyNear(minX, maxX, minZ, maxZ, mountainOnly) {
  const low = Math.max(minZ, RIVER_BOUNDS.minZ, mountainOnly ? CAVE_HILL.minZ : -Infinity),
    high = Math.min(maxZ, RIVER_BOUNDS.maxZ, mountainOnly ? CAVE_HILL.maxZ : Infinity);
  if (low > high) return false;
  const steps = Math.min(64, Math.ceil((high - low) / 2)),
    step = (high - low) / Math.max(1, steps),
    spread = VALLEY_REACH + RIVER_X_SLOPE * step * 0.5;
  for (let i = 0; i <= steps; i++) {
    const x = riverX(low + step * i);
    if (maxX > x - spread && minX < x + spread) return true;
  }
  return false;
}

function waterOverlaps(minX, maxX, minZ, maxZ, mountainOnly) {
  return (
    mountainRiverIntersects(minX, maxX, minZ, maxZ) ||
    (!mountainOnly &&
      maxX >= RIVER_BOUNDS.minX &&
      minX <= RIVER_BOUNDS.maxX &&
      maxZ >= RIVER_BOUNDS.minZ &&
      minZ <= RIVER_BOUNDS.maxZ)
  );
}

function boxOverlaps(bounds, minX, maxX, minZ, maxZ) {
  return maxX >= bounds.minX && minX <= bounds.maxX && maxZ >= bounds.minZ && minZ <= bounds.maxZ;
}

function pairHash(a, b) {
  let h = Math.imul(a ^ 0x5bd1e995, 0x27d4eb2d) ^ Math.imul(b + 0x165667b1, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  return h ^ (h >>> 13);
}

function nextPowerOfTwo(n) {
  let p = 1024;
  while (p < n) p *= 2;
  return p;
}

// Subdivide existing source triangles near the river, interpolating their UVs.
// Coarse flat triangles otherwise bridge across the lowered riverbed.
export function fitSourceRiverBank(source, maximumEdge = 0.5, mountainOnly = false) {
  return fitSourceSurface(source, maximumEdge, mountainOnly, TYPED_ARRAY_BYTES, null);
}

/** The same fit with its work counters, for tests and the read-only benchmark. */
export function measureSourceRiverBankFit(
  source,
  maximumEdge = 0.5,
  mountainOnly = false,
  typedArrayBudget = TYPED_ARRAY_BYTES,
) {
  const stats: SourceSurfaceFitStats = {
    noOp: false,
    sourceTriangles: 0,
    sourceVertices: 0,
    triangles: 0,
    vertices: 0,
    splits: 0,
    coverageSplits: 0,
    errorSplits: 0,
    layerSplits: 0,
    conformingSplits: 0,
    boundarySplits: 0,
    boundaryEdgeSplits: 0,
    samplePoints: 0,
    peakTypedArrayBytes: 0,
    crowdedReferences: 0,
    outputBytes: 0,
  };
  const geometry = fitSourceSurface(source, maximumEdge, mountainOnly, typedArrayBudget, stats);
  return { geometry, stats };
}

function fitSourceSurface(source, maximumEdge, mountainOnly, workLimit, stats) {
  if (typeof maximumEdge !== 'number' || !(maximumEdge > 0) || maximumEdge === Infinity)
    throw new Error(`Source surface fit needs a positive finite edge length, not ${maximumEdge}`);
  if (!(workLimit > 0)) throw new Error(`Invalid source surface fit budget ${workLimit}`);
  mountainOnly = !!mountainOnly;
  const position = source.attributes.position;
  if (!position || position.itemSize !== 3)
    throw new Error('Source surface fit needs a three-component position attribute');
  const vertexCount = position.count;
  for (let i = 0; i < vertexCount; i++)
    if (
      !Number.isFinite(position.getX(i)) ||
      !Number.isFinite(position.getY(i)) ||
      !Number.isFinite(position.getZ(i))
    )
      throw new Error(`Source surface vertex ${i} is not finite`);
  source.computeBoundingBox();
  const box = source.boundingBox;
  const projectedZ = mountainOnly ? expandedMountainZ : (z) => z;
  if (
    !waterOverlaps(
      box.min.x,
      box.max.x,
      projectedZ(box.min.z),
      projectedZ(box.max.z),
      mountainOnly,
    ) &&
    !(
      mountainOnly &&
      (box.max.z > MOUNTAIN_EXPANSION.start ||
        (box.max.z >= CAVE_HILL.minZ && box.min.z <= CAVE_HILL.maxZ))
    )
  ) {
    if (stats) stats.noOp = true;
    return source;
  }

  // ---- The rest of the source description is validated before any work. ----
  const names = Object.keys(source.attributes).filter(
    (name) => name !== 'normal' && name !== 'tangent' && name !== 'riverCut',
  );
  const carriedNames = names.filter((name) => name !== 'position');
  const carried = carriedNames.map((name) => source.attributes[name]);
  const offsets = [];
  let stride = 0;
  carried.forEach((attribute, i) => {
    if (attribute.count !== vertexCount)
      throw new Error(
        `Source attribute ${carriedNames[i]} has ${attribute.count} of ${vertexCount} vertices`,
      );
    offsets.push(stride);
    stride += attribute.itemSize;
  });
  const normal = source.attributes.normal;
  const keepNormals = !!normal && normal.itemSize === 3 && normal.count === vertexCount;
  const normalOffset = stride;
  if (keepNormals) stride += 3;
  if (Object.values(source.morphAttributes ?? {}).some((list: any) => list?.length))
    throw new Error('Source surface fit cannot carry morph targets');
  const index = source.index;
  const indexCount = index ? index.count : vertexCount;
  if (indexCount % 3)
    throw new Error(`Source surface has ${indexCount} indices, not whole triangles`);
  if (index)
    for (let i = 0; i < indexCount; i++) {
      const v = index.getX(i);
      if (!Number.isInteger(v) || v < 0 || v >= vertexCount)
        throw new Error(`Source surface index ${i} refers to missing vertex ${v}`);
    }
  const sourceTriangles = indexCount / 3;
  // Groups and draw ranges are kept, mapped to the triangles each source triangle becomes.
  const triangleRange = (start, count, what) => {
    if (!Number.isInteger(start) || start < 0 || start % 3)
      throw new Error(`Source surface ${what} starts inside a triangle (${start})`);
    if (!(count >= 0)) throw new Error(`Source surface ${what} has an invalid count (${count})`);
    const first = Math.min(sourceTriangles, start / 3),
      end = count === Infinity ? indexCount : Math.min(indexCount, start + count);
    return [first, Math.max(first, Math.floor(end / 3))];
  };
  const groups = source.groups.map((group) => ({
    range: triangleRange(group.start, group.count, 'group'),
    materialIndex: group.materialIndex,
  }));
  const sourceDraw = source.drawRange;
  const draw =
    sourceDraw.start === 0 && sourceDraw.count === Infinity
      ? null
      : {
          range: triangleRange(sourceDraw.start, sourceDraw.count, 'draw range'),
          open: sourceDraw.count === Infinity,
        };

  // ---- Working memory: every typed working array is counted against the budget. ----
  let workBytes = 0,
    peakBytes = 0;
  const account = (bytes) => {
    workBytes += bytes;
    if (workBytes > workLimit)
      throw new Error(
        `Source surface fit of ${sourceTriangles} triangles exceeds its ${workLimit} B typed array budget`,
      );
    if (workBytes > peakBytes) peakBytes = workBytes;
  };
  const allocate = (Type, length) => {
    account(length * Type.BYTES_PER_ELEMENT);
    return new Type(length);
  };
  const release = (array) => account(-array.byteLength);
  const resize = (array, length) => {
    const next = allocate(array.constructor, length);
    next.set(array);
    release(array);
    return next;
  };

  // Points: welded positions with source (s) and fitted (p) coordinates, riverCut, and whether
  // the point lies within LAYER_BAND of the ground it is layered with.
  let pointCapacity = Math.max(1024, vertexCount + 2 * sourceTriangles),
    pointCount = 0;
  let sx = allocate(Float64Array, pointCapacity),
    sy = allocate(Float64Array, pointCapacity),
    sz = allocate(Float64Array, pointCapacity),
    px = allocate(Float64Array, pointCapacity),
    py = allocate(Float64Array, pointCapacity),
    pz = allocate(Float64Array, pointCapacity),
    cut = allocate(Float64Array, pointCapacity),
    near = allocate(Uint8Array, pointCapacity);
  const addPoint = (x, y, z) => {
    if (pointCount === pointCapacity) {
      if (pointCount >= POINT_KEY) throw new Error('Source surface fit exceeded its point limit');
      pointCapacity = Math.ceil(pointCapacity * 1.5);
      sx = resize(sx, pointCapacity);
      sy = resize(sy, pointCapacity);
      sz = resize(sz, pointCapacity);
      px = resize(px, pointCapacity);
      py = resize(py, pointCapacity);
      pz = resize(pz, pointCapacity);
      cut = resize(cut, pointCapacity);
      near = resize(near, pointCapacity);
    }
    const g = pointCount++;
    sx[g] = x;
    sy[g] = y;
    sz[g] = z;
    // The same deformation as the previous per-vertex fit.
    let X, Z, fitted, ground;
    if (mountainOnly) {
      X = expandedMountainX(x, z);
      Z = expandedMountainZ(z);
      fitted = caveFootHeight(X, Z, y);
      ground = -riverBankDrop(X, Z);
    } else {
      X = x;
      Z = z;
      ground = -riverBankDrop(X, Z);
      fitted = y + ground;
    }
    const Y = mountainRiverBed(X, Z, fitted);
    if (!Number.isFinite(X) || !Number.isFinite(Y) || !Number.isFinite(Z))
      throw new Error(`Fitted source point ${x},${y},${z} is not finite`);
    px[g] = X;
    py[g] = Y;
    pz[g] = Z;
    cut[g] = Math.max(0, fitted - Y);
    // Streamed ground tiles are placed at 0 and lowered by the same riverBankDrop; both then
    // receive mountainRiverBed, so heights before it are compared. A ground tile is the ground.
    near[g] = Math.abs(fitted - ground) < LAYER_BAND ? 1 : 0;
    return g;
  };

  // Vertices: a welded point plus carried attribute values (and the source normal, if any).
  let vertexCapacity = Math.max(1024, vertexCount + sourceTriangles),
    vertexTotal = 0;
  let vertexPoint = allocate(Int32Array, vertexCapacity),
    vertexValue = allocate(Float64Array, vertexCapacity * stride);
  const addVertex = (g) => {
    if (vertexTotal === vertexCapacity) {
      vertexCapacity = Math.ceil(vertexCapacity * 1.5);
      vertexPoint = resize(vertexPoint, vertexCapacity);
      vertexValue = resize(vertexValue, vertexCapacity * stride);
    }
    vertexPoint[vertexTotal] = g;
    return vertexTotal++;
  };
  {
    const capacity = nextPowerOfTwo(vertexCount * 2),
      mask = capacity - 1;
    const slots = allocate(Int32Array, capacity).fill(-1);
    const bits = new Float64Array(3),
      words = new Int32Array(bits.buffer);
    for (let v = 0; v < vertexCount; v++) {
      // +0 folds -0 into 0, so equal coordinates hash alike.
      const x = position.getX(v) + 0,
        y = position.getY(v) + 0,
        z = position.getZ(v) + 0;
      bits[0] = x;
      bits[1] = y;
      bits[2] = z;
      let hash = 0x811c9dc5;
      for (let k = 0; k < 6; k++) hash = Math.imul(hash ^ words[k], 0x01000193);
      let slot = (hash ^ (hash >>> 16)) & mask,
        g = -1;
      for (; slots[slot] !== -1; slot = (slot + 1) & mask) {
        const k = slots[slot];
        if (sx[k] === x && sy[k] === y && sz[k] === z) {
          g = k;
          break;
        }
      }
      if (g < 0) slots[slot] = g = addPoint(x, y, z);
      const base = addVertex(g) * stride;
      for (let j = 0; j < carried.length; j++)
        for (let c = 0; c < carried[j].itemSize; c++)
          vertexValue[base + offsets[j] + c] = carried[j].getComponent(v, c);
      if (keepNormals) {
        vertexValue[base + normalOffset] = normal.getX(v);
        vertexValue[base + normalOffset + 1] = normal.getY(v);
        vertexValue[base + normalOffset + 2] = normal.getZ(v);
      }
    }
    release(slots);
  }
  const sourcePoints = pointCount;

  // Triangles: three vertices, the source triangle they refine, bisection depth, liveness.
  let triangleCapacity = Math.max(1024, sourceTriangles * 3),
    triangleCount = 0;
  let ta = allocate(Int32Array, triangleCapacity),
    tb = allocate(Int32Array, triangleCapacity),
    tc = allocate(Int32Array, triangleCapacity),
    troot = allocate(Int32Array, triangleCapacity),
    tdepth = allocate(Uint8Array, triangleCapacity),
    talive = allocate(Uint8Array, triangleCapacity);

  // Edges between welded points: midpoint, split flags and the live triangles using the edge.
  // Slots move when the table grows, so callers reserve space before holding slot numbers.
  let edgeCapacity = nextPowerOfTwo(sourceTriangles * 4 + 16),
    edgeMask = edgeCapacity - 1,
    edgeCount = 0;
  let edgeA = allocate(Int32Array, edgeCapacity).fill(-1),
    edgeB = allocate(Int32Array, edgeCapacity),
    edgeMidpoint = allocate(Int32Array, edgeCapacity),
    edgeT0 = allocate(Int32Array, edgeCapacity),
    edgeT1 = allocate(Int32Array, edgeCapacity),
    edgeFlag = allocate(Uint8Array, edgeCapacity);
  // A third or later live triangle on an edge (non-manifold source). Outside the typed array
  // accounting, so its references are limited on their own.
  const crowded = new Map<number, number[]>();
  let crowdedReferences = 0,
    crowdedPeak = 0;
  const edgeKey = (s) => edgeA[s] * POINT_KEY + edgeB[s];
  const findEdge = (g, h) => {
    const a = g < h ? g : h,
      b = g < h ? h : g;
    for (let s = pairHash(a, b) & edgeMask; ; s = (s + 1) & edgeMask) {
      const k = edgeA[s];
      if (k === -1) return -1;
      if (k === a && edgeB[s] === b) return s;
    }
  };
  const insertEdge = (g, h) => {
    const a = g < h ? g : h,
      b = g < h ? h : g;
    for (let s = pairHash(a, b) & edgeMask; ; s = (s + 1) & edgeMask) {
      const k = edgeA[s];
      if (k === a && edgeB[s] === b) return s;
      if (k === -1) {
        edgeA[s] = a;
        edgeB[s] = b;
        edgeMidpoint[s] = -1;
        edgeT0[s] = -1;
        edgeT1[s] = -1;
        edgeFlag[s] = 0;
        edgeCount++;
        return s;
      }
    }
  };
  const reserveEdges = (extra) => {
    if ((edgeCount + extra) * 5 <= edgeCapacity * 3) return;
    const oldA = edgeA,
      oldB = edgeB,
      oldMidpoint = edgeMidpoint,
      oldT0 = edgeT0,
      oldT1 = edgeT1,
      oldFlag = edgeFlag,
      oldCapacity = edgeCapacity;
    edgeCapacity *= 2;
    edgeMask = edgeCapacity - 1;
    edgeA = allocate(Int32Array, edgeCapacity).fill(-1);
    edgeB = allocate(Int32Array, edgeCapacity);
    edgeMidpoint = allocate(Int32Array, edgeCapacity);
    edgeT0 = allocate(Int32Array, edgeCapacity);
    edgeT1 = allocate(Int32Array, edgeCapacity);
    edgeFlag = allocate(Uint8Array, edgeCapacity);
    for (let s = 0; s < oldCapacity; s++) {
      const a = oldA[s];
      if (a === -1) continue;
      const b = oldB[s];
      let n = pairHash(a, b) & edgeMask;
      while (edgeA[n] !== -1) n = (n + 1) & edgeMask;
      edgeA[n] = a;
      edgeB[n] = b;
      edgeMidpoint[n] = oldMidpoint[s];
      edgeT0[n] = oldT0[s];
      edgeT1[n] = oldT1[s];
      edgeFlag[n] = oldFlag[s];
    }
    for (const array of [oldA, oldB, oldMidpoint, oldT0, oldT1, oldFlag]) release(array);
  };
  const attach = (s, t) => {
    if (edgeT0[s] === -1) edgeT0[s] = t;
    else if (edgeT1[s] === -1) edgeT1[s] = t;
    else {
      if (++crowdedReferences > CROWDED_LIMIT)
        throw new Error(`Source surface fit exceeded ${CROWDED_LIMIT} non-manifold edge uses`);
      crowdedPeak = Math.max(crowdedPeak, crowdedReferences);
      const key = edgeKey(s),
        list = crowded.get(key);
      if (list) list.push(t);
      else crowded.set(key, [t]);
    }
  };
  const detach = (s, t) => {
    if (edgeT0[s] === t) {
      edgeT0[s] = edgeT1[s];
      edgeT1[s] = -1;
    } else if (edgeT1[s] === t) edgeT1[s] = -1;
    else {
      const key = edgeKey(s),
        list = crowded.get(key),
        i = list ? list.indexOf(t) : -1;
      if (i < 0) throw new Error('Source surface fit lost a triangle edge');
      list.splice(i, 1);
      crowdedReferences--;
      if (!list.length) crowded.delete(key);
      return;
    }
    if (crowded.size && edgeT0[s] !== -1) {
      const key = edgeKey(s),
        list = crowded.get(key);
      if (list) {
        edgeT1[s] = list.shift();
        crowdedReferences--;
        if (!list.length) crowded.delete(key);
      }
    }
  };
  // The exact deformed midpoint of an edge, made once and shared by every triangle using it.
  const edgePoint = (s) => {
    let m = edgeMidpoint[s];
    if (m === -1) {
      const a = edgeA[s],
        b = edgeB[s];
      m = addPoint((sx[a] + sx[b]) * 0.5, (sy[a] + sy[b]) * 0.5, (sz[a] + sz[b]) * 0.5);
      edgeMidpoint[s] = m;
    }
    return m;
  };

  // Midpoint vertices per vertex pair: one for an ordinary edge, one per side of a UV seam.
  let pairCapacity = nextPowerOfTwo(sourceTriangles + 16),
    pairMask = pairCapacity - 1,
    pairCount = 0;
  let pairA = allocate(Int32Array, pairCapacity).fill(-1),
    pairB = allocate(Int32Array, pairCapacity),
    pairVertex = allocate(Int32Array, pairCapacity);
  const reservePairs = (extra) => {
    if ((pairCount + extra) * 5 <= pairCapacity * 3) return;
    const oldA = pairA,
      oldB = pairB,
      oldVertex = pairVertex,
      oldCapacity = pairCapacity;
    pairCapacity *= 2;
    pairMask = pairCapacity - 1;
    pairA = allocate(Int32Array, pairCapacity).fill(-1);
    pairB = allocate(Int32Array, pairCapacity);
    pairVertex = allocate(Int32Array, pairCapacity);
    for (let s = 0; s < oldCapacity; s++) {
      const a = oldA[s];
      if (a === -1) continue;
      let n = pairHash(a, oldB[s]) & pairMask;
      while (pairA[n] !== -1) n = (n + 1) & pairMask;
      pairA[n] = a;
      pairB[n] = oldB[s];
      pairVertex[n] = oldVertex[s];
    }
    for (const array of [oldA, oldB, oldVertex]) release(array);
  };
  const midpointVertex = (p, q, g) => {
    const a = p < q ? p : q,
      b = p < q ? q : p;
    let s = pairHash(a, b) & pairMask;
    for (; pairA[s] !== -1; s = (s + 1) & pairMask)
      if (pairA[s] === a && pairB[s] === b) return pairVertex[s];
    const m = addVertex(g);
    const pa = a * stride,
      pb = b * stride,
      pm = m * stride;
    for (let i = 0; i < stride; i++)
      vertexValue[pm + i] = (vertexValue[pa + i] + vertexValue[pb + i]) * 0.5;
    pairA[s] = a;
    pairB[s] = b;
    pairVertex[s] = m;
    pairCount++;
    return m;
  };

  let stack = allocate(Int32Array, 1024),
    stackSize = 0;
  const push = (t) => {
    if (stackSize === stack.length) stack = resize(stack, stack.length * 2);
    stack[stackSize++] = t;
  };
  const queueNeighbours = (s, t) => {
    const u = edgeT0[s],
      w = edgeT1[s];
    if (u !== -1 && u !== t) push(u);
    if (w !== -1 && w !== t) push(w);
    const list = crowded.size ? crowded.get(edgeKey(s)) : undefined;
    if (list) for (const v of list) if (v !== t) push(v);
  };
  const addTriangle = (a, b, c, root, depth) => {
    if (triangleCount === triangleCapacity) {
      triangleCapacity = Math.ceil(triangleCapacity * 1.5);
      ta = resize(ta, triangleCapacity);
      tb = resize(tb, triangleCapacity);
      tc = resize(tc, triangleCapacity);
      troot = resize(troot, triangleCapacity);
      tdepth = resize(tdepth, triangleCapacity);
      talive = resize(talive, triangleCapacity);
    }
    const t = triangleCount++;
    ta[t] = a;
    tb[t] = b;
    tc[t] = c;
    troot[t] = root;
    tdepth[t] = depth;
    talive[t] = 1;
    const ga = vertexPoint[a],
      gb = vertexPoint[b],
      gc = vertexPoint[c];
    attach(insertEdge(ga, gb), t);
    attach(insertEdge(gb, gc), t);
    attach(insertEdge(gc, ga), t);
    return t;
  };
  for (let k = 0; k < sourceTriangles; k++) {
    reserveEdges(3);
    const i = k * 3;
    addTriangle(
      index ? index.getX(i) : i,
      index ? index.getX(i + 1) : i + 1,
      index ? index.getX(i + 2) : i + 2,
      k,
      0,
    );
  }
  const markBoundary = (s) => {
    if (edgeT0[s] !== -1 && edgeT1[s] === -1) edgeFlag[s] |= BOUNDARY;
  };
  for (let t = 0; t < sourceTriangles; t++) {
    const ga = vertexPoint[ta[t]],
      gb = vertexPoint[tb[t]],
      gc = vertexPoint[tc[t]];
    markBoundary(findEdge(ga, gb));
    markBoundary(findEdge(gb, gc));
    markBoundary(findEdge(gc, ga));
  }

  // ---- Refinement criteria. Lengths are horizontal in fitted space, as before. ----
  const length2 = (g, h) => {
    const dx = px[g] - px[h],
      dz = pz[g] - pz[h];
    return dx * dx + dz * dz;
  };
  const nearValley = (g) => Math.abs(px[g] - riverX(pz[g])) < 6;
  const minimumLimit2 = Math.min(mountainOnly ? 0.1 : maximumEdge, maximumEdge) ** 2;
  // The previous fit's edge limit (squared) for these points; Infinity where it kept source
  // triangles whole. Its boxes follow the coarse river polyline, so water near the measured
  // centreline but outside those boxes also receives maximumEdge.
  const limit2 = (g0, g1, g2) => {
    const minX = Math.min(px[g0], px[g1], px[g2]),
      maxX = Math.max(px[g0], px[g1], px[g2]),
      minZ = Math.min(pz[g0], pz[g1], pz[g2]),
      maxZ = Math.max(pz[g0], pz[g1], pz[g2]);
    let edge;
    if (
      mountainOnly &&
      (boxOverlaps(CAVE_FOOT, minX, maxX, minZ, maxZ) ||
        boxOverlaps(CAVE_HILL, minX, maxX, minZ, maxZ))
    ) {
      const mouth =
        maxX >= CAMP_CAVE.x - 8 &&
        minX <= CAMP_CAVE.x + 8 &&
        maxZ >= CAMP_CAVE.z - 10 &&
        minZ <= CAMP_CAVE.z - 7.5;
      edge = Math.min(
        mouth ? 0.1 : nearValley(g0) || nearValley(g1) || nearValley(g2) ? 0.2 : 0.6,
        maximumEdge,
      );
    } else if (waterOverlaps(minX, maxX, minZ, maxZ, mountainOnly)) edge = maximumEdge;
    else if (
      mountainOnly &&
      Math.max(sz[g0], sz[g1], sz[g2]) > MOUNTAIN_EXPANSION.start &&
      Math.min(sz[g0], sz[g1], sz[g2]) < MOUNTAIN_EXPANSION.end
    )
      edge = 2;
    else {
      const margin =
        COVERAGE_MARGIN +
        0.5 * Math.sqrt(Math.max(length2(g0, g1), length2(g1, g2), length2(g2, g0)));
      if (!mountainWaterNear(minX - margin, maxX + margin, minZ - margin, maxZ + margin))
        return Infinity;
      edge = maximumEdge;
    }
    return edge * edge;
  };
  const covered = (minX, maxX, minZ, maxZ, longest2) =>
    (longest2 > VALLEY_WIDTH * VALLEY_WIDTH && valleyNear(minX, maxX, minZ, maxZ, mountainOnly)) ||
    (longest2 > MOUNTAIN_RIVER_WIDTH * MOUNTAIN_RIVER_WIDTH &&
      mountainWaterNear(minX, maxX, minZ, maxZ)) ||
    (mountainOnly &&
      longest2 > MOUTH_WIDTH * MOUTH_WIDTH &&
      boxOverlaps(MOUTH_BAND, minX, maxX, minZ, maxZ));
  // Horizontal offset of an edge's exact midpoint from its chord: the expansion bends edges.
  const deviation = (m, g, h) =>
    Math.hypot(px[m] - (px[g] + px[h]) * 0.5, pz[m] - (pz[g] + pz[h]) * 0.5);
  // Whether the exact deformed point g departs from the facet (a,b,c) with normal n, compared at
  // barycentric weights (wa,wb,wc): by more than `tolerance` in vertical-equivalent distance, or
  // by more than FIT_TOLERANCE in riverCut.
  const departs = (g, a, b, c, wa, wb, wc, nx, ny, nz, scale, tolerance) => {
    const dx = px[g] - (wa * px[a] + wb * px[b] + wc * px[c]),
      dy = py[g] - (wa * py[a] + wb * py[b] + wc * py[c]),
      dz = pz[g] - (wa * pz[a] + wb * pz[b] + wc * pz[c]);
    const surface =
      scale > 0 ? Math.abs(nx * dx + ny * dy + nz * dz) / scale : Math.hypot(dx, dy, dz);
    return (
      surface > tolerance ||
      Math.abs(cut[g] - (wa * cut[a] + wb * cut[b] + wc * cut[c])) > FIT_TOLERANCE
    );
  };
  const chordError = (m, a, b) => {
    const ex = px[b] - px[a],
      ey = py[b] - py[a],
      ez = pz[b] - pz[a],
      qx = px[m] - px[a],
      qy = py[m] - py[a],
      qz = pz[m] - pz[a],
      squared = ex * ex + ey * ey + ez * ez;
    const t = squared > 0 ? Math.max(0, Math.min(1, (qx * ex + qy * ey + qz * ez) / squared)) : 0;
    return Math.hypot(qx - ex * t, qy - ey * t, qz - ez * t);
  };
  let splits = 0,
    coverageSplits = 0,
    errorSplits = 0,
    layerSplits = 0,
    conformingSplits = 0,
    boundarySplits = 0,
    boundaryEdgeSplits = 0;
  const wantsSplit = (t, ga, gb, gc, s0, s1, s2, longest, longest2) => {
    if (tdepth[t] >= LEGACY_DEPTH || longest2 <= minimumLimit2 || !(longest2 > limit2(ga, gb, gc)))
      return false;
    const m0 = edgePoint(s0),
      m1 = edgePoint(s1),
      m2 = edgePoint(s2);
    if (longest2 > NARROWEST * NARROWEST) {
      const margin =
        2 * Math.max(deviation(m0, ga, gb), deviation(m1, gb, gc), deviation(m2, gc, ga)) +
        COVERAGE_MARGIN;
      if (
        covered(
          Math.min(px[ga], px[gb], px[gc], px[m0], px[m1], px[m2]) - margin,
          Math.max(px[ga], px[gb], px[gc], px[m0], px[m1], px[m2]) + margin,
          Math.min(pz[ga], pz[gb], pz[gc], pz[m0], pz[m1], pz[m2]) - margin,
          Math.max(pz[ga], pz[gb], pz[gc], pz[m0], pz[m1], pz[m2]) + margin,
          longest2,
        )
      ) {
        coverageSplits++;
        return true;
      }
    }
    const ux = px[gb] - px[ga],
      uy = py[gb] - py[ga],
      uz = pz[gb] - pz[ga],
      vx = px[gc] - px[ga],
      vy = py[gc] - py[ga],
      vz = pz[gc] - pz[ga];
    const nx = uy * vz - uz * vy,
      ny = uz * vx - ux * vz,
      nz = ux * vy - uy * vx,
      area = Math.hypot(nx, ny, nz);
    const scale = area > 1e-12 ? Math.max(Math.abs(ny), STEEP_NORMAL * area) : 0;
    let layered = (near[ga] | near[gb] | near[gc] | near[m0] | near[m1] | near[m2]) !== 0;
    let tolerance = layered ? LAYER_TOLERANCE : FIT_TOLERANCE;
    if (
      departs(m0, ga, gb, gc, 0.5, 0.5, 0, nx, ny, nz, scale, tolerance) ||
      departs(m1, ga, gb, gc, 0, 0.5, 0.5, nx, ny, nz, scale, tolerance) ||
      departs(m2, ga, gb, gc, 0.5, 0, 0.5, nx, ny, nz, scale, tolerance)
    ) {
      errorSplits++;
      if (layered) layerSplits++;
      return true;
    }
    // One interior point, (1/4,1/4,1/2) toward the vertex opposite the longest edge. It is the
    // next bisector's midpoint, so a split reuses the sample.
    const inner = edgePoint(
      insertEdge(
        longest === 0 ? m0 : longest === 1 ? m1 : m2,
        longest === 0 ? gc : longest === 1 ? ga : gb,
      ),
    );
    if (near[inner]) {
      layered = true;
      tolerance = LAYER_TOLERANCE;
    }
    if (
      departs(
        inner,
        ga,
        gb,
        gc,
        longest === 1 ? 0.5 : 0.25,
        longest === 2 ? 0.5 : 0.25,
        longest === 0 ? 0.5 : 0.25,
        nx,
        ny,
        nz,
        scale,
        tolerance,
      )
    ) {
      errorSplits++;
      if (layered) layerSplits++;
      return true;
    }
    return false;
  };
  // A mesh-boundary edge is also tested from its own endpoints alone, so another chunk or LOD
  // holding the same edge splits it too; where only one side splits it, the other side's chord
  // already lies within the tolerance of the exact deformed edge.
  const decideBoundary = (s) => {
    const flag = edgeFlag[s];
    if ((flag & (BOUNDARY | DECIDED)) !== BOUNDARY) return;
    edgeFlag[s] = flag | DECIDED;
    const a = edgeA[s],
      b = edgeB[s],
      length = length2(a, b);
    if (length <= minimumLimit2 || !(length > limit2(a, b, b))) return;
    const m = edgePoint(s),
      margin = 2 * deviation(m, a, b) + COVERAGE_MARGIN,
      tolerance = near[a] | near[b] | near[m] ? LAYER_TOLERANCE : FIT_TOLERANCE;
    if (
      (length > NARROWEST * NARROWEST &&
        covered(
          Math.min(px[a], px[b], px[m]) - margin,
          Math.max(px[a], px[b], px[m]) + margin,
          Math.min(pz[a], pz[b], pz[m]) - margin,
          Math.max(pz[a], pz[b], pz[m]) + margin,
          length,
        )) ||
      chordError(m, a, b) > tolerance ||
      Math.abs(cut[m] - (cut[a] + cut[b]) * 0.5) > FIT_TOLERANCE
    ) {
      edgeFlag[s] |= SPLIT;
      boundarySplits++;
    }
  };
  // Bisect edge (0: a-b, 1: b-c, 2: c-a) of a live triangle, keeping its winding.
  const split = (t, edge) => {
    const a = ta[t],
      b = tb[t],
      c = tc[t];
    const p = edge === 0 ? a : edge === 1 ? b : c,
      q = edge === 0 ? b : edge === 1 ? c : a,
      r = edge === 0 ? c : edge === 1 ? a : b;
    const gp = vertexPoint[p],
      gq = vertexPoint[q],
      gr = vertexPoint[r];
    const s = findEdge(gp, gq),
      registered = edgeFlag[s] & SPLIT;
    edgeFlag[s] |= SPLIT;
    const m = midpointVertex(p, q, edgePoint(s));
    detach(s, t);
    detach(findEdge(gq, gr), t);
    detach(findEdge(gr, gp), t);
    talive[t] = 0;
    // Triangles across a newly split edge must split it too.
    if (!registered) queueNeighbours(s, t);
    const depth = tdepth[t] + 1,
      root = troot[t];
    if (depth > MAXIMUM_DEPTH)
      throw new Error(`Source surface fit exceeded ${MAXIMUM_DEPTH} bisections of ${root}`);
    const first = addTriangle(p, m, r, root, depth),
      second = addTriangle(m, q, r, root, depth);
    if (edgeFlag[s] & BOUNDARY) {
      const gm = vertexPoint[m];
      edgeFlag[findEdge(gp, gm)] |= BOUNDARY;
      edgeFlag[findEdge(gm, gq)] |= BOUNDARY;
      boundaryEdgeSplits++;
    }
    splits++;
    push(second);
    push(first);
  };
  // A triangle holding a split edge is always bisected, and always on its longest edge (the
  // previous fit's rule, first longest on ties). Descendants keep that edge until it is their
  // longest, so it is bisected there too; triangles stay in the bisection family, no slivers.
  const refine = (t) => {
    if (!talive[t]) return;
    // At most four edges and one midpoint vertex are added below; held slots stay valid.
    reserveEdges(8);
    reservePairs(2);
    const ga = vertexPoint[ta[t]],
      gb = vertexPoint[tb[t]],
      gc = vertexPoint[tc[t]];
    const s0 = findEdge(ga, gb),
      s1 = findEdge(gb, gc),
      s2 = findEdge(gc, ga);
    if (s0 < 0 || s1 < 0 || s2 < 0) throw new Error('Source surface fit lost a triangle edge');
    decideBoundary(s0);
    decideBoundary(s1);
    decideBoundary(s2);
    const l0 = length2(ga, gb),
      l1 = length2(gb, gc),
      l2 = length2(gc, ga);
    const longest = l0 >= l1 && l0 >= l2 ? 0 : l1 >= l2 ? 1 : 2;
    if ((edgeFlag[s0] | edgeFlag[s1] | edgeFlag[s2]) & SPLIT) conformingSplits++;
    else if (!wantsSplit(t, ga, gb, gc, s0, s1, s2, longest, Math.max(l0, l1, l2))) return;
    split(t, longest);
  };
  for (let root = 0; root < sourceTriangles; root++) {
    push(root);
    while (stackSize) refine(stack[--stackSize]);
  }

  // ---- Output: live triangles grouped by source triangle, used vertices in creation order. ----
  const firstOutput = allocate(Int32Array, sourceTriangles + 1);
  for (let t = 0; t < triangleCount; t++) if (talive[t]) firstOutput[troot[t] + 1]++;
  for (let k = 0; k < sourceTriangles; k++) firstOutput[k + 1] += firstOutput[k];
  const triangles = firstOutput[sourceTriangles];
  const order = allocate(Int32Array, triangles);
  {
    const cursor = allocate(Int32Array, sourceTriangles);
    cursor.set(firstOutput.subarray(0, sourceTriangles));
    for (let t = 0; t < triangleCount; t++) if (talive[t]) order[cursor[troot[t]]++] = t;
    release(cursor);
  }
  const outputOf = allocate(Int32Array, vertexTotal).fill(-1);
  for (let i = 0; i < triangles; i++) {
    const t = order[i];
    outputOf[ta[t]] = outputOf[tb[t]] = outputOf[tc[t]] = -2;
  }
  let vertices = 0;
  for (let a = 0; a < vertexTotal; a++) if (outputOf[a] === -2) outputOf[a] = vertices++;
  const outputPosition = new Float32Array(vertices * 3),
    outputCarried = carried.map((attribute) => new Float32Array(vertices * attribute.itemSize)),
    outputCut = new Float32Array(vertices),
    outputNormal = new Float32Array(vertices * 3),
    outputIndex =
      vertices <= 65535 ? new Uint16Array(triangles * 3) : new Uint32Array(triangles * 3);
  let outputBytes = outputPosition.byteLength + outputCut.byteLength + outputNormal.byteLength;
  outputBytes += outputIndex.byteLength;
  for (const array of outputCarried) outputBytes += array.byteLength;
  account(outputBytes);
  for (let a = 0; a < vertexTotal; a++) {
    const v = outputOf[a];
    if (v < 0) continue;
    const g = vertexPoint[a],
      base = a * stride;
    outputPosition[v * 3] = px[g];
    outputPosition[v * 3 + 1] = py[g];
    outputPosition[v * 3 + 2] = pz[g];
    outputCut[v] = cut[g];
    for (let j = 0; j < carried.length; j++) {
      const size = carried[j].itemSize,
        target = outputCarried[j];
      for (let c = 0; c < size; c++) target[v * size + c] = vertexValue[base + offsets[j] + c];
    }
  }
  for (let i = 0; i < triangles; i++) {
    const t = order[i];
    outputIndex[i * 3] = outputOf[ta[t]];
    outputIndex[i * 3 + 1] = outputOf[tb[t]];
    outputIndex[i * 3 + 2] = outputOf[tc[t]];
  }
  // Area-weighted normals per welded point (computeVertexNormals on the welded mesh, so UV seams
  // shade alike). Points whose triangles are all undeformed keep the source normal.
  const compact = allocate(Int32Array, pointCount).fill(-1);
  let usedPoints = 0;
  for (let a = 0; a < vertexTotal; a++)
    if (outputOf[a] >= 0 && compact[vertexPoint[a]] === -1) compact[vertexPoint[a]] = usedPoints++;
  const normalSum = allocate(Float64Array, usedPoints * 3),
    state = allocate(Uint8Array, usedPoints);
  for (let g = 0; g < pointCount; g++) {
    const c = compact[g];
    if (
      c >= 0 &&
      (Math.abs(px[g] - sx[g]) > UNDEFORMED ||
        Math.abs(py[g] - sy[g]) > UNDEFORMED ||
        Math.abs(pz[g] - sz[g]) > UNDEFORMED ||
        cut[g] > UNDEFORMED)
    )
      state[c] = 1;
  }
  for (let i = 0; i < triangles; i++) {
    const A = outputIndex[i * 3] * 3,
      B = outputIndex[i * 3 + 1] * 3,
      C = outputIndex[i * 3 + 2] * 3;
    const ux = outputPosition[C] - outputPosition[B],
      uy = outputPosition[C + 1] - outputPosition[B + 1],
      uz = outputPosition[C + 2] - outputPosition[B + 2],
      vx = outputPosition[A] - outputPosition[B],
      vy = outputPosition[A + 1] - outputPosition[B + 1],
      vz = outputPosition[A + 2] - outputPosition[B + 2];
    const nx = uy * vz - uz * vy,
      ny = uz * vx - ux * vz,
      nz = ux * vy - uy * vx;
    const t = order[i],
      pa = compact[vertexPoint[ta[t]]],
      pb = compact[vertexPoint[tb[t]]],
      pc = compact[vertexPoint[tc[t]]];
    normalSum[pa * 3] += nx;
    normalSum[pa * 3 + 1] += ny;
    normalSum[pa * 3 + 2] += nz;
    normalSum[pb * 3] += nx;
    normalSum[pb * 3 + 1] += ny;
    normalSum[pb * 3 + 2] += nz;
    normalSum[pc * 3] += nx;
    normalSum[pc * 3 + 1] += ny;
    normalSum[pc * 3 + 2] += nz;
    if ((state[pa] | state[pb] | state[pc]) & 1) {
      state[pa] |= 2;
      state[pb] |= 2;
      state[pc] |= 2;
    }
  }
  for (let a = 0; a < vertexTotal; a++) {
    const v = outputOf[a];
    if (v < 0) continue;
    const c = compact[vertexPoint[a]];
    let x, y, z;
    if (keepNormals && !(state[c] & 2)) {
      const o = a * stride + normalOffset;
      x = vertexValue[o];
      y = vertexValue[o + 1];
      z = vertexValue[o + 2];
      if (a < vertexCount) {
        outputNormal[v * 3] = x;
        outputNormal[v * 3 + 1] = y;
        outputNormal[v * 3 + 2] = z;
        continue;
      }
    } else {
      x = normalSum[c * 3];
      y = normalSum[c * 3 + 1];
      z = normalSum[c * 3 + 2];
    }
    const length = Math.hypot(x, y, z) || 1;
    outputNormal[v * 3] = x / length;
    outputNormal[v * 3 + 1] = y / length;
    outputNormal[v * 3 + 2] = z / length;
  }

  const geometry = new THREE.BufferGeometry();
  for (const name of names) {
    if (name === 'position')
      geometry.setAttribute('position', new THREE.BufferAttribute(outputPosition, 3));
    else {
      const j = carriedNames.indexOf(name);
      geometry.setAttribute(name, new THREE.BufferAttribute(outputCarried[j], carried[j].itemSize));
    }
  }
  geometry.setAttribute('riverCut', new THREE.BufferAttribute(outputCut, 1));
  geometry.setAttribute('normal', new THREE.BufferAttribute(outputNormal, 3));
  geometry.setIndex(new THREE.BufferAttribute(outputIndex, 1));
  for (const { range, materialIndex } of groups)
    geometry.addGroup(
      3 * firstOutput[range[0]],
      3 * (firstOutput[range[1]] - firstOutput[range[0]]),
      materialIndex,
    );
  if (draw)
    geometry.setDrawRange(
      3 * firstOutput[draw.range[0]],
      draw.open ? Infinity : 3 * (firstOutput[draw.range[1]] - firstOutput[draw.range[0]]),
    );
  geometry.computeBoundingSphere();
  if (stats)
    Object.assign(stats, {
      noOp: false,
      sourceTriangles,
      sourceVertices: vertexCount,
      triangles,
      vertices,
      splits,
      coverageSplits,
      errorSplits,
      layerSplits,
      conformingSplits,
      boundarySplits,
      boundaryEdgeSplits,
      samplePoints: pointCount - sourcePoints,
      peakTypedArrayBytes: peakBytes,
      crowdedReferences: crowdedPeak,
      outputBytes,
    });
  return geometry;
}
