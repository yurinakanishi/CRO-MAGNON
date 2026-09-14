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
  await page.locator('#setup-form .character-choice:has(input:checked)').click();
  await page.locator('#setup-flow [data-choose-difficulty="normal"]').click();
  await page.locator('#setup-flow-yes').click();
  await page.waitForSelector('body.in-game', { timeout: 60000 });
  await page
    .locator('#world[data-world-asset="ready"][data-character-asset="ready"]')
    .waitFor({ timeout: 90000 });
  const room = game.rooms.get('MAGIC-METER');
  room.enemies = [];
  const button = page.locator('#magic-cooldown');
  const sample = () =>
    button.evaluate((b) => {
      const progress = b.querySelector('progress');
      return {
        hidden: b.hidden,
        label: b.querySelector('span')?.textContent ?? '',
        value: progress.value,
        max: progress.max,
        ariaValueText: progress.getAttribute('aria-valuetext'),
      };
    });
  await page.waitForSelector('#world[data-attack-available="true"]');
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
    if (samples.length === 10) await button.screenshot({ path: `${folder}/meter-late.png` });
    await sleep(300);
  }
  await page.screenshot({ path: `${folder}/meter-ready.png` });
  await page.screenshot({ path: `${folder}/hud.png` });
  const after = await sample();
  const mage = [...room.players.values()][0];
  assert.equal(mage.attackSequence, 1);
  assert.equal(before.hidden, true);
  assert.ok(!samples[0].hidden, 'recharge bar appears after casting');
  assert.equal(samples[0].label, '魔法を再び使えるまで');
  assert.doesNotMatch(samples[0].label, /\d/);
  const values = samples.filter((s) => !s.hidden).map((s) => s.value);
  assert.ok(values.length >= 8, 'recharge bar remains visible through recharge');
  assert.ok(values.every((value) => value >= 0 && value <= 5000));
  assert.ok(values[values.length - 1] < values[0] - 3000, 'bar continuously loses time');
  for (let i = 1; i < values.length; i++) assert.ok(values[i] <= values[i - 1] + 1);
  assert.ok(samples.filter((s) => !s.hidden).every((s) => s.max === 5000));
  assert.ok(samples.filter((s) => !s.hidden).every((s) => s.ariaValueText === '再使用待ち'));
  assert.equal(after.hidden, true);
  assert.equal(after.value, 0);
  assert.equal(after.ariaValueText, '使用可能');
  assert.equal(await page.locator('#world').getAttribute('data-attack-available'), 'true');
  assert.deepEqual(errors, []);
  await writeFile(
    `${folder}/summary.json`,
    JSON.stringify({ before, samples, after, errors }, null, 2),
  );
  console.log('magic meter ok', samples.map((s) => `${s.t}:${s.hidden}:${s.value}`).join(' '));
} finally {
  await browser.close();
  game.close();
}
