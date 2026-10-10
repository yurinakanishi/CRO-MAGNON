import test from 'node:test';
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { measuredWalkSurface } from '../dist/shared/measured-walk-surface.mjs';
import { CASTLE_SURFACE } from '../dist/shared/castle-surface.mjs';
import { CAMP_CAVE_SURFACE } from '../dist/shared/camp-cave-surface.mjs';
import { CollisionWorld } from '../dist/shared/collision.mjs';
import { castleWorld, castleLocal } from '../dist/shared/castle-layout.mjs';
import { caveWorldAt } from '../dist/shared/camp-cave-layout.mjs';
import { CHARACTER_MODELS } from '../dist/shared/characters.mjs';
import { movePlayer } from '../dist/shared/movement.mjs';
import { WORLD } from '../dist/shared/world.mjs';

// The oracle: measuredWalkSurface exactly as the frozen phase2a build shipped it, copied
// verbatim from output/optimization-audit-20261009/phase2a-build-review-r01/dist/shared/
// measured-walk-surface.mjs (only `export` and the source-map comment removed). Every query of
// the current module must return the same value, by SameValue, or throw the same error.
function baselineMeasuredWalkSurface(data, placement) {
    const { step, minX, minZ, nx, nz, heights } = data;
    if (!(step > 0) ||
        !Number.isInteger(nx) ||
        !Number.isInteger(nz) ||
        heights.length !== nx * nz ||
        !heights.every((h) => h === null || Number.isFinite(h)))
        throw new Error('Invalid measured walk surface');
    const c = Math.cos(placement.yaw), s = Math.sin(placement.yaw), scale = placement.scale ?? 1;
    const local = (x, z) => ({
        x: (c * (x - placement.x) - s * (z - placement.z)) / scale,
        z: (s * (x - placement.x) + c * (z - placement.z)) / scale,
    });
    const world = (x, z) => ({
        x: placement.x + (c * x + s * z) * scale,
        z: placement.z + (-s * x + c * z) * scale,
    });
    function cell(x, z) {
        const p = local(x, z), ix = Math.floor((p.x - minX) / step), iz = Math.floor((p.z - minZ) / step);
        return ix < 0 || iz < 0 || ix >= nx || iz >= nz ? null : { ix, iz, index: iz * nx + ix, p };
    }
    function height(x, z) {
        const sample = cell(x, z);
        if (!sample)
            return undefined;
        const h = heights[sample.index];
        if (h === null)
            return null;
        // Smooth within the measured neighbouring stair/floor samples, never across a wall.
        const u = (sample.p.x - minX) / step - 0.5, v = (sample.p.z - minZ) / step - 0.5, ix = Math.floor(u), iz = Math.floor(v), fx = u - ix, fz = v - iz;
        if (ix < 0 || iz < 0 || ix + 1 >= nx || iz + 1 >= nz)
            return h * scale;
        const q = [
            heights[iz * nx + ix],
            heights[iz * nx + ix + 1],
            heights[(iz + 1) * nx + ix],
            heights[(iz + 1) * nx + ix + 1],
        ];
        // A solid neighbour or a wall-sized jump (over 1.2 m) does not take part;
        // it reads as the centre height so the field stays continuous up to the
        // wall. Tall risers the raster missed become steep ramps rather than
        // invisible steps that stop a walking body.
        const r = q.map((y) => (y === null || Math.abs(y - h) > 1.2 ? h : y));
        return ((r[0] * (1 - fx) + r[1] * fx) * (1 - fz) + (r[2] * (1 - fx) + r[3] * fx) * fz) * scale;
    }
    // The largest height difference between the body centre and its eight-point
    // ring; null when any sample is solid. Walls and drops show as large values.
    // The ring is capped at the width of a broad human shoulder: the great ape
    // still collides with walls and other bodies at its full radius, but the
    // 0.35 m atlas cannot describe corridors finely enough for a 1.5 m ring
    // without pockets that trap it on the side stairs.
    const RING_CAP = 0.5;
    function deviation(x, z, radius = 0) {
        const centre = height(x, z);
        if (centre === null)
            return null;
        const ring = Math.min(radius, RING_CAP);
        let worst = 0;
        for (let i = 0; i < 8; i++) {
            const angle = (i * Math.PI) / 4, h = height(x + Math.cos(angle) * ring, z + Math.sin(angle) * ring);
            if (h === null)
                return null;
            if (centre !== undefined && h !== undefined)
                worst = Math.max(worst, Math.abs(h - centre));
        }
        return worst;
    }
    // 2026-09-13: the limits were tuned on the 1.2x ruin (0.84 m ring, 0.9 m
    // step); they are body limits, not model limits, so they no longer scale.
    const ringLimit = (radius) => Math.max(0.84, radius * 1.5);
    function free(x, z, radius = 0) {
        const worst = deviation(x, z, radius);
        return worst !== null && worst <= ringLimit(radius);
    }
    // A step is allowed when the destination is free, or when the body is already
    // brushing a ledge and the step does not bring it any closer (so a stair edge
    // never traps a player who reached it legally). Drops stay with transition().
    function allows(from, to, radius = 0) {
        if (free(to.x, to.z, radius))
            return true;
        const next = deviation(to.x, to.z, radius);
        if (next === null)
            return false;
        const current = deviation(from.x, from.z, radius);
        return current !== null && next <= Math.min(current + 0.25, ringLimit(radius) + 0.6);
    }
    function transition(a, b) {
        const ah = height(a.x, a.z), bh = height(b.x, b.z);
        if (ah === null || bh === null)
            return false;
        if (ah === undefined && bh === undefined)
            return true;
        // A tall step (the top riser of the side stairs reads as 0.7 m where the
        // smoothing stops at a wall) is climbable; a 0.9 m ledge is not, even at a run.
        return Math.abs((ah ?? 0) - (bh ?? 0)) <= 0.9 + Math.hypot(a.x - b.x, a.z - b.z) * 0.6;
    }
    return { local, world, cell, height, free, deviation, allows, transition, data, placement };
}

// A seeded generator, so every run compares the same inputs.
function generator(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (low, high) => low + (high - low) * next(),
    pick: (list) => list[Math.floor(next() * list.length)],
    int: (low, high) => low + Math.floor(next() * (high - low + 1)),
  };
}

// The value a call returns, or the class and message of what it throws.
function outcome(call) {
  try {
    return { value: call() };
  } catch (error) {
    return { error: `${error?.constructor?.name}: ${error?.message}` };
  }
}
function expectSame(actual, expected, describe) {
  if (!isDeepStrictEqual(actual, expected)) assert.deepStrictEqual(actual, expected, describe());
}
const show = (value) =>
  typeof value === 'bigint' ? `${value}n` : typeof value === 'string' ? `'${value}'` : String(value);

function pair(data, placement) {
  return {
    next: measuredWalkSurface(data, placement),
    base: baselineMeasuredWalkSurface(data, placement),
  };
}

let queries = 0;
// Every point query of both implementations at (x, z), with this body radius.
function comparePoint(surfaces, x, z, radius, label) {
  for (const name of ['height', 'cell', 'local', 'world']) {
    queries++;
    expectSame(
      outcome(() => surfaces.next[name](x, z)),
      outcome(() => surfaces.base[name](x, z)),
      () => `${label}: ${name}(${show(x)}, ${show(z)})`,
    );
  }
  for (const name of ['deviation', 'free']) {
    queries++;
    expectSame(
      outcome(() => surfaces.next[name](x, z, radius)),
      outcome(() => surfaces.base[name](x, z, radius)),
      () => `${label}: ${name}(${show(x)}, ${show(z)}, ${show(radius)})`,
    );
  }
}
function compareStep(surfaces, from, to, radius, label) {
  queries += 2;
  expectSame(
    outcome(() => surfaces.next.allows(from, to, radius)),
    outcome(() => surfaces.base.allows(from, to, radius)),
    () => `${label}: allows(${point(from)}, ${point(to)}, ${show(radius)})`,
  );
  expectSame(
    outcome(() => surfaces.next.transition(from, to)),
    outcome(() => surfaces.base.transition(from, to)),
    () => `${label}: transition(${point(from)}, ${point(to)})`,
  );
}
const point = (p) => `{x: ${show(p.x)}, z: ${show(p.z)}}`;

// Body radii as gameplay uses them, the ring cap's edge, negative and default (undefined).
const RADII = [undefined, 0, -0, 0.12, 0.28, 0.32, 0.35, 0.36, 0.48, 0.499999, 0.5, 0.500001];
RADII.push(0.76, 1.2, 1.5, 1.9, 3, -0.2, -0.76, -3);
// Distances (world metres) between the body ring and an atlas side, across the margin at which
// deviation() stops sampling; negative distances overlap the atlas.
const OFFSETS = [-0.05, -0.0101, -0.01, -0.0099, -1e-9, 0, 1e-9, 0.0099, 0.01, 0.0101];
OFFSETS.push(0.0102, 0.02, 0.05, 0.5, 3);
const SPECIAL = [NaN, Infinity, -Infinity, -0, 0, 1e15, -1e15, 1e300, -1e300, Number.MAX_VALUE];
SPECIAL.push(-Number.MAX_VALUE, Number.MIN_VALUE, -Number.MIN_VALUE);

// The local rectangle and the world box enclosing it.
function frame(surface) {
  const { minX, minZ, nx, nz, step } = surface.data,
    maxX = minX + nx * step,
    maxZ = minZ + nz * step;
  const corners = [
    [minX, minZ],
    [maxX, minZ],
    [minX, maxZ],
    [maxX, maxZ],
  ].map(([x, z]) => surface.world(x, z));
  const xs = corners.map((p) => p.x),
    zs = corners.map((p) => p.z);
  return {
    minX,
    minZ,
    maxX,
    maxZ,
    step,
    nx,
    nz,
    scale: Math.abs(surface.placement.scale ?? 1),
    box: {
      minX: Math.min(...xs),
      maxX: Math.max(...xs),
      minZ: Math.min(...zs),
      maxZ: Math.max(...zs),
    },
  };
}

function sweep(surfaces, rng, label, counts) {
  const { random, boundary, lattice, far, steps } = counts;
  const f = frame(surfaces.base),
    world = (lx, lz) => surfaces.base.world(lx, lz),
    box = f.box,
    pad = 3;
  for (let i = 0; i < random; i++)
    comparePoint(
      surfaces,
      rng.range(box.minX - pad, box.maxX + pad),
      rng.range(box.minZ - pad, box.maxZ + pad),
      rng.pick(RADII),
      `${label} random`,
    );
  // Whole rings just clear of, touching or overlapping each side of the rectangle.
  for (const radius of [0, 0.32, 0.5, 0.76, -0.76, 1.5])
    for (const offset of OFFSETS)
      for (let k = 0; k < boundary; k++) {
        const reach = (Math.abs(Math.min(radius, 0.5)) + offset) / f.scale,
          alongX = rng.range(f.minX - 1, f.maxX + 1),
          alongZ = rng.range(f.minZ - 1, f.maxZ + 1);
        for (const [lx, lz] of [
          [f.minX - reach, alongZ],
          [f.maxX + reach, alongZ],
          [alongX, f.minZ - reach],
          [alongX, f.maxZ + reach],
        ]) {
          const p = world(lx, lz);
          comparePoint(surfaces, p.x, p.z, radius, `${label} side ${offset}`);
        }
      }
  // Cell edges (floor of the cell index) and cell centres (floor of the bilinear index).
  const columns = [0, 1, f.nx - 1, f.nx],
    rows = [0, 1, f.nz - 1, f.nz];
  for (let k = 0; k < lattice; k++) {
    columns.push(rng.int(0, f.nx));
    rows.push(rng.int(0, f.nz));
  }
  for (const i of columns)
    for (const j of rows)
      for (const half of [0, 0.5])
        for (const e of [-1e-9, 0, 1e-9]) {
          const p = world(f.minX + (i + half) * f.step + e, f.minZ + (j + half) * f.step - e);
          for (const radius of [0, 0.32, 0.5]) comparePoint(surfaces, p.x, p.z, radius, `${label} lattice`);
        }
  // Far from the atlas, where deviation() no longer samples.
  const cx = (box.minX + box.maxX) / 2,
    cz = (box.minZ + box.maxZ) / 2,
    half = Math.hypot(box.maxX - box.minX, box.maxZ - box.minZ) / 2;
  for (let i = 0; i < far; i++) {
    const angle = rng.range(0, Math.PI * 2),
      distance = half + rng.pick([0.6, 1, 5, 40, 400, 2000]) * rng.next();
    comparePoint(
      surfaces,
      cx + Math.cos(angle) * distance,
      cz + Math.sin(angle) * distance,
      rng.pick(RADII),
      `${label} far`,
    );
  }
  // Movement-sized steps, as CollisionWorld.move and stepAllowed take them.
  for (let i = 0; i < steps; i++) {
    const from = {
        x: rng.range(box.minX - pad, box.maxX + pad),
        z: rng.range(box.minZ - pad, box.maxZ + pad),
      },
      angle = rng.range(0, Math.PI * 2),
      length = rng.pick([0.01, 0.05, 0.1, 0.25, 0.35, 1]),
      to = { x: from.x + Math.cos(angle) * length, z: from.z + Math.sin(angle) * length };
    compareStep(surfaces, from, to, rng.pick(RADII), `${label} step`);
  }
}

function specialValues(surfaces, centre, label, radii = [NaN, Infinity, -Infinity, -0, undefined, 0.32, 1e300, -1e300]) {
  const xs = [...SPECIAL, centre.x],
    zs = [...SPECIAL, centre.z];
  for (const x of xs)
    for (const z of zs)
      for (const radius of radii) comparePoint(surfaces, x, z, radius, `${label} special`);
  // Values the API does not expect still behave exactly as before, including thrown errors.
  for (const x of ['60', '', null, undefined, true, 1n, { valueOf: () => centre.x }, centre.x])
    for (const z of [centre.z, '94', null, 1n])
      for (const radius of ['0.3', null, true, 1n, 0.32])
        comparePoint(surfaces, x, z, radius, `${label} unusual`);
  for (const [from, to] of [
    [centre, { x: NaN, z: centre.z }],
    [{ x: Infinity, z: -Infinity }, centre],
    [{ x: -0, z: -0 }, { x: 0, z: 0 }],
    [{}, centre],
    [centre, { x: '52', z: centre.z }],
  ])
    for (const radius of [0, 0.32, NaN, -0])
      compareStep(surfaces, from, to, radius, `${label} special step`);
}

const realAtlases = () => ({
  castle: pair(CASTLE_SURFACE.data, CASTLE_SURFACE.placement),
  cave: pair(CAMP_CAVE_SURFACE.data, CAMP_CAVE_SURFACE.placement),
});

test('the castle and cave atlases answer every query exactly as the frozen implementation', (t) => {
  queries = 0;
  const rng = generator(20261009);
  for (const [name, surfaces] of Object.entries(realAtlases())) {
    sweep(surfaces, rng, name, { random: 15000, boundary: 8, lattice: 10, far: 2000, steps: 8000 });
    const { box } = frame(surfaces.base);
    specialValues(surfaces, { x: (box.minX + box.maxX) / 2, z: (box.minZ + box.maxZ) / 2 }, name);
  }
  // The module's own instances, which the game uses.
  for (const surface of [CASTLE_SURFACE, CAMP_CAVE_SURFACE]) {
    const surfaces = {
      next: surface,
      base: baselineMeasuredWalkSurface(surface.data, surface.placement),
    };
    sweep(surfaces, rng, 'module instance', { random: 3000, boundary: 1, lattice: 2, far: 300, steps: 1000 });
  }
  t.diagnostic(`${queries} queries compared`);
});

test('rotated, scaled and walled synthetic atlases answer exactly as the frozen implementation', (t) => {
  queries = 0;
  const rng = generator(4242);
  for (let k = 0; k < 64; k++) {
    const nx = rng.int(1, 24),
      nz = rng.int(1, 24),
      step = rng.pick([0.25, 0.35, 0.5, 1, 1.75]),
      levels = [0, 0.3, 0.6, 1.2, 1.21, 2.5, 5];
    const heights = Array.from({ length: nx * nz }, () =>
      rng.next() < 0.2 ? null : rng.pick(levels) + (rng.next() < 0.5 ? 0 : rng.range(-0.4, 0.4)),
    );
    const placement = {
      x: rng.pick([0, -0, rng.range(-150, 150)]),
      z: rng.pick([0, rng.range(-150, 150)]),
      yaw: rng.pick([0, Math.PI / 2, Math.PI, -Math.PI / 3, 2.5, 1e-12, -7.1, Math.PI * 1.5]),
      scale: rng.pick([undefined, 1, 2, 0.5, 1.2, -1.5, 0.75]),
    };
    const data = { step, minX: rng.range(-15, 15), minZ: rng.range(-15, 15), nx, nz, heights };
    const surfaces = pair(data, placement),
      label = `synthetic ${k} ${JSON.stringify({ nx, nz, step, ...placement })}`;
    sweep(surfaces, rng, label, { random: 400, boundary: 1, lattice: 2, far: 80, steps: 250 });
    if (k % 8 === 0) specialValues(surfaces, { x: placement.x, z: placement.z }, label);
  }
  t.diagnostic(`${queries} queries compared`);
});

test('degenerate and unusually valued atlases the validation accepts behave as before', (t) => {
  queries = 0;
  const rng = generator(77);
  const atlases = [
    { step: 1, minX: 0, minZ: 0, nx: 1, nz: 1, heights: [2] },
    { step: 1, minX: 0, minZ: 0, nx: 1, nz: 1, heights: [null] },
    { step: 0.5, minX: -2, minZ: -2, nx: 8, nz: 8, heights: Array(64).fill(null) },
    { step: 0.5, minX: -2, minZ: -2, nx: 8, nz: 8, heights: Array(64).fill(1.5) },
    { step: 0.35, minX: 0, minZ: 0, nx: 0, nz: 5, heights: [] },
    { step: 0.35, minX: 0, minZ: 0, nx: -2, nz: -3, heights: [0, 1, 2, 3, 4, 5] },
    { step: Infinity, minX: 0, minZ: 0, nx: 2, nz: 2, heights: [0, 1, null, 3] },
    { step: 1e308, minX: 0, minZ: 0, nx: 3, nz: 2, heights: [0, 1, 2, 3, 4, 5] },
    { step: 0.5, minX: -Infinity, minZ: 0, nx: 2, nz: 2, heights: [0, 1, 2, 3] },
    { step: 0.5, minX: Infinity, minZ: 0, nx: 2, nz: 2, heights: [0, 1, 2, 3] },
    { step: 0.5, minX: NaN, minZ: 0, nx: 2, nz: 2, heights: [0, 1, 2, 3] },
    { step: '0.5', minX: '-5', minZ: '-5', nx: 10, nz: 10, heights: Array(100).fill(0.25) },
    { step: 0.5, minX: -1e15, minZ: -1e15, nx: 4, nz: 4, heights: Array(16).fill(1) },
    { step: 0.35, minX: 0, minZ: 0, nx: 6, nz: 1, heights: [0, 0.2, 0.4, 5, 5, null] },
  ];
  const placements = [
    { x: 0, z: 0, yaw: 0 },
    { x: -0, z: -0, yaw: Math.PI, scale: -1 },
    { x: 12.5, z: -3, yaw: 1.1, scale: 1e-9 },
    { x: 12.5, z: -3, yaw: -0.4, scale: 1e9 },
    { x: 5, z: 5, yaw: 0, scale: 0 },
    { x: 5, z: 5, yaw: NaN },
    { x: 1e15, z: -1e15, yaw: 0.3, scale: 2 },
    { x: '12', z: '-3', yaw: '0.5', scale: '2' },
    { x: 3n, z: 0, yaw: 0 },
    { x: 4, z: 4, yaw: 0.2, scale: 2n },
  ];
  // Bounds the validation does not check: coerced, or throwing on every query, as before.
  atlases.push(
    { step: 1n, minX: 0, minZ: 0, nx: 2, nz: 2, heights: [0, 1, 2, 3] },
    { step: 0.5, minX: 0n, minZ: 0, nx: 2, nz: 2, heights: [0, 1, 2, 3] },
    { step: 0.5, minX: null, minZ: undefined, nx: 2, nz: 2, heights: [0, 1, 2, 3] },
    { step: true, minX: -1, minZ: -1, nx: 3, nz: 3, heights: Array(9).fill(0.5) },
  );
  for (const [i, data] of atlases.entries())
    for (const [j, placement] of placements.entries()) {
      const label = `atlas ${i} placement ${j}`,
        built = outcome(() => pair(data, placement));
      if (built.error) {
        expectSame(
          outcome(() => measuredWalkSurface(data, placement)),
          outcome(() => baselineMeasuredWalkSurface(data, placement)),
          () => label,
        );
        continue;
      }
      const surfaces = built.value;
      for (let k = 0; k < 300; k++) {
        const x = Number(placement.x) + rng.range(-25, 25),
          z = Number(placement.z) + rng.range(-25, 25);
        comparePoint(surfaces, x, z, rng.pick(RADII), label);
        compareStep(surfaces, { x, z }, { x: x + rng.range(-1, 1), z: z + rng.range(-1, 1) }, 0.32, label);
      }
      // (Placements that make every query throw are covered by the loop above.)
      if (typeof placement.x === 'number' && typeof placement.scale !== 'bigint')
        specialValues(surfaces, placement, label, [NaN, -0, undefined, 0.32]);
    }
  // Invalid atlases are refused with the same error.
  for (const data of [
    { step: 0, minX: 0, minZ: 0, nx: 1, nz: 1, heights: [0] },
    { step: -1, minX: 0, minZ: 0, nx: 1, nz: 1, heights: [0] },
    { step: NaN, minX: 0, minZ: 0, nx: 1, nz: 1, heights: [0] },
    { step: 1, minX: 0, minZ: 0, nx: 1.5, nz: 1, heights: [0] },
    { step: 1, minX: 0, minZ: 0, nx: 2, nz: 2, heights: [0, 0, 0] },
    { step: 1, minX: 0, minZ: 0, nx: 1, nz: 1, heights: [NaN] },
    { step: 1, minX: 0, minZ: 0, nx: 1, nz: 1, heights: [Infinity] },
    { step: 1, minX: 0, minZ: 0, nx: 1, nz: 1, heights: [undefined] },
  ])
    expectSame(
      outcome(() => measuredWalkSurface(data, { x: 0, z: 0, yaw: 0 })),
      outcome(() => baselineMeasuredWalkSurface(data, { x: 0, z: 0, yaw: 0 })),
      () => JSON.stringify(data),
    );
  t.diagnostic(`${queries} queries compared`);
});

test('heights and placement are read live, exactly as before, and the API is unchanged', () => {
  const rng = generator(9);
  const data = {
    step: 0.5,
    minX: -3,
    minZ: -2,
    nx: 16,
    nz: 12,
    heights: Array.from({ length: 192 }, (_, i) => (i % 7 === 0 ? null : (i % 5) * 0.4)),
  };
  const placement = { x: 20, z: -10, yaw: 0.7, scale: 1.3 };
  const surfaces = pair(data, placement),
    f = frame(surfaces.base);
  assert.deepEqual(Object.keys(surfaces.next), Object.keys(surfaces.base));
  assert.equal(surfaces.next.data, data);
  assert.equal(surfaces.next.placement, placement);
  const check = (label) => {
    for (let k = 0; k < 1500; k++) {
      const x = rng.range(f.box.minX - 6, f.box.maxX + 6),
        z = rng.range(f.box.minZ - 6, f.box.maxZ + 6);
      comparePoint(surfaces, x, z, rng.pick(RADII), label);
      compareStep(surfaces, { x, z }, { x: x + rng.range(-0.4, 0.4), z }, 0.32, label);
    }
  };
  check('initial');
  for (let i = 0; i < data.heights.length; i += 3)
    data.heights[i] = data.heights[i] === null ? 1.1 : null;
  data.heights[5] = NaN; // mutated after validation; both read it as it is
  check('mutated heights');
  placement.x += 3.7;
  placement.z -= 1.9;
  check('moved placement');
  placement.yaw = 2; // both captured yaw and scale when they were built
  placement.scale = 0.5;
  check('rotated placement');
  data.heights = [];
  data.minX = 100;
  check('replaced data members');
});

// The same CollisionWorld code over the oracle and over the current surfaces. Both worlds get
// freshly built surfaces, so path() takes the same branches; positions must stay identical.
function worlds() {
  const atlases = realAtlases();
  return {
    next: new CollisionWorld(undefined, { walkSurfaces: [atlases.castle.next, atlases.cave.next] }),
    base: new CollisionWorld(undefined, { walkSurfaces: [atlases.castle.base, atlases.cave.base] }),
  };
}
function lockstep(pairOfWorlds, model, running, start, goals) {
  const radius = model.radius ?? WORLD.playerRadius,
    speed = running ? (model.runSpeed ?? WORLD.runSpeed) : (model.walkSpeed ?? WORLD.walkSpeed);
  const actor = () => ({
    ...model,
    ...start,
    radius,
    runningRequested: running,
    lastInput: 0,
    dx: 0,
    dz: 0,
    facing: 0,
  });
  const next = actor(),
    base = actor(),
    reached = [];
  let now = 1000,
    steps = 0;
  for (const goal of goals) {
    for (let n = 0; n < 2400 && Math.hypot(base.x - goal.x, base.z - goal.z) > 0.06; n++) {
      const distance = Math.hypot(base.x - goal.x, base.z - goal.z);
      now += 50;
      for (const [body, world] of [
        [next, pairOfWorlds.next],
        [base, pairOfWorlds.base],
      ]) {
        Object.assign(body, {
          dx: (goal.x - body.x) / distance,
          dz: (goal.z - body.z) / distance,
          lastInput: now,
        });
        movePlayer(
          body,
          Math.min(0.05, distance / speed),
          now,
          (p, dx, dz) => world.move(p, dx, dz, p.radius),
          speed,
        );
      }
      steps++;
      for (const key of ['x', 'z', 'facing', 'velocityX', 'velocityZ'])
        if (!Object.is(next[key], base[key]))
          assert.fail(
            `${model.key} run=${running} diverged at step ${steps} (${key}): ${next[key]} vs ${base[key]}`,
          );
    }
    reached.push(Math.hypot(base.x - goal.x, base.z - goal.z) < 0.06);
  }
  return { steps, reached, end: { x: base.x, z: base.z } };
}

test('castle stairs, the cave aisle and movement near both atlases are bit-identical', (t) => {
  const pairOfWorlds = worlds();
  const radiusOf = (model) => model.radius ?? WORLD.playerRadius;
  const models = [...CHARACTER_MODELS].sort((a, b) => radiusOf(a) - radiusOf(b));
  const chosen = [models[0], models.at(-1)];
  // tests/castle-stairs.test.mjs: gate, forecourt, every level of the central stairs, a terrace
  // and back down. As there, every character reaches every waypoint.
  for (const model of chosen)
    for (const side of [-1, 1]) {
      const route = [[-2, 52], [0, 44], [0, 40], [0, 24], [0, 21], [0, 9], [-2, 9], [side * 5, 6]];
      route.push([0, 8], [0, -2], [-2, -6], [-3, -11], [-8, -12], [-3, -11], [-2, -6], [0, -2]);
      route.push([0, 8], [0, 9], [0, 21], [0, 24], [0, 40], [0, 44], [-2, 52], [-2, 62]);
      const result = lockstep(
        pairOfWorlds,
        model,
        false,
        castleWorld(-2, 62),
        route.map((local) => castleWorld(...local)),
      );
      assert.ok(
        result.reached.every(Boolean),
        `${model.key} stopped at ${JSON.stringify(castleLocal(result.end.x, result.end.z))}`,
      );
      t.diagnostic(`castle ${model.key} side ${side}: ${result.steps} identical steps`);
    }
  for (const model of chosen) {
    const goals = [8, 0, -10, -20, -30, -10, 14].map((localZ) => caveWorldAt(localZ));
    const result = lockstep(pairOfWorlds, model, true, caveWorldAt(16), goals);
    t.diagnostic(`cave ${model.key}: ${result.steps} identical steps, reached ${result.reached}`);
  }
  // Short moves, step checks and long sight lines into both atlases.
  const rng = generator(31337),
    boxes = Object.values(realAtlases()).map((surfaces) => frame(surfaces.base).box);
  let compared = 0;
  for (let i = 0; i < 500; i++) {
    const box = rng.pick(boxes),
      start = { x: rng.range(box.minX - 4, box.maxX + 4), z: rng.range(box.minZ - 4, box.maxZ + 4) },
      radius = rng.pick([0.28, 0.32, 0.36, 0.48, 0.76, 1.2, 1.9]);
    const same = (name, ...args) => {
      compared++;
      expectSame(
        outcome(() => pairOfWorlds.next[name](...args)),
        outcome(() => pairOfWorlds.base[name](...args)),
        () => `${name}(${JSON.stringify(args)})`,
      );
    };
    same('free', start, radius);
    const angle = rng.range(0, Math.PI * 2),
      length = rng.range(0.02, 0.8),
      dx = Math.cos(angle) * length,
      dz = Math.sin(angle) * length;
    same('move', start, dx, dz, radius);
    same('stepAllowed', start, { x: start.x + dx, z: start.z + dz }, radius);
    const sight = { x: start.x + rng.range(-40, 40), z: start.z + rng.range(-40, 40) };
    same('segmentFree', start, sight, 0.12);
    same('segmentFree', sight, start, radius);
    same('surfaceHeight', start);
    same('surfaceTransition', start, sight);
    if (i % 50 === 0) same('nearestFree', start, radius);
  }
  for (const [from, to] of [
    [castleWorld(-2, 62), castleWorld(-2, 59)],
    [caveWorldAt(14), caveWorldAt(11)],
  ]) {
    compared++;
    expectSame(
      pairOfWorlds.next.directPath(from, to, 0.32),
      pairOfWorlds.base.directPath(from, to, 0.32),
      () => `directPath(${JSON.stringify(from)}, ${JSON.stringify(to)})`,
    );
  }
  t.diagnostic(`${compared} collision queries compared`);
});

test('canonical outcomes: open ground reads level, a solid cell blocks, a wall stops the ring', () => {
  for (const surface of [CASTLE_SURFACE, CAMP_CAVE_SURFACE]) {
    // Far from both atlases (the camp at 50,50 is outside the cave and the castle).
    assert.equal(surface.height(50, 30), undefined);
    assert.equal(surface.deviation(50, 30, 0.32), 0);
    assert.equal(surface.free(50, 30, 1.9), true);
    const { nx, heights, minX, minZ, step } = surface.data,
      solid = heights.indexOf(null),
      wall = surface.world(minX + ((solid % nx) + 0.5) * step, minZ + (Math.floor(solid / nx) + 0.5) * step);
    assert.ok(solid >= 0, 'the atlas has solid cells');
    assert.equal(surface.height(wall.x, wall.z), null);
    assert.equal(surface.deviation(wall.x, wall.z, 0.32), null);
    assert.equal(surface.free(wall.x, wall.z, 0), false);
  }
  // The measured cave aisle stays walkable at the widest body (camp-surface-continuity).
  for (let localZ = 15.9; localZ >= -31.5; localZ -= 0.5) {
    const p = caveWorldAt(localZ);
    assert.ok(CAMP_CAVE_SURFACE.free(p.x, p.z, 0.76), `blocked aisle ${localZ}`);
  }
  const end = caveWorldAt(-33.5);
  assert.equal(CAMP_CAVE_SURFACE.free(end.x, end.z, 0.32), false, 'the natural blind end is solid');
});

// Repeatable timing of the frozen and current implementations on the same inputs. It reports
// only; Codex measures gameplay in Chrome. CRO_BENCH=1 node --test <this file>
test(
  'benchmark: walk-surface and collision queries, frozen against current',
  { skip: process.env.CRO_BENCH === '1' ? false : 'set CRO_BENCH=1 to run the benchmark' },
  (t) => {
    const rng = generator(1009),
      atlases = realAtlases(),
      pairOfWorlds = worlds(),
      boxes = Object.values(atlases).map((surfaces) => frame(surfaces.base).box);
    const outside = (p) =>
      boxes.every((b) => p.x < b.minX - 2 || p.x > b.maxX + 2 || p.z < b.minZ - 2 || p.z > b.maxZ + 2);
    const far = [],
      near = [],
      sights = [];
    while (far.length < 4096) {
      const p = {
        x: rng.range(WORLD.minX + 3, WORLD.maxX - 3),
        z: rng.range(WORLD.minZ + 3, WORLD.maxZ - 3),
      };
      if (outside(p)) far.push(p);
    }
    for (let i = 0; i < 4096; i++) {
      const box = boxes[i % boxes.length];
      near.push({ x: rng.range(box.minX, box.maxX), z: rng.range(box.minZ, box.maxZ) });
    }
    // Hunting-like sight lines: 20-80 m across open ground near the camp.
    while (sights.length < 256) {
      const a = { x: rng.range(10, 110), z: rng.range(-10, 60) },
        angle = rng.range(0, Math.PI * 2),
        length = rng.range(20, 80),
        b = { x: a.x + Math.cos(angle) * length, z: a.z + Math.sin(angle) * length };
      if (outside(a) && outside(b)) sights.push([a, b]);
    }
    const time = (run, calls) => {
      let sink = 0;
      for (let i = 0; i < 2; i++) sink += run();
      const rounds = [];
      for (let i = 0; i < 9; i++) {
        const started = performance.now();
        sink += run();
        rounds.push(((performance.now() - started) * 1e6) / calls);
      }
      rounds.sort((a, b) => a - b);
      return { nsPerCall: Number(rounds[4].toFixed(1)), sink: Number.isFinite(sink) ? 'finite' : 'other' };
    };
    const results = {};
    for (const [name, surfaces] of Object.entries(atlases))
      for (const [set, points] of Object.entries({ far, near }))
        for (const impl of ['base', 'next']) {
          const surface = surfaces[impl];
          results[`${name} deviation ${set} ${impl}`] = time(() => {
            let sum = 0;
            for (const p of points) sum += surface.deviation(p.x, p.z, 0.32) ?? 1;
            return sum;
          }, points.length);
          results[`${name} height ${set} ${impl}`] = time(() => {
            let sum = 0;
            for (const p of points) sum += surface.height(p.x, p.z) ?? 1;
            return sum;
          }, points.length);
        }
    for (const impl of ['base', 'next']) {
      const world = pairOfWorlds[impl];
      results[`CollisionWorld.free far ${impl}`] = time(() => {
        let sum = 0;
        for (const p of far) sum += world.free(p, 0.32) ? 1 : 0;
        return sum;
      }, far.length);
      results[`CollisionWorld.segmentFree 20-80 m ${impl}`] = time(() => {
        let sum = 0;
        for (const [a, b] of sights) sum += world.segmentFree(a, b, 0.12) ? 1 : 0;
        return sum;
      }, sights.length);
    }
    t.diagnostic(JSON.stringify({ node: process.version, results }, null, 2));
  },
);
