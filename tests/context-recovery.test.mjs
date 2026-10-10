import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  CONTEXT_RECOVERY,
  GraphicsContextState,
  compileScene,
} from '../dist/src/context-recovery.js';
import { WorldRenderer } from '../dist/src/world3d.js';
import { LandscapeInstances, WorldAssets } from '../dist/src/world-assets.js';
import { LoadingCave } from '../dist/src/loading-cave.js';
import { FrameClock } from '../dist/src/frame-clock.js';
import { CollisionWorld } from '../dist/shared/collision.mjs';
import { caveGalleryImages, caveImageNetwork } from './camp-cave-fixture.mjs';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Replace browser globals for one test; restored afterwards. */
function globalsFor(t, values) {
  for (const [key, value] of Object.entries(values)) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    t.after(() =>
      previous ? Object.defineProperty(globalThis, key, previous) : delete globalThis[key],
    );
  }
}

test('a loss is counted once, waits only while visible and offers a reload once', () => {
  const state = new GraphicsContextState();
  assert.equal(state.restore(), false, 'nothing to restore');
  assert.equal(state.lose(), true);
  assert.equal(state.lose(), false, 'a repeated loss event changes nothing');
  assert.equal(state.losses, 1);
  let now = 0;
  const frames = (seconds, hidden = false) => {
    let stalls = 0;
    for (const end = now + seconds * 1000; now < end; now += 1000 / 30)
      stalls += Number(state.frame(now, hidden));
    return stalls;
  };
  assert.equal(frames(30, true), 0, 'a hidden page never counts');
  assert.equal(state.waitedSeconds, 0);
  assert.equal(frames(CONTEXT_RECOVERY.visibleWaitSeconds - 1), 0);
  // The first frame after a long gap (a resumed tab) adds one capped frame only.
  now += 60_000;
  assert.equal(state.frame(now, false), false);
  assert.ok(state.waitedSeconds < CONTEXT_RECOVERY.visibleWaitSeconds);
  assert.equal(frames(2), 1, 'the reload is offered exactly once');
  assert.ok(state.stalled);
  assert.equal(state.restore(), true);
  assert.equal(state.restores, 1);
  assert.ok(!state.lost && !state.stalled);
  assert.equal(state.frame(now, false), false, 'no waiting without a loss');
  assert.equal(state.lose(), true, 'a later loss starts a fresh wait');
  assert.equal(state.losses, 2);
  assert.equal(state.waitedSeconds, 0);
});

/** A renderer whose programs compile until the test says they are ready. */
function compilingRenderer({ lost = false, parallel = true } = {}) {
  const gl = {
    lost,
    isContextLost() {
      return this.lost;
    },
  };
  const programs = new Map();
  return {
    gl,
    programs,
    compiled: 0,
    getContext: () => gl,
    extensions: { has: (name) => parallel && name === 'KHR_parallel_shader_compile' },
    properties: { get: (material) => ({ currentProgram: programs.get(material) }) },
    compile(scene) {
      this.compiled++;
      const materials = new Set();
      scene.traverse((node) => {
        if (!node.material) return;
        materials.add(node.material);
        programs.set(node.material, {
          ready: false,
          isReady() {
            return this.ready;
          },
        });
      });
      return materials;
    },
  };
}

test('compiling never hangs on a lost or restored context', async () => {
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()));
  const camera = new THREE.PerspectiveCamera();
  const lost = compilingRenderer({ lost: true });
  await compileScene(lost, scene, camera);
  assert.equal(lost.compiled, 0, 'nothing is compiled into a lost context');
  const renderer = compilingRenderer();
  let done = false;
  const compiling = compileScene(renderer, scene, camera).then(() => (done = true));
  await wait(40);
  assert.equal(done, false, 'it waits for the programs');
  for (const program of renderer.programs.values()) program.ready = true;
  await compiling;
  // Lost while compiling: polling a lost context would never complete.
  const losing = compilingRenderer();
  const lostCompile = compileScene(losing, scene, camera);
  await wait(30);
  losing.gl.lost = true;
  await lostCompile;
  // Restored while compiling: Three replaced its program store; the old programs are gone.
  const restoring = compilingRenderer();
  const restoredCompile = compileScene(restoring, scene, camera);
  await wait(30);
  restoring.properties = { get: () => ({}) };
  await restoredCompile;
  // Without parallel compilation every program is ready at once, as in Three.
  const serial = compilingRenderer({ parallel: false });
  const serialCompile = compileScene(serial, scene, camera);
  for (const program of serial.programs.values()) program.ready = true;
  await serialCompile;
});

/** A playing world without WebGL: the real lifecycle methods and frame loop body. */
function playingWorld() {
  const events = [],
    rendered = [],
    resized = [],
    warmups = [],
    redrawn = [];
  const world = Object.assign(Object.create(WorldRenderer.prototype), {
    canvas: { dataset: {}, style: {} },
    // The events come from a lost context; context-release.test.mjs drives a real renderer.
    renderer: {
      getContext: () => ({ isContextLost: () => true }),
      info: { memory: { geometries: 0, textures: 0 } },
    },
    disposed: false,
    failed: false,
    assetsReady: true,
    selfId: 'self',
    loadingCave: null,
    graphicsContext: new GraphicsContextState(),
    onGraphicsContext: (event) => events.push(event),
    frameClock: new FrameClock(performance.now()),
    motionLastFrame: null,
    pointer: { id: 1, dragged: true },
    graphics: { ready: (now) => warmups.push(now), observe: () => false },
    landscapes: ['valley-pine', 'valley-boulder'].map((key) => ({
      impostor: { draw: () => redrawn.push(key) },
    })),
    occluded: () => false,
    render: (time) => rendered.push(time),
    resize: (force) => resized.push(force),
    cancel() {
      this.pointer = null;
    },
  });
  return { world, events, rendered, resized, warmups, redrawn };
}

test('a lost context pauses drawing in the same loop and restoration resumes the current view', (t) => {
  const document = { hidden: false };
  let animationFrames = 0;
  globalsFor(t, { document, requestAnimationFrame: () => ++animationFrames });
  const { world, events, rendered, resized, warmups, redrawn } = playingWorld();
  const start = performance.now() + 1000;
  world.tick(start);
  assert.equal(rendered.length, 1);
  world.loseGraphicsContext();
  world.loseGraphicsContext();
  assert.deepEqual(events, ['lost'], 'one loss, however many events');
  assert.equal(world.pointer, null, 'a camera drag in progress ends');
  assert.equal(world.canvas.dataset.webglContext, 'lost');
  assert.equal(world.failed, false, 'a temporary loss is not a failure');
  assert.equal(world.assetsReady, true, 'the loaded world is kept');
  for (let now = start + 33; now < start + 3000; now += 33) world.tick(now);
  assert.equal(rendered.length, 1, 'nothing is drawn while the context is lost');
  world.restoreGraphicsContext();
  world.restoreGraphicsContext();
  assert.deepEqual(events, ['lost', 'restored']);
  assert.deepEqual(resized, [true], 'the drawing buffer is applied again');
  assert.equal(warmups.length, 1, 'the safety-scale measurement restarts');
  assert.deepEqual(redrawn, ['valley-pine', 'valley-boulder'], 'GPU-only far views are redrawn');
  assert.equal(world.motionLastFrame, null, 'the gap is not a slow frame');
  world.tick(start + 6000);
  assert.equal(rendered.length, 2, 'the same loop draws again');
  assert.equal(animationFrames, 0, 'neither loss nor restore starts another animation loop');
  assert.equal(world.canvas.dataset.webglRestores, '1');
});

test('a context that stays lost offers a reload after visible waiting only', (t) => {
  const document = { hidden: true };
  globalsFor(t, { document });
  const { world, events } = playingWorld();
  world.loseGraphicsContext();
  let now = performance.now() + 1000;
  for (const end = now + 60_000; now < end; now += 33) world.tick(now);
  assert.deepEqual(events, ['lost'], 'background time does not count');
  document.hidden = false;
  for (const end = now + (CONTEXT_RECOVERY.visibleWaitSeconds + 1) * 1000; now < end; now += 33)
    world.tick(now);
  assert.deepEqual(events, ['lost', 'stalled']);
  assert.equal(world.canvas.dataset.webglContext, 'stalled');
  // A late restoration still resumes.
  world.restoreGraphicsContext();
  assert.deepEqual(events, ['lost', 'stalled', 'restored']);
});

test('a verified-asset failure during a loss stays fatal, and a disposed world is never revived', (t) => {
  globalsFor(t, { document: { hidden: false }, cancelAnimationFrame: () => {} });
  t.mock.method(console, 'error', () => {});
  const { world, events } = playingWorld();
  const errors = [];
  Object.assign(world, {
    frame: 1,
    loadProgress: { phase: 'ready' },
    loadingLabel: null,
    onError: (message) => errors.push(message),
  });
  world.loseGraphicsContext();
  WorldRenderer.prototype.failWorld.call(
    world,
    '検証済みの3D素材を読み込めませんでした。',
    new Error('integrity mismatch'),
  );
  world.restoreGraphicsContext();
  world.loseGraphicsContext();
  assert.deepEqual(events, ['lost'], 'a failed world is not resumed or re-reported');
  assert.equal(errors.length, 1);
  assert.equal(world.failed, true);
  assert.equal(world.assetsReady, false);
  assert.equal(world.canvas.style.visibility, 'hidden');
  const disposed = playingWorld();
  disposed.world.loseGraphicsContext();
  disposed.world.disposed = true;
  disposed.world.restoreGraphicsContext();
  disposed.world.loseGraphicsContext();
  assert.deepEqual(disposed.events, ['lost'], 'restore after disposal is ignored');
});

test('far-view impostors keep their source scene and draw again into the same target', () => {
  const draws = [];
  const renderer = {
    target: null,
    extensions: { has: () => false },
    getRenderTarget() {
      return this.target;
    },
    setRenderTarget(target) {
      this.target = target;
    },
    getClearColor: (color) => color.set(0xffffff),
    getClearAlpha: () => 1,
    setClearColor() {},
    clear() {},
    render(scene) {
      draws.push({ scene, target: this.target });
    },
  };
  const source = new THREE.Group();
  source.add(new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshStandardMaterial()));
  const assets = new WorldAssets();
  assets.templates.set('valley-boulder', {
    asset: { modelKey: 'valley-boulder', heightMetres: 1.7 },
    gltf: { scene: source },
    lods: [{ scene: source.clone(true) }],
  });
  const landscape = new LandscapeInstances({
    assets,
    key: 'valley-boulder',
    placements: [],
    renderer,
    scene: new THREE.Scene(),
    distances: [28, 50, 110],
  });
  assert.equal(draws.length, 1);
  landscape.impostor.draw();
  assert.equal(draws.length, 2);
  assert.equal(draws[1].scene, draws[0].scene, 'the same retained source scene');
  assert.equal(draws[1].target, landscape.impostor.target, 'into the texture the billboards use');
  assert.equal(renderer.target, null, 'the previous target is restored');
  landscape.dispose();
});

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
    getContext: () => new Proxy({}, { get: () => () => {}, set: () => true }),
  };
}

test('the gallery finishes preparing while the context is lost and holds no keys through it', async (t) => {
  globalsFor(t, {
    document: {
      hidden: false,
      hasFocus: () => false,
      createElement: element,
      body: { classList: { add() {}, remove() {} } },
      addEventListener() {},
    },
    window: { addEventListener() {} },
    requestAnimationFrame: (callback) => setImmediate(() => callback(0)),
  });
  let compiled = 0;
  const avatar = {
    root: new THREE.Group(),
    animation: { name: 'Idle_Loop', update() {} },
    dispose() {},
  };
  // The ten images pass the game's verified download and decoder; only the network
  // and the image element are stand-ins (camp-cave-fixture.mjs).
  const asset = caveGalleryImages(),
    network = caveImageNetwork(asset);
  const world = {
    canvas: { parentElement: element(), dataset: {} },
    worldAssets: {
      loadCatalog: async () => ({ assets: [] }),
      ensureInitial: async () => ({ asset }),
      create: () => {
        const scene = new THREE.Group();
        scene.add(
          new THREE.Mesh(new THREE.BoxGeometry(30, 6, 80), new THREE.MeshStandardMaterial()),
        );
        return scene;
      },
    },
    humanAssets: new Map([['cro-magnon-woman', { create: async () => avatar }]]),
    renderer: {
      getContext: () => ({ isContextLost: () => true }),
      compile: () => {
        compiled++;
        return new Set();
      },
      render() {},
      capabilities: { getMaxAnisotropy: () => 1 },
    },
    collision: new CollisionWorld(),
    camera: { aspect: 1 },
    loadProgress: { phase: 'download', loaded: 0, total: 0 },
  };
  const cave = new LoadingCave(
    world,
    () => {},
    () => {},
    { character: 'cro-magnon-woman', images: network.options },
  );
  await cave.load();
  assert.equal(compiled, 0, 'compiling waits for the restored context');
  assert.equal(world.canvas.dataset.loadingCave, 'exploring');
  assert.equal(network.images.length, 10, 'every verified image decoded while lost');
  assert.equal(network.blobs.size, 0, 'every blob URL revoked');
  // Keys held as the context is lost are forgotten, not replayed after restoration.
  cave.keys.add('w');
  cave.stick = { x: 1, y: 0 };
  cave.releaseInput();
  assert.equal(cave.keys.size, 0);
  assert.deepEqual(cave.stick, { x: 0, y: 0 });
  assert.ok(
    network.images.every((image) => image.closed === 0),
    'the gallery still owns its images',
  );
  cave.dispose();
  assert.ok(
    network.images.every((image) => image.closed === 1),
    'leaving releases each image once',
  );
});
