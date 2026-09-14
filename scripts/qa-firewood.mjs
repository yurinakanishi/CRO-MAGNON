// Server positions are scene preparation; collection below uses the real E key.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createGameServer } from '../dist/server.mjs';
import { WebSocket } from 'ws';
import { resourceAppearance } from '../dist/shared/biome-scenery.mjs';
const { chromium } =
  await import('file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const mode = process.argv[2] || 'current';
const folder = `output/playwright/firewood/${process.argv[3] || mode}`;
await mkdir(folder, { recursive: true });
const game = createGameServer({ port: 0, host: '127.0.0.1' });
const { port } = await game.listen();
const errors = [],
  samples = [],
  peers = [],
  checks = [];
const browser = await chromium.launch({ channel: 'chrome', headless: true });
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
  }, name);
  await page.route('**/src/world3d.js', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body:
        (await response.text()) +
        '\nconst draw = WorldRenderer.prototype.render; WorldRenderer.prototype.render = function(...args) { window.woodWorld = this; return draw.apply(this,args); };',
    });
  });
  await page.goto(`http://127.0.0.1:${port}/?room=WOOD-QA`);
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
    .waitFor({ timeout: 120000 });
  await page.waitForFunction(() => window.woodWorld?.players.get(woodWorld.selfId)?.actor);
}
async function snapshot(page, label, id = 'wood-1') {
  await page.waitForTimeout(250);
  const state = await page.evaluate((id) => {
    const w = woodWorld,
      item = w.resources.get(id);
    const instances = [];
    item.model.traverse((n) => {
      if (n.isInstancedMesh) instances.push({ count: n.count, capacity: n.instanceMatrix.count });
    });
    return {
      amount: item.resource.amount,
      visible: item.model.visible,
      clip: item.clipPlane?.constant ?? null,
      instances,
      camera: w.camera.position.toArray(),
      calls: w.renderer.info.render.calls,
      triangles: w.renderer.info.render.triangles,
      fps: Number(w.canvas.dataset.fps),
      geometries: w.renderer.info.memory.geometries,
      textures: w.renderer.info.memory.textures,
      worldLoadMilliseconds: w.worldAssets.loadMilliseconds,
      pixelRatio: w.renderer.getPixelRatio(),
      viewport: [innerWidth, innerHeight],
    };
  }, id);
  if (mode === 'current') {
    assert.equal(state.clip, null);
    assert.ok(state.instances.length > 0);
    state.instances.forEach((batch) => assert.equal(batch.count, state.amount));
  }
  samples.push({ label, ...state });
  await page.screenshot({ path: `${folder}/${label}.png` });
  return state;
}
try {
  const page = await open('Wood A'),
    room = game.rooms.get('WOOD-QA');
  room.enemies = [];
  const me = () => [...room.players.values()].find((p) => p.name === 'Wood A');
  const resource = room.resources.find((r) => r.id === 'wood-1');
  assert.ok(resource);
  let other;
  if (mode === 'current') {
    other = await open('Wood B');
    Object.assign(
      [...room.players.values()].find((p) => p.name === 'Wood B'),
      { x: resource.x + 3, z: resource.z + 2.4 },
    );
    for (let i = 0; i < 3; i++) {
      const socket = new WebSocket(
        `ws://127.0.0.1:${port}/ws?` +
          new URLSearchParams({
            room: 'WOOD-QA',
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
    await page.waitForFunction(() => woodWorld.players.size === 5);
    checks.push('five connections, two actual Chrome renderers');
  }
  Object.assign(me(), { x: resource.x, z: resource.z + 2.4, yaw: Math.PI });
  await page.waitForTimeout(1800);
  await snapshot(page, 'full');
  await page.locator('#world').focus();
  const initialWood = me().inventory.wood;
  for (let i = 0; i < (mode === 'current' ? resource.maxAmount : 3); i++) {
    const before = resource.amount;
    await page.keyboard.press('KeyE');
    await page.waitForFunction(
      (n) => woodWorld.resources.get('wood-1').resource.amount < n,
      before,
      { timeout: 15000 },
    );
    await snapshot(page, `take-${i + 1}`);
    assert.equal(resource.amount, before - 1);
    assert.equal(me().inventory.wood, initialWood + i + 1);
    if (other) {
      await other.waitForFunction(
        (n) => woodWorld.resources.get('wood-1').resource.amount === n,
        resource.amount,
      );
      await snapshot(other, `peer-take-${i + 1}`);
    }
    if (mode === 'current' && i === 2) {
      const saved = { id: me().id, amount: resource.amount, wood: me().inventory.wood };
      await page.reload();
      await page.locator('#title-start').click();
      await ready(page);
      assert.equal(me().id, saved.id);
      assert.equal(resource.amount, saved.amount);
      assert.equal(me().inventory.wood, saved.wood);
      await snapshot(page, 'reload-partly-collected');
      await page.locator('#world').focus();
      checks.push('reload restores partly collected pile and inventory');
    }
  }
  if (mode === 'current') {
    checks.push(
      'real E input: seven whole logs removed, one inventory unit per log, both views agree',
    );
    assert.equal(resource.amount, 0);
    // Observe one natural 20-second regeneration tick, without moving its clock.
    await page.waitForFunction(
      () => woodWorld.resources.get('wood-1').resource.amount === 1,
      null,
      { timeout: 26000 },
    );
    await snapshot(page, 'natural-regrowth-one-log');
    checks.push('natural regeneration makes exactly one entire log reappear');
    for (const [width, height] of [
      [390, 844],
      [844, 390],
    ]) {
      await page.setViewportSize({ width, height });
      await snapshot(page, `viewport-${width}`);
    }
    await page.setViewportSize({ width: 1280, height: 800 });
    // Prepare the axe scenario, then verify its existing two-unit yield with E.
    resource.amount = 7;
    resource.regeneratedAt = Date.now();
    me().tool = true;
    await page.waitForTimeout(500);
    await page.locator('#world').focus();
    await page.keyboard.press('KeyE');
    await page.waitForFunction(() => woodWorld.resources.get('wood-1').resource.amount === 5);
    await snapshot(page, 'axe-two-units');
    me().tool = false;
    checks.push('existing axe yield removes two complete logs');
    for (const surface of ['snow', 'ash', 'sand']) {
      const target = room.resources.find(
        (r) => r.type === 'wood' && resourceAppearance(r).surface === surface,
      );
      assert.ok(target, surface);
      Object.assign(me(), { x: target.x, z: target.z + 2.4 });
      await page.waitForFunction((id) => woodWorld.resources.get(id)?.model.visible, target.id, {
        timeout: 30000,
      });
      await snapshot(page, `regional-${surface}`, target.id);
      const before = target.amount;
      await page.locator('#world').focus();
      await page.keyboard.press('KeyE');
      await page.waitForFunction(
        ({ id, before }) => woodWorld.resources.get(id)?.resource.amount === before - 1,
        { id: target.id, before },
        { timeout: 15000 },
      );
      await snapshot(page, `regional-${surface}-collected`, target.id);
    }
    checks.push('snow, ash and sand surfaces load and collect whole logs with actual E');
    Object.assign(me(), { x: resource.x, z: resource.z + 2.4 });
    await page.waitForTimeout(15000);
    await snapshot(page, 'return-to-valley');
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ mode, samples, checks, errors }));
} finally {
  for (const socket of peers) socket.close();
  await writeFile(
    `${folder}/summary.json`,
    JSON.stringify({ mode, samples, checks, errors }, null, 2),
  );
  await browser.close();
  game.close();
}
