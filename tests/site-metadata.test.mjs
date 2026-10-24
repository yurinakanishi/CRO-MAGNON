import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { publicSiteHtml } from '../scripts/site-metadata.mjs';
import { serveStatic, sendFailure } from '../dist/infrastructure/node/static-files.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (name) => readFile(new URL('../' + name, import.meta.url), 'utf8');

test('sitemap contains canonical, reciprocal language pages and robots keeps render assets accessible', async () => {
  const sitemap = await read('public/sitemap.xml');
  const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
  assert.deepEqual(urls, [
    'https://cromagnonmmo.com/',
    'https://cromagnonmmo.com/en/',
    'https://cromagnonmmo.com/privacy',
    'https://cromagnonmmo.com/en/privacy',
  ]);
  for (const [file, url] of ['index.html', 'en/index.html', 'privacy.html', 'en/privacy.html'].map(
    (file, i) => [file, urls[i]],
  )) {
    const html = await read('public/' + file);
    assert.ok(html.includes(`rel="canonical" href="${url}"`));
    assert.doesNotMatch(html, /workers\.dev/);
    assert.match(html, /hreflang="ja"/);
    assert.match(html, /hreflang="en"/);
    const configured = publicSiteHtml(Buffer.from(html), {
      measurementId: 'G-TEST123',
      searchConsoleVerification: 'test_token-123',
    }).toString();
    assert.equal((configured.match(/data-measurement-id="G-TEST123"/g) || []).length, 1);
    assert.equal((configured.match(/name="google-site-verification"/g) || []).length, 1);
  }
  assert.doesNotMatch(sitemap, /lastmod|priority|changefreq|workers\.dev|localhost/);
  const robots = await read('public/robots.txt');
  assert.match(robots, /Sitemap: https:\/\/cromagnonmmo\.com\/sitemap\.xml/);
  assert.doesNotMatch(robots, /Disallow: \/(?:src|shared|models|vendor|$)/m);
});

test('public metadata rejects malformed IDs instead of publishing broken or injected tags', () => {
  const source = Buffer.from('<head><script data-measurement-id=""></script></head>');
  const inactive = { measurementId: null, searchConsoleVerification: null };
  assert.equal(publicSiteHtml(source, inactive).toString(), source.toString());
  for (const measurementId of ['', 'UA-123', 'G-X"><script>', undefined])
    assert.throws(() => publicSiteHtml(source, { ...inactive, measurementId }));
  assert.throws(() =>
    publicSiteHtml(source, { ...inactive, searchConsoleVerification: '"><script>' }),
  );
  assert.throws(() => publicSiteHtml(Buffer.from('<head></head>'), inactive));
});

test('local server serves XML and both privacy languages with HEAD and real 404s', async (t) => {
  const server = http.createServer(async (req, res) => {
    try {
      await serveStatic(req, res, new URL(req.url, 'http://localhost').pathname, root);
    } catch (error) {
      sendFailure(res, error);
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  for (const [url, type] of [
    ['/robots.txt', 'text/plain'],
    ['/sitemap.xml', 'application/xml'],
    ['/privacy', 'text/html'],
    ['/en/privacy', 'text/html'],
    ['/site-analytics.js', 'text/javascript'],
  ]) {
    const response = await fetch(origin + url);
    assert.equal(response.status, 200);
    assert.ok(response.headers.get('content-type').startsWith(type));
    const head = await fetch(origin + url, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
  }
  assert.equal((await fetch(origin + '/missing-sitemap.xml')).status, 404);
});
