// Cave mural UVs: CAVE_MOTIFS rectangles are pixels of each image's original size.
// A served image may be a resized copy whose manifest record keeps that original
// size as `uvSource`; every normalised rectangle must stay the same.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import {
  CAVE_EXTRA_PIGMENTS,
  CAVE_MOTIFS,
  CAVE_MURALS,
  caveMotifSource,
  caveMotifUV,
  caveMuralImages,
  caveMuralPigment,
  caveMuralShader,
  caveUvSource,
} from '../dist/src/cave-gallery-layout.js';
import { prepareCaveMaterials } from '../dist/src/cave-materials.js';

const f = (n) => n.toFixed(6);
const size = (width, height) => ({ width, height });
const motifs = Object.keys(CAVE_MOTIFS).filter((motif) => motif !== 'comingSoon');

/** A camp-cave manifest whose mural images are the originals the rectangles were
 * measured in (the sizes recorded today). */
function originalManifest() {
  const record = (name, image) => ({
    url: `/models/camp-cave/${name}.png`,
    sha256: createHash('sha256').update(name).digest('hex'),
    bytes: 1000,
    image,
  });
  return {
    modelKey: 'camp-cave',
    pigment: record('mural-atlas', size(1254, 1254)),
    rockSurface: record('limestone', size(1254, 1254)),
    characterPigment: record('524-frieze', size(2171, 724)),
    rimoPigment: record('rimo-frieze', size(2172, 724)),
    mascotPigments: Object.fromEntries(
      Object.keys(CAVE_EXTRA_PIGMENTS).map((key) => [key, record(key, size(2172, 724))]),
    ),
  };
}

/** The same manifest after adopting whole-image resizes to a 1024 px edge (the r04
 * candidate sizes: 1024x1024 and 1024x341), each keeping its original as uvSource. */
function resizedManifest(manifest = originalManifest()) {
  const resize = (record) => {
    const scale = 1024 / Math.max(record.image.width, record.image.height);
    return {
      ...record,
      url: record.url.replace(/\.png$/, '.opt-0123456789abcdef.png'),
      image: size(Math.round(record.image.width * scale), Math.round(record.image.height * scale)),
      uvSource: record.image,
    };
  };
  return {
    ...manifest,
    pigment: resize(manifest.pigment),
    rockSurface: resize(manifest.rockSurface),
    characterPigment: resize(manifest.characterPigment),
    rimoPigment: resize(manifest.rimoPigment),
    mascotPigments: Object.fromEntries(
      Object.entries(manifest.mascotPigments).map(([key, record]) => [key, resize(record)]),
    ),
  };
}

/** The record a motif's pigment is sampled from. */
const recordOf = (images, motif) =>
  motif in CAVE_EXTRA_PIGMENTS
    ? images.extras[motif]
    : motif === 'creature524'
      ? images.characterPigment
      : motif === 'rimoFrieze'
        ? images.rimoPigment
        : images.pigment;

test('the served camp-cave manifests map every mural in its original pixel space', async () => {
  const asset = JSON.parse(await readFile('public/models/camp-cave/asset.json', 'utf8')),
    catalog = JSON.parse(await readFile('public/models/world-assets.json', 'utf8'));
  // The loading cave and the world both load the catalog's copy.
  for (const manifest of [asset, catalog.assets.find((entry) => entry.modelKey === 'camp-cave')]) {
    const murals = caveMuralImages(manifest);
    assert.equal(murals.pigment, manifest.pigment);
    assert.equal(murals.characterPigment, manifest.characterPigment);
    assert.equal(murals.rimoPigment, manifest.rimoPigment);
    for (const key of Object.keys(CAVE_EXTRA_PIGMENTS))
      assert.equal(murals.extras[key], manifest.mascotPigments[key], 'served as recorded');
    for (const motif of motifs)
      assert.deepEqual(caveUvSource(recordOf(murals, motif)), caveMotifSource(motif), motif);
    // Each served file is exactly the recorded image: hash, length and PNG size.
    const served = [murals.pigment, murals.characterPigment, murals.rimoPigment];
    for (const record of [...served, ...Object.values(murals.extras)]) {
      const bytes = await readFile(`public${record.url}`);
      assert.equal(createHash('sha256').update(bytes).digest('hex'), record.sha256, record.url);
      assert.equal(bytes.length, record.bytes, record.url);
      assert.deepEqual(size(bytes.readUInt32BE(16), bytes.readUInt32BE(20)), record.image, record.url);
    }
  }
});

test('a whole-image resize keeps every normalised rectangle', () => {
  const original = caveMuralImages(originalManifest()),
    resized = caveMuralImages(resizedManifest());
  for (const motif of motifs) {
    const before = recordOf(original, motif),
      after = recordOf(resized, motif);
    assert.notDeepEqual(after.image, before.image, `${motif} is served smaller`);
    assert.ok(after.image.width === 1024 || after.image.height === 1024);
    assert.deepEqual(caveUvSource(after), caveUvSource(before));
    assert.deepEqual(caveMotifUV(motif, caveUvSource(after)), caveMotifUV(motif, caveUvSource(before)));
    // What the mural shader is built with.
    assert.deepEqual(caveMotifUV(motif, caveUvSource(after)), caveMotifUV(motif));
    // Dividing the original pixel rectangle by the resized size would move the artwork.
    assert.notDeepEqual(caveMotifUV(motif, after.image), caveMotifUV(motif));
  }
  // The r04 candidate sizes.
  assert.deepEqual(resized.pigment.image, size(1024, 1024));
  assert.deepEqual(resized.characterPigment.image, size(1024, 341));
  assert.deepEqual(resized.rimoPigment.image, size(1024, 341));
  for (const record of Object.values(resized.extras)) assert.deepEqual(record.image, size(1024, 341));
  // Served URLs come from the manifest, not from the table naming the originals.
  for (const [key, pigment] of Object.entries(CAVE_EXTRA_PIGMENTS)) {
    assert.match(resized.extras[key].url, /\.opt-0123456789abcdef\.png$/);
    assert.notEqual(resized.extras[key].url, pigment.url);
  }
});

test('a record mapped through any other pixel space fails clearly', () => {
  const check = (change, pattern) => {
    const manifest = resizedManifest();
    change(manifest);
    assert.throws(() => caveMuralImages(manifest), pattern);
  };
  // A resized image without its original size would be normalised by 1024x341.
  check(
    (manifest) => delete manifest.mascotPigments.friendsRiver.uvSource,
    /camp-cave mascotPigments\.friendsRiver: .* maps CAVE_MOTIFS\.friendsRiver by 1024x341; its rectangle is measured in 2172x724 pixels/,
  );
  check(
    (manifest) => (manifest.pigment.uvSource = size(1300, 1300)),
    /camp-cave pigment: .* maps CAVE_MOTIFS\.bison by 1300x1300; its rectangle is measured in 1254x1254 pixels/,
  );
  // A crop, padding or upscale is not a whole-image resize.
  check(
    (manifest) => (manifest.rimoPigment.image = size(1024, 300)),
    /camp-cave rimoPigment: a 1024x300 image is not a whole-image resize of its 2172x724 uvSource/,
  );
  check(
    (manifest) => (manifest.characterPigment.image = size(4342, 1448)),
    /camp-cave characterPigment: a 4342x1448 image is not a whole-image resize/,
  );
  check(
    (manifest) => (manifest.characterPigment.uvSource = { width: 2171 }),
    /camp-cave characterPigment: uvSource needs a width and a height/,
  );
  check((manifest) => delete manifest.pigment.image, /camp-cave pigment: no image width and height/);
  check(
    (manifest) => delete manifest.mascotPigments.roundBots,
    /camp-cave mascotPigments\.roundBots: the manifest records no image/,
  );
  // Unresized records need no uvSource; a redundant equal one is accepted.
  const manifest = originalManifest();
  manifest.pigment.uvSource = size(1254, 1254);
  assert.doesNotThrow(() => caveMuralImages(manifest));
});

test('checking and mapping never change the rectangles or the manifest', () => {
  const rectangles = structuredClone(CAVE_MOTIFS),
    manifest = resizedManifest(),
    copy = structuredClone(manifest);
  const images = caveMuralImages(manifest);
  for (const motif of motifs) caveMotifUV(motif, caveUvSource(recordOf(images, motif)));
  prepare(manifest);
  assert.deepEqual(CAVE_MOTIFS, rectangles);
  assert.deepEqual(manifest, copy);
});

/** prepareCaveMaterials on one mesh, its textures shaped like the served images,
 * then the shader three would compile. */
function prepare(manifest) {
  const images = caveMuralImages(manifest),
    texture = (record) => new THREE.Texture({ width: record.image.width, height: record.image.height });
  const textures = {
    pigment: texture(images.pigment),
    limestone: texture(manifest.rockSurface),
    character524: texture(images.characterPigment),
    rimo: texture(images.rimoPigment),
    extras: {
      ...Object.fromEntries(Object.entries(images.extras).map(([key, record]) => [key, texture(record)])),
      comingSoon: new THREE.Texture({ width: 2048, height: 512 }),
    },
  };
  const root = new THREE.Group(),
    material = new THREE.MeshStandardMaterial();
  root.add(new THREE.Mesh(new THREE.BufferGeometry(), material));
  prepareCaveMaterials(
    root,
    textures.pigment,
    textures.limestone,
    textures.character524,
    textures.rimo,
    textures.extras,
  );
  const shader = {
    uniforms: {},
    vertexShader: '#include <begin_vertex>',
    fragmentShader:
      '#include <map_fragment>\n#include <lights_fragment_begin>\n#include <lights_fragment_end>',
  };
  material.onBeforeCompile(shader, {});
  root.children[0].geometry.dispose();
  material.dispose();
  return { images, textures, shader };
}

test('the custom shader samples each served image at its original-space rectangle', () => {
  const resized = prepare(resizedManifest()),
    original = prepare(originalManifest());
  const { uniforms, fragmentShader } = resized.shader;
  assert.equal(uniforms.cavePigment.value, resized.textures.pigment);
  assert.equal(uniforms.caveLimestone.value, resized.textures.limestone);
  assert.equal(uniforms.caveCharacter524.value, resized.textures.character524);
  assert.equal(uniforms.caveRimoPigment.value, resized.textures.rimo);
  for (const [key, value] of Object.entries(resized.textures.extras))
    assert.equal(uniforms[`cave_${key}`].value, value);
  // The program does not depend on the served size: same source, same program cache key.
  assert.equal(fragmentShader, original.shader.fragmentShader);
  assert.ok(fragmentShader.includes(caveMuralShader));
  const blocks = [
    ...fragmentShader.matchAll(
      /vec2 atlasUV=vec2\(([^,]+),([^)]+)\)\+clamp\(muralUV,\.001,\.999\)\*vec2\(([^,]+),([^)]+)\);\s*vec4 paint=texture2D\((\w+),atlasUV\);/g,
    ),
  ];
  assert.equal(blocks.length, CAVE_MURALS.length);
  CAVE_MURALS.forEach((mural, index) => {
    const pigment = caveMuralPigment(mural),
      record = pigment === 'comingSoon' ? null : recordOf(resized.images, mural.motif),
      uv = caveMotifUV(mural.motif, record ? caveUvSource(record) : caveMotifSource(mural.motif));
    const sampler =
      pigment === 'atlas'
        ? 'cavePigment'
        : pigment === 'character524'
          ? 'caveCharacter524'
          : pigment === 'rimoFrieze'
            ? 'caveRimoPigment'
            : `cave_${mural.motif}`;
    assert.deepEqual(
      blocks[index].slice(1),
      [f(uv.offset[0]), f(uv.offset[1]), f(uv.scale[0]), f(uv.scale[1]), sampler],
      `${mural.motif} on the ${mural.wall} wall`,
    );
    // Never the served (resized) size.
    if (record) assert.notDeepEqual(caveMotifUV(mural.motif, record.image), uv);
  });
  // Full-image friezes span exactly their image; atlas motifs keep their own windows.
  const rimo = blocks[CAVE_MURALS.findIndex((mural) => mural.motif === 'rimoFrieze')];
  assert.deepEqual(rimo.slice(1, 5), ['0.000000', '0.000000', '1.000000', '1.000000']);
});
