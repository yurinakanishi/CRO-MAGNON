import { mkdir, readFile, writeFile, readdir, stat, rename, cp } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareVendor } from './prepare-vendor.mjs';
import { bundleBrowser, bundledIndex } from './bundle-browser.mjs';
import { publicSiteHtml, siteHeaders } from './site-metadata.mjs';
import {
  assertPublicCharacterData,
  publicClothingDyeRulesModule,
} from './public-character-audit.mjs';
import {
  DECODER,
  MESHOPT_EXTENSION,
  activeAdoption,
  assertSameDigests,
  checkDecoder,
  checkModelUrl,
  checkRuntimeGraph,
  checkTextureImage,
  checkTextureUrl,
  glbExtensionsRequired,
  manifestDigests,
  retiredLiteralsIn,
} from './runtime-graph.mjs';
import {
  deliveredAsset,
  deliveryGraph,
  deliveryLedger,
  textureLedger,
} from './delivery/delivery-graph.mjs';
import { cookedFixedPng } from './delivery/delivery-cache.mjs';
import './build.mjs';
if (process.exitCode) throw new Error('TypeScript build failed');
const { CHARACTER_MODELS } = await import('../dist/shared/characters.mjs');
const { CLOTHING_DYE_RULES } = await import('../dist/src/clothing-dye-rules.js');
const { characterPortraitUrls } = await import('../dist/src/character-portraits.js');
const { MASCOT_PORTRAITS } = await import('../dist/src/mascot-portraits.js');
const { CHARACTER_ROSTER, characterModelReleased, characterSpeciesReleased } =
  await import('../dist/shared/character-roster.mjs');
const { GROUND_MASCOTS } = await import('../dist/shared/friend-mascots.mjs');
const { mascotModelReleased, mascotAsset, ACTIVE_MASCOT_MODELS } =
  await import('../dist/shared/mascot-roster.mjs');
const { TITLE_CREDITS, TITLE_GUEST, TITLE_SUPPORT, TITLE_DOTS, TITLE_FRIENDS } =
  await import('../dist/src/title-credit-profiles.js');

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const {
  browserBuildProfile,
  environmentAsset,
  auditEnvironmentDirectory,
  runtimeTextureRecords,
  runtimeBotPortraitUrls,
} = await import('./environment-assets.mjs');
const profile = browserBuildProfile('mmo', new Date().toISOString());
await prepareVendor({ cameraControls: false });
// A separate output root permits QA without replacing an active preview's files.
const outputArg = process.argv.find((arg) => arg.startsWith('--output-root='));
const buildRoot = outputArg ? path.resolve(root, outputArg.slice('--output-root='.length)) : root;
if (outputArg) {
  const relative = path.relative(path.join(root, 'output'), buildRoot);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative))
    throw new Error('MMO output root must be a subfolder of output/.');
  await mkdir(buildRoot, { recursive: true });
}
const destination = path.join(buildRoot, 'dist-cloudflare');
const workerDestination = path.join(buildRoot, 'dist-cloudflare-worker');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const staging = path.join(root, 'output/cloudflare-deploy', `build-${stamp}`);
const workerStaging = path.join(root, 'output/cloudflare-deploy', `worker-build-${stamp}`);
const workerFiles = [];
const release = JSON.parse(
  await readFile(path.join(root, 'cloudflare/public-release.json'), 'utf8'),
);
if (release.credits !== 'full')
  throw new Error('The shared contributor list requires full credits');
if (
  !Array.isArray(release.excludedCharacters) ||
  release.excludedCharacters.some(
    (species) => !CHARACTER_MODELS.some((model) => model.species === species),
  )
)
  throw new Error('Invalid excluded characters');
const excludedSpecies = new Set(release.excludedCharacters);
const hiddenPortraitSpecies = new Set([
  ...excludedSpecies,
  ...CHARACTER_ROSTER.filter((entry) => !entry.enabled).map((entry) => entry.species),
]);
const excludedModels = CHARACTER_MODELS.filter((model) => excludedSpecies.has(model.species));
const excludedKeys = new Set(excludedModels.map((model) => model.key));
const publicCharacters = CHARACTER_MODELS.filter(
  (model) =>
    model.playable !== false &&
    !excludedSpecies.has(model.species) &&
    characterSpeciesReleased(model.species),
);
if (!publicCharacters.some((model) => model.species === 'cro'))
  throw new Error('Missing default public character');
const hasOctopus = publicCharacters.some((model) => model.bodyPlan === 'octopus');
// The title and cave share the complete cast (2026-10-16), independently of mascot release.
const credits = TITLE_CREDITS;
const friends = TITLE_FRIENDS;
const fileLimit = 25 * 1024 * 1024;
const partSize = 24 * 1024 * 1024;
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const files = new Map();
const models = [];
let total = 0;
await mkdir(staging, { recursive: true });

async function publish(url, bytes) {
  const name = url.replace(/^\//, '');
  if (name.startsWith('models/') && !mascotModelReleased(name.split('/')[1]))
    throw new Error(`Dormant mascot file in MMO release: ${url}`);
  if (name.startsWith('models/') && !characterModelReleased(name.split('/')[1]))
    throw new Error(`Dormant character file in MMO release: ${url}`);
  bytes = environmentAsset(name, bytes, profile);
  if (bytes === undefined) return;
  if (!name || name.split('/').some((part) => !part || part === '.' || part === '..'))
    throw new Error(`Unexpected public path: ${url}`);
  if (bytes.length > fileLimit) throw new Error(`Static asset exceeds 25 MiB: ${url}`);
  assertPublicCharacterData(name, bytes, excludedKeys, excludedSpecies);
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
        file === 'dist/src/clothing-dye-rules.js' ||
        file === 'dist/shared/character-profiles.mjs' ||
        (!hasOctopus && file === 'dist/src/octopus-pose.js')
      )
        continue;
      let bytes = await readFile(path.join(root, file));
      if (file === 'dist/src/solo-worker.js') {
        // Input for the final filtered bundle; only its bundled output enters the ledger.
        await writeFile(path.join(staging, 'src/solo-worker.js'), bytes);
        continue;
      }
      if (!hasOctopus && file === 'dist/src/character-assets.js') {
        const source = bytes.toString('utf8');
        const optionalImport =
          "asset.bodyPlan === 'octopus' ? await import('./octopus-pose.js') : null";
        if (!source.includes(optionalImport))
          throw new Error('Missing conditional public character import');
        bytes = Buffer.from(source.replace(optionalImport, 'null'));
      }
      if (file === 'dist/src/style.css') {
        const css = bytes
          .toString('utf8')
          .replace(/([^{}]+)\{([^{}]*)\}/g, (rule, selectors, body) => {
            if (
              ![...hiddenPortraitSpecies].some((species) =>
                selectors.includes(`.portrait.${species}`),
              )
            )
              return rule;
            const visible = selectors
              .split(',')
              .filter(
                (selector) =>
                  ![...hiddenPortraitSpecies].some((species) =>
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
await publish(
  '/src/clothing-dye-rules.js',
  Buffer.from(
    publicClothingDyeRulesModule(
      CLOTHING_DYE_RULES,
      new Set([
        ...excludedKeys,
        ...CHARACTER_ROSTER.filter((entry) => !entry.enabled).flatMap((entry) => entry.modelKeys),
      ]),
    ),
  ),
);
for (const directory of ['dist/src', 'dist/shared']) await collect(directory, /\.(js|mjs|css)$/);
await collect('public/vendor', /\.(js|mjs|wasm|txt)$/);
await collect('public/audio', /\.(wav|mp3|json|txt)$/);
await collect('public/spawn', /\.jpg$/);
await collect('public/title', /\.(png|jpe?g|webp)$/, (name) => {
  if (name === 'cro-magnon-mmo-transparent.png') return false;
  return !name.startsWith('qr-') && !name.startsWith('avatar-');
});
for (const file of [
  'favicon.svg',
  'favicon.ico',
  'robots.txt',
  'sitemap.xml',
  'site-analytics.js',
  'site-privacy.css',
])
  await publish('/' + file, await readFile(path.join(root, 'public', file)));
await publish('/build-profile.json', Buffer.from(JSON.stringify(profile)));
await publish(
  '/multiplayer-config.json',
  Buffer.from(
    JSON.stringify(
      {
        mode: 'solo',
        serverUrl: '',
        room: 'SOLO',
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
    `export const TITLE_CREDITS = ${JSON.stringify(credits)};\nexport const TITLE_GUEST = ${JSON.stringify(TITLE_GUEST)};\nexport const TITLE_SUPPORT = ${JSON.stringify(TITLE_SUPPORT)};\nexport const TITLE_DOTS = ${JSON.stringify(TITLE_DOTS)};\nexport const TITLE_FRIENDS = ${JSON.stringify(friends)};\n`,
  ),
);

// The public character/credit tables and camera-free module replacements above
// must be applied before bundling. Never bundle the unfiltered source tree.
const browserBundle = await bundleBrowser(staging);
for (const file of browserBundle.files) await publish('/' + file.name, file.bytes);
const siteConfig = JSON.parse(
  await readFile(path.join(root, 'cloudflare/site-config.json'), 'utf8'),
);
for (const file of ['index.html', 'en/index.html', 'privacy.html', 'en/privacy.html']) {
  const html = publicSiteHtml(await readFile(path.join(root, 'public', file)), siteConfig);
  await publish('/' + file, file.endsWith('index.html') ? bundledIndex(html) : html);
}

const catalog = JSON.parse(
  await readFile(path.join(root, 'public/models/world-assets.json'), 'utf8'),
);
for (const key of ACTIVE_MASCOT_MODELS) {
  if (!catalog.assets.some((asset) => asset.modelKey === key))
    catalog.assets.push(
      JSON.parse(await readFile(path.join(root, `public/models/${key}/asset.json`), 'utf8')),
    );
}
const worldAssets = catalog.assets
  .filter(
    (asset) =>
      !excludedKeys.has(asset.modelKey) &&
      !excludedSpecies.has(asset.species) &&
      mascotModelReleased(asset.modelKey) &&
      characterModelReleased(asset.modelKey),
  )
  .map(mascotAsset);
const assets = [...worldAssets];
for (const { key } of publicCharacters)
  if (!assets.some((asset) => asset.modelKey === key))
    assets.push(
      JSON.parse(await readFile(path.join(root, `public/models/${key}/asset.json`), 'utf8')),
    );
const downloads = new Map();
// The shipped graph is exactly what the manifests name. With optimizedAssets the manifests
// must carry an applied, audited runtime adoption (scripts/optimization/adopt-candidates.mjs),
// and every adopted record must be that adoption's file. The legacy
// assets/public-performance mapping is not consulted. --exact-assets drops only the adoption
// requirement (local MMO checks before adoption); every file is still verified.
const requireAdoption = !!release.optimizedAssets && !process.argv.includes('--exact-assets');
const sourceManifests = await manifestDigests(root, assets);
const adoption = await activeAdoption(root, assets, runtimeTextureRecords);
const runtimeGraph = checkRuntimeGraph(assets, adoption, {
  requireAdoption,
  textureRecords: runtimeTextureRecords,
  textureExtensions: ['png'],
});
// The checked masters ship as their cooked delivery files (scripts/delivery): the same scenes,
// rigs, clips and materials with lossy-filtered floats and re-encoded PNG colour, each verified
// against its master when cooked. Manifests are rewritten to name them; masters stay unchanged.
const delivery = await deliveryGraph(root, assets, { textureRecords: runtimeTextureRecords });
const masters = new Map();
let compressedModels = false;
for (const asset of assets) {
  for (const record of [asset, ...(asset.lods || [])]) {
    checkModelUrl(record.url, record.sha256);
    if (downloads.has(record.url)) continue;
    const master = await readFile(path.join(root, `public${record.url}`));
    if (hash(master) !== record.sha256 || master.length !== record.bytes)
      throw new Error(`Model mismatch: ${record.url}`);
    masters.set(record.url, { sha256: record.sha256, bytes: record.bytes });
    const cooked = delivery.deliveries.get(record.url);
    if (!cooked) throw new Error(`No delivery file for ${record.url}`);
    const bytes = cooked.cooked ? await readFile(cooked.file) : master;
    if (hash(bytes) !== cooked.sha256 || bytes.length !== cooked.bytes)
      throw new Error(`Delivery mismatch: ${cooked.url} for ${record.url}`);
    checkModelUrl(cooked.url, cooked.sha256);
    if (glbExtensionsRequired(bytes, cooked.url).includes(MESHOPT_EXTENSION))
      compressedModels = true;
    const download = { url: cooked.url, sha256: cooked.sha256, bytes: cooked.bytes };
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
    // Packed levels share one delivery file: list each physical file once.
    if (!models.some((model) => model.url === download.url)) models.push(download);
  }
  const textures = runtimeTextureRecords(asset);
  for (const texture of textures) {
    checkTextureUrl(texture.url, texture.sha256, ['png']);
    const bytes = await readFile(path.join(root, `public${texture.url}`));
    if (
      (texture.bytes !== undefined && bytes.length !== texture.bytes) ||
      hash(bytes) !== texture.sha256
    )
      throw new Error(`Runtime texture mismatch: ${texture.url}`);
    checkTextureImage(texture, bytes, texture.url);
    // The checked master ships as its cooked delivery file (same decoded size).
    const cooked = delivery.textures.get(texture.url) ?? {
      ...texture,
      bytes: bytes.length,
      cooked: false,
      report: { master: texture },
    };
    const shipped = cooked.cooked ? await readFile(cooked.file) : bytes;
    if (hash(shipped) !== cooked.sha256 || shipped.length !== cooked.bytes)
      throw new Error(`Texture delivery mismatch: ${cooked.url} for ${texture.url}`);
    checkTextureUrl(cooked.url, cooked.sha256, ['png', 'webp']);
    await publish(cooked.url, shipped);
  }
}
// Compressed models load only through the decoder Three ships with the published GLTFLoader.
const decoder = await checkDecoder(
  root,
  files.has(DECODER.published)
    ? await readFile(path.join(staging, ...DECODER.published.split('/')))
    : undefined,
  { required: compressedModels, adoption },
);
const transform = (asset) => {
  const delivered = deliveredAsset(asset, delivery.deliveries, delivery.textures);
  return {
    ...delivered,
    ...downloads.get(asset.url),
    ...(asset.lods
      ? { lods: delivered.lods.map((lod, i) => ({ ...lod, ...downloads.get(asset.lods[i].url) })) }
      : {}),
  };
};
for (const asset of assets) {
  const source = mascotAsset(
    JSON.parse(
      await readFile(path.join(root, `public/models/${asset.modelKey}/asset.json`), 'utf8'),
    ),
  );
  // A model's own manifest must name exactly the files shipped for it, never a stale one.
  if (typeof source.url === 'string') {
    checkRuntimeGraph([source], adoption, {
      requireAdoption,
      textureRecords: runtimeTextureRecords,
      textureExtensions: ['png'],
    });
    for (const record of [source, ...(source.lods || [])]) {
      const shipped = masters.get(record.url);
      if (!shipped || shipped.sha256 !== record.sha256 || shipped.bytes !== record.bytes)
        throw new Error(
          `/models/${asset.modelKey}/asset.json names ${record.url}, which this build does not ship`,
        );
    }
    for (const texture of runtimeTextureRecords(source)) {
      const shipped = delivery.textures.get(texture.url) ?? texture;
      if (
        (shipped !== texture && shipped.report.master.sha256 !== texture.sha256) ||
        files.get(shipped.url.slice(1))?.sha256 !== shipped.sha256
      )
        throw new Error(
          `/models/${asset.modelKey}/asset.json names ${texture.url}, which this build does not ship`,
        );
    }
  }
  await publish(
    `/models/${asset.modelKey}/asset.json`,
    Buffer.from(JSON.stringify(transform(source), null, 2)),
  );
}
await publish(
  '/models/world-assets.json',
  Buffer.from(JSON.stringify({ ...catalog, assets: worldAssets.map(transform) }, null, 2)),
);
// Portraits keep their fixed .png URLs (markup and CSS name them); each ships as its palette PNG
// when that is smaller and within the delivery quality bound (scripts/delivery/cook-texture.mjs).
// A portrait a manifest declares as a runtime texture keeps its master bytes, so the recorded
// SHA-256 stays true.
const declaredTextures = new Set(
  assets.flatMap((asset) => runtimeTextureRecords(asset).map((texture) => texture.url)),
);
const portrait = async (url) =>
  declaredTextures.has(url)
    ? await readFile(path.join(root, `public${url}`))
    : (await cookedFixedPng(root, `public${url}`)).bytes;
for (const { key } of publicCharacters) {
  await publish(`/models/${key}/portrait.png`, await portrait(`/models/${key}/portrait.png`));
  for (const url of characterPortraitUrls(key))
    await publish(url, await readFile(path.join(root, `public${url}`)));
}
for (const url of runtimeBotPortraitUrls(assets)) await publish(url, await portrait(url));
for (const { modelKey, url } of MASCOT_PORTRAITS)
  if (assets.some((asset) => asset.modelKey === modelKey))
    await publish(url, await readFile(path.join(root, `public${url}`)));
// Every released walking companion's selection card picture.
for (const friend of GROUND_MASCOTS.filter((friend) => ACTIVE_MASCOT_MODELS.includes(friend.key))) {
  const url = friend.portrait ?? `/models/${friend.key}/portrait.png`;
  await publish(url, await portrait(url));
}
// A year-long immutable cache is only safe when every shipped GLB name is content-addressed.
const immutableModels =
  !!adoption && models.every((model) => checkModelUrl(model.url, model.sha256));
await publish(
  '/_headers',
  Buffer.from(
    '/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n  X-Frame-Options: DENY\n  Permissions-Policy: camera=(), microphone=()\n  Cache-Control: no-cache\n/models/*.bin\n  Cache-Control: public, max-age=31536000, immutable\n' +
      siteHeaders +
      (immutableModels
        ? '/models/*.glb\n  Cache-Control: public, max-age=31536000, immutable\n'
        : ''),
  ),
);
// Quoted literals of files the adoption replaced, reported for review rather than refused: the
// runtime loads models and cave images from their verified manifest records, and the remaining
// literals (CAVE_EXTRA_PIGMENTS) name each frieze's original image. The graph checks above are
// the shipped-file proof.
const retiredLiterals = [];
for (const name of files.keys())
  if (/\.(?:m?js|css|html)$/.test(name))
    for (const url of retiredLiteralsIn(await readFile(path.join(staging, name), 'utf8'), adoption))
      retiredLiterals.push({ file: name, url });
assertSameDigests(sourceManifests, await manifestDigests(root, assets));
const audit = await auditEnvironmentDirectory(staging, files.keys(), profile);
if (files.size > 20000) throw new Error('Static asset file count exceeds the Free plan');
// The Worker applies the same release policy, retaining dormant appearance data
// for saves. Explicitly excluded public characters still stay out of its catalog.
await mkdir(workerStaging, { recursive: true });
await cp(path.join(staging, 'shared'), path.join(workerStaging, 'shared'), { recursive: true });
// Keep dormant appearances only in the server registry so existing saves can
// retain and later restore them. Browser choices and model files remain filtered.
await writeFile(
  path.join(workerStaging, 'shared/character-profiles.mjs'),
  `export const CHARACTER_MODELS = Object.freeze(${JSON.stringify(CHARACTER_MODELS.filter((model) => model.playable !== false && !excludedSpecies.has(model.species)))}.map(Object.freeze));\n`,
);
for (const directory of ['application', 'cloudflare']) {
  await mkdir(path.join(workerStaging, directory), { recursive: true });
  for (const file of await readdir(path.join(root, 'dist', directory))) {
    if (!file.endsWith('.mjs')) continue;
    const bytes = await readFile(path.join(root, 'dist', directory, file));
    assertPublicCharacterData(`${directory}/${file}`, bytes, excludedKeys, excludedSpecies);
    await writeFile(path.join(workerStaging, directory, file), bytes);
  }
}
for (const directory of ['shared', 'application', 'cloudflare']) {
  for (const file of await readdir(path.join(workerStaging, directory))) {
    const name = `${directory}/${file}`;
    const bytes = await readFile(path.join(workerStaging, name));
    workerFiles.push({ path: name, bytes: bytes.length, sha256: hash(bytes) });
  }
}
async function retainAndSwap(source, target, previous) {
  const archive = path.join(root, 'output/cloudflare-deploy', `${previous}-${stamp}`);
  if (
    path.dirname(target) !== buildRoot ||
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
  buildId: hash(Buffer.from(JSON.stringify({ publicFiles: [...files.values()], workerFiles }))),
  profile,
  audit,
  browserBundle: browserBundle.record,
  builtAt: new Date().toISOString(),
  credits: release.credits,
  optimizedAssets: !!adoption,
  runtimeAdoption: runtimeGraph.adoption,
  runtimeGraph,
  decoder,
  delivery: {
    recipe: delivery.recipe,
    summary: delivery.summary,
    files: deliveryLedger(delivery.deliveries),
    textures: textureLedger(delivery.textures),
  },
  immutableModelCache: immutableModels,
  retiredLiterals,
  sourceManifests,
  excludedCharacters: [...excludedSpecies],
  dormantCharacters: CHARACTER_ROSTER.filter((entry) => !entry.enabled).map(
    (entry) => entry.species,
  ),
  activeMascotModels: ACTIVE_MASCOT_MODELS,
  characters: publicCharacters,
  workerMain: path
    .relative(root, path.join(workerDestination, 'cloudflare/worker.mjs'))
    .replaceAll('\\', '/'),
  files: files.size,
  bytes: total,
  models,
  publicFiles: [...files.values()],
  workerFiles,
};
await writeFile(
  outputArg
    ? path.join(buildRoot, 'cloudflare-build.json')
    : path.join(root, 'output/cloudflare-build.json'),
  JSON.stringify(report, null, 2),
);
console.log(
  `Cloudflare assets: ${files.size} files, ${(total / 1024 / 1024).toFixed(1)} MiB; ${models.length} GLBs (${delivery.summary.cooked} cooked for delivery, ${(delivery.summary.masterBytes / 1024 / 1024).toFixed(1)} → ${(delivery.summary.deliveryBytes / 1024 / 1024).toFixed(1)} MiB), ${models.filter((model) => model.parts).length} split. Credits: ${release.credits}. Runtime adoption: ${adoption ? adoption.id : 'none (exact manifest files)'}; meshopt decoder ${decoder.required ? 'included' : 'not needed'}; immutable GLB cache ${immutableModels ? 'on' : 'off'}; ${retiredLiterals.length} quoted literal(s) of replaced files in shipped code (listed in the report).`,
);
