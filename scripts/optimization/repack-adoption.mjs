// Chained adoption of an exact-repack revision (exact-repack.mjs) on the applied adoption it repacks
// (the base: complete, or itself chained). The result is ONE complete graph under ONE new id:
//   - the base graph is cloned exactly, lineage included: startup actors, sole-primary full models
//     with their rejected LODs and evidence, kept images, unadopted models;
//   - only the repacked models and images change. A packed template serves one file whose level i
//     is scene i (every level names the same url/sha256/bytes, its own scene and triangles). A
//     replaced image serves its lossless rewrite, keeping its size, uvSource, wrap and colour space
//     (`exactOf` names the planned output it is a rewrite of);
//   - each replaced entry records `supersedes`. The superseded files join `retired`, never one still
//     served, each with its archived candidate in the revision that generated it.
// The manifests are rewritten from the base's applied bytes (chained-adoption.mjs
// rewriteChainedManifestBytes). Apply, audit and restore are adoption.mjs's, and restore returns
// every manifest byte for byte to the base. Planning re-verifies the revision from disk against
// this very base (verifyExactRepack) and reads only.
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  ADOPTION_DIRECTORY,
  ADOPTION_GRAPH_SCHEMA,
  ADOPTION_PLAN_SCHEMA,
  adoptionDirectory,
} from '../runtime-graph.mjs';
import {
  DEFAULT_ACCEPTANCE,
  LOD_REJECTIONS,
  SELECTION,
  acceptanceDocuments,
  checkRevision,
  decoderIdentity,
  evidenceIdentities,
  fileProblems,
  runtimeLiterals,
  targetState,
} from './adoption.mjs';
import { inheritedImageCompatibility, rewriteChainedManifestBytes } from './chained-adoption.mjs';
import { EXACT_REPACK_RECIPE } from './contract.mjs';
import { repackTargets, scopeOf, verifyExactRepack } from './exact-repack.mjs';
import { jsonDifference, sha256 } from './glb.mjs';
import { loadEligibilityRules } from './inventory.mjs';
import { resolveRevisionDirectory } from './paths.mjs';
import { readServedBase } from './served-base.mjs';

const REVISION_RECORDS = Object.freeze([
  'manifest.json',
  'runtime-index.json',
  'verification.json',
]);
const fail = (message) => {
  throw new Error(message);
};
const identity = (record) => ({ url: record?.url, sha256: record?.sha256, bytes: record?.bytes });
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const sum = (values) => values.reduce((total, value) => total + value, 0);
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const servedFile = (record) => ({
  ...identity(record),
  triangles: record.triangles ?? null,
  ...(record.scene !== undefined ? { scene: record.scene } : {}),
});

/** Plan an exact-repack revision on its applied base. Nothing has a default. */
export async function planRepackAdoption(
  root,
  {
    revision: requested,
    adoption: id,
    base: baseId,
    acceptance,
    rules,
    lodRejections = LOD_REJECTIONS,
    replanning = false,
  } = {},
) {
  if (typeof baseId !== 'string' || !baseId)
    fail('An exact repack is adopted on its applied base (--base-adoption)');
  if (typeof requested !== 'string' || !requested)
    fail('An exact repack adoption needs its revision (--revision); there is no default');
  if (typeof id !== 'string' || !id)
    fail('An exact repack adoption needs a new adoption id (--adoption); there is no default');
  adoptionDirectory(root, baseId);
  const directory = adoptionDirectory(root, id);
  if (id === baseId) fail(`An exact repack adoption needs a new id, not its base's ${baseId}`);
  if (!replanning && existsSync(directory))
    fail(
      `${ADOPTION_DIRECTORY}/${id} already exists; adoption records are never reused, choose a new --adoption id`,
    );
  if (!Array.isArray(acceptance) || !acceptance.length)
    fail("An exact repack adoption needs this revision's own acceptance documents (--acceptance)");
  if (acceptance.some((relative) => DEFAULT_ACCEPTANCE.includes(relative)))
    fail('the r04 acceptance documents accepted earlier candidates, not this revision');
  rules ??= await loadEligibilityRules(root);

  // The base: applied, unchanged, current and intact, file by file.
  const base = await readServedBase(root, baseId, rules),
    baseGraph = base.graph,
    earlier = new Set(
      [...(base.plan.acceptance?.documents ?? []), ...(base.plan.base?.acceptance ?? [])].map(
        (document) => document.path,
      ),
    ),
    reused = acceptance.filter((relative) => earlier.has(relative));
  if (reused.length)
    fail(
      `${reused.join(', ')} accepted earlier candidates of ${baseId}'s chain, not this revision's`,
    );
  const documents = await acceptanceDocuments(root, acceptance);

  // The revision: its records, then everything re-verified from disk against this base.
  const revision = resolveRevisionDirectory(root, requested);
  if (revision.relative === base.record.candidateRevision.directory)
    fail(`${revision.relative} is the base's own candidate revision`);
  const read = {};
  for (const name of REVISION_RECORDS) {
    const file = path.join(revision.absolute, name);
    if (!existsSync(file)) fail(`${revision.relative}/${name} does not exist`);
    const bytes = await readFile(file);
    read[name] = {
      value: JSON.parse(bytes.toString('utf8')),
      identity: {
        path: `${revision.relative}/${name}`,
        sha256: sha256(bytes),
        bytes: bytes.length,
      },
    };
  }
  const manifest = read['manifest.json'].value;
  if (manifest.recipe !== EXACT_REPACK_RECIPE)
    fail(`${revision.relative} is not an exact-repack revision`);
  checkRevision(
    manifest,
    read['runtime-index.json'].value,
    read['verification.json'].value,
    revision.relative,
    { base: { id: baseId, planSha256: base.planSha256 } },
  );
  const report = await verifyExactRepack(root, revision.relative, {
    base: baseId,
    rules,
    served: base,
  });
  if (report.status !== 'passed')
    fail(
      `${revision.relative} does not verify against ${baseId} now: ${[
        ...report.checks
          .filter((item) => item.status !== 'passed')
          .map((item) => `${item.name}: ${(item.problems ?? []).join('; ')}`),
        ...report.files
          .filter((item) => item.status !== 'passed')
          .map((item) => `${item.id}: ${item.error}`),
      ]
        .slice(0, 8)
        .join(' | ')}`,
    );
  const recorded = jsonDifference(
    read['verification.json'].value.files.map(({ id: item, status, verification }) => ({
      id: item,
      status,
      verification: verification ?? null,
    })),
    report.files.map(({ id: item, status, verification }) => ({
      id: item,
      status,
      verification: verification ?? null,
    })),
  );
  if (recorded)
    fail(`${revision.relative}/verification.json is not this verification's result (${recorded})`);

  // Protected entries stay exactly as reviewed: the decoder and every LOD rejection.
  const decoder = await decoderIdentity(root);
  if (jsonDifference(decoder, baseGraph.decoder))
    fail(`The meshopt decoder is not the one ${baseId} recorded`);
  for (const [key, rule] of Object.entries(lodRejections)) {
    const entry = Object.hasOwn(baseGraph.models, key) ? baseGraph.models[key] : null;
    if (!entry) continue;
    if (
      entry.selection !== SELECTION.full ||
      entry.lodRejection?.decision !== rule.decision ||
      jsonDifference(entry.lodRejection.reviewed, rule.reviewed)
    )
      fail(`${key}: ${baseId} does not carry its reviewed LOD rejection; review it again`);
    if (
      jsonDifference(
        await evidenceIdentities(root, rule.evidence, 'LOD rejection evidence'),
        entry.lodRejection.evidence,
      )
    )
      fail(`${key}: its LOD rejection evidence changed since ${baseId}`);
  }

  // The graph: the base cloned; the repacked models and images replaced.
  const targets = repackTargets(base, scopeOf(manifest.scope)),
    records = new Map(manifest.files.map((record) => [record.modelKey, record])),
    images = new Map(
      manifest.images
        .filter((record) => record.output)
        .map((record) => [record.id.slice('image:'.length), record]),
    ),
    lineage = (record) => ({
      candidateRevision: record.candidateRevision ?? baseGraph.candidateRevision,
      adoptedBy: record.adoptedBy ?? baseId,
    }),
    retired = new Set(baseGraph.retired),
    copies = new Map(),
    superseded = [],
    graph = {
      schema: ADOPTION_GRAPH_SCHEMA,
      adoption: id,
      candidateRevision: revision.relative,
      recipe: EXACT_REPACK_RECIPE,
      base: {
        adoption: baseId,
        planSha256: base.planSha256,
        candidateRevision: baseGraph.candidateRevision,
      },
      scope: manifest.scope.only,
      decoder,
      models: {},
      notAdopted: structuredClone(baseGraph.notAdopted),
      lodRejections: structuredClone(baseGraph.lodRejections),
      textures: {},
      keptTextures: structuredClone(baseGraph.keptTextures),
      retired: [],
      retiredCandidates: structuredClone(baseGraph.retiredCandidates ?? []),
    };
  const copy = (output) => {
      copies.set(output.url, {
        url: output.url,
        sha256: output.sha256,
        bytes: output.bytes,
        from: `${revision.relative}/${output.file}`,
        to: `public${output.url}`,
      });
    },
    retire = (modelKey, role, previous, was) => {
      if (retired.has(previous.url)) return;
      retired.add(previous.url);
      superseded.push({
        modelKey,
        role,
        reason: `superseded-by-${id}`,
        ...identity(previous),
        triangles: previous.triangles ?? null,
        // The served copy's archived candidate, in the revision that generated it.
        from: `${was.candidateRevision}/${previous.url.slice(1)}`,
      });
    };
  for (const [key, entry] of Object.entries(baseGraph.models)) {
    const record = records.get(key);
    if (!record) {
      graph.models[key] = { ...structuredClone(entry), ...lineage(entry) };
      continue;
    }
    const target = targets.models.find((item) => item.key === key),
      was = lineage(entry),
      previous = [entry.primary, ...entry.lods],
      output = record.output;
    if (!target || previous.length !== output.scenes.length)
      fail(`${key}: the revision does not repack exactly its ${previous.length} level(s)`);
    const served = previous.map((level, i) => ({
      url: output.url,
      sha256: output.sha256,
      bytes: output.bytes,
      ...(output.packed ? { scene: output.scenes[i].scene } : {}),
      triangles: output.scenes[i].triangles,
      extensionsRequired: output.extensionsRequired,
      maximumTextureEdge: level.maximumTextureEdge,
      candidate: record.id,
      source: structuredClone(level.source),
    }));
    if (output.packed && served.some((level, i) => level.scene !== i))
      fail(`${key}: its scenes are not its levels in order`);
    graph.models[key] = {
      selection: SELECTION.ordinary,
      manifests: [...entry.manifests],
      primary: served[0],
      lods: served.slice(1),
      candidateRevision: revision.relative,
      adoptedBy: id,
      ...(output.packed ? { packed: { scenes: served.length } } : {}),
      supersedes: {
        adoption: was.adoptedBy,
        candidateRevision: was.candidateRevision,
        primary: servedFile(entry.primary),
        lods: entry.lods.map(servedFile),
      },
    };
    copy(output);
    previous.forEach((level, i) => retire(key, i ? 'lod' : 'model', level, was));
  }
  for (const [url, texture] of Object.entries(baseGraph.textures)) {
    const record = images.get(url);
    if (!record) {
      graph.textures[url] = { ...structuredClone(texture), ...lineage(texture) };
      continue;
    }
    const was = lineage(texture);
    if (!sameServed(record.source, texture))
      fail(
        `${record.id}: the revision repacks ${record.source.url}, not the served ${texture.url}`,
      );
    graph.textures[url] = {
      ...structuredClone(texture),
      url: record.output.url,
      sha256: record.output.sha256,
      bytes: record.output.bytes,
      candidate: record.id,
      candidateRevision: revision.relative,
      adoptedBy: id,
      exactOf: texture.exactOf ?? identity(texture),
      supersedes: {
        adoption: was.adoptedBy,
        candidateRevision: was.candidateRevision,
        ...identity(texture),
      },
    };
    copy(record.output);
    retire(texture.owner, 'image', texture, was);
  }
  if (
    images.size !==
    Object.values(graph.textures).filter((texture) => texture.adoptedBy === id).length
  )
    fail('an image record names no adopted image');
  // Archived candidates must still be the bytes their URL names.
  const archived = await fileProblems(
    root,
    superseded.map((item) => ({ path: item.from, sha256: item.sha256, bytes: item.bytes })),
  );
  if (archived.length)
    fail(`superseded files are not archived as recorded: ${archived.slice(0, 8).join('; ')}`);
  graph.retiredCandidates.push(...superseded);
  const nowServed = new Set(
    [
      ...Object.values(graph.models).flatMap((entry) => [entry.primary, ...entry.lods]),
      ...Object.values(graph.textures),
      ...graph.keptTextures,
    ].map((record) => record.url),
  );
  for (const url of retired)
    if (nowServed.has(url)) fail(`${url} would be both served and retired`);
  for (const model of base.current.models)
    if (!Object.hasOwn(graph.models, model.modelKey))
      for (const file of model.files)
        if (retired.has(file.url))
          fail(`${file.url} is retired, but ${model.modelKey} (not adopted) still delivers it`);
  for (const item of copies.values())
    if (base.current.files.has(item.url) || retired.has(item.url))
      fail(`${item.url} is already delivered or retired; it is never reused`);
  graph.retired = [...retired].sort(byText);

  // The inherited cave images must still mean what their root revision planned.
  const compatibility = await inheritedImageCompatibility(root, base.record, graph);
  if (compatibility.problems.length)
    fail(
      `The current runtime no longer loads the inherited standalone images with the same meaning: ${compatibility.problems.slice(0, 8).join('; ')}. Nothing was planned.`,
    );

  // Every manifest the base covered, from its current (applied) bytes.
  const before = new Map(),
    after = new Map(),
    operations = [],
    touchedModels = new Map(),
    touchedTextures = new Map(),
    add = (map, key, value) => map.set(key, [...(map.get(key) ?? []), value]);
  for (const input of base.current.manifests) {
    const bytes = await readFile(path.join(root, ...input.path.split('/')));
    if (sha256(bytes) !== input.sha256) fail(`${input.path} changed while the plan was computed`);
    before.set(input.path, bytes);
    const rewritten = rewriteChainedManifestBytes(input.path, bytes, graph);
    if (!rewritten) continue;
    after.set(input.path, rewritten.bytes);
    for (const key of rewritten.models) add(touchedModels, key, input.path);
    for (const url of rewritten.textures) add(touchedTextures, url, input.path);
    operations.push({
      path: input.path,
      before: { sha256: input.sha256, bytes: bytes.length },
      after: { sha256: sha256(rewritten.bytes), bytes: rewritten.bytes.length },
      changes: rewritten.changes,
    });
  }
  for (const [key, entry] of Object.entries(graph.models))
    if (jsonDifference(touchedModels.get(key) ?? [], entry.manifests))
      fail(`${key}: the rewrite does not cover exactly its manifests`);
  for (const [url, texture] of Object.entries(graph.textures))
    if (jsonDifference(touchedTextures.get(url) ?? [], texture.manifests))
      fail(`${url}: the rewrite does not cover exactly its manifests`);
  if (
    jsonDifference(
      operations.map((operation) => operation.path),
      base.record.rewrittenManifests.map((operation) => operation.path),
    )
  )
    fail(`The rewrite does not cover exactly the manifests ${baseId} rewrote`);

  const copyList = [...copies.values()].sort((a, b) => byText(a.url, b.url)),
    states = { absent: 0, present: 0 };
  for (const item of copyList) states[await targetState(root, item)]++;
  const changed = Object.values(graph.models).filter((entry) => entry.adoptedBy === id),
    totals = {
      adoptedModels: Object.keys(graph.models).length,
      repackedModels: changed.length,
      packedModels: changed.filter((entry) => entry.packed).length,
      replacedImages: images.size,
      copies: copyList.length,
      copyBytes: sum(copyList.map((item) => item.bytes)),
      supersededFiles: superseded.length,
      supersededBytes: sum(superseded.map((item) => item.bytes)),
      rewrittenManifests: operations.length,
      revisionTotals: manifest.totals,
    };
  const plan = {
    schema: ADOPTION_PLAN_SCHEMA,
    adoption: id,
    options: { revision: revision.relative, acceptance: [...acceptance], base: baseId },
    recipe: EXACT_REPACK_RECIPE,
    base: { ...base.record, acceptance: structuredClone(base.plan.acceptance?.documents ?? []) },
    candidateRevision: {
      directory: revision.relative,
      revision: manifest.revision,
      files: REVISION_RECORDS.map((name) => read[name].identity),
    },
    acceptance: { documents },
    inputs: { manifests: base.current.manifests, eligibility: rules.inputs },
    runtimeCompatibility: compatibility.record,
    operations: { copies: copyList, manifests: operations },
    graph,
    totals,
    atomicity: `apply replaces one file at a time (temporary file, then rename) and journals its progress; it is not a multi-file transaction. A partial application names two adoptions and is refused by apply and by the builds; restore returns every manifest to ${baseId}'s applied bytes.`,
  };
  const review = {
    adoption: id,
    base: baseId,
    recipe: EXACT_REPACK_RECIPE,
    note: 'informational; not part of plan.json and not compared by apply',
    targets: states,
    runtimeLiterals: await runtimeLiterals(root, graph),
  };
  return { plan, planBytes: Buffer.from(json(plan), 'utf8'), before, after, review };
}

const sameServed = (a, b) => a?.url === b?.url && a?.sha256 === b?.sha256 && a?.bytes === b?.bytes;
