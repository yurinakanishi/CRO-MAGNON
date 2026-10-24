// Isolated Chrome only: routes never contact Google or write to a player's browser profile.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { publicSiteHtml } from './site-metadata.mjs';

const output = process.argv[2] || 'output/playwright/site-analytics';
const assetDirectory = process.argv[3] || 'public';
await mkdir(output, { recursive: true });
const config = JSON.parse(await readFile('cloudflare/site-config.json', 'utf8'));
assert.match(config.measurementId, /^G-[A-Z0-9]+$/);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const checks = [],
  errors = [];
const pass = (value) => {
  checks.push(value);
  console.log('PASS', value);
};
let failure;
async function context(origin = 'https://cromagnonmmo.com', options = {}) {
  const ctx = await browser.newContext(options);
  const requests = [];
  await ctx.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) {
      requests.push(url.href);
      return route.fulfill({
        contentType: 'text/javascript',
        body: '/* QA stub: no Google traffic */',
      });
    }
    const name =
      url.pathname === '/en/privacy'
        ? 'en/privacy.html'
        : url.pathname === '/privacy'
          ? 'privacy.html'
          : url.pathname.slice(1);
    const bytes = await readFile(path.join(assetDirectory, name));
    const html = name.endsWith('.html');
    await route.fulfill({
      contentType: html ? 'text/html' : name.endsWith('.css') ? 'text/css' : 'text/javascript',
      body: html && assetDirectory === 'public' ? publicSiteHtml(bytes, config) : bytes,
    });
  });
  ctx.on('page', (page) => page.on('pageerror', (error) => errors.push(error.message)));
  return { ctx, requests };
}
try {
  for (const [lang, options] of [
    ['ja', {}],
    ['en', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }],
  ]) {
    const { ctx, requests } = await context(undefined, options);
    const page = await ctx.newPage();
    const url = `https://cromagnonmmo.com/${lang === 'en' ? 'en/' : ''}privacy?name=private-player#save-private`;
    await page.goto(url);
    await page.locator('#analytics-consent').waitFor();
    assert.deepEqual(requests, []);
    await page.screenshot({ path: path.join(output, `${lang}-consent.png`) });
    await page
      .getByRole('button', { name: lang === 'en' ? 'Do not allow' : '許可しない', exact: true })
      .click();
    await page.reload();
    assert.equal(await page.locator('#analytics-consent').count(), 0);
    assert.deepEqual(requests, []);
    pass(`${lang}: no Google traffic before consent or after persisted rejection`);
    await page.locator('[data-analytics-settings]').click();
    await page
      .getByRole('button', { name: lang === 'en' ? 'Allow analytics' : '計測を許可', exact: true })
      .click();
    await page.waitForFunction(
      () => !!document.querySelector('script[src*="googletagmanager.com"]'),
    );
    const calls = await page.evaluate(() => window.dataLayer.map((args) => Array.from(args)));
    assert.equal(calls.filter((args) => args[0] === 'event' && args[1] === 'page_view').length, 1);
    assert.doesNotMatch(JSON.stringify(calls), /private-player|save-private/);
    assert.equal(calls.find((args) => args[0] === 'config')[2].allow_google_signals, false);
    assert.equal(calls.find((args) => args[0] === 'consent')[2].ad_storage, 'denied');
    assert.equal(await page.locator('script[src*="googletagmanager.com"]').count(), 1);
    pass(`${lang}: opt-in loads one tag, queues one sanitized pageview and disables advertising`);
    await page.evaluate(() => {
      document.cookie = '_ga=qa; Path=/; Secure';
      localStorage.setItem('cro-player-name', 'keep');
    });
    const other = await ctx.newPage();
    await other.goto(url);
    await page.evaluate(() => {
      window.analyticsQaMarker = 'keep-running';
    });
    await other.locator('[data-analytics-settings]').click();
    await other
      .getByRole('button', { name: lang === 'en' ? 'Do not allow' : '許可しない', exact: true })
      .click();
    await page.waitForFunction(
      (id) =>
        localStorage.getItem('cro-analytics-consent-v1') === 'denied' &&
        window[`ga-disable-${id}`] === true,
      config.measurementId,
    );
    assert.equal(await page.evaluate(() => window.analyticsQaMarker), 'keep-running');
    assert.doesNotMatch(await page.evaluate(() => document.cookie), /_ga=/);
    assert.equal(await page.evaluate(() => localStorage.getItem('cro-player-name')), 'keep');
    await page.locator('[data-analytics-settings]').click();
    await page
      .getByRole('button', { name: lang === 'en' ? 'Allow analytics' : '計測を許可', exact: true })
      .click();
    assert.equal(
      await page.evaluate((id) => window[`ga-disable-${id}`], config.measurementId),
      false,
    );
    assert.equal(await page.locator('script[src*="googletagmanager.com"]').count(), 1);
    pass(
      `${lang}: withdrawal stops both tabs without reload, removes GA cookies, keeps game settings; reconsent reuses the tag`,
    );
    await ctx.close();
  }
  for (const origin of ['http://localhost:3000', 'https://cromagnonmmo.cro-magnon.workers.dev']) {
    const { ctx, requests } = await context(origin);
    await ctx.addInitScript(() => {
      try {
        localStorage.setItem('cro-analytics-consent-v1', 'granted');
      } catch {
        /* about:blank */
      }
    });
    const page = await ctx.newPage();
    await page.goto(origin + '/privacy');
    assert.equal(await page.locator('#analytics-consent').count(), 0);
    assert.deepEqual(requests, []);
    pass(`${origin}: no measurement with a saved opt-in`);
    await ctx.close();
  }
  assert.deepEqual(errors, []);
  pass('No browser exceptions; all Google requests intercepted, no data sent');
} catch (error) {
  failure = error.stack;
  process.exitCode = 1;
  console.error(failure);
} finally {
  await browser.close();
  await writeFile(
    path.join(output, 'result.json'),
    JSON.stringify({ checks, errors, failure }, null, 2) + '\n',
  );
}
