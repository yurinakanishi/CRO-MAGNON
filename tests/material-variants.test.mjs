import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  drawSidesInTurn,
  drawnInTwoPasses,
  instancedMaterial,
  materialCopy,
} from '../dist/src/material-variants.js';

/** A WebGL 2 context for Three r185's own WebGLRenderer that draws nothing but records each
 * draw call with the program and the faces it keeps: Three culls back faces and draws a
 * BackSide material by turning the front face clockwise (WebGLState.setMaterial). Programs
 * link with no active uniforms or attributes. */
function recordingContext() {
  const values = new Map(),
    names = new Map();
  const constant = (name) => {
    if (!values.has(name)) {
      values.set(name, 0x10000 + values.size * 64);
      names.set(values.get(name), name);
    }
    return values.get(name);
  };
  const state = { program: null, culling: false, front: null, draws: [] };
  const draw = (kind) => () =>
    state.draws.push({
      kind,
      program: state.program,
      front: state.culling ? names.get(state.front) : 'both',
    });
  const gl = {
    isContextLost: () => false,
    getError: () => 0,
    getExtension: () => null,
    getSupportedExtensions: () => [],
    getContextAttributes: () => ({ alpha: false, depth: true, stencil: false, antialias: false }),
    getShaderPrecisionFormat: () => ({ precision: 23, rangeMin: 127, rangeMax: 127 }),
    getParameter(pname) {
      const name = names.get(pname) ?? '';
      if (name === 'VERSION') return 'WebGL 2.0';
      if (name === 'VIEWPORT' || name === 'SCISSOR_BOX') return [0, 0, 4, 4];
      if (name.endsWith('_SIZE')) return 4096;
      return name.startsWith('MAX_') ? 16 : 0;
    },
    getProgramParameter: (program, pname) => (names.get(pname)?.startsWith('ACTIVE_') ? 0 : true),
    getShaderParameter: () => true,
    getProgramInfoLog: () => '',
    getShaderInfoLog: () => '',
    useProgram(program) {
      state.program = program;
    },
    enable(cap) {
      if (names.get(cap) === 'CULL_FACE') state.culling = true;
    },
    disable(cap) {
      if (names.get(cap) === 'CULL_FACE') state.culling = false;
    },
    frontFace(mode) {
      state.front = mode;
    },
    drawArrays: draw('arrays'),
    drawElements: draw('elements'),
    drawArraysInstanced: draw('arrays-instanced'),
    drawElementsInstanced: draw('elements-instanced'),
  };
  for (const kind of ['Buffer', 'Framebuffer', 'Program', 'Renderbuffer', 'Shader', 'Texture'])
    gl[`create${kind}`] = () => ({ kind });
  gl.createVertexArray = () => ({ kind: 'VertexArray' });
  const context = new Proxy(gl, {
    get: (target, key) =>
      key in target
        ? target[key]
        : typeof key === 'string' && /^[A-Z][A-Z0-9_]*$/.test(key)
          ? constant(key)
          : () => {},
  });
  const canvas = Object.assign(new EventTarget(), {
    width: 4,
    height: 4,
    style: {},
    setAttribute() {},
    getContext: () => context,
  });
  return { canvas, state };
}

/** A renderer, and how often each material had its program looked up again
 * (WebGLPrograms.getParameters asks every lookup for customProgramCacheKey). */
function counting() {
  const { canvas, state } = recordingContext(),
    renderer = new THREE.WebGLRenderer({ canvas }),
    lookups = new Map();
  const count = (material) => {
    const key = material.customProgramCacheKey;
    material.customProgramCacheKey = function () {
      lookups.set(this, (lookups.get(this) ?? 0) + 1);
      return key.call(this);
    };
    return material;
  };
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  camera.position.set(0, 2, 8);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  /** Lookups and draws of frames after the first two, which prepare every program. */
  const frames = (scene, n = 3) => {
    for (let i = 0; i < 2; i++) renderer.render(scene, camera);
    lookups.clear();
    state.draws.length = 0;
    const draws = [];
    for (let i = 0; i < n; i++) {
      state.draws.length = 0;
      renderer.render(scene, camera);
      draws.push(state.draws.map((d) => ({ ...d, program: programKey(d.program) })));
    }
    return { lookups: [...lookups.values()].reduce((a, b) => a + b, 0), draws };
  };
  const programKey = (handle) =>
    renderer.info.programs.find((program) => program.program === handle)?.cacheKey ?? null;
  return { renderer, count, frames, camera };
}

const surface = () =>
  new THREE.MeshStandardMaterial({ color: '#7a8a6b', map: new THREE.Texture(), roughness: 0.8 });
const water = (opacity = 0.88) =>
  new THREE.MeshStandardMaterial({
    color: '#92babb',
    transparent: true,
    opacity,
    side: THREE.DoubleSide,
  });

test('a material copy draws as its source: values, textures, hooks, userData and defines', () => {
  const source = surface();
  const time = { value: 0 };
  source.userData.time = time;
  source.defines = { ...source.defines, SOURCE_WIND: '' };
  source.onBeforeCompile = (shader) => {
    shader.uniforms.windTime = source.userData.time;
  };
  source.customProgramCacheKey = () => 'source-wind-1';
  const copy = materialCopy(source);
  assert.notEqual(copy, source);
  assert.equal(copy.map, source.map, 'textures by reference');
  assert.deepEqual(copy.color.toArray(), source.color.toArray());
  assert.equal(copy.roughness, source.roughness);
  assert.equal(copy.onBeforeCompile, source.onBeforeCompile);
  assert.equal(copy.customProgramCacheKey(), 'source-wind-1');
  assert.equal(copy.userData, source.userData, 'hooks keep reading the same userData');
  assert.deepEqual(copy.defines, source.defines);
  assert.notEqual(copy.defines, source.defines);
  const shader = { uniforms: {} };
  copy.onBeforeCompile(shader);
  assert.equal(shader.uniforms.windTime, time);
});

test('instanced draws share one copy per source material, released with the source', () => {
  const source = surface(),
    other = surface();
  const copy = instancedMaterial(source);
  assert.notEqual(copy, source);
  assert.equal(instancedMaterial(source), copy, 'every instanced user shares it');
  assert.equal(copy.map, source.map);
  assert.deepEqual(instancedMaterial([source, other]), [copy, instancedMaterial(other)]);
  let sourceDisposals = 0,
    copyDisposals = 0;
  source.addEventListener('dispose', () => sourceDisposals++);
  copy.addEventListener('dispose', () => copyDisposals++);
  copy.dispose();
  assert.equal(sourceDisposals, 0, 'a copy never releases its source');
  source.dispose();
  assert.equal(copyDisposals, 2, 'the source releases its copy');
  const again = instancedMaterial(source);
  assert.notEqual(again, copy, 'a released copy is not handed out again');
  source.dispose();
  assert.equal(sourceDisposals, 2);
});

test("a two-pass water mesh draws its sides in turn with a shared pair, Three's two passes", () => {
  const source = water();
  source.onBeforeCompile = () => {};
  source.customProgramCacheKey = () => 'water-1';
  assert.equal(drawnInTwoPasses(source), true);
  const a = new THREE.Mesh(new THREE.PlaneGeometry(2, 2, 2, 2), source),
    b = new THREE.Mesh(new THREE.PlaneGeometry(2, 2, 2, 2), source);
  const [back, front] = drawSidesInTurn(a);
  assert.deepEqual(a.material, [back, front]);
  assert.equal(b.material, source);
  assert.deepEqual(drawSidesInTurn(b), [back, front], 'one pair per material');
  assert.equal(back.side, THREE.BackSide);
  assert.equal(front.side, THREE.FrontSide);
  for (const side of [back, front]) {
    assert.equal(side.transparent, true);
    assert.equal(side.opacity, source.opacity);
    assert.equal(side.customProgramCacheKey(), 'water-1');
    assert.equal(side.onBeforeCompile, source.onBeforeCompile);
    assert.equal(drawnInTwoPasses(side), false);
  }
  const count = a.geometry.index.count;
  assert.deepEqual(a.geometry.groups, [
    { start: 0, count, materialIndex: 0 },
    { start: 0, count, materialIndex: 1 },
  ]);
  // A geometry shared by meshes split the same way keeps its two groups.
  const shared = new THREE.Mesh(a.geometry, water());
  drawSidesInTurn(shared);
  assert.equal(shared.geometry.groups.length, 2);
  assert.throws(() => drawSidesInTurn(a), /two transparent passes/, 'already split');
  assert.throws(() => drawSidesInTurn(new THREE.Mesh(a.geometry.clone(), surface())), /two/);
  const grouped = new THREE.PlaneGeometry();
  grouped.addGroup(0, 3, 0);
  assert.throws(() => drawSidesInTurn(new THREE.Mesh(grouped, water())), /other groups/);
  let released = 0;
  for (const side of [back, front]) side.addEventListener('dispose', () => released++);
  source.dispose();
  assert.equal(released, 2);
});

test('a material drawn instanced and plain is looked up every frame; its instanced copy is not', () => {
  const { count, frames } = counting();
  const scene = (instanced) => {
    const geometry = new THREE.BoxGeometry(),
      shared = count(surface()),
      group = new THREE.Scene();
    const batch = new THREE.InstancedMesh(geometry, instanced(shared), 3);
    for (let i = 0; i < 3; i++)
      batch.setMatrixAt(i, new THREE.Matrix4().makeTranslation(i * 2 - 2, 0, -3));
    group.add(batch, new THREE.Mesh(geometry, shared));
    return group;
  };
  const before = frames(scene((material) => material));
  assert.equal(before.lookups, 2 * 3, 'two program changes on each frame');
  // The copy takes over the counting hook with the others.
  const after = frames(scene((material) => instancedMaterial(material)));
  assert.equal(after.lookups, 0);
  assert.deepEqual(
    after.draws.at(-1).map((d) => d.kind),
    before.draws.at(-1).map((d) => d.kind),
  );
});

test("split water draws Three's back and front passes with the same programs, in order", () => {
  const { count, frames } = counting();
  const keyed = (material, key) => {
    material.customProgramCacheKey = () => key;
    return count(material);
  };
  const scene = (split) => {
    const group = new THREE.Scene(),
      tiles = keyed(water(), 'tiles');
    group.add(new THREE.Mesh(new THREE.BoxGeometry(6, 0.5, 6), count(surface())));
    for (const [x, z] of [
      [-2, 0],
      [2, -3],
      [0, 2],
    ]) {
      const tile = new THREE.Mesh(new THREE.PlaneGeometry(2, 2, 3, 3), tiles);
      tile.rotation.x = -Math.PI / 2.2;
      tile.position.set(x, 0.4, z);
      group.add(tile);
    }
    const sheet = new THREE.Mesh(new THREE.PlaneGeometry(3, 3), keyed(water(0.82), 'pool'));
    sheet.position.set(1, 0.6, 1);
    group.add(sheet);
    group.updateMatrixWorld();
    if (split) group.traverse((node) => node.isMesh && node.material.transparent && split(node));
    return group;
  };
  const before = frames(scene(null)),
    after = frames(scene((node) => drawSidesInTurn(node)));
  assert.equal(before.lookups, 3 * (2 * 4), "Three's two passes, twice per mesh and frame");
  assert.equal(after.lookups, 0);
  // The ground, then each water mesh from the farthest: its back faces, then its front faces.
  for (const [i, draws] of after.draws.entries()) {
    assert.deepEqual(draws, before.draws[i], `frame ${i}: programs, faces and order`);
    assert.deepEqual(
      draws.map((d) => d.front),
      ['CCW', 'CW', 'CCW', 'CW', 'CCW', 'CW', 'CCW', 'CW', 'CCW'],
    );
    assert.equal(new Set(draws.map((d) => d.program)).size, 5, 'ground, tiles×2, pool×2');
  }
});
