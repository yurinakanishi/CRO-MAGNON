import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveStatic, sendFailure } from '../dist/infrastructure/node/static-files.mjs';
import { bundledIndex } from '../scripts/bundle-browser.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
// The game's own domain (README), not the retained workers.dev URL.
const site = 'https://cromagnonmmo.com';
// Long tags wrap their attributes onto separate lines.
const meta = (html, key) =>
  html.match(new RegExp(`<meta\\s+(?:name|property)="${key}"\\s+content="([^"]*)"`))?.[1];

test('shared URLs serve distinct Japanese and English metadata before JavaScript runs', async (t) => {
  const server = http.createServer(async (request, response) => {
    try {
      await serveStatic(request, response, new URL(request.url, site).pathname, root);
    } catch (error) {
      sendFailure(response, error);
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const pages = [];
  for (const [pathname, language, locale, description] of [
    ['/', 'ja', 'ja_JP', '原始の世界を自由に冒険。'],
    ['/en/', 'en', 'en_US', 'Explore a prehistoric world.'],
  ]) {
    // Cookie/browser preferences and Accept-Language must not change a URL's OG text.
    const response = await fetch(origin + pathname, {
      headers: { 'User-Agent': 'Twitterbot', 'Accept-Language': language === 'ja' ? 'en' : 'ja' },
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^text\/html/);
    const html = await response.text();
    pages.push(html);
    for (const document of [html, bundledIndex(Buffer.from(html)).toString()]) {
      assert.match(document, new RegExp(`<html lang="${language}">`));
      for (const key of ['description', 'og:description', 'twitter:description'])
        assert.equal(meta(document, key), description);
      assert.equal(meta(document, 'og:locale'), locale);
      assert.equal(meta(document, 'og:url'), site + pathname);
      assert.ok(document.includes(`rel="canonical" href="${site + pathname}"`));
      assert.ok(document.includes(`hreflang="ja" href="${site}/"`));
      assert.ok(document.includes(`hreflang="en" href="${site}/en/"`));
      // Both previews show one image from the same site, a file the release serves.
      const image = new URL(meta(document, 'og:image'));
      assert.equal(meta(document, 'twitter:image'), image.href);
      assert.equal(image.origin, site);
      await access(path.join(root, 'public', image.pathname));
      assert.doesNotMatch(document, /オンライン・ファンタジー|三つの国と湾/);
    }
    const head = await fetch(origin + pathname, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
  }
  // Both entries must keep boot/import maps and styles in sync with the same game.
  const body = (html) =>
    html.slice(html.indexOf('  <body>')).replace(/<noscript>[\s\S]*?<\/noscript>/, '');
  assert.equal(body(pages[0]), body(pages[1]));
  const styles = (html) => [...html.matchAll(/<link rel="stylesheet"[^>]+>/g)].map(([tag]) => tag);
  assert.deepEqual(styles(pages[0]), styles(pages[1]));
  for (const pathname of ['/en', '/en/index.html', '/en/?room=EMBER']) {
    const response = await fetch(origin + pathname);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), pages[1]);
  }
  const missing = await fetch(origin + '/en/missing.html');
  assert.equal(missing.status, 404, 'unknown files still fail instead of masking broken links');
});
