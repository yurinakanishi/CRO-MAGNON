// Actual Chrome + isolated authoritative server. Only profile choices and Gamepad input are fixtures.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const build =
  process.env.GAME_QA_BUILD || new URL('../output/jump/preview/dist/', import.meta.url).href;
const { createGameServer } = await import(build + 'server.mjs');
const { CHARACTER_MODELS } = await import(build + 'shared/characters.mjs');
const { JUMP } = await import(build + 'shared/jumping.mjs');
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);
const output = process.argv[2] || 'output/playwright/jump-20260909';
await mkdir(output, { recursive: true });
const game = createGameServer({ port: 0, host: '127.0.0.1' });
const address = await game.listen(),
  checks = [],
  errors = [],
  evidence = [];
const base = `http://127.0.0.1:${address.port}`;
let browser, page;
const passed = (name) => {
  checks.push(name);
  console.log(`PASS ${name}`);
};
async function join(profile, name, room, normal = false, touch = false) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    hasTouch: touch,
  });
  await context.addInitScript(
    ({ profile, name }) => {
      localStorage.setItem('cro-name', name);
      localStorage.setItem('cro-species', profile.species);
      localStorage.setItem('cro-gender', profile.gender);
      window.qaPad = {
        id: 'Wireless Controller',
        index: 0,
        connected: true,
        mapping: 'standard',
        axes: [0, 0, 0, 0],
        buttons: Array.from({ length: 18 }, () => ({ pressed: false, value: 0 })),
      };
      Object.defineProperty(navigator, 'getGamepads', { value: () => [window.qaPad] });
    },
    { profile, name },
  );
  const p = await context.newPage();
  p.on('pageerror', (error) => errors.push(String(error)));
  p.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  await p.goto(`${base}/?room=${room}${normal ? '' : '&autostart=1'}`);
  if (normal) {
    await p.locator('#title-start').click();
    await p.locator('#setup-submit').click();
    await p.locator('#guide-start').waitFor({ state: 'visible', timeout: 60000 });
    assert.match(await p.locator('#screen-guide').innerText(), /ジャンプ/);
    await p.locator('#guide-start').click();
  }
  await p.waitForSelector('#world[data-world-asset="ready"][data-character-asset="ready"]', {
    timeout: 60000,
  });
  await p.locator('#world').focus();
  await p.evaluate(async () => {
    const { WorldRenderer } = await import('/src/world3d.js');
    const original = WorldRenderer.prototype.render;
    window.jumpSamples = [];
    // Read-only observation of actual rendered transforms after each real frame.
    WorldRenderer.prototype.render = function (...args) {
      const result = original.apply(this, args);
      window.jumpSamples.push({
        at: this.serverNow(),
        self: this.selfId,
        actors: [...this.players.values()]
          .filter((e) => e.actor)
          .map((e) => ({
            id: e.state.id,
            name: e.state.name,
            x: e.model.position.x,
            y: e.model.position.y,
            z: e.model.position.z,
            sequence: e.state.jumpSequence ?? 0,
            jumpAt: e.state.jumpAt ?? 0,
            animation: e.actor.animation.name,
          })),
      });
      if (window.jumpSamples.length > 2000) window.jumpSamples.shift();
      return result;
    };
  });
  return p;
}
const me = (name) =>
  [...game.rooms.values()].flatMap((r) => [...r.players.values()]).find((p) => p.name === name);
const wait = async (predicate) => {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('Timed out waiting for authoritative jump');
};
const samples = (p) => p.evaluate(() => window.jumpSamples);
const clear = (p) =>
  p.evaluate(() => {
    window.jumpSamples = [];
  });
const pressPad = (p, held) =>
  p.evaluate((value) => {
    window.qaPad.buttons[6] = { pressed: value, value: value ? 1 : 0 };
  }, held);
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  page = await join(CHARACTER_MODELS[0], 'Jump A', 'JUMP-UI', true, true);
  const peer = await join(CHARACTER_MODELS[4], 'Jump B', 'JUMP-UI');
  await page.waitForSelector('#world[data-glb-players="2"]', { timeout: 60000 });
  await peer.waitForSelector('#world[data-glb-players="2"]', { timeout: 60000 });
  await page.bringToFront();
  await clear(page);
  await clear(peer);
  await page.keyboard.down('Space');
  await wait(() => me('Jump A').jumpSequence === 1);
  await page.waitForTimeout(320);
  await page.screenshot({ path: `${output}/keyboard-airborne.png` });
  await page.waitForTimeout(700);
  await page.keyboard.down('Space'); // auto-repeat must not restart after landing
  await page.waitForTimeout(300);
  assert.equal(me('Jump A').jumpSequence, 1);
  await page.keyboard.up('Space');
  const local = (await samples(page)).flatMap((s) =>
      s.actors.filter((a) => a.name === 'Jump A').map((a) => ({ ...a, at: s.at })),
    ),
    remote = (await samples(peer)).flatMap((s) =>
      s.actors.filter((a) => a.name === 'Jump A').map((a) => ({ ...a, at: s.at })),
    );
  for (const observation of [local, remote]) {
    const air = observation.filter((s) => s.animation === 'Jump');
    assert.ok(air.length > 0);
    const ground = observation.findLast((s) => s.animation !== 'Jump');
    assert.ok(ground);
    assert.ok(Math.max(...air.map((s) => s.y)) - ground.y > 0.7);
    assert.ok(air.every((s) => s.sequence === 1));
  }
  evidence.push({ kind: 'local-peer', local, remote });
  passed(
    'Normal title/setup/guide start; Space arc visible on both real clients; held key jumps once and lands',
  );

  const origin = { x: me('Jump A').x, z: me('Jump A').z };
  await clear(page);
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(120);
  await page.keyboard.press('Space');
  await page.waitForTimeout(850);
  await page.keyboard.up('KeyW');
  await page.waitForTimeout(200);
  assert.ok(Math.hypot(me('Jump A').x - origin.x, me('Jump A').z - origin.z) > 0.2);
  assert.ok(
    (await samples(page)).some((s) =>
      s.actors.some((a) => a.name === 'Jump A' && a.animation === 'Jump'),
    ),
  );
  await page.locator('#run-button').click();
  await page.locator('#world').focus();
  await page.keyboard.down('KeyS');
  await page.waitForTimeout(150);
  await page.keyboard.press('Space');
  await page.waitForTimeout(100);
  assert.equal(me('Jump A').running, true);
  await page.waitForTimeout(700);
  await page.keyboard.up('KeyS');
  await page.locator('#run-button').click();
  await page.locator('#world').focus();
  passed('Walking and running retain horizontal movement throughout jumping');

  await page.waitForTimeout(200);
  const previous = me('Jump A').jumpSequence;
  await pressPad(page, true);
  await wait(() => me('Jump A').jumpSequence === previous + 1);
  await page.waitForTimeout(1150);
  assert.equal(me('Jump A').jumpSequence, previous + 1);
  await pressPad(page, false);
  await page.waitForTimeout(120);
  await page.keyboard.press('Escape');
  await pressPad(page, true);
  await page.waitForTimeout(200);
  assert.equal(me('Jump A').jumpSequence, previous + 1);
  await page.locator('#modal-close').click();
  await page.waitForTimeout(200);
  assert.equal(me('Jump A').jumpSequence, previous + 1);
  await pressPad(page, false);
  await page.waitForTimeout(120);
  await pressPad(page, true);
  await wait(() => me('Jump A').jumpSequence === previous + 2);
  await pressPad(page, false);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(900);
  assert.equal(me('Jump A').jumpSequence, previous + 2);
  await page.locator('#modal-close').click();
  assert.doesNotMatch(await page.locator('#toast-stack').innerText(), /着地してから/);
  passed(
    'Simulated L2 jumps once; menu/focus release gate holds, and opening a menu midair still lands',
  );

  await page.locator('#chat-toggle').click();
  await page.locator('#chat-input').fill('jump');
  const chatSeq = me('Jump A').jumpSequence;
  await page.keyboard.press('Space');
  assert.equal(await page.locator('#chat-input').inputValue(), 'jump ');
  assert.equal(me('Jump A').jumpSequence, chatSeq);
  await page.locator('#chat-toggle').click();
  passed('Typing a space in chat never jumps');

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(250);
    const b = await page.locator('#jump-button').boundingBox();
    assert.ok(
      b.x >= 0 && b.y >= 0 && b.x + b.width <= viewport.width && b.y + b.height <= viewport.height,
    );
    const before = me('Jump A').jumpSequence;
    await page.locator('#jump-button').tap();
    await wait(() => me('Jump A').jumpSequence === before + 1);
    await page.waitForTimeout(220);
    await page.screenshot({ path: `${output}/touch-${viewport.width}x${viewport.height}.png` });
    await page.waitForTimeout(700);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }
  passed('Touch button works and remains inside portrait and landscape mobile viewports');
  const oldId = me('Jump A').id;
  await page.locator('#jump-button').tap();
  await wait(() => me('Jump A').jumpAt > Date.now() - 500);
  await page.reload();
  await page.locator('#title-continue').click();
  await page.waitForSelector('#world[data-character-asset="ready"]', { timeout: 60000 });
  await wait(() => me('Jump A')?.id === oldId && me('Jump A').jumpSequence === 0);
  passed('Reload during jump resumes the same player on the ground');
  await page.context().close();
  await peer.context().close();

  for (const profile of CHARACTER_MODELS) {
    page = await join(profile, 'Model QA', `JUMP-${profile.key}`);
    await clear(page);
    await page.keyboard.press('Space');
    await wait(() => me('Model QA').jumpSequence === 1);
    await page.waitForTimeout(270);
    await page.screenshot({ path: `${output}/${profile.key}.png` });
    await page.waitForTimeout(850);
    const observation = (await samples(page)).flatMap((s) =>
      s.actors.filter((a) => a.name === 'Model QA'),
    );
    assert.ok(
      observation.some((a) => a.animation === 'Jump'),
      profile.key,
    );
    assert.equal(observation.at(-1).animation, 'Idle_Loop', profile.key);
    await page.keyboard.press('KeyF');
    await wait(() => me('Model QA').attackSequence === 1);
    evidence.push({ kind: 'model', model: profile.key, samples: observation });
    await page.context().close();
    await wait(() => !me('Model QA'));
  }
  passed('All six model choices visibly jump, land and can attack after landing');
  assert.deepEqual(errors, []);
  await writeFile(
    `${output}/report.json`,
    JSON.stringify(
      {
        checks,
        errors,
        physics: JUMP,
        evidence,
        fixtures: ['Profile selections', 'navigator.getGamepads input'],
        physicalController: false,
        physicalTouchscreen: false,
      },
      null,
      2,
    ),
  );
} catch (error) {
  await page?.screenshot({ path: `${output}/failure.png` }).catch(() => {});
  await writeFile(
    `${output}/failure.json`,
    JSON.stringify({ checks, errors, error: String(error) }, null, 2),
  );
  throw error;
} finally {
  await browser?.close();
  await game.close();
}
