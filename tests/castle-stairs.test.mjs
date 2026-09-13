import test from 'node:test';
import assert from 'node:assert/strict';
import { CollisionWorld } from '../dist/shared/collision.mjs';
import { castleWorld, castleLocal, CASTLE_TIERS } from '../dist/shared/castle-layout.mjs';
import { CHARACTER_MODELS } from '../dist/shared/characters.mjs';
import { movePlayer } from '../dist/shared/movement.mjs';
import { WORLD } from '../dist/shared/world.mjs';
import { measuredWalkSurface } from '../dist/shared/measured-walk-surface.mjs';
import { CASTLE_SURFACE } from '../dist/shared/castle-surface.mjs';

// 2026-09-13 stepped fortress: through the gate, across the forecourt, up the
// grand central stairs level by level to the summit, sideways on the middle
// terrace, and back down.
test('all seven characters manually climb the central stairs to the summit, turn both ways and descend', () => {
  const collision = new CollisionWorld();
  for (const model of CHARACTER_MODELS)
    for (const runningRequested of [false, true]) {
      for (const side of [-1, 1]) {
        const actor = {
          ...model,
          ...castleWorld(-2, 62),
          radius: model.radius ?? WORLD.playerRadius,
          runningRequested,
          lastInput: 0,
          dx: 0,
          dz: 0,
          facing: 0,
        };
        let now = 1000;
        for (const local of [
          [-2, 52],
          [0, 44],
          [0, 40],
          [0, 24],
          [0, 21],
          [0, 9],
          [-2, 9],
          [side * 5, 6],
          [0, 8],
          [0, -2],
          [-2, -6],
          [-3, -11],
          [-8, -12],
          [-3, -11],
          [-2, -6],
          [0, -2],
          [0, 8],
          [0, 9],
          [0, 21],
          [0, 24],
          [0, 40],
          [0, 44],
          [-2, 52],
          [-2, 62],
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
test('every character climbs the first flight of stairs by holding the stick', () => {
  const collision = new CollisionWorld();
  const level = (actor) => CASTLE_SURFACE.height(actor.x, actor.z) ?? 0;
  for (const model of CHARACTER_MODELS) {
    const radius = model.radius ?? WORLD.playerRadius;
    for (const side of [1, -1])
      for (const [x0, z0] of [
        [4, 42],
        [2, 41],
        [0, 42],
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

test('the walk atlas bridges the unmeasured riser rows so every central stair is continuous', () => {
  const { holeFills, groundMetres, columnChoice, maxStepRise } = CASTLE_SURFACE.data.measurement;
  assert.ok(holeFills.length >= 90, 'holes recorded');
  assert.equal(groundMetres, 13.4, 'the forecourt height the atlas was levelled by');
  assert.equal(columnChoice, 'highest', 'terraces win over the internal floor beneath them');
  assert.equal(maxStepRise, 1);
  for (const fill of holeFills) assert.ok(fill.h >= 0.3, 'only floors above the ground are filled');
  // Along the centre line of every grand stair the floor is measured (or
  // bridged) at every cell from its foot to its top, rising within a riser of
  // the previous cell.
  for (const level of CASTLE_TIERS) {
    if (!level.stair) continue;
    const { foot, top } = level.stair,
      steps = Math.ceil(Math.hypot(top.x - foot.x, top.z - foot.z) / 0.35);
    let previous = CASTLE_SURFACE.height(foot.x, foot.z);
    for (let i = 1; i <= steps; i++) {
      const p = {
          x: foot.x + ((top.x - foot.x) * i) / steps,
          z: foot.z + ((top.z - foot.z) * i) / steps,
        },
        h = CASTLE_SURFACE.height(p.x, p.z);
      assert.ok(Number.isFinite(h), `stair ${level.tier} cell ${i}`);
      assert.ok(
        h >= previous - 0.4 && h - previous <= 1.2,
        `stair ${level.tier} cell ${i}: ${previous} -> ${h}`,
      );
      previous = h;
    }
    assert.ok(
      previous >= CASTLE_TIERS[level.tier].floor - 0.6,
      `stair ${level.tier} reaches the next level`,
    );
  }
});
