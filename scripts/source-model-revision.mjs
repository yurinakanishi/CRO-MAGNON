// An intentional new source model can supersede an immutable optimization.
// Its hash-bound, accepted revision record must match both the old graph and
// the new model. The earlier optimization's files and plan remain untouched.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const files = (records) => records.map(({ url, sha256, bytes }) => ({ url, sha256, bytes }));
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export async function readSourceModelRevisions(root, assets, adoption) {
  const revisions = {};
  for (const asset of assets) {
    if (asset.sourceRevision === undefined) continue;
    const key = asset.modelKey,
      stamp = asset.sourceRevision;
    const fail = (reason) => {
      throw new Error(`${key}: invalid source revision: ${reason}`);
    };
    if (!stamp || typeof stamp !== 'object' || asset.runtimeOptimization !== undefined)
      fail('cannot retain an optimization stamp on a new source');
    if (typeof key !== 'string' || !/^[a-z0-9-]+$/.test(key)) fail('model key');
    if (
      typeof stamp.record !== 'string' ||
      !new RegExp(`^assets/${key}/qa/source-revision-[a-z0-9-]+\\.json$`).test(stamp.record)
    )
      fail('record path');
    const bytes = await readFile(path.join(root, ...stamp.record.split('/')));
    if (hash(bytes) !== stamp.sha256) fail('record SHA-256');
    const proof = JSON.parse(bytes);
    const previous = adoption.graph.models[key];
    if (
      proof.schema !== 'cro-magnon/source-model-revision@1' ||
      proof.decision !== 'adopt' ||
      proof.modelKey !== key
    )
      fail('not an accepted revision of this model');
    if (
      !previous ||
      proof.previous?.adoption !== adoption.id ||
      !equal(proof.previous?.files, files([previous.primary, ...previous.lods]))
    )
      fail('predecessor differs from the active optimization');
    const current = files([asset, ...(asset.lods ?? [])]);
    if (
      !equal(proof.files, current) ||
      current.some((file) => /\.opt-/.test(file.url)) ||
      current.some((file) => proof.previous.files.some((old) => old.url === file.url)) ||
      [asset, ...(asset.lods ?? [])].some((record) => record.scene !== undefined)
    )
      fail('new model identities differ or reuse a predecessor URL');
    // The recorded visual review is immutable evidence, independent of the stamp.
    if (!new RegExp(`^assets/${key}/qa/[a-z0-9-]+\\.json$`).test(proof.review?.path ?? ''))
      fail('review path');
    const reviewBytes = await readFile(path.join(root, ...proof.review.path.split('/')));
    if (hash(reviewBytes) !== proof.review.sha256) fail('review SHA-256');
    const review = JSON.parse(reviewBytes);
    if (review.decision !== 'adopt' || review.sha256 !== asset.sha256)
      fail('review does not accept this GLB');
    revisions[key] = { files: current, record: stamp.record, sha256: stamp.sha256 };
  }
  return revisions;
}

export function matchesSourceModelRevision(asset, adoption) {
  const proof = adoption?.sourceRevisions?.[asset.modelKey];
  return (
    !!proof &&
    asset.runtimeOptimization === undefined &&
    equal(files([asset, ...(asset.lods ?? [])]), proof.files) &&
    asset.sourceRevision?.record === proof.record &&
    asset.sourceRevision?.sha256 === proof.sha256
  );
}
