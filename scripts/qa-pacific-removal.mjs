import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createGameServer } from '../dist/server.mjs';
import { coastTextureData, isLand, chunkHasLand } from '../dist/shared/paleo-geography.mjs';
import { SCENERY } from '../dist/shared/scenery-layout.mjs';
import { waterBodyFree, handleBoatAction } from '../dist/shared/boats.mjs';
import { stopActor } from '../dist/shared/combat.mjs';
import { WARP_POINTS } from '../dist/shared/warp-sites.mjs';
import { WebSocket } from 'ws';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);
const out = 'output/playwright/pacific-removal-2026-09-22';
await mkdir(out, { recursive: true });
const server = createGameServer({ host: '127.0.0.1', port: 0 });
const { port } = await server.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [],
  checks = [],
  peers = [];
try {
  const pages = [];
  for (let i = 0; i < 2; i++) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    pages.push(page);
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await page.route('**/src/main.js', async (route) =>
      route.fulfill({
        contentType: 'text/javascript',
        body:
          `import {WorldRenderer as QAWorld} from '/src/world3d.js';
  const qaRender=QAWorld.prototype.render;QAWorld.prototype.render=function(...args){window.qaWorld=this;return qaRender.apply(this,args);};
  ` + (await readFile('dist/src/main.js', 'utf8')),
      }),
    );
    await page.goto(`http://127.0.0.1:${port}/?room=PACIFIC-QA`);
    console.log('TITLE', i, errors);
    await page.locator('#title-start').click();
    await page.locator('#setup-form .character-choice:has(input[value="cro-male"])').click();
    await page.locator('#setup-flow [data-choose-difficulty="normal"]').click();
    await page.locator('#setup-flow-yes').click();
    await page.waitForSelector('#world[data-world-asset="ready"][data-character-asset="ready"]', {
      timeout: 120000,
    });
    console.log('READY', i);
  }
  for (let i = 0; i < 3; i++) {
    const peer = new WebSocket(`ws://127.0.0.1:${port}/ws?room=PACIFIC-QA&name=Peer${i}`);
    peers.push(peer);
    await new Promise((resolve, reject) => {
      peer.once('open', resolve);
      peer.once('error', reject);
    });
  }
  const room = server.rooms.get('PACIFIC-QA');
  assert.equal(room.players.size, 5);
  assert.equal(room.residents.length, 0);
  assert.equal(room.gulf.plots.length, 0);
  assert.equal(room.resources.filter((r) => r.id.startsWith('gulf-')).length, 0);
  assert.equal(SCENERY.fires.filter((f) => f.id?.startsWith('gulf-')).length, 0);
  assert.equal(WARP_POINTS.filter((p) => p.id.startsWith('gulf-')).length, 0);
  checks.push(
    'Two Chrome pages and three peers connect; no retired residents, plots, resources or warp fires.',
  );
  const page = pages[0];
  await page.keyboard.press('w');
  await page.keyboard.press('f');
  await page.keyboard.press('m');
  await page.waitForSelector('#big-map');
  await page.evaluate(async () => {
    const m = await import('/src/world-map.js');
    m.resetWorldMap(null, 1);
  });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/atlas-desktop.png` });
  const geo = await page.evaluate(async () => {
    const g = await import('/shared/paleo-geography.mjs'),
      m = await import('/src/world-map.js');
    const points = [
      [-2690, 1170],
      [-2710, 770],
      [-2590, 450],
      [-2270, 350],
      [-1970, 470],
      [-1710, 770],
      [-1690, 1150],
    ];
    return {
      bounds: m.ATLAS_BOUNDS,
      points: points.map(([x, z]) => ({
        x,
        z,
        d: g.coastDistance(x, z),
        land: g.isLand(x, z),
        chunk: g.chunkHasLand(x, z),
      })),
    };
  });
  for (const p of geo.points) {
    assert.equal(p.land, false);
    assert.equal(p.chunk, false);
    assert.equal(isLand(p.x, p.z), false);
    assert.ok(waterBodyFree(p.x, p.z, 2));
  }
  assert.equal(geo.bounds.width, 4096);
  checks.push(
    'Former island spine is ocean in browser and server; no terrain chunks and hulls can pass. Atlas fits Earth.',
  );
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(450);
    await page.screenshot({ path: `${out}/atlas-${viewport.width}x${viewport.height}.png` });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/menu.png` });
  const body = await page.locator('body').innerText();
  for (const removed of ['三つの国・共同の畑', '集落の人びと・今日の手伝い'])
    assert.ok(!body.includes(removed));
  await page.keyboard.press('Escape');
  // Boat and location are preparation in this isolated, unsaved world only.
  // Movement across the former island uses real keyboard input afterwards.
  const sailor = [...room.players.values()][0];
  stopActor(sailor);
  Object.assign(sailor, { x: 128, z: 124 });
  sailor.inventory.wood = 24;
  assert.equal(handleBoatAction(room, sailor, { action: 'craftBoat' }, Date.now()).changed, true);
  assert.equal(handleBoatAction(room, sailor, { action: 'boardBoat' }, Date.now()).changed, true);
  const boat = room.boats.find((b) => b.riderId === sailor.id);
  Object.assign(boat, { x: -2270, z: 350 });
  Object.assign(sailor, { x: boat.x, z: boat.z });
  for (const p of pages)
    await p.waitForFunction(
      (id) => window.qaWorld?.state.players.some((s) => s.id === id && s.x < -2200),
      sailor.id,
    );
  await page.waitForTimeout(1400);
  await page.keyboard.down('w');
  await page.waitForTimeout(700);
  await page.keyboard.up('w');
  assert.ok(Math.hypot(boat.x + 2270, boat.z - 350) > 0.5, 'real paddling across removed land');
  assert.ok(waterBodyFree(boat.x, boat.z, boat.radius));
  for (const p of pages)
    assert.equal(
      await p.evaluate(
        () => !!qaWorld.gulfRenderer || !!qaWorld.coastalRenderer || !!qaWorld.villageRenderer,
      ),
      false,
    );
  await page.screenshot({ path: `${out}/former-island-at-sea.png` });
  checks.push(
    'A real canoe paddles over the former island; both rendering clients receive the position and instantiate no retired scenery renderers.',
  );
  await page.reload();
  await page.waitForSelector('#title-start');
  await page.screenshot({ path: `${out}/reload-title.png` });
  assert.deepEqual(errors, []);
  checks.push('Desktop/portrait/landscape map, menu and reload complete without browser errors.');
  await writeFile(
    `${out}/report.json`,
    JSON.stringify({ checks, errors, geo, players: 5 }, null, 2),
  );
  console.log(JSON.stringify({ checks, errors }));
} catch (error) {
  console.error(errors);
  throw error;
} finally {
  for (const p of peers) p.close();
  await browser.close();
  await server.close();
}
