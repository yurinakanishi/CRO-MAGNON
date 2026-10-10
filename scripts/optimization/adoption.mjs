// Adoption of an accepted candidate revision into the runtime manifests: plan, apply, audit and
// restore. Nothing here runs implicitly; Codex reviews a plan before running --apply.
//
// plan     Re-verifies four things:
//          - the revision, and its manifest, index and verification;
//          - the acceptance documents;
//          - the current manifests and eligibility inputs, against the revision's inputs;
//          - every original and selected candidate byte.
//          It then computes each asset.json and world-assets.json rewrite in memory. Into a NEW
//          folder assets/runtime-adoption/<id>/ it writes:
//          - before/: the exact bytes of every manifest the revision read;
//          - after/: the planned bytes;
//          - plan.json: the source-to-adopted graph and every operation;
//          - journal.json and review.json.
//          public/ is only read.
// apply    Recomputes that plan from the current files and stops unless it is byte-identical. Then:
//          1. copies candidate bytes to their hash-named URLs in public/models; a different file
//             is never overwritten, and neither is an original;
//          2. replaces each manifest, but only while it still holds its planned before-bytes.
//          Files are replaced one at a time (temporary file, then rename): this is NOT a
//          multi-file transaction. The journal records progress, and a partial application is
//          refused rather than resumed.
// audit    Read-only. It checks:
//          - the saved bytes, and that the after-bytes re-derive from the before-bytes;
//          - originals, candidates and copies;
//          - the current manifests and the active graph.
// restore  Writes the saved before-bytes back, but only into manifests that still hold exactly the
//          adopted bytes. Any other edit stops it before anything is written. Copies stay.
//
// A partial revision is adopted on top of an applied complete adoption with the `base` option
// (chained-adoption.mjs). The resulting plan is one complete graph under one new id; apply,
// audit and restore are the ones here, and restore returns the manifests to the base's bytes.
import { constants, existsSync, realpathSync } from 'node:fs';
import {
  copyFile,
  link,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { runtimeTextureRecords } from '../environment-assets.mjs';
import {
  ADOPTION_DIRECTORY,
  ADOPTION_GRAPH_SCHEMA,
  ADOPTION_JOURNAL_SCHEMA,
  ADOPTION_PLAN_SCHEMA,
  DECODER,
  MESHOPT_EXTENSION,
  RUNTIME_FIELD,
  adoptionDirectory,
  checkModelUrl,
  checkTextureUrl,
  quotedLiterals,
} from '../runtime-graph.mjs';
import {
  CANDIDATE_STATUS,
  EXACT_REPACK_RECIPE,
  GUARDED_RECIPE,
  MANIFEST_SCHEMA,
  MESHOPTIMIZER_VERSION,
  ORIGINAL_KEPT_STATUS,
  STANDALONE_ROLE,
  STARTUP_ROLE,
  runtimeIndexOf,
} from './contract.mjs';
import { jsonDifference, sha256 } from './glb.mjs';
import { sniffImage } from './images.mjs';
import { CATALOG, buildInventory, loadEligibilityRules, readVerifiedSource } from './inventory.mjs';
import {
  DEFAULT_REVISION,
  imageCandidateLocation,
  isInside,
  resolveCandidateFile,
  resolveRevisionDirectory,
} from './paths.mjs';
import { planStandaloneImages, readVerifiedImage } from './standalone-images.mjs';

export const AUDIT_SCHEMA = 'cro-magnon/runtime-adoption-audit@1';
// Codex's r04 decision and image review (2026-10-09); their hashes become the plan's QA identity.
export const DEFAULT_ACCEPTANCE = Object.freeze([
  'output/optimization-audit-20261009/image-review-r04.md',
  'output/optimization-audit-20261009/adoption-contract-r04.md',
]);
export const SELECTION = Object.freeze({
  ordinary: 'ordinary-compressed',
  startup: 'startup-sole-primary',
  full: 'full-sole-primary',
});
// Old far LODs rejected in native gameplay review after the revision was accepted. Such a model
// serves its verified compressed full candidate at every distance and its LODs are cleared. The
// original and candidate low files stay archived, unchanged and retired. A rule applies only to a
// model the revision adopts, and only to the exact files and triangle counts that were reviewed;
// anything else stops the plan for a new review.
export const LOD_REJECTIONS = Object.freeze({
  'violet-behemoth': Object.freeze({
    decision:
      'output/optimization-audit-20261009/adoption-contract-r04.md (native review addendum)',
    observation:
      'In the actual game renderer (FOV 57, gameplay scale 2.5, root distance 26.794 m), the old 7,965-triangle far LOD shows broken face/neck folds and silhouette, even after the normal-map correction. The 45 m view is partly hidden by the cave and establishes nothing.',
    evidence: Object.freeze([
      'output/playwright/optimization-20261009/lod-gameplay-review-r01/violet-behemoth-28m-runtime.png',
      'output/playwright/optimization-20261009/lod-gameplay-review-r01/violet-behemoth-28m-high.png',
    ]),
    reviewed: Object.freeze({
      model: Object.freeze({ url: '/models/violet-behemoth/model-c2.glb', triangles: 39825 }),
      lods: Object.freeze([
        Object.freeze({ url: '/models/violet-behemoth/lod-c2.glb', triangles: 7965 }),
      ]),
    }),
  }),
});
const clearsLods = (entry) => entry.selection !== SELECTION.ordinary;
const VERIFICATION_SCHEMA = 'cro-magnon/optimized-runtime-verification@1';
const RECORD = Object.freeze({
  plan: 'plan.json',
  journal: 'journal.json',
  review: 'review.json',
  before: 'before',
  after: 'after',
});
const IMAGE_EXTENSIONS = Object.freeze(['png', 'jpg', 'jpeg', 'webp']);
// Repository-relative paths: plain segments only (no "", ".", "..", drive or backslash).
const RELATIVE = /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;
const RUNTIME_SOURCES = Object.freeze(['src', 'shared']);

const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const fail = (message) => {
  throw new Error(message);
};
const plainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const identity = (record) => ({ url: record.url, sha256: record.sha256, bytes: record.bytes });
const sameFile = (a, b) => a?.url === b?.url && a?.sha256 === b?.sha256 && a?.bytes === b?.bytes;
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function repoFile(root, relative, what) {
  if (typeof relative !== 'string' || !RELATIVE.test(relative))
    fail(`Unsafe ${what} path ${JSON.stringify(relative)}`);
  return path.join(root, ...relative.split('/'));
}

/** Whether `target` (or its nearest existing ancestor) resolves, through any link, inside `parent`. */
function resolvesInside(parent, target) {
  let existing = target;
  while (!existsSync(existing) && path.dirname(existing) !== existing)
    existing = path.dirname(existing);
  const real = realpathSync.native(existing),
    realParent = realpathSync.native(parent);
  return real === realParent || isInside(realParent, real);
}

export function valueAt(object, entryPath) {
  let value = object;
  for (const part of entryPath.split('.'))
    value = plainObject(value) && Object.hasOwn(value, part) ? value[part] : undefined;
  return value;
}

/** Leaf paths where two parsed JSON values differ (added or removed keys count at the key). */
function changedPaths(a, b, where = '$', out = []) {
  if (a === b) return out;
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length)
    a.forEach((value, index) => changedPaths(value, b[index], `${where}[${index}]`, out));
  else if (plainObject(a) && plainObject(b))
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (Object.hasOwn(a, key) && Object.hasOwn(b, key))
        changedPaths(a[key], b[key], `${where}.${key}`, out);
      else out.push(`${where}.${key}`);
    }
  else out.push(where);
  return out;
}

// ---------------------------------------------------------------------------------------------
// The rewrite. It is pure: plan computes it, and audit re-derives it from the saved before-bytes.

function adoptModel(asset, key, entry, graph, where, allowed) {
  const at = `${where} (${key})`,
    lods = asset.lods ?? [],
    replaced = clearsLods(entry) ? entry.clearedLods : entry.lods.map((lod) => lod.source);
  if (!sameFile(asset, entry.primary.source))
    fail(
      `${at}: the manifest delivers ${asset.url} (${asset.sha256}), not the candidate's source ${entry.primary.source.url} (${entry.primary.source.sha256})`,
    );
  if (
    !Array.isArray(lods) ||
    lods.length !== replaced.length ||
    lods.some((lod, index) => !sameFile(lod, replaced[index]))
  )
    fail(`${at}: its LOD records are not the candidate revision's sources`);
  if (Object.hasOwn(asset, RUNTIME_FIELD)) fail(`${at}: already carries ${RUNTIME_FIELD}`);
  const next = structuredClone(asset),
    serve = (target, original, served, base) => {
      target.url = served.url;
      target.sha256 = served.sha256;
      target.bytes = served.bytes;
      allowed.push(`${base}.url`, `${base}.sha256`, `${base}.bytes`);
      // Served statistics follow the selected file; the original values stay in RUNTIME_FIELD.
      if (Object.hasOwn(original, 'triangles')) {
        target.triangles = served.triangles;
        allowed.push(`${base}.triangles`);
      }
    };
  serve(next, asset, entry.primary, where);
  if (clearsLods(entry)) {
    if (Object.hasOwn(asset, 'lods')) {
      next.lods = [];
      allowed.push(`${where}.lods`);
    }
  } else if (Object.hasOwn(asset, 'lods'))
    asset.lods.forEach((lod, index) =>
      serve(next.lods[index], lod, entry.lods[index], `${where}.lods[${index}]`),
    );
  next[RUNTIME_FIELD] = {
    adoption: graph.adoption,
    candidateRevision: graph.candidateRevision,
    selection: entry.selection,
    original: {
      ...identity(asset),
      ...(Object.hasOwn(asset, 'triangles') ? { triangles: asset.triangles } : {}),
      ...(Object.hasOwn(asset, 'lods') ? { lods: structuredClone(asset.lods) } : {}),
    },
    ...(entry.startup
      ? {
          startupCandidate: {
            record: entry.startup.record,
            url: entry.startup.url,
            sha256: entry.startup.sha256,
            bytes: entry.startup.bytes,
          },
        }
      : {}),
    ...(entry.identicalFullCandidate
      ? { identicalFullCandidate: entry.identicalFullCandidate }
      : {}),
    ...(entry.lodRejection
      ? {
          lodRejection: {
            decision: entry.lodRejection.decision,
            observation: entry.lodRejection.observation,
            addedFarTriangles: entry.farTriangles.added,
          },
        }
      : {}),
  };
  allowed.push(`${where}.${RUNTIME_FIELD}`);
  return next;
}

function adoptTexture(asset, url, texture, graph, where, allowed) {
  const at = `${where}.${texture.manifestEntry}`,
    record = valueAt(asset, texture.manifestEntry),
    { source } = texture;
  if (!plainObject(record)) fail(`${at}: no texture record`);
  if (
    record.url !== url ||
    record.sha256 !== source.sha256 ||
    record.bytes !== source.bytes ||
    record.image?.width !== source.width ||
    record.image?.height !== source.height
  )
    fail(
      `${at}: the manifest records ${record.url} (${record.sha256}), not the candidate's source ${url} (${source.sha256})`,
    );
  for (const field of ['uvSource', 'provenance'])
    if (Object.hasOwn(record, field)) fail(`${at}: already has ${field}`);
  record.url = texture.url;
  record.sha256 = texture.sha256;
  record.bytes = texture.bytes;
  record.image = { ...record.image, width: texture.width, height: texture.height };
  // Atlas rectangles stay normalised by the original pixel size.
  record.uvSource = { width: texture.uvSource.width, height: texture.uvSource.height };
  record.provenance = {
    [RUNTIME_FIELD]: {
      adoption: graph.adoption,
      candidateRevision: graph.candidateRevision,
      original: {
        url,
        sha256: source.sha256,
        bytes: source.bytes,
        image: { width: source.width, height: source.height },
      },
    },
  };
  allowed.push(
    ...['url', 'sha256', 'bytes', 'image.width', 'image.height', 'uvSource', 'provenance'].map(
      (field) => `${at}.${field}`,
    ),
  );
}

/**
 * Rewrite the asset records of one manifest with `adopt(asset, where, allowed, touched)`, which
 * returns the asset itself to leave it alone, pushes every JSON path it may change to `allowed`
 * and the model keys and texture URLs it adopts to `touched.models`/`touched.textures`. Returns
 * null when nothing changes. Every changed path must be an allowed one, and the file must already
 * be canonical `JSON.stringify(value, null, 2)` output, so unrelated content keeps its exact bytes.
 */
export function rewriteRecords(relative, bytes, adopt) {
  const source = bytes.toString('utf8'),
    parsed = JSON.parse(source),
    allowed = [],
    models = [],
    textures = [],
    touched = { models, textures };
  let next;
  if (relative === CATALOG) {
    if (!Array.isArray(parsed.assets)) fail(`${relative} has no assets array`);
    const assets = parsed.assets.map((asset, index) =>
      adopt(asset, `$.assets[${index}]`, allowed, touched),
    );
    next = assets.some((asset, index) => asset !== parsed.assets[index])
      ? { ...parsed, assets }
      : parsed;
  } else next = adopt(parsed, '$', allowed, touched);
  if (next === parsed) return null;
  const newline = source.endsWith('\n') ? '\n' : '';
  if (JSON.stringify(parsed, null, 2) + newline !== source)
    fail(
      `${relative} is not laid out as JSON.stringify(value, null, 2); rewriting it would reformat unrelated content`,
    );
  const permitted = new Set(allowed),
    changes = changedPaths(parsed, next),
    unexpected = changes.filter((change) => !permitted.has(change));
  if (unexpected.length) fail(`${relative}: the rewrite would change ${unexpected.join(', ')}`);
  return {
    bytes: Buffer.from(JSON.stringify(next, null, 2) + newline, 'utf8'),
    changes,
    models,
    textures,
  };
}

/** The adoption rewrite of one manifest from its pre-apply bytes, or null when the adoption does
 * not touch it (see rewriteRecords). */
export function rewriteManifestBytes(relative, bytes, graph) {
  return rewriteRecords(relative, bytes, (asset, where, allowed, touched) => {
    const key = asset?.modelKey,
      entry =
        typeof key === 'string' && Object.hasOwn(graph.models, key) ? graph.models[key] : null,
      owned = Object.entries(graph.textures).filter(([, texture]) => texture.owner === key);
    if (!entry && !owned.length) return asset;
    const next = entry
      ? adoptModel(asset, key, entry, graph, where, allowed)
      : structuredClone(asset);
    if (entry) touched.models.push(key);
    for (const [url, texture] of owned) {
      adoptTexture(next, url, texture, graph, where, allowed);
      touched.textures.push(url);
    }
    return next;
  });
}

// ---------------------------------------------------------------------------------------------
// Plan

/** The revision's own records: generated, unadopted, indexed and verified. With `base` (from
 * readBaseAdoption) it must be a partial revision verified against exactly that base. */
export function checkRevision(
  manifest,
  runtimeIndex,
  verification,
  relative,
  { base = null } = {},
) {
  if (manifest.schema !== MANIFEST_SCHEMA)
    fail(`${relative}/manifest.json has schema ${manifest.schema}, not ${MANIFEST_SCHEMA}`);
  if (manifest.directory !== relative)
    fail(`${relative}/manifest.json describes ${manifest.directory}`);
  if (manifest.status !== 'candidate' || manifest.adoption !== 'not-adopted')
    fail(
      `${relative}/manifest.json must still say generated candidate, not adopted (status ${manifest.status}, adoption ${manifest.adoption}); revisions are never edited`,
    );
  if (base) {
    if (manifest.scope?.complete !== false || manifest.base?.adoption !== base.id)
      fail(`${relative} is not a partial revision on ${base.id}`);
    if (
      verification.base?.adoption !== base.id ||
      verification.base.planSha256 !== base.planSha256 ||
      jsonDifference(verification.scope, manifest.scope)
    )
      fail(`${relative}/verification.json was not verified against base adoption ${base.id}`);
  } else if (manifest.scope?.complete !== true)
    fail(
      `${relative} is a partial revision; only a complete revision can be adopted on its own (a partial one needs its base adoption)`,
    );
  if (manifest.toolchain?.meshoptimizer !== MESHOPTIMIZER_VERSION)
    fail(
      `${relative} was generated with meshoptimizer ${manifest.toolchain?.meshoptimizer}, not ${MESHOPTIMIZER_VERSION}`,
    );
  const images = manifest.images ?? [];
  if (
    manifest.files.some((record) => record.status !== CANDIDATE_STATUS) ||
    images.some(
      (record) => record.status !== (record.output ? CANDIDATE_STATUS : ORIGINAL_KEPT_STATUS),
    )
  )
    fail(`${relative}: a record claims a status other than the generator's`);
  const indexDifference = jsonDifference(runtimeIndexOf(manifest), runtimeIndex);
  if (indexDifference)
    fail(`${relative}/runtime-index.json is not derived from manifest.json (${indexDifference})`);
  if (
    verification.schema !== VERIFICATION_SCHEMA ||
    verification.revision !== manifest.revision ||
    verification.status !== 'passed'
  )
    fail(
      `${relative}/verification.json does not record a passed verification of ${manifest.revision}`,
    );
  if (
    !Array.isArray(verification.checks) ||
    !verification.checks.length ||
    verification.checks.some((item) => item.status !== 'passed')
  )
    fail(`${relative}/verification.json has a check that did not pass`);
  const results = verification.files ?? [],
    byId = new Map(results.map((result) => [result.id, result])),
    records = [...manifest.files, ...images];
  if (results.length !== records.length || byId.size !== records.length)
    fail(`${relative}/verification.json does not cover exactly the manifest's records`);
  for (const record of records) {
    const result = byId.get(record.id);
    if (result?.status !== 'passed')
      fail(`${relative}/verification.json: ${record.id} did not pass`);
    const difference = jsonDifference(record.verification ?? null, result.verification ?? null);
    if (difference)
      fail(`${relative}/verification.json: ${record.id} differs from the manifest (${difference})`);
  }
}

export async function acceptanceDocuments(root, acceptance) {
  if (!Array.isArray(acceptance) || !acceptance.length)
    fail('At least one acceptance document is required (--acceptance)');
  if (new Set(acceptance).size !== acceptance.length)
    fail('An acceptance document is listed twice');
  const documents = [];
  for (const relative of acceptance) {
    const file = repoFile(root, relative, 'acceptance document');
    if (!existsSync(file)) fail(`Acceptance document ${relative} does not exist`);
    const bytes = await readFile(file);
    if (!bytes.length) fail(`Acceptance document ${relative} is empty`);
    documents.push({ path: relative, sha256: sha256(bytes), bytes: bytes.length });
  }
  return documents;
}

export function inputDifferences(what, recorded, current) {
  const before = new Map((recorded ?? []).map((input) => [input.path, input.sha256])),
    now = new Map(current.map((input) => [input.path, input.sha256])),
    found = [];
  for (const [file, digest] of before)
    if (!now.has(file)) found.push(`${file} is gone`);
    else if (now.get(file) !== digest)
      found.push(`${file} changed (${digest} -> ${now.get(file)})`);
  for (const file of now.keys()) if (!before.has(file)) found.push(`${file} is new`);
  if (!found.length) return null;
  const listed = found.slice(0, 8).join('; ');
  return `${what} differ from the ones the candidate revision was generated from: ${listed}${found.length > 8 ? `; and ${found.length - 8} more` : ''}`;
}

function checkInputs(manifest, inventory, rules) {
  const problem =
    inputDifferences('The current manifests', manifest.inputs?.manifests, inventory.manifests) ??
    inputDifferences('The eligibility inputs', manifest.inputs?.eligibility, rules.inputs);
  if (problem)
    fail(`${problem}. The candidate revision is stale for these inputs; nothing was planned.`);
  const current = new Map(inventory.models.map((model) => [model.modelKey, model])),
    files = (model) =>
      model.files
        .map((file) => [file.role, file.lodIndex, file.url, file.sha256, file.bytes].join('|'))
        .join('\n');
  if (current.size !== manifest.models.length)
    fail('The current manifests describe a different set of models than the candidate revision');
  for (const model of manifest.models) {
    const now = current.get(model.modelKey);
    if (!now) fail(`${model.modelKey} is no longer in the current manifests`);
    if (
      now.eligible !== model.eligible ||
      now.reason !== model.reason ||
      now.manifest !== model.manifest
    )
      fail(
        `${model.modelKey}: its eligibility or manifest changed (${model.reason} -> ${now.reason})`,
      );
    if (files(now) !== files(model))
      fail(`${model.modelKey}: its delivered files changed since the candidate revision`);
  }
}

export async function decoderIdentity(root) {
  const file = repoFile(root, DECODER.source, 'decoder');
  if (!existsSync(file)) fail(`${DECODER.source} is missing; install the pinned three release`);
  const bytes = await readFile(file),
    three = JSON.parse(
      await readFile(repoFile(root, 'node_modules/three/package.json', 'package'), 'utf8'),
    );
  return {
    extension: MESHOPT_EXTENSION,
    module: DECODER.specifier,
    published: DECODER.published,
    source: DECODER.source,
    threeVersion: three.version,
    sha256: sha256(bytes),
    bytes: bytes.length,
  };
}

function publicTarget(root, copy) {
  const hashed = copy.url.endsWith('.glb')
    ? checkModelUrl(copy.url, copy.sha256)
    : checkTextureUrl(copy.url, copy.sha256, IMAGE_EXTENSIONS);
  if (!hashed || copy.to !== `public${copy.url}`)
    fail(`${copy.to} is not a content-addressed public path`);
  const models = path.join(root, 'public', 'models'),
    target = path.join(root, 'public', ...copy.url.slice(1).split('/'));
  if (!isInside(models, target) || !resolvesInside(models, target))
    fail(`${copy.to} resolves outside public/models`);
  return target;
}

/** 'absent' or 'present' (identical bytes); a different file at a hash-named path is an error. */
export async function targetState(root, copy) {
  const target = publicTarget(root, copy);
  let info;
  try {
    info = await lstat(target);
  } catch (error) {
    if (error.code === 'ENOENT') return 'absent';
    throw error;
  }
  if (!info.isFile()) fail(`${copy.to} exists and is not a regular file`);
  const bytes = await readFile(target);
  if (bytes.length === copy.bytes && sha256(bytes) === copy.sha256) return 'present';
  return fail(
    `${copy.to} already exists with different content (SHA-256 ${sha256(bytes)}); a hash-named file is never overwritten`,
  );
}

async function runtimeFiles(root, directory, found = []) {
  const absolute = path.join(root, directory);
  if (!existsSync(absolute)) return found;
  for (const entry of (await readdir(absolute, { withFileTypes: true })).sort((a, b) =>
    byText(a.name, b.name),
  )) {
    const relative = `${directory}/${entry.name}`;
    if (entry.isDirectory()) await runtimeFiles(root, relative, found);
    else if (/\.(?:m?ts|m?js)$/.test(entry.name)) found.push(relative);
  }
  return found;
}

/** Informational: runtime sources that still name a replaced file as a quoted literal (the builds report them too). */
export async function runtimeLiterals(root, graph) {
  const replacements = new Map();
  for (const entry of Object.values(graph.models)) {
    replacements.set(entry.primary.source.url, entry.primary.url);
    entry.lods.forEach((lod) => replacements.set(lod.source.url, lod.url));
    for (const lod of entry.clearedLods ?? []) {
      replacements.set(lod.url, `(cleared; ${entry.primary.url} at every distance)`);
      replacements.set(lod.candidate, `(cleared; ${entry.primary.url} at every distance)`);
    }
  }
  for (const [url, texture] of Object.entries(graph.textures)) replacements.set(url, texture.url);
  const found = [];
  for (const directory of RUNTIME_SOURCES)
    for (const file of await runtimeFiles(root, directory))
      for (const url of quotedLiterals(
        await readFile(path.join(root, ...file.split('/')), 'utf8'),
        graph.retired,
      ))
        found.push({ file, url, replacedBy: replacements.get(url) ?? '(unused candidate)' });
  return found;
}

async function inputDrift(root, inputs) {
  const drift = [];
  for (const input of inputs ?? []) {
    const file = repoFile(root, input.path, 'input');
    const current = existsSync(file) ? sha256(await readFile(file)) : null;
    drift.push({
      path: input.path,
      recorded: input.sha256,
      current,
      changed: current !== input.sha256,
    });
  }
  return drift;
}

// The only standalone image plan fields that describe where the runtime reads a record rather
// than what the image is. Everything else must re-plan identically:
// - id and source identity, format and size;
// - resize target, filter, treatment and encoding;
// - UV normalisation and motif rectangles;
// - wrap, colour space, owner and manifest entry.
// The recorded risks must match too.
export const IMAGE_PLAN_DESCRIPTORS = Object.freeze(['runtimeEntry', 'configuredBy']);

/**
 * Runtime compatibility of the revision's standalone images, by re-planning them with the
 * current runtime files (syntax only, as the generator did). This is separate evidence: the
 * strict verify-candidates.mjs still reports any plan difference against the current runtime,
 * and the revision's verification.json is never touched.
 *
 * `readManifest` supplies the manifest bytes. A plan uses the current manifests, which must equal
 * the revision's inputs. An audit uses the saved pre-apply bytes, never the rewritten manifests.
 * Both descriptor versions and the current input hashes are recorded. Any other difference is a
 * problem.
 */
export async function runtimeCompatibility(root, manifest, { inventory, rules, readManifest }) {
  const recorded = manifest.images ?? [];
  if (!recorded.length) return { problems: [], record: null };
  const stricter = manifest.policy?.stricter512 ?? [],
    edges = new Map(
      manifest.models
        .filter((model) => model.selected)
        .map((model) => [model.modelKey, stricter.includes(model.modelKey) ? 512 : 1024]),
    ),
    problems = [];
  let current;
  try {
    current = await planStandaloneImages(root, {
      inventory,
      rules,
      edges,
      colorFilter: manifest.options?.colorFilter,
      webpQuality: manifest.options?.webpQuality,
      ...(readManifest ? { readManifest } : {}),
    });
  } catch (error) {
    return {
      problems: [`the current runtime files cannot be re-planned: ${error.message}`],
      record: null,
    };
  }
  const meaning = (plan) =>
      Object.fromEntries(
        Object.entries(plan).filter(([key]) => !IMAGE_PLAN_DESCRIPTORS.includes(key)),
      ),
    descriptors = (plan) =>
      Object.fromEntries(IMAGE_PLAN_DESCRIPTORS.map((key) => [key, plan[key]])),
    ids = (list) => list.map((item) => item.id).sort(byText),
    images = [];
  if (ids(recorded).join('\n') !== ids(current.images).join('\n'))
    problems.push(
      `the current runtime loads ${ids(current.images).join(', ') || 'no standalone image'}; the revision recorded ${ids(recorded).join(', ')}`,
    );
  const skipped = jsonDifference(manifest.standaloneImagesSkipped ?? [], current.skipped);
  if (skipped) problems.push(`the declared but unloaded images changed (${skipped})`);
  for (const record of recorded) {
    const planned = current.images.find((item) => item.id === record.id);
    if (!planned) continue;
    const semantic = jsonDifference(meaning(record.plan), meaning(planned.plan)),
      risks = jsonDifference(record.knownRisks ?? [], record.output ? planned.risks : []);
    if (semantic) problems.push(`${record.id}: ${semantic}`);
    if (risks) problems.push(`${record.id}: the recorded risks differ (${risks})`);
    if (!!record.output !== !!planned.job)
      problems.push(`${record.id}: the current plan ${planned.job ? 'needs' : 'needs no'} resize`);
    images.push({
      id: record.id,
      recorded: descriptors(record.plan),
      current: descriptors(planned.plan),
      descriptorsChanged: !!jsonDifference(descriptors(record.plan), descriptors(planned.plan)),
    });
  }
  return {
    problems,
    record: {
      rule: `re-planned from the current runtime files; only ${IMAGE_PLAN_DESCRIPTORS.join(' and ')} may differ from the revision's image plans`,
      inputs: current.inputs,
      recordedInputs: manifest.inputs?.standaloneImages ?? [],
      images,
    },
  };
}

/** The identity of each evidence file, which must exist. */
export async function evidenceIdentities(root, paths, what) {
  const identities = [];
  for (const relative of paths) {
    const file = repoFile(root, relative, what);
    if (!existsSync(file)) fail(`${what} ${relative} does not exist`);
    const bytes = await readFile(file);
    identities.push({ path: relative, sha256: sha256(bytes), bytes: bytes.length });
  }
  return identities;
}

// Loaded on demand: the chained planner and audit import this module and revision-scope.mjs.
const chainedAdoption = () => import('./chained-adoption.mjs');

/** The recipe a revision's manifest names, or null (none, or no readable manifest). */
async function revisionRecipe(root, requested) {
  if (typeof requested !== 'string' || !requested) return null;
  const file = path.join(resolveRevisionDirectory(root, requested).absolute, 'manifest.json');
  if (!existsSync(file)) return null;
  return JSON.parse(await readFile(file, 'utf8')).recipe ?? null;
}

/**
 * Compute an adoption plan. This only reads files; writePlan stores the result. `rules` and
 * `lodRejections` are injectable for tests. By default, loadEligibilityRules reads the built
 * dist/ modules and LOD_REJECTIONS holds the reviewed rejections. With `base` (an applied
 * adoption id) it plans a partial revision on that base instead (chained-adoption.mjs), which has
 * no default revision, id or acceptance documents.
 */
export async function planAdoption(root, options = {}) {
  if (options.base !== undefined) {
    // An exact-repack revision (served files repacked) has its own chained planner.
    const recipe = await revisionRecipe(root, options.revision);
    if (recipe === EXACT_REPACK_RECIPE)
      return (await import('./repack-adoption.mjs')).planRepackAdoption(root, options);
    // Reduced current primaries of explicitly listed models, independently proven and reviewed.
    if (recipe === GUARDED_RECIPE)
      return (await import('./guarded-adoption.mjs')).planGuardedAdoption(root, options);
    if (recipe !== null) fail(`${options.revision} names the unknown recipe ${recipe}`);
    return (await chainedAdoption()).planChainedAdoption(root, options);
  }
  const {
    revision: requested = DEFAULT_REVISION,
    adoption: requestedId,
    acceptance = DEFAULT_ACCEPTANCE,
    lodRejections = LOD_REJECTIONS,
  } = options;
  let { rules } = options;
  const revision = resolveRevisionDirectory(root, requested),
    readRevision = async (name) => {
      const file = path.join(revision.absolute, name);
      if (!existsSync(file)) fail(`${revision.relative}/${name} does not exist`);
      const bytes = await readFile(file);
      return {
        value: JSON.parse(bytes.toString('utf8')),
        identity: {
          path: `${revision.relative}/${name}`,
          sha256: sha256(bytes),
          bytes: bytes.length,
        },
      };
    },
    manifestFile = await readRevision('manifest.json'),
    indexFile = await readRevision('runtime-index.json'),
    verificationFile = await readRevision('verification.json'),
    manifest = manifestFile.value,
    runtimeIndex = indexFile.value,
    id = requestedId ?? `${manifest.revision}-a01`;
  adoptionDirectory(root, id);
  checkRevision(manifest, runtimeIndex, verificationFile.value, revision.relative);
  const documents = await acceptanceDocuments(root, acceptance);
  rules ??= await loadEligibilityRules(root);
  const inventory = await buildInventory(root, rules);
  checkInputs(manifest, inventory, rules);
  // The runtime loader may be reconfigured after generation; prove the images keep their meaning.
  const compatibility = await runtimeCompatibility(root, manifest, { inventory, rules });
  if (compatibility.problems.length)
    fail(
      `The current runtime no longer loads the revision's standalone images with the same meaning: ${compatibility.problems.slice(0, 8).join('; ')}. Nothing was planned.`,
    );
  const excluded = new Set(
      rules.characterModels
        .filter((profile) => rules.excludedSpecies.includes(profile.species))
        .map((profile) => profile.key),
    ),
    graph = {
      schema: ADOPTION_GRAPH_SCHEMA,
      adoption: id,
      candidateRevision: revision.relative,
      decoder: await decoderIdentity(root),
      models: {},
      notAdopted: {},
      lodRejections: {},
      textures: {},
      keptTextures: [],
      retired: [],
      retiredCandidates: [],
    },
    retired = new Set(),
    copies = new Map();
  for (const key of Object.keys(lodRejections))
    graph.lodRejections[key] = manifest.models.some(
      (model) => model.modelKey === key && model.selected,
    )
      ? 'applied'
      : 'not-adopted-by-this-revision';

  // A stored candidate: its bytes must match the record, and its name must address them.
  const stored = async (output, kind, label) => {
    if (output?.url !== `/${output?.file}`)
      fail(`${label}: candidate URL ${output?.url} does not match its file ${output?.file}`);
    const hashed =
      kind === 'model'
        ? checkModelUrl(output.url, output.sha256)
        : checkTextureUrl(output.url, output.sha256, IMAGE_EXTENSIONS);
    if (!hashed) fail(`${label}: candidate ${output.url} is not content-addressed`);
    const bytes = await readFile(resolveCandidateFile(revision.absolute, output.file));
    if (bytes.length !== output.bytes || sha256(bytes) !== output.sha256)
      fail(
        `${label}: ${revision.relative}/${output.file} no longer matches its record (${bytes.length} bytes, SHA-256 ${sha256(bytes)}); the candidate is corrupt`,
      );
    return bytes;
  };
  // A candidate that stays archived in the revision, never served: verified now and by the audit.
  const retire = async (record, modelKey, role, reason) => {
    await stored(record.output, 'model', record.id);
    retired.add(record.output.url);
    graph.retiredCandidates.push({
      modelKey,
      role,
      reason,
      url: record.output.url,
      sha256: record.output.sha256,
      bytes: record.output.bytes,
      triangles: record.output.triangles ?? null,
      from: `${revision.relative}/${record.output.file}`,
    });
  };
  // A served candidate: verified, then registered for copying under its hash-named URL.
  const candidate = async (output, kind, label) => {
    const bytes = await stored(output, kind, label),
      known = copies.get(output.url);
    if (known && (known.sha256 !== output.sha256 || known.bytes !== output.bytes))
      fail(`${output.url} is recorded twice with different content`);
    if (!known)
      copies.set(output.url, {
        url: output.url,
        sha256: output.sha256,
        bytes: output.bytes,
        from: `${revision.relative}/${output.file}`,
        to: `public${output.url}`,
      });
    return bytes;
  };
  const served = (record) => {
    if (!Number.isSafeInteger(record.output?.triangles))
      fail(`${record.id}: the candidate record does not state the triangles it serves`);
    return {
      url: record.output.url,
      sha256: record.output.sha256,
      bytes: record.output.bytes,
      triangles: record.output.triangles,
      extensionsRequired: record.output.extensionsRequired,
      maximumTextureEdge: record.output.maximumTextureEdge,
      candidate: record.id,
    };
  };
  const sourceOf = (file, triangles) => ({ ...identity(file), triangles: triangles ?? null });

  const ordinary = new Map(),
    startups = new Map();
  for (const record of manifest.files)
    if (record.role === STARTUP_ROLE) {
      const key = record.uses?.[0]?.modelKey;
      if (record.uses?.length !== 1 || startups.has(key))
        fail(`${record.id}: a startup actor serves exactly one model`);
      startups.set(key, record);
    } else {
      if (ordinary.has(record.source?.url)) fail(`${record.source?.url} has two candidate records`);
      ordinary.set(record.source.url, record);
    }

  for (const model of manifest.models) {
    const key = model.modelKey;
    if (!model.selected) {
      if (model.eligible) fail(`${key} is eligible but the candidate revision did not select it`);
      graph.notAdopted[key] = model.reason;
      continue;
    }
    if (!model.eligible) fail(`${key} is selected but not eligible`);
    if (excluded.has(key)) fail(`${key} belongs to an excluded character`);
    const [primaryFile, ...lodFiles] = model.files;
    if (
      primaryFile?.role !== 'model' ||
      lodFiles.some((file, index) => file.role !== 'lod' || file.lodIndex !== index)
    )
      fail(`${key}: unexpected file roles in the candidate revision`);
    // Originals must still be exactly what the candidates were derived from.
    for (const file of model.files) await readVerifiedSource(root, file);
    const recordOf = (file) => {
      const record = ordinary.get(file.url);
      if (
        !record ||
        record.source.sha256 !== file.sha256 ||
        record.source.bytes !== file.bytes ||
        record.output.url !== file.candidate ||
        !record.uses?.some((use) => use.modelKey === key)
      )
        fail(`${key}: ${file.url} has no matching candidate record`);
      return record;
    };
    const primaryRecord = recordOf(primaryFile),
      lodRecords = lodFiles.map(recordOf),
      rejection = Object.hasOwn(lodRejections, key) ? lodRejections[key] : null;
    // The old LODs an entry clears, each with the identity of its archived candidate.
    const cleared = () =>
      lodFiles.map((file, lodIndex) => ({
        ...identity(file),
        triangles: lodRecords[lodIndex].source.triangles ?? null,
        candidate: lodRecords[lodIndex].output.url,
        candidateSha256: lodRecords[lodIndex].output.sha256,
        candidateBytes: lodRecords[lodIndex].output.bytes,
      }));
    // What the far level showed (the farthest LOD) and what it shows once the LODs are cleared.
    const farTriangles = (after) => {
      const before = lodRecords.length ? lodRecords.at(-1).output.triangles : after;
      if (!Number.isSafeInteger(before))
        fail(`${key}: its LOD candidate does not state its triangles`);
      return { before, after, added: after - before };
    };
    if (rejection && model.startupActor)
      fail(`${key}: a startup actor cannot also carry an LOD rejection`);
    if (rejection) {
      const { reviewed } = rejection,
        describe = (url, triangles) => `${url} (${triangles} triangles)`,
        matches =
          primaryFile.url === reviewed.model.url &&
          primaryRecord.output.triangles === reviewed.model.triangles &&
          lodFiles.length === reviewed.lods.length &&
          lodFiles.every(
            (file, index) =>
              file.url === reviewed.lods[index].url &&
              lodRecords[index].output.triangles === reviewed.lods[index].triangles,
          );
      if (!matches)
        fail(
          `${key}: its LOD rejection was reviewed for ${describe(reviewed.model.url, reviewed.model.triangles)} with ${reviewed.lods.map((lod) => describe(lod.url, lod.triangles)).join(', ')}; the revision delivers ${describe(primaryFile.url, primaryRecord.output.triangles)} with ${lodFiles.map((file, index) => describe(file.url, lodRecords[index].output.triangles)).join(', ') || 'no LOD'}. Review it again before adopting.`,
        );
      if (!rejection.evidence?.length) fail(`${key}: its LOD rejection names no evidence`);
      await candidate(primaryRecord.output, 'model', primaryRecord.id);
      for (const record of lodRecords) await retire(record, key, 'lod', 'rejected-old-lod');
      const primary = {
        ...served(primaryRecord),
        source: sourceOf(primaryFile, primaryRecord.source.triangles),
      };
      graph.models[key] = {
        selection: SELECTION.full,
        manifests: [],
        primary,
        lods: [],
        clearedLods: cleared(),
        farTriangles: farTriangles(primary.triangles),
        lodRejection: {
          decision: rejection.decision,
          observation: rejection.observation,
          evidence: await evidenceIdentities(root, rejection.evidence, 'LOD rejection evidence'),
          reviewed: rejection.reviewed,
        },
      };
    } else if (!model.startupActor) {
      await candidate(primaryRecord.output, 'model', primaryRecord.id);
      for (const record of lodRecords) await candidate(record.output, 'model', record.id);
      graph.models[key] = {
        selection: SELECTION.ordinary,
        manifests: [],
        primary: {
          ...served(primaryRecord),
          source: sourceOf(primaryFile, primaryRecord.source.triangles),
        },
        lods: lodRecords.map((record, index) => ({
          ...served(record),
          source: sourceOf(lodFiles[index], record.source.triangles),
        })),
      };
    } else {
      const startup = startups.get(key);
      if (!startup || startup.output?.url !== model.startupActor)
        fail(`${key}: its startup actor record is missing`);
      const { full, geometry } = startup.source;
      if (!sameFile(full, primaryFile))
        fail(
          `${key}: the startup actor was derived from ${full?.url}, not the delivered ${primaryFile.url}`,
        );
      if (!lodFiles.some((file) => sameFile(geometry, file)))
        fail(`${key}: the startup actor's geometry source ${geometry?.url} is not a delivered LOD`);
      if (
        startup.upgrade?.url !== primaryRecord.output.url ||
        startup.upgrade.sha256 !== primaryRecord.output.sha256 ||
        startup.upgrade.bytes !== primaryRecord.output.bytes
      )
        fail(`${key}: the startup record's full candidate differs from the full-model record`);
      const startupBytes = await candidate(startup.output, 'model', startup.id);
      let identical = null;
      if (startup.output.sha256 === primaryRecord.output.sha256) {
        // A whole single primitive: the full and startup candidates are one file. Only the
        // startup URL is served; the identity is proven from both stored files, not the hashes.
        const fullBytes = await readFile(
          resolveCandidateFile(revision.absolute, primaryRecord.output.file),
        );
        if (!fullBytes.equals(startupBytes) || startup.output.bytes !== primaryRecord.output.bytes)
          fail(
            `${key}: the startup and full candidates record one SHA-256 but their stored bytes differ`,
          );
        identical = {
          url: primaryRecord.output.url,
          sha256: primaryRecord.output.sha256,
          bytes: primaryRecord.output.bytes,
          proof: `both stored candidate files are the same ${fullBytes.length} bytes (SHA-256 ${sha256(fullBytes)}); only ${startup.output.url} is copied and served`,
        };
      }
      const index = runtimeIndex.startupActors?.[key];
      if (!index) fail(`${key}: runtime-index.json has no startup actor`);
      const primary = { ...served(startup), source: sourceOf(primaryFile, full.triangles) };
      graph.models[key] = {
        selection: SELECTION.startup,
        manifests: [],
        primary,
        lods: [],
        startup: {
          record: startup.id,
          url: startup.output.url,
          sha256: startup.output.sha256,
          bytes: startup.output.bytes,
          geometry: index.geometry,
          geometrySource: { url: geometry.url, sha256: geometry.sha256 },
          fullSource: { url: full.url, sha256: full.sha256 },
        },
        // Every old LOD goes: neither the original nor its compressed candidate may come back.
        clearedLods: cleared(),
        farTriangles: farTriangles(primary.triangles),
        identicalFullCandidate: identical,
      };
      await retire(
        primaryRecord,
        key,
        'full',
        identical ? 'identical-to-the-served-startup-file' : 'unused-full-candidate',
      );
      for (const record of lodRecords) await retire(record, key, 'lod', 'rejected-old-lod');
    }
    retired.add(primaryFile.url);
    for (const file of lodFiles) retired.add(file.url);
  }

  for (const image of manifest.images ?? []) {
    const { plan: imagePlan, output } = image,
      source = imagePlan?.source;
    if (image.role !== STANDALONE_ROLE || !source)
      fail(`${image.id}: not a standalone texture record`);
    if (!Object.hasOwn(graph.models, imagePlan.owner))
      fail(`${image.id}: its owner ${imagePlan.owner} is not adopted`);
    await readVerifiedImage(root, source);
    if (!output) {
      // Already within the maximum edge: the original stays, unchanged.
      graph.keptTextures.push({
        owner: imagePlan.owner,
        manifestEntry: imagePlan.manifestEntry,
        ...identity(source),
        reason: ORIGINAL_KEPT_STATUS,
      });
      continue;
    }
    const expected = imageCandidateLocation(source.url, output.sha256 ?? '');
    if (output.file !== expected.file || output.url !== expected.url)
      fail(`${image.id}: ${output.file} is not the content-addressed name ${expected.file}`);
    const info = sniffImage(await candidate(output, 'texture', image.id));
    if (
      info.format !== output.format ||
      info.width !== output.width ||
      info.height !== output.height ||
      info.alpha !== output.alpha
    )
      fail(
        `${image.id}: the stored candidate is ${info.format} ${info.width}x${info.height}, its record says ${output.format} ${output.width}x${output.height}`,
      );
    const uvSource = imagePlan.uv?.normalizedBy;
    if (uvSource?.width !== source.width || uvSource?.height !== source.height)
      fail(`${image.id}: its UV rectangles are not normalised by the original size`);
    if (output.width === source.width && output.height === source.height)
      fail(`${image.id}: a candidate with the original size`);
    // The runtime (caveUvSource) maps rectangles through uvSource only for a whole-image
    // downsize that keeps the aspect within a pixel of rounding.
    if (
      output.width > source.width ||
      output.height > source.height ||
      Math.abs(output.width * source.height - output.height * source.width) >
        Math.max(source.width, source.height)
    )
      fail(
        `${image.id}: ${output.width}x${output.height} is not a whole-image resize of ${source.width}x${source.height}`,
      );
    graph.textures[source.url] = {
      owner: imagePlan.owner,
      manifestEntry: imagePlan.manifestEntry,
      manifests: [],
      url: output.url,
      sha256: output.sha256,
      bytes: output.bytes,
      mimeType: output.mimeType,
      width: output.width,
      height: output.height,
      uvSource: { width: source.width, height: source.height },
      alpha: output.alpha,
      colorSpace: imagePlan.colorSpace,
      wrap: imagePlan.uv.wrap,
      candidate: image.id,
      source: { ...identity(source), width: source.width, height: source.height },
    };
    retired.add(source.url);
  }

  // Replaced files may not be needed by anything that stays.
  for (const url of retired) {
    if (copies.has(url)) fail(`${url} is both served and replaced`);
    for (const use of inventory.files.get(url)?.uses ?? [])
      if (!Object.hasOwn(graph.models, use.modelKey))
        fail(`${url} is replaced, but ${use.modelKey} (not adopted) still delivers it`);
  }
  for (const record of manifest.files)
    if (!copies.has(record.output.url) && !retired.has(record.output.url))
      fail(`${record.id}: its candidate is neither served nor retired`);
  graph.retired = [...retired].sort(byText);

  // Every manifest the revision read: its exact bytes, and the rewrite if the adoption touches it.
  const before = new Map(),
    after = new Map(),
    operations = [];
  for (const input of inventory.manifests) {
    const bytes = await readFile(repoFile(root, input.path, 'manifest'));
    if (sha256(bytes) !== input.sha256) fail(`${input.path} changed while the plan was computed`);
    before.set(input.path, bytes);
    const rewritten = rewriteManifestBytes(input.path, bytes, graph);
    if (!rewritten) continue;
    after.set(input.path, rewritten.bytes);
    for (const key of rewritten.models) graph.models[key].manifests.push(input.path);
    for (const url of rewritten.textures) graph.textures[url].manifests.push(input.path);
    operations.push({
      path: input.path,
      before: { sha256: input.sha256, bytes: bytes.length },
      after: { sha256: sha256(rewritten.bytes), bytes: rewritten.bytes.length },
      changes: rewritten.changes,
    });
  }
  for (const model of manifest.models.filter((candidateModel) => candidateModel.selected))
    if (!graph.models[model.modelKey].manifests.includes(model.manifest))
      fail(`${model.modelKey}: ${model.manifest} was not rewritten`);
  for (const [url, texture] of Object.entries(graph.textures))
    if (!texture.manifests.length) fail(`${url}: no manifest record was rewritten`);

  const copyList = [...copies.values()].sort((a, b) => byText(a.url, b.url)),
    targets = { absent: 0, present: 0 };
  for (const copy of copyList) {
    if (inventory.files.has(copy.url))
      fail(`${copy.to} is a delivered original; it is never overwritten`);
    targets[await targetState(root, copy)]++;
  }
  const entries = Object.values(graph.models),
    textures = Object.values(graph.textures),
    sum = (values) => values.reduce((total, value) => total + value, 0),
    totals = {
      adoptedModels: entries.length,
      startupActors: entries.filter((entry) => entry.selection === SELECTION.startup).length,
      fullOnlyModels: entries.filter((entry) => entry.selection === SELECTION.full).length,
      clearedLods: sum(entries.map((entry) => entry.clearedLods?.length ?? 0)),
      retiredCandidates: graph.retiredCandidates.length,
      // Visible triangles each cleared model adds at its far distance (one instance each).
      addedFarTriangles: sum(entries.map((entry) => entry.farTriangles?.added ?? 0)),
      addedFarTrianglesByModel: Object.fromEntries(
        Object.entries(graph.models)
          .filter(([, entry]) => entry.farTriangles)
          .map(([key, entry]) => [key, entry.farTriangles.added]),
      ),
      standaloneTextures: textures.length,
      keptTextures: graph.keptTextures.length,
      notAdopted: Object.keys(graph.notAdopted).length,
      copies: copyList.length,
      copyBytes: sum(copyList.map((copy) => copy.bytes)),
      rewrittenManifests: operations.length,
      replacedBytes: sum([
        ...entries.map((entry) =>
          sum([
            entry.primary.source.bytes,
            ...entry.lods.map((lod) => lod.source.bytes),
            ...(entry.clearedLods ?? []).map((lod) => lod.bytes),
          ]),
        ),
        ...textures.map((texture) => texture.source.bytes),
      ]),
      servedBytes: sum([
        ...entries.map((entry) =>
          sum([entry.primary.bytes, ...entry.lods.map((lod) => lod.bytes)]),
        ),
        ...textures.map((texture) => texture.bytes),
      ]),
    };
  const plan = {
    schema: ADOPTION_PLAN_SCHEMA,
    adoption: id,
    options: { revision: revision.relative, acceptance: [...acceptance] },
    candidateRevision: {
      directory: revision.relative,
      revision: manifest.revision,
      files: [manifestFile.identity, indexFile.identity, verificationFile.identity],
    },
    acceptance: { documents },
    inputs: { manifests: inventory.manifests, eligibility: rules.inputs },
    // Recomputed by apply: a runtime change between plan and apply stops the apply.
    runtimeCompatibility: compatibility.record,
    operations: { copies: copyList, manifests: operations },
    graph,
    totals,
    atomicity:
      'apply replaces one file at a time (temporary file, then rename) and journals its progress; it is not a multi-file transaction. A partial application is refused by apply and by the builds, and restore undoes it file by file.',
  };
  const review = {
    adoption: id,
    note: 'informational; not part of plan.json and not compared by apply',
    targets,
    runtimeLiterals: await runtimeLiterals(root, graph),
    standaloneInputs: await inputDrift(root, manifest.inputs?.standaloneImages),
  };
  return { plan, planBytes: Buffer.from(json(plan), 'utf8'), before, after, review };
}

async function writeNew(file, bytes) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, bytes, { flag: 'wx' });
}

const recordFile = (directory, folder, relative) =>
  repoFile(path.join(directory, folder), relative, 'recorded manifest');

/** Store a computed plan in its NEW adoption folder. Nothing outside that folder is written. */
export async function writePlan(root, result) {
  const id = result.plan.adoption,
    directory = adoptionDirectory(root, id),
    parent = path.dirname(directory),
    relative = `${ADOPTION_DIRECTORY}/${id}`;
  await mkdir(parent, { recursive: true });
  if (!resolvesInside(root, parent)) fail(`${ADOPTION_DIRECTORY} resolves outside the repository`);
  try {
    await mkdir(directory);
  } catch (error) {
    if (error.code === 'EEXIST')
      fail(
        `${relative} already exists; adoption records are never reused, choose a new --adoption id`,
      );
    throw error;
  }
  for (const [manifest, bytes] of result.before)
    await writeNew(recordFile(directory, RECORD.before, manifest), bytes);
  for (const [manifest, bytes] of result.after)
    await writeNew(recordFile(directory, RECORD.after, manifest), bytes);
  await writeNew(path.join(directory, RECORD.review), json(result.review));
  await writeNew(path.join(directory, RECORD.plan), result.planBytes);
  await writeNew(
    path.join(directory, RECORD.journal),
    json({
      schema: ADOPTION_JOURNAL_SCHEMA,
      adoption: id,
      planSha256: sha256(result.planBytes),
      // A chained adoption names its base; restore returns the manifests to the base's bytes.
      ...(result.plan.base
        ? {
            base: {
              adoption: result.plan.base.adoption,
              planSha256: result.plan.base.planSha256,
            },
          }
        : {}),
      state: 'planned',
      history: [{ state: 'planned', at: new Date().toISOString() }],
    }),
  );
  return relative;
}

// ---------------------------------------------------------------------------------------------
// Apply, restore and audit

async function readRecord(root, id) {
  const directory = adoptionDirectory(root, id),
    relative = `${ADOPTION_DIRECTORY}/${id}`;
  if (!existsSync(path.join(directory, RECORD.plan)))
    fail(`${relative}/plan.json does not exist; create the plan first`);
  const planBytes = await readFile(path.join(directory, RECORD.plan)),
    journal = JSON.parse(await readFile(path.join(directory, RECORD.journal), 'utf8')),
    plan = JSON.parse(planBytes.toString('utf8'));
  if (plan.schema !== ADOPTION_PLAN_SCHEMA || plan.adoption !== id)
    fail(`${relative}/plan.json is not the plan of adoption ${id}`);
  if (
    journal.schema !== ADOPTION_JOURNAL_SCHEMA ||
    journal.adoption !== id ||
    journal.planSha256 !== sha256(planBytes)
  )
    fail(`${relative}/journal.json does not belong to its plan.json`);
  return { directory, relative, plan, planBytes, journal };
}

async function setJournal(directory, journal, state) {
  const next = {
      ...journal,
      state,
      history: [...(journal.history ?? []), { state, at: new Date().toISOString() }],
    },
    file = path.join(directory, RECORD.journal),
    temp = `${file}.tmp`;
  await rm(temp, { force: true });
  await writeFile(temp, json(next), { flag: 'wx' });
  await rename(temp, file);
  return next;
}

/** The saved before/ and after/ bytes, checked against the plan. */
async function savedManifests(directory, plan) {
  const before = new Map(),
    after = new Map(),
    problems = [];
  const load = async (folder, relative, expected, into) => {
    try {
      const bytes = await readFile(recordFile(directory, folder, relative));
      if (
        (expected.bytes !== undefined && bytes.length !== expected.bytes) ||
        sha256(bytes) !== expected.sha256
      )
        problems.push(`${folder}/${relative} does not match the plan`);
      else into.set(relative, bytes);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      problems.push(`${folder}/${relative} is missing`);
    }
  };
  for (const input of plan.inputs.manifests) await load(RECORD.before, input.path, input, before);
  for (const operation of plan.operations.manifests)
    await load(RECORD.after, operation.path, operation.after, after);
  return { before, after, problems };
}

// An interrupted run can leave its own temporary file behind. It is reported, never removed
// silently, and nothing else is touched.
const leftover = (temp) =>
  fail(
    `${temp} is left from an interrupted run; nothing was overwritten. Compare it with the plan or remove it, then run again.`,
  );

async function placeCopy(root, copy) {
  const source = repoFile(root, copy.from, 'candidate'),
    target = publicTarget(root, copy),
    temp = `${target}.adopting`;
  try {
    await copyFile(source, temp, constants.COPYFILE_EXCL);
  } catch (error) {
    if (error.code === 'EEXIST') leftover(temp);
    throw error;
  }
  try {
    const bytes = await readFile(temp);
    if (bytes.length !== copy.bytes || sha256(bytes) !== copy.sha256)
      fail(`${copy.from} changed while it was copied`);
    try {
      // A hard link never replaces an existing file, so a hash-named path only ever appears complete.
      await link(temp, target);
    } catch (error) {
      if (error.code === 'EEXIST') await targetState(root, copy);
      else if (['EPERM', 'ENOTSUP', 'EXDEV', 'ENOSYS'].includes(error.code))
        fail(
          `${copy.to}: this filesystem cannot hard-link (${error.code}), so the copy could not be placed without a replacing rename; nothing was overwritten`,
        );
      else throw error;
    }
  } finally {
    await rm(temp, { force: true });
  }
}

async function replaceManifest(root, relative, bytes, expected, result, id) {
  const target = repoFile(root, relative, 'manifest'),
    temp = `${target}.adoption-${id}.tmp`;
  if (!resolvesInside(path.join(root, 'public', 'models'), target))
    fail(`${relative} resolves outside public/models`);
  try {
    await writeFile(temp, bytes, { flag: 'wx' });
  } catch (error) {
    if (error.code === 'EEXIST') leftover(temp);
    throw error;
  }
  try {
    if (sha256(await readFile(target)) !== expected)
      fail(`${relative} changed during the operation; it was left as it is`);
    await rename(temp, target);
  } finally {
    await rm(temp, { force: true });
  }
  if (sha256(await readFile(target)) !== result)
    fail(`${relative} does not hold the expected bytes after replacement`);
}

/** Apply a stored plan once. See the header for what is (and is not) guaranteed. */
export async function applyAdoption(root, id, { rules, lodRejections } = {}) {
  const { directory, relative, plan, planBytes, journal } = await readRecord(root, id);
  if (journal.state !== 'planned')
    fail(
      journal.state === 'applied'
        ? `Adoption ${id} is already applied; a second apply is refused (inspect it with --audit)`
        : `Adoption ${id} is ${journal.state}; apply runs only once, on a planned adoption (restore a partial one, then plan again under a new id)`,
    );
  const saved = await savedManifests(directory, plan);
  if (saved.problems.length) fail(`${relative}: ${saved.problems.join('; ')}`);
  const fresh = await planAdoption(root, {
    ...plan.options,
    adoption: id,
    rules,
    ...(lodRejections ? { lodRejections } : {}),
    // The record exists now; a chained plan otherwise refuses a used id.
    replanning: true,
  });
  if (!fresh.planBytes.equals(planBytes))
    fail(
      `The current files no longer produce plan ${id} (${jsonDifference(plan, fresh.plan) ?? 'its bytes differ'}); nothing was applied. Plan again under a new adoption id.`,
    );
  const states = [];
  for (const copy of plan.operations.copies) states.push(await targetState(root, copy));
  let current = await setJournal(directory, journal, 'applying');
  for (const [index, copy] of plan.operations.copies.entries())
    if (states[index] === 'absent') await placeCopy(root, copy);
  for (const operation of plan.operations.manifests)
    await replaceManifest(
      root,
      operation.path,
      saved.after.get(operation.path),
      operation.before.sha256,
      operation.after.sha256,
      id,
    );
  current = await setJournal(directory, current, 'applied');
  return auditAdoption(root, id);
}

/** Put the saved before-bytes back where the adopted bytes are still untouched; refuse otherwise. */
export async function restoreAdoption(root, id) {
  const { directory, relative, plan, journal } = await readRecord(root, id);
  if (!['applying', 'applied', 'restoring'].includes(journal.state))
    fail(
      `Adoption ${id} is ${journal.state}; only an applied or partially applied adoption can be restored`,
    );
  const saved = await savedManifests(directory, plan);
  if (saved.problems.length) fail(`${relative}: ${saved.problems.join('; ')}`);
  const pending = [],
    untouched = [],
    conflicts = [];
  for (const operation of plan.operations.manifests) {
    const digest = sha256(await readFile(repoFile(root, operation.path, 'manifest')));
    if (digest === operation.after.sha256) pending.push(operation);
    else if (digest === operation.before.sha256) untouched.push(operation.path);
    else conflicts.push(operation.path);
  }
  if (conflicts.length)
    fail(
      `Restore stopped before writing anything: ${conflicts.join(', ')} changed after adoption ${id}. Restoring would destroy those edits; merge them by hand from ${relative}/before and ${relative}/after.`,
    );
  let current = await setJournal(directory, journal, 'restoring');
  for (const operation of pending)
    await replaceManifest(
      root,
      operation.path,
      saved.before.get(operation.path),
      operation.after.sha256,
      operation.before.sha256,
      id,
    );
  current = await setJournal(directory, current, 'restored');
  return {
    adoption: id,
    state: current.state,
    restored: pending.map((operation) => operation.path),
    alreadyOriginal: untouched,
    keptCopies: plan.operations.copies.map((copy) => copy.to),
    note: plan.base
      ? `the manifests hold base adoption ${plan.base.adoption}'s applied bytes again; this adoption's copied hash-named files stay in public/models, unnamed`
      : 'the copied hash-named files stay in public/models; no manifest names them after the restore',
  };
}

/** Every file a graph serves (models, LODs, adopted images), as its public/models path and identity.
 * Kept original images are originals; originalProblems checks them. */
export function servedFiles(graph) {
  const files = new Map();
  for (const entry of Object.values(graph.models))
    for (const record of [entry.primary, ...entry.lods]) files.set(record.url, record);
  for (const texture of Object.values(graph.textures)) files.set(texture.url, texture);
  return [...files.values()].map((record) => ({
    path: `public${record.url}`,
    sha256: record.sha256,
    bytes: record.bytes,
  }));
}

export async function fileProblems(root, files) {
  const problems = [];
  for (const file of files)
    try {
      const bytes = await readFile(repoFile(root, file.path, 'recorded'));
      if (
        (file.bytes !== undefined && bytes.length !== file.bytes) ||
        sha256(bytes) !== file.sha256
      )
        problems.push(`${file.path} changed (${bytes.length} bytes, SHA-256 ${sha256(bytes)})`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      problems.push(`${file.path} is missing`);
    }
  return problems;
}

/** Every original a graph replaced or keeps (models, LODs, cleared LODs, images), by SHA-256 and length. */
export async function originalProblems(root, graph) {
  const problems = [],
    seen = new Set();
  const visit = async (record, image = false) => {
    if (seen.has(record.url)) return;
    seen.add(record.url);
    try {
      if (image) await readVerifiedImage(root, record);
      else await readVerifiedSource(root, record);
    } catch (error) {
      problems.push(error.message);
    }
  };
  for (const entry of Object.values(graph.models)) {
    await visit(entry.primary.source);
    for (const lod of entry.lods) await visit(lod.source);
    for (const lod of entry.clearedLods ?? []) await visit(lod);
  }
  for (const texture of Object.values(graph.textures)) await visit(texture.source, true);
  for (const kept of graph.keptTextures) await visit(kept, true);
  return problems;
}

/** The catalog and every public/models/<name>/asset.json, as currently on disk. */
async function currentManifestRecords(root) {
  const catalog = JSON.parse(await readFile(repoFile(root, CATALOG, 'manifest'), 'utf8')),
    records = [{ path: CATALOG, assets: Array.isArray(catalog.assets) ? catalog.assets : [] }],
    models = path.join(root, 'public', 'models');
  for (const entry of (await readdir(models, { withFileTypes: true }))
    .filter((item) => item.isDirectory())
    .sort((a, b) => byText(a.name, b.name))) {
    let bytes;
    try {
      bytes = await readFile(path.join(models, entry.name, 'asset.json'));
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    records.push({
      path: `public/models/${entry.name}/asset.json`,
      assets: [JSON.parse(bytes.toString('utf8'))],
    });
  }
  return records;
}

/** The applied manifests against the graph: exact records, cleared LODs, no retired file anywhere. */
async function activeGraphProblems(root, plan) {
  const { graph, adoption: id } = plan,
    retired = new Set(graph.retired),
    problems = { startup: [], full: [], retired: [], models: [], textures: [] },
    servedModels = new Map(Object.keys(graph.models).map((key) => [key, 0])),
    servedTextures = new Map(Object.keys(graph.textures).map((url) => [url, 0]));
  for (const { path: file, assets } of await currentManifestRecords(root))
    for (const asset of assets) {
      const key = asset?.modelKey,
        records = [asset, ...(Array.isArray(asset?.lods) ? asset.lods : [])];
      let textures = [];
      try {
        textures = runtimeTextureRecords(asset);
      } catch (error) {
        problems.textures.push(`${file} ${key}: ${error.message}`);
      }
      for (const record of [...records, ...textures])
        if (retired.has(record?.url)) problems.retired.push(`${file} ${key}: ${record.url}`);
      const entry =
        typeof key === 'string' && Object.hasOwn(graph.models, key) ? graph.models[key] : null;
      if (entry) {
        servedModels.set(key, servedModels.get(key) + 1);
        const expected = [entry.primary, ...entry.lods];
        if (
          asset[RUNTIME_FIELD]?.adoption !== id ||
          records.length !== expected.length ||
          records.some(
            (record, index) =>
              !sameFile(record, expected[index]) || record?.scene !== expected[index].scene,
          )
        )
          problems.models.push(
            `${file} ${key}: does not serve exactly the planned files (and packed scenes)`,
          );
        if (entry.selection === SELECTION.startup) {
          if (asset.url !== entry.startup.url)
            problems.startup.push(`${file} ${key}: serves ${asset.url}, not its startup file`);
          if ((asset.lods ?? []).length)
            problems.startup.push(`${file} ${key}: still lists ${asset.lods.length} LOD(s)`);
        }
        if (entry.selection === SELECTION.full) {
          if (asset.url !== entry.primary.url)
            problems.full.push(`${file} ${key}: serves ${asset.url}, not its full candidate`);
          if ((asset.lods ?? []).length)
            problems.full.push(`${file} ${key}: still lists ${asset.lods.length} rejected LOD(s)`);
          if (asset[RUNTIME_FIELD]?.lodRejection?.addedFarTriangles !== entry.farTriangles.added)
            problems.full.push(
              `${file} ${key}: does not record its LOD rejection and far-triangle cost`,
            );
        }
      }
      for (const [url, texture] of Object.entries(graph.textures)) {
        if (texture.owner !== key) continue;
        servedTextures.set(url, servedTextures.get(url) + 1);
        const record = valueAt(asset, texture.manifestEntry);
        if (
          record?.url !== texture.url ||
          record.sha256 !== texture.sha256 ||
          record.bytes !== texture.bytes ||
          record.image?.width !== texture.width ||
          record.image?.height !== texture.height ||
          record.uvSource?.width !== texture.uvSource.width ||
          record.uvSource?.height !== texture.uvSource.height ||
          record.provenance?.[RUNTIME_FIELD]?.adoption !== id ||
          record.provenance[RUNTIME_FIELD].original?.url !== url
        )
          problems.textures.push(
            `${file} ${key}: ${texture.manifestEntry} is not ${texture.url} with uvSource ${texture.uvSource.width}x${texture.uvSource.height}`,
          );
      }
      for (const kept of graph.keptTextures) {
        if (kept.owner !== key) continue;
        const record = valueAt(asset, kept.manifestEntry);
        if (
          !sameFile(record, kept) ||
          record.uvSource !== undefined ||
          record.provenance !== undefined
        )
          problems.textures.push(
            `${file} ${key}: the original ${kept.url} (${kept.manifestEntry}) is no longer kept unchanged`,
          );
      }
    }
  for (const [key, count] of servedModels)
    if (!count) problems.models.push(`${key}: no current manifest serves it`);
  for (const [url, count] of servedTextures)
    if (!count) problems.textures.push(`${url}: no current manifest declares it`);
  return problems;
}

/**
 * Read-only inspection of an adoption record in its current state. It uses the saved pre-apply
 * bytes for source correspondence, never the (rewritten) current manifests. The report has no
 * timestamps, so an unchanged state gives an identical report.
 */
export async function auditAdoption(root, id) {
  const { directory, plan, planBytes, journal } = await readRecord(root, id),
    { graph } = plan,
    checks = [],
    check = (name, problems) =>
      checks.push({
        name,
        status: problems.length ? 'failed' : 'passed',
        ...(problems.length
          ? { problemCount: problems.length, problems: problems.slice(0, 40) }
          : {}),
      }),
    skip = (name, reason) => checks.push({ name, status: 'skipped', reason });
  const saved = await savedManifests(directory, plan);
  check('the saved pre-apply and planned manifest bytes match the plan', saved.problems);
  check(
    'the candidate revision manifest, runtime index and verification are unchanged',
    await fileProblems(root, plan.candidateRevision.files),
  );
  const chained = plan.base ? await chainedAdoption() : null,
    correspondence = [];
  let revisionManifest = null;
  if (chained)
    check(
      "the saved manifests are the base adoption's applied bytes, its record is unchanged, and the planned bytes are exactly their chained rewrite",
      await chained.chainedCorrespondence(root, plan, saved),
    );
  else
    try {
      revisionManifest = JSON.parse(
        await readFile(repoFile(root, plan.candidateRevision.files[0].path, 'revision'), 'utf8'),
      );
      const difference = inputDifferences(
        'The saved pre-apply manifests',
        revisionManifest.inputs?.manifests,
        plan.inputs.manifests,
      );
      if (difference) correspondence.push(difference);
    } catch (error) {
      correspondence.push(error.message);
    }
  for (const input of chained ? [] : plan.inputs.manifests) {
    const bytes = saved.before.get(input.path),
      operation = plan.operations.manifests.find((item) => item.path === input.path);
    if (!bytes) continue;
    let rewritten;
    try {
      rewritten = rewriteManifestBytes(input.path, bytes, graph);
    } catch (error) {
      correspondence.push(`${input.path}: ${error.message}`);
      continue;
    }
    if (!rewritten !== !operation)
      correspondence.push(
        `${input.path}: ${operation ? 'the plan rewrites it, the graph does not' : 'the graph rewrites it, the plan does not'}`,
      );
    else if (rewritten && !rewritten.bytes.equals(saved.after.get(input.path) ?? Buffer.alloc(0)))
      correspondence.push(
        `${input.path}: the saved after-bytes are not the rewrite of the saved before-bytes`,
      );
  }
  if (!chained)
    check(
      'the saved pre-apply manifests are the revision inputs, and the planned bytes are exactly their rewrite',
      correspondence,
    );
  // Re-plan the standalone images from the saved pre-apply manifests (never the rewritten ones)
  // and the runtime files as they are now. A chained adoption inherits its base's images: they are
  // re-planned from the base revision and the base's saved pre-apply manifests.
  let compatibility = null;
  if (chained) {
    const result = await chained.inheritedImageCompatibility(root, plan.base, graph),
      problems = [...result.problems];
    if (!result.record !== !plan.runtimeCompatibility)
      problems.push(
        `the plan ${plan.runtimeCompatibility ? 'recorded' : 'did not record'} standalone images; the base revision ${result.record ? 'has' : 'has none'}`,
      );
    if (problems.length || result.record) {
      check(
        "the current runtime still loads the base adoption's standalone images with unchanged meaning (re-planned from its revision and saved pre-apply manifests), and the graph serves them as recorded",
        problems,
      );
      if (result.record)
        compatibility = {
          ...result.record,
          changedSincePlan: !!jsonDifference(
            plan.runtimeCompatibility?.inputs ?? null,
            result.record.inputs,
          ),
        };
    }
  } else if (plan.runtimeCompatibility) {
    const name =
      "the current runtime still loads the revision's standalone images with unchanged meaning (re-planned from the saved pre-apply manifests)";
    if (!revisionManifest) check(name, ['the revision manifest could not be read']);
    else {
      const result = await runtimeCompatibility(root, revisionManifest, {
        inventory: { models: revisionManifest.models },
        // The plan proved character exclusion; this re-plan reads only the camp-cave folder.
        rules: { characterModels: [], excludedSpecies: [] },
        readManifest: async (relative) =>
          saved.before.get(relative) ?? fail(`${relative} has no saved pre-apply bytes`),
      });
      check(name, result.problems);
      if (result.record)
        compatibility = {
          ...result.record,
          changedSincePlan: !!jsonDifference(
            plan.runtimeCompatibility.inputs,
            result.record.inputs,
          ),
        };
    }
  }
  check(
    'the acceptance documents are unchanged',
    await fileProblems(root, plan.acceptance.documents),
  );
  check(
    'every original model and image still matches its recorded identity',
    await originalProblems(root, graph),
  );
  check(
    'every adopted candidate in the revision is unchanged',
    await fileProblems(
      root,
      plan.operations.copies.map((copy) => ({
        path: copy.from,
        sha256: copy.sha256,
        bytes: copy.bytes,
      })),
    ),
  );
  check(
    'every retired candidate (rejected LODs, unused full files) stays unchanged in the revision',
    await fileProblems(
      root,
      (graph.retiredCandidates ?? []).map((retired) => ({
        path: retired.from,
        sha256: retired.sha256,
        bytes: retired.bytes,
      })),
    ),
  );
  check(
    'the evidence of every LOD rejection is unchanged',
    await fileProblems(
      root,
      Object.values(graph.models).flatMap((entry) => entry.lodRejection?.evidence ?? []),
    ),
  );
  if (journal.state === 'planned')
    skip('every adopted file is in public/models under its hash-named URL', 'not applied');
  else
    check(
      'every adopted file is in public/models under its hash-named URL',
      await fileProblems(
        root,
        plan.operations.copies.map((copy) => ({
          path: copy.to,
          sha256: copy.sha256,
          bytes: copy.bytes,
        })),
      ),
    );
  // A chained graph also serves files its base copied; they must still be exactly those bytes.
  if (chained) {
    const copied = new Set(plan.operations.copies.map((copy) => copy.to));
    check(
      'every file the graph serves, retained from the base or copied now, matches its recorded identity in public/models',
      await fileProblems(
        root,
        servedFiles(graph).filter((item) => journal.state !== 'planned' || !copied.has(item.path)),
      ),
    );
  }
  const expected =
      { applied: 'after', planned: 'before', restored: 'before' }[journal.state] ?? null,
    manifestProblems = [];
  for (const operation of plan.operations.manifests) {
    const digest = sha256(await readFile(repoFile(root, operation.path, 'manifest')));
    if (!expected)
      manifestProblems.push(`${operation.path}: the adoption is ${journal.state} (partial)`);
    else if (digest !== operation[expected].sha256)
      manifestProblems.push(
        `${operation.path} is not the ${expected === 'after' ? 'adopted' : 'pre-apply'} bytes (SHA-256 ${digest})`,
      );
  }
  check(
    `the current manifests hold exactly the ${expected === 'after' ? 'adopted' : 'pre-apply'} bytes`,
    manifestProblems,
  );
  if (journal.state === 'applied') {
    const active = await activeGraphProblems(root, plan);
    check('every startup actor serves only its startup file, with no LOD', active.startup);
    check(
      'every model whose old LOD was rejected serves only its full candidate, with no LOD',
      active.full,
    );
    check('every adopted record serves exactly the planned candidate', active.models);
    check(
      'no runtime record names a replaced original, an unused candidate or a cleared LOD',
      active.retired,
    );
    check(
      'cave texture records serve the candidate with uvSource set to the original size',
      active.textures,
    );
  } else skip('active runtime graph', `the adoption is ${journal.state}`);
  check(
    "Three's bundled meshopt decoder is the one the plan recorded",
    await fileProblems(root, [
      { path: graph.decoder.source, sha256: graph.decoder.sha256, bytes: graph.decoder.bytes },
    ]),
  );
  return {
    schema: AUDIT_SCHEMA,
    adoption: id,
    planSha256: sha256(planBytes),
    ...(plan.base
      ? { base: { adoption: plan.base.adoption, planSha256: plan.base.planSha256 } }
      : {}),
    state: journal.state,
    applied: journal.state === 'applied',
    status: checks.some((item) => item.status === 'failed') ? 'failed' : 'passed',
    checks,
    // Both descriptor versions and the runtime files' current hashes; changedSincePlan says
    // whether those files changed after the plan (their meaning is checked above).
    runtimeCompatibility: compatibility,
    // The recorded cost of clearing LODs: what each model's far level showed and now shows.
    farTriangles: Object.entries(graph.models)
      .filter(([, entry]) => entry.farTriangles)
      .map(([modelKey, entry]) => ({
        modelKey,
        selection: entry.selection,
        ...entry.farTriangles,
        ...(entry.lodRejection ? { rejection: entry.lodRejection.decision } : {}),
      })),
  };
}

/** Store an audit report in the adoption folder (audit-<state>.json); an existing different report is refused. */
export async function writeAuditReport(root, report) {
  const file = path.join(adoptionDirectory(root, report.adoption), `audit-${report.state}.json`),
    text = json(report);
  if (existsSync(file)) {
    if ((await readFile(file, 'utf8')) !== text)
      fail(`${file} exists with different content; move it aside first`);
    return file;
  }
  await writeFile(file, text, { flag: 'wx' });
  return file;
}
