// Deterministic video frames from the actual textured GLBs, encoded at 30 fps.
import { mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);
const revision = process.argv[2] || 'revision-05',
  key = process.argv[3] || 'cro-magnon-hunter';
const out = path.resolve(`output/playwright/player-gaits/${revision}/comparison-${key}`);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1800, height: 820 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
try {
  await page.goto('http://127.0.0.1:3037');
  await page.waitForFunction(() => document.querySelector('#status').textContent.includes('完了'));
  await page.selectOption('#model', key);
  await page.waitForFunction(
    (key) =>
      document.querySelector('#status').textContent.includes(key) &&
      document.querySelector('#status').textContent.includes('完了'),
    key,
  );
  for (const [version, label] of [
    ['baseline', '最初の走り'],
    ['revision-02', '前回の変更'],
    [revision, '今回の修正'],
  ]) {
    await page.selectOption('#version', version);
    await page.waitForFunction(
      ({ key, version }) =>
        document.querySelector('#status').textContent === `${key} · ${version} · 完了`,
      { key, version },
    );
    await page.selectOption('#view', 'side');
    const dir = path.join(out, version);
    await mkdir(dir, { recursive: true });
    for (let f = 0; f < 180; f++) {
      const png = await page.evaluate(
        ({ f, label }) => {
          const cell = gaitReview.cells[6],
            rate = f < 90 ? 1.5 : 0.75;
          // Rendering times, independent of screenshot or machine speed.
          cell.phase = ((((f % 90) / 30) * rate) / cell.clip.duration) % 1;
          gaitReview.render();
          const canvas = document.createElement('canvas');
          canvas.width = 300;
          canvas.height = 400;
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#dde3e5';
          ctx.fillRect(0, 0, 300, 400);
          ctx.drawImage(cell.canvas, 0, 54);
          ctx.fillStyle = '#20303b';
          ctx.font = 'bold 20px sans-serif';
          ctx.fillText(label, 14, 25);
          ctx.font = '14px sans-serif';
          ctx.fillText(
            f < 90 ? 'ゲームの再生速度（1.5倍）' : '上の速度のスロー再生（1/2）',
            14,
            47,
          );
          return canvas.toDataURL('image/png').split(',')[1];
        },
        { f, label },
      );
      await writeFile(
        path.join(dir, `${String(f).padStart(3, '0')}.png`),
        Buffer.from(png, 'base64'),
      );
    }
    console.log('Comparison frames', key, version);
  }
} finally {
  await browser.close();
}
if (errors.length) throw Error(errors.join('\n'));
const args = ['-y', '-loglevel', 'error'];
for (const version of ['baseline', 'revision-02', revision])
  args.push('-framerate', '30', '-i', path.join(out, version, '%03d.png'));
args.push(
  '-filter_complex',
  'hstack=inputs=3',
  '-c:v',
  'libx264',
  '-pix_fmt',
  'yuv420p',
  '-crf',
  '18',
  '-movflags',
  '+faststart',
  path.join(out, 'comparison.mp4'),
);
await new Promise((resolve, reject) => {
  const child = spawn('ffmpeg', args, { windowsHide: true, stdio: 'inherit' });
  child.on('error', reject);
  child.on('exit', (code) => (code ? reject(Error('ffmpeg ' + code)) : resolve()));
});
await writeFile(
  path.join(out, 'report.json'),
  JSON.stringify(
    {
      key,
      revision,
      fps: 30,
      frames: 180,
      duration: 6,
      firstHalfRate: 1.5,
      secondHalfRate: 0.75,
      method:
        'Frame-by-frame Chrome WebGL render of exact retained and candidate GLBs; no screenshot timing dependence',
      errors,
    },
    null,
    2,
  ),
);
console.log(path.join(out, 'comparison.mp4'));
