// Undo adopt_world_asset.mjs for one key: restore its world-assets.json entry, per-model asset.json
// and shared/model-bounds.mts block from HEAD, and delete its delivered remake files (model-c*.glb, lod-c*.glb).
// node scripts/remake/unadopt_world_asset.mjs <key>
import { readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const key = process.argv[2];
const root = path.resolve(import.meta.dirname, '../..');
const head = (p) => execFileSync('git', ['show', `HEAD:${p}`], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28 });
const manifestPath = path.join(root, 'public/models/world-assets.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const original = JSON.parse(head('public/models/world-assets.json')).assets.find((a) => a.modelKey === key);
const i = manifest.assets.findIndex((a) => a.modelKey === key);
if (original && i >= 0) {
  manifest.assets[i] = original;
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
}
try {
  await writeFile(path.join(root, `public/models/${key}/asset.json`), head(`public/models/${key}/asset.json`));
} catch {}
const boundsPath = path.join(root, 'shared/model-bounds.mts');
let text = await readFile(boundsPath, 'utf8');
const marker = `  '${key}': {`;
if (text.includes(marker)) {
  const block = (t) => t.slice(t.indexOf(marker), t.indexOf('\n  },', t.indexOf(marker)) + 5);
  text = text.replace(block(text), block(head('shared/model-bounds.mts')));
  await writeFile(boundsPath, text);
}
const dir = path.join(root, 'public/models', key);
// Only untracked remake outputs: earlier deliveries such as the 524's tracked model-c14.glb also match model-c<n>.
const tracked = new Set(
  execFileSync('git', ['ls-files', `public/models/${key}`], { cwd: root, encoding: 'utf8' })
    .split(/\r?\n/)
    .filter(Boolean)
    .map((f) => path.basename(f)),
);
for (const f of await readdir(dir)) if (/^(model|lod)-c\d/.test(f) && !tracked.has(f)) await rm(path.join(dir, f));
console.log('restored', key);
