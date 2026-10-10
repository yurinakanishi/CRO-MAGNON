import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import {
  AssetLoadQueue,
  LOAD_TIER,
  LoadDemand,
  LoadTicket,
  isLoadCancelled,
  loadPriority,
} from '../dist/src/asset-load-queue.js';
import { STARTUP, landmarkPriority, terrainPriority } from '../dist/src/startup-plan.js';
import { WorldAssets } from '../dist/src/world-assets.js';
import { OpenWorldTerrain } from '../dist/src/open-world.js';
import { WorldRenderer } from '../dist/src/world3d.js';
import { RegionalScenery, regionalId } from '../dist/src/regional-scenery.js';
import { LoadingCave } from '../dist/src/loading-cave.js';
import { CharacterAssets } from '../dist/src/character-assets.js';
import { ActorResidency } from '../dist/src/actor-residency.js';
import { BIOMES, biomeById, chunkDescription, nearbyChunks } from '../dist/shared/biomes.mjs';
import { WORLD, CAMP, NPC } from '../dist/shared/world.mjs';
import { CAMP_SPAWN, spawnSite } from '../dist/shared/spawn-sites.mjs';
import { CASTLE } from '../dist/shared/castle-layout.mjs';
import { campMountainVisualLod } from '../dist/shared/camp-cave-layout.mjs';
import { CollisionWorld } from '../dist/shared/collision.mjs';
import { deliveredWomanRig } from './cro-magnon-woman-rig.mjs';
import { caveGalleryImages, caveImageNetwork } from './camp-cave-fixture.mjs';

const settle = () => new Promise((resolve) => setImmediate(resolve));

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

/** A model key from a verified record ('/key.glb', '/key-lod.glb') or a manifest URL. */
const keyOf = (record) =>
  typeof record === 'string' ? record : record.url.slice(1).replace(/(-lod)?\.glb$/, '');

/** A delayed loader: every call waits until the test settles it. */
function gate() {
  const calls = [];
  return {
    calls,
    load: (record) => {
      const call = { record, ...deferred() };
      calls.push(call);
      return call.promise;
    },
    keys: () => calls.map((call) => keyOf(call.record)),
  };
}

/** A small verified-like scene: a 32 m ground tile. */
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

const record = (modelKey, kind, bytes, extra = {}) => ({
  modelKey,
  kind,
  url: `/${modelKey}.glb`,
  bytes,
  lods: [],
  ...extra,
});

let land;
/** Every land chunk of the real map with its ground, indexed by chunk cell. */
function landGrid() {
  if (land) return land;
  land = new Map();
  const nx = Math.round((WORLD.maxX - WORLD.minX) / WORLD.chunkSize),
    nz = Math.round((WORLD.maxZ - WORLD.minZ) / WORLD.chunkSize);
  for (let ix = 0; ix < nx; ix++)
    for (let iz = 0; iz < nz; iz++) {
      const chunk = chunkDescription(ix, iz);
      if (chunk.land)
        land.set(`${ix},${iz}`, {
          ix,
          iz,
          x: chunk.x,
          z: chunk.z,
          ground: biomeById(chunk.biome).ground,
        });
    }
  return land;
}

/** Grounds of land chunks whose centre lies within `radius` of `cell`. */
function groundsNear(cell, radius) {
  const span = Math.ceil(radius / WORLD.chunkSize) + 1,
    out = new Set();
  for (let dx = -span; dx <= span; dx++)
    for (let dz = -span; dz <= span; dz++) {
      const other = landGrid().get(`${cell.ix + dx},${cell.iz + dz}`);
      if (other && Math.hypot(other.x - cell.x, other.z - cell.z) <= radius) out.add(other.ground);
    }
  return out;
}

/** An arrival whose floor radius holds one set of grounds while its 128 m plan
 * adds another: found on the real map rather than assumed. */
function borderArrival() {
  for (const cell of landGrid().values()) {
    const near = groundsNear(cell, STARTUP.floorRadius);
    const far = [...groundsNear(cell, 128)].filter((ground) => !near.has(ground));
    if (near.size && far.length) return { ...cell, near: [...near], far };
  }
  return null;
}

/** A distant arrival lacking at least one of `absent` within 200 m (beyond any
 * retained radius), whose floor holds a ground other than `other`. */
function distantArrival(origin, absent, other) {
  for (const cell of landGrid().values()) {
    if (Math.hypot(cell.x - origin.x, cell.z - origin.z) < 600) continue;
    const near = groundsNear(cell, STARTUP.floorRadius),
      around = groundsNear(cell, 200);
    if (absent.some((key) => !around.has(key)) && [...near].some((key) => key !== other))
      return { ...cell, near: [...near], around };
  }
  return null;
}

/** Terrain over the real map, with every biome ground as a verified record. */
function terrainWorld(loadEnvironment) {
  const failures = [];
  const assets = new WorldAssets({ loadEnvironment });
  assets.catalog = {
    assets: BIOMES.map((biome) =>
      record(biome.ground, 'terrain', 1000, {
        environment: true,
        onDemand: true,
        placement: { surfaceHeightMetres: 0 },
      }),
    ),
  };
  const world = {
    scene: new THREE.Scene(),
    worldAssets: assets,
    canvas: { dataset: {} },
    updateAssetDiagnostics() {},
    failWorld: (message, error) => failures.push(error ?? new Error(message)),
  };
  // Synchronous CPU bank fits; browsers use the worker.
  const terrain = new OpenWorldTerrain(world, null);
  const coast = new THREE.DataTexture(),
    biomes = new THREE.DataTexture();
  terrain.earthTextures = {
    coast,
    biomes,
    dispose() {
      coast.dispose();
      biomes.dispose();
    },
  };
  return {
    terrain,
    assets,
    failures,
    dispose() {
      terrain.dispose();
      assets.dispose();
    },
  };
}

let rigSource;
/** The delivered Cro-Magnon rig (hands, grips and poses need its real bones): its primary
 * and LOD, or after the r04 adoption its sole primary with no LOD. */
async function rigTemplate() {
  rigSource ??= deliveredWomanRig();
  const { primary, lod, asset } = await rigSource;
  return {
    gltf: { scene: cloneSkeleton(primary.scene), animations: primary.animations },
    lod: lod && { scene: cloneSkeleton(lod.scene) },
    asset,
  };
}

function element() {
  return {
    style: {},
    dataset: {},
    hidden: false,
    disabled: false,
    textContent: '',
    innerHTML: '',
    value: 0,
    classList: { add() {}, remove() {}, toggle() {} },
    append() {},
    remove() {},
    setAttribute() {},
    addEventListener() {},
    setPointerCapture() {},
    querySelector: () => element(),
    // The gallery's preview lettering draws into a 2D canvas.
    getContext: () => new Proxy({}, { get: () => () => {}, set: () => true }),
  };
}

/** Browser globals for the gallery; restored after the test. Its ten images pass the
 * game's verified download and decoder over a stand-in network and image element:
 * each visit gets `images: caveImageNetwork().options` (camp-cave-fixture.mjs). */
function installGalleryDom(t) {
  const values = {
    document: {
      hidden: false,
      hasFocus: () => false,
      createElement: element,
      body: { classList: { add() {}, remove() {} } },
      addEventListener() {},
    },
    window: { addEventListener() {} },
    requestAnimationFrame: (callback) => setImmediate(() => callback(0)),
  };
  for (const [key, value] of Object.entries(values)) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    t.after(() =>
      previous ? Object.defineProperty(globalThis, key, previous) : delete globalThis[key],
    );
  }
}

/** The gallery's view of the world: the verified cave and the character providers. */
function galleryWorld(humanAssets) {
  const cave = () => {
    const scene = new THREE.Group();
    scene.add(new THREE.Mesh(new THREE.BoxGeometry(30, 6, 80), new THREE.MeshStandardMaterial()));
    return scene;
  };
  return {
    canvas: { parentElement: element(), dataset: {} },
    worldAssets: {
      loadCatalog: async () => ({ assets: [] }),
      ensureInitial: async () => ({ asset: caveGalleryImages() }),
      create: cave,
    },
    humanAssets,
    renderer: {
      getContext: () => ({ isContextLost: () => false }),
      compile: () => new Set(),
      properties: { get: () => ({}) },
      extensions: { has: () => false },
      render() {},
      capabilities: { getMaxAnisotropy: () => 1 },
    },
    collision: new CollisionWorld(),
    camera: { aspect: 1 },
    loadProgress: { phase: 'download', loaded: 0, total: 0 },
  };
}

/** Held props and the torch wood every player actor attaches. */
function propAssets() {
  const assets = new WorldAssets();
  const prop = () => {
    const scene = new THREE.Group();
    scene.add(
      new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.6, 0.05), new THREE.MeshStandardMaterial()),
    );
    return { scene };
  };
  for (const key of ['stone-axe', 'wooden-spear', 'obsidian-spear'])
    assets.templates.set(key, {
      gltf: prop(),
      lods: [],
      asset: { modelKey: key, kind: 'equipment' },
    });
  assets.templates.set('firewood-log', {
    gltf: prop(),
    lods: [prop()],
    asset: { modelKey: 'firewood-log', kind: 'prop' },
  });
  return assets;
}

test('the local floor outranks every streamed actor but the self; fogged ground and landmarks wait last', () => {
  assert.equal(terrainPriority(0), loadPriority(LOAD_TIER.essential, 0));
  assert.ok(terrainPriority(STARTUP.floorRadius) < loadPriority(LOAD_TIER.initial));
  assert.ok(terrainPriority(STARTUP.floorRadius + 1) > loadPriority(LOAD_TIER.near, 40));
  assert.ok(terrainPriority(STARTUP.visibleRadius) < loadPriority(LOAD_TIER.visible));
  assert.ok(terrainPriority(STARTUP.visibleRadius + 1) >= loadPriority(LOAD_TIER.prefetch));
  assert.equal(landmarkPriority(-20), loadPriority(LOAD_TIER.near), 'standing inside a footprint');
  assert.ok(landmarkPriority(STARTUP.viewRadius + 1) >= loadPriority(LOAD_TIER.scene));
  assert.ok(landmarkPriority(STARTUP.fogFar + 1) >= loadPriority(LOAD_TIER.prefetch));
  const demand = new LoadDemand(),
    started = [];
  demand.update(
    new Map([
      ['a', 5],
      ['b', 9],
    ]),
    (key, ticket) => started.push([key, ticket]),
  );
  const [[, a], [, b]] = started;
  demand.update(new Map([['b', 2]]), (key, ticket) => started.push([key, ticket]));
  assert.ok(a.released && !b.released, 'an unwanted key is withdrawn');
  assert.equal(b.priority, 2, 'a held key is reprioritized, not requested again');
  assert.equal(started.length, 2);
  demand.settle('b', b);
  demand.update(new Map([['b', 3]]), (key, ticket) => started.push([key, ticket]));
  assert.equal(started.length, 3, 'a settled key is requested again when wanted');
  demand.clear();
  assert.ok(started[2][1].released);
  assert.equal(demand.size, 0);
});

test('the camp arrival needs its floor, camp scenery and framing landmarks, not the herd, boats, castle or far ground', () => {
  const plan = WorldRenderer.prototype.planStartup.call({
    focus: new THREE.Vector3(CAMP_SPAWN.x, 0, CAMP_SPAWN.z),
  });
  for (const key of [
    'meadow-ground',
    'camp-mountain',
    'camp-cave',
    'river-water',
    'wood-footbridge',
    'valley-pine',
    'valley-boulder',
    'berry-bush',
    'hide-tent',
    'drying-rack',
    'stone-firepit',
    'firewood-pile',
    'firewood-log',
    'stone-axe',
  ])
    assert.ok(plan.keys.includes(key), `${key} is needed on arrival`);
  for (const key of [
    'woolly-mammoth',
    'mammoth-meat',
    'dugout-canoe',
    'flint-spear',
    'valley-castle',
    'meadow-grass',
    'yellow-524-mascot',
    'rimo-neko',
    'orb-bot-white',
  ])
    assert.ok(!plan.keys.includes(key), `${key} streams after arrival`);
  assert.equal(new Set(plan.keys).size, plan.keys.length);
  assert.ok(plan.landmarkIds.includes('camp-mountain') && plan.landmarkIds.includes('camp-cave'));
  // The castle's footprint begins 86.6 m away: it streams right after arrival.
  assert.ok(
    Math.hypot(CASTLE.x - CAMP_SPAWN.x, CASTLE.z - CAMP_SPAWN.z) - CASTLE.clearance >
      STARTUP.viewRadius,
  );
  assert.ok(!plan.landmarkIds.includes(CASTLE.id));
  assert.deepEqual(plan.mountainLevels, [0], 'the camp sees the detailed mountain only');
  // The floor is exactly the grounds of the land chunks within the floor radius.
  const chunks = nearbyChunks(CAMP_SPAWN.x, CAMP_SPAWN.z, 128);
  const floor = new Set(
    chunks
      .filter((chunk) => chunk.land && chunk.distance <= STARTUP.floorRadius)
      .map((chunk) => biomeById(chunk.biome).ground),
  );
  assert.deepEqual([...floor].sort(), [...plan.floorKeys].sort());
  for (const chunk of chunks) {
    const ground = biomeById(chunk.biome).ground;
    if (chunk.land && !floor.has(ground) && !plan.sceneryKeys.includes(ground))
      assert.ok(!plan.keys.includes(ground), `${ground} beyond the floor radius streams`);
  }
});

test('a title start plans its chosen sight, and snapshots own the focus once joined', () => {
  const world = {
    focus: new THREE.Vector3(CAMP_SPAWN.x, 0, CAMP_SPAWN.z),
    selfId: null,
    disposed: false,
  };
  const site = spawnSite('castle');
  WorldRenderer.prototype.anticipateArrival.call(world, site);
  assert.equal(world.focus.x, site.x);
  assert.equal(world.focus.z, site.z);
  const plan = WorldRenderer.prototype.planStartup.call(world);
  assert.ok(plan.landmarkIds.includes(CASTLE.id), 'the castle frames this arrival');
  assert.ok(plan.keys.includes(CASTLE.key));
  assert.deepEqual(plan.mountainLevels, [campMountainVisualLod(site.x, site.z)]);
  world.selfId = 'self';
  WorldRenderer.prototype.anticipateArrival.call(world, CAMP_SPAWN);
  assert.equal(world.focus.x, site.x);
});

test('critical startup completes without requesting optional actors or waiting for a far region', async () => {
  const calls = [],
    blocked = new Set(['far-ground', 'far-ice']);
  const assets = new WorldAssets({
    loadEnvironment: (entry) => {
      calls.push(entry.url);
      return blocked.has(keyOf(entry)) ? new Promise(() => {}) : Promise.resolve(model());
    },
  });
  assets.catalog = {
    assets: [
      record('ground', 'terrain', 300),
      record('tent', 'static', 200),
      record('mountain', 'static', 500, { lods: [{ url: '/mountain-lod.glb', bytes: 100 }] }),
      record('mammoth', 'quadruped', 9000),
      record('canoe', 'boat', 1300, { environment: true }),
      record('far-ground', 'terrain', 2000, { environment: true, onDemand: true }),
      record('far-ice', 'terrain', 2000, { environment: true, onDemand: true }),
    ],
  };
  // A far region already streaming holds a queue slot and never arrives.
  void assets.ensureEnvironment('far-ground', LoadTicket.of(LOAD_TIER.prefetch, 120));
  const progress = [];
  await assets.loadStartup(['ground', 'tent', 'mountain'], {
    onProgress: (loaded, total) => {
      progress.push([loaded, total]);
      // Streamed work requested during startup never extends its total.
      if (progress.length === 2) assets.ensureEnvironment('far-ice').catch(() => {});
    },
  });
  const total = 300 + 200 + 500 + 100;
  assert.deepEqual(progress[0], [0, total]);
  assert.deepEqual(progress.at(-1), [total, total]);
  assert.ok(
    progress.every(([, sum]) => sum === total),
    'progress covers the bounded set only',
  );
  for (const key of ['ground', 'tent', 'mountain']) assert.ok(assets.templates.has(key));
  assert.ok(
    !calls.some((url) => url.includes('mammoth') || url.includes('canoe')),
    'optional actors are not requested by startup',
  );
  assert.ok(calls.includes('/far-ground.glb') && !assets.templates.has('far-ground'));
  assert.ok(Number.isFinite(assets.loadMilliseconds));
  assets.dispose();
});

test('a required startup model that is missing or fails its integrity check stops startup', async () => {
  const assets = new WorldAssets({
    loadEnvironment: (entry) =>
      keyOf(entry) === 'tent'
        ? Promise.reject(new Error('integrity mismatch'))
        : Promise.resolve(model()),
  });
  assets.catalog = { assets: [record('ground', 'terrain', 300), record('tent', 'static', 200)] };
  await assert.rejects(assets.loadStartup(['ground', 'tent']), /integrity mismatch/);
  assert.ok(!assets.templates.has('tent'), 'no substitute is installed');
  await assert.rejects(
    assets.loadStartup(['ground', 'missing-floor']),
    /Missing verified model missing-floor/,
  );
  assets.dispose();
});

test('arrival holds only for its floor: a blocked far ground keeps streaming behind it', async () => {
  const arrival = borderArrival();
  assert.ok(arrival, 'some land arrival sees a second ground beyond its floor radius');
  const blocked = new Set(arrival.far);
  const { terrain, assets, failures, dispose } = terrainWorld((entry) =>
    blocked.has(keyOf(entry)) ? new Promise(() => {}) : Promise.resolve(model()),
  );
  try {
    await terrain.arrive(arrival);
    for (const key of arrival.near) assert.ok(assets.templates.has(key), `${key} floor`);
    for (const key of arrival.far) {
      assert.ok(!assets.templates.has(key));
      assert.ok(terrain.pending.has(key), `${key} keeps loading after arrival`);
    }
    assert.ok(terrain.chunks.size > 0, 'the nearest floor is drawn');
    for (const chunk of terrain.chunks.values()) {
      assert.ok(chunk.distance < STARTUP.admitRadius);
      assert.ok(assets.templates.has(chunk.assetKey));
    }
    assert.deepEqual(failures, []);
  } finally {
    dispose();
  }
});

test('a floor ground that fails its integrity check stops arrival visibly', async () => {
  const arrival = borderArrival();
  const failing = arrival.near[0];
  const { terrain, failures, dispose } = terrainWorld((entry) =>
    keyOf(entry) === failing
      ? Promise.reject(new Error('integrity mismatch'))
      : Promise.resolve(model()),
  );
  try {
    await assert.rejects(terrain.arrive(arrival), /integrity mismatch/);
    assert.equal(failures.length, 1);
    assert.match(failures[0].message, /integrity mismatch/);
  } finally {
    dispose();
  }
});

test('a warp withdraws the old region’s queued ground and loads the new floor first', async () => {
  const a = borderArrival();
  const loader = gate();
  const { terrain, assets, failures, dispose } = terrainWorld(loader.load);
  assets.loadQueue = new AssetLoadQueue(1, 1);
  try {
    terrain.plan(a.x, a.z, 0);
    assert.equal(loader.calls.length, 1, 'one slot');
    const first = keyOf(loader.calls[0].record);
    assert.ok(a.near.includes(first), 'the floor loads before anything farther');
    const queued = [...terrain.pending.keys()].filter((key) => key !== first);
    assert.ok(queued.length, 'farther ground waits in the queue');
    const b = distantArrival(a, queued, first);
    assert.ok(b, 'a distant arrival lacks some of that ground');
    const withdrawn = queued.filter((key) => !b.around.has(key));
    terrain.plan(b.x, b.z, 1);
    await settle();
    assert.ok(assets.loadQueue.stats.cancelled >= withdrawn.length);
    for (const key of withdrawn) {
      assert.ok(!terrain.pending.has(key), `${key} was withdrawn`);
      assert.ok(!terrain.demand.has(key));
    }
    loader.calls[0].resolve(model());
    await settle();
    assert.ok(b.near.includes(keyOf(loader.calls[1].record)), 'the new floor starts next');
    for (const key of withdrawn) assert.ok(!loader.keys().includes(key), `${key} never downloaded`);
    assert.deepEqual(failures, [], 'a withdrawn ground is not an asset failure');
  } finally {
    dispose();
  }
});

test('leaving and re-entering before a ground arrives reuses its one download', async () => {
  const a = borderArrival();
  const loader = gate();
  const { terrain, assets, failures, dispose } = terrainWorld(loader.load);
  assets.loadQueue = new AssetLoadQueue(1, 1);
  try {
    terrain.plan(a.x, a.z, 0);
    const first = keyOf(loader.calls[0].record);
    const b = distantArrival(a, [first], first);
    assert.ok(b);
    terrain.plan(b.x, b.z, 1);
    assert.ok(!terrain.demand.has(first), 'leaving withdraws it; the running load continues');
    terrain.plan(a.x, a.z, 2);
    assert.ok(terrain.demand.has(first) && terrain.pending.has(first));
    assert.equal(
      loader.keys().filter((key) => key === first).length,
      1,
      'the return joins the running load',
    );
    loader.calls[0].resolve(model());
    await settle();
    assert.ok(assets.templates.has(first));
    assert.ok(!terrain.pending.has(first) && !terrain.demand.has(first), 'settled exactly once');
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(a.x, 10, a.z);
    camera.updateMatrixWorld(true);
    for (let i = 0; i < 40; i++) terrain.update(camera, 2.1 + i * 0.01);
    assert.ok([...terrain.chunks.values()].some((chunk) => chunk.assetKey === first));
    for (const chunk of terrain.chunks.values())
      assert.ok(terrain.desiredKeys.has(chunk.key), 'only chunks around the arrival');
    assert.deepEqual(failures, []);
  } finally {
    dispose();
  }
});

test('an evicted berry bush withdraws its cluster load, never receives late clusters, and re-admission shows the current amount', async () => {
  const loader = gate();
  const assets = new WorldAssets({ loadEnvironment: loader.load });
  assets.catalog = { assets: [record('berry-cluster', 'prop', 300)] };
  assets.loadQueue = new AssetLoadQueue(1, 1);
  const bush = new THREE.Group();
  bush.add(
    new THREE.Mesh(
      new THREE.SphereGeometry(0.5, 12, 8).translate(0, 0.7, 0),
      new THREE.MeshStandardMaterial(),
    ),
  );
  assets.templates.set('berry-bush', {
    gltf: { scene: bush },
    lods: [],
    asset: { modelKey: 'berry-bush', heightMetres: 1.2 },
  });
  const failures = [],
    attachments = [];
  const world = Object.assign(Object.create(WorldRenderer.prototype), {
    worldAssets: assets,
    disposed: false,
    scene: new THREE.Scene(),
    resources: new Map(),
    failWorld: (message, error) => failures.push(error ?? new Error(message)),
  });
  world.attachBerryClusters = (...args) => {
    const attached = WorldRenderer.prototype.attachBerryClusters.apply(world, args);
    attachments.push(attached);
    return attached;
  };
  const regional = Object.assign(Object.create(RegionalScenery.prototype), {
    world,
    landscapes: new Map(),
    props: new Map(),
  });
  const resource = { id: 'regional-berry-1', type: 'berry', x: 0, z: 0, amount: 5, maxAmount: 5 };
  const admit = (current) => {
    const item = {
      model: assets.createResource('berry-bush'),
      key: 'berry-bush',
      surface: null,
      baseScale: 1,
      resource: current,
    };
    world.scene.add(item.model);
    world.resources.set(current.id, item);
    world.decorateResource(item, current);
    return item;
  };
  const evict = () => regional.evict(regionalId('berry-bush', null));
  // Another load holds the only slot, so the cluster load is still queued.
  const busy = deferred();
  assets.loadQueue.request('busy', () => busy.promise, LoadTicket.of(LOAD_TIER.essential));
  const first = admit(resource);
  const firstFruit = first.fruit;
  evict();
  await settle();
  assert.equal(assets.loadQueue.stats.cancelled, 1, 'the queued cluster load is withdrawn');
  assert.equal(first.fruit, null);
  assert.ok(!world.resources.has(resource.id));
  busy.resolve();
  await settle();
  assert.equal(loader.calls.length, 0, 'nothing was downloaded for the evicted bush');
  // Re-admitted, evicted while its load runs, then admitted again with less fruit.
  const second = admit({ ...resource, amount: 2 });
  const secondFruit = second.fruit;
  assert.equal(loader.calls.length, 1);
  evict();
  const third = admit({ ...resource, amount: 3 });
  loader.calls[0].resolve({
    scene: (() => {
      const scene = new THREE.Group();
      scene.add(
        new THREE.Mesh(
          new THREE.BoxGeometry(0.125, 0.125, 0.125).translate(0, 0.0625, 0),
          new THREE.MeshStandardMaterial(),
        ),
      );
      return scene;
    })(),
  });
  await Promise.all(attachments);
  assert.equal(firstFruit.children.length, 0);
  assert.equal(secondFruit.children.length, 0, 'an evicted bush never receives late clusters');
  assert.equal(third.fruit.children.length, 5, 'the current bush has every cluster');
  assert.deepEqual(
    third.fruit.children.map((cluster) => cluster.visible),
    [true, true, true, false, false],
    'and shows the current amount',
  );
  assert.equal(loader.calls.length, 1, 'one download serves every bush');
  assert.deepEqual(failures, [], 'withdrawn and discarded loads are not asset failures');
  assets.dispose();
});

test('companions, the herd and the camp NPC load by distance: owned and near first, far never, withdrawn when left', async () => {
  const loader = gate();
  const assets = new WorldAssets({ loadEnvironment: loader.load });
  assets.catalog = {
    assets: [
      ...['yellow-524-mascot', 'orb-bot-white', 'orb-bot-blue'].map((key) =>
        record(key, 'companion', 300),
      ),
      record('woolly-mammoth', 'quadruped', 9000),
      record('mammoth-meat', 'static', 600),
    ],
  };
  assets.loadQueue = new AssetLoadQueue(1, 1);
  const people = gate();
  const npcAssets = new CharacterAssets('/models/neanderthal-hunter/asset.json', {
    queue: assets.loadQueue,
    loadModel: people.load,
  });
  const installed = [],
    failures = [];
  const state = {
    players: [{ id: 'self', x: CAMP_SPAWN.x, z: CAMP_SPAWN.z }],
    resources: [],
    camp: CAMP,
    npc: NPC,
    // The herd and 524 are beyond actor range; one bot is the player's own.
    animals: [{ id: 'mammoth-1', x: CAMP_SPAWN.x, z: CAMP_SPAWN.z + 350 }],
    companion524: { x: 300, z: 300 },
    orbBots: [
      { id: 'mine', kind: 'white', ownerId: 'self', x: CAMP_SPAWN.x + 1, z: CAMP_SPAWN.z },
      { id: 'wild', kind: 'blue', ownerId: null, x: CAMP_SPAWN.x, z: CAMP_SPAWN.z + 103 },
    ],
  };
  const world = Object.assign(Object.create(WorldRenderer.prototype), {
    worldAssets: assets,
    npcAssets,
    assetsReady: true,
    disposed: false,
    selfId: 'self',
    focus: new THREE.Vector3(CAMP_SPAWN.x, 0, CAMP_SPAWN.z),
    state,
    mammoths: [],
    boatRenderer: undefined,
    companionKeys: new Set(['yellow-524-mascot', 'orb-bot-white', 'orb-bot-blue']),
    streamDemand: new LoadDemand(),
    npcResidency: new ActorResidency(),
    actorEvictions: 0,
    canvas: { dataset: {} },
    failWorld: (message, error) => failures.push(error ?? new Error(message)),
    installStreamed: (key) => installed.push(key),
    updateAssetDiagnostics() {},
  });
  world.updateStreamedTemplates(0);
  assert.deepEqual(loader.keys(), ['orb-bot-white'], "the player's own companion first");
  assert.equal(world.canvas.dataset.companionAssets, 'loading');
  assert.equal(world.npcResidency.state, 'loading', 'the camp NPC (27 m) is queued');
  // Travel away before the queued work starts: it is withdrawn, never downloaded.
  world.focus.set(900, 0, 900);
  world.updateStreamedTemplates(1);
  await settle();
  assert.equal(assets.loadQueue.stats.cancelled, 2, 'the wild bot and the NPC');
  assert.equal(assets.loadQueue.queued.length, 0);
  assert.equal(world.npcResidency.state, 'absent');
  assert.equal(people.calls.length, 0);
  loader.calls[0].resolve(model());
  await settle();
  assert.deepEqual(installed, ['orb-bot-white'], 'an owned companion loads wherever it is');
  // Back at the camp, 524 has come close: it starts, then the NPC before the wild bot.
  world.focus.set(CAMP_SPAWN.x, 0, CAMP_SPAWN.z);
  state.companion524 = { x: CAMP_SPAWN.x + 4, z: CAMP_SPAWN.z + 13 };
  world.updateStreamedTemplates(2);
  assert.deepEqual(loader.keys(), ['orb-bot-white', 'yellow-524-mascot']);
  loader.calls[1].resolve(model());
  await settle();
  assert.equal(people.calls.length, 1, 'the NPC (27 m) starts before the bot (103 m)');
  assert.equal(loader.calls.length, 2);
  assert.deepEqual(installed, ['orb-bot-white', 'yellow-524-mascot']);
  assert.ok(
    !loader.keys().some((key) => key === 'woolly-mammoth' || key === 'mammoth-meat'),
    'the herd beyond actor range is never requested',
  );
  assert.deepEqual(failures, []);
  assets.dispose();
});

test('the gallery shows the selected character, loads its verified template once and the world reuses it', async (t) => {
  installGalleryDom(t);
  const loads = { 'neanderthal-woman': 0, 'cro-magnon-hunter': 0 };
  const humanAssets = new Map(
    Object.keys(loads).map((key) => [
      key,
      new CharacterAssets(`/models/${key}/asset.json`, {
        loadModel: async () => {
          loads[key]++;
          return rigTemplate();
        },
      }),
    ]),
  );
  const gallery = galleryWorld(humanAssets),
    network = caveImageNetwork();
  let proceeded = 0;
  const cave = new LoadingCave(
    gallery,
    () => proceeded++,
    () => {},
    {
      character: 'neanderthal-woman',
      images: network.options,
    },
  );
  await cave.load();
  assert.equal(network.images.length, 10, 'the gallery shows its ten verified images');
  assert.deepEqual(loads, { 'neanderthal-woman': 1, 'cro-magnon-hunter': 0 }, 'no substitute');
  const provider = humanAssets.get('neanderthal-woman');
  assert.equal(provider.instances.size, 1, 'the gallery avatar');
  assert.equal(gallery.canvas.dataset.loadingCave, 'exploring');
  // Proceeding keeps the gallery until the arrival; a second press does nothing.
  cave.proceed.onclick();
  assert.equal(proceeded, 0, 'entry is offered only once the world is ready');
  cave.markWorldReady();
  cave.proceed.onclick();
  cave.enterWorld();
  cave.proceed.onclick();
  assert.equal(proceeded, 1);
  assert.equal(cave.proceed.disabled, true);
  assert.equal(gallery.canvas.dataset.loadingCave, 'entering');
  assert.ok(network.images.every((image) => image.closed === 0));
  cave.dispose();
  assert.equal(provider.instances.size, 0);
  assert.ok(
    network.images.every((image) => image.closed === 1),
    'its images leave with it',
  );
  assert.ok(provider.template, 'the verified template stays for the arrival');
  // The world's local player is created from the same template.
  const world = Object.assign(Object.create(WorldRenderer.prototype), {
    canvas: { dataset: {} },
    assetsPromise: Promise.resolve(),
    assetsReady: true,
    disposed: false,
    selfId: 'self',
    players: new Map(),
    humanAssets,
    worldAssets: propAssets(),
    scene: new THREE.Scene(),
    failWorld: (message, error) => {
      throw error ?? new Error(message);
    },
  });
  const entity = {
    model: new THREE.Group(),
    state: {
      id: 'self',
      species: 'nea',
      gender: 'female',
      color: '#b98a60',
      x: 0,
      z: 0,
      facing: 0,
    },
  };
  world.players.set('self', entity);
  await world.loadHuman(entity, 'self');
  assert.ok(entity.actor && provider.instances.has(entity.actor));
  assert.equal(loads['neanderthal-woman'], 1, 'loaded once for the gallery and the world');
  assert.equal(world.canvas.dataset.characterAsset, 'ready');
  assert.ok(world.selfRenderReady());
});

/** A renderer that can create the local player, with gated equipment downloads. */
function selfWorld(humanAssets, loadEnvironment) {
  const assets = new WorldAssets({ loadEnvironment });
  const equipment = (key) => record(key, 'equipment', 300, { onDemand: true });
  assets.catalog = {
    assets: ['wooden-spear', 'obsidian-spear', 'kunoichi-katana', 'howkey-flask'].map(equipment),
  };
  // The camp's startup set already holds the axe and the torch wood.
  const resident = propAssets();
  for (const key of ['stone-axe', 'firewood-log'])
    assets.templates.set(key, resident.templates.get(key));
  return Object.assign(Object.create(WorldRenderer.prototype), {
    canvas: { dataset: {} },
    assetsPromise: Promise.resolve(),
    assetsReady: true,
    disposed: false,
    selfId: 'self',
    players: new Map(),
    humanAssets,
    worldAssets: assets,
    scene: new THREE.Scene(),
    failWorld: (message, error) => {
      throw error ?? new Error(message);
    },
  });
}

test('the arrival prepares exactly the selected character’s held props', async () => {
  for (const [species, gender, props] of [
    ['nea', 'female', ['obsidian-spear', 'wooden-spear']],
    ['cro', 'male', ['obsidian-spear', 'wooden-spear']],
    ['cat', 'female', ['kunoichi-katana']],
    ['ape', 'male', []],
    ['bear', 'female', []],
  ]) {
    const loader = gate(),
      people = gate();
    const humanAssets = new Map(
      ['cro-magnon-woman', 'cro-magnon-hunter', 'neanderthal-woman', 'neanderthal-hunter']
        .concat(['cat-kunoichi', 'giant-ape', 'desert-fennec-mage'])
        .map((key) => [
          key,
          new CharacterAssets(`/models/${key}/asset.json`, { loadModel: people.load }),
        ]),
    );
    const world = selfWorld(humanAssets, loader.load);
    void world.prepareSelf({ species, gender }).catch(() => {});
    await settle();
    assert.deepEqual(loader.keys().sort(), props, `${species}: its held props`);
    assert.equal(people.calls.length, 1, `${species}: its own character, once`);
    world.worldAssets.dispose();
  }
});

test('after the arrival is prepared the local body attaches from the snapshot without another download', async () => {
  const loader = gate();
  let characterLoads = 0;
  const provider = new CharacterAssets('/models/neanderthal-woman/asset.json', {
    loadModel: async () => {
      characterLoads++;
      return rigTemplate();
    },
  });
  const world = selfWorld(new Map([['neanderthal-woman', provider]]), loader.load);
  const preparing = world.prepareSelf({ species: 'nea', gender: 'female' });
  await settle();
  for (const call of loader.calls) {
    const scene = new THREE.Group();
    scene.add(
      new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.2, 0.05), new THREE.MeshStandardMaterial()),
    );
    call.resolve({ scene });
  }
  await preparing;
  const entity = {
    model: new THREE.Group(),
    state: {
      id: 'self',
      species: 'nea',
      gender: 'female',
      color: '#b98a60',
      x: 0,
      z: 0,
      facing: 0,
    },
  };
  world.players.set('self', entity);
  await world.loadHuman(entity, 'self');
  assert.ok(entity.actor && entity.weapon && entity.spears.get('obsidian-spear'));
  assert.equal(loader.calls.length, 2, 'both spears came before the snapshot, nothing after');
  assert.equal(characterLoads, 1);
  assert.ok(world.selfRenderReady());
  world.worldAssets.dispose();
});

test('arrival waits for the world, the local snapshot, its floor and its body; leaving ends it quietly', async () => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const floors = [];
  const world = Object.assign(Object.create(WorldRenderer.prototype), {
    assetsReady: false,
    disposed: false,
    failed: false,
    selfId: null,
    players: new Map(),
    openWorld: { arrive: async (position) => floors.push([position.x, position.z]) },
  });
  let arrived = false;
  const arriving = world.arrival().then(() => (arrived = true));
  await wait(120);
  assert.equal(arrived, false, 'no world yet');
  world.assetsReady = true;
  world.selfId = 'self';
  const self = { state: { x: 5, z: 7 } };
  world.players.set('self', self);
  await wait(120);
  assert.deepEqual(floors, [[5, 7]], 'the floor at the actual spawn is made ready');
  assert.equal(arrived, false, 'the body is not attached yet');
  self.actor = {};
  await arriving;
  assert.ok(arrived);
  const away = Object.assign(Object.create(WorldRenderer.prototype), {
    assetsReady: true,
    disposed: false,
    failed: false,
    selfId: null,
    players: new Map(),
  });
  let present = true;
  const leaving = world.arrival
    .call(away, () => present)
    .then(
      () => 'arrived',
      (error) => error,
    );
  present = false;
  assert.ok(isLoadCancelled(await leaving), 'leaving is not a failure');
  away.failed = true;
  await assert.rejects(world.arrival.call(away), /failed before arrival/);
});

test('a selected character that fails verification or is unknown stops the gallery without a substitute', async (t) => {
  installGalleryDom(t);
  let hunter = 0;
  const humanAssets = new Map([
    [
      'desert-fennec-mage',
      new CharacterAssets('/models/desert-fennec-mage/asset.json', {
        loadModel: async () => {
          throw new Error('integrity mismatch');
        },
      }),
    ],
    [
      'cro-magnon-hunter',
      new CharacterAssets('/models/cro-magnon-hunter/asset.json', {
        loadModel: async () => {
          hunter++;
          return rigTemplate();
        },
      }),
    ],
  ]);
  const network = caveImageNetwork();
  const failing = new LoadingCave(
    galleryWorld(humanAssets),
    () => {},
    () => {},
    { character: 'desert-fennec-mage', images: network.options },
  );
  await assert.rejects(failing.load(), /integrity mismatch/);
  failing.dispose();
  const unknown = new LoadingCave(
    galleryWorld(humanAssets),
    () => {},
    () => {},
    { character: 'missing-character', images: network.options },
  );
  await assert.rejects(unknown.load(), /Missing verified character missing-character/);
  unknown.dispose();
  assert.equal(hunter, 0, 'the hunter is never shown instead');
  assert.deepEqual(network.requests, [], 'a stopped gallery requests no image');
});

test('leaving the gallery while the character loads and returning attaches only the new visit’s avatar', async (t) => {
  installGalleryDom(t);
  const people = gate();
  const provider = new CharacterAssets('/models/cat-kunoichi/asset.json', {
    loadModel: people.load,
  });
  const gallery = galleryWorld(new Map([['cat-kunoichi', provider]])),
    left = caveImageNetwork(),
    returned = caveImageNetwork();
  const first = new LoadingCave(
    gallery,
    () => {},
    () => {},
    { character: 'cat-kunoichi', images: left.options },
  );
  const firstLoad = first.load().then(
    () => 'returned',
    (error) => error,
  );
  await settle();
  assert.equal(people.calls.length, 1);
  first.dispose();
  const second = new LoadingCave(
    gallery,
    () => {},
    () => {},
    { character: 'cat-kunoichi', images: returned.options },
  );
  const secondLoad = second.load();
  await settle();
  assert.equal(people.calls.length, 1, 'the running load is joined, not repeated');
  people.calls[0].resolve(await rigTemplate());
  await secondLoad;
  assert.equal(await firstLoad, 'returned', 'the left visit ends quietly');
  assert.equal(provider.instances.size, 1, "only the second visit's avatar exists");
  assert.deepEqual(left.requests, [], 'the left visit requests no image');
  assert.equal(returned.images.length, 10);
  second.dispose();
  assert.equal(provider.instances.size, 0);
  assert.ok(returned.images.every((image) => image.closed === 1));
});
