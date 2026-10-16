import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import {
  readSourceTextureRevisions,
  textureRevisionFiles,
} from '../scripts/source-texture-revision.mjs';
import { checkRuntimeGraph } from '../scripts/runtime-graph.mjs';
const hash = (b) => createHash('sha256').update(b).digest('hex');
const textureRecords = (a) => [a.pigment];
async function fixture(t, edit = () => {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'cro-art-revision-'));
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve(tmpdir()));
    assert(path.basename(root).startsWith('cro-art-revision-'));
    await rm(root, { recursive: true, force: true });
  });
  const folder = 'assets/camp-cave/qa';
  await mkdir(path.join(root, folder), { recursive: true });
  const old = {
    owner: 'camp-cave',
    manifestEntry: 'pigment',
    url: '/models/camp-cave/old.opt-aaaaaaaaaaaaaaaa.png',
    sha256: 'a'.repeat(64),
    bytes: 100,
  };
  const next = {
    url: '/models/camp-cave/new-r39.png',
    sha256: 'b'.repeat(64),
    bytes: 120,
    image: { width: 1024, height: 341 },
  };
  const asset = {
    modelKey: 'camp-cave',
    url: '/models/camp-cave/model.glb',
    sha256: 'c'.repeat(64),
    bytes: 1000,
    lods: [],
    pigment: next,
  };
  const adoption = { id: 'test-adoption', graph: { models: {}, textures: { old }, retired: [] } };
  const review = {
    decision: 'adopt',
    modelKey: 'camp-cave',
    sha256: asset.sha256,
    textures: textureRevisionFiles([next]),
  };
  const proof = {
    schema: 'cro-magnon/source-texture-revision@1',
    modelKey: 'camp-cave',
    decision: 'adopt',
    previous: {
      adoption: adoption.id,
      replaced: [{ url: old.url, sha256: old.sha256, bytes: old.bytes, manifestEntry: 'pigment' }],
    },
    files: textureRevisionFiles([next]),
    review: { path: `${folder}/adoption-art.json` },
  };
  edit({ proof, review, asset });
  const r = JSON.stringify(review);
  proof.review.sha256 = hash(r);
  await writeFile(path.join(root, `${folder}/adoption-art.json`), r);
  const p = JSON.stringify(proof),
    record = `${folder}/source-texture-revision-r39.json`;
  await writeFile(path.join(root, record), p);
  asset.textureRevision = { record, sha256: hash(p) };
  return { root, asset, adoption };
}
test('accepted texture revision replaces only named immutable predecessors', async (t) => {
  const { root, asset, adoption } = await fixture(t);
  const accepted = {
    ...adoption,
    textureRevisions: await readSourceTextureRevisions(root, [asset], adoption, textureRecords),
  };
  assert.doesNotThrow(() => checkRuntimeGraph([asset], accepted, { textureRecords }));
  assert.throws(
    () => checkRuntimeGraph([asset], adoption, { textureRecords }),
    /no verified acceptance/,
  );
  const changed = structuredClone(asset);
  changed.pigment.bytes++;
  assert.throws(
    () => checkRuntimeGraph([changed], accepted, { textureRecords }),
    /no verified acceptance/,
  );
  const noProof = { ...asset };
  delete noProof.textureRevision;
  assert.throws(
    () => checkRuntimeGraph([noProof], adoption, { textureRecords }),
    /shipped record does not declare/,
  );
});
for (const [name, edit, pattern] of [
  ['wrong predecessor', ({ proof }) => (proof.previous.replaced = []), /replaced textures/],
  ['wrong adoption', ({ proof }) => (proof.previous.adoption = 'wrong'), /predecessor/],
  ['changed texture', ({ proof }) => proof.files[0].bytes++, /identities/],
  ['unaccepted review', ({ review }) => (review.decision = 'pending'), /review does not accept/],
  ['other texture review', ({ review }) => (review.textures = []), /review does not accept/],
  [
    'oversized source',
    ({ proof, review, asset }) => {
      asset.pigment.image.width = 2048;
      proof.files = textureRevisionFiles([asset.pigment]);
      review.textures = proof.files;
    },
    /budget/,
  ],
])
  test(`texture revision rejects ${name}`, async (t) => {
    const { root, asset, adoption } = await fixture(t, edit);
    await assert.rejects(
      readSourceTextureRevisions(root, [asset], adoption, textureRecords),
      pattern,
    );
  });
test('a changed proof or unsafe path cannot authorize artwork', async (t) => {
  const { root, asset, adoption } = await fixture(t);
  asset.textureRevision.sha256 = '0'.repeat(64);
  await assert.rejects(
    readSourceTextureRevisions(root, [asset], adoption, textureRecords),
    /record SHA-256/,
  );
  asset.textureRevision.record = '../../record.json';
  await assert.rejects(
    readSourceTextureRevisions(root, [asset], adoption, textureRecords),
    /record path/,
  );
});
