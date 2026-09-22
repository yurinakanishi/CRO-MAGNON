// Captures the pictures of the exhibition start picker (public/spawn/<id>.jpg)
// from the real game, by walking the real exhibition start flow once per sight:
// title → character card → pictured sight. A throwaway in-memory LAN/exhibition
// server is used; nothing here touches the normal server on port 3000.
//   node scripts/capture-spawn-art.mjs [--review-only]
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { SPAWN_SITES } from '../dist/shared/spawn-sites.mjs';
import { EXHIBITION_RULES } from '../dist/shared/room-rules.mjs';
const { createGameServer } = await import('../dist/server.mjs');
const { chromium } =
  await import('file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const reviewOnly = process.argv.includes('--review-only');
const out = path.resolve('output/playwright/spawn-art');
await mkdir(out, { recursive: true });
await mkdir('public/spawn', { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, label, limit = 60000) {
  const start = Date.now();
  while (!(await fn())) {
    if (Date.now() - start > limit) throw Error('Timeout ' + label);
    await sleep(100);
  }
}
const game = createGameServer({ port: 0, host: '127.0.0.1', exhibition: true });
const normal = game.server.listeners('request')[0];
game.server.removeListener('request', normal);
let port;
game.server.on('request', async (req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/multiplayer-config.json')
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(
      JSON.stringify({
        mode: 'lan',
        serverUrl: `ws://127.0.0.1:${port}/ws`,
        room: 'EXHIBITION',
        guestName: 'Visitor',
      }),
    );
  else if (url === '/') {
    const html = await readFile('public/index.html', 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html' }).end(
      html.replace(
        '<script type="module" src="/src/main.js"></script>',
        `<script type="module">
          import {WorldRenderer} from "/src/world3d.js";
          const old=WorldRenderer.prototype.render;
          WorldRenderer.prototype.render=function(...a){window.spawnReview=this;return old.apply(this,a)};
          await import("/src/main.js");
          </script>`,
      ),
    );
  } else normal(req, res);
});
({ port } = await game.listen());
const base = `http://127.0.0.1:${port}`;
const errors = [],
  facts = { rules: EXHIBITION_RULES, sites: {} };
const context = await chromium.launchPersistentContext(path.join(out, 'profile'), {
  channel: 'chrome',
  headless: true,
  viewport: { width: 1280, height: 720 },
  args: ['--use-angle=d3d11', '--disable-background-timer-throttling'],
});
try {
  const page = context.pages()[0] || (await context.newPage());
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  for (const [index, site] of SPAWN_SITES.entries()) {
    await page.goto(base + '/');
    await page.locator('#title-start').click();
    await page.locator('#setup-form .character-choice:has(input:checked)').click();
    await page.locator('#setup-flow[data-step="spawn"]').waitFor();
    assert.equal(await page.locator('[data-choose-difficulty]').count(), 0, 'no difficulty step');
    if (!index) {
      await sleep(700);
      await page.screenshot({ path: path.join(out, 'picker.png') });
    }
    await page.locator(`[data-choose-spawn="${site.id}"]`).click();
    await page.waitForSelector('body.in-game', { timeout: 60000 });
    await page
      .locator('#world[data-world-asset="ready"][data-character-asset="ready"]')
      .waitFor({ timeout: 180000 });
    await until(() => page.evaluate(() => !!window.spawnReview?.selfId), 'renderer');
    await sleep(index ? 3500 : 6000);
    const room = game.rooms.get('EXHIBITION');
    const me = [...room.players.values()][0];
    const distance = Math.hypot(me.x - site.x, me.z - site.z);
    facts.sites[site.id] = {
      x: me.x,
      z: me.z,
      fromSite: distance,
      facing: me.facing,
      yaw: await page.evaluate(() => window.spawnReview.yaw),
    };
    assert.ok(distance < 8, `${site.id}: spawned ${distance.toFixed(1)} m from the site`);
    await page.screenshot({ path: path.join(out, `arrival-${site.id}.png`) });
    if (reviewOnly) continue;
    // The card picture: no HUD, a slightly wider and lower view of the sight.
    await page.addStyleTag({
      content:
        'body.in-game .game-viewport~*,body.in-game .game-viewport>*:not(canvas){visibility:hidden!important}',
    });
    // Creatures are pictured from close by, a little off-axis so the traveller
    // does not hide them; the arrival spot itself stays outside their territory.
    const close = { mammoth: 10, sabertooth: 5.5, behemoth: 15 }[site.id];
    const subject =
      site.id === 'mammoth'
        ? room.animals.find((a) => a.id === 'mammoth-1')
        : room.enemies.find((e) =>
            e.modelKey?.startsWith(site.id === 'behemoth' ? 'violet' : site.id),
          );
    let yaw = null;
    if (close && subject) {
      const away = Math.atan2(me.x - subject.x, me.z - subject.z);
      Object.assign(me, {
        x: subject.x + Math.sin(away) * close,
        z: subject.z + Math.cos(away) * close,
        facing: away + Math.PI,
        invulnerableUntil: Date.now() + 60000,
      });
      yaw = away + 0.5;
    }
    await page.evaluate((yaw) => {
      const r = window.spawnReview;
      document.activeElement?.blur();
      if (yaw !== null) r.yaw = yaw;
      r.pitch = 0.14;
      r.distance = r.targetDistance = yaw === null ? 7.5 : 6;
    }, yaw);
    await sleep(1500);
    await page.locator('#world').screenshot({
      path: `public/spawn/${site.id}.jpg`,
      type: 'jpeg',
      quality: 82,
      scale: 'css',
    });
  }
  // Exhibition tuning seen by a real client: always running, faster, no downing.
  const room = game.rooms.get('EXHIBITION');
  const me = [...room.players.values()][0];
  const before = { x: me.x, z: me.z };
  await page
    .locator('#world')
    .click({ position: { x: 640, y: 360 } })
    .catch(() => {});
  await page.keyboard.down('w');
  await sleep(2000);
  facts.run = { speed: me.speed, running: me.running, runningRequested: me.runningRequested };
  await page.keyboard.up('w');
  facts.run.moved = Math.hypot(me.x - before.x, me.z - before.z);
  facts.errors = errors;
  await writeFile(path.join(out, 'facts.json'), JSON.stringify(facts, null, 2));
  console.log(JSON.stringify(facts, null, 2));
} catch (error) {
  const page = context.pages()[0];
  await page?.screenshot({ path: path.join(out, 'failure.png') }).catch(() => {});
  console.log(
    JSON.stringify(
      {
        facts,
        errors,
        world: await page
          ?.evaluate(() => ({ ...document.querySelector('#world')?.dataset }))
          .catch(() => null),
      },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await context.close();
  setTimeout(() => process.exit(), 500).unref();
  void game.close();
}
