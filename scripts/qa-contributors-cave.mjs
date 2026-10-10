// Real Chrome controls against isolated in-memory rooms; no user save or MMO-room access.
import assert from 'node:assert/strict';
import { mkdir, writeFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { createGameServer } from '../dist/server.mjs';
import { MIME } from '../dist/infrastructure/node/static-files.mjs';
import { spawnSite } from '../dist/shared/spawn-sites.mjs';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);
const out = process.argv[2] || 'output/playwright/contributors-cave-20261009/' + Date.now();
const mmo = process.argv[3] && path.resolve(process.argv[3]);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const checks = [],
  errors = [];
const cases = [
  {
    mode: 'mmo',
    name: 'desktop',
    width: 1440,
    height: 900,
    touch: false,
    keyboard: false,
    resume: true,
  },
  { mode: 'mmo', name: 'portrait', width: 390, height: 844, touch: true },
  { mode: 'mmo', name: 'landscape', width: 844, height: 390, touch: true },
  {
    mode: 'local',
    name: 'desktop-keyboard',
    width: 1280,
    height: 800,
    touch: false,
    keyboard: true,
  },
  { mode: 'exhibition', name: 'desktop', width: 1440, height: 900, touch: false },
  { mode: 'exhibition', name: 'portrait', width: 390, height: 844, touch: true },
];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(fn, label, ms = 30000) {
  const end = Date.now() + ms;
  while (!(await fn())) {
    if (Date.now() > end) throw new Error(label);
    await sleep(100);
  }
}
let page;
try {
  for (const view of cases) {
    const label = view.mode + '-' + view.name;
    const roomId = 'CAVE_CREDITS';
    const runtimeConfig = {
      mode: view.mode === 'exhibition' ? 'lan' : 'online',
      serverUrl: '',
      room: roomId,
      guestName: 'Cave Credits QA',
    };
    const game = createGameServer({
      port: 0,
      host: '127.0.0.1',
      exhibition: view.mode === 'exhibition',
      runtimeConfig,
    });
    if (view.mode === 'mmo' && mmo) {
      const normal = game.server.listeners('request')[0];
      game.server.removeAllListeners('request');
      game.server.on('request', async (request, response) => {
        const url = new URL(request.url, 'http://127.0.0.1');
        if (url.pathname.startsWith('/api/') || url.pathname === '/multiplayer-config.json')
          return normal(request, response);
        const file = path.resolve(mmo, url.pathname === '/' ? 'index.html' : url.pathname.slice(1));
        if (path.relative(mmo, file).startsWith('..')) return response.writeHead(403).end();
        try {
          const info = await stat(file);
          response.writeHead(200, {
            'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
            'Content-Length': info.size,
          });
          createReadStream(file).pipe(response);
        } catch {
          response.writeHead(404).end();
        }
      });
    }
    const { port } = await game.listen();
    if (view.mode === 'exhibition') runtimeConfig.serverUrl = 'ws://127.0.0.1:' + port + '/ws';
    const context = await browser.newContext({
      viewport: { width: view.width, height: view.height },
      isMobile: view.touch,
      hasTouch: view.touch,
    });
    try {
      page = await context.newPage();
      const sent = [],
        welcome = [],
        states = [],
        requests = [];
      page.on('pageerror', (error) => errors.push(label + ': ' + error.message));
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(label + ': ' + message.text());
      });
      page.on('request', (request) => requests.push(new URL(request.url()).pathname));
      page.on('websocket', (socket) => {
        socket.on('framesent', ({ payload }) => {
          try {
            sent.push(JSON.parse(String(payload)));
          } catch {}
        });
        socket.on('framereceived', ({ payload }) => {
          try {
            const message = JSON.parse(String(payload));
            if (message.type === 'welcome') welcome.push(message);
            if (message.type === 'state') {
              states.push(message);
              if (states.length > 30) states.shift();
            }
          } catch {}
        });
      });
      await page.addInitScript(() => {
        localStorage.setItem('cro-species', 'cro');
        localStorage.setItem('cro-gender', 'female');
        localStorage.setItem('cro-difficulty', 'normal');
      });
      if (view.mode !== 'mmo' || !mmo)
        await page.route('**/src/build-profile.js', (route) =>
          route.fulfill({
            contentType: 'text/javascript',
            body:
              'export const BUILD_PROFILE = {environment:' +
              JSON.stringify(view.mode) +
              ',cameraControls:' +
              (view.mode !== 'mmo') +
              ',builtAt:null};',
          }),
        );
      await page.goto('http://127.0.0.1:' + port + '/');
      const activate = (selector) =>
        view.touch ? page.locator(selector).tap() : page.locator(selector).click();
      await activate('#title-contributors');
      await page.waitForFunction(() =>
        [...document.querySelectorAll('.contributor-avatar')].every(
          (image) => image.complete && image.naturalWidth > 0,
        ),
      );
      assert.equal(await page.locator('.contributors-mark, .contributor-text em').count(), 0);
      assert.equal(
        await page.locator('.contributors-dialog .modal-intro').textContent(),
        'アプレノ洞窟に残る壁画に会いに来てください。',
      );
      assert.equal(await page.locator('#contributors-cave').textContent(), 'アプレノ洞窟に行く');
      assert.equal(
        await page.locator('.contributors-dialog a').count(),
        view.mode === 'exhibition' ? 0 : 7,
      );
      assert.equal(await page.locator('.contributor-avatar').count(), 7);
      assert(!requests.some((url) => /cave-mural-strip|\/title\/qr-/.test(url)));
      const box = await page.locator('#contributors-cave').boundingBox();
      await page.screenshot({ path: out + '/' + label + '-dialog.png' });
      assert(
        box &&
          box.width >= 44 &&
          box.height >= 44 &&
          box.x >= 0 &&
          box.x + box.width <= view.width &&
          box.y >= 0 &&
          box.y + box.height <= view.height,
        label + ': cave button bounds ' + JSON.stringify(box),
      );
      if (view.keyboard) {
        for (
          let i = 0;
          i < 15 && (await page.evaluate(() => document.activeElement?.id)) !== 'contributors-cave';
          i++
        )
          await page.keyboard.press('Tab');
        assert.equal(await page.evaluate(() => document.activeElement?.id), 'contributors-cave');
        await page.keyboard.press('Enter');
      } else await activate('#contributors-cave');
      const cave = spawnSite('cave');
      const arrived = (sequence) => {
        const me = states.at(-1)?.players.find((p) => p.id === welcome.at(-1)?.id);
        return (
          me && (me.warpSequence || 0) >= sequence && Math.hypot(me.x - cave.x, me.z - cave.z) <= 8
        );
      };
      await until(() => arrived(1), label + ': no cave arrival');
      assert.equal(
        sent.filter((message) => message.action === 'warp' && message.targetId === 'spawn-cave')
          .length,
        1,
      );
      assert.equal(
        await page.locator('#loading-cave, #screen-setup:not([hidden]), #modal[open]').count(),
        0,
      );
      await page.waitForFunction(
        () => {
          const canvas = document.querySelector('#world');
          return (
            (canvas?.dataset.worldAsset === 'ready' &&
              canvas?.dataset.characterAsset === 'ready') ||
            !!document.querySelector('#render-error')
          );
        },
        null,
        { timeout: 180000 },
      );
      assert.equal(await page.locator('#render-error').count(), 0);
      await page.screenshot({ path: out + '/' + label + '-arrival.png' });
      if (view.resume) {
        // Only this isolated room is prepared with possessions for the return-to-title check.
        const originalId = welcome[0].id;
        const actor = game.rooms.get(roomId).players.get(originalId);
        actor.inventory.wood = 9;
        actor.inventory.shells = 6;
        await page.keyboard.press('Escape');
        await page.locator('[data-controller-menu="title"]').click();
        await page.locator('#screen-title:not([hidden])').waitFor();
        await activate('#title-contributors');
        await activate('#contributors-cave');
        await until(
          () => welcome.length === 2 && arrived(2),
          label + ': resume did not warp again',
        );
        assert.equal(welcome[1].id, originalId);
        const resumed = game.rooms.get(roomId).players.get(originalId);
        assert.equal(resumed.inventory.wood, 9);
        assert.equal(resumed.inventory.shells, 6);
        assert.equal(sent.filter((message) => message.action === 'warp').length, 2);
      }
      const data = {
        label,
        input: view.touch ? 'tap' : view.keyboard ? 'Tab/Enter' : 'click',
        credits: 7,
        caveArrival: true,
        possessionsPreserved: !!view.resume,
      };
      checks.push(data);
      console.log('PASS', JSON.stringify(data));
    } finally {
      await context.close();
      await game.close();
    }
  }
  assert.deepEqual(errors, []);
  await writeFile(
    out + '/result.json',
    JSON.stringify(
      {
        passed: true,
        browser: browser.version(),
        checks,
        errors,
        conditions:
          'Installed Chrome on Windows; exact MMO static files with the shared in-memory Node game core. Local/exhibition presentation uses an explicit build-profile fixture. Initial character preferences and the desktop return-check possessions are fixtures. No physical phone/controller, Cloudflare deployment, persistent user save or real MMO-room participation.',
      },
      null,
      2,
    ),
  );
} catch (error) {
  await page?.screenshot({ path: out + '/failure.png' }).catch(() => {});
  await writeFile(
    out + '/result.json',
    JSON.stringify(
      { passed: false, checks, errors, error: String(error), stack: error.stack },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await browser.close();
}
