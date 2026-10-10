// Actual packaged exhibition + MMO assets in real Chrome. All game state is isolated.
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { createGameServer } from '../dist/server.mjs';
import { localVerificationSettings } from '../dist/infrastructure/node/local-verification.mjs';
import { verifyExhibition } from './exhibition-integrity.mjs';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);
const out = path.resolve(
  process.argv[2] || `output/playwright/environments-20261006/${Date.now()}`,
);
if (!process.argv[3])
  throw new Error(
    'Use node scripts/qa-environment-profiles.mjs <evidence-folder> <exhibition-build-folder>',
  );
const exhibitionRoot = path.resolve(process.argv[3]);
await mkdir(out, { recursive: true });
const checks = [],
  errors = [],
  resources = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pass = (label) => {
  checks.push(label);
  console.log('PASS', label);
};
async function until(fn, label, timeout = 30000) {
  const end = Date.now() + timeout;
  while (!(await fn())) {
    if (Date.now() > end) throw new Error(`Timeout: ${label}`);
    await sleep(60);
  }
}
let browser, local, exhibition, mf, failure;
try {
  local = createGameServer({ ...localVerificationSettings(out), port: 0 });
  const localAddress = await local.listen();
  const manifest = await verifyExhibition(exhibitionRoot);
  const bundle = await import(pathToFileURL(path.join(exhibitionRoot, 'dist/server.mjs')).href);
  const config = {
    mode: 'lan',
    room: 'EXHIBITION',
    guestName: '展示確認',
    buildId: manifest.buildId,
    serverUrl: '',
  };
  exhibition = bundle.createGameServer({
    port: 0,
    host: '127.0.0.1',
    assetRoot: exhibitionRoot,
    environment: 'exhibition',
    exhibition: true,
    expectedBuild: manifest.buildId,
    runtimeConfig: config,
  });
  const exhibitionAddress = await exhibition.listen();
  config.serverUrl = `ws://127.0.0.1:${exhibitionAddress.port}/ws`;
  mf = new Miniflare(
    convertV4MiniflareOptions({
      name: 'environment-mmo-qa',
      host: '127.0.0.1',
      port: 0,
      modules: true,
      scriptPath: 'output/cloudflare-dry-run/worker.js',
      compatibilityDate: '2026-09-07',
      compatibilityFlags: ['nodejs_compat'],
      bindings: { SERVICE_ENABLED: 'true' },
      durableObjects: { GAME: { className: 'FreeGameRoom', useSQLite: true } },
      assets: {
        directory: path.resolve('dist-cloudflare'),
        binding: 'ASSETS',
        run_worker_first: ['/ws', '/api/*'],
        routerConfig: { has_user_worker: true },
        assetConfig: { not_found_handling: 'none' },
      },
    }),
  );
  const mmoBase = (await mf.ready).origin;
  for (const url of [
    '/src/motion-controls.js',
    '/src/motion-controls.css',
    '/src/motion-worker.js',
    '/motion/assets.json',
    '/motion/hand_landmarker-float16-v1.task',
    '/vendor/mediapipe/vision_bundle.mjs',
  ])
    assert.equal((await fetch(mmoBase + url)).status, 404, url);
  const html = await fetch(mmoBase);
  assert.match(html.headers.get('permissions-policy'), /camera=\(\)/);
  assert.doesNotMatch(await html.text(), /motion-controls/);
  pass(
    'Actual MMO assets return 404 for hand UI, worker, model and WASM library; camera policy is disabled',
  );
  browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: [
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
    ],
  });
  async function open(base, name, mobile = false, lan = false) {
    const context = await browser.newContext({
      viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 },
      isMobile: mobile,
      hasTouch: mobile,
    });
    const page = await context.newPage(),
      seen = { id: null, state: {}, sent: [] };
    page.on('pageerror', (e) => errors.push(`${name}: ${e}`));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(`${name}: ${m.text()}`);
    });
    page.on('request', (r) => resources.push({ name, url: r.url() }));
    page.on('websocket', (ws) => {
      ws.on('framesent', ({ payload }) => seen.sent.push(JSON.parse(String(payload))));
      ws.on('framereceived', ({ payload }) => {
        const m = JSON.parse(String(payload));
        if (m.type === 'welcome') seen.id = m.id;
        if (m.type === 'state') seen.state = m;
      });
    });
    await page.addInitScript((name) => {
      localStorage.setItem('cro-name', name);
      window.cameraCalls = 0;
      if (navigator.mediaDevices)
        navigator.mediaDevices.getUserMedia = async () => {
          window.cameraCalls++;
          throw new Error('Camera not used in this QA');
        };
      window.qaPad = {
        id: 'QA standard controller',
        index: 0,
        connected: false,
        mapping: 'standard',
        axes: [0, 0, 0, 0],
        buttons: Array.from({ length: 18 }, () => ({ pressed: false, value: 0 })),
      };
      Object.defineProperty(navigator, 'getGamepads', {
        value: () => (window.qaPad.connected ? [window.qaPad] : []),
      });
    }, name);
    await page.goto(base);
    const tap = (selector) =>
      mobile ? page.locator(selector).tap() : page.locator(selector).click();
    await tap('#title-start');
    await tap('#setup-form .character-choice:has(input[value="cro-female"])');
    if (lan) await tap('[data-choose-spawn="camp"]');
    else {
      await tap('#setup-flow-yes');
    }
    await page
      .locator('#world[data-world-asset="ready"][data-character-asset="ready"]')
      .waitFor({ timeout: 120000 });
    await until(
      async () =>
        seen.id &&
        seen.state.players?.some((p) => p.id === seen.id) &&
        (await page
          .locator('#connection-dot')
          .evaluate((dot) => !dot.classList.contains('offline'))),
      `${name} joined`,
    );
    await page.bringToFront();
    await page.locator('#world').focus();
    await page.screenshot({ path: path.join(out, `${name}.png`), animations: 'disabled' });
    return {
      context,
      page,
      seen,
      tap,
      player: () => seen.state.players.find((p) => p.id === seen.id),
    };
  }
  const a = await open(`http://127.0.0.1:${localAddress.port}`, 'local');
  assert.equal(await a.page.locator('#motion-controls').count(), 1);
  assert.equal(
    (await a.page.evaluate(() => import('/src/build-profile.js'))).BUILD_PROFILE.environment,
    'local',
  );
  async function checkPortraits(page, name) {
    // Exhibition's limited menu has no companion cards; verify its shared
    // catalog images decode without adding a menu absent from the product.
    if (!(await page.locator('.mascot-card img').count())) {
      const count = await page.evaluate(async () => {
        const { BOT_DESIGNS } = await import('/shared/orb-bots.mjs');
        const urls = Object.values(BOT_DESIGNS).flatMap((design) =>
          design.image ? [design.image] : [],
        );
        await Promise.all(
          urls.map(async (url) => {
            const img = new Image();
            img.src = url;
            await img.decode();
          }),
        );
        return urls.length;
      });
      assert.equal(count, 9, `${name} catalog portraits`);
      return;
    }
    await until(
      () =>
        page.evaluate(() => {
          const portraits = [...document.querySelectorAll('.mascot-card img')];
          return (
            portraits.length >= 9 && portraits.every((img) => img.complete && img.naturalWidth > 0)
          );
        }),
      `${name} companion portraits loaded`,
    );
  }
  await checkPortraits(a.page, 'local');
  assert.equal(await a.page.evaluate(() => window.cameraCalls), 0);
  await a.context.close();
  const e = await open(`http://127.0.0.1:${exhibitionAddress.port}`, 'exhibition', false, true);
  assert.equal(await e.page.locator('#motion-controls').count(), 1);
  assert.equal(
    (await e.page.evaluate(() => import('/src/build-profile.js'))).BUILD_PROFILE.environment,
    'exhibition',
  );
  await e.page.keyboard.press('Escape');
  await e.page.locator('.exhibition-menu').waitFor();
  await checkPortraits(e.page, 'exhibition');
  await e.page.screenshot({ path: path.join(out, 'exhibition-menu.png') });
  await e.page.keyboard.press('Escape');
  assert.equal(await e.page.evaluate(() => window.cameraCalls), 0);
  await e.context.close();
  pass(
    'Local verification and frozen exhibition each retain hand controls; exhibition uses its own menu and identity',
  );
  const m = await open(mmoBase, 'mmo-desktop');
  assert.equal(await m.page.locator('#motion-controls').count(), 0);
  assert.equal(
    await m.page.evaluate(() =>
      (document.permissionsPolicy || document.featurePolicy).allowsFeature('camera'),
    ),
    false,
  );
  const before = { x: m.player().x, z: m.player().z };
  await m.page.keyboard.down('d');
  await sleep(650);
  await m.page.keyboard.up('d');
  await until(
    () => Math.hypot(m.player().x - before.x, m.player().z - before.z) > 0.1,
    'MMO keyboard movement',
  );
  await until(() => !m.player().moving, 'MMO keyboard stop');
  const attack = m.player().attackSequence;
  await m.page.keyboard.press('f');
  await until(() => m.player().attackSequence > attack, 'MMO attack');
  await sleep(1300);
  const jump = m.player().jumpSequence;
  await m.page.keyboard.press(' ');
  await until(() => m.player().jumpSequence > jump, 'MMO jump');
  await m.page.keyboard.press('Escape');
  await m.page.locator('.pause-menu').waitFor();
  await checkPortraits(m.page, 'mmo-desktop');
  await m.page.screenshot({ path: path.join(out, 'mmo-menu.png') });
  await m.page.keyboard.press('Escape');
  await m.page.evaluate(() => {
    window.qaPad.connected = true;
  });
  await sleep(400);
  const padStart = m.seen.sent.length;
  await m.page.evaluate(() => {
    window.qaPad.axes[0] = 0.8;
  });
  await sleep(500);
  await m.page.evaluate(() => {
    window.qaPad.axes[0] = 0;
  });
  await until(() => !m.player().moving, 'MMO controller stop');
  assert.ok(
    m.seen.sent.slice(padStart).some((v) => v.type === 'move' && Math.hypot(v.dx, v.dz) > 0.5),
  );
  assert.equal(
    await m.page.evaluate(async () => (await import('/src/main.js')).motionDiagnostics().state),
    'UNAVAILABLE',
  );
  pass(
    'MMO desktop keyboard movement/stop, attack, jump, menu and controller input work without hand controls',
  );
  const phone = await open(mmoBase, 'mmo-portrait', true);
  assert.equal(await phone.page.locator('#motion-controls').count(), 0);
  const cdp = await phone.context.newCDPSession(phone.page);
  const bounds = await phone.page.locator('#touch-stick').boundingBox(),
    point = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  const touch = (type, points = []) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: points.map((p) => ({ radiusX: 5, radiusY: 5, force: 1, ...p })),
    });
  const start = phone.seen.sent.length;
  await touch('touchStart', [{ id: 1, ...point }]);
  await touch('touchMove', [{ id: 1, x: point.x, y: point.y - 44 }]);
  await sleep(500);
  await touch('touchEnd');
  await until(() => !phone.player().moving, 'MMO touch stop');
  assert.ok(
    phone.seen.sent.slice(start).some((v) => v.type === 'move' && Math.hypot(v.dx, v.dz) > 0.5),
  );
  await phone.tap('[data-touch-action="menu"]');
  await phone.page.locator('.pause-menu').waitFor();
  await checkPortraits(phone.page, 'mmo-portrait');
  await phone.page.screenshot({ path: path.join(out, 'mmo-portrait-menu.png') });
  const layout = await phone.page.evaluate(() => ({
    width: innerWidth,
    scroll: document.documentElement.scrollWidth,
    keys: [...document.querySelectorAll('kbd')].filter((v) => v.getClientRects().length).length,
  }));
  assert.ok(layout.scroll <= layout.width);
  assert.equal(layout.keys, 0);
  assert.ok(phone.seen.state.players.some((p) => p.id === m.seen.id));
  assert.equal(
    [...local.rooms.values()].some((room) => room.players.has(m.seen.id)),
    false,
  );
  assert.equal(
    [...exhibition.rooms.values()].some((room) => room.players.has(m.seen.id)),
    false,
  );
  pass(
    'MMO portrait touch movement/stop and menu work; two online peers share a world separate from local and exhibition',
  );
  await m.page.goto(`${mmoBase}/?autostart=1&hands=1&cameraControls=true`);
  await m.page.locator('#world[data-world-asset="ready"]').waitFor({ timeout: 120000 });
  assert.equal(await m.page.locator('#motion-controls').count(), 0);
  for (const page of [m.page, phone.page])
    assert.equal(await page.evaluate(() => window.cameraCalls), 0);
  assert.equal(
    resources.filter(
      (r) =>
        r.name.startsWith('mmo') && /\/(?:src\/motion-|vendor\/mediapipe\/|motion\/)/.test(r.url),
    ).length,
    0,
  );
  assert.deepEqual(errors, []);
  pass(
    'Reload and query flags cannot enable MMO hand controls; no recognizer requests, camera requests or browser errors',
  );
} catch (error) {
  failure = String(error.stack || error);
  console.error(error);
} finally {
  for (const [index, context] of (browser?.contexts() || []).entries())
    for (const page of context.pages())
      await page
        .screenshot({ path: path.join(out, `final-${index}.png`), animations: 'disabled' })
        .catch(() => {});
  await browser?.close();
  await local?.close();
  await exhibition?.close();
  await mf?.dispose();
  await writeFile(
    path.join(out, 'result.json'),
    JSON.stringify(
      { status: failure ? 'failed' : 'passed', checks, errors, failure, resources },
      null,
      2,
    ),
  );
}
if (failure) process.exitCode = 1;
