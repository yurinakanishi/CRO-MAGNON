import test from 'node:test';
import assert from 'node:assert/strict';
import { LANDMARKS } from '../dist/shared/landmarks.mjs';
import { LANDMARK_BOUNDS } from '../dist/shared/landmark-bounds.mjs';
import { landmarkObstacles } from '../dist/shared/landmark-collision.mjs';
import { CollisionWorld } from '../dist/shared/collision.mjs';
import { verifyModelSource } from './runtime-model-identity.mjs';

test('ice and volcano collision footprints are tied to the exact delivered geometry', async () => {
  for (const [key, footprint] of Object.entries(LANDMARK_BOUNDS)) {
    // Measured from the original GLB; an adopted derivative must decode to its geometry.
    const { original } = await verifyModelSource(key);
    assert.equal(original.sha256, footprint.sha256);
    assert.ok(
      footprint.boxes.length > 20,
      'Use the measured silhouette, not a single enclosing box',
    );
    assert.ok(footprint.boxes.every((b) => b.height > 0 && b.height <= footprint.max[1] + 0.001));
  }
});

test('rotated landmarks block human and mammoth sweeps while leaving a navigable approach', () => {
  for (const key of Object.keys(LANDMARK_BOUNDS)) {
    const placement = LANDMARKS.find((item) => item.key === key),
      obstacles = landmarkObstacles([placement], LANDMARK_BOUNDS);
    const world = new CollisionWorld(obstacles, { river: false }),
      span = placement.clearance + 8;
    const start = { x: placement.x - span, z: placement.z },
      goal = { x: placement.x + span, z: placement.z };
    for (const radius of [0.32, 2.95]) {
      assert.ok(world.free(start, radius));
      assert.ok(world.free(goal, radius));
      assert.equal(world.segmentFree(start, goal, radius), false);
      const stopped = world.move(start, span * 2, 0, radius);
      assert.ok(world.free(stopped, radius));
      assert.ok(
        Math.hypot(stopped.x - goal.x, stopped.z - goal.z) > 1,
        'High-speed movement must not tunnel through the mesh',
      );
    }
    const route = world.path(start, goal, 0.32);
    assert.ok(route.length);
    let previous = start;
    for (const point of route) {
      assert.ok(world.segmentFree(previous, point, 0.32));
      previous = point;
    }
    assert.ok(Math.hypot(previous.x - goal.x, previous.z - goal.z) < 0.01);
    assert.ok(
      world.cameraDistance({ ...start, y: 1.4 }, { x: 1, y: 0, z: 0 }, span * 2) < span * 2,
      'Camera contracts before entering a solid landmark',
    );
  }
});
