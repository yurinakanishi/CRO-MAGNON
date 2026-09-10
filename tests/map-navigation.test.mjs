import test from 'node:test';
import assert from 'node:assert/strict';
import { groupMapPoints } from '../dist/src/map-layout.js';
import {
  mapProjection,
  setWorldMapMode,
  centerWorldMap,
  zoomWorldMap,
  panWorldMap,
} from '../dist/src/world-map.js';
import { WARP_POINTS } from '../dist/shared/warp-sites.mjs';

test('zoom anchors, pan direction, zoom limits and recenter work without changing the minimap', () => {
  const canvas = { width: 1000, height: 620 },
    self = { x: 50, z: 50 };
  setWorldMapMode('earth');
  const mini = mapProjection({ width: 150, height: 100 }, false, self).point(80, 60);
  const initial = mapProjection(canvas, true, self);
  const anchor = { x: 400, y: 300 },
    world = initial.world(anchor.x, anchor.y);
  zoomWorldMap(canvas, self, 2, anchor);
  let p = mapProjection(canvas, true, self);
  assert.equal(p.scale, initial.scale * 2);
  assert.ok(Math.hypot(...p.point(world.x, world.z).map((n, i) => n - [400, 300][i])) < 1e-8);
  const before = p.point(50, 50);
  panWorldMap(canvas, self, 80, -30);
  p = mapProjection(canvas, true, self);
  const after = p.point(50, 50);
  assert.ok(Math.abs(after[0] - before[0] - 80) < 1e-8);
  assert.ok(Math.abs(after[1] - before[1] + 30) < 1e-8);
  zoomWorldMap(canvas, self, 1000);
  assert.equal(mapProjection(canvas, true, self).zoom, 32);
  zoomWorldMap(canvas, self, 0.00001);
  assert.equal(mapProjection(canvas, true, self).zoom, 1);
  assert.deepEqual(mapProjection({ width: 150, height: 100 }, false, self).point(80, 60), mini);
  setWorldMapMode('local');
  assert.deepEqual(mapProjection(canvas, true, self).point(self.x, self.z), [500, 310]);
  centerWorldMap(WARP_POINTS.at(-1));
  assert.deepEqual(
    mapProjection(canvas, true, self).point(WARP_POINTS.at(-1).x, WARP_POINTS.at(-1).z),
    [500, 310],
  );
  setWorldMapMode('earth');
  assert.deepEqual(mapProjection(canvas, true, self).point(50, 50), initial.point(50, 50));
});

test('overview groups keep all 30 destinations reachable at desktop, portrait and landscape sizes', () => {
  for (const [width, height] of [
    [1100, 730],
    [370, 450],
    [590, 290],
  ]) {
    setWorldMapMode('earth');
    const projection = mapProjection({ width, height }, true);
    const points = WARP_POINTS.map((p) => {
      const [x, y] = projection.point(p.x, p.z);
      return { ...p, x, y };
    });
    assert.ok(points.every((p) => p.x > 24 && p.x < width - 24 && p.y > 24 && p.y < height - 24));
    const groups = groupMapPoints(points);
    assert.equal(new Set(groups.flat().map((p) => p.id)).size, 30);
    assert.ok(groups.some((g) => g.length > 1));
    for (let i = 0; i < groups.length; i++)
      for (let j = i + 1; j < groups.length; j++)
        assert.ok(
          groups[i].every((a) => groups[j].every((b) => Math.hypot(a.x - b.x, a.y - b.y) >= 44)),
        );
  }
});

test('a bridging fire merges both overlapping groups without losing or duplicating a destination', () => {
  const points = [
    { id: 'a', x: 0, y: 0 },
    { id: 'b', x: 80, y: 0 },
    { id: 'c', x: 40, y: 0 },
    { id: 'd', x: 300, y: 0 },
  ];
  assert.deepEqual(
    groupMapPoints(points)
      .map((g) => g.map((p) => p.id).sort())
      .sort(),
    [['a', 'b', 'c'], ['d']],
  );
});
