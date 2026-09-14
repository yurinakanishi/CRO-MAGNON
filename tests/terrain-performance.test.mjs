import test from 'node:test';
import assert from 'node:assert/strict';
import { terrainFixture, buffers, snapshot } from '../scripts/benchmark-terrain.mjs';

test('stationary terrain stops uploads while ocean animation time keeps advancing', () => {
  const f = terrainFixture();
  try {
    f.terrain.update(f.camera, 1);
    const before = snapshot(f.terrain),
      versions = buffers(f.terrain).map((a) => a.version);
    for (let i = 2; i < 30; i++) f.terrain.update(f.camera, i);
    assert.deepEqual(snapshot(f.terrain), before);
    assert.deepEqual(
      buffers(f.terrain).map((a) => a.version),
      versions,
    );
    assert.equal(f.terrain.ocean.time.value, 29);
  } finally {
    f.dispose();
  }
});

test('camera movement, rotation and projection changes refresh land and sea', () => {
  const f = terrainFixture();
  try {
    f.terrain.update(f.camera, 1);
    let updates = Number(f.terrain.world.canvas.dataset.terrainUpdates);
    for (const change of [
      () => {
        f.camera.position.x += 5;
      },
      () => {
        f.camera.rotation.y += 0.4;
      },
      () => {
        f.camera.fov = 65;
        f.camera.updateProjectionMatrix();
      },
    ]) {
      change();
      f.camera.updateMatrixWorld(true);
      f.terrain.update(f.camera, ++updates);
      assert.equal(Number(f.terrain.world.canvas.dataset.terrainUpdates), updates);
    }
  } finally {
    f.dispose();
  }
});

test('new and removed chunks invalidate a stationary view inside the cull interval', () => {
  const f = terrainFixture();
  try {
    f.terrain.update(f.camera, 1);
    const original = snapshot(f.terrain);
    const chunk = [...f.terrain.chunks.values()].find(
      (c) => !c.bankMeshes.length && c.distance < 50,
    );
    assert.ok(chunk);
    f.terrain.nextPlan = Infinity;
    f.terrain.desired = f.terrain.desired.filter((c) => c.key !== chunk.key);
    f.terrain.removeChunk(chunk);
    f.terrain.chunks.delete(chunk.key);
    f.terrain.update(f.camera, 1.001);
    assert.equal(Number(f.terrain.world.canvas.dataset.terrainUpdates), 2);
    f.terrain.admit(chunk);
    f.terrain.update(f.camera, 1.002);
    assert.equal(Number(f.terrain.world.canvas.dataset.terrainUpdates), 3);
    // Admission restores the drawable chunk even before the normal 100 ms gate.
    assert.equal(f.terrain.chunks.size, original.chunks.length);
    assert.ok(buffers(f.terrain).some((a) => a.version >= 3));
  } finally {
    f.dispose();
  }
});

test('stationary planning retains active assets and still evicts unused regions after 12 seconds', () => {
  const f = terrainFixture();
  try {
    const released = [];
    f.terrain.assets.releaseEnvironment = (key) => released.push(key);
    f.terrain.lastUsed.set('unused-region', 0);
    for (const time of [1, 6, 11, 13, 30])
      f.terrain.plan(f.camera.position.x, f.camera.position.z, time);
    assert.deepEqual(released, ['unused-region']);
    for (const lastUsed of f.terrain.lastUsed.values()) assert.equal(lastUsed, 30);
  } finally {
    f.dispose();
  }
});

test('a late region load is admitted with a stationary camera', async () => {
  const f = terrainFixture();
  try {
    const chunk = [...f.terrain.chunks.values()].find(
      (c) => !c.bankMeshes.length && c.distance < 50,
    );
    const template = f.terrain.assets.templates.get(chunk.assetKey);
    f.terrain.removeChunk(chunk);
    f.terrain.chunks.delete(chunk.key);
    f.terrain.assets.templates.delete(chunk.assetKey);
    let finish;
    f.terrain.assets.ensureEnvironment = () =>
      new Promise((resolve) => {
        finish = resolve;
      });
    f.terrain.update(f.camera, 1);
    const updates = Number(f.terrain.world.canvas.dataset.terrainUpdates);
    assert.ok(!f.terrain.chunks.has(chunk.key));
    f.terrain.assets.templates.set(chunk.assetKey, template);
    finish();
    await Promise.all(f.terrain.pending.values());
    f.terrain.update(f.camera, 1.001);
    assert.ok(f.terrain.chunks.has(chunk.key));
    assert.ok(Number(f.terrain.world.canvas.dataset.terrainUpdates) > updates);
  } finally {
    f.dispose();
  }
});
