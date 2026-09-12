// Deterministic 30 fps evidence: two full-speed attacks, then one at half speed.
import { mkdir, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);
const revision = process.argv[2] || 'revision-02',
  out = path.resolve(
    'output/playwright/spear-thrusts',
    revision,
    process.env.SPEAR_REVIEW_VARIANT || '.',
  );
const browser = await chromium.launch({ channel: 'chrome', headless: true }),
  page = await browser.newPage();
try {
  await page.goto('http://127.0.0.1:3038');
  await page.waitForFunction(() => document.querySelector('#status')?.textContent.includes('完了'));
  await page.selectOption('#version', revision);
  const keys = await page.locator('#model option').evaluateAll((els) => els.map((e) => e.value));
  for (const key of keys) {
    await page.selectOption('#model', key);
    await page.waitForFunction(
      ({ key, revision }) =>
        document.querySelector('#status').textContent.startsWith(`${key} · ${revision}`) &&
        document.querySelector('#status').textContent.endsWith('完了'),
      { key, revision },
    );
    const dir = path.join(out, key + '-frames');
    await mkdir(dir, { recursive: true });
    for (let f = 0; f < 120; f++) {
      const time = f < 60 ? (f % 30) / 30 : (f - 60) / 60;
      const image = await page.evaluate(
        ({ time, slow, key }) => {
          const canvas = document.createElement('canvas');
          canvas.width = 720;
          canvas.height = 375;
          const ctx = canvas.getContext('2d');
          const c = thrustReview.cells[0];
          c.time = Math.min(0.7, time);
          ['left', 'angle'].forEach((view, i) => {
            document.querySelector('#view').value = view;
            thrustReview.render([c]);
            ctx.drawImage(c.canvas, i * 360, 35);
          });
          ctx.fillStyle = '#263640';
          ctx.fillRect(0, 0, 720, 35);
          ctx.fillStyle = 'white';
          ctx.font = '16px system-ui';
          ctx.fillText(`${key} · ${slow ? '0.5×' : '1×'} · 両手で構え、左足で踏み込む`, 16, 24);
          return canvas.toDataURL('image/png').split(',')[1];
        },
        { time, slow: f >= 60, key },
      );
      await writeFile(
        path.join(dir, `${String(f).padStart(3, '0')}.png`),
        Buffer.from(image, 'base64'),
      );
    }
    await promisify(execFile)(
      'ffmpeg',
      [
        '-y',
        '-hide_banner',
        '-loglevel',
        'error',
        '-framerate',
        '30',
        '-i',
        path.join(dir, '%03d.png'),
        '-frames:v',
        '120',
        '-vf',
        'pad=ceil(iw/2)*2:ceil(ih/2)*2',
        '-c:v',
        'libx264',
        '-crf',
        '18',
        '-pix_fmt',
        'yuv420p',
        '-movflags',
        '+faststart',
        path.join(out, key + '.mp4'),
      ],
      { windowsHide: true },
    );
    console.log('Video', key);
  }
} finally {
  await browser.close();
}
