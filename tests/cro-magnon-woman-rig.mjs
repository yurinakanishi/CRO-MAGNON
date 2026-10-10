// The Cro-Magnon woman's rig for CPU tests, parsed by scripts/motion-glb.mjs (the exact
// geometry, skin and clips; textures are not decoded), in two identities:
// - The original full model and far LOD the game delivered before the r04 runtime
//   adoption. They stay unchanged at their public URLs after it (adoption-contract-r04.md)
//   and remain the only real HIGH/LOW pair, so tests of the actor level switch use them.
// - The body the game delivers now. Before the adoption it is that same pair; after it,
//   the sole lightweight primary (meshopt-compressed) with no LOD. Residency, release and
//   grounding tests use it, so they follow the adoption.
// Every file is read only once its exact length and SHA-256 match its record.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { loadMotion } from '../scripts/motion-glb.mjs';

export const WOMAN = 'cro-magnon-woman';

/** The original pair: what the manifest delivers before the adoption and records as its
 * original (`runtimeOptimization.original`, scripts/optimization/adoption.mjs) after it. */
export const ORIGINAL_WOMAN = Object.freeze({
  full: Object.freeze({
    url: '/models/cro-magnon-woman/model-face-r01.glb',
    sha256: 'c8082f13995cebd42d674f6d4b5c87a61d441597d5670aec8803ca5006fdf2c1',
    bytes: 11552512,
  }),
  lod: Object.freeze({
    url: '/models/cro-magnon-woman/lod-face-r01.glb',
    sha256: 'af0fdffd99f893e08b3fd3e5411b629d7dec8ac321495f4b1129ba9f45ce2eb4',
    bytes: 736684,
    distanceMetres: 28,
  }),
});

const fileOf = (record) => ({ url: record?.url, sha256: record?.sha256, bytes: record?.bytes });
/** A verified file, parsed; null for none. */
const parsed = async (file) => (file ? loadMotion(await exactModel(file)) : null);

/** The woman's manifest as the game reads it now. */
export async function womanManifest() {
  return JSON.parse(await readFile(`public/models/${WOMAN}/asset.json`, 'utf8'));
}

/** The bytes of `file` (`{ url, sha256, bytes }`) under `root`, once its exact length and
 * SHA-256 match. */
export async function exactModel(file, root = 'public') {
  const path = `${root}${file.url}`,
    bytes = await readFile(path);
  assert.equal(bytes.length, file.bytes, `${path}: length`);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256, `${path}: SHA-256`);
  return bytes;
}

/** The original pair, parsed: `full` and `lod`, `levels` the actor record the level switch
 * reads (the original LOD distance), and `asset` the current manifest, whose gameplay
 * metadata (locomotion, clips) the adoption keeps. */
export async function originalWomanRig() {
  const asset = await womanManifest(),
    original = asset.runtimeOptimization?.original ?? asset;
  assert.deepEqual(fileOf(original), fileOf(ORIGINAL_WOMAN.full), 'the original full model');
  assert.deepEqual(fileOf(original.lods?.[0]), fileOf(ORIGINAL_WOMAN.lod), 'the original LOD');
  const { distanceMetres } = ORIGINAL_WOMAN.lod;
  assert.equal(original.lods[0].distanceMetres, distanceMetres, 'the original LOD distance');
  const [full, lod] = await Promise.all([parsed(ORIGINAL_WOMAN.full), parsed(ORIGINAL_WOMAN.lod)]);
  return { asset, full, lod, levels: { modelKey: WOMAN, lods: [{ distanceMetres }] } };
}

/** The body the game delivers now, parsed: `primary`, and `lod` for the first LOD its
 * manifest lists, or null when it lists none (the sole primary after the adoption). */
export async function deliveredWomanRig() {
  const asset = await womanManifest();
  const [primary, lod] = await Promise.all([parsed(asset), parsed(asset.lods?.[0])]);
  return { asset, primary, lod };
}
