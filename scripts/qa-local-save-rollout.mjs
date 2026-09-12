// Normal localhost UI; no position, inventory, calendar or server-state fixtures.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);
const base = 'http://localhost:3000',
  folder = path.resolve('output/playwright/local-save-20260909/normal');
await mkdir(folder, { recursive: true });
const errors = [],
  checks = [],
  delivery = [];
let context,
  id,
  state = {},
  welcome;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, label) {
  const start = Date.now();
  while (!(await fn())) {
    if (Date.now() - start > 20000) throw Error('Timeout ' + label);
    await sleep(100);
  }
}
async function launch() {
  context = await chromium.launchPersistentContext(path.join(folder, 'profile'), {
    channel: 'chrome',
    headless: true,
    viewport: { width: 1440, height: 900 },
    args: ['--use-angle=d3d11'],
  });
  const page = context.pages()[0];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('websocket', (s) =>
    s.on('framereceived', (e) => {
      try {
        const m = JSON.parse(String(e.payload));
        if (m.type === 'welcome') {
          id = m.id;
          welcome = m;
        }
        if (m.type === 'state') state = { ...state, ...m };
      } catch {}
    }),
  );
  await page.goto(base + '/?room=SAVE-LOCAL');
  assert.equal(await page.locator('#screen-title .menu-item').count(), 2);
  assert.equal(await page.locator('#screen-title a').count(), 0);
  return page;
}
async function ready(page) {
  await page
    .locator('#world[data-world-asset="ready"][data-character-asset="ready"]')
    .waitFor({ timeout: 90000 });
  await until(() => id && state.players?.some((p) => p.id === id), 'world');
  assert.deepEqual(errors, []);
}
try {
  let page = await launch();
  await page.locator('#title-start').click();
  await page.locator('#setup-form input[name="name"]').fill('保存の反映確認');
  await page.locator('#setup-submit').click();
  await page.waitForSelector('body.in-game', { timeout: 60000 });
  await ready(page);
  console.log('READY normal 3000');
  assert.equal(welcome.persistentSession, true);
  const before = state.players.find((p) => p.id === id);
  await page.locator('#world').focus();
  await page.keyboard.down('w');
  await sleep(650);
  await page.keyboard.up('w');
  await sleep(500);
  const moved = state.players.find((p) => p.id === id);
  assert.ok(Math.hypot(moved.x - before.x, moved.z - before.z) > 0.15);
  const originalId = id,
    inventory = structuredClone(moved.inventory),
    position = { x: moved.x, z: moved.z };
  await page.keyboard.press('Escape');
  await until(
    async () => /自動保存済み/.test(await page.locator('#local-save-status').innerText()),
    'save status',
  );
  for (const view of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(view);
    await page.locator('#local-save-status').scrollIntoViewIfNeeded();
    assert.ok(await page.locator('#local-save-status').isVisible());
    await page.screenshot({ path: path.join(folder, `menu-${view.width}.png`) });
  }
  const oldWelcome = welcome;
  await page.locator('[data-controller-menu="title"]').click();
  await page.locator('#title-start').click();
  await until(() => welcome !== oldWelcome && welcome.resumed, 'title resume');
  assert.equal(id, originalId);
  await context.close();
  context = null;
  await sleep(600);
  id = null;
  state = {};
  welcome = null;
  page = await launch();
  await page.locator('#title-start').click();
  await ready(page);
  assert.equal(welcome.resumed, true);
  assert.equal(id, originalId);
  const resumed = state.players.find((p) => p.id === id);
  assert.deepEqual(resumed.inventory, inventory);
  assert.deepEqual({ x: resumed.x, z: resumed.z }, position);
  await page.reload();
  await page.locator('#title-start').click();
  await ready(page);
  assert.equal(id, originalId);
  checks.push(
    'Ordinary title/setup, manual walking and stop, save status, title resume, real Chrome close/reopen, page reload, desktop/portrait/landscape; no supply, location or clock fixtures',
  );
  for (const file of ['main.js', 'session-storage.js']) {
    const local = await readFile('dist/src/' + file),
      remote = Buffer.from(await fetch(base + '/src/' + file).then((r) => r.arrayBuffer()));
    assert.deepEqual(remote, local);
    delivery.push({
      file: 'src/' + file,
      sha256: createHash('sha256').update(local).digest('hex'),
    });
  }
  const health = await fetch(base + '/api/health').then((r) => r.json());
  assert.equal(health.save.enabled, true);
  assert.equal(health.maxPlayers, 5);
  await context.close();
  context = null;
  await until(async () => {
    const saved = JSON.parse(await readFile('.cro-magnon-save/world.json', 'utf8')).state;
    const room = saved.rooms.find((r) => r.name === 'SAVE-LOCAL'),
      person = room?.sessions.find((s) => s.player.id === originalId);
    return (
      person?.expiresAt === Number.MAX_SAFE_INTEGER &&
      JSON.stringify(person.player.inventory) === JSON.stringify(inventory)
    );
  }, 'normal disk');
  checks.push(
    'Normal private disk checkpoint contains the same person and supplies with permanent resume; served modules match final build',
  );
  assert.deepEqual(errors, []);
  await writeFile(
    path.join(folder, 'summary.json'),
    JSON.stringify(
      {
        at: new Date().toISOString(),
        checks,
        errors,
        delivery,
        health,
        fixtures: [],
        room: 'SAVE-LOCAL',
        publicDeployment: false,
        exhibitionUpdated: false,
      },
      null,
      2,
    ),
  );
  console.log('PASS normal autosave and browser resume');
} finally {
  await context?.close();
}
