// Two real Chrome contexts, two loopback asset origins, one authoritative server.
// External browser requests are blocked. This is not a physical two-PC acceptance test.
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const root = path.resolve(process.argv[2] || '.');
const folder = path.resolve(process.argv[3] || 'output/playwright/exhibition-lan/r01');
await mkdir(folder, { recursive: true });
const { createGameServer } = await import(pathToFileURL(path.join(root, 'dist/server.mjs')));
const { createExhibitionClient } = await import(
  pathToFileURL(path.join(root, 'dist/infrastructure/node/exhibition-client.mjs'))
);
const { stopActor } = await import(pathToFileURL(path.join(root, 'dist/shared/combat.mjs')));
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);
const buildId = 'browser-lan-qa';
const game = createGameServer({
  port: 0,
  host: '0.0.0.0',
  serveAssets: false,
  expectedBuild: buildId,
  wsPaths: ['/'],
});
const address = await game.listen(),
  serverUrl = `ws://${process.env.EXHIBITION_QA_SERVER_IP || '127.0.0.1'}:${address.port}`;
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--use-angle=d3d11'],
});
const clients = [],
  pages = [],
  errors = [],
  external = [],
  requests = [],
  completed = [],
  fixtures = [],
  evidence = {};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const room = () => game.rooms.get('EXHIBITION');
const actor = (index) => [...room().players.values()].find((p) => p.name === `プレイヤー${index + 1}`);
async function until(fn, label, limit = 12000) {
  const deadline = Date.now() + limit;
  while (!(await fn())) {
    if (Date.now() > deadline) throw new Error('Timeout: ' + label);
    await sleep(40);
  }
}
async function capture(page, name) {
  await page.screenshot({ path: path.join(folder, `${name}.png`) });
  await writeFile(path.join(folder, `${name}.txt`), await page.locator('body').ariaSnapshot());
}
async function attachObservation(page) {
  await page.evaluate(async () => {
    const { WorldRenderer } = await import('/src/world3d.js');
    const render = WorldRenderer.prototype.render;
    WorldRenderer.prototype.render = function (...args) {
      render.apply(this, args);
      window.qaVisual = [...this.players.values()].map((e) => ({
        id: e.state.id,
        x: e.model.position.x,
        z: e.model.position.z,
        facing: e.model.rotation.y,
        animation: e.actor?.animation.name,
        visible: e.model.visible,
        self: e.state.id === this.selfId,
      }));
    };
  });
}
try {
  for (let index = 0; index < 2; index++) {
    const client = createExhibitionClient({
      root,
      port: 0,
      config: {
        mode: 'lan',
        serverUrl,
        buildId,
        room: 'EXHIBITION',
        guestName: `プレイヤー${index + 1}`,
      },
    });
    clients.push(client);
    const { port } = await client.listen();
    const base = `http://localhost:${port}`;
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.route('**/*', (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== base) {
        external.push(url.href);
        return route.abort();
      }
      requests.push({ index, url: url.href, type: route.request().resourceType() });
      return route.continue();
    });
    await context.addInitScript(
      ({ index }) => {
        localStorage.setItem('cro-species', 'cro');
        localStorage.setItem('cro-gender', index ? 'male' : 'female');
        localStorage.setItem('cro-skip-guide', '1');
        window.qaNetwork = { states: [], sends: [], welcomes: [], delay: 0, sockets: [], urls: [] };
        const NativeWebSocket = window.WebSocket;
        window.WebSocket = class extends NativeWebSocket {
          constructor(url, protocols) {
            super(url, protocols);
            window.qaNetwork.urls.push(url);
            window.qaNetwork.sockets.push(this);
            this.addEventListener('message', (e) => {
              const m = JSON.parse(e.data);
              if (m.type === 'welcome') window.qaNetwork.welcomes.push(m);
              if (m.type === 'state') {
                window.qaNetwork.states.push(m);
                if (window.qaNetwork.states.length > 250) window.qaNetwork.states.shift();
              }
            });
          }
          send(data) {
            window.qaNetwork.sends.push({ at: performance.now(), data: JSON.parse(data) });
            const delay = window.qaNetwork.delay;
            if (delay)
              setTimeout(() => {
                if (this.readyState === 1) super.send(data);
              }, delay);
            else super.send(data);
          }
        };
      },
      { index },
    );
    const page = await context.newPage();
    pages.push(page);
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await writeFile(
      path.join(folder, `title-${index}.txt`),
      await page.locator('body').ariaSnapshot(),
    );
    await page.getByRole('button', { name: 'はじめる', exact: true }).click();
    await writeFile(
      path.join(folder, `setup-${index}.txt`),
      await page.locator('body').ariaSnapshot(),
    );
    await page.getByRole('button', { name: 'この谷へ出発する', exact: false }).click();
    await page
      .locator('#connection-label')
      .filter({ hasText: 'LAN: Connected' })
      .waitFor({ timeout: 20000 });
    await page
      .locator('#world[data-world-asset="ready"][data-character-asset="ready"]')
      .waitFor({ timeout: 90000 });
    await attachObservation(page);
    console.log(`Loaded Player ${index + 1}: ${base} -> ${serverUrl}`);
  }
  await until(() => room().players.size === 2, 'two players');
  await until(() => pages[0].evaluate(() => window.qaVisual?.length === 2), 'both rendered');
  completed.push('fresh profiles use normal title/setup; two guests share one LAN world');
  for (let index = 0; index < 2; index++) {
    const page = pages[index],
      observer = pages[1 - index],
      p = actor(index);
    await page.bringToFront();
    await page.getByRole('button', { name: '走行モード', exact: true }).click();
    await page.locator('#world').focus();
    const before = { x: p.x, z: p.z };
    await page.keyboard.down(index ? 'a' : 'd');
    await sleep(1400);
    await page.keyboard.up(index ? 'a' : 'd');
    await sleep(250);
    assert.ok(Math.hypot(p.x - before.x, p.z - before.z) > 0.5, `P${index + 1} moved`);
    const seen = await observer.evaluate(
      (id) =>
        window.qaNetwork.states.some((s) =>
          s.players.some((p) => p.id === id && p.moving && p.running),
        ),
      p.id,
    );
    assert.ok(seen, 'other screen saw run');
    await page.keyboard.press('f');
    await until(
      () =>
        observer.evaluate(
          (id) =>
            window.qaNetwork.states.some((s) =>
              s.players.some((p) => p.id === id && p.attackSequence > 0),
            ),
          p.id,
        ),
      'shared attack',
    );
    await sleep(250);
    await capture(observer, `0${index + 1}-observed-player-${index + 1}`);
  }
  completed.push('bidirectional keyboard movement/rotation/run/attack reflected in other browser');
  // Hold outgoing input for 180ms and observe the model before server movement.
  const a = pages[0],
    p = actor(0);
  await a.bringToFront();
  await a.locator('#world').focus();
  await sleep(1000);
  await a.evaluate(() => {
    window.qaNetwork.delay = 180;
  });
  const serverBefore = { x: p.x, z: p.z };
  const visualBefore = await a.evaluate(() => window.qaVisual.find((p) => p.self));
  await a.keyboard.down('w');
  await sleep(95);
  const early = await a.evaluate(() => window.qaVisual.find((p) => p.self));
  assert.ok(
    Math.hypot(early.x - visualBefore.x, early.z - visualBefore.z) > 0.005,
    'local visual moved before server',
  );
  assert.ok(
    Math.hypot(p.x - serverBefore.x, p.z - serverBefore.z) < 0.001,
    'server has not received delayed input',
  );
  evidence.prediction = {
    outgoingDelayMs: 180,
    observedAfterMs: 95,
    visualBefore,
    early,
    serverBefore,
    serverEarly: { x: p.x, z: p.z },
  };
  await a.keyboard.up('w');
  await sleep(400);
  await a.evaluate(() => {
    window.qaNetwork.delay = 0;
  });
  await sleep(400);
  completed.push('180ms delayed input: local GPU model moves before authoritative response');
  // Explicit position fixture isolates shared gathering from long-distance travel.
  stopActor(p);
  const resource = room().resources.find((r) => r.type === 'berry' && r.amount > 0);
  Object.assign(p, room().collision.nearestFree(resource, p.radius, [], 3));
  fixtures.push({
    kind: 'position',
    player: p.id,
    x: p.x,
    z: p.z,
    purpose: 'near berry for normal E interaction',
  });
  await sleep(700);
  await a.locator('#world').focus();
  const amount = resource.amount;
  await a.keyboard.press('e');
  await until(() => resource.amount < amount, 'normal gather');
  await until(
    () =>
      pages[1].evaluate(
        ({ id, amount }) =>
          window.qaNetwork.states.some((s) =>
            s.resources?.some((r) => r.id === id && r.amount < amount),
          ),
        { id: resource.id, amount },
      ),
    'shared resource',
  );
  completed.push('normal E gather changes inventory and shared resource on other screen');
  const enemy = room().enemies.find((e) => e.hostile && e.phase === 'alive');
  stopActor(p);
  Object.assign(p, room().collision.nearestFree({ x: enemy.x - 2, z: enemy.z }, p.radius, [], 3));
  p.facing = Math.atan2(enemy.x - p.x, enemy.z - p.z);
  fixtures.push({
    kind: 'position',
    player: p.id,
    x: p.x,
    z: p.z,
    purpose: 'near enemy for normal F attack; damage is authoritative',
  });
  await sleep(700);
  await a.locator('#world').focus();
  const health = enemy.health;
  await a.keyboard.press('f');
  await until(() => enemy.health < health, 'combat damages enemy');
  await until(
    () =>
      pages[1].evaluate(
        ({ id, health }) =>
          window.qaNetwork.states.some((s) =>
            s.enemies?.some((e) => e.id === id && e.health < health),
          ),
        { id: enemy.id, health },
      ),
    'other screen sees enemy health',
  );
  completed.push(
    'normal F attack damages enemy and both screens receive authoritative enemy combat state',
  );
  const held = p.inventory.berry;
  await a.reload({ waitUntil: 'domcontentloaded' });
  await writeFile(path.join(folder, 'resume-title.txt'), await a.locator('body').ariaSnapshot());
  await a.getByRole('button', { name: 'つづきから', exact: false }).click();
  await a.locator('#connection-label').filter({ hasText: 'LAN: Connected' }).waitFor();
  await until(() => actor(0).inventory.berry === held, 'reload preserves inventory');
  assert.equal((await a.evaluate(() => window.qaNetwork.welcomes.at(-1))).resumed, true);
  await attachObservation(a);
  completed.push('reload resumes same session and inventory');
  // Drop a real socket, wait for the existing automatic reconnect.
  await a.evaluate(() => window.qaNetwork.sockets.at(-1).close());
  await a.locator('#connection-label').filter({ hasText: '再接続中' }).waitFor();
  await a
    .locator('#connection-label')
    .filter({ hasText: 'LAN: Connected' })
    .waitFor({ timeout: 15000 });
  assert.equal(actor(0).inventory.berry, held);
  completed.push('connection loss/reconnect retains inventory and configured LAN endpoint');
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    await a.setViewportSize(viewport);
    await sleep(500);
    assert.equal(await a.locator('#connection-label').textContent(), 'LAN: Connected');
    assert.ok(await a.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await capture(a, `${viewport.width}x${viewport.height}`);
  }
  completed.push('390x844 / 844x390 LAN status and no horizontal overflow');
  const network = await Promise.all(
    pages.map((page) =>
      page.evaluate(() => ({
        urls: window.qaNetwork.urls,
        latest: window.qaNetwork.states.at(-1),
        gpu: document.querySelector('#world').dataset.renderer,
        fps: document.querySelector('#world').dataset.fps,
      })),
    ),
  );
  for (const record of network) {
    assert.ok(record.urls.every((url) => new URL(url).origin === serverUrl));
    assert.ok(record.latest.enemies.length > 0 && record.latest.animals.length > 0);
    assert.ok(record.latest.players.length === 2);
  }
  assert.deepEqual(external, []);
  assert.deepEqual(errors, []);
  assert.ok(requests.filter((r) => r.url.endsWith('.glb') && r.index === 0).length > 0);
  assert.ok(requests.filter((r) => r.url.endsWith('.glb') && r.index === 1).length > 0);
  completed.push(
    'all HTTP requests originate from that PC loopback server; zero external requests; both render WebGL locally',
  );
  evidence.network = network.map(({ latest, ...rest }) => ({
    ...rest,
    urls: rest.urls.map((url) => {
      const u = new URL(url);
      return u.origin + u.pathname;
    }),
    players: latest.players.length,
    enemies: latest.enemies.length,
    animals: latest.animals.length,
  }));
  // The same packaged browser code also keeps the existing Online defaults.
  for (const page of pages) await page.close();
  const online = createGameServer({ port: 0, host: '127.0.0.1' });
  await online.listen();
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage(),
      urls = [];
    page.on('websocket', (socket) => urls.push(socket.url()));
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    const origin = `http://localhost:${online.address().port}`;
    await page.goto(origin + '/?autostart=1&room=ONLINE-QA', { waitUntil: 'domcontentloaded' });
    await page.locator('#connection-label').filter({ hasText: 'オンライン' }).waitFor();
    await page
      .locator('#world[data-world-asset="ready"][data-character-asset="ready"]')
      .waitFor({ timeout: 90000 });
    assert.equal(new URL(urls[0]).pathname, '/ws');
    assert.equal(new URL(urls[0]).host, new URL(origin).host);
    await capture(page, 'online-regression');
    await context.close();
    assert.deepEqual(errors, []);
    completed.push('same build Online mode keeps same-origin /ws and renders normally');
  } finally {
    await online.close();
  }
} catch (error) {
  evidence.failure = String(error);
  for (let i = 0; i < pages.length; i++) await capture(pages[i], `failure-${i}`).catch(() => {});
  process.exitCode = 1;
  console.error(error);
} finally {
  await writeFile(
    path.join(folder, 'report.json'),
    JSON.stringify(
      {
        at: new Date().toISOString(),
        root,
        completed,
        errors,
        external,
        requestCount: requests.length,
        fixtures,
        evidence,
        physicalTwoPC: false,
        physicalWifiOff: false,
      },
      null,
      2,
    ),
  );
  await writeFile(path.join(folder, 'requests.json'), JSON.stringify(requests, null, 2));
  await browser.close();
  for (const client of clients) await client.close();
  await game.close();
  console.log(JSON.stringify({ completed, errorCount: errors.length, external, folder }));
}
