import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const base = 'http://localhost:3012';
const modules = [
  'src/main.js',
  'src/world3d.js',
  'src/character-assets.js',
  'src/jump-pose.js',
  'src/combat-input.js',
  'src/gamepad-input.js',
  'src/gamepad-ui.js',
  'src/screens.js',
  'shared/jumping.mjs',
];
const health = await fetch(base + '/api/health');
assert.equal(health.status, 200);
const files = [];
for (const file of modules) {
  const response = await fetch(`${base}/${file}`);
  assert.equal(response.status, 200, file);
  const served = Buffer.from(await response.arrayBuffer());
  const expected = await readFile(new URL(`../output/jump/preview/dist/${file}`, import.meta.url));
  assert.equal(sha(served), sha(expected), file);
  files.push({ file, sha256: sha(served) });
}
const host = JSON.parse(
  await readFile(new URL('../output/jump/preview-host.json', import.meta.url)),
);
await writeFile(
  new URL('../output/jump/preview-check.json', import.meta.url),
  JSON.stringify({ base, host, health: await health.json(), files }, null, 2),
);
console.log(`Preview healthy; ${files.length} served modules match the isolated build.`);
