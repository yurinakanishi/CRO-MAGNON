// Real Chrome: the share marks on the title and in the loading cave, and the menu's シェア
// tab during play, with nothing over the world while playing (user request 2026-10-24).
// X, Facebook and Instagram are answered by a local stub, so nothing is posted or fetched
// from them. Preparation: the page's clipboard and share sheet are observed in the page
// (writeText / navigator.share record their arguments) so the OS clipboard is untouched.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createGameServer } from '../dist/server.mjs';
import { readDeliveryOverlay } from '../dist/infrastructure/node/delivery-overlay.mjs';
import { enterPreparedWorld } from './qa-game-entry.mjs';
import { PUBLIC_PAGE, shareHref, shareText } from '../dist/src/share-links.js';

const output = process.argv[2] || `output/playwright/share-links-${Date.now()}`;
await mkdir(output, { recursive: true });
const delivery = await readDeliveryOverlay(process.cwd());
const game = createGameServer({ host: '127.0.0.1', port: 0, delivery });
const base = `http://127.0.0.1:${(await game.listen()).port}/`;
const lan = createGameServer({
  host: '127.0.0.1',
  port: 0,
  delivery,
  runtimeConfig: { mode: 'lan', serverUrl: 'ws://127.0.0.1:9/ws', buildId: 'share-qa' },
});
const lanBase = `http://127.0.0.1:${(await lan.listen()).port}/`;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const checks = [],
  errors = [],
  lanErrors = [],
  external = [],
  outside = [],
  layout = {};
const pass = (label) => {
  checks.push(label);
  console.log('PASS', label);
};
const EN_PAGE = `${PUBLIC_PAGE}en/`;
const STUB = /^https:\/\/(x\.com|www\.facebook\.com|www\.instagram\.com)\//;
const VIEWPORTS = {
  pc: { viewport: { width: 1440, height: 900 } },
  'pc-short': { viewport: { width: 1280, height: 720 } },
  phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
  'phone-small': { viewport: { width: 320, height: 568 }, isMobile: true, hasTouch: true },
  'phone-landscape': { viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true },
};

async function open(name, url = base, sink = errors) {
  const options = VIEWPORTS[name];
  const context = await browser.newContext({ ...options, deviceScaleFactor: 1 });
  await context.route(STUB, (route) => {
    external.push(route.request().url());
    return route.fulfill({ status: 200, contentType: 'text/html', body: '<title>stub</title>' });
  });
  context.on('request', (request) => {
    if (!/^(http:\/\/127\.0\.0\.1:|data:|blob:)/.test(request.url())) outside.push(request.url());
  });
  await context.addInitScript(() => {
    window.qaShare = { copied: [], shared: [] };
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (text) => void window.qaShare.copied.push(text) },
    });
    // A phone's share sheet; desktop Chrome keeps its own navigator.share untouched.
    if (navigator.maxTouchPoints > 0)
      navigator.share = async (data) => void window.qaShare.shared.push(data);
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => sink.push(`${name}: ${error.stack || error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') sink.push(`${name}: ${message.text()}`);
  });
  await page.route('**/api/**', (route) => route.abort());
  await page.goto(url);
  return { context, page, touch: !!options.hasTouch, name };
}

const press = ({ page, touch }, selector) =>
  touch ? page.locator(selector).first().tap() : page.locator(selector).first().click();

/** Visible boxes of every element matching each selector. */
function boxes(page, selectors) {
  return page.evaluate((list) => {
    const visible = (el) =>
      el.getClientRects().length &&
      !el.closest('[hidden]') &&
      getComputedStyle(el).visibility !== 'hidden';
    return Object.fromEntries(
      list.map((selector) => [
        selector,
        [...document.querySelectorAll(selector)].filter(visible).map((el) => {
          const r = el.getBoundingClientRect();
          return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom };
        }),
      ]),
    );
  }, selectors);
}

const overlap = (a, b) =>
  Math.min(a.right, b.right) - Math.max(a.x, b.x) > 0.5 &&
  Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y) > 0.5;

/** Four share controls, each at least 44 px and whole on screen, touching none of `others`. */
async function checkLayout(session, scope, others, label) {
  const { page } = session;
  const viewport = page.viewportSize();
  const found = await boxes(page, [`${scope} [data-share]`, ...others]);
  const marks = found[`${scope} [data-share]`];
  assert.equal(marks.length, 4, `${label}: four share controls`);
  for (const mark of marks) {
    assert.ok(mark.w >= 44 && mark.h >= 44, `${label}: target ${JSON.stringify(mark)}`);
    assert.ok(
      mark.x >= 0 && mark.y >= 0 && mark.right <= viewport.width && mark.bottom <= viewport.height,
      `${label}: on screen ${JSON.stringify(mark)}`,
    );
  }
  for (const [selector, list] of Object.entries(found))
    if (selector !== `${scope} [data-share]`)
      for (const other of list)
        for (const mark of marks)
          assert.ok(!overlap(mark, other), `${label}: share overlaps ${selector}`);
  layout[label] = found;
  return marks;
}

/** A link opens its address in a new tab (answered by the stub). */
async function opensTab(session, selector, expected) {
  const tab = session.context.waitForEvent('page');
  await press(session, selector);
  const opened = await tab;
  await opened.waitForLoadState('domcontentloaded');
  assert.equal(opened.url(), expected, selector);
  await opened.close();
}

async function copied(page) {
  return page.evaluate(() => window.qaShare.copied.at(-1));
}

/** The status line under the group says `text` and stays on screen. */
async function statusShows(page, scope, text) {
  const line = page.locator(`${scope} .share-status`);
  await page.waitForFunction(
    ([selector, expected]) => document.querySelector(selector)?.textContent === expected,
    [`${scope} .share-status`, text],
  );
  const box = await line.boundingBox();
  const viewport = page.viewportSize();
  assert.ok(
    box &&
      box.x >= 0 &&
      box.y >= 0 &&
      box.x + box.width <= viewport.width &&
      box.y + box.height <= viewport.height,
    `${scope}: status on screen ${JSON.stringify(box)}`,
  );
}

async function gameReady(page) {
  await page.waitForFunction(() => document.body.classList.contains('solo-mode'));
  await page.locator('#screen-title:not([hidden]) .share-links').waitFor();
}

const titleOthers = [
  '#title-start',
  '#title-online',
  '#title-contributors',
  '#title-language',
  '#title-fullscreen',
  '.title-icon',
  '.title-art',
  '.title-footer span',
];

try {
  // ---- Title at every size: under the menu, clear of everything, reachable by arrow keys.
  for (const name of Object.keys(VIEWPORTS)) {
    const session = await open(name);
    await gameReady(session.page);
    // Let the phone artwork settle before measuring (its 8 s entrance animation).
    await session.page.evaluate(() =>
      document
        .querySelectorAll('#screen-title *')
        .forEach((el) => el.getAnimations().forEach((animation) => animation.finish())),
    );
    const marks = await checkLayout(session, '#screen-title', titleOthers, `${name} title`);
    const language = (await boxes(session.page, ['#title-language']))['#title-language'][0];
    assert.ok(
      marks.every((mark) => mark.y >= language.bottom),
      `${name}: marks under the menu`,
    );
    await session.page.screenshot({ path: `${output}/${name}-title.png` });
    await session.context.close();
  }
  pass('title: four 44px share marks under the menu at five sizes, overlapping nothing');

  // ---- Title actions on a PC: links, copy, Instagram, language and keyboard reach.
  {
    const session = await open('pc');
    const { page } = session;
    await gameReady(page);
    const xJa = shareHref('x', PUBLIC_PAGE, shareText('ja'));
    const fbJa = shareHref('facebook', PUBLIC_PAGE, shareText('ja'));
    assert.equal(await page.locator('#screen-title [data-share="x"]').getAttribute('href'), xJa);
    await opensTab(session, '#screen-title [data-share="x"]', xJa);
    await opensTab(session, '#screen-title [data-share="facebook"]', fbJa);
    await press(session, '#screen-title [data-share="copy"]');
    await statusShows(page, '#screen-title', 'リンクをコピーしました');
    assert.equal(await copied(page), PUBLIC_PAGE);
    await page.screenshot({ path: `${output}/pc-title-copied.png` });
    const instagram = session.context.waitForEvent('page');
    await press(session, '#screen-title [data-share="instagram"]');
    const tab = await instagram;
    await tab.waitForLoadState('domcontentloaded');
    assert.equal(tab.url(), 'https://www.instagram.com/');
    await tab.close();
    await statusShows(
      page,
      '#screen-title',
      'リンクをコピーしました。Instagramに貼り付けてください。',
    );
    assert.equal(await page.evaluate(() => window.qaShare.copied.length), 2);
    assert.deepEqual(await page.evaluate(() => window.qaShare.shared), []);
    // The message leaves by itself.
    await page.waitForFunction(
      () => document.querySelector('#screen-title .share-status')?.textContent === '',
      undefined,
      { timeout: 6000 },
    );
    pass('title (PC): X and Facebook open their composers; copy and Instagram copy the page');

    // English: the English page, text and labels; a link address copied by hand matches.
    await press(session, '#title-language');
    await page.waitForFunction(() => document.documentElement.lang === 'en');
    assert.equal(
      await page.locator('#screen-title [data-share="x"]').getAttribute('href'),
      shareHref('x', EN_PAGE, shareText('en')),
    );
    assert.equal(
      await page.locator('#screen-title [data-share="facebook"]').getAttribute('href'),
      shareHref('facebook', EN_PAGE, shareText('en')),
    );
    assert.equal(
      await page.locator('#screen-title [data-share="x"]').getAttribute('aria-label'),
      'Post on X',
    );
    assert.equal(
      await page.locator('#screen-title [data-share="copy"]').getAttribute('title'),
      'Copy link',
    );
    await press(session, '#screen-title [data-share="copy"]');
    await statusShows(page, '#screen-title', 'Link copied');
    assert.equal(await copied(page), EN_PAGE);
    await page.screenshot({ path: `${output}/pc-title-english.png` });
    await press(session, '#title-language');
    await page.waitForFunction(() => document.documentElement.lang === 'ja');
    assert.equal(await page.locator('#screen-title [data-share="x"]').getAttribute('href'), xJa);
    pass('title (PC): switching language changes the shared page, text and labels both ways');

    // The arrow keys reach the marks from the menu and move along them.
    await page.locator('#title-language').focus();
    await page.keyboard.press('ArrowDown');
    const first = await page.evaluate(() => document.activeElement?.dataset.share);
    assert.ok(first, 'ArrowDown from the menu reaches a share mark');
    await page.keyboard.press('ArrowRight');
    const next = await page.evaluate(() => document.activeElement?.dataset.share);
    assert.ok(next && next !== first, 'ArrowRight moves along the marks');
    pass(`title (PC): arrow keys reach the marks (${first} → ${next})`);
    await session.context.close();
  }

  // ---- Title on a phone: Instagram uses the share sheet, copy still copies.
  {
    const session = await open('phone');
    const { page } = session;
    await gameReady(page);
    assert.equal(await page.evaluate(() => matchMedia('(pointer: coarse)').matches), true);
    await press(session, '#screen-title [data-share="instagram"]');
    await page.waitForFunction(() => window.qaShare.shared.length === 1);
    assert.deepEqual(await page.evaluate(() => window.qaShare.shared[0]), {
      title: 'CRO-MAGNON MMO',
      text: shareText('ja'),
      url: PUBLIC_PAGE,
    });
    assert.equal(await page.evaluate(() => window.qaShare.copied.length), 0);
    await press(session, '#screen-title [data-share="copy"]');
    await statusShows(page, '#screen-title', 'リンクをコピーしました');
    assert.equal(await copied(page), PUBLIC_PAGE);
    await page.screenshot({ path: `${output}/phone-title-copied.png` });
    await opensTab(
      session,
      '#screen-title [data-share="x"]',
      shareHref('x', PUBLIC_PAGE, shareText('ja')),
    );
    pass('title (phone): Instagram opens the share sheet with the page; copy and X work by tap');
    await session.context.close();
  }

  // ---- The loading cave and then play, on a PC and a phone.
  for (const name of ['pc', 'phone']) {
    const session = await open(name);
    const { page, touch } = session;
    await gameReady(page);
    await press(session, '#title-start');
    await page.locator('#setup-form input[name="name"]').fill('Share QA');
    await press(session, '#setup-form input[value="cro-male"]');
    await press(session, '#setup-flow-yes');
    await press(session, '#mascot-start');
    await page.locator('#loading-cave[data-ready="true"]').waitFor({ timeout: 240000 });
    await page.locator('#loading-screen').waitFor({ state: 'hidden', timeout: 30000 });
    const caveOthers = [
      '.loading-cave-heading h2',
      '[data-cave-murals]',
      '[data-cave-back]',
      '[data-cave-torch]',
      '[data-cave-proceed]',
      '.loading-cave-help',
      ...(touch ? ['.loading-cave-stick'] : []),
    ];
    await checkLayout(session, '#loading-cave', caveOthers, `${name} cave`);
    const yaw = await page.locator('#world').getAttribute('data-cave-camera-yaw');
    await press(session, '#loading-cave [data-share="copy"]');
    await statusShows(page, '#loading-cave', 'リンクをコピーしました');
    assert.equal(await copied(page), PUBLIC_PAGE);
    await page.waitForTimeout(300);
    assert.equal(
      await page.locator('#world').getAttribute('data-cave-camera-yaw'),
      yaw,
      'pressing a share mark does not turn the cave camera',
    );
    await page.screenshot({ path: `${output}/${name}-cave.png` });
    await opensTab(
      session,
      '#loading-cave [data-share="facebook"]',
      shareHref('facebook', PUBLIC_PAGE, shareText('ja')),
    );
    // The header's buttons keep one line beside the marks, on narrow and turned phones too.
    const sizes = touch
      ? [
          ['phone', { width: 390, height: 844 }],
          ['phone-small', { width: 320, height: 568 }],
          ['phone-landscape', { width: 844, height: 390 }],
        ]
      : [[name, page.viewportSize()]];
    for (const [size, viewport] of sizes) {
      await page.setViewportSize(viewport);
      await page.waitForTimeout(300);
      await checkLayout(session, '#loading-cave', caveOthers, `${size} cave`);
      const header = await boxes(page, ['[data-cave-murals]', '[data-cave-back]']);
      for (const [selector, [button]] of Object.entries(header))
        assert.ok(button.h < 50, `${size}: ${selector} stays on one line (${button.h}px)`);
      if (size !== name) await page.screenshot({ path: `${output}/${size}-cave.png` });
    }
    if (touch) await page.setViewportSize({ width: 390, height: 844 });
    pass(
      `${name} cave: share marks beside the cave name, clear of its controls; copy keeps the view`,
    );

    await enterPreparedWorld(page, touch, 300000);
    await page.waitForTimeout(1000);
    const onScreen = () =>
      page.evaluate(
        () =>
          [...document.querySelectorAll('[data-share], .share-links')].filter(
            (el) => el.getClientRects().length && !el.closest('[hidden]'),
          ).length,
      );
    assert.equal(await onScreen(), 0, 'no share control over the world during play');
    await page.screenshot({ path: `${output}/${name}-play.png` });
    if (touch) await page.locator('[data-touch-action="menu"]').tap();
    else await page.keyboard.press('Escape');
    await page.locator('.pause-menu').waitFor();
    const tabs = await page
      .locator('.pause-tab')
      .evaluateAll((list) => list.map((tab) => tab.dataset.pauseTab));
    assert.deepEqual(tabs, ['inventory', 'mascots', 'character', 'settings', 'share']);
    await press(session, '[data-pause-tab="share"]');
    await page.locator('#pause-panel-share').waitFor();
    assert.equal(
      await page.locator('[data-pause-tab="share"]').getAttribute('aria-selected'),
      'true',
    );
    const labels = await page
      .locator('#pause-panel-share [data-share]')
      .evaluateAll((list) => list.map((el) => el.textContent.trim()));
    assert.deepEqual(labels, [
      'Xでポスト',
      'Instagramでシェア',
      'Facebookでシェア',
      'リンクをコピー',
    ]);
    assert.equal(
      await page.locator('#pause-panel-share .share-address').textContent(),
      PUBLIC_PAGE,
    );
    await checkLayout(
      session,
      '#pause-panel-share',
      ['#modal-close', '.pause-tab', '#pause-panel-share h2', '.share-address'],
      `${name} menu`,
    );
    await press(session, '#pause-panel-share [data-share="copy"]');
    await statusShows(page, '#pause-panel-share', 'リンクをコピーしました');
    assert.equal(await copied(page), PUBLIC_PAGE);
    await page.screenshot({ path: `${output}/${name}-menu-share.png` });
    await opensTab(
      session,
      '#pause-panel-share [data-share="x"]',
      shareHref('x', PUBLIC_PAGE, shareText('ja')),
    );
    await press(session, '#modal-close');
    // The closed dialog keeps its last content, hidden.
    await page.waitForFunction(() => !document.querySelector('#modal').open);
    assert.equal(await onScreen(), 0, 'closing the menu leaves the world clear again');
    pass(`${name} play: nothing on the HUD; the menu's last tab シェア shares and copies`);
    await session.context.close();
  }

  // ---- A LAN title never links out, so it shows no share marks.
  {
    // Its own error list: this title has no LAN server to reach.
    const session = await open('pc', lanBase, lanErrors);
    await session.page.waitForFunction(() => document.body.classList.contains('exhibition-mode'));
    await session.page.locator('#screen-title:not([hidden])').waitFor();
    assert.equal(await session.page.locator('.share-links, [data-share]').count(), 0);
    await session.page.screenshot({ path: `${output}/lan-title.png` });
    pass('LAN title: no share marks');
    await session.context.close();
  }

  assert.deepEqual(errors, []);
  assert.ok(external.length > 0);
  assert.deepEqual(
    outside.filter((url) => !STUB.test(url)),
    [],
    'nothing else leaves the machine',
  );
  pass('no page errors; the only outside addresses were the stubbed share pages');
} finally {
  await writeFile(
    `${output}/result.json`,
    `${JSON.stringify({ browser: browser.version(), base, checks, errors, lanErrors, external, outside, layout }, null, 2)}\n`,
  );
  await browser.close();
  await game.close();
  await lan.close();
}
