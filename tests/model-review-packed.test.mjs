// Packed levels in the model review page (src/model-review.ts, src/model-review-levels.ts):
// synthetic, test-only GLBs (glb-fixtures.mjs) parsed by the game's own loader. The page test
// runs the page module with stand-in browser objects, as model-review.test.mjs does.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { parseEmbeddedGLB } from '../dist/src/embedded-glb.js';
import { choiceLevel, reviewChoices, reviewedModel } from '../dist/src/model-review-levels.js';
import {
  arrayBuffer,
  compressedModel,
  decodeImages,
  deferred,
  globalsFor,
  record,
  serve,
  settle,
  sha,
} from './glb-fixtures.mjs';

/** The fixture triangle packed as `scenes` levels: scene L holds node "L<L>" whose mesh has
 * L + 1 primitives (so L + 1 triangles), each with its own accessors, and material "level L". */
function packedModel({ scenes = 3, change = () => {} } = {}) {
  return compressedModel({
    change(json) {
      const [position, index] = json.accessors,
        [texture] = json.textures,
        levels = [...Array(scenes).keys()];
      json.accessors = [];
      json.meshes = levels.map((level) => ({
        primitives: [...Array(level + 1)].map(() => {
          json.accessors.push({ ...position }, { ...index });
          const count = json.accessors.length;
          return { attributes: { POSITION: count - 2 }, indices: count - 1, material: level };
        }),
      }));
      json.textures = levels.map(() => ({ ...texture }));
      json.materials = levels.map((level) => ({
        name: `level ${level}`,
        pbrMetallicRoughness: { baseColorTexture: { index: level } },
      }));
      json.nodes = levels.map((level) => ({ name: `L${level}`, mesh: level }));
      json.scenes = levels.map((level) => ({ nodes: [level] }));
      change(json);
    },
  });
}

/** A catalog record whose `levels` levels all name `url` and their scene; level L records
 * L + 1 triangles unless `triangles` says otherwise. */
function packedRecord(key, url, glb, { levels = 3, name = key, triangles = [] } = {}) {
  const file = record(url, glb);
  return {
    modelKey: key,
    name,
    kind: 'static',
    ...file,
    scene: 0,
    triangles: triangles[0] ?? 1,
    lods: [...Array(levels - 1).keys()].map((index) => ({
      ...file,
      scene: index + 1,
      triangles: triangles[index + 1] ?? index + 2,
      distanceMetres: 20 * (index + 1),
    })),
  };
}

const trianglesOf = (root) => {
  let triangles = 0;
  root.traverse((node) => {
    if (node.isMesh) triangles += node.geometry.index.count / 3;
  });
  return triangles;
};

/** dispose() calls per geometry or material from here on. */
function disposals(t) {
  const geometry = t.mock.method(THREE.BufferGeometry.prototype, 'dispose'),
    material = t.mock.method(THREE.Material.prototype, 'dispose');
  return (resource) =>
    [...geometry.mock.calls, ...material.mock.calls].filter((call) => call.this === resource)
      .length;
}

/** Every geometry and material in every scene a parse made. */
function resourcesOf(model) {
  const found = new Set();
  for (const scene of model.scenes)
    scene.traverse((node) => {
      if (node.geometry) found.add(node.geometry);
      for (const material of [node.material].flat()) if (material) found.add(material);
    });
  return [...found];
}

test('an ordinary record keeps its menu entries; a packed one lists each level as its scene', async () => {
  const { glb } = await packedModel(),
    url = '/models/snow/model-levels.glb';
  assert.deepEqual(
    reviewChoices(
      {
        modelKey: 'stone',
        url: '/models/stone/model.glb',
        lods: [{ url: '/models/stone/lod1.glb' }, { url: '/models/stone/lod2.glb' }],
      },
      '石',
    ),
    [
      { label: '石', value: '/models/stone/model.glb', packed: null, disabled: false },
      { label: 'stone · LOD 1', value: '/models/stone/lod1.glb', packed: null, disabled: false },
      { label: 'stone · LOD 2', value: '/models/stone/lod2.glb', packed: null, disabled: false },
    ],
  );
  const snow = packedRecord('snow', url, glb, { name: '雪' }),
    choices = reviewChoices(snow, '雪');
  assert.deepEqual(
    choices.map(({ label, value, disabled }) => [label, value, disabled]),
    [
      ['雪 · scene 0', `${url}#scene=0`, false],
      ['雪 · LOD 1 · scene 1', `${url}#scene=1`, false],
      ['雪 · LOD 2 · scene 2', `${url}#scene=2`, false],
    ],
  );
  assert.deepEqual(
    choices.map((choice) => choice.packed),
    [0, 1, 2].map((level) => ({ record: snow, level, levels: 3 })),
  );
  assert.deepEqual(
    choices.map((choice) => choiceLevel(choice).triangles),
    [1, 2, 3],
  );
});

test('packed metadata the game would refuse is one disabled entry naming the refusal', async () => {
  const { glb } = await packedModel(),
    url = '/models/snow/model-levels.glb';
  const cases = [
    [
      'a level without a scene',
      (r) => delete r.lods[1].scene,
      /snow: 2 of its 3 levels name a scene/,
    ],
    [
      'a scene out of range',
      (r) => (r.lods[1].scene = 7),
      /level 2 names scene 7; packed level 2 is scene 2/,
    ],
    ['a negative scene', (r) => (r.scene = -1), /level 0 names scene -1/],
    ['a scene named twice', (r) => (r.lods[1].scene = 1), /levels 1 and 2 both name scene 1/],
    [
      'a scene that is not an index',
      (r) => (r.lods[0].scene = 1.5),
      /level 1 names scene 1\.5, not a scene index/,
    ],
    [
      'another file',
      (r) => (r.lods[0].sha256 = sha(Buffer.from('other'))),
      /level 1 is not the file level 0 names/,
    ],
    ['an actor kind', (r) => (r.kind = 'quadruped'), /a quadruped cannot have packed levels/],
  ];
  for (const [name, change, refusal] of cases) {
    const snow = packedRecord('snow', url, glb, { name: '雪' });
    change(snow);
    const choices = reviewChoices(snow, '雪');
    assert.equal(choices.length, 1, name);
    assert.equal(choices[0].disabled, true, name);
    assert.equal(choices[0].value, '', name);
    assert.equal(choices[0].packed, null, name);
    assert.match(choices[0].label, /^雪 · 確認不可: /, name);
    assert.match(choices[0].label, refusal, name);
  }
});

test('a packed choice reviews exactly its scene of the one parse; a parse that does not fit is refused', async (t) => {
  decodeImages(t);
  const { glb } = await packedModel(),
    url = '/models/snow/model-levels.glb',
    model = await parseEmbeddedGLB(arrayBuffer(glb), 'snow');
  for (const choice of reviewChoices(packedRecord('snow', url, glb), 'snow')) {
    const shown = reviewedModel(model, choice),
      { level } = choice.packed;
    assert.equal(shown.scene, model.scenes[level]);
    assert.deepEqual(shown.scenes, [model.scenes[level]]);
    assert.equal(trianglesOf(shown.scene), level + 1);
    assert.equal(shown.scene.getObjectByName(`L${level}`) !== undefined, true);
  }
  // An ordinary choice, or none (a local file), is the model itself.
  assert.equal(reviewedModel(model, null), model);
  assert.equal(reviewedModel(model, reviewChoices({ modelKey: 'snow', url }, 'snow')[0]), model);
  // A record with more levels than the file has scenes, or fewer.
  for (const levels of [4, 2]) {
    const [choice] = reviewChoices(packedRecord('snow', url, glb, { levels }), 'snow');
    assert.throws(
      () => reviewedModel(model, choice),
      new RegExp(`snow: has 3 scenes for ${levels} packed levels`),
    );
  }
  // Animated or skinned content is never reviewed as a packed level.
  const rig = await parseEmbeddedGLB(
      arrayBuffer((await compressedModel({ rig: true })).glb),
      'rig',
    ),
    [rigChoice] = reviewChoices(
      packedRecord('rig', '/models/rig/model-levels.glb', glb, { levels: 2 }),
      'rig',
    );
  assert.throws(() => reviewedModel(rig, rigChoice), /rig: packed levels cannot be animated/);
});

/** A canvas of `document` with a WebGL 2 context Three r185's WebGLRenderer can start with;
 * it draws nothing (as in model-review.test.mjs). */
function webglCanvas(document) {
  const values = new Map(),
    names = new Map();
  const constant = (name) => {
    if (!values.has(name)) {
      values.set(name, 0x10000 + values.size * 64);
      names.set(values.get(name), name);
    }
    return values.get(name);
  };
  const gl = {
    isContextLost: () => false,
    getError: () => 0,
    getExtension: () => null,
    getSupportedExtensions: () => [],
    getContextAttributes: () => ({ alpha: false, depth: true, stencil: false, antialias: true }),
    getShaderPrecisionFormat: () => ({ precision: 23, rangeMin: 127, rangeMax: 127 }),
    getParameter(pname) {
      const name = names.get(pname) ?? '';
      if (name === 'VERSION') return 'WebGL 2.0';
      if (name === 'VIEWPORT' || name === 'SCISSOR_BOX') return [0, 0, 4, 4];
      if (name.endsWith('_SIZE')) return 4096;
      return name.startsWith('MAX_') ? 16 : 0;
    },
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
  return Object.assign(new EventTarget(), {
    width: 4,
    height: 4,
    style: {},
    dataset: {},
    ownerDocument: document,
    setAttribute() {},
    getContext: () => context,
    getRootNode: () => document,
  });
}

/** The page's document and elements by id, recording what the review shows; `select` and
 * `listen` drive its controls. */
function reviewPage(t) {
  const elements = {},
    listeners = new Map();
  const element = (id) =>
    (elements[id] ??= {
      id,
      textContent: '',
      value: '',
      disabled: false,
      hidden: false,
      checked: false,
      files: [],
      options: [],
      clientWidth: 640,
      clientHeight: 480,
      style: {},
      addEventListener(type, listener) {
        listeners.set(`${id}:${type}`, listener);
      },
      replaceChildren(...options) {
        this.options = options;
      },
      add(option) {
        this.options.push(option);
      },
    });
  const document = Object.assign(new EventTarget(), {
    getElementById: element,
    querySelector: (selector) => element(selector.replace(/^#/, '')),
  });
  elements['review-canvas'] = webglCanvas(document);
  element('count').value = '1';
  element('camera').value = 'front';
  globalsFor(t, {
    document,
    Option: class {
      constructor(text, value) {
        Object.assign(this, { text, value });
      }
    },
    ResizeObserver: class {
      observe() {}
    },
    devicePixelRatio: 1,
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {},
  });
  return {
    ui: elements,
    /** Choose a menu entry as the reviewer does. */
    select(value) {
      element('asset-model').value = value;
      listeners.get('asset-model:change')();
    },
    listen: (key) => listeners.get(key),
  };
}

async function until(condition, what) {
  for (let wait = 0; wait < 2000 && !condition(); wait++) await settle();
  assert.ok(condition(), `timed out waiting for ${what}`);
}

test('the review page shows each packed level exactly and releases every superseded or refused parse whole', async (t) => {
  t.mock.method(console, 'warn', () => {});
  t.mock.method(console, 'error', () => {});
  let gate = null;
  const holding = [];
  const bitmaps = decodeImages(t, {
      hold: async () => {
        if (!gate) return;
        holding.push(gate);
        await gate.promise;
      },
    }),
    disposed = disposals(t),
    raws = [],
    parseAsync = GLTFLoader.prototype.parseAsync;
  t.mock.method(GLTFLoader.prototype, 'parseAsync', async function (...args) {
    const gltf = await parseAsync.apply(this, args);
    raws.push(gltf);
    return gltf;
  });
  const { glb } = await packedModel(),
    broken = (await packedModel({ scenes: 2 })).glb,
    stone = (await compressedModel()).glb,
    url = '/models/snow/model-levels.glb',
    brokenUrl = '/models/rock/model-levels.glb',
    value = (level) => `${url}#scene=${level}`;
  const mud = packedRecord('mud', '/models/mud/model-levels.glb', glb, { name: '泥' });
  delete mud.lods[0].scene;
  const catalog = {
    assets: [
      packedRecord('snow', url, glb, { name: '雪', triangles: [1, 2, 99] }),
      packedRecord('rock', brokenUrl, broken, { name: '岩' }),
      mud,
      { modelKey: 'stone', name: '石', ...record('/models/stone/model.glb', stone) },
    ],
  };
  const page = reviewPage(t),
    { ui } = page,
    shown = '候補を表示中 — 形状、リグ、全動作を確認',
    address = encodeURIComponent(value(1));
  const requests = serve(
    t,
    {
      '/models/world-assets.json': catalog,
      [url]: glb,
      [brokenUrl]: broken,
      '/models/stone/model.glb': stone,
      '/models/flint-spear/asset.json': packedRecord(
        'flint-spear',
        '/models/flint-spear/model-levels.glb',
        glb,
        { levels: 1 },
      ),
    },
    {
      origin: 'http://asset.test',
      href: `http://asset.test/model-review.html?model=${address}`,
      search: `?model=${address}`,
    },
  );
  const fetched = (path) => requests.filter((request) => request === path).length;
  await import('../dist/src/model-review.js');
  // The address names scene 1: the page waits for its catalog record, then shows that scene.
  await until(() => ui.status.textContent === shown, 'scene 1');
  assert.equal(ui['asset-model'].value, value(1));
  assert.deepEqual(
    ui['asset-model'].options.map((option) => [option.text, option.value, !!option.disabled]),
    [
      ['雪 · scene 0', value(0), false],
      ['雪 · LOD 1 · scene 1', value(1), false],
      ['雪 · LOD 2 · scene 2', value(2), false],
      ['岩 · scene 0', `${brokenUrl}#scene=0`, false],
      ['岩 · LOD 1 · scene 1', `${brokenUrl}#scene=1`, false],
      ['岩 · LOD 2 · scene 2', `${brokenUrl}#scene=2`, false],
      [
        '泥 · 確認不可: mud: 2 of its 3 levels name a scene; a packed template names one for every level',
        '',
        true,
      ],
      ['石', '/models/stone/model.glb', false],
    ],
  );
  assert.match(
    ui['model-info'].textContent,
    /^model-levels\.glb · scene 1\/3 \/ 0\.00 MB \/ 2 triangles \/ 2 meshes \/ 0 bones \//,
  );
  assert.match(
    ui['model-info'].textContent,
    /パック済みファイル 3 シーン中 scene 1 \/ 記録 2 triangles$/,
  );
  assert.equal(ui.hash.textContent, `SHA-256 ${sha(glb)}`);
  assert.equal(fetched(url), 1);
  const [first] = raws;
  assert.equal(raws.length, 1);
  // Scene 0 is chosen and, while it parses, superseded by scene 2.
  gate = deferred();
  page.select(value(0));
  await until(() => holding.length === 1, 'the scene 0 parse');
  page.select(value(2));
  const release = gate;
  gate = null;
  release.resolve();
  await until(
    () =>
      raws.length === 3 &&
      ui.status.textContent === shown &&
      ui['model-info'].textContent.startsWith('model-levels.glb · scene 2/3') &&
      resourcesOf(raws[1]).every((resource) => disposed(resource) === 1),
    'scene 2 after the superseded parse',
  );
  const [, superseded, current] = raws;
  assert.match(ui['model-info'].textContent, / \/ 3 triangles \/ 3 meshes \//);
  assert.match(ui['model-info'].textContent, /記録 99 triangles — 不一致$/, 'the record disagrees');
  // Every scene of each replaced or superseded parse is released once; the shown one is kept.
  for (const model of [first, superseded])
    assert.ok(resourcesOf(model).every((resource) => disposed(resource) === 1));
  assert.equal(resourcesOf(first).length, 6 + 3, 'three scenes: 6 geometries, 3 materials');
  assert.ok(resourcesOf(current).every((resource) => disposed(resource) === 0));
  assert.deepEqual(bitmaps.map((bitmap) => bitmap.closed).sort(), [0, 1, 1]);
  // A scene address no catalog record names is refused before anything is fetched.
  const before = requests.length;
  page.select(`${url}#scene=7`);
  await until(() => ui.status.textContent.startsWith('読込失敗'), 'the refusal');
  assert.equal(
    ui.status.textContent,
    `読込失敗: ${url}#scene=7 はカタログのパック済みLODではありません`,
  );
  assert.equal(requests.length, before);
  assert.ok(
    resourcesOf(current).every((resource) => disposed(resource) === 0),
    'still shown',
  );
  // A record whose file does not hold its levels: one download, one parse, released whole
  // with the model shown before.
  page.select(`${brokenUrl}#scene=1`);
  await until(
    () =>
      raws.length === 4 &&
      ui.status.textContent !== '選択したモデルを読み込み中…' &&
      ui.status.textContent.startsWith('読込失敗'),
    'the rock refusal',
  );
  assert.equal(ui.status.textContent, '読込失敗: rock: has 2 scenes for 3 packed levels');
  assert.equal(fetched(brokenUrl), 1);
  for (const model of [current, raws[3]])
    assert.ok(resourcesOf(model).every((resource) => disposed(resource) === 1));
  assert.deepEqual(
    bitmaps.map((bitmap) => bitmap.closed),
    [1, 1, 1, 1],
  );
  // An ordinary entry is reviewed as before: the plain file, its default scene, no level suffix.
  page.select('/models/stone/model.glb');
  await until(() => raws.length === 5 && ui.status.textContent === shown, 'the ordinary model');
  assert.match(
    ui['model-info'].textContent,
    /^model\.glb \/ 0\.00 MB \/ 1 triangles \/ 1 meshes \/ 0 bones \//,
  );
  assert.doesNotMatch(ui['model-info'].textContent, /パック済み/);
  assert.equal(ui.hash.textContent, `SHA-256 ${sha(stone)}`);
  // Held equipment is never read from a packed scene.
  ui.equipment.value = 'flint-spear';
  await page.listen('equipment:change')();
  assert.equal(
    ui['equipment-info'].textContent,
    '装備の読込失敗: flint-spear: equipment templates cannot have packed levels',
  );
  assert.equal(fetched('/models/flint-spear/model-levels.glb'), 0);
});
