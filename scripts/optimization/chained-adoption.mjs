// Chained adoption: a partial candidate revision (generate-candidates.mjs --base-adoption) adopted
// on top of the applied complete adoption it was derived against (the base).
//
// The result is ONE complete graph under ONE new adoption id, so the builds keep seeing a single
// active adoption and keep refusing manifests that name two:
//   - the base graph is cloned. Only the revision's scoped ordinary models are replaced, by its
//     verified candidates. A scoped file whose candidate is byte-identical to the one the base
//     serves stays served as it is. Every other entry keeps its served files, selection, cleared
//     LODs and evidence exactly: startup actors, sole-primary full models and their rejected
//     LODs, cave images, kept images and unadopted models;
//   - the replaced files join `retired` (never a URL that is still served);
//   - every entry and image records its lineage. `candidateRevision` is the revision that
//     generated the files it serves: the base's revision for retained files, never the partial
//     revision. `adoptedBy` is the adoption that first served them. A replaced entry carries
//     `supersedes`; the rewrite treats it as replaced only when `adoptedBy` is this graph's id
//     (an exact repack on a chained base carries the earlier chain's `supersedes` forward).
// The manifests are rewritten from their current bytes, which are the base's applied bytes and
// are saved in before/. Every adopted record moves to the new id: model records, and the
// provenance of cave images. Besides that, only a replaced model's url/sha256/bytes(/triangles)
// and its lineage change; every `original` stays exactly the true original. Restore therefore
// returns the manifests byte for byte to the base. Apply, audit and restore are adoption.mjs's.
// Nothing in the base record or in either candidate revision is ever written.
//
// The inherited standalone images keep their meaning only if the current runtime still loads
// them as the base revision planned them. Plan (and apply, which re-plans) and audit re-plan
// them from the base revision and the base's saved pre-apply manifests against the current
// runtime files, exactly as a complete adoption's audit does (adoption.mjs runtimeCompatibility).
// They then check that the graph serves each one as the revision recorded it.
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import {
  ADOPTION_DIRECTORY,
  ADOPTION_GRAPH_SCHEMA,
  ADOPTION_PLAN_SCHEMA,
  RUNTIME_FIELD,
  adoptionDirectory,
  checkModelUrl,
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
  inputDifferences,
  rewriteRecords,
  runtimeCompatibility,
  runtimeLiterals,
  targetState,
  valueAt,
} from './adoption.mjs';
import { GUARDED_RECIPE } from './contract.mjs';
import { jsonDifference, sha256 } from './glb.mjs';
import { loadEligibilityRules } from './inventory.mjs';
import { resolveCandidateFile, resolveRevisionDirectory } from './paths.mjs';
import { checkPartialRevision, readBaseAdoption, recordEdges } from './revision-scope.mjs';

const REVISION_RECORDS = Object.freeze([
  'manifest.json',
  'runtime-index.json',
  'verification.json',
]);
const fail = (message) => {
  throw new Error(message);
};
const plainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const identity = (record) => ({ url: record?.url, sha256: record?.sha256, bytes: record?.bytes });
const sameFile = (a, b) => a?.url === b?.url && a?.sha256 === b?.sha256 && a?.bytes === b?.bytes;
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const servedFile = (record) => ({
  ...identity(record),
  triangles: record.triangles ?? null,
  ...(record.scene !== undefined ? { scene: record.scene } : {}),
});

/** Every URL a graph serves: model and LOD files, adopted images and kept original images. */
function servedUrls(graph) {
  return new Set(
    [
      ...Object.values(graph.models).flatMap((entry) => [entry.primary, ...entry.lods]),
      ...Object.values(graph.textures),
      ...graph.keptTextures,
    ].map((record) => record.url),
  );
}

async function listFiles(directory, prefix = '') {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory())
      files.push(...(await listFiles(path.join(directory, entry.name), relative)));
    else files.push(relative);
  }
  return files.sort(byText);
}

// ---------------------------------------------------------------------------------------------
// The chained rewrite. It is pure: plan computes it, and audit re-derives it from before/.

/** Point a served record (model or LOD) at a new file; served statistics follow the file. A packed
 * level also names its scene in that file (the packed-level contract). */
function serve(target, current, served, at, allowed) {
  target.url = served.url;
  target.sha256 = served.sha256;
  target.bytes = served.bytes;
  allowed.push(`${at}.url`, `${at}.sha256`, `${at}.bytes`);
  if (Object.hasOwn(current, 'triangles')) {
    target.triangles = served.triangles;
    allowed.push(`${at}.triangles`);
  }
  if (served.scene !== undefined) {
    target.scene = served.scene;
    allowed.push(`${at}.scene`);
  } else if (Object.hasOwn(target, 'scene')) {
    delete target.scene;
    allowed.push(`${at}.scene`);
  }
}

/** The leaf JSON paths where `a` and `b` differ (the same walk as adoption.mjs changedPaths). */
function leafChanges(a, b, where, out = []) {
  if (a === b) return out;
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length)
    a.forEach((value, index) => leafChanges(value, b[index], `${where}[${index}]`, out));
  else if (plainObject(a) && plainObject(b))
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (Object.hasOwn(a, key) && Object.hasOwn(b, key))
        leafChanges(a[key], b[key], `${where}.${key}`, out);
      else out.push(`${where}.${key}`);
    }
  else out.push(where);
  return out;
}

/** Whether `graph` itself replaced this entry or image. A carried-forward one may hold the
 * `supersedes` of an earlier chain (an exact repack on a chained base); the base serves it as is. */
const replacedBy = (graph, record) => record.adoptedBy === graph.adoption && !!record.supersedes;

function chainModel(asset, key, entry, graph, where, allowed) {
  const at = `${where} (${key})`,
    baseId = graph.base.adoption,
    field = asset[RUNTIME_FIELD],
    replaced = replacedBy(graph, entry),
    previous = replaced
      ? [entry.supersedes.primary, ...entry.supersedes.lods]
      : [entry.primary, ...entry.lods],
    records = [asset, ...(Array.isArray(asset.lods) ? asset.lods : [])],
    lineage = replaced ? entry.supersedes : entry;
  if (!plainObject(field) || field.adoption !== baseId || field.selection !== entry.selection)
    fail(`${at}: is not the ${entry.selection} record of base adoption ${baseId}`);
  if (
    records.length !== previous.length ||
    records.some(
      (record, index) =>
        !sameFile(record, previous[index]) || record.scene !== previous[index].scene,
    )
  )
    fail(`${at}: does not serve exactly the files (and scenes) base adoption ${baseId} adopted`);
  if (field.candidateRevision !== lineage.candidateRevision)
    fail(
      `${at}: records ${field.candidateRevision}, not ${lineage.candidateRevision}, which generated the files it serves`,
    );
  // The true originals stay exactly as the base recorded them.
  const originalLods =
    entry.selection === SELECTION.ordinary
      ? entry.lods.map((lod) => lod.source)
      : (entry.clearedLods ?? []);
  if (
    !sameFile(field.original, entry.primary.source) ||
    jsonDifference((field.original.lods ?? []).map(identity), originalLods.map(identity))
  )
    fail(`${at}: its recorded original is not the original the graph records`);
  const next = structuredClone(asset),
    runtime = { ...field, adoption: graph.adoption };
  allowed.push(`${where}.${RUNTIME_FIELD}.adoption`);
  if (replaced) {
    serve(next, asset, entry.primary, where, allowed);
    entry.lods.forEach((lod, index) =>
      serve(next.lods[index], asset.lods[index], lod, `${where}.lods[${index}]`, allowed),
    );
    runtime.candidateRevision = entry.candidateRevision;
    runtime.supersedes = {
      adoption: entry.supersedes.adoption,
      candidateRevision: entry.supersedes.candidateRevision,
      ...identity(entry.supersedes.primary),
      lods: entry.supersedes.lods.map(identity),
    };
    allowed.push(
      `${where}.${RUNTIME_FIELD}.candidateRevision`,
      `${where}.${RUNTIME_FIELD}.supersedes`,
    );
    // guarded-surface@1 only. Every other recipe keeps its rewrite exactly as strict as before: a
    // replaced startup entry or a stamp that already holds `supersedes` is refused for them.
    // A replaced startup primary: the stamp names the startup file served now, and an identity
    // with the old full candidate no longer holds (it stays under `supersedes` in the graph).
    const guarded = graph.recipe === GUARDED_RECIPE;
    if (entry.startup && !guarded) fail(`${at}: only ${GUARDED_RECIPE} replaces a startup primary`);
    if (entry.startup) {
      runtime.startupCandidate = {
        record: entry.startup.record,
        url: entry.startup.url,
        sha256: entry.startup.sha256,
        bytes: entry.startup.bytes,
      };
      allowed.push(`${where}.${RUNTIME_FIELD}.startupCandidate`);
      if (!entry.identicalFullCandidate && Object.hasOwn(runtime, 'identicalFullCandidate')) {
        delete runtime.identicalFullCandidate;
        allowed.push(`${where}.${RUNTIME_FIELD}.identicalFullCandidate`);
      }
    }
    // A stamp that already held these objects (an entry replaced again) changes at leaf level:
    // permit exactly the leaves of the objects this rewrite sets, nothing else.
    if (guarded)
      for (const name of ['supersedes', 'startupCandidate'])
        if (Object.hasOwn(field, name))
          allowed.push(
            ...leafChanges(field[name], runtime[name], `${where}.${RUNTIME_FIELD}.${name}`),
          );
  }
  runtime.adoptedBy = entry.adoptedBy;
  allowed.push(`${where}.${RUNTIME_FIELD}.adoptedBy`);
  next[RUNTIME_FIELD] = runtime;
  return next;
}

/** A cave image keeps its size and uvSource. A retained one keeps its served file and only moves
 * its provenance to the new id. A replaced one (`supersedes`, an exact repack) serves its new file
 * and records the file it supersedes. */
function chainTexture(next, url, texture, graph, where, allowed) {
  const at = `${where}.${texture.manifestEntry}`,
    baseId = graph.base.adoption,
    record = valueAt(next, texture.manifestEntry),
    field = record?.provenance?.[RUNTIME_FIELD],
    replaced = replacedBy(graph, texture),
    previous = replaced ? texture.supersedes : texture,
    lineage = previous;
  if (
    !plainObject(record) ||
    !sameFile(record, previous) ||
    record.image?.width !== texture.width ||
    record.image?.height !== texture.height ||
    record.uvSource?.width !== texture.uvSource.width ||
    record.uvSource?.height !== texture.uvSource.height
  )
    fail(
      `${at}: is not ${previous.url} at ${texture.width}x${texture.height} with uvSource ${texture.uvSource.width}x${texture.uvSource.height}`,
    );
  if (
    !plainObject(field) ||
    field.adoption !== baseId ||
    field.candidateRevision !== lineage.candidateRevision ||
    !sameFile(field.original, { url, sha256: texture.source.sha256, bytes: texture.source.bytes })
  )
    fail(`${at}: its provenance is not base adoption ${baseId}'s record of the original ${url}`);
  const runtime = { ...field, adoption: graph.adoption };
  allowed.push(`${at}.provenance.${RUNTIME_FIELD}.adoption`);
  if (replaced) {
    record.url = texture.url;
    record.sha256 = texture.sha256;
    record.bytes = texture.bytes;
    runtime.candidateRevision = texture.candidateRevision;
    runtime.supersedes = {
      adoption: texture.supersedes.adoption,
      candidateRevision: texture.supersedes.candidateRevision,
      ...identity(texture.supersedes),
    };
    allowed.push(
      `${at}.url`,
      `${at}.sha256`,
      `${at}.bytes`,
      `${at}.provenance.${RUNTIME_FIELD}.candidateRevision`,
      `${at}.provenance.${RUNTIME_FIELD}.supersedes`,
    );
  }
  runtime.adoptedBy = texture.adoptedBy;
  allowed.push(`${at}.provenance.${RUNTIME_FIELD}.adoptedBy`);
  record.provenance = { ...record.provenance, [RUNTIME_FIELD]: runtime };
}

/** The chained rewrite of one manifest from the base's applied bytes, or null when it holds no
 * adopted record (see rewriteRecords). */
export function rewriteChainedManifestBytes(relative, bytes, graph) {
  if (!plainObject(graph.base)) fail(`${graph.adoption} is not a chained graph`);
  return rewriteRecords(relative, bytes, (asset, where, allowed, touched) => {
    const key = asset?.modelKey,
      entry =
        typeof key === 'string' && Object.hasOwn(graph.models, key) ? graph.models[key] : null,
      owned = Object.entries(graph.textures).filter(([, texture]) => texture.owner === key);
    for (const kept of graph.keptTextures.filter((item) => item.owner === key)) {
      const record = valueAt(asset, kept.manifestEntry);
      if (
        !sameFile(record, kept) ||
        record.uvSource !== undefined ||
        record.provenance !== undefined
      )
        fail(
          `${where}.${kept.manifestEntry}: the original ${kept.url} is no longer kept unchanged`,
        );
    }
    if (!entry && !owned.length) {
      if (plainObject(asset) && Object.hasOwn(asset, RUNTIME_FIELD))
        fail(`${where} (${key}): carries ${RUNTIME_FIELD}, but the graph does not adopt it`);
      return asset;
    }
    const next = entry
      ? chainModel(asset, key, entry, graph, where, allowed)
      : structuredClone(asset);
    if (entry) touched.models.push(key);
    for (const [url, texture] of owned) {
      chainTexture(next, url, texture, graph, where, allowed);
      touched.textures.push(url);
    }
    return next;
  });
}

// ---------------------------------------------------------------------------------------------
// Inherited standalone images

/** The graph's standalone images are exactly the base revision's image records. Each candidate is
 * served with its recorded identity and size, `uvSource` set to the original size, and the
 * recorded wrap and colour space. Each image already within the edge keeps its original. Nothing
 * else is served or kept. A revision without images needs a graph without images. */
export function inheritedImageProblems(graph, revision) {
  const problems = [],
    served = new Set(),
    kept = new Set();
  for (const image of revision.images ?? []) {
    const { plan, output } = image,
      source = plan?.source;
    if (!source) {
      problems.push(`${image.id}: the revision records no source`);
      continue;
    }
    if (output) {
      served.add(source.url);
      const texture = Object.hasOwn(graph.textures, source.url) ? graph.textures[source.url] : null;
      // An exact repack serves a lossless rewrite of the revision's output (`exactOf`), verified
      // when it was planned; its size, uvSource, wrap and colour space are the output's.
      if (
        !texture ||
        texture.owner !== plan.owner ||
        texture.manifestEntry !== plan.manifestEntry ||
        !sameFile(texture.exactOf ?? texture, output) ||
        texture.width !== output.width ||
        texture.height !== output.height ||
        texture.uvSource?.width !== source.width ||
        texture.uvSource?.height !== source.height ||
        texture.wrap !== plan.uv?.wrap ||
        texture.colorSpace !== plan.colorSpace ||
        !sameFile(texture.source, source)
      )
        problems.push(
          `${image.id}: the graph does not serve ${output.url} as the revision recorded it`,
        );
    } else {
      kept.add(source.url);
      const entry = graph.keptTextures.find((item) => item.url === source.url);
      if (
        !entry ||
        entry.owner !== plan.owner ||
        entry.manifestEntry !== plan.manifestEntry ||
        !sameFile(entry, source)
      )
        problems.push(`${image.id}: the graph does not keep the original ${source.url}`);
    }
  }
  for (const url of Object.keys(graph.textures))
    if (!served.has(url))
      problems.push(`${url}: the graph serves an image the revision did not record`);
  for (const item of graph.keptTextures)
    if (!kept.has(item.url))
      problems.push(`${item.url}: the graph keeps an image the revision did not record`);
  return problems;
}

/**
 * The base's standalone images re-planned with the current runtime files: from the base revision's
 * manifest and the base's saved pre-apply manifests, each read and checked against the hashes the
 * base recorded. Then they are compared with what `graph` serves. `base` is a base record
 * (readBaseAdoption's `record`, or a chained plan's `base`). Returns `{ problems, record }`.
 * `record` is null when the base revision has no standalone images. It names the current runtime
 * inputs and whether they changed since the base was planned. Nothing is written.
 */
export async function inheritedImageCompatibility(root, base, graph) {
  try {
    const directory = adoptionDirectory(root, base.adoption),
      planBytes = await readFile(path.join(directory, 'plan.json'));
    if (sha256(planBytes) !== base.planSha256)
      return {
        problems: [`${base.directory}/plan.json changed since it was recorded`],
        record: null,
      };
    const basePlan = JSON.parse(planBytes.toString('utf8'));
    // A chained base inherited its images too: they were planned by the chain's complete root.
    if (basePlan.base) return inheritedImageCompatibility(root, basePlan.base, graph);
    const [manifestFile] = base.candidateRevision.files,
      manifestBytes = await readFile(path.join(root, ...manifestFile.path.split('/')));
    if (
      manifestBytes.length !== manifestFile.bytes ||
      sha256(manifestBytes) !== manifestFile.sha256
    )
      return {
        problems: [`${manifestFile.path} changed since the base was planned`],
        record: null,
      };
    const revision = JSON.parse(manifestBytes.toString('utf8')),
      saved = new Map(basePlan.inputs.manifests.map((input) => [input.path, input.sha256])),
      result = await runtimeCompatibility(root, revision, {
        inventory: { models: revision.models },
        // The base's plan proved character exclusion; this re-plan reads only the camp-cave folder.
        rules: { characterModels: [], excludedSpecies: [] },
        readManifest: async (relative) => {
          if (!saved.has(relative))
            fail(`${relative} is not a manifest base adoption ${base.adoption} saved`);
          const bytes = await readFile(path.join(directory, 'before', ...relative.split('/')));
          if (sha256(bytes) !== saved.get(relative))
            fail(
              `${base.directory}/before/${relative} is not the pre-apply manifest its plan recorded`,
            );
          return bytes;
        },
      });
    return {
      problems: [...result.problems, ...inheritedImageProblems(graph, revision)],
      record: result.record && {
        ...result.record,
        inherited: {
          adoption: base.adoption,
          candidateRevision: base.candidateRevision.directory,
          manifests: `${base.directory}/before`,
          changedSinceBase: !!jsonDifference(
            basePlan.runtimeCompatibility?.inputs ?? null,
            result.record.inputs,
          ),
        },
      },
    };
  } catch (error) {
    return { problems: [error.message], record: null };
  }
}

// ---------------------------------------------------------------------------------------------
// Plan

/**
 * Plan the partial revision `revision` on the applied adoption `base` under the new id `adoption`.
 * Nothing has a default: the base, the revision, a new id and this revision's own acceptance
 * documents are required (the base's acceptance never covers new images). This only reads files;
 * writePlan stores the result. `replanning` is set by apply, whose record already exists.
 */
export async function planChainedAdoption(
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
    fail('A chained adoption needs its applied base adoption (--base-adoption)');
  if (typeof requested !== 'string' || !requested)
    fail('A chained adoption needs its partial revision (--revision); there is no default');
  if (typeof id !== 'string' || !id)
    fail('A chained adoption needs a new adoption id (--adoption); there is no default');
  adoptionDirectory(root, baseId);
  const directory = adoptionDirectory(root, id);
  if (id === baseId) fail(`A chained adoption needs a new id, not its base's ${baseId}`);
  if (!replanning && existsSync(directory))
    fail(
      `${ADOPTION_DIRECTORY}/${id} already exists; adoption records are never reused, choose a new --adoption id`,
    );
  if (!Array.isArray(acceptance) || !acceptance.length)
    fail(
      "A chained adoption needs this revision's own acceptance documents (--acceptance); the base's acceptance does not cover new candidates",
    );
  const earlier = acceptance.filter((relative) => DEFAULT_ACCEPTANCE.includes(relative));
  if (earlier.length)
    fail(`${earlier.join(', ')} accepted earlier candidates, not this revision's`);
  rules ??= await loadEligibilityRules(root);

  // The base: applied, unchanged, its manifests current and its files exactly as recorded.
  const base = await readBaseAdoption(root, baseId, rules),
    baseGraph = base.graph,
    reused = acceptance.filter((relative) =>
      (base.plan.acceptance?.documents ?? []).some((document) => document.path === relative),
    );
  if (reused.length)
    fail(
      `${reused.join(', ')} accepted base adoption ${baseId}'s candidates, not this revision's; name this revision's own acceptance documents`,
    );
  const documents = await acceptanceDocuments(root, acceptance);

  // The partial revision: its own records, verified against exactly this base, and nothing else.
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
  checkRevision(
    manifest,
    read['runtime-index.json'].value,
    read['verification.json'].value,
    revision.relative,
    { base },
  );
  const mismatches = checkPartialRevision(manifest, base).flatMap(({ name, problems }) =>
    problems.map((problem) => `${name}: ${problem}`),
  );
  if (mismatches.length)
    fail(
      `${revision.relative} does not match base adoption ${baseId}: ${mismatches.slice(0, 8).join('; ')}`,
    );
  for (const record of manifest.files) recordEdges(manifest, record);
  const eligibility = inputDifferences(
    'The eligibility inputs',
    manifest.inputs?.eligibility,
    rules.inputs,
  );
  if (eligibility)
    fail(`${eligibility}. The candidate revision is stale for these inputs; nothing was planned.`);
  const listed = new Set([
      ...REVISION_RECORDS,
      ...manifest.files.map((record) => record.output.file),
    ]),
    extra = (await listFiles(revision.absolute)).filter((file) => !listed.has(file));
  if (extra.length)
    fail(`${revision.relative} holds files it does not record: ${extra.slice(0, 8).join(', ')}`);

  // Protected entries stay exactly as reviewed: the decoder and every LOD rejection.
  const decoder = await decoderIdentity(root);
  if (jsonDifference(decoder, baseGraph.decoder))
    fail(
      `The meshopt decoder is not the one base adoption ${baseId} recorded; plan a complete adoption for this Three release`,
    );
  for (const [key, rule] of Object.entries(lodRejections)) {
    const entry = Object.hasOwn(baseGraph.models, key) ? baseGraph.models[key] : null;
    if (!entry) continue;
    if (
      entry.selection !== SELECTION.full ||
      entry.lodRejection?.decision !== rule.decision ||
      jsonDifference(entry.lodRejection.reviewed, rule.reviewed)
    )
      fail(
        `${key}: base adoption ${baseId} does not carry its reviewed LOD rejection; review it again`,
      );
    if (
      jsonDifference(
        await evidenceIdentities(root, rule.evidence, 'LOD rejection evidence'),
        entry.lodRejection.evidence,
      )
    )
      fail(`${key}: its LOD rejection evidence changed since base adoption ${baseId}`);
  }

  // The graph: the base cloned, the scoped ordinary entries replaced.
  const only = new Set(manifest.scope.only),
    lineage = (record) => ({
      candidateRevision: record.candidateRevision ?? baseGraph.candidateRevision,
      adoptedBy: record.adoptedBy ?? baseId,
    }),
    records = new Map(manifest.files.map((record) => [record.source.url, record])),
    archived = new Map(base.plan.operations.copies.map((copy) => [copy.url, copy])),
    baseServed = servedUrls(baseGraph),
    retired = new Set(baseGraph.retired),
    copies = new Map(),
    graph = {
      schema: ADOPTION_GRAPH_SCHEMA,
      adoption: id,
      // The revision this adoption adds. Each entry names the revision that generated its files.
      candidateRevision: revision.relative,
      base: {
        adoption: baseId,
        planSha256: base.planSha256,
        candidateRevision: baseGraph.candidateRevision,
      },
      scope: [...only].sort(byText),
      decoder,
      models: {},
      notAdopted: structuredClone(baseGraph.notAdopted),
      lodRejections: structuredClone(baseGraph.lodRejections),
      textures: {},
      keptTextures: structuredClone(baseGraph.keptTextures),
      retired: [],
      retiredCandidates: structuredClone(baseGraph.retiredCandidates ?? []),
    };
  let scopedFiles = 0;
  for (const [key, entry] of Object.entries(baseGraph.models)) {
    if (!only.has(key)) {
      graph.models[key] = { ...structuredClone(entry), ...lineage(entry) };
      continue;
    }
    // checkPartialRevision proved the scope: ordinary, not an actor, a full model or an image
    // owner, sharing no file. Each served file is replaced by the record of its own original.
    const model = manifest.models.find((item) => item.modelKey === key),
      previous = [entry.primary, ...entry.lods],
      replacements = (model?.files ?? []).map((file) => records.get(file.url));
    if (
      entry.selection !== SELECTION.ordinary ||
      replacements.length !== previous.length ||
      replacements.some((record) => !record)
    )
      fail(`${key}: the revision does not replace exactly its ${previous.length} served file(s)`);
    const served = [];
    for (const [index, record] of replacements.entries()) {
      const current = previous[index],
        source = current.source,
        output = record.output;
      if (!sameFile(record.source, source))
        fail(
          `${record.id}: derived from ${record.source.url}, not the original ${source.url} the base recorded`,
        );
      if (!Number.isSafeInteger(output?.triangles))
        fail(`${record.id}: the candidate record does not state the triangles it serves`);
      if (output.url !== `/${output.file}` || !checkModelUrl(output.url, output.sha256))
        fail(`${record.id}: candidate ${output.url} is not content-addressed`);
      const bytes = await readFile(resolveCandidateFile(revision.absolute, output.file));
      if (bytes.length !== output.bytes || sha256(bytes) !== output.sha256)
        fail(
          `${record.id}: ${revision.relative}/${output.file} no longer matches its record; the candidate is corrupt`,
        );
      const now = {
        url: output.url,
        sha256: output.sha256,
        bytes: output.bytes,
        triangles: output.triangles,
        extensionsRequired: output.extensionsRequired,
        maximumTextureEdge: output.maximumTextureEdge,
        candidate: record.id,
        source: structuredClone(source),
      };
      served.push(now);
      scopedFiles++;
      // Byte-identical to what the base serves: the same file stays served.
      if (sameFile(now, current)) continue;
      if (baseServed.has(now.url) || retired.has(now.url) || base.current.files.has(now.url))
        fail(
          `${record.id}: ${now.url} is already served, retired or delivered; it is never reused`,
        );
      const known = copies.get(now.url);
      if (known && (known.sha256 !== now.sha256 || known.bytes !== now.bytes))
        fail(`${now.url} is recorded twice with different content`);
      copies.set(now.url, {
        url: now.url,
        sha256: now.sha256,
        bytes: now.bytes,
        from: `${revision.relative}/${output.file}`,
        to: `public${now.url}`,
      });
      const copy = archived.get(current.url);
      if (!copy) fail(`${key}: base adoption ${baseId} recorded no copy of ${current.url}`);
      retired.add(current.url);
      graph.retiredCandidates.push({
        modelKey: key,
        role: index ? 'lod' : 'model',
        reason: `superseded-by-${id}`,
        url: current.url,
        sha256: current.sha256,
        bytes: current.bytes,
        triangles: current.triangles ?? null,
        from: copy.from,
      });
    }
    const was = lineage(entry);
    graph.models[key] = {
      selection: SELECTION.ordinary,
      manifests: [...entry.manifests],
      primary: served[0],
      lods: served.slice(1),
      candidateRevision: revision.relative,
      adoptedBy: id,
      supersedes: {
        adoption: was.adoptedBy,
        candidateRevision: was.candidateRevision,
        primary: servedFile(entry.primary),
        lods: entry.lods.map(servedFile),
      },
    };
  }
  for (const [url, texture] of Object.entries(baseGraph.textures))
    graph.textures[url] = { ...structuredClone(texture), ...lineage(texture) };

  // Retired files: never one that is still served, nor one an unadopted model still delivers.
  const nowServed = servedUrls(graph);
  for (const url of retired)
    if (nowServed.has(url)) fail(`${url} would be both served and retired`);
  for (const model of base.current.models)
    if (!Object.hasOwn(graph.models, model.modelKey))
      for (const file of model.files)
        if (retired.has(file.url))
          fail(`${file.url} is retired, but ${model.modelKey} (not adopted) still delivers it`);
  graph.retired = [...retired].sort(byText);

  // The inherited standalone images must still mean what the base revision planned, under the
  // current runtime files. Apply re-plans, so a runtime change after the plan stops it.
  const compatibility = await inheritedImageCompatibility(root, base.record, graph);
  if (compatibility.problems.length)
    fail(
      `The current runtime no longer loads base adoption ${baseId}'s standalone images with the same meaning: ${compatibility.problems.slice(0, 8).join('; ')}. Nothing was planned.`,
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
      fail(
        `${key}: the chained rewrite does not cover exactly its manifests ${entry.manifests.join(', ')}`,
      );
  for (const [url, texture] of Object.entries(graph.textures))
    if (jsonDifference(touchedTextures.get(url) ?? [], texture.manifests))
      fail(
        `${url}: the chained rewrite does not cover exactly its manifests ${texture.manifests.join(', ')}`,
      );
  if (
    jsonDifference(
      operations.map((operation) => operation.path),
      base.record.rewrittenManifests.map((operation) => operation.path),
    )
  )
    fail(
      `The chained rewrite does not cover exactly the manifests base adoption ${baseId} rewrote`,
    );

  const copyList = [...copies.values()].sort((a, b) => byText(a.url, b.url)),
    targets = { absent: 0, present: 0 };
  for (const copy of copyList) targets[await targetState(root, copy)]++;
  const entries = Object.values(graph.models),
    superseded = graph.retiredCandidates.filter((item) => item.reason === `superseded-by-${id}`),
    sum = (values) => values.reduce((total, value) => total + value, 0),
    totals = {
      adoptedModels: entries.length,
      startupActors: entries.filter((entry) => entry.selection === SELECTION.startup).length,
      fullOnlyModels: entries.filter((entry) => entry.selection === SELECTION.full).length,
      clearedLods: sum(entries.map((entry) => entry.clearedLods?.length ?? 0)),
      supersededModels: only.size,
      replacedFiles: superseded.length,
      unchangedFiles: scopedFiles - superseded.length,
      retiredCandidates: graph.retiredCandidates.length,
      addedFarTriangles: sum(entries.map((entry) => entry.farTriangles?.added ?? 0)),
      standaloneTextures: Object.keys(graph.textures).length,
      keptTextures: graph.keptTextures.length,
      notAdopted: Object.keys(graph.notAdopted).length,
      copies: copyList.length,
      copyBytes: sum(copyList.map((copy) => copy.bytes)),
      rewrittenManifests: operations.length,
      supersededBytes: sum(superseded.map((item) => item.bytes)),
      servedBytes: sum(copyList.map((copy) => copy.bytes)),
    };
  const plan = {
    schema: ADOPTION_PLAN_SCHEMA,
    adoption: id,
    options: { revision: revision.relative, acceptance: [...acceptance], base: baseId },
    base: { ...base.record, acceptance: structuredClone(base.plan.acceptance?.documents ?? []) },
    candidateRevision: {
      directory: revision.relative,
      revision: manifest.revision,
      files: REVISION_RECORDS.map((name) => read[name].identity),
    },
    acceptance: { documents },
    inputs: { manifests: base.current.manifests, eligibility: rules.inputs },
    // The partial revision has no standalone images. The base's are re-planned against the
    // current runtime (null when the base revision has none); audit compares their inputs.
    runtimeCompatibility: compatibility.record,
    operations: { copies: copyList, manifests: operations },
    graph,
    totals,
    atomicity: `apply replaces one file at a time (temporary file, then rename) and journals its progress; it is not a multi-file transaction. A partial application names two adoptions and is refused by apply and by the builds; restore returns every manifest to base adoption ${baseId}'s applied bytes.`,
  };
  const review = {
    adoption: id,
    base: baseId,
    note: 'informational; not part of plan.json and not compared by apply',
    targets,
    runtimeLiterals: await runtimeLiterals(root, graph),
  };
  return { plan, planBytes: Buffer.from(json(plan), 'utf8'), before, after, review };
}

// ---------------------------------------------------------------------------------------------
// Audit

/**
 * Source correspondence of a chained plan, for auditAdoption:
 *   - the base record is unchanged and still the applied record of its plan;
 *   - before/ holds exactly the base's applied bytes;
 *   - the base's after/ files are unchanged;
 *   - after/ is exactly the chained rewrite of before/.
 */
export async function chainedCorrespondence(root, plan, saved) {
  const problems = [],
    { base, graph } = plan;
  try {
    const directory = adoptionDirectory(root, base.adoption),
      planBytes = await readFile(path.join(directory, 'plan.json')),
      journal = JSON.parse(await readFile(path.join(directory, 'journal.json'), 'utf8'));
    if (sha256(planBytes) !== base.planSha256)
      problems.push(`${base.directory}/plan.json changed since this adoption was planned`);
    if (journal.planSha256 !== base.planSha256 || journal.state !== 'applied')
      problems.push(
        `${base.directory}/journal.json is not the applied record of its plan (${journal.state})`,
      );
    const basePlan = JSON.parse(planBytes.toString('utf8')),
      expected = new Map(basePlan.inputs.manifests.map((input) => [input.path, input.sha256])),
      recorded = new Map(plan.inputs.manifests.map((input) => [input.path, input.sha256]));
    for (const operation of basePlan.operations.manifests)
      expected.set(operation.path, operation.after.sha256);
    for (const [file, digest] of expected)
      if (recorded.get(file) !== digest)
        problems.push(
          `${file}: the saved bytes are not base adoption ${base.adoption}'s applied bytes`,
        );
    for (const file of recorded.keys())
      if (!expected.has(file))
        problems.push(`${file} was not covered by base adoption ${base.adoption}`);
    problems.push(
      ...(await fileProblems(
        root,
        basePlan.operations.manifests.map((operation) => ({
          path: `${base.directory}/after/${operation.path}`,
          sha256: operation.after.sha256,
          bytes: operation.after.bytes,
        })),
      )),
    );
  } catch (error) {
    problems.push(error.message);
  }
  for (const input of plan.inputs.manifests) {
    const bytes = saved.before.get(input.path),
      operation = plan.operations.manifests.find((item) => item.path === input.path);
    if (!bytes) continue;
    let rewritten;
    try {
      rewritten = rewriteChainedManifestBytes(input.path, bytes, graph);
    } catch (error) {
      problems.push(`${input.path}: ${error.message}`);
      continue;
    }
    if (!rewritten !== !operation)
      problems.push(
        `${input.path}: ${operation ? 'the plan rewrites it, the graph does not' : 'the graph rewrites it, the plan does not'}`,
      );
    else if (rewritten && !rewritten.bytes.equals(saved.after.get(input.path) ?? Buffer.alloc(0)))
      problems.push(
        `${input.path}: the saved after-bytes are not the chained rewrite of the saved before-bytes`,
      );
  }
  return problems;
}
