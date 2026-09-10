import { createGameCore } from '../dist/application/game-core.mjs';
// Real Chrome, real-time server, ordinary UI; only names/guide preference are fixtures.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createGameServer } from '../dist/server.mjs';
import { WARP_POINTS } from '../dist/shared/warp-sites.mjs';
const { chromium } =
  await import('file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const output = 'output/playwright/warp-points';
await mkdir(output, { recursive: true });
const core = createGameCore();
const game = createGameServer({ core, host: '127.0.0.1', port: 0 });
const address = await game.listen(),
  url = `http://127.0.0.1:${address.port}/?room=WARP-QA`;
const errors = [],
  checks = [];
let browser;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const contexts = await Promise.all([
    browser.newContext({ viewport: { width: 1440, height: 900 } }),
    browser.newContext({ viewport: { width: 1440, height: 900 } }),
  ]);
  const pages = [];
  for (let i = 0; i < 2; i++) {
    const page = await contexts[i].newPage();
    pages.push(page);
    page.on('pageerror', (e) => {
      errors.push(e.stack || String(e));
      console.log(e.stack || String(e));
    });
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await page.addInitScript(
      (name) => {
        localStorage.setItem('cro-name', name);
        localStorage.setItem('cro-skip-guide', '1');
      },
      `Warp QA ${i + 1}`,
    );
    await page.goto(url);
    await page.locator('#title-start').click();
    await page.locator('#setup-submit').click();
    await page.waitForSelector('#world[data-world-asset="ready"][data-character-asset="ready"]', {
      timeout: 90000,
    });
  }
  const [page, other] = pages;
  const r = core.rooms.get('WARP-QA');
  const me = () => [...r.players.values()].find((p) => p.name === 'Warp QA 1');
  const ally = () => [...r.players.values()].find((p) => p.name === 'Warp QA 2');
  const initialInventory = { ...me().inventory },
    initialEnergy = me().energy,
    allyStart = { x: ally().x, z: ally().z };
  const frames = [];
  other.on('websocket', () => {});
  // Observe actual network messages in the second browser without changing them.
  const cdp = await contexts[1].newCDPSession(other);
  await cdp.send('Network.enable');
  cdp.on('Network.webSocketFrameReceived', (event) => {
    try {
      const m = JSON.parse(event.response.payloadData);
      if (m.type === 'state') frames.push(m);
    } catch {}
  });
  await page.keyboard.press('m');
  await page.waitForSelector('#map-warp');
  assert.equal(await page.locator('[data-warp-point]').count(), 30);
  assert.equal(await page.locator('#map-warp').isDisabled(), true);
  await page.locator('[data-warp-point="fire-south-america"]').click();
  assert.equal(await page.locator('#map-location').inputValue(), 'fire-south-america');
  assert.ok(Math.hypot(me().x - 50, me().z - 50) < 15, 'selection alone does not move');
  await page.screenshot({ path: `${output}/world-selection.png` });
  await page.locator('#map-warp').click();
  await page.waitForFunction(() => !document.querySelector('#modal').open);
  const destination = WARP_POINTS.find((p) => p.id === 'fire-south-america');
  assert.ok(Math.hypot(me().x - destination.x, me().z - destination.z) < 8);
  await other.waitForTimeout(250);
  assert.ok(
    frames.some((s) =>
      s.players.some(
        (p) => p.id === me().id && p.warpSequence === 1 && Math.abs(p.x - me().x) < 0.01,
      ),
    ),
    'other browser receives arrival',
  );
  assert.deepEqual(me().inventory, initialInventory);
  assert.equal(me().energy, initialEnergy);
  assert.deepEqual({ x: ally().x, z: ally().z }, allyStart);
  await page.screenshot({ path: `${output}/arrival.png` });
  checks.push(
    'Map fire selection + explicit warp, unchanged possessions/energy, second browser receives same arrival',
  );
  await page.keyboard.press('m');
  await page.locator('#map-location').selectOption('adventure-fire-shadow-realm');
  assert.equal(await page.locator('#map-warp').isDisabled(), true);
  assert.match(await page.locator('#map-warp-status').textContent(), /旅の証/);
  await page.locator('#map-location').selectOption('gulf-fire-many-hearths');
  await page.waitForFunction(() => !document.querySelector('#map-warp').disabled);
  await page.locator('#map-warp').focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !document.querySelector('#modal').open);
  assert.ok(me().x < -2200);
  checks.push('List selection, keyboard confirmation, existing shadow-realm gate and cooldown');
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport);
    await page.keyboard.press('m');
    await page.waitForSelector('#map-warp');
    assert.equal(await page.locator('#big-map').getAttribute('data-map-mode'), 'gulf');
    await page.locator('[data-warp-point="gulf-fire-reed-shore"]').click();
    assert.equal(await page.locator('#map-location').inputValue(), 'gulf-fire-reed-shore');
    const overflow = await page
      .locator('#modal')
      .evaluate((el) => el.scrollWidth > el.clientWidth + 1);
    if (overflow) {
      await page.screenshot({ path: `${output}/overflow.png` });
      console.log(
        await page
          .locator('#modal')
          .evaluate((el) => ({
            width: el.clientWidth,
            scroll: el.scrollWidth,
            items: [...el.querySelectorAll('*')]
              .filter(
                (n) => n.getBoundingClientRect().right > el.getBoundingClientRect().right - 10,
              )
              .map((n) => ({
                tag: n.tagName,
                id: n.id,
                cls: n.className,
                width: n.getBoundingClientRect().width,
                right: n.getBoundingClientRect().right,
              })),
          })),
      );
    }
    assert.equal(overflow, false, `no horizontal overflow at ${viewport.width}`);
    await page.locator('#map-warp').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${output}/gulf-${viewport.width}x${viewport.height}.png` });
    await page.keyboard.press('Escape');
  }
  checks.push('Gulf map fire buttons and warp controls work at 1440x900, 390x844 and 844x390');
  await page.reload();
  await page.locator('#title-start').click();
  await page.waitForSelector('#world[data-character-asset="ready"]', { timeout: 90000 });
  assert.ok(me().x < -2200);
  checks.push('Reload + title start resumes at destination');
  assert.deepEqual(errors, []);
  await writeFile(
    `${output}/summary.json`,
    JSON.stringify(
      {
        url,
        checks,
        errors,
        positions: [...r.players.values()].map((p) => ({ name: p.name, x: p.x, z: p.z })),
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ checks, errors }, null, 2));
} finally {
  await browser?.close();
  await game.close();
}
