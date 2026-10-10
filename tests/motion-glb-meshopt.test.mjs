// CPU inspection of compressed deliveries. scripts/motion-glb.mjs and
// scripts/measure-collision-bounds.mjs decode EXT_meshopt_compression with the decoder three
// bundles (the one the game decodes with) and read what the original GLB holds. The files are
// the r04 candidate revision's, each verified by length and SHA-256 against its runtime index.
// That revision encodes geometry losslessly (attribute codec v0, index codec v1, no filters,
// no quantisation, no reordering), so the compressed full model must decode to exactly the
// original's geometry, skin and clips.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { loadMotion, unpack } from '../scripts/motion-glb.mjs';
import { geometryScene } from '../scripts/measure-collision-bounds.mjs';
import { ORIGINAL_WOMAN, WOMAN, exactModel } from './cro-magnon-woman-rig.mjs';

const R04 = 'assets/optimized-runtime/20261009-r04';
const MESHOPT = 'EXT_meshopt_compression';
/** Whether the GLB `bytes` lists meshopt compression in `key` (extensionsUsed/Required). */
const lists = (bytes, key) => (unpack(bytes).doc[key] ?? []).includes(MESHOPT);

/** The r04 candidates for the woman: her compressed full model and her startup body. */
async function candidates() {
  const index = JSON.parse(await readFile(`${R04}/runtime-index.json`, 'utf8')),
    full = index.files[ORIGINAL_WOMAN.full.url],
    startup = index.startupActors[WOMAN];
  assert.deepEqual(
    [full.sourceSha256, full.sourceBytes],
    [ORIGINAL_WOMAN.full.sha256, ORIGINAL_WOMAN.full.bytes],
    'the compressed full model is derived from the original',
  );
  assert.deepEqual(startup.fullSource, {
    url: ORIGINAL_WOMAN.full.url,
    sha256: ORIGINAL_WOMAN.full.sha256,
  });
  return { full, startup };
}

/** Every component of `attribute` (normalised values included), as comparable bytes. */
function components(attribute) {
  const values = new Float64Array(attribute.count * attribute.itemSize);
  for (let i = 0; i < attribute.count; i++)
    for (let c = 0; c < attribute.itemSize; c++)
      values[i * attribute.itemSize + c] = attribute.getComponent(i, c);
  return Buffer.from(values.buffer);
}

/** Each mesh in traversal order: its name and the skeleton it binds. */
function rigOf(scene) {
  const meshes = [];
  scene.traverse((node) => {
    if (!node.isMesh) return;
    meshes.push({
      name: node.name,
      bones: node.skeleton?.bones.map((bone) => bone.name),
      inverses: node.skeleton?.boneInverses.map((matrix) => matrix.toArray()),
    });
  });
  return meshes;
}

/** Each mesh in traversal order: every attribute and its index. */
function geometryOf(scene) {
  const meshes = [];
  scene.traverse((node) => {
    if (!node.isMesh) return;
    const { attributes, index } = node.geometry;
    meshes.push({
      attributes: Object.fromEntries(
        Object.entries(attributes).map(([key, attribute]) => [key, components(attribute)]),
      ),
      index: index && components(index),
    });
  });
  return meshes;
}

/** Each clip: its name, duration and every track's name, times and values. */
const clipsOf = (animations) =>
  animations.map((clip) => ({
    name: clip.name,
    duration: clip.duration,
    tracks: clip.tracks.map((track) => ({
      name: track.name,
      times: Buffer.from(new Float64Array(track.times).buffer),
      values: Buffer.from(new Float64Array(track.values).buffer),
    })),
  }));

/** `actual` holds exactly the attributes and indices of `expected`, mesh by mesh. */
function assertSameGeometry(actual, expected, where) {
  assert.equal(actual.length, expected.length, `${where}: meshes`);
  actual.forEach((mesh, i) => {
    const original = expected[i];
    assert.deepEqual(Object.keys(mesh.attributes).sort(), Object.keys(original.attributes).sort());
    for (const [key, values] of Object.entries(mesh.attributes))
      assert.ok(values.equals(original.attributes[key]), `${where} mesh ${i}: ${key}`);
    assert.equal(!!mesh.index, !!original.index, `${where} mesh ${i}: indexed`);
    if (mesh.index) assert.ok(mesh.index.equals(original.index), `${where} mesh ${i}: index`);
  });
}

test("the CPU helpers decode a compressed GLB with three's bundled decoder to exactly the original", async (t) => {
  const { full } = await candidates(),
    compressedBytes = await exactModel(full, R04),
    originalBytes = await exactModel(ORIGINAL_WOMAN.full);
  assert.ok(lists(compressedBytes, 'extensionsRequired'), 'the candidate needs a decoder');
  assert.ok(!lists(originalBytes, 'extensionsUsed'), 'the original needs none');
  const decodes = t.mock.method(MeshoptDecoder, 'decodeGltfBufferAsync');
  const original = await loadMotion(originalBytes);
  assert.equal(decodes.mock.callCount(), 0);
  const compressed = await loadMotion(compressedBytes);
  assert.ok(decodes.mock.callCount() > 0, 'decoded by the module the game imports');
  // Geometry, skin and clips, value for value.
  const rig = rigOf(original.scene);
  assert.ok(
    rig.some((mesh) => mesh.bones),
    'a skinned rig',
  );
  assert.deepEqual(rigOf(compressed.scene), rig);
  assertSameGeometry(geometryOf(compressed.scene), geometryOf(original.scene), 'motion');
  assert.deepEqual(clipsOf(compressed.animations), clipsOf(original.animations));
  // The collision measurement reads the same surface.
  const [measuredOriginal, measuredCompressed] = await Promise.all([
    geometryScene(`public${ORIGINAL_WOMAN.full.url}`),
    geometryScene(`${R04}${full.url}`),
  ]);
  assertSameGeometry(
    geometryOf(measuredCompressed.scene),
    geometryOf(measuredOriginal.scene),
    'collision',
  );
});

test('the r04 startup body, the delivered primary after adoption, keeps the original rig and clips', async () => {
  const { startup } = await candidates(),
    bytes = await exactModel(startup, R04);
  assert.ok(lists(bytes, 'extensionsRequired'), 'it needs a decoder');
  const [body, original] = await Promise.all([
    loadMotion(bytes),
    loadMotion(await exactModel(ORIGINAL_WOMAN.full)),
  ]);
  assert.deepEqual(rigOf(body.scene), rigOf(original.scene));
  assert.deepEqual(clipsOf(body.animations), clipsOf(original.animations));
});
