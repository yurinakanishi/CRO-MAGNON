// Inspect each real exported clip from five directions, at normal and half speed.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const { chromium } =
  await import('file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const [kind, revision] = process.argv.slice(2);
assert.ok(['mae'].includes(kind) && /^\d{2}$/.test(revision));
const base = `output/model-generation/models/mae`;
const out = `${base}/qa/final-${revision}/motion-angles`;
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1080, height: 900 } });
const errors = [],
  records = [];
page.on('pageerror', (e) => errors.push(String(e)));
let failure;
try {
  await page.goto(pathToFileURL(path.resolve(`${base}/qa/final-${revision}/viewer.html`)).href);
  await page.waitForFunction(() => document.querySelector('#mv')?.loaded);
  const clips = await page.locator('#mv').evaluate((m) => m.availableAnimations);
  assert.equal(clips.length, 6);
  const views = { front: 0, back: 180, left: -90, right: 90, threequarter: -35 };
  for (const clip of clips) {
    await page.selectOption('#clip', clip);
    await page.waitForTimeout(80);
    for (const [view, angle] of Object.entries(views)) {
      for (const speed of [1, 0.5]) {
        const before = await page.locator('#mv').evaluate(
          (m, { angle, speed }) => {
            m.pause();
            m.timeScale = speed;
            m.currentTime = m.duration * 0.2;
            m.cameraOrbit = `${angle}deg 83deg 150%`;
            m.jumpCameraToGoal();
            const before = m.currentTime;
            m.play();
            return before;
          },
          { angle, speed },
        );
        await page.waitForTimeout(150);
        const after = await page.locator('#mv').evaluate((m) => {
          m.pause();
          return m.currentTime;
        });
        assert.notEqual(after, before, `${clip}/${view}/${speed} did not advance`);
        records.push({ clip, view, speed, before, after });
      }
      await page.screenshot({ path: `${out}/${clip}-${view}.png` });
    }
  }
  assert.deepEqual(errors, []);
} catch (e) {
  failure = String(e.stack ?? e);
} finally {
  await browser.close();
  const raw = await readFile(`${base}/work/rig/revision-${revision}/candidate.glb`);
  await writeFile(
    `${out}/qa.json`,
    JSON.stringify(
      {
        passed: !failure,
        sha256: createHash('sha256').update(raw).digest('hex'),
        records,
        errors,
        failure,
        evidence:
          '30 exact-GLB screenshots; 60 live clip/direction/speed observations. Screenshots are not video.',
      },
      null,
      2,
    ) + '\n',
  );
}
if (failure) throw Error(failure);
console.log(
  JSON.stringify({
    kind,
    revision,
    directions: 5,
    clips: 6,
    observations: records.length,
    passed: true,
  }),
);
