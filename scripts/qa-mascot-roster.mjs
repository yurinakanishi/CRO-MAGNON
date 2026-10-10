// Real Chrome and four websocket peers, in a separate memory-only world.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import WebSocket from 'ws';
import { createGameServer } from '../dist/server.mjs';
import { localVerificationSettings } from '../dist/infrastructure/node/local-verification.mjs';
import { MASCOT_ROSTER, ACTIVE_MASCOT_MODELS } from '../dist/shared/mascot-roster.mjs';
import { BOT_KINDS } from '../dist/shared/orb-bots.mjs';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);
const out = process.argv[2] || `output/playwright/mascot-roster-${Date.now()}`;
const withHowkey = process.argv.includes('--howkey');
const cards = withHowkey ? 12 : 11;
await mkdir(out, { recursive: true });
const game = createGameServer({
  ...localVerificationSettings(out),
  port: 0,
  mascotModels: withHowkey ? [...ACTIVE_MASCOT_MODELS, 'howkey-scientist'] : ACTIVE_MASCOT_MODELS,
});
const { port } = await game.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [],
  requests = [],
  peers = [],
  checks = [];
let result;
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});
page.on('request', (request) => requests.push(new URL(request.url()).pathname));
const room = () => game.rooms.get('ROSTERQA');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, label, timeout = 180000) {
  const end = Date.now() + timeout;
  while (!(await check())) {
    if (Date.now() > end) throw new Error(label);
    await sleep(100);
  }
}
const pass = (label) => {
  checks.push(label);
  console.log('PASS', label);
};
try {
  if (withHowkey) {
    // Enable only the retained Howkey in this isolated QA browser, leaving the
    // production roster and all source model bytes unchanged.
    await page.route('**/shared/mascot-roster.mjs', async (route) => {
      const response = await route.fetch();
      const source = await response.text();
      const enabled = source.replace(
        /(modelKey:\s*'howkey-scientist',\s*credit:\s*'hawkie',\s*enabled:\s*)false/,
        '$1true',
      );
      assert.notEqual(source, enabled);
      await route.fulfill({ response, body: enabled });
    });
  }
  await page.goto(`http://127.0.0.1:${port}/?room=ROSTERQA`);
  await page.locator('#title-contributors').click();
  const guests = page
    .locator('.contributor-group')
    .filter({ has: page.locator('h3', { hasText: '友情出演' }) });
  assert.equal(await guests.locator('.contributor-avatar').count(), withHowkey ? 3 : 2);
  assert.deepEqual(
    await guests.locator('a').evaluateAll((links) => links.map((link) => link.href)),
    [
      'https://x.com/R5ni4',
      'https://x.com/vibe_walking',
      ...(withHowkey ? ['https://x.com/hawkymisc'] : []),
    ],
  );
  await page.screenshot({ path: `${out}/credits-desktop.png` });
  pass(
    withHowkey
      ? 'guest icons and X links restore Howkey alongside 524 and rimo'
      : 'guest icons and X links show only 524 and rimo',
  );
  await page.locator('#modal-close').click();
  await page.locator('#title-start').click();
  assert.equal(await page.locator('input[value="howkey-female"]').count(), 0);
  await page.locator('.character-choice:first-child').click();
  await page.locator('#setup-flow-yes').click();
  await page.locator('[data-cave-proceed]:enabled').waitFor({ timeout: 240000 });
  await page.screenshot({ path: `${out}/loading-cave.png` });
  await page.locator('[data-cave-proceed]').click();
  await page.locator('#world[data-companion-assets="ready"]').waitFor({ timeout: 180000 });
  await until(() => room()?.players.size === 1, 'browser joins');
  const playerId = [...room().players.keys()][0];
  for (let i = 0; i < 4; i++) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?room=ROSTERQA&name=Roster-peer-${i}`);
    const messages = [];
    ws.on('message', (bytes) => messages.push(JSON.parse(String(bytes))));
    peers.push({ ws, messages });
  }
  await until(
    () => peers.every((p) => p.messages.some((m) => m.type === 'state' && m.players.length === 5)),
    'all five clients see each other',
  );
  assert.equal(room().mae, undefined);
  assert.equal(room().kohaku, undefined);
  assert.equal(room().maruimo, undefined);
  assert.deepEqual(
    room().friends.map((f) => f.key),
    withHowkey ? ['howkey-scientist'] : [],
  );
  await page.keyboard.press('Escape');
  await page.locator('[data-pause-tab="mascots"]').click();
  assert.deepEqual(
    new Set(
      await page
        .locator('[data-mascot]')
        .evaluateAll((cards) => cards.map((card) => card.dataset.mascot)),
    ),
    new Set([...BOT_KINDS, 'rimo-neko', '524', ...(withHowkey ? ['howkey-scientist'] : [])]),
  );
  await until(
    () =>
      page
        .locator('[data-mascot] img')
        .evaluateAll((images) => images.every((image) => image.complete && image.naturalWidth > 0)),
    'all eleven portraits load',
  );
  await page.locator('[data-mascot-all="select"]').click();
  await until(
    () => room().orbBots.filter((bot) => bot.ownerId === playerId).length === 11,
    'select eleven mascots',
  );
  if (withHowkey)
    await until(
      () => room().friends[0].followPlayerId === playerId,
      'Howkey joins the selected companions',
    );
  await until(
    () =>
      page
        .locator('#mascot-selection-count')
        .textContent()
        .then((text) => text.includes(`${cards} / ${cards}`)),
    'eleven cards reflect server selection',
  );
  for (const [width, height, label] of [
    [1440, 900, 'desktop'],
    [390, 844, 'portrait'],
    [844, 390, 'landscape'],
  ]) {
    await page.setViewportSize({ width, height });
    assert.equal(await page.locator('[data-mascot]').count(), cards);
    await page.screenshot({ path: `${out}/mascots-${label}.png` });
  }
  pass(`five clients and ${cards} selection cards, including three viewport sizes`);
  await page.locator('[data-mascot-all="clear"]').click();
  await until(() => room().orbBots.every((bot) => bot.ownerId !== playerId), 'all eleven released');
  for (const peer of peers)
    for (const state of peer.messages.filter((m) => m.type === 'state')) {
      for (const field of ['mae', 'kohaku', 'maruimo'])
        assert.equal(state[field], undefined, field);
      assert.deepEqual(
        state.friends.map((f) => f.key),
        withHowkey ? ['howkey-scientist'] : [],
      );
    }
  for (const entry of MASCOT_ROSTER.filter(
    (entry) => !entry.enabled && !(withHowkey && entry.modelKey === 'howkey-scientist'),
  ))
    assert.ok(
      !requests.some((url) => url.startsWith(`/models/${entry.modelKey}/`)),
      entry.modelKey,
    );
  for (const fragment of [
    'maruimo-lascaux',
    'mae-kohaku-lascaux',
    'friends-meadow-lascaux',
    'friends-river-lascaux',
  ])
    assert.ok(
      requests.some((url) => url.includes(fragment)),
      fragment,
    );
  if (withHowkey) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.keyboard.press('Escape');
    const howkey = room().friends[0];
    const player = room().players.get(playerId);
    // Preparation only: place the player at the retained mascot's home. The
    // actual V input below must start and complete the server's pet interaction.
    Object.assign(player, { x: howkey.x, z: howkey.z - 1, facing: 0 });
    await until(
      () =>
        page
          .locator('[data-cue="pet"]')
          .textContent()
          .then((text) => text?.includes('Howkey')),
      'Howkey pet cue',
      15000,
    );
    await page.keyboard.press('v');
    await until(() => howkey.petPlayerId === playerId, 'Howkey pet starts', 10000);
    await until(() => howkey.petContactAt > 0, 'Howkey hand contact', 10000);
    await page.screenshot({ path: `${out}/howkey-pet.png` });
    await until(
      () => !howkey.petPlayerId && howkey.followPlayerId === playerId,
      'Howkey pet completes',
      15000,
    );
    assert.ok(requests.includes('/models/howkey-scientist/model-c2.glb'));
    assert.ok(requests.includes('/models/howkey-flask/model-r01.glb'));
    pass('retained Howkey rig and flask load; real V pet contact completes and bonds the mascot');
  }
  assert.deepEqual(errors, []);
  pass('no dormant mascot downloads; their four mural textures still load; browser errors zero');
  result = {
    passed: true,
    checks,
    players: 5,
    cards,
    withHowkey,
    errors,
    requestedModels: [...new Set(requests.filter((url) => url.endsWith('.glb')))],
    requestedMurals: [...new Set(requests.filter((url) => url.includes('lascaux')))],
  };
} catch (error) {
  result = { passed: false, checks, errors, error: String(error), stack: error.stack };
  await page.screenshot({ path: `${out}/failure.png` }).catch(() => {});
  throw error;
} finally {
  for (const { ws } of peers) ws.terminate();
  await writeFile(`${out}/result.json`, JSON.stringify(result, null, 2));
  await browser.close();
  await game.close();
}
