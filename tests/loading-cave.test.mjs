import test from 'node:test';
import assert from 'node:assert/strict';
import { LoadingCaveMovement } from '../dist/src/loading-cave-movement.js';
import { CollisionWorld } from '../dist/shared/collision.mjs';
import { caveLocal, caveWorldAt } from '../dist/shared/camp-cave-layout.mjs';
import { WorldAssets } from '../dist/src/world-assets.js';
import * as THREE from 'three';
import { prepareMountainRiverBedAsync } from '../dist/src/mountain-river.js';

test('loading visitor walks and runs on the measured cave floor, independently of room state', () => {
  const collision = new CollisionWorld();
  const visitor = new LoadingCaveMovement();
  const start = { ...visitor.position };
  for (let i = 0; i < 20; i++) visitor.step(collision, 0, -1, Math.PI, 0.05);
  assert.ok(visitor.position.z > start.z + 1);
  assert.ok(collision.free(visitor.position, 0.35));
  assert.ok(Math.abs(collision.surfaceHeight(visitor.position)) < 0.1);
  const walkSpeed = visitor.speed;
  visitor.step(collision, 0, 1, Math.PI, 0.05, true);
  assert.ok(visitor.speed > walkSpeed);
  visitor.step(collision, 0, 0, Math.PI, 0.05);
  assert.equal(visitor.speed, 0);
});

test('long input, diagonal movement and resumed frames cannot leave the cave or jump through its walls', () => {
  const collision = new CollisionWorld();
  for (const direction of [
    [0, 1],
    [0, -1],
    [1, 0],
    [-1, 0],
    [1, 1],
    [-1, -1],
  ]) {
    const visitor = new LoadingCaveMovement();
    for (let i = 0; i < 600; i++) {
      const previous = visitor.position;
      visitor.step(collision, ...direction, 0, 5, true);
      assert.ok(
        Math.hypot(visitor.position.x - previous.x, visitor.position.z - previous.z) <= 0.201,
      );
      assert.ok(collision.free(visitor.position, 0.35));
      const local = caveLocal(visitor.position.x, visitor.position.z);
      assert.ok(local.z >= -38 && local.z <= -1);
    }
  }
  const visitor = new LoadingCaveMovement();
  visitor.position = caveWorldAt(-1.02);
  visitor.step(collision, 0, -1, 0, 0.05);
  assert.ok(caveLocal(visitor.position.x, visitor.position.z).z <= -1);
});

test('the world reuses a cave loaded first and does not download or replace its shared resources', async () => {
  let downloads = 0;
  const scene = new THREE.Group();
  const assets = new WorldAssets({
    loadEnvironment: async () => {
      downloads++;
      return { scene };
    },
  });
  assets.catalog = {
    status: 'ready',
    assets: [{ modelKey: 'camp-cave', bytes: 10, kind: 'static', lods: [] }],
  };
  const first = assets.ensureInitial('camp-cave');
  assert.equal(assets.ensureInitial('camp-cave'), first);
  const template = await first;
  const progress = [];
  await assets.load({
    background: true,
    onProgress: (loaded, total) => progress.push({ loaded, total }),
  });
  assert.equal(assets.get('camp-cave'), template);
  assert.equal(downloads, 1);
  assert.deepEqual(progress, [{ loaded: 0, total: 0 }]);
  assets.dispose();
});

test('a mountain worker result arriving after disposal cannot replace the shared template', async () => {
  const source = new THREE.PlaneGeometry(2, 2);
  const mesh = new THREE.Mesh(source);
  const root = new THREE.Group();
  root.add(mesh);
  let resolve,
    active = true,
    disposed = 0;
  const result = new THREE.PlaneGeometry(3, 3);
  result.addEventListener('dispose', () => disposed++);
  const pending = prepareMountainRiverBedAsync(
    root,
    {
      build(input, options) {
        assert.notEqual(input, source);
        assert.deepEqual(options, { maximumEdge: 0.45, mountainOnly: true });
        input.dispose();
        return new Promise((done) => {
          resolve = done;
        });
      },
    },
    () => active,
  );
  active = false;
  resolve(result);
  await pending;
  assert.equal(disposed, 1);
  assert.equal(mesh.geometry, source);
  source.dispose();
  mesh.material.dispose();
});
