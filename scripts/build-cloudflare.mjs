import { mkdir, readFile, writeFile, copyFile, readdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import './prepare-vendor.mjs';
import './build.mjs';
if (process.exitCode) throw new Error('TypeScript build failed');
const { CHARACTER_MODELS } = await import('../dist/shared/characters.mjs');

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const destination = path.join(root, 'dist-cloudflare');
const files = new Set(['public/index.html', 'public/favicon.svg', 'public/models/world-assets.json', 'public/multiplayer-config.json']);
async function collect(directory) {
  for (const entry of await readdir(path.join(root, directory), { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const file = `${directory}/${entry.name}`;
    if (entry.isDirectory()) await collect(file);
    else if (/\.(js|mjs|css)$/.test(file)) files.add(file);
  }
}
await collect('dist/src'); await collect('dist/shared'); await collect('public/vendor');
for (const name of await readdir(path.join(root, 'public/title'))) {
  if (name.endsWith('.png')) files.add(`public/title/${name}`);
}
const manifest = JSON.parse(await readFile(path.join(root, 'public/models/world-assets.json'), 'utf8'));
for (const { key } of CHARACTER_MODELS) {
  if (!manifest.assets.some(asset => asset.modelKey === key)) manifest.assets.push(JSON.parse(await readFile(path.join(root, `public/models/${key}/asset.json`), 'utf8')));
}
const models = [];
for (const asset of manifest.assets) {
  files.add(`public/models/${asset.modelKey}/asset.json`);
  for (const record of [asset, ...(asset.lods || [])]) {
    if (!/^\/models\/[a-z0-9-]+\/(model|lod\d+)\.glb$/.test(record.url)) throw new Error(`Unexpected model URL: ${record.url}`);
    const file = `public${record.url}`, bytes = await readFile(path.join(root, file));
    const hash = createHash('sha256').update(bytes).digest('hex');
    if (hash !== record.sha256 || bytes.length !== record.bytes) throw new Error(`Model mismatch: ${file}`);
    files.add(file); models.push({ url: record.url, sha256: hash, bytes: bytes.length });
  }
}
for (const key of ['cro-magnon-woman', 'cro-magnon-hunter', 'neanderthal-woman', 'neanderthal-hunter', 'cat-kunoichi', 'desert-fennec-mage', 'giant-ape']) files.add(`public/models/${key}/portrait.png`);
await mkdir(destination, { recursive: true });
// Refuse stale output instead of accidentally publishing unrelated files.
const allowed = new Set([...files].map(file => file.replace(/^(public|dist)\//, '')));
allowed.add('_headers');
async function checkExisting(directory = destination) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await checkExisting(file);
    else if (!allowed.has(path.relative(destination, file).replaceAll('\\', '/'))) throw new Error(`Unexpected build output: ${file}`);
  }
}
await checkExisting();
let total = 0;
for (const file of files) {
  const source = path.join(root, file), target = path.join(destination, file.replace(/^(public|dist)\//, ''));
  const size = (await stat(source)).size;
  if (size > 25 * 1024 * 1024) throw new Error(`Static asset exceeds free hosting file limit: ${file}`);
  total += size; await mkdir(path.dirname(target), { recursive: true }); await copyFile(source, target);
}
await writeFile(path.join(destination, '_headers'), '/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n  X-Frame-Options: DENY\n  Cache-Control: no-cache\n');
await mkdir(path.join(root, 'output'), { recursive: true });
await writeFile(path.join(root, 'output/cloudflare-build.json'), JSON.stringify({ builtAt: new Date().toISOString(), files: files.size + 1, bytes: total, models }, null, 2));
console.log(`Cloudflare assets: ${files.size + 1} files, ${(total / 1024 / 1024).toFixed(1)} MiB; ${models.length} GLBs verified. No review models or private files.`);
