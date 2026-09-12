import { mkdir, writeFile, readFile } from 'node:fs/promises';
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
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 815 } }),
  errors = [],
  records = [];
page.on('pageerror', (e) => errors.push(String(e)));
try {
  await page.goto('http://127.0.0.1:3038');
  await page.waitForFunction(() => document.querySelector('#status')?.textContent.includes('完了'));
  await page.selectOption('#version', revision);
  const keys = await page.locator('#model option').evaluateAll((els) => els.map((e) => e.value));
  for (const key of process.argv[3] ? [process.argv[3]] : keys) {
    await page.selectOption('#model', key);
    for (const weapon of ['wooden-spear', 'obsidian-spear']) {
      await page.selectOption('#weapon', weapon);
      await page.waitForFunction(
        ({ key, revision, weapon }) =>
          document.querySelector('#status').textContent ===
          `${key} · ${revision} · ${weapon} · 完了`,
        { key, revision, weapon },
      );
      for (const view of ['side', 'front', 'back', 'left', 'angle']) {
        await page.selectOption('#view', view);
        await page.screenshot({ path: path.join(out, `${key}-${weapon}-${view}.png`) });
      }
    }
    const asset = JSON.parse(
      await readFile(`output/spear-thrusts/${revision}/${key}/asset.json`, 'utf8'),
    );
    records.push({
      key,
      revision,
      sha256: asset.sha256,
      views: 5,
      poses: 8,
      weapons: ['wooden-spear', 'obsidian-spear'],
    });
    console.log('Reviewed', key);
  }
  await writeFile(
    path.join(out, process.argv[3] ? 'partial-review.json' : 'report.json'),
    JSON.stringify({ records, errors }, null, 2),
  );
  if (errors.length) throw Error(errors.join('\n'));
} finally {
  await browser.close();
}
