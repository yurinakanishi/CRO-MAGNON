import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, lstat, rm, realpath, symlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { createCrowSync } from '../scripts/crow-canonical-sync.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'crow-sync-test-'));
  const workspace = path.join(root, 'CRO-MAGNON');
  const canonical = path.join(root, 'threed-model-creation', 'models');
  const source = path.join(workspace, 'output', 'model-generation', 'models', 'crow-shaman');
  await mkdir(path.join(source, 'work', 'revision-01', 'qa'), { recursive: true });
  await mkdir(path.join(source, 'reference'), { recursive: true });
  await mkdir(path.join(source, 'empty-history'), { recursive: true });
  await mkdir(canonical, { recursive: true });
  await writeFile(path.join(source, 'model.json'), '{"candidate":1}\n');
  await writeFile(path.join(source, 'reference', 'selected.png'), Buffer.from([1, 8, 3, 5]));
  await writeFile(path.join(source, 'work', 'revision-01', 'dense.glb'), Buffer.alloc(256001, 33));
  await writeFile(path.join(source, 'work', 'revision-01', 'qa', 'test.json'), '{"retained":true}');
  t.after(async () => {
    const resolved = await realpath(root);
    assert.equal(path.dirname(resolved).toLowerCase(), (await realpath(os.tmpdir())).toLowerCase());
    assert.ok(path.basename(resolved).startsWith('crow-sync-test-'));
    await rm(resolved, { recursive: true });
  });
  return { root, workspace, source, canonical, ...createCrowSync(workspace) };
}

test('crow sync plan preserves every file and empty directory without creating destination', async t => {
  const sync = await fixture(t), plan = await sync.plan();
  assert.equal(plan.files.length, 4); assert.equal(plan.newFiles, 4);
  assert.ok(plan.directories.includes('empty-history'));
  const dense = plan.files.find(entry => entry.path.endsWith('dense.glb'));
  assert.equal(dense.bytes, 256001);
  assert.equal(dense.sha256, createHash('sha256').update(Buffer.alloc(256001, 33)).digest('hex'));
  await assert.rejects(lstat(sync.destination), { code: 'ENOENT' });
});

test('crow copy is exclusive, reruns skip only identical files, and verify checks all hashes', async t => {
  const sync = await fixture(t), plan = await sync.plan();
  const first = await sync.copy(plan);
  assert.equal(first.copied, 4); assert.equal(first.skippedEqual, 0);
  assert.ok((await lstat(path.join(sync.destination, 'empty-history'))).isDirectory());
  assert.equal((await sync.verify(plan)).files, 4);
  const second = await sync.copy(plan);
  assert.equal(second.copied, 0); assert.equal(second.skippedEqual, 4);
  await writeFile(path.join(sync.destination, 'model.json'), 'existing canonical different');
  await assert.rejects(sync.copy(plan), /refusing overwrite/);
  assert.equal(await readFile(path.join(sync.destination, 'model.json'), 'utf8'), 'existing canonical different');
});

test('source revisions added or changed after planning block the entire copy preflight', async t => {
  const sync = await fixture(t), plan = await sync.plan();
  await writeFile(path.join(sync.source, 'model.json'), '{"candidate":2}');
  await assert.rejects(sync.copy(plan), /Source changed after planning/);
  await assert.rejects(lstat(sync.destination), { code: 'ENOENT' });
  const next = await sync.plan();
  await writeFile(path.join(sync.source, 'new-revision.json'), '{}');
  await assert.rejects(sync.copy(next), /Source tree changed after planning/);
  await assert.rejects(lstat(sync.destination), { code: 'ENOENT' });
});

test('reviewed plan cannot select another model or traverse out of crow-shaman', async t => {
  const sync = await fixture(t), plan = await sync.plan();
  await assert.rejects(sync.copy({ ...plan, destinationRoot: path.join(sync.canonical, 'other-model') }), /fixed crow-shaman/);
  for (const name of ['../outside.glb', '/absolute.glb', 'work\\escape.glb', 'file:stream']) {
    await assert.rejects(sync.copy({ ...plan, files: [{ ...plan.files[0], path: name }] }), /Invalid relative path|Path escaped/);
  }
  await assert.rejects(lstat(sync.destination), { code: 'ENOENT' });
});

test('junction or symlink entries in the source and destination are rejected', async t => {
  const sync = await fixture(t), plan = await sync.plan(), outside = path.join(sync.root, 'outside');
  await mkdir(outside); await writeFile(path.join(outside, 'keep.txt'), 'outside untouched');
  const sourceLink = path.join(sync.source, 'linked');
  await symlink(outside, sourceLink, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(sync.plan(), /Linked or redirected/);
  await rm(sourceLink);
  await symlink(outside, sync.destination, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(sync.copy(plan), /Linked or redirected/);
  assert.equal(await readFile(path.join(outside, 'keep.txt'), 'utf8'), 'outside untouched');
});

test('unexpected canonical content and active generation locks block writes', async t => {
  const sync = await fixture(t), plan = await sync.plan();
  await mkdir(sync.destination); await writeFile(path.join(sync.destination, 'unrelated.txt'), 'retain');
  await assert.rejects(sync.copy(plan), /Unexpected destination file retained/);
  assert.equal(await readFile(path.join(sync.destination, 'unrelated.txt'), 'utf8'), 'retain');
  await writeFile(path.join(path.dirname(sync.source), 'world-trellis.lock'), 'active');
  await assert.rejects(sync.plan(), /Finish the active TRELLIS/);
});
