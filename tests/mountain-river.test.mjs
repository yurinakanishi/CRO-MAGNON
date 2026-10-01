import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  MOUNTAIN_RIVER,
  MOUNTAIN_RIVER_SAMPLES,
  MOUNTAIN_RIVER_LENGTH,
  MOUNTAIN_WATERFALL,
  mountainRiverAt,
  mountainRiverSample,
  mountainRiverBed,
  mountainRiverContains,
  mountainWaterHeight,
} from '../dist/shared/mountain-river.mjs';
import { MOUNTAIN_LAKE, mountainLakePoint, mountainLakeAt } from '../dist/shared/mountain-lake.mjs';
import {
  terrainHeight,
  installSourceTerrain,
  WATER_LEVEL,
  riverX,
} from '../dist/shared/terrain.mjs';
import { mountainHeight } from '../dist/shared/camp-mountain.mjs';
import {
  expandedMountainX,
  expandedMountainZ,
  sourceMountainX,
  sourceMountainZ,
} from '../dist/shared/mountain-expansion.mjs';
import { isLand } from '../dist/shared/paleo-geography.mjs';
import {
  CAMP_MOUNTAIN_TRAIL,
  CAVE_APPROACH,
  caveWorldAt,
} from '../dist/shared/camp-cave-layout.mjs';
import { CASTLE_SURFACE } from '../dist/shared/castle-surface.mjs';
import { CollisionWorld } from '../dist/shared/collision.mjs';
import { SCENERY, grassForChunk } from '../dist/shared/scenery-layout.mjs';
import { fitSourceRiverBank } from '../dist/src/source-surface-fit.js';

test('the mountain spring drains continuously through a fall and pool to the existing river', () => {
  let previous = mountainRiverSample(0);
  for (let s = 0.05; s < MOUNTAIN_RIVER_LENGTH; s += 0.05) {
    const p = mountainRiverSample(s);
    assert.ok(p.y <= previous.y + 1e-10, 'the stream must never flow uphill');
    assert.ok(Math.hypot(p.x - previous.x, p.z - previous.z, p.y - previous.y) < 0.051);
    assert.ok(p.width > 0 && [p.x, p.y, p.z, p.nx, p.nz].every(Number.isFinite));
    const at = mountainRiverAt(p.x, p.z);
    assert.ok(at && at.distance < 0.00001);
    assert.ok(Math.abs(at.y - p.y) < 0.00001);
    previous = p;
  }
  const mouth = mountainRiverSample(MOUNTAIN_RIVER_LENGTH);
  assert.equal(mouth.y, WATER_LEVEL);
  assert.equal(mouth.x, riverX(mouth.z));
  assert.ok(MOUNTAIN_WATERFALL.lip.y - MOUNTAIN_WATERFALL.foot.y > 15);
  assert.ok(MOUNTAIN_WATERFALL.pool.width > MOUNTAIN_WATERFALL.lip.width * 2);
});

test('water fits below the original mountain and above the shared carved riverbed', () => {
  const release = installSourceTerrain({ resolution: 2, heights: [0, 0, 0, 0] });
  try {
    for (let s = 1; s < MOUNTAIN_RIVER_LENGTH - 1; s += 0.3) {
      const p = mountainRiverSample(s);
      for (const across of [-0.8, 0, 0.8]) {
        const x = p.x + p.nx * p.width * across,
          z = p.z + p.nz * p.width * across;
        assert.ok(terrainHeight(x, z) < p.y - 0.12, `dry obstruction at ${s}/${across}`);
        if (p.y > 0)
          assert.ok(mountainHeight(x, z) > p.y - 0.05, `floating channel at ${s}/${across}`);
      }
    }
  } finally {
    release();
  }
});

test('spring and riverbed leave the castle, cave and existing approach untouched', () => {
  for (const p of MOUNTAIN_RIVER_SAMPLES) assert.equal(CASTLE_SURFACE.cell(p.x, p.z), null);
  for (const p of [
    ...CAMP_MOUNTAIN_TRAIL,
    ...CAVE_APPROACH,
    ...Array.from({ length: 55 }, (_, i) => caveWorldAt(-i)),
  ]) {
    assert.equal(mountainRiverBed(p.x, p.z, mountainHeight(p.x, p.z)), mountainHeight(p.x, p.z));
    assert.equal(mountainRiverContains(p.x, p.z, 2), false);
  }
  assert.equal(mountainRiverBed(500, 500, 8), 8);
  assert.equal(mountainRiverAt(500, 500), null);
});

test('fitted source triangles expose the new river even when a triangle spans both banks', () => {
  const source = new THREE.BufferGeometry();
  source.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([-14, 35, 215, 4, 35, 215, 4, 35, 241, -14, 35, 241], 3),
  );
  source.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  source.setIndex([0, 2, 1, 0, 3, 2]);
  const fitted = fitSourceRiverBank(source, 0.35, true),
    material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(fitted, material),
    ray = new THREE.Raycaster();
  try {
    for (const p of MOUNTAIN_RIVER_SAMPLES.filter((p) => p.z > 216 && p.z < 237)) {
      ray.set(new THREE.Vector3(p.x, 50, p.z), new THREE.Vector3(0, -1, 0));
      const hit = ray.intersectObject(mesh)[0];
      assert.ok(hit);
      assert.ok(Math.abs(hit.point.y - mountainRiverBed(p.x, p.z, 35)) < 0.045);
      assert.ok(hit.point.y < p.y - 0.2);
    }
    const p = fitted.attributes.position,
      uv = fitted.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      assert.ok(Math.abs(uv.getX(i) - (p.getX(i) + 14) / 18) < 0.00001);
      assert.ok(Math.abs(uv.getY(i) - (p.getZ(i) - 215) / 26) < 0.00001);
    }
  } finally {
    source.dispose();
    fitted.dispose();
    material.dispose();
  }
});

test('water crossing preserves the game rules and decorative plants stay clear', () => {
  const wading = new CollisionWorld([], { coast: false, walkSurfaces: [] });
  const blocked = new CollisionWorld([], { coast: false, walkSurfaces: [], river: true });
  for (const p of [MOUNTAIN_RIVER[3], MOUNTAIN_WATERFALL.pool, MOUNTAIN_RIVER.at(-1)]) {
    assert.ok(wading.free(p, 0.32));
    assert.equal(blocked.free(p, 0.32), false);
  }
  for (const items of Object.values(SCENERY))
    for (const p of items) assert.equal(mountainRiverContains(p.x, p.z, 2.5), false);
  for (let ix = -4; ix <= 2; ix++)
    for (let iz = 4; iz <= 11; iz++)
      for (const p of grassForChunk(ix, iz))
        assert.equal(mountainRiverContains(p.x, p.z, 2.5), false);
});

test('the expanded summit keeps at least thirty metres of high land outside every lake shore', () => {
  // Keep the lake in the summit interior, not just above a narrow cliff lip.
  for (let degrees = 0; degrees < 360; degrees += 3) {
    const angle = (degrees * Math.PI) / 180;
    const shore = mountainLakePoint(angle);
    const direction = { x: shore.x - MOUNTAIN_LAKE.x, z: shore.z - MOUNTAIN_LAKE.z };
    const length = Math.hypot(direction.x, direction.z);
    for (let distance = 5; distance <= 30; distance += 1) {
      const x = shore.x + (direction.x / length) * distance,
        z = shore.z + (direction.z / length) * distance;
      assert.ok(
        mountainHeight(x, z) >= MOUNTAIN_LAKE.y + 0.25,
        `lake meets a hillside at ${degrees}°/${distance}m`,
      );
      assert.ok(isLand(x, z, 1), `summit missing from the shared coastline at ${x},${z}`);
    }
  }
});

test('source expansion is smooth and reversible while all terrain before the castle rear stays fixed', () => {
  for (let z = 30; z <= 450; z += 0.1) {
    assert.ok(Math.abs(sourceMountainZ(expandedMountainZ(z)) - z) < 1e-7);
    assert.ok(expandedMountainZ(z + 0.01) > expandedMountainZ(z));
    if (z <= 248) assert.equal(expandedMountainZ(z), z);
    for (const x of [-205, -75, 55]) {
      assert.ok(Math.abs(sourceMountainX(expandedMountainX(x, z), z) - x) < 1e-7);
      if (z <= 248) assert.equal(expandedMountainX(x, z), x);
    }
  }
  assert.equal(expandedMountainZ(300), 420);
});

test('the level mountain lake has a closed irregular shore and a connected outlet', () => {
  const lake = MOUNTAIN_LAKE;
  let area = 0;
  let previous = mountainLakePoint(0);
  for (let i = 1; i <= 360; i++) {
    const p = mountainLakePoint((i * Math.PI) / 180);
    assert.equal(p.y, lake.y);
    assert.ok(mountainHeight(p.x, p.z) > p.y + 0.3, 'the lake rim must retain its water');
    assert.ok(Math.abs(mountainLakeAt(p.x, p.z).shore) < 1e-10);
    area += previous.x * p.z - p.x * previous.z;
    previous = p;
    const inside = mountainLakePoint((i * Math.PI) / 180, 0.85);
    assert.ok(mountainRiverContains(inside.x, inside.z));
    assert.equal(mountainWaterHeight(inside.x, inside.z), lake.y);
    assert.ok(
      mountainRiverBed(inside.x, inside.z, mountainHeight(inside.x, inside.z)) < lake.y - 0.15,
    );
  }
  assert.ok(Math.abs(area / 2) > 700, 'the headwater must read as a lake, not a wide channel');
  const outlet = MOUNTAIN_RIVER[0];
  assert.equal(outlet.y, lake.y);
  assert.ok(mountainLakeAt(outlet.x, outlet.z).shore < -1);
  assert.equal(mountainWaterHeight(500, 500), -Infinity);
});

test('the lake basin and outlet leave every castle floor cell and dry shore intact', () => {
  for (let x = -150; x <= -12; x += 0.5)
    for (let z = 120; z <= 247; z += 0.5) {
      if (!CASTLE_SURFACE.cell(x, z)) continue;
      const original = mountainHeight(x, z);
      assert.equal(mountainRiverBed(x, z, original), original, `castle bank changed at ${x},${z}`);
    }
  const blocked = new CollisionWorld([], { coast: false, walkSurfaces: [], river: true });
  assert.equal(blocked.free(MOUNTAIN_LAKE, 0.32), false);
  for (let x = -65; x <= -25; x += 1)
    assert.equal(mountainRiverBed(x, 247, mountainHeight(x, 247)), mountainHeight(x, 247));
});
