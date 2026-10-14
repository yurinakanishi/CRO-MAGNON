// Real Chrome against an independent, memory-only room. No existing server or save is used.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createGameServer } from '../dist/server.mjs';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);
const out = process.argv[2] || `output/playwright/language-${Date.now()}`;
await mkdir(out, { recursive: true });
const game = createGameServer({
  port: 0,
  host: '127.0.0.1',
  environment: 'local',
  runtimeConfig: { mode: 'online', serverUrl: '', room: 'LANGUAGE-QA' },
});
const { port } = await game.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const checks = [],
  errors = [];
let page, failure;
const pass = (label, detail) => {
  checks.push({ label, detail });
  console.log('PASS', label);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const url = `http://127.0.0.1:${port}/`;
async function expectText(selector, expected, target = page) {
  await target.waitForFunction(
    ({ selector, expected }) => document.querySelector(selector)?.textContent.trim() === expected,
    { selector, expected },
  );
}
async function englishOnly(selector, target = page) {
  const text = await target.locator(selector).innerText();
  assert.doesNotMatch(text, /[\u3040-\u30ff\u3400-\u9fff]/, `${selector}: ${text}`);
}
async function shot(name, target = page) {
  await target.screenshot({ path: `${out}/${name}.png`, animations: 'disabled' });
}
function captureErrors(target) {
  target.on('pageerror', (error) => errors.push(error.message));
  target.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
}
try {
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  captureErrors(page);
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  await page.route('**/src/main.js', async (route) => {
    await held;
    await route.continue();
  });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await expectText('#title-start', 'はじめる');
  await page.locator('#title-language').click();
  await expectText('#title-start', 'Start');
  assert.equal(await page.locator('html').getAttribute('lang'), 'en');
  await page.locator('#title-contributors').click();
  await expectText('.contributors-dialog h2', 'Contributors');
  // The credits are only a list: no way into the cave from here.
  assert.equal(await page.locator('.contributors-dialog button, #contributors-cave').count(), 0);
  assert.ok((await page.locator('.contributor strong[translate="no"]').count()) > 0);
  await shot('01-shell-contributors-en');
  await page.locator('#modal-close').click();
  await page.locator('#title-start').click();
  await expectText('[data-title-status]', 'Getting ready…');
  await page.locator('#title-language').click();
  await expectText('[data-title-status]', '準備しています…');
  await page.locator('#title-language').click();
  await expectText('[data-title-status]', 'Getting ready…');
  release();
  await page.locator('#screen-setup').waitFor({ state: 'visible', timeout: 90000 });
  await expectText('.setup-heading h2', 'Choose a character');
  assert.equal(await page.locator('#setup-form').count(), 1);
  pass(
    'The lightweight title toggles immediately; the credits list and a pending start survive the game handoff',
  );

  await page.locator('input[name="name"]').fill('はい');
  await page.locator('#setup-back').click();
  await page.locator('#title-start').focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  assert.equal(
    await page.locator('#title-language').evaluate((el) => document.activeElement === el),
    true,
  );
  await page.keyboard.press('Enter');
  await expectText('#title-start', 'はじめる');
  assert.equal(
    await page.locator('#title-language').evaluate((el) => document.activeElement === el),
    true,
  );
  await page.keyboard.press('Space');
  await expectText('#title-start', 'Start');
  assert.equal(await page.locator('input[name="name"]').inputValue(), 'はい');
  await shot('02-title-en');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expectText('#title-start', 'Start');
  assert.equal(await page.evaluate(() => localStorage.getItem('cro-language')), 'en');
  pass('Enter/Space toggle once without losing focus or input; English survives reload');

  await page.locator('#title-start').click();
  await page.locator('input[name="name"]').fill('はい');
  await englishOnly('#screen-setup');
  await page.locator('.character-choice:has(input[value="cro-female"])').click();
  await englishOnly('#setup-flow');
  await shot('03-confirm-en');
  await page.locator('#setup-flow-yes').click();
  await page.locator('#loading-screen').waitFor({ state: 'visible' });
  assert.equal(await page.locator('.loading-screen-tip figcaption').count(), 0);
  await englishOnly('#loading-screen');
  await shot('03b-loading-screen-en');
  await page.locator('#loading-screen').waitFor({ state: 'hidden', timeout: 180000 });
  await expectText('.loading-cave-heading h2', 'Update Cave');
  await expectText('[data-cave-murals]', 'People in the murals');
  await page.locator('[data-cave-murals]').click();
  await expectText('.mural-people-dialog h2', 'People in the murals');
  assert.equal(await page.locator('.mural-people-dialog .contributor-group').count(), 0);
  assert.equal(
    await page
      .locator('.mural-people-dialog .contributor strong[translate="no"]')
      .allTextContents()
      .then((names) => names.includes('OpenAI Dots')),
    true,
  );
  // A card is the person's name, verbatim: no image, platform mark, character name or handle.
  assert.equal(await page.locator('.mural-people-dialog .contributor small').count(), 0);
  assert.equal(
    await page
      .locator('.mural-people-dialog .contributor img, .mural-people-dialog .contributor svg')
      .count(),
    0,
  );
  await shot('03c-cave-murals-en');
  await page.locator('#modal-close').click();
  pass('Merged loading tips and the cave’s mural people use English and retain the Dots');
  await shot('04-loading-en');
  await page.locator('[data-cave-proceed]').click({ timeout: 180000 });
  await page
    .locator('#world[data-world-asset="ready"][data-character-asset="ready"]')
    .waitFor({ timeout: 90000 });
  await page.waitForFunction(() => performance.getEntriesByName('cro:controls').length > 0, null, {
    timeout: 90000,
  });
  await expectText('#profile-name', 'はい');
  assert.equal(await page.locator('#day-label, #map-area').count(), 0);
  await shot('05-game-en');
  pass(
    'Character selection, confirmation, loading cave and in-game HUD use English; player name stays verbatim',
  );

  await page.locator('#world').focus();
  await page.keyboard.press('i');
  await expectText('.inventory-header h2', 'Inventory');
  await sleep(150);
  await englishOnly('.inventory-workspace');
  // Preparation only: supplies for one crafting transaction. Craft and equip use real UI.
  const player = [...game.rooms.get('LANGUAGE-QA').players.values()][0];
  player.inventory.wood = 12;
  player.inventory.stone = 8;
  await page.locator('[data-craft="axe"][aria-disabled="false"]').waitFor();
  await page.locator('[data-craft="axe"]').click();
  await expectText('#equipment-confirm-title', 'Equip this item?');
  await englishOnly('#equipment-confirm');
  await page.locator('#equipment-confirm-yes').click();
  await page.locator('#equipment-confirm').waitFor({ state: 'detached' });
  assert.equal(player.equippedItem, 'axe');
  await shot('06-inventory-en');
  await page.locator('[data-pause-tab="settings"]').click();
  await englishOnly('[data-pause-panel="settings"]');
  await shot('07-settings-en');
  await page.locator('[data-pause-tab="mascots"]').click();
  await englishOnly('[data-pause-panel="mascots"]');
  await page.locator('[data-mascot="white"]').click();
  await page.locator('[data-mascot="white"][aria-pressed="true"]').waitFor();
  assert.equal(player.mascot, 'white');
  await page.locator('[data-mascot-none]').click();
  await page.waitForFunction(() => !document.querySelector('[data-mascot][aria-pressed="true"]'));
  assert.equal(player.mascot, null);
  await shot('07b-mascots-en');
  pass('Inventory, crafting results, equipment confirmation, settings and companions use English');

  await page.keyboard.press('Escape');
  // Fast travel to the pictured sights lives in the map: its photo row and the chosen card.
  await page.locator('#world').focus();
  await page.keyboard.press('m');
  await page.locator('[data-map-place="spawn-mammoth"]').click();
  await page.locator('#map-card[data-state="ready"]').waitFor();
  await englishOnly('.atlas-places');
  await englishOnly('#map-card');
  await shot('07b2-map-sights-en');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#modal').open);
  pass('The map’s landmark photos and the chosen landmark’s card use English');
  await page.locator('#status-plate').click();
  await expectText('#modal-body > h2', 'Players');
  await expectText('#tribe-summary', 'Players: 1');
  await shot('07c-players-en');
  await page.locator('#tribe-invite').click();
  await expectText('#modal-body > h2', 'Invite');
  await shot('07d-invite-en');
  await page.locator('#modal-close').click();
  pass('Player count and invitation titles use English; companion selection still works');

  await page.locator('#chat-toggle').click();
  await expectText('#chat-toggle strong', 'Chat');
  await page.locator('#chat-input').fill('はじめる 木材 <b>そのまま</b>');
  await page.locator('#chat-input').press('Enter');
  await expectText('#chat-messages p:last-child', 'はい はじめる 木材 <b>そのまま</b>');
  assert.equal(await page.locator('#chat-messages p:last-child b').count(), 0);
  pass(
    'Player chat remains verbatim and escaped, even when its words match the translation catalog',
  );

  await page.locator('#world').focus();
  await page.keyboard.press('Escape');
  await page.locator('[data-controller-menu="title"]').click();
  await page.locator('#title-language').click();
  await expectText('#title-start', 'はじめる');
  await page.locator('#title-contributors').click();
  await expectText('.contributors-dialog h2', '関わってくれた人たち');
  await page.locator('#modal-close').click();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expectText('#title-start', 'はじめる');
  pass('Returning from play restores Japanese in one click and retains it across reload');

  // Exercise the shared DOM adapter with an actual DOM, including late updates and blocked storage.
  // Game copy is intentionally loaded with main, after the lightweight title.
  await page.waitForFunction(
    () => performance.getEntriesByName('cro:game-module-ready').length > 0,
    null,
    { timeout: 90000 },
  );
  const dom = await page.evaluate(async () => {
    const { setLanguage } = await import('/src/language.js');
    const { installLanguageUI, setLocalizedText } = await import('/src/language-ui.js');
    const root = document.createElement('section');
    root.innerHTML =
      '<button title="戻る">戻る</button><input value="はじめる" placeholder="仲間に話しかける…"><p translate="no">はじめる</p><span class="dynamic"></span>';
    document.body.append(root);
    installLanguageUI(root);
    setLanguage('en');
    const button = root.querySelector('button');
    const input = root.querySelector('input');
    const dynamic = root.querySelector('.dynamic');
    dynamic.textContent = '石斧';
    await new Promise(requestAnimationFrame);
    const first = [
      button.textContent,
      button.title,
      input.value,
      input.placeholder,
      root.querySelector('p').textContent,
      dynamic.textContent,
    ];
    let mutations = 0;
    const observer = new MutationObserver((r) => (mutations += r.length));
    observer.observe(dynamic, { childList: true, characterData: true, subtree: true });
    setLocalizedText(dynamic, '石斧');
    for (let i = 0; i < 100; i++) setLocalizedText(dynamic, '石斧');
    await new Promise(requestAnimationFrame);
    observer.disconnect();
    const original = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw Error('blocked');
      },
    });
    setLanguage('ja');
    const restored = [button.textContent, button.title, input.value, dynamic.textContent];
    Object.defineProperty(window, 'localStorage', original);
    root.remove();
    return { first, restored, mutations };
  });
  assert.deepEqual(dom.first, [
    'Back',
    'Back',
    'はじめる',
    'Talk to your companions…',
    'はじめる',
    'Stone axe',
  ]);
  assert.deepEqual(dom.restored, ['戻る', '戻る', 'はじめる', '石斧']);
  assert.equal(dom.mutations, 0);
  pass(
    'Late UI updates translate; Japanese restores original nodes; 100 unchanged English HUD updates write nothing; blocked storage is safe',
    dom,
  );

  for (const [width, height] of [
    [320, 568],
    [390, 844],
    [844, 390],
  ]) {
    const mobile = await browser.newPage({
      viewport: { width, height },
      isMobile: true,
      hasTouch: true,
    });
    captureErrors(mobile);
    await mobile.goto(url, { waitUntil: 'domcontentloaded' });
    await mobile.locator('#title-language').tap();
    await expectText('#title-start', 'Start', mobile);
    const rect = await mobile.locator('#title-language').boundingBox();
    assert.ok(
      rect.width >= 44 &&
        rect.height >= 43.9 &&
        rect.x >= 0 &&
        rect.y >= 0 &&
        rect.x + rect.width <= width + 1 &&
        rect.y + rect.height <= height + 1,
      JSON.stringify(rect),
    );
    await shot(`08-touch-${width}x${height}`, mobile);
    await mobile.locator('#title-start').tap();
    await expectText('.setup-heading h2', 'Choose a character', mobile);
    await mobile.locator('.character-choice:has(input[value="cro-female"])').tap();
    await englishOnly('#setup-flow', mobile);
    await shot(`09-touch-confirm-${width}x${height}`, mobile);
    await mobile.close();
    pass(`Touch toggle and English confirmation fit ${width}×${height}`);
  }
  assert.deepEqual(errors, []);
  console.log(`Evidence: ${out}`);
} catch (error) {
  failure = error.stack;
  if (page) {
    await shot('failure').catch(() => {});
    await writeFile(`${out}/failure.html`, await page.content().catch(() => ''));
  }
  throw error;
} finally {
  await writeFile(`${out}/result.json`, JSON.stringify({ checks, errors, failure }, null, 2));
  await browser.close();
  await game.close();
}
