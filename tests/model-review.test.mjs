// The model review page (src/model-review.ts) run in Node: its own module, with a
// WebGL context that draws nothing, page elements that record what the page shows,
// and the synthetic GLBs of glb-fixtures.mjs. Only the browser is a stand-in.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  arrayBuffer,
  compressedModel,
  decodeImages,
  globalsFor,
  serve,
  settle,
  sha,
} from './glb-fixtures.mjs';

/** A canvas of `document` with a WebGL 2 context Three r185's WebGLRenderer can start
 * with; it draws nothing. */
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
  // A canvas in the page: OrbitControls (r185 connect/disconnect) adds and removes its
  // listeners on the canvas, its ownerDocument and its root node, the document.
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

/** The page: its document (an event target, as the controls need), its elements by
 * id recording what the review shows, and its file input. */
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
    // The review's animation loop is started, never run.
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {},
  });
  return {
    ui: elements,
    /** Choose a local file in the review's file input. */
    async choose(name, bytes) {
      element('model-file').files = [{ name, arrayBuffer: async () => arrayBuffer(bytes) }];
      await listeners.get('model-file:change')();
    },
  };
}

test('model review opens, rejects and reopens models through the game parser', async (t) => {
  t.mock.method(console, 'warn', () => {});
  t.mock.method(console, 'error', () => {});
  const bitmaps = decodeImages(t),
    { glb } = await compressedModel({ rig: true }),
    corrupt = await compressedModel({ rig: true, corrupt: true }),
    page = reviewPage(t),
    shown = '候補を表示中 — 形状、リグ、全動作を確認',
    modelPath = '/models/review/model.glb';
  serve(
    t,
    { [modelPath]: glb },
    {
      origin: 'http://asset.test',
      href: `http://asset.test/model-review.html?model=${modelPath}`,
      search: `?model=${modelPath}`,
    },
  );
  // The page opens the served model named in its address before the import settles.
  await import('../dist/src/model-review.js');
  const { ui } = page;
  // Its model menu (built from catalogs this server lacks) selects that model.
  for (let wait = 0; wait < 100 && ui['asset-model'].value !== modelPath; wait++) await settle();
  assert.equal(ui['asset-model'].value, modelPath);
  assert.deepEqual(ui['asset-model'].options, []);
  // The review's controls listen on its canvas and document, as in a browser page.
  assert.equal(ui['review-canvas'].style.touchAction, 'none');
  // A meshopt-compressed rig: a plain GLTFLoader without the game's decoder refuses it.
  assert.equal(ui.status.textContent, shown);
  assert.equal(ui.hash.textContent, `SHA-256 ${sha(glb)}`, 'the exact bytes reviewed');
  assert.match(
    ui['model-info'].textContent,
    /^model\.glb \/ 0\.00 MB \/ 1 triangles \/ 1 meshes \/ 1 bones \//,
  );
  assert.deepEqual(
    ui.clip.options.map((option) => option.value),
    ['', 'Idle_Loop'],
  );
  assert.equal(ui.clip.value, 'Idle_Loop', 'the clip plays on the review actor');
  assert.deepEqual(
    bitmaps.map((bitmap) => bitmap.closed),
    [0, 0],
  );
  // A corrupt local file fails: its parse releases its own images, and the model
  // shown before is released too.
  await page.choose('broken.glb', corrupt.glb);
  assert.match(ui.status.textContent, /^読込失敗: Malformed buffer data/);
  assert.equal(ui.hash.textContent, '');
  assert.deepEqual(
    bitmaps.map((bitmap) => bitmap.closed),
    [1, 1, 1, 1],
  );
  // Choosing the good file again shows it and keeps its images.
  await page.choose('model.glb', glb);
  assert.equal(ui.status.textContent, shown);
  assert.equal(ui.hash.textContent, `SHA-256 ${sha(glb)}`);
  assert.deepEqual(
    bitmaps.map((bitmap) => bitmap.closed),
    [1, 1, 1, 1, 0, 0],
  );
  // Only the shared helper parses: the page has no loader of its own.
  const source = await readFile('dist/src/model-review.js', 'utf8');
  assert.doesNotMatch(source, /GLTFLoader\.js|new GLTFLoader/);
  assert.match(source, /parseEmbeddedGLB\(buffer, name\)/);
});
