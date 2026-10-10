import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { geometryScene } from '../scripts/measure-collision-bounds.mjs';
import { LOAD_TIER, LoadTicket } from '../dist/src/asset-load-queue.js';
import { criticalStartup } from '../dist/src/startup-plan.js';
import { StartupTerrain } from '../dist/src/startup-terrain.js';
import { WorldAssets } from '../dist/src/world-assets.js';
import { WorldRenderer } from '../dist/src/world3d.js';
import {
  LANDMARK_PLACEMENTS,
  StartupMountainFit,
  WorldLandmarks,
} from '../dist/src/world-landmarks.js';
import { fitSourceRiverBank } from '../dist/src/source-surface-fit.js';
import { collectGpuResources } from '../dist/src/context-recovery.js';
import { CAMP_MOUNTAIN } from '../dist/shared/camp-cave-layout.mjs';
import { CAMP_SPAWN, SPAWN_SITES } from '../dist/shared/spawn-sites.mjs';

const FAILED = '検証済みの3D素材を読み込めませんでした。再読み込みしてください。';
const settle = () => new Promise((resolve) => setImmediate(resolve));

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

/** A model key from a verified record ('/key.glb', '/key-lod.glb'). */
const keyOf = (record) => record.url.slice(1).replace(/(-lod)?\.glb$/, '');

/** A small verified-like scene: one source mesh. */
function model() {
  const scene = new THREE.Group();
  scene.add(
    new THREE.Mesh(
      new THREE.PlaneGeometry(32, 32).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial(),
    ),
  );
  return { scene };
}

/** A delayed loader: every download waits until the test answers it. */
function gate() {
  const calls = [];
  return {
    calls,
    load: (record) => {
      const call = { record, done: false, ...deferred() };
      calls.push(call);
      return call.promise;
    },
    keys: () => calls.map((call) => keyOf(call.record)),
    open: () => calls.filter((call) => !call.done),
    answer(call) {
      call.done = true;
      call.resolve(model());
    },
    fail(key, error) {
      const call = calls.find((item) => !item.done && keyOf(item.record) === key);
      call.done = true;
      call.reject(error);
    },
  };
}

/** Answer every download as it is requested, except those of `hold`. */
async function drain(loads, hold = new Set()) {
  for (let round = 0; round < 200; round++) {
    const open = loads.open().filter((call) => !hold.has(keyOf(call.record)));
    if (!open.length) return;
    for (const call of open) loads.answer(call);
    await settle();
  }
  throw new Error('the startup set never finished requesting');
}

/** A worker that holds each job until the test answers it; `finish` returns the source
 * unchanged, as the fake in streaming-performance.test.mjs does. */
class HeldWorker {
  static made = [];
  sent = [];
  terminated = false;
  onmessage = null;
  onerror = null;
  onmessageerror = null;
  constructor() {
    HeldWorker.made.push(this);
  }
  postMessage(data) {
    this.sent.push(data);
  }
  terminate() {
    this.terminated = true;
  }
  finish(i = 0) {
    this.onmessage({ data: this.sent[i] });
  }
}

// The real worker (src/river-bank-worker.ts) rebuilds the transferred arrays, calls the same
// fitter and transfers the result back; the stand-in of adaptive-surface-fit.test.mjs.
class InlineWorker {
  onmessage = null;
  onerror = null;
  onmessageerror = null;
  postMessage(data, transfer) {
    const job = structuredClone(data, { transfer });
    queueMicrotask(() => {
      const source = new THREE.BufferGeometry();
      for (const [name, value] of Object.entries(job.attributes))
        source.setAttribute(
          name,
          new THREE.BufferAttribute(value.array, value.itemSize, value.normalized),
        );
      if (job.index) source.setIndex(new THREE.BufferAttribute(job.index, 1));
      if (job.groups) source.groups = job.groups;
      if (job.drawRange) source.drawRange = job.drawRange;
      const geometry = fitSourceRiverBank(source, job.maximumEdge, job.mountainOnly);
      const attributes = Object.fromEntries(
        Object.entries(geometry.attributes).map(([name, a]) => [
          name,
          { array: a.array, itemSize: a.itemSize, normalized: a.normalized },
        ]),
      );
      const index = geometry.index?.array;
      const buffers = Object.values(attributes).map((a) => a.array.buffer);
      if (index) buffers.push(index.buffer);
      const reply = structuredClone(
        { id: job.id, attributes, index, groups: geometry.groups, drawRange: geometry.drawRange },
        { transfer: [...new Set(buffers)] },
      );
      this.onmessage({ data: reply });
    });
  }
  terminate() {}
}

/** RiverBankBuilder's default worker is the global Worker: stand it in for one test. */
async function withWorker(Worker, run) {
  const previous = globalThis.Worker;
  globalThis.Worker = Worker;
  HeldWorker.made = [];
  try {
    return await run();
  } finally {
    if (previous === undefined) delete globalThis.Worker;
    else globalThis.Worker = previous;
  }
}

/** Run, then let late callbacks happen; no promise may be left rejected and unobserved. */
async function noUnhandled(run) {
  const unhandled = [];
  const listener = (reason) => unhandled.push(reason);
  process.on('unhandledRejection', listener);
  try {
    await run();
    await settle();
    await settle();
  } finally {
    process.off('unhandledRejection', listener);
  }
  assert.deepEqual(unhandled, []);
}

const planAt = (point) =>
  WorldRenderer.prototype.planStartup.call({ focus: new THREE.Vector3(point.x, 0, point.z) });

/** A world as initializeWorld sees it at a camp arrival, with every record of its set (the
 * mountain with its one LOD) and a held prop of the local character. */
function startupWorld() {
  const plan = planAt(CAMP_SPAWN);
  const loads = gate();
  const assets = new WorldAssets({ loadEnvironment: loads.load });
  const record = (modelKey, kind = 'static', lods = []) => ({
    modelKey,
    kind,
    url: `/${modelKey}.glb`,
    bytes: 1,
    lods,
  });
  assets.catalog = {
    status: 'ready',
    assets: [
      ...plan.keys.map((key) =>
        record(
          key,
          'static',
          key === CAMP_MOUNTAIN.key ? [{ url: `/${key}-lod.glb`, bytes: 1 }] : [],
        ),
      ),
      record('wooden-spear', 'equipment'),
    ],
  };
  const failures = [],
    progress = [];
  const world = {
    worldAssets: assets,
    focus: new THREE.Vector3(CAMP_SPAWN.x, 0, CAMP_SPAWN.z),
    disposed: false,
    loadingCave: null,
    canvas: { dataset: {} },
    loadProgress: new Proxy(
      { loaded: 0, total: 0, phase: 'download' },
      {
        set(target, key, value) {
          if (key === 'loaded') progress.push(value);
          target[key] = value;
          return true;
        },
      },
    ),
    planStartup: WorldRenderer.prototype.planStartup,
    failWorld: (message, error) => failures.push({ message, error }),
  };
  const run = () => WorldRenderer.prototype.initializeWorld.call(world);
  // This fixture holds only model/worker data, without a DOM or rendered world.
  // Keep the real dependency gate while replacing the unrelated terrain builder.
  world.startupTerrain = new StartupTerrain(world, plan.floorKeys, async () => {});
  return { plan, world, assets, loads, failures, progress, run };
}

/** WorldRenderer.destroy(), in its order, for what the startup holds. */
function shutDown(world) {
  world.disposed = true;
  world.startupFit?.dispose();
  world.startupTerrain?.dispose();
  world.worldAssets.dispose();
}

const firstMesh = (root) => {
  let found = null;
  root.traverse((node) => (found ??= node.isMesh ? node : null));
  return found;
};

test('every arrival requests the same critical set, the fitted mountain and the floor first', () => {
  for (const site of SPAWN_SITES) {
    const plan = planAt(site);
    const landmarkKeys = LANDMARK_PLACEMENTS.filter((item) =>
      plan.landmarkIds.includes(item.id),
    ).map((item) => item.key);
    const set = new Set([...plan.sceneryKeys, ...plan.floorKeys, ...landmarkKeys]);
    assert.equal(new Set(plan.keys).size, plan.keys.length, `${site.id}: a repeated key`);
    assert.deepEqual([...plan.keys].sort(), [...set].sort(), `${site.id}: another set`);
    const first = [
      ...new Set([...(plan.mountainLevels.length ? [CAMP_MOUNTAIN.key] : []), ...plan.floorKeys]),
    ];
    assert.deepEqual(plan.keys.slice(0, first.length), first, `${site.id}: request order`);
  }
  const camp = planAt(CAMP_SPAWN);
  assert.deepEqual(camp.mountainLevels, [0]);
  assert.deepEqual(camp.keys.slice(0, 3), [CAMP_MOUNTAIN.key, 'meadow-ground', 'snow-ground']);
});

test('without the mountain in view nothing goes ahead of the floor, and no key repeats', () => {
  const base = {
    focus: { x: 0, z: 0 },
    chunks: [
      { distance: 10, land: true, ground: 'meadow-ground' },
      { distance: 60, land: true, ground: 'snow-ground' },
      { distance: 90, land: true, ground: 'ice-ground' },
      { distance: 20, land: false, ground: 'desert-ground' },
    ],
    mountainKey: CAMP_MOUNTAIN.key,
    mountainLevel: 1,
  };
  const mountain = { id: 'mountain', key: CAMP_MOUNTAIN.key, x: 500, z: 0, clearance: 10 },
    castle = { id: 'castle', key: 'valley-castle', x: 30, z: 0, clearance: 10 };
  const away = criticalStartup({
    ...base,
    placements: [mountain, castle],
    sceneryKeys: ['river-water', 'snow-ground', 'valley-castle'],
  });
  assert.deepEqual(away.mountainLevels, []);
  assert.deepEqual(away.keys, ['meadow-ground', 'snow-ground', 'valley-castle', 'river-water']);
  const near = criticalStartup({
    ...base,
    placements: [{ ...mountain, x: 40 }, castle],
    sceneryKeys: ['river-water', CAMP_MOUNTAIN.key],
  });
  assert.deepEqual(near.mountainLevels, [1]);
  assert.deepEqual(near.keys, [
    CAMP_MOUNTAIN.key,
    'meadow-ground',
    'snow-ground',
    'valley-castle',
    'river-water',
  ]);
});

test('the reordered set keeps the essential tier first, loads each template once and the fit requests nothing', async () => {
  await withWorker(HeldWorker, () =>
    noUnhandled(async () => {
      const { plan, world, assets, loads, failures, progress, run } = startupWorld();
      const started = run();
      await settle();
      assert.deepEqual(loads.keys(), [CAMP_MOUNTAIN.key, 'meadow-ground']);
      // The local character's held prop, requested later, still starts next.
      const spear = assets.ensureEquipment('wooden-spear', LoadTicket.of(LOAD_TIER.essential));
      loads.answer(loads.calls[1]);
      await settle();
      assert.equal(loads.keys()[2], 'wooden-spear');
      // A later startup request for the mountain joins its running load.
      const before = assets.loadQueue.stats.started;
      const joined = assets.ensureInitial(CAMP_MOUNTAIN.key);
      assert.equal(assets.loadQueue.stats.started, before);
      await drain(loads, new Set([plan.keys.at(-1)]));
      // The mountain is in and fitting while the set still downloads.
      assert.equal(HeldWorker.made.length, 1);
      assert.equal(HeldWorker.made[0].sent.length, 1);
      assert.equal(loads.open().length, 1);
      assert.equal(await joined, assets.get(CAMP_MOUNTAIN.key));
      HeldWorker.made[0].finish();
      await world.startupFit.done;
      world.disposed = true; // This fake world cannot build the scene that follows.
      await drain(loads);
      assert.equal(await started, undefined);
      await spear;
      const urls = loads.calls.map((call) => call.record.url);
      assert.equal(new Set(urls).size, urls.length, 'a file was downloaded twice');
      assert.deepEqual(
        [...urls].sort(),
        [
          ...plan.keys.map((key) => `/${key}.glb`),
          `/${CAMP_MOUNTAIN.key}-lod.glb`,
          '/wooden-spear.glb',
        ].sort(),
      );
      assert.equal(assets.loadQueue.stats.started, plan.keys.length + 1);
      // Progress covers exactly the set: from 0, one step per template, up to its total.
      assert.equal(world.loadProgress.total, plan.keys.length + 1);
      assert.equal(progress.length, plan.keys.length + 1);
      assert.equal(progress[0], 0);
      assert.ok(progress.every((value, i) => i === 0 || value > progress[i - 1]));
      assert.equal(progress.at(-1), world.loadProgress.total);
      assert.deepEqual(failures, []);
      shutDown(world);
    }),
  );
});

test('the startup fit and every later prepareMountain share one job per level and never fit twice', async () => {
  await withWorker(HeldWorker, () =>
    noUnhandled(async () => {
      const template = { asset: {}, gltf: model(), lods: [model()] };
      const assets = { templates: new Map([[CAMP_MOUNTAIN.key, template]]) };
      const fit = new StartupMountainFit(assets, [0]);
      fit.poll();
      fit.poll(true);
      const landmarks = new WorldLandmarks({ worldAssets: assets, focus: null });
      const joined = [landmarks.prepareMountain([0]), landmarks.prepareMountain([0])];
      assert.equal(HeldWorker.made.length, 1);
      assert.equal(HeldWorker.made[0].sent.length, 1);
      assert.equal(landmarks.builders.size, 0, 'WorldLandmarks started no second fit');
      assert.equal(fit.builders.size, 1);
      const worker = HeldWorker.made[0];
      worker.finish();
      await Promise.all([fit.done, ...joined]);
      assert.deepEqual([...template.riverBed.prepared], [0]);
      assert.equal(template.riverBed.jobs.size, 0);
      assert.equal(worker.terminated, true, 'a finished fit releases its worker');
      assert.equal(fit.builders.size, 0);
      await landmarks.prepareMountain([0]);
      assert.equal(HeldWorker.made.length, 1, 'a fitted level is not fitted again');
      // Disposal after completion stops nothing and unmarks nothing.
      fit.dispose();
      assert.deepEqual([...template.riverBed.prepared], [0]);
      // Without a level in view nothing is fitted and nothing waits.
      const none = new StartupMountainFit(assets, []);
      none.poll();
      await none.done;
      assert.equal(HeldWorker.made.length, 1);
      landmarks.dispose();
    }),
  );
});

test('the startup fit leaves the delivered mountain exactly as WorldLandmarks.prepareMountain fits it', async () => {
  const asset = JSON.parse(await readFile('public/models/camp-mountain/asset.json', 'utf8'));
  const decode = async () => ({ asset, gltf: await geometryScene(`public${asset.url}`), lods: [] });
  const early = await decode(),
    later = await decode();
  const source = firstMesh(early.gltf.scene).geometry;
  await withWorker(InlineWorker, async () => {
    const fit = new StartupMountainFit({ templates: new Map([[CAMP_MOUNTAIN.key, early]]) }, [0]);
    fit.poll();
    await fit.done;
    const landmarks = new WorldLandmarks({
      worldAssets: { templates: new Map([[CAMP_MOUNTAIN.key, later]]) },
      focus: null,
    });
    await landmarks.prepareMountain([0]);
    landmarks.dispose();
    fit.dispose();
  });
  assert.deepEqual([...early.riverBed.prepared], [0]);
  assert.deepEqual([...later.riverBed.prepared], [0]);
  const meshes = (root) => {
    const list = [];
    root.traverse((node) => node.isMesh && list.push(node));
    return list;
  };
  const bytes = (array) => Buffer.from(array.buffer, array.byteOffset, array.byteLength);
  const a = meshes(early.gltf.scene),
    b = meshes(later.gltf.scene);
  assert.equal(a.length, b.length);
  assert.notEqual(a[0].geometry, source, 'the fit installed its own geometry');
  assert.ok(
    !bytes(a[0].geometry.attributes.position.array).equals(bytes(source.attributes.position.array)),
    'the river bed was actually fitted',
  );
  for (const [i, mesh] of a.entries()) {
    const x = mesh.geometry,
      y = b[i].geometry;
    assert.deepEqual(Object.keys(x.attributes).sort(), Object.keys(y.attributes).sort());
    for (const name of Object.keys(y.attributes)) {
      const p = x.attributes[name],
        q = y.attributes[name];
      assert.deepEqual(
        [p.itemSize, p.normalized, p.array.constructor.name],
        [q.itemSize, q.normalized, q.array.constructor.name],
        name,
      );
      assert.ok(bytes(p.array).equals(bytes(q.array)), `${name} differs`);
    }
    assert.equal(!x.index, !y.index);
    if (y.index) assert.ok(bytes(x.index.array).equals(bytes(y.index.array)), 'index differs');
    assert.deepEqual(x.groups, y.groups);
    assert.deepEqual(x.drawRange, y.drawRange);
  }
});

test('a failed early fit stops the startup at once, once, with the existing message', async () => {
  await withWorker(HeldWorker, () =>
    noUnhandled(async () => {
      const { plan, world, assets, loads, failures, run } = startupWorld();
      const outcome = run().then(
        () => 'resolved',
        (error) => error,
      );
      await settle();
      await drain(loads, new Set([plan.keys.at(-1)]));
      const template = assets.templates.get(CAMP_MOUNTAIN.key);
      HeldWorker.made[0].onerror();
      const error = await outcome;
      assert.match(String(error), /River bank worker failed/);
      assert.equal(loads.open().length, 1, 'the failure did not wait for the rest of the set');
      assert.deepEqual(
        failures.map((failure) => failure.message),
        [FAILED],
      );
      assert.equal(template.riverBed.prepared.size, 0);
      assert.equal(world.startupFit.builders.size, 0);
      shutDown(world);
      await drain(loads);
      assert.equal(failures.length, 1, 'no second failure');
    }),
  );
});

test('another startup failure stops a still-running early fit and reports once', async () => {
  await withWorker(HeldWorker, () =>
    noUnhandled(async () => {
      const { plan, world, assets, loads, failures, run } = startupWorld();
      const outcome = run().then(
        () => 'resolved',
        (error) => error,
      );
      await settle();
      await drain(loads, new Set([plan.keys.at(-1)]));
      const worker = HeldWorker.made[0],
        template = assets.templates.get(CAMP_MOUNTAIN.key),
        mesh = firstMesh(template.gltf.scene),
        source = mesh.geometry;
      loads.fail(plan.keys.at(-1), new Error('verification failed'));
      const error = await outcome;
      assert.match(String(error), /verification failed/);
      assert.equal(worker.terminated, true, 'the early fit does not outlive the failed startup');
      assert.deepEqual(
        failures.map((failure) => failure.message),
        [FAILED],
      );
      worker.finish(); // A late answer is ignored.
      await settle();
      assert.equal(template.riverBed.prepared.size, 0);
      assert.equal(mesh.geometry, source);
      shutDown(world);
      assert.equal(failures.length, 1);
    }),
  );
});

test('an early terrain failure ends world startup while another prop is still downloading', async () => {
  await withWorker(HeldWorker, () =>
    noUnhandled(async () => {
      const { plan, world, loads, failures, run } = startupWorld();
      world.startupTerrain = new StartupTerrain(world, plan.floorKeys, async () => {
        throw new Error('terrain preparation failed');
      });
      const outcome = run().catch((error) => error);
      await settle();
      await drain(loads, new Set([plan.keys.at(-1)]));
      assert.match(String(await outcome), /terrain preparation failed/);
      assert.equal(loads.open().length, 1);
      assert.equal(failures.length, 1);
      assert.equal(HeldWorker.made[0].terminated, true);
      shutDown(world);
      await drain(loads);
      assert.equal(failures.length, 1);
    }),
  );
});

test('another failed download cancels terrain preparation and prevents its late continuation', async () => {
  await withWorker(HeldWorker, () =>
    noUnhandled(async () => {
      const { plan, world, loads, failures, run } = startupWorld(),
        job = deferred();
      let cancelled,
        releases = 0,
        completed = false;
      world.startupTerrain = new StartupTerrain(world, plan.floorKeys, async (stopped) => {
        cancelled = stopped;
        world.openWorld = {
          disposed: false,
          dispose() {
            this.disposed = true;
            releases++;
          },
        };
        await job.promise;
        if (!stopped()) completed = true;
      });
      const outcome = run().catch((error) => error);
      await settle();
      await drain(loads, new Set([plan.keys.at(-1)]));
      assert.equal(cancelled(), false, 'terrain starts before the prop completes');
      loads.fail(plan.keys.at(-1), new Error('prop integrity failed'));
      assert.match(String(await outcome), /prop integrity failed/);
      assert.equal(releases, 1);
      assert.equal(cancelled(), true);
      job.resolve();
      await settle();
      assert.equal(completed, false);
      assert.equal(failures.length, 1);
      shutDown(world);
    }),
  );
});

test('shutdown before the mountain arrives starts no fit and reports nothing', async () => {
  await withWorker(HeldWorker, () =>
    noUnhandled(async () => {
      const { world, loads, failures, run } = startupWorld();
      const started = run();
      await settle();
      assert.deepEqual(loads.keys(), [CAMP_MOUNTAIN.key, 'meadow-ground']);
      shutDown(world);
      await drain(loads); // Downloads already running still arrive.
      assert.equal(await started, undefined);
      await world.startupFit.done;
      assert.equal(HeldWorker.made.length, 0);
      assert.deepEqual(failures, []);
    }),
  );
});

test('shutdown during the worker fit terminates it, marks nothing and reports nothing', async () => {
  await withWorker(HeldWorker, () =>
    noUnhandled(async () => {
      const { plan, world, assets, loads, failures, run } = startupWorld();
      const started = run();
      await settle();
      await drain(loads, new Set([plan.keys.at(-1)]));
      const worker = HeldWorker.made[0],
        template = assets.templates.get(CAMP_MOUNTAIN.key),
        mesh = firstMesh(template.gltf.scene),
        source = mesh.geometry;
      // A lost context's release walk reaches the running fit without disturbing it.
      collectGpuResources([world]);
      assert.equal(worker.terminated, false);
      shutDown(world);
      assert.equal(worker.terminated, true);
      worker.finish(); // A late answer is ignored.
      await drain(loads);
      assert.equal(await started, undefined);
      await world.startupFit.done;
      assert.equal(template.riverBed.prepared.size, 0);
      assert.equal(mesh.geometry, source);
      assert.deepEqual(failures, []);
    }),
  );
});
