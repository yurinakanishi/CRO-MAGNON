import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { CAVE_MURALS, caveMuralHeight, caveMuralShader } from '../dist/src/cave-gallery-layout.js';
import { prepareCaveMaterials } from '../dist/src/cave-materials.js';

test('Rimo frieze faces the unchanged 524 and preserves the other wall placements', async () => {
  const old = JSON.parse(await readFile('assets/camp-cave/qa/gallery-r29.json'));
  const rimo = CAVE_MURALS.find((m) => m.motif === 'rimoFrieze');
  const figure = CAVE_MURALS.find((m) => m.motif === 'creature524');
  assert.equal(rimo.wall, 'east');
  assert.equal(figure.wall, 'west');
  assert.equal(rimo.centre, figure.centre);
  assert.equal(caveMuralHeight(rimo), 2.5);
  const preserved = old.layout.filter(
    (m) => !(m.wall === 'east' && ['mammoth', 'bison'].includes(m.motif)),
  );
  assert.deepEqual(
    CAVE_MURALS.filter((m) => m.motif !== 'rimoFrieze'),
    preserved,
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
  const textures = Array.from({ length: 4 }, () => new THREE.Texture());
  prepareCaveMaterials(root, ...textures);
  const shader = {
    uniforms: {},
    vertexShader: '#include <begin_vertex>',
    fragmentShader:
      '#include <map_fragment>\n#include <lights_fragment_begin>\n#include <lights_fragment_end>',
  };
  material.onBeforeCompile(shader, {});
  assert.equal(shader.uniforms.caveRimoPigment.value, textures[3]);
  assert.ok(shader.fragmentShader.includes('texture2D(caveRimoPigment,atlasUV)'));
  assert.ok(shader.fragmentShader.includes('texture2D(caveCharacter524,atlasUV)'));
  assert.equal((caveMuralShader.match(/texture2D\(caveRimoPigment/g) || []).length, 1);
  assert.equal(root.children.length, 1, 'Pigment must not add a floating decal plane');
  root.children[0].geometry.dispose();
  material.dispose();
  textures.forEach((t) => t.dispose());
});
