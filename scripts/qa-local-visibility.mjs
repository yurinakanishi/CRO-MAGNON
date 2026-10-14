import { enterPreparedWorld } from './qa-game-entry.mjs';
import { ALL_MASCOT_MODELS } from '../dist/shared/mascot-roster.mjs';
// Real Chrome and five connections against disposable in-memory hosts only.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import WebSocket from 'ws';
import { createGameServer } from '../dist/server.mjs';
import { readLocalVisibility } from '../dist/infrastructure/node/local-visibility.mjs';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);
const out = process.argv[2] || `output/playwright/local-visibility/${Date.now()}`;
await mkdir(out, { recursive: true });
const game = createGameServer({
  port: 0,
  host: '127.0.0.1',
  visibility: await readLocalVisibility('local-visibility.json'),
});
await game.listen();
const errors = [],
  checks = [],
  peers = [];
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: [
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
  ],
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pass = (text) => {
  checks.push(text);
  console.log('PASS', text);
};
async function until(check, message, timeout = 25000) {
  const deadline = Date.now() + timeout;
  while (!(await check())) {
    if (Date.now() > deadline) throw Error(message);
    await sleep(50);
  }
}
const shot = (page, name) =>
  page.screenshot({ path: `${out}/${name}.png`, animations: 'disabled' });
async function pageFor(host, name, oldProfile = false) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const seen = { id: null, state: {}, models: [] };
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('request', (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.startsWith('/models/')) seen.models.push(pathname);
  });
  page.on('websocket', (ws) =>
    ws.on('framereceived', ({ payload }) => {
      const message = JSON.parse(String(payload));
      if (message.type === 'welcome') seen.id = message.id;
      if (message.type === 'state') seen.state = message;
    }),
  );
  await page.addInitScript(
    ({ name, oldProfile }) => {
      localStorage.setItem('cro-name', name);
      if (oldProfile) {
        localStorage.setItem('cro-species', 'howkey');
        localStorage.setItem('cro-gender', 'female');
      }
    },
    { name, oldProfile },
  );
  if (host === shown)
    await page.route('**/shared/mascot-roster.mjs', async (route) => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        body: (await response.text()).replaceAll('enabled: false', 'enabled: true'),
      });
    });
  await page.goto(`http://127.0.0.1:${host.address().port}/?room=VISIBILITY`);
  return { context, page, seen, player: () => host.rooms.get('VISIBILITY').players.get(seen.id) };
}
async function openSetup(page) {
  // The initial loading shell contains this button before main.ts binds it.
  await page.waitForFunction(
    () => typeof document.querySelector('#title-start')?.onclick === 'function',
  );
  await page.locator('#title-start').click();
  await page.locator('#setup-form .character-choice').first().waitFor();
}
async function start(user, value) {
  await user.page
    .locator('#setup-form .character-choice:has(input[value="' + value + '"])')
    .click();
  await user.page.locator('#setup-flow-yes').click();
  await enterPreparedWorld(user.page, false);
  await user.page
    .locator(
      '#world[data-world-asset="ready"][data-character-asset="ready"][data-companion-assets="ready"]',
    )
    .waitFor({ timeout: 120000 });
  await until(() => user.seen.id && user.seen.state.players?.length, 'game joined');
  await user.page.locator('#world').focus();
}
let shown, failure;
try {
  const a = await pageFor(game, '非表示QA A', true);
  await openSetup(a.page);
  assert.equal(await a.page.locator('#setup-form .character-choice').count(), 5);
  assert.equal(await a.page.locator('input[value="maruimo-male"]').count(), 0);
  assert.equal(await a.page.locator('input[value="howkey-female"]').count(), 0);
  await shot(a.page, '01-hidden-choices');
  await start(a, 'cro-female');
  const b = await pageFor(game, '非表示QA B');
  await openSetup(b.page);
  await start(b, 'cro-male');
  const room = game.rooms.get('VISIBILITY');
  for (let i = 0; i < 3; i++) {
    const socket = new WebSocket(
      `ws://127.0.0.1:${game.address().port}/ws?room=VISIBILITY&species=${i % 2 ? 'maruimo' : 'howkey'}&gender=${i % 2 ? 'male' : 'female'}&name=peer-${i}`,
    );
    peers.push(socket);
    await new Promise((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });
  }
  await until(
    () => a.seen.state.players?.length === 5 && b.seen.state.players?.length === 5,
    'five peers',
  );
  for (const user of [a, b]) {
    assert.equal(user.seen.state.mae, undefined);
    assert.ok(user.seen.state.players.every((p) => !['maruimo', 'howkey'].includes(p.species)));
    assert.deepEqual(user.seen.state.companions, []);
    assert.deepEqual(user.seen.state.orbBots, []);
    assert.equal(user.seen.state.players[0].mascot, null);
  }
  pass(
    'Two real Chrome clients and three stale-profile peers see five playable characters, no hidden choices and no unselected mascots',
  );
  const before = { x: a.player().x, z: a.player().z };
  await a.page.keyboard.down('w');
  await sleep(400);
  await a.page.keyboard.up('w');
  await until(
    () => Math.hypot(a.player().x - before.x, a.player().z - before.z) > 0.15,
    'movement',
  );
  await a.page.keyboard.press('Escape');
  assert.doesNotMatch(await a.page.locator('#modal-body').innerText(), /mae|まるぃも|Howkey/i);
  await a.page.locator('[data-pause-tab="settings"]').click();
  await a.page.locator('[data-controller-menu="character"]').click();
  assert.equal(await a.page.locator('#character-switch-form .character-choice').count(), 5);
  assert.equal(
    await a.page.locator('#character-switch-form input[value="howkey-female"]').count(),
    0,
  );
  await shot(a.page, '02-hidden-switch');
  await a.page.locator('#character-switch-form input[value="cat-female"]').click();
  await a.page.locator('#character-confirm-yes').click();
  await until(
    () =>
      a.player().species === 'cat' &&
      b.seen.state.players?.find((p) => p.id === a.seen.id)?.species === 'cat',
    'shared character change',
  );
  await a.page.locator('#world[data-character-asset="ready"]').waitFor({ timeout: 120000 });
  await shot(a.page, '03-hidden-world');
  for (const [i, socket] of peers.entries())
    socket.send(
      JSON.stringify({
        type: 'action',
        action: 'changeCharacter',
        targetId: i % 2 ? 'maruimo-octopus' : 'howkey-scientist',
      }),
    );
  await sleep(400);
  assert.ok([...room.players.values()].every((p) => !['maruimo', 'howkey'].includes(p.species)));
  pass(
    'Movement, shared character switching and forged hidden-character rejection work with five players',
  );
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    await a.page.setViewportSize(viewport);
    await a.page.keyboard.press('Escape');
    await a.page.locator('[data-pause-tab="character"]').click();
    assert.equal(await a.page.locator('#character-switch-form .character-choice').count(), 5);
    assert.equal(
      await a.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    );
    await shot(a.page, `04-hidden-${viewport.width}`);
    await a.page.keyboard.press('Escape');
  }
  const oldId = a.seen.id;
  await a.page.reload();
  await openSetup(a.page);
  assert.equal(await a.page.locator('#setup-form .character-choice').count(), 5);
  await start(a, 'cro-female');
  assert.equal(a.seen.id, oldId);
  for (const user of [a, b])
    assert.ok(
      user.seen.models.every(
        (url) => !/^\/models\/(mae|maruimo-octopus|howkey-scientist)\//.test(url),
      ),
    );
  pass(
    'Portrait, landscape and rejoin keep all three hidden, with zero requests for their model or portrait files',
  );

  await a.context.close();
  await b.context.close();
  await writeFile(
    `${out}/shown-config.json`,
    JSON.stringify({ mae: true, maruimo: true, howkey: true }),
  );
  shown = createGameServer({
    port: 0,
    host: '127.0.0.1',
    visibility: await readLocalVisibility(`${out}/shown-config.json`),
    mascotModels: ALL_MASCOT_MODELS,
  });
  await shown.listen();
  const restored = await pageFor(shown, '再表示QA');
  await openSetup(restored.page);
  assert.equal(await restored.page.locator('#setup-form .character-choice').count(), 6);
  await shot(restored.page, '05-restored-choices');
  await start(restored, 'cro-female');
  for (const key of ['mae', 'howkey-scientist']) {
    await restored.page.keyboard.press('Escape');
    await restored.page.locator('[data-pause-tab="mascots"]').click();
    await restored.page.locator('[data-mascot="' + key + '"]').click();
    await until(() => restored.player().mascot === key, 'restored mascot choice');
    await restored.page.keyboard.press('Escape');
    await until(
      async () =>
        JSON.parse(await restored.page.locator('#world').getAttribute('data-companions')).some(
          (c) => c.key === key && c.visible,
        ),
      'restored mascot drawn',
    );
    assert.ok(
      restored.seen.models.some(
        (url) => url.startsWith('/models/' + key + '/') && url.endsWith('.glb'),
      ),
    );
    await shot(restored.page, '06-restored-' + key);
  }
  await restored.page.keyboard.press('Escape');
  await restored.page.locator('[data-pause-tab="settings"]').click();
  await restored.page.locator('[data-controller-menu="character"]').click();
  await restored.page.locator('#character-switch-form input[value="maruimo-male"]').click();
  await restored.page.locator('#character-confirm-yes').click();
  await until(() => restored.player().species === 'maruimo', 'restored maruimo');
  await restored.page
    .locator('#world[data-character-asset="ready"][data-player-model="maruimo-octopus"]')
    .waitFor({ timeout: 120000 });
  assert.ok(restored.seen.models.some((url) => /^\/models\/maruimo-octopus\/.+\.glb$/.test(url)));
  await shot(restored.page, '07-restored-maruimo');
  pass(
    'Setting all flags to true in a separate test host restores six playable choices and separately selected Howkey/mae companions using the original models',
  );
  assert.deepEqual(errors, []);
} catch (error) {
  failure = error;
  console.error(error.stack);
  for (const [i, page] of browser
    .contexts()
    .flatMap((context) => context.pages())
    .entries())
    await shot(page, `failure-${i}`).catch(() => {});
} finally {
  await writeFile(
    `${out}/report.json`,
    JSON.stringify(
      {
        checks,
        errors,
        failure: failure?.stack,
        screenshots: out,
        fixture:
          'Two real Chrome clients plus three WebSocket peers; separate all-visible host for restoration. No persistent save or normal-server settings were modified.',
      },
      null,
      2,
    ),
  );
  for (const peer of peers) peer.terminate();
  await browser.close();
  await shown?.close();
  await game.close();
}
console.log('Evidence', out);
if (failure) process.exitCode = 1;
