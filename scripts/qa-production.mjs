// Verify one exact public artifact through the local Cloudflare runtime.
// No account access, deployment, existing server, or persistent game storage.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { assertPublicCharacterData } from './public-character-audit.mjs';

assert.ok(process.argv[2] && process.argv[3], 'Pass the build root and browser evidence directory');
const buildRoot = path.resolve(process.argv[2]);
const output = path.resolve(process.argv[3]);
const assets = path.join(buildRoot, 'dist-cloudflare');
const workerRoot = path.join(buildRoot, 'dist-cloudflare-worker');
const report = JSON.parse(await readFile(path.join(buildRoot, 'cloudflare-build.json'), 'utf8'));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const checks = [];
const pass = (label) => {
  checks.push(label);
  console.log('PASS', label);
};
await mkdir(output, { recursive: true });
let mf, base, failure;

async function filesUnder(directory, prefix = '') {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    assert.ok(!entry.isSymbolicLink(), `Unexpected link: ${entry.name}`);
    const relative = prefix + entry.name;
    if (entry.isDirectory())
      files.push(...(await filesUnder(path.join(directory, entry.name), relative + '/')));
    else files.push(relative);
  }
  return files.sort();
}

async function run(script, args) {
  console.log(`Browser check: ${script}`);
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      stdio: 'inherit',
      windowsHide: true,
    });
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${script} exited ${code}`)),
    );
  });
}

try {
  // Reject unlisted leftovers as well as missing or changed files.
  for (const [directory, records] of [
    [assets, report.publicFiles],
    [workerRoot, report.workerFiles],
  ]) {
    assert.deepEqual(await filesUnder(directory), records.map((record) => record.path).sort());
    for (const record of records) {
      const file = path.resolve(directory, record.path);
      const relative = path.relative(directory, file);
      assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
      const bytes = await readFile(file);
      assert.equal(bytes.length, record.bytes, record.path);
      assert.equal(hash(bytes), record.sha256, record.path);
      if (/\.(?:m?js|css|json|html|txt)$/.test(record.path))
        assertPublicCharacterData(
          record.path,
          bytes,
          new Set(['maruimo-octopus']),
          new Set(['maruimo']),
        );
    }
  }
  assert.equal(
    report.buildId,
    hash(
      Buffer.from(
        JSON.stringify({ publicFiles: report.publicFiles, workerFiles: report.workerFiles }),
      ),
    ),
  );
  pass(
    'Every public/worker file and the build ID match the SHA-256 release ledger; no extra files',
  );
  const config = JSON.parse(await readFile(path.join(assets, 'multiplayer-config.json'), 'utf8'));
  assert.equal(config.mode, 'solo');
  assert.equal(config.room, 'SOLO');
  for (const key of [
    'maruimo-octopus',
    'cat-kunoichi',
    'kunoichi-katana',
    'neanderthal-hunter',
    'neanderthal-woman',
  ])
    assert.ok(!report.publicFiles.some((record) => record.path.startsWith(`models/${key}/`)), key);
  pass('The exact artifact enables solo and excludes the retired/private models');

  const { default: handler } = await import(
    pathToFileURL(path.join(workerRoot, 'cloudflare/request-handler.mjs')).href
  );
  let gameAccess = 0;
  const env = {
    SERVICE_ENABLED: 'false',
    ASSETS: { fetch: async () => new Response('static') },
    get GAME() {
      gameAccess++;
      throw new Error('A solo request must never access a Durable Object');
    },
  };
  for (const pathname of ['/ws', '/api/status'])
    assert.equal(
      (await handler.fetch(new Request(`https://example.test${pathname}`), env)).status,
      503,
    );
  assert.equal(gameAccess, 0);
  pass('The packaged request handler rejects online traffic before accessing a Durable Object');

  mf = new Miniflare(
    convertV4MiniflareOptions({
      name: 'production-solo-qa',
      host: '127.0.0.1',
      port: 0,
      modules: true,
      scriptPath: path.join(buildRoot, 'worker-dry-run/worker.js'),
      compatibilityDate: '2026-09-07',
      compatibilityFlags: ['nodejs_compat'],
      bindings: { SERVICE_ENABLED: 'false' },
      // Deliberately no Durable Object binding or persistence directory.
      assets: {
        directory: assets,
        binding: 'ASSETS',
        run_worker_first: ['/ws', '/api/*'],
        routerConfig: { has_user_worker: true },
        assetConfig: { not_found_handling: 'none' },
      },
    }),
  );
  base = (await mf.ready).origin;
  const publicFiles = report.publicFiles.filter((record) => !record.path.startsWith('_'));
  let cursor = 0;
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      while (cursor < publicFiles.length) {
        const file = publicFiles[cursor++];
        const response = await fetch(`${base}/${file.path}`);
        assert.equal(response.status, 200, file.path);
        assert.equal(hash(Buffer.from(await response.arrayBuffer())), file.sha256, file.path);
        assert.equal(response.headers.get('x-content-type-options'), 'nosniff', file.path);
        if (/\.glb$/.test(file.path) && report.immutableModelCache)
          assert.match(response.headers.get('cache-control'), /immutable/, file.path);
      }
    }),
  );
  pass(
    `Cloudflare local serving matches all ${publicFiles.length} public-file hashes and security/cache headers`,
  );
  for (const pathname of [
    '/models/maruimo-octopus/asset.json',
    '/models/cat-kunoichi/asset.json',
    '/motion/assets.json',
    '/.env',
    '/missing-page',
  ])
    assert.equal((await fetch(base + pathname)).status, 404, pathname);
  for (const pathname of ['/ws', '/api/status'])
    assert.equal((await fetch(base + pathname)).status, 503, pathname);
  const health = await (await fetch(base + '/api/health')).json();
  assert.equal(health.mode, 'solo');
  assert.equal(health.maxPlayers, 1);
  pass('Health is solo; online endpoints and unpublished paths remain unavailable');
  await run('scripts/qa-solo-play.mjs', [
    path.join(output, 'play'),
    `--url=${base}/`,
    '--idle',
    '--profile',
    '--recovery',
  ]);
  await run('scripts/qa-solo-exit.mjs', [path.join(output, 'exit'), `--url=${base}/`]);
  await run('scripts/qa-solo-storage.mjs', [path.join(output, 'storage')]);
  await run('scripts/qa-og-language.mjs', [path.join(output, 'language'), assets]);
  pass(
    'Chrome desktop/mobile, idle, resume, writer exclusion, context recovery, storage failure and both languages pass',
  );
} catch (error) {
  failure = error.stack || String(error);
  throw error;
} finally {
  await writeFile(
    path.join(output, 'result.json'),
    JSON.stringify(
      {
        buildId: report.buildId,
        base,
        status: failure ? 'failed' : 'passed',
        checks,
        failure,
        scope:
          'Chrome on this host; mobile viewport/touch emulation. Physical phones, physical gamepads and native Safari are not certified.',
      },
      null,
      2,
    ),
  );
  await mf?.dispose();
}
