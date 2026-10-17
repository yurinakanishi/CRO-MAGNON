// Disposable solo Chrome session. Gameplay observations never change the game state.
import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, stat, copyFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import { createGameServer } from '../dist/server.mjs';
import { readDeliveryOverlay } from '../dist/infrastructure/node/delivery-overlay.mjs';
import { readLocalVisibility } from '../dist/infrastructure/node/local-visibility.mjs';
import { enterPreparedWorld } from './qa-game-entry.mjs';

const before = process.argv.includes('--before');
const output = `output/playwright/desktop-actions-20261017/${before ? 'before' : 'after'}`;
await mkdir(`${output}/save-before`, { recursive: true });
const sha = (data) => createHash('sha256').update(data).digest('hex');
const saves = [];
for (const name of await readdir('.cro-magnon-save')) {
  const source = `.cro-magnon-save/${name}`;
  const info = await stat(source);
  if (!info.isFile()) continue;
  saves.push({ name, sha256: sha(await readFile(source)), mtime: info.mtimeMs });
  await copyFile(source, `${output}/save-before/${name}`);
}
const game = createGameServer({
  host: '127.0.0.1',
  port: 0,
  visibility: await readLocalVisibility('local-visibility.json'),
  delivery: await readDeliveryOverlay(process.cwd()),
  runtimeConfig: { mode: 'solo', serverUrl: '', room: 'SOLO' },
});
const base = `http://127.0.0.1:${(await game.listen()).port}`;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const report = { browser: browser.version(), base, checks: [], errors: [], forbidden: [], saves };
let page;
const pass = (message) => {
  report.checks.push(message);
  console.log('PASS', message);
};
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.addInitScript(() => {
    window.desktopQA = { state: {}, sent: [], id: '' };
    const Original = window.Worker;
    window.Worker = class extends Original {
      constructor(url, options) {
        super(url, options);
        this.soloObserver = String(url).includes('solo-worker');
        if (this.soloObserver)
          this.addEventListener('message', ({ data }) => {
            if (data.type !== 'message') return;
            const message = JSON.parse(data.data);
            if (message.type === 'welcome') desktopQA.id = message.id;
            if (message.type === 'state') desktopQA.state = { ...desktopQA.state, ...message };
          });
      }
      postMessage(data, ...rest) {
        if (this.soloObserver && data.type === 'command')
          desktopQA.sent.push(JSON.parse(data.data));
        return super.postMessage(data, ...rest);
      }
    };
  });
  page = await context.newPage();
  page.on('pageerror', (error) => report.errors.push(String(error)));
  page.on('websocket', (socket) => report.forbidden.push(socket.url()));
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/')) report.forbidden.push(request.url());
  });
  await page.goto(base);
  await page.locator('#title-start').click();
  await page.locator('#setup-form input[name="name"]').fill('PC操作の確認');
  await page.locator('#setup-form input[value="cro-male"]').click();
  await page.locator('#setup-flow-yes').click();
  await page.locator('[data-starting-mascot="524"]').click();
  await page.locator('[data-starting-mascot="rimo-neko"]').click();
  await page.locator('#mascot-start').click();
  await enterPreparedWorld(page, false);
  await page.locator('#input-cues:not([hidden])').waitFor();
  await page.screenshot({ path: `${output}/desktop.png` });
  report.initialButtons = await page.locator('#input-cues button').evaluateAll((buttons) =>
    buttons.map((button) => ({
      action: button.dataset.cue,
      label: button.innerText,
      width: button.getBoundingClientRect().width,
      height: button.getBoundingClientRect().height,
    })),
  );
  if (!before) {
    await page.getByRole('button', { name: '524を近くで見る', exact: true }).click();
    await page.waitForFunction(() => !!document.querySelector('#world').dataset.companionView);
    await page.locator('[data-cue="endInspect"]').waitFor();
    assert.deepEqual(
      await page
        .locator('#input-cues [data-cue]')
        .evaluateAll((buttons) => buttons.map((b) => b.dataset.cue)),
      ['endInspect'],
    );
    await page.screenshot({ path: `${output}/inspect.png` });
    await page.locator('[data-cue="endInspect"]').click();
    await page.waitForFunction(() => !document.querySelector('#world').dataset.companionView);
    pass('Mouse closeup and Return work without a keyboard or modal');

    await page.locator('.mascot-target-toggle').click();
    await page.locator('[data-mascot-target="rimo-neko"]').click();
    await page.getByRole('button', { name: 'りもねこを撫でる', exact: true }).click();
    await page.waitForFunction(() =>
      desktopQA.sent.some((m) => m.type === 'action' && m.action === 'petMascot'),
    );
    const pet = await page.evaluate(() => desktopQA.sent.filter((m) => m.action === 'petMascot'));
    assert.equal(pet.length, 1, 'one click sends one pet action');
    const target = await page.evaluate(
      (id) => desktopQA.state.companions.find((c) => c.id === id)?.key,
      pet[0].targetId,
    );
    assert.equal(target, 'rimo-neko');
    assert.equal(await page.locator('#mascot-target-panel').isHidden(), true);
    await page.waitForFunction(() =>
      desktopQA.state.companions.some(
        (c) => c.key === 'rimo-neko' && c.petPlayerId === desktopQA.id,
      ),
    );
    await page.screenshot({ path: `${output}/pet.png` });
    pass('Picker stays selection-only; one lower-button click pets the selected companion');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'world');
    await page.waitForFunction(
      () => !desktopQA.state.companions.some((c) => c.petPlayerId === desktopQA.id),
    );
    await page.keyboard.press('Space');
    await page.waitForFunction(() => desktopQA.sent.some((m) => m.action === 'jump'));
    pass('Clicking a gameplay button returns focus so Space still jumps');

    for (const [action, panel] of [
      ['bag', '[data-pause-panel="inventory"]'],
      ['mascots', '[data-pause-panel="mascots"]'],
      ['map', '#big-map'],
      ['menu', '.pause-menu'],
    ]) {
      await page.locator(`.input-shortcuts [data-cue="${action}"]`).click();
      await page.locator(panel).waitFor({ state: 'visible' });
      assert.equal(await page.locator('#input-cues').isVisible(), false);
      assert.equal(await page.evaluate(() => !!document.activeElement?.closest('#modal')), true);
      await page.locator('#modal-close').click();
      await page.locator('#input-cues:not([hidden])').waitFor();
    }
    pass(
      'Named inventory, companions, map and menu buttons open their real screens and retain modal focus',
    );

    await page.locator('[data-cue="throw"]').click();
    await page.waitForFunction(() => desktopQA.state.orbBots.some((b) => b.mode === 'waiting'));
    await page.locator('[data-cue="recall"]').click();
    await page.waitForFunction(() => desktopQA.state.orbBots.every((b) => b.mode === 'following'));
    await page.locator('[data-cue="pet"]').waitFor();
    await page.locator('[data-cue="inspect"]').waitFor();
    pass('Throw and recall work by mouse alongside the contextual companion buttons');

    // Real Tab reaches the first contextual action from the focused world canvas.
    for (let step = 0; step < 30; step++) {
      await page.keyboard.press('Tab');
      if (await page.evaluate(() => document.activeElement?.getAttribute('data-cue') === 'inspect'))
        break;
    }
    assert.equal(
      await page.evaluate(() => document.activeElement?.getAttribute('data-cue')),
      'inspect',
    );
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => !!document.querySelector('#world').dataset.companionView);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('#world').dataset.companionView);
    assert.equal(await page.locator('#modal').isVisible(), false);
    pass('Tab/Enter activate the visible action and Escape returns without opening the menu');

    for (const [width, height] of [
      [1920, 1080],
      [1280, 800],
      [1024, 768],
      [800, 600],
      [844, 480],
    ]) {
      await page.setViewportSize({ width, height });
      const layout = await page.locator('#input-cues button').evaluateAll((buttons) =>
        buttons.map((b) => {
          const r = b.getBoundingClientRect();
          const front = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          return {
            action: b.dataset.cue,
            x: r.x,
            y: r.y,
            width: r.width,
            height: r.height,
            reachable: !!front && b.contains(front),
            inView: r.x >= 0 && r.y >= 0 && r.right <= innerWidth && r.bottom <= innerHeight,
          };
        }),
      );
      assert.ok(
        layout.every((b) => b.inView && b.reachable && b.height >= 44),
        JSON.stringify({ width, height, layout }),
      );
      assert.ok((await page.locator('.input-actions [data-cue]').count()) <= 3);
      await page.screenshot({ path: `${output}/desktop-${width}x${height}.png` });
    }
    pass(
      'All action buttons remain at least 44px high, visible and clickable at five desktop sizes',
    );
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.evaluate(() => {
      window.qaPad = {
        id: 'Wireless Controller (Vendor: 054c)',
        index: 0,
        connected: true,
        mapping: 'standard',
        axes: [0, 0, 0, 0],
        buttons: Array.from({ length: 18 }, () => ({ pressed: false, value: 0 })),
      };
      Object.defineProperty(navigator, 'getGamepads', { value: () => [qaPad] });
    });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      qaPad.buttons[3] = { pressed: true, value: 1 };
    });
    await page.locator('#input-cues[data-device="gamepad"]').waitFor();
    await page.evaluate(() => {
      qaPad.buttons[3] = { pressed: false, value: 0 };
    });
    assert.equal(await page.locator('.controller-diagram').isVisible(), true);
    assert.equal(await page.locator('.input-shortcuts').count(), 0);
    assert.ok((await page.locator('.input-actions button').count()) <= 3);
    await page.screenshot({ path: `${output}/gamepad.png` });
    // The click itself must still run when it also switches the input device.
    await page.locator('[data-cue="inspect"]').click();
    await page.locator('#input-cues[data-device="keyboard"].is-inspecting').waitFor();
    await page.locator('[data-cue="endInspect"]').click();
    pass(
      'Simulated controller keeps its original diagram; a mouse action switches back without losing the click',
    );
    await context.close();

    const phoneContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 1,
    });
    page = await phoneContext.newPage();
    page.on('pageerror', (error) => report.errors.push(String(error)));
    page.on('websocket', (socket) => report.forbidden.push(socket.url()));
    page.on('request', (request) => {
      if (new URL(request.url()).pathname.startsWith('/api/')) report.forbidden.push(request.url());
    });
    await page.goto(base);
    await page.locator('#title-start').tap();
    await page.locator('#setup-form input[value="cro-male"]').tap();
    await page.locator('#setup-flow-yes').tap();
    await page.locator('[data-starting-mascot="524"]').tap();
    await page.locator('#mascot-start').tap();
    await enterPreparedWorld(page, true);
    for (const [width, height] of [
      [390, 844],
      [320, 740],
      [844, 390],
    ]) {
      await page.setViewportSize({ width, height });
      await page.locator('[data-touch-action="pet"]').waitFor();
      assert.equal(await page.locator('#input-cues').isVisible(), false);
      assert.equal(await page.locator('[data-touch-action="inspect"]').isVisible(), true);
      await page.screenshot({ path: `${output}/phone-${width}x${height}.png` });
      await page.locator('[data-touch-action="inspect"]').tap();
      await page.locator('[data-touch-action="endInspect"]').waitFor();
      await page.locator('[data-touch-action="endInspect"]').tap();
    }
    pass(
      'Touch emulation keeps its original controls and Look/Return at three portrait/landscape sizes',
    );
    await phoneContext.close();
  }
  report.delivered = [];
  for (const file of ['src/input-cues.js', 'src/input-cues-ui.js', 'src/input-cues.css']) {
    const response = await fetch(`${base}/${file}`);
    const hash = sha(Buffer.from(await response.arrayBuffer()));
    assert.equal(hash, sha(await readFile(`dist/${file}`)));
    report.delivered.push({ file, sha256: hash });
  }
  for (const name of ['health', 'status'])
    assert.equal((await fetch(`${base}/api/${name}`).then((r) => r.json())).ok, true);
  for (const saved of saves) {
    const source = `.cro-magnon-save/${saved.name}`;
    assert.equal(sha(await readFile(source)), saved.sha256);
    assert.equal((await stat(source)).mtimeMs, saved.mtime);
  }
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.forbidden, []);
  assert.equal(game.rooms.size, 0);
  report.status = before ? 'baseline' : 'passed';
} catch (error) {
  report.status = 'failed';
  report.failure = String(error.stack || error);
  await page?.screenshot({ path: `${output}/failure.png` }).catch(() => {});
  throw error;
} finally {
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
  await game.close();
}
