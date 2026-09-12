import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FRUIT_RADIUS,
  FRUIT_FALLBACK_HEIGHT,
  FRUIT_FALLBACK_RADIUS,
  STONE_MIN_SCALE,
  berryAnchors,
  fruitCount,
  meatPieceVisibility,
  meatRingLayout,
  seedFromId,
  stoneScale,
  woodClipHeight,
  woodClipPlane,
} from '../dist/src/resource-visuals.js';

// A synthetic bush: rings of vertices at several heights, radius growing with
// height, plus trunk vertices on the axis and an odd protruding "branch".
function bushPoints() {
  const points = [];
  for (let level = 0; level <= 10; level++) {
    const y = level * 0.12,
      radius = 0.15 + level * 0.03;
    for (let step = 0; step < 24; step++) {
      const angle = (step / 24) * Math.PI * 2;
      points.push([Math.cos(angle) * radius, y, Math.sin(angle) * radius]);
    }
    points.push([0, y, 0]);
  }
  points.push([0.9, 1.0, 0.05]);
  return points;
}

test('berry anchors are deterministic per seed, on the upper bush, and spread around it', () => {
  const points = bushPoints(),
    seed = seedFromId('berry-3'),
    anchors = berryAnchors(points, 5, seed);
  assert.equal(anchors.length, 5);
  assert.deepEqual(berryAnchors(points, 5, seed), anchors);
  assert.notDeepEqual(berryAnchors(points, 5, seedFromId('berry-4')), anchors);
  for (const [x, y, z] of anchors) {
    assert.ok(y >= 1.2 * 0.45, `fruit at y=${y} is below the upper 55 % of the bush`);
    assert.ok(Math.hypot(x, z) > 0.2, 'fruit sits on the outside of the foliage, not the trunk');
  }
  // One fruit per 72° wedge means no gap between neighbours can exceed two wedges.
  const angles = anchors.map(([x, , z]) => Math.atan2(z, x)).sort((a, b) => a - b);
  const gaps = angles.map((angle, index) =>
    index ? angle - angles[index - 1] : angle + Math.PI * 2 - angles[angles.length - 1],
  );
  assert.ok(
    Math.max(...gaps) < (Math.PI * 2 * 2) / 5 + 1e-9,
    `fruit should surround the bush, got gaps ${gaps.map((g) => g.toFixed(2))}`,
  );
  const radii = anchors.map(([x, , z]) => Math.hypot(x, z));
  assert.ok(Math.min(...radii) > 0.33, 'each sector contributes one of its outermost vertices');
  const outermost = points.reduce((best, [x, , z]) => Math.max(best, Math.hypot(x, z)), 0);
  assert.ok(
    [...Array(8)].some((_, index) =>
      berryAnchors(points, 5, index).some(
        ([x, , z]) => Math.hypot(x, z) > outermost + FRUIT_RADIUS * 0.4,
      ),
    ),
    'the protruding branch is picked by some seed and nudged outward beyond the vertex',
  );
  for (let a = 0; a < anchors.length; a++)
    for (let b = a + 1; b < anchors.length; b++) {
      const [ax, ay, az] = anchors[a],
        [bx, by, bz] = anchors[b];
      assert.ok(
        Math.hypot(ax - bx, ay - by, az - bz) >= FRUIT_RADIUS * 1.5,
        'no overlapping fruit',
      );
    }
});

test('berry anchors fall back to a ring without geometry and handle counts beyond the vertices', () => {
  const ring = berryAnchors([], 5, 7);
  assert.equal(ring.length, 5);
  for (const [x, y, z] of ring) {
    assert.equal(y, FRUIT_FALLBACK_HEIGHT);
    assert.ok(Math.abs(Math.hypot(x, z) - FRUIT_FALLBACK_RADIUS) < 1e-9);
  }
  assert.deepEqual(berryAnchors(bushPoints(), 0, 1), []);
  const flat = berryAnchors(
    [
      [0.3, 1, 0],
      [0, 1, 0.3],
    ],
    4,
    3,
  );
  assert.equal(flat.length, 4, 'shortfall is filled from a ring');
  assert.equal(berryAnchors([[0, 0.5, 0]], 2, 1).length, 2, 'trunk-only geometry uses the ring');
});

test('fruit count follows the amount and is bounded by the maximum', () => {
  assert.equal(fruitCount(3, 5), 3);
  assert.equal(fruitCount(9, 5), 5);
  assert.equal(fruitCount(0, 5), 0);
  assert.equal(fruitCount(-2, 5), 0);
  assert.equal(fruitCount(2, undefined), 0);
});

test('wood clipping height tracks the remaining amount and the plane sits above the pile base', () => {
  assert.equal(woodClipHeight(0.7, 7, 7), 0.7);
  assert.ok(Math.abs(woodClipHeight(0.7, 5, 7) - 0.5) < 1e-9);
  assert.equal(woodClipHeight(0.7, 0, 7), 0);
  assert.equal(woodClipHeight(0.7, 3, 0), 0);
  const plane = woodClipPlane(12, 1, 0.7, 3, 7);
  assert.deepEqual(plane.normal, [0, -1, 0]);
  assert.ok(Math.abs(plane.constant - (12 + 0.3)) < 1e-9);
  assert.ok(woodClipPlane(12, 1, 0.7, 7, 7).constant > 12.7, 'a full pile is never clipped');
  assert.ok(
    Math.abs(woodClipPlane(0, 2, 0.7, 3, 7).constant - 0.6) < 1e-9,
    'scaled with the model',
  );
  // three.js discards points whose signed distance n·p + c is negative:
  // a log above the clip height is removed, one below is kept.
  const signed = (y) => -y + plane.constant;
  assert.ok(signed(12.5) < 0);
  assert.ok(signed(12.1) > 0);
});

test('stone shrinks with the cube root of the remaining amount and never below 55 %', () => {
  assert.equal(stoneScale(0.55, 8, 8), 0.55);
  assert.ok(Math.abs(stoneScale(1, 1, 8) - 0.5) < 1e-9 || stoneScale(1, 1, 8) === STONE_MIN_SCALE);
  assert.equal(stoneScale(1, 1, 8), STONE_MIN_SCALE);
  assert.ok(Math.abs(stoneScale(1, 4, 8) - Math.cbrt(0.5)) < 1e-9);
  assert.equal(stoneScale(0.55, 0, 8), 0.55 * STONE_MIN_SCALE);
  assert.equal(stoneScale(0.55, 3, 0), 0.55);
});

test('meat pieces hide from the end as servings are taken', () => {
  assert.deepEqual(meatPieceVisibility(4, 4), [true, true, true, true]);
  assert.deepEqual(meatPieceVisibility(2, 4), [true, true, false, false]);
  assert.deepEqual(meatPieceVisibility(0, 4), [false, false, false, false]);
  assert.deepEqual(meatPieceVisibility(undefined, 4), [true, true, true, true]);
  assert.deepEqual(meatPieceVisibility(9, 4), [true, true, true, true]);
  const ring = meatRingLayout(4);
  assert.equal(ring.length, 4);
  for (const { x, z } of ring) assert.ok(Math.abs(Math.hypot(x, z) - 0.45) < 1e-9);
  assert.ok(
    new Set(ring.map(({ yaw }) => yaw.toFixed(3))).size === 4,
    'each piece has its own yaw',
  );
  assert.deepEqual(meatRingLayout(4), ring, 'layout is deterministic');
});

test('resource ids hash to stable seeds', () => {
  assert.equal(seedFromId('berry-1'), seedFromId('berry-1'));
  assert.notEqual(seedFromId('berry-1'), seedFromId('berry-2'));
  assert.ok(Number.isInteger(seedFromId('')));
});
