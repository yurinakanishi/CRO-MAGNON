// Real Chrome travelers in an isolated, unsaved room choose clothing colours: from the status
// plate on a desktop and on a phone, where a tap dyes at once, and in the menu's character tab,
// where a colour is worn with the apply button. Each sees the others' colours
// drawn by the dye shader; a new browser's remembered colour reaches the loading cave and the
// room. A read-only observer reports each actor's clothing and the compiled dye program.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createGameServer } from '../dist/server.mjs';
import { enterPreparedWorld } from './qa-game-entry.mjs';

const sharp = createRequire(import.meta.url)('sharp');
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);
const output = process.argv[2] || `output/playwright/clothing-dye-${Date.now()}`;
await mkdir(output, { recursive: true });
const ROOM = 'DYE-QA';
const game = createGameServer({ host: '127.0.0.1', port: 0 });
const { port } = await game.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [];
const checks = [];
const measurements = {};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, label, timeout = 20000) {
  const end = Date.now() + timeout;
  while (!(await check())) {
    if (Date.now() > end) throw Error(`timed out: ${label}`);
    await sleep(50);
  }
  checks.push(label);
}
const room = () => game.rooms.get(ROOM);

// Read-only observers: the world renderer once it has state, the loading cave once it loads.
const OBSERVE_WORLD =
  '\nconst qaSetState = WorldRenderer.prototype.setState; WorldRenderer.prototype.setState = function(...args) { globalThis.qaRenderer = this; return qaSetState.apply(this, args); };';
const OBSERVE_CAVE =
  '\nconst qaCaveLoad = LoadingCave.prototype.load; LoadingCave.prototype.load = function(...args) { globalThis.qaCave = this; return qaCaveLoad.apply(this, args); };';

async function open(name, options) {
  const {
    viewport,
    mobile = false,
    language = 'ja',
    species = 'cro',
    gender = 'female',
    dye = '',
    title = false,
  } = options;
  const context = await browser.newContext({ viewport, hasTouch: mobile, isMobile: mobile });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(`${name}: ${error}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`${name}: ${message.text()}`);
  });
  for (const [file, observer] of [
    ['world3d.js', OBSERVE_WORLD],
    ['loading-cave.js', OBSERVE_CAVE],
  ])
    await page.route(`**/src/${file}`, async (route) => {
      const response = await route.fetch();
      await route.fulfill({ response, body: (await response.text()) + observer });
    });
  // Seeded once: a reload keeps what the game itself stored.
  await page.addInitScript(
    (values) => {
      if (localStorage.getItem('qa-seeded')) return;
      for (const [key, value] of Object.entries(values)) localStorage.setItem(key, value);
      localStorage.setItem('qa-seeded', '1');
    },
    {
      'cro-name': name,
      'cro-species': species,
      'cro-gender': gender,
      'cro-language': language,
      ...(dye ? { 'cro-dye': dye } : {}),
    },
  );
  const before = new Set(room()?.players.keys() ?? []);
  const who = { name, context, page, mobile };
  if (title) {
    await page.goto(`http://127.0.0.1:${port}/?room=${ROOM}`);
    await page.locator('#title-start').click();
    await page.locator('#setup-form .character-choice:has(input:checked)').click();
    await page.locator('#setup-flow-yes').click();
    await page.locator('#mascot-start').click();
    await page.waitForFunction(() => globalThis.qaCave?.actor, undefined, { timeout: 180000 });
    who.cave = await page.evaluate(() => ({
      dye: globalThis.qaCave.actor.clothing?.dye ?? null,
      on: globalThis.qaCave.actor.clothing?.on.value ?? null,
    }));
    await page.waitForSelector('#loading-cave[data-world-ready="true"]', { timeout: 180000 });
    await sleep(800);
    await page.screenshot({ path: `${output}/${name.toLowerCase()}-loading-cave.png` });
  } else await page.goto(`http://127.0.0.1:${port}/?room=${ROOM}&autostart=1`);
  await enterPreparedWorld(page, mobile);
  await until(
    () => [...(room()?.players.keys() ?? [])].some((id) => !before.has(id)),
    `${name} joined`,
  );
  who.id = [...room().players.keys()].find((key) => !before.has(key));
  who.player = () => room().players.get(who.id);
  return who;
}

/** How a page draws a traveler: its actor's clothing, and whether the dye program is linked. */
const drawn = (viewer, id) =>
  viewer.page.evaluate((id) => {
    const r = globalThis.qaRenderer,
      actor = r?.players.get(id)?.actor;
    const programs = r?.renderer.info.programs ?? [];
    return {
      model: actor?.asset.modelKey ?? null,
      dye: actor?.clothing?.dye ?? null,
      on: actor?.clothing?.on.value ?? null,
      colour: actor?.clothing
        ? `#${actor.clothing.colour.value.getHexString('srgb-linear')}`
        : null,
      programs: programs.filter((p) => p.cacheKey.includes('clothing-dye-1')).length,
    };
  }, id);

async function wears(viewer, who, dye, label) {
  await until(
    () => drawn(viewer, who.id).then((d) => d.dye === dye && d.on === (dye ? 1 : 0)),
    label,
  );
}

/** Share of strongly coloured pixels near `hue` in the middle of the canvas. */
async function hueShare(page, hue, file) {
  const png = await page.locator('#world').screenshot({ path: file });
  const image = sharp(png);
  const { width, height } = await image.metadata();
  const left = Math.round(width * 0.3),
    top = Math.round(height * 0.2),
    w = Math.round(width * 0.4),
    h = Math.round(height * 0.65);
  const { data, info } = await image
    .extract({ left, top, width: w, height: h })
    .raw()
    .toBuffer({ resolveWithObject: true });
  let hits = 0;
  const pixels = info.width * info.height;
  for (let i = 0; i < data.length; i += info.channels) {
    const r = data[i] / 255,
      g = data[i + 1] / 255,
      b = data[i + 2] / 255;
    const max = Math.max(r, g, b),
      min = Math.min(r, g, b),
      d = max - min;
    if (max < 0.2 || d / max < 0.35) continue;
    let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
    const distance = Math.min(Math.abs(h - hue), 360 - Math.abs(h - hue));
    if (distance <= 22) hits++;
  }
  return hits / pixels;
}

/** Stand facing the traveler from a few steps away and look at them closely. */
async function lookAt(viewer, target, gap = 2.6) {
  const t = target.player();
  Object.assign(viewer.player(), { x: t.x, z: t.z - gap, facing: 0, dx: 0, dz: 0 });
  await sleep(1200);
  await until(
    () =>
      viewer.page
        .locator('[data-cue="inspect"]')
        .innerText()
        .then((text) => text.includes(target.name))
        .catch(() => false),
    `${viewer.name} is offered a look at ${target.name}`,
  );
  await viewer.page.locator('#world').focus();
  await viewer.page.keyboard.press('x');
  await until(
    () =>
      viewer.page.evaluate(
        (id) => document.querySelector('#world').dataset.companionView === id,
        target.id,
      ),
    `${viewer.name} looks closely at ${target.name}`,
  );
  await sleep(900);
}

let result;
try {
  // A, a hunter on a desktop, dyes from the status plate.
  const a = await open('Hunter A', {
    viewport: { width: 1440, height: 900 },
    gender: 'male',
  });
  Object.assign(a.player(), { x: 120, z: 124, facing: Math.PI, dx: 0, dz: 0 });
  await a.page.locator('#status-plate').click();
  const swatches = a.page.locator('#modal .dye-picker [data-dye]');
  await swatches.first().waitFor();
  assert.equal(await swatches.count(), 9, 'the own colours and eight dyes');
  assert.equal(await a.page.locator('#modal .dye-swatch[aria-pressed="true"]').count(), 1);
  assert.equal(
    await a.page.locator('#modal .dye-swatch[aria-pressed="true"]').getAttribute('data-dye'),
    '',
    'a newcomer wears the own colours',
  );
  await a.page.locator('#modal [data-dye="blue"]').click();
  await until(() => a.player().dye === 'blue', 'the status plate dyes A blue on the server');
  await until(
    () =>
      a.page
        .locator('#modal [data-dye="blue"]')
        .getAttribute('aria-pressed')
        .then((v) => v === 'true'),
    'the blue swatch shows as chosen',
  );
  assert.equal(await a.page.locator('#modal .dye-name').innerText(), '青');
  assert.equal(await a.page.evaluate(() => localStorage.getItem('cro-dye')), 'blue');
  checks.push('the choice is remembered on the browser');
  await wears(a, a, 'blue', 'A draws its own clothing blue');
  await sleep(300);
  await a.page.screenshot({ path: `${output}/a-status-plate-picker.png` });
  await a.page.keyboard.press('Escape');

  // B, in English, sees A's colour change while looking at A.
  const b = await open('Viewer B', {
    viewport: { width: 1280, height: 800 },
    language: 'en',
  });
  await lookAt(b, a);
  await wears(b, a, 'blue', 'B draws A blue');
  measurements.blueWithBlue = await hueShare(b.page, 217, `${output}/b-sees-a-blue.png`);
  const own = a.page.locator('#modal [data-dye=""]');
  const card = (value) =>
    a.page.locator(`#character-switch-form .character-choice:has(input[value="${value}"])`);
  // A returns to the own colours from the character tab, then picks yellow there. Beside the
  // cards a swatch only picks; the apply button wears it, on the same character too.
  await a.page.locator('#world').focus();
  await a.page.keyboard.press('Escape');
  await a.page.locator('[data-pause-tab="character"]').click();
  await a.page.waitForSelector('#character-switch-form .dye-picker');
  await card('cro-male').click();
  await sleep(200);
  assert.equal(
    await a.page.locator('#character-confirm').count(),
    0,
    'the character and colour worn ask nothing',
  );
  await own.click();
  await sleep(300);
  assert.equal(a.player().dye, 'blue', 'a swatch beside the cards only picks');
  assert.equal(
    await a.page.locator('#character-switch-form .dye-picker .dye-name').innerText(),
    '元の色',
  );
  await card('cro-male').click();
  assert.equal(await a.page.locator('#character-confirm').count(), 0);
  assert.match(await a.page.locator('.character-choice-summary').innerText(), /服の色\s*元の色/);
  await a.page.locator('#character-switch-apply').click();
  await until(() => a.player().dye === null, 'the same character is confirmed in the own colours');
  await until(
    () => a.page.evaluate(() => !document.querySelector('#modal').open),
    'a new colour alone leaves the menu',
  );
  await wears(b, a, null, 'B draws A in the own colours');
  await sleep(500);
  measurements.blueWithOwn = await hueShare(b.page, 217, `${output}/b-sees-a-own.png`);
  measurements.yellowWithOwn = await hueShare(b.page, 47, `${output}/b-sees-a-own-2.png`);
  await sleep(300);
  await a.page.locator('#world').focus();
  await a.page.keyboard.press('Escape');
  await a.page.locator('[data-pause-tab="character"]').click();
  await a.page.locator('#modal [data-dye="yellow"]').click();
  await a.page.screenshot({ path: `${output}/a-character-menu-picker.png` });
  await card('cro-male').click();
  assert.equal(await a.page.locator('#character-confirm').count(), 0);
  await a.page.screenshot({ path: `${output}/a-character-menu-choice.png` });
  await a.page.locator('#character-switch-apply').click();
  await until(() => a.player().dye === 'yellow', 'the character tab dyes A yellow');
  await wears(b, a, 'yellow', 'B draws A yellow');
  await sleep(500);
  measurements.yellowWithYellow = await hueShare(b.page, 47, `${output}/b-sees-a-yellow.png`);
  assert.ok(
    measurements.blueWithBlue > measurements.blueWithOwn + 0.02,
    `blue drawn: ${JSON.stringify(measurements)}`,
  );
  assert.ok(
    measurements.yellowWithYellow > measurements.yellowWithOwn + 0.02,
    `yellow drawn: ${JSON.stringify(measurements)}`,
  );
  checks.push("B's frames show A's dye and its removal");
  await b.page.keyboard.press('Escape');

  // B's own menu, in English.
  await b.page.locator('#status-plate').click();
  await b.page.locator('#modal .dye-picker').waitFor();
  assert.match(await b.page.locator('#modal .dye-picker legend').innerText(), /Clothing color/);
  assert.equal(await b.page.locator('#modal [data-dye="teal"]').getAttribute('aria-label'), 'Teal');
  assert.equal(await b.page.locator('#modal [data-dye=""]').getAttribute('aria-label'), 'Original');
  await b.page.locator('#modal [data-dye="white"]').click();
  await until(() => b.player().dye === 'white', 'B dyes white from the English menu');
  await until(
    () =>
      b.page
        .locator('#modal .dye-name')
        .innerText()
        .then((text) => text === 'White'),
    'the English menu names the chosen colour',
  );
  await b.page.keyboard.press('Escape');

  // C, a phone in portrait, taps a swatch on the status plate.
  const c = await open('Phone C', { viewport: { width: 390, height: 844 }, mobile: true });
  Object.assign(c.player(), { x: 121.6, z: 124, facing: Math.PI, dx: 0, dz: 0 });
  await c.page.locator('#status-plate').tap();
  const phoneSwatches = c.page.locator('#modal .dye-picker [data-dye]');
  await phoneSwatches.first().waitFor();
  const viewport = c.page.viewportSize();
  for (let i = 0; i < 9; i++) {
    const swatch = phoneSwatches.nth(i);
    await swatch.scrollIntoViewIfNeeded();
    const box = await swatch.boundingBox();
    assert.ok(box.width >= 44 && box.height >= 44, `swatch ${i} is a finger target`);
    assert.ok(box.x >= 0 && box.x + box.width <= viewport.width, `swatch ${i} fits the width`);
  }
  checks.push('the phone shows nine 44 px swatches within the screen width');
  await c.page.locator('#modal [data-dye="pink"]').tap();
  await until(() => c.player().dye === 'pink', 'a tap on the phone dyes C pink');
  await until(
    () =>
      c.page
        .locator('#modal [data-dye="pink"]')
        .getAttribute('aria-pressed')
        .then((v) => v === 'true'),
    'the phone shows pink as chosen',
  );
  await sleep(300);
  await c.page.screenshot({ path: `${output}/phone-status-plate-picker.png` });
  await c.page.locator('#modal-close').tap();
  await wears(c, c, 'pink', 'the phone draws its own traveler pink');
  await wears(a, c, 'pink', 'A draws C pink');

  // D, a fennec mage on a new browser that remembers green, starts from the title.
  const d = await open('Fennec D', {
    viewport: { width: 1280, height: 800 },
    species: 'bear',
    gender: 'female',
    dye: 'green',
    title: true,
  });
  assert.deepEqual(d.cave, { dye: 'green', on: 1 }, 'the loading cave shows the remembered colour');
  checks.push('the loading cave draws the remembered colour');
  assert.equal(d.player().dye, 'green', 'the title start brings the remembered colour');
  Object.assign(d.player(), { x: 123.2, z: 124, facing: Math.PI, dx: 0, dz: 0 });
  await wears(a, d, 'green', 'A draws D green');
  await wears(d, d, 'green', 'D draws itself green');

  // E, another Cro-Magnon woman whose browser remembers red, joins directly.
  const e = await open('Woman E', { viewport: { width: 960, height: 640 }, dye: 'red' });
  assert.equal(e.player().dye, 'red', 'a new traveler arrives in the remembered colour');

  // Everyone gathered: three women in three colours, the hunter and the fennec, in front of B.
  const line = [a, c, e, d];
  line.forEach((who, i) =>
    Object.assign(who.player(), { x: 117.6 + i * 1.2, z: 124, facing: Math.PI, dx: 0, dz: 0 }),
  );
  Object.assign(b.player(), { x: 119.4, z: 119.8, facing: 0, dx: 0, dz: 0 });
  const everyone = [a, b, c, d, e];
  // A page loads another character's model once that traveler comes near.
  const pairs = [];
  for (const viewer of everyone)
    for (const target of everyone)
      pairs.push(
        until(
          () =>
            drawn(viewer, target.id).then(
              (seen) =>
                seen.model !== null && seen.dye === target.player().dye && seen.programs >= 1,
            ),
          `${viewer.name} draws ${target.name} in ${target.player().dye}`,
          120000,
        ),
      );
  await Promise.all(pairs);
  checks.push('every page draws every traveler in the colour the room has them wear');
  measurements.programs = await drawn(b, a.id).then((value) => value.programs);
  // Staging for the picture only: B's camera behind B, raised to see over B's head.
  await b.page.evaluate(() => {
    const r = globalThis.qaRenderer;
    r.focusPlayer(Math.PI);
    r.setZoom(0.75);
    r.pitch = 0.3;
  });
  await sleep(2000);
  await b.page.screenshot({ path: `${output}/gathering.png` });

  // In the character tab, Enter on a swatch picks it without submitting anything; the character
  // chosen next arrives in that colour with one apply.
  await a.page.locator('#world').focus();
  await a.page.keyboard.press('Escape');
  await a.page.locator('[data-pause-tab="character"]').click();
  await a.page.locator('#character-switch-form [data-dye="teal"]').focus();
  await a.page.keyboard.press('Enter');
  await until(
    () =>
      a.page
        .locator('#character-switch-form [data-dye="teal"]')
        .getAttribute('aria-pressed')
        .then((v) => v === 'true'),
    'Enter on a swatch picks teal',
  );
  assert.equal(await a.page.locator('#character-confirm').count(), 0, 'no confirmation yet');
  assert.equal(a.player().dye, 'yellow', 'picking is not wearing');
  assert.equal(a.player().species, 'cro');
  assert.equal(a.player().gender, 'male');
  await a.page.locator('#character-switch-form input[value="cro-female"]').check();
  assert.equal(await a.page.locator('#character-confirm').count(), 0);
  assert.match(await a.page.locator('.character-choice-summary').innerText(), /水色/);
  await a.page.locator('#character-switch-apply').click();
  await until(() => a.player().gender === 'female', 'A becomes the Cro-Magnon woman');
  for (const viewer of [a, b])
    await until(
      () =>
        drawn(viewer, a.id).then(
          (seen) => seen.model === 'cro-magnon-woman' && seen.dye === 'teal' && seen.on === 1,
        ),
      `${viewer.name} draws the new character in the chosen colour`,
      120000,
    );
  assert.equal(a.player().dye, 'teal', 'the new character wears the colour picked with it');

  assert.deepEqual(errors, []);
  result = { passed: true, checks, measurements, errors };
  console.log(`PASS ${checks.length} checks, no browser errors`, JSON.stringify(measurements));
} catch (error) {
  result = {
    passed: false,
    checks,
    measurements,
    errors,
    error: String(error),
    stack: error.stack,
  };
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
