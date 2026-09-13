import http from 'node:http';
import path from 'node:path';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
const { chromium } =
  await import('file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const root = path.resolve('.'),
  out = 'output/playwright/mammoth-tail-structure-r11';
await mkdir(out, { recursive: true });
const server = http.createServer(async (req, res) => {
  try {
    const rel =
      new URL(req.url, 'http://localhost').pathname.slice(1) || 'assets/mammoth-tail/review.html';
    const file = path.resolve(root, rel);
    if (
      !file.startsWith(root + path.sep) ||
      !/^(assets\/mammoth-tail|output\/mammoth-tail|public\/models|node_modules\/three)\//.test(rel)
    )
      throw Error('path');
    const bytes = await readFile(file);
    res.setHeader(
      'Content-Type',
      file.endsWith('.js')
        ? 'text/javascript'
        : file.endsWith('.html')
          ? 'text/html'
          : 'application/octet-stream',
    );
    res.end(bytes);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 880 } });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => window.tailReview?.ready);
  await page.evaluate(() => tailReview.pause());
  const records = [];
  for (const clip of ['Idle_Loop', 'Walk_Loop', 'Run_Loop', 'Graze_Loop', 'Death'])
    for (const view of ['rear', 'quarter', 'side', 'front', 'left'])
      for (const phase of [0, 0.25, 0.5, 0.75, 1]) {
        await page.evaluate(
          ({ clip, view, phase }) => {
            tailReview.view(view);
            tailReview.pose(clip, phase);
          },
          { clip, view, phase },
        );
        const file = `${out}/${clip}-${view}-${phase}.png`;
        await page.screenshot({ path: file });
        records.push({ clip, view, phase, file });
      }
  await page.evaluate(() => {
    tailReview.view('close');
    tailReview.pose('Idle_Loop', 0);
  });
  await page.screenshot({ path: `${out}/close-comparison.png` });
  // Exactly 72 frames at 30 fps: one walk loop, no duplicated end frame.
  await mkdir(`${out}/video`, { recursive: true });
  for (let frame = 0; frame < 72; frame++) {
    await page.evaluate((f) => {
      tailReview.view('quarter');
      tailReview.pose('Walk_Loop', f / 72);
    }, frame);
    await page.screenshot({ path: `${out}/video/frame-${String(frame).padStart(3, '0')}.png` });
  }
  await writeFile(
    `${out}/review.json`,
    JSON.stringify(
      {
        status: errors.length ? 'failed' : 'passed',
        records,
        video: { fps: 30, frames: 72, clip: 'Walk_Loop' },
        errors,
      },
      null,
      2,
    ),
  );
  if (errors.length) throw Error(errors.join('\n'));
  console.log(`Passed ${records.length} poses, 72 video frames, errors 0`);
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
