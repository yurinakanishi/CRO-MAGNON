// Exact repack: a partial candidate revision made ONLY from the files an applied adoption serves,
// without changing any decoded value.
//   1. Every PNG in scope (embedded in the listed GLBs, plus the image owner's standalone images)
//      gets a lossless IDAT rewrite (png-idat.mjs), kept only when strictly smaller. Non-PNG
//      images, other bytes and every meshopt stream are copied verbatim.
//   2. The listed multi-level templates are packed into one GLB each, scene i holding level i
//      (level-pack.mjs). A single-level model gets a new file only if one of its PNGs changed.
//   3. Every output is verified from its bytes against the ORIGINAL served levels:
//      - canonical per-scene identity, with PNG identity aware of the lossless rewrite;
//      - every image byte mapped to its original or its recorded rewrite;
//      - non-image stored bytes identical;
//      - a second decode by Three r185.
// Writes only a NEW revision folder (manifest.json, runtime-index.json, candidates). Adoption is
// separate (repack-adoption.mjs). verifyExactRepack re-derives every output from disk. Nothing here
// changes geometry, image format, size or quality, or falls back to another file.
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { checkModelUrl, checkTextureUrl } from '../runtime-graph.mjs';
import { LOD_REJECTIONS, SELECTION } from './adoption.mjs';
import {
  CANDIDATE_STATUS,
  EXACT_REPACK_RECIPE,
  MANIFEST_SCHEMA,
  MESHOPTIMIZER_VERSION,
  ORIGINAL_KEPT_STATUS,
  PACKED_ROLE,
  STANDALONE_ROLE,
  runtimeIndexOf,
} from './contract.mjs';
import {
  jsonDifference,
  packGlb,
  parseGlb,
  primitiveTriangles,
  sha256,
  storedViewBytes,
  validateDocument,
} from './glb.mjs';
import { checkExtensions } from './gltf-usage.mjs';
import {
  checkSupported,
  packLevels,
  substituteImages,
  substitutionProblems,
  threeProblems,
  verifyLevels,
} from './level-pack.mjs';
import {
  candidateLocation,
  imageCandidateLocation,
  resolveCandidateFile,
  resolveRevisionDirectory,
} from './paths.mjs';
import { IDAT_SETTINGS, checkLosslessRewrite, pngIdentity, recompressPng } from './png-idat.mjs';
import { readServedBase } from './served-base.mjs';

// The reviewed r06 scope: four environment templates (snow-ground and camp-mountain packed) and
// camp-cave's standalone images. The camp-cave GLB itself is never touched.
export const REPACK_SCOPE = Object.freeze({
  models: Object.freeze(['snow-ground', 'camp-mountain', 'meadow-ground', 'river-water']),
  packed: Object.freeze(['snow-ground', 'camp-mountain']),
  imageOwner: 'camp-cave',
  images: 10,
});
export const PACKED_NAME = 'model-levels';
const REPORT_NAME = 'verification.json';
const VERIFICATION_SCHEMA = 'cro-magnon/optimized-runtime-verification@1';

const identity = (record) => ({ url: record?.url, sha256: record?.sha256, bytes: record?.bytes });
const sum = (values) => values.reduce((total, value) => total + value, 0);
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** The manifest's scope record for `scope`. */
export const scopeRecord = (scope) => ({
  complete: false,
  only: [...new Set([...scope.models, ...(scope.imageOwner ? [scope.imageOwner] : [])])].sort(
    byText,
  ),
  models: [...scope.models],
  packed: [...scope.packed],
  imageOwner: scope.imageOwner ?? null,
  images: scope.images,
});
/** The scope a manifest records. */
export const scopeOf = (record) => ({
  models: record?.models ?? [],
  packed: record?.packed ?? [],
  imageOwner: record?.imageOwner ?? null,
  images: record?.images ?? 0,
});

/** Triangles of the meshes a scene reaches, each once. */
function sceneTriangles(json, sceneIndex) {
  const meshes = new Set(),
    stack = [...(json.scenes?.[sceneIndex]?.nodes ?? [])];
  while (stack.length) {
    const node = json.nodes[stack.pop()];
    if (node.mesh !== undefined) meshes.add(node.mesh);
    stack.push(...(node.children ?? []));
  }
  return [...meshes].reduce(
    (total, m) =>
      total +
      json.meshes[m].primitives.reduce(
        (n, primitive) => n + primitiveTriangles(json, primitive),
        0,
      ),
    0,
  );
}

/**
 * The base's entries in `scope`. Only ordinary compressed models with plain (unpacked) records;
 * startup actors, sole-primary full models, rejected LODs, public characters and files shared with
 * another model are refused. A single-level model must have no LOD; a packed one at least one. The
 * image owner's adopted standalone images must be exactly `scope.images` PNGs.
 */
export function repackTargets(base, scope) {
  const fail = (message) => {
      throw new Error(`Exact repack on ${base.id}: ${message}`);
    },
    graph = base.graph,
    packed = new Set(scope.packed);
  if (new Set(scope.models).size !== scope.models.length) fail('a model is listed twice');
  for (const key of packed)
    if (!scope.models.includes(key)) fail(`${key} is packed but not listed`);
  if (scope.imageOwner && scope.models.includes(scope.imageOwner))
    fail(`${scope.imageOwner}'s own model is never repacked`);
  const models = scope.models.map((key) => {
    const entry = Object.hasOwn(graph.models, key) ? graph.models[key] : null;
    if (!entry) fail(`${key} is not adopted`);
    if (
      entry.selection !== SELECTION.ordinary ||
      entry.startup ||
      entry.lodRejection ||
      entry.clearedLods?.length ||
      Object.hasOwn(LOD_REJECTIONS, key)
    )
      fail(
        `${key} is ${entry.selection}; startup actors and rejected LODs keep their bodies, only ordinary compressed models are repacked`,
      );
    const model = base.current.models.find((item) => item.modelKey === key);
    if (!model?.eligible || model.publicCharacter)
      fail(`${key} is not an eligible environment model`);
    const levels = [entry.primary, ...entry.lods];
    if (levels.some((level) => level.scene !== undefined)) fail(`${key} is already packed`);
    if (packed.has(key) && levels.length < 2)
      fail(`${key} has one level; there is nothing to pack`);
    if (!packed.has(key) && levels.length !== 1)
      fail(`${key} has ${levels.length} levels; list it as packed or leave it out`);
    for (const level of levels) {
      const users = [
        ...new Set((base.current.files.get(level.url)?.uses ?? []).map((use) => use.modelKey)),
      ];
      if (users.length !== 1 || users[0] !== key)
        fail(
          `${level.url} is delivered by ${users.join(', ') || 'no current manifest'}, not only ${key}`,
        );
    }
    return { key, entry, levels, packed: packed.has(key) };
  });
  const textures = scope.imageOwner
    ? Object.entries(graph.textures).filter(([, texture]) => texture.owner === scope.imageOwner)
    : [];
  if (textures.length !== scope.images)
    fail(
      `${scope.imageOwner ?? 'no owner'} serves ${textures.length} adopted images, not ${scope.images}`,
    );
  for (const [, texture] of textures)
    if (texture.mimeType !== 'image/png') fail(`${texture.url} is ${texture.mimeType}, not PNG`);
  return { models, textures };
}

async function readServed(root, record, kind) {
  if (kind === 'model') checkModelUrl(record.url, record.sha256);
  else checkTextureUrl(record.url, record.sha256, ['png']);
  const bytes = await readFile(path.join(root, 'public', ...record.url.slice(1).split('/')));
  if (bytes.length !== record.bytes || sha256(bytes) !== record.sha256)
    throw new Error(
      `${record.url}: ${bytes.length} bytes, SHA-256 ${sha256(bytes)}; the base serves ${record.bytes} bytes, ${record.sha256}`,
    );
  return bytes;
}

/** Every served level parsed and checked, every image owner's PNG read; PNGs by SHA-256. */
async function loadSources(root, targets) {
  const pngs = new Map(),
    addPng = (bytes, reference) => {
      const digest = sha256(bytes),
        known = pngs.get(digest);
      if (known && !known.bytes.equals(bytes))
        throw new Error(`two PNGs share SHA-256 ${digest} but differ`);
      if (known) known.references.push(reference);
      else pngs.set(digest, { bytes: Buffer.from(bytes), references: [reference] });
    };
  const models = new Map();
  for (const target of targets.models) {
    const levels = [];
    for (const [index, record] of target.levels.entries()) {
      const label = `${target.key} level ${index}`,
        bytes = await readServed(root, record, 'model'),
        doc = parseGlb(bytes, record.url);
      checkSupported(doc.json, record.url);
      validateDocument(doc.json, doc.bin, record.url, { allowMeshopt: true });
      checkExtensions(doc.json, record.url, { allowMeshopt: true });
      if (sceneTriangles(doc.json, 0) !== record.triangles)
        throw new Error(
          `${record.url}: its scene has ${sceneTriangles(doc.json, 0)} triangles, the base records ${record.triangles}`,
        );
      (doc.json.images ?? []).forEach((image, i) => {
        if (image.mimeType === 'image/png')
          addPng(storedViewBytes(doc.json, doc.bin, image.bufferView), {
            kind: 'glb',
            modelKey: target.key,
            level: index,
            image: i,
          });
      });
      levels.push({ level: index, label, record, bytes, doc });
    }
    models.set(target.key, levels);
  }
  const textures = new Map();
  for (const [sourceUrl, texture] of targets.textures) {
    const bytes = await readServed(root, texture, 'texture'),
      { ihdr } = pngIdentity(bytes, texture.url);
    if (ihdr.width !== texture.width || ihdr.height !== texture.height)
      throw new Error(
        `${texture.url} is ${ihdr.width}x${ihdr.height}; the base records ${texture.width}x${texture.height}`,
      );
    addPng(bytes, { kind: 'texture', owner: texture.owner, manifestEntry: texture.manifestEntry });
    textures.set(sourceUrl, { texture, bytes });
  }
  return { models, textures, pngs };
}

/** One model's output: substituted levels, packed when listed. Null when nothing would change. */
function assembleModel(target, levels, replacements) {
  const substituted = levels.map((level) => {
    const result = substituteImages(level.doc, replacements, level.label);
    if (result.substituted.length) {
      const problems = substitutionProblems(level.doc, result, replacements, level.label);
      if (problems.length) throw new Error(problems.join('; '));
    }
    return { ...level, substitution: result };
  });
  const images = substituted.flatMap((level) =>
    (level.doc.json.images ?? []).flatMap((image, i) => {
      if (image.mimeType !== 'image/png') return [];
      const bytes = storedViewBytes(level.doc.json, level.doc.bin, image.bufferView),
        rewrite = replacements.get(sha256(bytes));
      return [
        {
          level: level.level,
          image: i,
          sha256: sha256(bytes),
          bytes: bytes.length,
          rewrite: rewrite ? { sha256: sha256(rewrite), bytes: rewrite.length } : null,
        },
      ];
    }),
  );
  if (target.packed) {
    const packed = packLevels(
      substituted.map((level) => ({
        label: level.label,
        doc: { json: level.substitution.json, bin: level.substitution.bin },
      })),
      target.key,
    );
    return { bytes: packed.bytes, packing: packed.report, images };
  }
  if (!substituted[0].substitution.substituted.length) return null;
  return {
    bytes: packGlb(substituted[0].substitution.json, substituted[0].substitution.bin),
    packing: null,
    images,
  };
}

/** The output against the ORIGINAL served levels, from its bytes. */
async function verifyModelOutput(bytes, levels, rewrites, label) {
  const result = await verifyLevels(
      bytes,
      levels.map((level) => ({ label: level.label, doc: level.doc })),
      label,
      { rewrites },
    ),
    three = await threeProblems(
      bytes,
      levels.map((level) => ({ label: level.label, bytes: level.bytes })),
      label,
    ),
    problems = [...result.problems, ...three.problems];
  (result.scenes ?? []).forEach((scene, i) => {
    if (scene.triangles !== levels[i].record.triangles)
      problems.push(
        `${label}: scene ${i} has ${scene.triangles} triangles, the served level ${levels[i].record.triangles}`,
      );
  });
  return {
    problems,
    verification: {
      status: 'passed',
      scenes: (result.scenes ?? []).map(({ scene, triangles, canonicalSha256 }) => ({
        scene,
        triangles,
        canonicalSha256,
      })),
      sharedTextureGroups: (result.sharing ?? []).length,
      threeFileWideRenames: three.renames.length,
      compressedViews: result.totals?.compressedViews ?? null,
    },
  };
}

function outputLocation(target, digest) {
  if (!target.packed) return candidateLocation(target.entry.primary.source.url, digest);
  const directory = target.levels[0].url.split('/')[2],
    file = `models/${directory}/${PACKED_NAME}.opt-${digest.slice(0, 16)}.glb`;
  return { file, url: `/${file}` };
}

function modelRecord(target, levels, assembled, verification, location) {
  const digest = sha256(assembled.bytes),
    scenes = levels.map((level, i) => ({
      scene: i,
      level: i,
      triangles: verification.scenes[i].triangles,
    }));
  return {
    id: `model:${target.key}`,
    role: target.packed ? PACKED_ROLE : 'model',
    status: CANDIDATE_STATUS,
    modelKey: target.key,
    uses: levels.map((level, i) => ({
      modelKey: target.key,
      role: i ? 'lod' : 'model',
      lodIndex: i ? i - 1 : null,
    })),
    source: {
      levels: levels.map((level, i) => ({
        level: i,
        ...identity(level.record),
        triangles: level.record.triangles,
        original: identity(level.record.source),
      })),
    },
    output: {
      file: location.file,
      url: location.url,
      sha256: digest,
      bytes: assembled.bytes.length,
      packed: target.packed,
      scenes,
      triangles: scenes[0].triangles,
      extensionsUsed: parseGlb(assembled.bytes, location.file).json.extensionsUsed ?? [],
      extensionsRequired: parseGlb(assembled.bytes, location.file).json.extensionsRequired ?? [],
    },
    images: assembled.images,
    packing: assembled.packing
      ? {
          deduplicatedImageViews: assembled.packing.deduplicatedImageViews,
          notDeduplicated: assembled.packing.notDeduplicated,
          textureSharing: assembled.packing.textureSharing,
          differingRootMetadata: assembled.packing.differingRootMetadata,
          droppedBufferMetadata: assembled.packing.droppedBufferMetadata,
        }
      : null,
    verification,
    knownRisks: target.packed
      ? [
          'One file serves every level: the runtime must select scene i for level i, as the packed-level contract defines. Native per-level review is still required.',
        ]
      : [],
  };
}

const pngSummary = (pngs, outcomes) =>
  [...pngs.entries()]
    .sort(([a], [b]) => byText(a, b))
    .map(([digest, png]) => {
      const outcome = outcomes.get(digest);
      return {
        sha256: digest,
        bytes: png.bytes.length,
        references: png.references,
        status: outcome.status,
        candidate: outcome.candidate
          ? { sha256: sha256(outcome.candidate), bytes: outcome.candidate.length }
          : null,
        reason: outcome.reason,
      };
    });

function totalsOf(targets, sources, records, imageRecords) {
  const unique = (files) => [...new Map(files.map((file) => [file.url, file])).values()],
    perModel = targets.models.map((target) => {
      const record = records.find((item) => item.modelKey === target.key),
        before = unique(target.levels.map(identity)),
        after = record ? [identity(record.output)] : before;
      return {
        modelKey: target.key,
        packed: target.packed,
        before: { files: before.length, bytes: sum(before.map((file) => file.bytes)) },
        after: { files: after.length, bytes: sum(after.map((file) => file.bytes)) },
      };
    }),
    textures = imageRecords.map((record) => ({
      before: record.source.bytes,
      after: record.output ? record.output.bytes : record.source.bytes,
    })),
    before =
      sum(perModel.map((model) => model.before.bytes)) +
      sum(textures.map((texture) => texture.before)),
    after =
      sum(perModel.map((model) => model.after.bytes)) +
      sum(textures.map((texture) => texture.after));
  return {
    rule: 'unique physical files actually served before and after this revision (not a sum of earlier proofs)',
    before: {
      files: sum(perModel.map((model) => model.before.files)) + textures.length,
      bytes: before,
    },
    after: {
      files: sum(perModel.map((model) => model.after.files)) + textures.length,
      bytes: after,
    },
    savedBytes: before - after,
    models: perModel,
    textures: {
      images: textures.length,
      replaced: imageRecords.filter((record) => record.output).length,
      before: sum(textures.map((t) => t.before)),
      after: sum(textures.map((t) => t.after)),
    },
    distinctPngs: sources.pngs.size,
  };
}

/** Everything a revision records, computed from the base's served files. */
async function computeRevision(root, base, scope, settings) {
  const targets = repackTargets(base, scope),
    sources = await loadSources(root, targets),
    outcomes = new Map();
  for (const [digest, png] of sources.pngs)
    outcomes.set(digest, recompressPng(png.bytes, digest.slice(0, 12), settings));
  const replacements = new Map(
      [...outcomes]
        .filter(([, outcome]) => outcome.candidate)
        .map(([digest, outcome]) => [digest, outcome.candidate]),
    ),
    rewrites = new Map([...replacements].map(([digest, bytes]) => [digest, sha256(bytes)])),
    outputs = new Map(),
    records = [];
  for (const target of targets.models) {
    const levels = sources.models.get(target.key),
      assembled = assembleModel(target, levels, replacements);
    if (!assembled) continue;
    const again = assembleModel(target, levels, replacements);
    if (!assembled.bytes.equals(again.bytes))
      throw new Error(`${target.key}: assembling twice gives different bytes`);
    const { problems, verification } = await verifyModelOutput(
      assembled.bytes,
      levels,
      rewrites,
      target.key,
    );
    if (problems.length)
      throw new Error(`${target.key}: the output is not exact: ${problems.slice(0, 8).join('; ')}`);
    const location = outputLocation(target, sha256(assembled.bytes));
    records.push(modelRecord(target, levels, assembled, verification, location));
    outputs.set(location.file, assembled.bytes);
  }
  const imageRecords = [];
  for (const [sourceUrl, { texture, bytes }] of sources.textures) {
    const digest = sha256(bytes),
      outcome = outcomes.get(digest),
      candidate = outcome.candidate;
    let output = null;
    if (candidate) {
      const location = imageCandidateLocation(texture.source.url, sha256(candidate));
      output = {
        file: location.file,
        url: location.url,
        sha256: sha256(candidate),
        bytes: candidate.length,
        width: texture.width,
        height: texture.height,
      };
      outputs.set(location.file, candidate);
    }
    imageRecords.push({
      id: `image:${sourceUrl}`,
      role: STANDALONE_ROLE,
      status: output ? CANDIDATE_STATUS : ORIGINAL_KEPT_STATUS,
      owner: texture.owner,
      manifestEntry: texture.manifestEntry,
      png: digest,
      source: { ...identity(texture), width: texture.width, height: texture.height },
      original: identity(texture.source),
      output,
      verification: output
        ? {
            status: 'passed',
            identity:
              'lossless IDAT rewrite: IHDR, non-IDAT chunks and filtered scanlines identical',
            width: texture.width,
            height: texture.height,
          }
        : null,
      reason: output ? null : outcome.reason,
      knownRisks: [],
    });
  }
  return {
    targets,
    sources,
    outcomes,
    records,
    imageRecords,
    outputs,
    png: pngSummary(sources.pngs, outcomes),
  };
}

function manifestOf(revision, base, scope, settings, computed) {
  const manifest = {
    schema: MANIFEST_SCHEMA,
    recipe: EXACT_REPACK_RECIPE,
    revision: path.basename(revision.absolute),
    directory: revision.relative,
    status: 'candidate',
    adoption: 'not-adopted',
    visualQa: 'pending-native-review',
    gpuValidation: 'not-performed',
    scope: scopeRecord(scope),
    base: base.record,
    policy: {
      recipe:
        'the files the base serves, repacked without changing a decoded value: lossless PNG IDAT rewrites (strictly smaller only) and multi-scene packing of the listed templates; no geometry, image format, size or quality change; non-PNG images and every other stored byte verbatim',
      png: {
        level: settings.level,
        windowBits: settings.windowBits,
        strategies: [...settings.strategies],
        memLevels: [...settings.memLevels],
        zlib: process.versions.zlib,
      },
      packing:
        'one GLB per listed template, scene i is level i; per-level nodes, meshes, materials, textures and samplers; identical image views stored once; samplers shared only where Three would share one Texture with one colour space',
      unchanged:
        'a model with no changed PNG and no packing keeps its served file; an image whose rewrite is not smaller keeps its served file',
    },
    inputs: { manifests: base.current.manifests },
    toolchain: {
      node: process.version,
      zlib: process.versions.zlib,
      meshoptimizer: MESHOPTIMIZER_VERSION,
    },
    models: computed.targets.models.map((target) => ({
      modelKey: target.key,
      packed: target.packed,
      levels: target.levels.map((level, i) => ({
        level: i,
        ...identity(level),
        triangles: level.triangles,
      })),
      output: computed.records.find((record) => record.modelKey === target.key)?.output.url ?? null,
    })),
    files: computed.records,
    images: computed.imageRecords,
    png: computed.png,
  };
  manifest.totals = totalsOf(
    computed.targets,
    computed.sources,
    computed.records,
    computed.imageRecords,
  );
  return manifest;
}

/**
 * Generate an exact-repack revision of the applied adoption `base` into the new folder `out`. With
 * `dryRun` nothing is written. `scope` and `settings` default to the reviewed r06 recipe.
 */
export async function generateExactRepack(
  root,
  { base: baseId, out, rules, scope = REPACK_SCOPE, settings = IDAT_SETTINGS, dryRun = false } = {},
) {
  if (typeof baseId !== 'string' || !baseId)
    throw new Error('An exact repack needs its applied base adoption (--base-adoption)');
  const revision = resolveRevisionDirectory(root, out);
  if (existsSync(revision.absolute))
    throw new Error(`${revision.relative} already exists; an exact repack needs a new --out`);
  const base = await readServedBase(root, baseId, rules),
    computed = await computeRevision(root, base, scope, settings),
    manifest = manifestOf(revision, base, scope, settings, computed);
  // The full encoder attempts (sizes and timings) stay beside the manifest, for review only.
  const attemptsRecord = {
    png: [...computed.outcomes].map(([digest, outcome]) => ({
      sha256: digest,
      status: outcome.status,
      reason: outcome.reason,
      record: outcome.record,
    })),
  };
  if (dryRun)
    return {
      dryRun: true,
      revision: revision.relative,
      base: baseId,
      scope: manifest.scope,
      totals: manifest.totals,
      files: manifest.files.map((record) => record.output.url),
      images: manifest.images.map((record) => record.output?.url ?? null),
    };
  const staging = path.join(
    path.dirname(revision.absolute),
    `.${path.basename(revision.absolute)}.staging-${process.pid}`,
  );
  await mkdir(staging);
  try {
    for (const [file, bytes] of computed.outputs) {
      const target = path.join(staging, ...file.split('/'));
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, bytes, { flag: 'wx' });
    }
    await writeFile(path.join(staging, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', {
      flag: 'wx',
    });
    await writeFile(
      path.join(staging, 'runtime-index.json'),
      JSON.stringify(runtimeIndexOf(manifest), null, 2) + '\n',
      { flag: 'wx' },
    );
    await writeFile(
      path.join(staging, 'png-attempts.json'),
      JSON.stringify(attemptsRecord, null, 2) + '\n',
      { flag: 'wx' },
    );
    if (existsSync(revision.absolute))
      throw new Error(`${revision.relative} appeared during generation; nothing was moved there`);
    await rename(staging, revision.absolute);
  } catch (error) {
    await rm(staging, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    throw error;
  }
  return {
    revision: revision.relative,
    base: baseId,
    scope: manifest.scope,
    totals: manifest.totals,
  };
}

// ---------------------------------------------------------------------------------------------
// Verification from disk

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

async function readOutput(revision, output, expected) {
  if (output?.file !== expected.file || output.url !== expected.url)
    throw new Error(`${output?.file} is not the content-addressed name ${expected.file}`);
  const bytes = await readFile(resolveCandidateFile(revision.absolute, output.file));
  if (bytes.length !== output.bytes || sha256(bytes) !== output.sha256)
    throw new Error(`${output.file}: the file differs from its recorded SHA-256/length`);
  return bytes;
}

/**
 * Re-verify the exact-repack revision `requested` against the applied adoption `base` from disk,
 * independently of the generator: every output is re-derived from the base's served files and the
 * recorded lossless rewrites and must be byte-identical, then compared scene by scene with the
 * original levels. `served` may pass an already verified base. Returns the verification report.
 */
export async function verifyExactRepack(
  root,
  requested,
  { base: baseId, rules, served = null } = {},
) {
  const revision = resolveRevisionDirectory(root, requested),
    manifest = JSON.parse(await readFile(path.join(revision.absolute, 'manifest.json'), 'utf8')),
    runtimeIndex = JSON.parse(
      await readFile(path.join(revision.absolute, 'runtime-index.json'), 'utf8'),
    );
  if (manifest.schema !== MANIFEST_SCHEMA || manifest.recipe !== EXACT_REPACK_RECIPE)
    throw new Error(`${revision.relative} is not an exact-repack revision`);
  if (manifest.base?.adoption !== baseId)
    throw new Error(`${revision.relative} repacks ${manifest.base?.adoption}, not ${baseId}`);
  const base = served ?? (await readServedBase(root, baseId, rules)),
    checks = [],
    results = [],
    check = (name, problems) =>
      checks.push({
        name,
        status: problems.length ? 'failed' : 'passed',
        ...(problems.length ? { problems: problems.slice(0, 40) } : {}),
      }),
    diff = (a, b, where) => {
      const difference = jsonDifference(a, b, where);
      return difference ? [difference] : [];
    },
    installed = JSON.parse(
      await readFile(path.join(root, 'node_modules', 'meshoptimizer', 'package.json'), 'utf8'),
    ).version;
  check(
    'the base adoption is still applied with the recorded records',
    diff(manifest.base, base.record, '$.base'),
  );
  check(
    "the inputs are the base's current manifests",
    diff(manifest.inputs?.manifests, base.current.manifests, '$.inputs.manifests'),
  );
  check(
    'runtime-index.json is exactly derived from manifest.json',
    diff(runtimeIndexOf(manifest), runtimeIndex, '$index'),
  );
  check(
    `the decoders are meshoptimizer ${MESHOPTIMIZER_VERSION}`,
    installed === MESHOPTIMIZER_VERSION &&
      manifest.toolchain?.meshoptimizer === MESHOPTIMIZER_VERSION
      ? []
      : [`installed ${installed}, recorded ${manifest.toolchain?.meshoptimizer}`],
  );
  check(
    'every record is an unadopted candidate',
    manifest.status === 'candidate' &&
      manifest.adoption === 'not-adopted' &&
      manifest.files.every((record) => record.status === CANDIDATE_STATUS) &&
      manifest.images.every(
        (record) => record.status === (record.output ? CANDIDATE_STATUS : ORIGINAL_KEPT_STATUS),
      )
      ? []
      : ['a record claims another status'],
  );
  const scope = scopeOf(manifest.scope);
  let targets, sources;
  try {
    check('the scope is the recorded scope', diff(manifest.scope, scopeRecord(scope), '$.scope'));
    targets = repackTargets(base, scope);
    sources = await loadSources(root, targets);
  } catch (error) {
    check('the scope and the served sources are valid', [error.message]);
    return reportOf(manifest, base, checks, results);
  }
  // The PNG records: exactly the scope's PNGs; each rewrite strictly smaller.
  const recordedPng = new Map((manifest.png ?? []).map((item) => [item.sha256, item]));
  check(
    "the PNG records are exactly the scope's PNGs",
    diff(
      (manifest.png ?? []).map(({ sha256: digest, bytes, references }) => ({
        sha256: digest,
        bytes,
        references,
      })),
      [...sources.pngs.entries()]
        .sort(([a], [b]) => byText(a, b))
        .map(([digest, png]) => ({
          sha256: digest,
          bytes: png.bytes.length,
          references: png.references,
        })),
      '$.png',
    ),
  );
  const rewrites = new Map(
    [...recordedPng.values()]
      .filter((item) => item.status === 'candidate' && item.candidate)
      .map((item) => [item.sha256, item.candidate.sha256]),
  );
  for (const item of recordedPng.values())
    if (
      (item.status === 'candidate') !== !!item.candidate ||
      (item.candidate && item.candidate.bytes >= item.bytes)
    )
      check(`PNG ${item.sha256.slice(0, 12)} records a consistent, strictly smaller rewrite`, [
        'it does not',
      ]);
  // Model outputs: re-derived exactly from the served levels and the rewrites found in the output.
  const expectedRecords = new Set();
  for (const target of targets.models) {
    const levels = sources.models.get(target.key),
      record = manifest.files.find((item) => item.modelKey === target.key),
      rewritten = levels.some((level) =>
        (level.doc.json.images ?? []).some(
          (image) =>
            image.mimeType === 'image/png' &&
            rewrites.has(sha256(storedViewBytes(level.doc.json, level.doc.bin, image.bufferView))),
        ),
      );
    if (!record) {
      if (target.packed || rewritten)
        results.push({
          id: `model:${target.key}`,
          status: 'failed',
          error: 'the recipe changes this model, but the revision records no output',
        });
      continue;
    }
    expectedRecords.add(record.id);
    try {
      const output = await readOutput(
          revision,
          record.output,
          outputLocation(target, record.output.sha256 ?? ''),
        ),
        doc = parseGlb(output, record.output.file),
        replacements = new Map(),
        byRewrite = new Map([...rewrites].map(([original, rewrite]) => [rewrite, original]));
      for (const image of doc.json.images ?? []) {
        const bytes = storedViewBytes(doc.json, doc.bin, image.bufferView),
          original = byRewrite.get(sha256(bytes));
        if (original) replacements.set(original, Buffer.from(bytes));
      }
      for (const [original, bytes] of replacements) {
        checkLosslessRewrite(
          sources.pngs.get(original).bytes,
          bytes,
          `${target.key} ${original.slice(0, 12)}`,
        );
        if (bytes.length >= sources.pngs.get(original).bytes.length)
          throw new Error(`${original.slice(0, 12)}: the rewrite is not smaller`);
      }
      // Every recorded rewrite of this model's PNGs is the one it serves; none is silently kept original.
      for (const level of levels)
        for (const image of level.doc.json.images ?? []) {
          const digest = sha256(storedViewBytes(level.doc.json, level.doc.bin, image.bufferView));
          if (image.mimeType === 'image/png' && rewrites.has(digest) && !replacements.has(digest))
            throw new Error(
              `${digest.slice(0, 12)} has a recorded rewrite that ${record.output.file} does not carry`,
            );
        }
      const assembled = assembleModel(target, levels, replacements);
      if (!assembled || !assembled.bytes.equals(output))
        throw new Error(
          `${record.output.file} is not the exact recipe output of the served levels`,
        );
      const { problems, verification } = await verifyModelOutput(
        output,
        levels,
        rewrites,
        target.key,
      );
      if (problems.length) throw new Error(problems.slice(0, 8).join('; '));
      const expected = modelRecord(
          target,
          levels,
          assembled,
          verification,
          outputLocation(target, sha256(output)),
        ),
        difference = jsonDifference(record, expected);
      if (difference) throw new Error(`the record differs from the re-derived one (${difference})`);
      results.push({ id: record.id, status: 'passed', verification });
    } catch (error) {
      results.push({ id: record.id, status: 'failed', error: error.message });
    }
  }
  check(
    'no record outside the scope or twice',
    manifest.files
      .filter((record) => !expectedRecords.has(record.id))
      .map((record) => `${record.id} is not expected`)
      .concat(manifest.files.length === expectedRecords.size ? [] : ['a model is recorded twice']),
  );
  // Standalone images: each a recorded, strictly smaller lossless rewrite, or kept.
  const listedImages = new Set();
  for (const [sourceUrl, { texture, bytes }] of sources.textures) {
    const id = `image:${sourceUrl}`,
      record = manifest.images.find((item) => item.id === id);
    listedImages.add(id);
    if (!record) {
      results.push({ id, status: 'failed', error: 'no record' });
      continue;
    }
    try {
      const recorded = recordedPng.get(sha256(bytes));
      let output = null;
      if (record.output) {
        const candidate = await readOutput(
          revision,
          record.output,
          imageCandidateLocation(texture.source.url, record.output.sha256 ?? ''),
        );
        checkLosslessRewrite(bytes, candidate, id);
        if (candidate.length >= bytes.length) throw new Error('the rewrite is not smaller');
        if (recorded?.candidate?.sha256 !== record.output.sha256)
          throw new Error('the PNG record names another rewrite');
        output = { ...record.output };
      } else if (rewrites.has(sha256(bytes))) throw new Error('a recorded rewrite has no output');
      const expected = {
          id,
          role: STANDALONE_ROLE,
          status: output ? CANDIDATE_STATUS : ORIGINAL_KEPT_STATUS,
          owner: texture.owner,
          manifestEntry: texture.manifestEntry,
          png: sha256(bytes),
          source: { ...identity(texture), width: texture.width, height: texture.height },
          original: identity(texture.source),
          output: output && {
            file: output.file,
            url: output.url,
            sha256: output.sha256,
            bytes: output.bytes,
            width: texture.width,
            height: texture.height,
          },
          verification: output
            ? {
                status: 'passed',
                identity:
                  'lossless IDAT rewrite: IHDR, non-IDAT chunks and filtered scanlines identical',
                width: texture.width,
                height: texture.height,
              }
            : null,
          reason: output ? null : (recorded?.reason ?? null),
          knownRisks: [],
        },
        difference = jsonDifference(record, expected);
      if (difference) throw new Error(`the record differs from the re-derived one (${difference})`);
      results.push({ id, status: 'passed', verification: record.verification });
    } catch (error) {
      results.push({ id, status: 'failed', error: error.message });
    }
  }
  check(
    'no image record outside the scope',
    manifest.images
      .filter((record) => !listedImages.has(record.id))
      .map((record) => `${record.id} is not expected`),
  );
  check(
    'the totals are the actual served bytes before and after',
    diff(manifest.totals, totalsOf(targets, sources, manifest.files, manifest.images), '$.totals'),
  );
  const listed = new Set([
    'manifest.json',
    'runtime-index.json',
    'png-attempts.json',
    REPORT_NAME,
    ...manifest.files.map((record) => record.output.file),
    ...manifest.images.filter((record) => record.output).map((record) => record.output.file),
  ]);
  check(
    'the revision folder holds only recorded files',
    (await listFiles(revision.absolute)).filter((file) => !listed.has(file)),
  );
  return reportOf(manifest, base, checks, results);
}

function reportOf(manifest, base, checks, results) {
  const failures =
    checks.filter((item) => item.status !== 'passed').length +
    results.filter((item) => item.status !== 'passed').length;
  return {
    schema: VERIFICATION_SCHEMA,
    revision: manifest.revision,
    recipe: EXACT_REPACK_RECIPE,
    base: { adoption: base.id, planSha256: base.planSha256 },
    scope: manifest.scope,
    status: failures ? 'failed' : 'passed',
    candidateStatus: CANDIDATE_STATUS,
    verified:
      'local files only: base still applied, served sources by hash, every output re-derived byte for byte, canonical scenes against the original levels with lossless-aware PNG identity, image byte mapping, non-image bytes, both meshopt decoders and a Three r185 decode',
    notVerified: [
      'native browser decoding and GPU upload',
      'runtime selection of packed scenes',
      'transfer and startup time',
      'mobile devices',
    ],
    checks,
    files: results,
  };
}

export const EXACT_REPACK_REPORT = REPORT_NAME;
