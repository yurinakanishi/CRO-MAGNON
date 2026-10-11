import { readFile } from 'node:fs/promises';
import path from 'node:path';

/** The prepared delivery overlay (scripts/delivery/prepare-overlay.mjs, under dist/). The local
 * server sends cooked delivery files and manifests naming them, as the packaged builds ship. A
 * record is rewritten only while its master is the one the overlay was cooked from, so a master
 * adopted after the overlay was prepared is served as itself. */
export const OVERLAY_FILE = 'dist/delivery/overlay.json';
const SCHEMA = 'cro-magnon/delivery-overlay@1';
const CACHE = 'dist/delivery/cache';
const HASH = /^[0-9a-f]{64}$/;
const DELIVERY_URL = /^\/models\/[a-z0-9-]+\/[a-z0-9-]+\.cook-[0-9a-f]{16}\.(?:glb|png|webp)$/;
const MANIFEST = /^models\/(?:world-assets|[a-z0-9-]+\/asset)\.json$/;

export type DeliveryFile = { url: string; sha256: string; bytes: number; scene?: number };
export type DeliveryEntry = { master: { sha256: string; bytes: number }; delivery: DeliveryFile };
export type DeliveryOverlay = {
  readonly models: ReadonlyMap<string, DeliveryEntry>;
  readonly textures: ReadonlyMap<string, DeliveryEntry>;
  /** Served path (no leading slash) of each delivery file, to its absolute cache file. */
  readonly files: ReadonlyMap<string, string>;
};

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

function entry(value: unknown, where: string): { entry: DeliveryEntry; file: string } {
  if (!isObject(value) || !isObject(value.master) || !isObject(value.delivery))
    throw new Error(`${where}: not a delivery entry`);
  const { master, delivery, file } = value;
  if (typeof master.sha256 !== 'string' || !HASH.test(master.sha256))
    throw new Error(`${where}: invalid master SHA-256`);
  if (
    typeof delivery.url !== 'string' ||
    !DELIVERY_URL.test(delivery.url) ||
    typeof delivery.sha256 !== 'string' ||
    !HASH.test(delivery.sha256) ||
    delivery.url.split('.cook-')[1]?.slice(0, 16) !== delivery.sha256.slice(0, 16) ||
    !Number.isSafeInteger(delivery.bytes) ||
    (delivery.scene !== undefined && !Number.isInteger(delivery.scene))
  )
    throw new Error(`${where}: invalid delivery file`);
  if (typeof file !== 'string' || !/^[0-9a-f]{64}\.(?:glb|png|webp)$/.test(file))
    throw new Error(`${where}: invalid cache file`);
  return {
    entry: {
      master: { sha256: master.sha256, bytes: Number(master.bytes) },
      delivery: {
        url: delivery.url,
        sha256: delivery.sha256,
        bytes: Number(delivery.bytes),
        ...(delivery.scene !== undefined ? { scene: Number(delivery.scene) } : {}),
      },
    },
    file,
  };
}

/** The prepared overlay of `root`, or null when none was prepared. */
export async function readDeliveryOverlay(root: string): Promise<DeliveryOverlay | null> {
  let text: string;
  try {
    text = await readFile(path.join(root, OVERLAY_FILE), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  const parsed: unknown = JSON.parse(text);
  if (!isObject(parsed) || parsed.schema !== SCHEMA)
    throw new Error(`${OVERLAY_FILE}: unknown schema`);
  const models = new Map<string, DeliveryEntry>(),
    textures = new Map<string, DeliveryEntry>(),
    files = new Map<string, string>();
  const cache = path.join(root, CACHE);
  for (const [key, target] of [
    ['models', models],
    ['textures', textures],
  ] as const) {
    const table = parsed[key];
    if (!isObject(table)) throw new Error(`${OVERLAY_FILE}: missing ${key}`);
    for (const [url, value] of Object.entries(table)) {
      const checked = entry(value, `${OVERLAY_FILE} ${url}`);
      target.set(url, checked.entry);
      const served = checked.entry.delivery.url.slice(1);
      const absolute = path.join(cache, checked.file);
      if (files.has(served) && files.get(served) !== absolute)
        throw new Error(`${OVERLAY_FILE}: ${served} names two cache files`);
      files.set(served, absolute);
    }
  }
  return { models, textures, files };
}

/** Whether the overlay rewrites this served path (the catalog or a model's own manifest). */
export const isDeliveryManifest = (servedPath: string) => MANIFEST.test(servedPath);

function rewriteRecord(record: Record<string, Json>, table: ReadonlyMap<string, DeliveryEntry>) {
  const url = record.url;
  if (typeof url !== 'string') return record;
  const known = table.get(url);
  if (!known || known.master.sha256 !== record.sha256) return record;
  const out: Record<string, Json> = {
    ...record,
    url: known.delivery.url,
    sha256: known.delivery.sha256,
  };
  if (record.bytes !== undefined) out.bytes = known.delivery.bytes;
  if (known.delivery.scene !== undefined) out.scene = known.delivery.scene;
  return out;
}

/** An asset manifest naming the overlay's delivery files: its model and LOD records, then its
 * runtime texture records anywhere but `provenance` (as the packaged builds rewrite them). */
export function deliveredAssetJson(asset: Json, overlay: DeliveryOverlay): Json {
  if (!isObject(asset) || typeof asset.url !== 'string') return asset;
  const textures = (value: Json): Json => {
    if (Array.isArray(value)) return value.map(textures);
    if (!isObject(value)) return value;
    const copy: Record<string, Json> = {};
    for (const [key, child] of Object.entries(value))
      copy[key] = key === 'provenance' ? child : textures(child);
    return rewriteRecord(copy, overlay.textures);
  };
  const out: Record<string, Json> = {};
  for (const [key, child] of Object.entries(asset as Record<string, Json>))
    out[key] = key === 'lods' || key === 'provenance' ? child : textures(child);
  // Levels packed into one delivery file are rewritten together or not at all: a template whose
  // levels name scenes of one file must name one for every level (world-asset-levels.ts).
  const levels = [out, ...(Array.isArray(asset.lods) ? asset.lods : [])].filter(isObject) as Record<
    string,
    Json
  >[];
  const rewritten = levels.map((level) => rewriteRecord(level, overlay.models));
  const packed = rewritten.some(
    (level, i) => level !== levels[i] && level.scene !== levels[i].scene,
  );
  if (packed && rewritten.some((level, i) => level === levels[i])) return out;
  const [top, ...lods] = rewritten;
  if (Array.isArray(asset.lods)) top.lods = lods;
  return top;
}

/** The text of a served manifest with the overlay applied. */
export function deliveredManifestText(servedPath: string, text: string, overlay: DeliveryOverlay) {
  const json: Json = JSON.parse(text);
  if (servedPath === 'models/world-assets.json') {
    if (!isObject(json) || !Array.isArray(json.assets)) return text;
    return JSON.stringify({
      ...json,
      assets: json.assets.map((a) => deliveredAssetJson(a, overlay)),
    });
  }
  return JSON.stringify(deliveredAssetJson(json, overlay));
}
