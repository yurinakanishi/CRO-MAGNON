// The delivery graph of a build: every master model file its manifests name, mapped to the file a
// client downloads. Builders check the masters exactly as before (runtime-graph.mjs), then ship
// the delivery files and manifests rewritten to name them. Scene indices, LOD distances, rig and
// clip metadata stay as the masters record them; only url, sha256 and bytes change.
import { cookedModel, cookedTexture, packedModel, recipeIdentity } from './delivery-cache.mjs';

const CONCURRENCY = 4;
// Static templates whose levels the runtime loads packed (world-asset-levels.ts). Actors keep one
// file per level (their clips, skeletons and grips are found by name); equipment, props and
// enemies refuse packed levels; boats and anything else keep their files until reviewed.
export const PACKED_KINDS = Object.freeze(new Set(['static', 'tree', 'terrain', 'bridge']));
// The standalone textures the runtime loads by manifest record (verified-texture.ts
// caveImageRecords): the camp cave's limestone and pigment layers. Every other image record
// (portraits, history) is shown by a fixed URL or not at all, and ships as its master.
function recordTextures(asset, textureRecords) {
  if (asset?.modelKey !== 'camp-cave') return [];
  const records = [
    asset.pigment,
    asset.rockSurface,
    asset.characterPigment,
    asset.rimoPigment,
    ...Object.values(asset.mascotPigments ?? {}),
  ].filter((record) => typeof record?.url === 'string');
  const known = new Set(textureRecords(asset).map((record) => record.url));
  for (const record of records)
    if (!known.has(record.url)) throw new Error(`${record.url} is not a checked runtime texture`);
  return records;
}

/** Cook (or fetch from the cache) every model file the assets name, and with `textureRecords`
 * (environment-assets.mjs runtimeTextureRecords) every standalone runtime texture. */
export async function deliveryGraph(root, assets, { log = () => {}, textureRecords = null } = {}) {
  const masters = new Map();
  for (const asset of assets)
    for (const record of [asset, ...(asset.lods ?? [])]) {
      if (typeof record?.url !== 'string' || !record.url.endsWith('.glb')) continue;
      if (/\.cook-[0-9a-f]{16}\.glb$/.test(record.url))
        throw new Error(`${record.url}: a manifest names a delivery file as its master`);
      const previous = masters.get(record.url);
      if (previous && (previous.sha256 !== record.sha256 || previous.bytes !== record.bytes))
        throw new Error(`${record.url} is named with two identities`);
      masters.set(record.url, { url: record.url, sha256: record.sha256, bytes: record.bytes });
    }
  const deliveries = new Map();
  const queue = [...masters.values()];
  // CRO_DELIVERY=masters ships the masters themselves: the before/after baseline for measurements.
  const mastersOnly = process.env.CRO_DELIVERY === 'masters';
  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    for (let record = queue.shift(); record; record = queue.shift()) {
      const delivery = mastersOnly
        ? {
            ...record,
            file: `${root}/public${record.url}`,
            cooked: false,
            report: { master: record, cook: null },
          }
        : await cookedModel(root, record);
      deliveries.set(record.url, delivery);
      log(delivery);
    }
  });
  await Promise.all(workers);
  // Pack each eligible static template's cooked levels into one file (one copy of each image).
  const owners = new Map();
  for (const asset of assets)
    for (const record of [asset, ...(asset.lods ?? [])])
      if (typeof record?.url === 'string')
        owners.set(record.url, (owners.get(record.url) ?? 0) + 1);
  let packedFiles = 0;
  if (!mastersOnly)
    for (const asset of assets) {
      const levels = [asset, ...(asset.lods ?? [])];
      if (
        !PACKED_KINDS.has(asset.kind) ||
        levels.length < 2 ||
        levels.some((level) => level.scene !== undefined || owners.get(level.url) !== 1)
      )
        continue;
      const packed = await packedModel(
        root,
        asset.modelKey,
        levels.map((level) => deliveries.get(level.url)),
      );
      if (!packed) continue;
      packedFiles++;
      levels.forEach((level, scene) => {
        const own = deliveries.get(level.url);
        deliveries.set(level.url, {
          ...packed,
          scene,
          report: { ...own.report, packed: packed.report },
        });
      });
    }
  // Standalone runtime textures (cave limestone and pigment layers).
  const textures = new Map();
  if (textureRecords && !mastersOnly)
    for (const asset of assets)
      for (const record of recordTextures(asset, textureRecords)) {
        if (textures.has(record.url)) continue;
        textures.set(record.url, await cookedTexture(root, record));
      }
  const recipe = await recipeIdentity();
  let masterBytes = 0,
    deliveryBytes = 0;
  const counted = new Set();
  for (const [url, delivery] of deliveries) {
    masterBytes += masters.get(url).bytes;
    if (!counted.has(delivery.url)) deliveryBytes += delivery.bytes;
    counted.add(delivery.url);
  }
  let textureMasterBytes = 0,
    textureDeliveryBytes = 0;
  for (const texture of textures.values()) {
    textureMasterBytes += texture.report.master.bytes;
    textureDeliveryBytes += texture.bytes;
  }
  return {
    deliveries,
    textures,
    recipe,
    summary: {
      files: deliveries.size,
      cooked: [...deliveries.values()].filter((d) => d.cooked).length,
      packedFiles,
      deliveryFiles: counted.size,
      masterBytes,
      deliveryBytes,
      textures: textures.size,
      cookedTextures: [...textures.values()].filter((t) => t.cooked).length,
      textureMasterBytes,
      textureDeliveryBytes,
    },
  };
}

/** A model or LOD record naming its delivery file instead of its master. */
export function deliveredRecord(record, deliveries) {
  const delivery = deliveries.get(record.url);
  if (!delivery) return record;
  if (delivery.report.master.sha256 !== record.sha256)
    throw new Error(`${record.url}: delivery cooked from another master`);
  const out = { ...record, url: delivery.url, sha256: delivery.sha256, bytes: delivery.bytes };
  // A packed delivery names the scene that holds this level.
  if (delivery.scene !== undefined) out.scene = delivery.scene;
  return out;
}

/** An asset manifest whose model, LOD and runtime texture records name delivery files.
 * Texture records are found where runtimeTextureRecords finds them (anywhere but provenance). */
export function deliveredAsset(asset, deliveries, textures = new Map()) {
  if (typeof asset?.url !== 'string') return asset;
  const out = deliveredRecord(asset, deliveries);
  if (Array.isArray(asset.lods))
    out.lods = asset.lods.map((lod) => deliveredRecord(lod, deliveries));
  const rewrite = (value) => {
    if (Array.isArray(value)) return value.map(rewrite);
    if (!value || typeof value !== 'object') return value;
    const texture = typeof value.url === 'string' ? textures.get(value.url) : undefined;
    const copy = {};
    for (const [key, child] of Object.entries(value))
      copy[key] = key === 'provenance' ? child : rewrite(child);
    if (texture) {
      if (texture.report.master.sha256 !== value.sha256)
        throw new Error(`${value.url}: texture delivery cooked from another master`);
      Object.assign(copy, { url: texture.url, sha256: texture.sha256 });
      if (value.bytes !== undefined) copy.bytes = texture.bytes;
    }
    return copy;
  };
  for (const [key, child] of Object.entries(out))
    if (key !== 'lods' && key !== 'provenance' && child && typeof child === 'object')
      out[key] = rewrite(child);
  return out;
}

/** The per-texture record a build report keeps. */
export function textureLedger(textures) {
  return [...textures.values()]
    .map((t) => ({
      master: t.report.master,
      delivery: { url: t.url, sha256: t.sha256, bytes: t.bytes },
      cooked: t.cooked,
      ...(t.cooked ? { encoding: t.report.encoding } : { kept: t.report.kept }),
      quality: t.report.quality ?? null,
    }))
    .sort((a, b) => a.master.url.localeCompare(b.master.url));
}

/** The per-file record a build report keeps. */
export function deliveryLedger(deliveries) {
  return [...deliveries.values()]
    .map((d) => ({
      master: d.report.master,
      delivery: {
        url: d.url,
        sha256: d.sha256,
        bytes: d.bytes,
        ...(d.scene !== undefined ? { scene: d.scene } : {}),
      },
      cooked: d.cooked,
      errors: d.report.cook?.errors ?? {},
      images: (d.report.cook?.images ?? []).map(
        ({ image, mime, bytes, cooked, cookedBytes, psnr, kept }) => ({
          image,
          mime,
          bytes,
          ...(cooked ? { cooked, cookedBytes, psnr } : { kept }),
        }),
      ),
    }))
    .sort((a, b) => a.master.url.localeCompare(b.master.url));
}
