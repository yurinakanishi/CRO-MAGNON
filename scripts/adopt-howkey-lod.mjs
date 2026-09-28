import assert from 'node:assert/strict';
import { readFile, copyFile, writeFile, constants } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const folder =
  'output/model-generation/models/howkey-scientist/work/final/revision-11/howkey-scientist';
const lodFile = process.argv[2] || 'lod-performance.glb';
assert.match(lodFile, /^lod-performance(?:-r\d+)?\.glb$/);
const source = `${folder}/${lodFile}`,
  dest = `public/models/howkey-scientist/${lodFile}`;
const bytes = await readFile(source),
  sha256 = createHash('sha256').update(bytes).digest('hex');
const report = JSON.parse(
  execFileSync(process.execPath, ['scripts/inspect-glb.mjs', source], { encoding: 'utf8' }),
);
assert.equal(report.validation, 'passed');
assert.equal(report.animations.length, 0);
assert.equal(report.skins[0].joints, 28);
assert.ok(report.triangles > 6500 && report.triangles < 16000);
await copyFile(source, dest, constants.COPYFILE_EXCL);
const asset = JSON.parse(await readFile('public/models/howkey-scientist/asset.json', 'utf8'));
asset.lods = [
  {
    url: `/models/howkey-scientist/${lodFile}`,
    sha256,
    bytes: bytes.length,
    triangles: report.triangles,
    distanceMetres: 28,
    purpose: 'animated-medium-lod-geometry',
  },
];
const note =
  'Source-derived medium geometry for 28 m distance and simplified shadows. Runtime shares the exact close-model materials and animated skeleton.';
asset.notes = [...new Set([...asset.notes, note])];
await writeFile('public/models/howkey-scientist/asset.json', JSON.stringify(asset, null, 2) + '\n');
await writeFile(
  `${folder}/${lodFile.replace('.glb', '-inspection.json')}`,
  JSON.stringify(report, null, 2) + '\n',
);
await writeFile(
  'output/model-generation/models/howkey-scientist/qa/delivery-manifest.json',
  JSON.stringify(asset, null, 2) + '\n',
);
console.log(JSON.stringify(asset.lods[0]));
