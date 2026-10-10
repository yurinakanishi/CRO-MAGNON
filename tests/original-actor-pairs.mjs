// The original full models and far LODs of the animated actors, as delivered before the r04
// runtime adoption. They stay unchanged at their public URLs after it
// (adoption-contract-r04.md), when the seven player bodies and the violet behemoth deliver a
// sole primary with no LOD and the other adopted actors a compressed pair. Tests of the actor
// level switch use these real pairs; tests of what the game delivers use the current manifest.
// Every file is read only once its exact length and SHA-256 match.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ORIGINAL_WOMAN, exactModel } from './cro-magnon-woman-rig.mjs';

/** A full model and its far LOD, each `[url, sha256, bytes]`; every LOD is drawn from 28 m. */
const pair = ([url, sha256, bytes], [lodUrl, lodSha256, lodBytes]) =>
  Object.freeze({
    full: Object.freeze({ url, sha256, bytes }),
    lod: Object.freeze({ url: lodUrl, sha256: lodSha256, bytes: lodBytes, distanceMetres: 28 }),
  });

/** The original pair of each actor: what its manifest delivers before the adoption and records
 * as its original (`runtimeOptimization.original`, scripts/optimization/adoption.mjs) after. */
export const ORIGINAL_PAIRS = Object.freeze({
  'cro-magnon-woman': ORIGINAL_WOMAN,
  'cro-magnon-hunter': pair(
    [
      '/models/cro-magnon-hunter/model-face-r01.glb',
      'd460b5217aea1933dbbd584d61626692c8c3a6f201077064d7c2065a69588552',
      12444656,
    ],
    [
      '/models/cro-magnon-hunter/lod-face-r01.glb',
      '91e6922796997a6f81f85fecf81accf5b6580e6710da672caa69f4a740baae83',
      1041640,
    ],
  ),
  'neanderthal-woman': pair(
    [
      '/models/neanderthal-woman/model-face-r01.glb',
      'b4c416900e972c8850892b7a5f886e62478894d1c958cf35830dc7ea1672dde9',
      10675488,
    ],
    [
      '/models/neanderthal-woman/lod-face-r01.glb',
      '867a3908acf4a85918aded67c2ae4a0529c860f9455ec613337d707c0e044156',
      716252,
    ],
  ),
  'neanderthal-hunter': pair(
    [
      '/models/neanderthal-hunter/model-face-r01.glb',
      '6910fd3396bcde7934e9af23fa2130ca5c1bca9a08da0d00fe5582076b94352b',
      15858864,
    ],
    [
      '/models/neanderthal-hunter/lod-face-r01.glb',
      '27f7e96e7c3e377db6be2b38bb9c9740a907b5c5a412cd1731fe7ea6885faa89',
      1006052,
    ],
  ),
  'cat-kunoichi': pair(
    [
      '/models/cat-kunoichi/model-c2.glb',
      '0f2fecf9409bfea07ea0eadb25d3038ebe0cd8f9ca64e37214c4a4a42b4eb90e',
      12754684,
    ],
    [
      '/models/cat-kunoichi/lod-c2.glb',
      '89addc6db3f18f48d5145ceb69fddeae9e9e23c8bb73e282de4595a40f1f0a49',
      998028,
    ],
  ),
  'desert-fennec-mage': pair(
    [
      '/models/desert-fennec-mage/model-c2.glb',
      '82ec1d4303e25bb37bef594c118861b9d7216d1b3b996091a93b89f62c0cc3b5',
      8843048,
    ],
    [
      '/models/desert-fennec-mage/lod-c2.glb',
      '1fd295fc6261305b911fa28134143e8dc8a8a34e96ebf9b7fa6903f9e06bf5a9',
      890624,
    ],
  ),
  'giant-ape': pair(
    [
      '/models/giant-ape/model-c2.glb',
      '9bfd996eec87c77af99d32c642564cd987548563bcbfe905a252d935f763e0b9',
      10566148,
    ],
    [
      '/models/giant-ape/lod-c2.glb',
      '8a5c25d064261114e015ccb0447e88a9383598ffac3c747891fc39128cb29d07',
      944420,
    ],
  ),
  'howkey-scientist': pair(
    [
      '/models/howkey-scientist/model-c2.glb',
      '229a82a35ddaec11ad82ab5e616e8952f1740ecd9c441c259aba8c6cd121a509',
      10170824,
    ],
    [
      '/models/howkey-scientist/lod-c2.glb',
      '8269f0fc24906fcc51e4758823370b4b6da60185d3cbd3eca665330ca4dc000b',
      803776,
    ],
  ),
  'maruimo-octopus': pair(
    [
      '/models/maruimo-octopus/model-c2.glb',
      '12886dd609a4415736390ffb46521b20887967037f8255c54107c58cd3d34c59',
      10811624,
    ],
    [
      '/models/maruimo-octopus/lod-c2.glb',
      '46c1a189b5989a3016f9c4be08378b6a2bdb9b854503a273bf3894d403b9ae9a',
      971756,
    ],
  ),
  'crow-shaman': pair(
    [
      '/models/crow-shaman/model-c2.glb',
      '4719f03aa5df820d70123e64e49ba88255182dbe34087ea7f315224cd4b8b89e',
      6691440,
    ],
    [
      '/models/crow-shaman/lod-c2.glb',
      '3c05ba2c8cd0654894fa71b53fd61bc1cbb6fa05515a7e66e56c4037c4ff104e',
      926720,
    ],
  ),
  'woolly-mammoth': pair(
    [
      '/models/woolly-mammoth/model-c2.glb',
      '1a4b70113c94aec36e6a24f1216f9c1b9d2f6975a7a4604b861fbce783b907d5',
      8468828,
    ],
    [
      '/models/woolly-mammoth/lod-c2.glb',
      'a6ceb7e85a8a2115da1c175ba753909fdb62d90e82ec91273cde4c65139915f0',
      482624,
    ],
  ),
  'sabertooth-tiger': pair(
    [
      '/models/sabertooth-tiger/model-c2.glb',
      'e6ec30cbd18aab4bf5b7f2f4972658f191c9f168d667501f7032f6f69b203ab0',
      6843576,
    ],
    [
      '/models/sabertooth-tiger/lod-c2.glb',
      '29b91f5cb8733200017eeac875504519d8c5f554cf262ec89cc7ff298d31bf1b',
      690408,
    ],
  ),
  'violet-behemoth': pair(
    [
      '/models/violet-behemoth/model-c2.glb',
      '85b3a6393ce569c81d75557201b510afc1b278529e1ffa65806ed6c0c17e4fda',
      7168980,
    ],
    [
      '/models/violet-behemoth/lod-c2.glb',
      'dcf10984d40d4ea4deaa38424c3cc2b438cfa0a4c4a5b5be1fea4925c24e153c',
      550636,
    ],
  ),
});

const fileOf = (record) => ({ url: record?.url, sha256: record?.sha256, bytes: record?.bytes });
const sameFile = (a, b) => JSON.stringify(fileOf(a)) === JSON.stringify(fileOf(b));

/** An actor's manifest as the game reads it now. */
export async function actorManifest(key) {
  return JSON.parse(await readFile(`public/models/${key}/asset.json`, 'utf8'));
}

/** The original pair of `key`, both files verified and parsed by `parse(bytes)`: `full`,
 * `lod`, `levels` (the actor record the level switch reads: the original LOD distance) and
 * `asset` (the current manifest, whose gameplay metadata the adoption keeps). */
export async function originalPair(key, parse) {
  const known = ORIGINAL_PAIRS[key],
    asset = await actorManifest(key),
    original = asset.runtimeOptimization?.original ?? asset;
  assert.ok(known, `${key}: no recorded original pair`);
  assert.deepEqual(fileOf(original), fileOf(known.full), `${key}: the original full model`);
  assert.deepEqual(fileOf(original.lods?.[0]), fileOf(known.lod), `${key}: the original LOD`);
  const { distanceMetres } = known.lod;
  assert.equal(original.lods[0].distanceMetres, distanceMetres, `${key}: the LOD distance`);
  const read = async (file) => parse(await exactModel(file));
  const [full, lod] = await Promise.all([read(known.full), read(known.lod)]);
  return { asset, full, lod, levels: { modelKey: key, lods: [{ distanceMetres }] } };
}

/** What the game delivers now for `key`: its manifest, whether that is still exactly the
 * original pair, and `load(parse)` for its verified primary and first LOD (null when the
 * manifest lists none: a sole primary). */
export async function deliveredActor(key) {
  const asset = await actorManifest(key),
    known = ORIGINAL_PAIRS[key],
    lods = asset.lods ?? [],
    lod = lods[0] ?? null;
  assert.ok(known, `${key}: no recorded original pair`);
  return {
    asset,
    original: sameFile(asset, known.full) && lods.length === 1 && sameFile(lod, known.lod),
    load: async (parse) => ({
      primary: await parse(await exactModel(asset)),
      lod: lod && (await parse(await exactModel(lod))),
    }),
  };
}
