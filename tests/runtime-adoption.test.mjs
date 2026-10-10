// Runtime adoption (scripts/optimization/adoption.mjs) and the build graph checks shared by the
// local, exhibition and MMO builds (scripts/runtime-graph.mjs). Every fixture is tiny synthetic
// data in a temporary folder; the last test only reads the real r04 revision.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runtimeTextureRecords } from '../scripts/environment-assets.mjs';
import {
  LOD_REJECTIONS,
  SELECTION,
  applyAdoption,
  auditAdoption,
  planAdoption,
  restoreAdoption,
  rewriteManifestBytes,
  writePlan,
} from '../scripts/optimization/adoption.mjs';
import {
  CANDIDATE_STATUS,
  EXACT_REPACK_RECIPE,
  MANIFEST_SCHEMA,
  MESHOPTIMIZER_VERSION,
  ORIGINAL_KEPT_STATUS,
  PACKED_ROLE,
  STANDALONE_ROLE,
  STARTUP_ROLE,
  runtimeIndexOf,
} from '../scripts/optimization/contract.mjs';
import {
  EXACT_REPACK_REPORT,
  REPACK_SCOPE,
  generateExactRepack,
  scopeRecord,
  verifyExactRepack,
} from '../scripts/optimization/exact-repack.mjs';
import { packGlb, parseGlb, sha256, storedViewBytes } from '../scripts/optimization/glb.mjs';
import { checkLosslessRewrite } from '../scripts/optimization/png-idat.mjs';
import { readServedBase } from '../scripts/optimization/served-base.mjs';
import {
  CATALOG,
  buildInventory,
  loadEligibilityRules,
} from '../scripts/optimization/inventory.mjs';
import {
  DEFAULT_REVISION,
  REPO_ROOT,
  candidateLocation,
  imageCandidateLocation,
} from '../scripts/optimization/paths.mjs';
import {
  inheritedImageCompatibility,
  inheritedImageProblems,
} from '../scripts/optimization/chained-adoption.mjs';
import {
  MAPS_512,
  baseRecordOf,
  checkPartialRevision,
  checkPartialScope,
  modelSummary,
  readBaseAdoption,
  recordEdges,
  selectWork,
  supersededModels,
} from '../scripts/optimization/revision-scope.mjs';
import { planStandaloneImages } from '../scripts/optimization/standalone-images.mjs';
import { assertPublicCharacterData } from '../scripts/public-character-audit.mjs';
import {
  DECODER,
  MESHOPT_EXTENSION,
  RUNTIME_FIELD,
  activeAdoption,
  checkDecoder,
  checkModelUrl,
  checkRuntimeGraph,
  checkTextureImage,
  checkTextureUrl,
  glbExtensionsRequired,
  retiredLiteral,
} from '../scripts/runtime-graph.mjs';
import { CHUNKS, compressedGlb, pngFile, sceneGlb } from './exact-repack-fixtures.mjs';
import { assertGuardedHistoryStep } from './fixtures/guarded/lineage.mjs';
import { assertAppliedOrRevisedSource } from './fixtures/guarded/source-revision.mjs';

const REVISION = 'assets/optimized-runtime/20991231-r01',
  REVISION_NAME = '20991231-r01',
  ID = '20991231-r01-a01',
  ACCEPTANCE = ['output/review/acceptance.md'],
  RECORD = `assets/runtime-adoption/${ID}`;
// A partial revision on the applied ID, and its chained adoption.
const CHAIN_REVISION = 'assets/optimized-runtime/20991231-r02',
  CHAIN_ID = '20991231-r02-a01',
  CHAIN_ACCEPTANCE = ['output/review/acceptance-r02.md'],
  CHAIN_RECORD = `assets/runtime-adoption/${CHAIN_ID}`;
// An exact repack (exact-repack.mjs) of an applied adoption, and its adoption.
const REPACK_REVISION = 'assets/optimized-runtime/20991231-r03',
  REPACK_ID = '20991231-r03-a01',
  REPACK_ACCEPTANCE = ['output/review/acceptance-r03.md'],
  REPACK_RECORD = `assets/runtime-adoption/${REPACK_ID}`,
  // The tree packed (two levels, one shared PNG) and the cave's two adopted images.
  TREE_AND_CAVE = Object.freeze({
    models: ['tree'],
    packed: ['tree'],
    imageOwner: 'camp-cave',
    images: 2,
  }),
  CAVE_ONLY = Object.freeze({ models: [], packed: [], imageOwner: 'camp-cave', images: 2 }),
  // One zlib setting keeps the fixture quick: the stored pigment stream shrinks, and the limestone,
  // already deflated with exactly this setting, is retained.
  REPACK_SETTINGS = Object.freeze({
    level: 9,
    windowBits: 15,
    strategies: ['DEFAULT'],
    memLevels: [8],
  }),
  // The tree's embedded image: a stored zlib stream between colour, density and text chunks.
  TREE_PNG = pngFile({
    before: [CHUNKS.gAMA, CHUNKS.pHYs],
    after: [CHUNKS.tEXt],
    idatChunks: 2,
  }),
  PIGMENT = '/models/camp-cave/pigment-r01.png',
  LIMESTONE = '/models/camp-cave/limestone-r01.png';
// Same shape as loadEligibilityRules(): grass is disabled groundcover, octo an excluded species.
const RULES = {
  mascotModelReleased: () => true,
  groundcoverVisible: (key) => key !== 'grass',
  characterModels: [
    { key: 'hero', species: 'cro' },
    { key: 'fox', species: 'fennec' },
    { key: 'octo', species: 'maruimo' },
  ],
  excludedSpecies: ['maruimo'],
  inputs: [
    { path: 'dist/shared/mascot-roster.mjs', sha256: 'a'.repeat(64) },
    { path: 'cloudflare/public-release.json', sha256: 'b'.repeat(64) },
  ],
};
const OPTIONS = { revision: REVISION, adoption: ID, acceptance: ACCEPTANCE, rules: RULES };
const CHAIN_OPTIONS = {
  revision: CHAIN_REVISION,
  adoption: CHAIN_ID,
  base: ID,
  acceptance: CHAIN_ACCEPTANCE,
  rules: RULES,
};
const REPACK_OPTIONS = {
  revision: REPACK_REVISION,
  adoption: REPACK_ID,
  base: ID,
  acceptance: REPACK_ACCEPTANCE,
  rules: RULES,
};
// The runtime files the standalone image plan is read from: today's verified cave loader in
// miniature. The pigment atlas holds two motifs; the friends frieze is its own rectangle.
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

const text = (value) => `${JSON.stringify(value, null, 2)}\n`;
const file = (root, relative) => path.join(root, ...relative.split('/'));
async function put(root, relative, bytes) {
  await mkdir(path.dirname(file(root, relative)), { recursive: true });
  await writeFile(file(root, relative), bytes);
}
const readJson = async (root, relative) => JSON.parse(await readFile(file(root, relative), 'utf8'));
const glb = (name, compressed = false) =>
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
// Header-only PNG with a label so that equal sizes still differ; enough for size and hash checks.
function png(width, height, label, alpha = true) {
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

async function snapshot(root, directory) {
  const found = {};
  const visit = async (relative) => {
    if (!existsSync(file(root, relative))) return;
    for (const entry of await readdir(file(root, relative), { withFileTypes: true })) {
      const child = `${relative}/${entry.name}`;
      if (entry.isDirectory()) await visit(child);
      else found[child] = sha256(await readFile(file(root, child)));
    }
  };
  await visit(directory);
  return found;
}

/** A complete candidate revision. It holds:
 * - a catalog tree;
 * - the camp cave with standalone textures;
 * - disabled grass;
 * - two startup actors: hero (source-derived) and fox (a whole single primitive, whose startup
 *   file is byte-identical to its full candidate);
 * - an excluded octopus.
 * With `behemoth`, it also holds violet-behemoth with the reviewed files and triangle counts
 * of its rejected far LOD, plus placeholder review evidence. With `exact`, the files an exact
 * repack reads are real: the tree's two levels are static GLBs sharing one PNG (256 and 64
 * triangles), its r01 candidates their meshopt compression, and the cave candidates real PNGs (the
 * pigment's stream stored, the limestone's already deflated at level 9). */
async function fixture({ behemoth = false, exact = false } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cro-adoption-')),
    originals = {};
  const original = async (url, bytes) => {
    await put(root, `public${url}`, bytes);
    originals[url] = bytes;
    return bytes;
  };
  const tree = await original(
      '/models/tree/model.glb',
      exact ? sceneGlb({ name: 'tree', triangles: 256, image: TREE_PNG }) : glb('tree'),
    ),
    treeLod = await original(
      '/models/tree/lod1.glb',
      exact ? sceneGlb({ name: 'tree lod', triangles: 64, image: TREE_PNG }) : glb('tree lod'),
    ),
    cave = await original('/models/camp-cave/model-r26.glb', glb('cave')),
    grass = await original('/models/grass/model.glb', glb('grass')),
    hero = await original('/models/hero/model-c2.glb', glb('hero')),
    heroLod = await original('/models/hero/lod-c2.glb', glb('hero lod')),
    fox = await original('/models/fox/model-c2.glb', glb('fox')),
    foxLod = await original('/models/fox/lod-c2.glb', glb('fox lod')),
    octo = await original('/models/octo/model-c2.glb', glb('octo')),
    pigment = await original('/models/camp-cave/pigment-r01.png', png(2048, 1024, 'pigment')),
    limestone = await original(
      '/models/camp-cave/limestone-r01.png',
      png(1500, 1500, 'limestone', false),
    ),
    friends = await original('/models/camp-cave/friends-r01.png', png(900, 300, 'friends')),
    old = await original('/models/camp-cave/old-r01.png', png(512, 512, 'old'));
  const assets = {
    tree: {
      modelKey: 'tree',
      name: '木',
      kind: 'tree',
      ...identity('/models/tree/model.glb', tree, { triangles: exact ? 256 : 120 }),
      upAxis: 'Y',
      notes: ['unrelated note'],
      provenance: {
        previousDelivery: { url: '/models/tree/model-old.glb', sha256: 'f'.repeat(64) },
      },
      lods: [
        identity('/models/tree/lod1.glb', treeLod, {
          triangles: exact ? 64 : 40,
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
        references: [{ path: 'public/models/camp-cave/old-r01.png', sha256: sha256(old) }],
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
    grass: {
      modelKey: 'grass',
      kind: 'foliage',
      ...identity('/models/grass/model.glb', grass, { triangles: 10 }),
    },
    hero: {
      modelKey: 'hero',
      name: 'Hero',
      kind: 'humanoid',
      ...identity('/models/hero/model-c2.glb', hero, { triangles: 900 }),
      clips: [{ name: 'Idle_Loop', seconds: 4, loop: true }],
      lods: [
        identity('/models/hero/lod-c2.glb', heroLod, {
          triangles: 300,
          distanceMetres: 28,
          purpose: 'animated-medium-lod-geometry',
        }),
      ],
      species: 'cro',
      bones: 22,
    },
    fox: {
      modelKey: 'fox',
      kind: 'humanoid',
      ...identity('/models/fox/model-c2.glb', fox, { triangles: 800 }),
      lods: [identity('/models/fox/lod-c2.glb', foxLod, { triangles: 200, distanceMetres: 28 })],
      species: 'fennec',
    },
    octo: {
      modelKey: 'octo',
      kind: 'humanoid',
      ...identity('/models/octo/model-c2.glb', octo, { triangles: 600 }),
      species: 'maruimo',
    },
  };
  if (behemoth) {
    const { reviewed, evidence } = LOD_REJECTIONS['violet-behemoth'],
      full = await original(reviewed.model.url, glb('behemoth')),
      low = await original(reviewed.lods[0].url, glb('behemoth lod'));
    assets.behemoth = {
      modelKey: 'violet-behemoth',
      name: 'Behemoth',
      kind: 'enemy',
      ...identity(reviewed.model.url, full, { triangles: reviewed.model.triangles }),
      clips: [{ name: 'Walk_Loop', seconds: 1.2, loop: true, rootMotion: 'in-place' }],
      lods: [
        identity(reviewed.lods[0].url, low, {
          triangles: reviewed.lods[0].triangles,
          distanceMetres: 28,
          purpose: 'animated-medium-lod-geometry',
        }),
      ],
      placement: { pivot: 'ground-body-centred' },
      retainedOriginal: {
        url: '/models/violet-behemoth/model-r10.glb',
        sha256: '9'.repeat(64),
        active: false,
      },
    };
    for (const relative of evidence) await put(root, relative, png(64, 64, relative));
  }
  await put(
    root,
    CATALOG,
    text({
      schemaVersion: 1,
      assets: [assets.tree, assets.cave, assets.grass, ...(behemoth ? [assets.behemoth] : [])],
    }),
  );
  for (const asset of [
    assets.tree,
    assets.cave,
    assets.hero,
    assets.fox,
    assets.octo,
    ...(behemoth ? [assets.behemoth] : []),
  ])
    await put(root, `public/models/${asset.modelKey}/asset.json`, text(asset));
  await put(root, DECODER.source, 'export const MeshoptDecoder = { supported: true };\n');
  await put(root, 'node_modules/three/package.json', text({ name: 'three', version: '0.185.0' }));
  if (exact)
    await put(
      root,
      'node_modules/meshoptimizer/package.json',
      text({ name: 'meshoptimizer', version: MESHOPTIMIZER_VERSION }),
    );
  await put(root, ACCEPTANCE[0], 'accepted for integration\n');

  // The revision, shaped as generate-candidates.mjs writes it.
  const inventory = await buildInventory(root, RULES),
    triangles = Object.fromEntries(
      Object.values(assets).flatMap((asset) =>
        [asset, ...(asset.lods ?? [])].map((record) => [record.url, record.triangles]),
      ),
    ),
    stored = {};
  const output = (sourceUrl, bytes, base, extra = {}) => {
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
      extensionsUsed: [MESHOPT_EXTENSION],
      extensionsRequired: [MESHOPT_EXTENSION],
      ...extra,
    };
  };
  const files = [],
    bySource = new Map();
  for (const model of inventory.models.filter((candidate) => candidate.eligible))
    for (const source of model.files) {
      const compressed =
        exact && model.modelKey === 'tree'
          ? await compressedGlb(originals[source.url], source.url)
          : glb(`${source.url} compressed`, true);
      const record = {
        id: source.url,
        role: source.role,
        uses: [{ modelKey: model.modelKey, role: source.role, lodIndex: source.lodIndex }],
        source: {
          ...identity(source.url, originals[source.url]),
          triangles: triangles[source.url],
        },
        output: output(source.url, compressed, null, {
          triangles: triangles[source.url],
        }),
        derivation: {},
        verification: { status: 'passed', triangles: triangles[source.url] },
        status: CANDIDATE_STATUS,
        knownRisks: [],
      };
      files.push(record);
      bySource.set(source.url, record);
    }
  const startup = (key, bytes, served) => {
    const full = bySource.get(assets[key].url),
      lod = bySource.get(assets[key].lods[0].url);
    return {
      id: `startup:${key}`,
      role: STARTUP_ROLE,
      uses: [{ modelKey: key, role: STARTUP_ROLE, lodIndex: null }],
      source: { geometry: lod.source, full: full.source },
      output: output(assets[key].url, bytes, 'startup', { triangles: served }),
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
      verification: { status: 'passed', triangles: served },
      status: CANDIDATE_STATUS,
      knownRisks: [],
    };
  };
  const heroStartup = startup('hero', glb('hero startup', true), 700),
    foxStartup = startup('fox', stored[bySource.get(assets.fox.url).output.file], 800);
  files.push(heroStartup, foxStartup);
  // The standalone images, planned as generate-candidates.mjs plans them: from the manifests and
  // the syntax of the runtime files (today's verified cave loader, in miniature).
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
          data = exact
            ? pngFile({
                width,
                height,
                alpha,
                ...(url.endsWith('/limestone-r01.png') ? { level: 9, idatChunks: 1 } : {}),
              })
            : png(width, height, `${url} candidate`, alpha),
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
    });
  assert.deepEqual(
    images.map((record) => record.id),
    [
      'image:/models/camp-cave/pigment-r01.png',
      'image:/models/camp-cave/limestone-r01.png',
      'image:/models/camp-cave/friends-r01.png',
    ],
  );
  const startupUrls = { hero: heroStartup.output.url, fox: foxStartup.output.url },
    manifest = {
      schema: MANIFEST_SCHEMA,
      revision: REVISION_NAME,
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
        startupActor: startupUrls[model.modelKey] ?? null,
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
      revision: REVISION_NAME,
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
  return { root, assets, bySource, heroStartup, foxStartup, images };
}

async function withFixture(run, options) {
  const world = await fixture(options);
  try {
    await run(world);
  } finally {
    await rm(world.root, { recursive: true, force: true });
  }
}

async function editRevision(root, edit) {
  const manifest = await readJson(root, `${REVISION}/manifest.json`);
  edit(manifest);
  await put(root, `${REVISION}/manifest.json`, text(manifest));
  await put(root, `${REVISION}/runtime-index.json`, text(runtimeIndexOf(manifest)));
}

test('a plan only reads, records the exact contract graph and never reuses a record', async () => {
  await withFixture(async ({ root, assets, bySource, heroStartup, foxStartup }) => {
    const publicBefore = await snapshot(root, 'public'),
      result = await planAdoption(root, OPTIONS),
      { graph, operations, totals } = result.plan;
    assert.deepEqual(Object.keys(graph.models).sort(), ['camp-cave', 'fox', 'hero', 'tree']);
    assert.deepEqual(graph.notAdopted, {
      grass: 'decorative-groundcover-disabled',
      octo: 'excluded-from-public-release',
    });
    // The reviewed LOD rejection names only violet-behemoth; it touches nothing else.
    assert.deepEqual(graph.lodRejections, { 'violet-behemoth': 'not-adopted-by-this-revision' });
    assert.equal(totals.fullOnlyModels, 0);
    // Startup actors: their startup file is the sole primary at every distance; old LODs go.
    for (const [key, record] of [
      ['hero', heroStartup],
      ['fox', foxStartup],
    ]) {
      const entry = graph.models[key];
      assert.equal(entry.selection, SELECTION.startup);
      assert.equal(entry.primary.url, record.output.url);
      assert.equal(entry.primary.triangles, record.output.triangles);
      assert.deepEqual(entry.lods, []);
      assert.deepEqual(
        entry.clearedLods.map((lod) => lod.url),
        [assets[key].lods[0].url],
      );
      for (const url of [
        assets[key].url,
        assets[key].lods[0].url,
        bySource.get(assets[key].url).output.url,
        bySource.get(assets[key].lods[0].url).output.url,
      ])
        assert.ok(graph.retired.includes(url), url);
    }
    assert.equal(graph.models.hero.identicalFullCandidate, null);
    // Fox: byte-identical full/startup content is served under one URL, with the proof recorded.
    assert.equal(
      graph.models.fox.identicalFullCandidate.url,
      bySource.get(assets.fox.url).output.url,
    );
    assert.equal(graph.models.fox.identicalFullCandidate.sha256, foxStartup.output.sha256);
    assert.equal(graph.models.tree.selection, SELECTION.ordinary);
    assert.deepEqual(
      graph.models.tree.lods.map((lod) => lod.url),
      [bySource.get(assets.tree.lods[0].url).output.url],
    );
    assert.deepEqual(graph.textures['/models/camp-cave/pigment-r01.png'].uvSource, {
      width: 2048,
      height: 1024,
    });
    assert.equal(graph.textures['/models/camp-cave/limestone-r01.png'].wrap, 'repeat');
    assert.deepEqual(
      graph.keptTextures.map((kept) => kept.url),
      ['/models/camp-cave/friends-r01.png'],
    );
    assert.deepEqual(
      operations.copies.map((copy) => copy.url),
      [
        bySource.get(assets.cave.url).output.url,
        graph.textures['/models/camp-cave/limestone-r01.png'].url,
        graph.textures['/models/camp-cave/pigment-r01.png'].url,
        foxStartup.output.url,
        heroStartup.output.url,
        bySource.get(assets.tree.lods[0].url).output.url,
        bySource.get(assets.tree.url).output.url,
      ].sort(),
    );
    assert.deepEqual(
      operations.manifests.map((operation) => operation.path),
      [
        CATALOG,
        'public/models/camp-cave/asset.json',
        'public/models/fox/asset.json',
        'public/models/hero/asset.json',
        'public/models/tree/asset.json',
      ],
    );
    // Only the declared runtime paths change; triangles stay where the served count is equal.
    assert.deepEqual(
      operations.manifests.find((operation) => operation.path === 'public/models/tree/asset.json')
        .changes,
      [
        '$.url',
        '$.sha256',
        '$.bytes',
        '$.lods[0].url',
        '$.lods[0].sha256',
        '$.lods[0].bytes',
        `$.${RUNTIME_FIELD}`,
      ],
    );
    assert.deepEqual(
      operations.manifests.find((operation) => operation.path === 'public/models/hero/asset.json')
        .changes,
      ['$.url', '$.sha256', '$.bytes', '$.triangles', '$.lods', `$.${RUNTIME_FIELD}`],
    );
    assert.equal(totals.startupActors, 2);
    assert.equal(totals.clearedLods, 2);
    // Unused full and LOD candidates stay archived, each identity recorded for the audit.
    assert.deepEqual(
      graph.retiredCandidates
        .map((retired) => [retired.modelKey, retired.role, retired.reason, retired.url])
        .sort(),
      [
        [
          'fox',
          'full',
          'identical-to-the-served-startup-file',
          bySource.get(assets.fox.url).output.url,
        ],
        ['fox', 'lod', 'rejected-old-lod', bySource.get(assets.fox.lods[0].url).output.url],
        ['hero', 'full', 'unused-full-candidate', bySource.get(assets.hero.url).output.url],
        ['hero', 'lod', 'rejected-old-lod', bySource.get(assets.hero.lods[0].url).output.url],
      ].sort(),
    );
    assert.deepEqual(graph.models.hero.farTriangles, { before: 300, after: 700, added: 400 });
    assert.deepEqual(
      await snapshot(root, 'public'),
      publicBefore,
      'planning wrote nothing under public/',
    );
    assert.equal(await writePlan(root, result), RECORD);
    const journal = await readJson(root, `${RECORD}/journal.json`);
    assert.equal(journal.state, 'planned');
    assert.equal(journal.planSha256, sha256(await readFile(file(root, `${RECORD}/plan.json`))));
    for (const operation of operations.manifests) {
      assert.equal(
        sha256(await readFile(file(root, `${RECORD}/before/${operation.path}`))),
        operation.before.sha256,
      );
      assert.equal(
        sha256(await readFile(file(root, `${RECORD}/after/${operation.path}`))),
        operation.after.sha256,
      );
    }
    assert.ok(
      existsSync(file(root, `${RECORD}/before/public/models/octo/asset.json`)),
      'every input manifest is saved',
    );
    await assert.rejects(writePlan(root, result), /already exists/);
    assert.deepEqual(await snapshot(root, 'public'), publicBefore);
  });
});

test('apply copies hash-named candidates, rewrites minimally, audits idempotently and refuses a second apply', async () => {
  await withFixture(async ({ root, assets, bySource, foxStartup }) => {
    const result = await planAdoption(root, OPTIONS),
      { graph } = result.plan;
    await writePlan(root, result);
    const publicBefore = await snapshot(root, 'public'),
      revisionBefore = await snapshot(root, REVISION);
    const report = await applyAdoption(root, ID, { rules: RULES });
    assert.equal(report.status, 'passed', JSON.stringify(report.checks, null, 2));
    assert.equal(report.applied, true);
    assert.deepEqual(
      (await readJson(root, `${RECORD}/journal.json`)).history.map((entry) => entry.state),
      ['planned', 'applying', 'applied'],
    );
    for (const copy of result.plan.operations.copies)
      assert.equal(sha256(await readFile(file(root, copy.to))), copy.sha256, copy.to);
    // Unused candidates (the actors' full and LOD files) are not copied.
    for (const url of [
      bySource.get(assets.hero.url).output.url,
      bySource.get(assets.hero.lods[0].url).output.url,
      bySource.get(assets.fox.url).output.url,
    ])
      assert.equal(existsSync(file(root, `public${url}`)), false, url);
    // Originals and the candidate revision are byte-for-byte unchanged.
    const publicAfter = await snapshot(root, 'public');
    for (const [name, digest] of Object.entries(publicBefore))
      if (!name.endsWith('.json') || name === 'public/models/octo/asset.json')
        assert.equal(publicAfter[name], digest, name);
    assert.deepEqual(await snapshot(root, REVISION), revisionBefore);

    const hero = await readJson(root, 'public/models/hero/asset.json'),
      { url, sha256: digest, bytes, triangles, lods, [RUNTIME_FIELD]: adopted, ...rest } = hero,
      {
        url: url0,
        sha256: digest0,
        bytes: bytes0,
        triangles: triangles0,
        lods: lods0,
        ...rest0
      } = assets.hero;
    assert.deepEqual(
      Object.keys(hero),
      [...Object.keys(assets.hero), RUNTIME_FIELD],
      'keys keep their order',
    );
    assert.deepEqual(rest, rest0, 'identity, rig, clips and game metadata are kept');
    assert.deepEqual(
      [url, digest, bytes, triangles, lods],
      [
        graph.models.hero.primary.url,
        graph.models.hero.primary.sha256,
        graph.models.hero.primary.bytes,
        700,
        [],
      ],
    );
    assert.deepEqual(adopted.original, {
      url: url0,
      sha256: digest0,
      bytes: bytes0,
      triangles: triangles0,
      lods: lods0,
    });
    assert.equal(adopted.selection, SELECTION.startup);
    const fox = await readJson(root, 'public/models/fox/asset.json');
    assert.equal(fox.url, foxStartup.output.url);
    assert.deepEqual(fox.lods, []);
    assert.equal(
      fox[RUNTIME_FIELD].identicalFullCandidate.url,
      bySource.get(assets.fox.url).output.url,
    );
    const catalog = await readJson(root, CATALOG),
      tree = await readJson(root, 'public/models/tree/asset.json'),
      cave = await readJson(root, 'public/models/camp-cave/asset.json');
    assert.deepEqual(
      catalog.assets.find((asset) => asset.modelKey === 'tree'),
      tree,
    );
    assert.deepEqual(
      catalog.assets.find((asset) => asset.modelKey === 'camp-cave'),
      cave,
    );
    assert.deepEqual(
      catalog.assets.find((asset) => asset.modelKey === 'grass'),
      assets.grass,
    );
    assert.equal(tree.lods[0].url, graph.models.tree.lods[0].url);
    assert.deepEqual(
      [tree.notes, tree.provenance, tree.lods[0].distanceMetres],
      [assets.tree.notes, assets.tree.provenance, 30],
    );
    // Cave textures: candidate served at its own size, UVs normalised by the original size.
    const pigment = graph.textures['/models/camp-cave/pigment-r01.png'];
    assert.deepEqual(
      [cave.pigment.url, cave.pigment.image, cave.pigment.uvSource],
      [pigment.url, { width: 1024, height: 512 }, { width: 2048, height: 1024 }],
    );
    assert.deepEqual(cave.rockSurface.uvSource, { width: 1500, height: 1500 });
    assert.deepEqual(cave.pigment.provenance[RUNTIME_FIELD].original, {
      url: '/models/camp-cave/pigment-r01.png',
      sha256: assets.cave.pigment.sha256,
      bytes: assets.cave.pigment.bytes,
      image: { width: 2048, height: 1024 },
    });
    assert.deepEqual(
      [cave.pigment.previous, cave.pigment.references, cave.pigment.source],
      [assets.cave.pigment.previous, assets.cave.pigment.references, assets.cave.pigment.source],
      'nested historical records are untouched',
    );
    assert.deepEqual(
      cave.mascotPigments.friends,
      assets.cave.mascotPigments.friends,
      'an original under 1024 px stays',
    );
    assert.deepEqual(
      runtimeTextureRecords(cave)
        .map((record) => record.url)
        .sort(),
      [
        pigment.url,
        graph.textures['/models/camp-cave/limestone-r01.png'].url,
        '/models/camp-cave/friends-r01.png',
        '/models/camp-cave/old-r01.png',
      ].sort(),
      'replaced originals are no longer runtime textures',
    );

    const first = await auditAdoption(root, ID),
      second = await auditAdoption(root, ID);
    assert.deepEqual(first, second, 'inspection is idempotent');
    assert.equal(first.status, 'passed');
    assert.equal(
      first.checks.find((item) => item.name.startsWith('every startup actor')).status,
      'passed',
    );
    const state = await snapshot(root, 'public');
    await assert.rejects(applyAdoption(root, ID, { rules: RULES }), /already applied/);
    assert.deepEqual(await snapshot(root, 'public'), state, 'a duplicate apply writes nothing');
  });
});

test('stale originals, changed manifests and changed eligibility are refused before anything is written', async () => {
  await withFixture(async ({ root, assets }) => {
    const before = await snapshot(root, 'public'),
      lod = file(root, `public${assets.tree.lods[0].url}`),
      lodBytes = await readFile(lod);
    await writeFile(lod, Buffer.concat([lodBytes, Buffer.from('x')]));
    await assert.rejects(planAdoption(root, OPTIONS), /bytes on disk|SHA-256/);
    await writeFile(lod, Buffer.from(lodBytes).fill(0x20, 30, 31));
    await assert.rejects(planAdoption(root, OPTIONS), /SHA-256/);
    await writeFile(lod, lodBytes);
    await put(
      root,
      'public/models/hero/asset.json',
      text({ ...assets.hero, notes: ['edited after generation'] }),
    );
    await assert.rejects(
      planAdoption(root, OPTIONS),
      /current manifests differ.*hero\/asset\.json changed/s,
    );
    await put(root, 'public/models/hero/asset.json', text(assets.hero));
    await assert.rejects(
      planAdoption(root, {
        ...OPTIONS,
        rules: {
          ...RULES,
          inputs: [{ path: RULES.inputs[0].path, sha256: 'c'.repeat(64) }, RULES.inputs[1]],
        },
      }),
      /eligibility inputs differ/,
    );
    assert.deepEqual(await snapshot(root, 'public'), before);
    assert.equal(existsSync(file(root, RECORD)), false);
  });
});

test('a corrupt candidate is refused at plan and at apply, and apply then writes nothing', async () => {
  await withFixture(async ({ root, assets, bySource }) => {
    const candidate = file(root, `${REVISION}/${bySource.get(assets.tree.url).output.file}`),
      good = await readFile(candidate);
    await writeFile(candidate, Buffer.from(good).fill(0x21, 24, 25));
    await assert.rejects(planAdoption(root, OPTIONS), /corrupt/);
    await writeFile(candidate, good);
    await writePlan(root, await planAdoption(root, OPTIONS));
    const before = await snapshot(root, 'public');
    await writeFile(candidate, Buffer.from(good).fill(0x21, 24, 25));
    await assert.rejects(applyAdoption(root, ID, { rules: RULES }), /corrupt/);
    assert.deepEqual(await snapshot(root, 'public'), before);
    assert.equal((await readJson(root, `${RECORD}/journal.json`)).state, 'planned');
  });
});

test('an unrelated manifest change between plan and apply stops the apply', async () => {
  await withFixture(async ({ root, assets }) => {
    await writePlan(root, await planAdoption(root, OPTIONS));
    await put(
      root,
      'public/models/octo/asset.json',
      text({ ...assets.octo, notes: ['unrelated edit'] }),
    );
    const before = await snapshot(root, 'public');
    await assert.rejects(
      applyAdoption(root, ID, { rules: RULES }),
      /current manifests differ.*octo\/asset\.json changed/s,
    );
    assert.deepEqual(await snapshot(root, 'public'), before, 'nothing was copied or rewritten');
    assert.equal((await readJson(root, `${RECORD}/journal.json`)).state, 'planned');
  });
});

test('unsafe adoption ids, acceptance paths, revisions and candidate paths are refused', async () => {
  await withFixture(async ({ root, assets }) => {
    await assert.rejects(
      planAdoption(root, { ...OPTIONS, adoption: '../escape' }),
      /Unsafe runtime adoption id/,
    );
    await assert.rejects(
      planAdoption(root, { ...OPTIONS, adoption: 'A/B' }),
      /Unsafe runtime adoption id/,
    );
    await assert.rejects(
      planAdoption(root, { ...OPTIONS, acceptance: ['../outside.md'] }),
      /Unsafe acceptance document path/,
    );
    await assert.rejects(
      planAdoption(root, { ...OPTIONS, acceptance: ['output/review/missing.md'] }),
      /does not exist/,
    );
    await assert.rejects(
      planAdoption(root, { ...OPTIONS, revision: 'assets/optimized-runtime/../../public/models' }),
      /outside|unsafe|must be a new folder/,
    );
    await editRevision(root, (manifest) => {
      const record = manifest.files.find((item) => item.id === assets.tree.url),
        escaped = record.output.file.replace('models/tree/', 'models/tree/../../escape/');
      record.output.file = escaped;
      record.output.url = `/${escaped}`;
      manifest.models.find((model) => model.modelKey === 'tree').files[0].candidate =
        record.output.url;
    });
    await assert.rejects(planAdoption(root, OPTIONS), /Unexpected model URL/);
    assert.equal(existsSync(file(root, 'assets/runtime-adoption')), false);
  });
});

test('a different file under a hash-named URL is never overwritten; an identical one is reused', async () => {
  await withFixture(async ({ root, assets, bySource }) => {
    const target = file(root, `public${bySource.get(assets.tree.url).output.url}`);
    await writeFile(target, Buffer.from('a different file under the same hashed name'));
    await assert.rejects(planAdoption(root, OPTIONS), /already exists with different content/);
    await writeFile(
      target,
      await readFile(file(root, `${REVISION}/${bySource.get(assets.tree.url).output.file}`)),
    );
    const result = await planAdoption(root, OPTIONS);
    assert.deepEqual(result.review.targets, {
      absent: result.plan.operations.copies.length - 1,
      present: 1,
    });
    await writePlan(root, result);
    assert.equal((await applyAdoption(root, ID, { rules: RULES })).status, 'passed');
  });
});

test('restore puts back only untouched adopted manifests and never destroys a later edit', async () => {
  await withFixture(async ({ root }) => {
    const result = await planAdoption(root, OPTIONS);
    await writePlan(root, result);
    await applyAdoption(root, ID, { rules: RULES });
    const cave = 'public/models/camp-cave/asset.json',
      adopted = await readFile(file(root, cave));
    await put(root, cave, text({ ...JSON.parse(adopted), notes: ['edited after adoption'] }));
    const edited = await snapshot(root, 'public');
    await assert.rejects(restoreAdoption(root, ID), /changed after adoption/);
    assert.deepEqual(await snapshot(root, 'public'), edited, 'restore wrote nothing');
    await writeFile(file(root, cave), adopted);
    const restored = await restoreAdoption(root, ID);
    assert.equal(restored.state, 'restored');
    for (const operation of result.plan.operations.manifests)
      assert.equal(
        sha256(await readFile(file(root, operation.path))),
        operation.before.sha256,
        operation.path,
      );
    for (const copy of result.plan.operations.copies)
      assert.ok(existsSync(file(root, copy.to)), `${copy.to} stays`);
    const audit = await auditAdoption(root, ID);
    assert.deepEqual([audit.state, audit.status, audit.applied], ['restored', 'passed', false]);
    const catalog = await readJson(root, CATALOG);
    assert.equal(await activeAdoption(root, catalog.assets, runtimeTextureRecords), null);
  });
});

test('an interrupted apply is refused everywhere until restore undoes exactly what it changed', async () => {
  await withFixture(async ({ root }) => {
    const result = await planAdoption(root, OPTIONS),
      operations = result.plan.operations.manifests,
      last = operations.at(-1).path,
      stray = `${last}.adoption-${ID}.tmp`;
    await writePlan(root, result);
    // A temporary file left by an earlier run stops the last manifest replacement.
    await put(root, stray, 'left behind by an interrupted run');
    await assert.rejects(
      applyAdoption(root, ID, { rules: RULES }),
      /left from an interrupted run; nothing was overwritten/,
    );
    assert.equal((await readJson(root, `${RECORD}/journal.json`)).state, 'applying');
    for (const operation of operations)
      assert.equal(
        sha256(await readFile(file(root, operation.path))),
        operation.path === last ? operation.before.sha256 : operation.after.sha256,
        operation.path,
      );
    const audit = await auditAdoption(root, ID);
    assert.equal(audit.status, 'failed');
    assert.match(JSON.stringify(audit.checks), /the adoption is applying \(partial\)/);
    const catalog = await readJson(root, CATALOG);
    await assert.rejects(
      activeAdoption(root, catalog.assets, runtimeTextureRecords),
      /applying, not applied/,
    );
    await assert.rejects(applyAdoption(root, ID, { rules: RULES }), /apply runs only once/);
    const restored = await restoreAdoption(root, ID);
    assert.deepEqual(restored.alreadyOriginal, [last]);
    assert.deepEqual(
      restored.restored,
      operations.slice(0, -1).map((operation) => operation.path),
    );
    for (const operation of operations)
      assert.equal(
        sha256(await readFile(file(root, operation.path))),
        operation.before.sha256,
        operation.path,
      );
    assert.equal(
      await readFile(file(root, stray), 'utf8'),
      'left behind by an interrupted run',
      'the stray file is reported, not removed',
    );
    for (const copy of result.plan.operations.copies)
      assert.ok(existsSync(file(root, copy.to)), copy.to);
  });
});

// As in r04: the revision recorded the earlier direct reads; the runtime now uses the verified loader.
const recordEarlierReads = (manifest) => {
  for (const image of manifest.images) {
    const entry = image.plan.manifestEntry;
    image.plan.runtimeEntry = entry.startsWith('mascotPigments.')
      ? `CAVE_EXTRA_PIGMENTS.${entry.slice('mascotPigments.'.length)}.url`
      : `template.asset.${entry}.url`;
    image.plan.configuredBy = [`src/loading-cave.ts template.asset.${entry}.url`];
  }
};

test('a reconfigured cave loader is accepted only when every re-planned image keeps its meaning', async () => {
  await withFixture(async ({ root }) => {
    await editRevision(root, recordEarlierReads);
    const { plan } = await planAdoption(root, OPTIONS),
      compatibility = plan.runtimeCompatibility;
    assert.deepEqual(
      compatibility.images.map((image) => [image.id, image.descriptorsChanged]),
      [
        ['image:/models/camp-cave/pigment-r01.png', true],
        ['image:/models/camp-cave/limestone-r01.png', true],
        ['image:/models/camp-cave/friends-r01.png', true],
      ],
    );
    const pigment = compatibility.images.find((image) => image.id.endsWith('pigment-r01.png'));
    assert.deepEqual(pigment.recorded, {
      runtimeEntry: 'template.asset.pigment.url',
      configuredBy: ['src/loading-cave.ts template.asset.pigment.url'],
    });
    assert.equal(pigment.current.runtimeEntry, 'caveImageRecords(template.asset).pigment');
    assert.ok(compatibility.inputs.some((input) => input.path === 'src/verified-texture.ts'));
    // Anything beyond the two descriptors stops the plan, as does a setting it cannot read.
    for (const [relative, from, to, pattern] of [
      [
        'src/cave-gallery-layout.ts',
        'bison: [10, 10, 1000, 500]',
        'bison: [10, 10, 1000, 520]',
        /same meaning: image:\/models\/camp-cave\/pigment-r01\.png: \$\.uv\.motifs/,
      ],
      [
        'src/verified-texture.ts',
        "key === 'rockSurface'",
        "key === 'pigment'",
        /cannot be re-planned: .*repeats pigment, the plan repeats rockSurface/,
      ],
      [
        'src/verified-texture.ts',
        "const repeat = key === 'rockSurface';",
        'const repeat = REPEATED.has(key);',
        /repeat is not a literal test of the record key/,
      ],
      [
        'src/verified-texture.ts',
        'colorSpace: THREE.SRGBColorSpace',
        'colorSpace: THREE.LinearSRGBColorSpace',
        /colorSpace is .*, not THREE\.SRGBColorSpace/,
      ],
      [
        'src/verified-texture.ts',
        'asset?.rockSurface',
        'asset[ROCK]',
        /the cave asset is used indirectly/,
      ],
    ]) {
      const source = await readFile(file(root, relative), 'utf8');
      assert.ok(source.includes(from), from);
      await writeFile(file(root, relative), source.replace(from, to));
      await assert.rejects(planAdoption(root, OPTIONS), pattern, String(pattern));
      await writeFile(file(root, relative), source);
    }
    // A recorded field other than the descriptors is semantic too.
    await editRevision(root, (manifest) => {
      manifest.images[0].plan.filter = 'box';
    });
    await assert.rejects(planAdoption(root, OPTIONS), /same meaning: .*\$\.filter/);
  });
});

test('after adoption the audit re-plans the images from the saved pre-apply manifests and the runtime as it is', async () => {
  await withFixture(async ({ root }) => {
    await writePlan(root, await planAdoption(root, OPTIONS));
    const name = 'the current runtime still loads',
      compatible = (report) => report.checks.find((item) => item.name.startsWith(name)),
      applied = await applyAdoption(root, ID, { rules: RULES });
    // The current manifests now name the candidates; only the saved bytes give the sources.
    assert.equal(compatible(applied).status, 'passed', JSON.stringify(compatible(applied)));
    assert.equal(applied.runtimeCompatibility.changedSincePlan, false);
    const module = file(root, 'src/verified-texture.ts'),
      source = await readFile(module, 'utf8');
    await writeFile(module, `// a reviewed refactor that keeps every image\n${source}`);
    const touched = await auditAdoption(root, ID);
    assert.equal(touched.status, 'passed');
    assert.equal(touched.runtimeCompatibility.changedSincePlan, true);
    await writeFile(module, source.replace("key === 'rockSurface'", "key === 'pigment'"));
    const drifted = await auditAdoption(root, ID);
    assert.equal(drifted.status, 'failed');
    assert.match(JSON.stringify(compatible(drifted).problems), /repeats pigment/);
  });
});

test('violet-behemoth serves its verified full candidate at every distance; its rejected LOD stays archived, retired and costed', async () => {
  await withFixture(
    async ({ root, assets, bySource }) => {
      const rule = LOD_REJECTIONS['violet-behemoth'],
        full = bySource.get(assets.behemoth.url),
        low = bySource.get(assets.behemoth.lods[0].url),
        result = await planAdoption(root, OPTIONS),
        { graph, totals, operations } = result.plan,
        entry = graph.models['violet-behemoth'];
      assert.equal(graph.lodRejections['violet-behemoth'], 'applied');
      assert.equal(entry.selection, SELECTION.full);
      assert.deepEqual(
        [entry.primary.url, entry.primary.sha256, entry.primary.bytes, entry.primary.triangles],
        [full.output.url, full.output.sha256, full.output.bytes, 39825],
      );
      assert.deepEqual(entry.lods, []);
      assert.deepEqual(entry.farTriangles, { before: 7965, after: 39825, added: 31860 });
      assert.equal(totals.fullOnlyModels, 1);
      assert.equal(totals.addedFarTrianglesByModel['violet-behemoth'], 31860);
      assert.deepEqual(entry.clearedLods, [
        {
          url: assets.behemoth.lods[0].url,
          sha256: assets.behemoth.lods[0].sha256,
          bytes: assets.behemoth.lods[0].bytes,
          triangles: 7965,
          candidate: low.output.url,
          candidateSha256: low.output.sha256,
          candidateBytes: low.output.bytes,
        },
      ]);
      assert.deepEqual(
        [entry.lodRejection.decision, entry.lodRejection.observation],
        [rule.decision, rule.observation],
      );
      assert.deepEqual(
        entry.lodRejection.evidence.map((item) => item.path),
        [...rule.evidence],
      );
      for (const url of [assets.behemoth.lods[0].url, low.output.url])
        assert.ok(graph.retired.includes(url), url);
      assert.deepEqual(
        graph.retiredCandidates.find((item) => item.modelKey === 'violet-behemoth'),
        {
          modelKey: 'violet-behemoth',
          role: 'lod',
          reason: 'rejected-old-lod',
          url: low.output.url,
          sha256: low.output.sha256,
          bytes: low.output.bytes,
          triangles: 7965,
          from: `${REVISION}/${low.output.file}`,
        },
      );
      assert.ok(operations.copies.some((copy) => copy.url === full.output.url));
      assert.ok(
        !operations.copies.some((copy) => copy.url === low.output.url),
        'the rejected LOD is never copied',
      );
      // Every other ordinary model keeps its current LOD semantics.
      assert.deepEqual(
        [graph.models.tree.selection, graph.models.tree.lods.length],
        [SELECTION.ordinary, 1],
      );

      await writePlan(root, result);
      const publicBefore = await snapshot(root, 'public'),
        revisionBefore = await snapshot(root, REVISION),
        report = await applyAdoption(root, ID, { rules: RULES });
      assert.equal(report.status, 'passed', JSON.stringify(report.checks, null, 2));
      assert.equal(
        report.checks.find((item) => item.name.startsWith('every model whose old LOD was rejected'))
          .status,
        'passed',
      );
      assert.equal(
        report.checks.find((item) => item.name.startsWith('every retired candidate')).status,
        'passed',
      );
      assert.deepEqual(
        report.farTriangles.find((item) => item.modelKey === 'violet-behemoth'),
        {
          modelKey: 'violet-behemoth',
          selection: SELECTION.full,
          before: 7965,
          after: 39825,
          added: 31860,
          rejection: rule.decision,
        },
      );
      // The original and candidate low files stay archived and unchanged; neither is served.
      const publicAfter = await snapshot(root, 'public');
      for (const name of [`public${assets.behemoth.lods[0].url}`, `public${assets.behemoth.url}`])
        assert.equal(publicAfter[name], publicBefore[name], name);
      assert.deepEqual(await snapshot(root, REVISION), revisionBefore);
      assert.equal(existsSync(file(root, `public${low.output.url}`)), false);
      const catalog = await readJson(root, CATALOG),
        own = await readJson(root, 'public/models/violet-behemoth/asset.json'),
        adopted = catalog.assets.find((asset) => asset.modelKey === 'violet-behemoth');
      assert.deepEqual(adopted, own, 'both runtime manifests agree');
      const { url, sha256: digest, bytes, triangles, lods, [RUNTIME_FIELD]: field, ...rest } = own,
        {
          url: url0,
          sha256: digest0,
          bytes: bytes0,
          triangles: triangles0,
          lods: lods0,
          ...rest0
        } = assets.behemoth;
      assert.deepEqual(rest, rest0, 'scale, rig, clips and gameplay metadata are kept');
      assert.deepEqual(
        [url, digest, bytes, triangles, lods],
        [full.output.url, full.output.sha256, full.output.bytes, 39825, []],
      );
      assert.deepEqual(field.original, {
        url: url0,
        sha256: digest0,
        bytes: bytes0,
        triangles: triangles0,
        lods: lods0,
      });
      assert.deepEqual(field.lodRejection, {
        decision: rule.decision,
        observation: rule.observation,
        addedFarTriangles: 31860,
      });
      // Builds refuse to bring the rejected LOD back, original or compressed.
      const adoption = await activeAdoption(root, catalog.assets, runtimeTextureRecords),
        options = { textureRecords: runtimeTextureRecords };
      assert.deepEqual(
        checkRuntimeGraph([adopted], adoption, options).models.map((model) => model.url),
        [full.output.url],
      );
      assert.throws(
        () => checkRuntimeGraph([{ ...adopted, lods: lods0 }], adoption, options),
        /differ from runtime adoption/,
      );
      const compressedLod = {
        ...lods0[0],
        url: low.output.url,
        sha256: low.output.sha256,
        bytes: low.output.bytes,
      };
      assert.throws(
        () => checkRuntimeGraph([{ ...adopted, lods: [compressedLod] }], adoption, options),
        /differ from runtime adoption/,
      );
      // The audit sees a manifest that reactivates the old LOD.
      await put(
        root,
        CATALOG,
        text({
          ...catalog,
          assets: catalog.assets.map((asset) =>
            asset === adopted ? { ...asset, lods: lods0 } : asset,
          ),
        }),
      );
      const audit = await auditAdoption(root, ID);
      assert.equal(audit.status, 'failed');
      for (const name of [
        'every model whose old LOD was rejected',
        'no runtime record names a replaced original',
      ])
        assert.equal(
          audit.checks.find((item) => item.name.startsWith(name)).status,
          'failed',
          name,
        );
    },
    { behemoth: true },
  );
});

test('an LOD rejection covers only the reviewed files, needs its evidence and never stacks on a startup actor', async () => {
  await withFixture(
    async ({ root }) => {
      const rule = LOD_REJECTIONS['violet-behemoth'],
        reviewedAs = (reviewed) => ({ 'violet-behemoth': { ...rule, reviewed } });
      await assert.rejects(
        planAdoption(root, {
          ...OPTIONS,
          lodRejections: reviewedAs({
            model: rule.reviewed.model,
            lods: [{ url: rule.reviewed.lods[0].url, triangles: 8000 }],
          }),
        }),
        /reviewed for \/models\/violet-behemoth\/model-c2\.glb \(39825 triangles\) with \/models\/violet-behemoth\/lod-c2\.glb \(8000 triangles\)/,
      );
      await assert.rejects(
        planAdoption(root, {
          ...OPTIONS,
          lodRejections: reviewedAs({
            model: { ...rule.reviewed.model, url: '/models/violet-behemoth/model-c3.glb' },
            lods: rule.reviewed.lods,
          }),
        }),
        /Review it again before adopting/,
      );
      await assert.rejects(
        planAdoption(root, { ...OPTIONS, lodRejections: { ...LOD_REJECTIONS, hero: rule } }),
        /a startup actor cannot also carry an LOD rejection/,
      );
      await rm(file(root, rule.evidence[0]));
      await assert.rejects(planAdoption(root, OPTIONS), /LOD rejection evidence .* does not exist/);
      assert.equal(existsSync(file(root, 'assets/runtime-adoption')), false);
    },
    { behemoth: true },
  );
});

test('local, exhibition and public graphs ship exactly the adopted files and reject stale or unaudited ones', async () => {
  await withFixture(async ({ root, assets }) => {
    const result = await planAdoption(root, OPTIONS),
      { graph } = result.plan;
    await writePlan(root, result);
    await applyAdoption(root, ID, { rules: RULES });
    const catalog = await readJson(root, CATALOG),
      [hero, fox, octo] = await Promise.all(
        ['hero', 'fox', 'octo'].map((key) => readJson(root, `public/models/${key}/asset.json`)),
      ),
      excludedKeys = new Set(['octo']),
      excludedSpecies = new Set(['maruimo']),
      local = [...catalog.assets, hero, fox, octo],
      shippedPublic = [
        ...catalog.assets.filter(
          (asset) => !excludedKeys.has(asset.modelKey) && !excludedSpecies.has(asset.species),
        ),
        hero,
        fox,
      ],
      options = { textureRecords: runtimeTextureRecords },
      adoption = await activeAdoption(root, local, runtimeTextureRecords);
    assert.equal(adoption.id, ID);
    const expectedPublic = [
      graph.models.tree.primary.url,
      graph.models.tree.lods[0].url,
      graph.models['camp-cave'].primary.url,
      '/models/grass/model.glb',
      graph.models.hero.primary.url,
      graph.models.fox.primary.url,
    ].sort();
    const publicGraph = checkRuntimeGraph(shippedPublic, adoption, {
      ...options,
      requireAdoption: true,
    });
    assert.deepEqual(publicGraph.models.map((model) => model.url).sort(), expectedPublic);
    assert.deepEqual(publicGraph.originals, [
      { modelKey: 'grass', reason: 'decorative-groundcover-disabled' },
    ]);
    assert.deepEqual(
      publicGraph.textures.map((texture) => [texture.url, texture.adopted]).sort(),
      [
        [graph.textures['/models/camp-cave/pigment-r01.png'].url, true],
        [graph.textures['/models/camp-cave/limestone-r01.png'].url, true],
        ['/models/camp-cave/friends-r01.png', false],
        ['/models/camp-cave/old-r01.png', false],
      ].sort(),
    );
    const localGraph = checkRuntimeGraph(local, adoption, options);
    assert.deepEqual(
      localGraph.models.map((model) => model.url).sort(),
      [...expectedPublic, '/models/octo/model-c2.glb'].sort(),
    );
    assert.ok(
      localGraph.originals.some(
        (item) => item.modelKey === 'octo' && item.reason === 'excluded-from-public-release',
      ),
    );
    // The public filter still keeps the excluded character's files and metadata out.
    for (const model of publicGraph.models)
      assertPublicCharacterData(model.url.slice(1), Buffer.alloc(0), excludedKeys, excludedSpecies);
    for (const asset of shippedPublic)
      assertPublicCharacterData(
        `models/${asset.modelKey}/asset.json`,
        Buffer.from(JSON.stringify(asset)),
        excludedKeys,
        excludedSpecies,
      );
    assert.throws(
      () =>
        assertPublicCharacterData(
          'models/octo/asset.json',
          Buffer.from(JSON.stringify(octo)),
          excludedKeys,
          excludedSpecies,
        ),
      /Excluded/,
    );
    // Stale, mismatched and unaudited records are refused.
    assert.throws(
      () =>
        checkRuntimeGraph(
          [{ ...hero, lods: hero[RUNTIME_FIELD].original.lods }],
          adoption,
          options,
        ),
      /differ from runtime adoption/,
    );
    assert.throws(
      () =>
        checkRuntimeGraph(
          [{ ...hero, url: assets.hero.url, sha256: assets.hero.sha256, bytes: assets.hero.bytes }],
          adoption,
          options,
        ),
      /differ from runtime adoption/,
    );
    const sneaky = 'e'.repeat(64);
    assert.throws(
      () =>
        checkRuntimeGraph(
          [
            {
              ...assets.grass,
              url: `/models/grass/model.opt-${sneaky.slice(0, 16)}.glb`,
              sha256: sneaky,
            },
          ],
          adoption,
          options,
        ),
      /content-addressed model outside/,
    );
    assert.throws(() => checkRuntimeGraph([assets.hero], adoption, options), /not the adopted one/);
    const cave = catalog.assets.find((asset) => asset.modelKey === 'camp-cave'),
      stale = structuredClone(cave),
      flat = structuredClone(cave);
    stale.pigment = structuredClone(assets.cave.pigment);
    assert.throws(
      () => checkRuntimeGraph([stale], adoption, options),
      /replaced it, but camp-cave still ships it/,
    );
    delete flat.pigment.uvSource;
    assert.throws(
      () => checkRuntimeGraph([flat], adoption, options),
      /differs from runtime adoption/,
    );
    assert.throws(() => checkRuntimeGraph([hero], null, options), /carries runtimeOptimization/);
    assert.throws(
      () => checkRuntimeGraph([assets.grass], null, { ...options, requireAdoption: true }),
      /requires manifests carrying an applied runtime adoption/,
    );
    const other = structuredClone(hero);
    other[RUNTIME_FIELD].adoption = 'other-a01';
    await assert.rejects(
      activeAdoption(root, [fox, other], runtimeTextureRecords),
      /more than one runtime adoption/,
    );
    const journal = file(root, `${RECORD}/journal.json`),
      applied = await readFile(journal);
    await writeFile(journal, text({ ...JSON.parse(applied), state: 'applying' }));
    await assert.rejects(activeAdoption(root, local, runtimeTextureRecords), /not applied/);
    await writeFile(journal, applied);
    // Shipped code may not keep loading a replaced original by literal URL.
    assert.equal(
      retiredLiteral("load('/models/camp-cave/pigment-r01.png')", adoption),
      '/models/camp-cave/pigment-r01.png',
    );
    assert.equal(
      retiredLiteral('const lod = `/models/hero/lod-c2.glb`;', adoption),
      '/models/hero/lod-c2.glb',
    );
    assert.equal(
      retiredLiteral('{"source":"public/models/camp-cave/pigment-r01.png"}', adoption),
      null,
    );
    assert.equal(
      retiredLiteral(
        `load('${graph.textures['/models/camp-cave/pigment-r01.png'].url}')`,
        adoption,
      ),
      null,
    );
    assert.equal(retiredLiteral("load('/models/camp-cave/pigment-r01.png')", null), null);
    // The served image header must state the recorded size.
    const served = await readFile(file(root, `public${cave.pigment.url}`));
    checkTextureImage(cave.pigment, served, 'pigment');
    assert.throws(
      () =>
        checkTextureImage(
          { ...cave.pigment, image: { width: 2048, height: 1024 } },
          served,
          'pigment',
        ),
      /1024x512/,
    );
  });
});

test('compressed models are packaged only with the meshopt decoder the adoption recorded', async () => {
  await withFixture(async ({ root }) => {
    const result = await planAdoption(root, OPTIONS);
    await writePlan(root, result);
    await applyAdoption(root, ID, { rules: RULES });
    const catalog = await readJson(root, CATALOG),
      adoption = await activeAdoption(root, catalog.assets, runtimeTextureRecords),
      decoder = await readFile(file(root, DECODER.source)),
      required = glbExtensionsRequired(
        await readFile(file(root, `public${catalog.assets[0].url}`)),
        'tree',
      );
    assert.deepEqual(required, [MESHOPT_EXTENSION]);
    assert.deepEqual(
      glbExtensionsRequired(await readFile(file(root, 'public/models/grass/model.glb')), 'grass'),
      [],
    );
    await assert.rejects(
      checkDecoder(root, undefined, { required: true, adoption }),
      /does not include/,
    );
    await assert.rejects(
      checkDecoder(root, Buffer.from('another decoder'), { required: true, adoption }),
      /not the decoder Three ships/,
    );
    assert.deepEqual(await checkDecoder(root, decoder, { required: true, adoption }), {
      required: true,
      file: DECODER.published,
      sha256: sha256(decoder),
    });
    assert.equal(
      (await checkDecoder(root, undefined, { required: false, adoption: null })).required,
      false,
    );
    await writeFile(
      file(root, DECODER.source),
      'export const MeshoptDecoder = { changed: true };\n',
    );
    await assert.rejects(
      checkDecoder(root, await readFile(file(root, DECODER.source)), { required: true, adoption }),
      /is not the decoder runtime adoption .* recorded/,
    );
    const audit = await auditAdoption(root, ID);
    assert.equal(audit.status, 'failed');
    assert.equal(
      audit.checks.find((item) => item.name.includes('meshopt decoder')).status,
      'failed',
    );
  });
});

test('model and texture URLs are allowlisted and hash-named files must be addressed by their SHA-256', () => {
  const digest = sha256(Buffer.from('candidate')),
    prefix = digest.slice(0, 16);
  assert.equal(checkModelUrl('/models/tree/model.glb', digest), false);
  assert.equal(checkModelUrl('/models/tree/lod-c2-1.glb', digest), false);
  assert.equal(checkModelUrl(`/models/tree/model-r13-normal.opt-${prefix}.glb`, digest), true);
  assert.equal(checkModelUrl(`/models/hero/startup.opt-${prefix}.glb`, digest), true);
  for (const url of [
    '/models/hero/startup.glb',
    '/models/../secret/model.glb',
    '/models/tree/../model.glb',
    '/models/tree/sub/model.glb',
    '/models/tree/other.glb',
    '/models/tree/model.GLB',
    `/models/tree/model.opt-${prefix.slice(1)}.glb`,
    'https://example.com/models/tree/model.glb',
    '/public/models/tree/model.glb',
  ])
    assert.throws(() => checkModelUrl(url, digest), /Unexpected model URL/, url);
  assert.throws(
    () => checkModelUrl(`/models/tree/model.opt-${'0'.repeat(16)}.glb`, digest),
    /not addressed/,
  );
  assert.equal(checkTextureUrl('/models/camp-cave/524-lascaux-frieze-r32.png', digest), false);
  assert.equal(
    checkTextureUrl(`/models/camp-cave/524-lascaux-frieze-r32.opt-${prefix}.png`, digest),
    true,
  );
  assert.equal(
    checkTextureUrl('/models/camp-cave/wall.jpg', digest, ['png', 'jpg', 'jpeg']),
    false,
  );
  for (const url of [
    '/models/camp-cave/wall.jpg',
    '/models/camp-cave/../x.png',
    '/models/camp-cave/Wall.png',
    '/models/x.png',
  ])
    assert.throws(() => checkTextureUrl(url, digest), /Unexpected runtime texture/, url);
  assert.throws(
    () => checkTextureUrl(`/models/camp-cave/wall.opt-${'1'.repeat(16)}.png`, digest),
    /not addressed/,
  );
});

test('a manifest that is not canonical JSON is never reformatted by the rewrite', async () => {
  await withFixture(async ({ root, assets }) => {
    const { graph } = (await planAdoption(root, OPTIONS)).plan;
    assert.throws(
      () =>
        rewriteManifestBytes(
          'public/models/tree/asset.json',
          Buffer.from(JSON.stringify(assets.tree)),
          graph,
        ),
      /not laid out as JSON\.stringify/,
    );
    assert.equal(
      rewriteManifestBytes('public/models/octo/asset.json', Buffer.from(text(assets.octo)), graph),
      null,
    );
    assert.throws(
      () =>
        rewriteManifestBytes(
          'public/models/tree/asset.json',
          Buffer.from(text({ ...assets.tree, sha256: 'd'.repeat(64) })),
          graph,
        ),
      /not the candidate's source/,
    );
  });
});

// Real data, read-only. Before Codex applies r04, the plan must reproduce the contract graph.
// After the apply it has to audit clean instead (the current manifests are then adopted).
// Partial revisions on an applied base adoption (revision-scope.mjs).
const fileIdentity = ({ url, sha256: digest, bytes }) => ({ url, sha256: digest, bytes });
const partial = ({ only = [], edge512 = [], maps512 = [] } = {}) => ({
  only: new Set(only),
  edge512: new Set(edge512),
  maps512: new Set(maps512),
});
async function appliedBase(root) {
  await writePlan(root, await planAdoption(root, OPTIONS));
  const report = await applyAdoption(root, ID, { rules: RULES });
  assert.equal(report.status, 'passed', JSON.stringify(report.checks, null, 2));
  return readBaseAdoption(root, ID, RULES);
}

test('a partial revision reads the applied base originals and refuses actors, sole-primary models and image owners', async () => {
  await withFixture(
    async ({ root, assets, bySource }) => {
      const base = await appliedBase(root),
        assetsBefore = await snapshot(root, 'assets'),
        publicBefore = await snapshot(root, 'public'),
        treeFiles = (inventory) =>
          inventory.models.find((model) => model.modelKey === 'tree').files.map(fileIdentity);
      // Today's manifests serve the tree's r01 candidates; the base gives back the originals.
      assert.deepEqual(
        treeFiles(await buildInventory(root, RULES)),
        [assets.tree.url, assets.tree.lods[0].url].map((url) =>
          fileIdentity(bySource.get(url).output),
        ),
      );
      assert.deepEqual(
        treeFiles(base.inventory),
        [assets.tree, assets.tree.lods[0]].map(fileIdentity),
      );
      assert.equal(base.record.state, 'applied');
      assert.equal(
        base.record.planSha256,
        sha256(await readFile(file(root, `${RECORD}/plan.json`))),
      );
      assert.deepEqual(
        base.record.rewrittenManifests.map((item) => item.path),
        [
          CATALOG,
          'public/models/camp-cave/asset.json',
          'public/models/fox/asset.json',
          'public/models/hero/asset.json',
          'public/models/tree/asset.json',
          'public/models/violet-behemoth/asset.json',
        ],
      );
      // The snapshot inventory reads exactly the saved manifests, and nothing else.
      const plan = await readJson(root, `${RECORD}/plan.json`),
        saved = new Map();
      for (const input of plan.inputs.manifests)
        saved.set(input.path, await readFile(file(root, `${RECORD}/before/${input.path}`)));
      assert.deepEqual(base.inventory.manifests, plan.inputs.manifests);
      await assert.rejects(
        buildInventory(root, RULES, {
          snapshot: new Map([...saved, ['public/models/tree/notes.json', Buffer.from('{}')]]),
        }),
        /unexpected path "public\/models\/tree\/notes\.json"/,
      );
      await assert.rejects(
        buildInventory(root, RULES, {
          snapshot: new Map([...saved, ['public/models/notes/asset.json', Buffer.from('{}')]]),
        }),
        /describe no model: public\/models\/notes\/asset\.json/,
      );

      const selection = selectWork(
        base.inventory,
        partial({ only: ['tree'], maps512: ['tree'] }),
        base,
      );
      assert.deepEqual(
        selection.files.map((item) => [item.url, item.sha256, item.edges, item.edge]),
        [
          [assets.tree.lods[0].url, assets.tree.lods[0].sha256, MAPS_512, 1024],
          [assets.tree.url, assets.tree.sha256, MAPS_512, 1024],
        ],
      );
      assert.deepEqual(selection.startup, []);
      assert.deepEqual(supersededModels(base, new Set(['tree'])), {
        tree: {
          selection: SELECTION.ordinary,
          manifests: [CATALOG, 'public/models/tree/asset.json'],
          served: [assets.tree.url, assets.tree.lods[0].url].map((url) =>
            fileIdentity(bySource.get(url).output),
          ),
          originals: [assets.tree, assets.tree.lods[0]].map(fileIdentity),
        },
      });

      const refused = (options, pattern) =>
        assert.throws(() => selectWork(base.inventory, partial(options), base), pattern);
      refused({ only: ['hero'] }, /hero is a startup actor \(sole primary\)/);
      refused({ only: ['fox', 'tree'] }, /fox is a startup actor/);
      refused(
        { only: ['violet-behemoth'] },
        /violet-behemoth serves its full candidate as the sole primary/,
      );
      refused({ only: ['camp-cave'] }, /camp-cave owns standalone runtime images/);
      refused({ only: ['grass'] }, /grass is not an eligible model key/);
      refused({}, /needs an explicit --only list/);
      refused(
        { only: ['tree'], edge512: ['camp-cave'] },
        /--edge-512 lists camp-cave outside --only/,
      );
      refused(
        { only: ['tree'], edge512: ['tree'], maps512: ['tree'] },
        /tree: listed in both --edge-512 and --maps-512; the texture edge is ambiguous/,
      );
      // A file shared with an unlisted model would leave that model on a retired file.
      const files = new Map(base.inventory.files),
        lod = files.get(assets.tree.lods[0].url);
      files.set(lod.url, {
        ...lod,
        uses: [...lod.uses, { modelKey: 'camp-cave', role: 'lod', lodIndex: 0 }],
      });
      assert.throws(
        () =>
          checkPartialScope(
            { ...base, inventory: { ...base.inventory, files } },
            partial({ only: ['tree'] }),
          ),
        /\/models\/tree\/lod1\.glb of tree is also delivered by camp-cave; list every model that shares it/,
      );

      // Read-only: the base, its candidate revision and every actor, cave and behemoth record stay.
      assert.deepEqual(await snapshot(root, 'assets'), assetsBefore);
      assert.deepEqual(await snapshot(root, 'public'), publicBefore);
      assert.deepEqual(Object.keys(baseRecordOf(base, new Set(['tree'])).models), ['tree']);
    },
    { behemoth: true },
  );
});

test('a base adoption is refused unless applied, bound to its plan, with saved, re-derivable and current manifests', async () => {
  await withFixture(async ({ root }) => {
    await writePlan(root, await planAdoption(root, OPTIONS));
    await assert.rejects(readBaseAdoption(root, ID, RULES), /it is planned, not applied/);
    await applyAdoption(root, ID, { rules: RULES });
    await readBaseAdoption(root, ID, RULES);
    const tampered = async (relative, edit, pattern) => {
        const bytes = await readFile(file(root, relative));
        await writeFile(file(root, relative), edit(bytes.toString('utf8')));
        try {
          await assert.rejects(readBaseAdoption(root, ID, RULES), pattern, relative);
        } finally {
          await writeFile(file(root, relative), bytes);
        }
      },
      note = (source) => source.replace('"unrelated note"', '"edited note"');
    await tampered(
      `${RECORD}/before/public/models/tree/asset.json`,
      note,
      /before\/public\/models\/tree\/asset\.json is not the pre-apply manifest the plan recorded/,
    );
    await tampered(
      `${RECORD}/after/public/models/tree/asset.json`,
      note,
      /after\/public\/models\/tree\/asset\.json is not the planned rewrite/,
    );
    await tampered(
      'public/models/tree/asset.json',
      note,
      /no longer exactly the applied ones: public\/models\/tree\/asset\.json changed/,
    );
    await tampered(
      `${RECORD}/journal.json`,
      (source) => source.replace('"state": "applied"', '"state": "restored"'),
      /it is restored, not applied/,
    );
    await tampered(
      `${RECORD}/plan.json`,
      (source) => source.replace('"atomicity"', '"atomicity "'),
      /journal\.json does not belong to plan\.json/,
    );
    await tampered(
      `${REVISION}/manifest.json`,
      (source) => `${source} `,
      /manifest\.json changed since the adoption was planned/,
    );
    await tampered(
      `${REVISION}/verification.json`,
      (source) => `${source} `,
      /verification\.json changed since the adoption was planned/,
    );
    // Untampered again, it reads; then a missing saved manifest and an unknown id are refused.
    await readBaseAdoption(root, ID, RULES);
    await rm(file(root, `${RECORD}/before/public/models/hero/asset.json`));
    await assert.rejects(
      readBaseAdoption(root, ID, RULES),
      /before\/public\/models\/hero\/asset\.json is missing/,
    );
    await assert.rejects(
      readBaseAdoption(root, `${ID.slice(0, -1)}2`, RULES),
      /plan\.json is missing/,
    );
  });
});

test('a partial revision is verified against its base: exact scope, coverage, original names and unchanged records', async () => {
  await withFixture(async ({ root }) => {
    const base = await appliedBase(root),
      only = new Set(['tree']),
      selection = selectWork(base.inventory, partial({ only: ['tree'], maps512: ['tree'] }), base),
      // Shaped as generate-candidates.mjs records them; the bytes are not read here.
      records = selection.files.map((source) => {
        const digest = sha256(Buffer.from(`${source.url} partial`)),
          location = candidateLocation(source.url, digest);
        return {
          id: source.url,
          role: source.uses.map((use) => use.role).join('+'),
          uses: source.uses,
          source: fileIdentity(source),
          output: {
            ...location,
            sha256: digest,
            bytes: 10,
            maximumTextureEdge: source.edge,
            textureEdges: source.edges,
            images: [],
          },
        };
      }),
      manifest = {
        scope: { complete: false, only: ['tree'] },
        base: baseRecordOf(base, only),
        policy: { stricter512: [], maps512: ['tree'] },
        inputs: { manifests: base.inventory.manifests },
        standaloneImageOwner: null,
        models: base.inventory.models.map((model) =>
          modelSummary(
            model,
            only.has(model.modelKey),
            (url) => records.find((record) => record.source.url === url)?.output.url ?? null,
            null,
          ),
        ),
        files: records,
        images: [],
      },
      failed = (value) =>
        checkPartialRevision(value, base)
          .filter((item) => item.problems.length)
          .map((item) => `${item.name}: ${item.problems.join('; ')}`)
          .join('\n'),
      variant = (edit) => {
        const copy = structuredClone(manifest);
        edit(copy);
        return failed(copy);
      };
    assert.equal(failed(manifest), '');
    for (const record of records) assert.deepEqual(recordEdges(manifest, record), MAPS_512);
    assert.match(
      variant((m) => (m.scope.only = ['hero', 'tree'])),
      /hero is a startup actor/,
    );
    assert.match(
      variant((m) => (m.scope.complete = true)),
      /the scope claims to be complete/,
    );
    assert.match(
      variant((m) => (m.base.planSha256 = '0'.repeat(64))),
      /\$\.planSha256/,
    );
    assert.match(
      variant((m) => (m.base.models.tree.served[0].sha256 = '0'.repeat(64))),
      /\$\.models\.tree\.served\[0\]\.sha256/,
    );
    assert.match(
      variant((m) => m.files.pop()),
      /\/models\/tree\/model\.glb has no candidate/,
    );
    assert.match(
      variant(
        (m) =>
          (m.files[0].output.file = m.files[0].output.file.replace(
            '.opt-',
            `.opt-${'0'.repeat(16)}.opt-`,
          )),
      ),
      /is not named after its original as models\/tree\/lod1\.opt-/,
    );
    assert.match(
      variant((m) => (m.files[0].source.sha256 = '0'.repeat(64))),
      /its source or uses differ/,
    );
    assert.match(
      variant((m) => (m.models.find((model) => model.modelKey === 'camp-cave').selected = true)),
      /the model list is the saved pre-apply inventory/,
    );
    assert.match(
      variant((m) => m.images.push({ id: 'image:x' })),
      /records standalone images/,
    );
    assert.match(
      variant((m) => (m.inputs.manifests[0].sha256 = '0'.repeat(64))),
      /the sources are the base's saved pre-apply manifests/,
    );
    // Each file's edges must be the policy's; legacy records keep the single-edge check.
    const wrong = structuredClone(records[0]);
    wrong.output.textureEdges = { color: 512, normal: 512, data: 512 };
    assert.throws(() => recordEdges(manifest, wrong), /texture edges differ from the policy/);
    assert.throws(
      () =>
        recordEdges(
          { ...manifest, policy: { stricter512: ['tree'], maps512: ['tree'] } },
          records[0],
        ),
      /ambiguous/,
    );
    const { textureEdges: _edges, ...legacyOutput } = records[0].output,
      legacy = { ...records[0], output: legacyOutput };
    assert.equal(recordEdges({ policy: { stricter512: [] } }, legacy), null);
    assert.throws(() => recordEdges(manifest, legacy), /per-image texture edges are required/);
  });
});

test('a base adoption is refused when a served copy or an original is corrupt or missing, even with unchanged manifests', async () => {
  await withFixture(
    async ({ root, assets }) => {
      const base = await appliedBase(root),
        damaged = async (relative, damage, pattern) => {
          const target = file(root, relative),
            bytes = await readFile(target);
          await damage(target, bytes);
          try {
            await assert.rejects(readBaseAdoption(root, ID, RULES), pattern, relative);
          } finally {
            await writeFile(target, bytes);
          }
        },
        flip = (target, bytes) => writeFile(target, Buffer.from(bytes).fill(0x21, 12, 13)),
        remove = (target) => rm(target);
      // Served copies: a startup actor's file, a cave image, the behemoth's sole primary.
      await damaged(
        `public${base.graph.models.hero.primary.url}`,
        flip,
        /served or original files do not match the plan: public\/models\/hero\/startup\.opt-[0-9a-f]{16}\.glb changed/,
      );
      await damaged(
        `public${base.graph.textures['/models/camp-cave/pigment-r01.png'].url}`,
        remove,
        /public\/models\/camp-cave\/pigment-r01\.opt-[0-9a-f]{16}\.png is missing/,
      );
      await damaged(
        `public${base.graph.models['violet-behemoth'].primary.url}`,
        flip,
        /public\/models\/violet-behemoth\/model-c2\.opt-[0-9a-f]{16}\.glb changed/,
      );
      // True originals: a replaced model, a cleared actor LOD, the rejected LOD, a kept image.
      await damaged(`public${assets.tree.url}`, flip, /\/models\/tree\/model\.glb: SHA-256/);
      await damaged(`public${assets.hero.lods[0].url}`, remove, /ENOENT/);
      await damaged(
        `public${assets.behemoth.lods[0].url}`,
        flip,
        /\/models\/violet-behemoth\/lod-c2\.glb: SHA-256/,
      );
      await damaged(
        'public/models/camp-cave/friends-r01.png',
        flip,
        /\/models\/camp-cave\/friends-r01\.png: SHA-256/,
      );
      await readBaseAdoption(root, ID, RULES);
    },
    { behemoth: true },
  );
});

// A manifest's payload: everything except the adoption id and adoptedBy a chain moves.
const payload = (value) =>
  Array.isArray(value)
    ? value.map(payload)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.entries(value).map(([key, item]) => {
            if (key !== RUNTIME_FIELD || !item || typeof item !== 'object')
              return [key, payload(item)];
            const { adoption: _adoption, adoptedBy: _adoptedBy, ...rest } = item;
            return [key, payload(rest)];
          }),
        )
      : value;
const assetsOf = (relative, bytes) =>
  relative === CATALOG ? JSON.parse(bytes).assets : [JSON.parse(bytes)];

/** The partial revision r02 on the applied ID, shaped as generate-candidates.mjs --base-adoption
 * writes it and verify-candidates.mjs --base-adoption reports it. Its tree model is a new file;
 * its tree LOD candidate is byte-identical to the one the base serves. */
async function chainFixture({ root, assets, bySource }) {
  const base = await appliedBase(root),
    only = new Set(['tree']),
    selection = selectWork(base.inventory, partial({ only: ['tree'], maps512: ['tree'] }), base),
    triangles = {
      [assets.tree.url]: assets.tree.triangles,
      [assets.tree.lods[0].url]: assets.tree.lods[0].triangles,
    },
    stored = {},
    records = [];
  for (const source of selection.files) {
    const bytes =
        source.url === assets.tree.url
          ? glb(`${source.url} r02`, true)
          : await readFile(file(root, `${REVISION}/${bySource.get(source.url).output.file}`)),
      digest = sha256(bytes),
      location = candidateLocation(source.url, digest);
    stored[location.file] = bytes;
    records.push({
      id: source.url,
      role: source.uses.map((use) => use.role).join('+'),
      uses: source.uses,
      source: { ...fileIdentity(source), triangles: triangles[source.url] },
      output: {
        ...location,
        sha256: digest,
        bytes: bytes.length,
        triangles: triangles[source.url],
        maximumTextureEdge: source.edge,
        textureEdges: source.edges,
        extensionsUsed: [MESHOPT_EXTENSION],
        extensionsRequired: [MESHOPT_EXTENSION],
        images: [],
      },
      derivation: {},
      verification: { status: 'passed', triangles: triangles[source.url] },
      status: CANDIDATE_STATUS,
      knownRisks: [],
    });
  }
  const manifest = {
    schema: MANIFEST_SCHEMA,
    revision: '20991231-r02',
    directory: CHAIN_REVISION,
    status: 'candidate',
    adoption: 'not-adopted',
    scope: { complete: false, only: ['tree'] },
    base: baseRecordOf(base, only),
    policy: { stricter512: [], maps512: ['tree'] },
    toolchain: { meshoptimizer: MESHOPTIMIZER_VERSION },
    options: { webpQuality: 90, colorFilter: 'lanczos' },
    inputs: {
      manifests: base.inventory.manifests,
      eligibility: RULES.inputs,
      standaloneImages: null,
    },
    standaloneImageOwner: null,
    models: base.inventory.models.map((model) =>
      modelSummary(
        model,
        only.has(model.modelKey),
        (url) => records.find((record) => record.source.url === url)?.output.url ?? null,
        null,
      ),
    ),
    files: records,
    images: [],
  };
  await put(root, `${CHAIN_REVISION}/manifest.json`, text(manifest));
  await put(root, `${CHAIN_REVISION}/runtime-index.json`, text(runtimeIndexOf(manifest)));
  await put(
    root,
    `${CHAIN_REVISION}/verification.json`,
    text({
      schema: 'cro-magnon/optimized-runtime-verification@1',
      revision: '20991231-r02',
      base: { adoption: ID, planSha256: base.planSha256 },
      scope: manifest.scope,
      status: 'passed',
      checks: [{ name: 'fixture', status: 'passed' }],
      files: records.map((record) => ({
        id: record.id,
        status: 'passed',
        verification: record.verification,
      })),
    }),
  );
  for (const [relative, bytes] of Object.entries(stored))
    await put(root, `${CHAIN_REVISION}/${relative}`, bytes);
  await put(root, CHAIN_ACCEPTANCE[0], 'r02 accepted after its own visual review\n');
  const [model, lod] = [assets.tree.url, assets.tree.lods[0].url].map((url) =>
    records.find((record) => record.id === url),
  );
  return { base, manifest, model, lod };
}

async function shippedRecords(root) {
  const catalog = await readJson(root, CATALOG),
    characters = await Promise.all(
      ['hero', 'fox', 'octo'].map((key) => readJson(root, `public/models/${key}/asset.json`)),
    );
  return [...catalog.assets, ...characters];
}

test('a chained adoption clones the applied base graph, replaces only the scoped files and restores the base byte for byte', async () => {
  await withFixture(
    async (world) => {
      const { root, assets, bySource } = world,
        { base, model, lod } = await chainFixture(world),
        oldModel = bySource.get(assets.tree.url).output,
        oldLod = bySource.get(assets.tree.lods[0].url).output,
        baseRecord = await snapshot(root, RECORD),
        revisions = await snapshot(root, 'assets/optimized-runtime'),
        publicBefore = await snapshot(root, 'public'),
        result = await planAdoption(root, CHAIN_OPTIONS),
        { graph } = result.plan,
        { copies, manifests: operations } = result.plan.operations;
      // Planning only reads.
      assert.deepEqual(await snapshot(root, 'public'), publicBefore);
      assert.deepEqual(await snapshot(root, 'assets/optimized-runtime'), revisions);
      assert.deepEqual(await snapshot(root, RECORD), baseRecord);
      assert.equal(existsSync(file(root, CHAIN_RECORD)), false);

      // One complete graph: the base's, with lineage; only the tree is replaced.
      assert.deepEqual(
        [graph.adoption, graph.candidateRevision, graph.base, graph.scope],
        [
          CHAIN_ID,
          CHAIN_REVISION,
          { adoption: ID, planSha256: base.planSha256, candidateRevision: REVISION },
          ['tree'],
        ],
      );
      assert.deepEqual(Object.keys(graph.models), Object.keys(base.graph.models));
      for (const [key, entry] of Object.entries(base.graph.models)) {
        if (key === 'tree') continue;
        const { candidateRevision, adoptedBy, ...rest } = graph.models[key];
        assert.deepEqual(rest, entry, `${key} keeps every served file, selection and LOD decision`);
        assert.deepEqual([candidateRevision, adoptedBy], [REVISION, ID], key);
      }
      for (const [url, texture] of Object.entries(base.graph.textures)) {
        const { candidateRevision, adoptedBy, ...rest } = graph.textures[url];
        assert.deepEqual(rest, texture, url);
        assert.deepEqual([candidateRevision, adoptedBy], [REVISION, ID], url);
      }
      assert.deepEqual(
        [graph.keptTextures, graph.notAdopted, graph.lodRejections, graph.decoder],
        [
          base.graph.keptTextures,
          base.graph.notAdopted,
          base.graph.lodRejections,
          base.graph.decoder,
        ],
      );
      const behemoth = graph.models['violet-behemoth'];
      assert.deepEqual(
        [behemoth.selection, behemoth.primary.triangles, behemoth.lods, behemoth.farTriangles],
        [SELECTION.full, 39825, [], { before: 7965, after: 39825, added: 31860 }],
      );
      const tree = graph.models.tree;
      assert.deepEqual(
        [tree.selection, tree.candidateRevision, tree.adoptedBy],
        [SELECTION.ordinary, CHAIN_REVISION, CHAIN_ID],
      );
      assert.deepEqual(
        [tree.primary, tree.lods[0]].map(fileIdentity),
        [model.output, oldLod].map(fileIdentity),
        'the byte-identical LOD candidate stays served',
      );
      assert.deepEqual(
        [tree.primary.source, tree.lods[0].source],
        [base.graph.models.tree.primary.source, base.graph.models.tree.lods[0].source],
        'the true originals, never the served r01 candidates',
      );
      assert.deepEqual(tree.supersedes, {
        adoption: ID,
        candidateRevision: REVISION,
        primary: { ...fileIdentity(oldModel), triangles: 120 },
        lods: [{ ...fileIdentity(oldLod), triangles: 40 }],
      });
      // Only the replaced file is retired; nothing still served is.
      assert.deepEqual(graph.retired, [...base.graph.retired, oldModel.url].sort());
      assert.ok(!graph.retired.includes(oldLod.url));
      assert.deepEqual(graph.retiredCandidates.slice(base.graph.retiredCandidates.length), [
        {
          modelKey: 'tree',
          role: 'model',
          reason: `superseded-by-${CHAIN_ID}`,
          ...fileIdentity(oldModel),
          triangles: 120,
          from: `${REVISION}/${oldModel.file}`,
        },
      ]);
      assert.deepEqual(
        copies.map((copy) => [copy.url, copy.from]),
        [[model.output.url, `${CHAIN_REVISION}/${model.output.file}`]],
      );
      assert.deepEqual(
        [result.plan.totals.replacedFiles, result.plan.totals.unchangedFiles],
        [1, 1],
      );
      assert.deepEqual(
        [result.plan.options, result.plan.base.planSha256, result.plan.acceptance.documents.length],
        [{ revision: CHAIN_REVISION, acceptance: CHAIN_ACCEPTANCE, base: ID }, base.planSha256, 1],
      );

      // The manifests the base rewrote, from its applied bytes: every record keeps its payload,
      // and only the tree model changes its file and lineage.
      assert.deepEqual(
        operations.map((operation) => operation.path),
        base.record.rewrittenManifests.map((item) => item.path),
      );
      for (const operation of operations) {
        const saved = result.before.get(operation.path),
          rewritten = result.after.get(operation.path);
        assert.equal(
          sha256(saved),
          base.record.rewrittenManifests.find((item) => item.path === operation.path).after.sha256,
          `${operation.path}: the base's applied bytes`,
        );
        const [was, now] = [saved, rewritten].map((bytes) => assetsOf(operation.path, bytes));
        now.forEach((asset, index) => {
          const old = was[index];
          if (asset.modelKey !== 'tree') {
            assert.deepEqual(payload(asset), payload(old), `${operation.path} ${asset.modelKey}`);
            if (old[RUNTIME_FIELD])
              assert.deepEqual(
                [
                  asset[RUNTIME_FIELD].adoption,
                  asset[RUNTIME_FIELD].adoptedBy,
                  asset[RUNTIME_FIELD].candidateRevision,
                ],
                [CHAIN_ID, ID, REVISION],
              );
            return;
          }
          const { url, sha256: digest, bytes, [RUNTIME_FIELD]: runtime, ...rest } = asset,
            { url: _u, sha256: _d, bytes: _b, [RUNTIME_FIELD]: runtime0, ...rest0 } = old;
          assert.deepEqual(rest, rest0, 'the tree keeps its LODs, triangles and metadata');
          assert.deepEqual(
            [url, digest, bytes],
            [model.output.url, model.output.sha256, model.output.bytes],
          );
          assert.deepEqual(runtime.original, runtime0.original, 'the true original stays');
          assert.deepEqual(
            [runtime.adoption, runtime.candidateRevision, runtime.selection, runtime.adoptedBy],
            [CHAIN_ID, CHAIN_REVISION, SELECTION.ordinary, CHAIN_ID],
          );
          assert.deepEqual(runtime.supersedes, {
            adoption: ID,
            candidateRevision: REVISION,
            ...fileIdentity(oldModel),
            lods: [fileIdentity(oldLod)],
          });
        });
      }
      const cave = assetsOf(
        'public/models/camp-cave/asset.json',
        result.after.get('public/models/camp-cave/asset.json'),
      )[0];
      assert.deepEqual(cave.pigment.provenance[RUNTIME_FIELD], {
        adoption: CHAIN_ID,
        candidateRevision: REVISION,
        original: {
          url: '/models/camp-cave/pigment-r01.png',
          sha256: assets.cave.pigment.sha256,
          bytes: assets.cave.pigment.bytes,
          image: { width: 2048, height: 1024 },
        },
        adoptedBy: ID,
      });
      assert.deepEqual(
        [cave.pigment.image, cave.pigment.uvSource],
        [
          { width: 1024, height: 512 },
          { width: 2048, height: 1024 },
        ],
      );

      // Apply, audit: one active graph under one id.
      await writePlan(root, result);
      assert.deepEqual((await readJson(root, `${CHAIN_RECORD}/journal.json`)).base, {
        adoption: ID,
        planSha256: base.planSha256,
      });
      const report = await applyAdoption(root, CHAIN_ID, { rules: RULES });
      assert.equal(
        report.status,
        'passed',
        JSON.stringify(
          report.checks.filter((item) => item.status !== 'passed'),
          null,
          2,
        ),
      );
      assert.deepEqual(report.base, { adoption: ID, planSha256: base.planSha256 });
      for (const name of [
        "the saved manifests are the base adoption's applied bytes",
        'every file the graph serves',
        'cave texture records serve the candidate',
        'every model whose old LOD was rejected',
      ])
        assert.equal(
          report.checks.find((item) => item.name.startsWith(name))?.status,
          'passed',
          name,
        );
      assert.deepEqual(
        await snapshot(root, RECORD),
        baseRecord,
        'the base record is never written',
      );
      assert.deepEqual(await snapshot(root, 'assets/optimized-runtime'), revisions);
      const shipped = await shippedRecords(root),
        options = { textureRecords: runtimeTextureRecords },
        adoption = await activeAdoption(root, shipped, runtimeTextureRecords);
      assert.equal(adoption.id, CHAIN_ID);
      const runtime = checkRuntimeGraph(shipped, adoption, { ...options, requireAdoption: true });
      assert.deepEqual(
        runtime.models.filter((item) => item.modelKey === 'tree').map((item) => item.url),
        [model.output.url, oldLod.url],
      );
      assert.ok(!runtime.models.some((item) => item.url === oldModel.url));
      const hero = shipped.find((asset) => asset.modelKey === 'hero'),
        stale = structuredClone(hero);
      stale[RUNTIME_FIELD].adoption = ID;
      assert.throws(() => checkRuntimeGraph([stale], adoption, options), /not the adopted one/);
      await assert.rejects(
        activeAdoption(root, [...shipped, stale], runtimeTextureRecords),
        /more than one runtime adoption/,
      );
      // The base's own audit now records history; it is no longer a usable base.
      assert.equal((await auditAdoption(root, ID)).status, 'failed');
      await assert.rejects(readBaseAdoption(root, ID, RULES), /no longer exactly the applied ones/);

      // Restore: every manifest holds the base's applied bytes again, byte for byte.
      const restored = await restoreAdoption(root, CHAIN_ID);
      assert.equal(restored.state, 'restored');
      for (const item of base.record.rewrittenManifests)
        assert.ok(
          (await readFile(file(root, item.path))).equals(
            await readFile(file(root, `${RECORD}/after/${item.path}`)),
          ),
          item.path,
        );
      assert.ok(existsSync(file(root, `public${model.output.url}`)), 'copies stay');
      assert.equal((await auditAdoption(root, ID)).status, 'passed');
      const chainAudit = await auditAdoption(root, CHAIN_ID);
      assert.deepEqual([chainAudit.state, chainAudit.status], ['restored', 'passed']);
      assert.equal(
        (await activeAdoption(root, await shippedRecords(root), runtimeTextureRecords)).id,
        ID,
      );
      await readBaseAdoption(root, ID, RULES);
      assert.deepEqual(await snapshot(root, RECORD), baseRecord);
    },
    { behemoth: true },
  );
});

test('a chained plan needs an intact applied base, its own acceptance and a revision verified against exactly that base', async () => {
  await withFixture(
    async (world) => {
      const { root, assets, bySource } = world,
        { base, model } = await chainFixture(world),
        refused = (options, pattern) =>
          assert.rejects(planAdoption(root, { ...CHAIN_OPTIONS, ...options }), pattern),
        revisionFiles = ['manifest.json', 'runtime-index.json', 'verification.json'].map(
          (name) => `${CHAIN_REVISION}/${name}`,
        ),
        tampered = async (edit, pattern) => {
          const saved = await Promise.all(
              revisionFiles.map((relative) => readFile(file(root, relative))),
            ),
            manifest = await readJson(root, revisionFiles[0]),
            verification = await readJson(root, revisionFiles[2]);
          edit(manifest, verification);
          await put(root, revisionFiles[0], text(manifest));
          await put(root, revisionFiles[1], text(runtimeIndexOf(manifest)));
          await put(root, revisionFiles[2], text(verification));
          try {
            await refused({}, pattern);
          } finally {
            for (const [index, relative] of revisionFiles.entries())
              await writeFile(file(root, relative), saved[index]);
          }
        },
        damaged = async (relative, bytes, pattern) => {
          const target = file(root, relative),
            good = existsSync(target) ? await readFile(target) : null;
          await put(root, relative, bytes);
          try {
            await refused({}, pattern);
          } finally {
            if (good) await writeFile(target, good);
            else await rm(target);
          }
        },
        publicBefore = await snapshot(root, 'public');

      // Without a base, a partial revision is still refused, as before.
      await assert.rejects(
        planAdoption(root, { ...OPTIONS, revision: CHAIN_REVISION, adoption: CHAIN_ID }),
        /is a partial revision; only a complete revision can be adopted on its own/,
      );
      // Nothing has a default, and the base's acceptance never covers new candidates.
      await refused({ revision: undefined }, /needs its partial revision/);
      await refused({ adoption: undefined }, /needs a new adoption id/);
      await refused({ adoption: ID }, /needs a new id, not its base's/);
      await refused({ acceptance: undefined }, /own acceptance documents/);
      await refused(
        { acceptance: ACCEPTANCE },
        /accepted base adoption .* candidates, not this revision's/,
      );
      await refused({ revision: REVISION }, /is the base's own candidate revision/);

      // The revision must be verified against exactly this base and record nothing else.
      await tampered((manifest) => {
        manifest.base.planSha256 = '0'.repeat(64);
      }, /does not match base adoption .*\$\.planSha256/);
      await tampered((manifest, verification) => {
        manifest.scope.only = ['tree', 'violet-behemoth'];
        verification.scope = manifest.scope;
      }, /violet-behemoth serves its full candidate as the sole primary/);
      await tampered((manifest, verification) => {
        delete verification.base;
      }, /was not verified against base adoption/);
      await tampered((manifest, verification) => {
        manifest.files.push(structuredClone(manifest.files[0]));
        verification.files.push(structuredClone(verification.files[0]));
      }, /does not cover exactly the manifest's records/);
      await damaged(
        `${CHAIN_REVISION}/models/tree/extra.opt-${'0'.repeat(16)}.glb`,
        glb('extra'),
        /holds files it does not record: models\/tree\/extra/,
      );
      await damaged(
        `${CHAIN_REVISION}/${model.output.file}`,
        glb('tampered r02'),
        /the candidate is corrupt/,
      );
      await refused(
        {
          rules: {
            ...RULES,
            inputs: [{ path: RULES.inputs[0].path, sha256: 'c'.repeat(64) }, RULES.inputs[1]],
          },
        },
        /eligibility inputs differ/,
      );

      // The base must be applied, current and intact.
      await damaged(
        'public/models/octo/asset.json',
        text({ ...assets.octo, notes: ['unrelated edit'] }),
        /no longer exactly the applied ones: public\/models\/octo\/asset\.json changed/,
      );
      const journal = await readJson(root, `${RECORD}/journal.json`);
      await damaged(
        `${RECORD}/journal.json`,
        text({ ...journal, state: 'restored' }),
        /it is restored, not applied/,
      );
      await damaged(
        `public${base.graph.models.fox.primary.url}`,
        Buffer.from('not the startup file'),
        /served or original files do not match the plan/,
      );
      await damaged(
        `public${assets.behemoth.lods[0].url}`,
        Buffer.from('not the rejected LOD'),
        /served or original files do not match the plan/,
      );
      // A different file under the new hash-named URL is never overwritten.
      await damaged(
        `public${model.output.url}`,
        Buffer.from('a different file under the same hashed name'),
        /already exists with different content/,
      );

      // Every refusal wrote nothing; the untampered plan goes through.
      assert.deepEqual(await snapshot(root, 'public'), publicBefore);
      assert.equal(existsSync(file(root, CHAIN_RECORD)), false);
      const result = await planAdoption(root, CHAIN_OPTIONS);
      await writePlan(root, result);
      await refused({}, /already exists; adoption records are never reused/);
      assert.equal(
        bySource.get(assets.tree.url).output.url,
        result.plan.graph.models.tree.supersedes.primary.url,
      );
    },
    { behemoth: true },
  );
});

test('a chained apply stops before writing on drift or a conflicting copy; an interrupted one names two adoptions until restored', async () => {
  await withFixture(async (world) => {
    const { root, assets } = world,
      { model } = await chainFixture(world),
      result = await planAdoption(root, CHAIN_OPTIONS),
      operations = result.plan.operations.manifests;
    await writePlan(root, result);
    const publicBefore = await snapshot(root, 'public'),
      planned = async (pattern) => {
        await assert.rejects(applyAdoption(root, CHAIN_ID, { rules: RULES }), pattern);
        assert.equal((await readJson(root, `${CHAIN_RECORD}/journal.json`)).state, 'planned');
      };
    // An unrelated edit after the plan: the re-plan differs and nothing is written.
    await put(root, 'public/models/octo/asset.json', text({ ...assets.octo, notes: ['edited'] }));
    await planned(/no longer exactly the applied ones/);
    await put(root, 'public/models/octo/asset.json', text(assets.octo));
    // A different file appears under the new candidate's URL: refused before any copy or rewrite.
    const target = `public${model.output.url}`;
    await put(root, target, 'a different file under the same hashed name');
    await planned(/already exists with different content/);
    await rm(file(root, target));
    assert.deepEqual(await snapshot(root, 'public'), publicBefore);

    // An interrupted apply: some manifests name the chain, the rest still the base.
    const last = operations.at(-1).path,
      stray = `${last}.adoption-${CHAIN_ID}.tmp`;
    await put(root, stray, 'left behind by an interrupted run');
    await assert.rejects(
      applyAdoption(root, CHAIN_ID, { rules: RULES }),
      /left from an interrupted run; nothing was overwritten/,
    );
    assert.equal((await readJson(root, `${CHAIN_RECORD}/journal.json`)).state, 'applying');
    const current = [];
    for (const operation of operations)
      current.push(...assetsOf(operation.path, await readFile(file(root, operation.path))));
    await assert.rejects(
      activeAdoption(root, current, runtimeTextureRecords),
      /more than one runtime adoption/,
    );
    await assert.rejects(applyAdoption(root, CHAIN_ID, { rules: RULES }), /apply runs only once/);
    assert.equal((await auditAdoption(root, CHAIN_ID)).status, 'failed');
    // The half-applied manifests are not even a consistent inventory: the catalog's tree record
    // already serves the chain's file, its own manifest (the last, unreplaced one) the base's. The
    // base validation refuses them there, before any drift comparison, and a second chain
    // cannot start from them. That attempt writes nothing.
    assert.equal(last, 'public/models/tree/asset.json');
    const inconsistent =
        /^Error: public\/models\/world-assets\.json and public\/models\/tree\/asset\.json disagree on the delivered files of tree$/,
      second = `${CHAIN_ID.slice(0, -1)}2`,
      halfApplied = await snapshot(root, 'public'),
      records = await snapshot(root, 'assets/runtime-adoption');
    await assert.rejects(readBaseAdoption(root, ID, RULES), inconsistent);
    await assert.rejects(planAdoption(root, { ...CHAIN_OPTIONS, adoption: second }), inconsistent);
    assert.deepEqual(await snapshot(root, 'public'), halfApplied);
    assert.deepEqual(await snapshot(root, 'assets/runtime-adoption'), records);
    assert.equal(existsSync(file(root, `assets/runtime-adoption/${second}`)), false);
    assert.equal((await readJson(root, `${CHAIN_RECORD}/journal.json`)).state, 'applying');
    assert.equal((await readJson(root, `${RECORD}/journal.json`)).state, 'applied');
    const restored = await restoreAdoption(root, CHAIN_ID);
    assert.deepEqual(restored.alreadyOriginal, [last]);
    assert.deepEqual(
      restored.restored,
      operations.slice(0, -1).map((operation) => operation.path),
    );
    for (const operation of operations)
      assert.ok(
        (await readFile(file(root, operation.path))).equals(
          await readFile(file(root, `${RECORD}/after/${operation.path}`)),
        ),
        operation.path,
      );
    assert.equal((await auditAdoption(root, ID)).status, 'passed');
    await readBaseAdoption(root, ID, RULES);
  });
});

test('a chained plan, apply and audit re-plan the inherited cave images against the current runtime', async () => {
  await withFixture(async (world) => {
    const { root } = world,
      { base } = await chainFixture(world),
      module = file(root, 'src/verified-texture.ts'),
      source = await readFile(module, 'utf8'),
      refactor = `// a reviewed refactor that keeps every image\n${source}`,
      semantic = source.replace("key === 'rockSurface'", "key === 'pigment'"),
      sameMeaning =
        /no longer loads base adoption .* standalone images with the same meaning: .*repeats pigment/,
      name = "the current runtime still loads the base adoption's standalone images",
      compatible = (report) => report.checks.find((item) => item.name.startsWith(name));
    assert.ok(semantic !== source);
    // A semantic loader change stops the plan; so does a moved motif rectangle.
    await writeFile(module, semantic);
    await assert.rejects(planAdoption(root, CHAIN_OPTIONS), sameMeaning);
    await writeFile(module, source);
    const layout = file(root, 'src/cave-gallery-layout.ts'),
      motifs = await readFile(layout, 'utf8');
    await writeFile(
      layout,
      motifs.replace('bison: [10, 10, 1000, 500]', 'bison: [10, 10, 1000, 520]'),
    );
    await assert.rejects(
      planAdoption(root, CHAIN_OPTIONS),
      /same meaning: image:\/models\/camp-cave\/pigment-r01\.png: \$\.uv\.motifs/,
    );
    await writeFile(layout, motifs);

    // A refactor that keeps every image plans; the record names the base's revision and saved
    // manifests and the current runtime inputs. The base record is never written.
    await writeFile(module, refactor);
    const baseRecord = await snapshot(root, RECORD),
      result = await planAdoption(root, CHAIN_OPTIONS),
      record = result.plan.runtimeCompatibility;
    assert.deepEqual(record.inherited, {
      adoption: ID,
      candidateRevision: REVISION,
      manifests: `${RECORD}/before`,
      changedSinceBase: true,
    });
    assert.deepEqual(
      record.images.map((image) => image.id),
      [
        'image:/models/camp-cave/pigment-r01.png',
        'image:/models/camp-cave/limestone-r01.png',
        'image:/models/camp-cave/friends-r01.png',
      ],
    );
    assert.equal(
      record.inputs.find((input) => input.path === 'src/verified-texture.ts').sha256,
      sha256(Buffer.from(refactor)),
    );
    await writePlan(root, result);

    // A semantic change between plan and apply: apply re-plans and writes nothing.
    await writeFile(module, semantic);
    const publicBefore = await snapshot(root, 'public');
    await assert.rejects(applyAdoption(root, CHAIN_ID, { rules: RULES }), sameMeaning);
    assert.deepEqual(await snapshot(root, 'public'), publicBefore);
    assert.equal((await readJson(root, `${CHAIN_RECORD}/journal.json`)).state, 'planned');

    // As planned, it applies; the audit records the current inputs.
    await writeFile(module, refactor);
    const applied = await applyAdoption(root, CHAIN_ID, { rules: RULES });
    assert.equal(applied.status, 'passed', JSON.stringify(compatible(applied)));
    assert.equal(compatible(applied).status, 'passed');
    assert.equal(applied.runtimeCompatibility.changedSincePlan, false);
    // A later edit that keeps every image passes and is reported as changed.
    await writeFile(module, source);
    const touched = await auditAdoption(root, CHAIN_ID);
    assert.equal(touched.status, 'passed');
    assert.equal(touched.runtimeCompatibility.changedSincePlan, true);
    // A semantic change after apply fails the audit and names it.
    await writeFile(module, semantic);
    const drifted = await auditAdoption(root, CHAIN_ID);
    assert.equal(drifted.status, 'failed');
    assert.equal(compatible(drifted).status, 'failed');
    assert.match(JSON.stringify(compatible(drifted).problems), /repeats pigment/);
    assert.deepEqual(await snapshot(root, RECORD), baseRecord);

    // The graph must serve the inherited images exactly as the base revision recorded them.
    const revision = await readJson(root, `${REVISION}/manifest.json`),
      pigment = '/models/camp-cave/pigment-r01.png';
    assert.deepEqual(inheritedImageProblems(base.graph, revision), []);
    const moved = structuredClone(base.graph);
    moved.textures[pigment].uvSource = { width: 1024, height: 512 };
    assert.match(
      inheritedImageProblems(moved, revision).join('\n'),
      /pigment-r01\.png: the graph does not serve .* as the revision recorded it/,
    );
    const dropped = structuredClone(base.graph);
    dropped.keptTextures = [];
    assert.match(
      inheritedImageProblems(dropped, revision).join('\n'),
      /does not keep the original \/models\/camp-cave\/friends-r01\.png/,
    );
    // A base revision without standalone images needs a graph without them, and nothing else.
    const bare = { ...structuredClone(base.graph), textures: {}, keptTextures: [] };
    assert.deepEqual(inheritedImageProblems(bare, { images: [] }), []);
    assert.match(
      inheritedImageProblems(base.graph, { images: [] }).join('\n'),
      /serves an image the revision did not record/,
    );
  });
});

// Exact repack (exact-repack.mjs, repack-adoption.mjs): the files an applied adoption serves,
// repacked without changing a decoded value and adopted as one more chained graph.

/** The exact repack of the applied `base`, generated, verified and reported as
 * generate-candidates.mjs --recipe exact-repack and verify-candidates.mjs --write-report make it,
 * with its own acceptance document. */
async function repackRevision(root, { base = ID, scope = TREE_AND_CAVE } = {}) {
  await generateExactRepack(root, {
    base,
    out: REPACK_REVISION,
    rules: RULES,
    scope,
    settings: REPACK_SETTINGS,
  });
  const report = await verifyExactRepack(root, REPACK_REVISION, { base, rules: RULES });
  assert.equal(
    report.status,
    'passed',
    JSON.stringify(
      [...report.checks, ...report.files].filter((item) => item.status !== 'passed'),
      null,
      2,
    ),
  );
  await put(root, `${REPACK_REVISION}/${EXACT_REPACK_REPORT}`, text(report));
  await put(root, REPACK_ACCEPTANCE[0], 'r03 accepted after its own native review\n');
  return { report, manifest: await readJson(root, `${REPACK_REVISION}/manifest.json`) };
}

/** Plan refusals with `options`; every edit is undone after the refusal it must cause. */
function planRefusals(root, options) {
  const refused = (extra, pattern) =>
    assert.rejects(planAdoption(root, { ...options, ...extra }), pattern);
  return {
    refused,
    // The manifest edited, its index re-derived and the report kept in step with it.
    async tampered(edit, pattern) {
      const files = ['manifest.json', 'runtime-index.json', EXACT_REPACK_REPORT].map(
          (name) => `${options.revision}/${name}`,
        ),
        saved = await Promise.all(files.map((relative) => readFile(file(root, relative)))),
        manifest = await readJson(root, files[0]),
        report = await readJson(root, files[2]);
      edit(manifest, report);
      await put(root, files[0], text(manifest));
      await put(root, files[1], text(runtimeIndexOf(manifest)));
      await put(root, files[2], text(report));
      try {
        await refused({}, pattern);
      } finally {
        for (const [index, relative] of files.entries())
          await writeFile(file(root, relative), saved[index]);
      }
    },
    async damaged(relative, bytes, pattern) {
      const target = file(root, relative),
        good = existsSync(target) ? await readFile(target) : null;
      await put(root, relative, bytes);
      try {
        await refused({}, pattern);
      } finally {
        if (good) await writeFile(target, good);
        else await rm(target);
      }
    },
  };
}

// A served model record without its file, scene, LODs and adoption field.
const unserved = ({
  url: _u,
  sha256: _s,
  bytes: _b,
  scene: _n,
  lods: _l,
  [RUNTIME_FIELD]: _f,
  ...rest
}) => rest;
// An adopted image without its file and lineage.
const unfiled = ({
  url: _u,
  sha256: _s,
  bytes: _b,
  candidate: _c,
  candidateRevision: _r,
  adoptedBy: _a,
  exactOf: _e,
  supersedes: _p,
  ...rest
}) => rest;
const failedChecks = (report) =>
  JSON.stringify(
    report.checks.filter((item) => item.status === 'failed'),
    null,
    2,
  );

test('an exact repack packs the tree into one file and rewrites a cave PNG losslessly, adopted on its applied base and restored byte for byte', async () => {
  await withFixture(
    async ({ root, assets, bySource }) => {
      const base = await appliedBase(root),
        baseRecord = await snapshot(root, RECORD),
        publicBefore = await snapshot(root, 'public'),
        { manifest, report } = await repackRevision(root),
        oldModel = bySource.get(assets.tree.url).output,
        oldLod = bySource.get(assets.tree.lods[0].url).output,
        was = base.graph.textures[PIGMENT],
        [packed] = manifest.files,
        images = new Map(manifest.images.map((record) => [record.id, record])),
        pigment = images.get(`image:${PIGMENT}`),
        limestone = images.get(`image:${LIMESTONE}`);

      // The revision: made from the files the base serves, verified against exactly that base.
      assert.deepEqual(
        await snapshot(root, 'public'),
        publicBefore,
        'generating writes no public file',
      );
      assert.deepEqual(await snapshot(root, RECORD), baseRecord);
      assert.deepEqual(
        [
          manifest.recipe,
          manifest.scope,
          manifest.base.adoption,
          manifest.base.planSha256,
          report.base,
        ],
        [
          EXACT_REPACK_RECIPE,
          scopeRecord(TREE_AND_CAVE),
          ID,
          base.planSha256,
          { adoption: ID, planSha256: base.planSha256 },
        ],
      );
      assert.deepEqual(
        manifest.files.map((record) => [record.id, record.role]),
        [['model:tree', PACKED_ROLE]],
      );
      assert.match(packed.output.url, /^\/models\/tree\/model-levels\.opt-[0-9a-f]{16}\.glb$/);
      assert.deepEqual(packed.output.scenes, [
        { scene: 0, level: 0, triangles: 256 },
        { scene: 1, level: 1, triangles: 64 },
      ]);
      assert.deepEqual(
        packed.source.levels.map((level) => [fileIdentity(level), level.original]),
        [
          [fileIdentity(oldModel), fileIdentity(assets.tree)],
          [fileIdentity(oldLod), fileIdentity(assets.tree.lods[0])],
        ],
        'the served r01 levels, each with its true original',
      );
      // One stored PNG serves both scenes: the lossless rewrite of the image the levels share.
      const doc = parseGlb(
          await readFile(file(root, `${REPACK_REVISION}/${packed.output.file}`)),
          'packed tree',
        ),
        views = [...new Set(doc.json.images.map((image) => image.bufferView))],
        embedded = storedViewBytes(doc.json, doc.bin, views[0]);
      assert.deepEqual(
        [doc.json.scene, doc.json.scenes.length, doc.json.images.length, views.length],
        [0, 2, 2, 1],
      );
      checkLosslessRewrite(TREE_PNG, embedded, 'tree image');
      assert.ok(embedded.length < TREE_PNG.length);
      assert.deepEqual(
        packed.images.map((image) => [image.level, image.sha256, image.rewrite]),
        [0, 1].map((level) => [
          level,
          sha256(TREE_PNG),
          { sha256: sha256(embedded), bytes: embedded.length },
        ]),
      );
      // The cave: the pigment's stored stream shrinks; the limestone's cannot, so it stays served.
      const pigmentServed = await readFile(file(root, `public${was.url}`)),
        limestoneServed = await readFile(file(root, `public${base.graph.textures[LIMESTONE].url}`)),
        rewritten = await readFile(file(root, `${REPACK_REVISION}/${pigment.output.file}`));
      assert.deepEqual([...images.keys()].sort(), [`image:${LIMESTONE}`, `image:${PIGMENT}`]);
      checkLosslessRewrite(pigmentServed, rewritten, 'pigment');
      assert.ok(rewritten.length < pigmentServed.length);
      assert.deepEqual(
        [pigment.status, fileIdentity(pigment.source), pigment.output.width, pigment.output.height],
        [CANDIDATE_STATUS, fileIdentity(was), 1024, 512],
      );
      assert.deepEqual([limestone.status, limestone.output], [ORIGINAL_KEPT_STATUS, null]);
      assert.match(limestone.reason, /is not smaller/);
      // The totals are the bytes actually served before and after, physical file by file.
      const before = oldModel.bytes + oldLod.bytes + pigmentServed.length + limestoneServed.length,
        after = packed.output.bytes + rewritten.length + limestoneServed.length;
      assert.deepEqual(
        [
          manifest.totals.before,
          manifest.totals.after,
          manifest.totals.savedBytes,
          manifest.totals.distinctPngs,
        ],
        [{ files: 4, bytes: before }, { files: 3, bytes: after }, before - after, 3],
      );

      // The plan only reads, and clones the base graph with lineage.
      const revisions = await snapshot(root, 'assets/optimized-runtime'),
        result = await planAdoption(root, REPACK_OPTIONS),
        { graph } = result.plan,
        { copies, manifests: operations } = result.plan.operations;
      assert.deepEqual(await snapshot(root, 'public'), publicBefore);
      assert.deepEqual(await snapshot(root, 'assets/optimized-runtime'), revisions);
      assert.deepEqual(await snapshot(root, RECORD), baseRecord);
      assert.equal(existsSync(file(root, REPACK_RECORD)), false);
      assert.deepEqual(
        [graph.adoption, graph.candidateRevision, graph.recipe, graph.base, graph.scope],
        [
          REPACK_ID,
          REPACK_REVISION,
          EXACT_REPACK_RECIPE,
          { adoption: ID, planSha256: base.planSha256, candidateRevision: REVISION },
          ['camp-cave', 'tree'],
        ],
      );
      assert.deepEqual(
        [result.plan.recipe, result.plan.options],
        [
          EXACT_REPACK_RECIPE,
          { revision: REPACK_REVISION, acceptance: REPACK_ACCEPTANCE, base: ID },
        ],
      );
      // Everything outside the scope carries forward exactly: the startup actors with their
      // cleared LODs, the behemoth's sole body with its LOD rejection and evidence, the cave model.
      assert.deepEqual(Object.keys(graph.models), Object.keys(base.graph.models));
      for (const [key, entry] of Object.entries(base.graph.models)) {
        if (key === 'tree') continue;
        const { candidateRevision, adoptedBy, ...rest } = graph.models[key];
        assert.deepEqual(rest, entry, `${key} keeps every served file, selection and LOD decision`);
        assert.deepEqual([candidateRevision, adoptedBy], [REVISION, ID], key);
      }
      assert.deepEqual(
        [graph.keptTextures, graph.notAdopted, graph.lodRejections, graph.decoder],
        [
          base.graph.keptTextures,
          base.graph.notAdopted,
          base.graph.lodRejections,
          base.graph.decoder,
        ],
      );
      // The tree: one file, level i in scene i, the true originals, the superseded r01 files.
      const tree = graph.models.tree;
      assert.deepEqual(
        [tree.selection, tree.candidateRevision, tree.adoptedBy, tree.packed, tree.manifests],
        [
          SELECTION.ordinary,
          REPACK_REVISION,
          REPACK_ID,
          { scenes: 2 },
          base.graph.models.tree.manifests,
        ],
      );
      assert.deepEqual(
        [tree.primary, ...tree.lods].map((level) => [
          fileIdentity(level),
          level.scene,
          level.triangles,
          level.candidate,
        ]),
        [
          [fileIdentity(packed.output), 0, 256, 'model:tree'],
          [fileIdentity(packed.output), 1, 64, 'model:tree'],
        ],
      );
      assert.deepEqual(
        [tree.primary.source, tree.lods[0].source],
        [base.graph.models.tree.primary.source, base.graph.models.tree.lods[0].source],
      );
      assert.deepEqual(tree.supersedes, {
        adoption: ID,
        candidateRevision: REVISION,
        primary: { ...fileIdentity(oldModel), triangles: 256 },
        lods: [{ ...fileIdentity(oldLod), triangles: 64 }],
      });
      // The images: the pigment serves its rewrite with everything else kept; the limestone stays.
      const repacked = graph.textures[PIGMENT];
      assert.deepEqual(
        unfiled(repacked),
        unfiled(was),
        'size, uvSource, wrap and colour space stay',
      );
      assert.deepEqual(
        [
          fileIdentity(repacked),
          repacked.candidateRevision,
          repacked.adoptedBy,
          repacked.exactOf,
          repacked.supersedes,
        ],
        [
          fileIdentity(pigment.output),
          REPACK_REVISION,
          REPACK_ID,
          fileIdentity(was),
          { adoption: ID, candidateRevision: REVISION, ...fileIdentity(was) },
        ],
      );
      const {
        candidateRevision: keptRevision,
        adoptedBy: keptBy,
        ...kept
      } = graph.textures[LIMESTONE];
      assert.deepEqual(
        [kept, keptRevision, keptBy],
        [base.graph.textures[LIMESTONE], REVISION, ID],
        'the retained image keeps its served file',
      );
      // Only the superseded files retire, each archived in the revision that generated it.
      assert.deepEqual(
        graph.retired,
        [...base.graph.retired, oldModel.url, oldLod.url, was.url].sort(),
      );
      assert.deepEqual(
        graph.retiredCandidates
          .slice(base.graph.retiredCandidates.length)
          .map((item) => [item.modelKey, item.role, item.reason, item.url, item.from]),
        [
          [
            'tree',
            'model',
            `superseded-by-${REPACK_ID}`,
            oldModel.url,
            `${REVISION}/${oldModel.file}`,
          ],
          ['tree', 'lod', `superseded-by-${REPACK_ID}`, oldLod.url, `${REVISION}/${oldLod.file}`],
          ['camp-cave', 'image', `superseded-by-${REPACK_ID}`, was.url, `${REVISION}${was.url}`],
        ],
      );
      assert.deepEqual(
        copies.map((copy) => [copy.url, copy.from]),
        [
          [pigment.output.url, `${REPACK_REVISION}/${pigment.output.file}`],
          [packed.output.url, `${REPACK_REVISION}/${packed.output.file}`],
        ],
      );
      assert.deepEqual(
        [
          result.plan.totals.repackedModels,
          result.plan.totals.packedModels,
          result.plan.totals.replacedImages,
          result.plan.totals.supersededFiles,
          result.plan.totals.revisionTotals,
        ],
        [1, 1, 1, 3, manifest.totals],
      );

      // The manifests the base rewrote, from its applied bytes: only the tree's files and scenes,
      // the pigment's file and the lineage change.
      assert.deepEqual(
        operations.map((operation) => operation.path),
        base.record.rewrittenManifests.map((item) => item.path),
      );
      for (const operation of operations) {
        const [old, next] = [result.before, result.after].map((saved) =>
          assetsOf(operation.path, saved.get(operation.path)),
        );
        next.forEach((asset, index) => {
          const previous = old[index];
          if (asset.modelKey === 'tree') {
            assert.deepEqual(unserved(asset), unserved(previous), 'the tree keeps its metadata');
            assert.deepEqual(
              asset.lods.map(unserved),
              previous.lods.map(unserved),
              'each level keeps its triangles, distance and purpose',
            );
            assert.deepEqual(
              [asset, ...asset.lods].map((record) => [fileIdentity(record), record.scene]),
              [
                [fileIdentity(packed.output), 0],
                [fileIdentity(packed.output), 1],
              ],
            );
            const runtime = asset[RUNTIME_FIELD];
            assert.deepEqual(
              runtime.original,
              previous[RUNTIME_FIELD].original,
              'the true original',
            );
            assert.deepEqual(
              [
                runtime.adoption,
                runtime.candidateRevision,
                runtime.selection,
                runtime.adoptedBy,
                runtime.supersedes,
              ],
              [
                REPACK_ID,
                REPACK_REVISION,
                SELECTION.ordinary,
                REPACK_ID,
                {
                  adoption: ID,
                  candidateRevision: REVISION,
                  ...fileIdentity(oldModel),
                  lods: [fileIdentity(oldLod)],
                },
              ],
            );
            return;
          }
          if (asset.modelKey === 'camp-cave') {
            const { pigment: record, ...rest } = asset,
              { pigment: record0, ...rest0 } = previous,
              unfiledRecord = ({ url: _u, sha256: _s, bytes: _b, provenance: _p, ...value }) =>
                value;
            assert.deepEqual(payload(rest), payload(rest0), 'the cave model and other images');
            assert.deepEqual(
              unfiledRecord(record),
              unfiledRecord(record0),
              'size, uvSource, history',
            );
            assert.deepEqual(fileIdentity(record), fileIdentity(pigment.output));
            assert.deepEqual(record.provenance[RUNTIME_FIELD], {
              ...record0.provenance[RUNTIME_FIELD],
              adoption: REPACK_ID,
              candidateRevision: REPACK_REVISION,
              supersedes: { adoption: ID, candidateRevision: REVISION, ...fileIdentity(was) },
              adoptedBy: REPACK_ID,
            });
            return;
          }
          assert.deepEqual(
            payload(asset),
            payload(previous),
            `${operation.path} ${asset.modelKey}`,
          );
          if (previous[RUNTIME_FIELD])
            assert.deepEqual(
              [asset[RUNTIME_FIELD].adoption, asset[RUNTIME_FIELD].adoptedBy],
              [REPACK_ID, ID],
              asset.modelKey,
            );
        });
      }

      // Apply: the copies and the rewritten manifests, nothing else.
      await writePlan(root, result);
      assert.deepEqual((await readJson(root, `${REPACK_RECORD}/journal.json`)).base, {
        adoption: ID,
        planSha256: base.planSha256,
      });
      const applied = await applyAdoption(root, REPACK_ID, { rules: RULES });
      assert.equal(applied.status, 'passed', failedChecks(applied));
      for (const name of [
        "the saved manifests are the base adoption's applied bytes",
        "the current runtime still loads the base adoption's standalone images",
        'every file the graph serves',
        'every adopted record serves exactly the planned candidate',
        'cave texture records serve the candidate',
        'every startup actor serves only its startup file',
        'every model whose old LOD was rejected',
        'the evidence of every LOD rejection is unchanged',
      ])
        assert.equal(
          applied.checks.find((item) => item.name.startsWith(name))?.status,
          'passed',
          name,
        );
      assert.deepEqual(
        await snapshot(root, RECORD),
        baseRecord,
        'the base record is never written',
      );
      assert.deepEqual(await snapshot(root, 'assets/optimized-runtime'), revisions);
      const publicAfter = await snapshot(root, 'public');
      assert.deepEqual(
        Object.keys(publicAfter)
          .filter((name) => publicAfter[name] !== publicBefore[name])
          .sort(),
        [...operations.map((operation) => operation.path), ...copies.map((copy) => copy.to)].sort(),
        'only the rewritten manifests and the two copies; every other file stays byte for byte',
      );

      // The build graph: one physical copy serves both tree levels, each from its own scene.
      const shipped = await shippedRecords(root),
        textureRecords = runtimeTextureRecords,
        adoption = await activeAdoption(root, shipped, textureRecords),
        runtime = checkRuntimeGraph(shipped, adoption, { textureRecords, requireAdoption: true });
      assert.equal(adoption.id, REPACK_ID);
      assert.deepEqual(
        runtime.models
          .filter((item) => item.modelKey === 'tree')
          .map((item) => [item.url, item.scene]),
        [
          [packed.output.url, 0],
          [packed.output.url, 1],
        ],
      );
      assert.deepEqual(
        runtime.physicalModels.filter((item) => item.url === packed.output.url),
        [{ ...fileIdentity(packed.output), records: 2 }],
      );
      for (const url of [oldModel.url, oldLod.url, was.url])
        assert.ok(![...runtime.models, ...runtime.textures].some((item) => item.url === url), url);
      const swapped = structuredClone(shipped),
        swappedTree = swapped.find((asset) => asset.modelKey === 'tree');
      [swappedTree.scene, swappedTree.lods[0].scene] = [1, 0];
      assert.throws(
        () => checkRuntimeGraph(swapped, adoption, { textureRecords }),
        /tree: the shipped model files or scenes .* differ from runtime adoption/,
        'a swapped scene is refused although the file and its SHA-256 are unchanged',
      );

      // The base is history until restore returns every manifest to its applied bytes.
      assert.equal((await auditAdoption(root, ID)).status, 'failed');
      await assert.rejects(readServedBase(root, ID, RULES), /no longer exactly its applied ones/);
      const restored = await restoreAdoption(root, REPACK_ID);
      assert.equal(restored.state, 'restored');
      for (const item of base.record.rewrittenManifests)
        assert.ok(
          (await readFile(file(root, item.path))).equals(
            await readFile(file(root, `${RECORD}/after/${item.path}`)),
          ),
          item.path,
        );
      assert.ok(existsSync(file(root, `public${packed.output.url}`)), 'copies stay');
      assert.equal((await auditAdoption(root, ID)).status, 'passed');
      const audit = await auditAdoption(root, REPACK_ID);
      assert.deepEqual([audit.state, audit.status], ['restored', 'passed']);
      assert.equal(
        (await activeAdoption(root, await shippedRecords(root), runtimeTextureRecords)).id,
        ID,
      );
      await readServedBase(root, ID, RULES);
      assert.deepEqual(await snapshot(root, RECORD), baseRecord);
    },
    { behemoth: true, exact: true },
  );
});

test('an exact repack plan fails closed on base drift, a tampered revision, a protected scope or a conflicting copy; apply and restore stop before writing', async () => {
  await withFixture(
    async ({ root, assets, bySource }) => {
      const base = await appliedBase(root),
        { manifest } = await repackRevision(root),
        [packed] = manifest.files,
        oldModel = bySource.get(assets.tree.url).output,
        { refused, tampered, damaged } = planRefusals(root, REPACK_OPTIONS),
        [evidence] = LOD_REJECTIONS['violet-behemoth'].evidence,
        publicBefore = await snapshot(root, 'public');

      // Nothing has a default; no earlier acceptance covers the repack.
      await refused({ adoption: undefined }, /needs a new adoption id/);
      await refused({ adoption: ID }, /needs a new id, not its base's/);
      await refused({ acceptance: undefined }, /own acceptance documents/);
      await refused(
        { acceptance: ACCEPTANCE },
        /accepted earlier candidates of 20991231-r01-a01's chain/,
      );
      // An unknown recipe is never read as another one.
      await damaged(
        `${REPACK_REVISION}/manifest.json`,
        text({ ...manifest, recipe: 'exact-repack@2' }),
        /names the unknown recipe exact-repack@2/,
      );
      // The revision is verified again from disk, against exactly this base.
      await tampered((edited) => {
        edited.base.planSha256 = '0'.repeat(64);
      }, /does not verify against 20991231-r01-a01 now: the base adoption is still applied/);
      await tampered((edited) => {
        const [first, second] = edited.files[0].output.scenes;
        edited.files[0].output.scenes = [second, first];
      }, /model:tree: the record differs from the re-derived one/);
      for (const [scope, pattern] of [
        [
          { ...TREE_AND_CAVE, models: ['tree', 'hero'] },
          /hero is startup-sole-primary; startup actors and rejected LODs keep their bodies/,
        ],
        [
          { ...TREE_AND_CAVE, models: ['tree', 'violet-behemoth'] },
          /violet-behemoth is full-sole-primary; startup actors and rejected LODs keep their bodies/,
        ],
        [
          { ...TREE_AND_CAVE, models: ['tree', 'camp-cave'] },
          /camp-cave's own model is never repacked/,
        ],
        [{ ...TREE_AND_CAVE, packed: [] }, /tree has 2 levels; list it as packed or leave it out/],
        [{ ...TREE_AND_CAVE, images: 3 }, /camp-cave serves 2 adopted images, not 3/],
      ])
        await tampered((edited, report) => {
          edited.scope = scopeRecord(scope);
          report.scope = edited.scope;
        }, pattern);
      await damaged(
        `${REPACK_REVISION}/${packed.output.file}`,
        Buffer.from('not the packed tree'),
        /model:tree: .*differs from its recorded SHA-256\/length/,
      );
      await damaged(
        `${REPACK_REVISION}/models/tree/extra.opt-${'0'.repeat(16)}.glb`,
        glb('extra'),
        /the revision folder holds only recorded files: models\/tree\/extra/,
      );
      // The base must be applied, current and intact, its superseded files archived as recorded.
      await damaged(
        'public/models/octo/asset.json',
        text({ ...assets.octo, notes: ['unrelated edit'] }),
        /no longer exactly its applied ones: public\/models\/octo\/asset\.json changed/,
      );
      await damaged(
        `public${base.graph.models.fox.primary.url}`,
        Buffer.from('not the startup file'),
        /served or original files do not match the plan/,
      );
      await damaged(
        `public${oldModel.url}`,
        Buffer.from('not the served tree'),
        /served or original files do not match the plan/,
      );
      await damaged(
        `${REVISION}/${oldModel.file}`,
        Buffer.from('not the archived r01 candidate'),
        /superseded files are not archived as recorded/,
      );
      await damaged(
        evidence,
        png(64, 64, 'changed evidence'),
        /its LOD rejection evidence changed since 20991231-r01-a01/,
      );
      // A different file under the new hash-named URL is never overwritten.
      await damaged(
        `public${packed.output.url}`,
        Buffer.from('a different file under the same hashed name'),
        /already exists with different content/,
      );
      assert.deepEqual(await snapshot(root, 'public'), publicBefore, 'every refusal wrote nothing');
      assert.equal(existsSync(file(root, REPACK_RECORD)), false);

      // Apply re-plans: drift or a conflicting copy stops it before any write.
      await writePlan(root, await planAdoption(root, REPACK_OPTIONS));
      await refused({}, /already exists; adoption records are never reused/);
      const planned = async (pattern) => {
        await assert.rejects(applyAdoption(root, REPACK_ID, { rules: RULES }), pattern);
        assert.equal((await readJson(root, `${REPACK_RECORD}/journal.json`)).state, 'planned');
      };
      await put(root, 'public/models/octo/asset.json', text({ ...assets.octo, notes: ['edited'] }));
      await planned(/no longer exactly its applied ones/);
      await put(root, 'public/models/octo/asset.json', text(assets.octo));
      const target = `public${packed.output.url}`;
      await put(root, target, 'a different file under the same hashed name');
      await planned(/already exists with different content/);
      await rm(file(root, target));
      assert.deepEqual(await snapshot(root, 'public'), publicBefore);

      // Restore never destroys a later edit: it stops before writing anything.
      assert.equal((await applyAdoption(root, REPACK_ID, { rules: RULES })).status, 'passed');
      const treeManifest = 'public/models/tree/asset.json',
        adopted = await readFile(file(root, treeManifest)),
        appliedState = await snapshot(root, 'public');
      await put(root, treeManifest, text({ ...JSON.parse(adopted), notes: ['a later edit'] }));
      await assert.rejects(
        restoreAdoption(root, REPACK_ID),
        /Restore stopped before writing anything: public\/models\/tree\/asset\.json changed after adoption/,
      );
      assert.equal((await readJson(root, `${REPACK_RECORD}/journal.json`)).state, 'applied');
      await writeFile(file(root, treeManifest), adopted);
      assert.deepEqual(await snapshot(root, 'public'), appliedState);
      assert.equal((await restoreAdoption(root, REPACK_ID)).state, 'restored');
      for (const item of base.record.rewrittenManifests)
        assert.ok(
          (await readFile(file(root, item.path))).equals(
            await readFile(file(root, `${RECORD}/after/${item.path}`)),
          ),
          item.path,
        );
    },
    { behemoth: true, exact: true },
  );
});

test('an exact repack on a chained base carries the chain forward: its replaced tree, the actors, the behemoth and its LOD rejection; the inherited images keep their meaning', async () => {
  await withFixture(
    async (world) => {
      const { root, assets } = world;
      await chainFixture(world);
      await writePlan(root, await planAdoption(root, CHAIN_OPTIONS));
      const chained = await applyAdoption(root, CHAIN_ID, { rules: RULES });
      assert.equal(chained.status, 'passed', failedChecks(chained));
      const chain = await readServedBase(root, CHAIN_ID, RULES),
        chainRecord = await snapshot(root, CHAIN_RECORD),
        baseRecord = await snapshot(root, RECORD),
        { manifest } = await repackRevision(root, { base: CHAIN_ID, scope: CAVE_ONLY }),
        options = { ...REPACK_OPTIONS, base: CHAIN_ID },
        { refused, damaged } = planRefusals(root, options),
        image = manifest.images.find((record) => record.id === `image:${PIGMENT}`),
        was = chain.graph.textures[PIGMENT];
      assert.deepEqual(
        [manifest.files, manifest.scope.only, manifest.base.adoption, manifest.base.base],
        [[], ['camp-cave'], CHAIN_ID, { adoption: ID, planSha256: chain.plan.base.planSha256 }],
      );

      // Neither the chain's nor its base's acceptance covers the repack.
      await refused(
        { acceptance: CHAIN_ACCEPTANCE },
        /accepted earlier candidates of 20991231-r02-a01's chain/,
      );
      await refused(
        { acceptance: ACCEPTANCE },
        /accepted earlier candidates of 20991231-r02-a01's chain/,
      );
      await damaged(
        LOD_REJECTIONS['violet-behemoth'].evidence[0],
        png(64, 64, 'changed evidence'),
        /its LOD rejection evidence changed since 20991231-r02-a01/,
      );
      // The inherited images are re-planned from the chain's complete root against the runtime.
      const module = file(root, 'src/verified-texture.ts'),
        source = await readFile(module, 'utf8');
      await writeFile(module, source.replace("key === 'rockSurface'", "key === 'pigment'"));
      try {
        await refused(
          {},
          /no longer loads the inherited standalone images with the same meaning: .*repeats pigment/,
        );
      } finally {
        await writeFile(module, source);
      }

      const result = await planAdoption(root, options),
        { graph } = result.plan;
      assert.deepEqual(graph.base, {
        adoption: CHAIN_ID,
        planSha256: chain.planSha256,
        candidateRevision: CHAIN_REVISION,
      });
      assert.deepEqual(graph.models, chain.graph.models, 'every model, lineage included');
      assert.deepEqual(
        [graph.keptTextures, graph.notAdopted, graph.lodRejections, graph.decoder],
        [
          chain.graph.keptTextures,
          chain.graph.notAdopted,
          chain.graph.lodRejections,
          chain.graph.decoder,
        ],
      );
      for (const key of ['hero', 'fox'])
        assert.deepEqual(
          [
            graph.models[key].selection,
            graph.models[key].lods,
            graph.models[key].clearedLods.map((lod) => lod.url),
            graph.models[key].adoptedBy,
          ],
          [SELECTION.startup, [], [assets[key].lods[0].url], ID],
          key,
        );
      const behemoth = graph.models['violet-behemoth'];
      assert.deepEqual(
        [behemoth.selection, behemoth.lods, behemoth.farTriangles, behemoth.adoptedBy],
        [SELECTION.full, [], { before: 7965, after: 39825, added: 31860 }, ID],
      );
      assert.deepEqual(
        [graph.models.tree.adoptedBy, graph.models.tree.supersedes.adoption],
        [CHAIN_ID, ID],
        "the chain's own replacement stays as the chain recorded it",
      );
      assert.deepEqual(
        [
          fileIdentity(graph.textures[PIGMENT]),
          graph.textures[PIGMENT].exactOf,
          graph.textures[PIGMENT].supersedes,
        ],
        [
          fileIdentity(image.output),
          fileIdentity(was),
          { adoption: ID, candidateRevision: REVISION, ...fileIdentity(was) },
        ],
      );
      assert.deepEqual(graph.textures[LIMESTONE], chain.graph.textures[LIMESTONE]);
      assert.deepEqual(graph.retired, [...chain.graph.retired, was.url].sort());
      assert.equal(result.plan.runtimeCompatibility.inherited.adoption, ID);

      // Apply, build, restore: the chain is current again, byte for byte.
      await writePlan(root, result);
      const applied = await applyAdoption(root, REPACK_ID, { rules: RULES });
      assert.equal(applied.status, 'passed', failedChecks(applied));
      for (const name of [
        "the saved manifests are the base adoption's applied bytes",
        "the current runtime still loads the base adoption's standalone images",
        'every startup actor serves only its startup file',
        'every model whose old LOD was rejected',
        'the evidence of every LOD rejection is unchanged',
      ])
        assert.equal(
          applied.checks.find((item) => item.name.startsWith(name))?.status,
          'passed',
          name,
        );
      assert.deepEqual(await snapshot(root, CHAIN_RECORD), chainRecord);
      assert.deepEqual(await snapshot(root, RECORD), baseRecord);
      const shipped = await shippedRecords(root),
        adoption = await activeAdoption(root, shipped, runtimeTextureRecords);
      assert.equal(adoption.id, REPACK_ID);
      checkRuntimeGraph(shipped, adoption, {
        textureRecords: runtimeTextureRecords,
        requireAdoption: true,
      });
      const shippedBehemoth = shipped.find((asset) => asset.modelKey === 'violet-behemoth');
      assert.deepEqual(
        [
          shippedBehemoth.url,
          shippedBehemoth.lods ?? [],
          shippedBehemoth[RUNTIME_FIELD].lodRejection.addedFarTriangles,
        ],
        [behemoth.primary.url, [], 31860],
      );
      assert.equal((await restoreAdoption(root, REPACK_ID)).state, 'restored');
      for (const item of chain.record.rewrittenManifests)
        assert.ok(
          (await readFile(file(root, item.path))).equals(
            await readFile(file(root, `${CHAIN_RECORD}/after/${item.path}`)),
          ),
          item.path,
        );
      assert.equal((await auditAdoption(root, CHAIN_ID)).status, 'passed');
      await readServedBase(root, CHAIN_ID, RULES);
      assert.deepEqual(await snapshot(root, CHAIN_RECORD), chainRecord);
    },
    { behemoth: true, exact: true },
  );
});

// The first intended partial revision (texture budget review r15, tiers A-C) against the real
// applied base. Read-only: nothing is planned, generated or written.
const R05_MAPS_512 = Object.freeze([
    'hide-tent',
    'berry-bush',
    'valley-pine',
    'stone-firepit',
    'firewood-pile',
    'firewood-log',
    'drying-rack',
    'stone-axe',
    'wood-footbridge',
    'valley-boulder',
    'orb-bot-white',
    'orb-bot-blue',
    'orb-bot-green',
    'orb-bot-purple',
    'orb-bot-orange',
  ]),
  R05_EDGE_512 = Object.freeze([
    'wooden-spear',
    'obsidian-spear',
    'kunoichi-katana',
    'flint-spear',
  ]);

const R05_SCOPE = Object.freeze([...R05_MAPS_512, ...R05_EDGE_512].sort()),
  R05_EDGES = (uses) =>
    uses.some((use) => R05_EDGE_512.includes(use.modelKey))
      ? { color: 512, normal: 512, data: 512 }
      : MAPS_512;

// After the r05 chain is applied, the chain is the active adoption and its base is history: its
// manifests are no longer current, so readBaseAdoption refuses it. The chain's own audit proves
// the correspondence; its plan, its revision and the base's plan prove the recorded scope.
async function assertActiveR05Chain(id, plan, rules, historical = false) {
  if (!historical) {
    const report = await auditAdoption(REPO_ROOT, id);
    assert.equal(
      report.status,
      'passed',
      JSON.stringify(
        report.checks.filter((item) => item.status === 'failed'),
        null,
        2,
      ),
    );
    for (const name of [
      "the saved manifests are the base adoption's applied bytes",
      "the current runtime still loads the base adoption's standalone images",
      'every file the graph serves',
      'every startup actor serves only its startup file',
      'every model whose old LOD was rejected',
    ])
      assert.equal(
        report.checks.find((item) => item.name.startsWith(name))?.status,
        'passed',
        name,
      );
    await assert.rejects(
      readBaseAdoption(REPO_ROOT, plan.base.adoption, rules),
      /no longer exactly the applied ones/,
    );
  }
  const basePlanBytes = await readFile(file(REPO_ROOT, `${plan.base.directory}/plan.json`)),
    basePlan = JSON.parse(basePlanBytes),
    [revisionFile] = plan.candidateRevision.files,
    revisionBytes = await readFile(file(REPO_ROOT, revisionFile.path)),
    revision = JSON.parse(revisionBytes);
  assert.equal(sha256(basePlanBytes), plan.base.planSha256, 'the base plan is unchanged');
  assert.equal(sha256(revisionBytes), revisionFile.sha256, 'the r05 manifest is unchanged');
  assert.equal(basePlan.candidateRevision.directory, DEFAULT_REVISION, 'the base adopted r04');
  // The recorded scope: the chain, its revision and the revision's base record agree.
  assert.deepEqual(
    [plan.graph.scope, revision.scope.only, revision.policy.maps512, revision.policy.stricter512],
    [R05_SCOPE, R05_SCOPE, [...R05_MAPS_512].sort(), [...R05_EDGE_512].sort()],
  );
  for (const key of [
    'adoption',
    'directory',
    'planSha256',
    'candidateRevision',
    'rewrittenManifests',
  ])
    assert.deepEqual(revision.base[key], plan.base[key], `the revision's base ${key}`);
  for (const key of R05_SCOPE) {
    const entry = plan.graph.models[key],
      was = basePlan.graph.models[key],
      recorded = revision.base.models[key],
      originals = [was.primary.source, ...was.lods.map((lod) => lod.source)].map(fileIdentity),
      superseded = [was.primary, ...was.lods].map(fileIdentity);
    assert.equal(was.selection, SELECTION.ordinary, key);
    assert.deepEqual(
      [entry.selection, entry.candidateRevision, entry.adoptedBy],
      [SELECTION.ordinary, revision.directory, id],
      key,
    );
    // The true originals the base replaced, never its served candidates.
    assert.deepEqual(
      [entry.primary.source, ...entry.lods.map((lod) => lod.source)].map(fileIdentity),
      originals,
      key,
    );
    for (const source of originals) assert.doesNotMatch(source.url, /\.opt-/, source.url);
    assert.deepEqual(recorded.originals, originals, `${key}: the revision's recorded originals`);
    assert.deepEqual(
      [entry.supersedes.primary, ...entry.supersedes.lods].map(fileIdentity),
      superseded,
      key,
    );
    assert.deepEqual(recorded.served, superseded, `${key}: the revision's recorded base files`);
  }
  for (const record of revision.files)
    assert.deepEqual(recordEdges(revision, record), R05_EDGES(record.uses), record.id);
  // Protected entries and images: exactly the base's, apart from their lineage.
  const kept = Object.keys(basePlan.graph.models).filter((key) => !R05_SCOPE.includes(key));
  for (const key of kept) {
    const { candidateRevision, adoptedBy, ...rest } = plan.graph.models[key];
    assert.deepEqual(rest, basePlan.graph.models[key], key);
    assert.deepEqual(
      [candidateRevision, adoptedBy],
      [basePlan.graph.candidateRevision, basePlan.adoption],
      key,
    );
  }
  for (const [url, texture] of Object.entries(basePlan.graph.textures)) {
    const { candidateRevision, adoptedBy, ...rest } = plan.graph.textures[url];
    assert.deepEqual(rest, texture, url);
    assert.deepEqual(
      [candidateRevision, adoptedBy],
      [basePlan.graph.candidateRevision, basePlan.adoption],
      url,
    );
  }
  assert.equal(
    kept.filter((key) => plan.graph.models[key].selection === SELECTION.startup).length,
    7,
  );
  assert.deepEqual(
    [
      plan.graph.models['violet-behemoth'].selection,
      plan.graph.models['violet-behemoth'].primary.triangles,
      plan.graph.models['violet-behemoth'].lods,
    ],
    [SELECTION.full, 39825, []],
  );
  assert.ok(kept.includes('camp-cave'));
}

// After the r06 exact repack is applied on the r05 chain, the repack is active and the chain is
// history. The repack's audit proves the correspondence. Its plan, its revision and the chain's
// plan prove that only the reviewed scope changed, without a decoded change, and that the chain it
// repacked is the r05 chain.
async function assertActiveRepack(id, plan, rules, historical = false) {
  if (!historical) {
    const report = await auditAdoption(REPO_ROOT, id);
    assert.equal(report.status, 'passed', failedChecks(report));
    for (const name of [
      "the saved manifests are the base adoption's applied bytes",
      "the current runtime still loads the base adoption's standalone images",
      'every file the graph serves',
      'every startup actor serves only its startup file',
      'every model whose old LOD was rejected',
      'the evidence of every LOD rejection is unchanged',
    ])
      assert.equal(
        report.checks.find((item) => item.name.startsWith(name))?.status,
        'passed',
        name,
      );
    await assert.rejects(
      readServedBase(REPO_ROOT, plan.base.adoption, rules),
      /no longer exactly its applied ones/,
    );
  }
  const basePlanBytes = await readFile(file(REPO_ROOT, `${plan.base.directory}/plan.json`)),
    basePlan = JSON.parse(basePlanBytes),
    [revisionFile] = plan.candidateRevision.files,
    revisionBytes = await readFile(file(REPO_ROOT, revisionFile.path)),
    revision = JSON.parse(revisionBytes);
  assert.equal(sha256(basePlanBytes), plan.base.planSha256, 'the r05 chain plan is unchanged');
  assert.equal(sha256(revisionBytes), revisionFile.sha256, 'the repack manifest is unchanged');
  assert.ok(basePlan.base, 'the repack sits on the r05 chain');
  await assertActiveR05Chain(basePlan.adoption, basePlan, rules, true);
  assert.deepEqual(basePlan.graph.scope, R05_SCOPE);
  assert.deepEqual(
    [revision.recipe, revision.scope, plan.graph.scope],
    [EXACT_REPACK_RECIPE, scopeRecord(REPACK_SCOPE), scopeRecord(REPACK_SCOPE).only],
  );
  for (const [key, entry] of Object.entries(basePlan.graph.models)) {
    const now = plan.graph.models[key];
    // Outside the scope, or a single-level model none of whose PNGs shrank: exactly the chain's.
    if (now.adoptedBy !== id) {
      assert.ok(!REPACK_SCOPE.packed.includes(key), `${key} is packed`);
      assert.deepEqual(now, entry, `${key} carries forward exactly, lineage included`);
      continue;
    }
    assert.ok(REPACK_SCOPE.models.includes(key), key);
    const levels = [now.primary, ...now.lods],
      was = [entry.primary, ...entry.lods];
    assert.deepEqual(
      [now.selection, now.candidateRevision, levels.length],
      [SELECTION.ordinary, revision.directory, was.length],
      key,
    );
    assert.deepEqual(
      levels.map((level) => [level.source, level.triangles]),
      was.map((level) => [level.source, level.triangles]),
      `${key}: the true originals and every level's triangles`,
    );
    assert.deepEqual(
      [now.supersedes.primary, ...now.supersedes.lods].map(fileIdentity),
      was.map(fileIdentity),
      key,
    );
    if (REPACK_SCOPE.packed.includes(key)) {
      assert.deepEqual(
        levels.map((level) => level.scene),
        levels.map((_, index) => index),
        key,
      );
      assert.equal(new Set(levels.map((level) => level.url)).size, 1, key);
      assert.match(levels[0].url, /\/model-levels\.opt-[0-9a-f]{16}\.glb$/, key);
    } else
      assert.ok(
        levels.every((level) => level.scene === undefined),
        key,
      );
  }
  for (const [url, texture] of Object.entries(basePlan.graph.textures)) {
    const now = plan.graph.textures[url];
    if (now.adoptedBy !== id) {
      assert.deepEqual(now, texture, url);
      continue;
    }
    assert.equal(now.owner, REPACK_SCOPE.imageOwner, url);
    assert.deepEqual(
      unfiled(now),
      unfiled(texture),
      `${url}: size, uvSource, wrap and colour space`,
    );
    assert.deepEqual(now.exactOf, texture.exactOf ?? fileIdentity(texture), url);
    assert.deepEqual(fileIdentity(now.supersedes), fileIdentity(texture), url);
  }
  assert.deepEqual(
    [plan.graph.keptTextures, plan.graph.notAdopted, plan.graph.lodRejections, plan.graph.decoder],
    [
      basePlan.graph.keptTextures,
      basePlan.graph.notAdopted,
      basePlan.graph.lodRejections,
      basePlan.graph.decoder,
    ],
  );
  assert.equal(
    Object.values(plan.graph.models).filter((entry) => entry.selection === SELECTION.startup)
      .length,
    7,
  );
  assert.deepEqual(
    [
      plan.graph.models['violet-behemoth'].selection,
      plan.graph.models['violet-behemoth'].primary.triangles,
      plan.graph.models['violet-behemoth'].lods,
    ],
    [SELECTION.full, 39825, []],
  );
}

test('the intended r05 scope derives from the applied base originals and leaves its actors, behemoth and cave alone', async (t) => {
  const catalog = JSON.parse(await readFile(file(REPO_ROOT, CATALOG), 'utf8')),
    id = catalog.assets.find((asset) => asset[RUNTIME_FIELD])?.[RUNTIME_FIELD].adoption;
  if (!id) return t.skip('no runtime adoption is applied');
  const rules = await loadEligibilityRules(REPO_ROOT),
    active = JSON.parse(
      await readFile(file(REPO_ROOT, `assets/runtime-adoption/${id}/plan.json`), 'utf8'),
    );
  // The r06 exact repack on the r05 chain: the chain it repacked is checked through it.
  if (active.recipe === 'guarded-surface@1') {
    const report = await auditAdoption(REPO_ROOT, id);
    await assertAppliedOrRevisedSource(REPO_ROOT, id, report);
    let base = await assertGuardedHistoryStep(REPO_ROOT, active);
    while (base.recipe === 'guarded-surface@1')
      base = await assertGuardedHistoryStep(REPO_ROOT, base);
    assert.equal(base.recipe, EXACT_REPACK_RECIPE);
    return assertActiveRepack(base.adoption, base, rules, true);
  }
  if (active.recipe === EXACT_REPACK_RECIPE) return assertActiveRepack(id, active, rules);
  if (active.base) return assertActiveR05Chain(id, active, rules);
  // Before the chain: the applied complete adoption is the base r05 derives from.
  const base = await readBaseAdoption(REPO_ROOT, id, rules),
    selection = selectWork(
      base.inventory,
      partial({
        only: [...R05_MAPS_512, ...R05_EDGE_512],
        maps512: R05_MAPS_512,
        edge512: R05_EDGE_512,
      }),
      base,
    );
  assert.equal(selection.chosen.length, 19);
  assert.deepEqual(selection.startup, []);
  for (const model of selection.chosen) {
    const entry = base.graph.models[model.modelKey];
    assert.equal(entry.selection, SELECTION.ordinary, model.modelKey);
    // The originals the base replaced, never its served candidates.
    assert.deepEqual(
      model.files.map(fileIdentity),
      [entry.primary.source, ...entry.lods.map((lod) => lod.source)].map(fileIdentity),
      model.modelKey,
    );
    for (const source of model.files) assert.doesNotMatch(source.url, /\.opt-/, source.url);
  }
  for (const item of selection.files) assert.deepEqual(item.edges, R05_EDGES(item.uses), item.url);
  // The chain would inherit the base's cave images: the current runtime must still load them
  // with the meaning r04 planned (the same gate the chained plan, apply and audit run).
  const inherited = await inheritedImageCompatibility(REPO_ROOT, base.record, base.graph);
  assert.deepEqual(inherited.problems, []);
  assert.equal(inherited.record.images.length, 10);
  const actors = Object.entries(base.graph.models)
    .filter(([, entry]) => entry.selection === SELECTION.startup)
    .map(([key]) => key);
  assert.equal(actors.length, 7);
  for (const key of actors)
    assert.throws(
      () => selectWork(base.inventory, partial({ only: [key] }), base),
      /startup actor/,
      key,
    );
  assert.throws(
    () => selectWork(base.inventory, partial({ only: ['violet-behemoth'] }), base),
    /sole primary/,
  );
  assert.throws(
    () => selectWork(base.inventory, partial({ only: ['camp-cave'] }), base),
    /standalone runtime images/,
  );
});

test('the accepted r04 revision proves its contract graph and any explicitly reviewed source successor', async () => {
  const catalog = JSON.parse(await readFile(file(REPO_ROOT, CATALOG), 'utf8')),
    applied = catalog.assets.find((asset) => asset[RUNTIME_FIELD])?.[RUNTIME_FIELD].adoption;
  if (applied) {
    // The active adoption: r04's own, or a chain that inherits r04's graph (its audit checks the
    // base record; the base's own audit then reports its manifests as history).
    const report = await auditAdoption(REPO_ROOT, applied);
    await assertAppliedOrRevisedSource(REPO_ROOT, applied, report);
    const active = JSON.parse(
        await readFile(file(REPO_ROOT, `assets/runtime-adoption/${applied}/plan.json`), 'utf8'),
      ),
      index = JSON.parse(
        await readFile(file(REPO_ROOT, `${DEFAULT_REVISION}/runtime-index.json`), 'utf8'),
      ),
      { graph } = active;
    // The chain's complete root (r04's adoption), through every recorded base plan.
    let origin = active;
    while (origin.base) {
      if (origin.recipe === 'guarded-surface@1') await assertGuardedHistoryStep(REPO_ROOT, origin);
      const bytes = await readFile(file(REPO_ROOT, `${origin.base.directory}/plan.json`));
      assert.equal(sha256(bytes), origin.base.planSha256, `${origin.adoption}: its base plan`);
      origin = JSON.parse(bytes);
    }
    assert.equal(origin.candidateRevision.directory, DEFAULT_REVISION);
    if (active.base) assert.deepEqual(report.base?.adoption, active.base.adoption);
    // r04's startup identities remain in the checked history. The active graph still serves
    // seven sole-primary actors, the unchanged behemoth and the same cave images.
    const actors = Object.entries(graph.models).filter(
      ([, entry]) => entry.selection === SELECTION.startup,
    );
    assert.deepEqual(actors.map(([key]) => key).sort(), Object.keys(index.startupActors).sort());
    for (const [key, entry] of actors) {
      assert.equal(origin.graph.models[key].primary.url, index.startupActors[key].url, key);
      assert.deepEqual(entry.startup.url, entry.primary.url, key);
      assert.deepEqual(entry.clearedLods, origin.graph.models[key].clearedLods, key);
      assert.deepEqual(entry.lods, [], key);
    }
    const behemoth = graph.models['violet-behemoth'];
    assert.deepEqual(
      [behemoth.selection, behemoth.primary.url, behemoth.lods],
      [SELECTION.full, index.files['/models/violet-behemoth/model-c2.glb'].url, []],
    );
    assert.deepEqual(Object.keys(graph.textures).sort(), Object.keys(index.textures).sort());
    // An exact repack serves a lossless rewrite of r04's image (`exactOf`), at its size and UVs.
    for (const [url, texture] of Object.entries(graph.textures))
      assert.deepEqual(
        [(texture.exactOf ?? texture).url, texture.uvSource],
        [index.textures[url].url, index.textures[url].uvSource],
        url,
      );
    return;
  }
  const { plan } = await planAdoption(REPO_ROOT),
    index = JSON.parse(
      await readFile(file(REPO_ROOT, `${DEFAULT_REVISION}/runtime-index.json`), 'utf8'),
    ),
    actors = Object.entries(plan.graph.models).filter(
      ([, entry]) => entry.selection === SELECTION.startup,
    );
  assert.deepEqual(actors.map(([key]) => key).sort(), Object.keys(index.startupActors).sort());
  assert.equal(actors.length, 7);
  for (const [key, entry] of actors) {
    assert.equal(entry.primary.url, index.startupActors[key].url);
    assert.deepEqual(entry.lods, []);
    assert.ok(entry.clearedLods.length > 0, key);
    for (const lod of entry.clearedLods)
      for (const url of [lod.url, lod.candidate]) assert.ok(plan.graph.retired.includes(url), url);
  }
  assert.deepEqual(
    actors
      .filter(([, entry]) => entry.identicalFullCandidate)
      .map(([key]) => key)
      .sort(),
    ['desert-fennec-mage', 'giant-ape'],
  );
  assert.deepEqual(Object.keys(plan.graph.textures).sort(), Object.keys(index.textures).sort());
  for (const [url, texture] of Object.entries(plan.graph.textures)) {
    assert.equal(texture.url, index.textures[url].url);
    assert.deepEqual(texture.uvSource, index.textures[url].uvSource);
  }
  assert.ok(!Object.keys(plan.graph.models).some((key) => key.startsWith('maruimo')));
  // r04 recorded the direct reads; today's verified loader re-plans every image identically
  // apart from those two descriptors (planAdoption refuses anything else).
  const { images: compatible } = plan.runtimeCompatibility;
  assert.equal(compatible.length, 10);
  for (const image of compatible) {
    assert.match(
      image.recorded.runtimeEntry,
      /^(?:template\.asset\.\w+|CAVE_EXTRA_PIGMENTS\.\w+)\.url$/,
      image.id,
    );
    assert.match(
      image.current.runtimeEntry,
      /^caveImageRecords\(template\.asset\)\.\w+$/,
      image.id,
    );
  }
  // Native review addendum: violet-behemoth's old far LOD is rejected; its full candidate is served.
  const behemoth = plan.graph.models['violet-behemoth'],
    behemothLod = '/models/violet-behemoth/lod-c2.glb';
  assert.deepEqual(
    Object.entries(plan.graph.models)
      .filter(([, entry]) => entry.selection === SELECTION.full)
      .map(([key]) => key),
    ['violet-behemoth'],
  );
  assert.equal(plan.graph.lodRejections['violet-behemoth'], 'applied');
  assert.equal(behemoth.primary.url, index.files['/models/violet-behemoth/model-c2.glb'].url);
  assert.equal(behemoth.primary.sha256, index.files['/models/violet-behemoth/model-c2.glb'].sha256);
  assert.deepEqual(behemoth.lods, []);
  assert.deepEqual(behemoth.farTriangles, { before: 7965, after: 39825, added: 31860 });
  for (const url of [behemothLod, index.files[behemothLod].url])
    assert.ok(plan.graph.retired.includes(url), url);
  for (const evidence of behemoth.lodRejection.evidence)
    assert.match(evidence.sha256, /^[0-9a-f]{64}$/);
  const actorKeys = new Set(Object.keys(index.startupActors)),
    expected = [
      ...new Set([
        ...Object.entries(index.files)
          .filter(([source]) => !actorKeys.has(source.split('/')[2]) && source !== behemothLod)
          .map(([, candidate]) => candidate.url),
        ...Object.values(index.startupActors).map((actor) => actor.url),
        ...Object.values(index.textures).map((texture) => texture.url),
      ]),
    ].sort();
  assert.deepEqual(
    plan.operations.copies.map((copy) => copy.url),
    expected,
  );
});
