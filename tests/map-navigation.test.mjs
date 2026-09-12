import test from 'node:test';
import assert from 'node:assert/strict';
import {
  movePointer,
  clampPointer,
  nearestWithin,
  nudgeStep,
  placeLabels,
  MAP_TIERS,
  MAP_ZOOM,
  PICK_RADIUS,
  EDGE_BAND,
} from '../dist/src/map-layout.js';
import {
  mapProjection,
  resetWorldMap,
  setWorldMapMode,
  centerWorldMap,
  zoomWorldMap,
  panWorldMap,
  worldMapTerrainSample,
  ATLAS_BOUNDS,
} from '../dist/src/world-map.js';
import { WARP_POINTS } from '../dist/shared/warp-sites.mjs';
import { GULF } from '../dist/shared/gulf-region.mjs';

test('one seamless projection shows the whole earth and the gulf at 1× and keeps the minimap unchanged', () => {
  const canvas = { width: 1000, height: 620 },
    self = { x: 50, z: 50 };
  resetWorldMap();
  const mini = mapProjection({ width: 150, height: 100 }, false, self).point(80, 60);
  const projection = mapProjection(canvas, true, self);
  assert.equal(projection.zoom, 1);
  for (const point of [
    ...WARP_POINTS,
    { x: GULF.minX, z: GULF.maxZ },
    { x: GULF.maxX, z: GULF.minZ },
  ]) {
    const [x, y] = projection.point(point.x, point.z);
    assert.ok(
      x > 24 && x < canvas.width - 24 && y > 24 && y < canvas.height - 24,
      point.id ?? 'gulf',
    );
  }
  assert.ok(ATLAS_BOUNDS.minX <= GULF.minX && ATLAS_BOUNDS.maxZ >= GULF.maxZ);
  assert.deepEqual(mapProjection({ width: 150, height: 100 }, false, self).point(80, 60), mini);
  assert.deepEqual(
    mapProjection({ width: 150, height: 100 }, false, self).point(self.x, self.z),
    [75, 50],
  );
});

test('zoom anchors at the pointer, pans move the map by the given pixels, and zoom stays within 1× to 32×', () => {
  const canvas = { width: 1000, height: 620 },
    self = { x: 50, z: 50 };
  resetWorldMap();
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
  assert.equal(mapProjection(canvas, true, self).zoom, MAP_ZOOM.max);
  zoomWorldMap(canvas, self, 0.00001);
  assert.equal(mapProjection(canvas, true, self).zoom, MAP_ZOOM.min);
  centerWorldMap(WARP_POINTS.at(-1));
  assert.deepEqual(
    mapProjection(canvas, true, self).point(WARP_POINTS.at(-1).x, WARP_POINTS.at(-1).z),
    [500, 310],
  );
  setWorldMapMode('earth'); // Legacy reset: whole world, 1×.
  assert.deepEqual(mapProjection(canvas, true, self).point(50, 50), initial.point(50, 50));
});

test('opening the atlas centres the player at 4× and the tiers reveal names in order', () => {
  const canvas = { width: 1000, height: 620 },
    self = { x: -2270, z: 450 };
  resetWorldMap(self, MAP_ZOOM.open);
  const p = mapProjection(canvas, true, self);
  assert.equal(p.zoom, 4);
  assert.deepEqual(p.point(self.x, self.z), [500, 310]);
  assert.ok(MAP_TIERS.places < MAP_TIERS.fires && MAP_TIERS.fires < MAP_TIERS.sites);
  assert.equal(MAP_ZOOM.open, MAP_TIERS.fires, 'fire names are visible as soon as the map opens');
});

test('the pointer moves at 600 px/s × magnitude² and drags the map along inside the edge band', () => {
  const size = { width: 1000, height: 600 };
  const gentle = movePointer({ x: 500, y: 300 }, { x: 0.5, y: 0 }, 0.1, size);
  assert.ok(Math.abs(gentle.pointer.x - (500 + 600 * 0.25 * 0.1)) < 1e-9);
  assert.deepEqual(gentle.pan, { x: 0, y: 0 });
  const fast = movePointer({ x: 500, y: 300 }, { x: 1, y: 0 }, 1, size);
  assert.equal(fast.pointer.x, size.width * (1 - EDGE_BAND));
  assert.equal(fast.pan.x, size.width * (1 - EDGE_BAND) - 1100, 'the overshoot scrolls the map');
  const idle = movePointer({ x: 500, y: 300 }, { x: 0, y: 0 }, 0.1, size);
  assert.deepEqual(idle.pointer, { x: 500, y: 300 });
  const up = clampPointer({ x: 500, y: -40 }, size);
  assert.equal(up.pointer.y, size.height * EDGE_BAND);
  assert.equal(up.pan.y, size.height * EDGE_BAND + 40);
  assert.deepEqual(nudgeStep(0), 1);
  assert.ok(nudgeStep(20) > nudgeStep(5) && nudgeStep(5) > nudgeStep(0));
});

test('a fire counts as chosen within 22 px of the pointer and the nearest one wins', () => {
  const fires = [
    { id: 'a', x: 100, y: 100 },
    { id: 'b', x: 112, y: 100 },
    { id: 'c', x: 400, y: 400 },
  ];
  assert.equal(PICK_RADIUS, 22);
  assert.equal(nearestWithin(fires, { x: 108, y: 100 })?.id, 'b');
  assert.equal(nearestWithin(fires, { x: 100, y: 121 })?.id, 'a');
  assert.equal(nearestWithin(fires, { x: 100, y: 123 }), null);
  assert.equal(nearestWithin(fires, { x: 250, y: 250 }), null);
});

test('label declutter keeps fires over enemies over places over settlements and skips overlaps', () => {
  const rect = (x, y, width = 60, height = 14) => ({ x, y, width, height });
  const requests = [
    { name: 'settlement', priority: 3, rect: rect(0, 0) },
    { name: 'place', priority: 2, rect: rect(10, 4) },
    { name: 'enemy', priority: 1, rect: rect(20, 8) },
    { name: 'fire', priority: 0, rect: rect(30, 12) },
    { name: 'far place', priority: 2, rect: rect(300, 300) },
  ];
  assert.deepEqual(
    placeLabels(requests).map((r) => r.name),
    ['fire', 'far place'],
  );
  assert.deepEqual(
    placeLabels(requests.filter((r) => r.name !== 'fire')).map((r) => r.name),
    ['enemy', 'far place'],
  );
});

test('the atlas and minimap share one arrow whose tip follows the world facing: 0 is +z (down), π/2 is +x (right)', async () => {
  const { MAP_ARROW_PATH, MAP_ARROW_POINTS, MAP_ARROW_SIZE, markerRotation, mapArrowTip } =
    await import('../dist/src/map-layout.js');
  const { mapScreen } = await import('../dist/src/map-screen.js');
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  let tip = mapArrowTip(0);
  assert.ok(near(tip.x, 0) && near(tip.y, 1), 'facing 0 points down the screen (+z)');
  tip = mapArrowTip(Math.PI / 2);
  assert.ok(near(tip.x, 1) && near(tip.y, 0), 'facing π/2 points right (+x)');
  tip = mapArrowTip(Math.PI);
  assert.ok(near(tip.x, 0) && near(tip.y, -1), 'facing π points up (north, −z)');
  tip = mapArrowTip(-Math.PI / 2);
  assert.ok(near(tip.x, -1) && near(tip.y, 0), 'facing −π/2 points left (−x)');
  // The tip-up arrow needs a half turn to face +z, so the rotation is π − facing on both maps.
  assert.ok(near(markerRotation(0), Math.PI), 'facing 0 turns the tip down');
  assert.ok(near(markerRotation(Math.PI), 0), 'facing π leaves the tip up');
  assert.ok(near(markerRotation(Math.PI / 2), Math.PI / 2), 'facing π/2 turns the tip right');
  // The SVG path is built from the same points the minimap draws; the tip sits at the top centre.
  assert.equal(MAP_ARROW_SIZE, 24);
  assert.deepEqual(MAP_ARROW_POINTS[0], [12, 2]);
  assert.match(MAP_ARROW_PATH, /^M12 2 L/);
  assert.ok(MAP_ARROW_POINTS.some(([x, y]) => x === 12 && y > 2 && y < 24), 'notched tail');
  const html = mapScreen(() => '');
  assert.match(html, new RegExp(`id="map-self"[^>]*>.*<svg[^>]*viewBox="0 0 24 24"[^>]*><path d="${MAP_ARROW_PATH}"`));
  assert.doesNotMatch(html, /▲/, 'no text glyph markers');
});

test('atlas terrain is filled coarsely while the view moves and finely once it settles', async () => {
  resetWorldMap({ x: 50, z: 50 }, 8);
  assert.equal(worldMapTerrainSample(), 2, 'a view change asks for the in-motion fill');
  panWorldMap({ width: 960, height: 600 }, { x: 50, z: 50 }, 30, 20);
  assert.equal(worldMapTerrainSample(), 2);
  await new Promise((resolve) => setTimeout(resolve, 180));
  assert.equal(worldMapTerrainSample(), 1, 'the settled fill is the full-resolution one');
});
