import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import {
  configureActorPerformance,
  disposeActorPerformance,
  updateActorPerformance,
} from '../dist/src/performance-lod.js';
import { applyBehemothPalette } from '../dist/src/behemoth-palette.js';
import { deliveredActor, originalPair } from './original-actor-pairs.mjs';

// output/optimization-audit-20261009/lod-tangent-mismatch-audit.json: the close GLB of each of
// these enemies has TANGENT and a normal map where its reduced GLB has no TANGENT.
const AFFECTED = ['crow-shaman', 'violet-behemoth', 'sabertooth-tiger'];

// A delivered GLB (its verified bytes) parsed by the installed GLTFLoader with the meshopt
// decoder three bundles, except that texture images do not decode in Node: each glTF texture
// becomes a placeholder THREE.Texture (its image-format extensions are dropped so the loader's
// own texture plugins pass it on), so every material is still built and finalized (maps,
// normalScale, clearcoat, vertex colours) as in the browser.
async function parseDelivered(bytes) {
  const jsonLength = bytes.readUInt32LE(12),
    doc = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString());
  for (const texture of doc.textures ?? []) delete texture.extensions;
  const json = Buffer.from(JSON.stringify(doc)),
    chunk = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 32)]),
    binary = bytes.subarray(20 + jsonLength),
    glb = Buffer.alloc(20 + chunk.length + binary.length);
  glb.writeUInt32LE(0x46546c67, 0);
  glb.writeUInt32LE(2, 4);
  glb.writeUInt32LE(glb.length, 8);
  glb.writeUInt32LE(chunk.length, 12);
  glb.writeUInt32LE(0x4e4f534a, 16);
  chunk.copy(glb, 20);
  binary.copy(glb, 20 + chunk.length);
  await MeshoptDecoder.ready;
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  loader.register(() => ({
    name: 'node-texture-placeholder',
    loadTexture: () => Promise.resolve(new THREE.Texture()),
  }));
  return loader.parseAsync(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.length), '');
}

function disposals(resource) {
  let count = 0;
  resource.addEventListener('dispose', () => count++);
  return () => count;
}

/** The template as WorldAssets.loadEnemyTemplate prepares it: placed and, for the violet
 * behemoth, its materials recompiled with the palette. */
function prepareTemplate(key, gltf) {
  gltf.scene.updateMatrixWorld(true);
  if (key === 'violet-behemoth')
    gltf.scene.traverse((node) => {
      if (node.isMesh)
        for (const material of [node.material].flat()) applyBehemothPalette(material);
    });
}

/** Far away the reduced geometry of `lod` wears the close material finalized for it, as
 * GLTFLoader does; switching moves no bone; each enemy releases only its own variants. */
async function assertFinalizedFar(key, gltf, lod, levels) {
  prepareTemplate(key, gltf);
  const template = new Set(),
    shared = new Map();
  for (const scene of [gltf.scene, lod.scene])
    scene.traverse((node) => {
      if (!node.isMesh) return;
      for (const resource of [node.geometry, ...[node.material].flat()])
        if (!shared.has(resource)) shared.set(resource, disposals(resource));
      if (scene === gltf.scene)
        for (const material of [node.material].flat()) template.add(material);
    });
  // Two enemies of one template, cloned as WorldAssets.createAnimal clones them.
  const root = cloneSkeleton(gltf.scene),
    other = cloneSkeleton(gltf.scene);
  const detail = configureActorPerformance(root, lod.scene, levels),
    otherDetail = configureActorPerformance(other, lod.scene, levels);
  const mismatched = detail.meshes.filter(
    (entry) => entry.high.attributes.tangent && !entry.low.attributes.tangent,
  );
  assert.ok(mismatched.length, 'the audited TANGENT mismatch');
  const mixer = new THREE.AnimationMixer(root);
  mixer.clipAction(gltf.animations[0]).play();
  mixer.update(0.37);
  root.updateMatrixWorld(true);
  const bones = [];
  root.traverse((node) => {
    if (node.isBone) bones.push(node);
  });
  const pose = () => bones.map((bone) => bone.matrixWorld.clone()),
    objects = () => {
      let count = 0;
      root.traverse(() => count++);
      return count;
    };
  const posed = pose(),
    before = objects();
  assert.equal(updateActorPerformance(root, levels.lods[0].distanceMetres), 1);
  for (const entry of mismatched) {
    const close = entry.highMaterial;
    assert.ok(!Array.isArray(close) && close.normalMap, 'normal mapped');
    assert.ok(template.has(close), 'the adopted material is the shared template material');
    // The installed loader's own rule: its glTF material finalized for the reduced geometry.
    const { materials: index } = gltf.parser.associations.get(close),
      base = await gltf.parser.getDependency('material', index),
      probe = new THREE.Mesh(entry.low, base);
    gltf.parser.assignFinalMaterial(probe);
    const expected = probe.material,
      worn = entry.mesh.material;
    assert.equal(entry.mesh.geometry, entry.low);
    assert.equal(worn, entry.lowMaterial);
    assert.notEqual(worn, close);
    assert.deepEqual(worn.normalScale.toArray(), expected.normalScale.toArray());
    assert.equal(worn.normalScale.y, -close.normalScale.y, 'derivative tangents flip green');
    if (close.clearcoatNormalScale)
      assert.deepEqual(
        worn.clearcoatNormalScale.toArray(),
        expected.clearcoatNormalScale.toArray(),
      );
    assert.equal(worn.vertexColors, expected.vertexColors);
    assert.equal(worn.flatShading, expected.flatShading);
    for (const slot of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap'])
      assert.equal(worn[slot], close[slot], `${slot} is shared, not copied`);
    assert.equal(worn.color.getHex(), close.color.getHex());
    assert.equal(worn.onBeforeCompile, close.onBeforeCompile);
    assert.equal(worn.customProgramCacheKey(), close.customProgramCacheKey());
    if (key === 'violet-behemoth')
      assert.equal(worn.customProgramCacheKey(), 'violet-behemoth-palette-1');
  }
  // Switching moves no bone and adds no object, either way, while the mixer keeps animating.
  root.updateMatrixWorld(true);
  pose().forEach((matrix, i) => assert.ok(matrix.equals(posed[i]), bones[i].name));
  assert.equal(objects(), before);
  mixer.update(0.2);
  root.updateMatrixWorld(true);
  const moved = pose();
  assert.equal(updateActorPerformance(root, 1), 0);
  root.updateMatrixWorld(true);
  pose().forEach((matrix, i) => assert.ok(matrix.equals(moved[i]), bones[i].name));
  for (const entry of detail.meshes) {
    assert.equal(entry.mesh.material, entry.highMaterial);
    assert.equal(entry.mesh.geometry, entry.high);
  }
  // Each enemy owns its variants; releasing them leaves the shared template alive.
  const own = detail.variants;
  assert.ok(own.length > 0 && own.every((variant) => !otherDetail.variants.includes(variant)));
  const released = own.map(disposals);
  disposeActorPerformance(root);
  disposeActorPerformance(root);
  assert.deepEqual(
    released.map((count) => count()),
    own.map(() => 1),
  );
  disposeActorPerformance(other);
  mixer.stopAllAction();
  mixer.uncacheRoot(root);
  for (const [resource, disposed] of shared)
    assert.equal(disposed(), 0, `${resource.type} ${resource.name} stays with the template`);
}

/** A sole primary (its manifest lists no LOD): at every distance each mesh keeps exactly its
 * served geometry and template material, no variant is made, and the template stays alive. */
function assertStableFar(key, gltf, asset) {
  prepareTemplate(key, gltf);
  const shared = new Map();
  gltf.scene.traverse((node) => {
    if (!node.isMesh) return;
    for (const resource of [node.geometry, ...[node.material].flat()])
      if (!shared.has(resource)) shared.set(resource, disposals(resource));
  });
  const root = cloneSkeleton(gltf.scene),
    detail = configureActorPerformance(root, null, asset);
  const drawn = detail.meshes.map(({ mesh }) => ({
    mesh,
    geometry: mesh.geometry,
    material: mesh.material,
  }));
  assert.ok(drawn.length > 0);
  for (const entry of detail.meshes) {
    assert.equal(entry.low, entry.high, `${key}: no low file`);
    assert.equal(entry.lowMaterial, entry.highMaterial, `${key}: nothing to finalize again`);
  }
  assert.deepEqual(detail.variants, []);
  const mixer = new THREE.AnimationMixer(root);
  mixer.clipAction(gltf.animations[0]).play();
  // Near, the reviewed 26.794 m boss view, the old LOD distance, far and back.
  for (const distance of [1, 26.794, 28, 60, 400, 1]) {
    mixer.update(0.2);
    updateActorPerformance(root, distance);
    for (const { mesh, geometry, material } of drawn) {
      assert.equal(mesh.geometry, geometry, `${key} at ${distance} m: the served geometry`);
      assert.equal(mesh.material, material, `${key} at ${distance} m: the template material`);
    }
    root.updateMatrixWorld(true);
    root.traverse((node) => assert.ok(node.matrixWorld.elements.every(Number.isFinite)));
  }
  if (key === 'violet-behemoth')
    for (const { material } of drawn)
      for (const worn of [material].flat())
        assert.equal(worn.customProgramCacheKey(), 'violet-behemoth-palette-1');
  disposeActorPerformance(root);
  mixer.stopAllAction();
  mixer.uncacheRoot(root);
  for (const [resource, disposed] of shared)
    assert.equal(disposed(), 0, `${resource.type} ${resource.name} stays with the template`);
}

for (const key of AFFECTED) {
  // The original full model and far LOD, verified (original-actor-pairs.mjs): the real pair
  // whose tangent mismatch this regression proof covers.
  test(`${key}: far away the close material is finalized for the reduced geometry, as GLTFLoader does`, async () => {
    const { full, lod, levels } = await originalPair(key, parseDelivered);
    await assertFinalizedFar(key, full, lod, levels);
  });
  // What the game delivers now: a compressed pair keeps the same rule; a sole primary (the
  // violet behemoth after r04) keeps its served geometry and materials at every distance.
  test(`${key}: the served model wears exactly the levels and materials its manifest lists far away`, async (t) => {
    const delivery = await deliveredActor(key);
    if (delivery.original) {
      t.diagnostic(`${key} is delivered as its original pair, proven above`);
      return;
    }
    const { primary, lod } = await delivery.load(parseDelivered);
    if (lod) await assertFinalizedFar(key, primary, lod, delivery.asset);
    else assertStableFar(key, primary, delivery.asset);
  });
}
