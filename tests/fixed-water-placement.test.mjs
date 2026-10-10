import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { geometryScene } from '../scripts/measure-collision-bounds.mjs';
import { WorldAssets } from '../dist/src/world-assets.js';
import { buildWaterAssets } from '../dist/src/world-scenery.js';

// The delivered river-water GLB (meshes only), as the world's verified template.
const manifest = JSON.parse(await readFile('public/models/river-water/asset.json', 'utf8'));
const source = await geometryScene(`public${manifest.url}`);
source.scene.updateMatrixWorld(true);
const assets = new WorldAssets();
assets.templates.set('river-water', { asset: manifest, gltf: source, lods: [] });

const nodes = (root) => {
  const list = [];
  root.traverse((node) => list.push(node));
  return list;
};
const fixedRoots = (world) => [world.water, world.mountainRiver, world.marsh.pools];

/** A world scene as WorldRenderer's constructor makes it (its root never recomposes), with
 * the water built, a moving actor and a moving camera. `reference`: every water node
 * recomposes on every frame, as before its placement was fixed. */
function world({ reference = false } = {}) {
  const scene = new THREE.Scene();
  scene.matrixAutoUpdate = false;
  const built = {
    scene,
    worldAssets: assets,
    renderer: { getPixelRatio: () => 1 },
    staticScenery: [],
    openWorld: { earthTextures: { coast: new THREE.DataTexture() } },
  };
  buildWaterAssets(built);
  if (reference)
    for (const root of fixedRoots(built))
      for (const node of nodes(root)) node.matrixAutoUpdate = true;
  built.actor = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.7, 0.4));
  body.position.y = 0.85;
  built.actor.add(body);
  scene.add(built.actor);
  built.camera = new THREE.PerspectiveCamera(57, 390 / 844, 0.15, 360);
  return built;
}

/** Matrix4.compose and multiplyMatrices calls made by `run`. */
function counted(run) {
  const counts = { compose: 0, multiply: 0 };
  const { compose, multiplyMatrices } = THREE.Matrix4.prototype;
  THREE.Matrix4.prototype.compose = function (...args) {
    counts.compose++;
    return compose.apply(this, args);
  };
  THREE.Matrix4.prototype.multiplyMatrices = function (...args) {
    counts.multiply++;
    return multiplyMatrices.apply(this, args);
  };
  try {
    run();
  } finally {
    THREE.Matrix4.prototype.compose = compose;
    THREE.Matrix4.prototype.multiplyMatrices = multiplyMatrices;
  }
  return counts;
}

/** One frame's transform work, as renderWorld and WebGLRenderer.render do it: the shader
 * time and the moving objects change, then the scene's world matrices are updated (the
 * renderer's scene update stays enabled), then the parentless camera's. */
function frame(world, i) {
  world.waterMaterial.userData.time.value = i / 30;
  world.actor.position.set(48 + i * 0.3, 1, 57 - i * 0.2);
  world.actor.rotation.y = i * 0.1;
  world.camera.position.set(40 + i, 12, 70 - i);
  world.camera.lookAt(48, 0, 57);
  assert.equal(world.scene.matrixWorldAutoUpdate, true);
  const counts = counted(() => world.scene.updateMatrixWorld());
  world.camera.updateMatrixWorld();
  return counts;
}

function assertSameMatrices(a, b) {
  const x = nodes(a.scene),
    y = nodes(b.scene);
  assert.equal(x.length, y.length);
  x.forEach((node, i) => {
    assert.equal(node.name, y[i].name);
    const label = `${node.name || node.type} #${i}`;
    assert.deepEqual(node.matrix.elements, y[i].matrix.elements, `${label} local`);
    assert.deepEqual(node.matrixWorld.elements, y[i].matrixWorld.elements, `${label} world`);
  });
}

/** View-space positions of the first vertices of every drawn water object, as its vertex
 * shader places them (modelViewMatrix × position). */
function viewSpace(world) {
  const out = [],
    vertex = new THREE.Vector3(),
    modelView = new THREE.Matrix4();
  for (const root of fixedRoots(world))
    root.traverse((node) => {
      if (!node.geometry) return;
      modelView.multiplyMatrices(world.camera.matrixWorldInverse, node.matrixWorld);
      const position = node.geometry.attributes.position;
      for (let i = 0; i < Math.min(position.count, 6); i++)
        out.push(...vertex.fromBufferAttribute(position, i).applyMatrix4(modelView).toArray());
    });
  return out;
}

const automatic = (scene) => nodes(scene).filter((node) => node !== scene && node.matrixAutoUpdate);
const fixedCount = (world) => fixedRoots(world).reduce((n, root) => n + nodes(root).length, 0);

/** The shader of `material` as Three would compile it: the uniforms its hook binds. */
function compiled(material) {
  const shader = {
    uniforms: {},
    vertexShader: '#include <begin_vertex>\n#include <project_vertex>',
    fragmentShader: '#include <color_fragment>\n#include <normal_fragment_begin>',
  };
  material.onBeforeCompile(shader);
  return shader.uniforms;
}

test('the fixed water renders exactly as before while only its own recompositions stop', () => {
  const fixed = world(),
    reference = world({ reference: true });
  // The scene census counted these same groups: 22, 54 and 13 unchanged automatic nodes.
  assert.deepEqual(
    fixedRoots(fixed).map((root) => [root.name, nodes(root).length]),
    [
      ['TRELLIS river tiles', 22],
      ['Mountain lake, waterfall and connected tributary', 54],
      ['behemoth marsh pools', 13],
    ],
  );
  const water = fixedCount(fixed);
  let actorWorld = null;
  for (let i = 0; i < 6; i++) {
    const a = frame(fixed, i),
      b = frame(reference, i);
    assertSameMatrices(fixed, reference);
    assert.deepEqual(viewSpace(fixed), viewSpace(reference), `frame ${i} view space`);
    // Only automatic nodes (the actor, the mist) recompose and multiply now; the reference
    // also recomposes and multiplies every water node.
    const moving = automatic(fixed.scene).length;
    assert.deepEqual(a, { compose: moving, multiply: moving }, `frame ${i}`);
    assert.deepEqual(b, { compose: moving + water, multiply: moving + water }, `frame ${i}`);
    // The moving actor still follows its position on every frame.
    const body = fixed.actor.children[0];
    assert.notDeepEqual(body.matrixWorld.elements, actorWorld);
    actorWorld = [...body.matrixWorld.elements];
    assert.ok(
      new THREE.Vector3()
        .setFromMatrixPosition(body.matrixWorld)
        .distanceTo(new THREE.Vector3(48 + i * 0.3, 1.85, 57 - i * 0.2)) < 1e-9,
    );
  }
  // Visibility, culling and bounds are as before; nothing joined distance culling.
  assert.equal(fixed.staticScenery.length, 0);
  const x = fixedRoots(fixed).flatMap(nodes),
    y = fixedRoots(reference).flatMap(nodes);
  x.forEach((node, i) => {
    assert.equal(node.visible, y[i].visible);
    assert.equal(node.frustumCulled, y[i].frustumCulled);
    assert.deepEqual(node.geometry?.boundingSphere, y[i].geometry?.boundingSphere);
    assert.equal(node.matrixWorldNeedsUpdate, false);
  });
  // The shared template, and every later copy of it, still recompose as before.
  assert.ok(nodes(source.scene).every((node) => node.matrixAutoUpdate));
  assert.ok(nodes(assets.create('river-water')).every((node) => node.matrixAutoUpdate));
});

test('shader time still reaches every fixed water material', () => {
  const fixed = world(),
    time = fixed.waterMaterial.userData.time;
  frame(fixed, 7);
  const material = (name) => {
    let found = null;
    fixed.scene.traverse((node) => (found ??= node.name === name ? node.material : null));
    return found;
  };
  const bound = [
    compiled(fixed.waterMaterial).flowTime,
    compiled(material('Source river water 0')).flowTime,
    compiled(material('Source water with calm lake ripples')).lakeTime,
    compiled(material('Waterfall splash droplets')).flowTime,
    compiled(fixed.marsh.pools.children[0].children[0].material).marshTime,
  ];
  for (const uniform of bound) assert.equal(uniform, time);
  frame(fixed, 8);
  assert.equal(bound[0].value, 8 / 30);
});

test('a moving child and an explicit parent update still propagate through the fixed water', () => {
  const fixed = world(),
    reference = world({ reference: true });
  const probes = [fixed, reference].map((built) => {
    const probe = new THREE.Mesh(new THREE.BoxGeometry());
    built.water.add(probe);
    return probe;
  });
  for (let i = 0; i < 3; i++) {
    for (const probe of probes) probe.position.set(i, 0.5, -i);
    frame(fixed, i);
    frame(reference, i);
    assertSameMatrices(fixed, reference);
    assert.deepEqual(
      probes[0].matrixWorld.elements,
      new THREE.Matrix4().multiplyMatrices(fixed.water.matrixWorld, probes[0].matrix).elements,
    );
    assert.equal(probes[0].matrixWorld.elements[12], i);
  }
  // The scene never moves in the game; if it were moved and updated explicitly, the fixed
  // water would follow exactly.
  const before = fixedRoots(fixed)
    .flatMap(nodes)
    .map((node) => [...node.matrixWorld.elements]);
  for (const built of [fixed, reference]) {
    built.scene.position.set(5, -2, 3);
    built.scene.rotation.y = 0.5;
    built.scene.updateMatrix();
  }
  frame(fixed, 3);
  frame(reference, 3);
  assertSameMatrices(fixed, reference);
  assert.deepEqual(viewSpace(fixed), viewSpace(reference));
  fixedRoots(fixed)
    .flatMap(nodes)
    .forEach((node, i) => {
      const expected = new THREE.Matrix4().multiplyMatrices(node.parent.matrixWorld, node.matrix);
      assert.deepEqual(node.matrixWorld.elements, expected.elements);
      assert.notDeepEqual(node.matrixWorld.elements, before[i]);
    });
  frame(fixed, 4);
  frame(reference, 4);
  assertSameMatrices(fixed, reference);
});

test('a world built again after disposal places its water exactly as before', () => {
  const first = world();
  frame(first, 0);
  frame(first, 1);
  const placed = fixedRoots(first)
    .flatMap(nodes)
    .map((node) => [node.name, [...node.matrixWorld.elements]]);
  // Shutdown, as WorldRenderer.destroy() releases its scene.
  first.scene.traverse((node) => {
    node.geometry?.dispose();
    for (const material of [node.material ?? []].flat()) material.dispose();
  });
  first.scene.clear();
  const again = world(),
    reference = world({ reference: true });
  for (let i = 0; i < 2; i++) {
    frame(again, i);
    frame(reference, i);
    assertSameMatrices(again, reference);
  }
  assert.deepEqual(
    fixedRoots(again)
      .flatMap(nodes)
      .map((node) => [node.name, [...node.matrixWorld.elements]]),
    placed,
  );
  assert.notEqual(again.waterMaterial.userData.time, first.waterMaterial.userData.time);
});
