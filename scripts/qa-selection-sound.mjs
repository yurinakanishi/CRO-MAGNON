// Real Chrome, separate browser storage and an ephemeral solo server. Never opens user saves.
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { createGameCore } from '../dist/application/game-core.mjs';
import { createGameServer } from '../dist/server.mjs';
import { readDeliveryOverlay } from '../dist/infrastructure/node/delivery-overlay.mjs';
import { readLocalVisibility } from '../dist/infrastructure/node/local-visibility.mjs';
import { enterPreparedWorld } from './qa-game-entry.mjs';
import { AUDIO_SETTINGS_KEY } from '../dist/src/nature-audio-settings.js';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const output = process.argv[2] || `output/playwright/selection-sound-${Date.now()}`;
await mkdir(output, { recursive: true });
const core = createGameCore({ visibility: await readLocalVisibility('local-visibility.json') });
const game = createGameServer({
  core,
  port: 0,
  host: '127.0.0.1',
  delivery: await readDeliveryOverlay(process.cwd()),
});
const base = `http://127.0.0.1:${(await game.listen()).port}/`;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const checks = [],
  errors = [],
  forbidden = [],
  layouts = [],
  audio = [];
const pass = (label) => {
  checks.push(label);
  console.log('PASS', label);
};
let failure;

async function open(mobile) {
  const context = await browser.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    hasTouch: mobile,
    isMobile: mobile,
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(String(error.stack || error)));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('websocket', (socket) => forbidden.push(socket.url()));
  await page.route('**/api/**', (route) => {
    forbidden.push(route.request().url());
    return route.abort();
  });
  // Read-only access to the actual audio engine, as in the existing audio QA.
  await page.route('**/src/world3d.js', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body:
        (await response.text()) +
        '\nconst observeState=WorldRenderer.prototype.setState;WorldRenderer.prototype.setState=function(...args){globalThis.qaRenderer=this;return observeState.apply(this,args);};',
    });
  });
  await page.goto(base);
  const tap = (selector) =>
    mobile ? page.locator(selector).tap() : page.locator(selector).click();
  await tap('#title-start');
  await page.locator('#setup-form input[name="name"]').fill('選択と音 QA');
  await page.locator('#setup-form input[name="name"]').blur();
  return { page, context, tap, mobile };
}

async function layout(who, label, selector = '#setup-form') {
  // Resize/visualViewport events update ScreenManager's CSS variables on the next frame.
  await who.page.waitForTimeout(600);
  const data = await who.page.locator(selector).evaluate(async (form) => {
    await document.fonts.ready;
    const grid = form.querySelector('.character-choice-grid');
    const cards = [...grid.querySelectorAll('.character-choice')];
    await Promise.all(cards.map((card) => card.querySelector('img').decode()));
    const box = grid.getBoundingClientRect();
    const formBox = form.getBoundingClientRect();
    const controls = form.querySelector('.character-choice-controls').getBoundingClientRect();
    const bottom = Math.min(
      box.bottom - 5,
      controls.left < box.right ? controls.top : Infinity,
      formBox.bottom,
      innerHeight,
    );
    const visible = cards.filter((card) => {
      const r = card.getBoundingClientRect();
      return (
        r.top >= Math.max(box.top, formBox.top, 0) &&
        r.bottom <= bottom + 1 &&
        r.left >= box.left &&
        r.right <= box.right
      );
    });
    return {
      viewport: [innerWidth, innerHeight],
      grid: box.toJSON(),
      form: formBox.toJSON(),
      visible: visible.map((card) => card.querySelector('img').dataset.characterImage),
      columns: getComputedStyle(grid).gridTemplateColumns,
      scrollTop: grid.scrollTop,
      scrollLeft: grid.scrollLeft,
      horizontalOverflow: grid.scrollWidth > grid.clientWidth,
      clippedNames: cards
        .filter((card) => {
          const name = card.querySelector('.character-name');
          const text = name.querySelector('strong').getBoundingClientRect();
          const r = name.getBoundingClientRect();
          return text.top < r.top || text.bottom > r.bottom + 1;
        })
        .map((card) => card.textContent),
      confirm: form.querySelector('button[type="submit"]').getBoundingClientRect().toJSON(),
      controls: controls.toJSON(),
      back: form.querySelector('.setup-back')?.getBoundingClientRect().toJSON(),
      scrollHeight: form.scrollHeight,
    };
  });
  layouts.push({ label, ...data });
  await who.page.screenshot({ path: `${output}/${label}.png`, animations: 'disabled' });
  assert.ok(data.visible.length >= 4, `${label}: only ${data.visible.length} complete cards`);
  assert.equal(data.horizontalOverflow, false, label);
  assert.deepEqual(data.clippedNames, [], label);
  assert.ok(data.confirm.top >= 0 && data.confirm.bottom <= data.viewport[1], label + ': confirm');
  if (data.back)
    assert.ok(data.back.bottom <= Math.min(data.form.bottom, data.viewport[1]), label + ': back');
  return data;
}

async function soundState(who) {
  return who.page.evaluate(() => {
    const a = globalThis.qaRenderer.audio;
    return {
      enabled: a.settings.enabled,
      context: a.context?.state ?? null,
      master: a.master?.gain.value ?? 0,
      loops: a.loops.size,
      loopsMuted: [...a.loops.values()].every((loop) => loop.gain.gain.value === 0),
      voices: a.voices.size,
      loaded: a.stats.loaded,
      errors: a.errors,
      decksPaused: a.music?.decks.every((deck) => deck.audio.paused) ?? true,
    };
  });
}

async function menu(who, tab) {
  if (who.mobile) await who.tap('[data-touch-action="menu"]');
  else {
    await who.page.locator('#world').focus();
    await who.page.keyboard.press('Escape');
  }
  await who.tap(`[data-pause-tab="${tab}"]`);
}

async function verifySound(who) {
  const before = await soundState(who);
  audio.push({ mobile: who.mobile, phase: 'default', ...before });
  assert.equal(before.enabled, false);
  assert.equal(before.context, null);
  assert.equal(before.loops, 0);
  if (who.mobile) {
    assert.equal(
      await who.page.locator('[data-touch-action="sound"]').getAttribute('aria-pressed'),
      'false',
    );
    await who.tap('[data-touch-action="sound"]');
  } else {
    await menu(who, 'settings');
    assert.equal(
      await who.page.locator('[data-setting="sound"]').getAttribute('aria-pressed'),
      'false',
    );
    await who.tap('[data-setting="sound"]');
    await who.tap('#modal-close');
  }
  await who.page.waitForFunction(
    () => {
      const a = globalThis.qaRenderer.audio;
      return (
        a.settings.enabled &&
        a.context?.state === 'running' &&
        a.stats.loaded > 0 &&
        a.loops.size > 0
      );
    },
    undefined,
    { timeout: 60000 },
  );
  // Measure the actual master output rather than only trusting an enabled flag.
  const rms = await who.page.evaluate(async () => {
    const a = globalThis.qaRenderer.audio;
    const analyser = a.context.createAnalyser();
    analyser.fftSize = 2048;
    a.master.connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    let peak = 0;
    for (let i = 0; i < 20; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      analyser.getFloatTimeDomainData(samples);
      peak = Math.max(peak, Math.sqrt(samples.reduce((n, v) => n + v * v, 0) / samples.length));
    }
    a.master.disconnect(analyser);
    return peak;
  });
  assert.ok(rms > 0.00001, `Expected audible signal: ${rms}`);
  audio.push({ mobile: who.mobile, phase: 'enabled', rms, ...(await soundState(who)) });
  if (who.mobile) {
    await who.page.screenshot({ path: `${output}/phone-sound-on.png` });
    await menu(who, 'settings');
    assert.equal(
      await who.page.locator('[data-setting="sound"]').getAttribute('aria-pressed'),
      'true',
    );
    await who.tap('[data-setting="sound"]');
    await who.tap('#modal-close');
    assert.equal(
      await who.page.locator('[data-touch-action="sound"]').getAttribute('aria-pressed'),
      'false',
    );
  } else {
    await menu(who, 'settings');
    await who.tap('[data-setting="sound"]');
    await who.tap('#modal-close');
  }
  await who.page.waitForFunction(() => globalThis.qaRenderer.audio.context?.state === 'suspended');
  const muted = await soundState(who);
  audio.push({ mobile: who.mobile, phase: 'muted', ...muted });
  assert.equal(muted.loopsMuted, true);
  assert.equal(muted.voices, 0);
  assert.equal(muted.decksPaused, true);
  assert.deepEqual(muted.errors, []);
  assert.equal(
    await who.page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key)).enabled,
      AUDIO_SETTINGS_KEY,
    ),
    false,
  );
  pass(
    `${who.mobile ? 'Phone' : 'PC'} starts silent, enables real audio by UI, then silences all channels and saves off`,
  );
}

try {
  const phone = await open(true);
  for (const [width, height] of [
    [390, 844],
    [430, 932],
    [360, 640],
    [320, 568],
    [844, 390],
  ]) {
    await phone.page.setViewportSize({ width, height });
    await layout(phone, `phone-characters-${width}`);
  }
  pass(
    'Four complete character cards and the next button are initially visible on 320–430 px portrait phones',
  );
  await phone.page.setViewportSize({ width: 390, height: 844 });
  const order = await phone.page
    .locator('#setup-form [data-character-image]')
    .evaluateAll((nodes) => nodes.map((n) => n.dataset.characterImage));
  assert.deepEqual(order.slice(0, 4), [
    'cro-magnon-boy-headband',
    'cro-magnon-woman',
    'cro-magnon-boy-lion',
    'cro-magnon-girl-feather',
  ]);
  assert.deepEqual(order.slice(-3), ['cro-magnon-hunter', 'desert-fennec-mage', 'giant-ape']);
  assert.equal(order.length, 14);
  await phone.page.waitForTimeout(600);
  const grid = await phone.page.locator('#setup-form .character-choice-grid').boundingBox();
  const cdp = await phone.context.newCDPSession(phone.page);
  const x = grid.x + grid.width / 2;
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x, y: grid.y + grid.height * 0.85 }],
  });
  for (let i = 1; i <= 8; i++) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x, y: grid.y + grid.height * (0.85 - i * 0.075) }],
    });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await phone.page.waitForFunction(
    () => document.querySelector('#setup-form .character-choice-grid').scrollTop > 50,
  );
  await cdp.detach();
  await phone.tap('#setup-form input[value="cro-magnon-boy-lion"]');
  await phone.tap('#setup-form [data-dye="red"]');
  assert.equal(
    await phone.page.locator('#setup-form input:checked').inputValue(),
    'cro-magnon-boy-lion',
  );
  assert.equal(
    await phone.page
      .locator('#setup-form [data-character-image="cro-magnon-boy-lion"]')
      .getAttribute('src'),
    '/models/cro-magnon-boy-lion/portraits/choice-r04-red.webp',
  );
  await phone.tap('#setup-flow-yes');
  const pets = await phone.page
    .locator('[data-starting-mascot]')
    .evaluateAll((nodes) => nodes.map((n) => n.dataset.startingMascot));
  assert.deepEqual(pets.slice(0, 2), ['524', 'rimo-neko']);
  await phone.tap('[data-starting-mascot="524"]');
  await phone.page
    .locator('#starting-mascot-form img')
    .evaluateAll((images) => Promise.all(images.map((image) => image.decode())));
  await phone.page.screenshot({ path: `${output}/phone-mascots.png`, animations: 'disabled' });
  await phone.tap('#mascot-back');
  assert.equal(
    await phone.page.locator('#setup-form input:checked').inputValue(),
    'cro-magnon-boy-lion',
  );
  assert.equal(
    await phone.page.locator('#setup-form [data-dye="red"]').getAttribute('aria-pressed'),
    'true',
  );
  await phone.tap('#setup-flow-yes');
  assert.equal(
    await phone.page.locator('[data-starting-mascot="524"]').getAttribute('aria-pressed'),
    'true',
  );
  pass(
    'The same reordered cast, actual dye photos, 524-first companions and separate-screen draft choices work by touch',
  );
  await phone.tap('#mascot-start');
  await enterPreparedWorld(phone.page, true);
  await verifySound(phone);
  await menu(phone, 'character');
  await layout(phone, 'phone-character-menu', '.character-switch');
  const menuOrder = await phone.page
    .locator('.character-switch [data-character-image]')
    .evaluateAll((nodes) => nodes.map((n) => n.dataset.characterImage));
  assert.deepEqual(menuOrder, order);
  await phone.tap('[data-pause-tab="mascots"]');
  assert.deepEqual(
    await phone.page
      .locator('[data-mascot]')
      .evaluateAll((nodes) => nodes.slice(0, 2).map((n) => n.dataset.mascot)),
    ['524', 'rimo-neko'],
  );
  pass('In-game character and companion menus use the same orders and four-card phone layout');
  await phone.page.unrouteAll({ behavior: 'wait' });
  await phone.context.close();

  const pc = await open(false);
  await pc.page.screenshot({ path: `${output}/pc-characters.png`, animations: 'disabled' });
  await pc.page.locator('#setup-form input[name="character"]:checked').press('Enter');
  assert.equal(await pc.page.locator('#screen-mascot').isVisible(), false);
  await pc.tap('#setup-flow-yes');
  await pc.tap('[data-starting-mascot="524"]');
  await pc.tap('#mascot-start');
  await enterPreparedWorld(pc.page, false);
  await verifySound(pc);
  await pc.page.reload();
  assert.equal(
    await pc.page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key)).enabled,
      AUDIO_SETTINGS_KEY,
    ),
    false,
  );
  await pc.page.unrouteAll({ behavior: 'wait' });
  await pc.context.close();

  const svg = await readFile('public/favicon.svg');
  const original = Buffer.from(svg.toString().match(/base64,([^"]+)/)[1], 'base64');
  const icon = await sharp(svg).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const old = await sharp(original).ensureAlpha().raw().toBuffer();
  const pixel = (x, y) => (y * 64 + x) * 4;
  for (const [x, y] of [
    [0, 0],
    [63, 0],
    [0, 63],
    [63, 63],
  ])
    assert.equal(icon.data[pixel(x, y) + 3], 0);
  for (let y = 16; y < 48; y++)
    for (let x = 0; x < 64; x++) {
      assert.ok(
        icon.data
          .subarray(pixel(x, y), pixel(x, y) + 4)
          .equals(old.subarray(pixel(x, y), pixel(x, y) + 4)),
      );
    }
  const ico = await readFile('public/favicon.ico');
  assert.equal(ico.readUInt16LE(4), 4);
  for (let i = 0; i < 4; i++) {
    const entry = 6 + 16 * i;
    const data = await sharp(
      ico.subarray(
        ico.readUInt32LE(entry + 12),
        ico.readUInt32LE(entry + 12) + ico.readUInt32LE(entry + 8),
      ),
    )
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    for (const [x, y] of [
      [0, 0],
      [data.info.width - 1, 0],
      [0, data.info.height - 1],
      [data.info.width - 1, data.info.height - 1],
    ])
      assert.equal(data.data[(y * data.info.width + x) * 4 + 3], 0);
  }
  await sharp(svg).resize(256, 256).png().toFile(`${output}/favicon-rounded.png`);
  pass(
    'SVG and every ICO size have four transparent rounded corners; the central artwork is pixel-identical',
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(forbidden, []);
  assert.equal(core.rooms.size, 0);
  pass('No browser errors, game APIs, WebSockets or server game rooms');
} catch (error) {
  failure = error;
  console.error(error);
} finally {
  await writeFile(
    `${output}/report.json`,
    JSON.stringify(
      {
        ok: !failure,
        browser: browser.version(),
        checks,
        layouts,
        audio,
        errors,
        forbidden,
        failure: failure ? String(failure.stack || failure) : null,
        iconSha256: createHash('sha256')
          .update(await readFile('public/favicon.ico'))
          .digest('hex'),
      },
      null,
      2,
    ) + '\n',
  );
  await browser.close();
  await game.close();
  core.close();
}
if (failure) process.exitCode = 1;
