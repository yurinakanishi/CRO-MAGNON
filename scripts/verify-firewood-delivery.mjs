import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const world = JSON.parse(await readFile('public/models/world-assets.json', 'utf8'));
const current = world.assets.find((a) => a.modelKey === 'firewood-log');
const earlier = JSON.parse(
  execFileSync('git', ['show', 'HEAD:public/models/world-assets.json'], { encoding: 'utf8' }),
);
const earlierCatalog = JSON.parse(
  execFileSync('git', ['show', 'HEAD:assets/world-models.json'], { encoding: 'utf8' }),
);
for (const spec of earlierCatalog.assets.filter((a) => a.kind === 'humanoid'))
  earlier.assets.push(
    JSON.parse(
      execFileSync('git', ['show', `HEAD:public/models/${spec.key}/asset.json`], {
        encoding: 'utf8',
      }),
    ),
  );
const preserved = [];
for (const asset of earlier.assets)
  for (const record of [asset, ...(asset.lods ?? [])]) {
    const file = 'public' + record.url,
      bytes = await readFile(file);
    assert.equal(hash(bytes), record.sha256, file);
    preserved.push({ file, sha256: record.sha256 });
  }
const served = [];
for (const record of [current, ...current.lods]) {
  const local = await readFile('public' + record.url);
  assert.equal(hash(local), record.sha256);
  assert.equal(local.length, record.bytes);
  const response = await fetch('http://127.0.0.1:3000' + record.url);
  assert.ok(response.ok);
  assert.equal(hash(Buffer.from(await response.arrayBuffer())), record.sha256);
  served.push({ url: record.url, sha256: record.sha256, bytes: record.bytes });
}
for (const [url, path] of [
  ['/src/world3d.js', 'dist/src/world3d.js'],
  ['/src/wood-pile.js', 'dist/src/wood-pile.js'],
  ['/src/biome-surfaces.js', 'dist/src/biome-surfaces.js'],
  ['/src/regional-scenery.js', 'dist/src/regional-scenery.js'],
  ['/src/resource-visuals.js', 'dist/src/resource-visuals.js'],
  ['/shared/wood-pile-layout.mjs', 'dist/shared/wood-pile-layout.mjs'],
  ['/shared/biome-scenery.mjs', 'dist/shared/biome-scenery.mjs'],
  ['/shared/model-bounds.mjs', 'dist/shared/model-bounds.mjs'],
  ['/shared/collision.mjs', 'dist/shared/collision.mjs'],
  ['/models/world-assets.json', 'public/models/world-assets.json'],
]) {
  const response = await fetch('http://127.0.0.1:3000' + url);
  assert.ok(response.ok);
  const sha256 = hash(await readFile(path));
  assert.equal(hash(Buffer.from(await response.arrayBuffer())), sha256);
  served.push({ url, sha256 });
}
await writeFile(
  'assets/firewood-log/delivery.json',
  JSON.stringify(
    {
      at: new Date().toISOString(),
      status: 'passed',
      preservedCount: preserved.length,
      preserved,
      served,
    },
    null,
    2,
  ) + '\n',
);
console.log(
  JSON.stringify({ preserved: preserved.length, served: served.length, status: 'passed' }),
);
