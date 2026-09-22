// Two real Chrome pages, local asset servers and one isolated exhibition world.
// Only the standard controller devices and proximity fixture are simulated.
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import { verifyExhibition } from './exhibition-integrity.mjs';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);
const root = path.resolve(import.meta.dirname, '..');
const assetsRoot = process.argv[2] ? path.resolve(process.argv[2]) : root;
const manifest = process.argv[2] ? await verifyExhibition(assetsRoot) : null;
const buildId = manifest?.buildId || 'labels-qa';
const { createGameServer } = await import(pathToFileURL(path.join(assetsRoot, 'dist/server.mjs')));
const { createExhibitionClient } = await import(
  pathToFileURL(path.join(assetsRoot, 'dist/infrastructure/node/exhibition-client.mjs'))
);
const { readControllerLayout } = await import(
  pathToFileURL(path.join(assetsRoot, 'scripts/exhibition-config.mjs'))
);
const folder = path.join(root, `output/playwright/controller-labels-${Date.now()}`);
await mkdir(folder, { recursive: true });
await writeFile(
  path.join(folder, 'exhibition.env'),
  'PC1_CONTROLLER_LAYOUT=ps4\nPC2_CONTROLLER_LAYOUT=switch-pro\n',
);
const game = createGameServer({
  host: '127.0.0.1',
  port: 0,
  exhibition: true,
  serveAssets: false,
  expectedBuild: buildId,
  wsPaths: ['/'],
});
const { port } = await game.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const pages = [],
  clients = [],
  checks = [],
  errors = [];
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const pass = (text) => {
  checks.push(text);
  console.log('PASS', text);
};
async function tap(page, index) {
  await page.bringToFront();
  for (const pressed of [false, true, false]) {
    await page.evaluate(
      ({ index, pressed }) => {
        window.qaPad.buttons[index] = { pressed, value: pressed ? 1 : 0 };
      },
      { index, pressed },
    );
    await pause(180);
  }
}
async function shot(page, label) {
  await writeFile(path.join(folder, `${label}.txt`), await page.locator('body').ariaSnapshot());
  await page.screenshot({ path: path.join(folder, `${label}.png`), animations: 'disabled' });
}
async function help(page, layout, label) {
  await page.locator('#title-howto').click();
  await page.locator('[data-help-tab="pad"]').click();
  const text = await page.locator('#help-panel-pad').innerText();
  if (layout === 'switch-pro') {
    assert.doesNotMatch(text, /○|□|△|×|OPTIONS|SHARE|タッチパッド|R[123]|L[12]/);
    for (const hint of ['Y / ZR', 'X（上）', 'B（下）', 'ZL', '右スティック押し込み'])
      assert.ok(text.includes(hint));
    assert.match(await page.locator('[data-help-tab="pad"]').innerText(), /Switch Pro/);
  } else {
    for (const hint of ['○', '□ / R2', '△（上）', '×（下）', 'OPTIONS', 'SHARE'])
      assert.ok(text.includes(hint));
    assert.match(await page.locator('[data-help-tab="pad"]').innerText(), /DUALSHOCK 4/);
  }
  await shot(page, label);
  await tap(page, 0);
  await page.locator('#modal').waitFor({ state: 'hidden' });
}
try {
  for (const [role, layout, right, bottom, left, menu] of [
    ['host', 'ps4', '○', '×', '□', 'OPTIONS'],
    ['client', 'switch-pro', 'A', 'B', 'Y', '＋'],
  ]) {
    const client = createExhibitionClient({
      root: assetsRoot,
      port: 0,
      config: {
        mode: 'lan',
        serverUrl: `ws://127.0.0.1:${port}/`,
        room: 'LABELS-QA',
        guestName: layout,
        buildId,
      },
      getControllerLayout: () => readControllerLayout(folder, role, {}),
    });
    clients.push(client);
    const local = await client.listen();
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addInitScript(() => {
      window.qaPad = {
        id: 'Standard controller',
        index: 0,
        connected: true,
        mapping: 'standard',
        axes: [0, 0, 0, 0],
        buttons: Array.from({ length: 18 }, () => ({ pressed: false, value: 0 })),
      };
      Object.defineProperty(navigator, 'getGamepads', { value: () => [window.qaPad] });
    });
    const page = await context.newPage();
    pages.push(page);
    page.on('pageerror', (error) => errors.push(String(error)));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.goto(`http://127.0.0.1:${local.port}`);
    await page.locator('#title-howto').waitFor();
    await help(page, layout, `${layout}-title-help`);
    pass(`${layout}: title help and bottom-button dismissal`);
    await page.locator('#title-start').click();
    console.log(await page.locator('#screen-setup').ariaSnapshot());
    await tap(page, 1);
    await page.locator('#setup-flow[data-step="spawn"]').waitFor();
    await tap(page, 1);
    await page
      .locator('#world[data-world-asset="ready"][data-character-asset="ready"]')
      .waitFor({ timeout: 120000 });
    assert.match(await page.locator('#connection-label').innerText(), /LAN: Connected/);
    await tap(page, 9);
    await page.locator('.pause-menu').waitFor();
    assert.ok(
      (await page.locator('.pause-hint').innerText()).includes(
        `${right} で決定 · ${bottom}（下のボタン）か ${menu}`,
      ),
    );
    assert.deepEqual(
      await page
        .locator('[data-pause-tab]')
        .evaluateAll((tabs) => tabs.map((tab) => tab.dataset.pauseTab)),
      ['inventory', 'character', 'warp'],
    );
    await page.locator('[data-pause-tab="warp"]').click();
    assert.equal(await page.locator('[data-warp-spawn]').count(), 6);
    await shot(page, `${layout}-pause-warp`);
    await tap(page, 0);
    await page.locator('#modal').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('#prompt-bar kbd').innerText(), menu);
    pass(`${layout}: right button selects character and spawn; menu hints agree`);
    await tap(page, 8);
    await page.locator('.atlas').waitFor();
    assert.match(await page.locator('#map-warp').innerText(), new RegExp(`^${right} ワープ`));
    assert.ok((await page.locator('#map-pin-send').innerText()).startsWith(left));
    assert.equal(
      await page.locator('#map-center kbd').innerText(),
      layout === 'ps4' ? 'R3' : '右スティック押し込み',
    );
    await shot(page, `${layout}-map`);
    await tap(page, 0);
    await page.locator('.atlas').waitFor({ state: 'hidden' });
    pass(`${layout}: map labels, map opening and bottom-button back`);
    const room = game.rooms.get('LABELS-QA');
    const player = [...room.players.values()].find((p) => p.name === layout);
    const before = player.attackSequence;
    await tap(page, 2);
    assert.ok(player.attackSequence > before);
    // Fixture only: place this QA player next to a berry to make a real contextual hint visible.
    const berry = room.resources.find((r) => r.type === 'berry' && r.amount > 0);
    Object.assign(player, room.collision.nearestFree(berry, player.radius, [], 2), {
      target: null,
      dx: 0,
      dz: 0,
    });
    await page.locator('#interaction-hint:not([hidden])').waitFor();
    assert.equal(await page.locator('#interaction-hint kbd').innerText(), right);
    assert.equal(await page.locator('#ride-button kbd').textContent(), bottom);
    assert.equal(await page.locator('#boat-board kbd').textContent(), bottom);
    assert.equal(await page.locator('#pet524-button kbd').textContent(), bottom);
    await shot(page, `${layout}-context`);
    const amount = berry.amount;
    await tap(page, 1);
    await pause(2200);
    assert.ok(berry.amount < amount);
    pass(
      `${layout}: displayed left button attacks and right button gathers; contextual labels agree`,
    );
  }
  const room = game.rooms.get('LABELS-QA');
  assert.equal(room.players.size, 2);
  const pc1Player = [...room.players.values()].find((p) => p.name === 'ps4');
  const switchPage = pages[1];
  await switchPage.reload();
  await switchPage.setViewportSize({ width: 390, height: 844 });
  await help(switchPage, 'switch-pro', 'switch-pro-portrait-help');
  await writeFile(path.join(folder, 'exhibition.local.env'), 'PC2_CONTROLLER_LAYOUT=ps4\n');
  await switchPage.reload();
  await help(switchPage, 'ps4', 'pc2-changed-to-ps4-without-restart');
  assert.equal(game.rooms.get('LABELS-QA'), room);
  assert.equal(room.players.get(pc1Player.id), pc1Player);
  assert.equal(await pages[0].locator('#prompt-bar kbd').innerText(), 'OPTIONS');
  pass('PC2 label override appears on browser reload; PC1 player and shared world persist');
  assert.deepEqual(errors, []);
} finally {
  await writeFile(
    path.join(folder, 'result.json'),
    JSON.stringify({ assetsRoot, buildId, checks, errors, physicalControllers: false }, null, 2),
  );
  console.log('EVIDENCE', folder);
  await browser.close();
  for (const client of clients) await client.close();
  await game.close();
}
