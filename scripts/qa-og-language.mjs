// Static OG responses and actual title controls; separate servers and browser storage only.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { createGameServer } from '../dist/server.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const output = process.argv[2] || 'output/playwright/og-language';
if (!process.argv[3])
  throw new Error('Pass the isolated public build asset directory as argument 3.');
const publicDirectory = path.resolve(process.argv[3]);
await mkdir(output, { recursive: true });
const checks = [],
  errors = [],
  traffic = [],
  served = [];
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const pass = (label) => {
  checks.push(label);
  console.log('PASS', label);
};
let game, mf, browser, failure;
try {
  game = createGameServer({
    port: 0,
    host: '127.0.0.1',
    environment: 'local',
    runtimeConfig: { mode: 'solo', serverUrl: '', room: 'SOLO' },
  });
  const local = `http://127.0.0.1:${(await game.listen()).port}`;
  mf = new Miniflare(
    convertV4MiniflareOptions({
      name: 'og-language-qa',
      host: '127.0.0.1',
      port: 0,
      modules: true,
      compatibilityDate: '2026-09-07',
      // No game Worker or database is needed to serve either language.
      script:
        'export default { fetch() { return new Response("Unexpected Worker request", { status: 500 }); } };',
      assets: {
        directory: publicDirectory,
        binding: 'ASSETS',
        run_worker_first: ['/ws', '/api/*'],
        routerConfig: { has_user_worker: true },
        assetConfig: { not_found_handling: 'none' },
      },
    }),
  );
  const published = (await mf.ready).origin;
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  for (const [name, origin, directory] of [
    ['local', local, path.resolve('public')],
    ['public', published, publicDirectory],
  ]) {
    for (const [pathname, file, locale, text] of [
      ['/', 'index.html', 'ja_JP', '原始の世界を自由に冒険。'],
      ['/en/', 'en/index.html', 'en_US', 'Explore a prehistoric world.'],
    ]) {
      const response = await fetch(origin + pathname, { headers: { 'User-Agent': 'Twitterbot' } });
      assert.equal(response.status, 200);
      const bytes = Buffer.from(await response.arrayBuffer());
      assert.equal(hash(bytes), hash(await readFile(path.join(directory, file))));
      const html = bytes.toString();
      assert.ok(html.includes(`property="og:description" content="${text}"`));
      assert.ok(html.includes(`property="og:locale" content="${locale}"`));
      served.push({ name, pathname, sha256: hash(bytes) });
    }
    const alias = await fetch(origin + '/en');
    assert.equal(alias.status, 200);
    assert.match(await alias.text(), /<html lang="en">/);
    pass(`${name}: crawler receives distinct static languages, matching file SHA; /en also works`);

    const context = await browser.newContext({
      viewport: name === 'public' ? { width: 390, height: 844 } : { width: 1280, height: 800 },
      isMobile: name === 'public',
      hasTouch: name === 'public',
    });
    // Prepare only the QA browser's old preference, once. All switches use real controls.
    await context.addInitScript(() => {
      if (!sessionStorage.getItem('og-qa-seeded')) {
        localStorage.setItem('cro-language', 'ja');
        sessionStorage.setItem('og-qa-seeded', '1');
      }
    });
    const page = await context.newPage();
    const navigations = [];
    page.on('pageerror', (error) => errors.push(`${name}: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(`${name}: ${message.text()}`);
    });
    page.on('websocket', (socket) => traffic.push(socket.url()));
    page.on('request', (request) => {
      if (request.isNavigationRequest()) navigations.push(request.url());
      if (new URL(request.url()).pathname.startsWith('/api/')) traffic.push(request.url());
    });
    const title = async (language) => {
      await page.waitForFunction(
        (selected) =>
          document.querySelector('#title-start')?.textContent ===
          (selected === 'en' ? 'Start solo play' : 'ソロプレイで始める'),
        language,
      );
      assert.equal(await page.locator('html').getAttribute('lang'), language);
      assert.equal(
        await page.locator('link[rel="canonical"]').getAttribute('href'),
        `https://cromagnonmmo.com${language === 'en' ? '/en/' : '/'}`,
      );
      assert.equal(
        await page.locator('meta[property="og:locale"]').getAttribute('content'),
        language === 'en' ? 'en_US' : 'ja_JP',
      );
      assert.equal(
        await page.locator('#title-privacy').getAttribute('href'),
        language === 'en' ? '/en/privacy' : '/privacy',
      );
    };
    await page.goto(`${origin}/en/?room=EMBER#preview`, { waitUntil: 'domcontentloaded' });
    await title('en');
    pass(`${name}: English link opens in English over a saved Japanese preference`);
    await page.evaluate(() => history.replaceState({ qa: 'preserved' }, '', location.href));
    const navigationCount = navigations.length;
    await page.locator('#title-language').click();
    await title('ja');
    assert.equal(page.url(), `${origin}/?room=EMBER#preview`);
    await page.locator('#title-language').click();
    await title('en');
    assert.equal(page.url(), `${origin}/en/?room=EMBER#preview`);
    assert.equal(navigations.length, navigationCount, 'language switches must not reload');
    assert.deepEqual(await page.evaluate(() => history.state), { qa: 'preserved' });
    assert.equal(await page.evaluate(() => localStorage.getItem('cro-language')), 'en');
    pass(
      `${name}: real language controls update shared URLs without reloading; query/hash/state preserved`,
    );
    await page.reload({ waitUntil: 'domcontentloaded' });
    await title('en');
    await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
    await title('en');
    assert.equal(
      page.url(),
      origin + '/en/',
      'the saved preference still applies on the ordinary URL',
    );
    await page.locator('#title-language').click();
    await title('ja');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await title('ja');
    assert.equal(page.url(), origin + '/');
    pass(`${name}: both choices survive reload and the ordinary URL keeps the saved preference`);
    await page.goto(origin + '/en/', { waitUntil: 'domcontentloaded' });
    await title('en');
    await page.screenshot({
      path: path.join(output, `${name}-english-title.png`),
      animations: 'disabled',
    });
    await page.locator('#title-start').click();
    await page.locator('#screen-setup').waitFor({ state: 'visible', timeout: 90000 });
    await page
      .getByRole('heading', { name: 'Choose a character', exact: true })
      .waitFor({ state: 'visible' });
    await page.screenshot({
      path: path.join(output, `${name}-english-setup.png`),
      animations: 'disabled',
    });
    pass(`${name}: English title hands off to the actual character selection`);
    await context.close();
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(traffic, []);
  pass('No browser errors, game API requests or WebSocket connections');
} catch (error) {
  failure = error.stack || String(error);
  process.exitCode = 1;
  console.error(failure);
} finally {
  await browser?.close();
  await game?.close();
  await mf?.dispose();
  await writeFile(
    path.join(output, 'result.json'),
    JSON.stringify({ checks, errors, traffic, served, failure }, null, 2),
  );
}
