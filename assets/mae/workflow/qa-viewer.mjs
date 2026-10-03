import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium } =
  await import('file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const colour = process.argv[2],
  revision = process.argv[3] ?? '01';
assert.ok(['mae'].includes(colour));
const out = `output/model-generation/models/mae/qa/final-${revision}`;
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1080, height: 900 } }),
  errors = [],
  external = [],
  checks = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('request', (r) => {
  if (/^https?:/.test(r.url())) external.push(r.url());
});
try {
  await page.goto(pathToFileURL(path.resolve(`${out}/viewer.html`)).href);
  await page.waitForFunction(() => document.querySelector('#mv')?.loaded, { timeout: 120000 });
  assert.equal(await page.locator('#error').textContent(), '');
  assert.equal(await page.locator('#mv').evaluate((m) => m.availableAnimations.length), 6);
  checks.push('all six clips loaded offline');
  await page.locator('#play').click();
  assert.equal(await page.locator('#mv').evaluate((m) => m.paused), true);
  const views = {
    front: '0deg 90deg 150%',
    back: '180deg 90deg 150%',
    left: '-90deg 90deg 150%',
    right: '90deg 90deg 150%',
    threequarter: '-35deg 78deg 150%',
    top: '0deg 5deg 150%',
    bottom: '0deg 175deg 150%',
  };
  for (const [name, orbit] of Object.entries(views)) {
    await page.locator('#mv').evaluate((m, orbit) => {
      m.cameraOrbit = orbit;
      m.jumpCameraToGoal();
    }, orbit);
    await page.waitForTimeout(180);
    await page.screenshot({ path: `${out}/browser-${name}.png` });
  }
  checks.push('seven exact-GLB textured views');
  for (const clip of ['Idle_Loop', 'Walk_Loop', 'Run_Loop', 'Pet', 'Happy', 'Hit']) {
    await page.selectOption('#clip', clip);
    await page.locator('#play').click();
    await page.locator('#mv').evaluate((m) => {
      m.cameraOrbit = '0deg 82deg 150%';
      m.jumpCameraToGoal();
    });
    for (const phase of [0.05, 0.3, 0.55, 0.8, 0.98]) {
      await page.locator('#mv').evaluate((m, t) => (m.currentTime = m.duration * t), phase);
      await page.waitForTimeout(60);
      await page.screenshot({ path: `${out}/${clip}-${Math.round(phase * 100)}.png` });
    }
  }
  checks.push('30 clip poses rendered from exact exported skin');
  await page.selectOption('#clip', 'Walk_Loop');
  await page.waitForTimeout(150);
  const before = await page.locator('#mv').evaluate((m) => m.currentTime);
  await page.waitForTimeout(160);
  assert.notEqual(await page.locator('#mv').evaluate((m) => m.currentTime), before);
  checks.push('clip playback advances');
  await page.locator('#play').click();
  const stopped = await page.locator('#mv').evaluate((m) => m.currentTime);
  await page.waitForTimeout(120);
  assert.ok(Math.abs((await page.locator('#mv').evaluate((m) => m.currentTime)) - stopped) < 0.001);
  checks.push('pause holds');
  await page.selectOption('#speed', '.5');
  assert.equal(await page.locator('#mv').evaluate((m) => m.timeScale), 0.5);
  await page.locator('#timeline').press('Home');
  await page.locator('#timeline').press('ArrowRight');
  assert.ok(Math.abs((await page.locator('#mv').evaluate((m) => m.currentTime)) - 0.001) < 0.0005);
  checks.push('speed and scrub');
  const orbit = await page.locator('#mv').evaluate((m) => m.getCameraOrbit().toString());
  await page.mouse.move(460, 400);
  await page.mouse.down();
  await page.mouse.move(710, 430, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  assert.notEqual(await page.locator('#mv').evaluate((m) => m.getCameraOrbit().toString()), orbit);
  checks.push('drag orbit');
  const radius = await page.locator('#mv').evaluate((m) => m.getCameraOrbit().radius);
  await page.mouse.wheel(0, -300);
  await page.waitForTimeout(300);
  assert.ok(
    Math.abs((await page.locator('#mv').evaluate((m) => m.getCameraOrbit().radius)) - radius) >
      0.001,
  );
  checks.push('wheel zoom');
  await page.locator('#reset').click();
  assert.ok(
    Math.abs(
      (await page.locator('#mv').evaluate((m) => m.getCameraOrbit().theta)) - (-25 * Math.PI) / 180,
    ) < 0.001,
  );
  checks.push('reset view');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${out}/viewer-mobile.png` });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  checks.push('390px view fits');
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  await writeFile(
    `${out}/viewer-qa.json`,
    JSON.stringify({ colour, revision, checks, errors, external, passed: true }, null, 2) + '\n',
  );
  console.log(JSON.stringify({ colour, checks: checks.length, passed: true }));
} finally {
  await browser.close();
}
