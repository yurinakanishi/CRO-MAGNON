import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import {
  CAVE_MURALS,
  CAVE_EXTRA_PIGMENTS,
  caveMuralHeight,
  caveMuralShader,
} from '../dist/src/cave-gallery-layout.js';
import { prepareCaveMaterials } from '../dist/src/cave-materials.js';
import {
  RUNTIME_FIELD,
  imageIdentities,
  modelIdentities,
  r04AdoptedCave,
  verifyCaveModel,
  verifyRgbaImage,
} from './cave-runtime-identity.mjs';

/** The generated originals: these never change, whatever file the game serves. */
const ORIGINAL_CAVE_GLB = {
  url: '/models/camp-cave/model-r26.glb',
  sha256: '65dde1aa7311b88c159d524d93af82a770dac77e48ee1f35356e3000cad8a15f',
};
const FRIEZE_524 = { width: 2171, height: 724 };
const FRIEZE_RIMO = { width: 2172, height: 724 };

test('Rimo frieze still faces 524 while all released mascots join the animal gallery', async () => {
  const rimo = CAVE_MURALS.find((m) => m.motif === 'rimoFrieze');
  const figure = CAVE_MURALS.find((m) => m.motif === 'creature524');
  assert.equal(rimo.wall, 'east');
  assert.equal(figure.wall, 'west');
  assert.equal(rimo.centre, figure.centre);
  assert.equal(caveMuralHeight(rimo), 2.5);
  assert.equal(figure.width, rimo.width);
  assert.equal(figure.strength, rimo.strength);
  assert.ok(Math.abs(caveMuralHeight(figure) - caveMuralHeight(rimo)) < 0.01);
  const asset = JSON.parse(await readFile('public/models/camp-cave/asset.json'));
  const p = asset.characterPigment;
  assert.deepEqual(p.subjects, [
    '524',
    'woolly mammoth',
    'ochre wild horse',
    'red wild horse',
    'aurochs',
  ]);
  // The generated 2171x724 RGBA frieze stays as its source and at its original URL;
  // the served file (the same one until runtime adoption) is proven separately.
  await verifyRgbaImage(p, 'characterPigment', FRIEZE_524);
  assert.equal(
    new Set(['524', 'rimo-neko', ...Object.values(CAVE_EXTRA_PIGMENTS).flatMap((p) => p.subjects)])
      .size,
    22,
  );
});

test('the Rimo pigment and the cave model keep their originals, serve verified files, and both manifests agree', async () => {
  const asset = JSON.parse(await readFile('public/models/camp-cave/asset.json'));
  const world = JSON.parse(await readFile('public/models/world-assets.json'));
  assert.deepEqual(
    world.assets.find((a) => a.modelKey === 'camp-cave'),
    asset,
  );
  await verifyRgbaImage(asset.rimoPigment, 'rimoPigment', FRIEZE_RIMO);
  await verifyCaveModel(asset);
  const prior = JSON.parse(await readFile('assets/camp-cave/archive-geometry-r26-20261010.json'));
  const model = await verifyCaveModel(prior);
  assert.equal(model.original.url, ORIGINAL_CAVE_GLB.url);
  assert.equal(model.original.sha256, ORIGINAL_CAVE_GLB.sha256);
});

test('the r04 adoption of the cave model, 524 and Rimo friezes verifies on its candidate files', async () => {
  const asset = JSON.parse(await readFile('public/models/camp-cave/asset.json'));
  const { cave, images, serve } = await r04AdoptedCave(asset);
  assert.equal(Object.keys(images).length, 10, 'every standalone cave image has a candidate');
  const model = await verifyCaveModel(cave, { serve });
  assert.equal(model.adopted, true);
  assert.equal(model.original.sha256, ORIGINAL_CAVE_GLB.sha256);
  const friezes = [
    ['characterPigment', FRIEZE_524],
    ['rimoPigment', FRIEZE_RIMO],
  ];
  for (const [entry, size] of friezes) {
    const { adopted } = await verifyRgbaImage(images[entry], entry, size, { serve });
    assert.equal(adopted, true, entry);
  }
});

test('a malformed or partial adoption stamp is rejected, never read as the original', async () => {
  const asset = JSON.parse(await readFile('public/models/camp-cave/asset.json'));
  const { cave, images } = await r04AdoptedCave(asset);
  const rimo = images.rimoPigment,
    original = rimo.provenance[RUNTIME_FIELD].original;
  const image = (change) => {
    const record = structuredClone(rimo);
    change(record);
    return () => imageIdentities(record, 'rimoPigment');
  };
  const partial = /rimoPigment: uvSource or provenance without an adoption stamp/;
  assert.throws(
    image((r) => delete r.provenance),
    partial,
  );
  assert.throws(
    image((r) => (r.provenance = {})),
    partial,
  );
  assert.throws(
    image((r) => delete r.uvSource),
    /rimoPigment: an adopted image without uvSource/,
  );
  assert.throws(
    image((r) => delete r.provenance[RUNTIME_FIELD].original),
    /no original file identity/,
  );
  assert.throws(
    image((r) => delete r.provenance[RUNTIME_FIELD].original.image),
    /the stamp records no original image size/,
  );
  assert.throws(
    image((r) => delete r.provenance[RUNTIME_FIELD].candidateRevision),
    /no candidateRevision/,
  );
  assert.throws(
    image((r) => (r.uvSource = { ...r.image })),
    /rimoPigment: uvSource is not original/,
  );
  assert.throws(
    image((r) => Object.assign(r, { url: original.url, sha256: original.sha256 })),
    /rimoPigment: the adoption serves the original/,
  );
  assert.throws(
    image((r) => (r.url = r.url.replace('.opt-', '.min-'))),
    /rimoPigment: the served URL is not hash-addressed/,
  );
  // A record that names the candidate must be served those exact bytes.
  const servedOriginal = () => `public${original.url}`;
  await assert.rejects(
    verifyRgbaImage(rimo, 'rimoPigment', FRIEZE_RIMO, { serve: servedOriginal }),
    /length|SHA-256/,
  );
  const model = (change) => {
    const record = structuredClone(cave);
    change(record);
    return () => modelIdentities(record);
  };
  assert.throws(
    model((r) => (r[RUNTIME_FIELD] = null)),
    /camp-cave\.runtimeOptimization: the adoption stamp is not an object/,
  );
  assert.throws(
    model((r) => delete r[RUNTIME_FIELD].original.sha256),
    /camp-cave\.runtimeOptimization: no original file identity/,
  );
  assert.throws(
    model((r) => delete r[RUNTIME_FIELD].adoption),
    /no adoption/,
  );
  assert.throws(
    model((r) => Object.assign(r, r[RUNTIME_FIELD].original)),
    /camp-cave: the adoption serves the original/,
  );
  // Records with no adoption field are their own originals; the complete ones still pass.
  const unadopted = { ...original };
  assert.deepEqual(imageIdentities(unadopted, 'rimoPigment').original, original);
  assert.equal(modelIdentities({ ...cave[RUNTIME_FIELD].original }).adopted, false);
  assert.equal(imageIdentities(rimo, 'rimoPigment').adopted, true);
  assert.equal(modelIdentities(cave).adopted, true);
});

test('material uses the separate Rimo pigment on existing mesh triangles', () => {
  const root = new THREE.Group(),
    material = new THREE.MeshStandardMaterial();
  root.add(new THREE.Mesh(new THREE.BufferGeometry(), material));
  const textures = Array.from(
    { length: 5 + Object.keys(CAVE_EXTRA_PIGMENTS).length },
    () => new THREE.Texture(),
  );
  const extra = Object.fromEntries(
    [...Object.keys(CAVE_EXTRA_PIGMENTS), 'comingSoon'].map((key, i) => [key, textures[i + 4]]),
  );
  prepareCaveMaterials(root, ...textures.slice(0, 4), extra);
  const shader = {
    uniforms: {},
    vertexShader: '#include <begin_vertex>',
    fragmentShader:
      '#include <map_fragment>\n#include <lights_fragment_begin>\n#include <lights_fragment_end>',
  };
  material.onBeforeCompile(shader, {});
  assert.equal(shader.uniforms.caveRimoPigment.value, textures[3]);
  for (const key of Object.keys(extra))
    assert.equal(shader.uniforms[`cave_${key}`].value, extra[key]);
  assert.ok(shader.fragmentShader.includes('texture2D(caveRimoPigment,atlasUV)'));
  assert.ok(shader.fragmentShader.includes('texture2D(caveCharacter524,atlasUV)'));
  assert.equal((caveMuralShader.match(/texture2D\(caveRimoPigment/g) || []).length, 1);
  assert.equal(root.children.length, 1, 'Pigment must not add a floating decal plane');
  root.children[0].geometry.dispose();
  material.dispose();
  textures.forEach((t) => t.dispose());
});
