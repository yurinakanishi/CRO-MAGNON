import { sha256 } from './asset-hash.js';
import { browserVerifiedAssetCache, type VerifiedAssetCache } from './verified-asset-cache.js';

export interface AssetFile {
  url: string;
  bytes: number;
  sha256: string;
}
export interface AssetDownload extends AssetFile {
  parts?: AssetFile[];
}
export type AssetTransport = (url: URL) => Promise<Response>;
export interface AssetDownloadOptions {
  /** Verified file bytes kept after GPU eviction and across reloads; null disables
   * it. Default: this page's CacheStorage copy where available, else none. */
  cache?: VerifiedAssetCache | null;
  /** Default: the global fetch at the time of each request. */
  transport?: AssetTransport;
}

const fetchTransport: AssetTransport = (url) => fetch(url);
const running = new Map<string, { promise: Promise<ArrayBuffer>; consumers: number }>();
const scopes = new WeakMap<object, number>();
const uncached = {};
let scopeCount = 0;
function scopeOf(value: object) {
  let id = scopes.get(value);
  if (id === undefined) scopes.set(value, (id = ++scopeCount));
  return id;
}

/** Reassemble large public GLBs without changing geometry, textures or animation. */
export async function downloadVerifiedAsset(
  record: AssetDownload,
  origin = location.origin,
  {
    cache = browserVerifiedAssetCache(origin),
    transport = fetchTransport,
  }: AssetDownloadOptions = {},
): Promise<ArrayBuffer> {
  const validate = (file: AssetFile) => {
    const url = new URL(file.url, origin);
    if (url.origin !== origin || !['http:', 'https:'].includes(url.protocol))
      throw new Error('Models must be served by this game');
    if (!Number.isSafeInteger(file.bytes) || file.bytes <= 0 || file.bytes > 256 * 1024 * 1024)
      throw new Error(`${file.url}: invalid file length`);
    if (!/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error(`${file.url}: invalid SHA-256`);
    return url;
  };
  // Every returned byte sequence is verified, whether it came from the cache or the network.
  const load = async (file: AssetFile, url: URL) => {
    if (cache) {
      const cached = await cache.read(file);
      if (cached && cached.byteLength === file.bytes && (await sha256(cached)) === file.sha256) {
        cache.used(file);
        return cached;
      }
      // A damaged entry is deleted and the file fetched once more from its own URL.
      if (cached) cache.discard(file);
    }
    const response = await transport(url);
    if (!response.ok) throw new Error(`${file.url}: HTTP ${response.status}`);
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength !== file.bytes) throw new Error(`${file.url}: file length mismatch`);
    if ((await sha256(bytes)) !== file.sha256) throw new Error(`${file.url}: SHA-256 mismatch`);
    cache?.store(file, bytes);
    return bytes;
  };
  // Concurrent requests for one file share a single load, but every caller gets
  // its own buffer: a parser may transfer or detach the one it receives.
  const download = (file: AssetFile): Promise<ArrayBuffer> => {
    const url = validate(file);
    const scope = `${scopeOf(transport)}:${scopeOf(cache ?? uncached)}`;
    const id = `${scope} ${url.href} ${file.sha256} ${file.bytes}`;
    let shared = running.get(id);
    if (!shared) {
      const promise = load(file, url).finally(() => {
        if (running.get(id)?.promise === promise) running.delete(id);
      });
      running.set(id, (shared = { promise, consumers: 0 }));
    }
    const job = shared;
    job.consumers++;
    return job.promise.then((bytes) => (--job.consumers > 0 ? bytes.slice(0) : bytes));
  };
  validate(record);
  if (!record.parts) return download(record);
  if (!Array.isArray(record.parts) || !record.parts.length || record.parts.length > 16)
    throw new Error(`${record.url}: invalid model parts`);
  for (const part of record.parts) validate(part);
  if (record.parts.reduce((sum, part) => sum + part.bytes, 0) !== record.bytes)
    throw new Error(`${record.url}: model part lengths do not match`);
  const bytes = new Uint8Array(record.bytes);
  let offset = 0;
  // Keep peak memory bounded while the world loads several models concurrently.
  for (const part of record.parts) {
    bytes.set(new Uint8Array(await download(part)), offset);
    offset += part.bytes;
  }
  if ((await sha256(bytes)) !== record.sha256) throw new Error(`${record.url}: SHA-256 mismatch`);
  return bytes.buffer;
}
