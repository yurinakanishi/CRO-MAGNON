import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createHash } from 'node:crypto';
import { WorldAssets } from '../dist/src/world-assets.js';

const record = (key) => ({ modelKey: key, environment: true, onDemand: true, lods: [] });
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => (resolve = done));
  return { promise, resolve };
};
const model = (texture = null) => {
  const scene = new THREE.Group();
  scene.add(
    new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ map: texture })),
  );
  return { scene };
};

test('disposal rejects queued environments before unfinished downloads complete', async () => {
  const pending = [deferred(), deferred()];
  let calls = 0;
  const assets = new WorldAssets({ loadEnvironment: () => pending[calls++].promise });
  assets.catalog = { assets: ['a', 'b', 'queued'].map(record) };
  const all = Promise.allSettled(['a', 'b', 'queued'].map((key) => assets.ensureEnvironment(key)));
  const queued = assets.ensureEnvironment('queued');
  let rejected = false;
  queued.catch(() => (rejected = true));
  assets.dispose();
  await Promise.resolve();
  await Promise.resolve();
  const rejectedBeforeCompletion = rejected;
  for (const work of pending) work.resolve(model());
  await all;
  assert.equal(
    rejectedBeforeCompletion,
    true,
    'queued cancellation cannot depend on network completion',
  );
  assert.equal(calls, 2);
  assert.equal(assets.environmentQueue.length, 0);
  assert.equal(assets.environmentLoads.size, 0);
  assert.equal(assets.templates.size, 0);
});

test('shared LOD texture and shared bitmap are each released once on eviction and shutdown', () => {
  for (const operation of ['evict', 'shutdown']) {
    const assets = new WorldAssets();
    let closed = 0,
      disposed = 0;
    const bitmap = { close: () => closed++ };
    const texture = new THREE.Texture(bitmap);
    const secondTexture = new THREE.Texture(bitmap);
    texture.addEventListener('dispose', () => disposed++);
    secondTexture.addEventListener('dispose', () => disposed++);
    assets.templates.set('ground', {
      asset: record('ground'),
      gltf: model(texture),
      lods: [model(texture), model(secondTexture)],
    });
    if (operation === 'evict') assets.releaseEnvironment('ground');
    else assets.dispose();
    assets.dispose();
    assert.equal(disposed, 2, `${operation}: each texture is disposed once`);
    assert.equal(closed, 1, `${operation}: shared ImageBitmap is closed once`);
  }
});

test('evicting an environment invalidates its surface material cache before reloading', () => {
  const assets = new WorldAssets();
  let disposed = 0;
  assets.templates.set('ground', { asset: record('ground'), gltf: model(), lods: [] });
  assets.surfaceTemplates.set('ground:snow', {
    asset: record('ground'),
    dispose: () => disposed++,
  });
  assets.releaseEnvironment('ground');
  const remaining = assets.surfaceTemplates.size;
  assets.dispose();
  assert.equal(
    remaining,
    0,
    'a reloaded environment must not reuse a material pointing at a closed bitmap',
  );
  assert.equal(disposed, 1);
});

test('a disposed asset provider does not start new enemy or equipment loads', async () => {
  const assets = new WorldAssets();
  assets.dispose();
  assert.equal(await assets.createEnemy('crow-shaman'), null);
  assert.equal(await assets.createEquipment('wooden-spear'), null);
  assert.equal(assets.enemyLoads.size, 0);
  assert.equal(assets.equipmentLoads.size, 0);
});

test('shutdown stops the initial loading workers before remaining models and LODs start', async (t) => {
  const json = JSON.stringify({
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [] }],
    nodes: [],
  });
  const length = Math.ceil(Buffer.byteLength(json) / 4) * 4;
  const bytes = Buffer.alloc(20 + length, 0x20);
  bytes.writeUInt32LE(0x46546c67, 0);
  bytes.writeUInt32LE(2, 4);
  bytes.writeUInt32LE(bytes.length, 8);
  bytes.writeUInt32LE(length, 12);
  bytes.writeUInt32LE(0x4e4f534a, 16);
  bytes.write(json, 20);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const catalog = {
    status: 'ready',
    assets: ['a', 'b', 'c', 'd'].map((key) => ({
      modelKey: key,
      url: `/${key}.glb`,
      bytes: bytes.length,
      sha256,
      lods: [{ url: `/${key}-lod.glb`, bytes: bytes.length, sha256 }],
    })),
  };
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'location');
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: { origin: 'http://asset.test' },
  });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'location', previous);
    else delete globalThis.location;
  });
  const requests = [],
    pending = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (String(url) === '/models/world-assets.json') return Response.json(catalog);
    requests.push(new URL(url).pathname);
    if (requests.length > 3) return new Response(bytes);
    const work = deferred();
    pending.push(work);
    await work.promise;
    return new Response(bytes);
  });
  const assets = new WorldAssets(),
    loading = assets.load();
  while (pending.length < 3) await new Promise(setImmediate);
  assets.dispose();
  for (const work of pending) work.resolve();
  await loading;
  assert.deepEqual(requests, ['/a.glb', '/b.glb', '/c.glb']);
  assert.equal(assets.templates.size, 0);
});
