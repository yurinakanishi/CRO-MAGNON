/**
 * Persistent copies of verified model FILE bytes (whole GLBs or public split
 * parts) in this origin's CacheStorage, so actors and scenery whose GPU
 * resources were freed load again without a second transfer. Ordinary HTTP
 * revalidation does not reliably keep files this large.
 *
 * Entries are content-addressed by the expected SHA-256 and length: a manifest
 * with another hash can never be given older bytes. Nothing here trusts stored
 * bytes. The caller hashes every byte sequence read() returns and passes
 * store() only bytes it has verified; store() copies them at once and a
 * background worker writes them later.
 *
 * Hard budget: at most 64 MiB of stored response bodies in at most 64 records,
 * the small JSON recency index included; about four original characters with
 * their LODs. One file may hold up to 25 MiB, the public build's file limit, so
 * every public file or split part fits on its own. File sizes come from the
 * keys, which equal the bytes written; the index is measured as stored. Each
 * write recounts from cache.keys(), deletes least recently used files until
 * the new file and the index describing it fit, stores that index and only
 * then the file, so no intermediate state exceeds the budget either.
 *
 * Every put and delete runs under one Web Lock per origin, and the lock is
 * held until the browser has settled each of them: a stalled write turns the
 * cache off for this page but never lets another writer start meanwhile.
 * Without Web Locks other tabs could interleave, so no cache is offered there
 * and an instance built without locks only reads. Cache API entries neither
 * expire nor follow Cache-Control: eviction, and deleting a file superseded by
 * another hash for the same URL, are done here. Reads rewrite only the index,
 * never a file. Only this module's own named cache is opened.
 *
 * CacheStorage exists only in secure contexts (HTTPS, localhost). Plain-HTTP
 * LAN origins, some private modes and Node get no cache. Storage errors, quota
 * failures and timeouts leave the verified network path unchanged.
 */
const MiB = 1024 * 1024;

export const VERIFIED_ASSET_CACHE = Object.freeze({
  /** Rename together with the key format: keys this version cannot parse are deleted. */
  name: 'cro-magnon-verified-assets-v1',
  /** Every stored response body, the index included. */
  maxBytes: 64 * MiB,
  /** Stored records, the index included. */
  maxEntries: 64,
  maxEntryBytes: 25 * MiB,
  /** Verified copies waiting for the writer; more files are not cached meanwhile. */
  maxPendingBytes: 32 * MiB,
  /** A slower read turns the cache off for this page and the network serves instead. */
  readTimeoutMs: 10_000,
  /** Likewise for a write batch, waiting for the lock included. */
  writeTimeoutMs: 60_000,
});

const KEY_PATH = '/__verified-assets/v1/';
const INDEX = 'index.json';
const ENTRY = /^sha256-([a-f0-9]{64})-([1-9][0-9]{0,15})$/;
const MAX_SOURCE_LENGTH = 1024;
const MAX_FAILURES = 3;

export interface VerifiedFile {
  readonly url: string;
  readonly bytes: number;
  readonly sha256: string;
}

/** The parts of the Cache API used here; window.caches satisfies these. */
export interface CacheLike {
  match(request: string): Promise<Response | undefined>;
  put(request: string, response: Response): Promise<void>;
  delete(request: string): Promise<boolean>;
  keys(): Promise<ReadonlyArray<{ readonly url: string }>>;
}
export interface CacheStorageLike {
  open(name: string): Promise<CacheLike>;
}
/** navigator.locks satisfies this. */
export interface LockManagerLike {
  request(
    name: string,
    options: { signal?: AbortSignal },
    callback: () => Promise<void>,
  ): Promise<unknown>;
}
export interface VisibilityEvents {
  addEventListener(type: 'visibilitychange', listener: () => void): void;
}

export interface VerifiedAssetCacheOptions {
  readonly storage: CacheStorageLike;
  /** The page origin. Entry keys are same-origin URLs that are never fetched. */
  readonly origin: string;
  /** The origin's lock manager. Without one the cache never writes. */
  readonly locks?: LockManagerLike | null;
  /** A timeout while the page was hidden or frozen does not turn the cache off. */
  readonly document?: VisibilityEvents | null;
  readonly name?: string;
  readonly maxBytes?: number;
  readonly maxEntries?: number;
  readonly maxEntryBytes?: number;
  readonly maxPendingBytes?: number;
  readonly readTimeoutMs?: number;
  readonly writeTimeoutMs?: number;
}

export interface VerifiedAssetCacheUsage {
  /** Stored file bodies plus the stored index: what maxBytes limits. */
  readonly bytes: number;
  readonly indexBytes: number;
  /** Stored records, the index included: what maxEntries limits. */
  readonly records: number;
  readonly entries: ReadonlyArray<{
    readonly key: string;
    readonly bytes: number;
    readonly used: number;
    readonly source: string | null;
  }>;
}

interface PendingWrite {
  readonly key: string;
  readonly source: string | null;
  readonly size: number;
  readonly blob: Blob;
}
interface Entry {
  readonly size: number;
  used: number;
  source: string | null;
  /** Position in cache.keys(), i.e. insertion order: breaks recency ties. */
  readonly order: number;
}
interface Snapshot {
  readonly entries: Map<string, Entry>;
  /** File bytes, from the keys. */
  bytes: number;
  clock: number;
  /** The index body as stored, or null when there is none. */
  readonly stored: string | null;
  readonly storedBytes: number;
  /** Records in this cache that are neither a file nor the index. */
  readonly strays: readonly string[];
}
interface Index {
  clock: number;
  readonly entries: Map<string, { used: number; source: string | null }>;
}
interface Batch {
  readonly write: PendingWrite | null;
  readonly discards: readonly string[];
  readonly touches: ReadonlyArray<readonly [string, string | null]>;
}

class CacheTimeout extends Error {
  constructor(stage: string) {
    super(`verified asset cache ${stage} timed out`);
    this.name = 'CacheTimeout';
  }
}

/** Thrown instead of starting a put or delete after the cache was turned off. */
class CacheStopped extends Error {
  constructor() {
    super('verified asset cache stopped');
    this.name = 'CacheStopped';
  }
}

/** Settle with `work` or reject after `ms`. Only for reads: a late read changes
 * nothing. The race still handles a late rejection, and the timer is cleared. */
function within<T>(work: Promise<T>, ms: number, stage: string): Promise<T> {
  let cancel = () => {};
  const timeout = new Promise<never>((_, reject) => {
    const timer = setTimeout(() => reject(new CacheTimeout(stage)), ms);
    cancel = () => clearTimeout(timer);
  });
  return Promise.race([work, timeout]).finally(() => cancel());
}

function describe(error: unknown): string {
  if (typeof error !== 'object' || error === null) return String(error);
  const { name, message } = error as { name?: unknown; message?: unknown };
  return `${String(name ?? 'Error')}: ${String(message ?? '')}`;
}

function isQuotaError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { name, code } = error as { name?: unknown; code?: unknown };
  return name === 'QuotaExceededError' || code === 22;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isCount = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;

function limit(value: number | undefined, fallback: number, minimum: number): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < minimum)
    throw new RangeError(`Invalid verified asset cache limit: ${result}`);
  return result;
}

const encoder = new TextEncoder();
const byteLength = (text: string) => encoder.encode(text).byteLength;

function indexBody(entries: Iterable<[string, Entry]>, clock: number): string {
  const records: Record<string, { used: number; source?: string }> = {};
  for (const [key, { used, source }] of entries)
    records[key] = source ? { used, source } : { used };
  return JSON.stringify({ version: 1, clock, entries: records });
}

/** Recency is advisory: an unreadable index only resets eviction order. */
function parseIndex(text: string): Index {
  const index: Index = { clock: 0, entries: new Map() };
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return index;
  }
  if (!isRecord(data) || data.version !== 1) return index;
  const { clock, entries } = data;
  if (!isRecord(entries)) return index;
  if (isCount(clock)) index.clock = clock;
  for (const [key, value] of Object.entries(entries)) {
    if (!ENTRY.test(key) || !isRecord(value)) continue;
    const { used, source } = value;
    if (!isCount(used)) continue;
    index.entries.set(key, {
      used,
      source: typeof source === 'string' && source.length <= MAX_SOURCE_LENGTH ? source : null,
    });
    index.clock = Math.max(index.clock, used);
  }
  return index;
}

const byRecency = ([, a]: [string, Entry], [, b]: [string, Entry]) =>
  a.used - b.used || a.order - b.order;

export class VerifiedAssetCache {
  readonly origin: string;
  readonly name: string;
  readonly maxBytes: number;
  readonly maxEntries: number;
  readonly maxEntryBytes: number;
  readonly maxPendingBytes: number;
  readonly stats = {
    hits: 0,
    misses: 0,
    pendingReads: 0,
    corrupt: 0,
    stored: 0,
    storedBytes: 0,
    skipped: 0,
    evicted: 0,
    evictedBytes: 0,
    superseded: 0,
    quotaErrors: 0,
    errors: 0,
  };
  /** Set once storage proved unusable; this page then uses the network only. */
  disabledReason: string | null = null;
  /** Set when this page stops writing: no Web Locks, a quota failure or repeated
   * write errors. Stored files are still read. */
  readOnlyReason: string | null = null;
  lastError: string | null = null;
  private readonly storage: CacheStorageLike;
  private readonly locks: LockManagerLike | null;
  private readonly readTimeoutMs: number;
  private readonly writeTimeoutMs: number;
  private readonly prefix: string;
  private opened: Promise<CacheLike> | null = null;
  /** Verified copies queued or being written, by key: read() serves them too. */
  private readonly pending = new Map<string, PendingWrite>();
  private queue: PendingWrite[] = [];
  private pendingBytes = 0;
  /** Verified reads not yet recorded in the index, oldest first. */
  private readonly touches = new Map<string, string | null>();
  private readonly discards = new Set<string>();
  private worker: Promise<void> | null = null;
  private readFailures = 0;
  private writeFailures = 0;
  private visibilityChanges = 0;

  constructor(options: VerifiedAssetCacheOptions) {
    const base = new URL(KEY_PATH, options.origin);
    if (base.origin !== options.origin || !['http:', 'https:'].includes(base.protocol))
      throw new Error('The verified asset cache needs an HTTP(S) page origin');
    this.origin = base.origin;
    this.prefix = base.href;
    this.storage = options.storage;
    this.locks = options.locks ?? null;
    this.name = options.name ?? VERIFIED_ASSET_CACHE.name;
    this.maxBytes = limit(options.maxBytes, VERIFIED_ASSET_CACHE.maxBytes, 0);
    this.maxEntries = limit(options.maxEntries, VERIFIED_ASSET_CACHE.maxEntries, 0);
    this.maxEntryBytes = limit(options.maxEntryBytes, VERIFIED_ASSET_CACHE.maxEntryBytes, 0);
    this.maxPendingBytes = limit(options.maxPendingBytes, VERIFIED_ASSET_CACHE.maxPendingBytes, 0);
    this.readTimeoutMs = limit(options.readTimeoutMs, VERIFIED_ASSET_CACHE.readTimeoutMs, 1);
    this.writeTimeoutMs = limit(options.writeTimeoutMs, VERIFIED_ASSET_CACHE.writeTimeoutMs, 1);
    options.document?.addEventListener('visibilitychange', () => this.visibilityChanges++);
    if (!this.locks) this.readOnly('no Web Locks: other pages could interleave writes');
  }

  get writable() {
    return !this.readOnlyReason;
  }

  /** Stored bytes for `file`, or null. Never rejects. The caller must verify the result. */
  async read(file: VerifiedFile): Promise<ArrayBuffer | null> {
    const key = this.keyOf(file);
    if (!key || this.disabledReason) return null;
    const pending = this.pending.get(key);
    if (pending) {
      try {
        const bytes = await pending.blob.arrayBuffer();
        this.stats.pendingReads++;
        return bytes;
      } catch {
        // The stored copy may still serve.
      }
    }
    const visibility = this.visibilityChanges;
    try {
      const bytes = await within(this.match(key), this.readTimeoutMs, 'read');
      this.readFailures = 0;
      if (!bytes) this.stats.misses++;
      return bytes;
    } catch (error) {
      this.fail(error, 'read', visibility);
      return null;
    }
  }

  /** `file` was read back and verified: keep it longer than unused entries. */
  used(file: VerifiedFile): void {
    const key = this.keyOf(file);
    if (!key || this.disabledReason) return;
    this.stats.hits++;
    if (!this.writable) return;
    this.touches.delete(key);
    this.touches.set(key, this.sourceOf(file.url));
    this.kick();
  }

  /** Bytes read for `file` failed verification: delete them before any new copy is stored. */
  discard(file: VerifiedFile): void {
    const key = this.keyOf(file);
    if (!key) return;
    this.stats.corrupt++;
    this.touches.delete(key);
    this.unqueue(key);
    if (this.disabledReason || !this.locks) return;
    this.discards.add(key);
    this.kick();
  }

  /** Keep a copy of bytes the caller has verified against `file`. Returns at once:
   * the copy is taken now, so the caller may transfer or detach `bytes`. */
  store(file: VerifiedFile, bytes: ArrayBuffer): void {
    if (this.disabledReason || !this.writable) return;
    const key = this.keyOf(file);
    if (key && this.pending.has(key)) return;
    if (
      !key ||
      bytes.byteLength !== file.bytes ||
      this.pendingBytes + file.bytes > this.maxPendingBytes
    ) {
      this.stats.skipped++;
      return;
    }
    let blob: Blob;
    try {
      blob = new Blob([bytes]);
    } catch (error) {
      this.fail(error, 'write', this.visibilityChanges);
      return;
    }
    const write = { key, source: this.sourceOf(file.url), size: file.bytes, blob };
    this.pending.set(key, write);
    this.queue.push(write);
    this.pendingBytes += write.size;
    this.kick();
  }

  /** Resolves once queued writes, deletions and recency updates are done. */
  async idle(): Promise<void> {
    while (this.worker) await this.worker;
  }

  diagnostics() {
    return {
      name: this.name,
      enabled: !this.disabledReason,
      writable: this.writable,
      disabledReason: this.disabledReason,
      readOnlyReason: this.readOnlyReason,
      lastError: this.lastError,
      pendingWrites: this.pending.size,
      pendingBytes: this.pendingBytes,
      maxBytes: this.maxBytes,
      maxEntries: this.maxEntries,
      maxEntryBytes: this.maxEntryBytes,
      ...this.stats,
    };
  }

  /** What is stored now, least recently used first; null while unavailable. Read-only. */
  async usage(): Promise<VerifiedAssetCacheUsage | null> {
    if (this.disabledReason) return null;
    const visibility = this.visibilityChanges;
    try {
      const reading = this.open().then((cache) => this.snapshot(cache));
      const state = await within(reading, this.readTimeoutMs, 'read');
      const index = state.stored === null ? 0 : 1;
      return {
        bytes: state.bytes + state.storedBytes,
        indexBytes: state.storedBytes,
        records: state.entries.size + state.strays.length + index,
        entries: [...state.entries]
          .sort(byRecency)
          .map(([key, { size, used, source }]) => ({ key, bytes: size, used, source })),
      };
    } catch (error) {
      this.fail(error, 'read', visibility);
      return null;
    }
  }

  private keyOf({ sha256, bytes }: VerifiedFile): string | null {
    const valid =
      typeof sha256 === 'string' &&
      /^[a-f0-9]{64}$/.test(sha256) &&
      Number.isSafeInteger(bytes) &&
      bytes > 0 &&
      bytes <= Math.min(this.maxEntryBytes, this.maxBytes);
    return valid ? `sha256-${sha256}-${bytes}` : null;
  }

  /** The same-origin path an entry came from, so a new hash for it supersedes the entry. */
  private sourceOf(url: string): string | null {
    try {
      const resolved = new URL(url, this.origin);
      const source = resolved.pathname + resolved.search;
      return resolved.origin === this.origin && source.length <= MAX_SOURCE_LENGTH ? source : null;
    } catch {
      return null;
    }
  }

  private open(): Promise<CacheLike> {
    if (this.opened) return this.opened;
    let opened: Promise<CacheLike>;
    try {
      opened = Promise.resolve(this.storage.open(this.name));
    } catch (error) {
      opened = Promise.reject(error);
    }
    opened.catch((error) => this.disable(`unavailable: ${describe(error)}`));
    this.opened = opened;
    return opened;
  }

  private async match(key: string): Promise<ArrayBuffer | null> {
    const response = await (await this.open()).match(this.prefix + key);
    return response ? response.arrayBuffer() : null;
  }

  private kick(): void {
    if (this.worker || this.disabledReason || !this.locks) return;
    const worker = this.drain().finally(() => {
      if (this.worker === worker) this.worker = null;
      if (this.queue.length || this.touches.size || this.discards.size) this.kick();
    });
    this.worker = worker;
  }

  /** One batch at a time; every batch is taken off the queues before it runs, so
   * failures cannot repeat work and the loop always ends. Never rejects. */
  private async drain(): Promise<void> {
    const locks = this.locks;
    while (locks && !this.disabledReason) {
      const batch = this.take();
      if (!batch) return;
      const visibility = this.visibilityChanges;
      // A batch that takes too long turns the cache off and stops waiting for the
      // lock. Once granted, the lock is held until every started put or delete
      // has settled, however late: no other writer may count around it.
      const abort = new AbortController();
      const stop = this.watch(() => {
        this.disable('verified asset cache write timed out');
        abort.abort();
      });
      try {
        await locks.request(this.name, { signal: abort.signal }, () => this.step(batch));
        this.writeFailures = 0;
      } catch (error) {
        // After a timeout, the aborted wait or the stopped batch is expected.
        if (!this.disabledReason) this.fail(error, 'write', visibility);
      } finally {
        stop();
        if (batch.write) this.settle(batch.write);
      }
    }
  }

  /** Calls `expire` once writeTimeoutMs pass with the page visible throughout. */
  private watch(expire: () => void): () => void {
    let cancel = () => {};
    const arm = (visibility: number) => {
      const timer = setTimeout(() => {
        if (visibility === this.visibilityChanges) expire();
        else arm(this.visibilityChanges);
      }, this.writeTimeoutMs);
      cancel = () => clearTimeout(timer);
    };
    arm(this.visibilityChanges);
    return () => cancel();
  }

  private take(): Batch | null {
    let write: PendingWrite | null = null;
    while (!write) {
      const next = this.queue.shift();
      if (!next) break;
      if (this.pending.get(next.key) === next) write = next;
    }
    if (!write && !this.touches.size && !this.discards.size) return null;
    const batch = { write, discards: [...this.discards], touches: [...this.touches] };
    this.discards.clear();
    this.touches.clear();
    return batch;
  }

  /** Runs under the origin's Web Lock and returns only after its last put or delete. */
  private async step({ write, discards, touches }: Batch): Promise<void> {
    const cache = await this.open();
    const state = await this.snapshot(cache);
    for (const url of state.strays) await this.mutate(() => cache.delete(url));
    for (const key of discards) await this.remove(cache, state, key);
    for (const [key, source] of touches) {
      const entry = state.entries.get(key);
      if (!entry) continue;
      entry.used = ++state.clock;
      if (source) entry.source = source;
    }
    const adding =
      write && this.writable && this.pending.get(write.key) === write
        ? await this.admit(cache, state, write)
        : null;
    if (!(await this.fit(cache, state, adding?.key ?? null)))
      throw new Error('verified asset cache budget cannot hold its index');
    // The index first: until the file lands it only adds a record, already counted.
    const indexed = await this.saveIndex(cache, state);
    if (!adding || !indexed) return;
    const body = new Response(adding.blob, {
      headers: { 'Content-Type': 'application/octet-stream' },
    });
    try {
      await this.mutate(() => cache.put(this.prefix + adding.key, body));
    } catch (error) {
      if (!isQuotaError(error)) throw error;
      this.quota(error);
      return;
    }
    this.stats.stored++;
    this.stats.storedBytes += adding.size;
  }

  /** Stored files counted from cache.keys(), and the index exactly as stored. */
  private async snapshot(cache: CacheLike): Promise<Snapshot> {
    const requests = await cache.keys();
    const response = await cache.match(this.prefix + INDEX);
    const raw = response ? new Uint8Array(await response.arrayBuffer()) : null;
    const stored = raw ? new TextDecoder().decode(raw) : null;
    const index = parseIndex(stored ?? '');
    const entries = new Map<string, Entry>();
    const strays: string[] = [];
    let bytes = 0;
    requests.forEach(({ url }, order) => {
      const key = url.startsWith(this.prefix) ? url.slice(this.prefix.length) : '';
      if (key === INDEX) return;
      const size = Number(ENTRY.exec(key)?.[2]);
      if (!Number.isSafeInteger(size)) {
        strays.push(url);
        return;
      }
      const known = index.entries.get(key);
      entries.set(key, { size, used: known?.used ?? 0, source: known?.source ?? null, order });
      bytes += size;
    });
    return {
      entries,
      bytes,
      clock: index.clock,
      stored,
      storedBytes: raw?.byteLength ?? 0,
      strays,
    };
  }

  /** Plan to store `write`, or touch the stored copy. Null when no file is written. */
  private async admit(cache: CacheLike, state: Snapshot, write: PendingWrite) {
    const { key, size, source } = write;
    const existing = state.entries.get(key);
    if (existing) {
      existing.used = ++state.clock;
      if (source) existing.source = source;
      return null;
    }
    const entry = { size, used: state.clock + 1, source, order: Number.MAX_SAFE_INTEGER };
    // The least it can take: this file alone plus an index describing it.
    const alone = size + byteLength(indexBody(new Map([[key, entry]]), entry.used));
    if (alone > this.maxBytes || this.maxEntries < 2) {
      this.stats.skipped++;
      return null;
    }
    if (source)
      for (const [other, stored] of [...state.entries])
        if (stored.source === source) {
          await this.remove(cache, state, other);
          this.stats.superseded++;
        }
    state.clock = entry.used;
    state.entries.set(key, entry);
    state.bytes += size;
    return write;
  }

  /** Delete least recently used files, never `keep`, until the files and the index
   * describing them fit maxBytes and maxEntries. */
  private async fit(cache: CacheLike, state: Snapshot, keep: string | null) {
    for (const [key, entry] of [...state.entries].sort(byRecency)) {
      if (this.fits(state)) return true;
      if (key === keep) continue;
      await this.remove(cache, state, key);
      this.stats.evicted++;
      this.stats.evictedBytes += entry.size;
    }
    return this.fits(state);
  }

  private fits(state: Snapshot): boolean {
    const files = state.entries.size;
    if (!files) return true;
    const index = byteLength(indexBody(state.entries, state.clock));
    return state.bytes + index <= this.maxBytes && files + 1 <= this.maxEntries;
  }

  /** Store the index `state` needs unless it is stored already; false after a quota failure. */
  private async saveIndex(cache: CacheLike, state: Snapshot): Promise<boolean> {
    const body = state.entries.size ? indexBody(state.entries, state.clock) : null;
    if (body === state.stored) return true;
    const url = this.prefix + INDEX;
    const headers = { 'Content-Type': 'application/json' };
    try {
      if (body === null) await this.mutate(() => cache.delete(url));
      else await this.mutate(() => cache.put(url, new Response(body, { headers })));
    } catch (error) {
      if (!isQuotaError(error)) throw error;
      this.quota(error);
      return false;
    }
    return true;
  }

  private async remove(cache: CacheLike, state: Snapshot, key: string): Promise<void> {
    await this.mutate(() => cache.delete(this.prefix + key));
    const entry = state.entries.get(key);
    if (entry) {
      state.entries.delete(key);
      state.bytes -= entry.size;
    }
  }

  /** Start a put or delete unless the cache was turned off; callers await it to the end. */
  private async mutate<T>(work: () => Promise<T>): Promise<T> {
    if (this.disabledReason) throw new CacheStopped();
    return work();
  }

  private settle(write: PendingWrite): void {
    if (this.pending.get(write.key) !== write) return;
    this.pending.delete(write.key);
    this.pendingBytes -= write.size;
  }

  private unqueue(key: string): void {
    const write = this.pending.get(key);
    if (!write) return;
    this.settle(write);
    this.queue = this.queue.filter((queued) => queued !== write);
  }

  /** Quota failures are expected: keep reading what is stored, stop writing. */
  private quota(error: unknown): void {
    this.stats.quotaErrors++;
    this.lastError = `write: ${describe(error)}`;
    this.readOnly('quota exceeded');
  }

  /** Drop queued copies and recency updates. Damaged files are still deleted. */
  private readOnly(reason: string): void {
    this.readOnlyReason ??= reason;
    this.pending.clear();
    this.queue = [];
    this.pendingBytes = 0;
    this.touches.clear();
  }

  /** `visibility` is the visibility change count when the failed operation began. */
  private fail(error: unknown, stage: 'read' | 'write', visibility: number): void {
    this.stats.errors++;
    this.lastError = `${stage}: ${describe(error)}`;
    if (error instanceof CacheTimeout) {
      // A page hidden or frozen meanwhile proves nothing about the storage.
      if (visibility === this.visibilityChanges) this.disable(error.message);
    } else if (stage === 'read') {
      if (++this.readFailures >= MAX_FAILURES) this.disable('repeated read errors');
    } else if (++this.writeFailures >= MAX_FAILURES) this.readOnly('repeated write errors');
  }

  private disable(reason: string): void {
    if (this.disabledReason) return;
    this.disabledReason = reason;
    this.readOnly(reason);
    this.discards.clear();
  }
}

interface BrowserScope {
  readonly isSecureContext?: boolean;
  readonly caches?: CacheStorageLike;
  readonly location?: { readonly origin?: string };
  readonly navigator?: { readonly locks?: LockManagerLike };
  readonly document?: VisibilityEvents;
}

/** A cache for this page, or null where CacheStorage or Web Locks are unavailable:
 * insecure origins such as plain-HTTP LAN addresses, some private modes, Node. */
export function createBrowserVerifiedAssetCache(scope: unknown = globalThis) {
  try {
    const page = scope as BrowserScope;
    const origin = page.location?.origin;
    if (page.isSecureContext !== true || typeof origin !== 'string') return null;
    const storage = page.caches;
    if (!storage || typeof storage.open !== 'function') return null;
    // Without Web Locks another tab could interleave writes and break the budget.
    const { locks } = page.navigator ?? {};
    if (!locks || typeof locks.request !== 'function') return null;
    const { document } = page;
    return new VerifiedAssetCache({
      storage,
      origin,
      locks,
      document: document && typeof document.addEventListener === 'function' ? document : null,
    });
  } catch {
    // A throwing CacheStorage getter or an opaque origin: use the network only.
    return null;
  }
}

let shared: VerifiedAssetCache | null | undefined;

/** This page's shared cache when `origin` is the page origin, else null. */
export function browserVerifiedAssetCache(origin: string): VerifiedAssetCache | null {
  if (shared === undefined) shared = createBrowserVerifiedAssetCache();
  return shared && shared.origin === origin ? shared : null;
}
