// Runtime GLB loading: synthetic, test-only models (glb-fixtures.mjs) decoded by
// three r185's own GLTFLoader with the decoder three bundles. Only the browser's
// image decoding is a stand-in (decodeImages), reached through GLTFLoader's
// ImageBitmapLoader.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import {
  coalesceTextures,
  disposeModels,
  parseEmbeddedGLB,
  textureIdentity,
} from '../dist/src/embedded-glb.js';
import { WorldAssets, loadVerifiedGLB } from '../dist/src/world-assets.js';
import { CharacterAssets, loadCharacterTemplate } from '../dist/src/character-assets.js';
import { AssetLoadQueue } from '../dist/src/asset-load-queue.js';
import {
  BROKEN,
  PNG,
  WEBP,
  arrayBuffer,
  compressedModel,
  decodeImages,
  deferred,
  firstMesh,
  reachable,
  record,
  serve,
  settle,
  sha,
} from './glb-fixtures.mjs';

test('the runtime decoder is the one three 0.185.1 ships; the npm package is tooling only', async () => {
  const three = JSON.parse(await readFile('node_modules/three/package.json', 'utf8')),
    tooling = JSON.parse(await readFile('node_modules/meshoptimizer/package.json', 'utf8')),
    project = JSON.parse(await readFile('package.json', 'utf8')),
    decoder = await readFile(
      fileURLToPath(import.meta.resolve('three/addons/libs/meshopt_decoder.module.js')),
      'utf8',
    );
  assert.equal(three.version, '0.185.1');
  // Identity of the decoder the game loads (published by prepare-vendor; the MMO release
  // audit in environment-profiles.test.mjs fails if it is missing from vendor/).
  assert.match(decoder, /Built from meshoptimizer 1\.1\b/);
  assert.equal(project.devDependencies.meshoptimizer, '1.1.1');
  assert.equal(tooling.version, '1.1.1');
  assert.equal(project.dependencies.meshoptimizer, undefined, 'never a runtime dependency');
});

test('both runtime loaders decode meshopt with the bundled decoder and hash the image GLTFLoader selects', async (t) => {
  const bitmaps = decodeImages(t),
    decodes = t.mock.method(MeshoptDecoder, 'decodeGltfBufferAsync'),
    { glb, positions } = await compressedModel();
  serve(t, {
    '/scenery.glb': glb,
    '/models/test/asset.json': {
      modelKey: 'cro-magnon-woman',
      ...record('/high.glb', glb),
      lods: [record('/lod.glb', glb)],
    },
    '/high.glb': glb,
    '/lod.glb': glb,
  });
  const scenery = await loadVerifiedGLB(record('/scenery.glb', glb)),
    character = await loadCharacterTemplate('/models/test/asset.json');
  assert.equal(decodes.mock.callCount(), 6, 'both compressed views of all three models');
  for (const gltf of [scenery, character.gltf, character.lod]) {
    assert.equal(gltf.isRuntimeGLTF, true);
    assert.equal(gltf.parser, undefined, 'the parser is not kept');
    const mesh = firstMesh(gltf);
    assert.deepEqual(Array.from(mesh.geometry.attributes.position.array), Array.from(positions));
    assert.deepEqual([...mesh.geometry.index.array].sort(), [0, 1, 2]);
    // The identity is the encoded image GLTFLoader decoded: the WebP, not the PNG fallback.
    assert.equal(mesh.material.map.userData.embeddedSha256, sha(WEBP));
  }
  assert.equal(bitmaps.length, 3);
  assert.ok(bitmaps.every((bitmap) => bitmap.bytes.equals(WEBP)));
  // The character's full model and LOD are one cohort: the LOD takes the full model's
  // texture and its own copy of the image is closed at once.
  const full = firstMesh(character.gltf).material,
    lod = firstMesh(character.lod).material;
  assert.equal(lod.map, full.map);
  assert.deepEqual(
    bitmaps.map((bitmap) => bitmap.closed),
    [0, 0, 1],
  );
  disposeModels([scenery]);
  disposeModels([character.gltf, character.lod]);
  assert.deepEqual(
    bitmaps.map((bitmap) => bitmap.closed),
    [1, 1, 1],
    'every decoded image is closed exactly once',
  );
});

/** The raw GLTFLoader results parseEmbeddedGLB() receives, parser included. */
function loaderResults(t) {
  const results = [],
    parseAsync = GLTFLoader.prototype.parseAsync;
  t.mock.method(GLTFLoader.prototype, 'parseAsync', async function (...args) {
    const gltf = await parseAsync.apply(this, args);
    results.push(gltf);
    return gltf;
  });
  return results;
}

test('a parsed model keeps its scenes, clips and metadata, not the parser, GLB body or input bytes', async (t) => {
  const bitmaps = decodeImages(t),
    raws = loaderResults(t),
    { glb, positions, rig } = await compressedModel({ rig: true }),
    input = arrayBuffer(glb),
    model = await parseEmbeddedGLB(input, 'rig');
  const [raw] = raws,
    fields = ['animations', 'asset', 'cameras', 'scene', 'scenes', 'userData'];
  assert.deepEqual(Object.keys(model).sort(), [...fields, 'isRuntimeGLTF'].sort());
  assert.equal(model.isRuntimeGLTF, true);
  // GLTFLoader's own objects, not copies.
  for (const field of fields) assert.equal(model[field], raw[field], field);
  assert.equal(model.scenes.length, 2);
  assert.equal(model.scenes[0], model.scene);
  assert.deepEqual(model.userData, { review: 'rig' });
  assert.equal(model.asset.generator, 'embedded-glb test');
  // Geometry, skin and clip hold exactly the bytes of the file.
  const body = model.scene.getObjectByName('Body'),
    second = model.scenes[1].getObjectByName('Second'),
    attributes = body.geometry.attributes,
    [track] = model.animations[0].tracks;
  assert.ok(body.isSkinnedMesh);
  assert.deepEqual(Array.from(attributes.position.array), Array.from(positions));
  assert.deepEqual(Array.from(attributes.skinIndex.array), Array.from(rig.joints));
  assert.deepEqual(Array.from(attributes.skinWeight.array), Array.from(rig.weights));
  assert.deepEqual(Array.from(second.geometry.attributes.position.array), Array.from(rig.second));
  assert.equal(model.animations[0].name, 'Idle_Loop');
  assert.equal(track.name, 'Bone.position');
  assert.deepEqual(Array.from(track.times), Array.from(rig.times));
  assert.deepEqual(Array.from(track.values), Array.from(rig.moves));
  // Identities were recorded while the parser still existed.
  assert.equal(body.material.map.userData.embeddedSha256, sha(WEBP));
  assert.equal(second.material.map.userData.embeddedSha256, sha(PNG));
  // Nothing only the parse used stays reachable from what the game keeps.
  const { parser } = raw,
    parseOnly = [parser, parser.json, parser.cache, parser.extensions.KHR_binary_glTF.body, input];
  assert.ok(parseOnly.every(Boolean) && parseOnly[3] instanceof ArrayBuffer);
  assert.deepEqual([...reachable(model, parseOnly)], []);
  assert.deepEqual(
    bitmaps.map((bitmap) => bitmap.closed),
    [0, 0],
    'its images stay open while it is kept',
  );
  disposeModels([model]);
  assert.deepEqual(
    bitmaps.map((bitmap) => bitmap.closed),
    [1, 1],
    'both scenes are released',
  );
});

test('runtime models play, clone, coalesce and release every scene once', async (t) => {
  const bitmaps = decodeImages(t),
    { glb } = await compressedModel({ rig: true }),
    full = await parseEmbeddedGLB(arrayBuffer(glb), 'full'),
    lod = await parseEmbeddedGLB(arrayBuffer(glb), 'lod');
  const second = (model) => model.scenes[1].getObjectByName('Second').material;
  assert.equal(coalesceTextures([full, lod]), 2, "the LOD takes both of the full model's textures");
  assert.equal(second(lod).map, second(full).map, 'its second scene included');
  assert.deepEqual(
    bitmaps.map((bitmap) => bitmap.closed),
    [0, 0, 1, 1],
  );
  // An actor plays the template's clip on its own skeleton copy.
  const actor = cloneSkeleton(full.scene),
    mixer = new THREE.AnimationMixer(actor);
  mixer.clipAction(full.animations[0]).play();
  mixer.update(0.5);
  assert.deepEqual(actor.getObjectByName('Bone').position.toArray(), [0, 0.25, 0]);
  assert.equal(full.scene.getObjectByName('Bone').position.y, 0, 'the template stays at rest');
  assert.equal(actor.getObjectByName('Body').skeleton.bones[0], actor.getObjectByName('Bone'));
  const copy = full.scenes[1].clone(true);
  assert.equal(copy.getObjectByName('Second').geometry, full.scenes[1].getObjectByName('Second').geometry);
  mixer.stopAllAction();
  mixer.uncacheRoot(actor);
  disposeModels([full, lod]);
  assert.deepEqual(
    bitmaps.map((bitmap) => bitmap.closed),
    [1, 1, 1, 1],
    'every image is closed exactly once',
  );
});

test('a compressed model never loads without a working meshopt decoder or from a corrupt stream', async (t) => {
  const bitmaps = decodeImages(t),
    { glb } = await compressedModel(),
    supported = MeshoptDecoder.supported;
  t.after(() => (MeshoptDecoder.supported = supported));
  MeshoptDecoder.supported = false;
  await assert.rejects(
    parseEmbeddedGLB(arrayBuffer(glb), 'probe'),
    /probe: its meshopt compression cannot be decoded without WebAssembly/,
  );
  assert.equal(bitmaps.length, 0, 'it fails before any image is decoded');
  MeshoptDecoder.supported = supported;
  // three r185 itself reads no fallback data for the required extension without a decoder.
  await assert.rejects(
    new GLTFLoader().parseAsync(arrayBuffer(glb), ''),
    /setMeshoptDecoder must be called before loading compressed files/,
  );
  const corrupt = await compressedModel({ corrupt: true });
  await assert.rejects(parseEmbeddedGLB(arrayBuffer(corrupt.glb), 'probe'), /Malformed buffer data/);
});

test('image identity fails clearly for storage it cannot vouch for, before any request or decode', async (t) => {
  const bitmaps = decodeImages(t),
    requests = serve(t, {});
  const probe = async (change) =>
    parseEmbeddedGLB(arrayBuffer((await compressedModel({ change })).glb), 'probe');
  await assert.rejects(
    probe((json) => (json.bufferViews[3].byteLength += 64)),
    /probe: image 1 range \d+\+\d+ is outside the binary chunk/,
  );
  // Compressed geometry is never hashed as an image.
  await assert.rejects(
    probe((json) => (json.images[1].bufferView = 0)),
    /probe: image 1 is stored in a compressed buffer view/,
  );
  await assert.rejects(
    probe((json) => Object.assign(json.bufferViews[3], { buffer: 1, byteOffset: 0, byteLength: 6 })),
    /probe: image 1 is not stored in the GLB binary chunk/,
  );
  await assert.rejects(
    probe((json) => (json.images[1] = { uri: 'https://cdn.example/albedo.webp' })),
    /probe: image 1: GLB must embed its resources/,
  );
  await assert.rejects(
    probe((json) => (json.textures[0].extensions.EXT_texture_webp.source = 5)),
    /probe: texture 0 EXT_texture_webp source is not an image/,
  );
  await assert.rejects(
    probe((json) => {
      json.textures[0].extensions = { KHR_texture_basisu: { source: 0 } };
      json.extensionsRequired.push('KHR_texture_basisu');
    }),
    /probe: texture 0 requires KTX2 textures/,
  );
  await assert.rejects(
    probe((json) => (json.buffers[0].byteLength += 64)),
    /probe: buffer 0 is longer than the GLB binary chunk/,
  );
  assert.deepEqual(requests, [], 'nothing was requested');
  assert.equal(bitmaps.length, 0, 'nothing was decoded');
});

test('an embedded image the browser cannot decode fails the model and closes what did decode', async (t) => {
  t.mock.method(console, 'error', () => {});
  const bitmaps = decodeImages(t, { fails: (bytes) => bytes.equals(BROKEN) });
  const { glb } = await compressedModel({
    images: [PNG, WEBP, BROKEN],
    change(json) {
      // A second textured triangle whose only image does not decode.
      json.textures.push({ sampler: 0, source: 2 });
      json.materials.push({ pbrMetallicRoughness: { baseColorTexture: { index: 1 } } });
      json.meshes.push({ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 1 }] });
      json.nodes.push({ mesh: 1 });
      json.scenes[0].nodes.push(1);
    },
  });
  await assert.rejects(
    parseEmbeddedGLB(arrayBuffer(glb), 'probe'),
    /probe: 1 embedded image\(s\) could not be decoded/,
  );
  assert.equal(bitmaps.length, 1);
  assert.equal(bitmaps[0].closed, 1, 'the image that did decode is released with its model');
});

// GLTFLoader requests a model's textures before its geometry is decoded, so when a
// corrupt meshopt stream rejects the parse, images may have decoded or still be decoding.
test('a geometry stream failing after its image decoded releases that image once', async (t) => {
  const bitmaps = decodeImages(t),
    decode = MeshoptDecoder.decodeGltfBufferAsync,
    { glb } = await compressedModel({ corrupt: true });
  let decodedFirst = false;
  t.mock.method(MeshoptDecoder, 'decodeGltfBufferAsync', async function (...args) {
    for (let wait = 0; wait < 100 && !bitmaps.length; wait++) await settle();
    decodedFirst = bitmaps.length === 1;
    return decode.apply(this, args);
  });
  await assert.rejects(parseEmbeddedGLB(arrayBuffer(glb), 'probe'), /Malformed buffer data/);
  assert.ok(decodedFirst, 'the image had decoded before the geometry failed');
  assert.equal(bitmaps.length, 1);
  assert.equal(bitmaps[0].closed, 1);
});

test('an image still decoding when the parse fails is waited for, then released once', async (t) => {
  const gate = deferred(),
    bitmaps = decodeImages(t, { hold: () => gate.promise }),
    parseAsync = GLTFLoader.prototype.parseAsync,
    { glb } = await compressedModel({ corrupt: true });
  let parseFailed = false,
    finished = false;
  t.mock.method(GLTFLoader.prototype, 'parseAsync', function (...args) {
    const parsing = parseAsync.apply(this, args);
    parsing.catch(() => (parseFailed = true));
    return parsing;
  });
  const loading = parseEmbeddedGLB(arrayBuffer(glb), 'probe');
  loading.catch(() => {}).finally(() => (finished = true));
  for (let wait = 0; wait < 100 && !parseFailed; wait++) await settle();
  assert.ok(parseFailed, 'GLTFLoader rejected the corrupt geometry while the image was held');
  await settle();
  assert.equal(finished, false, 'the failure waits for the image still decoding');
  assert.equal(bitmaps.length, 0);
  gate.resolve();
  await assert.rejects(loading, /Malformed buffer data/);
  assert.equal(bitmaps.length, 1);
  assert.equal(bitmaps[0].closed, 1, 'the late image is closed once it decodes');
});

test('a failed parse releases an image two textures share once, and each texture and material once', async (t) => {
  const bitmaps = decodeImages(t),
    disposed = new Map();
  const count = function () {
    disposed.set(this, (disposed.get(this) ?? 0) + 1);
  };
  t.mock.method(THREE.Texture.prototype, 'dispose', count);
  t.mock.method(THREE.Material.prototype, 'dispose', count);
  const { glb } = await compressedModel({
    corrupt: true,
    change(json) {
      // A second sampler of the same WebP image: GLTFLoader makes a second texture
      // that shares the first one's decoded image.
      json.samplers.push({ wrapS: 33071 });
      json.textures.push({ sampler: 1, source: 0, extensions: { EXT_texture_webp: { source: 1 } } });
      json.materials[0].emissiveTexture = { index: 1 };
    },
  });
  await assert.rejects(parseEmbeddedGLB(arrayBuffer(glb), 'probe'), /Malformed buffer data/);
  assert.equal(bitmaps.length, 1, 'one decode serves both samplers');
  assert.equal(bitmaps[0].closed, 1);
  const textures = [...disposed.keys()].filter((object) => object.isTexture),
    materials = [...disposed.keys()].filter((object) => object.isMaterial);
  assert.equal(textures.length, 2);
  assert.equal(textures[0].source, textures[1].source);
  assert.notEqual(textures[0].wrapS, textures[1].wrapS);
  assert.equal(materials.length, 1);
  assert.deepEqual([...disposed.values()], [1, 1, 1], 'each is disposed exactly once');
});

test('after a failed parse the retried load keeps its images and coalesces as before', async (t) => {
  const bitmaps = decodeImages(t),
    good = await compressedModel(),
    corrupt = await compressedModel({ corrupt: true }),
    manifest = (high) => ({
      modelKey: 'cro-magnon-woman',
      ...record('/high.glb', high),
      lods: [record('/lod.glb', good.glb)],
    }),
    files = {
      '/models/test/asset.json': manifest(corrupt.glb),
      '/high.glb': corrupt.glb,
      '/lod.glb': good.glb,
    },
    queue = new AssetLoadQueue(),
    people = new CharacterAssets('/models/test/asset.json', { queue });
  serve(t, files);
  await assert.rejects(people.load(), /Malformed buffer data/);
  await settle();
  assert.equal(people.template, null);
  assert.equal(queue.active, 0);
  assert.deepEqual(
    bitmaps.map((bitmap) => bitmap.closed),
    [1],
    'nothing the failed parse decoded stays open',
  );
  Object.assign(files, { '/models/test/asset.json': manifest(good.glb), '/high.glb': good.glb });
  const template = await people.load(),
    map = firstMesh(template.gltf).material.map;
  for (const model of [template.gltf, template.lod]) {
    assert.equal(model.isRuntimeGLTF, true);
    assert.equal(model.parser, undefined);
  }
  assert.equal(firstMesh(template.lod).material.map, map);
  assert.equal(map.image, bitmaps[1]);
  assert.deepEqual(
    bitmaps.map((bitmap) => bitmap.closed),
    [1, 0, 1],
    'the retried model keeps its image; only the LOD duplicate is closed',
  );
  people.dispose();
  assert.deepEqual(
    bitmaps.map((bitmap) => bitmap.closed),
    [1, 1, 1],
  );
});

// Coalescing with real three.js objects.
const stand = (name) => ({
  name,
  closed: 0,
  close() {
    this.closed++;
  },
});
function embedded(hash, image, change = () => {}) {
  const texture = new THREE.Texture(image);
  texture.userData.embeddedSha256 = hash;
  change(texture);
  return texture;
}
function model(...materials) {
  const scene = new THREE.Group();
  for (const material of materials) scene.add(new THREE.Mesh(new THREE.BufferGeometry(), material));
  return { scene };
}
function countDisposals(...textures) {
  const counts = new Map();
  for (const texture of textures) {
    counts.set(texture, 0);
    texture.addEventListener('dispose', () => counts.set(texture, counts.get(texture) + 1));
  }
  return counts;
}

test('equal encoded images share a texture only when every pixel-affecting state agrees', () => {
  const srgb = (texture) => (texture.colorSpace = THREE.SRGBColorSpace);
  const map = embedded('albedo', stand('full albedo'), srgb),
    normal = embedded('normal', stand('full normal')),
    full = new THREE.MeshStandardMaterial({ map, normalMap: normal });
  // GLTFLoader's derivative-tangent copy of a material flips normalScale.y.
  full.normalScale.set(1, -1);
  const lodMap = embedded('albedo', stand('lod albedo'), srgb),
    lodNormal = embedded('normal', stand('lod normal')),
    lod = new THREE.MeshStandardMaterial({ map: lodMap, normalMap: lodNormal });
  const variants = {
    centre: embedded('albedo', stand('centre'), (texture) => {
      srgb(texture);
      texture.center.set(0.5, 0.5);
    }),
    matrix: embedded('albedo', stand('matrix'), (texture) => {
      srgb(texture);
      texture.matrixAutoUpdate = false;
      texture.matrix.setUvTransform(0.25, 0, 1, 1, 0, 0, 0);
    }),
    colorSpace: embedded('albedo', stand('linear')),
    wrap: embedded('albedo', stand('repeat'), (texture) => {
      srgb(texture);
      texture.wrapS = THREE.RepeatWrapping;
    }),
  };
  const distinct = Object.values(variants).map((texture) => new THREE.MeshStandardMaterial({ map: texture }));
  const disposals = countDisposals(lodMap, lodNormal, ...Object.values(variants));
  for (const texture of Object.values(variants))
    assert.notEqual(textureIdentity(texture), textureIdentity(map));
  assert.equal(textureIdentity(lodMap), textureIdentity(map));
  assert.equal(coalesceTextures([model(full), model(lod, ...distinct)]), 2);
  assert.equal(lod.map, map);
  assert.equal(lod.normalMap, normal);
  assert.equal(full.normalScale.y, -1, 'materials keep their own normal handling');
  assert.equal(lod.normalScale.y, 1);
  distinct.forEach((material, index) => assert.equal(material.map, Object.values(variants)[index]));
  assert.deepEqual(
    [...disposals.values()],
    [1, 1, 0, 0, 0, 0],
    'only the two retired textures are disposed',
  );
  assert.equal(lodMap.image.closed, 1);
  assert.equal(lodNormal.image.closed, 1);
  assert.equal(map.image.closed + normal.image.closed, 0);
});

test('a retired texture keeps an image another texture still uses; final disposal releases each once', () => {
  const fullImage = stand('full'),
    sharedImage = stand('shared');
  const map = embedded('albedo', fullImage),
    lodMap = embedded('albedo', sharedImage);
  // GLTFLoader gives one decoded image to every sampler of it: a clone shares the source.
  const emissive = lodMap.clone();
  emissive.wrapS = THREE.MirroredRepeatWrapping;
  const full = model(new THREE.MeshStandardMaterial({ map })),
    lod = model(new THREE.MeshStandardMaterial({ map: lodMap, emissiveMap: emissive }));
  const disposals = countDisposals(map, lodMap, emissive);
  assert.equal(coalesceTextures([full, lod]), 1);
  assert.equal(disposals.get(lodMap), 1);
  assert.equal(sharedImage.closed, 0, 'the emissive texture still shows this image');
  disposeModels([full, lod]);
  assert.deepEqual([...disposals.values()], [1, 1, 1]);
  assert.equal(fullImage.closed, 1);
  assert.equal(sharedImage.closed, 1);
});

test('coalescing again, or with a model added later, keeps what earlier models and their variants use', () => {
  const image = stand('full'),
    map = embedded('albedo', image),
    material = new THREE.MeshStandardMaterial({ map });
  const full = model(material),
    lod = model(new THREE.MeshStandardMaterial({ map: embedded('albedo', stand('lod')) }));
  assert.equal(coalesceTextures([full, lod]), 1);
  const disposals = countDisposals(map);
  assert.equal(coalesceTextures([full, lod]), 0, 'a coalesced cohort is left as it is');
  // A surface variant clones the material and keeps its texture (biome-surfaces.ts).
  const variant = material.clone();
  const laterImage = stand('later'),
    later = model(new THREE.MeshStandardMaterial({ map: embedded('albedo', laterImage) }));
  assert.equal(coalesceTextures([full, lod, later]), 1, 'the newly listed model joins');
  assert.equal(later.scene.children[0].material.map, map);
  assert.equal(variant.map, map);
  assert.equal(disposals.get(map), 0);
  assert.equal(image.closed, 0, 'the variant still draws the kept image');
  assert.equal(laterImage.closed, 1);
  disposeModels([full, lod, later]);
  assert.equal(disposals.get(map), 1);
  assert.equal(image.closed, 1);
});

test('a failed or cancelled character load releases its parsed model; the queue loads it again', async (t) => {
  const bitmaps = decodeImages(t),
    { glb } = await compressedModel(),
    manifest = { modelKey: 'cro-magnon-woman', ...record('/high.glb', glb), lods: [record('/lod.glb', glb)] },
    files = { '/models/test/asset.json': manifest, '/high.glb': glb },
    requests = serve(t, files),
    queue = new AssetLoadQueue();
  const people = new CharacterAssets('/models/test/asset.json', { queue });
  await assert.rejects(people.load(), /\/lod\.glb: HTTP 404/);
  await settle();
  assert.equal(people.template, null);
  assert.equal(people.pending, null);
  assert.equal(queue.active, 0);
  assert.deepEqual(
    bitmaps.map((bitmap) => bitmap.closed),
    [1],
    'the full model parsed before the LOD failed is released',
  );
  // A failed load is not remembered: the next request downloads both models again.
  files['/lod.glb'] = glb;
  const template = await people.load();
  assert.equal(firstMesh(template.lod).material.map, firstMesh(template.gltf).material.map);
  assert.equal(requests.filter((path) => path === '/high.glb').length, 2);
  people.dispose();
  assert.deepEqual(
    bitmaps.map((bitmap) => bitmap.closed),
    [1, 1, 1],
  );
  // Disposed while its LOD downloads, a provider discards the late template whole.
  const gate = deferred(),
    before = bitmaps.length,
    lodRequests = () => requests.filter((path) => path === '/lod.glb').length,
    seen = lodRequests();
  files['/lod.glb'] = async () => {
    await gate.promise;
    return new Response(glb);
  };
  const late = new CharacterAssets('/models/test/asset.json', { queue }),
    loading = late.load();
  while (lodRequests() === seen) await settle();
  late.dispose();
  gate.resolve();
  assert.equal(await loading, null);
  await settle();
  assert.equal(queue.active, 0);
  assert.deepEqual(
    bitmaps.slice(before).map((bitmap) => bitmap.closed),
    [1, 1],
    'its full model and LOD are each released once',
  );
});

test('a world template whose LOD fails releases its parsed model and is not kept', async (t) => {
  const bitmaps = decodeImages(t),
    { glb } = await compressedModel();
  serve(t, { '/boulder.glb': glb });
  const assets = new WorldAssets();
  assets.catalog = {
    assets: [
      {
        modelKey: 'boulder',
        environment: true,
        onDemand: true,
        ...record('/boulder.glb', glb),
        lods: [record('/boulder-lod.glb', glb)],
      },
    ],
  };
  await assert.rejects(assets.ensureEnvironment('boulder'), /\/boulder-lod\.glb: HTTP 404/);
  await settle();
  assert.equal(assets.templates.has('boulder'), false);
  assert.equal(assets.loadQueue.active, 0);
  assert.deepEqual(
    bitmaps.map((bitmap) => bitmap.closed),
    [1],
  );
  assets.dispose();
});
