import test from 'node:test';
import assert from 'node:assert/strict';
import { CollisionWorld } from '../dist/shared/collision.mjs';
import { castleWorld, castleLocal } from '../dist/shared/castle-layout.mjs';
import { CHARACTER_MODELS } from '../dist/shared/characters.mjs';
import { movePlayer } from '../dist/shared/movement.mjs';
import { WORLD } from '../dist/shared/world.mjs';
import { measuredWalkSurface } from '../dist/shared/measured-walk-surface.mjs';
import { CASTLE_SURFACE } from '../dist/shared/castle-surface.mjs';

// 2026-09-12 ruin: through the gate, across the forecourt, up the central
// stair onto the hall, sideways along the hall's front edge, and back down.
test('all seven characters manually climb the central stair, turn both ways and descend', () => {
  const collision = new CollisionWorld();
  for (const model of CHARACTER_MODELS)
    for (const runningRequested of [false, true]) {
      for (const side of [-1, 1]) {
        const actor = {
          ...model,
          ...castleWorld(-9, 40),
          radius: model.radius ?? WORLD.playerRadius,
          runningRequested,
          lastInput: 0,
          dx: 0,
          dz: 0,
          facing: 0,
        };
        let now = 1000;
        for (const local of [
          [-9, 30],
          [0, 16],
          [0, 2],
          [0, -4],
          [side * 6, -4],
          [0, -4],
          [0, -12],
          [side * 4, -18],
          [0, -4],
          [0, 2],
          [0, 16],
          [-9, 30],
          [-9, 40],
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

// The 2026-09-11 report (old keep): players stopped midway on the side stairs.
// The ruin's side stairs are wide and straight; holding the stick up either
// flight from the forecourt must carry every character onto the hall floor.
test('every character climbs both side stairs to the upper hall by holding the stick', () => {
  const collision = new CollisionWorld();
  const level = (actor) => CASTLE_SURFACE.height(actor.x, actor.z) ?? 0;
  for (const model of CHARACTER_MODELS) {
    const radius = model.radius ?? WORLD.playerRadius;
    for (const side of [1, -1])
      for (const [x0, z0] of [
        [21, 16],
        [24, 15],
        [18, 15],
      ])
        for (const [dxl, dzl] of [
          [0, -1],
          [0.25, -1],
        ])
          for (const runningRequested of [false, true]) {
            const start = castleWorld(side * x0, z0);
            if (!collision.free(start, radius)) continue;
            const actor = {
              ...model,
              ...start,
              radius,
              runningRequested,
              lastInput: 0,
              dx: 0,
              dz: 0,
              facing: 0,
            };
            const heading = castleWorld(side * dxl, dzl),
              origin = castleWorld(0, 0),
              length = Math.hypot(heading.x - origin.x, heading.z - origin.z),
              dx = (heading.x - origin.x) / length,
              dz = (heading.z - origin.z) / length,
              speed = runningRequested
                ? (model.runSpeed ?? WORLD.runSpeed)
                : (model.walkSpeed ?? WORLD.walkSpeed);
            let now = 1000,
              reached = false;
            for (let n = 0; n < 400 && !reached; n++) {
              now += 50;
              Object.assign(actor, { dx, dz, lastInput: now });
              movePlayer(actor, 0.05, now, (p, a, b) => collision.move(p, a, b, p.radius), speed);
              assert.notEqual(
                CASTLE_SURFACE.deviation(actor.x, actor.z, actor.radius),
                null,
                `${model.key}: body inside a wall`,
              );
              reached = level(actor) >= 5;
            }
            assert.ok(
              reached,
              `${model.key} side=${side} start=${[side * x0, z0]} dir=${[side * dxl, dzl]} run=${runningRequested} stopped at ${JSON.stringify(castleLocal(actor.x, actor.z))} h=${level(actor).toFixed(2)}`,
            );
          }
  }
});

test('the walk atlas bridges the unmeasured riser rows so every stair is continuous', () => {
  const { holeFills, groundMetres } = CASTLE_SURFACE.data.measurement;
  assert.ok(holeFills.length >= 90, 'holes recorded');
  assert.equal(groundMetres, 1.28, 'the plinth height the atlas was levelled by');
  for (const fill of holeFills) assert.ok(fill.h >= 0.3, 'only floors above the ground are filled');
  // Along the centre line of each of the three stairs the floor is measured
  // (or bridged) at every cell from the forecourt to the hall.
  for (const x of [-22, 0, 20])
    for (let z = 14; z >= 2; z -= 0.35) {
      const p = castleWorld(x, z);
      assert.ok(Number.isFinite(CASTLE_SURFACE.height(p.x, p.z)), `stair ${x} at z ${z.toFixed(2)}`);
    }
});
