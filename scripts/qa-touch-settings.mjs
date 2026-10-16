// Real touch controls and final-save navigation in isolated Chrome solo sessions.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createGameServer } from '../dist/server.mjs';
import { readDeliveryOverlay } from '../dist/infrastructure/node/delivery-overlay.mjs';
import { readLocalVisibility } from '../dist/infrastructure/node/local-visibility.mjs';
import { AUDIO_SETTINGS_KEY } from '../dist/src/nature-audio-settings.js';
import { enterPreparedWorld } from './qa-game-entry.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const output = process.argv[2] || 'output/playwright/touch-settings-20261016';
const before = process.argv.includes('--before');
const phase = before ? 'before' : 'after';
await mkdir(`${output}/${phase}`, { recursive: true });
const hash = (data) => createHash('sha256').update(data).digest('hex');
async function userSaveFiles() {
  const names = await readdir('.cro-magnon-save').catch((error) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  const files = [];
  for (const name of names.sort()) {
    const file = '.cro-magnon-save/' + name,
      info = await stat(file);
    if (!info.isFile()) continue;
    const data = await readFile(file);
    files.push({
      name,
      bytes: data.length,
      sha256: hash(data),
      modifiedAt: info.mtime.toISOString(),
    });
  }
  return files;
}
const savesBefore = await userSaveFiles();
await writeFile(`${output}/${phase}/save-before.json`, JSON.stringify(savesBefore, null, 2));
const game = createGameServer({
  host: '127.0.0.1',
  port: 0,
  visibility: await readLocalVisibility('local-visibility.json'),
  delivery: await readDeliveryOverlay(process.cwd()),
  runtimeConfig: { mode: 'solo', serverUrl: '', room: 'SOLO' },
});
const base = `http://127.0.0.1:${(await game.listen()).port}`;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const checks = [],
  errors = [],
  forbidden = [],
  layouts = [],
  maps = [],
  served = [];
const pass = (label) => {
  checks.push(label);
  console.log('PASS', label);
};
let failure;

async function enter(mobile) {
  const context = await browser.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    isMobile: mobile,
    hasTouch: mobile,
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('websocket', (socket) => forbidden.push(socket.url()));
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/')) forbidden.push(request.url());
  });
  await page.goto(base);
  const tap = (selector) =>
    mobile ? page.locator(selector).tap() : page.locator(selector).click();
  await tap('#title-start');
  await page.locator('#setup-form input[name="name"]').fill('Touch settings QA');
  await tap('#setup-form input[value="cro-male"]');
  await tap('#setup-flow-yes');
  await tap('[data-starting-mascot="524"]');
  await tap('#mascot-start');
  await enterPreparedWorld(page, mobile);
  return { context, page, tap, mobile };
}

async function hud(who, width, height) {
  await who.page.setViewportSize({ width, height });
  await who.page.waitForTimeout(400);
  const layout = await who.page.locator('#touch-controls').evaluate((root) => {
    const box = (node) => {
      const r = node.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    };
    return {
      viewport: [innerWidth, innerHeight],
      buttons: [...root.querySelectorAll('button')]
        .filter((button) => button.getClientRects().length)
        .map((button) => {
          const bounds = box(button),
            glyph = button.querySelector('.icon');
          return {
            action: button.dataset.touchAction,
            ...bounds,
            glyph: glyph ? box(glyph) : null,
            hit:
              document
                .elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
                ?.closest('button') === button,
          };
        }),
      soundText: root.querySelector('[data-touch-action="sound"]').textContent.trim(),
      map: box(document.querySelector('#map-button')),
    };
  });
  layouts.push(layout);
  if (!before) {
    for (const button of layout.buttons) {
      assert.ok(button.width >= 44 && button.height >= 44, JSON.stringify(button));
      assert.ok(
        button.x >= 0 &&
          button.y >= 0 &&
          button.x + button.width <= width + 1 &&
          button.y + button.height <= height + 1,
        JSON.stringify(button),
      );
      assert.ok(button.hit, JSON.stringify(button));
      if (['menu', 'settings', 'mascots', 'center', 'sound'].includes(button.action))
        assert.ok(button.glyph.width >= 29.9, JSON.stringify(button));
      if (['jump', 'attack'].includes(button.action))
        assert.ok(button.glyph.width / button.width >= 0.6, JSON.stringify(button));
    }
    for (let i = 0; i < layout.buttons.length; i++)
      for (const b of [...layout.buttons.slice(i + 1), layout.map]) {
        const a = layout.buttons[i];
        assert.ok(
          Math.min(a.x + a.width, b.x + b.width) <= Math.max(a.x, b.x) + 1 ||
            Math.min(a.y + a.height, b.y + b.height) <= Math.max(a.y, b.y) + 1,
          `overlap: ${a.action}/${b.action ?? 'minimap'}`,
        );
      }
    assert.equal(layout.soundText, '');
  }
  await who.page.screenshot({ path: `${output}/${phase}/hud-${width}x${height}.png` });
}

async function map(who, label) {
  await who.tap('#map-button');
  await who.page.locator('#big-map').waitFor();
  const markers = await who.page.locator('.warp-map-point').evaluateAll((buttons) =>
    buttons
      .filter((button) => button.getClientRects().length)
      .map((button) => {
        const r = button.getBoundingClientRect(),
          s = getComputedStyle(button);
        return {
          id: button.dataset.warpPoint,
          width: button.offsetWidth,
          height: button.offsetHeight,
          round: s.borderRadius,
          rect: { x: r.x, y: r.y, width: r.width, height: r.height },
          hit:
            document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('button') ===
            button,
        };
      }),
  );
  assert.ok(markers.length > 0);
  maps.push({ label, markers });
  if (!before)
    for (const marker of markers) {
      assert.equal(marker.width, marker.height, label);
      assert.equal(marker.round, '50%');
      if (who.mobile) assert.equal(marker.width, 44);
    }
  const target = markers.find((marker) => marker.hit);
  assert.ok(target, 'A visible fire can be selected');
  await who.tap(`[data-warp-point="${target.id}"]`);
  assert.equal(
    await who.page.locator(`[data-warp-point="${target.id}"]`).getAttribute('aria-pressed'),
    'true',
  );
  await who.page.screenshot({ path: `${output}/${phase}/map-${label}.png` });
  await who.tap('#modal-close');
}

async function settings(who) {
  if (who.mobile) await who.tap('[data-touch-action="settings"]');
  else {
    await who.page.locator('#world').focus();
    await who.page.keyboard.press('Escape');
    await who.tap('[data-pause-tab="settings"]');
  }
  assert.equal(await who.page.locator('.pause-menu').getAttribute('data-tab'), 'settings');
  assert.equal(await who.page.locator('.pause-rail [data-controller-menu="title"]').count(), 0);
  assert.equal(
    await who.page.locator('#pause-panel-settings [data-controller-menu="title"]').count(),
    1,
  );
}

async function exit(who) {
  await settings(who);
  await who.page
    .locator('#pause-panel-settings [data-controller-menu="title"]')
    .scrollIntoViewIfNeeded();
  if (who.mobile) {
    const button = await who.page
      .locator('#pause-panel-settings [data-controller-menu="title"]')
      .boundingBox();
    assert.ok(button && button.width >= 44 && button.height >= 44);
  }
  await who.page.screenshot({
    path: `${output}/${phase}/${who.mobile ? 'phone' : 'pc'}-settings.png`,
  });
  await who.tap('#pause-panel-settings [data-controller-menu="title"]');
  await who.page.locator('#screen-title').waitFor();
  await who.page.waitForFunction(
    async () =>
      !(await navigator.locks.query()).held.some((lock) => lock.name === 'cro-magnon-solo-play'),
  );
  const checkpoint = await who.page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const r = indexedDB.open('cro-magnon-solo', 1);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction('checkpoints', 'readonly'),
          r = tx.objectStore('checkpoints').get('current');
        tx.oncomplete = () => resolve(r.result);
        tx.onabort = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  });
  assert.ok(checkpoint?.payload, 'Exit saves the isolated solo progress');
  pass(
    `${who.mobile ? 'Phone' : 'PC'}: settings contains the only title action; tapping saves and leaves`,
  );
}

try {
  const phone = await enter(true);
  await hud(phone, 390, 844);
  await map(phone, 'phone-390');
  if (!before) {
    for (const [width, height] of [
      [320, 568],
      [360, 640],
      [430, 932],
      [844, 390],
      [568, 320],
    ])
      await hud(phone, width, height);
    await phone.page.setViewportSize({ width: 390, height: 844 });
    pass('Larger icons and whole, non-overlapping 44px targets on six phone viewports');
    const sound = phone.page.locator('[data-touch-action="sound"]');
    assert.equal(await sound.getAttribute('aria-pressed'), 'false');
    assert.equal(await sound.getAttribute('aria-label'), '音をオンにする');
    const muted = await sound.locator('svg').innerHTML();
    await phone.tap('[data-touch-action="sound"]');
    assert.equal(await sound.getAttribute('aria-pressed'), 'true');
    assert.equal(await sound.getAttribute('aria-label'), '音をオフにする');
    assert.notEqual(await sound.locator('svg').innerHTML(), muted);
    assert.equal(await sound.innerText(), '');
    await settings(phone);
    assert.equal(
      await phone.page.locator('[data-setting="sound"]').getAttribute('aria-pressed'),
      'true',
    );
    await phone.tap('[data-setting="sound"]');
    await phone.tap('#modal-close');
    assert.equal(await sound.getAttribute('aria-pressed'), 'false');
    assert.equal(await sound.getAttribute('aria-label'), '音をオンにする');
    assert.equal(await sound.locator('svg').innerHTML(), muted);
    assert.equal(
      await phone.page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key)).enabled,
        AUDIO_SETTINGS_KEY,
      ),
      false,
    );
    pass('Icon-only sound button changes glyph and accessible name; settings stays synchronized');
    await phone.tap('[data-touch-action="menu"]');
    assert.equal(await phone.page.locator('.pause-menu').getAttribute('data-tab'), 'inventory');
    assert.equal(await phone.page.locator('[data-controller-menu="title"]').isVisible(), false);
    await phone.tap('#modal-close');
    await exit(phone);
  }
  await phone.context.close();
  if (!before) {
    const pc = await enter(false);
    assert.equal(await pc.page.locator('#touch-controls').isVisible(), false);
    await map(pc, 'pc');
    await exit(pc);
    await pc.context.close();
    pass('Phone and PC map markers are circles and remain selectable');
  }
  for (const path of ['/src/main.js', '/src/touch-controls.js', '/src/touch-controls.css']) {
    const response = await fetch(base + path),
      bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(response.status, 200);
    assert.equal(hash(bytes), hash(await readFile('dist' + path)));
    served.push({ path, sha256: hash(bytes), bytes: bytes.length });
  }
  assert.equal((await fetch(base + '/api/health').then((r) => r.json())).ok, true);
  assert.equal((await fetch(base + '/api/status').then((r) => r.json())).ok, true);
  assert.deepEqual(await userSaveFiles(), savesBefore);
  assert.deepEqual(errors, []);
  assert.deepEqual(forbidden, []);
  pass(
    'Served JS/CSS match disk; health/status pass; user saves unchanged; no game API or WebSocket',
  );
} catch (error) {
  failure = String(error.stack || error);
  console.error(failure);
  process.exitCode = 1;
} finally {
  await writeFile(
    `${output}/${phase}/report.json`,
    JSON.stringify(
      {
        base,
        checks,
        layouts,
        maps,
        served,
        savesBefore,
        errors,
        forbidden,
        failure,
        physicalPhoneTested: false,
      },
      null,
      2,
    ),
  );
  await browser.close();
  await game.close();
}
