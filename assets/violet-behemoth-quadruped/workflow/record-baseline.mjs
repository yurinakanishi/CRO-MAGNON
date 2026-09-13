import { readFile, writeFile, readdir, copyFile, mkdir, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const out = 'assets/violet-behemoth-quadruped';
assert.equal(
  await access(`${out}/baseline.json`).then(
    () => true,
    () => false,
  ),
  false,
);
const files = [];
async function visit(folder) {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const path = `${folder}/${entry.name}`;
    if (entry.isDirectory()) await visit(path);
    else if (entry.name.endsWith('.glb')) {
      const bytes = await readFile(path);
      files.push({
        path,
        bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      });
    }
  }
}
await visit('public/models');
await mkdir(`${out}/retained-original`, { recursive: true });
for (const name of ['asset.json'])
  await copyFile(`public/models/violet-behemoth/${name}`, `${out}/retained-original/${name}`);
await copyFile('shared/behemoth-rules.mts', `${out}/retained-original/behemoth-rules.mts`);
await writeFile(
  `${out}/baseline.json`,
  JSON.stringify({ capturedAt: new Date().toISOString(), files }, null, 2) + '\n',
);
console.log(
  `Recorded ${files.length} existing GLBs; the adoption must preserve every one byte-for-byte.`,
);
