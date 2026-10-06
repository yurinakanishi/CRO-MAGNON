import { mkdir, readdir, readFile, copyFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256, buildId } from './exhibition-integrity.mjs';
import { prepareVendor } from './prepare-vendor.mjs';
import './build.mjs';
if (process.exitCode) throw new Error('TypeScript build failed');
if (process.platform !== 'win32')
  throw new Error(
    'Build the Windows exhibition package on Windows to include the correct Node runtime.',
  );

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const local = process.argv.includes('--local');
const {
  browserBuildProfile,
  environmentAsset,
  auditEnvironmentAssets,
  runtimeTextureRecords,
  runtimeBotPortraitUrls,
} = await import('./environment-assets.mjs');
const profile = browserBuildProfile(local ? 'local' : 'exhibition', new Date().toISOString());
await prepareVendor({ cameraControls: profile.cameraControls });
const destination = path.resolve(
  root,
  process.argv.slice(2).find((arg) => !arg.startsWith('--')) ||
    `output/environments/${profile.environment}/build-${profile.builtAt.replace(/[:.]/g, '-')}`,
);
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
await collect('public/vendor', (file) => /\.(js|mjs|wasm)$/.test(file));
await collect('public/audio', (file) => /\.(wav|mp3|json|txt)$/.test(file));
await collect('public/motion', (file) => /\.(task|json|txt)$/.test(file));
await collect('public/title', (file) => /\.(png|jpe?g)$/.test(file));
await collect('public/spawn', (file) => /\.jpg$/.test(file));
await collect('node_modules/ws');
for (const file of [
  'public/index.html',
  'public/favicon.svg',
  'public/multiplayer-config.json',
  'public/models/world-assets.json',
  'scripts/exhibition-integrity.mjs',
  ...(local
    ? ['scripts/start-local.mjs', 'start-local.cmd', 'README-LOCAL.md', 'local-visibility.json']
    : [
        'scripts/start-exhibition.mjs',
        'scripts/exhibition-config.mjs',
        'scripts/exhibition-station.ps1',
        'start-exhibition-host.bat',
        'start-exhibition-client.bat',
        'README-EXHIBITION.md',
        'README-EXHIBITION-3PC.md',
        'README-EXHIBITION-4PC.md',
        'README-EXHIBITION-SECURITY.md',
        'assets/exhibition-lan/qa-summary.json',
        'exhibition.env',
      ]),
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
    if (
      !/^\/models\/[a-z0-9-]+\/(model(?:-[a-z0-9]+)*|lod(?:\d+|-[a-z0-9-]+))\.glb$/.test(model.url)
    )
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
  // External runtime textures (for example cave pigment and limestone) are
  // declared directly on the accepted asset. Historical provenance is not shipped.
  for (const texture of runtimeTextureRecords(asset)) {
    if (!/^\/models\/[a-z0-9-]+\/[a-z0-9-]+\.(png|jpe?g)$/.test(texture.url))
      throw new Error(`Unexpected texture: ${texture.url}`);
    const file = `public${texture.url}`;
    if (
      (await sha256(path.join(root, file))) !== texture.sha256 ||
      (texture.bytes !== undefined && (await stat(path.join(root, file))).size !== texture.bytes)
    )
      throw new Error(`Texture integrity failed: ${file}`);
    add(file);
  }
}
for (const { key } of CHARACTER_MODELS) add(`public/models/${key}/portrait.png`);
for (const url of runtimeBotPortraitUrls(manifest.assets)) add(`public${url}`);
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
await mkdir(path.join(destination, 'public'), { recursive: true });
await writeFile(path.join(destination, 'public/build-profile.json'), JSON.stringify(profile));
files.push({
  path: 'public/build-profile.json',
  sha256: await sha256(path.join(destination, 'public/build-profile.json')),
});
for (const [file, source] of [...sources].sort(([a], [b]) => a.localeCompare(b))) {
  const target = path.join(destination, file);
  await mkdir(path.dirname(target), { recursive: true });
  const publicPath = file.replace(/^(?:dist|public)\//, '');
  if (['src/build-profile.js', 'src/hand-controls.js', 'index.html'].includes(publicPath))
    await writeFile(target, environmentAsset(publicPath, await readFile(source), profile));
  else await copyFile(source, target);
  bytes += (await stat(target)).size;
  // Settings are intentionally editable, code/assets/runtime must match on both PCs.
  if (!['exhibition.env', 'local-visibility.json'].includes(file))
    files.push({ path: file, sha256: await sha256(target) });
}
const publicFiles = files.filter(
  (file) =>
    /^(?:dist\/(?:src|shared)\/|public\/)/.test(file.path) &&
    file.path !== 'dist/shared/game-core.mjs',
);
const audit = await auditEnvironmentAssets(
  publicFiles.map((file) => file.path.replace(/^(?:dist|public)\//, '')),
  (name) =>
    readFile(
      path.join(
        destination,
        name.startsWith('src/') || name.startsWith('shared/') ? 'dist' : 'public',
        name,
      ),
    ),
  profile,
);
const report = {
  profile,
  audit,
  buildId: buildId(files),
  builtAt: new Date().toISOString(),
  platform: process.platform,
  arch: process.arch,
  node: process.version,
  files,
  bytes,
  glbs,
};
await writeFile(
  path.join(destination, local ? 'local-build.json' : 'exhibition-build.json'),
  JSON.stringify(report, null, 2),
);
if (local)
  await writeFile(
    path.join(destination, 'public/local-build.json'),
    JSON.stringify({
      mode: 'local',
      buildId: report.buildId,
      builtAt: report.builtAt,
    }),
  );
console.log(
  `${local ? 'Portable local game' : 'Offline exhibition'} ready: ${destination}\nBuild ${report.buildId}\n${files.length} verified files; ${glbs} GLBs; ${(bytes / 1024 / 1024).toFixed(1)} MiB.${local ? ' Open start-local.cmd on the destination PC.' : ' Deploy this same build to PC0, PC1, PC2 and PC3.'}`,
);
