// Real Chrome and four websocket peers in a memory-only world on a random port.
// The former trader position is fixture setup; movement and menus use real inputs.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import WebSocket from 'ws';
import { createGameServer } from '../dist/server.mjs';
import { readLocalVisibility } from '../dist/infrastructure/node/local-visibility.mjs';
import { readDeliveryOverlay } from '../dist/infrastructure/node/delivery-overlay.mjs';
import { RETAINED_TRADER } from '../dist/shared/world.mjs';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);
const out = process.argv[2] || `output/playwright/neanderthal-retirement-${Date.now()}`;
await mkdir(out, { recursive: true });
const game = createGameServer({
  host: '127.0.0.1',
  port: 0,
  visibility: await readLocalVisibility('local-visibility.json'),
  delivery: await readDeliveryOverlay(process.cwd()),
});
const { port } = await game.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const requests = [],
  commands = [],
  errors = [],
  checks = [],
  peers = [],
  states = [];
let id, failure;
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});
page.on('request', (request) => requests.push(new URL(request.url()).pathname));
page.on('websocket', (socket) =>
  socket.on('framereceived', ({ payload }) => {
    const message = JSON.parse(String(payload));
    if (message.type === 'welcome') id = message.id;
    if (message.type === 'state') states.push(message);
  }),
);
page.on('websocket', (socket) =>
  socket.on('framesent', ({ payload }) => {
    commands.push(JSON.parse(String(payload)));
  }),
);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, label, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`Timeout: ${label}`);
    await sleep(50);
  }
}
const pass = (label) => {
  checks.push(label);
  console.log('PASS', label);
};
try {
  // Read-only observer of the rendered scene, following the repository's QA pattern.
  await page.route('**/src/world3d.js', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body:
        (await response.text()) +
        '\nconst originalSetState = WorldRenderer.prototype.setState; WorldRenderer.prototype.setState = function(...args) { globalThis.qaRenderer = this; return originalSetState.apply(this, args); };',
    });
  });
  await page.addInitScript(() => {
    localStorage.setItem('cro-name', 'Retained QA');
    localStorage.setItem('cro-species', 'nea');
    localStorage.setItem('cro-gender', 'female');
  });
  await page.goto(`http://127.0.0.1:${port}/?room=RETAINEDQA`);
  await page.locator('#title-start').click();
  assert.equal(await page.locator('#setup-form .character-choice').count(), 5);
  assert.equal(await page.locator('input[value^="nea-"]').count(), 0);
  assert.equal(await page.locator('input[name="character"]:checked').inputValue(), 'cro-female');
  await page.screenshot({ path: `${out}/choices-desktop.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${out}/choices-phone.png` });
  await page.setViewportSize({ width: 1440, height: 900 });
  pass(
    'desktop and portrait setup offer five current choices and accept an old Neanderthal preference',
  );
  await page.locator('.character-choice:has(input[value="cro-female"])').click();
  await page.locator('#setup-flow-yes').click();
  await page.locator('[data-cave-proceed]:enabled').waitFor({ timeout: 240000 });
  await page.locator('[data-cave-proceed]').click();
  await page
    .locator('#world[data-world-asset="ready"][data-character-asset="ready"]')
    .waitFor({ timeout: 180000 });
  await page.locator('#loading-screen').waitFor({ state: 'hidden', timeout: 180000 });
  await until(() => id && game.rooms.get('RETAINEDQA')?.players.has(id), 'browser arrival');
  for (let i = 0; i < 4; i++) {
    const socket = new WebSocket(
      `ws://127.0.0.1:${port}/ws?room=RETAINEDQA&name=Peer${i}&species=nea&gender=${i % 2 ? 'male' : 'female'}`,
    );
    const messages = [];
    socket.on('message', (bytes) => messages.push(JSON.parse(String(bytes))));
    peers.push({ socket, messages });
  }
  await until(
    () =>
      states.at(-1)?.players.length === 5 &&
      peers.every((peer) =>
        peer.messages.some((m) => m.type === 'state' && m.players.length === 5),
      ),
    'five connections',
  );
  const room = game.rooms.get('RETAINEDQA'),
    player = room.players.get(id);
  for (const state of [...states, ...peers.flatMap((peer) => peer.messages)].filter(
    (m) => m.type === 'state',
  )) {
    assert.equal(state.npc, undefined);
    assert.ok(state.players.every((p) => p.species !== 'nea' && !p.unavailableCharacter));
  }
  // Prepare the old NPC's approach in this unsaved room, then observe the scene.
  Object.assign(player, {
    x: RETAINED_TRADER.x,
    z: RETAINED_TRADER.z - 2,
    facing: 0,
    warpSequence: (player.warpSequence ?? 0) + 1,
  });
  await until(
    () =>
      page.evaluate(
        ({ x, z }) => {
          const r = globalThis.qaRenderer,
            p = r?.state.players.find((p) => p.id === r.selfId);
          return p && Math.hypot(p.x - x, p.z - z) < 0.1;
        },
        { x: player.x, z: player.z },
      ),
    'former trader position reaches the renderer',
  );
  await sleep(2500);
  const observed = await page.evaluate(() => {
    const r = globalThis.qaRenderer;
    return {
      npc: !!r.npc,
      label: !!r.npcLabel,
      residency: r.npcResidency.state,
      keys: [...r.humanAssets.keys()],
      rendered: r.canvas.dataset.glbNpcs,
    };
  });
  assert.equal(observed.npc, false);
  assert.equal(observed.label, false);
  assert.equal(observed.residency, 'absent');
  assert.ok(observed.keys.every((key) => !key.startsWith('neanderthal-')));
  assert.doesNotMatch(await page.locator('#interaction-hint').textContent(), /オル|物々交換/);
  await page.screenshot({ path: `${out}/former-trader.png` });
  await page.keyboard.press('4');
  await sleep(150);
  assert.ok(commands.every((message) => message.action !== 'trade'));
  const before = { x: player.x, z: player.z };
  await page.locator('#world').focus();
  await page.keyboard.down('w');
  await sleep(450);
  await page.keyboard.up('w');
  await until(
    () => Math.hypot(player.x - before.x, player.z - before.z) > 0.15,
    'actual keyboard movement',
  );
  pass(
    'five connections have no Neanderthals; the former trader has no body, label or action, and keyboard movement works',
  );
  await page.keyboard.press('Escape');
  await page.locator('[data-controller-menu="character"]').click();
  assert.equal(await page.locator('#character-switch-form .character-choice').count(), 5);
  assert.equal(await page.locator('input[value^="nea-"]').count(), 0);
  await page.screenshot({ path: `${out}/switch-choices.png` });
  assert.ok(requests.every((url) => !url.includes('/models/neanderthal-')));
  assert.deepEqual(errors, []);
  pass(
    'character switch offers five choices; zero requests for either dormant model or portrait; zero browser errors',
  );
} catch (error) {
  failure = error.stack || String(error);
  await page.screenshot({ path: `${out}/failure.png` }).catch(() => {});
  console.error(failure);
} finally {
  await writeFile(
    `${out}/report.json`,
    JSON.stringify(
      {
        status: failure ? 'failed' : 'passed',
        checks,
        errors,
        failure,
        requests,
        dormantRequests: requests.filter((url) => url.includes('/models/neanderthal-')),
        environment:
          'real Chrome desktop; portrait viewport emulation; one browser and four websocket peers; random port; memory-only room',
        fixture: 'former trader coordinates set in memory before real keyboard movement',
      },
      null,
      2,
    ),
  );
  for (const peer of peers) peer.socket.terminate();
  await browser.close();
  await game.close();
}
if (failure) process.exitCode = 1;
