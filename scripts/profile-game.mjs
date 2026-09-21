// Isolated server and real Chrome. Position changes are scene fixtures, not gameplay.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createGameServer } from '../dist/server.mjs';
import { stopActor } from '../dist/shared/combat.mjs';
import { CASTLE_GATE } from '../dist/shared/castle-layout.mjs';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);
const variant = process.argv[2] || 'current';
const savedBaseline = process.argv.includes('--saved-baseline');
const viewport = process.argv.includes('--full-hd')
  ? { width: 1920, height: 1080 }
  : { width: 1280, height: 800 };
const folder = `output/playwright/performance-2026-09-19/${variant}`;
await mkdir(folder, { recursive: true });
const game = createGameServer({ port: 0, host: '127.0.0.1' });
const { port } = await game.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport });
const errors = [],
  measurements = [];
let wire = null;
page.on('websocket', (socket) =>
  socket.on('framereceived', ({ payload }) => {
    if (wire) {
      wire.messages++;
      wire.bytes += Buffer.byteLength(payload);
    }
  }),
);
const stats = (values) => {
  const s = [...values].sort((a, b) => a - b);
  return {
    mean: s.reduce((a, b) => a + b, 0) / s.length,
    median: s[Math.floor(s.length * 0.5)],
    p95: s[Math.ceil(s.length * 0.95) - 1],
    max: s.at(-1),
  };
};
page.on('pageerror', (e) => {
  errors.push(String(e));
  console.error(String(e));
});
page.on('console', (m) => {
  if (m.type() === 'error') {
    errors.push(m.text());
    console.error(m.text());
  }
});
await page.addInitScript(() => {
  localStorage.setItem('cro-name', 'Performance QA');
  localStorage.setItem('cro-species', 'cro');
  localStorage.setItem('cro-gender', 'female');
  window.perfFrames = [];
  window.perfTasks = [];
  window.perfParts = {};
  new PerformanceObserver((list) => {
    if (window.perfCollect)
      window.perfTasks.push(
        ...list.getEntries().map((e) => ({ at: e.startTime, duration: e.duration })),
      );
  }).observe({ type: 'longtask', buffered: true });
});
if (savedBaseline)
  await page.route(/\/(src|shared)\/[^?]+\.(m?js)(\?.*)?$/, async (route) => {
    const file = new URL(route.request().url()).pathname;
    await route.fulfill({
      contentType: 'text/javascript',
      body: await readFile(`output/performance-2026-09-19/baseline-dist${file}`, 'utf8'),
    });
  });
await page.route('**/src/world3d.js', async (route) => {
  const response = await route.fetch();
  const code = savedBaseline
    ? await readFile('output/performance-2026-09-19/baseline-dist/src/world3d.js', 'utf8')
    : await response.text();
  await route.fulfill({
    response,
    body:
      code +
      `
const original=WorldRenderer.prototype.render;
WorldRenderer.prototype.render=function(...args){
  window.perfWorld=this;
  const start=performance.now(); const result=original.apply(this,args);
  if(window.perfCollect) window.perfFrames.push({at:start,cpu:performance.now()-start,calls:this.renderer.info.render.calls,triangles:this.renderer.info.render.triangles,programs:this.renderer.info.programs.length,lights:this.fires.filter(f=>f.light.visible).length});
  return result;
};`,
  });
});
try {
  await page.goto(`http://127.0.0.1:${port}/?room=PERFORMANCE-QA`);
  await page.locator('#title-start').click();
  await page.locator('#setup-form .character-choice:has(input:checked)').click();
  await page.locator('#setup-flow [data-choose-difficulty="normal"]').click();
  await page.locator('#setup-flow-yes').click();
  await page
    .locator('#world[data-world-asset="ready"][data-character-asset="ready"]')
    .waitFor({ timeout: 120000 })
    .catch(async (error) => {
      console.error(
        await page.evaluate(() => ({
          dataset: { ...document.querySelector('#world').dataset },
          banks: window.perfWorld?.openWorld?.bankJobs?.size,
          pending: window.perfWorld?.openWorld?.bankBuilder?.jobs?.size,
        })),
      );
      throw error;
    });
  const room = game.rooms.get('PERFORMANCE-QA');
  const me = () => [...room.players.values()][0];
  const cdp = await page.context().newCDPSession(page);
  if (process.argv.includes('--cpu4'))
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  for (const [scene, point, yaw] of [
    ['camp', { x: 50, z: 62 }, -0.28],
    ['cave', { x: 34.5, z: 130.5 }, Math.PI],
    ['castle', { x: CASTLE_GATE.x, z: CASTLE_GATE.z - 6 }, Math.PI],
  ]) {
    if (process.argv.includes('--camp-only') && scene !== 'camp') continue;
    if (process.argv.includes('--castle-only') && scene !== 'castle') continue;
    stopActor(me());
    Object.assign(me(), point, { energy: 100 });
    await page.evaluate((yaw) => {
      perfWorld.yaw = yaw;
    }, yaw);
    await page.waitForTimeout(10000);
    await page.evaluate(async () => {
      const w = perfWorld;
      const THREE = await import('/vendor/three.module.js');
      // Time inclusive subsystem work; nested totals must not be added together.
      for (const [obj, key, label] of [
        [THREE.SkinnedMesh.prototype, 'computeBoundingSphere', 'skinBounds'],
        [w, 'updateLabels', 'labels'],
        [w.collision, 'cameraDistance', 'cameraCollision'],
        [w.collision, 'move', 'bodyCollision'],
        [w.landmarks?.castleCamera, 'distance', 'castleRay'],
        [w.landmarks?.caveCamera, 'distance', 'caveRay'],
        [w.openWorld, 'update', 'terrain'],
        [w.landmarks, 'update', 'landmarks'],
        [w.regionalScenery, 'update', 'scenery'],
        [w.villageRenderer, 'update', 'village'],
        [w.renderer, 'render', 'webgl'],
      ]) {
        if (!obj || obj[key].perfWrapped) continue;
        const fn = obj[key];
        obj[key] = function (...args) {
          const start = performance.now();
          const r = fn.apply(this, args);
          if (window.perfCollect) {
            const v = (window.perfParts[label] ??= { ms: 0, calls: 0 });
            v.ms += performance.now() - start;
            v.calls++;
          }
          return r;
        };
        obj[key].perfWrapped = true;
      }
    });
    for (const moving of [false, true]) {
      wire = { messages: 0, bytes: 0 };
      await page.evaluate(() => {
        perfFrames = [];
        perfTasks = [];
        perfParts = {};
        perfCollect = true;
      });
      if (moving) {
        await page.locator('#world').focus();
        await page.keyboard.down('w');
      }
      await page.waitForTimeout(5000);
      if (moving) await page.keyboard.up('w');
      const data = await page.evaluate(() => {
        perfCollect = false;
        const w = perfWorld,
          gl = w.renderer.getContext(),
          debug = gl.getExtension('WEBGL_debug_renderer_info');
        return {
          frames: perfFrames,
          tasks: perfTasks,
          parts: perfParts,
          dataset: { ...w.canvas.dataset },
          graphics: debug
            ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)
            : gl.getParameter(gl.RENDERER),
          ratio: w.renderer.getPixelRatio(),
          memory: { ...w.renderer.info.memory },
          position: w.players.get(w.selfId).model.position.toArray(),
          camera: w.camera.position.toArray(),
          userAgent: navigator.userAgent,
        };
      });
      const summary = {
        scene,
        moving,
        frames: data.frames.length,
        frameMs: stats(data.frames.slice(1).map((f, i) => f.at - data.frames[i].at)),
        cpuMs: stats(data.frames.map((f) => f.cpu)),
        calls: stats(data.frames.map((f) => f.calls)),
        triangles: stats(data.frames.map((f) => f.triangles)),
        parts: data.parts,
        longTasks: data.tasks,
        wire,
      };
      wire = null;
      measurements.push({ ...summary, raw: data });
      console.log(JSON.stringify(summary));
      await page.screenshot({ path: `${folder}/${scene}-${moving ? 'walking' : 'idle'}.png` });
    }
    if (process.argv.includes('--profile')) {
      await cdp.send('Profiler.enable');
      await cdp.send('Profiler.start');
      await page.waitForTimeout(5000);
      const { profile } = await cdp.send('Profiler.stop');
      await writeFile(`${folder}/${scene}.cpuprofile`, JSON.stringify(profile));
      const nodes = new Map(profile.nodes.map((n) => [n.id, n]));
      const totals = new Map();
      profile.samples?.forEach((id, i) => {
        const n = nodes.get(id),
          key = n.callFrame.url.split('/').slice(-2).join('/') + ':' + n.callFrame.functionName;
        totals.set(key, (totals.get(key) || 0) + profile.timeDeltas[i] / 1000);
      });
      console.log(
        JSON.stringify({ scene, hot: [...totals].sort((a, b) => b[1] - a[1]).slice(0, 22) }),
      );
    }
  }
  assert.deepEqual(errors, []);
} finally {
  await writeFile(
    `${folder}/summary.json`,
    JSON.stringify(
      {
        variant,
        savedBaseline,
        viewport,
        cpuThrottle: process.argv.includes('--cpu4') ? 4 : 1,
        warmupMs: 10000,
        measurementMs: 5000,
        errors,
        measurements,
      },
      null,
      2,
    ),
  );
  await browser.close();
  await game.close();
}
