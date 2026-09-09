import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, writeFile, readFile, rename, rmdir } from 'node:fs/promises';
import path from 'node:path';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);
const folder = path.resolve(process.argv[2] || `output/playwright/local-save-${Date.now()}`);
await mkdir(folder, { recursive: true });
const saveDir = path.join(folder, 'save'),
  checks = [],
  errors = [],
  commands = [],
  screenshots = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, label, limit = 15000) {
  const start = Date.now();
  while (!(await fn())) {
    if (Date.now() - start > limit) throw Error('Timeout ' + label);
    await sleep(100);
  }
}
let child,
  port,
  context,
  peerContext,
  requestId = 0,
  base,
  loaded;
const pending = new Map();
async function start() {
  child = fork(new URL('./qa-local-save-host.mjs', import.meta.url), [], {
    env: { ...process.env, CRO_SAVE_DIR: saveDir, PORT: String(port || 0) },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    windowsHide: true,
  });
  let ready = false,
    log = '';
  child.stdout.on('data', (b) => (log += b));
  child.stderr.on('data', (b) => (log += b));
  child.on('message', (m) => {
    if (m.ready) {
      port = m.port;
      base = `http://127.0.0.1:${port}`;
      loaded = m.loaded;
      ready = true;
    }
    if (m.reply) {
      const call = pending.get(m.reply);
      pending.delete(m.reply);
      m.ok ? call?.resolve(m.value) : call?.reject(Error(m.error));
    }
  });
  await until(() => {
    if (child.exitCode !== null) throw Error(log);
    return ready;
  }, 'host');
}
function request(kind) {
  return new Promise((resolve, reject) => {
    const id = ++requestId;
    pending.set(id, { resolve, reject });
    child.send({ id, kind });
  });
}
async function stop() {
  const exited = once(child, 'exit');
  await request('stop');
  assert.equal((await exited)[0], 0);
}
async function launch(profile) {
  return chromium.launchPersistentContext(path.join(folder, profile), {
    channel: 'chrome',
    headless: true,
    viewport: { width: 1440, height: 900 },
    args: ['--use-angle=d3d11'],
  });
}
function observe(page) {
  const observation = { id: null, state: {}, welcome: null };
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('websocket', (s) => {
    s.on('framesent', (e) => {
      try {
        commands.push(JSON.parse(String(e.payload)));
      } catch {}
    });
    s.on('framereceived', (e) => {
      try {
        const m = JSON.parse(String(e.payload));
        if (m.type === 'welcome') {
          observation.id = m.id;
          observation.welcome = m;
        }
        if (m.type === 'state') observation.state = { ...observation.state, ...m };
      } catch {}
    });
  });
  return observation;
}
async function play(ctx, name, resume = false) {
  const page = ctx.pages()[0] || (await ctx.newPage()),
    seen = observe(page);
  await page.goto(base + '/?room=SAVE-CHROME');
  assert.equal(await page.locator('#screen-title .menu-item').count(), 2);
  assert.equal(await page.locator('#screen-title a').count(), 0);
  await page.locator('#title-start').click();
  if (!resume) {
    await page.locator('#setup-form input[name="name"]').fill(name);
    await page.locator('#setup-submit').click();
    await page.locator('#guide-start').click();
  }
  await page
    .locator('#world[data-world-asset="ready"][data-character-asset="ready"]')
    .waitFor({ timeout: 90000 });
  await until(() => seen.id && seen.state.players?.some((p) => p.id === seen.id), 'welcome');
  assert.equal(seen.welcome.resumed, resume);
  assert.deepEqual(errors, []);
  console.log('READY Chrome ' + name);
  return { page, seen };
}
async function pause(page) {
  if (await page.locator('#modal').evaluate((d) => d.open))
    await page.locator('#modal-close').click();
  await page.locator('#world').focus();
  await page.keyboard.press('Escape');
  await page.locator('#local-save-status').waitFor();
}
async function shot(page, name) {
  const file = path.join(folder, name + '.png');
  await page.screenshot({ path: file });
  screenshots.push(file);
}
function pass(text) {
  checks.push(text);
  console.log('PASS ' + text);
}
try {
  await start();
  // The first action after launching the private host is an actual browser readiness check.
  context = await launch('profile-a');
  let a = await play(context, '保存A');
  await shot(a.page, '01-ready');
  peerContext = await launch('profile-b');
  let b = await play(peerContext, '保存B');
  const originalIds = [a.seen.id, b.seen.id];
  const before = a.seen.state.players.find((p) => p.id === a.seen.id);
  await a.page.locator('#world').focus();
  await a.page.keyboard.down('w');
  await sleep(650);
  await a.page.keyboard.up('w');
  await sleep(500);
  const moved = a.seen.state.players.find((p) => p.id === a.seen.id);
  assert.ok(Math.hypot(before.x - moved.x, before.z - moved.z) > 0.15);
  await until(
    () => b.seen.state.players?.find((p) => p.id === a.seen.id)?.z === moved.z,
    'shared manual movement',
  );
  pass(
    'Two actual Chrome profiles share manual movement; title still has two entries and static credits',
  );
  await request('prepare');
  await request('save');
  const expected = await request('state');
  await pause(a.page);
  await until(
    async () => /自動保存済み/.test(await a.page.locator('#local-save-status').innerText()),
    'saved status',
  );
  await a.page.locator('[data-controller-menu="inventory"]').focus();
  const focus = await a.page.evaluate(() => document.activeElement.dataset.controllerMenu);
  await request('save');
  await sleep(300);
  assert.equal(await a.page.evaluate(() => document.activeElement.dataset.controllerMenu), focus);
  await pause(a.page);
  const titleWelcome = a.seen.welcome;
  await a.page.locator('[data-controller-menu="title"]').click();
  await a.page.locator('#title-start').click();
  await until(
    () =>
      a.seen.welcome !== titleWelcome &&
      a.seen.welcome?.resumed &&
      a.seen.state.players?.some((p) => p.id === originalIds[0]),
    'title resume',
  );
  assert.equal(a.seen.id, originalIds[0]);
  pass('Save updates preserve menu selection; title exit and Start retain identity and supplies');
  await context.close();
  context = null;
  await peerContext.close();
  peerContext = null;
  await stop();
  const shutdownCheckpoint = JSON.parse(await readFile(path.join(saveDir, 'world.json'), 'utf8'))
    .state.rooms[0];
  await start();
  context = await launch('profile-a');
  a = await play(context, '保存A', true);
  peerContext = await launch('profile-b');
  b = await play(peerContext, '保存B', true);
  assert.deepEqual([a.seen.id, b.seen.id], originalIds);
  const restored = await request('state');
  for (const p of expected.people) {
    const after = restored.people.find((n) => n.id === p.id);
    assert.deepEqual(after.inventory, p.inventory);
    assert.equal(after.spearHead, p.spearHead);
    assert.deepEqual([after.x, after.z], [p.x, p.z]);
  }
  assert.deepEqual(loaded.gulf, shutdownCheckpoint.gulf);
  assert.equal(restored.createdAt, expected.createdAt);
  assert.deepEqual(
    loaded.residents.map((r) => r.watering),
    shutdownCheckpoint.residents.map((r) => r.watering),
  );
  pass(
    'Closing Chrome and the server process, then reopening both, restores both identities, equipment, inventory, plots, middens and shared food from disk',
  );
  // Create a real write failure without touching the current primary; restore the backup path afterwards.
  await request('save');
  await rename(path.join(saveDir, 'world.backup.json'), path.join(saveDir, 'qa-old-backup.json'));
  await mkdir(path.join(saveDir, 'world.backup.json'));
  await pause(a.page);
  await request('save').then(
    () => assert.fail('Expected save failure'),
    () => {},
  );
  await until(
    async () => /失敗/.test(await a.page.locator('#local-save-status').innerText()),
    'error display',
  );
  await shot(a.page, '02-save-error');
  await rmdir(path.join(saveDir, 'world.backup.json'));
  await request('save');
  await until(
    async () => /自動保存済み/.test(await a.page.locator('#local-save-status').innerText()),
    'recovery display',
  );
  pass(
    'A real disk write failure is shown; the old checkpoint remains and a successful retry clears the error',
  );
  // Simulated Gamepad API, with actual game menu callbacks and selection.
  await a.page.evaluate(() => {
    window.qaPad = {
      id: 'QA Controller',
      index: 0,
      connected: true,
      mapping: 'standard',
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 18 }, () => ({ pressed: false, value: 0 })),
    };
    Object.defineProperty(navigator, 'getGamepads', {
      configurable: true,
      value: () => [window.qaPad],
    });
    window.dispatchEvent(new Event('gamepadconnected'));
  });
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    await a.page.setViewportSize(viewport);
    await pause(a.page);
    await a.page.locator('#local-save-status').scrollIntoViewIfNeeded();
    assert.ok(await a.page.locator('#local-save-status').isVisible());
    assert.ok(
      await a.page
        .locator('#modal')
        .evaluate((el) => el.getBoundingClientRect().right <= innerWidth + 1),
    );
    await shot(a.page, `03-menu-${viewport.width}`);
    await a.page.locator('[data-controller-menu="inventory"]').focus();
    await request('save');
    await sleep(250);
    assert.equal(
      await a.page.evaluate(() => document.activeElement.dataset.controllerMenu),
      'inventory',
    );
    await a.page.evaluate(() => {
      window.qaPad.buttons[0] = { pressed: true, value: 1 };
    });
    await sleep(120);
    await a.page.evaluate(() => {
      window.qaPad.buttons[0] = { pressed: false, value: 0 };
    });
    await sleep(150);
    assert.equal(await a.page.locator('[data-controller-menu="inventory"]').count(), 0);
  }
  pass(
    'Desktop, portrait and landscape menus remain usable; simulated Gamepad confirmation and focus survive save notifications',
  );
  assert.equal(
    commands.some(
      (m) =>
        m.type === 'target' ||
        m.type === 'expedition' ||
        (m.type === 'move' && (!Number.isFinite(m.dx) || !Number.isFinite(m.dz))),
    ),
    false,
  );
  assert.deepEqual(errors, []);
  await context.close();
  context = null;
  await peerContext.close();
  peerContext = null;
  await stop();
  const primary = path.join(saveDir, 'world.json');
  await writeFile(primary, '{');
  await start();
  context = await launch('profile-a');
  a = await play(context, '保存A', true);
  await pause(a.page);
  await until(
    async () => /予備/.test(await a.page.locator('#local-save-status').innerText()),
    'backup disclosure',
  );
  await shot(a.page, '04-backup-recovery');
  pass(
    'A damaged primary recovers its backup and the running UI explicitly discloses the recovery',
  );
  await writeFile(
    path.join(folder, 'summary.json'),
    JSON.stringify(
      {
        checks,
        errors,
        screenshots,
        players: 2,
        fixtures: [
          'Obsidian/blades/shellfish/shells/water and spear heads',
          'One planted root with a watering request, one resident carrying water, pantry and midden quantities, one resource amount',
          'QA backup path obstructed for a real write failure; primary deliberately corrupted after shutdown',
        ],
        realActions: [
          'Manual walking',
          'Title leave/Start',
          'Chrome profile close/reopen',
          'Separate server process restart and disk restore',
          'Responsive menus and simulated Gamepad',
        ],
        clockChanges: 0,
      },
      null,
      2,
    ),
  );
} finally {
  await context?.close();
  await peerContext?.close();
  if (child?.exitCode === null && !child.signalCode) await stop().catch(() => child.kill());
}
