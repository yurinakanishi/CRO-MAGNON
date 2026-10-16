import test from 'node:test';
import assert from 'node:assert/strict';
import { WorldRenderer } from '../dist/src/world3d.js';
import { companionViewDistances } from '../dist/src/companion-view.js';

function fixture() {
  const captures = new Set();
  const limits = companionViewDistances(0.27, 57, 0.5);
  const world = Object.assign(Object.create(WorldRenderer.prototype), {
    companionView: { id: '524', yaw: 0.3, pitch: 0.2, distance: 6 },
    pointer: null,
    yaw: 0,
    pitch: 0.2,
    automaticHeading: null,
    targetDistance: limits.fit,
    camera: { fov: 57, aspect: 0.5 },
    manualInputAllowed: () => true,
    manualCameraAllowed: () => true,
    companionViewTargets: () => [{ id: '524', radius: 0.27 }],
    canvas: {
      style: {},
      dataset: {},
      focus() {},
      addEventListener() {},
      setPointerCapture: (id) => captures.add(id),
      hasPointerCapture: (id) => captures.has(id),
      releasePointerCapture(id) {
        captures.delete(id);
        world.cancel({ pointerId: id });
      },
    },
  });
  world.setupInput();
  const pointer = (id, x, y = 100) => ({
    pointerId: id,
    clientX: x,
    clientY: y,
    button: 0,
    pointerType: 'touch',
    preventDefault() {},
  });
  return { world, captures, limits, pointer };
}

test('pinch spreads to zoom in, closes to zoom out, and clamps without rotating', () => {
  const { world: w, limits, pointer: p } = fixture();
  w.down(p(1, 100));
  w.down(p(2, 200));
  w.move(p(2, 240));
  assert.ok(Math.abs(w.targetDistance - limits.fit / 1.4) < 1e-10);
  assert.equal(w.yaw, 0);
  assert.equal(w.pitch, 0.2);
  w.move(p(2, 150));
  assert.ok(Math.abs(w.targetDistance - limits.fit * 2) < 1e-10);
  w.move(p(2, 10000));
  assert.equal(w.targetDistance, limits.near);
  w.move(p(2, 101));
  assert.equal(w.targetDistance, limits.far);
});

test('lifting either finger rebases orbit; capture release does not cancel the remaining finger', () => {
  for (const first of [1, 2]) {
    const { world: w, captures, pointer: p } = fixture();
    w.down(p(1, 100));
    w.down(p(2, 200));
    w.move(p(2, 300));
    w.up(p(first, first === 1 ? 100 : 300));
    const remaining = first === 1 ? 2 : 1,
      x = remaining === 1 ? 100 : 300;
    assert.deepEqual([...captures], [remaining]);
    assert.equal(w.pointer.id, remaining);
    w.move(p(remaining, x));
    assert.equal(w.yaw, 0);
    w.move(p(remaining, x + 10));
    assert.ok(Math.abs(w.yaw + 0.06) < 1e-10);
    assert.equal(w.pointer.dragged, true, 'a released pinch cannot become a pet click');
    w.up(p(remaining, x + 10));
    assert.equal(w.pointer, null);
    assert.equal(captures.size, 0);
  }
});

test('cancel or leaving inspection clears both fingers; a new gesture starts cleanly', () => {
  for (const leaving of [false, true]) {
    const { world: w, captures, pointer: p } = fixture();
    w.down(p(1, 100));
    w.down(p(2, 200));
    if (leaving) w.endCompanionView();
    else w.cancel({ pointerId: 1 });
    assert.equal(captures.size, 0);
    assert.equal(w.pointer, null);
    const distance = w.targetDistance;
    w.move(p(2, 400));
    assert.equal(w.targetDistance, distance);
    w.down(p(3, 150));
    w.move(p(3, 160));
    assert.equal(w.pointer.id, 3);
    assert.equal(w.pointer.dragged, true);
  }
});
