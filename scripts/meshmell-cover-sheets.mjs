import { createRequire } from 'node:module';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { chromium } = require(resolve(root, '../meshmell.com/node_modules/playwright'));
const records = JSON.parse(readFileSync(resolve(root, 'assets/meshmell/covers.json'), 'utf8')).models;
const createdAt = new Date().toISOString();
const output = resolve(root, 'output/meshmell-covers/sheets', createdAt.replace(/[-:.]/g, ''));
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const sheets = [];
try {
  for (let offset = 0; offset < records.length; offset += 8) {
    const selected = records.slice(offset, offset + 8);
    const page = await browser.newPage({ viewport: { width: 1280, height: 704 }, deviceScaleFactor: 1 });
    const cells = selected.map(r => `<figure><img src="data:image/jpeg;base64,${readFileSync(resolve(root, r.image)).toString('base64')}"><figcaption>${r.key}</figcaption></figure>`).join('');
    await page.setContent(`<style>*{box-sizing:border-box}body{margin:0;background:#182023;color:#fff;display:grid;grid-template-columns:repeat(4,320px);font:15px sans-serif}figure{margin:0;height:352px}img{width:320px;height:320px;display:block}figcaption{padding:8px}</style>${cells}`);
    await page.locator('img').evaluateAll(images => Promise.all(images.map(i => i.decode())));
    const path = resolve(output, `sheet-${offset / 8 + 1}.png`);
    await page.screenshot({ path });
    sheets.push({ path, keys: selected.map(r => r.key), sha256: createHash('sha256').update(readFileSync(path)).digest('hex') });
    await page.close();
  }
} finally { await browser.close(); }
const report = { createdAt, action: 'cover-contact-sheets', width: 1280, height: 704, sheets };
writeFileSync(resolve(root, 'assets/meshmell/cover-sheets.json'), JSON.stringify(report, null, 2) + '\n');
writeFileSync(resolve(root, `assets/meshmell/history/${report.createdAt.replace(/[-:.]/g, '')}-cover-contact-sheets.json`), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(report));
