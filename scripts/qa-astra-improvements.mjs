// Isolated room, actual Chrome and real controls. Route instrumentation observes
// rendering only; server position fixtures are explicitly recorded below.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { WebSocket } from 'ws';
import { createGameServer } from '../dist/server.mjs';
import { JOURNEY_STOPS } from '../dist/shared/biomes.mjs';
import { stopActor } from '../dist/shared/combat.mjs';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);
const variant = process.argv[2] || 'current';
assert.ok(['baseline', 'current'].includes(variant));
const folder = `output/playwright/astra-improvements/${variant}`;
await mkdir(folder, { recursive: true });
const game = createGameServer({ port: 0, host: '127.0.0.1' });
const { port } = await game.listen();
const roomName = 'ASTRA-QA',
  errors = [],
  checks = [],
  peers = [],
  measurements = [];
let browser;
const observer = `
const originalRender = WorldRenderer.prototype.render;
WorldRenderer.prototype.render = function(...args) {
  window.astraRenderer = this;
  const started = performance.now();
  const result = originalRender.apply(this, args);
  if (window.astraCollect && this.canvas.dataset.worldAsset === 'ready' && window.astraFrames.length < 300) {
    window.astraFrames.push({at: started, cpuMs: performance.now() - started,
      calls: this.renderer.info.render.calls, triangles: this.renderer.info.render.triangles,
      geometries: this.renderer.info.memory.geometries, textures: this.renderer.info.memory.textures,
      terrainUpdates: this.openWorld?.cullUpdates ?? null,
      terrainUploadBytes: this.openWorld?.uploadBytes ?? null});
  }
  return result;
};`;
async function open(name) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.addInitScript((name) => {
    localStorage.setItem('cro-name', name);
    localStorage.setItem('cro-species', 'cro');
    localStorage.setItem('cro-gender', 'female');
    window.astraFrames = [];
  }, name);
  if (variant === 'baseline')
    for (const file of ['open-world.js', 'world-assets.js']) {
      await page.route(`**/src/${file}`, async (route) =>
        route.fulfill({
          contentType: 'application/javascript',
          body: await readFile(`output/astra-improvements/baseline/${file}`, 'utf8'),
        }),
      );
    }
  await page.route('**/src/world3d.js', async (route) => {
    const response = await route.fetch();
    const source =
      variant === 'baseline'
        ? await readFile('output/astra-improvements/baseline/world3d.js', 'utf8')
        : await response.text();
    await route.fulfill({ response, body: source + observer });
  });
  await page.goto(`http://127.0.0.1:${port}/?room=${roomName}`);
  await page.locator('#title-start').click();
  await page.locator('#setup-form .character-choice:has(input:checked)').click();
  await page.locator('#setup-flow [data-choose-difficulty="normal"]').click();
  await page.locator('#setup-flow-yes').click();
  await ready(page);
  return page;
}
async function ready(page) {
  await page
    .locator('#world[data-world-asset="ready"][data-character-asset="ready"]')
    .waitFor({ timeout: 90000 });
  await page.waitForFunction(() => window.astraRenderer?.players.get(astraRenderer.selfId)?.actor);
}
async function measure(page, scene) {
  await page.waitForTimeout(8000);
  await page.evaluate(() => {
    window.astraFrames = [];
    window.astraCollect = true;
  });
  await page.waitForFunction(() => astraFrames.length >= 181, null, { timeout: 60000 });
  const data = await page.evaluate(() => {
    window.astraCollect = false;
    const gl = astraRenderer.renderer.getContext(),
      debug = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      frames: astraFrames,
      dataset: { ...document.querySelector('#world').dataset },
      graphics: debug
        ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)
        : gl.getParameter(gl.RENDERER),
      camera: astraRenderer.camera.position.toArray(),
      pixelRatio: astraRenderer.renderer.getPixelRatio(),
      userAgent: navigator.userAgent,
    };
  });
  const stats = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    return {
      mean: values.reduce((a, b) => a + b, 0) / values.length,
      median: sorted[Math.floor(sorted.length * 0.5)],
      p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
    };
  };
  const frameMs = stats(data.frames.slice(1).map((f, i) => f.at - data.frames[i].at));
  const cpuMs = stats(data.frames.map((f) => f.cpuMs));
  measurements.push({ scene, frameMs, cpuMs, ...data });
  await page.screenshot({ path: `${folder}/${scene}.png` });
  console.log(JSON.stringify({ scene, frameMs, cpuMs, graphics: data.graphics }));
}
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await open('Astra A');
  const room = game.rooms.get(roomName);
  const me = () => [...room.players.values()].find((p) => p.name === 'Astra A');
  // A reproducible starting position. Only the setup uses direct positioning.
  stopActor(me());
  assert.ok(room.collision.free({ x: 76, z: 68 }, me().radius));
  Object.assign(me(), { x: 76, z: 68 });
  await measure(page, 'camp-stationary');
  checks.push('joined and rendered the verified world');
  if (variant === 'current') {
    // The walking sight line is passed to the same canopy gate used while riding.
    assert.equal(
      await page.evaluate(() =>
        astraRenderer.landscapes
          .filter((l) => l.canopyOcclusion)
          .every((l) => l.viewUpdate?.hadFocus),
      ),
      true,
    );
    checks.push('walking camera excludes trees covering the player sight line');
    const first = measurements[0].frames[0],
      last = measurements[0].frames.at(-1);
    assert.equal(
      last.terrainUpdates,
      first.terrainUpdates,
      'stationary terrain must stop rebuilding',
    );
    assert.equal(last.terrainUploadBytes, first.terrainUploadBytes);
    const before = { x: me().x, z: me().z, attack: me().attackSequence ?? 0 };
    await page.locator('#world').focus();
    await page.keyboard.down('w');
    await page.waitForTimeout(1800);
    await page.keyboard.up('w');
    assert.ok(
      Math.hypot(me().x - before.x, me().z - before.z) > 1,
      'real W input moves the player',
    );
    await page.keyboard.press('f');
    await page.waitForTimeout(1000);
    assert.ok(me().attackSequence > before.attack, 'real F input attacks');
    const movingUpdates = await page.evaluate(() => astraRenderer.openWorld.cullUpdates);
    assert.ok(movingUpdates > last.terrainUpdates, 'movement invalidates terrain cache');
    checks.push('actual walking and attack; terrain resumes updating');
    // Inspect distant streaming as a scene fixture, not a claim of walking there.
    const snow = JOURNEY_STOPS.find((p) => /snow/.test(p.id));
    assert.ok(snow);
    stopActor(me());
    Object.assign(me(), { x: snow.x, z: snow.z });
    await page.waitForTimeout(4000);
    await measure(page, 'snow-stationary');
    stopActor(me());
    Object.assign(me(), { x: 76, z: 68 });
    await page.waitForTimeout(14000);
    await ready(page);
    checks.push('snow scene loaded and camp reloaded after regional eviction');
    const other = await open('Astra B');
    for (let i = 0; i < 3; i++) {
      const socket = new WebSocket(
        `ws://127.0.0.1:${port}/ws?` +
          new URLSearchParams({
            room: roomName,
            name: `Peer ${i}`,
            species: 'cro',
            gender: 'male',
          }),
      );
      await new Promise((resolve, reject) => {
        socket.once('open', resolve);
        socket.once('error', reject);
      });
      peers.push(socket);
    }
    await page.waitForFunction(() => astraRenderer.players.size === 5);
    await other.waitForFunction(() => astraRenderer.players.size === 5);
    await page.locator('#world').focus();
    const beforeMulti = { x: me().x, z: me().z };
    await page.keyboard.down('d');
    await page.waitForTimeout(1600);
    await page.keyboard.up('d');
    await page.waitForTimeout(900);
    assert.ok(Math.hypot(me().x - beforeMulti.x, me().z - beforeMulti.z) > 1);
    const peerPosition = await other.evaluate(() => {
      const p = [...astraRenderer.players.values()].find((p) => p.state.name === 'Astra A');
      return { x: p.model.position.x, z: p.model.position.z };
    });
    assert.ok(Math.hypot(me().x - peerPosition.x, me().z - peerPosition.z) < 0.4);
    await page.screenshot({ path: `${folder}/five-players.png` });
    checks.push('five connections, two rendered views, actual lateral movement synchronizes');
    const saved = { id: me().id, x: me().x, z: me().z, inventory: { ...me().inventory } };
    await page.reload();
    await page.locator('#title-start').click();
    await ready(page);
    assert.equal(me().id, saved.id);
    assert.ok(Math.hypot(me().x - saved.x, me().z - saved.z) < 0.05);
    assert.deepEqual(me().inventory, saved.inventory);
    checks.push('reload resumes the same identity, position and inventory');
    for (const [width, height] of [
      [390, 844],
      [844, 390],
    ]) {
      await page.setViewportSize({ width, height });
      await page.locator('#world').focus();
      await page.keyboard.press('i');
      await page.waitForTimeout(350);
      assert.equal(await page.locator('dialog[open]').count(), 1);
      await page.screenshot({ path: `${folder}/inventory-${width}.png` });
      await page.keyboard.press('Escape');
      await page.keyboard.press('m');
      await page.waitForTimeout(350);
      assert.equal(await page.locator('dialog[open]').count(), 1);
      await page.screenshot({ path: `${folder}/map-${width}.png` });
      await page.keyboard.press('Escape');
    }
    checks.push('inventory and map in portrait and landscape sizes');
    await other.close();
  }
  assert.deepEqual(errors, []);
} finally {
  await writeFile(
    `${folder}/summary.json`,
    JSON.stringify(
      {
        variant,
        viewport: [1280, 800],
        renderedViewsDuringMeasurement: 1,
        warmupSeconds: 8,
        fixture: { x: 76, z: 68 },
        checks,
        errors,
        measurements,
      },
      null,
      2,
    ),
  );
  for (const socket of peers) socket.close();
  await browser?.close();
  game.close();
}
