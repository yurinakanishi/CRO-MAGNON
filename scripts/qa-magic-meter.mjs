// Isolated in-memory game; the mage casts with the real F key and the HUD meter is sampled in real time.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createGameServer } from '../dist/server.mjs';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);
const folder = 'output/playwright/magic-meter';
await mkdir(folder, { recursive: true });
const game = createGameServer({ port: 0, host: '127.0.0.1' });
const { port } = await game.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.addInitScript(() => {
    localStorage.setItem('cro-name', 'MeterQA');
    localStorage.setItem('cro-species', 'bear');
    localStorage.setItem('cro-gender', 'female');
  });
  await page.goto(`http://127.0.0.1:${port}/?room=MAGIC-METER`);
  await page.locator('#title-start').click();
  await page.locator('#setup-form input[name="name"]').fill('MeterQA');
  await page.locator('#setup-submit').click();
  await page.locator('#guide-start').click();
  await page
    .locator('#world[data-world-asset="ready"][data-character-asset="ready"]')
    .waitFor({ timeout: 90000 });
  const room = game.rooms.get('MAGIC-METER');
  room.enemies = [];
  const button = page.locator('#attack-button');
  const sample = async () =>
    button.evaluate((b) => ({
      disabled: b.disabled,
      cooling: b.classList.contains('cooling'),
      fill: b.style.getPropertyValue('--cooldown'),
      left: b.querySelector('.cooldown-left').hidden
        ? ''
        : b.querySelector('.cooldown-left').textContent,
      title: b.title,
      meterWidth: b.querySelector('.cooldown-meter').getBoundingClientRect().width,
    }));
  await button.waitFor();
  await page.waitForFunction(() => document.querySelector('#attack-button').disabled === false);
  const before = await sample();
  await page
    .locator('#world')
    .click({ position: { x: 700, y: 300 } })
    .catch(() => {});
  await page.keyboard.press('KeyF');
  await sleep(250);
  const samples = [];
  const t0 = Date.now();
  while (Date.now() - t0 < 5600) {
    samples.push({ t: Date.now() - t0, ...(await sample()) });
    if (samples.length === 4) await button.screenshot({ path: `${folder}/meter-early.png` });
    if (samples.length === 16) await button.screenshot({ path: `${folder}/meter-late.png` });
    await sleep(300);
  }
  await button.screenshot({ path: `${folder}/meter-ready.png` });
  await page.screenshot({ path: `${folder}/hud.png` });
  const after = await sample();
  const mage = [...room.players.values()][0];
  assert.equal(mage.attackSequence, 1);
  assert.equal(before.cooling, false);
  assert.ok(samples[0].cooling && samples[0].disabled, 'meter shows right after the cast');
  assert.ok(samples[0].left.endsWith('s'), 'remaining seconds are shown');
  const fills = samples.filter((s) => s.cooling).map((s) => Number(s.fill));
  assert.ok(fills.length >= 12, `meter stays visible for most of the 5s (${fills.length})`);
  for (let i = 1; i < fills.length; i++) assert.ok(fills[i] >= fills[i - 1], 'fill only grows');
  assert.ok(
    fills[0] < 0.2 && fills.at(-1) > 0.8,
    `fill spans the recharge ${fills[0]}→${fills.at(-1)}`,
  );
  assert.equal(after.cooling, false);
  assert.equal(after.disabled, false);
  assert.deepEqual(errors, []);
  await writeFile(
    `${folder}/summary.json`,
    JSON.stringify({ before, samples, after, errors }, null, 2),
  );
  console.log('magic meter ok', samples.map((s) => `${s.t}:${s.fill}:${s.left}`).join(' '));
} finally {
  await browser.close();
  game.close();
}
