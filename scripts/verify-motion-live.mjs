import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { MOTION_KEYS } from './motion-glb.mjs';
const origin = process.argv[2] || 'http://localhost:3000';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const records = [];
for (const key of MOTION_KEYS) {
  const local = JSON.parse(await readFile(`public/models/${key}/asset.json`, 'utf8'));
  const response = await fetch(`${origin}/models/${key}/asset.json`);
  assert.ok(response.ok);
  const live = await response.json();
  assert.deepEqual(live, local);
  const file = await fetch(new URL(live.url, origin));
  assert.ok(file.ok);
  assert.equal(hash(Buffer.from(await file.arrayBuffer())), local.sha256);
  records.push({ key, url: local.url, sha256: local.sha256 });
}
for (const name of ['action-blender', 'character-animation', 'world-assets']) {
  const expected = hash(await readFile(`dist/src/${name}.js`)),
    response = await fetch(`${origin}/src/${name}.js`);
  assert.ok(response.ok);
  assert.equal(hash(Buffer.from(await response.arrayBuffer())), expected);
  records.push({ module: name, sha256: expected });
}
const response = await fetch(`${origin}/models/world-assets.json`);
assert.deepEqual(
  await response.json(),
  JSON.parse(await readFile('public/models/world-assets.json', 'utf8')),
);
await writeFile(
  'assets/creature-motion/live-validation.json',
  JSON.stringify(
    { status: 'passed', at: new Date().toISOString(), origin, records, serverRestart: false },
    null,
    2,
  ) + '\n',
);
console.log('Live motion GLBs, individual/combined manifests and three modules match.');
