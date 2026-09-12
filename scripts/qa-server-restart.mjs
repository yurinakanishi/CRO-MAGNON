// Real Chrome against a game server that is killed mid-session and started again a few
// seconds later (a crash, or the development watcher restarting after a rebuild). The
// client must stay in the game with "再接続中…" and rejoin by itself, never falling back
// to the setup screen.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const { chromium } =
  await import('file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const output = path.join(root, 'output/playwright/server-restart');
await mkdir(output, { recursive: true });
const port = Number(process.argv[2] || 3081),
  downMs = Number(process.argv[3] || 10000);
const base = `http://127.0.0.1:${port}`;
const started = Date.now();
const log = (...args) => console.log(`[${((Date.now() - started) / 1000).toFixed(1)}s]`, ...args);
async function startServer() {
  const child = spawn(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import { createGameCore } from ${JSON.stringify(pathToFileURL(path.join(root, 'dist/application/game-core.mjs')).href)};
import { createGameServer } from ${JSON.stringify(pathToFileURL(path.join(root, 'dist/server.mjs')).href)};
const game = createGameServer({ core: createGameCore({ keepEmptyRooms: true }), host: '127.0.0.1', port: ${port} });
await game.listen();
console.log('listening');`,
    ],
    { cwd: root, stdio: ['ignore', 'pipe', 'inherit'], windowsHide: true },
  );
  await new Promise((resolve, reject) => {
    child.stdout.on('data', (data) => String(data).includes('listening') && resolve());
    child.once('exit', (code) => reject(new Error(`server exited early (${code})`)));
  });
  return child;
}
let server = await startServer();
let browser;
const errors = [];
try {
  browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--use-angle=d3d11', '--disable-background-timer-throttling'],
  });
  const page = await (
    await browser.newContext({ viewport: { width: 1440, height: 900 } })
  ).newPage();
  page.on('pageerror', (e) => errors.push(e.stack || String(e)));
  // The status check is expected to fail while the server is away; Chrome logs that itself.
  page.on(
    'console',
    (m) =>
      m.type() === 'error' && !m.text().includes('ERR_CONNECTION_REFUSED') && errors.push(m.text()),
  );
  const welcomes = [];
  page.on('websocket', (ws) =>
    ws.on('framereceived', (frame) => {
      try {
        const message = JSON.parse(frame.payload);
        if (message.type === 'welcome') welcomes.push(message);
      } catch {}
    }),
  );
  await page.addInitScript(() => {
    localStorage.setItem('cro-name', 'Restart QA');
  });
  await page.goto(`${base}/?room=RESTART-QA`);
  await page.locator('#title-start').click();
  await page.locator('#setup-form input[name="character"][value="cro-male"]').check();
  await page.locator('#setup-submit').click();
  await page
    .locator('#world[data-world-asset="ready"][data-character-asset="ready"]')
    .waitFor({ timeout: 90000 });
  const snapshot = () =>
    page.evaluate(() => ({
      screen: document.body.dataset.screen || null,
      label: document.querySelector('#connection-label')?.textContent,
      players: document.querySelectorAll('.player-label, .name-label').length,
    }));
  log('joined', JSON.stringify(await snapshot()));
  server.kill();
  await once(server, 'exit');
  log(`server killed; restarting in ${downMs} ms`);
  const restart = new Promise((resolve) => setTimeout(resolve, downMs)).then(startServer);
  const seen = new Set();
  const deadline = Date.now() + downMs + 45000;
  while (Date.now() < deadline) {
    const now = await snapshot();
    seen.add(now.label);
    assert.equal(now.screen, null, `client fell back to the ${now.screen} screen: ${now.label}`);
    if (welcomes.length >= 2 && now.label === 'オンライン') break;
    await page.waitForTimeout(400);
  }
  server = await restart;
  log('labels seen while the server was away:', [...seen].join(' / '));
  assert.ok(seen.has('再接続中…'), 'the connection label must show 再接続中… while waiting');
  assert.equal(welcomes.length, 2, 'the client must rejoin the restarted server by itself');
  assert.equal((await snapshot()).label, 'オンライン');
  await page.screenshot({ path: path.join(output, 'rejoined.png') });
  assert.deepEqual(errors, []);
  console.log('PASS server restart: stayed in game, reconnected automatically, no page errors');
} finally {
  await browser?.close();
  server.kill();
}
