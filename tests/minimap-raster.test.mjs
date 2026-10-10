import test from 'node:test';
import assert from 'node:assert/strict';
import { minimapRasterWindow, MINIMAP_RASTER } from '../dist/src/minimap-raster.js';
import { WORLD } from '../dist/shared/world.mjs';

test('arrival samples a small exact global window and retains it during nearby movement', () => {
  const view = { width: 160, height: 115, scale: 160 / 180, center: { x: 48, z: 57 } };
  const first = minimapRasterWindow(view, WORLD);
  assert.ok(first.width * first.height < (MINIMAP_RASTER.width * MINIMAP_RASTER.height) / 20);
  const moved = minimapRasterWindow({ ...view, center: { x: 49, z: 59 } }, WORLD, first);
  assert.equal(moved, first);
  // The retained region includes the visible rectangle and a filtering gutter.
  for (const [axis, min, size, raster, radius] of [
    ['x', WORLD.minX, WORLD.width, MINIMAP_RASTER.width, view.width / view.scale / 2],
    ['y', WORLD.minZ, WORLD.depth, MINIMAP_RASTER.height, view.height / view.scale / 2],
  ]) {
    const center = axis === 'x' ? view.center.x : view.center.z;
    assert.ok(first[axis] <= ((center - radius - min) / size) * raster - 1);
    assert.ok(
      first[axis] + first[axis === 'x' ? 'width' : 'height'] >=
        ((center + radius - min) / size) * raster + 1,
    );
  }
});

test('world corners and warps stay within the original raster without retaining stale windows', () => {
  const view = {
    width: 160,
    height: 115,
    scale: 160 / 180,
    center: { x: WORLD.minX, z: WORLD.minZ },
  };
  const a = minimapRasterWindow(view, WORLD);
  assert.equal(a.x, 0);
  assert.equal(a.y, 0);
  const b = minimapRasterWindow({ ...view, center: { x: WORLD.maxX, z: WORLD.maxZ } }, WORLD, a);
  assert.notEqual(a, b);
  assert.equal(b.x + b.width, MINIMAP_RASTER.width);
  assert.equal(b.y + b.height, MINIMAP_RASTER.height);
  assert.equal(
    minimapRasterWindow({ ...view, center: { x: WORLD.minX - 1e6, z: 0 } }, WORLD),
    null,
  );
  assert.throws(() => minimapRasterWindow({ ...view, scale: 0 }, WORLD), /Invalid/);
});
