// Frame-addressed render of the exact old and new textured GLBs at 30 fps.
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);
const revision = process.argv[2] || 'revision-10';
const keys = process.argv[3]
  ? [process.argv[3]]
  : [
      'cro-magnon-woman',
      'cro-magnon-hunter',
      'neanderthal-woman',
      'neanderthal-hunter',
      'cat-kunoichi',
    ];
const base = `output/playwright/human-joints/${revision}`;
const b = await chromium.launch({ channel: 'chrome', headless: true }),
  p = await b.newPage();
const errors = [],
  records = [];
p.on('pageerror', (e) => errors.push(String(e)));
try {
  await p.goto('http://127.0.0.1:3037');
  await p.waitForFunction(() => document.querySelector('#status').textContent.includes('完了'));
  await p.evaluate((r) => document.querySelector('#version').add(new Option(r, r)), revision);
  for (const key of keys) {
    for (const version of ['revision-05', revision]) {
      await p.selectOption('#version', version);
      await p.waitForFunction(
        (v) => document.querySelector('#status').textContent.includes(`${v} · 完了`),
        version,
      );
      await p.selectOption('#model', key);
      await p.waitForFunction(
        ({ key, version }) =>
          document.querySelector('#status').textContent === `${key} · ${version} · 完了`,
        { key, version },
      );
      await p.selectOption('#view', 'side');
      await p.evaluate(() => {
        const c = gaitReview.cells;
        c.splice(0, c.length, c[0], c[6]);
      });
      const dir = `${base}/video/${key}/${version}`;
      await mkdir(dir, { recursive: true });
      for (let f = 0; f < 120; f++) {
        const png = await p.evaluate(
          ({ f, version, revision }) => {
            const canvas = document.createElement('canvas');
            canvas.width = 600;
            canvas.height = 400;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#dde3e5';
            ctx.fillRect(0, 0, 600, 400);
            for (const c of gaitReview.cells)
              c.phase = (((f / 30) * (f < 60 ? 1 : 0.5)) / c.clip.duration) % 1;
            gaitReview.render();
            gaitReview.cells.forEach((c, i) => ctx.drawImage(c.canvas, i * 300, 60));
            ctx.fillStyle = '#20303b';
            ctx.font = 'bold 20px sans-serif';
            ctx.fillText(version === revision ? '修正後' : '修正前', 14, 24);
            ctx.font = '16px sans-serif';
            ctx.fillText('歩行', 14, 48);
            ctx.fillText('走行', 314, 48);
            ctx.fillText(f < 60 ? '元の再生速度' : 'スロー再生', 430, 24);
            return canvas.toDataURL('image/png').split(',')[1];
          },
          { f, version, revision },
        );
        await writeFile(`${dir}/${String(f).padStart(3, '0')}.png`, Buffer.from(png, 'base64'));
      }
    }
    const dest = `${base}/${key}-comparison.mp4`;
    await new Promise((resolve, reject) => {
      const child = spawn(
        process.env.FFMPEG || 'ffmpeg',
        [
          '-y',
          '-loglevel',
          'error',
          '-framerate',
          '30',
          '-i',
          `${base}/video/${key}/revision-05/%03d.png`,
          '-framerate',
          '30',
          '-i',
          `${base}/video/${key}/${revision}/%03d.png`,
          '-filter_complex',
          'vstack=inputs=2',
          '-c:v',
          'libx264',
          '-pix_fmt',
          'yuv420p',
          '-crf',
          '18',
          '-movflags',
          '+faststart',
          dest,
        ],
        { windowsHide: true, stdio: 'inherit' },
      );
      child.on('error', reject);
      child.on('exit', (c) => (c ? reject(Error('ffmpeg ' + c)) : resolve()));
    });
    const asset = JSON.parse(await readFile(`output/player-gaits/${revision}/${key}/asset.json`));
    records.push({
      key,
      sha256: asset.sha256,
      file: dest,
      fps: 30,
      frames: 120,
      seconds: 4,
      terminalDuplicate: false,
    });
    console.log('Video', key);
  }
  if (errors.length) throw Error(errors.join('\n'));
  await writeFile(`${base}/video-report.json`, JSON.stringify({ records, errors }, null, 2));
} finally {
  await b.close();
}
