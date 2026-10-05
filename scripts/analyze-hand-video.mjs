// Local-only, prerecorded-video review using the shipped HandLandmarker Worker.
// Usage: node scripts/analyze-hand-video.mjs <video.mp4> [output-directory] [Hz]
import http from 'node:http';
import path from 'node:path';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, writeFile, stat, copyFile } from 'node:fs/promises';
const root = path.resolve(import.meta.dirname, '..');
const videoPath = path.resolve(process.argv[2]);
const out = path.resolve(process.argv[3] || 'output/playwright/left-hand-video-20261005');
const hz = Number(process.argv[4] || 15);
if (!(hz >= 5 && hz <= 30)) throw Error('Expected 5–30 Hz');
await mkdir(out, { recursive: true });
const videoStat = await stat(videoPath);
const mime = { '.mjs': 'text/javascript', '.js': 'text/javascript', '.wasm': 'application/wasm' };
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/') {
      res
        .writeHead(200, { 'Content-Type': 'text/html' })
        .end(
          '<!doctype html><meta charset="utf-8"><title>Local prerecorded hand review</title>' +
            '<video id="video" muted preload="auto" src="/video.mp4"></video><canvas id="sheet"></canvas>',
        );
      return;
    }
    if (url.pathname === '/video.mp4') {
      const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
      const start = range ? Number(range[1]) : 0;
      const end = range?.[2] ? Number(range[2]) : videoStat.size - 1;
      res.writeHead(range ? 206 : 200, {
        'Content-Type': 'video/mp4',
        'Accept-Ranges': 'bytes',
        'Content-Length': end - start + 1,
        ...(range ? { 'Content-Range': `bytes ${start}-${end}/${videoStat.size}` } : {}),
      });
      createReadStream(videoPath, { start, end }).pipe(res);
      return;
    }
    const rel = url.pathname.slice(1);
    if (!/^(src\/|vendor\/mediapipe\/|motion\/)/.test(rel) || rel.includes('..'))
      throw Error('path');
    const file = path.join(root, rel.startsWith('src/') ? 'dist' : 'public', rel);
    res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [],
  externalRequests = [];
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1') return route.continue();
    externalRequests.push(route.request().url());
    return route.abort();
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => document.querySelector('video').readyState >= 2);
  const metadata = await page.evaluate(() => {
    const v = document.querySelector('video');
    return { duration: v.duration, width: v.videoWidth, height: v.videoHeight };
  });
  console.log(JSON.stringify({ ...metadata, hz, out }));
  const sheet = await page.evaluate(async () => {
    const video = document.querySelector('video'),
      canvas = document.querySelector('canvas');
    const n = Math.ceil(video.duration / 2),
      w = 320,
      h = Math.round((w * video.videoHeight) / video.videoWidth);
    canvas.width = w * 4;
    canvas.height = (h + 28) * Math.ceil(n / 4);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#14191f';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < n; i++) {
      const t = Math.min(i * 2 + 0.01, video.duration - 0.01);
      await new Promise((resolve) => {
        video.onseeked = resolve;
        video.currentTime = t;
      });
      const x = (i % 4) * w,
        y = Math.floor(i / 4) * (h + 28);
      ctx.drawImage(video, x, y, w, h);
      ctx.fillStyle = 'white';
      ctx.font = '18px sans-serif';
      ctx.fillText(t.toFixed(1) + ' s', x + 8, y + h + 20);
    }
    return canvas.toDataURL('image/jpeg', 0.9).split(',')[1];
  });
  await writeFile(path.join(out, 'contact-sheet.jpg'), Buffer.from(sheet, 'base64'));
  console.log('Contact sheet saved');
  await page.exposeFunction('progress', (n, total) => console.log(`Landmarks ${n}/${total}`));
  const analysis = await page.evaluate(async (hz) => {
    const video = document.querySelector('video');
    const worker = new Worker('/src/motion-worker.js', { type: 'module' });
    const call = (message, transfer = []) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(Error('Worker timeout')), 20000);
        worker.onmessage = ({ data }) => {
          clearTimeout(timer);
          data.type === 'error' ? reject(Error(JSON.stringify(data))) : resolve(data);
        };
        worker.onerror = (e) => {
          clearTimeout(timer);
          reject(Error(e.message));
        };
        worker.postMessage(message, transfer);
      });
    const ready = await call({ type: 'init', bootId: 1, delegate: 'CPU' });
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = Math.round((640 * video.videoHeight) / video.videoWidth);
    const ctx = canvas.getContext('2d');
    const count = Math.floor(video.duration * hz),
      frames = [];
    for (let i = 0; i < count; i++) {
      const t = Math.min((i + 0.1) / hz, video.duration - 0.01);
      await new Promise((resolve) => {
        video.onseeked = resolve;
        video.currentTime = t;
      });
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const bitmap = await createImageBitmap(canvas);
      const result = await call(
        {
          type: 'frame',
          bootId: 1,
          sessionId: 1,
          frameId: i + 1,
          sampledAtMainMs: t * 1000,
          bitmap,
        },
        [bitmap],
      );
      frames.push(result);
      if (i % 90 === 0) await window.progress(i, count);
    }
    await call({ type: 'close' });
    worker.terminate();
    return { ready, frames };
  }, hz);
  await writeFile(
    path.join(out, 'landmarks.json'),
    JSON.stringify({
      source: path.basename(videoPath),
      ...metadata,
      hz,
      ...analysis,
      errors,
      externalRequests,
      limitation:
        'Prerecorded video sampled at fixed virtual times; not live latency or playability evidence.',
    }),
  );
  await mkdir(path.join(out, 'baseline'), { recursive: true });
  for (const file of ['motion-input.js', 'motion-hands.js', 'motion-actions.js'])
    await copyFile(path.join(root, 'dist/src', file), path.join(out, 'baseline', file));
  console.log(JSON.stringify({ frames: analysis.frames.length, errors, externalRequests }));
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
