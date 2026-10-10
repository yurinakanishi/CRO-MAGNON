// Chained adoption of a guarded-surface@1 revision on the applied adoption it was verified against
// (the base). The result is ONE complete graph under ONE new id:
//   - the base graph is cloned exactly, lineage included: every unlisted model, every LOD rejection
//     and its evidence, every texture and kept image, the decoder;
//   - each listed model serves its reviewed candidate as its primary. An ordinary model keeps every
//     LOD record exactly; a startup actor keeps no LOD and the same cleared LODs, its startup record
//     now names the new primary, and the preceding startup facts move under `supersedes`;
//   - the superseded primary joins `retired` with its archived candidate in the revision that
//     generated it; only the new primaries are copied into public/models.
// The manifests are rewritten from the base's applied bytes (rewriteChainedManifestBytes); apply,
// audit and restore are adoption.mjs's. Planning re-verifies the revision from disk against this
// very base (verifyGuardedRevision) and only reads.
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
import { GUARDED_RECIPE } from './contract.mjs';
import { jsonDifference, sha256 } from './glb.mjs';
import { guardedTargets, verifyGuardedRevision } from './guarded-surface.mjs';
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
const servedFile = (record) => ({ ...identity(record), triangles: record.triangles ?? null });

/** Plan a guarded-surface@1 revision on its applied base. Nothing has a default. */
export async function planGuardedAdoption(
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
    fail('A guarded adoption is planned on its applied base (--base-adoption)');
  if (typeof requested !== 'string' || !requested)
    fail('A guarded adoption needs its revision (--revision); there is no default');
  if (typeof id !== 'string' || !id)
    fail('A guarded adoption needs a new adoption id (--adoption); there is no default');
  adoptionDirectory(root, baseId);
  const directory = adoptionDirectory(root, id);
  if (id === baseId) fail(`A guarded adoption needs a new id, not its base's ${baseId}`);
  if (!replanning && existsSync(directory))
    fail(
      `${ADOPTION_DIRECTORY}/${id} already exists; adoption records are never reused, choose a new --adoption id`,
    );
  if (!Array.isArray(acceptance) || !acceptance.length)
    fail("A guarded adoption needs this revision's own acceptance documents (--acceptance)");
  if (acceptance.some((relative) => DEFAULT_ACCEPTANCE.includes(relative)))
    fail('the r04 acceptance documents accepted earlier candidates, not this revision');
  rules ??= await loadEligibilityRules(root);

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
  if (manifest.recipe !== GUARDED_RECIPE)
    fail(`${revision.relative} is not a ${GUARDED_RECIPE} revision`);
  checkRevision(
    manifest,
    read['runtime-index.json'].value,
    read['verification.json'].value,
    revision.relative,
    { base: { id: baseId, planSha256: base.planSha256 } },
  );
  const report = await verifyGuardedRevision(root, revision.relative, {
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

  // The graph: the base cloned, the listed primaries replaced.
  const targets = guardedTargets(base, manifest.scope.models),
    records = new Map(manifest.files.map((record) => [record.modelKey, record])),
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
      recipe: GUARDED_RECIPE,
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
  for (const [key, entry] of Object.entries(baseGraph.models)) {
    const record = records.get(key);
    if (!record) {
      graph.models[key] = { ...structuredClone(entry), ...lineage(entry) };
      continue;
    }
    const target = targets.find((item) => item.key === key);
    if (
      !target ||
      record.selection !== entry.selection ||
      jsonDifference(record.source, {
        ...identity(entry.primary),
        triangles: entry.primary.triangles ?? null,
        original: identity(entry.primary.source),
      })
    )
      fail(`${key}: the revision does not replace exactly the base's current primary`);
    const was = lineage(entry),
      output = record.output,
      next = {
        ...structuredClone(entry),
        primary: {
          url: output.url,
          sha256: output.sha256,
          bytes: output.bytes,
          triangles: output.triangles,
          extensionsRequired: output.extensionsRequired,
          maximumTextureEdge: entry.primary.maximumTextureEdge,
          candidate: record.id,
          // The true original, never the superseded served file.
          source: structuredClone(entry.primary.source),
        },
        candidateRevision: revision.relative,
        adoptedBy: id,
        supersedes: {
          adoption: was.adoptedBy,
          candidateRevision: was.candidateRevision,
          primary: servedFile(entry.primary),
          lods: entry.lods.map(servedFile),
        },
      };
    if (entry.selection === SELECTION.startup) {
      // The startup record follows its new primary; what it was, stays recorded.
      next.supersedes.startup = structuredClone(entry.startup);
      next.supersedes.identicalFullCandidate = entry.identicalFullCandidate ?? null;
      next.supersedes.farTriangles = entry.farTriangles ?? null;
      next.startup = {
        ...structuredClone(entry.startup),
        record: record.id,
        url: output.url,
        sha256: output.sha256,
        bytes: output.bytes,
        derivation: { recipe: GUARDED_RECIPE, from: identity(entry.primary) },
      };
      next.identicalFullCandidate = null;
      if (entry.farTriangles)
        next.farTriangles = {
          before: entry.farTriangles.before,
          after: output.triangles,
          added: output.triangles - entry.farTriangles.before,
        };
    }
    graph.models[key] = next;
    copies.set(output.url, {
      url: output.url,
      sha256: output.sha256,
      bytes: output.bytes,
      from: `${revision.relative}/${output.file}`,
      to: `public${output.url}`,
    });
    if (!retired.has(entry.primary.url)) {
      retired.add(entry.primary.url);
      superseded.push({
        modelKey: key,
        role: entry.selection === SELECTION.startup ? 'startup' : 'model',
        reason: `superseded-by-${id}`,
        ...identity(entry.primary),
        triangles: entry.primary.triangles ?? null,
        from: `${was.candidateRevision}/${entry.primary.url.slice(1)}`,
      });
    }
  }
  for (const [url, texture] of Object.entries(baseGraph.textures))
    graph.textures[url] = { ...structuredClone(texture), ...lineage(texture) };
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

  const compatibility = await inheritedImageCompatibility(root, base.record, graph);
  if (compatibility.problems.length)
    fail(
      `The current runtime no longer loads the inherited standalone images with the same meaning: ${compatibility.problems.slice(0, 8).join('; ')}. Nothing was planned.`,
    );

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
  const plan = {
    schema: ADOPTION_PLAN_SCHEMA,
    adoption: id,
    options: { revision: revision.relative, acceptance: [...acceptance], base: baseId },
    recipe: GUARDED_RECIPE,
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
    totals: {
      adoptedModels: Object.keys(graph.models).length,
      replacedPrimaries: records.size,
      copies: copyList.length,
      copyBytes: sum(copyList.map((item) => item.bytes)),
      supersededFiles: superseded.length,
      supersededBytes: sum(superseded.map((item) => item.bytes)),
      rewrittenManifests: operations.length,
    },
    atomicity: `apply replaces one file at a time (temporary file, then rename) and journals its progress; it is not a multi-file transaction. A partial application names two adoptions and is refused by apply and by the builds; restore returns every manifest to ${baseId}'s applied bytes.`,
  };
  const review = {
    adoption: id,
    base: baseId,
    recipe: GUARDED_RECIPE,
    note: 'informational; not part of plan.json and not compared by apply',
    targets: states,
    runtimeLiterals: await runtimeLiterals(root, graph),
  };
  return { plan, planBytes: Buffer.from(json(plan), 'utf8'), before, after, review };
}
