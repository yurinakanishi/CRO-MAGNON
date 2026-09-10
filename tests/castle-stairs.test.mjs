import test from 'node:test';
import assert from 'node:assert/strict';
import { CollisionWorld } from '../dist/shared/collision.mjs';
import { castleWorld, castleLocal } from '../dist/shared/castle-layout.mjs';
import { CHARACTER_MODELS } from '../dist/shared/characters.mjs';
import { movePlayer } from '../dist/shared/movement.mjs';
import { WORLD } from '../dist/shared/world.mjs';
import { measuredWalkSurface } from '../dist/shared/measured-walk-surface.mjs';

test('all seven characters manually climb the central stair, turn both ways and descend', () => {
  const collision = new CollisionWorld();
  for (const model of CHARACTER_MODELS)
    for (const runningRequested of [false, true]) {
      for (const side of [-1, 1]) {
        const actor = {
          ...model,
          ...castleWorld(0, 35),
          radius: model.radius ?? WORLD.playerRadius,
          runningRequested,
          lastInput: 0,
          dx: 0,
          dz: 0,
          facing: 0,
        };
        let now = 1000;
        for (const local of [
          [0, 19.05],
          [side * 5, 19.05],
          [side * 5, 23],
          [side * 5, 19.05],
          [0, 19.05],
          [0, 35],
        ]) {
          const goal = castleWorld(...local);
          for (let n = 0; n < 2400 && Math.hypot(actor.x - goal.x, actor.z - goal.z) > 0.06; n++) {
            const distance = Math.hypot(actor.x - goal.x, actor.z - goal.z);
            now += 50;
            Object.assign(actor, {
              dx: (goal.x - actor.x) / distance,
              dz: (goal.z - actor.z) / distance,
              lastInput: now,
            });
            const speed = runningRequested
              ? (model.runSpeed ?? WORLD.runSpeed)
              : (model.walkSpeed ?? WORLD.walkSpeed);
            movePlayer(
              actor,
              Math.min(0.05, distance / speed),
              now,
              (p, dx, dz) => collision.move(p, dx, dz, p.radius),
              speed,
            );
            assert.ok(collision.free(actor, actor.radius), `${model.key}: body clearance`);
          }
          assert.ok(
            Math.hypot(actor.x - goal.x, actor.z - goal.z) < 0.06,
            `${model.key} run=${runningRequested} goal=${local} stopped=${JSON.stringify(castleLocal(actor.x, actor.z))}`,
          );
        }
      }
    }
});

test('rotated measured walls slide the body without crossing walls, drops or other actors', () => {
  for (const yaw of [0, -1.05, Math.PI / 2])
    for (const blockedHeight of [null, 7]) {
      const surface = measuredWalkSurface(
        {
          step: 0.25,
          minX: 0,
          minZ: 0,
          nx: 40,
          nz: 40,
          heights: Array.from({ length: 1600 }, (_, i) => (i % 40 >= 20 ? blockedHeight : 0)),
        },
        { x: 30, z: 30, yaw, scale: 1 },
      );
      const collision = new CollisionWorld([], { coast: false, walkSurfaces: [surface] });
      const start = surface.world(4.65, 2),
        delta = surface.world(1, 2),
        origin = surface.world(0, 0);
      const end = collision.move(start, delta.x - origin.x, delta.z - origin.z, 0.32);
      const local = surface.local(end.x, end.z);
      assert.ok(local.z > 3.95, 'tangential input survives contact by the body edge');
      assert.ok(local.x < 4.69, 'no penetration or terrace climbing');
      assert.ok(collision.free(end, 0.32));
      const other = { ...surface.world(4.65, 3), type: 'circle', radius: 0.4 };
      const blocked = collision.move(start, delta.x - origin.x, delta.z - origin.z, 0.32, [other]);
      assert.ok(collision.free(blocked, 0.32, [other]));
      const retreat = collision.move(end, origin.x - delta.x, origin.z - delta.z, 0.32);
      assert.ok(Math.hypot(retreat.x - end.x, retreat.z - end.z) > 1.5, 'can back away');
    }
});
