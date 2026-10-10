import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { downloadVerifiedAsset } from '../dist/src/asset-download.js';
import {
  VERIFIED_ASSET_CACHE,
  VerifiedAssetCache,
  browserVerifiedAssetCache,
  createBrowserVerifiedAssetCache,
} from '../dist/src/verified-asset-cache.js';

const unhandled = [];
process.on('unhandledRejection', (error) => unhandled.push(error));

const origin = 'https://game.example';
const prefix = `${origin}/__verified-assets/v1/`;
const indexUrl = `${prefix}index.json`;
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const file = (url, bytes) => ({ url, bytes: bytes.length, sha256: hash(bytes) });
const keyOf = (record) => `${prefix}sha256-${record.sha256}-${record.bytes}`;
/** Deterministic content; different seeds differ from the first byte on. */
const filled = (length, seed) =>
  Buffer.from(Array.from({ length }, (_, i) => (i * 31 + seed * 131 + (i >> 4)) & 255));
const tick = () => new Promise((resolve) => setImmediate(resolve));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(condition) {
  for (let i = 0; i < 200 && !condition(); i++) await tick();
  assert.ok(condition(), 'condition not reached');
}
function deferred() {
  let resolve;
  const promise = new Promise((yes) => (resolve = yes));
  return { promise, resolve };
}

/** Web Locks double for one origin: one holder at a time, abortable while waiting. */
function fakeLocks() {
  const locks = { names: [], held: 0, maxHeld: 0 };
  let tail = Promise.resolve();
  locks.request = (name, options, callback) => {
    locks.names.push(name);
    const { signal } = options;
    const turn = tail;
    let finish;
    const finished = new Promise((resolve) => (finish = resolve));
    tail = turn.then(() => finished);
    return new Promise((resolve, reject) => {
      let granted = false;
      const abort = () => {
        if (granted) return;
        finish();
        reject(new DOMException('The lock request was aborted.', 'AbortError'));
      };
      if (signal?.aborted) return abort();
      signal?.addEventListener('abort', abort, { once: true });
      turn.then(async () => {
        if (signal?.aborted) return;
        granted = true;
        signal?.removeEventListener('abort', abort);
        locks.held++;
        locks.maxHeld = Math.max(locks.maxHeld, locks.held);
        try {
          resolve(await callback());
        } catch (error) {
          reject(error);
        } finally {
          locks.held--;
          finish();
        }
      });
    });
  };
  return locks;
}

/** Cache API double: put() consumes the body, match() returns a fresh copy and
 * keys() keeps insertion order, a re-put moving the entry to the end. */
class FakeCache {
  constructor(storage, name) {
    this.storage = storage;
    this.name = name;
    this.entries = new Map();
  }
  async match(request) {
    const url = String(request);
    this.storage.log.push(['match', this.name, url]);
    await this.storage.hooks.match?.(url);
    const bytes = this.entries.get(url);
    return bytes ? new Response(bytes.slice()) : undefined;
  }
  async put(request, response) {
    const url = String(request);
    const storage = this.storage;
    storage.log.push(['put-start', this.name, url]);
    storage.active++;
    storage.maxActive = Math.max(storage.maxActive, storage.active);
    try {
      const bytes = new Uint8Array(await response.arrayBuffer());
      await storage.hooks.put?.(url, bytes);
      this.entries.delete(url);
      this.entries.set(url, bytes);
      storage.log.push(['put', this.name, url]);
      storage.observe();
    } finally {
      storage.active--;
    }
  }
  async delete(request) {
    const url = String(request);
    this.storage.log.push(['delete', this.name, url]);
    return this.entries.delete(url);
  }
  async keys() {
    return [...this.entries.keys()].map((url) => new Request(url));
  }
}

/** One origin's CacheStorage and its lock manager. Peaks count every stored body. */
class FakeStorage {
  constructor(hooks = {}) {
    this.hooks = hooks;
    this.locks = fakeLocks();
    this.caches = new Map();
    this.log = [];
    this.opened = [];
    this.active = 0;
    this.maxActive = 0;
    this.peakBytes = 0;
    this.peakRecords = 0;
  }
  async open(name) {
    this.opened.push(name);
    await this.hooks.open?.(name);
    if (!this.caches.has(name)) this.caches.set(name, new FakeCache(this, name));
    return this.caches.get(name);
  }
  get ours() {
    return this.caches.get(VERIFIED_ASSET_CACHE.name);
  }
  entry(url) {
    return this.ours?.entries.get(url);
  }
  /** Stored files of the verified cache, without its index. */
  contents() {
    return [...(this.ours?.entries ?? [])].filter(([url]) => url !== indexUrl);
  }
  /** Every record of the verified cache and the bytes of every stored body. */
  actual() {
    const bodies = [...(this.ours?.entries.values() ?? [])];
    return { bytes: bodies.reduce((sum, body) => sum + body.length, 0), records: bodies.length };
  }
  observe() {
    const { bytes, records } = this.actual();
    this.peakBytes = Math.max(this.peakBytes, bytes);
    this.peakRecords = Math.max(this.peakRecords, records);
  }
  puts(url) {
    return this.log.filter(([op, , target]) => op === 'put' && (!url || target === url)).length;
  }
}

/** A page's cache on `storage`, sharing the origin's locks unless told otherwise. */
const cacheFor = (storage, options = {}) =>
  new VerifiedAssetCache({ storage, origin, locks: storage.locks, ...options });

/** Same-origin files by path. Responses wait for `hold` when given. */
function network(files, hold = null) {
  const requests = [];
  const transport = async (url) => {
    requests.push(url.pathname);
    if (hold) await hold;
    const bytes = files.get(url.pathname);
    return bytes ? new Response(bytes) : new Response('', { status: 404 });
  };
  return { requests, transport };
}

test('a second verified read returns the exact bytes without a request, also after a reload', async () => {
  const bytes = filled(4096, 1);
  const record = file('/models/test/model.glb', bytes);
  const gate = deferred();
  const storage = new FakeStorage({ put: (url) => (url === indexUrl ? undefined : gate.promise) });
  const cache = cacheFor(storage);
  const { requests, transport } = network(new Map([[record.url, bytes]]));
  const read = (target) => downloadVerifiedAsset(record, origin, { cache: target, transport });
  assert.deepEqual(Buffer.from(await read(cache)), bytes);
  // Before the write lands, the queued verified copy serves.
  assert.deepEqual(Buffer.from(await read(cache)), bytes);
  assert.equal(cache.stats.pendingReads, 1);
  gate.resolve();
  await cache.idle();
  assert.deepEqual(Buffer.from(storage.entry(keyOf(record))), bytes);
  assert.deepEqual(Buffer.from(await read(cache)), bytes);
  const reloaded = cacheFor(storage);
  assert.deepEqual(Buffer.from(await read(reloaded)), bytes);
  await Promise.all([cache.idle(), reloaded.idle()]);
  assert.deepEqual(requests, [record.url]);
  assert.equal(cache.stats.hits, 2);
  assert.equal(reloaded.stats.hits, 1);
  assert.deepEqual(new Set(storage.opened), new Set([VERIFIED_ASSET_CACHE.name]));
});

test('concurrent requests share one transfer and every caller owns its buffer', async () => {
  const bytes = filled(2048, 2);
  const record = file('/models/test/actor.glb', bytes);
  const release = deferred();
  const { requests, transport } = network(new Map([[record.url, bytes]]), release.promise);
  const storage = new FakeStorage();
  const cache = cacheFor(storage);
  const loads = [0, 1, 2].map(() => downloadVerifiedAsset(record, origin, { cache, transport }));
  await until(() => requests.length === 1);
  release.resolve();
  const [a, b, c] = await Promise.all(loads);
  assert.equal(requests.length, 1);
  assert.ok(a !== b && b !== c && a !== c);
  structuredClone(a, { transfer: [a] }); // as a parser handing its buffer to a worker would
  assert.equal(a.byteLength, 0);
  new Uint8Array(b).fill(0);
  assert.deepEqual(Buffer.from(c), bytes);
  await cache.idle();
  assert.deepEqual(Buffer.from(storage.entry(keyOf(record))), bytes);
  assert.deepEqual(
    Buffer.from(await downloadVerifiedAsset(record, origin, { cache, transport })),
    bytes,
  );
  assert.equal(requests.length, 1);
  // Without a cache, duplicates are coalesced the same way.
  const plain = network(new Map([[record.url, bytes]]));
  const both = await Promise.all(
    [0, 1].map(() =>
      downloadVerifiedAsset(record, origin, { cache: null, transport: plain.transport }),
    ),
  );
  assert.equal(plain.requests.length, 1);
  assert.notEqual(both[0], both[1]);
  for (const result of both) assert.deepEqual(Buffer.from(result), bytes);
});

test('entries are keyed by content: a changed hash never reuses old bytes and supersedes them', async () => {
  const url = '/models/test/model.glb';
  const v1 = filled(1000, 3);
  const v2 = filled(1200, 4);
  const v3 = Buffer.from(v2);
  v3[0] ^= 1; // same length, other content
  const storage = new FakeStorage();
  const cache = cacheFor(storage);
  const load = async (bytes, path = url) => {
    const served = network(new Map([[path, bytes]]));
    const result = await downloadVerifiedAsset(file(path, bytes), origin, {
      cache,
      transport: served.transport,
    });
    await cache.idle();
    return { bytes: Buffer.from(result), requests: served.requests };
  };
  assert.deepEqual(await load(v1), { bytes: v1, requests: [url] });
  assert.deepEqual(await load(v2), { bytes: v2, requests: [url] });
  assert.deepEqual(
    storage.contents().map(([key]) => key),
    [keyOf(file(url, v2))],
  );
  assert.equal(cache.stats.superseded, 1);
  assert.deepEqual(await load(v3), { bytes: v3, requests: [url] });
  // The identical file under another URL is the same verified content.
  assert.deepEqual(await load(v3, '/models/copy/model.glb'), { bytes: v3, requests: [] });
  assert.deepEqual(
    storage.contents().map(([key]) => key),
    [keyOf(file(url, v3))],
  );
});

test('a damaged cached file is deleted and fetched once more from its own URL', async () => {
  const bytes = filled(3000, 5);
  const record = file('/models/test/model.glb', bytes);
  const storage = new FakeStorage();
  const cache = cacheFor(storage);
  const { requests, transport } = network(new Map([[record.url, bytes]]));
  const read = () => downloadVerifiedAsset(record, origin, { cache, transport });
  await read();
  await cache.idle();
  const damages = [
    (stored) => {
      stored[100] ^= 0xff;
      return stored;
    },
    (stored) => stored.subarray(0, 10),
  ];
  for (const damage of damages) {
    storage.ours.entries.set(keyOf(record), damage(storage.entry(keyOf(record))));
    storage.log.length = 0;
    assert.deepEqual(Buffer.from(await read()), bytes);
    await cache.idle();
    const writes = storage.log
      .filter(([op, , url]) => ['delete', 'put'].includes(op) && url === keyOf(record))
      .map(([op]) => op);
    assert.deepEqual(writes, ['delete', 'put']);
    assert.deepEqual(Buffer.from(storage.entry(keyOf(record))), bytes);
  }
  assert.deepEqual(requests, [record.url, record.url, record.url]);
  assert.equal(cache.stats.corrupt, 2);
});

test('bad network bytes fail with the normal integrity errors and are never cached', async () => {
  const bytes = filled(500, 6);
  const record = file('/models/test/model.glb', bytes);
  const flipped = Buffer.from(bytes);
  flipped[0] ^= 1;
  const storage = new FakeStorage();
  const cache = cacheFor(storage);
  const failures = [
    [flipped, /SHA-256 mismatch/],
    [bytes.subarray(1), /file length mismatch/],
    [null, /HTTP 404/],
  ];
  for (const [served, error] of failures) {
    const { transport } = network(new Map(served ? [[record.url, served]] : []));
    await assert.rejects(downloadVerifiedAsset(record, origin, { cache, transport }), error);
  }
  await cache.idle();
  assert.equal(storage.puts(), 0);
  assert.equal(cache.stats.stored, 0);
  // A damaged cached copy followed by a bad network copy: the same error, nothing kept.
  const good = network(new Map([[record.url, bytes]]));
  await downloadVerifiedAsset(record, origin, { cache, transport: good.transport });
  await cache.idle();
  storage.entry(keyOf(record))[0] ^= 1;
  const bad = network(new Map([[record.url, flipped]]));
  await assert.rejects(
    downloadVerifiedAsset(record, origin, { cache, transport: bad.transport }),
    /SHA-256 mismatch/,
  );
  await cache.idle();
  assert.equal(storage.entry(keyOf(record)), undefined);
  assert.deepEqual(storage.actual(), { bytes: 0, records: 0 });
  assert.deepEqual(bad.requests, [record.url]);
});

test('quota failures keep verified network reads working and stop further writes', async () => {
  const quota = () => new DOMException('Quota exceeded', 'QuotaExceededError');
  const storage = new FakeStorage({
    put: (url) => {
      if (url !== indexUrl) throw quota();
    },
  });
  const cache = cacheFor(storage);
  const a = filled(800, 7);
  const b = filled(900, 8);
  const { requests, transport } = network(
    new Map([
      ['/models/a.glb', a],
      ['/models/b.glb', b],
    ]),
  );
  for (const [url, bytes] of [
    ['/models/a.glb', a],
    ['/models/b.glb', b],
    ['/models/a.glb', a],
  ]) {
    const result = await downloadVerifiedAsset(file(url, bytes), origin, { cache, transport });
    assert.deepEqual(Buffer.from(result), bytes);
    await cache.idle();
  }
  assert.deepEqual(requests, ['/models/a.glb', '/models/b.glb', '/models/a.glb']);
  assert.equal(cache.stats.quotaErrors, 1);
  assert.equal(cache.writable, false);
  assert.equal(cache.readOnlyReason, 'quota exceeded');
  assert.equal(cache.disabledReason, null);
  assert.equal(cache.diagnostics().pendingBytes, 0);
});

test('storage errors never make a verified network file unusable', async () => {
  const files = [0, 1, 2, 3].map((i) => [`/models/e${i}.glb`, filled(400, 20 + i)]);
  const records = files.map(([url, bytes]) => file(url, bytes));
  // Writes fail after the first file: three failures make the cache read-only.
  const writing = new FakeStorage({
    put: (url) => {
      if (url !== indexUrl && url !== keyOf(records[0])) throw new TypeError('disk failure');
    },
  });
  const cache = cacheFor(writing);
  const sent = network(new Map(files));
  for (const [index, record] of records.entries()) {
    const result = await downloadVerifiedAsset(record, origin, {
      cache,
      transport: sent.transport,
    });
    assert.deepEqual(Buffer.from(result), files[index][1]);
    await cache.idle();
  }
  assert.equal(cache.stats.errors, 3);
  assert.equal(cache.readOnlyReason, 'repeated write errors');
  assert.equal(cache.disabledReason, null);
  const stored = await downloadVerifiedAsset(records[0], origin, {
    cache,
    transport: sent.transport,
  });
  assert.deepEqual(Buffer.from(stored), files[0][1]);
  assert.equal(sent.requests.length, 4);
  // Reads fail: three failures turn the cache off, the network still serves.
  const reading = new FakeStorage({
    match: (url) => {
      if (url !== indexUrl) throw new TypeError('backend lost');
    },
  });
  const broken = cacheFor(reading);
  const again = network(new Map(files));
  for (const [index, record] of records.entries()) {
    const result = await downloadVerifiedAsset(record, origin, {
      cache: broken,
      transport: again.transport,
    });
    assert.deepEqual(Buffer.from(result), files[index][1]);
    await broken.idle();
  }
  assert.equal(broken.disabledReason, 'repeated read errors');
  assert.equal(reading.log.filter(([op, , url]) => op === 'match' && url !== indexUrl).length, 3);
  assert.equal(again.requests.length, 4);
});

test('unavailable CacheStorage leaves the verified network path', async () => {
  const storage = new FakeStorage({
    open: () => {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    },
  });
  const cache = cacheFor(storage);
  const bytes = filled(600, 9);
  const record = file('/models/test/model.glb', bytes);
  const { requests, transport } = network(new Map([[record.url, bytes]]));
  for (let i = 0; i < 2; i++)
    assert.deepEqual(
      Buffer.from(await downloadVerifiedAsset(record, origin, { cache, transport })),
      bytes,
    );
  await cache.idle();
  assert.equal(requests.length, 2);
  assert.match(cache.disabledReason, /unavailable: SecurityError/);
  assert.equal(storage.opened.length, 1);
});

test('a stalled cache read times out to the network and turns the cache off', async () => {
  const storage = new FakeStorage({ match: () => new Promise(() => {}) });
  const cache = cacheFor(storage, { readTimeoutMs: 20 });
  const bytes = filled(700, 12);
  const record = file('/models/test/model.glb', bytes);
  const { requests, transport } = network(new Map([[record.url, bytes]]));
  for (let i = 0; i < 2; i++)
    assert.deepEqual(
      Buffer.from(await downloadVerifiedAsset(record, origin, { cache, transport })),
      bytes,
    );
  await cache.idle();
  assert.equal(requests.length, 2);
  assert.match(cache.disabledReason, /read timed out/);
  assert.equal(storage.puts(), 0);
});

test('a read that stalls while the page is hidden does not turn the cache off', async () => {
  const listeners = [];
  const document = { addEventListener: (type, listener) => listeners.push([type, listener]) };
  let stalled = 0;
  const storage = new FakeStorage({
    match: (url) => {
      if (url === indexUrl) return;
      stalled++;
      return new Promise(() => {});
    },
  });
  const cache = cacheFor(storage, { readTimeoutMs: 20, document });
  assert.deepEqual(
    listeners.map(([type]) => type),
    ['visibilitychange'],
  );
  const bytes = filled(500, 13);
  const record = file('/models/test/model.glb', bytes);
  const { requests, transport } = network(new Map([[record.url, bytes]]));
  const first = downloadVerifiedAsset(record, origin, { cache, transport });
  await until(() => stalled === 1);
  listeners[0][1](); // hidden or frozen, then shown again, while the read waits
  assert.deepEqual(Buffer.from(await first), bytes);
  assert.equal(cache.disabledReason, null);
  await cache.idle();
  assert.deepEqual(
    Buffer.from(await downloadVerifiedAsset(record, origin, { cache, transport })),
    bytes,
  );
  assert.match(cache.disabledReason, /read timed out/);
  assert.deepEqual(requests, [record.url, record.url]);
});

test('CacheStorage is used only by a secure HTTP(S) page with Web Locks', () => {
  const storage = new FakeStorage();
  const page = (overrides) => ({
    isSecureContext: true,
    caches: storage,
    location: { origin },
    navigator: { locks: storage.locks },
    ...overrides,
  });
  assert.ok(createBrowserVerifiedAssetCache(page({})) instanceof VerifiedAssetCache);
  // Plain-HTTP LAN origins are not secure contexts.
  assert.equal(createBrowserVerifiedAssetCache(page({ isSecureContext: false })), null);
  assert.equal(createBrowserVerifiedAssetCache(page({ caches: undefined })), null);
  assert.equal(createBrowserVerifiedAssetCache(page({ navigator: {} })), null);
  const denied = {
    ...page({}),
    get caches() {
      throw new DOMException('denied', 'SecurityError');
    },
  };
  assert.equal(createBrowserVerifiedAssetCache(denied), null);
  assert.equal(createBrowserVerifiedAssetCache(page({ location: { origin: 'null' } })), null);
  assert.equal(browserVerifiedAssetCache(origin), null); // Node has no secure page
  assert.deepEqual(storage.opened, []);
});

test('the byte budget counts the stored index exactly, at and just past the boundary', async () => {
  const bytes = filled(600, 14);
  const record = file('/models/test/model.glb', bytes);
  const load = async (options) => {
    const storage = new FakeStorage();
    const cache = cacheFor(storage, options);
    const { transport } = network(new Map([[record.url, bytes]]));
    const result = await downloadVerifiedAsset(record, origin, { cache, transport });
    assert.deepEqual(Buffer.from(result), bytes);
    await cache.idle();
    return { storage, cache, actual: storage.actual(), usage: await cache.usage() };
  };
  const roomy = await load({});
  const index = roomy.storage.entry(indexUrl).length;
  assert.deepEqual(roomy.actual, { bytes: 600 + index, records: 2 });
  assert.equal(roomy.usage.bytes, 600 + index);
  assert.equal(roomy.usage.indexBytes, index);
  assert.equal(roomy.usage.records, 2);
  const exact = await load({ maxBytes: 600 + index });
  assert.deepEqual(exact.actual, { bytes: 600 + index, records: 2 });
  assert.equal(exact.cache.stats.stored, 1);
  const short = await load({ maxBytes: 600 + index - 1 });
  assert.deepEqual(short.actual, { bytes: 0, records: 0 });
  assert.equal(short.cache.stats.skipped, 1);
  assert.equal(short.storage.puts(), 0);
  const oneRecord = await load({ maxEntries: 1 });
  assert.deepEqual(oneRecord.actual, { bytes: 0, records: 0 });
});

test('the reviewed counterexamples stay within 1000 stored bytes, index included', async () => {
  // A file as large as the whole budget cannot be stored with its index.
  const big = filled(1000, 15);
  const bigRecord = file('/models/big.glb', big);
  const single = new FakeStorage();
  const cache = cacheFor(single, { maxBytes: 1000, maxEntryBytes: 1000 });
  const sent = network(new Map([[bigRecord.url, big]]));
  const result = await downloadVerifiedAsset(bigRecord, origin, {
    cache,
    transport: sent.transport,
  });
  assert.deepEqual(Buffer.from(result), big);
  await cache.idle();
  assert.deepEqual(single.actual(), { bytes: 0, records: 0 });
  assert.deepEqual(await cache.usage(), { bytes: 0, indexBytes: 0, records: 0, entries: [] });
  // Two pages store 600 bytes each at once, with and without Web Locks.
  const files = new Map([
    ['/models/one.glb', filled(600, 16)],
    ['/models/two.glb', filled(600, 17)],
  ]);
  for (const locked of [true, false]) {
    const shared = new FakeStorage();
    const options = { maxBytes: 1000, maxEntryBytes: 1000, locks: locked ? shared.locks : null };
    const pages = [cacheFor(shared, options), cacheFor(shared, options)];
    const { requests, transport } = network(files);
    const results = await Promise.all(
      [...files].map(([url, bytes], i) =>
        downloadVerifiedAsset(file(url, bytes), origin, { cache: pages[i], transport }),
      ),
    );
    assert.deepEqual(
      results.map((bytes) => Buffer.from(bytes)),
      [...files.values()],
    );
    await Promise.all(pages.map((page) => page.idle()));
    assert.equal(requests.length, 2);
    assert.ok(shared.peakBytes <= 1000, `peak ${shared.peakBytes} bytes`);
    if (locked) {
      assert.equal(shared.contents().length, 1);
      assert.ok(shared.actual().bytes <= 1000);
      assert.equal(shared.locks.maxHeld, 1);
    } else {
      // Unguarded pages only read; they never put or delete, and the network serves.
      assert.deepEqual(shared.actual(), { bytes: 0, records: 0 });
      assert.deepEqual(
        shared.log.filter(([op]) => op !== 'match'),
        [],
      );
      for (const page of pages) assert.match(page.readOnlyReason, /^no Web Locks/);
    }
  }
});

test('the byte and record budget holds under concurrent writes', async () => {
  const storage = new FakeStorage();
  const budget = { maxBytes: 1000, maxEntries: 3, maxEntryBytes: 600, maxPendingBytes: 100_000 };
  const cache = cacheFor(storage, budget);
  const files = Array.from({ length: 12 }, (_, i) => [
    `/models/f${i}.glb`,
    filled(150 + ((i * 97) % 451), 30 + i),
  ]);
  const huge = ['/models/huge.glb', filled(700, 99)];
  const { transport } = network(new Map([...files, huge]));
  const results = await Promise.all(
    [...files, huge].map(([url, bytes]) =>
      downloadVerifiedAsset(file(url, bytes), origin, { cache, transport }),
    ),
  );
  for (const [index, [, bytes]] of [...files, huge].entries())
    assert.deepEqual(Buffer.from(results[index]), bytes);
  await cache.idle();
  assert.ok(storage.peakBytes <= 1000, `peak ${storage.peakBytes} bytes`);
  assert.ok(storage.peakRecords <= 3, `peak ${storage.peakRecords} records`);
  assert.equal(storage.maxActive, 1);
  assert.equal(storage.entry(keyOf(file(...huge))), undefined);
  assert.ok(cache.stats.evicted > 0);
  assert.ok(cache.stats.skipped >= 1);
  const usage = await cache.usage();
  assert.deepEqual(
    { bytes: usage.bytes, records: usage.records },
    storage.actual(),
  );
});

test('pages sharing one origin stay within the budget through Web Locks', async () => {
  const storage = new FakeStorage();
  const options = { maxBytes: 1000, maxEntries: 4, maxEntryBytes: 600 };
  const tabs = [cacheFor(storage, options), cacheFor(storage, options)];
  const files = Array.from({ length: 10 }, (_, i) => [
    `/models/g${i}.glb`,
    filled(200 + i * 40, 50 + i),
  ]);
  const { transport } = network(new Map(files));
  await Promise.all(
    files.map(([url, bytes], i) =>
      downloadVerifiedAsset(file(url, bytes), origin, { cache: tabs[i % 2], transport }),
    ),
  );
  await Promise.all(tabs.map((tab) => tab.idle()));
  assert.ok(storage.peakBytes <= 1000, `peak ${storage.peakBytes} bytes`);
  assert.ok(storage.peakRecords <= 4, `peak ${storage.peakRecords} records`);
  assert.equal(storage.maxActive, 1);
  assert.equal(storage.locks.maxHeld, 1);
  assert.ok(storage.locks.names.length >= files.length);
  assert.ok(storage.locks.names.every((name) => name === VERIFIED_ASSET_CACHE.name));
});

test('a late native write keeps the lock until it settles; waiting pages give up safely', async () => {
  const records = ['a', 'b', 'c'].map((name, i) => [`/models/${name}.glb`, filled(600, 110 + i)]);
  const [a, b, c] = records.map(([url, bytes]) => file(url, bytes));
  const late = deferred();
  const storage = new FakeStorage({ put: (url) => (url === keyOf(a) ? late.promise : undefined) });
  const budget = { maxBytes: 1000, maxEntryBytes: 600 };
  const stalled = cacheFor(storage, { ...budget, writeTimeoutMs: 30 });
  const patient = cacheFor(storage, budget);
  const hasty = cacheFor(storage, { ...budget, writeTimeoutMs: 30 });
  const { requests, transport } = network(new Map(records));
  // Verified network bytes are returned while the optional write is stuck.
  const get = (cache, record) => downloadVerifiedAsset(record, origin, { cache, transport });
  assert.deepEqual(Buffer.from(await get(stalled, a)), records[0][1]);
  await until(() => storage.log.some(([op, , url]) => op === 'put-start' && url === keyOf(a)));
  assert.deepEqual(Buffer.from(await get(patient, b)), records[1][1]);
  assert.deepEqual(Buffer.from(await get(hasty, c)), records[2][1]);
  await sleep(80);
  assert.match(stalled.disabledReason, /write timed out/);
  assert.equal(storage.locks.held, 1, 'the stalled page still holds the lock');
  // The page that timed out while waiting released its copy and never writes.
  assert.match(hasty.disabledReason, /write timed out/);
  assert.equal(hasty.diagnostics().pendingBytes, 0);
  assert.equal(patient.diagnostics().pendingBytes, 600);
  late.resolve();
  await Promise.all([stalled.idle(), patient.idle(), hasty.idle()]);
  const writes = storage.log.filter(([op]) => op !== 'match');
  const started = writes.findIndex(([op, , url]) => op === 'put-start' && url === keyOf(a));
  assert.deepEqual(writes[started + 1], ['put', VERIFIED_ASSET_CACHE.name, keyOf(a)]);
  assert.ok(storage.peakBytes <= 1000, `peak ${storage.peakBytes} bytes`);
  assert.equal(storage.locks.maxHeld, 1);
  assert.deepEqual(
    storage.contents().map(([url]) => url),
    [keyOf(b)],
  );
  assert.ok(storage.actual().bytes <= 1000);
  assert.equal(requests.length, 3);
});

test('least recently used files go first, and reads rewrite only the small index', async () => {
  const storage = new FakeStorage();
  const names = ['a', 'b', 'c', 'd', 'e'];
  const files = new Map(
    names.map((name, i) => [name, [`/models/${name}.glb`, filled(300, 60 + i)]]),
  );
  const { requests, transport } = network(new Map(files.values()));
  const get = async (cache, name) => {
    await downloadVerifiedAsset(file(...files.get(name)), origin, { cache, transport });
    await cache.idle();
  };
  const stored = () =>
    storage
      .contents()
      .map(([url]) => names.find((name) => url === keyOf(file(...files.get(name)))))
      .sort();
  const bodyPuts = () => storage.puts() - storage.puts(indexUrl);
  // Four records: three files and the index.
  const cache = cacheFor(storage, { maxEntries: 4 });
  for (const name of ['a', 'b', 'c']) await get(cache, name);
  const [bodies, indexes] = [bodyPuts(), storage.puts(indexUrl)];
  await get(cache, 'a'); // a hit makes a the most recent
  assert.equal(bodyPuts(), bodies);
  assert.equal(storage.puts(indexUrl), indexes + 1);
  await get(cache, 'd');
  assert.deepEqual(stored(), ['a', 'c', 'd']);
  // Recency survives a reload.
  const reloaded = cacheFor(storage, { maxEntries: 4 });
  await get(reloaded, 'c');
  await get(reloaded, 'e');
  assert.deepEqual(stored(), ['c', 'd', 'e']);
  assert.ok(storage.peakRecords <= 4);
  assert.deepEqual(
    requests,
    names.map((name) => files.get(name)[0]),
  );
});

test("only this cache's own entries are counted or deleted; a lost index only resets order", async () => {
  const storage = new FakeStorage();
  const saves = await storage.open('cro-magnon-saves');
  await saves.put(`${origin}/save.json`, new Response('{"day":3}'));
  const ours = await storage.open(VERIFIED_ASSET_CACHE.name);
  await ours.put(`${prefix}not-an-entry`, new Response('stray'));
  storage.opened.length = 0;
  const files = ['x', 'y', 'z'].map((name, i) => [`/models/${name}.glb`, filled(256, 100 + i)]);
  const { transport } = network(new Map(files));
  const get = async (cache, [url, bytes]) => {
    await downloadVerifiedAsset(file(url, bytes), origin, { cache, transport });
    await cache.idle();
  };
  // Three records: two files and the index.
  const cache = cacheFor(storage, { maxEntries: 3 });
  await get(cache, files[0]);
  await get(cache, files[1]);
  assert.equal(storage.entry(`${prefix}not-an-entry`), undefined);
  await ours.put(indexUrl, new Response('{ not json'));
  // Without recency, insertion order decides: x was stored first.
  const reloaded = cacheFor(storage, { maxEntries: 3 });
  await get(reloaded, files[2]);
  assert.deepEqual(
    storage.contents().map(([url]) => url),
    [files[1], files[2]].map(([url, bytes]) => keyOf(file(url, bytes))),
  );
  assert.notEqual(new TextDecoder().decode(storage.entry(indexUrl)), '{ not json');
  assert.deepEqual(new Set(storage.opened), new Set([VERIFIED_ASSET_CACHE.name]));
  assert.equal(saves.entries.size, 1);
  assert.equal(new TextDecoder().decode(saves.entries.get(`${origin}/save.json`)), '{"day":3}');
});

test('cached split parts reassemble the exact GLB and still need its full hash', async () => {
  const a = filled(700, 70);
  const b = filled(500, 71);
  const whole = Buffer.concat([a, b]);
  const record = {
    ...file('/models/test/model.glb', whole),
    parts: [file('/models/test/model.part-1.bin', a), file('/models/test/model.part-2.bin', b)],
  };
  const storage = new FakeStorage();
  const cache = cacheFor(storage);
  const { requests, transport } = network(
    new Map([
      [record.parts[0].url, a],
      [record.parts[1].url, b],
    ]),
  );
  const read = (target) => downloadVerifiedAsset(target, origin, { cache, transport });
  assert.deepEqual(Buffer.from(await read(record)), whole);
  await cache.idle();
  assert.deepEqual(
    storage
      .contents()
      .map(([url]) => url)
      .sort(),
    record.parts.map(keyOf).sort(),
  );
  assert.deepEqual(Buffer.from(await read(record)), whole);
  assert.equal(requests.length, 2);
  // Cached parts in the wrong order still fail the original GLB hash.
  await assert.rejects(read({ ...record, parts: [...record.parts].reverse() }), /SHA-256 mismatch/);
  assert.equal(requests.length, 2);
  // Damage to one part refetches that part only.
  storage.entry(keyOf(record.parts[1]))[0] ^= 1;
  assert.deepEqual(Buffer.from(await read(record)), whole);
  assert.deepEqual(requests.slice(2), [record.parts[1].url]);
  await cache.idle();
});

test('verified copies waiting to be written stay within their memory bound', async () => {
  const gate = deferred();
  const storage = new FakeStorage({ put: (url) => (url === indexUrl ? undefined : gate.promise) });
  const cache = cacheFor(storage, { maxPendingBytes: 1000 });
  const files = [
    ['/models/p0.glb', filled(600, 80)],
    ['/models/p1.glb', filled(600, 81)],
    ['/models/p2.glb', filled(300, 82)],
  ];
  const { transport } = network(new Map(files));
  for (const [url, bytes] of files)
    await downloadVerifiedAsset(file(url, bytes), origin, { cache, transport });
  assert.equal(cache.diagnostics().pendingBytes, 900);
  assert.equal(cache.stats.skipped, 1);
  gate.resolve();
  await cache.idle();
  assert.equal(cache.diagnostics().pendingBytes, 0);
  assert.deepEqual(
    storage.contents().map(([url]) => url),
    [files[0], files[2]].map(([url, bytes]) => keyOf(file(url, bytes))),
  );
});

test('no cache operation leaves an unhandled rejection', async () => {
  await tick();
  assert.deepEqual(unhandled, []);
});
