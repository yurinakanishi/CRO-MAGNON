import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import {
  AssetLoadQueue,
  LOAD_TIER,
  LoadCancelled,
  LoadTicket,
  isLoadCancelled,
  loadPriority,
} from '../dist/src/asset-load-queue.js';
import {
  ActorResidency,
  RESIDENCY,
  essentialActorIds,
  releaseResidency,
  residencyAttached,
  residencyPriority,
  stepResidency,
} from '../dist/src/actor-residency.js';
import { WorldAssets } from '../dist/src/world-assets.js';
import { CharacterAssets } from '../dist/src/character-assets.js';
import { WorldRenderer } from '../dist/src/world3d.js';
import { ENEMY_CLIPS } from '../dist/src/enemy-state.js';
import { updateActorPerformance } from '../dist/src/performance-lod.js';
import { deliveredWomanRig } from './cro-magnon-woman-rig.mjs';

/** Let every pending promise chain run; all loaders here are test-controlled. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

/** A delayed loader: every call waits until the test resolves or rejects it. */
function gate() {
  const calls = [];
  return {
    calls,
    load: (record) => {
      const call = { record, ...deferred() };
      calls.push(call);
      return call.promise;
    },
    keys: () => calls.map((call) => call.record.modelKey ?? call.record),
  };
}

/** Jobs that record their start and wait for the test to finish them. */
function workLog() {
  const started = [],
    finish = {};
  const work = (key) => () =>
    new Promise((resolve) => {
      started.push(key);
      finish[key] = () => resolve(key);
    });
  return { started, finish, work };
}

const enemyRecord = (key) => ({ modelKey: key, kind: 'enemy', url: `/${key}.glb`, lods: [] });

/** A synthetic enemy GLB with the six enemy clips (or a broken subset). */
function enemyModel(clips = ENEMY_CLIPS) {
  const geometry = new THREE.BoxGeometry(1, 1, 1),
    scene = new THREE.Group();
  scene.add(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial()));
  return { scene, geometry, animations: clips.map((name) => new THREE.AnimationClip(name, 1, [])) };
}

let rigSource;
/** The delivered Cro-Magnon rig (the torch and poses need its real bones): its primary
 * and LOD, or after the r04 adoption its sole primary with no LOD. Each load gets its
 * own scenes, so evicting one template never affects another. */
async function rigTemplate() {
  rigSource ??= deliveredWomanRig();
  const { primary, lod, asset } = await rigSource;
  return {
    gltf: { scene: cloneSkeleton(primary.scene), animations: primary.animations },
    lod: lod && { scene: cloneSkeleton(lod.scene) },
    asset,
  };
}

function installDocument(t) {
  const element = () => ({
    style: {},
    dataset: {},
    hidden: false,
    textContent: '',
    className: '',
    classList: { add() {}, remove() {}, toggle() {} },
    append() {},
    setAttribute() {},
    remove() {},
  });
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    writable: true,
    value: { createElement: element, hidden: false },
  });
  t.after(() =>
    previous ? Object.defineProperty(globalThis, 'document', previous) : delete globalThis.document,
  );
}

/** Held props and the torch wood the real player path attaches. */
function installPropTemplates(assets) {
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
}

const RESOURCES = [];
const snapshot = (players, enemies = []) => ({
  players,
  enemies,
  resources: RESOURCES,
  camp: { level: 0 },
});
const enemy = (id, modelKey, x, z = 0) => ({
  id,
  name: id,
  modelKey,
  x,
  z,
  radius: 0.5,
  phase: 'alive',
});
const person = (id, x, z, extra = {}) => ({
  id,
  name: id,
  species: 'cro',
  gender: 'female',
  color: '#b98a60',
  x,
  z,
  facing: 0,
  radius: 0.32,
  ...extra,
});

/** A renderer without WebGL: the real snapshot, residency and load paths. */
function worldFixture({ assets, humanAssets = new Map(), selfId = null }) {
  const failures = [],
    loads = [];
  const world = Object.assign(Object.create(WorldRenderer.prototype), {
    worldAssets: assets,
    humanAssets,
    players: new Map(),
    enemies: new Map(),
    labels: [],
    labelLayer: { append() {} },
    scene: new THREE.Scene(),
    focus: new THREE.Vector3(),
    canvas: { dataset: {} },
    prediction: { enabled: false, receive() {} },
    state: snapshot([]),
    selfId,
    assetsReady: true,
    assetsPromise: Promise.resolve(),
    actorEvictions: 0,
    disposed: false,
    failWorld: (message, error) => failures.push(error ?? new Error(message)),
  });
  for (const name of ['loadHuman', 'loadEnemy'])
    world[name] = (...args) => {
      const done = WorldRenderer.prototype[name].apply(world, args);
      loads.push(done);
      return done;
    };
  return { world, failures, loads };
}

test('one bounded queue coalesces each key and starts the best queued work first', async () => {
  const queue = new AssetLoadQueue(2, 1),
    { started, finish, work } = workLog();
  const a = queue.request('a', work('a'), LoadTicket.of(LOAD_TIER.scene));
  assert.equal(queue.request('a', work('again'), LoadTicket.of(LOAD_TIER.near, 3)), a);
  const b = queue.request('b', work('b'), LoadTicket.of(LOAD_TIER.scene));
  const far = queue.request('far', work('far'), LoadTicket.of(LOAD_TIER.prefetch, 120));
  const first = queue.request('first', work('first'), LoadTicket.of(LOAD_TIER.visible, 60));
  const second = queue.request('second', work('second'), LoadTicket.of(LOAD_TIER.visible, 60));
  const self = queue.request('self', work('self'), LoadTicket.of(LOAD_TIER.essential));
  assert.deepEqual(started, ['a', 'b'], 'two loads at once; a running key is joined');
  finish.a();
  assert.equal(await a, 'a');
  assert.deepEqual(started, ['a', 'b', 'self'], 'the local player outranks earlier queued work');
  finish.b();
  await b;
  assert.equal(started.at(-1), 'first', 'equal priorities keep request order');
  finish.self();
  await self;
  assert.equal(started.at(-1), 'second');
  finish.first();
  await first;
  assert.equal(started.at(-1), 'far', 'prefetch waits for the nearby scene');
  finish.second();
  finish.far();
  await Promise.all([second, far]);
  assert.deepEqual(queue.diagnostics(), {
    active: 0,
    queued: 0,
    background: 0,
    started: 6,
    completed: 6,
    failed: 0,
    cancelled: 0,
  });
});

test('approaching work is reprioritized by its ticket and prefetch never fills both slots', async () => {
  const queue = new AssetLoadQueue(2, 1),
    { started, finish, work } = workLog();
  const tickets = {
    one: LoadTicket.of(LOAD_TIER.prefetch, 110),
    two: LoadTicket.of(LOAD_TIER.prefetch, 120),
    three: LoadTicket.of(LOAD_TIER.prefetch, 124),
  };
  const loads = Object.fromEntries(
    Object.entries(tickets).map(([key, ticket]) => [key, queue.request(key, work(key), ticket)]),
  );
  assert.deepEqual(started, ['one'], 'one background load; the other slot stays free');
  // The third actor walks into interaction range (or the player warps beside it).
  tickets.three.priority = loadPriority(LOAD_TIER.near, 20);
  queue.pump();
  assert.deepEqual(started, ['one', 'three']);
  finish.one();
  await loads.one;
  assert.deepEqual(started, ['one', 'three', 'two'], 'background work continues afterwards');
  finish.three();
  finish.two();
  await Promise.all([loads.two, loads.three]);
});

test('withdrawn loads cancel without an asset error and leave no ticket watchers', async () => {
  const queue = new AssetLoadQueue(1, 1),
    { started, finish, work } = workLog();
  // A long-lived consumer ticket reused for several loads; never released.
  const keep = LoadTicket.of(LOAD_TIER.scene);
  const running = queue.request('running', work('running'), keep);
  const shared = LoadTicket.of(LOAD_TIER.visible, 30),
    other = LoadTicket.of(LOAD_TIER.visible, 40);
  const sharedLoad = queue.request('shared', work('shared'), shared);
  assert.equal(queue.join('shared', other), true);
  const lonely = LoadTicket.of(LOAD_TIER.prefetch, 120);
  const lonelyOutcome = queue.request('lonely', work('lonely'), lonely).then(
    () => 'loaded',
    (error) => error,
  );
  const reused = queue.request('reused', work('reused'), keep).then(
    () => 'loaded',
    (error) => error,
  );
  assert.equal(keep.watching, 1, 'one watcher per queue, however many jobs');
  lonely.release();
  const error = await lonelyOutcome;
  assert.ok(error instanceof LoadCancelled && isLoadCancelled(error));
  assert.equal(lonely.watching, 0);
  shared.release();
  assert.equal(queue.queued.length, 2, 'another consumer keeps the shared load');
  // A running load completes even when its consumer withdraws; owners discard it.
  keep.release();
  finish.running();
  assert.equal(await running, 'running');
  finish.shared();
  await sharedLoad;
  assert.ok(isLoadCancelled(await reused), 'nobody waits for it');
  assert.deepEqual(started, ['running', 'shared'], 'withdrawn work never started');
  for (const ticket of [keep, shared, other, lonely]) assert.equal(ticket.watching, 0);
  assert.equal(queue.stats.cancelled, 2);
  assert.equal(queue.stats.failed, 0);
});

test('queue disposal settles queued callers at once and lets running work drain', async () => {
  const queue = new AssetLoadQueue(1, 1),
    { started, finish, work } = workLog();
  const running = queue.request('running', work('running'), LoadTicket.of(LOAD_TIER.scene));
  let cancelled = false;
  const queued = queue
    .request('queued', work('queued'), LoadTicket.of(LOAD_TIER.near, 4))
    .catch((error) => (cancelled = isLoadCancelled(error)));
  queue.dispose();
  await Promise.resolve();
  assert.equal(cancelled, true, 'queued callers do not wait for the network');
  finish.running();
  assert.equal(await running, 'running');
  await queued;
  assert.deepEqual(started, ['running']);
  assert.equal(queue.active, 0);
  await assert.rejects(
    queue.request('late', work('late'), LoadTicket.of(LOAD_TIER.essential)),
    (error) => isLoadCancelled(error),
  );
});

test('residency bands admit near actors first, prefetch approaching ones and keep a margin', () => {
  assert.equal(residencyPriority(900, true, false), loadPriority(LOAD_TIER.essential));
  assert.equal(residencyPriority(10, false, false), loadPriority(LOAD_TIER.near, 10));
  assert.equal(residencyPriority(80, false, false), loadPriority(LOAD_TIER.visible, 80));
  assert.equal(residencyPriority(120, false, false), loadPriority(LOAD_TIER.prefetch, 120));
  assert.equal(residencyPriority(RESIDENCY.prefetch + 1, false, false), null, 'far: no fetch');
  assert.equal(
    residencyPriority(RESIDENCY.prefetch + 1, false, true),
    loadPriority(LOAD_TIER.prefetch, RESIDENCY.prefetch + 1),
    'a held actor keeps the hysteresis margin',
  );
  assert.equal(residencyPriority(RESIDENCY.retain + 1, false, true), null);
  assert.equal(residencyPriority(Number.NaN, false, true), null);
  assert.ok(RESIDENCY.near < RESIDENCY.admit && RESIDENCY.admit < RESIDENCY.prefetch);
  assert.ok(RESIDENCY.prefetch < RESIDENCY.retain);
  const players = [
    { id: 'self', carrierId: 'ape', passengerId: 'cub' },
    { id: 'ape' },
    { id: 'cub' },
    { id: 'rider', carrierId: 'self' },
    { id: 'stranger', carrierId: 'ape' },
  ];
  assert.deepEqual([...essentialActorIds(players, 'self')].sort(), ['ape', 'cub', 'rider', 'self']);
  assert.equal(essentialActorIds(players, null).size, 0);
});

test('a holder loads once, keeps its actor through the grace period, then releases it', () => {
  const record = new ActorResidency(),
    near = loadPriority(LOAD_TIER.near, 5);
  assert.equal(stepResidency(record, near, 0), 'load');
  const { token, ticket } = record;
  assert.ok(token && ticket && record.state === 'loading');
  assert.equal(stepResidency(record, loadPriority(LOAD_TIER.visible, 60), 1), null);
  assert.equal(ticket.priority, loadPriority(LOAD_TIER.visible, 60), 'priority follows distance');
  assert.equal(residencyAttached(record, {}), false, 'another load cannot attach');
  assert.equal(residencyAttached(record, null), false);
  assert.equal(residencyAttached(record, token), true);
  assert.equal(record.state, 'resident');
  assert.equal(ticket.released, true, 'an attached actor holds no queue interest');
  assert.equal(stepResidency(record, null, 10), null, 'inside the grace period');
  assert.equal(stepResidency(record, near, 11), null, 're-entry keeps the same actor');
  assert.equal(stepResidency(record, null, 20), null);
  assert.equal(stepResidency(record, null, 11 + RESIDENCY.graceSeconds), 'evict');
  releaseResidency(record);
  assert.equal(record.state, 'absent');
  assert.equal(residencyAttached(record, token), false, 'a stale load never revives it');
  assert.equal(residencyAttached(record, null), false, 'nor does a null token');
  assert.equal(record.state, 'absent');
  assert.equal(stepResidency(record, near, 30), 'load');
  const loading = record.ticket;
  assert.equal(stepResidency(record, null, 30.1), 'cancel', 'unfinished loads stop at once');
  releaseResidency(record);
  assert.equal(loading.released, true);
});

test('enemy templates load once through the queue, cancel without consumers and free without owners', async () => {
  const loader = gate(),
    assets = new WorldAssets({ loadEnvironment: loader.load });
  assets.catalog = { assets: ['wolf', 'bear'].map(enemyRecord) };
  assets.loadQueue = new AssetLoadQueue(1, 1);
  const wolf = assets.createEnemy('wolf', LoadTicket.of(LOAD_TIER.near, 10));
  const far = LoadTicket.of(LOAD_TIER.prefetch, 120);
  const bear = assets.createEnemy('bear', far).then(
    () => 'created',
    (error) => error,
  );
  far.release();
  assert.ok(isLoadCancelled(await bear), 'a withdrawn requester is not an asset failure');
  assert.deepEqual(loader.keys(), ['wolf'], 'no download for the withdrawn enemy');
  assert.equal(assets.enemyLoads.has('bear'), false, 'it can be requested again');
  const pack = assets.createEnemy('wolf', LoadTicket.of(LOAD_TIER.visible, 70));
  const model = enemyModel();
  let freed = 0;
  model.geometry.addEventListener('dispose', () => freed++);
  loader.calls[0].resolve(model);
  const [a, b] = await Promise.all([wolf, pack]);
  assert.equal(loader.calls.length, 1, 'two actors of a kind share one load');
  assert.ok(a && b && a !== b);
  assert.equal(assets.actorUsers.get('wolf'), 2);
  assert.equal(assets.collectActors(0, 12), 0);
  a.dispose();
  assert.equal(assets.collectActors(100, 12), 0, 'one owner keeps it');
  b.dispose();
  b.dispose();
  assert.equal(assets.actorUsers.has('wolf'), false, 'reference counts balance');
  assert.equal(assets.collectActors(200, 12), 0, 'an idle period starts');
  assert.equal(assets.collectActors(211, 12), 0);
  assert.equal(freed, 0);
  assert.equal(assets.collectActors(212, 12), 1);
  assert.equal(freed, 1, 'the evicted template releases its geometry');
  assert.equal(assets.templates.has('wolf'), false);
  const again = assets.createEnemy('wolf', LoadTicket.of(LOAD_TIER.near, 5));
  assert.equal(loader.calls.length, 2, 'a later need loads it again');
  loader.calls[1].resolve(enemyModel());
  assert.ok(await again);
  assets.dispose();
  assert.equal(assets.actorUsers.size, 0);
});

test('a needed enemy GLB that is broken or fails integrity rejects visibly and can be retried', async () => {
  const loader = gate(),
    assets = new WorldAssets({ loadEnvironment: loader.load });
  assets.catalog = { assets: [enemyRecord('wolf')] };
  const failing = assets.createEnemy('wolf', LoadTicket.of(LOAD_TIER.near, 5));
  const broken = enemyModel(['Idle_Loop']);
  let freed = 0;
  broken.geometry.addEventListener('dispose', () => freed++);
  loader.calls[0].resolve(broken);
  await assert.rejects(failing, /missing clips/);
  assert.equal(freed, 1, 'the rejected model is released, never substituted');
  assert.equal(assets.templates.size, 0);
  assert.equal(assets.actorUsers.size, 0);
  assert.equal(assets.enemyLoads.size, 0);
  const retry = assets.createEnemy('wolf', LoadTicket.of(LOAD_TIER.near, 5));
  loader.calls[1].reject(new Error('integrity mismatch'));
  await assert.rejects(retry, /integrity mismatch/);
  assert.equal(assets.loadQueue.stats.failed, 2);
  assets.dispose();
});

function personTemplate(bitmap) {
  const scenes = [new THREE.Group(), new THREE.Group()],
    textures = [new THREE.Texture(bitmap), new THREE.Texture(bitmap)];
  scenes.forEach((scene, index) =>
    scene.add(
      new THREE.Mesh(
        new THREE.BoxGeometry(),
        new THREE.MeshStandardMaterial({ map: textures[index] }),
      ),
    ),
  );
  return {
    gltf: { scene: scenes[0], animations: [] },
    lod: { scene: scenes[1] },
    asset: { modelKey: 'test-person' },
    textures,
  };
}

test('character templates coalesce, evict with shared bitmaps closed once and reload on demand', async () => {
  const loader = gate(),
    queue = new AssetLoadQueue(1, 1);
  const provider = new CharacterAssets('/models/test-person/asset.json', {
    queue,
    loadModel: loader.load,
  });
  const a = provider.load(LoadTicket.of(LOAD_TIER.visible, 50));
  assert.equal(provider.load(LoadTicket.of(LOAD_TIER.essential)), a, 'one pending load');
  assert.equal(loader.calls.length, 1);
  let closed = 0,
    textures = 0;
  const template = personTemplate({ close: () => closed++ });
  for (const texture of template.textures) texture.addEventListener('dispose', () => textures++);
  loader.calls[0].resolve(template);
  assert.equal(await a, template);
  assert.equal(provider.evict(), true);
  assert.equal(provider.evict(), false);
  assert.equal(textures, 2, 'each texture is disposed once');
  assert.equal(closed, 1, 'the shared ImageBitmap closes once');
  assert.equal(provider.template, null);
  assert.equal(provider.evictions, 1);
  const reload = provider.load();
  assert.equal(loader.calls.length, 2, 'the provider stays usable after eviction');
  const second = personTemplate({ close() {} });
  loader.calls[1].resolve(second);
  assert.equal(await reload, second);
  // A load finishing after permanent disposal is released, not installed.
  const late = new CharacterAssets('/models/test-person/asset.json', {
    queue,
    loadModel: loader.load,
  });
  const lateLoad = late.load();
  late.dispose();
  let lateClosed = 0;
  loader.calls[2].resolve(personTemplate({ close: () => lateClosed++ }));
  assert.equal(await lateLoad, null);
  assert.equal(late.template, null);
  assert.equal(lateClosed, 1);
});

test('a character creation withdrawn before its load starts cancels it and balances its owner count', async () => {
  const queue = new AssetLoadQueue(1, 1);
  queue.request('busy', () => new Promise(() => {}), LoadTicket.of(LOAD_TIER.essential));
  const loader = gate();
  const provider = new CharacterAssets('/models/test-person/asset.json', {
    queue,
    loadModel: loader.load,
  });
  const ticket = LoadTicket.of(LOAD_TIER.prefetch, 120);
  const creation = provider.create({ color: '#fff', ticket }).then(
    () => 'created',
    (error) => error,
  );
  assert.equal(provider.users, 1, 'a pending creation is an owner');
  ticket.release();
  assert.ok(isLoadCancelled(await creation));
  assert.equal(loader.calls.length, 0, 'nothing was downloaded');
  assert.equal(provider.users, 0);
  assert.equal(provider.pending, null, 'a later request starts a fresh load');
});

test('a character template is collected only after the grace period with no instance or creation', async () => {
  let loads = 0;
  const provider = new CharacterAssets('/models/cro-magnon-woman/asset.json', {
    loadModel: () => (loads++, rigTemplate()),
  });
  const first = await provider.create({ color: '#a86' });
  const second = await provider.create({ color: '#68a' });
  assert.equal(loads, 1);
  assert.equal(provider.users, 2);
  first.dispose();
  first.dispose();
  assert.equal(provider.users, 1);
  assert.equal(provider.collect(0, 12), false);
  assert.equal(provider.collect(100, 12), false, 'one owner keeps it');
  second.dispose();
  assert.equal(provider.collect(200, 12), false, 'an idle period starts');
  assert.equal(provider.collect(211, 12), false);
  const third = await provider.create({ color: '#a86' });
  assert.equal(loads, 1, 're-entry within the grace period reuses the template');
  third.dispose();
  assert.equal(provider.collect(212, 12), false, 'recent use restarts the idle period');
  assert.equal(provider.collect(223, 12), false);
  assert.equal(provider.collect(224, 12), true);
  assert.equal(provider.template, null);
  const reloaded = await provider.create({ color: '#a86' });
  assert.ok(reloaded);
  assert.equal(loads, 2, 'reload after eviction');
  reloaded.dispose();
  assert.equal(provider.collect(300, 12, true), false, 'a holder about to create keeps it');
  assert.equal(provider.collect(400, 12, true), false);
  assert.equal(provider.collect(401, 12), false, 'the idle period starts when none needs it');
  assert.equal(provider.collect(413, 12), true);
  provider.dispose();
  assert.equal(provider.users, 0);
});

// After the r04 adoption the seven player bodies are each a sole primary whose manifest
// lists no LOD. The delivered rig with its LOD left out has that shape before adoption too.
test('a sole-primary character draws one body at every distance and evicts and reloads like any other', async () => {
  let loads = 0;
  const provider = new CharacterAssets('/models/cro-magnon-woman/asset.json', {
    loadModel: async () => {
      loads++;
      const template = await rigTemplate();
      return { ...template, lod: null, asset: { ...template.asset, lods: [] } };
    },
  });
  const actor = await provider.create({ color: '#a86' });
  assert.equal(provider.template.lod, null);
  const meshes = [];
  actor.root.traverse((node) => {
    if (node.isMesh) meshes.push({ node, geometry: node.geometry, material: node.material });
  });
  assert.ok(meshes.length > 0);
  const unchanged = ({ node, geometry, material }) =>
    node.geometry === geometry && node.material === material;
  for (const distance of [5, 60, 400, 5]) {
    updateActorPerformance(actor.root, distance);
    assert.ok(meshes.every(unchanged), `the primary body and its materials at ${distance} m`);
  }
  actor.dispose();
  assert.equal(provider.collect(0, 12), false, 'an idle period starts');
  assert.equal(provider.collect(12, 12), true, 'collected after the grace period');
  assert.equal(provider.template, null);
  const again = await provider.create({ color: '#68a' });
  assert.ok(again);
  assert.equal(loads, 2, 'reloaded after eviction');
  again.dispose();
  provider.dispose();
  assert.equal(provider.users, 0);
});

test('far enemies keep only their state; approaching ones load nearest first within two slots', async (t) => {
  installDocument(t);
  const loader = gate(),
    assets = new WorldAssets({ loadEnvironment: loader.load });
  assets.catalog = { assets: ['wolf', 'bear', 'boar', 'lynx'].map(enemyRecord) };
  const { world, failures, loads } = worldFixture({ assets, selfId: 'self' });
  const states = [enemy('wolf-1', 'wolf', 400), enemy('bear-1', 'bear', 600)];
  world.state = snapshot([], states);
  world.syncEnemies();
  world.updateActorResidency(10);
  assert.equal(world.enemies.size, 2, 'every enemy keeps its state holder');
  assert.equal(loader.calls.length, 0, 'far enemies fetch nothing');
  states[0].x = 120;
  world.updateActorResidency(11);
  world.updateActorResidency(11.5);
  assert.deepEqual(loader.keys(), ['wolf'], 'entering the prefetch band starts one load');
  assert.equal(world.enemies.get('wolf-1').residency.state, 'loading');
  const arrivals = [enemy('boar-1', 'boar', 30), enemy('lynx-1', 'lynx', 80)];
  states[1].x = 118;
  world.state = snapshot([], [...states, ...arrivals]);
  world.syncEnemies();
  world.updateActorResidency(12);
  assert.deepEqual(loader.keys(), ['wolf', 'boar'], 'the nearest starts in the free slot');
  loader.calls[0].resolve(enemyModel());
  await settle();
  assert.deepEqual(loader.keys(), ['wolf', 'boar', 'lynx'], 'visible work before prefetch');
  loader.calls[1].resolve(enemyModel());
  await settle();
  assert.deepEqual(loader.keys(), ['wolf', 'boar', 'lynx', 'bear']);
  assert.ok(assets.loadQueue.diagnostics().active <= 2);
  loader.calls[2].resolve(enemyModel());
  loader.calls[3].resolve(enemyModel());
  await Promise.all(loads);
  for (const id of ['wolf-1', 'bear-1', 'boar-1', 'lynx-1']) {
    const holder = world.enemies.get(id);
    assert.equal(holder.residency.state, 'resident');
    assert.equal(holder.model.children[0], holder.actor.root);
  }
  assert.deepEqual(failures, []);
  assert.deepEqual(world.residencyDiagnostics().enemies, { resident: 4, loading: 0, absent: 0 });
});

test('a departing enemy keeps its actor through the grace period, then the last owner frees the template', async (t) => {
  installDocument(t);
  const loader = gate(),
    assets = new WorldAssets({ loadEnvironment: loader.load });
  assets.catalog = { assets: [enemyRecord('wolf')] };
  const { world, failures, loads } = worldFixture({ assets, selfId: 'self' });
  const states = [enemy('a', 'wolf', 10), enemy('b', 'wolf', 20)];
  world.state = snapshot([], states);
  world.syncEnemies();
  world.updateActorResidency(0);
  assert.equal(loader.calls.length, 1, 'one load for both wolves');
  const model = enemyModel();
  let freed = 0;
  model.geometry.addEventListener('dispose', () => freed++);
  loader.calls[0].resolve(model);
  await Promise.all(loads);
  const actor = world.enemies.get('a').actor;
  assert.ok(actor && world.enemies.get('b').actor);
  states[0].x = 300;
  world.updateActorResidency(5);
  states[0].x = 30;
  world.updateActorResidency(10);
  assert.equal(world.enemies.get('a').actor, actor, 're-entry within the grace period reuses it');
  states[0].x = 300;
  world.updateActorResidency(15);
  assert.equal(world.enemies.get('a').actor, actor);
  world.updateActorResidency(10 + RESIDENCY.graceSeconds);
  const departed = world.enemies.get('a');
  assert.equal(departed.actor, null, 'released after the grace period');
  assert.equal(departed.model.children.length, 0, 'no visible substitute is left');
  assert.equal(departed.state, states[0], 'its state stays for targets and the map');
  assert.equal(world.actorEvictions, 1);
  world.updateActorResidency(40);
  assert.ok(assets.templates.has('wolf'), 'the other wolf still owns the template');
  states[1].x = 300;
  world.updateActorResidency(41);
  world.updateActorResidency(40 + RESIDENCY.graceSeconds);
  assert.equal(world.enemies.get('b').actor, null);
  assert.equal(assets.actorUsers.size, 0, 'owner counts balance after eviction');
  world.updateActorResidency(60);
  assert.equal(freed, 0, 'the template outlives its last actor by a grace period');
  world.updateActorResidency(60 + RESIDENCY.graceSeconds);
  assert.equal(freed, 1);
  assert.equal(assets.templates.has('wolf'), false);
  states[0].x = 10;
  world.updateActorResidency(80);
  assert.equal(loader.calls.length, 2, 'returning loads it again');
  loader.calls[1].resolve(enemyModel());
  await Promise.all(loads);
  assert.ok(world.enemies.get('a').actor);
  assert.deepEqual(failures, []);
});

test('late, removed, withdrawn and disposed enemy loads never attach an actor', async (t) => {
  installDocument(t);
  const loader = gate(),
    assets = new WorldAssets({ loadEnvironment: loader.load });
  assets.catalog = { assets: ['wolf', 'bear', 'boar'].map(enemyRecord) };
  const { world, failures, loads } = worldFixture({ assets, selfId: 'self' });
  const leaving = enemy('leaving', 'wolf', 30),
    removed = enemy('removed', 'bear', 30);
  world.state = snapshot([], [leaving, removed]);
  world.syncEnemies();
  world.updateActorResidency(0);
  assert.deepEqual(loader.keys(), ['wolf', 'bear']);
  leaving.x = 400;
  world.updateActorResidency(1);
  assert.equal(world.enemies.get('leaving').residency.state, 'absent', 'cancelled at once');
  world.state = snapshot([], [leaving]);
  world.syncEnemies();
  assert.equal(world.enemies.has('removed'), false);
  loader.calls[0].resolve(enemyModel());
  loader.calls[1].resolve(enemyModel());
  await Promise.all(loads);
  assert.equal(world.enemies.get('leaving').actor, null);
  assert.equal(assets.animals.size, 0, 'no late actor is created or leaked');
  assert.equal(assets.actorUsers.size, 0);
  // Disposal while a load runs.
  const boar = enemy('boar', 'boar', 20);
  world.state = snapshot([], [leaving, boar]);
  world.syncEnemies();
  world.updateActorResidency(2);
  assert.equal(loader.keys().at(-1), 'boar');
  world.disposed = true;
  assets.dispose();
  loader.calls.at(-1).resolve(enemyModel());
  await Promise.all(loads);
  assert.equal(world.enemies.get('boar').actor, null);
  assert.equal(assets.animals.size, 0);
  assert.deepEqual(failures, [], 'withdrawn and disposed loads are not asset errors');
});

test('a needed enemy model failure stops rendering visibly; a withdrawn one does not', async (t) => {
  installDocument(t);
  const loader = gate(),
    assets = new WorldAssets({ loadEnvironment: loader.load });
  assets.catalog = { assets: ['wolf', 'bear'].map(enemyRecord) };
  assets.loadQueue = new AssetLoadQueue(1, 1);
  const { world, failures, loads } = worldFixture({ assets, selfId: 'self' });
  const near = enemy('near', 'wolf', 10),
    passing = enemy('passing', 'bear', 120);
  world.state = snapshot([], [near, passing]);
  world.syncEnemies();
  world.updateActorResidency(0);
  passing.x = 500;
  world.updateActorResidency(1);
  loader.calls[0].resolve(enemyModel(['Idle_Loop', 'Walk_Loop']));
  await Promise.all(loads);
  assert.deepEqual(loader.keys(), ['wolf'], 'the withdrawn enemy downloaded nothing');
  assert.equal(failures.length, 1, 'only the needed broken model is reported');
  assert.match(failures[0].message, /missing clips/);
  assert.equal(world.enemies.get('near').actor, null, 'no fallback model is shown');
});

const manifest = (key) => `/models/${key}/asset.json`;

test('the local player and its carrier load first and stay through a warp; remote loads never touch readiness', async (t) => {
  installDocument(t);
  const clock = performance.now() / 1000;
  const loader = gate(),
    assets = new WorldAssets({ loadEnvironment: loader.load });
  assets.catalog = { assets: ['wolf', 'bear', 'boar'].map(enemyRecord) };
  installPropTemplates(assets);
  const people = gate();
  const humanAssets = new Map(
    ['cro-magnon-woman', 'neanderthal-woman', 'cro-magnon-hunter'].map((key) => [
      key,
      new CharacterAssets(manifest(key), { queue: assets.loadQueue, loadModel: people.load }),
    ]),
  );
  const { world, failures, loads } = worldFixture({ assets, humanAssets });
  const foes = [
    enemy('wolf-1', 'wolf', 60),
    enemy('bear-1', 'bear', 70),
    enemy('boar-1', 'boar', 120),
  ];
  world.state = snapshot([], foes);
  world.syncEnemies();
  world.updateActorResidency(clock);
  assert.deepEqual(loader.keys(), ['wolf', 'bear'], 'both slots run nearby enemies');
  // Essential actors load first at any distance: the local player and its carrier.
  const self = person('self', 0, 0, { carrierId: 'carrier' }),
    carrier = person('carrier', 0, 300, { species: 'nea', passengerId: 'self' }),
    stranger = person('stranger', 0, 500, { species: 'nea' });
  world.setState(snapshot([self, carrier, stranger], foes), 'self');
  await settle();
  assert.equal(world.canvas.dataset.characterAsset, 'loading');
  assert.equal(people.calls.length, 0, 'both slots are still busy');
  assert.equal(
    world.players.get('stranger').residency.state,
    'absent',
    'a far player fetches nothing',
  );
  loader.calls[0].resolve(enemyModel());
  await settle();
  assert.deepEqual(
    people.keys(),
    [manifest('cro-magnon-woman')],
    'the local player outranks the boar',
  );
  people.calls[0].resolve(await rigTemplate());
  await settle();
  assert.deepEqual(
    people.keys(),
    [manifest('cro-magnon-woman'), manifest('neanderthal-woman')],
    'then its carrier',
  );
  assert.deepEqual(loader.keys(), ['wolf', 'bear'], 'the prefetched boar is still queued');
  const own = world.players.get('self');
  assert.equal(own.model.children[0], own.actor.root);
  assert.ok(own.torch && own.axe && own.gripRight, 'held props come with the actor');
  assert.equal(world.canvas.dataset.characterAsset, 'ready');
  // A warp 700 m away withdraws the old neighbourhood's loads; essential ones continue.
  const warp = performance.now() / 1000;
  self.x = 700;
  world.focus.set(700, 0, 0);
  world.updateActorResidency(warp);
  assert.equal(world.enemies.get('boar-1').residency.state, 'absent', 'queued far work is dropped');
  assert.equal(world.enemies.get('bear-1').residency.state, 'absent');
  people.calls[1].resolve(await rigTemplate());
  loader.calls[1].resolve(enemyModel());
  await settle();
  assert.ok(world.players.get('carrier').actor, 'the carrier attaches at any distance');
  world.updateActorResidency(warp + RESIDENCY.graceSeconds);
  assert.ok(own.actor && world.players.get('carrier').actor, 'essential actors are never evicted');
  assert.equal(world.enemies.get('wolf-1').actor, null, 'the old neighbourhood is released');
  assert.equal(world.enemies.get('bear-1').actor, null, 'its late arrival never attached');
  assert.deepEqual(loader.keys(), ['wolf', 'bear'], 'the withdrawn boar never downloaded');
  // A remote player arriving beside the local player downloads its own model.
  const friend = person('friend', 705, 0, { gender: 'male' });
  world.setState(snapshot([self, carrier, stranger, friend], foes), 'self');
  await settle();
  assert.equal(people.keys().at(-1), manifest('cro-magnon-hunter'));
  assert.equal(world.canvas.dataset.characterAsset, 'ready', 'unchanged while it loads');
  people.calls[2].resolve(await rigTemplate());
  await Promise.all(loads);
  assert.ok(world.players.get('friend').actor);
  assert.ok(!world.players.get('stranger').actor);
  assert.equal(world.canvas.dataset.characterAsset, 'ready');
  assert.deepEqual(failures, []);
});

test('a character switch leaves no stale actor, and the unused template is evicted and reloads', async (t) => {
  installDocument(t);
  const assets = new WorldAssets({ loadEnvironment: gate().load });
  assets.catalog = { assets: [] };
  installPropTemplates(assets);
  const people = gate();
  const providers = Object.fromEntries(
    ['cro-magnon-woman', 'neanderthal-woman'].map((key) => [
      key,
      new CharacterAssets(manifest(key), { queue: assets.loadQueue, loadModel: people.load }),
    ]),
  );
  const { world, failures } = worldFixture({
    assets,
    humanAssets: new Map(Object.entries(providers)),
  });
  const self = person('self', 0, 0);
  world.setState(snapshot([self]), 'self');
  await settle();
  people.calls[0].resolve(await rigTemplate());
  await settle();
  const original = world.players.get('self');
  assert.ok(original.actor);
  // Switch to a model that is still downloading, then switch back before it arrives.
  world.setState(snapshot([{ ...self, species: 'nea' }]), 'self');
  await settle();
  assert.equal(original.actor, null, 'the previous actor is released at once');
  assert.equal(world.canvas.dataset.characterAsset, 'loading');
  assert.equal(people.calls.length, 2);
  world.setState(snapshot([self]), 'self');
  await settle();
  const current = world.players.get('self');
  assert.ok(current.actor && providers['cro-magnon-woman'].instances.has(current.actor));
  assert.equal(world.canvas.dataset.characterAsset, 'ready');
  people.calls[1].resolve(await rigTemplate());
  await settle();
  assert.equal(world.players.get('self'), current);
  assert.equal(providers['neanderthal-woman'].instances.size, 0, 'the late model never attaches');
  assert.equal(providers['neanderthal-woman'].users, 0, 'its owner count balances');
  assert.equal(providers['cro-magnon-woman'].users, 1);
  assert.equal(
    world.canvas.dataset.characterAsset,
    'ready',
    'a stale load never changes readiness',
  );
  // The unused template is evicted after the grace period, and reloads on demand.
  const later = performance.now() / 1000;
  world.updateActorResidency(later);
  world.updateActorResidency(later + RESIDENCY.graceSeconds);
  assert.equal(providers['neanderthal-woman'].template, null);
  assert.ok(providers['cro-magnon-woman'].template, 'the live model stays');
  world.setState(snapshot([{ ...self, species: 'nea' }]), 'self');
  await settle();
  assert.equal(people.calls.length, 3, 'switching back to it downloads it again');
  people.calls[2].resolve(await rigTemplate());
  await settle();
  assert.ok(providers['neanderthal-woman'].instances.has(world.players.get('self').actor));
  assert.equal(world.canvas.dataset.characterAsset, 'ready');
  assert.deepEqual(failures, []);
});

test('a holder waiting for the world keeps its preloaded model instead of downloading it twice', async (t) => {
  installDocument(t);
  const assets = new WorldAssets({ loadEnvironment: gate().load });
  assets.catalog = { assets: [] };
  installPropTemplates(assets);
  let downloads = 0;
  const provider = new CharacterAssets(manifest('cro-magnon-woman'), {
    queue: assets.loadQueue,
    loadModel: () => (downloads++, rigTemplate()),
  });
  await provider.load();
  const { world, failures, loads } = worldFixture({
    assets,
    humanAssets: new Map([['cro-magnon-woman', provider]]),
  });
  // The loading cave preloaded the model; the world is still preparing its first frames.
  const prepared = deferred();
  world.assetsPromise = prepared.promise;
  world.setState(snapshot([person('self', 0, 0)]), 'self');
  const now = performance.now() / 1000;
  world.updateActorResidency(now + 1);
  world.updateActorResidency(now + 1 + 2 * RESIDENCY.graceSeconds);
  assert.ok(provider.template, 'kept while its holder waits to create the actor');
  prepared.resolve();
  await Promise.all(loads);
  assert.ok(world.players.get('self').actor);
  assert.equal(downloads, 1);
  assert.equal(world.canvas.dataset.characterAsset, 'ready');
  assert.deepEqual(failures, []);
});
