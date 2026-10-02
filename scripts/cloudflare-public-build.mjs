import { mkdir, readFile, writeFile, readdir, stat, rename, cp } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import './prepare-vendor.mjs';
import './build.mjs';
if (process.exitCode) throw new Error('TypeScript build failed');
const { CHARACTER_MODELS } = await import('../dist/shared/characters.mjs');
const { TITLE_CREDITS, TITLE_GUEST } = await import('../dist/src/title-credit-profiles.js');

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const destination = path.join(root, 'dist-cloudflare');
const workerDestination = path.join(root, 'dist-cloudflare-worker');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const staging = path.join(root, 'output/cloudflare-deploy', `build-${stamp}`);
const workerStaging = path.join(root, 'output/cloudflare-deploy', `worker-build-${stamp}`);
const release = JSON.parse(
  await readFile(path.join(root, 'cloudflare/public-release.json'), 'utf8'),
);
if (!['public', 'full'].includes(release.credits)) throw new Error('Invalid public credits mode');
if (
  !Array.isArray(release.excludedCharacters) ||
  release.excludedCharacters.some(
    (species) => !CHARACTER_MODELS.some((model) => model.species === species),
  )
)
  throw new Error('Invalid excluded characters');
const excludedSpecies = new Set(release.excludedCharacters);
const excludedModels = CHARACTER_MODELS.filter((model) => excludedSpecies.has(model.species));
const excludedKeys = new Set(excludedModels.map((model) => model.key));
const publicCharacters = CHARACTER_MODELS.filter((model) => !excludedSpecies.has(model.species));
if (!publicCharacters.some((model) => model.species === 'cro'))
  throw new Error('Missing default public character');
const hasOctopus = publicCharacters.some((model) => model.bodyPlan === 'octopus');
const forbidden = /maruimo|まる[ぃい]も/i;
const credits = release.credits === 'full' ? TITLE_CREDITS : TITLE_CREDITS.slice(0, 1);
const visibleProfiles = new Set([...credits, TITLE_GUEST].map((person) => person.qr));
const fileLimit = 25 * 1024 * 1024;
const partSize = 24 * 1024 * 1024;
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const files = new Map();
const models = [];
let total = 0;
await mkdir(staging, { recursive: true });

async function publish(url, bytes) {
  const name = url.replace(/^\//, '');
  if (!name || name.split('/').some((part) => !part || part === '.' || part === '..'))
    throw new Error(`Unexpected public path: ${url}`);
  if (bytes.length > fileLimit) throw new Error(`Static asset exceeds 25 MiB: ${url}`);
  if (excludedKeys.has(name.split('/')[1])) throw new Error(`Excluded character file: ${url}`);
  if (
    excludedSpecies.has('maruimo') &&
    (forbidden.test(name) ||
      (/\.(js|mjs|css|json|html|txt)$/.test(name) && forbidden.test(bytes.toString('utf8'))))
  )
    throw new Error(`Excluded character data in public file: ${url}`);
  const digest = hash(bytes);
  if (files.has(name)) {
    if (files.get(name).sha256 !== digest) throw new Error(`Conflicting public file: ${url}`);
    return;
  }
  const target = path.join(staging, name);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, bytes);
  files.set(name, { path: name, bytes: bytes.length, sha256: digest });
  total += bytes.length;
}

async function collect(directory, extensions, keep = () => true) {
  for (const entry of await readdir(path.join(root, directory), { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const file = `${directory}/${entry.name}`;
    if (entry.isDirectory()) await collect(file, extensions, keep);
    else if (extensions.test(file) && keep(entry.name)) {
      // Generate this module from the chosen profiles, never copy it unfiltered.
      if (
        file === 'dist/src/title-credit-profiles.js' ||
        file === 'dist/shared/character-profiles.mjs' ||
        (!hasOctopus && file === 'dist/src/octopus-pose.js')
      )
        continue;
      let bytes = await readFile(path.join(root, file));
      if (file === 'dist/src/style.css') {
        const css = bytes
          .toString('utf8')
          .replace(/([^{}]+)\{([^{}]*)\}/g, (rule, selectors, body) => {
            if (![...excludedSpecies].some((species) => selectors.includes(`.portrait.${species}`)))
              return rule;
            const visible = selectors
              .split(',')
              .filter(
                (selector) =>
                  ![...excludedSpecies].some((species) =>
                    selector.includes(`.portrait.${species}`),
                  ),
              );
            return visible.length ? `${visible.join(',')}{${body}}` : '';
          });
        bytes = Buffer.from(css);
      }
      await publish('/' + file.replace(/^(public|dist)\//, ''), bytes);
    }
  }
}

await publish(
  '/shared/character-profiles.mjs',
  Buffer.from(
    `export const CHARACTER_MODELS = Object.freeze(${JSON.stringify(publicCharacters)}.map(Object.freeze));\n`,
  ),
);
for (const directory of ['dist/src', 'dist/shared']) await collect(directory, /\.(js|mjs|css)$/);
await collect('public/vendor', /\.(js|mjs|wasm|txt)$/);
await collect('public/motion', /\.(task|txt|json)$/);
await collect('public/spawn', /\.jpg$/);
await collect('public/title', /\.(png|jpe?g)$/, (name) => {
  const profile = /^(?:qr|avatar)-([a-z0-9]+)\./.exec(name);
  return !profile || visibleProfiles.has(profile[1]);
});
for (const file of ['index.html', 'favicon.svg'])
  await publish('/' + file, await readFile(path.join(root, 'public', file)));
await publish(
  '/multiplayer-config.json',
  Buffer.from(
    JSON.stringify(
      {
        mode: 'online',
        serverUrl: '',
        room: 'EMBER',
        movementRefreshMs: 140,
      },
      null,
      2,
    ),
  ),
);
await publish(
  '/src/title-credit-profiles.js',
  Buffer.from(
    `export const TITLE_CREDITS = ${JSON.stringify(credits)};\nexport const TITLE_GUEST = ${JSON.stringify(TITLE_GUEST)};\n`,
  ),
);

const catalog = JSON.parse(
  await readFile(path.join(root, 'public/models/world-assets.json'), 'utf8'),
);
const worldAssets = catalog.assets.filter(
  (asset) => !excludedKeys.has(asset.modelKey) && !excludedSpecies.has(asset.species),
);
const assets = [...worldAssets];
for (const { key } of publicCharacters)
  if (!assets.some((asset) => asset.modelKey === key))
    assets.push(
      JSON.parse(await readFile(path.join(root, `public/models/${key}/asset.json`), 'utf8')),
    );
const downloads = new Map();
const optimized = release.optimizedAssets
  ? new Map(
      JSON.parse(
        await readFile(path.join(root, 'assets/public-performance/manifest.json'), 'utf8'),
      ).records.map((record) => [record.sourceUrl, record]),
    )
  : null;
for (const asset of assets) {
  for (const record of [asset, ...(asset.lods || [])]) {
    if (
      !/^\/models\/[a-z0-9-]+\/(model(?:-[a-z0-9]+)*|lod(?:\d+|-[a-z0-9-]+))\.glb$/.test(record.url)
    )
      throw new Error(`Unexpected model URL: ${record.url}`);
    if (downloads.has(record.url)) continue;
    let bytes = await readFile(path.join(root, `public${record.url}`));
    if (hash(bytes) !== record.sha256 || bytes.length !== record.bytes)
      throw new Error(`Model mismatch: ${record.url}`);
    const download = { url: record.url, sha256: record.sha256, bytes: record.bytes };
    if (optimized) {
      const derived = optimized.get(record.url);
      if (
        !derived ||
        derived.sourceSha256 !== record.sha256 ||
        derived.sourceBytes !== record.bytes
      )
        throw new Error(`Missing or stale public optimization: ${record.url}`);
      if (!/^assets\/public-performance\/models\/[a-z0-9-]+\.glb$/.test(derived.file))
        throw new Error(`Invalid optimized path: ${derived.file}`);
      bytes = await readFile(path.join(root, derived.file));
      if (bytes.length !== derived.bytes || hash(bytes) !== derived.sha256)
        throw new Error(`Optimized model mismatch: ${record.url}`);
      Object.assign(download, { url: derived.url, sha256: derived.sha256, bytes: derived.bytes });
    }
    if (bytes.length > fileLimit) {
      download.parts = [];
      for (let offset = 0, part = 0; offset < bytes.length; offset += partSize, part++) {
        const chunk = bytes.subarray(offset, offset + partSize);
        const url = `${download.url.slice(0, -4)}-${download.sha256.slice(0, 12)}.part-${part + 1}.bin`;
        await publish(url, chunk);
        download.parts.push({ url, bytes: chunk.length, sha256: hash(chunk) });
      }
      const reconstructed = Buffer.concat(
        await Promise.all(
          download.parts.map((part) => readFile(path.join(staging, part.url.slice(1)))),
        ),
      );
      if (!bytes.equals(reconstructed))
        throw new Error(`Model reconstruction failed: ${record.url}`);
    } else await publish(download.url, bytes);
    downloads.set(record.url, download);
    models.push(download);
  }
  const textures = [
    ...(asset.runtimeTextures || []),
    ...Object.values(asset).filter(
      (value) =>
        value &&
        typeof value === 'object' &&
        typeof value.url === 'string' &&
        value.url.endsWith('.png'),
    ),
  ];
  for (const texture of textures) {
    if (!/^\/models\/[a-z0-9-]+\/[a-z0-9-]+\.png$/.test(texture.url))
      throw new Error(`Unexpected runtime texture: ${texture.url}`);
    const bytes = await readFile(path.join(root, `public${texture.url}`));
    if (bytes.length !== texture.bytes || hash(bytes) !== texture.sha256)
      throw new Error(`Runtime texture mismatch: ${texture.url}`);
    await publish(texture.url, bytes);
  }
}
const transform = (asset) => ({
  ...asset,
  ...downloads.get(asset.url),
  ...(asset.lods ? { lods: asset.lods.map((lod) => ({ ...lod, ...downloads.get(lod.url) })) } : {}),
});
for (const asset of assets) {
  const source = JSON.parse(
    await readFile(path.join(root, `public/models/${asset.modelKey}/asset.json`), 'utf8'),
  );
  await publish(
    `/models/${asset.modelKey}/asset.json`,
    Buffer.from(JSON.stringify(transform(source), null, 2)),
  );
}
await publish(
  '/models/world-assets.json',
  Buffer.from(JSON.stringify({ ...catalog, assets: worldAssets.map(transform) }, null, 2)),
);
for (const { key } of publicCharacters)
  await publish(
    `/models/${key}/portrait.png`,
    await readFile(path.join(root, `public/models/${key}/portrait.png`)),
  );
await publish(
  '/_headers',
  Buffer.from(
    '/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n  X-Frame-Options: DENY\n  Cache-Control: no-cache\n/models/*.bin\n  Cache-Control: public, max-age=31536000, immutable\n' +
      (optimized ? '/models/*.glb\n  Cache-Control: public, max-age=31536000, immutable\n' : ''),
  ),
);
if (files.size > 20000) throw new Error('Static asset file count exceeds the Free plan');
// Server modules use the same filtered character list as the browser. Never bundle
// the local-only catalog into the uploaded Worker or expose server modules as assets.
await mkdir(workerStaging, { recursive: true });
await cp(path.join(staging, 'shared'), path.join(workerStaging, 'shared'), { recursive: true });
for (const directory of ['application', 'cloudflare']) {
  await mkdir(path.join(workerStaging, directory), { recursive: true });
  for (const file of await readdir(path.join(root, 'dist', directory))) {
    if (!file.endsWith('.mjs')) continue;
    const bytes = await readFile(path.join(root, 'dist', directory, file));
    if (excludedSpecies.has('maruimo') && forbidden.test(bytes.toString('utf8')))
      throw new Error(`Excluded character in Worker module: ${directory}/${file}`);
    await writeFile(path.join(workerStaging, directory, file), bytes);
  }
}
async function retainAndSwap(source, target, previous) {
  const archive = path.join(root, 'output/cloudflare-deploy', `${previous}-${stamp}`);
  if (
    path.dirname(target) !== root ||
    path.dirname(source) !== path.join(root, 'output/cloudflare-deploy') ||
    path.dirname(archive) !== path.join(root, 'output/cloudflare-deploy')
  )
    throw new Error('Unexpected build destination');
  try {
    const info = await stat(target);
    if (!info.isDirectory()) throw new Error('Build destination is not a directory');
    await rename(target, archive);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await rename(source, target);
}
await retainAndSwap(workerStaging, workerDestination, 'previous-worker');
await retainAndSwap(staging, destination, 'previous');
const report = {
  builtAt: new Date().toISOString(),
  credits: release.credits,
  optimizedAssets: !!optimized,
  excludedCharacters: [...excludedSpecies],
  characters: publicCharacters,
  workerMain: 'dist-cloudflare-worker/cloudflare/worker.mjs',
  files: files.size,
  bytes: total,
  models,
  publicFiles: [...files.values()],
};
await writeFile(path.join(root, 'output/cloudflare-build.json'), JSON.stringify(report, null, 2));
console.log(
  `Cloudflare assets: ${files.size} files, ${(total / 1024 / 1024).toFixed(1)} MiB; ${models.length} exact GLBs, ${models.filter((model) => model.parts).length} split. Credits: ${release.credits}.`,
);
