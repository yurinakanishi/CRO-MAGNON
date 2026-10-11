// Content-addressed cache of cooked delivery files (dist/delivery/cache, disposable build output).
//
// A cooked file is a pure function of its master's bytes, the cooking options and the recipe
// (this directory's cooking code, its policy and the codec versions). The key covers all of
// them, so a stale entry can never be served for a changed master or recipe.
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { COOK_RECIPE, DEFAULT_POLICY, cookGlb } from './cook-glb.mjs';
import { packLevels } from './pack-levels.mjs';
import { TEXTURE_POLICY, cookTexture } from './cook-texture.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const CACHE_DIRECTORY = 'dist/delivery/cache';
/** Models whose texture alpha a runtime material samples although the GLB marks it OPAQUE. */
export const RUNTIME_ALPHA_MODELS = Object.freeze(new Set(['river-water']));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const COOKED_URL = /^\/models\/([a-z0-9-]+)\/([a-z0-9-]+)(?:\.opt-[0-9a-f]{16})?\.glb$/;

let recipePromise = null;
let sharpPromise = null;

async function loadSharp() {
  sharpPromise ??= import('sharp').then((module) => module.default);
  return sharpPromise;
}

/** Everything the cooked bytes depend on besides the master and its options. */
export async function recipeIdentity() {
  recipePromise ??= (async () => {
    const sharp = await loadSharp();
    const root = path.resolve(here, '../..');
    const meshopt = JSON.parse(
      await readFile(path.join(root, 'node_modules/meshoptimizer/package.json'), 'utf8'),
    ).version;
    const code = Buffer.concat([
      await readFile(path.join(here, 'cook-glb.mjs')),
      await readFile(path.join(here, 'pack-levels.mjs')),
      await readFile(path.join(here, 'cook-texture.mjs')),
    ]);
    const identity = {
      recipe: COOK_RECIPE,
      code: sha256(code),
      policy: DEFAULT_POLICY,
      texturePolicy: TEXTURE_POLICY,
      meshoptimizer: meshopt,
      sharp: sharp.versions.sharp,
      libwebp: sharp.versions.webp,
      libvips: sharp.versions.vips,
    };
    return { ...identity, digest: sha256(Buffer.from(JSON.stringify(identity))) };
  })();
  return recipePromise;
}

/** The delivery URL of a cooked model: its master's name, content-addressed by the cooked SHA. */
export function cookedUrl(sourceUrl, cookedSha) {
  const match = COOKED_URL.exec(sourceUrl);
  if (!match) throw new Error(`Cannot name a cooked delivery file for ${sourceUrl}`);
  return `/models/${match[1]}/${match[2]}.cook-${cookedSha.slice(0, 16)}.glb`;
}

/**
 * The cooked delivery file of one verified master GLB record ({ url, sha256, bytes }), from the
 * cache or cooked now. Returns { url, sha256, bytes, file, report, cooked } where `cooked` is false
 * when the master itself is delivered (cooking did not make it smaller).
 */
export async function cookedModel(root, record, { masterBytes } = {}) {
  const identity = await recipeIdentity();
  const modelKey = COOKED_URL.exec(record.url)?.[1];
  const alphaSampled = RUNTIME_ALPHA_MODELS.has(modelKey);
  const key = sha256(
    Buffer.from(JSON.stringify({ recipe: identity.digest, master: record.sha256, alphaSampled })),
  );
  const directory = path.join(root, CACHE_DIRECTORY);
  const file = path.join(directory, `${key}.glb`);
  const reportFile = path.join(directory, `${key}.json`);
  try {
    const report = JSON.parse(await readFile(reportFile, 'utf8'));
    if (report.master?.sha256 === record.sha256) {
      if (!report.cooked)
        return { ...record, file: path.join(root, 'public', record.url), report, cooked: false };
      const bytes = await readFile(file);
      if (sha256(bytes) === report.delivery.sha256 && bytes.length === report.delivery.bytes)
        return { ...report.delivery, file, report, cooked: true };
    }
  } catch (error) {
    if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
  }
  const master = masterBytes ?? (await readFile(path.join(root, 'public', record.url)));
  if (sha256(master) !== record.sha256 || master.length !== record.bytes)
    throw new Error(`Master mismatch before cooking: ${record.url}`);
  const sharp = await loadSharp();
  const { bytes, report: cookReport } = await cookGlb(master, {
    label: record.url,
    sharp,
    alphaSampled,
  });
  // Deliver the cooked file only when it is actually smaller on the wire.
  const { gzipSync } = await import('node:zlib');
  const smaller = gzipSync(bytes, { level: 6 }).length < gzipSync(master, { level: 6 }).length;
  const delivery = smaller
    ? { url: cookedUrl(record.url, sha256(bytes)), sha256: sha256(bytes), bytes: bytes.length }
    : { url: record.url, sha256: record.sha256, bytes: record.bytes };
  const report = {
    schema: 'cro-magnon/delivery-cook-entry@1',
    recipe: identity,
    master: { url: record.url, sha256: record.sha256, bytes: record.bytes },
    options: { alphaSampled },
    cooked: smaller,
    delivery,
    cook: cookReport,
  };
  await mkdir(directory, { recursive: true });
  if (smaller) {
    const temporary = `${file}.${process.pid}.tmp`;
    await writeFile(temporary, bytes);
    await rename(temporary, file);
  }
  const temporaryReport = `${reportFile}.${process.pid}.tmp`;
  await writeFile(temporaryReport, JSON.stringify(report, null, 2));
  await rename(temporaryReport, reportFile);
  return smaller
    ? { ...delivery, file, report, cooked: true }
    : { ...record, file: path.join(root, 'public', record.url), report, cooked: false };
}

/**
 * One packed delivery file for a static template's level deliveries (level 0 first), from the
 * cache or packed now. Returns { url, sha256, bytes, file, cooked, report } or null when packing
 * would not make the download smaller.
 */
export async function packedModel(root, modelKey, levels) {
  const identity = await recipeIdentity();
  const key = sha256(
    Buffer.from(
      JSON.stringify({ recipe: identity.digest, pack: levels.map((level) => level.sha256) }),
    ),
  );
  const directory = path.join(root, CACHE_DIRECTORY);
  const file = path.join(directory, `${key}.glb`);
  const reportFile = path.join(directory, `${key}.json`);
  try {
    const report = JSON.parse(await readFile(reportFile, 'utf8'));
    if (!report.packed) return null;
    const bytes = await readFile(file);
    if (sha256(bytes) === report.delivery.sha256 && bytes.length === report.delivery.bytes)
      return { ...report.delivery, file, cooked: true, report };
  } catch (error) {
    if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
  }
  const inputs = await Promise.all(levels.map((level) => readFile(level.file)));
  inputs.forEach((bytes, i) => {
    if (sha256(bytes) !== levels[i].sha256)
      throw new Error(`${modelKey} level ${i} changed before packing`);
  });
  const packed = await packLevels(inputs, `${modelKey} levels`);
  const { gzipSync } = await import('node:zlib');
  const before = inputs.reduce((sum, bytes) => sum + gzipSync(bytes, { level: 6 }).length, 0);
  const smaller = gzipSync(packed, { level: 6 }).length < before;
  const delivery = {
    url: `/models/${modelKey}/model-levels.cook-${sha256(packed).slice(0, 16)}.glb`,
    sha256: sha256(packed),
    bytes: packed.length,
  };
  const report = {
    schema: 'cro-magnon/delivery-pack-entry@1',
    recipe: identity,
    levels: levels.map((level) => ({ url: level.url, sha256: level.sha256, bytes: level.bytes })),
    packed: smaller,
    delivery,
  };
  await mkdir(directory, { recursive: true });
  if (smaller) {
    const temporary = `${file}.${process.pid}.tmp`;
    await writeFile(temporary, packed);
    await rename(temporary, file);
  }
  const temporaryReport = `${reportFile}.${process.pid}.tmp`;
  await writeFile(temporaryReport, JSON.stringify(report, null, 2));
  await rename(temporaryReport, reportFile);
  return smaller ? { ...delivery, file, cooked: true, report } : null;
}

const TEXTURE_MASTER = /^\/models\/([a-z0-9-]+)\/([a-z0-9-]+)(?:\.opt-[0-9a-f]{16})?\.png$/;

/**
 * The delivery file of one verified standalone texture record ({ url, sha256, bytes }), from the
 * cache or cooked now. Returns { url, sha256, bytes, file, cooked, report }.
 */
export async function cookedTexture(root, record) {
  const identity = await recipeIdentity();
  const match = TEXTURE_MASTER.exec(record.url);
  const master = { url: record.url, sha256: record.sha256, bytes: record.bytes };
  const masterFile = path.join(root, 'public', record.url);
  if (!match)
    return { ...master, file: masterFile, cooked: false, report: { master, kept: 'name' } };
  const key = sha256(
    Buffer.from(JSON.stringify({ recipe: identity.digest, texture: record.sha256 })),
  );
  const directory = path.join(root, CACHE_DIRECTORY);
  const reportFile = path.join(directory, `${key}.json`);
  try {
    const report = JSON.parse(await readFile(reportFile, 'utf8'));
    if (report.master?.sha256 === record.sha256) {
      if (!report.cooked) return { ...report.master, file: masterFile, cooked: false, report };
      const file = path.join(directory, `${key}.${report.extension}`);
      const bytes = await readFile(file);
      if (sha256(bytes) === report.delivery.sha256 && bytes.length === report.delivery.bytes)
        return { ...report.delivery, file, cooked: true, report };
    }
  } catch (error) {
    if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
  }
  const bytes = await readFile(masterFile);
  if (
    sha256(bytes) !== record.sha256 ||
    (record.bytes !== undefined && bytes.length !== record.bytes)
  )
    throw new Error(`Texture master mismatch before cooking: ${record.url}`);
  const result = await cookTexture(bytes, await loadSharp());
  const report = {
    schema: 'cro-magnon/delivery-texture-entry@1',
    recipe: identity,
    master: { ...master, bytes: bytes.length },
    cooked: !!result.bytes,
    ...(result.bytes
      ? {
          extension: result.extension,
          encoding: result.encoding,
          delivery: {
            url: `/models/${match[1]}/${match[2]}.cook-${sha256(result.bytes).slice(0, 16)}.${result.extension}`,
            sha256: sha256(result.bytes),
            bytes: result.bytes.length,
          },
        }
      : { kept: result.kept }),
    quality: result.quality ?? null,
  };
  await mkdir(directory, { recursive: true });
  const file = path.join(directory, `${key}.${result.extension ?? 'png'}`);
  if (result.bytes) {
    const temporary = `${file}.${process.pid}.tmp`;
    await writeFile(temporary, result.bytes);
    await rename(temporary, file);
  }
  const temporaryReport = `${reportFile}.${process.pid}.tmp`;
  await writeFile(temporaryReport, JSON.stringify(report, null, 2));
  await rename(temporaryReport, reportFile);
  return result.bytes
    ? { ...report.delivery, file, cooked: true, report }
    : { ...master, bytes: bytes.length, file: masterFile, cooked: false, report };
}

/**
 * A UI image served at its own fixed .png URL (character and companion portraits): the master or
 * a palette PNG of it, from the cache or cooked now. Returns { bytes, cooked, report }.
 */
export async function cookedFixedPng(root, relative) {
  const identity = await recipeIdentity();
  const master = await readFile(path.join(root, relative));
  const masterSha = sha256(master);
  const key = sha256(Buffer.from(JSON.stringify({ recipe: identity.digest, fixedPng: masterSha })));
  const directory = path.join(root, CACHE_DIRECTORY);
  const file = path.join(directory, `${key}.png`);
  const reportFile = path.join(directory, `${key}.json`);
  try {
    const report = JSON.parse(await readFile(reportFile, 'utf8'));
    if (report.master?.sha256 === masterSha) {
      if (!report.cooked) return { bytes: master, cooked: false, report };
      const bytes = await readFile(file);
      if (sha256(bytes) === report.delivery.sha256) return { bytes, cooked: true, report };
    }
  } catch (error) {
    if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
  }
  const result = await cookTexture(master, await loadSharp(), TEXTURE_POLICY, { samePng: true });
  const report = {
    schema: 'cro-magnon/delivery-fixed-png@1',
    recipe: identity,
    master: { path: relative, sha256: masterSha, bytes: master.length },
    cooked: !!result.bytes,
    ...(result.bytes
      ? {
          encoding: result.encoding,
          delivery: { sha256: sha256(result.bytes), bytes: result.bytes.length },
        }
      : { kept: result.kept }),
    quality: result.quality ?? null,
  };
  await mkdir(directory, { recursive: true });
  if (result.bytes) {
    const temporary = `${file}.${process.pid}.tmp`;
    await writeFile(temporary, result.bytes);
    await rename(temporary, file);
  }
  const temporaryReport = `${reportFile}.${process.pid}.tmp`;
  await writeFile(temporaryReport, JSON.stringify(report, null, 2));
  await rename(temporaryReport, reportFile);
  return { bytes: result.bytes ?? master, cooked: !!result.bytes, report };
}

/** Remove cache entries of other recipes (their reports name another recipe digest). Returns
 * the number of files removed. Built packages hold copies, so nothing shipped depends on them. */
export async function pruneCache(root) {
  const { digest } = await recipeIdentity();
  const directory = path.join(root, CACHE_DIRECTORY);
  const { readdir, rm } = await import('node:fs/promises');
  let names;
  try {
    names = await readdir(directory);
  } catch (error) {
    if (error.code === 'ENOENT') return 0;
    throw error;
  }
  const stale = new Set();
  for (const name of names.filter((n) => /^[0-9a-f]{64}\.json$/.test(n))) {
    let report = null;
    try {
      report = JSON.parse(await readFile(path.join(directory, name), 'utf8'));
    } catch {
      // An unreadable report is stale.
    }
    if (report?.recipe?.digest !== digest) stale.add(name.slice(0, 64));
  }
  let removed = 0;
  for (const name of names)
    if (stale.has(name.slice(0, 64)) || name.endsWith('.tmp')) {
      await rm(path.join(directory, name), { force: true });
      removed++;
    }
  return removed;
}
