import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);
const revision = process.argv[2] || 'revision-02',
  out = path.resolve('output/playwright/player-gaits', revision);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1800, height: 820 } }),
  errors = [],
  records = [];
page.on('pageerror', (e) => errors.push(String(e)));
try {
  await page.goto('http://127.0.0.1:3037');
  await page.waitForFunction(() => document.querySelector('#status')?.textContent.includes('完了'));
  await page.selectOption('#version', revision);
  const keys = await page.locator('#model option').evaluateAll((els) => els.map((e) => e.value));
  for (const key of keys) {
    await page.selectOption('#model', key);
    await page.waitForFunction(
      ({ key, revision }) =>
        document.querySelector('#status').textContent === `${key} · ${revision} · 完了`,
      { key, revision },
    );
    for (const view of ['side', 'front', 'back', 'left', 'angle']) {
      await page.selectOption('#view', view);
      await page.screenshot({ path: path.join(out, `${key}-${view}.png`) });
    }
    // Record the exact loaded candidate at 30 fps, without a duplicated end frame.
    const video = await page.evaluate(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 600;
      canvas.height = 340;
      const context = canvas.getContext('2d'),
        stream = canvas.captureStream(30),
        parts = [];
      const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9' });
      recorder.ondataavailable = (e) => {
        if (e.data.size) parts.push(e.data);
      };
      const done = new Promise(
        (resolve) =>
          (recorder.onstop = async () => {
            const bytes = new Uint8Array(await new Blob(parts).arrayBuffer());
            let text = '';
            for (const b of bytes) text += String.fromCharCode(b);
            resolve(btoa(text));
          }),
      );
      recorder.start();
      for (let f = 0; f < 120; f++) {
        for (const c of gaitReview.cells) c.phase = (f / 30 / c.clip.duration) % 1;
        gaitReview.render();
        context.drawImage(gaitReview.cells[0].canvas, 0, 0);
        context.drawImage(gaitReview.cells[6].canvas, 300, 0);
        await new Promise((r) => setTimeout(r, 1000 / 30));
      }
      recorder.stop();
      stream.getTracks().forEach((t) => t.stop());
      return done;
    });
    await writeFile(path.join(out, `${key}.webm`), Buffer.from(video, 'base64'));
    records.push({ key, revision, views: 5, phases: 6, fps: 30, frames: 120 });
    console.log('Reviewed', key);
  }
  await writeFile(path.join(out, 'report.json'), JSON.stringify({ records, errors }, null, 2));
  if (errors.length) throw Error(errors.join('\n'));
} finally {
  await browser.close();
}
