// A camp-cave manifest record has two identities. The original is the generated file,
// kept unchanged as its source and at its original public URL. The served file is what
// the game downloads. Before runtime adoption they are one file. After adoption the
// record serves a verified, hash-addressed derivative, and the adoption stamp records
// the original: `runtimeOptimization.original` on the model record and
// `provenance.runtimeOptimization.original` on an image record
// (scripts/optimization/adoption.mjs adoptModel / adoptTexture).
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

export const RUNTIME_FIELD = 'runtimeOptimization';
/** The longest edge an adopted cave image may have. */
export const ADOPTED_EDGE = 1024;
/** The immutable candidate revision whose cave files the adoption serves. */
export const R04 = 'assets/optimized-runtime/20261009-r04';

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const plain = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const isSize = (size) =>
  plain(size) &&
  Number.isSafeInteger(size.width) &&
  Number.isSafeInteger(size.height) &&
  size.width > 0 &&
  size.height > 0;
const isFile = (file) =>
  plain(file) &&
  typeof file.url === 'string' &&
  /^\/models\/camp-cave\/[^/]+$/.test(file.url) &&
  typeof file.sha256 === 'string' &&
  /^[a-f0-9]{64}$/.test(file.sha256) &&
  Number.isSafeInteger(file.bytes) &&
  file.bytes > 0;
const fileOf = (record) => ({ url: record.url, sha256: record.sha256, bytes: record.bytes });
const sizeOf = (size) => ({ width: size.width, height: size.height });
const publicFile = (url) => `public${url}`;

/** The content-addressed URL of a verified derivative of `original`. */
export const derivedUrl = (original, sha) =>
  original.url.replace(/(\.[a-z0-9]+)$/i, `.opt-${sha.slice(0, 16)}$1`);

/** The complete adoption stamp `holder[RUNTIME_FIELD]`, or a failure. */
function adoptionStamp(holder, where) {
  const stamp = holder[RUNTIME_FIELD];
  assert.ok(plain(stamp), `${where}: the adoption stamp is not an object`);
  for (const field of ['adoption', 'candidateRevision'])
    assert.ok(typeof stamp[field] === 'string' && stamp[field] !== '', `${where}: no ${field}`);
  assert.ok(isFile(stamp.original), `${where}: no original file identity`);
  return stamp;
}

/** An adopted record serves another file under its content-addressed name. */
function assertDerived(original, served, where) {
  assert.notEqual(served.sha256, original.sha256, `${where}: the adoption serves the original`);
  const url = derivedUrl(original, served.sha256);
  assert.equal(served.url, url, `${where}: the served URL is not hash-addressed`);
}

/** The original and served files of the camp-cave model record. */
export function modelIdentities(asset, where = 'camp-cave') {
  assert.ok(isFile(asset), `${where}: not a served model record`);
  const served = fileOf(asset);
  if (!Object.hasOwn(asset, RUNTIME_FIELD)) return { adopted: false, original: served, served };
  const original = fileOf(adoptionStamp(asset, `${where}.${RUNTIME_FIELD}`).original);
  assertDerived(original, served, where);
  return { adopted: true, original, served };
}

/** The original and served files of a camp-cave image record. Without any adoption
 * field they are one file. A uvSource or provenance without a complete stamp is an
 * error, never read as the original. */
export function imageIdentities(record, where) {
  assert.ok(isFile(record) && isSize(record.image), `${where}: not a served image record`);
  const served = { ...fileOf(record), image: sizeOf(record.image) };
  if (!Object.hasOwn(record, 'provenance') && !Object.hasOwn(record, 'uvSource'))
    return { adopted: false, original: served, served };
  const stamped = plain(record.provenance) && Object.hasOwn(record.provenance, RUNTIME_FIELD);
  assert.ok(stamped, `${where}: uvSource or provenance without an adoption stamp`);
  const stamp = adoptionStamp(record.provenance, `${where}.provenance.${RUNTIME_FIELD}`);
  assert.ok(isSize(stamp.original.image), `${where}: the stamp records no original image size`);
  const original = { ...fileOf(stamp.original), image: sizeOf(stamp.original.image) };
  assert.ok(isSize(record.uvSource), `${where}: an adopted image without uvSource`);
  assert.deepEqual(sizeOf(record.uvSource), original.image, `${where}: uvSource is not original`);
  assertDerived(original, served, where);
  return { adopted: true, original, served };
}

/** The file's bytes, once its exact length and SHA-256 match `file`. */
export async function readExact(path, file) {
  const bytes = await readFile(path);
  assert.equal(bytes.length, file.bytes, `${path}: length`);
  assert.equal(sha256(bytes), file.sha256, `${path}: SHA-256`);
  return bytes;
}

/** A PNG's IHDR: its size and colour type (6 is RGBA). */
export function pngHeader(bytes, path) {
  assert.ok(bytes.subarray(0, 8).equals(PNG_SIGNATURE), `${path}: not a PNG`);
  assert.equal(bytes.toString('latin1', 12, 16), 'IHDR', `${path}: no IHDR`);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), colour: bytes[25] };
}

/** Proves an RGBA cave image record twice: its original of `size` (the generated
 * source and the original public file, both unchanged) and, separately, the file
 * served now. An adopted copy stays RGBA, within the edge and a whole-image resize. */
export async function verifyRgbaImage(record, where, size, { serve = publicFile } = {}) {
  const { adopted, original, served } = imageIdentities(record, where);
  assert.deepEqual(original.image, size, `${where}: the original size`);
  assert.equal(typeof record.source, 'string', `${where}: no generated source`);
  for (const path of [record.source, publicFile(original.url)]) {
    const header = pngHeader(await readExact(path, original), path);
    assert.deepEqual(sizeOf(header), size, `${path}: the original size`);
    assert.equal(header.colour, 6, `${path}: must retain RGBA`);
  }
  const path = serve(served.url);
  const header = pngHeader(await readExact(path, served), path);
  assert.deepEqual(sizeOf(header), served.image, `${path}: the served size`);
  assert.equal(header.colour, 6, `${path}: must retain RGBA`);
  if (adopted) {
    const { width, height } = served.image;
    assert.ok(Math.max(width, height) <= ADOPTED_EDGE, `${path}: over ${ADOPTED_EDGE} px`);
    assert.ok(width <= size.width && height <= size.height, `${path}: upscaled`);
    const slack = Math.max(size.width, size.height);
    const skew = Math.abs(width * size.height - height * size.width);
    assert.ok(skew <= slack, `${path}: not a whole-image resize`);
  }
  return { adopted, original, served };
}

/** Proves the camp-cave model twice: its original GLB at the original public URL
 * and, separately, the GLB served now. */
export async function verifyCaveModel(asset, { serve = publicFile } = {}) {
  const { adopted, original, served } = modelIdentities(asset);
  await readExact(publicFile(original.url), original);
  const bytes = await readExact(serve(served.url), served);
  assert.equal(bytes.toString('latin1', 0, 4), 'glTF', `${served.url}: not a GLB`);
  return { adopted, original, served };
}

const valueAt = (value, path) => path.split('.').reduce((node, key) => node?.[key], value);

/** The camp-cave model and image records as the r04 adoption writes them (adoptModel,
 * adoptTexture), built from the revision's runtime index and served from the
 * revision. The index's sources must be the originals `current` records, adopted or
 * not, so the adopted path is proven on the real candidate bytes either way. */
export async function r04AdoptedCave(current) {
  const index = JSON.parse(await readFile(`${R04}/runtime-index.json`, 'utf8'));
  const stamp = (original) => ({
    [RUNTIME_FIELD]: { adoption: 'r04-proof', candidateRevision: '20261009-r04', original },
  });
  const original = modelIdentities(current).original,
    model = index.files[original.url];
  assert.ok(model, `${R04} has no candidate for ${original.url}`);
  assert.deepEqual([model.sourceSha256, model.sourceBytes], [original.sha256, original.bytes]);
  const cave = { ...fileOf(model), ...stamp(original) };
  const images = {};
  for (const [url, entry] of Object.entries(index.textures)) {
    if (entry.owner !== 'camp-cave') continue;
    const record = valueAt(current, entry.manifestEntry),
      originalImage = imageIdentities(record, entry.manifestEntry).original;
    assert.deepEqual(
      [url, entry.sourceSha256, entry.sourceBytes],
      [originalImage.url, originalImage.sha256, originalImage.bytes],
      `${entry.manifestEntry}: the candidate's source is the manifest's original`,
    );
    images[entry.manifestEntry] = {
      ...fileOf(entry),
      image: { width: entry.width, height: entry.height },
      source: record.source,
      uvSource: sizeOf(entry.uvSource),
      provenance: stamp(originalImage),
    };
  }
  return { cave, images, serve: (url) => `${R04}${url}` };
}
