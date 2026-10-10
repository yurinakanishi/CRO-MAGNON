// A model record has two identities. The original is the GLB that collision and footprint
// data were measured from, kept unchanged at its original public URL. The served file is
// what the game downloads. Before runtime adoption they are one file. After adoption the
// record serves a verified, hash-addressed meshopt derivative, the stamp
// `runtimeOptimization.original` records the original (scripts/optimization/adoption.mjs
// adoptModel), and the adoption's record keeps the manifest it replaced. A measured hash is
// proven against the original; the served file must decode to the original's geometry.
// An exact repack (scripts/optimization/exact-repack.mjs) may serve a template's levels as the
// scenes of one content-addressed `model-levels.opt-<sha16>.glb`: the primary is scene 0 and
// LOD i scene i, every level naming the same file. Such a record is accepted only when adopted:
// its adoption must be applied and its records exactly that adoption's packed entry, as the
// build graph checks them (scripts/runtime-graph.mjs).
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { runtimeTextureRecords } from '../scripts/environment-assets.mjs';
import { geometryScene } from '../scripts/measure-collision-bounds.mjs';
import { activeAdoption, checkRuntimeGraph } from '../scripts/runtime-graph.mjs';

const RUNTIME_FIELD = 'runtimeOptimization';
const DERIVED = /\.opt-[a-f0-9]{16}\.glb$/;

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const plain = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const isFile = (file, key) =>
  plain(file) &&
  typeof file.url === 'string' &&
  new RegExp(`^/models/${key}/[^/]+\\.glb$`).test(file.url) &&
  typeof file.sha256 === 'string' &&
  /^[a-f0-9]{64}$/.test(file.sha256) &&
  Number.isSafeInteger(file.bytes) &&
  file.bytes > 0;
const fileOf = (record) => ({ url: record.url, sha256: record.sha256, bytes: record.bytes });
const publicFile = (url) => `public${url}`;
const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));

/** The file's bytes, once its exact length and SHA-256 match `file`. */
async function readExact(path, file) {
  const bytes = await readFile(path);
  assert.equal(bytes.length, file.bytes, `${path}: length`);
  assert.equal(sha256(bytes), file.sha256, `${path}: SHA-256`);
  return bytes;
}

/** A packed template's levels (primary first): at least two, level i naming scene i (an
 * integer), every level naming exactly the served file. */
function assertPackedLevels(levels, served, key) {
  assert.ok(levels.length >= 2, `${key}: a packed template has at least two levels`);
  levels.forEach((record, index) => {
    assert.ok(plain(record), `${key}: level ${index} is not a record`);
    assert.ok(
      Number.isInteger(record.scene) && record.scene === index,
      `${key}: level ${index} names scene ${JSON.stringify(record.scene)}, not ${index}`,
    );
    assert.deepEqual(fileOf(record), served, `${key}: level ${index} is not the packed file`);
  });
}

/** The original and served files of `asset`, the record of model `key`. Without the
 * adoption field they are one file. An adoption field must be a complete stamp, and a
 * hash-addressed URL without one is an error; neither is read as the original. Any `scene`
 * (on the record or a LOD) makes it a packed template, which must be adopted and named
 * `model-levels.opt-<sha16>.glb` by its served SHA-256. */
export function modelIdentities(asset, key) {
  assert.ok(isFile(asset, key), `${key}: not a served model record`);
  const served = fileOf(asset),
    levels = [asset, ...(Array.isArray(asset.lods) ? asset.lods : [])],
    packed = levels.some((record) => plain(record) && Object.hasOwn(record, 'scene'));
  if (!Object.hasOwn(asset, RUNTIME_FIELD)) {
    assert.ok(!packed, `${key}: a packed scene without an adoption stamp`);
    assert.doesNotMatch(served.url, DERIVED, `${key}: a derivative URL without an adoption stamp`);
    return { adopted: false, packed: false, original: served, served, stamp: null };
  }
  const stamp = asset[RUNTIME_FIELD];
  assert.ok(plain(stamp), `${key}: the adoption stamp is not an object`);
  for (const field of ['adoption', 'candidateRevision', 'selection'])
    assert.ok(typeof stamp[field] === 'string' && stamp[field] !== '', `${key}: no ${field}`);
  assert.ok(isFile(stamp.original, key), `${key}: no complete original file identity`);
  const original = fileOf(stamp.original);
  assert.notEqual(served.sha256, original.sha256, `${key}: the adoption serves the original`);
  if (packed) assertPackedLevels(levels, served, key);
  const url = packed
    ? `/models/${key}/model-levels.opt-${served.sha256.slice(0, 16)}.glb`
    : original.url.replace(/\.glb$/, `.opt-${served.sha256.slice(0, 16)}.glb`);
  assert.equal(served.url, url, `${key}: the served URL is not hash-addressed`);
  return { adopted: true, packed, original, served, stamp };
}

/** A packed record checked by the build graph against `adoption` (activeAdoption): the adopted
 * packed entry exactly, scenes in order, one content-addressed model-levels file. */
export function assertPackedAdopted(asset, adoption) {
  assert.ok(adoption, `${asset?.modelKey}: a packed template outside any applied adoption`);
  checkRuntimeGraph([asset], adoption, { textureRecords: runtimeTextureRecords });
}

/** The packed GLB itself: one scene per level, with level 0 the default scene, which is the
 * scene assertSameGeometry decodes. */
function assertPackedFile(bytes, levels, where) {
  assert.ok(bytes.length >= 20 && bytes.readUInt32LE(16) === 0x4e4f534a, `${where}: no JSON chunk`);
  const length = bytes.readUInt32LE(12);
  assert.ok(20 + length <= bytes.length, `${where}: the JSON chunk exceeds the file`);
  const json = JSON.parse(bytes.toString('utf8', 20, 20 + length));
  assert.equal(json.scene ?? 0, 0, `${where}: the default scene is not level 0`);
  assert.equal(json.scenes?.length, levels, `${where}: scenes for ${levels} levels`);
}

/** The stamp's adoption record replaced exactly this original with this served file: its
 * saved pre-adoption manifest, the bytes its plan journals, names the original. A chained
 * adoption (`plan.base`, scripts/optimization/chained-adoption.mjs) saved its base's adopted
 * bytes instead. The chain is followed, hash by hash, to the adoption that saved the
 * pre-adoption manifest. Each entry names the revision that generated its files
 * (`candidateRevision`, else the graph's). */
async function assertRecorded(key, { original, served, stamp }) {
  assert.match(stamp.adoption, /^\d{8}-r\d+-a\d+$/, `${key}: not an adoption id`);
  const path = `public/models/${key}/asset.json`,
    top = `assets/runtime-adoption/${stamp.adoption}`,
    plan = await readJson(`${top}/plan.json`);
  assert.equal(plan.adoption, stamp.adoption, `${key}: ${top} is another adoption`);
  let record = top,
    saved = plan;
  for (;;) {
    const step = saved.operations.manifests.find((entry) => entry.path === path);
    assert.ok(step, `${key}: ${record} did not rewrite ${path}`);
    const before = JSON.parse(await readExact(`${record}/before/${path}`, step.before));
    if (!saved.base) {
      assert.ok(!Object.hasOwn(before, RUNTIME_FIELD), `${key}: the saved manifest is adopted`);
      assert.deepEqual(fileOf(before), original, `${key}: the stamp is not the replaced original`);
      break;
    }
    const base = `assets/runtime-adoption/${saved.base.adoption}`,
      bytes = await readFile(`${base}/plan.json`),
      basePlan = JSON.parse(bytes),
      adopted = basePlan.operations.manifests.find((entry) => entry.path === path)?.after;
    assert.equal(sha256(bytes), saved.base.planSha256, `${key}: ${base} is not ${record}'s base`);
    assert.deepEqual(
      [adopted?.sha256, adopted?.bytes],
      [step.before.sha256, step.before.bytes],
      `${key}: ${record} saved other bytes than ${base} adopted`,
    );
    record = base;
    saved = basePlan;
  }
  const model = plan.graph.models[key];
  assert.ok(plain(model), `${key}: ${top} adopted no such model`);
  assert.deepEqual(
    [stamp.candidateRevision, stamp.selection],
    [model.candidateRevision ?? plan.graph.candidateRevision, model.selection],
    `${key}: the stamp is not the recorded selection`,
  );
  assert.deepEqual(fileOf(model.primary), served, `${key}: the record serves another file`);
  assert.deepEqual(
    fileOf(model.primary.source),
    original,
    `${key}: the record adopted another source`,
  );
}

/** An attribute's components, de-interleaved, in its own component type. */
function components(attribute) {
  const { count, itemSize } = attribute;
  if (!attribute.isInterleavedBufferAttribute) return attribute.array;
  const { array, stride } = attribute.data,
    values = new array.constructor(count * itemSize);
  for (let i = 0; i < count; i++)
    for (let c = 0; c < itemSize; c++)
      values[i * itemSize + c] = array[i * stride + attribute.offset + c];
  return values;
}

/** The same component type and the same bits, component for component. */
function assertSameValues(served, original, where) {
  const type = (array) => [array.constructor.name, array.length];
  assert.deepEqual(type(served), type(original), `${where}: component type or count`);
  const bits = (array) => Buffer.from(array.buffer, array.byteOffset, array.byteLength);
  if (bits(served).equals(bits(original))) return;
  const i = original.findIndex((value, index) => !Object.is(value, served[index]));
  assert.fail(`${where}: component ${i} is ${served[i]}, not ${original[i]}`);
}

function assertSameAttribute(served, original, where) {
  const layout = (attribute) => [attribute.itemSize, attribute.count, attribute.normalized];
  assert.deepEqual(layout(served), layout(original), `${where}: layout`);
  assertSameValues(components(served), components(original), where);
}

function assertSameMesh(served, original, where) {
  const a = served.geometry,
    b = original.geometry,
    names = (attributes) => Object.keys(attributes).sort();
  assert.deepEqual(names(a.attributes), names(b.attributes), `${where}: attributes`);
  for (const name of names(b.attributes))
    assertSameAttribute(a.attributes[name], b.attributes[name], `${where} ${name}`);
  assert.deepEqual(names(a.morphAttributes), names(b.morphAttributes), `${where}: morphs`);
  for (const [name, targets] of Object.entries(b.morphAttributes)) {
    assert.equal(a.morphAttributes[name].length, targets.length, `${where}: ${name} targets`);
    targets.forEach((target, i) =>
      assertSameAttribute(a.morphAttributes[name][i], target, `${where} ${name}[${i}]`),
    );
  }
  assert.equal(a.morphTargetsRelative, b.morphTargetsRelative, `${where}: relative morphs`);
  assert.equal(a.index === null, b.index === null, `${where}: indexed`);
  if (b.index) assertSameAttribute(a.index, b.index, `${where} index`);
  assert.deepEqual([a.groups, a.drawRange], [b.groups, b.drawRange], `${where}: draw groups`);
  if (!original.isSkinnedMesh) return;
  const bones = (mesh) => mesh.skeleton.bones.map((bone) => bone.name),
    binds = (mesh) => [mesh.bindMatrix, ...mesh.skeleton.boneInverses].map((m) => m.elements);
  assert.deepEqual(bones(served), bones(original), `${where}: bones`);
  assert.deepEqual(binds(served), binds(original), `${where}: bind matrices`);
}

/** Every scene node in traversal order, with its world matrix current. */
function sceneNodes(gltf) {
  gltf.scene.updateMatrixWorld(true);
  const nodes = [];
  gltf.scene.traverse((node) => nodes.push(node));
  return nodes;
}

/** The served GLB decodes (three's GLTFLoader and bundled meshopt decoder) to the
 * original's scene: the same node hierarchy and world transforms, and for every mesh the
 * same attributes, indices, groups and skin, value for value; clips likewise. Materials
 * and images are not geometry and are not compared. Returns the number of meshes. */
export async function assertSameGeometry(originalPath, servedPath, where) {
  const [original, served] = await Promise.all([
    geometryScene(originalPath),
    geometryScene(servedPath),
  ]);
  const a = sceneNodes(served),
    b = sceneNodes(original);
  const outline = (nodes) => {
    const index = new Map(nodes.map((node, i) => [node, i]));
    return nodes.map((node) => [node.type, node.name, index.get(node.parent) ?? -1]);
  };
  assert.deepEqual(outline(a), outline(b), `${where}: scene graph`);
  let meshes = 0;
  for (const [i, node] of b.entries()) {
    const label = `${where} ${node.type} ${JSON.stringify(node.name)}`;
    assert.deepEqual(a[i].matrixWorld.elements, node.matrixWorld.elements, `${label}: transform`);
    if (!node.isMesh) continue;
    assertSameMesh(a[i], node, label);
    meshes++;
  }
  assert.ok(meshes > 0, `${where}: no mesh to compare`);
  const clips = (gltf) =>
    gltf.animations.map((clip) => [clip.name, clip.duration, clip.tracks.map((t) => t.name)]);
  assert.deepEqual(clips(served), clips(original), `${where}: clips`);
  original.animations.forEach((clip, i) =>
    clip.tracks.forEach((track, j) => {
      const other = served.animations[i].tracks[j],
        label = `${where} ${clip.name} ${track.name}`;
      assertSameValues(other.times, track.times, `${label} times`);
      assertSameValues(other.values, track.values, `${label} values`);
    }),
  );
  return meshes;
}

/** Proves model `key` twice: its original GLB, exactly as named by the record (and, once
 * adopted, by the adoption's saved manifest) at its original public URL, and separately
 * the GLB served now, which must decode to the original's geometry. Collision data is
 * checked against the returned `original`. */
export async function verifyModelSource(key, { asset, serve = publicFile } = {}) {
  asset ??= await readJson(`public/models/${key}/asset.json`);
  const identity = modelIdentities(asset, key),
    { adopted, packed, original, served } = identity;
  if (adopted) await assertRecorded(key, identity);
  if (packed) assertPackedAdopted(asset, await activeAdoption('.', [asset], runtimeTextureRecords));
  await readExact(publicFile(original.url), original);
  const path = serve(served.url),
    bytes = await readExact(path, served);
  assert.equal(bytes.toString('latin1', 0, 4), 'glTF', `${path}: not a GLB`);
  if (packed) assertPackedFile(bytes, asset.lods.length + 1, path);
  if (adopted) await assertSameGeometry(publicFile(original.url), path, key);
  return { adopted, original, served };
}
