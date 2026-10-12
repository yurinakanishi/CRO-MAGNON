// Real Chrome travelers in an isolated, unsaved room: one writes a self-introduction, the
// others walk up and look at them (keyboard, click and phone touch) to read their card.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createGameServer } from '../dist/server.mjs';
import { chooseMascot } from '../dist/shared/mascot-selection.mjs';
import { enterPreparedWorld } from './qa-game-entry.mjs';

const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);
const output = process.argv[2] || `output/playwright/player-profile-${Date.now()}`;
await mkdir(output, { recursive: true });
const ROOM = 'PROFILE-QA';
const INTRO = 'はじめまして。マンモス狩りが好きです。';
const game = createGameServer({ host: '127.0.0.1', port: 0 });
const { port } = await game.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [];
const checks = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, label, timeout = 15000) {
  const end = Date.now() + timeout;
  while (!(await check())) {
    if (Date.now() > end) throw Error(`timed out: ${label}`);
    await sleep(40);
  }
  checks.push(label);
}
const room = () => game.rooms.get(ROOM);

async function join(name, { viewport, mobile = false, language = 'ja', gender = 'female' }) {
  const context = await browser.newContext({ viewport, hasTouch: mobile, isMobile: mobile });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(`${name}: ${error}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`${name}: ${message.text()}`);
  });
  await page.addInitScript(
    ({ name, gender, language }) => {
      localStorage.setItem('cro-name', name);
      localStorage.setItem('cro-species', 'cro');
      localStorage.setItem('cro-gender', gender);
      localStorage.setItem('cro-language', language);
    },
    { name, gender, language },
  );
  const before = new Set(room()?.players.keys() ?? []);
  await page.goto(`http://127.0.0.1:${port}/?room=${ROOM}&autostart=1`);
  await enterPreparedWorld(page, mobile);
  await until(
    () => [...(room()?.players.keys() ?? [])].some((id) => !before.has(id)),
    `${name} joined`,
  );
  const id = [...room().players.keys()].find((key) => !before.has(key));
  return { name, context, page, id, player: () => room().players.get(id) };
}
/** Stand facing the traveler from a few steps away, on open ground near the camp. */
async function faceTraveler(viewer, target, gap = 2.6) {
  const t = target.player();
  Object.assign(viewer.player(), { x: t.x, z: t.z - gap, facing: 0, dx: 0, dz: 0 });
  await sleep(1200);
}
const card = (who) => who.page.locator('#player-profile');

let result;
const a = await join('Companion A', { viewport: { width: 1440, height: 900 } });
try {
  // A writes a self-introduction from the status plate's dialog.
  Object.assign(a.player(), { x: 120, z: 120, facing: Math.PI });
  await a.page.locator('#status-plate').click();
  await a.page.locator('#intro-input').fill(INTRO);
  await a.page.locator('#intro-form button[type="submit"]').click();
  await until(() => a.player().intro === INTRO, 'the introduction reaches the server');
  await until(
    () =>
      a.page
        .locator('#intro-status')
        .innerText()
        .then((text) => text.includes('保存しました')),
    'the dialog confirms it was saved',
  );
  await a.page.screenshot({ path: `${output}/a-intro-editor.png`, animations: 'disabled' });
  await a.page.keyboard.press('Escape');

  // B (English interface) walks up and looks at A with the keyboard.
  const b = await join('Companion B', {
    viewport: { width: 1280, height: 800 },
    language: 'en',
    gender: 'male',
  });
  await faceTraveler(b, a);
  await until(
    () =>
      b.page
        .locator('[data-cue="inspect"]')
        .innerText()
        .then((text) => text.includes('Companion A'))
        .catch(() => false),
    'B is offered a look at A',
  );
  await b.page.locator('#world').focus();
  await b.page.keyboard.press('x');
  await until(
    () =>
      b.page.evaluate((id) => document.querySelector('#world').dataset.companionView === id, a.id),
    'B looks closely at A',
  );
  await card(b).waitFor({ state: 'visible' });
  assert.equal(await card(b).getAttribute('data-player'), a.id);
  const text = await card(b).innerText();
  assert.match(text, /Companion A/);
  assert.ok(text.includes(INTRO), 'her own words stay as written in English');
  assert.match(text, /Health/);
  assert.match(text, /100 \/ 100/);
  assert.match(text, /Traveling alone/);
  checks.push("A's card shows her words and visible state, in B's language");
  // The card follows what changes in the world.
  chooseMascot(room(), a.player(), 'white', Date.now());
  await until(
    () =>
      card(b)
        .innerText()
        .then((value) => /White bot/.test(value)),
    "A's new companion appears on the card",
  );
  await sleep(600);
  await b.page.screenshot({ path: `${output}/b-looks-at-a.png` });
  // Walking away ends the close-up and the card.
  await b.page.keyboard.down('s');
  await sleep(500);
  await b.page.keyboard.up('s');
  await until(() => card(b).isHidden(), 'moving away closes the card');

  // A click on A also looks at her.
  await faceTraveler(b, a);
  const label = b.page.locator('.world-label.player', { hasText: 'Companion A' });
  await label.waitFor({ state: 'visible' });
  const box = await label.boundingBox();
  // The name floats over the head; the body is somewhere below it, depending on the zoom.
  for (const below of [40, 80, 120, 160, 200, 240, 280]) {
    await b.page.mouse.click(box.x + box.width / 2, box.y + box.height + below);
    await sleep(350);
    if (await card(b).isVisible()) break;
  }
  await until(() => card(b).isVisible(), 'a click on A opens her card');
  await b.page.keyboard.press('Escape');
  await until(() => card(b).isHidden(), 'Escape returns from the close-up');

  // A phone in portrait: the prompt names A; her card takes the free corner by the thumb.
  // B steps aside first, so A is the only traveler in front of the phone.
  Object.assign(b.player(), { x: a.player().x + 25, z: a.player().z, dx: 0, dz: 0 });
  const c = await join('Companion C', { viewport: { width: 390, height: 844 }, mobile: true });
  await faceTraveler(c, a);
  const prompt = c.page.locator('[data-touch-action="inspect"]');
  await until(
    () =>
      prompt
        .innerText()
        .then((value) => value.includes('Companion A'))
        .catch(() => false),
    'the phone is offered a look at A',
  );
  await prompt.tap();
  await card(c).waitFor({ state: 'visible' });
  assert.equal(await card(c).getAttribute('data-player'), a.id);
  assert.ok((await card(c).innerText()).includes(INTRO));
  const cardBox = await card(c).boundingBox();
  const viewport = c.page.viewportSize();
  assert.ok(cardBox.x >= 0 && cardBox.y >= 0, 'inside the screen');
  assert.ok(
    cardBox.x + cardBox.width <= viewport.width && cardBox.y + cardBox.height <= viewport.height,
  );
  for (const action of ['zoomIn', 'zoomOut', 'endInspect']) {
    const button = await c.page.locator(`[data-touch-action="${action}"]`).boundingBox();
    const apart =
      button.x >= cardBox.x + cardBox.width ||
      button.x + button.width <= cardBox.x ||
      button.y >= cardBox.y + cardBox.height ||
      button.y + button.height <= cardBox.y;
    assert.ok(apart, `the card leaves ${action} free`);
  }
  checks.push('the phone card stays on screen beside the thumb prompts');
  await sleep(500);
  await c.page.screenshot({ path: `${output}/phone-looks-at-a.png` });
  await c.page.locator('[data-touch-action="endInspect"]').tap();
  await until(() => card(c).isHidden(), 'the phone returns from the close-up');

  assert.deepEqual(errors, []);
  result = { passed: true, checks, errors };
  console.log(`PASS ${checks.length} checks, no browser errors`);
} catch (error) {
  result = { passed: false, checks, errors, error: String(error), stack: error.stack };
  for (const page of browser.contexts().flatMap((context) => context.pages()))
    await page
      .screenshot({ path: `${output}/failure-${page.viewportSize()?.width}.png` })
      .catch(() => {});
  throw error;
} finally {
  await writeFile(`${output}/result.json`, JSON.stringify(result, null, 2));
  await browser.close();
  await game.close();
}
