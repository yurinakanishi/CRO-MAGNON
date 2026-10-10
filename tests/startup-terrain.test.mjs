import test from 'node:test';
import assert from 'node:assert/strict';
import { StartupTerrain } from '../dist/src/startup-terrain.js';

const settle = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function world() {
  return { disposed: false, failed: false, worldAssets: { templates: new Map() } };
}
function install(world, ...keys) {
  for (const key of keys) world.worldAssets.templates.set(key, {});
}

test('terrain starts on its exact dependencies while an unrelated prop is still absent', async () => {
  const w = world(),
    job = deferred();
  let calls = 0,
    finished = false;
  const terrain = new StartupTerrain(w, ['meadow', 'snow', 'meadow'], async () => {
    calls++;
    await job.promise;
  });
  terrain.done.then(() => {
    finished = true;
  });
  install(w, 'meadow', 'river-water', 'wood-footbridge');
  terrain.poll();
  await settle();
  assert.equal(calls, 0, 'every ground that arrival needs must exist');
  install(w, 'snow');
  terrain.poll();
  terrain.poll();
  await settle();
  assert.equal(calls, 1);
  assert.equal(w.worldAssets.templates.has('tent'), false);
  assert.equal(finished, false, 'arrival still waits for terrain preparation');
  job.resolve();
  await terrain.done;
  terrain.poll(true);
  assert.equal(calls, 1);
});

test('a missing bridge or ground at the end of verified downloads rejects explicitly', async () => {
  const w = world();
  install(w, 'meadow', 'river-water');
  const terrain = new StartupTerrain(w, ['meadow'], async () => assert.fail('must not build'));
  terrain.poll(true);
  await assert.rejects(terrain.done, /Missing verified terrain dependencies wood-footbridge/);
});

test('terrain failures reject immediately without waiting for unrelated downloads', async () => {
  for (const synchronous of [false, true]) {
    const w = world(),
      job = deferred();
    install(w, 'meadow', 'river-water', 'wood-footbridge');
    const terrain = new StartupTerrain(w, ['meadow'], () => {
      if (synchronous) throw new Error('terrain failed');
      return job.promise;
    });
    terrain.poll();
    await settle();
    if (!synchronous) job.reject(new Error('terrain failed'));
    await assert.rejects(terrain.done, /terrain failed/);
    terrain.dispose();
  }
});

test('leaving before readiness or in the queued microtask never starts terrain work', async () => {
  for (const ready of [false, true]) {
    const w = world();
    if (ready) install(w, 'meadow', 'river-water', 'wood-footbridge');
    const terrain = new StartupTerrain(w, ['meadow'], async () => assert.fail('left world built'));
    terrain.poll();
    terrain.dispose();
    await terrain.done;
    await settle();
  }
});

test('leaving during terrain work releases its worker owner once and ignores a late failure', async () => {
  const w = world(),
    job = deferred();
  install(w, 'meadow', 'river-water', 'wood-footbridge');
  let stopped,
    releases = 0;
  const terrain = new StartupTerrain(w, ['meadow'], async (cancelled) => {
    stopped = cancelled;
    w.openWorld = {
      disposed: false,
      dispose() {
        this.disposed = true;
        releases++;
      },
    };
    await job.promise;
    assert.equal(cancelled(), false, 'never continue assembling a left world');
  });
  terrain.poll();
  await settle();
  assert.equal(stopped(), false);
  terrain.dispose();
  terrain.dispose();
  await terrain.done;
  assert.equal(stopped(), true);
  assert.equal(releases, 1);
  job.reject(new Error('late worker reply'));
  await settle();
});
