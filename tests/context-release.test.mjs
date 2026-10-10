import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import {
  GraphicsContextState,
  collectGpuResources,
  recordEngineResources,
  releaseLostContext,
} from '../dist/src/context-recovery.js';
import { WorldRenderer } from '../dist/src/world3d.js';
import { CharacterAssets } from '../dist/src/character-assets.js';
import { LandscapeInstances, WorldAssets } from '../dist/src/world-assets.js';
import { LoadingCave } from '../dist/src/loading-cave.js';
import { FrameClock } from '../dist/src/frame-clock.js';
import { CollisionWorld } from '../dist/shared/collision.mjs';
import { CAMP_CAVE } from '../dist/shared/camp-cave-layout.mjs';
import { deliveredWomanRig } from './cro-magnon-woman-rig.mjs';
import { caveGalleryImages, caveImageNetwork } from './camp-cave-fixture.mjs';
import { coalesceTextures, parseEmbeddedGLB } from '../dist/src/embedded-glb.js';
import { arrayBuffer, compressedModel, decodeImages } from './glb-fixtures.mjs';

/** Replace browser globals for one test; restored afterwards. */
function globalsFor(t, values) {
  for (const [key, value] of Object.entries(values)) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    t.after(() =>
      previous ? Object.defineProperty(globalThis, key, previous) : delete globalThis[key],
    );
  }
}

/** Three logs context events and unsupported extensions. */
function quiet(t) {
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'warn', () => {});
}

function element() {
  return {
    style: {},
    dataset: {},
    hidden: false,
    disabled: false,
    textContent: '',
    innerHTML: '',
    value: 0,
    classList: { add() {}, remove() {}, toggle() {} },
    append() {},
    remove() {},
    setAttribute() {},
    addEventListener() {},
    setPointerCapture() {},
    querySelector: () => element(),
    // The gallery's preview lettering draws into a 2D canvas.
    getContext: () => new Proxy({}, { get: () => () => {}, set: () => true }),
  };
}

/** A WebGL 2 context for Three r185's own WebGLRenderer. It draws nothing but
 * keeps object ownership as WebKit does: an object belongs to the context
 * generation that created it, a lost context ignores every call, and deleting an
 * object of an earlier generation is INVALID_OPERATION ("delete: object does not
 * belong to this context"), recorded in `stale`; valid deletes are counted in
 * `deletes`. Programs link with no active uniforms or attributes, so samplers
 * are uploaded by bindSamplers(). */
function webglCanvas() {
  const values = new Map(),
    names = new Map();
  const constant = (name) => {
    if (!values.has(name)) {
      // Spaced, so TEXTURE0 + unit and COLOR_ATTACHMENT0 + index stay distinct.
      values.set(name, 0x10000 + values.size * 64);
      names.set(values.get(name), name);
    }
    return values.get(name);
  };
  const state = { lost: false, generation: 0, stale: [], deletes: 0 };
  const gl = {
    isContextLost: () => state.lost,
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
  };
  const kinds = [
    'Buffer',
    'Framebuffer',
    'Program',
    'Renderbuffer',
    'Shader',
    'Texture',
    'VertexArray',
  ];
  for (const kind of kinds) {
    gl[`create${kind}`] = () => (state.lost ? null : { kind, generation: state.generation });
    gl[`delete${kind}`] = (object) => {
      if (state.lost || !object) return;
      if (object.generation === state.generation) state.deletes++;
      else state.stale.push(`delete${kind}`);
    };
  }
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
    dataset: {},
    parentElement: element(),
    setAttribute() {},
    getContext: () => context,
  });
  return {
    canvas,
    state,
    lose() {
      state.lost = true;
      canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    },
    restore() {
      state.lost = false;
      state.generation++;
      canvas.dispatchEvent(new Event('webglcontextrestored'));
    },
  };
}

/** Upload what the drawn programs sample, as their sampler bindings do (the same
 * setTexture2D path): every texture among the program uniform values Three keeps
 * for each material (its maps, textures given in onBeforeCompile and those the
 * renderer binds itself, such as the DFG lookup table) and each bone texture. */
function bindSamplers(renderer, roots) {
  const upload = (value) => {
    if (value?.isTexture && !value.isRenderTargetTexture) renderer.initTexture(value);
  };
  for (const root of roots)
    root.traverse((node) => {
      for (const material of [node.material ?? []].flat())
        if (renderer.properties.has(material))
          for (const { value } of Object.values(renderer.properties.get(material).uniforms ?? {}))
            [value].flat().forEach(upload);
      upload(node.skeleton?.boneTexture);
    });
}

/** Three's module-level DFG lookup table, as the renderer bound it for `material`. */
const dfgLUT = (renderer, material) =>
  recordEngineResources(renderer, [material], new Map()).get('dfg-lut');

/** One resource of each kind Three frees through a context's listeners. */
function resources() {
  const scene = new THREE.Scene(),
    camera = new THREE.PerspectiveCamera();
  const map = new THREE.DataTexture(new Uint8Array(16), 2, 2);
  map.needsUpdate = true;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial({ map }));
  const grass = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(),
    new THREE.MeshBasicMaterial(),
    2,
  );
  const geometry = new THREE.BoxGeometry(),
    vertices = geometry.attributes.position.count;
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(vertices * 4, 4));
  geometry.setAttribute(
    'skinWeight',
    new THREE.Float32BufferAttribute(new Float32Array(vertices * 4).fill(0.25), 4),
  );
  const bone = new THREE.Bone(),
    body = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial());
  body.add(bone);
  body.bind(new THREE.Skeleton([bone]));
  for (const object of [mesh, grass, body]) {
    object.frustumCulled = false;
    scene.add(object);
  }
  return { scene, camera, map, mesh, grass, body, target: new THREE.WebGLRenderTarget(4, 4) };
}

/** Draw as the game does: a far-view target, then the canvas. */
function draw(renderer, { scene, camera, target }) {
  renderer.setRenderTarget(target);
  renderer.render(scene, camera);
  renderer.setRenderTarget(null);
  renderer.render(scene, camera);
  bindSamplers(renderer, [scene]);
}

/** What eviction and shutdown do with each. */
function disposeAll({ map, mesh, grass, body, target }) {
  map.dispose();
  mesh.geometry.dispose();
  grass.dispose();
  grass.geometry.dispose();
  body.skeleton.dispose();
  body.geometry.dispose();
  target.dispose();
}

test('Three r185 deletes handles of a lost context when a resource is disposed after a restore', (t) => {
  quiet(t);
  const gl = webglCanvas(),
    renderer = new THREE.WebGLRenderer({ canvas: gl.canvas }),
    held = resources();
  draw(renderer, held);
  gl.lose();
  gl.restore();
  draw(renderer, held);
  disposeAll(held);
  // The WebKit trace's failure, for every kind of resource.
  for (const call of [
    'deleteTexture',
    'deleteBuffer',
    'deleteVertexArray',
    'deleteFramebuffer',
    'deleteRenderbuffer',
  ])
    assert.ok(gl.state.stale.includes(call), `${call} of the lost context`);
  // The engine's lookup table carries both contexts' listeners too; let them go.
  dfgLUT(renderer, held.mesh.material).dispose();
  renderer.dispose();
});

test('released while lost, later disposals delete only handles of the current context', (t) => {
  quiet(t);
  const gl = webglCanvas(),
    renderer = new THREE.WebGLRenderer({ canvas: gl.canvas }),
    held = resources(),
    engine = new Map(),
    reports = [];
  // Registered after the renderer's own listener, as WorldRenderer's is.
  gl.canvas.addEventListener('webglcontextlost', () =>
    reports.push(releaseLostContext(renderer, [held], engine)),
  );
  draw(renderer, held);
  assert.equal(releaseLostContext(renderer, [held]), null, 'a live context is never released');
  const sources = () => [
    held.map.image.data,
    held.mesh.geometry.attributes.position.array,
    held.grass.instanceMatrix.array,
    held.body.skeleton.boneTexture,
  ];
  const before = sources();
  for (let loss = 0; loss < 2; loss++) {
    gl.lose();
    gl.restore();
    draw(renderer, held);
  }
  assert.equal(reports.length, 2);
  for (const report of reports) {
    assert.deepEqual(report.unreleased, { geometries: 0, textures: 0 }, 'nothing left uncounted');
    assert.equal(report.targets, 1);
    assert.equal(report.instances, 1);
    assert.ok(report.textures >= 2 && report.geometries >= 3);
  }
  sources().forEach((value, index) =>
    assert.equal(value, before[index], 'the CPU sources stay for the restored uploads'),
  );
  assert.ok(renderer.info.memory.textures >= 3 && renderer.info.memory.geometries >= 3);
  disposeAll(held);
  // Shutdown also lets go of the engine's own resources (WorldRenderer.destroy()).
  for (const resource of engine.values()) resource.dispose();
  assert.deepEqual(gl.state.stale, []);
  assert.deepEqual(renderer.info.memory, { geometries: 0, textures: 0 });
  renderer.dispose();
});

test("Three's own DFG lookup table is released at every loss and at shutdown, never gathering listeners", (t) => {
  quiet(t);
  // Lit materials sample the table Three r185 binds itself (DFGLUTData.js).
  const cycles = (release) => {
    const gl = webglCanvas(),
      renderer = new THREE.WebGLRenderer({ canvas: gl.canvas }),
      scene = new THREE.Scene(),
      camera = new THREE.PerspectiveCamera(),
      mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()),
      held = { scene, mesh },
      engine = new Map(),
      reports = [];
    mesh.frustumCulled = false;
    scene.add(mesh);
    if (release)
      gl.canvas.addEventListener('webglcontextlost', () =>
        reports.push(releaseLostContext(renderer, [held], engine)),
      );
    const frame = () => {
      renderer.render(scene, camera);
      bindSamplers(renderer, [scene]);
    };
    frame();
    const lut = dfgLUT(renderer, mesh.material),
      data = lut.image.data;
    for (let loss = 0; loss < 3; loss++) {
      gl.lose();
      gl.restore();
      frame();
    }
    return { gl, renderer, mesh, engine, reports, lut, data };
  };
  // Unreleased, every lost context leaves its listener on the singleton.
  const kept = cycles(false);
  kept.lut.dispose();
  assert.deepEqual(kept.gl.state.stale, ['deleteTexture', 'deleteTexture', 'deleteTexture']);
  kept.renderer.dispose();
  const released = cycles(true);
  assert.equal(released.lut, kept.lut, 'one module-level table for every renderer');
  assert.equal(released.lut.name, 'DFG_LUT');
  assert.equal(released.engine.get('dfg-lut'), released.lut);
  assert.equal(released.reports.length, 3);
  for (const report of released.reports) {
    assert.deepEqual(report.engine, ['sprite-quad', 'dfg-lut']);
    assert.deepEqual(report.unreleased, { geometries: 0, textures: 0 });
  }
  assert.equal(released.lut.image.data, released.data, 'its data stays for the next upload');
  // Shutdown, as WorldRenderer.destroy() lets go of the engine's resources.
  released.mesh.geometry.dispose();
  for (const resource of released.engine.values()) resource.dispose();
  assert.deepEqual(released.gl.state.stale, []);
  assert.deepEqual(released.renderer.info.memory, { geometries: 0, textures: 0 });
  const deletes = released.gl.state.deletes;
  released.lut.dispose();
  assert.equal(released.gl.state.deletes, deletes, 'no listener of this renderer remains on it');
  released.renderer.dispose();
});

/** A model as parseEmbeddedGLB() returns it (RuntimeGLTF): scenes, clips and
 * metadata, no parser. */
const runtimeModel = (scene, animations = [], scenes = [scene]) => ({
  isRuntimeGLTF: true,
  scene,
  scenes,
  animations,
  cameras: [],
  asset: { version: '2.0' },
  userData: {},
});

test('the release reaches resources wherever their owners keep them', () => {
  const texture = () => new THREE.DataTexture(new Uint8Array(4), 1, 1);
  const uniform = texture(),
    compiled = texture(),
    parserOnly = texture(),
    held = texture(),
    detached = new THREE.BoxGeometry(),
    pooled = new THREE.BoxGeometry(),
    template = new THREE.BoxGeometry(),
    alternate = new THREE.BoxGeometry(),
    loaded = new THREE.BoxGeometry(),
    beside = new THREE.BoxGeometry();
  const scene = new THREE.Scene(),
    shaded = new THREE.Mesh(
      new THREE.BoxGeometry(),
      new THREE.ShaderMaterial({ uniforms: { map: { value: uniform } } }),
    );
  // A level kept beside its mesh while another is drawn.
  shaded.userData.lowDetail = new THREE.Mesh(detached);
  scene.add(shaded);
  const model = new THREE.Group().add(new THREE.Mesh(template)),
    other = new THREE.Group().add(new THREE.Mesh(alternate));
  const gltf = runtimeModel(model, [new THREE.AnimationClip('Idle_Loop', 1, [])], [model, other]);
  // A GLTFLoader result: its parser's caches repeat the scenes, and this texture was
  // retired before any draw.
  const raw = new THREE.Group().add(new THREE.Mesh(loaded));
  const loaderResult = {
    scene: raw,
    scenes: [raw],
    animations: [],
    parser: { associations: new Map([[parserOnly, {}]]), getDependency() {} },
  };
  const owner = {
    scene,
    templates: new Map([['key', { gltf, lods: [loaderResult] }]]),
    pool: new Set([new THREE.Points(pooled)]),
    // A shader receives these in onBeforeCompile; the owner keeps them in a field.
    earth: { textures: [compiled] },
    samples: new Float32Array(8),
    // Not a parsed model, though it has a scene and a parser: walked whole.
    chat: { scene: new THREE.Group(), parser: { associations: new Map([[held, {}]]) }, beside },
  };
  owner.self = owner;
  const found = collectGpuResources([owner]);
  for (const geometry of [detached, pooled, template, alternate, loaded, beside])
    assert.ok(found.geometries.has(geometry));
  for (const map of [uniform, compiled, held]) assert.ok(found.textures.has(map));
  assert.ok(!found.textures.has(parserOnly), 'a GLTF parser is not walked');
});

test('parsed models are found whole wherever templates, surface variants and providers keep them', async (t) => {
  const bitmaps = decodeImages(t),
    { glb } = await compressedModel({ rig: true }),
    parse = (label) => parseEmbeddedGLB(arrayBuffer(glb), label);
  const full = await parse('full'),
    lod = await parse('lod'),
    person = await parse('person'),
    personLod = await parse('person lod');
  /** Every geometry and map of every scene of `models`. */
  const parts = (...models) => {
    const geometries = new Set(),
      maps = new Set();
    for (const model of models)
      for (const scene of model.scenes)
        scene.traverse((node) => {
          if (node.geometry) geometries.add(node.geometry);
          if (node.material?.map) maps.add(node.material.map);
        });
    return { geometries, maps };
  };
  const retired = [...parts(lod, personLod).maps];
  assert.equal(coalesceTextures([full, lod]) + coalesceTextures([person, personLod]), 4);
  const assets = new WorldAssets();
  assets.catalog = { assets: [] };
  assets.templates.set('valley-boulder', {
    asset: { modelKey: 'valley-boulder', heightMetres: 1.7 },
    gltf: full,
    lods: [lod],
  });
  // A regional variant spreads the parsed model and replaces its scene (biome-surfaces.ts).
  const variant = assets.get('valley-boulder', 'snow'),
    copy = assets.create('valley-boulder', 0, 'snow');
  const people = new CharacterAssets('/models/cro-magnon-woman/asset.json', {
    loadModel: async () => ({
      gltf: person,
      lod: personLod,
      asset: { modelKey: 'cro-magnon-woman' },
    }),
  });
  await people.load();
  // A drawn skin binds a bone texture; a model's userData is its own.
  const skeleton = person.scene.getObjectByName('Body').skeleton;
  skeleton.computeBoneTexture();
  const preview = new THREE.DataTexture(new Uint8Array(4), 1, 1);
  full.userData.preview = preview;
  // An owner with a scene and a parser of its own is not a parsed model: walked whole.
  const held = new THREE.BoxGeometry();
  const world = {
    worldAssets: assets,
    humanAssets: new Map([['cro-magnon-woman', people]]),
    scene: new THREE.Scene().add(copy),
    input: {
      scene: new THREE.Group(),
      parser: { associations: new Map(), getDependency() {} },
      held,
    },
  };
  const found = collectGpuResources([world]);
  const owned = parts(full, lod, person, personLod);
  assert.equal(owned.geometries.size, 8, 'two triangles, in two scenes, of each model');
  assert.equal(owned.maps.size, 4, 'each pair shares its two textures');
  for (const geometry of [...owned.geometries, held]) assert.ok(found.geometries.has(geometry));
  for (const texture of [...owned.maps, skeleton.boneTexture, preview])
    assert.ok(found.textures.has(texture));
  for (const texture of retired) assert.ok(!found.textures.has(texture), 'retired before any draw');
  for (const material of variant.materials) assert.ok(found.materials.has(material));
  assert.equal(found.textures.size, owned.maps.size + 2);
  // Shutdown releases each parsed model once, both scenes included.
  people.dispose();
  assets.dispose();
  assert.deepEqual(
    bitmaps.map((bitmap) => bitmap.closed),
    bitmaps.map(() => 1),
  );
  assert.equal(bitmaps.length, 8);
  preview.dispose();
  held.dispose();
});

let rigSource;
/** The delivered Cro-Magnon rig, as the actor tests load it (geometry, skin, clips): its
 * primary and LOD, or after the r04 adoption its sole primary with no LOD. */
async function rigTemplate() {
  rigSource ??= deliveredWomanRig();
  const { primary, lod, asset } = await rigSource;
  return {
    gltf: runtimeModel(cloneSkeleton(primary.scene), primary.animations),
    lod: lod && runtimeModel(cloneSkeleton(lod.scene)),
    asset,
  };
}

/** A texture whose source stands in for an ImageBitmap and records close(). */
function bitmapTexture(closed, name) {
  const texture = new THREE.Texture({ width: 2, height: 2, close: () => closed.push(name) });
  texture.needsUpdate = true;
  return texture;
}

/** The gallery's verified cave, the far-view boulder and the character provider. */
function worldAssets(closed, counter) {
  const assets = new WorldAssets();
  assets.catalog = { assets: [] };
  const cave = new THREE.Group();
  cave.add(new THREE.Mesh(new THREE.BoxGeometry(30, 6, 80), new THREE.MeshStandardMaterial()));
  assets.templates.set(CAMP_CAVE.key, {
    asset: { modelKey: CAMP_CAVE.key, ...caveGalleryImages() },
    gltf: runtimeModel(cave),
    lods: [],
  });
  const boulder = new THREE.Group();
  boulder.add(
    new THREE.Mesh(
      new THREE.BoxGeometry(1, 2, 1),
      new THREE.MeshStandardMaterial({ map: bitmapTexture(closed, 'boulder') }),
    ),
  );
  assets.templates.set('valley-boulder', {
    asset: { modelKey: 'valley-boulder', heightMetres: 1.7 },
    gltf: runtimeModel(boulder),
    lods: [runtimeModel(boulder.clone(true))],
  });
  const people = new CharacterAssets('/models/cro-magnon-woman/asset.json', {
    queue: assets.loadQueue,
    loadModel: async () => {
      counter.loads++;
      const template = await rigTemplate();
      const material = new THREE.MeshStandardMaterial({ map: bitmapTexture(closed, 'rig') });
      template.gltf.scene.traverse((node) => {
        if (node.isMesh) node.material = material;
      });
      return template;
    },
  });
  return { assets, people };
}

/** The real loss and restore methods on a world without DOM, listening on the
 * canvas after the renderer as the constructor does. */
function playingWorld(gl, renderer, owned) {
  const events = [],
    releases = [];
  const world = Object.assign(Object.create(WorldRenderer.prototype), {
    canvas: gl.canvas,
    renderer,
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(57, 1, 0.15, 360),
    disposed: false,
    failed: false,
    assetsReady: true,
    graphicsContext: new GraphicsContextState(),
    onGraphicsContext: (event) => events.push(event),
    frameClock: new FrameClock(performance.now()),
    motionLastFrame: null,
    graphics: { ready() {}, observe: () => false },
    landscapes: [],
    loadingCave: null,
    engineResources: new Map(),
    collision: new CollisionWorld(),
    loadProgress: { phase: 'ready', loaded: 1, total: 1 },
    resize() {},
    cancel() {},
    ...owned,
  });
  world.camera.position.set(0, 1.2, 6);
  world.contextLost = (e) => {
    e.preventDefault();
    world.loseGraphicsContext();
  };
  world.contextRestored = () => world.restoreGraphicsContext();
  gl.canvas.addEventListener('webglcontextlost', world.contextLost);
  gl.canvas.addEventListener('webglcontextrestored', world.contextRestored);
  // Each loss's report, read once the world has handled the event.
  gl.canvas.addEventListener('webglcontextlost', () =>
    releases.push(JSON.parse(gl.canvas.dataset.webglReleased)),
  );
  return { world, events, releases };
}

/** Browser globals for the gallery. Its ten images load through the game's verified
 * download and decoder over a stand-in network and image element (caveImageNetwork),
 * and arrive as uploadable textures of their recorded sizes. */
function galleryDom(t) {
  globalsFor(t, {
    document: {
      hidden: false,
      hasFocus: () => false,
      createElement: element,
      body: { classList: { add() {}, remove() {} } },
      addEventListener() {},
    },
    window: { addEventListener() {} },
    requestAnimationFrame: (callback) => setImmediate(() => callback(0)),
  });
}

/** The gallery's ten verified images, for the cave template of `assets`. */
function galleryImages(assets) {
  const network = caveImageNetwork(assets.get(CAMP_CAVE.key).asset);
  /** Each served file requested once, decoded once, and no blob URL left. */
  network.assertLoaded = () => {
    assert.deepEqual([...network.requests].sort(), [...network.files.keys()].sort());
    assert.equal(network.images.length, 10, 'each verified image decoded once');
    assert.equal(network.blobs.size, 0, 'every blob URL revoked');
  };
  /** Whether every decoded image has been closed exactly `times` times. */
  network.closedEach = (times) => network.images.every((image) => image.closed === times);
  return network;
}

/** The gallery's frame (the world prepares behind it), with its samplers; the
 * gallery's pigments reach its programs through onBeforeCompile. */
function drawGallery(renderer, world, cave) {
  cave.render(0);
  renderer.render(world.scene, world.camera);
  bindSamplers(renderer, [cave.scene, world.scene]);
}

/** As destroy() lets go of Three's own resources first, then releases the world's
 * far views, providers and templates. Returns the lookup table it let go of. */
function shutDown(world, assets, people) {
  world.releaseEngineResources();
  for (const landscape of world.landscapes) landscape.dispose();
  people.dispose();
  assets.dispose();
  world.renderer.dispose();
  return world.engineResources.get('dfg-lut');
}

/** No listener of this context's renderer is left on Three's module-level table. */
function assertLetGo(gl, lut) {
  const deletes = gl.state.deletes;
  lut.dispose();
  assert.equal(gl.state.deletes, deletes, 'the lookup table holds no listener of the renderer');
}

test('the world and its gallery survive two native losses, the gallery exit, an eviction and shutdown', async (t) => {
  quiet(t);
  galleryDom(t);
  const gl = webglCanvas(),
    renderer = new THREE.WebGLRenderer({ canvas: gl.canvas }),
    closed = [],
    counter = { loads: 0 };
  const { assets, people } = worldAssets(closed, counter);
  const { world, events, releases } = playingWorld(gl, renderer, {
    worldAssets: assets,
    humanAssets: new Map([['cro-magnon-woman', people]]),
  });
  world.landscapes.push(
    new LandscapeInstances({
      assets,
      key: 'valley-boulder',
      placements: [],
      renderer,
      scene: world.scene,
      distances: [28, 50, 110],
    }),
  );
  // The gallery is open and ready while the world waits behind it (main.ts).
  const gallery = galleryImages(assets);
  const cave = new LoadingCave(
    world,
    () => {},
    () => {},
    { character: 'cro-magnon-woman', images: gallery.options },
  );
  world.loadingCave = cave;
  await cave.load();
  gallery.assertLoaded();
  drawGallery(renderer, world, cave);
  gl.lose();
  gl.restore();
  drawGallery(renderer, world, cave);
  assert.ok(gallery.closedEach(0), 'a loss lets go of GPU copies only; the images stay');
  // Entering the world closes the gallery (closeLoadingCave): its own pigments and
  // its actor's bone textures were the WebKit trace's thirteen stale deletes.
  cave.dispose();
  world.loadingCave = null;
  assert.deepEqual(gl.state.stale, []);
  assert.ok(gallery.closedEach(1), 'leaving releases each gallery image once');
  // Playing: the character and a scenery copy share their templates.
  const actor = await people.create({ color: '#b7a27a' });
  const boulder = assets.create('valley-boulder');
  world.scene.add(actor.root, boulder);
  const play = () => {
    actor.animation.update(1 / 30, 0, false);
    renderer.render(world.scene, world.camera);
    bindSamplers(renderer, [world.scene]);
  };
  play();
  gl.lose();
  gl.restore();
  play();
  assert.deepEqual(events, ['lost', 'restored', 'lost', 'restored']);
  assert.equal(world.canvas.dataset.webglRestores, '2');
  for (const release of releases) {
    assert.deepEqual(release.unreleased, { geometries: 0, textures: 0 }, 'every holder reached');
    // The lit cave, rig and boulder sampled Three's own table in each context.
    assert.deepEqual(release.engine, ['sprite-quad', 'dfg-lut']);
  }
  assert.equal(counter.loads, 1, 'no verified model is loaded again');
  assert.deepEqual(closed, [], 'no live source image is closed');
  // The actor leaves and its unused template is evicted, closing its own image.
  world.scene.remove(actor.root, boulder);
  actor.dispose();
  assert.equal(people.evict(), true);
  assert.deepEqual(closed, ['rig']);
  const lut = shutDown(world, assets, people);
  assert.deepEqual(closed, ['rig', 'boulder']);
  assert.ok(gallery.closedEach(1), 'never released twice');
  assert.deepEqual(gl.state.stale, [], 'no delete reached a handle of a lost context');
  assertLetGo(gl, lut);
});

test('a loss while the gallery is still loading releases what the world had prepared', async (t) => {
  quiet(t);
  galleryDom(t);
  const gl = webglCanvas(),
    renderer = new THREE.WebGLRenderer({ canvas: gl.canvas }),
    closed = [],
    counter = { loads: 0 };
  const { assets, people } = worldAssets(closed, counter);
  const { world, events, releases } = playingWorld(gl, renderer, {
    worldAssets: assets,
    humanAssets: new Map([['cro-magnon-woman', people]]),
  });
  world.landscapes.push(
    new LandscapeInstances({
      assets,
      key: 'valley-boulder',
      placements: [],
      renderer,
      scene: world.scene,
      distances: [28, 50, 110],
    }),
  );
  renderer.render(world.scene, world.camera);
  bindSamplers(renderer, [world.scene]);
  const gallery = galleryImages(assets);
  const cave = new LoadingCave(
    world,
    () => {},
    () => {},
    { character: 'cro-magnon-woman', images: gallery.options },
  );
  world.loadingCave = cave;
  const loading = cave.load();
  gl.lose();
  // The gallery finishes preparing during the loss; it draws once restored.
  await loading;
  gallery.assertLoaded();
  assert.ok(gallery.closedEach(0));
  gl.restore();
  drawGallery(renderer, world, cave);
  cave.dispose();
  world.loadingCave = null;
  assert.ok(gallery.closedEach(1), 'leaving releases each gallery image once');
  assert.deepEqual(events, ['lost', 'restored']);
  assert.deepEqual(releases[0].unreleased, { geometries: 0, textures: 0 });
  assert.deepEqual(
    releases[0].engine,
    ['sprite-quad', 'dfg-lut'],
    'the lit boulder used the table',
  );
  const lut = shutDown(world, assets, people);
  assert.deepEqual(gl.state.stale, []);
  assertLetGo(gl, lut);
  assert.equal(counter.loads, 1);
});

test('a failed world still releases its lost context and is never resumed', (t) => {
  quiet(t);
  t.mock.method(console, 'error', () => {});
  globalsFor(t, { cancelAnimationFrame: () => {} });
  const gl = webglCanvas(),
    renderer = new THREE.WebGLRenderer({ canvas: gl.canvas }),
    held = resources();
  const { world, events } = playingWorld(gl, renderer, {
    scene: held.scene,
    held,
    frame: 1,
    loadingLabel: null,
    onError() {},
  });
  draw(renderer, held);
  world.failWorld('検証済みの3D素材を読み込めませんでした。', new Error('integrity mismatch'));
  for (let loss = 0; loss < 2; loss++) {
    gl.lose();
    assert.deepEqual(JSON.parse(gl.canvas.dataset.webglReleased).unreleased, {
      geometries: 0,
      textures: 0,
    });
    gl.restore();
  }
  assert.deepEqual(events, [], 'a failed world is neither paused nor resumed');
  assert.equal(world.failed, true);
  disposeAll(held);
  world.releaseEngineResources();
  assert.deepEqual(gl.state.stale, []);
  renderer.dispose();
});
