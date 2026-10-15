// Verify an already assembled MMO package. No upload, live server or user save.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import http from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { MIME } from '../dist/infrastructure/node/static-files.mjs';
import { characterPortraitUrls } from '../dist/src/character-portraits.js';

const root = process.argv[2];
if (!root) throw new Error('Pass the isolated MMO build root.');
const build = JSON.parse(await readFile(`${root}/cloudflare-build.json`, 'utf8'));
const keys = ['cat-kunoichi', 'kunoichi-katana'];
const files = new Map(build.publicFiles.map((file) => [file.path, file]));
assert.ok(build.dormantCharacters.includes('cat'));
assert.ok(build.characters.every((model) => model.species !== 'cat'));
assert.ok(
  [...files.keys()].every((file) => !keys.some((key) => file.startsWith(`models/${key}/`))),
);
assert.ok(
  build.models.every((model) => !keys.some((key) => model.url.includes(`/models/${key}/`))),
);
const catalog = JSON.parse(
  await readFile(`${root}/dist-cloudflare/models/world-assets.json`, 'utf8'),
);
assert.ok(catalog.assets.every((asset) => !keys.includes(asset.modelKey)));
for (const file of ['shared/character-profiles.mjs', 'src/style.css', 'src/clothing-dye-rules.js'])
  assert.doesNotMatch(
    await readFile(`${root}/dist-cloudflare/${file}`, 'utf8'),
    /cat-kunoichi|クノイチ/,
  );
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const photos = build.characters.flatMap((model) => characterPortraitUrls(model.key));
for (const url of photos) {
  const file = files.get(url.slice(1));
  assert.ok(file, url);
  const bytes = await readFile(`${root}/dist-cloudflare${url}`);
  assert.equal(sha(bytes), file.sha256, url);
}

// The actual packaged Worker registry retains private appearances for restoration.
const worker = path.resolve(root, 'dist-cloudflare-worker');
const { createGameCore } = await import(
  pathToFileURL(path.join(worker, 'application/game-core.mjs'))
);
const { CHARACTER_ROSTER } = await import(
  pathToFileURL(path.join(worker, 'shared/character-roster.mjs'))
);
const entry = CHARACTER_ROSTER.find((record) => record.species === 'cat');
class Socket extends EventEmitter {
  readyState = 1;
  bufferedAmount = 0;
  messages = [];
  send(text) {
    this.messages.push(JSON.parse(text));
  }
  close() {
    this.readyState = 3;
    this.emit('close');
  }
}
const core = createGameCore({ persistentSessions: true, keepEmptyRooms: true });
let restored;
try {
  for (let i = 0; i < 5; i++)
    core.connect(
      new Socket(),
      new URLSearchParams({
        room: 'RETIRED',
        resume: '1',
        species: 'cat',
        character: 'cat-kunoichi',
        name: `QA-${i}`,
      }),
    );
  const room = core.rooms.get('RETIRED');
  assert.equal(room.players.size, 5);
  assert.ok(
    core
      .snapshot(room, true)
      .players.every((player) => player.species === 'cro' && !player.unavailableCharacter),
  );
  const checkpoint = core.exportState();
  assert.ok(
    checkpoint.rooms[0].sessions.every(
      (session) => session.player.unavailableCharacter.character === 'cat-kunoichi',
    ),
  );
  entry.enabled = true;
  restored = createGameCore({ persistentSessions: true, keepEmptyRooms: true });
  restored.importState(checkpoint);
  assert.ok(
    [...restored.rooms.get('RETIRED').sessions.values()].every(
      (session) =>
        session.player.character === 'cat-kunoichi' && !session.player.unavailableCharacter,
    ),
  );
} finally {
  entry.enabled = false;
  core.close();
  restored?.close();
}

// Serve only the exact public-file ledger. Test the packaged browser bundle on a phone.
const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost');
  const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  const file = files.get(name);
  if (!file) {
    response.writeHead(404).end();
    return;
  }
  try {
    const bytes = await readFile(`${root}/dist-cloudflare/${file.path}`);
    assert.equal(sha(bytes), file.sha256, file.path);
    response.writeHead(200, {
      'Content-Type': MIME[path.extname(file.path)] ?? 'application/octet-stream',
    });
    response.end(bytes);
  } catch (error) {
    response.writeHead(500).end(String(error));
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [],
  requests = [];
try {
  for (const key of keys) {
    const asset = JSON.parse(await readFile(`public/models/${key}/asset.json`, 'utf8'));
    for (const url of [
      `/models/${key}/asset.json`,
      `/models/${key}/portrait.png`,
      asset.url,
      ...(asset.lods ?? []).map((lod) => lod.url),
      ...characterPortraitUrls(key),
    ])
      assert.equal((await fetch(base + url)).status, 404, url);
  }
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  page.on('pageerror', (error) => errors.push(error.stack));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('request', (request) => {
    if (/\/models\/(cat-kunoichi|kunoichi-katana)\//.test(request.url()))
      requests.push(request.url());
  });
  await page.goto(base);
  await page.locator('#title-start').tap();
  await page.locator('#setup-form').waitFor({ state: 'visible' });
  assert.equal(
    await page.locator('#setup-form .character-choice').count(),
    build.characters.length,
  );
  assert.equal(await page.locator('#setup-form input[value="cat-female"]').count(), 0);
  for (const colour of ['red', 'blue', '']) {
    await page.locator(`#setup-form [data-dye="${colour}"]`).tap();
    const images = await page
      .locator('#setup-form [data-character-image]')
      .evaluateAll(async (images) => {
        await Promise.all(images.map((image) => image.decode()));
        return images.map((image) => ({
          src: image.getAttribute('src'),
          width: image.naturalWidth,
        }));
      });
    assert.ok(
      images.every(
        (image) => image.width === 336 && image.src.endsWith(`-${colour || 'original'}.webp`),
      ),
    );
  }
  await page.locator('#setup-form input[value="bear-female"]').tap();
  await page
    .locator('#setup-form input[value="bear-female"]')
    .evaluate((input) =>
      input.closest('label').scrollIntoView({ block: 'nearest', inline: 'start' }),
    );
  // Finish the touch highlight before taking the review picture.
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${root}/phone-size-ratios.png` });
  const grid = await page.locator('.character-choice-grid').boundingBox();
  assert.ok(grid.height <= 261);
  assert.deepEqual(requests, []);
  assert.deepEqual(errors, []);
  const result = {
    status: 'passed',
    buildId: build.buildId,
    characters: build.characters.map((model) => model.key),
    photos: photos.length,
    excludedModels: keys,
    worker:
      'Five connections reject the retired appearance; the private checkpoint restores after enabling the in-memory flag.',
    browser:
      'The packaged bundle opens 13 public choices, changes photographs with colours, fits a 390px phone and never requests the retired models.',
    grid,
    errors,
    requests,
  };
  await writeFile(`${root}/kunoichi-release-qa.json`, JSON.stringify(result, null, 2));
  console.log(
    JSON.stringify({
      status: result.status,
      buildId: result.buildId,
      characters: result.characters.length,
      photos: result.photos,
      errors: errors.length,
    }),
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
