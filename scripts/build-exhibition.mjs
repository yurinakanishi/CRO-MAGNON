import { mkdir, readdir, readFile, copyFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256, buildId } from './exhibition-integrity.mjs';
import './prepare-vendor.mjs';
import './build.mjs';
if (process.exitCode) throw new Error('TypeScript build failed');
if (process.platform !== 'win32')
  throw new Error(
    'Build the Windows exhibition package on Windows to include the correct Node runtime.',
  );

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const destination = path.resolve(root, process.argv[2] || 'output/exhibition');
const relative = path.relative(path.join(root, 'output'), destination);
if (!relative || relative.startsWith('..') || path.isAbsolute(relative))
  throw new Error('Destination must be a subfolder of output/.');
await mkdir(destination, { recursive: true });
if ((await readdir(destination)).length)
  throw new Error(
    `Destination is not empty: ${destination}. Choose a new output subfolder to preserve existing builds.`,
  );
const sources = new Map();
const add = (file) => sources.set(file, path.join(root, file));
async function collect(directory, filter = () => true) {
  for (const entry of await readdir(path.join(root, directory), { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const file = `${directory}/${entry.name}`;
    if (entry.isDirectory()) await collect(file, filter);
    else if (filter(file)) add(file);
  }
}
for (const directory of ['dist/src', 'dist/shared', 'dist/application', 'dist/infrastructure'])
  await collect(directory, (file) => /\.(js|mjs|css)$/.test(file));
add('dist/server.mjs');
await collect('public/vendor', (file) => /\.(js|mjs)$/.test(file));
await collect('public/title', (file) => /\.png$/.test(file));
await collect('node_modules/ws');
for (const file of [
  'public/index.html',
  'public/favicon.svg',
  'public/multiplayer-config.json',
  'public/models/world-assets.json',
  'scripts/start-exhibition.mjs',
  'scripts/exhibition-config.mjs',
  'scripts/exhibition-integrity.mjs',
  'start-exhibition-host.bat',
  'start-exhibition-client.bat',
  'README-EXHIBITION.md',
  'assets/exhibition-lan/qa-summary.json',
  'exhibition.env',
])
  add(file);
const manifest = JSON.parse(
  await readFile(path.join(root, 'public/models/world-assets.json'), 'utf8'),
);
const { CHARACTER_MODELS } = await import('../dist/shared/characters.mjs');
for (const { key } of CHARACTER_MODELS)
  if (!manifest.assets.some((asset) => asset.modelKey === key))
    manifest.assets.push(
      JSON.parse(await readFile(path.join(root, `public/models/${key}/asset.json`), 'utf8')),
    );
let glbs = 0;
for (const asset of manifest.assets) {
  add(`public/models/${asset.modelKey}/asset.json`);
  for (const model of [asset, ...(asset.lods || [])]) {
    if (!/^\/models\/[a-z0-9-]+\/(model(?:-[a-z0-9]+)*|lod\d+)\.glb$/.test(model.url))
      throw new Error(`Unexpected model: ${model.url}`);
    const file = `public${model.url}`;
    if (
      (await sha256(path.join(root, file))) !== model.sha256 ||
      (await stat(path.join(root, file))).size !== model.bytes
    )
      throw new Error(`Model integrity failed: ${file}`);
    add(file);
    glbs++;
  }
}
for (const key of ['cat-kunoichi', 'desert-fennec-mage']) add(`public/models/${key}/portrait.png`);
sources.set('runtime/node.exe', process.execPath);
// Keep the license for the exact bundled runtime. New Node versions need their
// matching license added during preparation, never fetched at exhibition startup.
sources.set(
  'runtime/LICENSE',
  path.join(root, `scripts/licenses/node-${process.version}-LICENSE.txt`),
);
sources.set('public/vendor/THREE-LICENSE.txt', path.join(root, 'node_modules/three/LICENSE'));
const files = [];
let bytes = 0;
for (const [file, source] of [...sources].sort(([a], [b]) => a.localeCompare(b))) {
  const target = path.join(destination, file);
  await mkdir(path.dirname(target), { recursive: true });
  await copyFile(source, target);
  bytes += (await stat(target)).size;
  // Settings are intentionally editable, code/assets/runtime must match on both PCs.
  if (file !== 'exhibition.env') files.push({ path: file, sha256: await sha256(target) });
}
const report = {
  buildId: buildId(files),
  builtAt: new Date().toISOString(),
  platform: process.platform,
  arch: process.arch,
  node: process.version,
  files,
  bytes,
  glbs,
};
await writeFile(path.join(destination, 'exhibition-build.json'), JSON.stringify(report, null, 2));
console.log(
  `Offline exhibition ready: ${destination}\nBuild ${report.buildId}\n${files.length} verified files; ${glbs} GLBs; ${(bytes / 1024 / 1024).toFixed(1)} MiB. Copy the complete folder to BOTH PCs.`,
);
