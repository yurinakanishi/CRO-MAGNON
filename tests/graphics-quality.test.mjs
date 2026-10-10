import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  FRAME_RATE,
  GraphicsBudget,
  MAX_DRAWING_PIXELS,
  SAFETY_BUFFER_SCALE,
} from '../dist/src/graphics-quality.js';
import { FrameClock } from '../dist/src/frame-clock.js';
import { WorldRenderer } from '../dist/src/world3d.js';
import { LoadingCave } from '../dist/src/loading-cave.js';
import { ActorUpdateBudget } from '../dist/src/actor-update-budget.js';
import { WorldAssets } from '../dist/src/world-assets.js';

/** Replace browser globals for one test; restored in reverse order afterwards. */
function globalsFor(t) {
  const restore = [];
  t.after(() => {
    while (restore.length) restore.pop()();
  });
  return (values) => {
    for (const [key, value] of Object.entries(values)) {
      const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
      Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
      restore.push(() =>
        descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key],
      );
    }
  };
}

/** Repeat an interval pattern (ms) for at least the given seconds. */
function frames(pattern, seconds) {
  const out = [];
  for (let total = 0, i = 0; total < seconds * 1000; i++) {
    out.push(pattern[i % pattern.length]);
    total += Number.isFinite(out.at(-1)) ? out.at(-1) : 0;
  }
  return out;
}

/** Feed drawn-frame intervals; NaN models the first frame after a hidden tab. */
function run(budget, start, intervals, active = () => true) {
  let now = start;
  const changes = [];
  for (const [index, ms] of intervals.entries()) {
    now += Number.isFinite(ms) ? ms : 1000;
    if (budget.observe(now, ms, active(now, index))) changes.push(now);
  }
  return { now, changes };
}

/** Intervals between frames actually drawn by the 30 FPS clock on a jittery display. */
function clockIntervals(hz, seconds) {
  const clock = new FrameClock(0),
    out = [];
  let last = null;
  for (let i = 0; i < hz * seconds; i++) {
    const now = (i * 1000) / hz + (i % 2 ? 0.7 : -0.7);
    if (clock.advance(now) === null) continue;
    if (last !== null) out.push(now - last);
    last = now;
  }
  return out;
}

function resizable(width, height) {
  const box = { width, height },
    calls = [];
  const canvas = {
    width: 300,
    height: 150,
    style: {},
    dataset: {},
    getBoundingClientRect: () => box,
  };
  // Mirrors WebGLRenderer: logical size, pixel ratio and the canvas drawing buffer.
  let size = [canvas.width, canvas.height],
    ratio = 1;
  const renderer = {
    getPixelRatio: () => ratio,
    getSize: (target) => target.set(...size),
    setDrawingBufferSize(w, h, r) {
      calls.push([w, h, r]);
      size = [w, h];
      ratio = r;
      canvas.width = Math.floor(w * r);
      canvas.height = Math.floor(h * r);
    },
  };
  const world = Object.assign(Object.create(WorldRenderer.prototype), {
    canvas,
    renderer,
    camera: new THREE.PerspectiveCamera(),
    touchCamera: { enabled: false },
    graphics: new GraphicsBudget(),
    fires: [],
  });
  return { world, canvas, calls, box };
}

test('stored auto/standard preferences and device probes cannot change the one profile', (t) => {
  const replace = globalsFor(t),
    storage = [];
  replace({ devicePixelRatio: 2 });
  for (const [stored, cores, memory] of [
    ['standard', 16, 32],
    ['auto', 16, 32],
    ['auto', 2, 1],
    ['low', 2, 1],
  ]) {
    replace({
      localStorage: {
        getItem: (key) => (storage.push(['get', key]), stored),
        setItem: (key) => storage.push(['set', key]),
        removeItem: (key) => storage.push(['remove', key]),
      },
      navigator: { hardwareConcurrency: cores, deviceMemory: memory },
    });
    const { world, canvas } = resizable(1920, 1080);
    world.resize();
    assert.equal(world.graphics.fps, FRAME_RATE);
    assert.equal(FRAME_RATE, 30);
    assert.equal(new FrameClock(0).interval, 1000 / 30);
    assert.equal(world.graphics.scale, 1);
    assert.ok(canvas.width * canvas.height <= MAX_DRAWING_PIXELS);
    assert.equal(canvas.dataset.safetyScale, '1');
  }
  assert.deepEqual(storage, [], 'the graphics preference is neither read nor written');
});

test('portrait and desktop drawing buffers stay within 720p at DPR 1, resizing only on change', (t) => {
  const replace = globalsFor(t);
  for (const [width, height, dpr] of [
    [3840, 2160, 2],
    [1920, 1080, 1.25],
    [1280, 800, 1.25],
    [1280, 720, 1],
    [390, 844, 3],
    [844, 390, 2],
    [320, 568, 2],
    [430, 932, 3],
    [800, 600, 0.8],
    [0, 0, 1],
  ]) {
    replace({ devicePixelRatio: dpr });
    const { world, canvas, calls } = resizable(width, height);
    world.resize();
    const label = `${width}x${height}@${dpr}`,
      ratio = world.renderer.getPixelRatio();
    assert.ok(canvas.width * canvas.height <= MAX_DRAWING_PIXELS, label);
    assert.ok(ratio <= 1 && ratio <= dpr, label);
    // Screens inside the budget keep every CSS pixel up to DPR 1.
    if (Math.max(1, width) * Math.max(1, height) <= MAX_DRAWING_PIXELS)
      assert.equal(ratio, Math.min(1, dpr), label);
    assert.deepEqual(canvas.style, {}, `${label}: the DOM size is never reduced`);
    assert.equal(canvas.dataset.drawingBuffer, `${canvas.width}x${canvas.height}`);
    assert.equal(canvas.dataset.pixelRatio, ratio.toFixed(3));
    world.resize();
    assert.equal(calls.length, 1, `${label}: an unchanged size keeps its drawing buffer`);
  }
  replace({ devicePixelRatio: 3 });
  const phone = resizable(390, 844);
  phone.world.resize();
  Object.assign(phone.box, { width: 844, height: 390 });
  phone.world.resize();
  phone.world.resize();
  assert.equal(phone.calls.length, 2, 'rotation reallocates once');
  assert.equal(`${phone.canvas.width}x${phone.canvas.height}`, '844x390');
});

test('sustained active rendering below 20 FPS lowers the buffer scale once, after warmup', (t) => {
  const budget = new GraphicsBudget();
  budget.ready(0);
  const slow = run(budget, 0, frames([60], 60));
  assert.equal(slow.changes.length, 1);
  // An 8 s warmup, then three consecutive slow 3 s windows.
  assert.ok(slow.changes[0] > 16900 && slow.changes[0] < 17100, String(slow.changes[0]));
  assert.equal(budget.scale, SAFETY_BUFFER_SCALE);
  // One step per session: neither lower again nor back up, whatever follows.
  const after = run(budget, slow.now, [...frames([120], 30), ...frames([1000 / 30], 60)]);
  assert.deepEqual(after.changes, []);
  assert.equal(budget.scale, SAFETY_BUFFER_SCALE);
  for (const [label, pattern] of [
    ['15 FPS', [1000 / 15]],
    ['19 FPS on a variable-refresh display', [1000 / 19]],
    ['60 Hz 20/15 FPS vsync steps', [50, 200 / 3, 50, 200 / 3, 200 / 3]],
  ]) {
    const overloaded = new GraphicsBudget();
    overloaded.ready(0);
    assert.equal(run(overloaded, 0, frames(pattern, 30)).changes.length, 1, label);
    assert.equal(overloaded.scale, SAFETY_BUFFER_SCALE, label);
  }
  // The safety step reallocates the buffer once, at 0.75 of the same budget, and
  // point sprites sized at creation keep their on-screen size.
  globalsFor(t)({ devicePixelRatio: 1 });
  const { world, canvas, calls } = resizable(1280, 800);
  const spark = { value: 0 },
    mist = { value: 0 };
  world.fires = [{ sparks: { material: { uniforms: { scale: spark } } } }];
  world.marsh = { mist: { material: { uniforms: { pixelScale: mist } } } };
  world.resize();
  const full = world.renderer.getPixelRatio();
  assert.equal(`${canvas.width}x${canvas.height}`, '1214x758');
  world.graphics.ready(0);
  const step = run(world.graphics, 0, frames([60], 30));
  assert.equal(step.changes.length, 1);
  world.resize();
  world.resize();
  assert.equal(calls.length, 2);
  assert.equal(world.renderer.getPixelRatio(), full * SAFETY_BUFFER_SCALE);
  assert.equal(canvas.dataset.safetyScale, String(SAFETY_BUFFER_SCALE));
  assert.equal(spark.value, world.renderer.getPixelRatio());
  assert.equal(mist.value, world.renderer.getPixelRatio());
});

test('the 30 FPS cap, the 20 FPS vsync step and isolated stalls never lower the buffer', () => {
  for (const [label, intervals] of [
    ...[30, 60, 120, 144, 240].map((hz) => [
      `${hz} Hz display at the cap`,
      clockIntervals(hz, 120),
    ]),
    ['the cap with missed vsyncs', frames([1000 / 30, 1000 / 30, 1000 / 30, 50], 120)],
    ['exactly 20 FPS', frames([50], 120)],
    ['the 20 FPS step of a 59.94 Hz display', frames([3000 / 59.94], 120)],
    ['22 FPS with a 240 ms stall every 1.6 s', frames([...Array(30).fill(1000 / 22), 240], 120)],
    ['the cap with 600 ms stalls', frames([...Array(90).fill(1000 / 30), 600], 120)],
  ]) {
    const budget = new GraphicsBudget();
    budget.ready(0);
    assert.deepEqual(run(budget, 0, intervals).changes, [], label);
    assert.equal(budget.scale, 1, label);
  }
});

test('loading, inactive views, timing gaps and hidden-tab resumes restart the measurement', () => {
  const slow = frames([60], 120);
  // Control: the same frames lower the scale when uninterrupted.
  const control = new GraphicsBudget();
  control.ready(0);
  assert.equal(run(control, 0, slow).changes.length, 1);
  // Before the world is ready nothing is measured, however long or slow.
  assert.deepEqual(run(new GraphicsBudget(), 0, slow).changes, []);
  const interrupted = (active, intervals = slow) => {
    const budget = new GraphicsBudget();
    budget.ready(0);
    return run(budget, 0, intervals, active).changes;
  };
  // A covered or otherwise inactive view for one frame every 8 s (map, menu, title).
  assert.deepEqual(
    interrupted((_, index) => index % 133 !== 0),
    [],
  );
  // A timing gap (long stall, suspended page) every 8 s.
  assert.deepEqual(interrupted(undefined, frames([...Array(133).fill(60), 300], 120)), []);
  // The first frame after a hidden tab has no interval.
  assert.deepEqual(interrupted(undefined, frames([...Array(133).fill(60), NaN], 120)), []);
});

test('the loading cave and the world draw through one 30 FPS clock; cave frames never lower the buffer', (t) => {
  const element = () => ({
    dataset: {},
    style: {},
    setAttribute() {},
    addEventListener() {},
    querySelector: element,
    append() {},
    remove() {},
  });
  const document = {
    hidden: false,
    hasFocus: () => true,
    createElement: element,
    body: { classList: { add() {}, remove() {} } },
    addEventListener() {},
  };
  globalsFor(t)({ document, window: { addEventListener() {} } });
  const world = Object.assign(Object.create(WorldRenderer.prototype), {
    canvas: { parentElement: element(), dataset: {} },
    frameClock: new FrameClock(0),
    graphics: new GraphicsBudget(),
    motionLastFrame: null,
    selfId: 'self',
    assetsReady: true,
    occluded: () => false,
    onFrameTiming: null,
  });
  const cave = new LoadingCave(
    world,
    () => {},
    () => {},
  );
  // The cave's gallery lights cast no shadows; it shares the world's renderer.
  cave.scene.traverse((node) => {
    if (node.isLight) assert.equal(node.castShadow, false);
  });
  let caveFrames = 0,
    worldFrames = 0,
    resizes = 0;
  const render = cave.render.bind(cave);
  cave.render = (dt) => {
    caveFrames++;
    render(dt);
  };
  world.loadingCave = cave;
  world.renderWorld = () => worldFrames++;
  world.resize = () => resizes++;
  world.graphics.ready(0);
  let now = 0;
  const tickUntil = (end, hz) => {
    for (; now < end; now += 1000 / hz) world.tick(now);
  };
  tickUntil(4000, 144);
  assert.ok(caveFrames >= 119 && caveFrames <= 121, `${caveFrames} cave frames in 4 s`);
  assert.equal(worldFrames, 0);
  // A device exploring the cave at 15 FPS for a minute is not measured as world load.
  tickUntil(64000, 15);
  assert.equal(world.graphics.scale, 1);
  cave.dispose();
  world.loadingCave = null;
  let start = now;
  tickUntil(start + 4000, 144);
  assert.ok(worldFrames >= 119 && worldFrames <= 121, `${worldFrames} world frames in 4 s`);
  // 15 FPS in the world, then a hidden tab. Without a restart the resumed frames
  // would complete the third slow window within about 6 s.
  tickUntil(now + 5000, 15);
  document.hidden = true;
  tickUntil(now + 30000, 60);
  document.hidden = false;
  start = now;
  tickUntil(start + 10000, 15);
  assert.equal(world.graphics.scale, 1, 'a hidden tab restarts the measurement');
  assert.equal(resizes, 0);
  tickUntil(start + 15000, 15);
  assert.equal(world.graphics.scale, SAFETY_BUFFER_SCALE);
  assert.equal(resizes, 1, 'the one safety step resizes once');
  tickUntil(now + 30000, 15);
  assert.equal(resizes, 1);
});

test('the world lighting has no shadow-casting sun', () => {
  const world = Object.assign(Object.create(WorldRenderer.prototype), {
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(),
  });
  world.setupLighting();
  const lights = [];
  world.scene.traverse((node) => {
    if (node.isLight) lights.push(node);
  });
  assert.ok(lights.includes(world.sun) && lights.includes(world.hemisphere));
  // Three.js renders a shadow map only for shadow-casting lights.
  assert.ok(lights.every((light) => light.castShadow === false));
});

test('offscreen loops accumulate elapsed time, while re-entry and important actions sample immediately', () => {
  const budget = new ActorUpdateBudget(),
    camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  camera.updateMatrixWorld(true);
  budget.begin(camera);
  const actor = {},
    back = new THREE.Vector3(0, 0, 10),
    front = new THREE.Vector3(0, 0, -10);
  assert.equal(budget.step(actor, back, 10, 0, 0.016), 0.016);
  assert.equal(budget.step(actor, back, 10, 0.1, 0.016), null);
  assert.equal(budget.step(actor, front, 10, 0.11, 0.016), 0.11);
  assert.ok(budget.step(actor, back, 10, 0.12, 0.016, true) > 0);
  assert.equal(budget.step(actor, back, 10, 0.15, 0.016), null);
  assert.ok(budget.step(actor, back, 10, 0.34, 0.016) > 0.2);
});

test('deferred companions share the two-load queue and disposal prevents late resurrection', async () => {
  const jobs = [];
  let active = 0,
    max = 0;
  const assets = new WorldAssets({
    loadEnvironment: () =>
      new Promise((resolve) => {
        active++;
        max = Math.max(max, active);
        jobs.push(() => {
          active--;
          resolve({ scene: new THREE.Group() });
        });
      }),
  });
  assets.catalog = {
    assets: ['a', 'b', 'c'].map((modelKey) => ({ modelKey, kind: 'companion', lods: [] })),
  };
  const work = Promise.allSettled(['a', 'b', 'c'].map((k) => assets.ensureCompanion(k)));
  const first = assets.ensureCompanion('a');
  assert.equal(jobs.length, 2);
  jobs.shift()();
  await first;
  assert.ok(assets.templates.has('a'));
  assert.equal(max, 2);
  assets.dispose();
  for (const done of jobs) done();
  const outcomes = await work;
  assert.equal(outcomes[0].status, 'fulfilled');
  assert.equal(outcomes[1].status, 'rejected');
  assert.equal(outcomes[2].status, 'rejected');
  assert.equal(assets.templates.size, 0);
});
