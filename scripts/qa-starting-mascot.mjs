// Real Chrome, isolated server and no user save. Choices/start/back use real UI.
// A read-only renderer observer checks the selected companion's actual GLB.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createGameCore } from '../dist/application/game-core.mjs';
import { createGameServer } from '../dist/server.mjs';
import { readDeliveryOverlay } from '../dist/infrastructure/node/delivery-overlay.mjs';
import { activeMascot, mascotBodies } from '../dist/shared/mascot-selection.mjs';
import { MASCOT_PORTRAITS } from '../dist/src/mascot-portraits.js';
import { enterPreparedWorld } from './qa-game-entry.mjs';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);
const output = process.argv[2] || `output/playwright/starting-mascot-${Date.now()}`;
await mkdir(output, { recursive: true });
const core = createGameCore({ persistentSessions: true, keepEmptyRooms: true });
const game = createGameServer({
  core,
  host: '127.0.0.1',
  port: 0,
  delivery: await readDeliveryOverlay(process.cwd()),
});
const { port } = await game.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const checks = [],
  errors = [],
  layouts = [],
  models = [];
const room = () => core.rooms.get('START-PET');
// Keep unattended QA peers present during GLB loads, without simulating input assertions.
const keepActive = setInterval(() => {
  for (const p of room()?.players.values() ?? []) p.lastActivityAt = Date.now();
}, 1000);
const pass = (label) => {
  checks.push(label);
  console.log('PASS', label);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, label, timeout = 90000) {
  const end = Date.now() + timeout;
  while (!(await check())) {
    if (Date.now() > end) throw Error(`Timed out: ${label}`);
    await sleep(100);
  }
}
async function open(name, mobile) {
  const context = await browser.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    hasTouch: mobile,
    isMobile: mobile,
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(`${name}: ${error.stack ?? error}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`${name}: ${message.text()}`);
  });
  await page.route('**/src/world3d.js', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body:
        (await response.text()) +
        '\nconst qaSetState=WorldRenderer.prototype.setState;WorldRenderer.prototype.setState=function(...args){globalThis.qaRenderer=this;return qaSetState.apply(this,args);};',
    });
  });
  await page.goto(`http://127.0.0.1:${port}/?room=START-PET`);
  const tap = (locator) => (mobile ? locator.tap() : locator.click());
  await tap(page.locator('#title-start'));
  await page.locator('#setup-form input[name="name"]').fill(name);
  return {
    name,
    page,
    context,
    mobile,
    tap,
    player: () => [...(room()?.players.values() ?? [])].find((p) => p.name === name),
  };
}
const pick = (who, key) => who.tap(who.page.locator(`[data-starting-mascot="${key}"]`));
async function photographs(who, selector) {
  for (const portrait of MASCOT_PORTRAITS) {
    const photo = who.page.locator(`${selector} img[src="${portrait.url}"]`);
    const info = await photo.evaluate(async (image) => {
      await image.decode();
      return {
        width: image.naturalWidth,
        height: image.naturalHeight,
        fit: getComputedStyle(image).objectFit,
      };
    });
    assert.deepEqual(info, { width: 384, height: 320, fit: 'contain' });
  }
}
async function menu(who, tab) {
  if (who.mobile) await who.tap(who.page.locator('[data-touch-action="menu"]'));
  else {
    await who.page.locator('#world').focus();
    await who.page.keyboard.press('Escape');
  }
  if (tab) await who.tap(who.page.locator(`[data-pause-tab="${tab}"]`));
}
async function title(who) {
  await menu(who);
  await who.tap(who.page.locator('[data-controller-menu="title"]'));
  await who.page.locator('#screen-title').waitFor({ state: 'visible' });
}
async function start(who, key) {
  if (await who.page.locator('#screen-setup').isVisible()) {
    await who.page.locator('#setup-form input[name="name"]').fill(who.name);
    await who.tap(who.page.locator('#setup-flow-yes'));
  }
  await pick(who, key);
  await who.tap(who.page.locator('#mascot-start'));
  await enterPreparedWorld(who.page, who.mobile);
  await until(() => who.player()?.mascot === key, `joins with ${key}`);
}
async function body(who, owner, key) {
  const actual = activeMascot(room(), owner);
  assert.ok(actual);
  const expected = MASCOT_PORTRAITS.find((photo) => photo.key === key);
  await who.page.waitForFunction(
    ({ id, modelKey }) => {
      const renderer = globalThis.qaRenderer;
      const entry =
        renderer?.companionRenderers.renderers.get(id) ?? renderer?.orbBotRenderer?.bots.get(id);
      return entry?.actor?.asset.modelKey === modelKey;
    },
    { id: actual.id, modelKey: expected.modelKey },
    { timeout: 90000 },
  );
  const model = await who.page.evaluate((id) => {
    const renderer = globalThis.qaRenderer;
    const r =
      renderer.companionRenderers.renderers.get(id) ?? renderer.orbBotRenderer?.bots.get(id);
    return {
      key: r.actor.asset.modelKey,
      sha256: r.actor.asset.sha256,
      visible: (r.root ?? r.actor.root).visible,
    };
  }, actual.id);
  const capture = JSON.parse(
    await readFile(
      `assets/mascot-portraits/${expected.modelKey.startsWith('orb-bot-') ? '20261015-dots-r01' : '20261015-r01'}/capture.json`,
      'utf8',
    ),
  );
  assert.equal(model.sha256, capture.records.find((record) => record.key === key).asset.sha256);
  assert.equal(model.visible, true);
  models.push(model);
}
let failure;
try {
  const first = await open('出発の仲間', true);
  assert.equal(await first.page.locator('#screen-mascot').isVisible(), false);
  assert.equal(await first.page.locator('#setup-form [data-starting-mascot]').count(), 0);
  await first.tap(first.page.locator('#setup-form .character-choice:has(input[value="cro-male"])'));
  await first.tap(first.page.locator('[data-dye="red"]'));
  const savedBefore = await first.page.evaluate(() => ({ ...localStorage }));
  await first.tap(first.page.locator('#setup-flow-yes'));
  assert.equal(await first.page.locator('#screen-setup').isVisible(), false);
  assert.equal(await first.page.locator('#screen-mascot').isVisible(), true);
  assert.equal(await first.page.locator('[data-starting-mascot]').count(), 12);
  await photographs(first, '#starting-mascot-form');
  await pick(first, 'rimo-neko');
  await pick(first, '524');
  assert.equal(await first.page.locator('[data-starting-mascot][aria-pressed="true"]').count(), 1);
  assert.equal(room()?.players.size ?? 0, 0);
  await first.page.locator('[data-starting-mascot="rimo-neko"]').focus();
  await first.page.keyboard.press('Enter');
  assert.equal(
    await first.page.locator('[data-starting-mascot="rimo-neko"]').getAttribute('aria-pressed'),
    'true',
  );
  assert.equal(room()?.players.size ?? 0, 0);
  assert.deepEqual(await first.page.evaluate(() => ({ ...localStorage })), savedBefore);
  pass(
    'Character and companion screens are separate; all 11 real photos load; draft selection and Enter never join or save',
  );
  for (const [width, height] of [
    [320, 568],
    [390, 844],
    [430, 932],
    [768, 1024],
    [844, 390],
  ]) {
    await first.page.setViewportSize({ width, height });
    await first.tap(first.page.locator('#mascot-back'));
    assert.equal(await first.page.locator('#screen-mascot').isVisible(), false);
    assert.equal(
      await first.page.locator('#setup-form input[name="name"]').inputValue(),
      first.name,
    );
    assert.equal(
      await first.page.locator('#setup-form input[name="character"]:checked').inputValue(),
      'cro-male',
    );
    assert.equal(
      await first.page.locator('#setup-form [data-dye="red"]').getAttribute('aria-pressed'),
      'true',
    );
    const characterHeight = await first.page
      .locator('.character-choice-grid')
      .evaluate((grid) => grid.getBoundingClientRect().height);
    assert.ok(characterHeight <= 261);
    await first.page.screenshot({
      path: `${output}/character-${width}.png`,
      animations: 'disabled',
    });
    await first.tap(first.page.locator('#setup-flow-yes'));
    await first.page.locator('[data-starting-mascot="524"]').scrollIntoViewIfNeeded();
    await pick(first, '524');
    await sleep(350);
    const layout = await first.page.locator('#starting-mascot-form').evaluate((form) => {
      const rect = (selector) => {
        const box = form.querySelector(selector).getBoundingClientRect();
        return {
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
          right: box.right,
          bottom: box.bottom,
        };
      };
      return {
        width: innerWidth,
        height: innerHeight,
        form: form.getBoundingClientRect().toJSON(),
        pets: rect('.starting-mascot-cards'),
        card: rect('[data-starting-mascot="524"]'),
        actions: rect('.mascot-setup-actions'),
        documentWidth: document.documentElement.scrollWidth,
      };
    });
    assert.ok(layout.documentWidth <= width + 1);
    assert.ok(layout.card.width >= 80 && layout.card.height < 170);
    assert.ok(
      layout.card.y >= 0 && layout.card.bottom <= height,
      `pet visible at ${width}x${height}`,
    );
    layouts.push(layout);
    await first.page.screenshot({ path: `${output}/setup-${width}.png`, animations: 'disabled' });
    await first.page.locator('#mascot-start').scrollIntoViewIfNeeded();
    assert.equal(await first.page.locator('#mascot-start').isVisible(), true);
    await pick(first, 'heart');
    assert.equal(
      await first.page.locator('[data-starting-mascot="heart"]').getAttribute('aria-pressed'),
      'true',
    );
  }
  await first.page.setViewportSize({ width: 390, height: 844 });
  await first.page.keyboard.press('Escape');
  assert.equal(await first.page.locator('#screen-setup').isVisible(), true);
  await first.tap(first.page.locator('#setup-flow-yes'));
  assert.equal(
    await first.page.locator('[data-starting-mascot="heart"]').getAttribute('aria-pressed'),
    'true',
  );
  pass(
    'Five phone/tablet dimensions keep compact cards; Back and Escape preserve the character, colour, name and companion draft',
  );
  await first.tap(first.page.locator('#mascot-back'));
  await first.tap(first.page.locator('#setup-back'));
  await first.tap(first.page.locator('#title-start'));
  assert.equal(
    await first.page.locator('[data-starting-mascot="none"]').getAttribute('aria-pressed'),
    'true',
  );
  pass('Returning all the way to the title cancels the unfinished choices');
  await first.tap(first.page.locator('[data-dye="red"]'));
  await start(first, '524');
  await body(first, first.player().id, '524');
  assert.equal(first.player().dye, 'red');
  pass('First entry brings the chosen 524 with the chosen outfit and verified real model');
  const second = await open('同じ仲間', false);
  await second.page.screenshot({ path: `${output}/character-desktop.png`, animations: 'disabled' });
  await second.tap(second.page.locator('#setup-flow-yes'));
  await second.page.screenshot({ path: `${output}/setup-desktop.png`, animations: 'disabled' });
  await start(second, '524');
  for (const who of [first, second])
    for (const owner of [first, second]) await body(who, owner.player().id, '524');
  assert.notEqual(
    activeMascot(room(), first.player().id).id,
    activeMascot(room(), second.player().id).id,
  );
  assert.equal(mascotBodies(room()).filter((c) => !c.leavingAt).length, 2);
  pass('Two real browsers bring the same 524, with one independent body per player');
  // Fixture-only preparation checks that entry keeps inventory; selection itself remains UI-driven.
  first.player().inventory.wood = 7;
  await menu(first, 'mascots');
  await photographs(first, '#modal');
  await first.page.screenshot({ path: `${output}/menu-photos.png`, animations: 'disabled' });
  for (const photo of MASCOT_PORTRAITS.filter((photo) => photo.modelKey.startsWith('orb-bot-'))) {
    await first.tap(first.page.locator(`[data-mascot="${photo.key}"]`));
    await until(() => first.player().mascot === photo.key, `menu chooses ${photo.key}`);
    await first.tap(first.page.locator('#modal-close'));
    await body(first, first.player().id, photo.key);
    assert.equal(
      mascotBodies(room()).filter((c) => c.ownerId === first.player().id && !c.leavingAt).length,
      1,
    );
    await menu(first, 'mascots');
  }
  pass(
    'All nine Dots share their photographed delivered GLBs with the real world and remain one companion per player',
  );
  await first.tap(first.page.locator('[data-mascot="rimo-neko"]'));
  await until(() => first.player().mascot === 'rimo-neko', 'menu pet change');
  await first.page.waitForFunction(() => localStorage.getItem('cro-mascot') === 'rimo-neko');
  await first.tap(first.page.locator('#modal-close'));
  await body(first, first.player().id, 'rimo-neko');
  await first.page.screenshot({ path: `${output}/rimo-in-world.png` });
  await title(first);
  await first.tap(first.page.locator('#title-start'));
  await first.tap(first.page.locator('#setup-flow-yes'));
  assert.equal(
    await first.page.locator('[data-starting-mascot="rimo-neko"]').getAttribute('aria-pressed'),
    'true',
  );
  pass('The in-game menu shares the photographs and remembers its choice at the next title start');
  await pick(first, 'none');
  await first.tap(first.page.locator('#mascot-back'));
  await first.tap(first.page.locator('#setup-back'));
  await first.tap(first.page.locator('#title-start'));
  assert.equal(
    await first.page.locator('[data-starting-mascot="rimo-neko"]').getAttribute('aria-pressed'),
    'true',
  );
  const id =
    first.player()?.id ??
    [...room().sessions.values()].find((entry) => entry.player.name === first.name)?.player.id;
  await start(first, '524');
  assert.equal(first.player().id, id);
  assert.equal(first.player().inventory.wood, 7);
  await body(first, first.player().id, '524');
  assert.equal(mascotBodies(room()).filter((c) => c.ownerId === id && !c.leavingAt).length, 1);
  pass('A new title choice replaces only the pet and preserves the saved player and inventory');
  await title(first);
  await first.tap(first.page.locator('#title-start'));
  await first.tap(first.page.locator('#setup-flow-yes'));
  await pick(first, 'none');
  await first.tap(first.page.locator('#mascot-start'));
  await enterPreparedWorld(first.page, true);
  await until(() => first.player() && first.player().mascot === null, 'travel alone');
  assert.equal(activeMascot(room(), first.player().id), undefined);
  pass('Explicit Travel alone clears the companion without affecting the other player');
  assert.equal(second.player().mascot, '524');
  assert.deepEqual(errors, []);
} catch (error) {
  failure = error;
  console.error(error);
  let index = 0;
  for (const context of browser.contexts())
    for (const page of context.pages())
      await page.screenshot({ path: `${output}/failure-${index++}.png` }).catch(() => {});
} finally {
  await writeFile(
    `${output}/result.json`,
    JSON.stringify(
      { ok: !failure, checks, layouts, models, errors, failure: failure?.stack },
      null,
      2,
    ),
  );
  clearInterval(keepActive);
  await browser.close();
  await game.close();
  process.exit(failure ? 1 : 0);
}
