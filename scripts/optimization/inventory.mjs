// Current-manifest inventory: which model GLBs are eligible for runtime candidates and why
// the others are excluded. Reads only local repository files; nothing is fetched.
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { sha256 } from './glb.mjs';
import { resolveSourceFile } from './paths.mjs';

export const CATALOG = 'public/models/world-assets.json';
export const PUBLIC_RELEASE = 'cloudflare/public-release.json';
// The same built modules the 2026-10-09 audit used for eligibility.
export const ELIGIBILITY_MODULES = Object.freeze([
  'dist/shared/mascot-roster.mjs',
  'dist/src/scenery-visibility.js',
  'dist/shared/character-profiles.mjs',
]);
const HASH = /^[0-9a-f]{64}$/;

export async function loadEligibilityRules(root) {
  const inputs = [],
    modules = [];
  for (const relative of ELIGIBILITY_MODULES) {
    const file = path.join(root, ...relative.split('/'));
    let bytes;
    try {
      bytes = await readFile(file);
    } catch (error) {
      if (error.code === 'ENOENT')
        throw new Error(`${relative} is missing; run "npm run build" first`);
      throw error;
    }
    inputs.push({ path: relative, sha256: sha256(bytes) });
    modules.push(await import(pathToFileURL(file).href));
  }
  const releaseBytes = await readFile(path.join(root, ...PUBLIC_RELEASE.split('/'))),
    release = JSON.parse(releaseBytes);
  inputs.push({ path: PUBLIC_RELEASE, sha256: sha256(releaseBytes) });
  const [roster, visibility, characters] = modules;
  if (
    typeof roster.mascotModelReleased !== 'function' ||
    typeof visibility.groundcoverVisible !== 'function'
  )
    throw new Error('eligibility modules do not export mascotModelReleased/groundcoverVisible');
  if (!Array.isArray(characters.CHARACTER_MODELS))
    throw new Error('character profiles do not export CHARACTER_MODELS');
  return {
    mascotModelReleased: roster.mascotModelReleased,
    groundcoverVisible: visibility.groundcoverVisible,
    characterModels: characters.CHARACTER_MODELS,
    excludedSpecies: release.excludedCharacters ?? [],
    inputs,
  };
}

export function publicCharacterKeys(rules) {
  return rules.characterModels
    .filter(
      (profile) => profile.playable !== false && !rules.excludedSpecies.includes(profile.species),
    )
    .map((profile) => profile.key);
}

/** Eligibility as in the 2026-10-09 audit: active world catalog plus public player characters. */
export function classifyModel(modelKey, worldCatalog, rules) {
  const publicCharacter = publicCharacterKeys(rules).includes(modelKey),
    result = (eligible, reason) => ({ eligible, reason, publicCharacter });
  if (worldCatalog) {
    if (!rules.mascotModelReleased(modelKey)) return result(false, 'dormant-mascot-roster-entry');
    if (!rules.groundcoverVisible(modelKey))
      return result(false, 'decorative-groundcover-disabled');
    return result(true, 'active-world-catalog');
  }
  if (publicCharacter) return result(true, 'public-player-character');
  const profile = rules.characterModels.find((candidate) => candidate.key === modelKey);
  if (profile?.playable === false) return result(false, 'character-not-playable');
  if (profile && rules.excludedSpecies.includes(profile.species))
    return result(false, 'excluded-from-public-release');
  return result(false, 'not-in-world-catalog-or-character-roster');
}

function fileRecord(record, where) {
  if (
    typeof record?.url !== 'string' ||
    !HASH.test(record.sha256 ?? '') ||
    !Number.isSafeInteger(record.bytes) ||
    record.bytes < 1
  )
    throw new Error(`${where}: invalid url/sha256/bytes record`);
  resolveSourceFile('.', record.url);
  return { url: record.url, sha256: record.sha256, bytes: record.bytes };
}

function compareRecords(catalog, individual, where) {
  const files = (asset) =>
    [asset, ...(asset.lods ?? [])].map(
      (record) => `${record.url}|${record.sha256}|${record.bytes}`,
    );
  const a = files(catalog),
    b = files(individual);
  if (a.length !== b.length || a.some((value, index) => value !== b[index]))
    throw new Error(
      `${CATALOG} and ${where} disagree on the delivered files of ${catalog.modelKey}`,
    );
}

/** Model folders of a manifest snapshot (repository path -> bytes); anything else is refused. */
function snapshotDirectories(snapshot) {
  const names = [];
  for (const relative of snapshot.keys()) {
    if (relative === CATALOG) continue;
    const match = /^public\/models\/([a-z0-9][a-z0-9._-]*)\/asset\.json$/.exec(relative);
    if (!match)
      throw new Error(`the manifest snapshot holds an unexpected path ${JSON.stringify(relative)}`);
    names.push(match[1]);
  }
  return names.sort();
}

/**
 * The model inventory of the current manifests. With `snapshot` (repository path -> bytes, such as
 * an adoption's saved pre-apply manifests) it is built from exactly those bytes instead, and every
 * snapshot file must be one the inventory reads; the GLBs they name are still read from disk.
 */
export async function buildInventory(root, rules, { snapshot = null } = {}) {
  const read = async (relative) => {
    if (!snapshot) return readFile(path.join(root, ...relative.split('/')));
    if (!snapshot.has(relative))
      throw Object.assign(new Error(`${relative} is not in the manifest snapshot`), {
        code: 'ENOENT',
      });
    return snapshot.get(relative);
  };
  const catalogBytes = await read(CATALOG),
    catalog = JSON.parse(catalogBytes);
  if (!Array.isArray(catalog.assets)) throw new Error(`${CATALOG} has no assets array`);
  const manifests = [{ path: CATALOG, sha256: sha256(catalogBytes) }],
    records = new Map();
  for (const asset of catalog.assets) {
    if (records.has(asset.modelKey)) throw new Error(`${CATALOG} lists ${asset.modelKey} twice`);
    records.set(asset.modelKey, { asset, worldCatalog: true, manifest: CATALOG });
  }
  const directories = snapshot
    ? snapshotDirectories(snapshot)
    : (await readdir(path.join(root, 'public', 'models'), { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
  for (const name of directories) {
    const relative = `public/models/${name}/asset.json`;
    let bytes;
    try {
      bytes = await read(relative);
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    const asset = JSON.parse(bytes);
    if (!asset.modelKey || typeof asset.url !== 'string' || !asset.url.endsWith('.glb')) continue;
    manifests.push({ path: relative, sha256: sha256(bytes) });
    const known = records.get(asset.modelKey);
    if (known?.worldCatalog) compareRecords(known.asset, asset, relative);
    else if (known)
      throw new Error(`${relative} and ${known.manifest} both describe ${asset.modelKey}`);
    else records.set(asset.modelKey, { asset, worldCatalog: false, manifest: relative });
  }
  if (snapshot && manifests.length !== snapshot.size) {
    const used = new Set(manifests.map((manifest) => manifest.path));
    throw new Error(
      `the manifest snapshot holds files that describe no model: ${[...snapshot.keys()].filter((relative) => !used.has(relative)).join(', ')}`,
    );
  }
  const files = new Map(),
    models = [];
  for (const { asset, worldCatalog, manifest } of records.values()) {
    const where = `${manifest} ${asset.modelKey}`,
      entries = [
        { role: 'model', lodIndex: null, ...fileRecord(asset, where) },
        ...(asset.lods ?? []).map((lod, index) => ({
          role: 'lod',
          lodIndex: index,
          distanceMetres: lod.distanceMetres ?? null,
          ...fileRecord(lod, `${where} lods[${index}]`),
        })),
      ];
    for (const entry of entries) {
      const known = files.get(entry.url);
      if (known && (known.sha256 !== entry.sha256 || known.bytes !== entry.bytes))
        throw new Error(`${entry.url} has conflicting manifest records`);
      if (known)
        known.uses.push({ modelKey: asset.modelKey, role: entry.role, lodIndex: entry.lodIndex });
      else
        files.set(entry.url, {
          url: entry.url,
          sha256: entry.sha256,
          bytes: entry.bytes,
          uses: [{ modelKey: asset.modelKey, role: entry.role, lodIndex: entry.lodIndex }],
        });
    }
    models.push({
      modelKey: asset.modelKey,
      kind: asset.kind ?? null,
      worldCatalog,
      manifest,
      ...classifyModel(asset.modelKey, worldCatalog, rules),
      files: entries,
    });
  }
  return { manifests, models, files };
}

/** Read an original exactly as the manifest records it; any drift is an error. */
export async function readVerifiedSource(root, record) {
  const file = resolveSourceFile(root, record.url),
    bytes = await readFile(file);
  if (bytes.length !== record.bytes)
    throw new Error(
      `${record.url}: ${bytes.length} bytes on disk, the manifest records ${record.bytes} bytes`,
    );
  const digest = sha256(bytes);
  if (digest !== record.sha256)
    throw new Error(
      `${record.url}: SHA-256 ${digest} does not match the manifest ${record.sha256}`,
    );
  return bytes;
}
