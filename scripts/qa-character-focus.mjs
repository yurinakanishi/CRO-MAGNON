// Independent test world. All selection, confirmation and switching use real UI;
// only the controller device and exhibition runtime config are simulated.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createGameServer } from '../dist/server.mjs';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);
const folder = `output/playwright/character-focus-${Date.now()}`;
await mkdir(folder, { recursive: true });
const game = createGameServer({ host: '127.0.0.1', port: 0 });
const { port } = await game.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [],
  checks = [],
  observations = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const pass = (message) => {
  checks.push(message);
  console.log(`PASS ${message}`);
};
const card = (value, scope = '#setup-form') =>
  `${scope} .character-choice:has(input[value="${value}"])`;
async function open(options = {}, lan = false) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...options });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.addInitScript(() => {
    window.qaPad = {
      id: 'Wireless Controller',
      index: 0,
      connected: true,
      mapping: 'standard',
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 18 }, () => ({ pressed: false, value: 0 })),
    };
    Object.defineProperty(navigator, 'getGamepads', { value: () => [window.qaPad] });
  });
  if (lan)
    await page.route('**/multiplayer-config.json', (route) =>
      route.fulfill({
        json: {
          mode: 'lan',
          serverUrl: `ws://127.0.0.1:${port}/ws`,
          room: 'EXHIBITION',
          guestName: 'Focus QA',
        },
      }),
    );
  await page.goto(`http://127.0.0.1:${port}/?room=FOCUS-QA`);
  await page.locator('#title-start').click();
  await page.waitForFunction(() =>
    [...document.querySelectorAll('#setup-form .character-art')].every(
      (img) => img.complete && img.naturalWidth,
    ),
  );
  console.log(await page.locator('#screen-setup').ariaSnapshot());
  return page;
}
async function cursor(page, expected, label, scope = '#setup-form') {
  await sleep(450);
  const state = await page.locator(scope).evaluate((form) => ({
    active:
      document.activeElement?.getAttribute('name') === 'character'
        ? document.activeElement.value
        : null,
    checked: form.querySelector('input[name="character"]:checked')?.value,
    cards: [...form.querySelectorAll('.character-choice')].map((el) => ({
      value: el.querySelector('input').value,
      filter: getComputedStyle(el.querySelector('img')).filter,
      border: getComputedStyle(el).borderColor,
      focused: el.matches(':focus-within'),
      hovered: el.matches(':hover'),
    })),
    checks: form.querySelectorAll('.character-check').length,
  }));
  assert.equal(state.active, expected, label);
  const highlighted = state.cards.filter((c) => c.filter === 'none');
  assert.deepEqual(
    highlighted.map((c) => c.value),
    expected ? [expected] : [],
    label,
  );
  assert.deepEqual(
    state.cards.filter((c) => c.border === 'rgb(224, 176, 112)').map((c) => c.value),
    expected ? [expected] : [],
    label,
  );
  assert.equal(state.checks, 0);
  observations.push({ label, ...state });
  await page.screenshot({ path: `${folder}/${label}.png`, animations: 'disabled' });
  return state;
}
async function tap(page, button) {
  await page.bringToFront();
  for (const pressed of [false, true, false]) {
    await page.evaluate(
      ({ button, pressed }) => {
        window.qaPad.buttons[button] = { pressed, value: pressed ? 1 : 0 };
      },
      { button, pressed },
    );
    await sleep(180);
  }
}
async function who(page, value, scope = '#setup-flow') {
  await page.locator(scope).waitFor();
  assert.equal(
    await page.locator('#setup-form input[name="character"]:checked').inputValue(),
    value,
  );
  assert.equal(await page.locator(scope).getAttribute('data-step'), 'difficulty');
}
try {
  const page = await open();
  const initial = await cursor(page, null, '01-initial-no-false-selection');
  assert.equal(initial.checked, 'cro-female');
  pass('Initial stored female does not show a checked badge or a false cursor');

  await page.locator(card('cro-male')).hover();
  const hovered = await cursor(page, 'cro-male', '02-mouse-male-only');
  assert.equal(hovered.checked, 'cro-female');
  assert.equal(await page.locator('#setup-flow').count(), 0);
  pass('Mouse hover highlights only its target, without choosing or opening the next step');

  await page.keyboard.press('ArrowRight');
  const keyed = await cursor(page, 'nea-female', '03-keyboard-with-stationary-mouse');
  assert.equal(keyed.cards.find((c) => c.hovered)?.value, 'cro-male');
  await page.keyboard.press('Enter');
  await who(page, 'nea-female');
  await page.keyboard.press('Escape');
  await cursor(page, 'nea-female', '04-back-from-difficulty');
  pass(
    'Keys move the only highlight despite a stationary mouse; Enter and Back keep the correct character',
  );

  await tap(page, 15);
  await cursor(page, 'nea-male', '05-controller-male-only');
  await tap(page, 1);
  await who(page, 'nea-male');
  await page.locator('[data-choose-difficulty="hard"]').click();
  await page.locator('#setup-flow-no').click();
  await page.keyboard.press('Escape');
  await cursor(page, 'nea-male', '06-back-from-final-confirmation');
  pass(
    'Simulated controller navigation, circle confirmation and cancellation use the highlighted character',
  );

  await page.locator(card('bear-female')).hover();
  await cursor(page, 'bear-female', '07-mouse-after-controller');
  await page.locator(card('bear-female')).click();
  await who(page, 'bear-female');
  await page.locator('[data-choose-difficulty="easy"]').click();
  await page.locator('#setup-flow-yes').click();
  await page
    .locator(
      '#world[data-world-asset="ready"][data-character-asset="ready"][data-player-model="desert-fennec-mage"]',
    )
    .waitFor({ timeout: 90000 });
  pass('Mouse after controller selects the mage and renders that exact model in the real game');

  await page.keyboard.press('Escape');
  await page.locator('[data-controller-menu="character"]').click();
  await cursor(page, 'bear-female', '08-in-game-current-character', '#character-switch-form');
  await page.locator(card('cro-male', '#character-switch-form')).hover();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await page.locator('#character-confirm-no').click();
  const cancelled = await cursor(
    page,
    'nea-female',
    '09-switch-cancel-one-cursor',
    '#character-switch-form',
  );
  assert.equal(cancelled.checked, 'bear-female');
  await page.keyboard.press('Enter');
  await page.locator('#character-confirm-yes').click();
  await page
    .locator('#world[data-character-asset="ready"][data-player-model="neanderthal-woman"]')
    .waitFor({ timeout: 90000 });
  pass(
    'The shared in-game character picker also keeps one cursor after cancellation and switches to the correct model',
  );

  await page.keyboard.press('Escape');
  await page.locator('[data-controller-menu="title"]').click();
  await page.locator('#title-start').click();
  const reopened = await cursor(page, null, '10-title-reopen');
  assert.equal(reopened.checked, 'nea-female');
  await page.locator(card('cat-female')).hover();
  await cursor(page, 'cat-female', '11-reopen-hover');
  await page.reload();
  await page.locator('#title-start').click();
  const reloaded = await cursor(page, null, '12-reload-saved-choice');
  assert.equal(reloaded.checked, 'nea-female');
  pass(
    'Returning to title and reloading preserve the profile without restoring a second highlight',
  );

  const lan = await open({}, true);
  await cursor(lan, 'cro-female', '13-exhibition-initial');
  await tap(lan, 15);
  await cursor(lan, 'cro-male', '14-exhibition-controller');
  await tap(lan, 1);
  await who(lan, 'cro-male');
  pass('Exhibition layout starts with one cursor and moves it cleanly from the first woman');

  const narrow = await open({ viewport: { width: 390, height: 844 }, hasTouch: true });
  await narrow.locator(card('cat-female')).tap();
  await who(narrow, 'cat-female');
  await narrow.keyboard.press('Escape');
  await cursor(narrow, 'cat-female', '15-touch-narrow');
  pass('Touch selection and Back work on the 390 by 844 layout');
  assert.deepEqual(errors, []);
} finally {
  await writeFile(
    `${folder}/result.json`,
    JSON.stringify({ checks, errors, observations }, null, 2),
  );
  console.log('EVIDENCE', folder);
  await browser.close();
  await game.close();
}
