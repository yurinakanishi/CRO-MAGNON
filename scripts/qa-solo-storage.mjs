// Native Chrome IndexedDB failure/backup QA, using isolated test storage only.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);
const source = await readFile('dist/infrastructure/browser/solo-save.mjs', 'utf8');
const server = createServer((request, response) => {
  response.setHeader('Content-Type', request.url === '/save.mjs' ? 'text/javascript' : 'text/html');
  response.end(
    request.url === '/save.mjs' ? source : '<!doctype html><title>Isolated solo storage QA</title>',
  );
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const output = process.argv[2] || 'output/playwright/solo-storage';
await mkdir(output, { recursive: true });
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const result = await page.evaluate(async () => {
    const { openSoloSave, encodeSoloSave, SOLO_DATABASE, SOLO_STORE } = await import('/save.mjs');
    const checks = [];
    const check = (condition, label) => {
      if (!condition) throw new Error(label);
      checks.push(label);
    };
    const reject = async (operation, label) => {
      let failed = false;
      try {
        await operation();
      } catch {
        failed = true;
      }
      check(failed, label);
    };
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const data = (value) => ({
      session: 'test-session',
      game: { version: 1, worldVersion: 4, rooms: [], savedAt: value },
    });
    const raw = async (change) => {
      const db = await new Promise((resolve, reject) => {
        const req = indexedDB.open(SOLO_DATABASE, 1);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      return new Promise((resolve, reject) => {
        const tx = db.transaction(SOLO_STORE, change ? 'readwrite' : 'readonly');
        const store = tx.objectStore(SOLO_STORE);
        if (change) for (const [key, value] of Object.entries(change)) store.put(value, key);
        const current = store.get('current'),
          previous = store.get('previous');
        tx.oncomplete = () => {
          db.close();
          resolve({ current: current.result, previous: previous.result });
        };
        tx.onabort = () => {
          db.close();
          reject(tx.error);
        };
      });
    };
    let port = await openSoloSave();
    await port.load(() => {});
    await port.write(data(1));
    await port.write(data(2));
    const committed = await raw();
    check(
      committed.current.revision === 2 && committed.previous.revision === 1,
      'Two committed revisions retain the previous checkpoint',
    );
    // Abort after an individual put succeeds, while the native transaction is still live.
    const nativeTransaction = IDBDatabase.prototype.transaction;
    let putSucceeded = false;
    IDBDatabase.prototype.transaction = function (...args) {
      const tx = nativeTransaction.apply(this, args);
      if (args[1] === 'readwrite') {
        const store = tx.objectStore(SOLO_STORE),
          nativePut = store.put;
        store.put = function (...values) {
          const request = nativePut.apply(this, values);
          request.addEventListener('success', () => {
            putSucceeded = true;
            try {
              tx.abort();
            } catch {}
          });
          return request;
        };
      }
      return tx;
    };
    try {
      await reject(
        () => port.write(data(3)),
        'An aborted transaction is reported as a failed save',
      );
    } finally {
      IDBDatabase.prototype.transaction = nativeTransaction;
    }
    check(putSucceeded, 'Failure was injected after request success, before transaction commit');
    check(same(await raw(), committed), 'An aborted write preserves both prior records exactly');
    await port.write(data(4));
    check(
      (await raw()).current.revision === 3,
      'Retry succeeds without advancing the revision on failure',
    );
    port.close();

    const intact = await raw();
    await raw({ current: { ...intact.current, payload: 'broken' } });
    port = await openSoloSave();
    const recovered = await port.load(() => {});
    check(
      recovered.recovered && recovered.data.game.savedAt === 2,
      'A corrupt current record restores the verified previous checkpoint',
    );
    await port.write(data(5));
    check(
      same((await raw()).previous, intact.previous),
      'Recovery keeps the known-good backup instead of the corrupt record',
    );
    port.close();

    for (const kind of ['both-corrupt', 'future-envelope', 'future-payload']) {
      let fixture;
      if (kind === 'both-corrupt')
        fixture = {
          current: { version: 1, payload: 'bad' },
          previous: { version: 1, payload: 'bad2' },
        };
      else if (kind === 'future-envelope')
        fixture = { current: { ...intact.current, version: 2 }, previous: intact.previous };
      else
        fixture = {
          current: await encodeSoloSave({ ...data(6), game: { ...data(6).game, version: 2 } }, 9),
          previous: intact.previous,
        };
      await raw(fixture);
      port = await openSoloSave();
      await reject(() => port.load(() => {}), `${kind}: loading is refused`);
      await reject(() => port.write(data(7)), `${kind}: writing is blocked`);
      check(same(await raw(), fixture), `${kind}: original records are preserved`);
      port.close();
    }
    // Native transaction constructor failure is surfaced (e.g. quota/storage revocation).
    await raw(intact);
    port = await openSoloSave();
    await port.load(() => {});
    IDBDatabase.prototype.transaction = function (...args) {
      if (args[1] === 'readwrite')
        throw new DOMException('Injected storage limit', 'QuotaExceededError');
      return nativeTransaction.apply(this, args);
    };
    try {
      await reject(() => port.write(data(8)), 'Quota denial is reported rather than acknowledged');
    } finally {
      IDBDatabase.prototype.transaction = nativeTransaction;
    }
    check(same(await raw(), intact), 'Quota denial leaves the committed data intact');
    port.close();
    return { checks, passed: checks.length };
  });
  assert.equal(result.passed, 18);
  await writeFile(`${output}/result.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
