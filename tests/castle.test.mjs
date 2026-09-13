import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import {
  CASTLE,
  CASTLE_GATE,
  CASTLE_HALL,
  castleWorld,
  nearCastle,
} from '../dist/shared/castle-layout.mjs';
import { CASTLE_SURFACE } from '../dist/shared/castle-surface.mjs';
import { CollisionWorld } from '../dist/shared/collision.mjs';
import { SCENERY, HUNTING_GROUNDS } from '../dist/shared/scenery-layout.mjs';
import { INITIAL_RESOURCES, CAMP } from '../dist/shared/world.mjs';
import { isLand } from '../dist/shared/paleo-geography.mjs';
import { moveActor } from '../dist/shared/movement.mjs';
import { planNavigation, updateNavigation } from '../dist/shared/navigation.mjs';
import { createEnemies } from '../dist/shared/enemies.mjs';
import { SABERTOOTH_GROUND } from '../dist/shared/sabertooth-rules.mjs';
import { MeshRayGrid } from '../dist/src/mesh-ray-grid.js';
import * as THREE from 'three';
import { geometryScene } from '../scripts/measure-collision-bounds.mjs';

const CASTLE_GLB = JSON.parse(
  await readFile('public/models/valley-castle/asset.json', 'utf8'),
).url.replace(/^\//, 'public/');
test('castle floor atlas is measured from the delivered mesh and clears the starting valley', async () => {
  const bytes = await readFile(CASTLE_GLB);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), CASTLE_SURFACE.data.sourceSha256);
  for (let x = -39; x <= 39; x += 2)
    for (let z = -39; z <= 39; z += 2) {
      const p = castleWorld(x, z);
      assert.ok(isLand(p.x, p.z, 1), `${x},${z}`);
    }
  // The ruin: forecourt at valley level, one great hall about 5.6 m above it.
  assert.ok(Math.abs(CASTLE_SURFACE.height(CASTLE_GATE.x, CASTLE_GATE.z) ?? 0) < 0.3);
  assert.ok((CASTLE_SURFACE.height(CASTLE_HALL.x, CASTLE_HALL.z) ?? 0) > 5);
  for (const p of [
    CAMP,
    ...INITIAL_RESOURCES,
    ...HUNTING_GROUNDS,
    ...Object.values(SCENERY).flat(),
  ])
    assert.equal(nearCastle(p.x, p.z), false);
  assert.ok(Math.hypot(CASTLE.x - CAMP.x, CASTLE.z - CAMP.z) < 110);
  assert.ok(
    Math.abs(Math.hypot(CASTLE.x - CAMP.x, CASTLE.z - CAMP.z) - Math.hypot(90, 50)) < 1e-9,
    'camp distance is preserved',
  );
  assert.ok(CASTLE.z > 0 && CASTLE.scale === 1.2, 'castle moved map-south and enlarged');
  assert.ok(
    Math.hypot(CASTLE.x - SABERTOOTH_GROUND.x, CASTLE.z - SABERTOOTH_GROUND.z) > 90,
    'sabertooth separation increased',
  );
});
test('normal authoritative movement enters the castle, climbs all terraces and returns', () => {
  const collision = new CollisionWorld(),
    actor = {
      id: 'walker',
      species: 'cat',
      x: 48,
      z: 57,
      radius: 0.32,
      lastInput: 0,
      dx: 0,
      dz: 0,
      runningRequested: true,
    };
  let now = 1000;
  // Gate, forecourt, up the left stair, across the hall, down the right stair, out.
  const goals = [
    CASTLE_GATE,
    castleWorld(-22, 20),
    castleWorld(-22, 2),
    CASTLE_HALL,
    castleWorld(20, 2),
    castleWorld(20, 20),
    CASTLE_GATE,
  ];
  let maximumHeight = 0,
    samples = 0;
  for (const goal of goals) {
    assert.ok(planNavigation(actor, goal, collision, [], now), JSON.stringify(goal));
    let n = 0;
    while (actor.navigationGoal && n++ < 5000) {
      now += 50;
      updateNavigation(actor, collision, [], now);
      moveActor(actor, 0.05, now, (p, dx, dz) => collision.move(p, dx, dz, p.radius));
      assert.ok(collision.free(actor, actor.radius));
      maximumHeight = Math.max(maximumHeight, collision.surfaceHeight(actor));
      samples++;
    }
    assert.ok(
      Math.hypot(actor.x - goal.x, actor.z - goal.z) < 0.1,
      `Failed to reach ${JSON.stringify({ goal, actor, local: CASTLE_SURFACE.local(actor.x, actor.z) })}`,
    );
  }
  assert.ok(maximumHeight > 5, `hall reached (${maximumHeight})`);
  assert.ok(samples > 500);
  assert.ok(
    collision.path({ x: 48, z: 57 }, CASTLE_HALL, 0.32).length > 2,
    'Long route uses the entrance',
  );
  assert.equal(
    collision.segmentFree(CASTLE_GATE, CASTLE_HALL, 0.32),
    false,
    'Walls block a straight shortcut',
  );
  // 2026-09-12: the sorcerer waits on the roofless great hall on top of the ruin.
  const enemy = createEnemies(collision, [], 1000)[0];
  assert.ok(collision.surfaceHeight(enemy) > 5);
  assert.ok(Math.hypot(enemy.x - CASTLE_HALL.x, enemy.z - CASTLE_HALL.z) < 20);
  // The hall is a wide arena: a 12 m ring around the post is all walkable floor.
  for (let a = 0; a < 16; a++) {
    const p = {
      x: enemy.home.x + 12 * Math.cos((a * Math.PI) / 8),
      z: enemy.home.z + 12 * Math.sin((a * Math.PI) / 8),
    };
    assert.ok(collision.surfaceHeight(p) > 5, `hall floor at ${a}`);
  }
});
test('camera triangle index agrees with full exact-mesh raycasts across the castle', async () => {
  const gltf = await geometryScene(CASTLE_GLB);
  gltf.scene.position.set(CASTLE.x, CASTLE.groundOffset, CASTLE.z);
  gltf.scene.rotation.y = CASTLE.yaw;
  gltf.scene.scale.setScalar(CASTLE.scale);
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((n) => {
    if (n.isMesh) n.material.side = THREE.DoubleSide;
  });
  const grid = new MeshRayGrid(gltf.scene),
    ray = new THREE.Raycaster();
  let hits = 0;
  for (const local of [
    [-9, 38],
    [-22, 20],
    [-22, 8],
    [0, -16],
    [7, -12],
    [0, 8],
  ])
    for (let i = 0; i < 16; i++) {
      const p = castleWorld(...local),
        origin = new THREE.Vector3(p.x, (CASTLE_SURFACE.height(p.x, p.z) ?? 0) + 1.4, p.z),
        direction = new THREE.Vector3(
          Math.sin((i * Math.PI) / 8),
          0.25,
          Math.cos((i * Math.PI) / 8),
        ).normalize();
      ray.set(origin, direction);
      ray.far = 9;
      const hit = ray.intersectObject(gltf.scene, true).find((h) => h.distance > 0.08);
      const expected = hit ? Math.min(9, Math.max(0.35, hit.distance - 0.2)) : 9,
        actual = grid.distance(origin, direction, 9);
      if (hit) assert.ok(Math.abs(actual - expected) < 0.002, `${actual} != ${expected}`);
      else assert.ok(actual > 8.8, `only a grazing float32 hit is allowed: ${actual}`);
      if (hit) hits++;
    }
  assert.ok(hits > 6, `open ruin: ${hits} wall hits`);
});
