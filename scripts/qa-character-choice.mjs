// Real Chrome and an isolated, unsaved room. Every selection/apply/back uses the UI.
// Read-only renderer observers check the actual cave/world outfits. The server activity
// timestamp is refreshed only to keep unattended peers from leaving during long asset loads.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createGameCore } from '../dist/application/game-core.mjs';
import { createGameServer } from '../dist/server.mjs';
import { PLAYABLE_CHARACTER_MODELS, characterModel } from '../dist/shared/characters.mjs';
import { CLOTHING_DYES } from '../dist/shared/clothing-dye.mjs';
import { cardValue } from '../dist/src/character-selection.js';
import { characterPortraitUrl } from '../dist/src/character-portraits.js';
import { enterPreparedWorld } from './qa-game-entry.mjs';

const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);
const output = process.argv[2] || `output/playwright/character-choice-${Date.now()}`;
await mkdir(output, { recursive: true });
const core = createGameCore({ persistentSessions: true, keepEmptyRooms: true });
const game = createGameServer({ core, host: '127.0.0.1', port: 0 });
const { port } = await game.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const checks = [],
  errors = [],
  layout = [],
  retiredRequests = [];
const room = () => core.rooms.get('CHOICE-QA');
const keepActive = setInterval(() => {
  for (const player of room()?.players.values() ?? []) player.lastActivityAt = Date.now();
}, 1000);
const pass = (message) => {
  checks.push(message);
  console.log('PASS', message);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, label, timeout = 90000) {
  const end = Date.now() + timeout;
  while (!(await check())) {
    if (Date.now() > end) throw Error(`Timed out: ${label}`);
    await sleep(80);
  }
}
async function open(name, mobile = false) {
  const context = await browser.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    hasTouch: mobile,
    isMobile: mobile,
  });
  const page = await context.newPage();
  page.on('request', (request) => {
    if (/\/models\/(cat-kunoichi|kunoichi-katana)\//i.test(request.url()))
      retiredRequests.push(request.url());
  });
  page.on('pageerror', (error) => errors.push(`${name}: ${error.stack ?? error}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`${name}: ${message.text()}`);
  });
  for (const [file, body] of [
    [
      'world3d.js',
      '\nconst qaSetState = WorldRenderer.prototype.setState; WorldRenderer.prototype.setState = function(...args) { globalThis.qaRenderer = this; return qaSetState.apply(this, args); };',
    ],
    [
      'loading-cave.js',
      '\nconst qaLoad = LoadingCave.prototype.load; LoadingCave.prototype.load = function(...args) { globalThis.qaCave = this; return qaLoad.apply(this, args); };',
    ],
  ])
    await page.route(`**/src/${file}`, async (route) => {
      const response = await route.fetch();
      await route.fulfill({ response, body: (await response.text()) + body });
    });
  await page.addInitScript((name) => {
    if (!localStorage.getItem('cro-name')) localStorage.setItem('cro-name', name);
  }, name);
  await page.goto(`http://127.0.0.1:${port}/?room=CHOICE-QA`);
  const tap = (locator) => (mobile ? locator.tap() : locator.click());
  return {
    page,
    context,
    mobile,
    tap,
    player: () => [...(room()?.players.values() ?? [])].find((p) => p.name === name),
  };
}
const choose = (who, value, scope = '#setup-form') =>
  who.tap(who.page.locator(`${scope} input[value="${value}"]`));
const dye = (who, value, scope = '#setup-form') =>
  who.tap(who.page.locator(`${scope} [data-dye="${value}"]`));
async function portraits(who, colour, scope = '#setup-form') {
  const images = await who.page
    .locator(`${scope} [data-character-image]`)
    .evaluateAll(async (items) => {
      await Promise.all(items.map((image) => image.decode()));
      return items.map((image) => ({
        key: image.dataset.characterImage,
        src: image.getAttribute('src'),
        width: image.naturalWidth,
        height: image.naturalHeight,
        filter: getComputedStyle(image).filter,
        fit: getComputedStyle(image).objectFit,
      }));
    });
  assert.equal(images.length, PLAYABLE_CHARACTER_MODELS.length);
  for (const image of images) {
    assert.equal(image.src, characterPortraitUrl(image.key, colour));
    assert.equal(image.width, 336);
    assert.equal(image.height, 384);
    assert.equal(image.filter, 'none', 'Colours are not darkened or desaturated by CSS');
    assert.equal(image.fit, 'contain', 'The photograph is not cropped');
  }
}
async function start(who) {
  await who.tap(who.page.locator('#setup-flow-yes'));
  await enterPreparedWorld(who.page, who.mobile);
  await until(() => who.player(), 'join');
}
async function menu(who) {
  if (who.mobile) await who.tap(who.page.locator('[data-touch-action="menu"]'));
  else {
    await who.page.locator('#world').focus();
    await who.page.keyboard.press('Escape');
  }
  await who.tap(who.page.locator('[data-pause-tab="character"]'));
}
async function wears(who, id, key, colour) {
  await who.page.waitForFunction(
    ({ id, key, colour }) => {
      const r = globalThis.qaRenderer;
      const actor = r?.players.get(id)?.actor;
      return actor?.asset.modelKey === key && (actor.clothing?.dye ?? null) === colour;
    },
    { id, key, colour },
    { timeout: 90000 },
  );
}
async function fits(who, label) {
  await who.page.screenshot({ path: `${output}/${label}.png`, animations: 'disabled' });
  const result = await who.page.locator('#setup-form').evaluate((form) => {
    const rect = (selector) => {
      const r = form.querySelector(selector).getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
    };
    return {
      width: innerWidth,
      height: innerHeight,
      button: rect('#setup-flow-yes'),
      colours: rect('.dye-picker'),
      grid: rect('.character-choice-grid'),
      cards: [...form.querySelectorAll('.character-choice')].map((card) => {
        const box = card.getBoundingClientRect();
        const photo = card.querySelector('img').getBoundingClientRect();
        return {
          width: box.width,
          height: box.height,
          imageWidth: photo.width,
          imageHeight: photo.height,
        };
      }),
      overflow: document.documentElement.scrollWidth > innerWidth,
    };
  });
  layout.push({ label, ...result });
  assert.equal(result.overflow, false, label);
  for (const r of [result.button, result.colours]) {
    assert.ok(
      r.x >= 0 && r.right <= result.width + 1 && r.y >= 0 && r.bottom <= result.height + 1,
      `${label}: ${JSON.stringify(r)}`,
    );
  }
  assert.ok(result.button.height >= 44, label);
  assert.ok(result.grid.height >= 70, `${label}: cards remain visible`);
  assert.ok(
    result.grid.height <= 261,
    `${label}: cards never stretch into the remaining screen height`,
  );
  const first = result.cards[0];
  for (const card of result.cards) {
    assert.ok(card.height / card.width < 2.1, `${label}: compact card proportions`);
    assert.ok(
      Math.abs(card.imageHeight - first.imageHeight) < 1,
      `${label}: one image scale for every character`,
    );
    assert.ok(Math.abs(card.imageWidth - first.imageWidth) < 1, `${label}: equal photo frames`);
  }
}

try {
  const a = await open('ChoiceA');
  await a.tap(a.page.locator('#title-contributors'));
  assert.deepEqual(await a.page.locator('.contributor-group h3').allTextContents(), [
    '制作',
    '関わってくれた人たち',
  ]);
  assert.equal(
    await a.page.locator('.contributor-group').first().locator('strong').innerText(),
    'yuri',
  );
  assert.equal(await a.page.locator('.contributor').count(), 8);
  assert.equal(await a.page.locator('.contributors-dialog a').count(), 7);
  assert.equal(await a.page.locator('.contributors-dialog h2').count(), 0);
  assert.equal(
    (await a.page.locator('.contributors-dialog').innerText()).match(/関わってくれた人たち/g)
      .length,
    1,
  );
  assert.doesNotMatch(await a.page.locator('.contributors-dialog').innerText(), /監修|友情出演/);
  await a.page.screenshot({ path: `${output}/contributors-desktop.png` });
  await a.tap(a.page.locator('#modal-close'));
  pass('Credits retain all eight names and seven links, under 制作 and one contributors group');
  await a.tap(a.page.locator('#title-start'));
  await a.page.locator('#setup-form').waitFor({ state: 'visible', timeout: 90000 });
  assert.equal(await a.page.locator('#setup-form [data-dye]').count(), 9);
  assert.equal(await a.page.locator('#setup-form input[value="cat-female"]').count(), 0);
  for (const model of PLAYABLE_CHARACTER_MODELS) {
    await choose(a, cardValue(model));
    assert.equal(await a.page.locator('#setup-form input:checked').inputValue(), cardValue(model));
    for (const colour of ['', ...CLOTHING_DYES.map((d) => d.key)]) {
      await dye(a, colour);
      await portraits(a, colour);
      assert.equal(
        await a.page
          .locator('#setup-form [data-dye][aria-pressed="true"]')
          .getAttribute('data-dye'),
        colour,
      );
      assert.equal(await a.page.locator('#setup-flow, #character-confirm').count(), 0);
    }
  }
  assert.equal(room()?.players.size ?? 0, 0);
  assert.equal(await a.page.evaluate(() => localStorage.getItem('cro-dye')), null);
  pass(
    `All ${PLAYABLE_CHARACTER_MODELS.length} characters × nine photographed colours appear without joining, saving or opening a modal`,
  );
  await choose(a, 'cro-male');
  await dye(a, 'blue');
  await a.page.locator('#setup-form input[value="cro-female"]').focus();
  await a.page.keyboard.press('Enter');
  assert.equal(await a.page.locator('#setup-form input:checked').inputValue(), 'cro-female');
  await a.page.locator('#setup-form [data-dye="red"]').focus();
  await a.page.keyboard.press('Enter');
  assert.equal(await a.page.locator('#setup-flow').count(), 0);
  await portraits(a, 'red');
  await a.page.screenshot({ path: `${output}/setup-desktop.png` });
  await a.tap(a.page.locator('#setup-flow-yes'));
  await a.page.waitForFunction(() => globalThis.qaCave?.actor, undefined, { timeout: 180000 });
  assert.equal(await a.page.evaluate(() => globalThis.qaCave.actor.clothing.dye), 'red');
  await enterPreparedWorld(a.page, false);
  await until(() => a.player()?.dye === 'red', 'first chosen colour');
  await wears(a, a.player().id, 'cro-magnon-woman', 'red');
  const id = a.player().id;
  const possessions = structuredClone({
    inventory: a.player().inventory,
    energy: a.player().energy,
    gathered: a.player().gathered,
  });
  pass(
    'Keyboard Enter selects cards and colours; one apply dresses the first cave and world actor in red',
  );
  await menu(a);
  await choose(a, 'cro-male', '#character-switch-form');
  await dye(a, 'green', '#character-switch-form');
  await portraits(a, 'green', '#character-switch-form');
  assert.equal(characterModel(a.player()).key, 'cro-magnon-woman');
  assert.equal(a.player().dye, 'red');
  assert.equal(await a.page.evaluate(() => localStorage.getItem('cro-dye')), 'red');
  await a.page.keyboard.press('Escape');
  assert.equal(await a.page.locator('#modal').evaluate((el) => el.open), false);
  await menu(a);
  assert.equal(
    await a.page.locator('#character-switch-form input:checked').inputValue(),
    'cro-female',
  );
  assert.equal(
    await a.page.locator('#character-switch-form [data-dye="red"]').getAttribute('aria-pressed'),
    'true',
  );
  await dye(a, 'white', '#character-switch-form');
  await portraits(a, 'white', '#character-switch-form');
  await a.tap(a.page.locator('#character-switch-apply'));
  await until(() => a.player().dye === 'white', 'colour only');
  await a.page.waitForFunction(() => !document.querySelector('#modal').open);
  await menu(a);
  await a.tap(a.page.locator('#character-switch-apply'));
  await a.page.waitForFunction(() => !document.querySelector('#modal').open);
  pass(
    'Back discards the draft; colour-only and unchanged outfits apply directly and return to play',
  );
  await menu(a);
  await dye(a, 'teal', '#character-switch-form');
  const alternate = PLAYABLE_CHARACTER_MODELS.find((m) => cardValue(m) === m.key);
  assert.ok(alternate, 'a distinct model sharing species/gender is available');
  await choose(a, cardValue(alternate), '#character-switch-form');
  await portraits(a, 'teal', '#character-switch-form');
  assert.equal(await a.page.locator('#character-confirm').count(), 0);
  await a.page.screenshot({ path: `${output}/change-desktop.png` });
  await a.tap(a.page.locator('#character-switch-apply'));
  await until(
    () => characterModel(a.player()).key === alternate.key && a.player().dye === 'teal',
    'new character and colour',
  );
  await a.page.waitForFunction(() => !document.querySelector('#modal').open);
  await wears(a, id, alternate.key, 'teal');
  assert.equal(a.player().id, id);
  assert.deepEqual(
    { inventory: a.player().inventory, energy: a.player().energy, gathered: a.player().gathered },
    possessions,
  );
  await a.page.reload();
  await a.tap(a.page.locator('#title-start'));
  await a.page.locator('#setup-form').waitFor({ state: 'visible', timeout: 90000 });
  assert.equal(
    await a.page.locator('#setup-form input:checked').inputValue(),
    cardValue(alternate),
  );
  assert.equal(
    await a.page.locator('#setup-form [data-dye="teal"]').getAttribute('aria-pressed'),
    'true',
  );
  await portraits(a, 'teal');
  await choose(a, 'cro-male');
  await dye(a, 'purple');
  await start(a);
  assert.equal(a.player().id, id);
  assert.equal(a.player().dye, 'purple');
  assert.deepEqual(a.player().inventory, possessions.inventory);
  pass(
    'A distinct character model and colour apply together; reload/reselection preserve identity and possessions',
  );

  const b = await open('ChoiceB', true);
  await b.tap(b.page.locator('#title-start'));
  await b.page.locator('#setup-form').waitFor({ state: 'visible', timeout: 90000 });
  for (const viewport of [
    { width: 320, height: 568 },
    { width: 390, height: 844 },
    { width: 430, height: 932 },
    { width: 768, height: 1024 },
    { width: 844, height: 390 },
  ]) {
    await b.page.setViewportSize(viewport);
    await portraits(b, '');
    await fits(b, `setup-phone-${viewport.width}x${viewport.height}`);
  }
  await b.page.setViewportSize({ width: 390, height: 844 });
  await choose(b, 'bear-female');
  await b.page
    .locator('#setup-form input[value="bear-female"]')
    .evaluate((input) =>
      input.closest('label').scrollIntoView({ block: 'nearest', inline: 'start' }),
    );
  await fits(b, 'setup-phone-size-ratios');
  await choose(b, 'cro-female');
  await dye(b, 'pink');
  await choose(b, 'cro-male');
  await dye(b, 'yellow');
  await start(b);
  assert.equal(b.player().dye, 'yellow');
  await wears(a, b.player().id, 'cro-magnon-hunter', 'yellow');
  await wears(b, a.player().id, 'cro-magnon-hunter', 'purple');
  await menu(b);
  await choose(b, 'cro-female', '#character-switch-form');
  await dye(b, 'pink', '#character-switch-form');
  await portraits(b, 'pink', '#character-switch-form');
  assert.equal(b.player().dye, 'yellow');
  await b.page.screenshot({ path: `${output}/change-phone.png` });
  await b.tap(b.page.locator('#character-switch-apply'));
  await until(
    () => b.player().dye === 'pink' && characterModel(b.player()).key === 'cro-magnon-woman',
    'phone outfit',
  );
  await wears(a, b.player().id, 'cro-magnon-woman', 'pink');
  pass('Touch setup fits 320px/390px portrait and landscape; phone changes reach the other player');
  await b.tap(b.page.locator('[data-touch-action="menu"]'));
  await b.tap(b.page.locator('[data-controller-menu="title"]'));
  await b.tap(b.page.locator('#title-language'));
  await b.tap(b.page.locator('#title-contributors'));
  assert.deepEqual(await b.page.locator('.contributor-group h3').allTextContents(), [
    'Created by',
    'Contributors',
  ]);
  assert.equal(await b.page.locator('.contributors-dialog h2').count(), 0);
  await b.page.screenshot({ path: `${output}/contributors-phone-en.png` });
  await b.tap(b.page.locator('#modal-close'));
  await b.tap(b.page.locator('#title-start'));
  await b.page.locator('#setup-form').waitFor({ state: 'visible', timeout: 90000 });
  assert.equal(await b.page.locator('#setup-flow-yes').innerText(), 'Use this');
  await dye(b, 'green');
  assert.doesNotMatch(
    await b.page.locator('.character-choice-controls').innerText(),
    /[ぁ-んァ-ヶ一-龯]/,
  );
  pass('English translates the merged credits, apply button and live outfit summary');
  assert.deepEqual(retiredRequests, [], 'The kunoichi and its katana are never downloaded');
  pass(
    'Phone cards stay compact at 320–768px; the removed kunoichi and katana are never requested',
  );
  assert.deepEqual(errors, []);
} finally {
  await writeFile(
    `${output}/result.json`,
    JSON.stringify({ checks, errors, layout, retiredRequests }, null, 2),
  );
  clearInterval(keepActive);
  await browser.close();
  await game.close();
  console.log(`Evidence: ${output}`);
}
