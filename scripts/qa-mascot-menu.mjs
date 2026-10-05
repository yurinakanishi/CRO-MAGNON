// Browser and server stay in an independent room with in-memory state.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createGameServer } from '../dist/server.mjs';

const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);
const output = process.argv[2] || `output/playwright/mascot-menu-${Date.now()}`;
await mkdir(output, { recursive: true });
const game = createGameServer({ host: '127.0.0.1', port: 0 });
const { port } = await game.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (error) => errors.push(String(error)));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, label, timeout = 12000) {
  const end = Date.now() + timeout;
  while (!(await check())) {
    if (Date.now() > end) throw Error(label);
    await sleep(40);
  }
}
const room = () => game.rooms.get('MASCOT-CARDS-QA');
const playerId = () => [...(room()?.players.keys() ?? [])][0];
let result;
try {
  await page.addInitScript(() => {
    localStorage.setItem('cro-name', 'Mascot QA');
    localStorage.setItem('cro-species', 'cro');
    localStorage.setItem('cro-gender', 'female');
  });
  await page.goto(`http://127.0.0.1:${port}/?room=MASCOT-CARDS-QA&autostart=1`);
  await page
    .locator('#world[data-world-asset="ready"][data-character-asset="ready"]')
    .waitFor({ timeout: 90000 });
  await until(() => !!playerId(), 'player joined');
  const firstId = playerId();
  await page.keyboard.press('Escape');
  const removed = [
    'dismissKohaku',
    'dismissMae',
    'dismissRimo',
    'dismiss524',
    'bots',
    'travelAlone',
  ];
  for (const action of removed)
    assert.equal(await page.locator(`[data-controller-menu="${action}"]`).count(), 0, action);
  assert.equal(await page.locator('.orb-menu').count(), 0);
  await page.locator('[data-pause-tab="mascots"]').click();
  assert.equal(await page.locator('[data-mascot]').count(), 13);
  assert.equal(await page.locator('[data-mascot] img').count(), 13);
  await until(
    () =>
      page
        .locator('[data-mascot] img')
        .evaluateAll((images) => images.every((image) => image.complete && image.naturalWidth > 0)),
    'every mascot portrait loaded',
  );
  for (const kind of [
    'white',
    'blue',
    'green',
    'purple',
    'orange',
    'beret',
    'frog',
    'triangle',
    'heart',
  ])
    assert.equal(
      await page.locator(`[data-mascot="${kind}"] img`).getAttribute('src'),
      `/models/orb-bot-${kind}/portrait.png`,
    );
  await page.screenshot({ path: `${output}/cards-desktop.png`, animations: 'disabled' });

  await page.locator('[data-mascot="white"]').click();
  await until(
    () => room().orbBots.find((bot) => bot.kind === 'white')?.ownerId === playerId(),
    'white follows',
  );
  await until(
    () =>
      page
        .locator('[data-mascot="white"]')
        .getAttribute('aria-pressed')
        .then((value) => value === 'true'),
    'white card reflects server',
  );
  await page.locator('[data-mascot="rimo-neko"]').click();
  await until(() => room().rimoNeko?.followPlayerId === playerId(), 'rimo follows');
  await page.locator('[data-mascot-all="select"]').click();
  await until(
    () =>
      room().orbBots.filter((bot) => bot.ownerId === playerId()).length === 11 &&
      room().mae?.followPlayerId === playerId() &&
      room().kohaku?.followPlayerId === playerId(),
    'all mascots selected',
  );
  await until(
    () =>
      page
        .locator('#mascot-selection-count')
        .textContent()
        .then((value) => value.includes('13 / 13')),
    'all cards reflect server',
  );
  await page.screenshot({ path: `${output}/all-selected.png`, animations: 'disabled' });
  await page.locator('[data-mascot-all="clear"]').click();
  await until(
    () =>
      room().orbBots.every((bot) => bot.ownerId !== playerId()) &&
      [room().rimoNeko, room().companion524, room().mae, room().kohaku].every(
        (mascot) => mascot?.followPlayerId !== playerId(),
      ),
    'all mascots released',
  );
  await until(
    () =>
      page
        .locator('#mascot-selection-count')
        .textContent()
        .then((value) => value.includes('0 / 13')),
    'clear reflects server',
  );
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport);
    assert.equal(await page.locator('[data-mascot]').count(), 13);
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    await page.screenshot({
      path: `${output}/cards-${viewport.width}x${viewport.height}.png`,
      animations: 'disabled',
    });
  }
  const otherContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const otherPage = await otherContext.newPage();
  otherPage.on('pageerror', (error) => errors.push(String(error)));
  await otherPage.addInitScript(() => {
    localStorage.setItem('cro-name', 'Other Mascot QA');
    localStorage.setItem('cro-species', 'cro');
    localStorage.setItem('cro-gender', 'male');
  });
  await otherPage.goto(`http://127.0.0.1:${port}/?room=MASCOT-CARDS-QA&autostart=1`);
  await otherPage
    .locator('#world[data-world-asset="ready"][data-character-asset="ready"]')
    .waitFor({ timeout: 90000 });
  await until(() => room().players.size === 2, 'second player joined');
  const otherId = [...room().players.keys()].find((id) => id !== firstId);
  await otherPage.keyboard.press('Escape');
  await otherPage.locator('[data-pause-tab="mascots"]').click();
  await otherPage.locator('[data-mascot="white"]').click();
  await until(
    () => room().orbBots.find((bot) => bot.kind === 'white')?.ownerId === otherId,
    'other player owns white',
  );
  await until(
    () => page.locator('[data-mascot="white"]').isDisabled(),
    'other owner blocks first card',
  );
  assert.match(await page.locator('[data-mascot="white"]').innerText(), /ほかの旅人と一緒/);
  await page.locator('[data-mascot-all="select"]').click();
  await until(
    () => room().orbBots.filter((bot) => bot.ownerId === firstId).length === 10,
    'bulk select skips other owner',
  );
  assert.equal(room().orbBots.find((bot) => bot.kind === 'white')?.ownerId, otherId);
  await page.screenshot({ path: `${output}/other-owner.png`, animations: 'disabled' });
  assert.deepEqual(errors, []);
  result = { passed: true, cards: 13, otherOwnerProtected: true, errors };
  console.log(
    'PASS 13 cards, individual and bulk selection, other owner, three sizes, no browser errors',
  );
} catch (error) {
  result = { passed: false, errors, error: String(error), stack: error.stack };
  await page.screenshot({ path: `${output}/failure.png` }).catch(() => {});
  throw error;
} finally {
  await writeFile(`${output}/result.json`, JSON.stringify(result, null, 2));
  await browser.close();
  await game.close();
}
