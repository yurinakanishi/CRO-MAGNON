import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import {
  CAVE_MURALS,
  CAVE_EXTRA_PIGMENTS,
  caveMuralHeight,
  caveMuralShader,
} from '../dist/src/cave-gallery-layout.js';
import { prepareCaveMaterials } from '../dist/src/cave-materials.js';

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
  for (const file of [p.source, 'public' + p.url]) {
    const bytes = await readFile(file);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), p.sha256);
    assert.equal(bytes.readUInt32BE(16), 2171);
    assert.equal(bytes.readUInt32BE(20), 724);
    assert.equal(bytes[25], 6, '524 frieze must retain RGBA');
  }
  assert.equal(
    new Set(['524', 'rimo-neko', ...Object.values(CAVE_EXTRA_PIGMENTS).flatMap((p) => p.subjects)])
      .size,
    14,
  );
});

test('new pigment source, delivery and world manifest are the same image', async () => {
  const asset = JSON.parse(await readFile('public/models/camp-cave/asset.json'));
  const world = JSON.parse(await readFile('public/models/world-assets.json'));
  assert.deepEqual(
    world.assets.find((a) => a.modelKey === 'camp-cave'),
    asset,
  );
  const p = asset.rimoPigment;
  for (const file of [p.source, 'public' + p.url]) {
    const bytes = await readFile(file);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), p.sha256);
    assert.equal(bytes.readUInt32BE(16), 2172);
    assert.equal(bytes.readUInt32BE(20), 724);
    assert.equal(bytes[25], 6, 'PNG must retain RGBA');
  }
  assert.equal(asset.sha256, '65dde1aa7311b88c159d524d93af82a770dac77e48ee1f35356e3000cad8a15f');
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
