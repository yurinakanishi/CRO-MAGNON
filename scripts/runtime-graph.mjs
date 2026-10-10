// Runtime model and texture graph checks shared by the local, exhibition and MMO builds.
//
// A build ships exactly the files its manifests name. Each one is named by an allowlisted URL,
// and the build checks it against the manifest SHA-256 and length. A hash-named file
// (<name>.opt-<sha16>.<ext>) must also be addressed by that SHA-256. When the manifests carry an
// applied runtime adoption (scripts/optimization/adopt-candidates.mjs), the shipped records must
// be exactly that adoption's audited graph:
// - no original it replaced;
// - no other candidate;
// - no cleared startup-actor LOD;
// - no adopted texture without its recorded uvSource;
// - a packed template only as the adoption packed it: one content-addressed model-levels file,
//   level i in scene i, never a scene outside an adopted packed entry.
// Compressed models ship only with Three's bundled meshopt decoder, the one the adoption
// recorded. Nothing falls back to another mapping.
import { createHash } from 'node:crypto';
import { open, readFile } from 'node:fs/promises';
import path from 'node:path';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export const ADOPTION_DIRECTORY = 'assets/runtime-adoption';
export const ADOPTION_PLAN_SCHEMA = 'cro-magnon/runtime-adoption-plan@1';
export const ADOPTION_JOURNAL_SCHEMA = 'cro-magnon/runtime-adoption-journal@1';
export const ADOPTION_GRAPH_SCHEMA = 'cro-magnon/runtime-adoption-graph@1';
// One lowercase path segment, e.g. 20261009-r04-a01.
export const ADOPTION_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
// Adopted model records carry this field with the original identity they replaced. Adopted
// texture records carry it under their own `provenance` key, which runtimeTextureRecords never
// ships.
export const RUNTIME_FIELD = 'runtimeOptimization';
export const MESHOPT_EXTENSION = 'EXT_meshopt_compression';
// embedded-glb.ts imports the decoder Three ships with its GLTFLoader; prepare-vendor publishes it.
export const DECODER = Object.freeze({
  specifier: 'three/addons/libs/meshopt_decoder.module.js',
  published: 'vendor/addons/libs/meshopt_decoder.module.js',
  source: 'node_modules/three/examples/jsm/libs/meshopt_decoder.module.js',
});

const HASH = /^[0-9a-f]{64}$/;
const MODEL_URL = /^\/models\/[a-z0-9-]+\/([a-z0-9-]+)(?:\.opt-([0-9a-f]{16}))?\.glb$/;
// The original model and LOD names the builds have always accepted.
const ORIGINAL_MODEL = /^(?:model(?:-[a-z0-9]+)*|lod(?:\d+|-[a-z0-9-]+))$/;
const TEXTURE_URL = /^\/models\/[a-z0-9-]+\/[a-z0-9-]+(?:\.opt-([0-9a-f]{16}))?\.([a-z]+)$/;
const GLB_MAGIC = 0x46546c67,
  CHUNK_JSON = 0x4e4f534a;

function addressed(url, prefix, sha, what) {
  if (prefix === undefined) return false;
  if (typeof sha !== 'string' || !HASH.test(sha) || sha.slice(0, 16) !== prefix)
    throw new Error(`Hash-named ${what} ${url} is not addressed by its recorded SHA-256 ${sha}`);
  return true;
}

/** Validate a shipped model URL. It is either an original model/LOD name as before, or a
 * content-addressed candidate of one or of a startup actor. Returns whether it is content-addressed. */
export function checkModelUrl(url, sha) {
  const match = typeof url === 'string' ? MODEL_URL.exec(url) : null;
  if (
    !match ||
    !(ORIGINAL_MODEL.test(match[1]) || (match[2] !== undefined && match[1] === 'startup'))
  )
    throw new Error(`Unexpected model URL: ${url}`);
  return addressed(url, match[2], sha, 'model');
}

/** The same for a standalone runtime texture with one of `extensions`. */
export function checkTextureUrl(url, sha, extensions = ['png']) {
  const match = typeof url === 'string' ? TEXTURE_URL.exec(url) : null;
  if (!match || !extensions.includes(match[2]))
    throw new Error(`Unexpected runtime texture: ${url}`);
  return addressed(url, match[1], sha, 'texture');
}

/** The extensions a GLB requires, read from its JSON chunk (nothing else is parsed). */
export function glbExtensionsRequired(bytes, label) {
  if (
    bytes.length < 20 ||
    bytes.readUInt32LE(0) !== GLB_MAGIC ||
    bytes.readUInt32LE(4) !== 2 ||
    bytes.readUInt32LE(16) !== CHUNK_JSON
  )
    throw new Error(`${label} is not a GLB 2.0 file with a JSON chunk`);
  const length = bytes.readUInt32LE(12);
  if (20 + length > bytes.length) throw new Error(`${label}: the JSON chunk exceeds the file`);
  let json;
  try {
    json = JSON.parse(bytes.toString('utf8', 20, 20 + length));
  } catch (error) {
    throw new Error(`${label}: invalid JSON chunk (${error.message})`);
  }
  const required = json?.extensionsRequired ?? [];
  if (!Array.isArray(required) || !required.every((name) => typeof name === 'string'))
    throw new Error(`${label}: extensionsRequired is not a list of names`);
  return required;
}

/** glbExtensionsRequired of a file, reading only its header and JSON chunk. */
export async function glbFileExtensionsRequired(file, label) {
  const handle = await open(file, 'r');
  try {
    const { size } = await handle.stat(),
      header = Buffer.alloc(20);
    if (size < 20) throw new Error(`${label} is not a GLB 2.0 file with a JSON chunk`);
    await handle.read(header, 0, 20, 0);
    const length = header.readUInt32LE(12);
    if (20 + length > size) throw new Error(`${label}: the JSON chunk exceeds the file`);
    const chunk = Buffer.alloc(length);
    await handle.read(chunk, 0, length, 20);
    return glbExtensionsRequired(Buffer.concat([header, chunk]), label);
  } finally {
    await handle.close();
  }
}

/** Check a texture's recorded size against its PNG header. This applies to a content-addressed
 * PNG and to any record with a uvSource. */
export function checkTextureImage(texture, bytes, label) {
  if (!texture.url.endsWith('.png')) return;
  if (!/\.opt-[0-9a-f]{16}\.png$/.test(texture.url) && texture.uvSource === undefined) return;
  if (
    bytes.length < 24 ||
    bytes.readUInt32BE(0) !== 0x89504e47 ||
    bytes.toString('latin1', 12, 16) !== 'IHDR'
  )
    throw new Error(`${label} is not a PNG`);
  const width = bytes.readUInt32BE(16),
    height = bytes.readUInt32BE(20);
  if (texture.image?.width !== width || texture.image?.height !== height)
    throw new Error(
      `${label} is ${width}x${height}, its manifest records ${texture.image?.width}x${texture.image?.height}`,
    );
}

export function adoptionDirectory(root, id) {
  if (typeof id !== 'string' || !ADOPTION_ID.test(id))
    throw new Error(`Unsafe runtime adoption id ${JSON.stringify(id)}`);
  return path.join(root, ...ADOPTION_DIRECTORY.split('/'), id);
}

/** The adoption the manifest records name, verified as applied, or null when none names one. */
export async function activeAdoption(root, assets, textureRecords) {
  const ids = new Set();
  for (const asset of assets)
    for (const field of [
      asset?.[RUNTIME_FIELD],
      ...textureRecords(asset).map((texture) => texture.provenance?.[RUNTIME_FIELD]),
    ])
      if (field !== undefined) ids.add(field?.adoption);
  if (!ids.size) return null;
  if (ids.size > 1)
    throw new Error(`The manifests name more than one runtime adoption: ${[...ids].join(', ')}`);
  const [id] = ids,
    directory = adoptionDirectory(root, id),
    where = `${ADOPTION_DIRECTORY}/${id}`,
    planBytes = await readFile(path.join(directory, 'plan.json')),
    journal = JSON.parse(await readFile(path.join(directory, 'journal.json'), 'utf8')),
    planSha256 = sha256(planBytes);
  if (
    journal.schema !== ADOPTION_JOURNAL_SCHEMA ||
    journal.adoption !== id ||
    journal.planSha256 !== planSha256
  )
    throw new Error(`${where}/journal.json does not belong to its plan.json`);
  if (journal.state !== 'applied')
    throw new Error(
      `Runtime adoption ${id} is ${journal.state}, not applied; restore it or apply it completely before building`,
    );
  const plan = JSON.parse(planBytes.toString('utf8'));
  if (
    plan.schema !== ADOPTION_PLAN_SCHEMA ||
    plan.adoption !== id ||
    plan.graph?.schema !== ADOPTION_GRAPH_SCHEMA ||
    plan.graph.adoption !== id
  )
    throw new Error(`${where}/plan.json is not a runtime adoption plan for ${id}`);
  return { id, planSha256, graph: plan.graph };
}

const sameFile = (record, expected) =>
  record?.url === expected?.url &&
  record?.sha256 === expected?.sha256 &&
  record?.bytes === expected?.bytes;
// A packed environment template (scripts/optimization/exact-repack.mjs): one content-addressed
// `model-levels` file whose scene i is level i. Its primary is scene 0 and its LODs are scenes
// 1..N. Every level names the same url/sha256/bytes (and the same parts, if any); only triangles,
// distanceMetres and purpose differ.
const PACKED_NAME = 'model-levels';

/** Why `records` (primary first) are not a consistent packed template, or null. */
function packedProblem(records) {
  const [first] = records,
    match = MODEL_URL.exec(first?.url ?? '');
  if (records.some((record, index) => record.scene !== index))
    return `its levels are not scenes 0..${records.length - 1} in order`;
  if (records.some((record) => !sameFile(record, first))) return 'its levels name different files';
  if (
    records.some(
      (record) => JSON.stringify(record.parts ?? null) !== JSON.stringify(first.parts ?? null),
    )
  )
    return 'its levels name different parts';
  if (match?.[1] !== PACKED_NAME || match[2] === undefined)
    return `${first.url} is not a content-addressed ${PACKED_NAME} file`;
  return null;
}

/**
 * Check every model and texture record a build ships against `adoption` (from activeAdoption).
 * `assets` are the manifest records exactly as the build publishes them. Without an adoption,
 * the check is that nothing content-addressed ships unaudited. Returns the shipped graph for the
 * build report.
 */
export function checkRuntimeGraph(
  assets,
  adoption,
  { requireAdoption = false, textureRecords, textureExtensions = ['png'] },
) {
  if (!adoption && requireAdoption)
    throw new Error(
      'optimizedAssets requires manifests carrying an applied runtime adoption (assets/runtime-adoption, scripts/optimization/adopt-candidates.mjs); none is applied, and the legacy assets/public-performance mapping is no longer used',
    );
  const graph = adoption?.graph ?? null,
    outside = adoption ? `runtime adoption ${adoption.id}` : 'any applied runtime adoption',
    retired = new Set(graph?.retired ?? []),
    adoptedTextures = new Map(
      Object.values(graph?.textures ?? {}).map((texture) => [texture.url, texture]),
    ),
    models = [],
    textures = [],
    originals = [];
  for (const asset of assets) {
    const key = asset?.modelKey;
    if (typeof key !== 'string' || !/^[a-z0-9-]+$/.test(key))
      throw new Error(`A shipped asset has an unusable modelKey ${JSON.stringify(key)}`);
    const records = [asset, ...(asset.lods ?? [])],
      entry = graph && Object.hasOwn(graph.models, key) ? graph.models[key] : null;
    const hashed = records.map((record) => checkModelUrl(record.url, record.sha256));
    if (entry) {
      const expected = [entry.primary, ...entry.lods],
        packed = expected.some((record) => record.scene !== undefined);
      if (packed) {
        const problem = packedProblem(expected);
        if (problem) throw new Error(`${key}: ${outside} packs it inconsistently: ${problem}`);
      }
      if (asset[RUNTIME_FIELD]?.adoption !== adoption.id)
        throw new Error(
          `${key}: ${outside} adopts it, but its manifest record is not the adopted one`,
        );
      if (
        records.length !== expected.length ||
        records.some(
          (record, index) =>
            !sameFile(record, expected[index]) || record.scene !== expected[index].scene,
        )
      )
        throw new Error(
          `${key}: the shipped model files or scenes (${records.map((record) => `${record.url}${record.scene === undefined ? '' : `#${record.scene}`}`).join(', ')}) differ from ${outside}`,
        );
      if (packed) {
        const problem = packedProblem(records);
        if (problem)
          throw new Error(`${key}: the shipped records pack it inconsistently: ${problem}`);
      }
    } else {
      if (asset[RUNTIME_FIELD] !== undefined)
        throw new Error(`${key}: carries ${RUNTIME_FIELD}, but ${outside} does not adopt it`);
      if (records.some((record) => record.scene !== undefined))
        throw new Error(`${key}: names a packed scene, but ${outside} does not adopt it packed`);
      records.forEach((record, index) => {
        if (hashed[index])
          throw new Error(`${record.url}: a content-addressed model outside ${outside}`);
        if (retired.has(record.url))
          throw new Error(`${record.url}: ${outside} replaced it, but ${key} still ships it`);
      });
      originals.push({
        modelKey: key,
        reason: graph
          ? (graph.notAdopted?.[key] ?? 'not-in-candidate-revision')
          : 'no-runtime-adoption',
      });
    }
    records.forEach((record, index) =>
      models.push({
        modelKey: key,
        role: index ? 'lod' : 'model',
        url: record.url,
        sha256: record.sha256,
        bytes: record.bytes,
        scene: record.scene ?? null,
        adopted: !!entry,
      }),
    );
    const declared = textureRecords(asset);
    for (const texture of declared) {
      const contentAddressed = checkTextureUrl(texture.url, texture.sha256, textureExtensions),
        adopted = adoptedTextures.get(texture.url);
      if (adopted) {
        if (
          adopted.owner !== key ||
          texture.sha256 !== adopted.sha256 ||
          texture.bytes !== adopted.bytes ||
          texture.image?.width !== adopted.width ||
          texture.image?.height !== adopted.height ||
          texture.uvSource?.width !== adopted.uvSource.width ||
          texture.uvSource?.height !== adopted.uvSource.height ||
          texture.provenance?.[RUNTIME_FIELD]?.adoption !== adoption.id
        )
          throw new Error(
            `${texture.url}: the shipped texture record (identity, size or uvSource) differs from ${outside}`,
          );
      } else {
        if (contentAddressed)
          throw new Error(`${texture.url}: a content-addressed texture outside ${outside}`);
        if (retired.has(texture.url))
          throw new Error(`${texture.url}: ${outside} replaced it, but ${key} still ships it`);
        if (texture.uvSource !== undefined)
          throw new Error(`${texture.url}: has a uvSource outside ${outside}`);
      }
      textures.push({
        modelKey: key,
        url: texture.url,
        sha256: texture.sha256,
        bytes: texture.bytes ?? null,
        adopted: !!adopted,
        ...(adopted ? { uvSource: adopted.uvSource } : {}),
      });
    }
    for (const adopted of adoptedTextures.values())
      if (adopted.owner === key && !declared.some((texture) => texture.url === adopted.url))
        throw new Error(
          `${key}: ${outside} adopts ${adopted.url} (${adopted.manifestEntry}), which the shipped record does not declare`,
        );
  }
  // One physical copy per URL: packed levels share it; one URL never has two identities.
  const physical = new Map();
  for (const model of models) {
    const known = physical.get(model.url);
    if (known && (known.sha256 !== model.sha256 || known.bytes !== model.bytes))
      throw new Error(`${model.url} is named with two identities`);
    if (known) known.records++;
    else
      physical.set(model.url, {
        url: model.url,
        sha256: model.sha256,
        bytes: model.bytes,
        records: 1,
      });
  }
  return {
    adoption: adoption ? { id: adoption.id, planSha256: adoption.planSha256 } : null,
    models,
    physicalModels: [...physical.values()],
    textures,
    originals,
  };
}

/**
 * Check the packaged meshopt decoder. It is required when a shipped model needs
 * EXT_meshopt_compression, and must be byte-identical to the decoder Three ships with its
 * GLTFLoader. That decoder must be the one the adoption recorded.
 */
export async function checkDecoder(root, packaged, { required, adoption }) {
  if (!required) return { required: false, file: null, sha256: null };
  if (!packaged)
    throw new Error(
      `Compressed models need Three's meshopt decoder ${DECODER.published}, which this build does not include`,
    );
  const bundled = await readFile(path.join(root, ...DECODER.source.split('/'))),
    digest = sha256(bundled);
  if (!(Buffer.isBuffer(packaged) ? packaged : Buffer.from(packaged)).equals(bundled))
    throw new Error(
      `${DECODER.published} is not the decoder Three ships with its GLTFLoader (${DECODER.source})`,
    );
  if (adoption && adoption.graph.decoder?.sha256 !== digest)
    throw new Error(
      `${DECODER.source} (${digest}) is not the decoder runtime adoption ${adoption.id} recorded (${adoption.graph.decoder?.sha256}); review the adoption again with this Three release`,
    );
  return { required: true, file: DECODER.published, sha256: digest };
}

const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Every URL of `urls` that `code` names as a quoted string literal ("…", '…' or `…`). */
export function quotedLiterals(code, urls) {
  if (!urls.length) return [];
  const pattern = new RegExp('(["\'`])(' + urls.map(escape).join('|') + ')\\1', 'g'),
    found = new Set();
  for (const match of code.matchAll(pattern)) found.add(match[2]);
  return [...found];
}

/** Every file the adoption replaced that shipped `code` names as a quoted literal. The builds
 * report these for review. A literal is not necessarily a load: the runtime fetches models and
 * cave images through their verified manifest records. */
export function retiredLiteralsIn(code, adoption) {
  return quotedLiterals(code, adoption?.graph?.retired ?? []);
}

/** The first such literal, or null. */
export function retiredLiteral(code, adoption) {
  return retiredLiteralsIn(code, adoption)[0] ?? null;
}

/** SHA-256 of the catalog and of each shipped asset's own manifest, to prove a build leaves them unchanged. */
export async function manifestDigests(root, assets) {
  const files = new Set(['public/models/world-assets.json']);
  for (const asset of assets) {
    if (!/^[a-z0-9-]+$/.test(asset?.modelKey ?? ''))
      throw new Error(
        `A shipped asset has an unusable modelKey ${JSON.stringify(asset?.modelKey)}`,
      );
    files.add(`public/models/${asset.modelKey}/asset.json`);
  }
  const digests = {};
  for (const file of files)
    try {
      digests[file] = sha256(await readFile(path.join(root, ...file.split('/'))));
    } catch (error) {
      // Catalog-only assets have no manifest of their own.
      if (error.code !== 'ENOENT') throw error;
    }
  return digests;
}

export function assertSameDigests(before, after) {
  const changed = Object.keys({ ...before, ...after }).filter(
    (file) => before[file] !== after[file],
  );
  if (changed.length) throw new Error(`The build changed source manifests: ${changed.join(', ')}`);
}
