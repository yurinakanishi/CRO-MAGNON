import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { geometryScene } from '../scripts/measure-collision-bounds.mjs';
import {
  legacyTriangles,
  openEdges,
  verticalSurface,
} from '../scripts/benchmark-adaptive-surface-fit.mjs';
import { fitSourceRiverBank, measureSourceRiverBankFit } from '../dist/src/source-surface-fit.js';
import { RiverBankBuilder } from '../dist/src/river-bank-builder.js';
import { riverBankDrop, riverX } from '../dist/shared/river-profile.mjs';
import { MOUNTAIN_RIVER_SAMPLES, mountainRiverBed } from '../dist/shared/mountain-river.mjs';
import { mountainLakeIntersects } from '../dist/shared/mountain-lake.mjs';
import { CAMP_CAVE, CAMP_MOUNTAIN, caveFootHeight } from '../dist/shared/camp-cave-layout.mjs';
import { expandedMountainX } from '../dist/shared/mountain-expansion.mjs';

// Flat source quads wound upward, each with its own vertices: neighbours meet at a UV seam.
function quads(list, normal) {
  const position = [],
    uv = [],
    normals = [],
    index = [];
  for (const q of list) {
    const base = position.length / 3;
    for (const [x, z] of [
      [q.minX, q.minZ],
      [q.maxX, q.minZ],
      [q.maxX, q.maxZ],
      [q.minX, q.maxZ],
    ]) {
      position.push(x, q.y ?? 0, z);
      uv.push(
        ...(q.uv?.(x, z) ?? [(x - q.minX) / (q.maxX - q.minX), (z - q.minZ) / (q.maxZ - q.minZ)]),
      );
      if (normal) normals.push(...normal);
    }
    index.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  if (normal) geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setIndex(index);
  return geometry;
}

const triangleCount = (geometry) => geometry.index.count / 3;

function* faces(geometry) {
  const p = geometry.attributes.position,
    index = geometry.index;
  for (let i = 0; i < index.count; i += 3) {
    const corners = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
    yield {
      corners,
      points: corners.map((v) => new THREE.Vector3().fromBufferAttribute(p, v)),
    };
  }
}

// Only the source outline may stay open; a T-junction would open an interior edge.
function assertOutline(geometry, minX, maxX, minZ, maxZ) {
  const { open, crowded } = openEdges(geometry);
  assert.equal(crowded, 0, 'no edge may be shared by three faces');
  const along = (a, b, axis, value) =>
    Math.abs(a[axis] - value) < 1e-4 && Math.abs(b[axis] - value) < 1e-4;
  for (const [a, b] of open)
    assert.ok(
      along(a, b, 0, minX) || along(a, b, 0, maxX) || along(a, b, 2, minZ) || along(a, b, 2, maxZ),
      `interior edge left open: ${a} - ${b}`,
    );
  assert.ok(open.length >= 4);
}

function snapshot(geometry) {
  return {
    attributes: Object.fromEntries(
      Object.entries(geometry.attributes).map(([name, a]) => [name, Array.from(a.array)]),
    ),
    index: geometry.index ? Array.from(geometry.index.array) : null,
  };
}

test('a narrow river crossing a coarse triangle is found although no vertex or edge midpoint touches it', () => {
  const source = quads([{ minX: 50, maxX: 100, minZ: 30, maxZ: 36 }]);
  // Vertices, edge midpoints and the interior points the error measure samples all lie on dry
  // ground; only the feature band test can see the 7.6 m wide river between them.
  for (const [x, z] of [
    [50, 30],
    [100, 30],
    [100, 36],
    [50, 36],
    [75, 33],
    [75, 30],
    [75, 36],
    [100, 33],
    [50, 33],
    [87.5, 31.5],
    [62.5, 34.5],
  ])
    assert.equal(riverBankDrop(x, z), 0, `${x},${z} must be outside the banks`);
  const { geometry, stats } = measureSourceRiverBankFit(source.clone());
  try {
    const height = verticalSurface(geometry, 0.5);
    for (let z = 30.5; z <= 35.5; z += 1)
      for (const offset of [-5, -3.2, -2, -1, 0, 1, 2, 3.2, 5]) {
        const x = riverX(z) + offset,
          y = height(x, z);
        assert.ok(y !== undefined, `hole at ${x},${z}`);
        assert.ok(Math.abs(y + riverBankDrop(x, z)) < 0.045, `bank bridged at ${x},${z}: ${y}`);
      }
    const p = geometry.attributes.position,
      uv = geometry.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      assert.ok(Math.abs(uv.getX(i) - (p.getX(i) - 50) / 50) < 0.00001);
      assert.ok(Math.abs(uv.getY(i) - (p.getZ(i) - 30) / 6) < 0.00001);
    }
    assertOutline(geometry, 50, 100, 30, 36);
    let far = 0;
    for (const { points } of faces(geometry)) {
      const x = (points[0].x + points[1].x + points[2].x) / 3,
        z = (points[0].z + points[1].z + points[2].z) / 3;
      if (Math.abs(x - riverX(z)) > 10) far++;
    }
    assert.ok(far < 100, `${far} triangles refine dry ground far from the river`);
    const previous = legacyTriangles(source, 0.5, false);
    assert.ok(stats.triangles * 4 < previous, `${stats.triangles} of ${previous} triangles`);
  } finally {
    source.dispose();
    geometry.dispose();
  }
});

test('the cave-mouth rim stays continuous and follows the exact deformed hillside', () => {
  // A flat 12 m source slope whose expanded footprint (2.6x east of x=0) covers the rock mouth.
  const source = quads([{ minX: 14, maxX: 26, minZ: 80, maxZ: 92, y: 12 }]);
  const { geometry, stats } = measureSourceRiverBankFit(source.clone(), 0.45, true);
  try {
    const height = verticalSurface(geometry, 0.25);
    const rim = CAMP_CAVE.z - 9.4;
    let worst = 0;
    for (let across = -7; across <= 7; across += 0.5)
      for (let z = 80.5; z <= 91.5; z += 0.25) {
        const x = CAMP_CAVE.x + across,
          y = height(x, z);
        assert.ok(y !== undefined, `hole at ${x},${z}`);
        if (Math.abs(across) > 3.4) continue;
        // The level trench floor and the hillside above it are resolved to the general
        // tolerance; the 1.2 m rim between them to the cave-hill test's 0.25 m.
        const error = Math.abs(y - mountainRiverBed(x, z, caveFootHeight(x, z, 12)));
        const smooth = z <= rim - 0.6 || z >= rim + 1.8;
        assert.ok(error < (smooth ? 0.045 : 0.25), `mouth surface ${x},${z}: ${error}`);
        worst = Math.max(worst, error);
      }
    assert.ok(Math.abs(height(CAMP_CAVE.x, rim - 1)) < 0.045, 'the trench floor stays level');
    assert.ok(height(CAMP_CAVE.x, rim + 2) > 10, 'the hillside still rises above the rim');
    assertOutline(
      geometry,
      Math.fround(expandedMountainX(14, 86)),
      Math.fround(expandedMountainX(26, 86)),
      80,
      92,
    );
    const previous = legacyTriangles(source, 0.45, true);
    assert.ok(stats.triangles < previous, `${stats.triangles} of ${previous} triangles`);
  } finally {
    source.dispose();
    geometry.dispose();
  }
});

test('where the hill is layered over the meadow, the visible edge stays within 10 cm of the exact crossing', () => {
  // A flat source 0.2 m below ground at the camp end of the cave approach. caveFootHeight lowers
  // it through (1 - approach): west of the trench it leaves ground level at about a 0.5% slope,
  // where a facet error of 5 mm would move the meadow/hill edge by a metre.
  const source = quads([{ minX: 30, maxX: 51, minZ: 60, maxZ: 64, y: -0.2 }]);
  const { geometry, stats } = measureSourceRiverBankFit(source.clone(), 0.45, true);
  try {
    assert.ok(stats.layerSplits > 0);
    const height = verticalSurface(geometry, 0.25);
    const ground = -0.0035; // the placed meadow tile near the camp
    const exact = (x, z) => mountainRiverBed(x, z, caveFootHeight(x, z, -0.2));
    for (const z of [60.5, 61.5, 62.5, 63.5]) {
      let low = 42,
        high = CAMP_CAVE.x - 4.2; // the approach floor: exactly level
      assert.ok(exact(low, z) < ground && exact(high, z) > ground);
      for (let i = 0; i < 60; i++) {
        const middle = (low + high) / 2;
        if (exact(middle, z) < ground) low = middle;
        else high = middle;
      }
      const crossing = (low + high) / 2;
      for (let x = 42; x <= CAMP_CAVE.x - 1; x += 0.01) {
        if (Math.abs(x - crossing) < 0.1) continue;
        const y = height(x, z);
        assert.ok(y !== undefined, `hole at ${x},${z}`);
        assert.equal(y > ground, exact(x, z) > ground, `meadow/hill edge moved at ${x},${z}`);
      }
    }
  } finally {
    source.dispose();
    geometry.dispose();
  }
});

test('a non-manifold edge shared by three source triangles is split once for all of them', () => {
  // Two ground triangles meet at an edge across the river; a raised fin shares the same edge.
  const source = new THREE.BufferGeometry();
  source.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([60, 0, 40, 70, 0, 40, 65, 0, 30, 65, 0, 50, 65, 3, 41], 3),
  );
  source.setAttribute(
    'uv',
    new THREE.Float32BufferAttribute([0, 0, 1, 0, 0.5, -1, 0.5, 1, 0.5, 0.5], 2),
  );
  source.setIndex([0, 1, 2, 1, 0, 3, 1, 0, 4]);
  const { geometry, stats } = measureSourceRiverBankFit(source.clone());
  try {
    assert.ok(stats.crowdedReferences > 0, 'the third triangle on the edge was tracked');
    const p = geometry.attributes.position,
      uses = new Map();
    for (const { corners } of faces(geometry))
      for (let k = 0; k < 3; k++) {
        const a = corners[k],
          b = corners[(k + 1) % 3];
        const key = [a, b]
          .map((v) => `${p.getX(v)},${p.getY(v)},${p.getZ(v)}`)
          .sort()
          .join('/');
        uses.set(key, (uses.get(key) ?? 0) + 1);
      }
    let shared = 0;
    for (const [key, count] of uses) {
      const [a, b] = key.split('/').map((point) => point.split(',').map(Number));
      if (a[2] === 40 && b[2] === 40 && a[0] >= 60 && b[0] >= 60 && a[0] <= 70 && b[0] <= 70) {
        assert.equal(count, 3, `piece ${key} of the shared edge`);
        shared++;
      } else assert.ok(count <= 2, `edge ${key} used ${count} times`);
    }
    assert.ok(shared > 1, 'the river crossing the shared edge refined it');
  } finally {
    source.dispose();
    geometry.dispose();
  }
});

test('flat or smoothly deformed broad regions need little refinement', () => {
  // Inside the river bounds but far from the water: nothing deforms, nothing is split.
  const tilt = new THREE.Vector3(0.1, 1, 0.05).normalize().toArray();
  const dry = quads([{ minX: 90, maxX: 110, minZ: -40, maxZ: -20, y: 0.5 }], tilt);
  const kept = fitSourceRiverBank(dry.clone());
  // The former cave-hill foot: a flat source raised onto the smooth foothill profile.
  const foot = quads([{ minX: -14, maxX: -2, minZ: 100, maxZ: 112 }]);
  const { geometry: raised, stats } = measureSourceRiverBankFit(foot.clone(), 0.45, true);
  try {
    assert.notEqual(kept, dry);
    assert.equal(triangleCount(kept), 2);
    assert.ok(legacyTriangles(dry, 0.5, false) > 1000, 'the previous fit split this region');
    assert.deepEqual(Array.from(kept.index.array), Array.from(dry.index.array));
    assert.deepEqual(
      Array.from(kept.attributes.position.array),
      Array.from(dry.attributes.position.array),
    );
    assert.deepEqual(
      Array.from(kept.attributes.normal.array),
      Array.from(dry.attributes.normal.array),
      'undeformed source normals are kept',
    );
    assert.ok(kept.attributes.riverCut.array.every((cut) => cut === 0));

    const height = verticalSurface(raised, 0.5);
    for (let x = -13.5; x <= -2.5; x += 0.5)
      for (let z = 100.5; z <= 111.5; z += 0.5) {
        const exact = mountainRiverBed(x, z, caveFootHeight(x, z, 0));
        assert.ok(exact > 15, 'the foothill raises this source');
        assert.ok(Math.abs(height(x, z) - exact) < 0.045, `foothill ${x},${z}`);
      }
    const previous = legacyTriangles(foot, 0.45, true);
    assert.ok(stats.triangles * 10 < previous, `${stats.triangles} of ${previous} triangles`);
  } finally {
    for (const geometry of [dry, kept, foot, raised]) geometry.dispose();
  }
});

test('quads meeting at a UV seam share every bank midpoint and keep their upward winding', () => {
  const source = quads([
    { minX: 55, maxX: 65, minZ: 40, maxZ: 50, uv: (x, z) => [(x - 55) / 10, (z - 40) / 10] },
    { minX: 65, maxX: 75, minZ: 40, maxZ: 50, uv: (x, z) => [2 + (x - 65) / 10, (z - 40) / 10] },
  ]);
  const soupSource = source.toNonIndexed();
  const fitted = fitSourceRiverBank(source.clone()),
    soup = fitSourceRiverBank(soupSource);
  try {
    for (const geometry of [fitted, soup]) {
      assertOutline(geometry, 55, 75, 40, 50);
      const p = geometry.attributes.position,
        uv = geometry.attributes.uv;
      const seam = { left: [], right: [] };
      for (let i = 0; i < p.count; i++) {
        const left = uv.getX(i) < 1.5;
        assert.ok(
          Math.abs(uv.getX(i) - (left ? (p.getX(i) - 55) / 10 : 2 + (p.getX(i) - 65) / 10)) <
            0.00001,
        );
        assert.ok(Math.abs(uv.getY(i) - (p.getZ(i) - 40) / 10) < 0.00001);
        if (p.getX(i) === 65) seam[left ? 'left' : 'right'].push(`${p.getY(i)},${p.getZ(i)}`);
      }
      // Both sides of the seam carry the same lowered bank vertices.
      assert.ok(seam.left.some((key) => Number(key.split(',')[0]) < -0.7));
      assert.deepEqual([...new Set(seam.left)].sort(), [...new Set(seam.right)].sort());
      for (const { points } of faces(geometry)) {
        const normal = new THREE.Vector3()
          .subVectors(points[1], points[0])
          .cross(new THREE.Vector3().subVectors(points[2], points[0]));
        assert.ok(normal.y > 0, 'a fitted face turned over');
      }
    }
    assert.equal(triangleCount(soup), triangleCount(fitted));
  } finally {
    for (const geometry of [source, soupSource, fitted, soup]) geometry.dispose();
  }
});

test('material groups and the draw range follow the triangles each source triangle becomes', () => {
  const source = quads([{ minX: 55, maxX: 75, minZ: 40, maxZ: 60 }]);
  source.addGroup(0, 3, 0);
  source.addGroup(3, 3, 1);
  source.setDrawRange(3, 3);
  const fitted = fitSourceRiverBank(source.clone());
  try {
    const [first, second] = fitted.groups;
    assert.equal(fitted.groups.length, 2);
    assert.deepEqual(
      [first.start, first.materialIndex, second.start, second.materialIndex],
      [0, 0, first.count, 1],
    );
    assert.equal(first.count + second.count, fitted.index.count);
    assert.ok(first.count > 3 && second.count > 3);
    assert.deepEqual(fitted.drawRange, { start: second.start, count: second.count });
    // Source triangle 0 lies on the side x - z >= 15 of the diagonal, triangle 1 on the other.
    let i = 0;
    for (const { points } of faces(fitted)) {
      const x = (points[0].x + points[1].x + points[2].x) / 3,
        z = (points[0].z + points[1].z + points[2].z) / 3;
      assert.ok(i < first.count ? x - z > 15 - 1e-4 : x - z < 15 + 1e-4);
      i += 3;
    }
  } finally {
    source.dispose();
    fitted.dispose();
  }
});

test('undeformed vertices keep their source normals and deformed ones are recomputed', () => {
  const tilt = new THREE.Vector3(0.2, 1, -0.1).normalize();
  const source = quads([{ minX: 50, maxX: 100, minZ: 30, maxZ: 36 }], tilt.toArray());
  const fitted = fitSourceRiverBank(source.clone());
  try {
    const p = fitted.attributes.position,
      n = fitted.attributes.normal;
    const touched = new Uint8Array(p.count);
    for (const { corners } of faces(fitted))
      if (corners.some((v) => Math.abs(p.getY(v)) > 1e-6)) for (const v of corners) touched[v] = 1;
    let kept = 0,
      computed = 0;
    for (let i = 0; i < p.count; i++) {
      const normal = new THREE.Vector3().fromBufferAttribute(n, i);
      if (!touched[i]) {
        assert.ok(normal.distanceTo(tilt) < 1e-6, `source normal lost at vertex ${i}`);
        kept++;
      } else if (normal.distanceTo(tilt) > 0.01) computed++;
      assert.ok(Math.abs(normal.length() - 1) < 1e-5);
    }
    assert.ok(kept > 0 && computed > 0);
  } finally {
    source.dispose();
    fitted.dispose();
  }
});

test('a surface away from every river is returned unchanged', () => {
  const ground = quads([{ minX: 1000, maxX: 1010, minZ: 1000, maxZ: 1010 }], [0, 1, 0]);
  const hill = quads([{ minX: -1010, maxX: -1000, minZ: -1010, maxZ: -1000 }], [0, 1, 0]);
  const before = snapshot(ground);
  assert.equal(fitSourceRiverBank(ground), ground);
  assert.equal(fitSourceRiverBank(hill, 0.45, true), hill);
  assert.deepEqual(snapshot(ground), before);
  ground.dispose();
  hill.dispose();
});

test('invalid or oversized sources fail explicitly and leave the source untouched', () => {
  const source = quads([{ minX: 55, maxX: 75, minZ: 40, maxZ: 60 }]);
  const before = snapshot(source);
  for (const edge of [0, -1, NaN, Infinity, '0.5', null])
    assert.throws(() => fitSourceRiverBank(source, edge), /edge length/);
  assert.throws(() => fitSourceRiverBank(new THREE.BufferGeometry()), /position/);
  const broken = source.clone();
  broken.attributes.position.setY(1, NaN);
  assert.throws(() => fitSourceRiverBank(broken), /not finite/);
  const partial = source.clone();
  partial.setIndex([0, 2, 1, 0]);
  assert.throws(() => fitSourceRiverBank(partial), /whole triangles/);
  const outside = source.clone();
  outside.setIndex([0, 2, 9]);
  assert.throws(() => fitSourceRiverBank(outside), /missing vertex/);
  const morph = source.clone();
  morph.morphAttributes.position = [source.attributes.position.clone()];
  assert.throws(() => fitSourceRiverBank(morph), /morph/);
  const grouped = source.clone();
  grouped.addGroup(1, 3, 0);
  assert.throws(() => fitSourceRiverBank(grouped), /inside a triangle/);
  const short = source.clone();
  short.deleteAttribute('uv');
  short.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0], 2));
  assert.throws(() => fitSourceRiverBank(short), /uv has 2 of 4/);
  // Work beyond the budget stops with an error instead of returning a partial mesh.
  assert.throws(() => measureSourceRiverBankFit(source, 0.5, false, 64 * 1024), /budget/);
  assert.throws(() => measureSourceRiverBankFit(source, 0.1, false, 192 * 1024), /budget/);
  assert.deepEqual(snapshot(source), before);
  for (const geometry of [source, broken, partial, outside, morph, grouped, short])
    geometry.dispose();
});

// The real worker (src/river-bank-worker.ts) rebuilds the transferred arrays, calls the same
// fitter and transfers the result back. This stand-in does the same with structuredClone.
class InlineWorker {
  onmessage = null;
  onerror = null;
  onmessageerror = null;
  postMessage(data, transfer) {
    const job = structuredClone(data, { transfer });
    queueMicrotask(() => {
      const source = new THREE.BufferGeometry();
      for (const [name, value] of Object.entries(job.attributes))
        source.setAttribute(
          name,
          new THREE.BufferAttribute(value.array, value.itemSize, value.normalized),
        );
      if (job.index) source.setIndex(new THREE.BufferAttribute(job.index, 1));
      if (job.groups) source.groups = job.groups;
      if (job.drawRange) source.drawRange = job.drawRange;
      const geometry = fitSourceRiverBank(source, job.maximumEdge, job.mountainOnly);
      const attributes = Object.fromEntries(
        Object.entries(geometry.attributes).map(([name, a]) => [
          name,
          { array: a.array, itemSize: a.itemSize, normalized: a.normalized },
        ]),
      );
      const index = geometry.index?.array;
      const buffers = Object.values(attributes).map((a) => a.array.buffer);
      if (index) buffers.push(index.buffer);
      const reply = structuredClone(
        { id: job.id, attributes, index, groups: geometry.groups, drawRange: geometry.drawRange },
        { transfer: [...new Set(buffers)] },
      );
      this.onmessage({ data: reply });
    });
  }
  terminate() {}
}

test('worker transfer returns exactly the synchronous fit, in standalone transferable buffers', async () => {
  const source = quads([
    { minX: 55, maxX: 65, minZ: 40, maxZ: 60 },
    { minX: 65, maxX: 75, minZ: 40, maxZ: 60 },
  ]);
  source.addGroup(0, 6, 0);
  source.addGroup(6, 6, 1);
  const reference = fitSourceRiverBank(source.clone());
  const again = fitSourceRiverBank(source.clone());
  const builder = new RiverBankBuilder(() => new InlineWorker());
  const delivered = await builder.build(source.clone());
  try {
    for (const geometry of [again, delivered]) {
      assert.deepEqual(
        Object.keys(geometry.attributes).sort(),
        Object.keys(reference.attributes).sort(),
      );
      for (const name of Object.keys(reference.attributes))
        assert.deepEqual(
          Array.from(geometry.attributes[name].array),
          Array.from(reference.attributes[name].array),
          `${name} differs`,
        );
      assert.deepEqual(Array.from(geometry.index.array), Array.from(reference.index.array));
      assert.deepEqual(geometry.groups, reference.groups);
      assert.deepEqual(geometry.drawRange, reference.drawRange);
    }
    const arrays = Object.values(reference.attributes).map((a) => a.array);
    arrays.push(reference.index.array);
    for (const array of arrays) {
      assert.equal(array.byteOffset, 0);
      assert.equal(array.byteLength, array.buffer.byteLength);
    }
    assert.equal(new Set(arrays.map((array) => array.buffer)).size, arrays.length);
  } finally {
    builder.dispose();
    for (const geometry of [source, reference, again, delivered]) geometry.dispose();
  }
});

test('the narrow feature bands cover the shared deformation they guard', () => {
  // riverBankDrop is zero beyond 3.8 m of riverX, whose slope stays below 3.
  for (let z = -70; z <= 190; z += 0.5) {
    assert.ok(Math.abs(riverX(z + 0.5) - riverX(z)) <= 1.5);
    for (const offset of [3.81, 4.5, 8])
      for (const side of [-1, 1]) assert.equal(riverBankDrop(riverX(z) + side * offset, z), 0);
  }
  // mountainRiverBed leaves even a deep hill unchanged beyond the width plus 10.2 m.
  const segments = MOUNTAIN_RIVER_SAMPLES.slice(1).map((b, i) => [MOUNTAIN_RIVER_SAMPLES[i], b]);
  const clear = (x, z) =>
    segments.every(([a, b]) => {
      const dx = b.x - a.x,
        dz = b.z - a.z,
        squared = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / squared));
      return Math.hypot(x - a.x - dx * t, z - a.z - dz * t) >= Math.max(a.width, b.width) + 10.2;
    });
  let checked = 0;
  for (const [a, b] of segments.filter((_, i) => i % 5 === 0)) {
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    if (!length) continue;
    assert.ok(mountainRiverBed(a.x, a.z, a.y + 60) < a.y + 59, 'the channel is cut');
    for (const side of [-1, 1]) {
      const reach = Math.max(a.width, b.width) + 10.3,
        x = a.x - (side * (b.z - a.z) * reach) / length,
        z = a.z + (side * (b.x - a.x) * reach) / length;
      if (mountainLakeIntersects(x, x, z, z) || !clear(x, z)) continue;
      assert.ok(Math.abs(mountainRiverBed(x, z, a.y + 60) - (a.y + 60)) < 1e-9, `${x},${z}`);
      checked++;
    }
  }
  assert.ok(checked > 50);
  // caveFootHeight changes sharply only inside the cave-mouth band.
  const second = (x, z, dx, dz) =>
    Math.abs(
      caveFootHeight(x + dx, z + dz, 12) -
        2 * caveFootHeight(x, z, 12) +
        caveFootHeight(x - dx, z - dz, 12),
    );
  for (let x = CAMP_CAVE.x - 15; x <= CAMP_CAVE.x + 15; x += 0.5)
    for (let z = 62; z <= 99; z += 0.25) {
      if (Math.abs(x - CAMP_CAVE.x) < 8.5 && z > 74.5 && z < 86.3) continue;
      if (Math.abs(x - riverX(z)) < 6) continue;
      assert.ok(second(x, z, 0, 0.1) < 0.08 && second(x, z, 0.1, 0) < 0.08, `sharp at ${x},${z}`);
    }
  assert.ok(second(CAMP_CAVE.x, CAMP_CAVE.z - 9.4, 0, 0.1) > 0.15, 'the rim is inside the band');
});

test('both delivered camp-mountain meshes fit without opening interior edges, below the previous count', async (t) => {
  const asset = JSON.parse(await readFile('public/models/camp-mountain/asset.json'));
  const placement = new THREE.Matrix4()
    .makeRotationY(CAMP_MOUNTAIN.yaw)
    .setPosition(CAMP_MOUNTAIN.x, 0, CAMP_MOUNTAIN.z);
  for (const { url } of [asset, ...asset.lods]) {
    const { scene } = await geometryScene(`public${url}`);
    scene.updateMatrixWorld(true);
    const meshes = [];
    scene.traverse((node) => {
      if (node.isMesh) meshes.push(node);
    });
    for (const node of meshes) {
      const matrix = placement.clone().multiply(node.matrixWorld);
      const source = node.geometry.clone().applyMatrix4(matrix);
      const { geometry, stats } = measureSourceRiverBankFit(source.clone(), 0.45, true);
      try {
        const sourceOpen = openEdges(source).open.length,
          fittedOpen = openEdges(geometry).open.length;
        assert.equal(fittedOpen, sourceOpen + stats.boundaryEdgeSplits, `${url}: T-junction`);
        const previous = legacyTriangles(source, 0.45, true);
        t.diagnostic(
          `${url}: ${stats.sourceTriangles} source, ${stats.triangles} fitted, ` +
            `previous fit ${previous}; ${stats.layerSplits} layered splits; ` +
            `typed arrays ${stats.peakTypedArrayBytes} B (accounting), output ${stats.outputBytes} B`,
        );
        assert.ok(stats.triangles < previous);
        const p = geometry.attributes.position,
          n = geometry.attributes.normal;
        for (let i = 0; i < p.count; i++) {
          assert.ok(Number.isFinite(p.getX(i) + p.getY(i) + p.getZ(i)));
          const length = Math.hypot(n.getX(i), n.getY(i), n.getZ(i));
          assert.ok(length === 0 || Math.abs(length - 1) < 1e-5);
        }
      } finally {
        geometry.dispose();
        source.dispose();
      }
    }
    scene.traverse((node) => {
      if (node.isMesh) node.geometry.dispose();
    });
  }
});
