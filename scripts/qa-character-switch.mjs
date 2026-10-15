// Real Chrome + real-time isolated server. Profile/guide preferences and a read-only renderer observer.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createGameCore } from '../dist/application/game-core.mjs';
import { createGameServer } from '../dist/server.mjs';
import { PLAYABLE_CHARACTER_MODELS as CHARACTER_MODELS } from '../dist/shared/characters.mjs';
import { cardValue } from '../dist/src/character-selection.js';
const { chromium } =
  await import('file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const output = 'output/playwright/character-switch';
await mkdir(output, { recursive: true });
const core = createGameCore({ persistentSessions: true, keepEmptyRooms: true });
const game = createGameServer({ core, host: '127.0.0.1', port: 0 });
const address = await game.listen(),
  url = `http://127.0.0.1:${address.port}/?room=SWITCH-QA`;
const errors = [],
  checks = [];
// Keep the unattended peer connected while every model is loaded on both screens.
const keepActive = setInterval(() => {
  for (const room of core.rooms.values())
    for (const player of room.players.values()) player.lastActivityAt = Date.now();
}, 1000);
let browser;
const passed = (text) => {
  checks.push(text);
  console.log('PASS', text);
};
// The first entry and a resume pass through the update cave until its button is ready.
const leaveCave = async (page) => {
  await page
    .locator('#loading-cave[data-ready="true"], #world[data-world-asset="ready"]')
    .first()
    .waitFor({ timeout: 180000 });
  if (await page.locator('#loading-cave[data-ready="true"]').count())
    await page.locator('[data-cave-proceed]').click({ timeout: 180000 });
};
const last = CHARACTER_MODELS.at(-1);
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const pages = [];
  for (let i = 0; i < 2; i++) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    pages.push(page);
    page.on('pageerror', (e) => errors.push(e.stack || String(e)));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await page.route('**/src/world3d.js', async (route) => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        body:
          (await response.text()) +
          '\nconst qaSetState = WorldRenderer.prototype.setState; WorldRenderer.prototype.setState = function(...args) { globalThis.qaRenderer = this; return qaSetState.apply(this, args); };',
      });
    });
    await page.addInitScript(
      (name) => {
        localStorage.setItem('cro-name', name);
      },
      `Switch QA ${i + 1}`,
    );
    await page.goto(url);
    await page.locator('#title-start').click();
    await page.locator('#setup-form .character-choice:has(input:checked)').click();
    await page.locator('#setup-flow-yes').click();
    await page.locator('#mascot-start').click();
    await leaveCave(page);
    await page.waitForSelector('#world[data-world-asset="ready"][data-character-asset="ready"]', {
      timeout: 90000,
    });
  }
  const [page, other] = pages;
  const r = core.rooms.get('SWITCH-QA');
  const me = () => [...r.players.values()].find((p) => p.name === 'Switch QA 1');
  const id = me().id,
    original = {
      x: me().x,
      z: me().z,
      inventory: structuredClone(me().inventory),
      energy: me().energy,
    };
  const open = async () => {
    await page.locator('#world').focus();
    await page.keyboard.press('Escape');
    await page.locator('[data-pause-tab="character"]').click();
    await page.waitForSelector('#character-switch-form');
  };
  const choose = async (model) =>
    page.locator(`#character-switch-form input[value="${cardValue(model)}"]`).check();
  const rendered = async (targetPage, model) =>
    targetPage.waitForFunction(
      ({ id, key }) => {
        const entity = globalThis.qaRenderer?.players.get(id);
        return (
          entity?.actor?.asset.modelKey === key && entity.model.children.includes(entity.actor.root)
        );
      },
      { id, key: model.key },
      { timeout: 90000 },
    );
  await open();
  assert.equal(
    await page.locator('#character-switch-form input[type="radio"]').count(),
    CHARACTER_MODELS.length,
  );
  assert.equal(await page.locator('#character-switch-form input:not([type="radio"])').count(), 0);
  assert.equal(await page.locator('#character-confirm').count(), 0);
  // The character and colour already worn ask nothing.
  await choose(CHARACTER_MODELS[0]);
  await page.waitForTimeout(200);
  assert.equal(await page.locator('#character-confirm').count(), 0);
  await choose(last);
  assert.equal(me().species, 'cro');
  assert.equal(await page.locator('#character-confirm').count(), 0);
  assert.equal(await page.locator('#character-switch-apply').innerText(), 'これにする');
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${output}/desktop.png` });
  await page.locator('#modal-close').click();
  await open();
  assert.equal(
    await page.locator('#character-switch-form input:checked').inputValue(),
    'cro-female',
  );
  await page.locator('#modal-close').click();
  assert.equal(me().species, 'cro');
  passed(
    'Cards only choose a draft; one apply button commits it, and Back leaves the worn character unchanged',
  );
  for (const model of [...CHARACTER_MODELS.slice(1), CHARACTER_MODELS[0]]) {
    await open();
    await choose(model);
    await page.locator('#character-switch-apply').click();
    await page.waitForFunction(() => !document.querySelector('#modal').open);
    await Promise.all([rendered(page, model), rendered(other, model)]);
    assert.equal(me().id, id);
    assert.deepEqual(
      { x: me().x, z: me().z, inventory: me().inventory, energy: me().energy },
      original,
    );
    assert.equal(
      await page
        .locator('#my-portrait')
        .evaluate((el, key) => el.classList.contains(key), model.key),
      true,
    );
    assert.equal(await page.evaluate(() => globalThis.qaRenderer.players.size), 2);
    await page.screenshot({ path: `${output}/${model.key}.png` });
  }
  passed(
    'Every playable 3D model on both screens, exact coordinates/identity/inventory/energy retained',
  );
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport);
    await open();
    await choose(last);
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${output}/${viewport.width}x${viewport.height}-selection.png` });
    assert.equal(
      await page.locator('#modal').evaluate((el) => el.scrollWidth > el.clientWidth + 1),
      false,
    );
    await page.locator('#character-switch-apply').scrollIntoViewIfNeeded();
    assert.equal(
      await page.locator('#character-switch-apply').evaluate((el) => {
        const r = el.getBoundingClientRect();
        return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight;
      }),
      true,
      'apply button fits the small screen',
    );
    await page.screenshot({ path: `${output}/${viewport.width}x${viewport.height}.png` });
    await page.locator('#modal-close').click();
  }
  passed(
    'Portrait and landscape small screens: usable selection and apply without horizontal overflow',
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  await open();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#character-switch-form input:checked').inputValue(), 'cro-male');
  assert.equal(me().gender, 'female');
  assert.equal(await page.locator('#character-confirm').count(), 0);
  await page.keyboard.press('Escape');
  assert.equal(
    await page.locator('#modal').evaluate((el) => el.open),
    false,
    'Escape leaves the menu without applying the draft',
  );
  assert.equal(await page.locator('#character-confirm').count(), 0);
  await open();
  assert.equal(
    await page.locator('#character-switch-form input:checked').inputValue(),
    'cro-female',
  );
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#character-switch-form input:checked').inputValue(), 'cro-male');
  await page.locator('#character-switch-apply').focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !document.querySelector('#modal').open);
  await rendered(page, CHARACTER_MODELS[1]);
  passed('Keyboard arrows + Enter pick a card, Escape discards it, and Enter on apply commits it');
  await page.reload();
  await page.locator('#title-start').click();
  // The start screen offers the changed character, already chosen.
  await page.locator('#setup-form .character-choice:has(input:checked)').click();
  await page.locator('#setup-flow-yes').click();
  await page.locator('#mascot-start').click();
  await leaveCave(page);
  await rendered(page, CHARACTER_MODELS[1]);
  // Entering again through the update cave starts at the camp; the person stays the same.
  assert.equal(me().id, id);
  assert.deepEqual(
    { inventory: me().inventory, energy: me().energy },
    { inventory: original.inventory, energy: original.energy },
  );
  passed('Reload and resume restore the changed appearance, identity and possessions');
  // Real movement following a change, measured from where the resumed player stands.
  const resumed = { x: me().x, z: me().z };
  await page.locator('#world').focus();
  await page.keyboard.down('w');
  await page.waitForTimeout(450);
  await page.keyboard.up('w');
  await page.waitForTimeout(200);
  assert.ok(Math.hypot(me().x - resumed.x, me().z - resumed.z) > 0.1);
  await page.keyboard.press('f');
  await page.waitForTimeout(950);
  assert.ok(me().attackSequence > 0);
  passed('Manual movement and attack still work after switching and reloading');
  assert.deepEqual(errors, []);
} finally {
  clearInterval(keepActive);
  await writeFile(`${output}/summary.json`, JSON.stringify({ checks, errors }, null, 2));
  await browser?.close();
  await game.close();
}
