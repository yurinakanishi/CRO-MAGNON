// A hash-bound artwork revision supersedes named optimization outputs. The old
// graph stays immutable; neither a bare flag nor a missing texture is accepted.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
export const textureRevisionFiles = (records) =>
  records
    .map(({ url, sha256, bytes, image, uvSource }) => ({
      url,
      sha256,
      bytes,
      ...(image ? { image } : {}),
      ...(uvSource ? { uvSource } : {}),
    }))
    .sort((a, b) => a.url.localeCompare(b.url));
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export async function readSourceTextureRevisions(root, assets, adoption, textureRecords) {
  const revisions = {};
  for (const asset of assets) {
    if (asset.textureRevision === undefined) continue;
    const key = asset.modelKey,
      stamp = asset.textureRevision;
    const fail = (reason) => {
      throw Error(`${key}: invalid source texture revision: ${reason}`);
    };
    if (
      !/^[a-z0-9-]+$/.test(key) ||
      !new RegExp(`^assets/${key}/qa/source-texture-revision-[a-z0-9-]+\\.json$`).test(
        stamp?.record ?? '',
      )
    )
      fail('record path');
    const bytes = await readFile(path.join(root, stamp.record));
    if (hash(bytes) !== stamp.sha256) fail('record SHA-256');
    const proof = JSON.parse(bytes),
      files = textureRevisionFiles(textureRecords(asset));
    if (
      proof.schema !== 'cro-magnon/source-texture-revision@1' ||
      proof.decision !== 'adopt' ||
      proof.modelKey !== key
    )
      fail('not an accepted artwork revision');
    if (proof.previous?.adoption !== adoption.id) fail('predecessor adoption');
    if (!equal(proof.files, files)) fail('new texture identities differ');
    const missing = Object.values(adoption.graph.textures ?? {}).filter(
      (t) => t.owner === key && !files.some((f) => f.url === t.url),
    );
    const replaced = missing
      .map(({ url, sha256, bytes, manifestEntry }) => ({ url, sha256, bytes, manifestEntry }))
      .sort((a, b) => a.url.localeCompare(b.url));
    if (!missing.length || !equal(proof.previous.replaced, replaced))
      fail('replaced textures differ from the active optimization');
    if (!new RegExp(`^assets/${key}/qa/[a-z0-9-]+\\.json$`).test(proof.review?.path ?? ''))
      fail('review path');
    const reviewBytes = await readFile(path.join(root, proof.review.path));
    if (hash(reviewBytes) !== proof.review.sha256) fail('review SHA-256');
    const review = JSON.parse(reviewBytes);
    if (
      review.decision !== 'adopt' ||
      review.modelKey !== key ||
      review.sha256 !== asset.sha256 ||
      !equal(review.textures, files)
    )
      fail('review does not accept these exact textures');
    for (const file of files.filter(
      (f) => !Object.values(adoption.graph.textures ?? {}).some((t) => t.url === f.url) && f.image,
    )) {
      if (
        !Number.isSafeInteger(file.image.width) ||
        !Number.isSafeInteger(file.image.height) ||
        Math.min(file.image.width, file.image.height) < 1 ||
        Math.max(file.image.width, file.image.height) > 1024 ||
        file.uvSource !== undefined ||
        /\.(?:opt|cook)-/.test(file.url)
      )
        fail('new source texture budget or identity');
    }
    revisions[key] = {
      record: stamp.record,
      sha256: stamp.sha256,
      files,
      replaced: missing.map((t) => t.url),
    };
  }
  return revisions;
}
export function matchesSourceTextureRevision(asset, adoption, records) {
  const proof = adoption?.textureRevisions?.[asset.modelKey];
  return (
    !!proof &&
    asset.textureRevision?.record === proof.record &&
    asset.textureRevision?.sha256 === proof.sha256 &&
    equal(textureRevisionFiles(records), proof.files)
  );
}
