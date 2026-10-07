// Native Chrome finger gestures, using an independent world with no saved players.
import assert from 'node:assert/strict';
import { mkdir, writeFile, symlink, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { createGameServer } from '../dist/server.mjs';
import { localVerificationSettings } from '../dist/infrastructure/node/local-verification.mjs';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);
const out = process.argv[2] || `output/playwright/mobile-start-20261007/${Date.now()}`;
const assets = process.argv[3];
await mkdir(out, { recursive: true });
let browserRoot;
if (assets) {
  browserRoot = path.resolve(out, 'browser-root');
  for (const directory of ['public', 'dist'])
    await mkdir(path.join(browserRoot, directory), { recursive: true });
  for (const directory of ['src', 'shared'])
    await symlink(
      path.resolve(assets, directory),
      path.join(browserRoot, 'dist', directory),
      'junction',
    );
  for (const directory of ['models', 'vendor', 'audio', 'title', 'spawn'])
    await symlink(
      path.resolve('public', directory),
      path.join(browserRoot, 'public', directory),
      'junction',
    );
  await copyFile(path.join(assets, 'index.html'), path.join(browserRoot, 'public/index.html'));
  await copyFile('public/favicon.svg', path.join(browserRoot, 'public/favicon.svg'));
}
const game = createGameServer({
  ...localVerificationSettings(out),
  port: 0,
  ...(browserRoot ? { assetRoot: browserRoot } : {}),
});
const { port } = await game.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const checks = [],
  layouts = [],
  errors = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const pass = (label) => {
  checks.push(label);
  console.log('PASS', label);
};
let page, failure;
async function swipe(selector, dx, dy) {
  const r = await page.locator(selector).boundingBox();
  const x = r.x + r.width * (dx < 0 ? 0.85 : 0.3);
  const y = r.y + r.height * (dy < 0 ? 0.8 : 0.5);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let i = 1; i <= 12; i++) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: x + (dx * i) / 12, y: y + (dy * i) / 12 }],
    });
    await sleep(20);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
  await sleep(650);
}
async function layout(label, selectors) {
  await sleep(550);
  const data = await page.evaluate(
    ({ label, selectors }) => {
      const active = document.querySelector('.screen:not([hidden])');
      const rect = (element) => {
        const r = element.getBoundingClientRect();
        return {
          x: r.x,
          y: r.y,
          right: r.right,
          bottom: r.bottom,
          width: r.width,
          height: r.height,
        };
      };
      return {
        label,
        viewport: {
          width: innerWidth,
          height:
            Number(
              document
                .querySelector('.screens')
                .style.getPropertyValue('--screen-height')
                .replace('px', ''),
            ) || innerHeight,
        },
        document: {
          top: document.scrollingElement.scrollTop,
          width: document.scrollingElement.scrollWidth,
          height: document.scrollingElement.scrollHeight,
        },
        screen: {
          ...rect(active),
          top: active.scrollTop,
          contentHeight: active.scrollHeight,
          clientHeight: active.clientHeight,
        },
        controls: selectors.map((selector) => ({
          selector,
          ...rect(document.querySelector(selector)),
        })),
      };
    },
    { label, selectors },
  );
  layouts.push(data);
  assert.equal(data.document.top, 0, `${label}: document scroll`);
  assert.equal(data.screen.top, 0, `${label}: screen scroll`);
  assert.ok(data.document.width <= data.viewport.width, `${label}: page width`);
  assert.ok(data.screen.contentHeight <= data.screen.clientHeight + 1, `${label}: clipped content`);
  for (const control of data.controls) {
    assert.ok(
      control.x >= -1 && control.right <= data.viewport.width + 1,
      `${label}: ${control.selector} width`,
    );
    assert.ok(
      control.y >= -1 && control.bottom <= data.viewport.height + 1,
      `${label}: ${control.selector} height`,
    );
    assert.ok(control.height >= 44, `${label}: ${control.selector} target`);
  }
  await page.screenshot({ path: `${out}/${label}.png` });
}
async function newPage(size, touch = true) {
  if (page) await page.close();
  page = await browser.newPage({ viewport: size, hasTouch: touch, isMobile: touch });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.addInitScript(() => {
    localStorage.setItem('cro-name', 'Portrait QA');
    localStorage.setItem('cro-graphics-quality', 'low');
  });
  await page.goto(`http://127.0.0.1:${port}`);
  await page.locator('#title-start').waitFor();
  await sleep(400);
}
try {
  for (const size of process.env.QA_START_EXTRAS_ONLY
    ? []
    : [
        { width: 320, height: 568 },
        { width: 390, height: 844 },
        { width: 430, height: 932 },
        { width: 844, height: 390 },
      ]) {
    const tag = `${size.width}x${size.height}`;
    await newPage(size);
    await layout(`title-${tag}`, ['#title-start', '#title-graphics', '#title-contributors']);
    // Online home has no mural; the contributor dialog remains available.
    assert.equal(await page.locator('.cave-mural').count(), 0);
    await page.locator('#title-contributors').tap();
    assert.ok((await page.locator('.contributor').count()) >= 5);
    await page.locator('#modal-close').tap();
    assert.equal(await page.evaluate(() => document.scrollingElement.scrollLeft), 0);
    await swipe('#screen-title .title-hero', 0, -80);
    await layout(`title-after-swipe-${tag}`, [
      '#title-start',
      '#title-graphics',
      '#title-contributors',
    ]);
    await page.locator('#title-start').tap();
    assert.equal(await page.evaluate(() => document.activeElement.id), 'screen-setup');
    await layout(`characters-${tag}`, ['input[name="name"]', 'input[name="room"]', '#setup-back']);
    for (const name of ['name', 'room'])
      assert.equal(
        await page.locator(`input[name="${name}"]`).evaluate((e) => getComputedStyle(e).fontSize),
        '16px',
      );
    const grid = page.locator('.character-choice-grid');
    const row = await grid
      .locator('.character-choice')
      .evaluateAll((cards) => cards.map((c) => c.getBoundingClientRect().top));
    assert.ok(row.every((top) => Math.abs(top - row[0]) < 1));
    await swipe('.character-choice-grid', -Math.min(170, size.width / 2), 0);
    assert.ok(await grid.evaluate((e) => e.scrollLeft > 0));
    assert.equal(await page.locator('#setup-flow').count(), 0, 'swipe should not select a card');
    await swipe('.character-choice-grid', 0, -60);
    assert.equal(await grid.evaluate((e) => e.scrollTop), 0);
    await grid.evaluate((e) => {
      e.scrollLeft = e.scrollWidth;
    });
    await sleep(250);
    await grid.locator('.character-choice').last().tap();
    await layout(`difficulty-${tag}`, [
      '[data-choose-difficulty="easy"]',
      '[data-choose-difficulty="normal"]',
      '[data-choose-difficulty="hard"]',
    ]);
    await page.locator('[data-choose-difficulty="normal"]').tap();
    await layout(`confirm-${tag}`, ['#setup-flow-yes', '#setup-flow-no']);
    await page.locator('#setup-flow-no').tap();
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#setup-flow').count(), 0);
    await page.locator('#setup-back').tap();
    await layout(`back-${tag}`, ['#title-start', '#title-graphics']);
    pass(
      `${tag}: title/back/confirmation fit; native horizontal swipes; vertical swipes stay still`,
    );
  }
  await newPage({ width: 390, height: 844 });
  await page.locator('#title-start').tap();
  await page.evaluate(() => {
    window.__viewportHeight = visualViewport.height;
    Object.defineProperty(visualViewport, 'height', {
      configurable: true,
      get: () => window.__viewportHeight,
    });
    window.__viewportHeight = 360;
    visualViewport.dispatchEvent(new Event('resize'));
  });
  await page.locator('input[name="name"]').tap();
  await layout('keyboard-360', ['input[name="name"]', 'input[name="room"]', '#setup-back']);
  assert.equal(await page.locator('.character-options').isVisible(), false);
  await page.keyboard.press('Enter');
  await page.evaluate(() => {
    delete visualViewport.height;
    visualViewport.dispatchEvent(new Event('resize'));
  });
  assert.equal(await page.locator('.character-options').isVisible(), true);
  assert.equal(await page.evaluate(() => document.activeElement.name), 'character');
  await layout('keyboard-dismissed', ['input[name="name"]', '#setup-back']);
  await page.setViewportSize({ width: 844, height: 390 });
  await layout('rotated', ['#setup-back']);
  pass('typing uses the visible viewport; Enter restores cards; rotation fits');
  await page.evaluate(async () => {
    const { bindSetupFlow } = await import('/src/setup-flow.js');
    // Isolate the exhibition flow from the already-bound normal start form.
    const original = document.querySelector('#setup-form');
    const form = original.cloneNode(true);
    original.replaceWith(form);
    bindSetupFlow({
      form,
      difficulty: () => 'normal',
      spawnChoice: () => true,
    });
  });
  await page.locator('.character-choice-grid').evaluate((e) => {
    e.scrollLeft = 0;
  });
  await page.locator('.character-choice').first().tap();
  await page.locator('.spawn-grid').waitFor();
  await swipe('.spawn-grid', -150, 0);
  assert.ok(
    await page.locator('.spawn-grid').evaluate((e) => e.scrollLeft > 0 && e.scrollTop === 0),
  );
  const spawn = await page.locator('.spawn-picker').evaluate((e) => ({
    top: e.getBoundingClientRect().top,
    bottom: e.getBoundingClientRect().bottom,
    scroll: e.scrollHeight,
    height: e.clientHeight,
  }));
  assert.ok(spawn.top >= 0 && spawn.bottom <= 390 && spawn.scroll <= spawn.height + 1);
  await page.screenshot({ path: `${out}/spawn-horizontal.png` });
  await page.setViewportSize({ width: 320, height: 568 });
  await page.evaluate(() => {
    delete visualViewport.height;
    visualViewport.dispatchEvent(new Event('resize'));
  });
  await page.locator('.spawn-grid').evaluate((e) => {
    e.scrollLeft = 0;
  });
  await layout('spawn-portrait', ['.spawn-card']);
  pass('exhibition starting sights also scroll horizontally inside their section');
  await newPage({ width: 1440, height: 900 }, false);
  await page.locator('#title-start').click();
  assert.equal(await page.evaluate(() => document.activeElement.name), 'name');
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await page.locator('[data-choose-difficulty="normal"]').waitFor();
  await page.keyboard.press('Enter');
  await page.locator('#setup-flow-yes').waitFor();
  await page.screenshot({ path: `${out}/desktop-confirm.png` });
  pass('desktop text focus, arrows and Enter keep their existing flow');
  assert.deepEqual(errors, []);
} catch (error) {
  failure = error.stack;
  process.exitCode = 1;
  console.error(failure);
  await page?.screenshot({ path: `${out}/failure.png` }).catch(() => {});
} finally {
  await writeFile(
    `${out}/result.json`,
    JSON.stringify(
      {
        checks,
        layouts,
        errors,
        failure,
        assets: assets || 'compiled source',
        physicalPhone: false,
        keyboard: 'simulated visualViewport; native Chrome finger gestures',
      },
      null,
      2,
    ),
  );
  await browser.close();
  await game.close();
  console.log(out);
}
