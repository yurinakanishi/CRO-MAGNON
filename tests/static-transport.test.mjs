import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { serveStatic } from '../dist/infrastructure/node/static-files.mjs';
import { localContentOverride } from '../dist/infrastructure/node/local-visibility.mjs';
import {
  activeStaticStreams,
  negotiateEncoding,
} from '../dist/infrastructure/node/static-transport.mjs';

// Every check below reads the actual HTTP response bytes from a real server that
// calls serveStatic, as server.mts and exhibition-client.mts do.

const HIDDEN = Object.freeze({ hiddenCharacters: Object.freeze(['maruimo']), hideMae: true });

/** Text that compresses, but not to nothing, so large bodies take real work. */
function text(bytes, seed = 1) {
  let state = seed;
  const words = ['const', 'export', 'function', 'return', 'world', 'cave', '{', '}', ';', '\n'];
  const parts = [];
  let length = 0;
  while (length < bytes) {
    state = (state * 1103515245 + 12345) % 2147483648;
    const word = `${words[state % words.length]}${(state >> 8) % 997} `;
    parts.push(word);
    length += word.length;
  }
  return parts.join('').slice(0, bytes);
}

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cro-static-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const directory of [
    'public/models/maruimo-octopus',
    'public/title',
    'dist/src',
    'dist/shared',
  ])
    await mkdir(path.join(root, directory), { recursive: true });
  const files = {
    html: '<!doctype html><title>t</title><script type="module" src="/src/boot.js"></script>\n',
    module: text(300_000),
    large: text(12_000_000, 7),
    png: Buffer.from(Array.from({ length: 4096 }, (_, i) => (i * 131 + 7) % 256)),
    model: Buffer.concat([
      Buffer.from('glTF\x02\x00\x00\x00'),
      Buffer.from(Array.from({ length: 90000 }, (_, i) => (i * 131 + 7) % 256)),
    ]),
    catalog: JSON.stringify({
      status: 'ready',
      assets: [
        { modelKey: 'stone-axe', url: '/models/stone-axe/model.glb' },
        { modelKey: 'maruimo-octopus', species: 'maruimo', url: '/models/maruimo-octopus/m.glb' },
        { modelKey: 'mae', url: '/models/mae/m.glb' },
      ],
    }),
  };
  await writeFile(path.join(root, 'public/index.html'), files.html);
  await writeFile(path.join(root, 'dist/src/game.js'), files.module);
  await writeFile(path.join(root, 'dist/src/large.js'), files.large);
  await writeFile(path.join(root, 'public/title/art.png'), files.png);
  await writeFile(path.join(root, 'public/models/transport-fixture.glb'), files.model);
  await writeFile(path.join(root, 'public/models/world-assets.json'), files.catalog);
  await writeFile(path.join(root, 'public/models/maruimo-octopus/asset.json'), '{}');
  await writeFile(path.join(root, 'public/.secret.json'), '{"secret":true}');
  return { root, files };
}

async function serve(t, root, visibility) {
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://localhost');
      await serveStatic(request, response, url.pathname, root, visibility);
    } catch (error) {
      response.writeHead(error.code === 'ENOENT' || error.code === 'ENOTDIR' ? 404 : 400).end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return server.address().port;
}

/** Raw response bytes: Node's client never decodes content codings itself. */
function fetchRaw(port, url, { method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      { host: '127.0.0.1', port, path: url, method, headers, agent: false },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () =>
          resolve({
            status: response.statusCode,
            headers: response.headers,
            body: Buffer.concat(chunks),
          }),
        );
        response.on('error', reject);
      },
    );
    request.on('error', reject);
    request.end();
  });
}

const settled = async () => {
  for (let i = 0; i < 200 && activeStaticStreams() > 0; i++)
    await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(activeStaticStreams(), 0, 'every static stream was released');
};

test('Accept-Encoding is parsed by weight, not by substring', () => {
  const cases = [
    [undefined, true, 'identity'],
    ['', true, 'identity'],
    ['gzip', true, 'gzip'],
    ['GZIP', true, 'gzip'],
    ['x-gzip', true, 'gzip'],
    ['gzip, deflate, br, zstd', true, 'gzip'],
    ['br', true, 'identity'],
    ['gzip;q=0', true, 'identity'],
    ['gzip;q=0.000', true, 'identity'],
    ['gzip;q=0.5, identity;q=1', true, 'identity'],
    ['gzip;q=1, identity;q=0.5', true, 'gzip'],
    ['identity;q=0, gzip', true, 'gzip'],
    ['*', true, 'gzip'],
    ['*;q=0.3, identity;q=0.2', true, 'gzip'],
    ['*;q=0', true, null],
    ['identity;q=0', true, null],
    ['gzip;q=0, identity;q=0', true, null],
    ['identity;q=0, *;q=0.5', true, 'gzip'],
    ['identity;q=0, *;q=0.5', false, null],
    ['gzip', false, 'identity'],
    ['gzip;q=2', true, 'identity'],
    ['gzip;q=abc', true, 'identity'],
    ['gzip ; Q=0.8', true, 'gzip'],
    // Identity the client never mentions is only the fallback: any accepted gzip wins.
    ['gzip;q=0.3', true, 'gzip'],
    ['gzip;q=0.001', true, 'gzip'],
    // Explicitly weighted identity is compared (gzip wins ties).
    ['gzip;q=0.5, identity;q=0.4', true, 'gzip'],
    ['gzip;q=0.5, identity;q=0.5', true, 'gzip'],
    ['gzip;q=0.5, identity;q=0.6', true, 'identity'],
    // A wildcard weighs identity too, unless identity is named.
    ['gzip;q=0.5, *;q=1', true, 'identity'],
    ['gzip;q=0.5, *;q=0.4', true, 'gzip'],
    ['gzip;q=0.5, identity;q=0.4, *;q=1', true, 'gzip'],
    ['*;q=0.5', true, 'gzip'],
    ['*;q=0.5', false, 'identity'],
    // Unavailable codings fall back to identity unless identity is refused.
    ['br;q=1, gzip;q=0', true, 'identity'],
    ['br, zstd', false, 'identity'],
    ['br, *;q=0', true, null],
    ['br, identity;q=0', true, null],
    ['br, gzip;q=0.2, *;q=0', true, 'gzip'],
    ['gzip;q=0.3', false, 'identity'],
    ['gzip;q=0, gzip;q=1', true, 'identity'],
    [['gzip;q=0', 'identity;q=0'], true, null],
    ['g zip, identity', true, 'identity'],
  ];
  for (const [header, compressible, expected] of cases)
    assert.equal(negotiateEncoding(header, compressible), expected, JSON.stringify(header));
});

test('compressible text is gzip-encoded on request and decodes to the exact stored bytes', async (t) => {
  const { root, files } = await fixture(t);
  const port = await serve(t, root);
  const plain = await fetchRaw(port, '/src/game.js');
  assert.equal(plain.status, 200);
  assert.equal(plain.headers['content-encoding'], undefined);
  assert.equal(Number(plain.headers['content-length']), files.module.length);
  assert.equal(plain.headers.vary, 'Accept-Encoding');
  assert.equal(plain.body.toString(), files.module);
  const gzip = await fetchRaw(port, '/src/game.js', {
    headers: { 'Accept-Encoding': 'gzip, deflate, br' },
  });
  assert.equal(gzip.status, 200);
  assert.equal(gzip.headers['content-encoding'], 'gzip');
  assert.equal(gzip.headers['content-length'], undefined, 'no stored length for an encoded body');
  assert.equal(gzip.headers.vary, 'Accept-Encoding');
  assert.equal(gzip.headers['content-type'], 'text/javascript; charset=utf-8');
  assert.equal(gzip.headers['cache-control'], 'no-cache');
  assert.equal(gzip.headers.etag, plain.headers.etag, 'one validator: the stored file');
  assert.ok(gzip.body.length < files.module.length / 2);
  assert.equal(gunzipSync(gzip.body).toString(), files.module);
  const html = await fetchRaw(port, '/', { headers: { 'Accept-Encoding': 'gzip' } });
  assert.equal(html.headers['content-type'], 'text/html; charset=utf-8');
  assert.equal(gunzipSync(html.body).toString(), files.html);
  await settled();
});

test('GLB transport preserves every decoded byte, validators, HEAD and identity delivery', async (t) => {
  const { root, files } = await fixture(t);
  const port = await serve(t, root);
  const url = '/models/transport-fixture.glb';
  const plain = await fetchRaw(port, url, { headers: { 'Accept-Encoding': 'identity' } });
  const headers = { 'Accept-Encoding': 'gzip' };
  const compressed = await fetchRaw(port, url, { headers });
  assert.equal(compressed.status, 200);
  assert.equal(compressed.headers['content-encoding'], 'gzip');
  assert.equal(compressed.headers['content-type'], 'model/gltf-binary');
  assert.equal(compressed.headers.vary, 'Accept-Encoding');
  assert.equal(compressed.headers['content-length'], undefined);
  assert.ok(compressed.body.length < files.model.length);
  assert.deepEqual(gunzipSync(compressed.body), files.model);
  assert.deepEqual(plain.body, files.model);
  assert.equal(Number(plain.headers['content-length']), files.model.length);
  assert.equal(compressed.headers.etag, plain.headers.etag);
  const head = await fetchRaw(port, url, { method: 'HEAD', headers });
  assert.equal(head.body.length, 0);
  for (const name of ['content-type', 'content-encoding', 'content-length', 'etag', 'vary'])
    assert.equal(head.headers[name], compressed.headers[name]);
  const cached = await fetchRaw(port, url, {
    headers: { ...headers, 'If-None-Match': plain.headers.etag },
  });
  assert.equal(cached.status, 304);
  assert.equal(cached.body.length, 0);
  assert.equal(cached.headers.vary, 'Accept-Encoding');
  assert.equal(cached.headers.etag, plain.headers.etag);
  assert.equal(cached.headers['content-encoding'], undefined);
  await settled();
});

test('refused codings fail explicitly with 406; encoded images are sent as stored', async (t) => {
  const { root, files } = await fixture(t);
  const port = await serve(t, root);
  for (const header of ['identity;q=0', '*;q=0', 'gzip;q=0, identity;q=0']) {
    const refused = await fetchRaw(port, '/src/game.js', {
      headers: { 'Accept-Encoding': header },
    });
    assert.equal(refused.status, 406, header);
    assert.equal(refused.headers['content-encoding'], undefined);
  }
  const png = await fetchRaw(port, '/title/art.png', { headers: { 'Accept-Encoding': 'gzip, *' } });
  assert.equal(png.status, 200);
  assert.equal(png.headers['content-encoding'], undefined);
  assert.equal(png.headers.vary, undefined);
  assert.equal(Number(png.headers['content-length']), files.png.length);
  assert.ok(png.body.equals(files.png));
  const pngRefused = await fetchRaw(port, '/title/art.png', {
    headers: { 'Accept-Encoding': 'identity;q=0, gzip' },
  });
  assert.equal(pngRefused.status, 406);
  // The allowlist still answers first.
  assert.equal(
    (await fetchRaw(port, '/.secret.json', { headers: { 'Accept-Encoding': 'gzip' } })).status,
    403,
  );
  const escape = await fetchRaw(port, '/src/..%5c..%5cpackage.json', {
    headers: { 'Accept-Encoding': 'gzip' },
  });
  assert.equal(escape.status, 403);
  await settled();
});

test('HEAD matches GET headers without a body; 304 carries the validator and Vary only', async (t) => {
  const { root, files } = await fixture(t);
  const port = await serve(t, root);
  for (const accept of ['gzip', undefined]) {
    const headers = accept ? { 'Accept-Encoding': accept } : {};
    const get = await fetchRaw(port, '/src/game.js', { headers });
    const head = await fetchRaw(port, '/src/game.js', { method: 'HEAD', headers });
    assert.equal(head.status, 200);
    assert.equal(head.body.length, 0);
    for (const name of [
      'content-encoding',
      'content-length',
      'content-type',
      'etag',
      'vary',
      'cache-control',
    ])
      assert.equal(head.headers[name], get.headers[name], `${accept}: ${name}`);
    const cached = await fetchRaw(port, '/src/game.js', {
      headers: { ...headers, 'If-None-Match': `W/"other", ${get.headers.etag}` },
    });
    assert.equal(cached.status, 304);
    assert.equal(cached.body.length, 0);
    assert.equal(cached.headers.etag, get.headers.etag);
    assert.equal(cached.headers.vary, 'Accept-Encoding');
    assert.equal(cached.headers['content-encoding'], undefined);
  }
  assert.equal(files.module.length > 0, true);
  await settled();
});

test('a modified file is served as its new revision with a new validator', async (t) => {
  const { root } = await fixture(t);
  const port = await serve(t, root);
  const file = path.join(root, 'dist/src/game.js');
  const first = await fetchRaw(port, '/src/game.js', { headers: { 'Accept-Encoding': 'gzip' } });
  const next = text(310_000, 99);
  await writeFile(file, next);
  const later = new Date(Date.now() + 5000);
  await utimes(file, later, later);
  const stale = await fetchRaw(port, '/src/game.js', {
    headers: { 'Accept-Encoding': 'gzip', 'If-None-Match': first.headers.etag },
  });
  assert.equal(stale.status, 200, 'the old validator no longer matches');
  assert.notEqual(stale.headers.etag, first.headers.etag);
  assert.equal(gunzipSync(stale.body).toString(), next);
  const plain = await fetchRaw(port, '/src/game.js');
  assert.equal(plain.body.toString(), next);
  assert.equal(Number(plain.headers['content-length']), next.length);
  await settled();
});

test('visibility overrides keep their filtered content and no-store, encoded or not', async (t) => {
  const { root } = await fixture(t);
  const port = await serve(t, root, HIDDEN);
  for (const url of ['/models/world-assets.json', '/shared/character-profiles.mjs']) {
    const expected = await localContentOverride(url.slice(1), root, HIDDEN);
    assert.equal(typeof expected, 'string');
    const gzip = await fetchRaw(port, url, { headers: { 'Accept-Encoding': 'gzip' } });
    assert.equal(gzip.headers['content-encoding'], 'gzip');
    assert.equal(gzip.headers['cache-control'], 'no-store');
    assert.equal(gzip.headers.etag, undefined);
    assert.equal(gzip.headers.vary, 'Accept-Encoding');
    assert.equal(gunzipSync(gzip.body).toString(), expected);
    const plain = await fetchRaw(port, url);
    assert.equal(plain.headers['content-encoding'], undefined);
    assert.equal(plain.headers['cache-control'], 'no-store');
    assert.equal(plain.body.toString(), expected);
    const head = await fetchRaw(port, url, {
      method: 'HEAD',
      headers: { 'Accept-Encoding': 'gzip' },
    });
    assert.equal(head.body.length, 0);
    assert.equal(head.headers['content-encoding'], 'gzip');
  }
  const catalog = JSON.parse(
    gunzipSync(
      (
        await fetchRaw(port, '/models/world-assets.json', {
          headers: { 'Accept-Encoding': 'gzip' },
        })
      ).body,
    ),
  );
  assert.deepEqual(
    catalog.assets.map((asset) => asset.modelKey),
    ['stone-axe'],
  );
  const hidden = await fetchRaw(port, '/models/maruimo-octopus/asset.json', {
    headers: { 'Accept-Encoding': 'gzip' },
  });
  assert.equal(hidden.status, 404);
  assert.equal(hidden.headers['cache-control'], 'no-store');
  await settled();
});

test('a client leaving mid-body releases the streams and the server keeps serving', async (t) => {
  const { root, files } = await fixture(t);
  const port = await serve(t, root);
  for (const headers of [{ 'Accept-Encoding': 'gzip' }, {}]) {
    await new Promise((resolve, reject) => {
      const request = http.request(
        { host: '127.0.0.1', port, path: '/src/large.js', headers, agent: false },
        (response) => {
          assert.equal(response.statusCode, 200);
          // Our own abort may surface as an error on the response; it is expected.
          response.on('error', () => {});
          response.once('data', () => {
            request.destroy();
            resolve();
          });
        },
      );
      request.on('error', (error) => (error.code === 'ECONNRESET' ? resolve() : reject(error)));
      request.end();
    });
    await settled();
  }
  // Several concurrent full bodies afterwards, each exact.
  const results = await Promise.all(
    Array.from({ length: 4 }, (_, i) =>
      fetchRaw(port, '/src/large.js', { headers: i % 2 ? {} : { 'Accept-Encoding': 'gzip' } }),
    ),
  );
  for (const [i, result] of results.entries()) {
    const body = i % 2 ? result.body : gunzipSync(result.body);
    assert.equal(body.length, files.large.length);
    assert.equal(body.toString(), files.large);
  }
  await settled();
});

test('a missing file is still an ordinary not-found for the caller', async (t) => {
  const { root } = await fixture(t);
  const port = await serve(t, root);
  const missing = await fetchRaw(port, '/src/missing.js', {
    headers: { 'Accept-Encoding': 'gzip' },
  });
  assert.equal(missing.status, 404);
  assert.equal(missing.headers['content-encoding'], undefined);
  const directory = await fetchRaw(port, '/src/', { headers: { 'Accept-Encoding': 'gzip' } });
  assert.notEqual(directory.status, 200);
  await settled();
});
