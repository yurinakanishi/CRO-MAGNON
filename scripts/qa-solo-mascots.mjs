// Real Chrome, disposable browser storage and an ephemeral asset host. The observer
// records ordinary worker messages only; every selection, throw and stroke uses UI.
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import { createGameServer } from '../dist/server.mjs';
import { readDeliveryOverlay } from '../dist/infrastructure/node/delivery-overlay.mjs';
import { enterPreparedWorld } from './qa-game-entry.mjs';
const output = process.argv[2] || `output/playwright/solo-mascots-${Date.now()}`;
const layoutOnly = process.argv.includes('--layout-only');
await mkdir(output, { recursive: true });
const game = createGameServer({
  host: '127.0.0.1',
  port: 0,
  delivery: await readDeliveryOverlay(process.cwd()),
});
const base = `http://127.0.0.1:${(await game.listen()).port}/`;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const checks = [],
  errors = [],
  forbidden = [],
  delivered = [];
let page;
const pass = (text) => {
  checks.push(text);
  console.log('PASS', text);
};
const until = (predicate, argument) =>
  page.waitForFunction(predicate, argument, { timeout: 30000 });
async function checkpoint() {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const r = indexedDB.open('cro-magnon-solo', 1);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    return new Promise((resolve, reject) => {
      const tx = db.transaction('checkpoints', 'readonly'),
        r = tx.objectStore('checkpoints').get('current');
      tx.oncomplete = () => {
        db.close();
        resolve(JSON.parse(r.result.payload).game.rooms[0].sessions[0].player);
      };
      tx.onabort = () => reject(tx.error);
    });
  });
}
try {
  const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
  assert.equal(
    sha(await readFile('src/orb-bots.css')),
    sha(await readFile('dist/src/orb-bots.css')),
    'build the current CSS before browser QA',
  );
  for (const file of [
    'src/orb-bots.css',
    'src/mascot-target.js',
    'src/starting-mascot.js',
    'src/main.js',
    'src/solo-worker.js',
    'shared/mascot-selection.mjs',
  ]) {
    const response = await fetch(new URL(file, base));
    assert.equal(response.status, 200);
    const hash = sha(Buffer.from(await response.arrayBuffer()));
    assert.equal(hash, sha(await readFile(`dist/${file}`)), file);
    delivered.push({ file, sha256: hash });
  }
  for (const mobile of layoutOnly ? [true] : [false, true]) {
    const label = mobile ? 'phone' : 'pc';
    const context = await browser.newContext({
      viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 },
      isMobile: mobile,
      hasTouch: mobile,
      deviceScaleFactor: 1,
    });
    await context.addInitScript(() => {
      window.mascotQA = { state: {}, sent: [], id: '' };
      const Original = window.Worker;
      window.Worker = class extends Original {
        constructor(url, options) {
          super(url, options);
          this.soloObserver = String(url).includes('solo-worker');
          if (this.soloObserver)
            this.addEventListener('message', ({ data }) => {
              if (data.type !== 'message') return;
              const m = JSON.parse(data.data);
              if (m.type === 'welcome') window.mascotQA.id = m.id;
              if (m.type === 'state') window.mascotQA.state = { ...window.mascotQA.state, ...m };
            });
        }
        postMessage(data, ...rest) {
          if (this.soloObserver && data.type === 'command')
            window.mascotQA.sent.push(JSON.parse(data.data));
          return super.postMessage(data, ...rest);
        }
      };
    });
    page = await context.newPage();
    page.on('pageerror', (e) => errors.push(e.stack || e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('websocket', (socket) => forbidden.push(socket.url()));
    await page.route('**/api/**', (route) => {
      forbidden.push(route.request().url());
      return route.abort();
    });
    const tap = async (selector) =>
      mobile ? page.locator(selector).tap() : page.locator(selector).click();
    const command = (action) =>
      mobile ? `[data-touch-action="${action}"]` : `[data-cue="${action}"]`;
    await page.goto(base);
    await tap('#title-start');
    await page.locator('#setup-form input[name="name"]').fill('仲間QA');
    await tap('#setup-form input[value="cro-male"]');
    await tap('#setup-flow-yes');
    await tap('[data-starting-mascot-all]');
    assert.equal(await page.locator('[data-starting-mascot][aria-pressed="true"]').count(), 11);
    await tap('[data-starting-mascot-none]');
    assert.equal(await page.locator('[data-starting-mascot][aria-pressed="true"]').count(), 0);
    await tap('[data-starting-mascot="524"]');
    await tap('[data-starting-mascot="rimo-neko"]');
    await tap('#mascot-back');
    await tap('#setup-flow-yes');
    assert.equal(await page.locator('[data-starting-mascot][aria-pressed="true"]').count(), 2);
    await tap('[data-starting-mascot-all]');
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${output}/${label}-selection.png` });
    await tap('#mascot-start');
    await enterPreparedWorld(page, mobile);
    await until(
      () =>
        window.mascotQA.state.players?.[0]?.mascots?.length === 11 &&
        window.mascotQA.state.orbBots?.length === 11,
    );
    await page.locator('#mascot-target:not([hidden])').waitFor();
    pass(`${label}: multi choice, all/none and Back preserve the draft; all 11 arrive`);
    await tap('.mascot-target-toggle');
    assert.equal(await page.locator('#mascot-target [data-mascot-command]').count(), 0);
    await page.locator(command('inspect')).waitFor();
    await page.locator(command('pet')).waitFor();
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${output}/${label}-target.png` });
    if (mobile) {
      for (const viewport of [
        { width: 320, height: 568 },
        { width: 844, height: 390 },
        { width: 390, height: 844 },
      ]) {
        await page.setViewportSize(viewport);
        await page.waitForTimeout(250);
        const geometry = await page.locator('#mascot-target').evaluate((root) => {
          const rect = (node) => {
            const r = node.getBoundingClientRect();
            return {
              x: r.x,
              y: r.y,
              right: r.right,
              bottom: r.bottom,
              width: r.width,
              height: r.height,
            };
          };
          return {
            panel: rect(root),
            pad: rect(document.querySelector('#touch-stick')),
            buttons: [...root.querySelectorAll('button')]
              .filter((b) => b.checkVisibility() && !b.hasAttribute('data-mascot-target'))
              .map(rect),
            toolbar: [...document.querySelectorAll('.touch-toolbar button')]
              .filter((b) => b.checkVisibility())
              .map(rect),
          };
        });
        assert.ok(
          geometry.panel.x >= 0 &&
            geometry.panel.right <= viewport.width &&
            geometry.panel.bottom <= viewport.height,
        );
        assert.ok(geometry.buttons.every((r) => r.width >= 44 && r.height >= 44));
        const pad = geometry.pad,
          panel = geometry.panel;
        assert.ok(
          pad.right <= panel.x ||
            pad.x >= panel.right ||
            pad.bottom <= panel.y ||
            pad.y >= panel.bottom,
          'selector clears the visible movement pad',
        );
        assert.ok(
          geometry.toolbar.every(
            (r) =>
              r.right <= geometry.panel.x ||
              r.x >= geometry.panel.right ||
              r.bottom <= geometry.panel.y ||
              r.y >= geometry.panel.bottom,
          ),
        );
        await page.screenshot({
          path: `${output}/phone-target-${viewport.width}x${viewport.height}.png`,
        });
      }
      pass(
        'phone: 320px portrait, 390px portrait and landscape keep the selector on screen, with 44px controls clear of the toolbar',
      );
      if (layoutOnly) {
        await context.close();
        continue;
      }
    }
    await tap('[data-mascot-step="1"]');
    const selected = await page.locator('#mascot-target').getAttribute('data-target-key');
    if (mobile) await page.touchscreen.tap(350, 300);
    else await page.mouse.click(1200, 300);
    assert.equal(await page.locator('#mascot-target-panel').isHidden(), true);
    assert.equal(await page.locator('#mascot-target').getAttribute('data-target-key'), selected);
    await tap('.mascot-target-toggle');
    await tap('[data-mascot-step="-1"]');
    pass(
      `${label}: picker only selects a target; outside tap closes it and preserves the selection`,
    );
    await tap(command('inspect'));
    assert.equal(await page.locator('#mascot-target-panel').isHidden(), true);
    await until(() => document.querySelector('#world').dataset.companionView?.startsWith('524@'));
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${output}/${label}-524-closeup.png` });
    await tap('.mascot-target-toggle');
    await page.waitForTimeout(350);
    assert.ok(
      await page.evaluate(() =>
        document.querySelector('#world').dataset.companionView?.startsWith('524@'),
      ),
      'opening the selector keeps the current closeup',
    );
    await tap('[data-mascot-step="1"]');
    await until(() =>
      document.querySelector('#world').dataset.companionView?.startsWith('rimo-neko@'),
    );
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${output}/${label}-rimo-closeup.png` });
    await tap(command('endInspect'));
    await page.locator(command('pet')).waitFor();
    // The lower action remains reachable while the target picker is open.
    await tap('.mascot-target-toggle');
    await tap(command('pet'));
    assert.equal(await page.locator('#mascot-target-panel').isHidden(), true);
    await until(() =>
      window.mascotQA.state.companions?.some(
        (c) => c.key === 'rimo-neko' && c.petPlayerId === window.mascotQA.id,
      ),
    );
    assert.equal(
      await page.evaluate(
        () => window.mascotQA.state.companions.find((c) => c.key === '524').petPlayerId,
      ),
      null,
    );
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${output}/${label}-pet.png` });
    await until(() => window.mascotQA.state.companions?.every((c) => !c.petPlayerId));
    pass(
      `${label}: lower Look/Back/Pet buttons work on the first tap; arrows switch 524/rimo and petting reaches only rimo`,
    );
    await tap('.mascot-target-toggle');
    if (mobile) {
      const strip = await page.locator('.mascot-target-strip').boundingBox();
      const session = await context.newCDPSession(page);
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x: strip.x + strip.width - 12, y: strip.y + 28 }],
      });
      for (let i = 1; i <= 8; i++) {
        await session.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [{ x: strip.x + strip.width - 12 - i * 12, y: strip.y + 28 }],
        });
        await page.waitForTimeout(40);
      }
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await until(
        () =>
          !['524', 'rimo-neko'].includes(
            document.querySelector('#mascot-target').dataset.targetKey,
          ),
      );
      await session.detach();
      await page.waitForTimeout(700);
      await page.screenshot({ path: `${output}/phone-swiped.png` });
      pass('phone: native horizontal touch swipe selects a different companion');
    } else {
      await page.keyboard.press('BracketRight');
      assert.equal(await page.locator('#mascot-target').getAttribute('data-target-key'), 'white');
      pass('pc: bracket key changes the target without changing the travelling party');
    }
    // Return the selector to 524 by the actual previous buttons.
    for (
      let i = 0;
      i < 11 && (await page.locator('#mascot-target').getAttribute('data-target-key')) !== '524';
      i++
    )
      await tap('[data-mascot-step="-1"]');
    await tap('.mascot-target-toggle');
    // Leave the cave through ordinary movement; throwing remains forbidden inside.
    if (mobile) {
      const zone = await page.locator('.touch-move').boundingBox();
      const session = await context.newCDPSession(page);
      const x = zone.x + zone.width / 2,
        y = zone.y + zone.height * 0.65;
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x, y }],
      });
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x, y: y - 70 }],
      });
      await page.waitForTimeout(2200);
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await session.detach();
    } else {
      await page.keyboard.down('w');
      await page.waitForTimeout(2200);
      await page.keyboard.up('w');
    }
    await page.waitForTimeout(2000);
    for (let i = 0; i < 11; i++) {
      if (mobile) await tap('[data-touch-action="throw"]');
      else await page.keyboard.press('c');
      await page.waitForTimeout(120);
    }
    await until(() => window.mascotQA.state.orbBots?.filter((b) => b.sequence > 0).length === 11);
    await until(() => window.mascotQA.state.orbBots?.every((b) => b.mode === 'waiting'));
    const thrown = await page.evaluate(() =>
      window.mascotQA.state.orbBots.map(({ kind, sequence, throwAt }) => ({
        kind,
        sequence,
        throwAt,
      })),
    );
    assert.equal(new Set(thrown.map((b) => b.kind)).size, 11);
    assert.ok(thrown.every((b) => b.sequence === 1));
    assert.equal([...thrown].sort((a, b) => a.throwAt - b.throwAt)[0].kind, '524');
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${output}/${label}-thrown.png` });
    if (mobile) await tap('[data-touch-action="recall"]');
    else await page.keyboard.press('q');
    await until(() => window.mascotQA.state.orbBots?.every((b) => b.mode === 'following'));
    pass(
      `${label}: 11 real throw presses deploy 11 distinct companions once each, then recall all`,
    );
    if (mobile) await tap('[data-touch-action="mascots"]');
    else {
      await page.keyboard.press('Escape');
      await tap('[data-pause-tab="mascots"]');
    }
    await tap('[data-mascot="524"]');
    await until(() => window.mascotQA.state.players?.[0]?.mascots?.length === 10);
    assert.equal((await checkpoint()).mascots.length, 10);
    await tap('[data-mascot-all]');
    await until(() => window.mascotQA.state.players?.[0]?.mascots?.length === 11);
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${output}/${label}-menu.png` });
    assert.equal((await checkpoint()).mascots.length, 11);
    await tap('[data-mascot-none]');
    await until(() => window.mascotQA.state.players?.[0]?.mascots?.length === 0);
    assert.deepEqual((await checkpoint()).mascots, []);
    await tap('[data-mascot-all]');
    await until(() => window.mascotQA.state.players?.[0]?.mascots?.length === 11);
    await page.reload();
    await tap('#title-start');
    await tap('#setup-flow-yes');
    assert.equal(await page.locator('[data-starting-mascot][aria-pressed="true"]').count(), 11);
    await tap('#mascot-start');
    await enterPreparedWorld(page, mobile);
    await until(() => window.mascotQA.state.orbBots?.length === 11);
    assert.equal((await checkpoint()).mascots.length, 11);
    pass(`${label}: in-game individual/all/none changes save immediately; reload restores all 11`);
    await context.close();
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(forbidden, []);
  assert.equal(game.rooms.size, 0);
  pass('No browser errors, game APIs or WebSockets; game remains entirely in the browser');
} catch (error) {
  await page?.screenshot({ path: `${output}/failure.png` }).catch(() => {});
  console.error(
    'QA STATE',
    await page
      ?.evaluate(() => ({
        qa: window.mascotQA,
        target: document.querySelector('#mascot-target')?.outerHTML,
      }))
      .catch(() => null),
  );
  throw error;
} finally {
  await writeFile(
    `${output}/result.json`,
    JSON.stringify(
      { browser: browser.version(), base, checks, errors, forbidden, delivered },
      null,
      2,
    ),
  );
  await browser.close();
  await game.close();
}
