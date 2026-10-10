// guarded-surface@1 (scripts/optimization/guarded-surface.mjs, guarded-adoption.mjs) on an isolated
// temp repository with an applied base adoption (tests/fixtures/guarded/base.mjs) and r04-shaped
// proof outputs written by the fixture (tests/fixtures/guarded/proof.mjs). No ignored output/
// artifact of the real repository is read.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { runtimeTextureRecords } from '../scripts/environment-assets.mjs';
import {
  applyAdoption,
  auditAdoption,
  planAdoption,
  restoreAdoption,
  SELECTION,
  writePlan,
} from '../scripts/optimization/adoption.mjs';
import { rewriteChainedManifestBytes } from '../scripts/optimization/chained-adoption.mjs';
import {
  EXACT_REPACK_RECIPE,
  GUARDED_RECIPE,
  runtimeIndexOf,
} from '../scripts/optimization/contract.mjs';
import { parseGlb, sha256 } from '../scripts/optimization/glb.mjs';
import {
  collectGarbage,
  packPlain,
  replacePrimitive,
} from '../scripts/optimization/guarded/document.mjs';
import {
  budgetProblems,
  checkCandidate,
  generateGuardedRevision,
  guardedTargets,
  verifyGuardedRevision,
  worstOf,
} from '../scripts/optimization/guarded-surface.mjs';
import { readServedBase } from '../scripts/optimization/served-base.mjs';
import { RUNTIME_FIELD, activeAdoption, checkRuntimeGraph } from '../scripts/runtime-graph.mjs';
import { parseAccept } from '../scripts/optimize-guarded-assets.mjs';
import {
  BASE_ACCEPTANCE,
  BASE_ID,
  RULES,
  appliedBase,
  file,
  put,
  text,
} from './fixtures/guarded/base.mjs';
import { IMPLEMENTATION_FILES, reduceServed, writeProof } from './fixtures/guarded/proof.mjs';

const GUARDED_REVISION = 'assets/optimized-runtime/20991231-g01',
  GUARDED_ID = '20991231-g01-a01',
  ACCEPTANCE = ['output/review/guarded-g01.md'],
  RECORD = `assets/runtime-adoption/${GUARDED_ID}`,
  // The real proofs came as two complete runs; the fixture does the same by default.
  GROUPS = [['tree'], ['hero']],
  PLAN = {
    revision: GUARDED_REVISION,
    adoption: GUARDED_ID,
    base: BASE_ID,
    acceptance: ACCEPTANCE,
    rules: RULES,
  };
const readJson = async (root, relative) => JSON.parse(await readFile(file(root, relative), 'utf8'));
const identity = ({ url, sha256: digest, bytes }) => ({ url, sha256: digest, bytes });
const proofDir = (index) => `output/proof-fixture-${index + 1}`;

async function snapshot(root, directory) {
  const found = {},
    visit = async (relative) => {
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

async function withBase(run) {
  const world = await appliedBase();
  try {
    await run(world);
  } finally {
    await rm(world.root, { recursive: true, force: true });
  }
}

/**
 * The proofs of the applied base, one complete summary per group of keys, and a generate() for
 * them with explicit overrides. `targets` replaces a key's reduction; `edit(evidence, variant, key)`
 * and `summaryEdit(summary, index)` change the output before it is hashed.
 */
async function prove(world, { groups = GROUPS, targets = {}, edit, summaryEdit = () => {} } = {}) {
  const base = await readServedBase(world.root, BASE_ID, RULES),
    proofs = [];
  for (const [index, keys] of groups.entries())
    proofs.push(
      await writeProof(
        world.root,
        keys.map((key) => targets[key] ?? { key, record: base.graph.models[key].primary }),
        { dir: proofDir(index), edit, summaryEdit: (summary) => summaryEdit(summary, index) },
      ),
    );
  const digest = proofs[0].digest,
    summaries = proofs.map((proof) => proof.summaryPath),
    accept = Object.assign({}, ...proofs.map((proof) => proof.accept)),
    generate = (extra = {}) =>
      generateGuardedRevision(world.root, {
        base: BASE_ID,
        basePlanSha256: base.planSha256,
        summaries,
        implementation: digest,
        accept,
        out: GUARDED_REVISION,
        rules: RULES,
        ...extra,
      });
  return { base, proofs, summaries, digest, accept, generate };
}

/** Generate, verify and record the report, as optimize-guarded-assets.mjs generate/verify --write-report do. */
async function generated(world, options) {
  const run = await prove(world, options);
  await run.generate();
  const report = await verifyGuardedRevision(world.root, GUARDED_REVISION, {
    base: BASE_ID,
    rules: RULES,
    implementation: run.digest,
  });
  assert.equal(
    report.status,
    'passed',
    JSON.stringify(
      [...report.checks, ...report.files].filter((item) => item.status !== 'passed'),
      null,
      2,
    ),
  );
  await put(world.root, `${GUARDED_REVISION}/verification.json`, text(report));
  await put(
    world.root,
    ACCEPTANCE[0],
    'guarded g01 accepted after native review of the exact candidates\n',
  );
  return {
    ...run,
    report,
    manifest: await readJson(world.root, `${GUARDED_REVISION}/manifest.json`),
  };
}

test('a guarded primary adoption from two complete proofs replaces only the listed primaries, keeps every LOD, texture and other entry, and restores the base byte for byte', async () => {
  await withBase(async (world) => {
    const { root } = world,
      run = await prove(world),
      publicBefore = await snapshot(root, 'public'),
      baseRecord = await snapshot(root, `assets/runtime-adoption/${BASE_ID}`),
      base = run.base;
    // Dry run: nothing is created.
    const dry = await run.generate({ dryRun: true });
    assert.deepEqual([dry.dryRun, dry.keys], [true, ['hero', 'tree']]);
    assert.equal(existsSync(file(root, GUARDED_REVISION)), false);
    assert.deepEqual((await readdir(file(root, 'assets/optimized-runtime'))).sort(), [
      '20991231-r01',
    ]);
    // Generate, verify, plan.
    const { manifest } = await generated(world),
      records = Object.fromEntries(manifest.files.map((record) => [record.modelKey, record]));
    assert.deepEqual(
      [manifest.recipe, manifest.scope],
      [GUARDED_RECIPE, { complete: false, only: ['hero', 'tree'], models: ['hero', 'tree'] }],
    );
    assert.deepEqual(
      runtimeIndexOf(manifest),
      await readJson(root, `${GUARDED_REVISION}/runtime-index.json`),
    );
    // Each original summary is archived byte for byte, with its provenance and the keys it supplies.
    assert.deepEqual(
      manifest.proof.summaries.map((item) => [item.file, item.from, item.keys]),
      [
        ['proof/summary-1.json', `${proofDir(0)}/summary.json`, ['tree']],
        ['proof/summary-2.json', `${proofDir(1)}/summary.json`, ['hero']],
      ],
    );
    for (const item of manifest.proof.summaries)
      assert.ok(
        (await readFile(file(root, `${GUARDED_REVISION}/${item.file}`))).equals(
          await readFile(file(root, item.from)),
        ),
        item.file,
      );
    assert.deepEqual(
      [records.tree.proof.summary, records.hero.proof.summary],
      ['proof/summary-1.json', 'proof/summary-2.json'],
    );
    for (const record of manifest.files) {
      assert.equal(record.verification.status, 'passed');
      assert.ok(
        record.verification.triangles.candidate < record.verification.triangles.source,
        record.id,
      );
    }
    // The unchanged LOD is archived with the same bytes, never as a public copy.
    const lod = base.graph.models.tree.lods[0];
    assert.deepEqual(records.tree.lineageArchive, [{ file: lod.url.slice(1), ...identity(lod) }]);
    assert.equal(
      sha256(await readFile(file(root, `${GUARDED_REVISION}/${lod.url.slice(1)}`))),
      lod.sha256,
    );
    assert.deepEqual(
      await snapshot(root, 'public'),
      publicBefore,
      'generation writes nothing public',
    );
    const result = await planAdoption(root, PLAN),
      { graph } = result.plan;
    assert.deepEqual(await snapshot(root, 'public'), publicBefore, 'planning only reads');
    assert.deepEqual(
      [graph.recipe, graph.base.adoption, graph.scope],
      [GUARDED_RECIPE, BASE_ID, ['hero', 'tree']],
    );
    // Ordinary model: only the primary changes; the LOD record is the base's, exactly.
    const tree = graph.models.tree;
    assert.deepEqual(identity(tree.primary), identity(records.tree.output));
    assert.deepEqual(tree.lods, base.graph.models.tree.lods);
    assert.deepEqual(
      tree.primary.source,
      base.graph.models.tree.primary.source,
      'the true original stays',
    );
    assert.deepEqual(tree.supersedes.primary, {
      ...identity(base.graph.models.tree.primary),
      triangles: base.graph.models.tree.primary.triangles,
    });
    // Startup actor: new primary, no LOD, the same cleared LODs, the preceding startup facts kept.
    const hero = graph.models.hero,
      was = base.graph.models.hero;
    assert.equal(hero.selection, SELECTION.startup);
    assert.deepEqual([hero.lods, hero.clearedLods], [[], was.clearedLods]);
    assert.deepEqual(
      [hero.startup.url, hero.startup.sha256, hero.startup.bytes],
      [records.hero.output.url, records.hero.output.sha256, records.hero.output.bytes],
    );
    assert.deepEqual(
      [hero.startup.geometrySource, hero.startup.fullSource],
      [was.startup.geometrySource, was.startup.fullSource],
    );
    assert.deepEqual(hero.supersedes.startup, was.startup);
    assert.deepEqual(hero.farTriangles, {
      before: was.farTriangles.before,
      after: records.hero.output.triangles,
      added: records.hero.output.triangles - was.farTriangles.before,
    });
    // Everything else: the base's, with its lineage named.
    const lineage = (record) => ({
      ...record,
      candidateRevision: record.candidateRevision ?? base.graph.candidateRevision,
      adoptedBy: record.adoptedBy ?? BASE_ID,
    });
    assert.deepEqual(Object.keys(graph.models).sort(), Object.keys(base.graph.models).sort());
    for (const key of Object.keys(base.graph.models).filter(
      (item) => item !== 'tree' && item !== 'hero',
    ))
      assert.deepEqual(graph.models[key], lineage(base.graph.models[key]), key);
    assert.deepEqual(Object.keys(graph.textures).sort(), Object.keys(base.graph.textures).sort());
    for (const [url, texture] of Object.entries(base.graph.textures))
      assert.deepEqual(graph.textures[url], lineage(texture), url);
    assert.deepEqual(
      [graph.keptTextures, graph.lodRejections, graph.decoder],
      [base.graph.keptTextures, base.graph.lodRejections, base.graph.decoder],
    );
    // Copies: the two new primaries only; retired: the two superseded primaries.
    assert.deepEqual(
      result.plan.operations.copies.map((copy) => copy.url),
      [records.hero.output.url, records.tree.output.url].sort(),
    );
    assert.deepEqual(
      graph.retired,
      [...(base.graph.retired ?? []), was.primary.url, base.graph.models.tree.primary.url].sort(),
    );
    const archivedFrom = (url) => `${base.graph.candidateRevision}/${url.slice(1)}`;
    assert.deepEqual(
      graph.retiredCandidates.slice(0, -2),
      base.graph.retiredCandidates ?? [],
      "the base's retired candidates stay",
    );
    assert.deepEqual(
      graph.retiredCandidates
        .slice(-2)
        .map((item) => [item.modelKey, item.role, item.url, item.from])
        .sort(),
      [
        ['hero', 'startup', was.primary.url, archivedFrom(was.primary.url)],
        [
          'tree',
          'model',
          base.graph.models.tree.primary.url,
          archivedFrom(base.graph.models.tree.primary.url),
        ],
      ],
    );
    // Apply, audit, build graph.
    await writePlan(root, result);
    const applied = await applyAdoption(root, GUARDED_ID, { rules: RULES });
    assert.equal(
      applied.status,
      'passed',
      JSON.stringify(
        applied.checks.filter((item) => item.status !== 'passed'),
        null,
        2,
      ),
    );
    assert.equal((await auditAdoption(root, GUARDED_ID)).status, 'passed');
    assert.deepEqual(
      await snapshot(root, `assets/runtime-adoption/${BASE_ID}`),
      baseRecord,
      'the base record is never written',
    );
    const treeAsset = await readJson(root, 'public/models/tree/asset.json'),
      heroAsset = await readJson(root, 'public/models/hero/asset.json');
    assert.deepEqual(identity(treeAsset), identity(records.tree.output));
    assert.deepEqual(identity(treeAsset.lods[0]), identity(lod), 'the LOD is served unchanged');
    assert.deepEqual([identity(heroAsset), heroAsset.lods], [identity(records.hero.output), []]);
    assert.deepEqual(
      identity(heroAsset[RUNTIME_FIELD].startupCandidate),
      identity(records.hero.output),
      'the stamp names the startup file served now',
    );
    assert.equal(heroAsset[RUNTIME_FIELD].adoption, GUARDED_ID);
    const catalog = await readJson(root, 'public/models/world-assets.json'),
      shipped = [...catalog.assets, heroAsset],
      adoption = await activeAdoption(root, shipped, runtimeTextureRecords);
    assert.equal(adoption.id, GUARDED_ID);
    checkRuntimeGraph(shipped, adoption, {
      textureRecords: runtimeTextureRecords,
      requireAdoption: true,
    });
    // Restore: exactly the base's applied manifest bytes.
    assert.equal((await restoreAdoption(root, GUARDED_ID)).state, 'restored');
    for (const item of base.record.rewrittenManifests)
      assert.ok(
        (await readFile(file(root, item.path))).equals(
          await readFile(file(root, `assets/runtime-adoption/${BASE_ID}/after/${item.path}`)),
        ),
        item.path,
      );
    assert.equal((await auditAdoption(root, BASE_ID)).status, 'passed');
    await readServedBase(root, BASE_ID, RULES);
  });
});

test('the scope is explicit and refuses coupled, packed, rejected, shared and out-of-graph models', () => {
  const entry = (url, extra = {}) => ({
      selection: SELECTION.ordinary,
      primary: { url, sha256: 'a'.repeat(64), bytes: 1 },
      lods: [],
      ...extra,
    }),
    fake = (models, users = {}) => ({
      id: 'fake',
      graph: { models },
      current: {
        models: Object.keys(models).map((key) => ({ modelKey: key, eligible: true })),
        files: new Map(
          Object.entries(models).map(([key, item]) => [
            item.primary.url,
            { uses: (users[key] ?? [key]).map((modelKey) => ({ modelKey })) },
          ]),
        ),
      },
    }),
    refused = (base, keys, pattern) => assert.throws(() => guardedTargets(base, keys), pattern);
  const base = fake({ tree: entry('/models/tree/model.opt-0000000000000000.glb') });
  refused(base, [], /explicit, non-empty list/);
  refused(base, ['tree', 'tree'], /listed twice/);
  for (const key of [
    'camp-cave',
    'camp-mountain',
    'valley-castle',
    'glacier-spires',
    'volcanic-cone',
    'desert-cactus',
    'volcanic-basalt-columns',
    'meadow-ground',
    'snow-ground',
    'desert-ground',
    'ice-ground',
    'volcanic-ground',
    'river-water',
    'lake-water',
  ])
    refused(
      fake({ [key]: entry(`/models/${key}/model.glb`) }),
      [key],
      /collision-, footprint- or fit-coupled/,
    );
  refused(base, ['grass'], /not a model of base adoption fake/);
  refused(
    fake({
      'violet-behemoth': entry('/models/violet-behemoth/model.glb', { selection: SELECTION.full }),
    }),
    ['violet-behemoth'],
    /LOD rejection; it is not supported/,
  );
  refused(
    fake({
      rock: entry('/models/rock/model-levels.opt-0000000000000000.glb', {
        primary: { url: '/models/rock/x.glb', sha256: 'a'.repeat(64), bytes: 1, scene: 0 },
        lods: [{ url: '/models/rock/x.glb', scene: 1 }],
      }),
    }),
    ['rock'],
    /packed template/,
  );
  refused(
    fake({ tree: entry('/models/tree/model.glb') }, { tree: ['tree', 'bush'] }),
    ['tree'],
    /delivered by tree, bush, not only tree/,
  );
  assert.deepEqual(
    guardedTargets(base, ['tree']).map((target) => [target.key, target.startup]),
    [['tree', false]],
  );
  assert.throws(() => parseAccept(''), /scope is never implicit/);
  assert.throws(
    () => parseAccept(`tree=${'a'.repeat(64)},tree=${'b'.repeat(64)}`),
    /accepted twice/,
  );
  assert.throws(() => parseAccept('tree=abc'), /not key=<64 hex sha256>/);
});

test('stale bases, wrong or changed implementations, incomplete or inconsistent summaries, failed variants and unreviewed candidates are refused before anything is written', async () => {
  await withBase(async (world) => {
    const { root } = world,
      refuse = async (options, extra, pattern) => {
        const run = await prove(world, options);
        await assert.rejects(
          run.generate(typeof extra === 'function' ? extra(run) : extra),
          pattern,
        );
        assert.equal(existsSync(file(root, GUARDED_REVISION)), false);
      };
    await refuse({}, { basePlanSha256: '0'.repeat(64) }, /, not the stated 0{64}/);
    await refuse({}, { implementation: 'f'.repeat(64) }, /is not the expected f{64}/);
    await refuse(
      {},
      (run) => ({ accept: { ...run.accept, tree: 'e'.repeat(64) } }),
      /is not the reviewed e{64}/,
    );
    await refuse({}, { accept: {} }, /explicit reviewed candidates/);
    await refuse({}, { summaries: [] }, /at least one explicit, complete proof summary/);
    await refuse(
      { summaryEdit: (summary) => (summary.implementationAfterRun.changedDuringRun = true) },
      {},
      /changed during the proof run/,
    );
    await refuse(
      {
        summaryEdit: (summary, i) =>
          i === 1 && (summary.implementationAfterRun.digest = 'd'.repeat(64)),
      },
      {},
      /changed during the proof run/,
    );
    await refuse(
      { summaryEdit: (summary) => (summary.policy.pose.clips = 'first 6') },
      {},
      /not a full-coverage guarded-body run/,
    );
    await refuse(
      { summaryEdit: (summary) => (summary.policy.pose.surfaceStride = 2) },
      {},
      /not a full-coverage/,
    );
    await refuse(
      { summaryEdit: (summary) => (summary.policy.pose = null) },
      {},
      /not a full-coverage/,
    );
    await refuse(
      { summaryEdit: (summary) => (summary.policy.overrides = { tree: { errorMetres: 0.008 } }) },
      {},
      /not a full-coverage/,
    );
    await refuse(
      {
        summaryEdit: (summary) =>
          (summary.policy.variants['guarded-head-back'] = { kind: 'diagnostic' }),
      },
      {},
      /not a full-coverage/,
    );
    await refuse(
      { summaryEdit: (summary) => (summary.policy.gates.maxMultiple = 7) },
      {},
      /not a full-coverage/,
    );
    await refuse(
      { summaryEdit: (summary) => (summary.tool = 'proof-lowpoly-high-r02') },
      {},
      /is proof-lowpoly-high-r02/,
    );
    await refuse(
      { edit: (_, variant) => (variant.status = 'budget-not-met') },
      {},
      /proof status is budget-not-met/,
    );
    await refuse(
      { edit: (_, variant) => (variant.variant = 'guarded-head-back') },
      {},
      /no guarded-body result/,
    );
    await refuse(
      { edit: (evidence, variant) => evidence.variants.push(structuredClone(variant)) },
      {},
      /records 2 guarded-body results/,
    );
    await refuse(
      { edit: (evidence) => (evidence.served.sha256 = '0'.repeat(64)) },
      {},
      /the proof was made from/,
    );
    await refuse(
      { edit: (evidence) => delete evidence.coupling },
      {},
      /coupled geometry \(or records no coupling verdict\)/,
    );
    await refuse(
      { edit: (evidence) => (evidence.levels.oldLodsUsed = true) },
      {},
      /old LODs or a packed scene/,
    );
    await refuse(
      { edit: (_, variant) => (variant.storage.alternatives[0].belowSourceGzip = false) },
      {},
      /no storage within both budgets/,
    );
    // Several summaries: one policy, disjoint keys, each used.
    await refuse(
      { groups: [['tree'], ['tree', 'hero']] },
      {},
      /tree appears in more than one proof summary/,
    );
    await refuse(
      { summaryEdit: (summary, i) => i === 1 && (summary.policy.pose.scope = 'another scope') },
      {},
      /do not share one policy/,
    );
    await refuse(
      { groups: [['tree', 'hero'], ['tree']] },
      (run) => ({ summaries: [run.summaries[0], run.summaries[0]] }),
      /is named twice/,
    );
    await refuse(
      { groups: [['tree'], ['hero']] },
      (run) => ({ accept: { tree: run.accept.tree } }),
      /supplies no accepted key/,
    );
    await refuse(
      { groups: [['tree']] },
      (run) => ({ accept: { ...run.accept, hero: 'a'.repeat(64) } }),
      /hero: no proof summary has a result for it/,
    );
    // An implementation file changed on disk after the run.
    const run = await prove(world);
    await writeFile(file(root, IMPLEMENTATION_FILES[0]), '// changed\n');
    await assert.rejects(run.generate(), /implementation file .*proof-lowpoly-high-r04\.mjs/);
  });
});

test('posed evidence fails closed: altered, missing or inconsistent numbers, coverage, clips and labels are refused with refreshed hashes', async () => {
  await withBase(async (world) => {
    const { root } = world,
      // Edit the animated startup actor's evidence (one scene, one instance, rest + walk@0.33 + walk@0.66).
      refuse = async (change, pattern) => {
        const run = await prove(world, {
          edit: (evidence, variant, key) =>
            key === 'hero' &&
            change(
              variant,
              variant.poses.primitives[0].instances[0],
              variant.poses.scenes[0],
              evidence,
            ),
        });
        await assert.rejects(run.generate(), pattern);
        assert.equal(existsSync(file(root, GUARDED_REVISION)), false);
      };
    // Measurements: finite, nonnegative, present, complete counts, regions covering every sample.
    await refuse(
      (_, instance) => (instance.poses[1].holes.all.max = null),
      /holes all: not a complete finite, nonnegative measurement/,
    );
    await refuse(
      (_, instance) => (instance.poses[0].interiors.static.p99 = -0.001),
      /interiors static: not a complete finite, nonnegative measurement/,
    );
    await refuse(
      (_, instance) => delete instance.poses[0].interiors.static.mean,
      /interiors static: not a complete finite/,
    );
    await refuse((_, instance) => delete instance.poses[2].webbing, /no webbing measurement/);
    await refuse((_, instance) => {
      instance.poses[0].holes.all.count -= 1;
      instance.poses[0].holes.static.count -= 1;
    }, /holes: \d+ samples, the stride-1 proof has \d+/);
    await refuse(
      (_, instance) => (instance.poses[0].webbing.static.count -= 1),
      /webbing: its regions cover/,
    );
    await refuse(
      (variant) => (variant.primitives[0].locks.lockedVertices = 3),
      /0 locked hole sample\(s\), the plan locks 3/,
    );
    // The fixed gate on every pose, and worst statistics exactly those of the poses.
    await refuse(
      (_, instance) => (instance.poses[1].webbing.static.max = 0.03),
      /webbing static: p99 .* exceed the fixed world gate/,
    );
    await refuse(
      (_, instance) => (instance.worst.holes.all.max = 0),
      /worst statistics are not those of its poses/,
    );
    await refuse(
      (_, instance) => (instance.gateMetres = { p99: 0.016, max: 0.048 }),
      /recorded gate is not the fixed world gate/,
    );
    await refuse(
      (variant) => (variant.primitives[0].settings.localErrorMetres = 0.005),
      /body reduction at 0.004 m with the fixed world gate/,
    );
    await refuse(
      (variant) => (variant.primitives[0].settings.worldGateMetres = { p99: 0.016, max: 0.048 }),
      /body reduction at 0.004 m/,
    );
    // Coverage: exactly the source's scenes, primitives, instances, slots.
    await refuse(
      (variant) => variant.poses.scenes.push(structuredClone(variant.poses.scenes[0])),
      /not exactly the source's 1/,
    );
    await refuse(
      (variant) => variant.poses.primitives.push(structuredClone(variant.poses.primitives[0])),
      /are not exactly the reduced/,
    );
    await refuse((_, instance) => (instance.skin = 0), /path or skin is not the source's/);
    await refuse((_, __, scene) => {
      scene.primitiveInstances = 3;
      scene.slotIdentity = '3 of 3 slot(s) identified by exact positions and indices';
    }, /mesh slot/);
    // Clips, applicable channels from the source, pose labels.
    await refuse((_, instance, scene) => {
      scene.clips = [];
      scene.clipTracks = [];
      scene.poses = ['rest'];
      instance.poses = instance.poses.slice(0, 1);
      instance.worst = worstOf(instance.poses);
    }, /not every delivered clip was posed/);
    await refuse(
      (_, __, scene) =>
        (scene.clipTracks[0] = {
          clip: 'walk',
          applicableChannels: 0,
          appliedTracksSource: 0,
          appliedTracksCandidate: 0,
        }),
      /the source has 1 applicable channel\(s\); recorded 0, applied 0\/0/,
    );
    await refuse(
      (_, __, scene) =>
        (scene.clipTracks[0] = {
          clip: 'walk',
          applicableChannels: 2,
          appliedTracksSource: 2,
          appliedTracksCandidate: 2,
        }),
      /the source has 1 applicable channel\(s\); recorded 2/,
    );
    await refuse(
      (_, __, scene) => (scene.clipTracks[0].appliedTracksCandidate = 0),
      /the source has 1 applicable channel\(s\); recorded 1, applied 1\/0/,
    );
    await refuse(
      (_, __, scene) => (scene.clipTracks[0].appliedTracksSource = null),
      /applicable channel/,
    );
    await refuse((_, instance) => {
      instance.poses.pop();
      instance.worst = worstOf(instance.poses);
    }, /are not its scene's 3/);
    await refuse(
      (_, __, scene) => (scene.poses = ['rest', 'walk@0.25', 'walk@0.66']),
      /not exactly the 3 of rest and every delivered clip/,
    );
  });
});

test('altered vertices, indices or images are refused even when every hash and digest is refreshed', async () => {
  await withBase(async (world) => {
    const { root } = world,
      base = await readServedBase(root, BASE_ID, RULES),
      record = base.graph.models.tree.primary,
      attempt = async (target, pattern) => {
        const run = await prove(world, { targets: { tree: { key: 'tree', record, ...target } } });
        await assert.rejects(run.generate(), pattern);
      },
      alter = async (pick) => {
        const reduction = await reduceServed(root, record),
          doc = parseGlb(reduction.candidate, 'candidate');
        doc.bin[pick(doc.json)] ^= 1;
        return reduction;
      };
    await attempt(
      await alter(
        (json) =>
          json.bufferViews[
            json.accessors[json.meshes[0].primitives[0].attributes.POSITION].bufferView
          ].byteOffset + 4,
      ),
      /POSITION: 1 vertex element\(s\) are not their source vertex's bytes/,
    );
    await attempt(
      await alter((json) => json.bufferViews[json.images[0].bufferView].byteOffset + 40),
      /images\[0\]: bytes changed/,
    );
    // A flipped triangle, its index digest refreshed in the evidence: the topology refuses it.
    const reduction = await reduceServed(root, record),
      flipped = Uint32Array.from(reduction.indices);
    [flipped[1], flipped[2]] = [flipped[2], flipped[1]];
    const candidate = packPlain(
      collectGarbage(
        replacePrimitive(reduction.source, 0, 0, {
          indices: flipped,
          sourceVertices: reduction.sourceVertices,
        }),
      ),
      'flipped',
    );
    await attempt(
      { ...reduction, candidate, indices: flipped },
      /incoherently wound edge\(s\) absent from the source|facing against their vertex normals/,
    );
    // An out-of-range mapping.
    const broken = Uint32Array.from(reduction.sourceVertices);
    broken[0] = 1e6;
    await attempt({ ...reduction, sourceVertices: broken }, /not one-to-one within/);
  });
});

test('the budget needs raw <= source AND gzip -6 below the source, and an unreduced candidate is refused', async () => {
  const small = Buffer.alloc(100, 1),
    large = Buffer.concat([
      small,
      Buffer.from(Array.from({ length: 400 }, (_, i) => (i * 37) % 251)),
    ]);
  assert.match(budgetProblems(small, large).join('\n'), /raw 500 bytes exceed the source's 100/);
  assert.match(
    budgetProblems(small, small).join('\n'),
    /gzip -6 \d+ bytes is not below the source's \d+/,
  );
  assert.deepEqual(budgetProblems(large, small), []);
  await withBase(async (world) => {
    const base = await readServedBase(world.root, BASE_ID, RULES),
      record = base.graph.models.tree.primary,
      unreduced = await reduceServed(world.root, record, { ratio: 1 }),
      run = await prove(world, { targets: { tree: { key: 'tree', record, ...unreduced } } });
    await assert.rejects(
      run.generate(),
      /no storage within both budgets|no triangle was removed|gzip -6 \d+ bytes is not below|exceed the source's/,
    );
  });
});

test('checkCandidate reports a failed verification whenever it finds a problem', async () => {
  await withBase(async (world) => {
    const { root } = world,
      run = await prove(world, { groups: [['hero']] }),
      record = run.base.graph.models.hero.primary,
      dir = proofDir(0),
      sourceBytes = await readFile(file(root, `public${record.url}`)),
      candidateBytes = await readFile(file(root, `${dir}/hero/guarded-body.glb`)),
      raw = await readFile(file(root, `${dir}/hero/guarded-body.m0p0.source-vertices.u32le`)),
      mappings = [
        {
          mesh: 0,
          primitive: 0,
          sourceVertices: new Uint32Array(
            raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength),
          ),
        },
      ],
      check = async (change) => {
        const evidence = await readJson(root, `${dir}/hero/evidence.json`),
          [variant] = evidence.variants;
        change(variant);
        return checkCandidate({
          key: 'hero',
          sourceBytes,
          candidateBytes,
          evidence,
          variant,
          mappings,
          digest: run.digest,
        });
      };
    const good = await check(() => {});
    assert.deepEqual([good.problems, good.verification.status], [[], 'passed']);
    for (const change of [
      (variant) => (variant.status = 'budget-not-met'),
      (variant) => (variant.poses.primitives[0].instances[0].poses[0].holes.all.max = 0.03),
    ]) {
      const { problems, verification } = await check(change);
      assert.ok(problems.length);
      assert.equal(verification.status, 'failed');
    }
  });
});

test('an archived revision is re-judged by the same strict summary policy and posed evidence: tampering is refused with refreshed hashes', async () => {
  await withBase(async (world) => {
    const { root } = world,
      run = await generated(world),
      revision = (relative) => `${GUARDED_REVISION}/${relative}`,
      saved = await snapshot(root, GUARDED_REVISION),
      originals = Object.fromEntries(
        await Promise.all(
          Object.keys(saved).map(async (relative) => [
            relative,
            await readFile(file(root, relative)),
          ]),
        ),
      ),
      restore = async () => {
        for (const [relative, bytes] of Object.entries(originals))
          await writeFile(file(root, relative), bytes);
      },
      // Rewrite JSON in the revision, then refresh every hash that names it, up to the manifest.
      rewrite = async (relative, change) => {
        const value = await readJson(root, revision(relative));
        change(value);
        const bytes = Buffer.from(text(value));
        await writeFile(file(root, revision(relative)), bytes);
        return { sha256: sha256(bytes), bytes: bytes.length };
      },
      refreshManifest = async (change) => {
        const manifest = await rewrite('manifest.json', change);
        await writeFile(
          file(root, revision('runtime-index.json')),
          text(runtimeIndexOf(await readJson(root, revision('manifest.json')))),
        );
        return manifest;
      },
      failedWith = async (pattern) => {
        const report = await verifyGuardedRevision(root, GUARDED_REVISION, {
          base: BASE_ID,
          rules: RULES,
        });
        assert.equal(report.status, 'failed');
        assert.match(
          JSON.stringify(
            [...report.checks, ...report.files].filter((item) => item.status !== 'passed'),
          ),
          pattern,
        );
        await assert.rejects(
          planAdoption(root, PLAN),
          /does not verify against|is not this verification's result/,
        );
        await restore();
      },
      tamperSummary = async (index, change) => {
        const identity = await rewrite(`proof/summary-${index + 1}.json`, change);
        await refreshManifest((manifest) =>
          Object.assign(manifest.proof.summaries[index], identity),
        );
      };
    // Archived policy and implementation identity.
    await tamperSummary(0, (summary) => (summary.policy.gates.maxMultiple = 7));
    await failedWith(/not a full-coverage guarded-body run/);
    await tamperSummary(
      1,
      (summary) => (summary.policy.overrides = { hero: { errorMetres: 0.008 } }),
    );
    await failedWith(/not a full-coverage guarded-body run/);
    await tamperSummary(1, (summary) => (summary.implementationAfterRun.changedDuringRun = true));
    await failedWith(/changed during the proof run/);
    await tamperSummary(1, (summary) => (summary.implementationAfterRun.digest = 'd'.repeat(64)));
    await failedWith(/changed during the proof run/);
    await tamperSummary(1, (summary) => (summary.policy.pose.scope = 'another scope'));
    await failedWith(/do not share one policy/);
    await tamperSummary(1, (summary) => summary.keys.push(structuredClone(summary.keys[0])));
    await failedWith(/lists hero more than once/);
    // Archived posed evidence, every hash above it refreshed (summary entry, summary, manifest record).
    const tamperEvidence = async (change) => {
      const evidence = await rewrite('proof/hero/evidence.json', (value) =>
        change(value.variants[0]),
      );
      const summary = await rewrite('proof/summary-2.json', (value) =>
        Object.assign(value.keys.find((item) => item.key === 'hero').evidence, evidence),
      );
      await refreshManifest((manifest) => {
        Object.assign(manifest.proof.summaries[1], summary);
        Object.assign(
          manifest.files.find((item) => item.modelKey === 'hero').proof.evidence,
          evidence,
        );
      });
    };
    await tamperEvidence(
      (variant) => (variant.poses.primitives[0].instances[0].poses[1].holes.static.max = 0.03),
    );
    await failedWith(/exceed the fixed world gate/);
    await tamperEvidence(
      (variant) => (variant.poses.scenes[0].clipTracks[0].applicableChannels = 0),
    );
    await failedWith(/the source has 1 applicable channel/);
    await tamperEvidence(
      (variant) => (variant.poses.primitives[0].instances[0].poses[2].interiors.all.p99 = null),
    );
    await failedWith(/not a complete finite, nonnegative measurement/);
    // Untampered, it still passes (and the restored bytes are the generated ones).
    assert.deepEqual(await snapshot(root, GUARDED_REVISION), saved);
    assert.equal(
      (
        await verifyGuardedRevision(root, GUARDED_REVISION, {
          base: BASE_ID,
          rules: RULES,
          implementation: run.digest,
        })
      ).status,
      'passed',
    );
    const pinned = await verifyGuardedRevision(root, GUARDED_REVISION, {
      base: BASE_ID,
      rules: RULES,
      implementation: 'f'.repeat(64),
    });
    assert.equal(
      pinned.status,
      'failed',
      'a stated implementation digest must be the recorded one',
    );
  });
});

test('revisions and adoptions are exclusive, unknown recipes are refused, a tampered revision fails verification, and apply stops on drift', async () => {
  await withBase(async (world) => {
    const { root } = world,
      run = await generated(world);
    await assert.rejects(run.generate(), /already exists; a guarded revision needs a new --out/);
    // A stored candidate altered after generation.
    const record = run.manifest.files[0],
      target = file(root, `${GUARDED_REVISION}/${record.output.file}`),
      good = await readFile(target),
      bad = Buffer.from(good);
    bad[bad.length - 1] ^= 1;
    await writeFile(target, bad);
    assert.equal(
      (await verifyGuardedRevision(root, GUARDED_REVISION, { base: BASE_ID, rules: RULES })).status,
      'failed',
    );
    await assert.rejects(planAdoption(root, PLAN), /does not verify against/);
    await writeFile(target, good);
    // An unknown recipe is never read as this one.
    const manifestPath = `${GUARDED_REVISION}/manifest.json`,
      manifestBytes = await readFile(file(root, manifestPath));
    await put(root, manifestPath, text({ ...run.manifest, recipe: 'guarded-surface@2' }));
    await assert.rejects(planAdoption(root, PLAN), /names the unknown recipe guarded-surface@2/);
    await writeFile(file(root, manifestPath), manifestBytes);
    // Earlier acceptance never covers these candidates.
    await assert.rejects(
      planAdoption(root, { ...PLAN, acceptance: BASE_ACCEPTANCE }),
      /accepted earlier candidates/,
    );
    // Exclusive adoption records; apply re-plans and stops on drift without writing.
    await writePlan(root, await planAdoption(root, PLAN));
    await assert.rejects(
      planAdoption(root, PLAN),
      /already exists; adoption records are never reused/,
    );
    const publicBefore = await snapshot(root, 'public'),
      treeBytes = await readFile(file(root, 'public/models/tree/asset.json'));
    await put(
      root,
      'public/models/tree/asset.json',
      text({ ...JSON.parse(treeBytes), notes: ['an unrelated edit'] }),
    );
    await assert.rejects(
      applyAdoption(root, GUARDED_ID, { rules: RULES }),
      /no longer exactly its applied ones/,
    );
    assert.equal((await readJson(root, `${RECORD}/journal.json`)).state, 'planned');
    await writeFile(file(root, 'public/models/tree/asset.json'), treeBytes);
    assert.deepEqual(await snapshot(root, 'public'), publicBefore);
    assert.equal((await applyAdoption(root, GUARDED_ID, { rules: RULES })).status, 'passed');
  });
});

test('a startup primary replaced twice keeps its original cleared LODs and their provenance, and never revives a rejected LOD', async () => {
  const SECOND_REVISION = 'assets/optimized-runtime/20991231-g02',
    SECOND_ID = '20991231-g02-a01',
    SECOND_ACCEPTANCE = ['output/review/guarded-g02.md'];
  await withBase(async (world) => {
    const { root } = world,
      original = (await readServedBase(root, BASE_ID, RULES)).graph,
      cleared = original.models.hero.clearedLods,
      rejected = cleared.flatMap((lod) => [lod.url, lod.candidate]);
    assert.ok(cleared.length, 'the fixture startup actor has a cleared LOD');
    await generated(world);
    await writePlan(root, await planAdoption(root, PLAN));
    assert.equal((await applyAdoption(root, GUARDED_ID, { rules: RULES })).status, 'passed');
    // The second replacement, on the first guarded adoption.
    const first = await readServedBase(root, GUARDED_ID, RULES),
      was = first.graph.models.hero,
      record = was.primary,
      proof = await writeProof(
        root,
        [{ key: 'hero', record, ...(await reduceServed(root, record, { ratio: 0.7 })) }],
        { dir: 'output/proof-second' },
      );
    await generateGuardedRevision(root, {
      base: GUARDED_ID,
      basePlanSha256: first.planSha256,
      summaries: [proof.summaryPath],
      implementation: proof.digest,
      accept: proof.accept,
      out: SECOND_REVISION,
      rules: RULES,
    });
    const report = await verifyGuardedRevision(root, SECOND_REVISION, {
      base: GUARDED_ID,
      rules: RULES,
      implementation: proof.digest,
    });
    assert.equal(
      report.status,
      'passed',
      JSON.stringify(
        [...report.checks, ...report.files].filter((item) => item.status !== 'passed'),
        null,
        2,
      ),
    );
    await put(root, `${SECOND_REVISION}/verification.json`, text(report));
    await put(root, SECOND_ACCEPTANCE[0], 'guarded g02 accepted after native review\n');
    await assert.rejects(
      planAdoption(root, {
        revision: SECOND_REVISION,
        adoption: SECOND_ID,
        base: GUARDED_ID,
        acceptance: ACCEPTANCE,
        rules: RULES,
      }),
      /accepted earlier candidates/,
    );
    const result = await planAdoption(root, {
        revision: SECOND_REVISION,
        adoption: SECOND_ID,
        base: GUARDED_ID,
        acceptance: SECOND_ACCEPTANCE,
        rules: RULES,
      }),
      { graph } = result.plan,
      hero = graph.models.hero,
      output = (await readJson(root, `${SECOND_REVISION}/manifest.json`)).files[0].output;
    // The original cleared LODs, their sources and the far-level baseline, all from the first base.
    assert.deepEqual([hero.lods, hero.clearedLods], [[], cleared]);
    assert.deepEqual(hero.primary.source, original.models.hero.primary.source);
    assert.deepEqual(
      [hero.startup.geometrySource, hero.startup.fullSource],
      [original.models.hero.startup.geometrySource, original.models.hero.startup.fullSource],
    );
    assert.deepEqual(hero.farTriangles, {
      before: original.models.hero.farTriangles.before,
      after: output.triangles,
      added: output.triangles - original.models.hero.farTriangles.before,
    });
    // What it supersedes is the first guarded adoption's startup file.
    assert.deepEqual(
      [
        hero.supersedes.adoption,
        hero.supersedes.candidateRevision,
        identity(hero.supersedes.primary),
        hero.supersedes.startup,
      ],
      [GUARDED_ID, GUARDED_REVISION, identity(was.primary), was.startup],
    );
    assert.deepEqual(identity(hero.startup), identity(output));
    // No rejected LOD (original or candidate) is served, copied or un-retired; earlier retirements stay.
    const served = new Set(
      Object.values(graph.models)
        .flatMap((entry) => [entry.primary, ...entry.lods])
        .map((item) => item.url),
    );
    for (const url of rejected) {
      assert.ok(graph.retired.includes(url), url);
      assert.ok(!served.has(url), url);
    }
    for (const url of first.graph.retired) assert.ok(graph.retired.includes(url), url);
    assert.ok(graph.retired.includes(was.primary.url));
    assert.deepEqual(
      result.plan.operations.copies.map((copy) => copy.url),
      [output.url],
    );
    assert.deepEqual(graph.retiredCandidates.at(-1), {
      modelKey: 'hero',
      role: 'startup',
      reason: `superseded-by-${SECOND_ID}`,
      ...identity(was.primary),
      triangles: was.primary.triangles,
      from: `${GUARDED_REVISION}/${was.primary.url.slice(1)}`,
    });
    // Apply: the stamp keeps the true original and its cleared LODs; no LOD is served.
    const firstAfter = await readFile(file(root, 'public/models/hero/asset.json'));
    await writePlan(root, result);
    assert.equal((await applyAdoption(root, SECOND_ID, { rules: RULES })).status, 'passed');
    const asset = await readJson(root, 'public/models/hero/asset.json'),
      stamp = asset[RUNTIME_FIELD];
    assert.deepEqual([identity(asset), asset.lods], [identity(output), []]);
    assert.deepEqual(
      [stamp.adoption, stamp.selection, identity(stamp.startupCandidate)],
      [SECOND_ID, SELECTION.startup, identity(output)],
    );
    assert.deepEqual(identity(stamp.original), identity(original.models.hero.primary.source));
    assert.deepEqual(stamp.original.lods.map(identity), cleared.map(identity));
    assert.deepEqual(
      [stamp.supersedes.adoption, stamp.supersedes.url],
      [GUARDED_ID, was.primary.url],
    );
    // Restore returns to the first guarded adoption's applied bytes exactly.
    assert.equal((await restoreAdoption(root, SECOND_ID)).state, 'restored');
    assert.ok((await readFile(file(root, 'public/models/hero/asset.json'))).equals(firstAfter));
    assert.equal((await auditAdoption(root, GUARDED_ID)).status, 'passed');
  });
});

test('the chained rewrite stays strict for every other recipe: no re-superseded leaves and no startup replacement', () => {
  const path = 'public/models/rock/asset.json',
    file = (letter, bytes) => ({
      url: `/models/rock/model.opt-${letter.repeat(16)}.glb`,
      sha256: letter.repeat(64),
      bytes,
    }),
    older = file('b', 11),
    served = file('a', 10),
    next = file('c', 9),
    original = { url: '/models/rock/model.glb', sha256: 'd'.repeat(64), bytes: 20 },
    stamp = (selection) => ({
      adoption: 'base-a01',
      candidateRevision: 'assets/optimized-runtime/r2',
      selection,
      original: { ...original, lods: [] },
      supersedes: {
        adoption: 'first-a01',
        candidateRevision: 'assets/optimized-runtime/r1',
        ...older,
        lods: [],
      },
      adoptedBy: 'base-a01',
    }),
    bytesOf = (selection) =>
      Buffer.from(
        text({ modelKey: 'rock', ...served, lods: [], [RUNTIME_FIELD]: stamp(selection) }),
      ),
    graph = (recipe, selection) => ({
      adoption: 'next-a01',
      recipe,
      base: { adoption: 'base-a01' },
      candidateRevision: 'assets/optimized-runtime/r3',
      textures: {},
      keptTextures: [],
      models: {
        rock: {
          selection,
          manifests: [path],
          primary: { ...next, source: original },
          lods: [],
          ...(selection === SELECTION.startup
            ? { clearedLods: [], startup: { record: 'model:rock', ...next } }
            : {}),
          candidateRevision: 'assets/optimized-runtime/r3',
          adoptedBy: 'next-a01',
          supersedes: {
            adoption: 'base-a01',
            candidateRevision: 'assets/optimized-runtime/r2',
            primary: { ...served, triangles: null },
            lods: [],
          },
        },
      },
    });
  // An entry whose stamp already records an earlier `supersedes`: only guarded-surface@1 may update its leaves.
  assert.throws(
    () =>
      rewriteChainedManifestBytes(
        path,
        bytesOf(SELECTION.ordinary),
        graph(EXACT_REPACK_RECIPE, SELECTION.ordinary),
      ),
    /the rewrite would change .*supersedes\./,
  );
  assert.throws(
    () =>
      rewriteChainedManifestBytes(
        path,
        bytesOf(SELECTION.ordinary),
        graph(undefined, SELECTION.ordinary),
      ),
    /the rewrite would change .*supersedes\./,
  );
  const ordinary = JSON.parse(
    rewriteChainedManifestBytes(
      path,
      bytesOf(SELECTION.ordinary),
      graph(GUARDED_RECIPE, SELECTION.ordinary),
    ).bytes,
  )[RUNTIME_FIELD];
  assert.deepEqual(
    [ordinary.adoption, ordinary.supersedes.adoption, ordinary.supersedes.url, ordinary.original],
    ['next-a01', 'base-a01', served.url, { ...original, lods: [] }],
  );
  // A startup replacement: guarded-surface@1 only.
  assert.throws(
    () =>
      rewriteChainedManifestBytes(
        path,
        bytesOf(SELECTION.startup),
        graph(EXACT_REPACK_RECIPE, SELECTION.startup),
      ),
    /only guarded-surface@1 replaces a startup primary/,
  );
  const startup = JSON.parse(
    rewriteChainedManifestBytes(
      path,
      bytesOf(SELECTION.startup),
      graph(GUARDED_RECIPE, SELECTION.startup),
    ).bytes,
  )[RUNTIME_FIELD];
  assert.deepEqual(startup.startupCandidate, { record: 'model:rock', ...next });
});
