// What a candidate revision covers: the selected models, the maximum texture edge of each image
// treatment and, for a partial revision, the applied adoption ("base") it is derived against.
//
// A partial revision supersedes a listed set of the base's ordinary compressed models. Its sources
// are the originals the base recorded before it was applied: the saved pre-apply manifests in
// assets/runtime-adoption/<id>/before/, never the served candidates (which would be decoded and
// re-encoded, and named with a second .opt hash). It never rebuilds a startup actor, a sole-primary
// full model (rejected LOD) or a model that owns standalone images; those stay as the base adopted
// them. Reading a base checks:
//   - plan.json, journal.json (applied, bound to the plan) and the candidate revision's manifest,
//     index and verification bytes;
//   - before/: exactly the manifests the candidate revision was generated from;
//   - after/: the planned bytes, and each re-derived from its before-bytes and the plan's graph;
//   - the current manifests: the after-bytes where the base rewrote them, the before-bytes elsewhere;
//   - each adopted model's recorded originals: exactly its saved pre-apply records;
//   - the files themselves: every file the base serves (copies, startup files, cave images) and
//     every original it replaced or keeps, by SHA-256 and length; the manifests alone prove
//     nothing about a corrupt or missing file.
// A chained adoption (one with a base of its own) is not a base. Nothing here writes.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  ADOPTION_DIRECTORY,
  ADOPTION_GRAPH_SCHEMA,
  ADOPTION_JOURNAL_SCHEMA,
  ADOPTION_PLAN_SCHEMA,
  adoptionDirectory,
} from '../runtime-graph.mjs';
import {
  LOD_REJECTIONS,
  SELECTION,
  fileProblems,
  originalProblems,
  rewriteManifestBytes,
  servedFiles,
} from './adoption.mjs';
import { MANIFEST_SCHEMA, STARTUP_ROLE } from './contract.mjs';
import { jsonDifference, sha256 } from './glb.mjs';
import { buildInventory } from './inventory.mjs';
import { candidateLocation, resolveRevisionDirectory } from './paths.mjs';
import { CAVE_OWNER } from './standalone-images.mjs';
import { maximumEdgeOf, textureEdges } from './textures.mjs';

// --maps-512: normal and data maps at 512, colour (and unsampled images) kept at 1024.
export const MAPS_512 = Object.freeze({ color: 1024, normal: 512, data: 512 });
const RECORDED_MANIFEST =
  /^public\/models\/(?:world-assets\.json|[a-z0-9][a-z0-9._-]*\/asset\.json)$/;
const CANDIDATE_RECORDS = Object.freeze([
  'manifest.json',
  'runtime-index.json',
  'verification.json',
]);
const OPTIMIZED_NAME = /\.opt-[0-9a-f]{16}\.[a-z]+$/;
const identity = (record) => ({ url: record?.url, sha256: record?.sha256, bytes: record?.bytes });

/** The texture edges of each model key. A key in both lists is ambiguous and refused. */
export function edgePolicy({ edge512, maps512 = new Set() }) {
  const both = [...maps512].filter((key) => edge512.has(key)).sort();
  if (both.length)
    throw new Error(
      `${both.join(', ')}: listed in both --edge-512 and --maps-512; the texture edge is ambiguous`,
    );
  return (key) => textureEdges(edge512.has(key) ? 512 : maps512.has(key) ? MAPS_512 : 1024, key);
}

/** The models, files and startup actors a run derives, each file with its texture edges. With a
 * `base`, `inventory` is the base's saved pre-apply inventory and the scope is checked first. */
export function selectWork(inventory, options, base = null) {
  const eligible = inventory.models.filter((model) => model.eligible),
    keys = new Set(eligible.map((model) => model.modelKey));
  for (const key of [...options.edge512, ...options.maps512, ...options.only])
    if (!keys.has(key)) throw new Error(`${key} is not an eligible model key`);
  const edgesOf = edgePolicy(options);
  if (base) checkPartialScope(base, options);
  const chosen = eligible.filter((model) => !options.only.size || options.only.has(model.modelKey)),
    edges = new Map();
  for (const model of chosen) {
    const modelEdges = edgesOf(model.modelKey);
    for (const file of model.files) {
      if (edges.has(file.url) && jsonDifference(edges.get(file.url), modelEdges))
        throw new Error(`${file.url} is shared by models with different texture edges`);
      edges.set(file.url, modelEdges);
    }
  }
  const owners = new Map(chosen.map((model) => [model.modelKey, edgesOf(model.modelKey)])),
    files = [...edges.keys()].sort().map((url) => ({
      ...inventory.files.get(url),
      edges: edges.get(url),
      edge: maximumEdgeOf(edges.get(url)),
    })),
    startup = chosen
      .filter((model) => model.publicCharacter)
      .map((model) => {
        const [full, lod] = model.files;
        if (!lod)
          throw new Error(
            `${model.modelKey}: a public character needs its adopted LOD for a startup actor`,
          );
        return {
          modelKey: model.modelKey,
          full: full.url,
          lod: lod.url,
          lodDistanceMetres: lod.distanceMetres,
          edges: edges.get(full.url),
          edge: maximumEdgeOf(edges.get(full.url)),
        };
      });
  return { chosen, files, startup, edges, owners };
}

/** The texture edges a revision's policy gives one record, or null for a record written before
 * per-image edges were recorded. Every model delivering the file must agree, and the record too. */
export function recordEdges(manifest, record) {
  const policy = edgePolicy({
      edge512: new Set(manifest.policy?.stricter512 ?? []),
      maps512: new Set(manifest.policy?.maps512 ?? []),
    }),
    owners = [...new Set((record.uses ?? []).map((use) => use.modelKey))];
  if (!owners.length) throw new Error(`${record.id}: no model delivers it`);
  const [edges, ...others] = owners.map(policy);
  if (others.some((other) => jsonDifference(other, edges)))
    throw new Error(`${record.id}: its models ${owners.join(', ')} have different texture edges`);
  if (record.output?.textureEdges === undefined) {
    if (
      manifest.policy?.maps512?.length ||
      (record.output?.images ?? []).some((image) => image.maximumEdge !== undefined)
    )
      throw new Error(`${record.id}: per-image texture edges are required but not recorded`);
    return null;
  }
  const difference = jsonDifference(record.output.textureEdges, edges);
  if (difference)
    throw new Error(`${record.id}: its texture edges differ from the policy (${difference})`);
  if (record.output.maximumTextureEdge !== maximumEdgeOf(edges))
    throw new Error(
      `${record.id}: maximum texture edge ${record.output.maximumTextureEdge} is not ${maximumEdgeOf(edges)}`,
    );
  return edges;
}

/** One `manifest.models` entry, as the generator writes it and the verifier expects it. */
export const modelSummary = (model, selected, candidateOf, startupActor) => ({
  modelKey: model.modelKey,
  kind: model.kind,
  manifest: model.manifest,
  worldCatalog: model.worldCatalog,
  publicCharacter: model.publicCharacter,
  eligible: model.eligible,
  reason: model.reason,
  reviewed: true,
  selected,
  files: model.files.map((file) => ({
    role: file.role,
    lodIndex: file.lodIndex,
    url: file.url,
    sha256: file.sha256,
    bytes: file.bytes,
    candidate: candidateOf(file.url),
  })),
  startupActor,
});

/** The applied base adoption `id`, verified as described above, with its saved pre-apply inventory. */
export async function readBaseAdoption(root, id, rules) {
  const directory = adoptionDirectory(root, id),
    relative = `${ADOPTION_DIRECTORY}/${id}`,
    fail = (message) => {
      throw new Error(`Base adoption ${id}: ${message}`);
    },
    readRecord = async (...parts) => {
      try {
        return await readFile(path.join(directory, ...parts));
      } catch (error) {
        if (error.code === 'ENOENT') fail(`${relative}/${parts.join('/')} is missing`);
        throw error;
      }
    };
  const planBytes = await readRecord('plan.json'),
    journal = JSON.parse(await readRecord('journal.json')),
    plan = JSON.parse(planBytes),
    planSha256 = sha256(planBytes),
    graph = plan.graph;
  if (
    plan.schema !== ADOPTION_PLAN_SCHEMA ||
    plan.adoption !== id ||
    graph?.schema !== ADOPTION_GRAPH_SCHEMA ||
    graph.adoption !== id
  )
    fail('plan.json is not the plan of this adoption');
  if (plan.base !== undefined || graph.base !== undefined)
    fail(
      'it is itself a chained adoption; a partial revision is derived against a complete adoption only',
    );
  if (
    journal.schema !== ADOPTION_JOURNAL_SCHEMA ||
    journal.adoption !== id ||
    journal.planSha256 !== planSha256
  )
    fail('journal.json does not belong to plan.json');
  if (journal.state !== 'applied')
    fail(
      `it is ${journal.state}, not applied; a partial revision is derived against an applied adoption only`,
    );

  // The candidate revision it adopted: manifest, index and verification exactly as planned.
  const candidate = plan.candidateRevision ?? {},
    revision = resolveRevisionDirectory(root, candidate.directory);
  if (
    graph.candidateRevision !== revision.relative ||
    jsonDifference(
      (candidate.files ?? []).map((item) => item.path),
      CANDIDATE_RECORDS.map((name) => `${revision.relative}/${name}`),
    )
  )
    fail(`plan.json does not name the manifest, index and verification of ${revision.relative}`);
  const stored = new Map();
  for (const [index, item] of candidate.files.entries()) {
    const bytes = await readFile(path.join(revision.absolute, CANDIDATE_RECORDS[index]));
    if (bytes.length !== item.bytes || sha256(bytes) !== item.sha256)
      fail(`${item.path} changed since the adoption was planned`);
    stored.set(CANDIDATE_RECORDS[index], bytes);
  }
  const adopted = JSON.parse(stored.get('manifest.json'));
  if (
    adopted.schema !== MANIFEST_SCHEMA ||
    adopted.revision !== candidate.revision ||
    adopted.directory !== revision.relative ||
    adopted.scope?.complete !== true
  )
    fail(
      `${revision.relative}/manifest.json is not the complete candidate revision the plan names`,
    );
  const inputs = plan.inputs?.manifests;
  if (!Array.isArray(inputs) || !inputs.length) fail('plan.json records no input manifests');
  const inputDifference = jsonDifference(adopted.inputs?.manifests, inputs);
  if (inputDifference)
    fail(
      `its inputs are not the manifests ${revision.relative} was generated from (${inputDifference})`,
    );

  // before/: every manifest the revision read; after/: each planned rewrite, re-derived.
  const before = new Map(),
    operations = new Map();
  for (const input of inputs) {
    if (!RECORDED_MANIFEST.test(input?.path ?? '') || before.has(input.path))
      fail(`plan.json records an unexpected manifest path ${JSON.stringify(input?.path)}`);
    const bytes = await readRecord('before', ...input.path.split('/'));
    if (sha256(bytes) !== input.sha256)
      fail(`before/${input.path} is not the pre-apply manifest the plan recorded`);
    before.set(input.path, bytes);
  }
  for (const operation of plan.operations?.manifests ?? []) {
    const bytes = before.get(operation.path);
    if (!bytes || operations.has(operation.path))
      fail(`it rewrites ${operation.path}, which it did not read`);
    if (operation.before?.sha256 !== sha256(bytes) || operation.before.bytes !== bytes.length)
      fail(`${operation.path}: the planned before-bytes are not the saved ones`);
    const after = await readRecord('after', ...operation.path.split('/'));
    if (after.length !== operation.after?.bytes || sha256(after) !== operation.after.sha256)
      fail(`after/${operation.path} is not the planned rewrite`);
    operations.set(operation.path, operation);
  }
  for (const [file, bytes] of before) {
    const rewritten = rewriteManifestBytes(file, bytes, graph),
      operation = operations.get(file);
    if (
      !rewritten !== !operation ||
      (rewritten && sha256(rewritten.bytes) !== operation.after.sha256)
    )
      fail(`${file}: the planned after-bytes are not the rewrite of the saved before-bytes`);
  }

  // Still applied: the current manifests are exactly the after-bytes, or the before-bytes where
  // the adoption changed nothing.
  const current = await buildInventory(root, rules),
    expected = new Map(
      inputs.map((input) => [input.path, operations.get(input.path)?.after.sha256 ?? input.sha256]),
    ),
    seen = new Set(),
    drift = [];
  for (const { path: file, sha256: digest } of current.manifests) {
    seen.add(file);
    if (!expected.has(file)) drift.push(`${file} is new`);
    else if (expected.get(file) !== digest) drift.push(`${file} changed (SHA-256 ${digest})`);
  }
  for (const file of expected.keys()) if (!seen.has(file)) drift.push(`${file} is gone`);
  if (drift.length)
    fail(
      `the current manifests are no longer exactly the applied ones: ${drift.slice(0, 8).join('; ')}${drift.length > 8 ? `; and ${drift.length - 8} more` : ''}`,
    );

  // The originals: the saved pre-apply inventory, which must be what every adopted model came from.
  const inventory = await buildInventory(root, rules, { snapshot: before }),
    snapshotDifference = jsonDifference(inventory.manifests, inputs);
  if (snapshotDifference)
    fail(`the saved pre-apply manifests do not rebuild its inputs (${snapshotDifference})`);
  for (const [key, entry] of Object.entries(graph.models)) {
    const model = inventory.models.find((item) => item.modelKey === key),
      lods =
        entry.selection === SELECTION.ordinary
          ? entry.lods.map((lod) => lod.source)
          : (entry.clearedLods ?? []),
      recorded = [entry.primary?.source, ...lods].map(identity);
    if (!model || jsonDifference(recorded, model.files.map(identity)))
      fail(`${key}: the originals it adopted are not its saved pre-apply records`);
  }
  const files = [
    ...(await fileProblems(root, servedFiles(graph))),
    ...(await originalProblems(root, graph)),
  ];
  if (files.length)
    fail(
      `its served or original files do not match the plan: ${files.slice(0, 8).join('; ')}${files.length > 8 ? `; and ${files.length - 8} more` : ''}`,
    );
  return {
    id,
    plan,
    graph,
    planSha256,
    adopted,
    inventory,
    current,
    record: {
      adoption: id,
      directory: relative,
      planSha256,
      state: journal.state,
      candidateRevision: {
        directory: revision.relative,
        revision: candidate.revision,
        files: candidate.files.map((item) => ({
          path: item.path,
          sha256: item.sha256,
          bytes: item.bytes,
        })),
      },
      rewrittenManifests: [...operations.values()].map((operation) => ({
        path: operation.path,
        before: { sha256: operation.before.sha256, bytes: operation.before.bytes },
        after: { sha256: operation.after.sha256, bytes: operation.after.bytes },
      })),
    },
  };
}

/** Model keys whose manifests carry the base's standalone images. */
function imageOwners(base) {
  return new Set([
    CAVE_OWNER,
    ...Object.values(base.graph.textures ?? {}).map((texture) => texture.owner),
    ...(base.graph.keptTextures ?? []).map((texture) => texture.owner),
    ...(base.adopted.images ?? []).map((image) => image.plan?.owner),
    ...(base.adopted.standaloneImageOwner?.modelKey
      ? [base.adopted.standaloneImageOwner.modelKey]
      : []),
  ]);
}

/** A partial revision on `base` covers an explicit list of the base's ordinary compressed models,
 * none of them a startup actor, a sole-primary full model or an image owner, and none sharing a
 * file with an unlisted model. Throws on the first violation. */
export function checkPartialScope(base, { only, edge512, maps512 = new Set() }) {
  const id = base.id;
  if (!only.size) throw new Error(`A partial revision on ${id} needs an explicit --only list`);
  for (const [flag, keys] of [
    ['--edge-512', edge512],
    ['--maps-512', maps512],
  ]) {
    const outside = [...keys].filter((key) => !only.has(key)).sort();
    if (outside.length)
      throw new Error(
        `${flag} lists ${outside.join(', ')} outside --only; a partial revision covers exactly its --only models`,
      );
  }
  const owners = imageOwners(base);
  for (const key of [...only].sort()) {
    const model = base.inventory.models.find((item) => item.modelKey === key),
      entry = Object.hasOwn(base.graph.models, key) ? base.graph.models[key] : null;
    if (!model?.eligible)
      throw new Error(`${key} is not an eligible model of ${id}'s saved pre-apply manifests`);
    if (model.publicCharacter || entry?.selection === SELECTION.startup || entry?.startup)
      throw new Error(
        `${key} is a startup actor (sole primary) in ${id}; a partial revision never rebuilds startup actors`,
      );
    if (
      entry?.selection === SELECTION.full ||
      entry?.lodRejection ||
      entry?.clearedLods?.length ||
      Object.hasOwn(LOD_REJECTIONS, key)
    )
      throw new Error(
        `${key} serves its full candidate as the sole primary in ${id} (rejected LOD); a partial revision never replaces it`,
      );
    if (owners.has(key))
      throw new Error(
        `${key} owns standalone runtime images in ${id}; a partial revision never plans standalone images`,
      );
    if (entry?.selection !== SELECTION.ordinary)
      throw new Error(
        `${key} is ${entry ? entry.selection : 'not adopted'} in ${id}; a partial revision supersedes only ordinary compressed models`,
      );
    for (const file of model.files) {
      if (OPTIMIZED_NAME.test(file.url))
        throw new Error(`${key}: ${file.url} is a candidate, not an original`);
      const others = [
        ...new Set(base.inventory.files.get(file.url).uses.map((use) => use.modelKey)),
      ].filter((user) => !only.has(user));
      if (others.length)
        throw new Error(
          `${file.url} of ${key} is also delivered by ${others.join(', ')}; list every model that shares it`,
        );
    }
  }
}

/** What the listed models serve today under the base, and the originals they are derived from. */
export function supersededModels(base, only) {
  return Object.fromEntries(
    [...only].sort().map((key) => {
      const entry = base.graph.models[key];
      return [
        key,
        {
          selection: entry.selection,
          manifests: entry.manifests,
          served: [entry.primary, ...entry.lods].map(identity),
          originals: [entry.primary.source, ...entry.lods.map((lod) => lod.source)].map(identity),
        },
      ];
    }),
  );
}

/** The `manifest.base` record of a partial revision on `base` covering `only`. */
export const baseRecordOf = (base, only) => ({
  ...base.record,
  models: supersededModels(base, only),
});

/** The standalone-image plan of a partial revision: none; the base's adopted images stay. */
export const skippedStandalone = (base) => ({
  owner: null,
  inputs: null,
  images: [],
  skipped: `not planned: a partial revision on ${base.id} keeps the base's adopted standalone images`,
});

/** The verifier's checks of a partial revision against its base: `[{ name, problems }]`. */
export function checkPartialRevision(manifest, base) {
  const results = [],
    run = (name, test) => {
      try {
        results.push({ name, problems: test() });
      } catch (error) {
        results.push({ name, problems: [error.message] });
      }
    },
    list = manifest.scope?.only,
    only = new Set(Array.isArray(list) ? list : []);
  run(
    'the scope is an explicit list of ordinary models adopted by the base, sharing no file with another model',
    () => {
      const problems = [];
      if (manifest.scope?.complete !== false) problems.push('the scope claims to be complete');
      if (!Array.isArray(list) || jsonDifference(list, [...only].sort()))
        problems.push('scope.only is not a sorted list of distinct keys');
      checkPartialScope(base, {
        only,
        edge512: new Set(manifest.policy?.stricter512 ?? []),
        maps512: new Set(manifest.policy?.maps512 ?? []),
      });
      return problems;
    },
  );
  run(
    'the base adoption is the one the revision was derived against: applied, with unchanged records',
    () => {
      const difference = jsonDifference(manifest.base, baseRecordOf(base, only));
      return difference ? [difference] : [];
    },
  );
  run("the sources are the base's saved pre-apply manifests", () => {
    const difference = jsonDifference(manifest.inputs?.manifests, base.inventory.manifests);
    return difference ? [difference] : [];
  });
  run(
    "candidates cover exactly the listed models' original files, named after the originals",
    () => {
      const problems = [],
        expected = new Map(
          base.inventory.models
            .filter((model) => only.has(model.modelKey))
            .flatMap((model) =>
              model.files.map((file) => [file.url, base.inventory.files.get(file.url)]),
            ),
        ),
        records = manifest.files ?? [],
        recorded = new Set();
      for (const record of records) {
        if (record.role === STARTUP_ROLE) {
          problems.push(`${record.id}: a partial revision has no startup actors`);
          continue;
        }
        const original = expected.get(record.source?.url);
        if (!original || recorded.has(original.url)) {
          problems.push(
            `${record.id}: not an original file of the listed models, or recorded twice`,
          );
          continue;
        }
        recorded.add(original.url);
        if (
          jsonDifference(identity(record.source), identity(original)) ||
          jsonDifference(record.uses, original.uses)
        )
          problems.push(`${record.id}: its source or uses differ from the saved pre-apply records`);
        const location = candidateLocation(original.url, record.output?.sha256 ?? '');
        if (record.output?.file !== location.file || record.output?.url !== location.url)
          problems.push(
            `${record.id}: ${record.output?.file} is not named after its original as ${location.file}`,
          );
      }
      for (const url of expected.keys())
        if (!recorded.has(url)) problems.push(`${url} has no candidate`);
      if ((manifest.images ?? []).length || manifest.standaloneImageOwner !== null)
        problems.push('a partial revision records standalone images');
      return problems;
    },
  );
  run('the model list is the saved pre-apply inventory, selected exactly for the scope', () => {
    const candidates = new Map(
        (manifest.files ?? []).map((record) => [record.source?.url, record.output?.url]),
      ),
      expected = base.inventory.models.map((model) =>
        modelSummary(model, only.has(model.modelKey), (url) => candidates.get(url) ?? null, null),
      ),
      difference = jsonDifference(manifest.models, expected);
    return difference ? [difference] : [];
  });
  return results;
}
