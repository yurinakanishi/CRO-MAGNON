import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const runtime =
  process.env.PLAYWRIGHT_MODULE ||
  'C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
const { chromium } = await import(pathToFileURL(runtime).href);
const label = process.argv[2] || 'before';
const species = process.argv[3] || 'cro';
const out = path.resolve('output/playwright/movement-smoothing', `${label}-${species}`);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  recordVideo: { dir: out, size: { width: 1280, height: 800 } },
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
const stage = async (name) =>
  page.evaluate((name) => {
    window.motionQa.label = name;
  }, name);
const hold = async (key, ms) => {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
};
try {
  if (label === 'before')
    for (const file of ['local-prediction', 'world3d']) {
      const source = await readFile(`output/movement-smoothing/before/${file}.ts`, 'utf8');
      const body = ts.transpileModule(source, {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
      }).outputText;
      await page.route(`**/src/${file}.js`, (route) =>
        route.fulfill({ contentType: 'text/javascript', body }),
      );
    }
  // Profile only; movement, clocks, world state and inventory are not prepared.
  await page.addInitScript((species) => {
    localStorage.setItem('cro-species', species);
    localStorage.setItem('cro-gender', 'female');
    localStorage.setItem('cro-name', 'Movement QA');
  }, species);
  await page.goto(process.env.GAME_QA_URL || 'http://127.0.0.1:3023/?room=SMOOTH-QA');
  await page.locator('#title-start').click();
  await page.locator('#setup-submit').click();
  await page.waitForSelector('#world[data-world-asset="ready"][data-character-asset="ready"]', {
    timeout: 60000,
  });
  await page.locator('#world').focus();
  await page.waitForTimeout(1000);
  await stage('walk');
  await hold('w', 2200);
  await stage('stop');
  await page.waitForTimeout(500);
  await page.keyboard.press('Shift');
  await page.locator('#world').focus();
  await stage('run');
  await hold('s', 2000);
  await stage('stop');
  await page.waitForTimeout(700);
  await stage('turn');
  await hold('a', 650);
  await page.waitForTimeout(300);
  await hold('d', 650);
  await stage('stop');
  await page.waitForTimeout(700);
  await stage('jump');
  await page.keyboard.press('Space');
  await page.waitForTimeout(950);
  await stage('attack');
  await page.keyboard.press('f');
  await page.waitForTimeout(950);
  await stage('idle');
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(out, 'desktop.png') });
  const frames = await page.evaluate(() => window.motionQa.frames);
  const metrics = [];
  for (const name of ['walk', 'run', 'stop']) {
    let segmentStart = 0,
      previousLabel;
    const stable = frames.filter((f) => {
      if (f.label !== previousLabel) {
        segmentStart = f.t;
        previousLabel = f.label;
      }
      return f.label === name && f.t > segmentStart + 0.4;
    });
    const speeds = stable.map((f) => f.speed);
    const maxYawError = Math.max(
      0,
      ...stable.map((f) =>
        Math.abs(Math.atan2(Math.sin(f.yaw - f.facing), Math.cos(f.yaw - f.facing))),
      ),
    );
    let backwards = 0;
    for (let i = 1; i < stable.length; i++) {
      const f = stable[i],
        p = stable[i - 1];
      if ((f.x - p.x) * Math.sin(f.facing) + (f.z - p.z) * Math.cos(f.facing) < -0.001) backwards++;
    }
    metrics.push({
      name,
      frames: stable.length,
      minSpeed: Math.min(...speeds),
      maxSpeed: Math.max(...speeds),
      maxYawError,
      backwards,
      idleFrames: stable.filter((f) => f.clip === 'Idle_Loop').length,
      hiddenFrames: stable.filter((f) => !f.visible).length,
      shadowFrames: stable.filter((f) => f.shadow).length,
      meanCostMs: stable.reduce((s, f) => s + f.cost, 0) / stable.length,
      meanFrameMs: stable.reduce((s, f) => s + f.dt * 1000, 0) / stable.length,
    });
  }
  await writeFile(path.join(out, 'frames.json'), JSON.stringify(frames));
  await writeFile(
    path.join(out, 'summary.json'),
    JSON.stringify(
      {
        label,
        species,
        metrics,
        errors,
        fixtures:
          'Profile only; real keyboard input and unmodified game clock/positions/inventory.',
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ label, species, metrics, errors }, null, 2));
  assert.deepEqual(errors, []);
  if (label !== 'before')
    for (const m of metrics.filter((m) => ['walk', 'run'].includes(m.name))) {
      assert.ok(m.frames > 15, `${m.name}: enough observed frames`);
      assert.ok(m.maxYawError < 0.35, `${m.name}: forward motion must not turn the body backwards`);
      assert.equal(m.hiddenFrames, 0);
    }
  if (label !== 'before') {
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 844, height: 390 },
    ]) {
      await page.setViewportSize(viewport);
      await page.screenshot({ path: path.join(out, `${viewport.width}x${viewport.height}.png`) });
    }
    await page.reload();
    await page.locator('#title-start').click();
    await page.waitForSelector('#world[data-world-asset="ready"][data-character-asset="ready"]', {
      timeout: 60000,
    });
    await page.locator('#world').focus();
    await hold('w', 500);
    await page.waitForTimeout(300);
    assert.deepEqual(errors, []);
  }
} finally {
  await context.close();
  await browser.close();
}
