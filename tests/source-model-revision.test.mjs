import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readSourceModelRevisions } from '../scripts/source-model-revision.mjs';
import { checkRuntimeGraph } from '../scripts/runtime-graph.mjs';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const old = {
  url: '/models/camp-cave/model-r26.opt-aaaaaaaaaaaaaaaa.glb',
  sha256: 'a'.repeat(64),
  bytes: 100,
};
const next = { url: '/models/camp-cave/model-r27.glb', sha256: 'b'.repeat(64), bytes: 110 };
async function fixture(t, edit = () => {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'cave-source-revision-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const folder = 'assets/camp-cave/qa';
  await mkdir(path.join(root, folder), { recursive: true });
  const review = { decision: 'adopt', sha256: next.sha256 };
  const adoption = {
    id: '20261010-r07-a01',
    graph: { models: { 'camp-cave': { primary: old, lods: [] } }, textures: {}, retired: [] },
  };
  const asset = { modelKey: 'camp-cave', ...next, lods: [] };
  const proof = {
    schema: 'cro-magnon/source-model-revision@1',
    modelKey: asset.modelKey,
    decision: 'adopt',
    previous: { adoption: adoption.id, files: [old] },
    files: [next],
    review: { path: `${folder}/adoption-r27.json` },
  };
  edit({ proof, review, asset });
  const reviewBytes = JSON.stringify(review);
  proof.review.sha256 = hash(reviewBytes);
  await writeFile(path.join(root, `${folder}/adoption-r27.json`), reviewBytes);
  const bytes = JSON.stringify(proof),
    record = `${folder}/source-revision-r27.json`;
  await writeFile(path.join(root, record), bytes);
  asset.sourceRevision = { record, sha256: hash(bytes) };
  return { root, asset, adoption };
}
const options = { requireAdoption: true, textureRecords: () => [] };

test('an explicitly reviewed new source supersedes only its exact immutable predecessor', async (t) => {
  const { root, asset, adoption } = await fixture(t);
  const approved = {
    ...adoption,
    sourceRevisions: await readSourceModelRevisions(root, [asset], adoption),
  };
  const graph = checkRuntimeGraph([asset], approved, options);
  assert.equal(graph.models[0].sha256, next.sha256);
  assert.throws(() => checkRuntimeGraph([asset], adoption, options), /no verified acceptance/);
  const changed = { ...asset, bytes: next.bytes + 1 };
  assert.throws(() => checkRuntimeGraph([changed], approved, options), /no verified acceptance/);
  assert.throws(
    () => checkRuntimeGraph([{ ...asset, sourceRevision: undefined }], adoption, options),
    /not the adopted one/,
  );
});

for (const [label, edit, error] of [
  [
    'missing predecessor',
    ({ proof }) => {
      delete proof.previous;
    },
    /predecessor/,
  ],
  [
    'wrong predecessor',
    ({ proof }) => {
      proof.previous.files = [];
    },
    /predecessor/,
  ],
  [
    'changed file',
    ({ proof }) => {
      proof.files = [{ ...next, bytes: 1 }];
    },
    /identities/,
  ],
  [
    'reusing old URL',
    ({ asset, proof }) => {
      asset.url = old.url;
      proof.files = [{ ...next, url: old.url }];
    },
    /identities/,
  ],
  [
    'no accepted review',
    ({ review }) => {
      review.decision = 'reject';
    },
    /review does not accept/,
  ],
  [
    'review of a different GLB',
    ({ review }) => {
      review.sha256 = old.sha256;
    },
    /review does not accept/,
  ],
  [
    'retained optimization stamp',
    ({ asset }) => {
      asset.runtimeOptimization = {};
    },
    /optimization stamp/,
  ],
])
  test(`a source revision rejects ${label}`, async (t) => {
    const { root, asset, adoption } = await fixture(t, edit);
    await assert.rejects(readSourceModelRevisions(root, [asset], adoption), error);
  });

test('proof tampering and an unsafe proof path cannot authorize a model', async (t) => {
  const { root, asset, adoption } = await fixture(t);
  asset.sourceRevision.sha256 = 'c'.repeat(64);
  await assert.rejects(readSourceModelRevisions(root, [asset], adoption), /record SHA-256/);
  asset.sourceRevision.record = 'assets/camp-cave/qa/../../source-revision-r27.json';
  await assert.rejects(readSourceModelRevisions(root, [asset], adoption), /record path/);
});
