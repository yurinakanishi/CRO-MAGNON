import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
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
const out = `output/playwright/human-joints/${revision}`;
await mkdir(out, { recursive: true });
const b = await chromium.launch({ channel: 'chrome', headless: true });
const p = await b.newPage({ viewport: { width: 1800, height: 820 } });
const errors = [],
  records = [];
p.on('pageerror', (e) => errors.push(String(e)));
try {
  await p.goto('http://127.0.0.1:3037');
  await p.waitForFunction(() => document.querySelector('#status').textContent.includes('完了'));
  await p.evaluate((r) => document.querySelector('#version').add(new Option(r, r)), revision);
  await p.selectOption('#version', revision);
  await p.waitForFunction(
    (r) => document.querySelector('#status').textContent.includes(`${r} · 完了`),
    revision,
  );
  for (const key of keys) {
    await p.selectOption('#model', key);
    await p.waitForFunction(
      ({ key, revision }) =>
        document.querySelector('#status').textContent === `${key} · ${revision} · 完了`,
      { key, revision },
    );
    for (const view of ['side', 'front', 'back', 'left', 'angle']) {
      await p.selectOption('#view', view);
      await p.screenshot({ path: `${out}/${key}-${view}.png` });
    }
    const bytes = await readFile(`output/player-gaits/${revision}/${key}/model.glb`);
    records.push({
      key,
      revision,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      views: 5,
      phases: 6,
    });
    console.log('Rendered', key, revision);
  }
  await writeFile(
    `${out}/report${process.argv[3] ? '-' + process.argv[3] : ''}.json`,
    JSON.stringify({ records, errors }, null, 2),
  );
  if (errors.length) throw Error(errors.join('\n'));
} finally {
  await b.close();
}
