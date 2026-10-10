// The model-identity helper (runtime-model-identity.mjs) on synthetic records: ordinary records
// as before, and a packed exact-repack template only when strictly adopted. Reads no file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { assertPackedAdopted, modelIdentities } from './runtime-model-identity.mjs';

const ORIGINAL = { url: '/models/hill/model.glb', sha256: 'a'.repeat(64), bytes: 10 },
  ORIGINAL_LOD = { url: '/models/hill/lod1.glb', sha256: 'e'.repeat(64), bytes: 5 },
  PACKED_FILE = {
    url: `/models/hill/model-levels.opt-${'b'.repeat(16)}.glb`,
    sha256: 'b'.repeat(64),
    bytes: 20,
  },
  STAMP = {
    adoption: '20991231-r03-a01',
    candidateRevision: 'assets/optimized-runtime/20991231-r03',
    selection: 'ordinary-compressed',
    original: { ...ORIGINAL, triangles: 256, lods: [{ ...ORIGINAL_LOD, triangles: 64 }] },
  };
const packedAsset = (edit = (asset) => asset) =>
  edit({
    modelKey: 'hill',
    ...PACKED_FILE,
    scene: 0,
    triangles: 256,
    lods: [{ ...PACKED_FILE, scene: 1, triangles: 64, distanceMetres: 40 }],
    runtimeOptimization: structuredClone(STAMP),
  });
const refused = (asset, message) =>
  assert.throws(() => modelIdentities(asset, 'hill'), { code: 'ERR_ASSERTION', message });

test('ordinary records keep their identities: unadopted, or adopted under the original-derived name', () => {
  const unadopted = { modelKey: 'hill', ...ORIGINAL, lods: [ORIGINAL_LOD] };
  assert.deepEqual(modelIdentities(unadopted, 'hill'), {
    adopted: false,
    packed: false,
    original: ORIGINAL,
    served: ORIGINAL,
    stamp: null,
  });
  const served = {
      url: `/models/hill/model.opt-${'c'.repeat(16)}.glb`,
      sha256: 'c'.repeat(64),
      bytes: 8,
    },
    adopted = modelIdentities({ modelKey: 'hill', ...served, runtimeOptimization: STAMP }, 'hill');
  assert.deepEqual(
    [adopted.adopted, adopted.packed, adopted.original, adopted.served],
    [true, false, ORIGINAL, served],
  );
  // An ordinary record is never accepted under the packed name.
  refused(
    { modelKey: 'hill', ...PACKED_FILE, runtimeOptimization: STAMP },
    /hill: the served URL is not hash-addressed/,
  );
});

test('a packed primary is accepted only adopted, as scene 0 of model-levels.opt-<sha16>.glb named by every level', () => {
  const identity = modelIdentities(packedAsset(), 'hill');
  assert.deepEqual(
    [identity.adopted, identity.packed, identity.original, identity.served],
    [true, true, ORIGINAL, PACKED_FILE],
  );
  refused(
    packedAsset((asset) => {
      delete asset.runtimeOptimization;
      return asset;
    }),
    /hill: a packed scene without an adoption stamp/,
  );
  refused(
    { modelKey: 'hill', ...ORIGINAL, lods: [{ ...ORIGINAL_LOD, scene: 1 }] },
    /hill: a packed scene without an adoption stamp/,
  );
  refused(
    packedAsset((asset) => ({ ...asset, scene: 1 })),
    /level 0 names scene 1, not 0/,
  );
  refused(
    packedAsset((asset) => ({ ...asset, scene: '0' })),
    /level 0 names scene "0", not 0/,
  );
  refused(
    packedAsset((asset) => ({ ...asset, scene: null })),
    /level 0 names scene null, not 0/,
  );
  refused(
    packedAsset((asset) => {
      delete asset.scene;
      return asset;
    }),
    /level 0 names scene undefined, not 0/,
  );
  refused(
    packedAsset((asset) => ({ ...asset, lods: [{ ...asset.lods[0], scene: 2 }] })),
    /level 1 names scene 2, not 1/,
  );
  refused(
    packedAsset((asset) => ({ ...asset, lods: [{ ...asset.lods[0], scene: 0.5 }] })),
    /level 1 names scene 0.5, not 1/,
  );
  refused(
    packedAsset((asset) => ({ ...asset, lods: [{ ...asset.lods[0], bytes: 21 }] })),
    /level 1 is not the packed file/,
  );
  refused(
    packedAsset((asset) => ({ ...asset, lods: [] })),
    /at least two levels/,
  );
  // The packed name, addressed by the served SHA-256; never the original-derived name.
  const named = (url) =>
    packedAsset((asset) => ({ ...asset, url, lods: [{ ...asset.lods[0], url }] }));
  refused(
    named(`/models/hill/model.opt-${'b'.repeat(16)}.glb`),
    /the served URL is not hash-addressed/,
  );
  refused(
    named(`/models/hill/model-levels.opt-${'f'.repeat(16)}.glb`),
    /the served URL is not hash-addressed/,
  );
  refused(named('/models/hill/model-levels.glb'), /the served URL is not hash-addressed/);
});

test('a packed record must be exactly its applied adoption packed entry, as the build graph checks it', () => {
  const entry = {
      selection: 'ordinary-compressed',
      primary: { ...PACKED_FILE, scene: 0 },
      lods: [{ ...PACKED_FILE, scene: 1 }],
    },
    adoption = (models = { hill: entry }) => ({
      id: STAMP.adoption,
      planSha256: 'd'.repeat(64),
      graph: { models, textures: {}, retired: [], notAdopted: {} },
    });
  assertPackedAdopted(packedAsset(), adoption());
  assert.throws(() => assertPackedAdopted(packedAsset(), null), /outside any applied adoption/);
  assert.throws(() => assertPackedAdopted(packedAsset(), adoption({})), /does not adopt it/);
  assert.throws(
    () =>
      assertPackedAdopted(
        packedAsset(),
        adoption({ hill: { ...entry, primary: { ...PACKED_FILE }, lods: [{ ...PACKED_FILE }] } }),
      ),
    /differ from runtime adoption 20991231-r03-a01/,
  );
  assert.throws(
    () =>
      assertPackedAdopted(
        packedAsset((asset) => ({
          ...asset,
          runtimeOptimization: { ...asset.runtimeOptimization, adoption: '20991231-r03-a02' },
        })),
        adoption(),
      ),
    /not the adopted one/,
  );
  assert.throws(
    () =>
      assertPackedAdopted(
        packedAsset(),
        adoption({
          hill: { ...entry, lods: [{ ...PACKED_FILE, sha256: 'f'.repeat(64), scene: 1 }] },
        }),
      ),
    /packs it inconsistently: its levels name different files/,
  );
});
