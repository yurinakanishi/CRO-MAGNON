import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { mkdir, mkdtemp, open, readdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { sendFailure, serveStatic } from '../dist/infrastructure/node/static-files.mjs';
import {
  removeStaleTemporaries,
  writeFileAtomic,
  writeFilesAtomic,
} from '../scripts/atomic-write.mjs';

// scripts/build.mjs replaces dist/ files while the dev server (serveStatic) and tests read
// them. A module read during the build must be one whole revision, never a truncated one
// ("SyntaxError: Unexpected end of input" in the browser).

/** Distinct module text of a given size. */
function revision(bytes, mark) {
  const line = `export const revision = '${mark}'; // ${'x'.repeat(60)}\n`;
  return line.repeat(Math.ceil(bytes / line.length)).slice(0, bytes);
}

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cro-atomic-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'dist/src'), { recursive: true });
  return root;
}

async function serve(t, root) {
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://localhost');
      await serveStatic(request, response, url.pathname, root);
    } catch (error) {
      sendFailure(response, error);
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return server.address().port;
}

/**
 * Status and body of a response. A body cut short or stalled, or one longer than its
 * Content-Length (a file grown while it was sent), is reported, never awaited or thrown.
 */
function fetchEnd(port, url) {
  return new Promise((resolve) => {
    const request = http.request(
      { host: '127.0.0.1', port, path: url, agent: false },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('error', () => {});
        response.on('close', () =>
          resolve({
            status: response.statusCode,
            complete: response.complete,
            body: Buffer.concat(chunks).toString(),
          }),
        );
      },
    );
    request.setTimeout(5000, () => request.destroy(new Error('stalled')));
    request.on('error', (error) =>
      resolve({ status: 0, complete: false, body: '', error: error.code ?? error.message }),
    );
    request.end();
  });
}

test('a module served while builds replace it is always one whole revision', async (t) => {
  const root = await fixture(t);
  const port = await serve(t, root);
  const file = path.join(root, 'dist/src/module.js');
  const revisions = [revision(1_500_000, 'a'), revision(900_000, 'b')];
  await writeFile(file, revisions[0]);
  let writing = true;
  const seen = new Set();
  const defects = [];
  let reads = 0;
  const reader = async () => {
    while (writing) {
      const { status, complete, body, error } = await fetchEnd(port, '/src/module.js');
      reads++;
      const index = revisions.indexOf(body);
      if (status !== 200 || !complete || index < 0)
        defects.push(error ?? `${status} complete=${complete} ${body.length} bytes`);
      else seen.add(index);
    }
  };
  const readers = [reader(), reader()];
  try {
    for (let write = 1; write <= 24; write++)
      await writeFileAtomic(file, revisions[write % revisions.length]);
  } finally {
    writing = false;
    await Promise.all(readers);
  }
  assert.deepEqual(defects, []);
  assert.ok(reads >= 24, `only ${reads} reads overlapped the writes`);
  assert.deepEqual([...seen].sort(), [0, 1], 'readers saw both revisions');
  assert.equal(await readFile(file, 'utf8'), revisions[0]);
  assert.deepEqual(await readdir(path.join(root, 'dist/src')), ['module.js']);
  // The temporary name is dot-prefixed: never served, even while it exists.
  await writeFile(path.join(root, 'dist/src/.module.js.1.1.tmp'), 'partial');
  assert.equal((await fetchEnd(port, '/src/.module.js.1.1.tmp')).status, 403);
});

test('a reader holding the old file reads it whole; the new file follows its close', async (t) => {
  const root = await fixture(t);
  const file = path.join(root, 'dist/src/module.js');
  await writeFile(file, 'old revision');
  const handle = await open(file, 'r');
  let replaced = false;
  const write = writeFileAtomic(file, 'new revision').then(() => (replaced = true));
  await new Promise((resolve) => setTimeout(resolve, 100));
  // Windows refuses to replace an open file (EPERM, despite FILE_SHARE_DELETE): the write
  // waits for the reader. POSIX renames at once and the reader keeps the old inode.
  if (process.platform === 'win32') assert.equal(replaced, false);
  assert.equal(await handle.readFile('utf8'), 'old revision');
  await handle.close();
  await write;
  assert.equal(await readFile(file, 'utf8'), 'new revision');
  assert.deepEqual(await readdir(path.dirname(file)), ['module.js']);
});

test(
  'a file kept open past the deadline is left unchanged, without a temporary',
  { skip: process.platform !== 'win32' && 'only Windows refuses to replace an open file' },
  async (t) => {
    const root = await fixture(t);
    const file = path.join(root, 'dist/src/module.js');
    await writeFile(file, 'old revision');
    const handle = await open(file, 'r');
    try {
      await assert.rejects(
        writeFileAtomic(file, 'new revision', { deadlineMs: 100 }),
        /could not be replaced within 100 ms \((EPERM|EACCES|EBUSY)\).*left unchanged/,
      );
    } finally {
      await handle.close();
    }
    assert.equal(await readFile(file, 'utf8'), 'old revision');
    assert.deepEqual(await readdir(path.dirname(file)), ['module.js']);
  },
);

test('a failed write in a batch is reported after the others finish', async (t) => {
  const root = await fixture(t);
  await writeFile(path.join(root, 'dist/not-a-directory'), '');
  await assert.rejects(
    writeFilesAtomic([
      [path.join(root, 'dist/src/a.js'), 'a'],
      [path.join(root, 'dist/not-a-directory/b.js'), 'b'],
      [path.join(root, 'dist/shared/c.mjs'), 'c'],
    ]),
  );
  assert.equal(await readFile(path.join(root, 'dist/src/a.js'), 'utf8'), 'a');
  assert.equal(await readFile(path.join(root, 'dist/shared/c.mjs'), 'utf8'), 'c');
  assert.deepEqual(await readdir(path.join(root, 'dist/src')), ['a.js']);
  assert.deepEqual(await readdir(path.join(root, 'dist/shared')), ['c.mjs']);
});

test('only stale temporaries of killed builds are removed', async (t) => {
  const root = await fixture(t);
  const directory = path.join(root, 'dist/src');
  for (const name of ['.old.js.123.1.tmp', '.live.js.123.2.tmp', '.keep', 'module.js'])
    await writeFile(path.join(directory, name), '');
  const past = new Date(Date.now() - 120_000);
  for (const name of ['.old.js.123.1.tmp', '.keep'])
    await utimes(path.join(directory, name), past, past);
  await removeStaleTemporaries(directory);
  assert.deepEqual((await readdir(directory)).sort(), ['.keep', '.live.js.123.2.tmp', 'module.js']);
  await removeStaleTemporaries(path.join(root, 'dist/missing'));
});

test('the build writes every output through the atomic writer', async () => {
  const build = await readFile(new URL('../scripts/build.mjs', import.meta.url), 'utf8');
  assert.match(build, /program\.emit\(undefined, \(file, text, writeByteOrderMark\) =>/);
  assert.match(build, /await writeFilesAtomic\(emitted\)/);
  assert.doesNotMatch(build, /\.emit\(\)/);
  assert.doesNotMatch(build, /\b(writeFile|writeFileSync|copyFile|copyFileSync)\(/);
});
