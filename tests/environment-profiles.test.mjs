import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtemp, mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { WebSocket } from 'ws';
import { ENVIRONMENTS, environmentProfile } from '../dist/shared/environment-profile.mjs';
import { localVerificationSettings } from '../dist/infrastructure/node/local-verification.mjs';
import { createGameServer, createPersistentGameServer } from '../dist/server.mjs';
import {
  browserBuildProfile,
  environmentAsset,
  auditEnvironmentAssets,
  cameraAsset,
  runtimeTextureRecords,
  runtimeBotPortraitUrls,
} from '../scripts/environment-assets.mjs';
import { sha256, buildId, verifyExhibition } from '../scripts/exhibition-integrity.mjs';

test('all nine catalog bot portraits are included only when their models are released', async () => {
  const { assets } = JSON.parse(await readFile('public/models/world-assets.json', 'utf8'));
  const portraits = runtimeBotPortraitUrls(assets);
  assert.equal(portraits.length, 9);
  for (const color of ['white', 'blue', 'green', 'purple', 'orange'])
    assert.ok(portraits.includes(`/models/orb-bot-${color}/portrait.png`));
  assert.deepEqual(runtimeBotPortraitUrls([{ modelKey: 'orb-bot-white' }]), [
    '/models/orb-bot-white/portrait.png',
  ]);
  assert.deepEqual(runtimeBotPortraitUrls([]), []);
});

test('nested declared cave textures are packaged with integrity while historical provenance stays out', async () => {
  const cave = JSON.parse(await readFile('public/models/camp-cave/asset.json', 'utf8')),
    catalog = JSON.parse(await readFile('public/models/world-assets.json', 'utf8')).assets.find(
      (asset) => asset.modelKey === 'camp-cave',
    ),
    records = runtimeTextureRecords(cave);
  // Exactly the active records the manifest declares: the four direct images, every mascot
  // frieze, and the declared previous atlas (packaged as before). They name originals before
  // adoption and hash-named candidates after it.
  for (const key of ['roundBots', 'shapeBots', 'maeKohaku'])
    assert.ok(Object.hasOwn(cave.mascotPigments, key), key);
  const declared = [
    cave.pigment,
    cave.rockSurface,
    cave.characterPigment,
    cave.rimoPigment,
    ...Object.values(cave.mascotPigments),
    cave.pigment.previous,
  ];
  assert.deepEqual(
    records.map((record) => record.url).sort(),
    declared.map((record) => record.url).sort(),
  );
  assert.deepEqual(runtimeTextureRecords(catalog), records, 'both runtime manifests agree');
  // Every URL inside a provenance record is historical: an adopted image's original, a reference.
  const historical = new Set();
  const visit = (value, inside) => {
    if (!value || typeof value !== 'object') return;
    if (inside && typeof value.url === 'string') historical.add(value.url);
    for (const [key, child] of Object.entries(value)) visit(child, inside || key === 'provenance');
  };
  visit(cave, false);
  for (const record of records) {
    assert.ok(!historical.has(record.url), `${record.url} is historical`);
    const file = path.join('public', ...record.url.slice(1).split('/')),
      bytes = await readFile(file);
    assert.equal(await sha256(file), record.sha256, record.url);
    if (record.bytes !== undefined) assert.equal(bytes.length, record.bytes, record.url);
    const original = record.provenance?.runtimeOptimization?.original;
    assert.equal(
      /\.opt-[0-9a-f]{16}\.png$/.test(record.url),
      !!original,
      `${record.url}: hash-named exactly when adopted`,
    );
    if (original) {
      // Adopted: the served size, plus the original size its rectangles are measured in.
      assert.deepEqual(
        [bytes.readUInt32BE(16), bytes.readUInt32BE(20)],
        [record.image.width, record.image.height],
        record.url,
      );
      assert.deepEqual(record.uvSource, original.image, record.url);
      assert.ok(!records.some((other) => other.url === original.url), original.url);
    } else assert.equal(record.uvSource, undefined, record.url);
  }
  const record = { url: '/models/test/pigment.png', sha256: 'a'.repeat(64) };
  assert.deepEqual(
    runtimeTextureRecords({
      mural: { group: record },
      provenance: { old: { ...record, url: '/models/test/old.png' } },
    }),
    [record],
  );
  // An adopted record ships; the original it replaced, kept under its provenance, does not.
  const adopted = {
    url: `/models/test/pigment.opt-${'c'.repeat(16)}.png`,
    sha256: 'c'.repeat(64),
    bytes: 10,
    image: { width: 512, height: 256 },
    uvSource: { width: 2048, height: 1024 },
    provenance: {
      runtimeOptimization: { original: { ...record, image: { width: 2048, height: 1024 } } },
    },
  };
  assert.deepEqual(runtimeTextureRecords({ pigment: adopted }), [adopted]);
  assert.throws(
    () => runtimeTextureRecords({ a: record, b: { ...record, sha256: 'b'.repeat(64) } }),
    /Conflicting/,
  );
});

test('all environment releases reject removed journal code and stale incremental assets', async () => {
  for (const environment of ['local', 'exhibition', 'mmo']) {
    const profile = browserBuildProfile(environment);
    for (const [name, code] of [
      ['src/adventure-ui.js', 'export const old = true;'],
      ['src/main.js', 'openJournal();'],
      ['src/touch-controls.js', 'const action = "journal";'],
      ['src/style.css', '.journal-entry {}'],
    ]) {
      const files = new Map([
        ['build-profile.json', Buffer.from(JSON.stringify(profile))],
        [name, Buffer.from(code)],
      ]);
      await assert.rejects(
        auditEnvironmentAssets(files.keys(), async (file) => files.get(file), profile),
        /Removed journal/,
      );
    }
  }
});

test('all environment releases reject the removed graphics selector and its stored preference', async () => {
  for (const environment of ['local', 'exhibition', 'mmo']) {
    const profile = browserBuildProfile(environment);
    for (const [name, code] of [
      ['src/graphics-settings.js', 'export {};'],
      ['src/main.js', "localStorage.getItem('cro-graphics-quality');"],
      ['src/main.js', '<button id="title-graphics" class="menu-item">画質</button>'],
      ['src/main.js', "root.querySelectorAll('[data-graphics]');"],
      ['src/world3d.js', 'renderer.setGraphicsMode?.(mode);'],
    ]) {
      const files = new Map([
        ['build-profile.json', Buffer.from(JSON.stringify(profile))],
        [name, Buffer.from(code)],
      ]);
      await assert.rejects(
        auditEnvironmentAssets(files.keys(), async (file) => files.get(file), profile),
        /Removed graphics selector/,
      );
    }
  }
});

test('environment profiles isolate local ports/storage and keep MMO camera controls disabled', () => {
  assert.equal(ENVIRONMENTS.local.cameraControls, true);
  assert.equal(ENVIRONMENTS.exhibition.cameraControls, true);
  assert.equal(ENVIRONMENTS.mmo.cameraControls, false);
  assert.equal(new Set(Object.values(ENVIRONMENTS).map((p) => p.port)).size, 3);
  assert.equal(ENVIRONMENTS.exhibition.storage, null);
  assert.notEqual(ENVIRONMENTS.local.storage, ENVIRONMENTS.mmo.storage);
  assert.throws(() => environmentProfile('constructor'));
  assert.throws(() => environmentProfile('unknown'));
  assert.throws(() => {
    ENVIRONMENTS.mmo.cameraControls = true;
  }, TypeError);
  const options = localVerificationSettings('C:/game');
  assert.equal(options.host, '127.0.0.1');
  assert.notEqual(options.saveDirectory, path.join('C:/game', '.cro-magnon-save'));
  for (const port of [0, 80, 'bad', 65536])
    assert.throws(() => localVerificationSettings('C:/game', port));
});

test('MMO hand entry cannot create UI or start a camera, even if passed local hooks', async () => {
  const profile = browserBuildProfile('mmo');
  const stub = environmentAsset(
    'src/hand-controls.js',
    Buffer.from('original'),
    profile,
  ).toString();
  const api = await import(`data:text/javascript,${encodeURIComponent(stub)}`);
  const poison = new Proxy(
    {},
    {
      get() {
        throw new Error('Hand controls were invoked');
      },
    },
  );
  assert.equal(api.createHandControls(poison, poison), undefined);
  for (const name of [
    'src/motion-camera.js',
    'src/motion-controls.css',
    'src/motion-worker.js',
    'vendor/mediapipe/wasm/vision.wasm',
    'motion/assets.json',
  ]) {
    assert.equal(environmentAsset(name, Buffer.from('recognizer'), profile), undefined);
    assert.equal(cameraAsset(name), true);
  }
  const html =
    '<link rel="stylesheet" href="/src/motion-controls.css" />\n<link rel="stylesheet" href="/src/touch-controls.css" />\n';
  const result = environmentAsset('index.html', Buffer.from(html), profile).toString();
  assert.doesNotMatch(result, /motion-controls/);
  assert.match(result, /touch-controls/);
  assert.equal(
    environmentAsset('index.html', Buffer.from(html), browserBuildProfile('exhibition')).toString(),
    html,
  );
});

test('actual emitted MMO browser modules have a complete dependency graph without recognizer assets', async () => {
  const profile = browserBuildProfile('mmo', '2026-10-06T00:00:00.000Z');
  const files = new Map([['build-profile.json', Buffer.from(JSON.stringify(profile))]]);
  async function collect(directory, prefix) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name),
        name = `${prefix}/${entry.name}`;
      if (entry.isDirectory()) await collect(file, name);
      else if (/\.(?:m?js|css|wasm|txt)$/.test(entry.name)) {
        const bytes = environmentAsset(name, await readFile(file), profile);
        if (bytes !== undefined) files.set(name, bytes);
      }
    }
  }
  for (const [directory, prefix] of [
    ['dist/src', 'src'],
    ['dist/shared', 'shared'],
    ['public/vendor', 'vendor'],
  ])
    await collect(directory, prefix);
  files.set(
    'index.html',
    environmentAsset('index.html', await readFile('public/index.html'), profile),
  );
  const audit = await auditEnvironmentAssets(
    files.keys(),
    async (name) => files.get(name),
    profile,
  );
  assert.equal(audit.cameraControls, false);
  assert.ok(files.has('src/touch-controls.js'));
  assert.ok(files.has('src/gamepad-ui.js'));
  assert.ok(files.has('src/assisted-controls.js'));
});

test('release auditing rejects camera leaks and broken static/dynamic/worker dependencies', async () => {
  const profile = browserBuildProfile('mmo');
  const make = (code) =>
    new Map([
      ['build-profile.json', Buffer.from(JSON.stringify(profile))],
      ['src/main.js', Buffer.from(code)],
    ]);
  for (const code of [
    "import './missing.js';",
    "export { x } from './missing.js';",
    "import('./missing.js');",
    "new URL('./missing.js', import.meta.url);",
    'navigator.mediaDevices.getUserMedia({video:true})',
  ]) {
    const files = make(code);
    await assert.rejects(
      auditEnvironmentAssets(files.keys(), async (name) => files.get(name), profile),
    );
  }
  const files = make('');
  files.set('motion/model.task', Buffer.from('model'));
  await assert.rejects(
    auditEnvironmentAssets(files.keys(), async (name) => files.get(name), profile),
    /Camera asset/,
  );
});

test('local runtime configuration is server-owned and leaves bundled configuration untouched', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'cro-environment-http-'));
  await mkdir(path.join(root, 'public'));
  const original = '{"mode":"online","room":"OTHER"}';
  await writeFile(path.join(root, 'public/multiplayer-config.json'), original);
  const options = localVerificationSettings(root);
  const game = createGameServer({ ...options, port: 0, assetRoot: root });
  t.after(() => game.close());
  const address = await game.listen(),
    base = `http://127.0.0.1:${address.port}`;
  assert.equal(address.address, '127.0.0.1');
  assert.deepEqual(
    await fetch(`${base}/multiplayer-config.json`).then((r) => r.json()),
    options.runtimeConfig,
  );
  assert.equal((await fetch(`${base}/api/health`).then((r) => r.json())).environment, 'local');
  assert.equal(await readFile(path.join(root, 'public/multiplayer-config.json'), 'utf8'), original);
  assert.equal(
    (await fetch(`${base}/multiplayer-config.json`, { method: 'HEAD' })).headers.get(
      'cache-control',
    ),
    'no-store',
  );
});

test('local verification persistence resumes only its own world and leaves the legacy save intact', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'cro-environment-save-'));
  await mkdir(path.join(root, '.cro-magnon-save'));
  const legacy = path.join(root, '.cro-magnon-save/world.json');
  await writeFile(legacy, 'legacy user save sentinel');
  const options = localVerificationSettings(root);
  const game = await createPersistentGameServer({ ...options, port: 0, saveIntervalMs: 100000 });
  const other = await createPersistentGameServer({
    port: 0,
    saveDirectory: path.join(root, '.cro-magnon-save/other'),
    saveIntervalMs: 100000,
  });
  t.after(async () => {
    await game.close();
    await other.close();
  });
  const { port } = await game.listen();
  const welcome = await new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?room=LOCAL_VERIFY&name=Tester&resume=1`);
    ws.on('error', reject);
    ws.on('message', (data) => {
      const m = JSON.parse(String(data));
      if (m.type === 'welcome') {
        ws.close();
        resolve(m);
      }
    });
  });
  game.rooms.get('LOCAL_VERIFY').players.get(welcome.id).inventory.wood = 17;
  await game.saveNow();
  assert.equal(other.rooms.has('LOCAL_VERIFY'), false);
  await game.close();
  const restored = await createPersistentGameServer({
    ...options,
    port: 0,
    saveIntervalMs: 100000,
  });
  t.after(() => restored.close());
  assert.equal(restored.core.exportState().rooms[0].sessions[0].player.inventory.wood, 17);
  assert.equal(await readFile(legacy, 'utf8'), 'legacy user save sentinel');
});

test('frozen exhibition releases reject modified files before startup', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'cro-environment-release-'));
  await writeFile(path.join(root, 'game.js'), 'original release');
  const files = [{ path: 'game.js', sha256: await sha256(path.join(root, 'game.js')) }];
  await writeFile(
    path.join(root, 'exhibition-build.json'),
    JSON.stringify({ files, buildId: buildId(files) }),
  );
  await verifyExhibition(root);
  await writeFile(path.join(root, 'game.js'), 'changed development build');
  await assert.rejects(verifyExhibition(root), /Build file changed/);
});
