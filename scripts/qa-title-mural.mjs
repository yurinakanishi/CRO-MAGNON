// Online title: the cave mural on the loading and home screens, its X links,
// the contributors dialog and the unchanged exhibition QR credits.
// Uses an independent world with no saved players; X itself is never contacted.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createGameServer } from '../dist/server.mjs';
import { localVerificationSettings } from '../dist/infrastructure/node/local-verification.mjs';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);
const out = process.argv[2] || `output/playwright/title-mural-20261007/${Date.now()}`;
await mkdir(out, { recursive: true });
const game = createGameServer({ ...localVerificationSettings(out), port: 0 });
const { port } = await game.listen();
const base = `http://127.0.0.1:${port}`;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const checks = [];
const errors = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const pass = (label, detail) => {
  checks.push(detail ? { label, ...detail } : { label });
  console.log('PASS', label, detail ? JSON.stringify(detail) : '');
};

async function open(name, options = {}) {
  const context = await browser.newContext({
    viewport: options.viewport || { width: 1440, height: 900 },
    deviceScaleFactor: options.scale || 1,
    isMobile: !!options.mobile,
    hasTouch: !!options.mobile,
    reducedMotion: options.reducedMotion || 'no-preference',
  });
  // Profile links open in a new tab; answer them locally instead of loading X.
  await context.route(/^https:\/\/x\.com\//, (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<title>x</title>' }),
  );
  if (options.config)
    await context.route(/\/multiplayer-config\.json$/, (route) =>
      route.fulfill({ contentType: 'application/json', body: JSON.stringify(options.config) }),
    );
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(`${name}: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`${name}: ${message.text()}`);
  });
  await page.goto(`${base}/`);
  return { context, page };
}

const ready = (page) =>
  page.waitForFunction(() => !document.querySelector('#screen-title[data-loading]'), null, {
    timeout: 240000,
  });

/** Layout boxes of the visible title parts, and any overlap or horizontal overflow. */
async function measure(page) {
  return page.evaluate(() => {
    const box = (selector) => {
      const el = document.querySelector(selector);
      if (!el || el.hidden || !el.getClientRects().length) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    };
    const art = box('.title-art');
    const menu = box('.title-menu') || box('.title-loading');
    const mural = box('.mural-viewport');
    const overlap = (a, b) =>
      !!a &&
      !!b &&
      a.x < b.right - 1 &&
      b.x < a.right - 1 &&
      a.y < b.bottom - 1 &&
      b.y < a.bottom - 1;
    return {
      viewport: { width: innerWidth, height: innerHeight },
      art,
      menu,
      mural,
      artMenuOverlap: overlap(art, menu),
      menuMuralOverlap: overlap(menu, mural),
      artMuralOverlap: overlap(art, mural),
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1,
      muralInside: !!mural && mural.bottom <= innerHeight + 1 && mural.y >= 0,
    };
  });
}

async function trackX(page) {
  return page.evaluate(
    () => new DOMMatrix(getComputedStyle(document.querySelector('.mural-track')).transform).m41,
  );
}

let failure;
try {
  // ---- Desktop: loading screen, then the home screen ----
  {
    const { context, page } = await open('desktop');
    await page.waitForSelector('#screen-title:not([hidden])');
    const loading = await page.evaluate(() => ({
      loading: !!document.querySelector('#screen-title[data-loading]'),
      menuHidden: document.querySelector('.title-menu').hidden,
      status: document.querySelector('.title-loading')?.textContent,
      focus: document.activeElement?.className,
      qr: document.querySelectorAll('.credit-qr').length,
      panels: document.querySelectorAll('.mural-panel').length,
    }));
    assert.equal(loading.loading, true, 'title starts in its loading state');
    assert.equal(loading.menuHidden, true);
    assert.equal(loading.qr, 0, 'no QR codes online');
    assert.equal(loading.panels, 2);
    assert.equal(loading.focus, 'title-loading');
    await page.waitForFunction(() => document.querySelector('.mural-image').complete);
    await sleep(600);
    await page.screenshot({ path: `${out}/desktop-loading.png` });
    const loadingLayout = await measure(page);
    assert.ok(
      loadingLayout.muralInside && !loadingLayout.horizontalOverflow,
      JSON.stringify(loadingLayout),
    );
    assert.ok(!loadingLayout.menuMuralOverlap && !loadingLayout.artMenuOverlap);
    loading.layout = loadingLayout;
    pass(
      'Desktop loading screen shows the title art, progress and mural without QR codes',
      loading,
    );

    const x0 = await trackX(page);
    await sleep(2000);
    const x1 = await trackX(page);
    assert.ok(x1 < x0 - 5, `mural pans left (${x0} -> ${x1})`);
    pass('Mural pans slowly during loading', { from: x0, to: x1, pixelsPerSecond: (x0 - x1) / 2 });

    // Hotspots sit inside their panel, so they move by exactly the track's offset.
    const sync = await page.evaluate(async () => {
      const spot = document.querySelector('.mural-panel a.mural-spot');
      const panel = spot.parentElement;
      const sample = () => {
        const s = spot.getBoundingClientRect();
        const p = panel.getBoundingClientRect();
        return { spot: s.x, panel: p.x, relative: (s.x - p.x) / p.width };
      };
      const a = sample();
      await new Promise((r) => setTimeout(r, 1000));
      const b = sample();
      return { a, b, moved: a.spot - b.spot, panelMoved: a.panel - b.panel };
    });
    assert.ok(Math.abs(sync.moved - sync.panelMoved) < 0.5, 'hotspot and painting move together');
    assert.ok(Math.abs(sync.a.relative - sync.b.relative) < 1e-4);
    pass('Hotspot stays locked to the painted character while panning', sync);

    const percent = [];
    const started = Date.now();
    while (await page.$('#screen-title[data-loading]')) {
      percent.push(await page.textContent('.title-loading-percent'));
      if (Date.now() - started > 240000) throw new Error('world did not finish loading');
      await sleep(500);
    }
    await sleep(900);
    const home = await page.evaluate(() => ({
      menu: [...document.querySelectorAll('.title-menu .menu-item')].map((b) => b.textContent),
      focus: document.activeElement?.id,
      loadingHidden: document.querySelector('.title-loading').hidden,
      world: document.querySelector('#world').dataset.worldAsset,
    }));
    assert.deepEqual(home.menu, ['はじめる', '画質', '関わってくれた人たち']);
    assert.equal(home.focus, 'title-start');
    assert.equal(home.loadingHidden, true);
    assert.equal(home.world, 'ready');
    await page.screenshot({ path: `${out}/desktop-home.png` });
    pass('Menu replaces the loading bar once the world is ready', {
      ...home,
      percentSamples: [...new Set(percent)].slice(0, 12),
    });

    const layout = await measure(page);
    assert.ok(!layout.artMenuOverlap && !layout.menuMuralOverlap && !layout.artMuralOverlap);
    assert.ok(!layout.horizontalOverflow && layout.muralInside);
    pass('Desktop layout has no overlap or horizontal overflow', layout);

    // Arrow keys move through the three menu items only, never onto the moving mural.
    const order = [];
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('ArrowDown');
      order.push(
        await page.evaluate(() => document.activeElement?.id || document.activeElement?.className),
      );
    }
    assert.ok(
      order.every((id) => !String(id).includes('mural')),
      JSON.stringify(order),
    );
    assert.ok(order.includes('title-contributors'));
    pass('Arrow keys skip the mural hotspots', { order });

    const links = await page.evaluate(() =>
      [...document.querySelectorAll('.mural-panel:not([aria-hidden]) .mural-spot')].map((el) => ({
        key: el.dataset.contributor,
        tag: el.tagName,
        href: el.getAttribute('href'),
        target: el.getAttribute('target'),
        rel: el.getAttribute('rel'),
        label: el.getAttribute('aria-label'),
        name: el.querySelector('.mural-tag b')?.textContent,
      })),
    );
    const byKey = Object.fromEntries(links.map((l) => [l.key, l]));
    assert.equal(byKey.rimo.href, 'https://x.com/vibe_walking');
    assert.equal(byKey.r524.href, 'https://x.com/R5ni4');
    for (const l of links.filter((l) => l.tag === 'A')) {
      assert.equal(l.target, '_blank');
      assert.match(l.rel, /noopener/);
      assert.match(l.href, /^https:\/\/x\.com\/[A-Za-z0-9_]+$/);
    }
    pass('Mural characters link to verified X profiles; unverified ones are labels only', {
      links,
    });

    // Hover pauses the pan so a moving character is easy to pick, then click it.
    const findVisible = () =>
      page.evaluate(() => {
        const panels = [...document.querySelectorAll('.mural-panel')];
        for (const [index, panel] of panels.entries())
          for (const el of panel.querySelectorAll('a.mural-spot')) {
            const r = el.getBoundingClientRect();
            if (r.x > 80 && r.right < innerWidth - 80)
              return { index, key: el.dataset.contributor, href: el.href };
          }
        return null;
      });
    let visible = await findVisible();
    for (let waited = 0; !visible && waited < 120000; waited += 1000) {
      await sleep(1000);
      visible = await findVisible();
    }
    if (!visible) throw new Error('no linked character was visible in the mural');
    const target = page
      .locator('.mural-panel')
      .nth(visible.index)
      .locator(`a.mural-spot[data-contributor="${visible.key}"]`);
    const centre = async () => {
      const r = await target.boundingBox();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    };
    let point = await centre();
    await page.mouse.move(point.x, point.y);
    const p0 = await trackX(page);
    await sleep(800);
    const p1 = await trackX(page);
    assert.ok(Math.abs(p1 - p0) < 0.5, 'hover pauses the mural');
    await page.screenshot({ path: `${out}/desktop-hover.png` });
    point = await centre();
    const [popup] = await Promise.all([
      context.waitForEvent('page'),
      page.mouse.click(point.x, point.y),
    ]);
    await popup.waitForLoadState();
    assert.equal(popup.url(), visible.href);
    await popup.close();
    pass('Hover pauses the mural and clicking a character opens its X profile', visible);
    await page.mouse.move(700, 120);

    await page.click('#title-contributors');
    await page.waitForSelector('#modal[open] .contributors-dialog');
    await sleep(400);
    const dialog = await page.evaluate(() => ({
      groups: [...document.querySelectorAll('.contributor-group h3')].map((h) => h.textContent),
      cards: [...document.querySelectorAll('.contributor')].map((c) => ({
        tag: c.tagName,
        href: c.getAttribute('href'),
        name: c.querySelector('strong').textContent,
        avatar: c.querySelector('img').getAttribute('src'),
        loaded: c.querySelector('img').complete && c.querySelector('img').naturalWidth > 0,
        mural: c.querySelector('em')?.textContent ?? null,
      })),
      qr: document.querySelectorAll('#modal .credit-qr').length,
    }));
    assert.ok(dialog.cards.length >= 4);
    assert.ok(
      dialog.cards.every((c) => c.loaded),
      'every icon loads',
    );
    assert.equal(dialog.qr, 0);
    for (const card of dialog.cards.filter((c) => c.tag === 'A'))
      assert.match(card.href, /^https:\/\/x\.com\/[A-Za-z0-9_]+$/);
    await page.screenshot({ path: `${out}/desktop-contributors.png` });
    const first = page.locator('a.contributor').first();
    const [profile] = await Promise.all([context.waitForEvent('page'), first.click()]);
    await profile.waitForLoadState();
    assert.match(profile.url(), /^https:\/\/x\.com\//);
    await profile.close();
    await page.click('#modal-close');
    await page.waitForFunction(() => !document.querySelector('#modal').open);
    pass('Contributors dialog lists X icons and names that open X profiles', dialog);
    await context.close();
  }

  // ---- Phones and short landscape screens ----
  for (const [name, viewport] of [
    ['phone-390x844', { width: 390, height: 844 }],
    ['phone-320x568', { width: 320, height: 568 }],
    ['phone-landscape-844x390', { width: 844, height: 390 }],
  ]) {
    const { context, page } = await open(name, { viewport, mobile: true, scale: 2 });
    await page.waitForSelector('#screen-title:not([hidden])');
    await page.waitForFunction(() => document.querySelector('.mural-image').complete);
    await sleep(500);
    const loading = await measure(page);
    await page.screenshot({ path: `${out}/${name}-loading.png` });
    await ready(page);
    await sleep(900);
    const home = await measure(page);
    await page.screenshot({ path: `${out}/${name}-home.png` });
    for (const layout of [loading, home]) {
      assert.ok(!layout.horizontalOverflow, `${name} has no horizontal overflow`);
      assert.ok(layout.muralInside, `${name} mural fits`);
      assert.ok(
        !layout.menuMuralOverlap && !layout.artMuralOverlap && !layout.artMenuOverlap,
        `${name} overlap ${JSON.stringify(layout)}`,
      );
    }
    const menuInside = home.menu.bottom <= home.mural.y + 1 && home.menu.y >= 0;
    assert.ok(menuInside, `${name} menu inside`);
    // Tap a visible linked character.
    const tapped = await page.evaluate(() => {
      for (const el of document.querySelectorAll('a.mural-spot')) {
        const r = el.getBoundingClientRect();
        if (r.x > 30 && r.right < innerWidth - 30)
          return { key: el.dataset.contributor, x: r.x + r.width / 2, y: r.y + r.height / 2 };
      }
      return null;
    });
    let opened = null;
    if (tapped) {
      const [popup] = await Promise.all([
        context.waitForEvent('page'),
        page.touchscreen.tap(tapped.x, tapped.y),
      ]);
      await popup.waitForLoadState();
      opened = popup.url();
      assert.match(opened, /^https:\/\/x\.com\//);
      await popup.close();
    }
    await page.click('#title-contributors');
    await page.waitForSelector('#modal[open] .contributors-dialog');
    await sleep(400);
    await page.screenshot({ path: `${out}/${name}-contributors.png` });
    const dialogFit = await page.evaluate(() => {
      const modal = document.querySelector('#modal');
      const d = modal.getBoundingClientRect();
      const wide = [...modal.querySelectorAll('.contributors-dialog *')]
        .filter((el) => el.getBoundingClientRect().right > d.right - 1)
        .map((el) => el.className || el.tagName);
      return { inside: d.right <= innerWidth + 1 && d.x >= -1, contentOverflow: wide };
    });
    assert.ok(
      dialogFit.inside && !dialogFit.contentOverflow.length,
      `${name} dialog fits ${JSON.stringify(dialogFit)}`,
    );
    pass(`${name}: loading and home layout fit; tapping a character and the dialog work`, {
      loading,
      home,
      tapped,
      opened,
    });
    await context.close();
  }

  // ---- Reduced motion: no pan, the wall scrolls instead ----
  {
    const { context, page } = await open('reduced', { reducedMotion: 'reduce' });
    await page.waitForSelector('#screen-title:not([hidden])');
    const result = await page.evaluate(() => ({
      animation: getComputedStyle(document.querySelector('.mural-track')).animationName,
      overflow: getComputedStyle(document.querySelector('.mural-viewport')).overflowX,
      scrollable:
        document.querySelector('.mural-viewport').scrollWidth >
        document.querySelector('.mural-viewport').clientWidth,
    }));
    assert.equal(result.animation, 'none');
    assert.equal(result.overflow, 'auto');
    assert.ok(result.scrollable);
    pass('Reduced motion stops the pan and lets the wall scroll', result);
    await context.close();
  }

  // ---- Exhibition (LAN) keeps icon, name and QR credits, without the mural ----
  {
    const { context, page } = await open('exhibition', {
      config: {
        mode: 'lan',
        serverUrl: `ws://127.0.0.1:${port}/ws`,
        room: 'EXHIBITION',
        guestName: 'プレイヤー1',
      },
    });
    await page.waitForSelector('#screen-title:not([hidden])');
    await sleep(800);
    const result = await page.evaluate(() => ({
      variant: document.querySelector('#screen-title').dataset.variant ?? null,
      mural: document.querySelectorAll('.cave-mural').length,
      qr: document.querySelectorAll('.credit-qr').length,
      avatars: document.querySelectorAll('.credit-avatar').length,
      links: document.querySelectorAll('#screen-title a[href]').length,
      menu: [...document.querySelectorAll('.title-menu .menu-item')].map((b) => b.textContent),
      menuHidden: document.querySelector('.title-menu').hidden,
    }));
    assert.equal(result.variant, null);
    assert.equal(result.mural, 0);
    assert.ok(result.qr >= 3 && result.qr === result.avatars);
    assert.equal(result.links, 0);
    assert.deepEqual(result.menu, ['はじめる', '画質']);
    assert.equal(result.menuHidden, false);
    await page.screenshot({ path: `${out}/exhibition-title.png` });
    pass('Exhibition title keeps QR credits, no links and no mural', result);
    await context.close();
  }
  assert.deepEqual(errors, []);
  pass('No page or console errors');
} catch (error) {
  failure = error;
  console.error(error);
} finally {
  await writeFile(
    `${out}/report.json`,
    JSON.stringify({ ok: !failure, failure: failure?.stack ?? null, checks, errors }, null, 2),
  );
  await browser.close();
  await game.close?.();
  process.exit(failure ? 1 : 0);
}
