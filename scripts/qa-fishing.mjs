// Isolated real Chrome QA. Fixtures are recorded separately from DOM/gamepad play.
import { mkdir, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { WebSocket } from 'ws';
const build = process.env.GAME_QA_BUILD || new URL('../dist/', import.meta.url).href;
const { createGameServer } = await import(build + 'server.mjs');
const { createGameCore } = await import(build + 'application/game-core.mjs');
const { stopActor } = await import(build + 'shared/combat.mjs');
const { GULF_ENTRY } = await import(build + 'shared/gulf-region.mjs');
const { FISHING_SITES } = await import(build + 'shared/fishing-sites.mjs');
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);
const core = createGameCore(),
  game = createGameServer({ core, port: 0, host: '127.0.0.1' });
const folder = process.argv[2] || 'output/playwright/fishing';
await mkdir(folder, { recursive: true });
const address = await game.listen(),
  base = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--use-angle=d3d11'],
});
const pages = [],
  errors = [],
  peers = [],
  observations = [],
  fixtures = [],
  fps = [],
  commands = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function addPage(name) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(
    ({ name }) => {
      localStorage.setItem('cro-name', name);
      localStorage.setItem('cro-species', 'nea');
      localStorage.setItem('cro-gender', 'female');
      window.qaPad = {
        id: 'Wireless Controller (STANDARD GAMEPAD)',
        index: 0,
        connected: true,
        mapping: 'standard',
        axes: [0, 0, 0, 0],
        buttons: Array.from({ length: 18 }, () => ({ pressed: false, value: 0 })),
      };
      window.qaPadEnabled = false;
      Object.defineProperty(navigator, 'getGamepads', {
        configurable: true,
        value: () => (window.qaPadEnabled ? [window.qaPad] : []),
      });
    },
    { name },
  );
  const p = await context.newPage();
  pages.push(p);
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await p.goto(`${base}/?room=FISH-QA&autostart=1`, { waitUntil: 'domcontentloaded' });
  await p
    .locator('#world[data-world-asset="ready"][data-character-asset="ready"]')
    .waitFor({ timeout: 90000 });
  return p;
}
const page = await addPage('魚場A');
await page.screenshot({ path: `${folder}/01-ready.png` });
console.log(
  JSON.stringify({
    ready: true,
    base,
    errors,
    ui: (await page.locator('body').ariaSnapshot()).slice(0, 3500),
  }),
);
const room = () => core.rooms.get('FISH-QA');
const actor = (name = '魚場A') => [...room().players.values()].find((p) => p.name === name);
const sampler = setInterval(() => {
  const s = core.snapshot(room());
  observations.push({
    players: s.players.length,
    positions: s.players.map((p) => ({
      name: p.name,
      x: p.x,
      z: p.z,
      boatId: p.boatId,
      free: !!p.boatId || room().collision.free(p, p.radius),
      fishing: p.fishing?.spotId,
      rawFish: p.inventory.rawFish,
      cookedFish: p.inventory.cookedFish,
    })),
  });
}, 250);
const rl = createInterface({ input: process.stdin });
try {
  for await (const line of rl) {
    try {
      const q = JSON.parse(line),
        p = pages[q.page ?? 0];
      let r;
      commands.push(q);
      if (q.type === 'key') {
        await p.keyboard.press(q.key);
        r = { key: q.key };
      }
      if (q.type === 'hold') {
        await p.keyboard.down(q.key);
        await sleep(Math.min(q.ms, 10000));
        await p.keyboard.up(q.key);
        r = { held: q.key };
      }
      if (q.type === 'click') {
        await p.locator(q.selector).click({ timeout: 8000 });
        r = { clicked: q.selector };
      }
      if (q.type === 'probe') r = { ui: await p.locator('body').ariaSnapshot(), errors };
      if (q.type === 'compact')
        r = {
          players: core
            .snapshot(room())
            .players.map((p) => ({
              name: p.name,
              x: p.x,
              z: p.z,
              moving: p.moving,
              boatId: p.boatId,
              fishing: p.fishing,
              gulf: p.gulf,
              inventory: p.inventory,
              cookingEndsAt: p.cookingEndsAt,
              energy: p.energy,
            })),
          shoals: room().gulf.shoals,
          stores: room().gulf.stores,
          errors,
        };
      if (q.type === 'shot') {
        await p.screenshot({ path: `${folder}/${q.file}.png` });
        fps.push(
          await p
            .locator('#world')
            .evaluate((c) => ({ fps: c.dataset.fps, chunks: c.dataset.terrainChunks })),
        );
        r = { path: `${folder}/${q.file}.png` };
      }
      if (q.type === 'viewport') {
        await p.setViewportSize({ width: q.width, height: q.height });
        r = { viewport: q };
      }
      if (q.type === 'reload') {
        await p.reload({ waitUntil: 'domcontentloaded' });
        await p
          .locator('#world[data-world-asset="ready"][data-character-asset="ready"]')
          .waitFor({ timeout: 90000 });
        r = { reloaded: true };
      }
      if (q.type === 'addPage') {
        await addPage(q.name);
        r = { pages: pages.length };
      }
      if (q.type === 'addPeers') {
        for (let i = 0; i < q.count; i++) {
          const s = new WebSocket(
            `${base.replace('http', 'ws')}/ws?room=FISH-QA&name=Peer${i}&species=cro&resume=1`,
          );
          peers.push(s);
          await new Promise((res) => s.once('open', res));
          s.send(JSON.stringify({ type: 'expedition', destination: GULF_ENTRY.id }));
        }
        r = { peers: peers.length };
      }
      if (q.type === 'fixture') {
        const a = actor(q.name);
        stopActor(a);
        if (q.x !== undefined) a.x = q.x;
        if (q.z !== undefined) a.z = q.z;
        if (q.inventory) Object.assign(a.inventory, q.inventory);
        if (q.energy !== undefined) a.energy = q.energy;
        fixtures.push(q);
        r = { fixture: true, name: a.name, x: a.x, z: a.z };
      }
      if (q.type === 'pad') {
        await p.locator('#world').focus();
        await p.evaluate(() => (window.qaPadEnabled = true));
        await sleep(250);
        await p.evaluate((i) => (window.qaPad.buttons[i] = { pressed: true, value: 1 }), q.button);
        await sleep(160);
        await p.evaluate((i) => (window.qaPad.buttons[i] = { pressed: false, value: 0 }), q.button);
        r = { pad: q.button };
      }
      if (q.type === 'layout')
        r = await p.evaluate(() => ({
          width: innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
          modal: document.querySelector('#modal')?.getBoundingClientRect().toJSON(),
          overflow: [...document.querySelectorAll('#modal button')]
            .filter((b) => b.getBoundingClientRect().width > innerWidth)
            .map((b) => b.id),
        }));
      if (q.type === 'save') {
        const report = {
          at: new Date().toISOString(),
          errors,
          fps,
          fixtures,
          commands,
          renderedPages: pages.length,
          peers: peers.length,
          samples: observations.length,
          maxPlayers: Math.max(...observations.map((o) => o.players)),
          collisionViolations: observations.flatMap((o) => o.positions.filter((p) => !p.free)),
          state: core.snapshot(room(), true),
          notes: q.notes,
        };
        await writeFile(`${folder}/report.json`, JSON.stringify(report, null, 2));
        r = { saved: true, errors, samples: observations.length, maxPlayers: report.maxPlayers };
      }
      if (q.type === 'quit') {
        console.log('{"closed":true}');
        break;
      }
      console.log(JSON.stringify(r ?? { unknown: q }));
    } catch (error) {
      console.log(JSON.stringify({ error: String(error) }));
    }
  }
} finally {
  clearInterval(sampler);
  rl.close();
  await browser.close();
  for (const s of peers) s.close();
  await game.close();
}
