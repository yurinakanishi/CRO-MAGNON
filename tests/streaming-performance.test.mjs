import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { RiverBankBuilder } from '../dist/src/river-bank-builder.js';
import { VisibleActorGroup } from '../dist/src/visible-actor-group.js';
import { terrainFixture } from '../scripts/benchmark-terrain.mjs';

function fakeWorker() {
  return {
    sent: [],
    terminated: false,
    postMessage(data, transfers) {
      this.sent.push({ data, transfers });
    },
    terminate() {
      this.terminated = true;
    },
    finish(i = 0) {
      const { data } = this.sent[i];
      this.onmessage({ data });
    },
  };
}
const source = () => new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);

test('bank construction serializes jobs and transfers only private geometry buffers', async () => {
  const worker = fakeWorker(),
    builder = new RiverBankBuilder(() => worker);
  const template = source(),
    a = template.clone(),
    b = template.clone();
  const first = builder.build(a),
    second = builder.build(b);
  assert.equal(worker.sent.length, 1);
  assert.ok(worker.sent[0].transfers.includes(a.attributes.position.array.buffer));
  assert.ok(!worker.sent[0].transfers.includes(template.attributes.position.array.buffer));
  assert.ok(!worker.sent[0].data.attributes.normal, 'worker recomputes normals');
  worker.finish();
  const result = await first;
  assert.deepEqual(result.attributes.position.array, template.attributes.position.array);
  assert.equal(worker.sent.length, 2);
  worker.finish(1);
  (await second).dispose();
  result.dispose();
  template.dispose();
  builder.dispose();
});

test('leaving the world rejects in-flight and queued bank jobs and terminates the worker', async () => {
  const worker = fakeWorker(),
    builder = new RiverBankBuilder(() => worker);
  const a = source(),
    b = source();
  let disposed = 0;
  b.addEventListener('dispose', () => disposed++);
  const first = builder.build(a),
    second = builder.build(b);
  const checks = [assert.rejects(first, /disposed/), assert.rejects(second, /disposed/)];
  builder.dispose();
  await Promise.all(checks);
  assert.equal(worker.terminated, true);
  assert.equal(disposed, 1);
  assert.equal(worker.sent.length, 1);
  worker.finish(); // A late response cannot resurrect a cancelled job.
  await assert.rejects(builder.build(source()), /disposed/);
});

test('worker startup and execution failures reject their jobs instead of hanging scene readiness', async () => {
  const builder = new RiverBankBuilder(() => {
    throw new Error('startup failure');
  });
  await assert.rejects(builder.build(source()), /startup failure/);
  const worker = fakeWorker(),
    running = new RiverBankBuilder(() => worker);
  const first = running.build(source()),
    second = running.build(source());
  const checks = [assert.rejects(first, /worker failed/), assert.rejects(second, /worker failed/)];
  worker.onerror();
  await Promise.all(checks);
  assert.equal(worker.terminated, true);
});

test('completed bank jobs invalidate the view, but stale arrivals are disposed after departure', async () => {
  const f = terrainFixture();
  try {
    const bank = [...f.terrain.chunks.values()].find((c) => c.bankMeshes.length);
    assert.ok(bank);
    f.terrain.removeChunk(bank);
    f.terrain.chunks.delete(bank.key);
    const waiting = [];
    f.terrain.bankBuilder = {
      build(input) {
        input.dispose();
        return new Promise((resolve) => waiting.push(resolve));
      },
      dispose() {},
    };
    f.terrain.admit(bank);
    f.terrain.admit(bank);
    assert.equal(waiting.length, 1, 'one build per chunk');
    assert.ok(!f.terrain.chunks.has(bank.key));
    waiting.shift()(source());
    await Promise.all(f.terrain.bankJobs.values());
    assert.ok(f.terrain.chunks.has(bank.key));
    f.terrain.update(f.camera, 1);
    assert.ok(f.terrain.world.canvas.dataset.terrainUpdates);
    f.terrain.removeChunk(f.terrain.chunks.get(bank.key));
    f.terrain.chunks.delete(bank.key);
    f.terrain.admit(bank);
    f.terrain.desiredKeys.delete(bank.key);
    const stale = source();
    let disposed = false;
    stale.addEventListener('dispose', () => (disposed = true));
    waiting.shift()(stale);
    await Promise.all(f.terrain.bankJobs.values());
    assert.equal(disposed, true);
    assert.ok(!f.terrain.chunks.has(bank.key));
  } finally {
    f.dispose();
  }
});

test('hidden actor skeletons skip render traversal and return with current transforms', () => {
  const scene = new THREE.Scene();
  scene.matrixAutoUpdate = false;
  const actor = new VisibleActorGroup(),
    bone = new THREE.Bone();
  actor.add(bone);
  scene.add(actor);
  scene.updateMatrixWorld();
  let updates = 0;
  const update = bone.updateMatrixWorld;
  bone.updateMatrixWorld = function (...args) {
    updates++;
    return update.apply(this, args);
  };
  actor.visible = false;
  actor.position.x = 8;
  bone.position.y = 2;
  for (let i = 0; i < 60; i++) scene.updateMatrixWorld();
  assert.equal(updates, 0);
  // Anchors queried explicitly by attachments remain correct, even hidden.
  assert.deepEqual(bone.getWorldPosition(new THREE.Vector3()).toArray(), [8, 2, 0]);
  actor.position.z = 4;
  actor.visible = true;
  scene.updateMatrixWorld();
  assert.equal(updates, 1);
  assert.deepEqual(bone.getWorldPosition(new THREE.Vector3()).toArray(), [8, 2, 4]);
  actor.visible = false;
  actor.updateMatrixWorld(true);
  assert.equal(updates, 2);
});
