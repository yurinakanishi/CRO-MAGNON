// Before/after in-game performance and appearance captures for the 2026-10 asset remake.
// Isolated in-memory server (never port 3000), one real Chrome view + four protocol peers.
// Positions/camera are scene preparation on this throwaway server, not user input.
// Usage: PERF_LABEL=before node scripts/remake/qa-remake-perf.mjs
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { WebSocket } from 'ws';
import { createGameServer } from '../../dist/server.mjs';
const { chromium } =
  await import('file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');

const label = process.env.PERF_LABEL ?? 'run';
const out = path.resolve(process.env.PERF_OUT ?? `output/asset-remake/perf/${label}`);
const duration = Number(process.env.PERF_MS ?? 12000);
const width = Number(process.env.PERF_W ?? 1280),
  height = Number(process.env.PERF_H ?? 800);
await mkdir(out, { recursive: true });
const game = createGameServer({ port: 0, host: '127.0.0.1' });
const { port } = await game.listen();
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'],
});
const context = await browser.newContext({ viewport: { width, height } });
const page = await context.newPage();
const errors = [],
  peers = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, label, timeout = 180000) {
  const end = Date.now() + timeout;
  while (!(await fn())) {
    if (Date.now() > end) throw Error(label);
    await sleep(100);
  }
}
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 500)); });
const step = (m) => console.error(`[${new Date().toISOString().slice(11, 19)}] ${m}`);
await page.addInitScript(() => {
  localStorage.setItem('cro-graphics-quality', 'standard');
  performance.setResourceTimingBufferSize(5000);
});
const normal = game.server.listeners('request')[0];
game.server.removeAllListeners('request');
game.server.on('request', async (request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  if (url.pathname === '/src/world3d.js') {
    const body = Buffer.from(
      (await readFile('dist/src/world3d.js', 'utf8')) +
        '\nconst __r=WorldRenderer.prototype.render;WorldRenderer.prototype.render=function(...a){window.qa=this;return __r.apply(this,a);};',
    );
    response.writeHead(200, { 'Content-Type': 'text/javascript', 'Content-Length': body.length });
    return response.end(body);
  }
  return normal(request, response);
});

async function measure(name) {
  const r = await page.evaluate(async (duration) => {
    const start = performance.now(),
      intervals = [];
    let last = start,
      frame = qa.renderer.info.render.frame,
      calls = [],
      tris = [];
    await new Promise((resolve) => {
      const rec = (now) => {
        if (qa.renderer.info.render.frame !== frame) {
          intervals.push(now - last);
          last = now;
          frame = qa.renderer.info.render.frame;
          calls.push(qa.renderer.info.render.calls);
          tris.push(qa.renderer.info.render.triangles);
        }
        if (now - start >= duration) resolve();
        else requestAnimationFrame(rec);
      };
      requestAnimationFrame(rec);
    });
    const s = [...intervals].sort((a, b) => a - b),
      q = (p) => s[Math.min(s.length - 1, Math.floor(s.length * p))];
    const gl = qa.renderer.getContext(),
      ext = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      frames: intervals.length,
      averageFps: (intervals.length * 1000) / (performance.now() - start),
      frameMs: { p50: q(0.5), p95: q(0.95), p99: q(0.99), max: s.at(-1) },
      drawCalls: { min: Math.min(...calls), max: Math.max(...calls) },
      triangles: { min: Math.min(...tris), max: Math.max(...tris) },
      geometries: qa.renderer.info.memory.geometries,
      textures: qa.renderer.info.memory.textures,
      heapMB: performance.memory ? performance.memory.usedJSHeapSize / 1e6 : null,
      gpu: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      drawingBuffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
    };
  }, duration);
  await page.screenshot({ path: path.join(out, `${name}.png`) });
  return r;
}

const result = { label, viewport: [width, height], scenes: {} };
try {
  const t0 = Date.now();
  step('goto');
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.locator('#title-start').click();
  await page.locator('#setup-form .character-choice:has(input[value="cro-female"])').click();
  await page.locator('#setup-flow-yes').click();
  await page
    .locator('#world[data-world-asset="ready"][data-character-asset="ready"]')
    .waitFor({ timeout: 300000 });
  result.worldReadyMs = Date.now() - t0;
  step('world ready');
  await until(() => game.rooms.get('EMBER')?.players.size === 1, 'browser joined');
  const room = game.rooms.get('EMBER');
  const species = ['cro', 'nea', 'cat', 'howkey'];
  for (let i = 0; i < 4; i++) {
    const ws = new WebSocket(
      `ws://127.0.0.1:${port}/ws?${new URLSearchParams({ room: 'EMBER', name: `Perf${i}`, species: species[i], gender: i % 2 ? 'female' : 'male' })}`,
    );
    peers.push(ws);
    await new Promise((res, rej) => {
      ws.once('open', res);
      ws.once('error', rej);
    });
  }
  await until(() => room.players.size === 5, 'five players');
  const players = [...room.players.values()];
  const place = (cx, cz, facing = Math.PI) =>
    players.forEach((p, i) =>
      Object.assign(p, {
        x: cx + [0, -2, 2, -1.2, 1.2][i],
        z: cz + [0, -1, -1, -3, -3][i],
        facing,
        moving: false,
      }),
    );
  // Scene 1: camp, five players, companions and orb bots.
  place(49, 58);
  await page.waitForFunction(() => qa.players.size === 5 && [...qa.players.values()].every((e) => e.actor), null, { timeout: 180000 });
  await page.evaluate(() => { Object.assign(qa, { yaw: 0, pitch: 0.25, targetDistance: 8 }); });
  await sleep(8000);
  step('measure camp');
  result.scenes.camp = await measure('camp');
  // Scene 2: mammoth meadow close view.
  const mammoth = room.animals?.[0] ?? null;
  if (mammoth) {
    place(mammoth.x + 9, mammoth.z + 2, -Math.PI / 2);
    await sleep(6000);
    await page.evaluate(() => { Object.assign(qa, { pitch: 0.18, targetDistance: 9 }); });
    await sleep(2500);
    step('measure mammoth');
    result.scenes.mammoth = await measure('mammoth');
  }
  // Scene 3: wide camp overview (many props, LOD mix).
  place(50, 70);
  await page.evaluate(() => { Object.assign(qa, { yaw: 0, pitch: 0.55, targetDistance: 22 }); });
  await sleep(7000);
  result.scenes.overview = await measure('overview');
  const resources = await page.evaluate(() =>
    performance.getEntriesByType('resource').map((r) => ({
      name: new URL(r.name).pathname,
      ms: r.duration,
      bytes: r.decodedBodySize,
    })),
  );
  result.loadedModelBytes = resources
    .filter((r) => r.name.endsWith('.glb'))
    .reduce((s, r) => s + (r.bytes || 0), 0);
  result.loadedModels = resources.filter((r) => r.name.endsWith('.glb')).length;
  result.errors = errors;
} catch (e) {
  result.failure = String(e?.stack ?? e);
  result.errors = errors;
} finally {
  await writeFile(path.join(out, 'perf.json'), JSON.stringify(result, null, 2));
  for (const ws of peers) ws.close();
  await browser.close();
  await game.close();
}
console.log(JSON.stringify(result, null, 1).slice(0, 3000));
