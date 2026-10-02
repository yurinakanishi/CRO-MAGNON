// The current app intentionally returns to the title after reload. Verify the
// real title/setup/rejoin path separately, retaining the full gameplay run.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { WebSocket } from 'ws';
import { createGameServer } from '../dist/server.mjs';
const { chromium } =
  await import('file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const out = `output/playwright/orb-bots/reload-${Date.now()}`;
await mkdir(out, { recursive: true });
const game = createGameServer({ port: 0, host: '127.0.0.1' });
const { port } = await game.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [],
  peers = [],
  seen = { id: null, state: null, resumed: false };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, label) {
  const end = Date.now() + 25000;
  while (!fn()) {
    if (Date.now() > end) throw Error(label);
    await sleep(50);
  }
}
page.on('pageerror', (e) => errors.push(String(e)));
page.on('websocket', (ws) =>
  ws.on('framereceived', ({ payload }) => {
    const m = JSON.parse(String(payload));
    if (m.type === 'welcome') {
      seen.id = m.id;
      seen.resumed = m.resumed;
    }
    if (m.type === 'state') seen.state = m;
  }),
);
async function enter() {
  await page.locator('#title-start').click();
  await page.locator('#setup-form .character-choice:has(input[value="maruimo-male"])').click();
  await page.locator('#setup-flow [data-choose-difficulty="normal"]').click();
  await page.locator('#setup-flow-yes').click();
  await page
    .locator('#world[data-world-asset="ready"][data-character-asset="ready"]')
    .waitFor({ timeout: 120000 });
  await page.locator('#orb-bot-controls').waitFor({ state: 'visible' });
}
let failure, report;
try {
  await page.goto(`http://127.0.0.1:${port}/?room=ORB-RELOAD-QA`);
  await enter();
  const room = game.rooms.get('ORB-RELOAD-QA');
  room.enemies = [];
  for (let i = 0; i < 4; i++) {
    const ws = new WebSocket(
      `ws://127.0.0.1:${port}/ws?room=ORB-RELOAD-QA&name=ReloadObserver${i}`,
    );
    peers.push(ws);
    await new Promise((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });
  }
  await until(() => room.players.size === 5 && room.orbBots.length === 25, 'initial 25');
  const p = room.players.get(seen.id);
  // Explicit isolated inventory fixture makes preservation meaningful.
  p.inventory.wood = 3;
  p.inventory.berry = 2;
  const inventory = structuredClone(p.inventory);
  await sleep(200);
  await page.reload();
  await page.locator('#title-start').waitFor({ state: 'visible' });
  await until(
    () => room.players.size === 4 && room.orbBots.length === 20,
    'disconnected owner removed',
  );
  await page.screenshot({ path: `${out}/reload-title.png` });
  await enter();
  await until(() => room.players.size === 5 && room.orbBots.length === 25, 'rejoined 25');
  const resumed = room.players.get(seen.id);
  assert.equal(seen.resumed, true);
  assert.deepEqual(resumed.inventory, inventory);
  assert.equal(new Set(room.orbBots.map((b) => b.id)).size, 25);
  const owned = room.orbBots.filter((b) => b.ownerId === seen.id);
  assert.deepEqual(owned.map((b) => b.kind).sort(), ['blue', 'green', 'orange', 'purple', 'white']);
  assert.ok(owned.every((b) => b.mode === 'following'));
  assert.equal(await page.locator('#orb-bot-controls .orb-choice').count(), 5);
  await page.screenshot({ path: `${out}/rejoined-five.png` });
  assert.deepEqual(errors, []);
  report = {
    players: 5,
    bots: 25,
    owned: 5,
    inventoryPreserved: true,
    resumed: true,
    scope:
      'Isolated unsaved room, one Chrome renderer and four protocol peers; wood=3 and berry=2 are explicit test fixtures.',
  };
} catch (e) {
  failure = String(e.stack ?? e);
  await page.screenshot({ path: `${out}/failure.png` }).catch(() => {});
} finally {
  await writeFile(
    `${out}/result.json`,
    JSON.stringify({ passed: !failure, report, errors, failure }, null, 2) + '\n',
  );
  peers.forEach((ws) => ws.close());
  await browser.close();
  await game.close();
}
if (failure) throw Error(failure);
console.log(JSON.stringify({ out, passed: true, ...report }));
