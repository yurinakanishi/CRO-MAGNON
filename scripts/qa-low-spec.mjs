// Isolated in-memory five-player scene. Fixtures are prepared on this server only.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { WebSocket } from 'ws';
import { createGameServer } from '../dist/server.mjs';
import { MIME } from '../dist/infrastructure/node/static-files.mjs';
const { chromium } =
  await import('file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const build = path.resolve(process.env.PERF_BUILD ?? 'dist-cloudflare');
const out = process.env.PERF_OUT ?? `output/playwright/low-spec/${Date.now()}`;
const duration = Number(process.env.PERF_MS ?? 15000);
// A preference stored before the one fixed profile. It must be neither used nor rewritten.
const mode = process.env.PERF_MODE ?? 'standard';
await mkdir(out, { recursive: true });
const game = createGameServer({ port: 0, host: '127.0.0.1' });
const { port } = await game.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
const errors = [],
  peers = [],
  checks = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(fn, label, timeout = 120000) {
  const end = Date.now() + timeout;
  while (!(await fn())) {
    if (Date.now() > end) throw Error(label);
    await sleep(100);
  }
}
try {
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.addInitScript((mode) => {
    localStorage.setItem('cro-graphics-quality', mode);
    performance.setResourceTimingBufferSize(3000);
  }, mode);
  // Serve the exact public artifact. The small injected observer records real frames;
  // camera values below are scene preparation, never claimed as user input.
  const normalRequest = game.server.listeners('request')[0];
  game.server.removeAllListeners('request');
  game.server.on('request', async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (url.pathname.startsWith('/api/')) return normalRequest(request, response);
    const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const file = path.resolve(build, rel);
    if (path.relative(build, file).startsWith('..')) return response.writeHead(403).end();
    try {
      let body = await readFile(file);
      if (rel === 'src/world3d.js')
        body = Buffer.from(
          body.toString() +
            '\nconst originalRender=WorldRenderer.prototype.render;WorldRenderer.prototype.render=function(...args){window.qa=this;return originalRender.apply(this,args);};',
        );
      response.writeHead(200, {
        'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream',
        'Content-Length': body.length,
      });
      response.end(body);
    } catch {
      response.writeHead(404).end('Not found');
    }
  });
  await page.goto(`http://127.0.0.1:${port}/`);
  console.log('title loaded');
  await page.locator('#title-start').click();
  await page.locator('#setup-form .character-choice:has(input[value="cro-female"])').click();
  await page.locator('#setup-flow-yes').click();
  // Drawn frames per second: every frame of either scene is one renderer.render call.
  const drawnFps = (ms) =>
    page.evaluate(
      (ms) =>
        new Promise((resolve) => {
          const first = qa.renderer.info.render.frame,
            start = performance.now();
          setTimeout(
            () =>
              resolve(
                ((qa.renderer.info.render.frame - first) * 1000) / (performance.now() - start),
              ),
            ms,
          );
        }),
      ms,
    );
  let caveFps = null;
  // The online build opens the walkable loading cave and joins only on 世界へ進む.
  if (
    await page
      .locator('#loading-cave')
      .waitFor({ timeout: 15000 })
      .then(
        () => true,
        () => false,
      )
  ) {
    await page.locator('#loading-cave[data-world-ready="true"]').waitFor({ timeout: 180000 });
    caveFps = await drawnFps(3000);
    assert.ok(caveFps < 31, `loading cave drew ${caveFps} FPS`);
    checks.push(`loading cave capped at 30 FPS (${caveFps.toFixed(2)} drawn)`);
    await page.locator('[data-cave-proceed]').click();
  }
  await page
    .locator('#world[data-world-asset="ready"][data-character-asset="ready"]')
    .waitFor({ timeout: 180000 });
  console.log('world loaded');
  await until(() => game.rooms.get('EMBER')?.players.size === 1, 'one browser joined');
  const room = game.rooms.get('EMBER');
  const self = [...room.players.values()][0];
  for (let i = 0; i < 4; i++) {
    const ws = new WebSocket(
      `ws://127.0.0.1:${port}/ws?${new URLSearchParams({ room: 'EMBER', name: `Perf${i}`, species: ['nea', 'cat', 'bear', 'cro'][i], gender: 'female' })}`,
    );
    peers.push(ws);
    await new Promise((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });
  }
  await until(() => room.players.size === 5, 'five players');
  console.log('five players connected');
  const positions = [
    [49, 58],
    [47, 57],
    [51, 57],
    [48, 54],
    [52, 54],
  ];
  [...room.players.values()].forEach((p, i) =>
    Object.assign(p, { x: positions[i][0], z: positions[i][1], facing: Math.PI, moving: false }),
  );
  Object.assign(room.companion524, { x: 50, z: 56 });
  Object.assign(room.rimoNeko, { x: 50, z: 55 });
  await page.waitForFunction(
    () =>
      qa.players.size === 5 &&
      [...qa.players.values()].every((e) => e.actor) &&
      qa.orbBotRenderer?.bots.size === 45 &&
      qa.companion524Renderer &&
      qa.rimoNekoRenderer,
    { timeout: 180000 },
  );
  await page.evaluate(() => {
    qa.yaw = 0;
    qa.pitch = 0.25;
    qa.targetDistance = 8;
  });
  await sleep(8000);
  const result = await page.evaluate(async (duration) => {
    const start = performance.now(),
      intervals = [],
      samples = [];
    let last = start,
      frame = qa.renderer.info.render.frame,
      count = 0;
    await new Promise((resolve) => {
      const record = (now) => {
        if (qa.renderer.info.render.frame !== frame) {
          intervals.push(now - last);
          last = now;
          frame = qa.renderer.info.render.frame;
          count++;
        }
        if (samples.length === 0 || now - start >= samples.length * 1000)
          samples.push({
            elapsed: now - start,
            fps: Number(qa.canvas.dataset.fps),
            calls: qa.renderer.info.render.calls,
            triangles: qa.renderer.info.render.triangles,
            heap: performance.memory?.usedJSHeapSize,
            geometry: qa.renderer.info.memory.geometries,
            textures: qa.renderer.info.memory.textures,
          });
        if (now - start >= duration) resolve();
        else requestAnimationFrame(record);
      };
      requestAnimationFrame(record);
    });
    const sorted = intervals.sort((a, b) => a - b),
      gl = qa.renderer.getContext(),
      ext = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      elapsed: performance.now() - start,
      frames: count,
      p50: sorted[Math.floor(sorted.length * 0.5)],
      p95: sorted[Math.floor(sorted.length * 0.95)],
      samples,
      gpu: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      viewport: [innerWidth, innerHeight],
      drawingBuffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
      dataset: { ...qa.canvas.dataset },
      resources: performance.getEntriesByType('resource').map((r) => ({
        name: new URL(r.name).pathname,
        duration: r.duration,
        bytes: r.decodedBodySize,
      })),
    };
  }, duration);
  result.averageFps = (result.frames * 1000) / result.elapsed;
  checks.push('one real Chrome view plus four protocol clients, 45 bots and both companions');
  await page.screenshot({ path: `${out}/five-players.png` });
  // One fixed profile whatever was stored: 30 FPS, 720p at DPR ≤ 1, no sun shadow map.
  const profile = await page.evaluate(() => {
    let shadowLights = 0;
    qa.scene.traverse((node) => {
      if (node.isLight && node.castShadow) shadowLights++;
    });
    return {
      fps: qa.graphics.fps,
      safetyScale: qa.graphics.scale,
      shadowMap: qa.renderer.shadowMap.enabled,
      shadowLights,
      stored: localStorage.getItem('cro-graphics-quality'),
    };
  });
  assert.ok(result.drawingBuffer[0] * result.drawingBuffer[1] <= 1280 * 720);
  assert.equal(profile.fps, 30);
  assert.equal(result.dataset.fpsLimit, '30');
  assert.ok(result.averageFps < 31, `world drew ${result.averageFps} FPS`);
  assert.equal(profile.shadowMap, false);
  assert.equal(profile.shadowLights, 0);
  assert.equal(profile.stored, mode, 'the stale preference is not rewritten');
  checks.push(`stored "${mode}" ignored: 30 FPS world, drawing buffer within 720p, no shadow map`);
  await page.keyboard.press('Escape');
  await page.locator('[data-pause-tab="settings"]').click();
  assert.equal(await page.locator('[data-graphics]').count(), 0);
  checks.push('settings offer no quality selector');
  await page.screenshot({ path: `${out}/settings.png` });
  await page.locator('#modal-close').click();
  await page.locator('#world').focus();
  for (let i = 0; i < 9; i++) await page.keyboard.press('c');
  await until(
    () => room.orbBots.filter((b) => b.ownerId === self.id && b.mode === 'waiting').length === 9,
    'all nine land',
    15000,
  );
  await page.keyboard.press('q');
  await until(
    () => room.orbBots.filter((b) => b.ownerId === self.id && b.mode === 'following').length === 9,
    'all nine recall',
    15000,
  );
  checks.push('nine throws, wait and recall through keyboard');
  for (const [width, height] of [
    [390, 844],
    [844, 390],
  ]) {
    await page.setViewportSize({ width, height });
    await sleep(750);
    assert.ok(await page.evaluate(() => qa.canvas.width * qa.canvas.height <= 1280 * 720));
    await page.screenshot({ path: `${out}/${width}x${height}.png` });
  }
  checks.push('portrait and landscape viewport');
  await page.reload();
  await page.locator('#title-start').waitFor();
  assert.equal(await page.locator('#title-graphics, [data-graphics]').count(), 0);
  checks.push('title offers no quality selector after reload');
  assert.deepEqual(errors, []);
  await writeFile(
    `${out}/result.json`,
    JSON.stringify(
      { build, storedQuality: mode, duration, checks, errors, caveFps, profile, ...result },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      out,
      storedQuality: mode,
      caveFps,
      averageFps: result.averageFps,
      p95: result.p95,
      drawingBuffer: result.drawingBuffer,
      checks,
    }),
  );
} catch (error) {
  await page.screenshot({ path: `${out}/failure.png`, timeout: 5000 }).catch(() => {});
  await writeFile(
    `${out}/failure.json`,
    JSON.stringify({ error: String(error), errors, checks }, null, 2),
  );
  throw error;
} finally {
  for (const ws of peers) ws.close();
  await context.close();
  await browser.close();
  await game.close();
}
