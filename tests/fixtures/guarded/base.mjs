// An isolated temp repository with an APPLIED complete runtime adoption, for the guarded-surface@1
// tests. Trimmed from tests/runtime-adoption.test.mjs's fixture and built only with production
// code (inventory, standalone-image planning, planAdoption/writePlan/applyAdoption):
//   - tree: ordinary, primary + one LOD, real connected grids (served r01 candidates are plain GLBs);
//   - hero: a startup actor whose startup file is a real animated grid; its old LOD is cleared;
//   - camp-cave: its standalone images (two adopted, one kept), the cave GLB a placeholder.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { applyAdoption, planAdoption, writePlan } from '../../../scripts/optimization/adoption.mjs';
import {
  CANDIDATE_STATUS,
  MANIFEST_SCHEMA,
  MESHOPTIMIZER_VERSION,
  ORIGINAL_KEPT_STATUS,
  STANDALONE_ROLE,
  STARTUP_ROLE,
  runtimeIndexOf,
} from '../../../scripts/optimization/contract.mjs';
import { packGlb, sha256 } from '../../../scripts/optimization/glb.mjs';
import { CATALOG, buildInventory } from '../../../scripts/optimization/inventory.mjs';
import { imageCandidateLocation } from '../../../scripts/optimization/paths.mjs';
import { planStandaloneImages } from '../../../scripts/optimization/standalone-images.mjs';
import { DECODER, MESHOPT_EXTENSION } from '../../../scripts/runtime-graph.mjs';
import { gridGlb, gridTriangles } from './glb.mjs';

export const REVISION = 'assets/optimized-runtime/20991231-r01';
export const BASE_ID = '20991231-r01-a01';
export const BASE_ACCEPTANCE = ['output/review/acceptance.md'];
export const RULES = {
  mascotModelReleased: () => true,
  groundcoverVisible: () => true,
  characterModels: [{ key: 'hero', species: 'cro' }],
  excludedSpecies: [],
  inputs: [
    { path: 'dist/shared/mascot-roster.mjs', sha256: 'a'.repeat(64) },
    { path: 'cloudflare/public-release.json', sha256: 'b'.repeat(64) },
  ],
};
// Today's verified cave loader in miniature (as in tests/runtime-adoption.test.mjs).
const CAVE_RUNTIME = Object.freeze({
  'src/cave-gallery-layout.ts': `export const CAVE_MOTIFS = {
  friends: [0, 0, 900, 300],
  comingSoon: [0, 0, 2048, 512],
  bison: [10, 10, 1000, 500],
  deer: [1100, 10, 2000, 1000],
} as const;
export const CAVE_EXTRA_PIGMENTS = {
  friends: { url: '/models/camp-cave/friends-r01.png', subjects: ['fox'] },
} as const;
export function caveMotifSource(motif) {
  const [, , x1, y1] = CAVE_MOTIFS[motif];
  const extra = motif in CAVE_EXTRA_PIGMENTS || motif === 'comingSoon';
  const [imageWidth, imageHeight] =
    extra || motif === 'creature524' ? [x1, y1] : motif === 'rimoFrieze' ? [2172, 724] : [2048, 1024];
  return { width: imageWidth, height: imageHeight };
}
export function caveMuralImages(asset) {
  const extras = {};
  for (const key of Object.keys(CAVE_EXTRA_PIGMENTS)) extras[key] = asset?.mascotPigments?.[key];
  return { pigment: asset?.pigment, extras };
}
`,
  'src/verified-texture.ts': `export function caveImageRecords(asset) {
  const murals = caveMuralImages(asset);
  const rock = asset?.rockSurface;
  return { pigment: murals.pigment, rockSurface: rock, ...murals.extras };
}
export function loadCaveTextures(asset, anisotropy, options = {}) {
  const records = caveImageRecords(asset);
  const entries = Object.keys(records).map((key) => {
    const repeat = key === 'rockSurface';
    const settings = { colorSpace: THREE.SRGBColorSpace, anisotropy, repeat };
    return [key, records[key], settings];
  });
  return new VerifiedTextureBatch(entries, options);
}
`,
  'src/loading-cave.ts':
    'const images = (this.images = loadCaveTextures(template.asset, anisotropy, this.imageOptions));\n',
  'src/world-landmarks.ts':
    'images = loadCaveTextures(template.asset, anisotropy, this.imageOptions);\n',
});

export const text = (value) => `${JSON.stringify(value, null, 2)}\n`;
export const file = (root, relative) => path.join(root, ...relative.split('/'));
export async function put(root, relative, bytes) {
  await mkdir(path.dirname(file(root, relative)), { recursive: true });
  await writeFile(file(root, relative), bytes);
}
const placeholder = (name, compressed = false) =>
  packGlb({
    asset: { version: '2.0' },
    ...(compressed
      ? { extensionsUsed: [MESHOPT_EXTENSION], extensionsRequired: [MESHOPT_EXTENSION] }
      : {}),
    extras: { name },
  });
const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function chunk(type, data) {
  const head = Buffer.alloc(8),
    crc = Buffer.alloc(4);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  let c = 0xffffffff;
  for (const byte of Buffer.concat([head.subarray(4), data]))
    c = CRC[(c ^ byte) & 0xff] ^ (c >>> 8);
  crc.writeUInt32BE((c ^ 0xffffffff) >>> 0, 0);
  return Buffer.concat([head, data, crc]);
}
/** Header-only PNG (size and hash checks only), as the runtime-adoption fixture uses for cave images. */
export function headerPng(width, height, label, alpha = true) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = alpha ? 6 : 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('tEXt', Buffer.from(`Comment\0${label}`, 'latin1')),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
const identity = (url, bytes, extra = {}) => ({
  url,
  sha256: sha256(bytes),
  bytes: bytes.length,
  ...extra,
});

/** Build the repository and apply the complete adoption BASE_ID. Returns { root, assets, bySource, startup }. */
export async function appliedBase() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cro-guarded-')),
    originals = {},
    original = async (url, bytes) => {
      await put(root, `public${url}`, bytes);
      originals[url] = bytes;
      return bytes;
    };
  const tree = await original(
      '/models/tree/model.glb',
      gridGlb({ name: 'tree', cols: 16, rows: 16 }),
    ),
    treeLod = await original(
      '/models/tree/lod1.glb',
      gridGlb({ name: 'tree lod', cols: 6, rows: 6 }),
    ),
    cave = await original('/models/camp-cave/model-r26.glb', placeholder('cave')),
    hero = await original('/models/hero/model-c2.glb', placeholder('hero')),
    heroLod = await original('/models/hero/lod-c2.glb', placeholder('hero lod')),
    pigment = await original('/models/camp-cave/pigment-r01.png', headerPng(2048, 1024, 'pigment')),
    limestone = await original(
      '/models/camp-cave/limestone-r01.png',
      headerPng(1500, 1500, 'limestone', false),
    ),
    friends = await original('/models/camp-cave/friends-r01.png', headerPng(900, 300, 'friends')),
    old = await original('/models/camp-cave/old-r01.png', headerPng(512, 512, 'old'));
  const assets = {
    tree: {
      modelKey: 'tree',
      name: '木',
      kind: 'tree',
      ...identity('/models/tree/model.glb', tree, { triangles: gridTriangles(16, 16) }),
      notes: ['unrelated note'],
      lods: [
        identity('/models/tree/lod1.glb', treeLod, {
          triangles: gridTriangles(6, 6),
          distanceMetres: 30,
          purpose: 'far',
        }),
      ],
    },
    cave: {
      modelKey: 'camp-cave',
      kind: 'static',
      ...identity('/models/camp-cave/model-r26.glb', cave, { triangles: 500 }),
      lods: [],
      pigment: {
        ...identity('/models/camp-cave/pigment-r01.png', pigment),
        source: 'assets/camp-cave/source/pigment-r01.png',
        image: { width: 2048, height: 1024 },
        previous: { url: '/models/camp-cave/old-r01.png', sha256: sha256(old) },
      },
      rockSurface: {
        ...identity('/models/camp-cave/limestone-r01.png', limestone),
        image: { width: 1500, height: 1500 },
      },
      mascotPigments: {
        friends: {
          ...identity('/models/camp-cave/friends-r01.png', friends),
          image: { width: 900, height: 300 },
          subjects: ['fox'],
        },
      },
    },
    hero: {
      modelKey: 'hero',
      name: 'Hero',
      kind: 'humanoid',
      ...identity('/models/hero/model-c2.glb', hero, { triangles: 900 }),
      lods: [
        identity('/models/hero/lod-c2.glb', heroLod, {
          triangles: 300,
          distanceMetres: 28,
          purpose: 'animated-medium-lod-geometry',
        }),
      ],
      species: 'cro',
    },
  };
  await put(root, CATALOG, text({ schemaVersion: 1, assets: [assets.tree, assets.cave] }));
  for (const asset of [assets.tree, assets.cave, assets.hero])
    await put(root, `public/models/${asset.modelKey}/asset.json`, text(asset));
  await put(root, DECODER.source, 'export const MeshoptDecoder = { supported: true };\n');
  await put(root, 'node_modules/three/package.json', text({ name: 'three', version: '0.185.0' }));
  await put(root, BASE_ACCEPTANCE[0], 'accepted for integration\n');

  const inventory = await buildInventory(root, RULES),
    triangles = Object.fromEntries(
      Object.values(assets).flatMap((asset) =>
        [asset, ...(asset.lods ?? [])].map((record) => [record.url, record.triangles]),
      ),
    ),
    stored = {},
    output = (sourceUrl, bytes, base, extra = {}) => {
      const digest = sha256(bytes),
        name = base ?? sourceUrl.slice(sourceUrl.lastIndexOf('/') + 1, -'.glb'.length),
        relative = `models/${sourceUrl.split('/')[2]}/${name}.opt-${digest.slice(0, 16)}.glb`;
      stored[relative] = bytes;
      return {
        file: relative,
        url: `/${relative}`,
        sha256: digest,
        bytes: bytes.length,
        maximumTextureEdge: 1024,
        extensionsUsed: [],
        extensionsRequired: [],
        ...extra,
      };
    },
    // The served r01 candidates: plain GLBs (different bytes from the originals) for the tree,
    // placeholders for the rest.
    candidateBytes = (url) =>
      url === '/models/tree/model.glb'
        ? gridGlb({ name: 'tree', cols: 16, rows: 16, generator: 'r01 candidate' })
        : url === '/models/tree/lod1.glb'
          ? gridGlb({ name: 'tree lod', cols: 6, rows: 6, generator: 'r01 candidate' })
          : placeholder(`${url} compressed`, true),
    files = [],
    bySource = new Map();
  for (const model of inventory.models.filter((candidate) => candidate.eligible))
    for (const source of model.files) {
      const bytes = candidateBytes(source.url),
        record = {
          id: source.url,
          role: source.role,
          uses: [{ modelKey: model.modelKey, role: source.role, lodIndex: source.lodIndex }],
          source: {
            ...identity(source.url, originals[source.url]),
            triangles: triangles[source.url],
          },
          output: output(source.url, bytes, null, {
            triangles: triangles[source.url],
            ...(source.url.startsWith('/models/tree/')
              ? {}
              : { extensionsUsed: [MESHOPT_EXTENSION], extensionsRequired: [MESHOPT_EXTENSION] }),
          }),
          derivation: {},
          verification: { status: 'passed', triangles: triangles[source.url] },
          status: CANDIDATE_STATUS,
          knownRisks: [],
        };
      files.push(record);
      bySource.set(source.url, record);
    }
  const full = bySource.get(assets.hero.url),
    lod = bySource.get(assets.hero.lods[0].url),
    // Animated (one clip, one channel): the posed evidence must name its clip, channels and poses.
    startupGlb = gridGlb({ name: 'hero startup', cols: 12, rows: 12, clip: 'walk' }),
    startup = {
      id: 'startup:hero',
      role: STARTUP_ROLE,
      uses: [{ modelKey: 'hero', role: STARTUP_ROLE, lodIndex: null }],
      source: { geometry: lod.source, full: full.source },
      output: output(assets.hero.url, startupGlb, 'startup', { triangles: gridTriangles(12, 12) }),
      upgrade: {
        sourceUrl: full.source.url,
        url: full.output.url,
        sha256: full.output.sha256,
        bytes: full.output.bytes,
      },
      lodDistanceMetres: 28,
      derivation: {
        startup: {
          geometry: {
            lowLevel: 'startup geometry at every distance',
            primitives: [
              {
                mesh: 0,
                primitive: 0,
                material: 'Body',
                source: 'source-simplified',
                retention: null,
              },
            ],
          },
          primitives: [],
        },
      },
      verification: { status: 'passed', triangles: gridTriangles(12, 12) },
      status: CANDIDATE_STATUS,
      knownRisks: [],
    };
  files.push(startup);
  for (const [relative, source] of Object.entries(CAVE_RUNTIME)) await put(root, relative, source);
  const planned = await planStandaloneImages(root, {
      inventory,
      rules: RULES,
      edges: new Map([['camp-cave', 1024]]),
    }),
    images = planned.images.map((item) => {
      let result = null;
      if (item.job) {
        const { width, height } = item.plan.target,
          { url, alpha } = item.plan.source,
          data = headerPng(width, height, `${url} candidate`, alpha),
          location = imageCandidateLocation(url, sha256(data));
        stored[location.file] = data;
        result = {
          file: location.file,
          url: location.url,
          sha256: sha256(data),
          bytes: data.length,
          format: 'png',
          mimeType: 'image/png',
          width,
          height,
          alpha,
          maximumTextureEdge: 1024,
        };
      }
      return {
        id: item.id,
        role: STANDALONE_ROLE,
        plan: item.plan,
        output: result,
        verification: result
          ? { status: 'passed', width: result.width, height: result.height }
          : null,
        status: result ? CANDIDATE_STATUS : ORIGINAL_KEPT_STATUS,
        knownRisks: result ? item.risks : [],
      };
    }),
    manifest = {
      schema: MANIFEST_SCHEMA,
      revision: '20991231-r01',
      directory: REVISION,
      status: 'candidate',
      adoption: 'not-adopted',
      scope: { complete: true, only: [] },
      toolchain: { meshoptimizer: MESHOPTIMIZER_VERSION },
      options: { webpQuality: 90, colorFilter: 'lanczos' },
      inputs: {
        manifests: inventory.manifests,
        eligibility: RULES.inputs,
        standaloneImages: planned.inputs,
      },
      standaloneImagesSkipped: planned.skipped,
      models: inventory.models.map((model) => ({
        modelKey: model.modelKey,
        kind: model.kind,
        manifest: model.manifest,
        worldCatalog: model.worldCatalog,
        publicCharacter: model.publicCharacter,
        eligible: model.eligible,
        reason: model.reason,
        reviewed: true,
        selected: model.eligible,
        files: model.files.map((source) => ({
          role: source.role,
          lodIndex: source.lodIndex,
          ...identity(source.url, originals[source.url]),
          candidate: model.eligible ? bySource.get(source.url).output.url : null,
        })),
        startupActor: model.modelKey === 'hero' ? startup.output.url : null,
      })),
      files,
      images,
    };
  await put(root, `${REVISION}/manifest.json`, text(manifest));
  await put(root, `${REVISION}/runtime-index.json`, text(runtimeIndexOf(manifest)));
  await put(
    root,
    `${REVISION}/verification.json`,
    text({
      schema: 'cro-magnon/optimized-runtime-verification@1',
      revision: '20991231-r01',
      status: 'passed',
      checks: [{ name: 'fixture', status: 'passed' }],
      files: [...files, ...images].map((record) => ({
        id: record.id,
        status: 'passed',
        verification: record.verification,
      })),
    }),
  );
  for (const [relative, bytes] of Object.entries(stored))
    await put(root, `${REVISION}/${relative}`, bytes);
  await writePlan(
    root,
    await planAdoption(root, {
      revision: REVISION,
      adoption: BASE_ID,
      acceptance: BASE_ACCEPTANCE,
      rules: RULES,
    }),
  );
  const report = await applyAdoption(root, BASE_ID, { rules: RULES });
  assert.equal(
    report.status,
    'passed',
    JSON.stringify(
      report.checks.filter((item) => item.status === 'failed'),
      null,
      2,
    ),
  );
  return { root, assets, bySource, startup };
}
