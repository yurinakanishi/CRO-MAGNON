// Neutral before/after captures for the 2026-10 asset remake.
// Renders exact served GLBs through the existing model-review page (fixed hemisphere +
// sun lighting, metre grid) so old and new deliveries share camera, light and pose.
// Usage: node scripts/qa-remake-neutral-views.mjs <jobs.json>
//   jobs.json: [{ "out": "output/asset-remake/<key>/before", "model": "/models/<key>/x.glb",
//                 "views": [{ "camera": "front", "clip": "Walk_Loop", "t": 0.25 }], "count": 1 }]
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createGameServer } from '../dist/server.mjs';
const { chromium } =
  await import('file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');

const jobs = JSON.parse(await readFile(process.argv[2], 'utf8'));
const game = createGameServer({ port: 0, host: '127.0.0.1' });
const { port } = await game.listen();
// QA_SOFTWARE_GL=1: render with SwiftShader so these captures never compete with TRELLIS for the 6 GB GPU.
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: process.env.QA_SOFTWARE_GL ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : [],
});
const context = await browser.newContext({ viewport: { width: 1100, height: 860 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = [];
try {
  for (const job of jobs) {
    await mkdir(job.out, { recursive: true });
    await page.goto(
      `http://127.0.0.1:${port}/model-review.html?model=${encodeURIComponent(job.model)}`,
    );
    await page.waitForFunction(
      () => !document.querySelector('#clip').disabled || /頂点|三角形|triangles|m /.test(document.querySelector('#model-info').textContent),
      null,
      { timeout: 240000 },
    );
    await sleep(800);
    if (job.count) {
      await page.selectOption('#count', String(job.count)).catch(() => {});
      await sleep(400);
    }
    if (job.hideGround) await page.locator('#ground').uncheck().catch(() => {});
    const info = await page.locator('#model-info').textContent();
    for (const view of job.views) {
      await page.selectOption('#camera', view.camera);
      const clips = await page.$$eval('#clip option', (o) => o.map((x) => x.value));
      if (view.clip && clips.includes(view.clip)) {
        await page.selectOption('#clip', view.clip);
        await sleep(150);
        await page.$eval(
          '#timeline',
          (el, t) => {
            el.value = String(t);
            el.dispatchEvent(new Event('input'));
          },
          view.t ?? 0,
        );
      } else {
        await page.selectOption('#clip', '');
      }
      await sleep(500);
      const name = `${view.camera}${view.clip ? `-${view.clip}-${String(view.t ?? 0).replace('.', '_')}` : ''}.png`;
      await page.locator('#viewport').screenshot({ path: path.join(job.out, name) });
      report.push({ model: job.model, file: path.join(job.out, name), ...view });
    }
    report.push({ model: job.model, info });
  }
} finally {
  await writeFile(
    path.join(jobs[0].out, '..', 'neutral-views-report.json'),
    JSON.stringify({ errors, report }, null, 2),
  ).catch(() => {});
  await browser.close();
  await game.close();
}
console.log(JSON.stringify({ captures: report.length, errors }, null, 1));
