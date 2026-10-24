// Verify the exact built files through Cloudflare's local asset router.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const buildRoot = process.argv[2];
if (!buildRoot) throw new Error('Pass an isolated public build root');
const output = path.resolve(buildRoot);
const directory = path.join(output, 'dist-cloudflare');
const config = JSON.parse(await readFile('cloudflare/site-config.json', 'utf8'));
const ledger = JSON.parse(await readFile(path.join(output, 'cloudflare-build.json'), 'utf8'));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const checks = [];
const mf = new Miniflare(
  convertV4MiniflareOptions({
    name: 'site-metadata-qa',
    host: '127.0.0.1',
    port: 0,
    modules: true,
    compatibilityDate: '2026-09-07',
    script: 'export default {fetch(request, env) { return env.ASSETS.fetch(request); }}',
    assets: {
      directory,
      binding: 'ASSETS',
      run_worker_first: ['/api/*', '/ws'],
      routerConfig: { has_user_worker: true },
      assetConfig: { not_found_handling: 'none' },
    },
  }),
);
let failure;
try {
  const origin = (await mf.ready).origin;
  for (const [url, file, type] of [
    ['/', 'index.html', 'text/html'],
    ['/en/', 'en/index.html', 'text/html'],
    ['/privacy', 'privacy.html', 'text/html'],
    ['/en/privacy', 'en/privacy.html', 'text/html'],
    ['/robots.txt', 'robots.txt', 'text/plain'],
    ['/sitemap.xml', 'sitemap.xml', 'application/xml'],
    ['/site-analytics.js', 'site-analytics.js', 'text/javascript'],
    ['/site-privacy.css', 'site-privacy.css', 'text/css'],
  ]) {
    const response = await fetch(origin + url, { redirect: 'manual' });
    assert.equal(response.status, 200, url);
    assert.ok(response.headers.get('content-type').startsWith(type), url);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(hash(bytes), hash(await readFile(path.join(directory, file))), url);
    assert.equal(hash(bytes), ledger.publicFiles.find((entry) => entry.path === file)?.sha256, url);
    if (file.endsWith('.html')) {
      assert.ok(bytes.toString().includes(`rel="canonical" href="https://cromagnonmmo.com${url}"`));
      assert.ok(bytes.toString().includes(`data-measurement-id="${config.measurementId}"`));
      assert.equal(response.headers.get('x-robots-tag'), null);
    }
    assert.equal((await fetch(origin + url, { method: 'HEAD' })).status, 200);
    checks.push(`${url}: 200, MIME, exact ledger/file SHA and HEAD`);
  }
  const script = await fetch(origin + '/src/boot-bundle.js');
  assert.equal(script.headers.get('x-robots-tag'), 'noindex');
  assert.equal((await fetch(origin + '/missing-page')).status, 404);
  checks.push('Runtime files remain crawlable with noindex; missing URLs stay 404');
  console.log(checks.map((value) => `PASS ${value}`).join('\n'));
} catch (error) {
  failure = error.stack;
  process.exitCode = 1;
  console.error(failure);
} finally {
  await mf.dispose();
  await mkdir(output, { recursive: true });
  await writeFile(
    path.join(output, 'site-metadata-qa.json'),
    JSON.stringify({ buildId: ledger.buildId, checks, failure }, null, 2) + '\n',
  );
}
