// Cook GLBs in memory and report the delivery sizes (nothing is written unless --out is given).
//   node scripts/delivery/cook-report.mjs public/models/x/model.glb ... [--out output/dir] [--json]
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import sharp from 'sharp';
import { cookGlb } from './cook-glb.mjs';

const args = process.argv.slice(2);
const outIndex = args.indexOf('--out');
const out = outIndex >= 0 ? args.splice(outIndex, 2)[1] : null;
const asJson = args.includes('--json');
const files = args.filter((arg) => !arg.startsWith('--'));
const mb = (n) => (n / 1048576).toFixed(2);
const rows = [];
let before = 0,
  after = 0,
  beforeGz = 0,
  afterGz = 0;
for (const file of files) {
  const bytes = await readFile(file);
  const started = performance.now();
  const { bytes: cooked, report } = await cookGlb(bytes, { label: file, sharp });
  const ms = performance.now() - started;
  const gzA = zlib.gzipSync(bytes, { level: 6 }).length,
    gzB = zlib.gzipSync(cooked, { level: 6 }).length;
  before += bytes.length;
  after += cooked.length;
  beforeGz += gzA;
  afterGz += gzB;
  rows.push({ file, bytes: bytes.length, cooked: cooked.length, gzA, gzB, ms, report });
  if (!asJson)
    console.log(
      `${mb(bytes.length).padStart(6)} -> ${mb(cooked.length).padStart(6)} MB  gzip ${mb(gzA).padStart(6)} -> ${mb(gzB).padStart(6)}  ${(100 - (100 * gzB) / gzA).toFixed(0).padStart(3)}%  ${ms.toFixed(0).padStart(5)}ms  ${file}`,
    );
  if (out) {
    const target = path.join(out, file.replace(/^public[\\/]/, ''));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, cooked);
    await writeFile(`${target}.cook.json`, JSON.stringify(report, null, 2));
  }
}
if (asJson)
  console.log(
    JSON.stringify(
      rows.map(({ report, ...row }) => ({ ...row, errors: report.errors, images: report.images })),
      null,
      2,
    ),
  );
console.log(
  `TOTAL ${mb(before)} -> ${mb(after)} MB, gzip ${mb(beforeGz)} -> ${mb(afterGz)} MB (${(100 - (100 * afterGz) / beforeGz).toFixed(1)}% smaller)`,
);
