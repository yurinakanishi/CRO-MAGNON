import test from 'node:test';
import assert from 'node:assert/strict';

// A small DOM stand-in: the atlas only needs ids, classes, dataset, style and events.
class ClassList {
  #set = new Set();
  add(...names) {
    for (const name of names) this.#set.add(name);
  }
  remove(...names) {
    for (const name of names) this.#set.delete(name);
  }
  contains(name) {
    return this.#set.has(name);
  }
  toggle(name, force) {
    const on = force === undefined ? !this.#set.has(name) : !!force;
    if (on) this.#set.add(name);
    else this.#set.delete(name);
    return on;
  }
}
class El {
  constructor(id = '') {
    this.id = id;
    this.dataset = {};
    this.attrs = {};
    this.classList = new ClassList();
    this.style = { setProperty: (k, v) => (this.style[k] = v) };
    this.listeners = {};
    this.textContent = '';
    this.hidden = false;
    this.disabled = false;
    this.children = [];
  }
  setAttribute(k, v) {
    this.attrs[k] = String(v);
  }
  getAttribute(k) {
    return this.attrs[k];
  }
  matches(selector) {
    return selector === '[aria-pressed="true"]' && this.attrs['aria-pressed'] === 'true';
  }
  closest(selector) {
    return selector === 'dialog' ? dialog : null;
  }
  addEventListener(type, fn) {
    (this.listeners[type] ??= []).push(fn);
  }
  removeEventListener(type, fn) {
    this.listeners[type] = (this.listeners[type] ?? []).filter((f) => f !== fn);
  }
  dispatchEvent(event) {
    for (const fn of this.listeners[event.type] ?? []) fn(event);
    return true;
  }
  focus() {}
  scrollIntoView() {}
}
const dialog = new El('modal');
dialog.open = true;
dialog.closed = 0;
dialog.close = () => dialog.closed++;
// Each opening of the atlas renders a new canvas.
const atlasCanvas = () => {
  const canvas = new El('big-map');
  canvas.width = 1000;
  canvas.height = 620;
  canvas.parentElement = { clientWidth: 1000, clientHeight: 620 };
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 620 });
  canvas.isConnected = true;
  return canvas;
};
const canvas = atlasCanvas();
const root = new El('warp-map-points');
Object.defineProperty(root, 'innerHTML', {
  set(html) {
    root.children = [...html.matchAll(/data-warp-point="([^"]+)"/g)].map((m) => {
      const button = new El();
      button.dataset.warpPoint = m[1];
      return button;
    });
  },
});
root.querySelectorAll = () => root.children;
const ids = [
  'map-card',
  'map-warp',
  'map-pin-send',
  'map-pin-clear',
  'map-pin-status',
  'map-cursor',
  'map-self',
  'map-region',
  'map-destination',
  'map-selection',
  'map-warp-status',
  'map-zoom-level',
  'map-zoom-in',
  'map-zoom-out',
  'map-center',
];
const elements = Object.fromEntries(ids.map((id) => [id, new El(id)]));
elements['big-map'] = canvas;
elements['warp-map-points'] = root;
const selfName = new El();
const pinActions = new El();
const sights = []; // The 名所 photos; the first test's atlas has none.
const byId = (id) => elements[id] ?? null;
globalThis.document = {
  querySelector: (selector) =>
    selector === '#map-self b' ? selfName : byId(selector.replace(/^#/, '')),
  querySelectorAll: (selector) =>
    selector === '.map-pin-actions,#map-pin-status'
      ? [pinActions, elements['map-pin-status']]
      : selector === '[data-map-place]'
        ? sights
        : [],
  getElementById: byId,
};

const { installMapWarp, selectedWarpId } = await import('../dist/src/map-warp-ui.js');
const { mapProjection } = await import('../dist/src/world-map.js');
const { WARP_POINTS } = await import('../dist/shared/warp-sites.mjs');
const { SPAWN_SITES } = await import('../dist/shared/spawn-sites.mjs');
const { mapEmptyPrompt } = await import('../dist/src/map-screen.js');
elements['map-destination'].textContent = mapEmptyPrompt(); // As the markup renders it.

const frame = (overrides = {}) => ({
  status: 'connected',
  index: 0,
  move: { x: 0, y: 0, running: false },
  look: { x: 0, y: 0 },
  actions: [],
  navigation: null,
  active: true,
  pointer: { x: 0, y: 0 },
  zoom: 0,
  ...overrides,
});

test('controller: the stick moves the pointer, confirm selects the fire under it, confirm again warps once', () => {
  const me = { id: 'me', x: 50, z: 50, facing: 0, seals: 0 };
  const actions = [],
    sent = [];
  let pins = [];
  const map = installMapWarp({
    player: () => me,
    pins: () => pins,
    pinEnabled: () => true,
    send: (message) => sent.push(message),
    now: () => 100000,
    action: (type, id) => actions.push([type, id]),
    icon: () => '',
    connected: () => true,
    redraw: () => canvas.dispatchEvent(new Event('mapdraw')),
  });
  assert.equal(mapProjection(canvas, true, me).zoom, 4, 'opens at 4×');
  assert.deepEqual(
    mapProjection(canvas, true, me).point(50, 50),
    [500, 310],
    'centred on the player',
  );
  assert.equal(elements['map-destination'].textContent, mapEmptyPrompt());
  assert.equal(elements['map-cursor'].style.left, '500px');
  assert.ok(
    elements['map-cursor'].classList.contains('is-near'),
    'the home fire is under the pointer',
  );

  map.input(frame({ pointer: { x: 1, y: 0 } }), 0.1);
  assert.equal(elements['map-cursor'].style.left, '560px');
  assert.ok(!elements['map-cursor'].classList.contains('is-near'));
  map.input(frame({ actions: ['confirm'] }), 0.016);
  assert.equal(selectedWarpId(), '', 'nothing within 22 px: confirm does nothing');
  assert.deepEqual(actions, []);

  map.input(frame({ pointer: { x: -1, y: 0 } }), 0.1);
  map.input(frame({ actions: ['confirm'] }), 0.016);
  assert.equal(selectedWarpId(), 'fire-50-50');
  assert.equal(elements['map-card'].dataset.state, 'ready');
  assert.equal(elements['map-destination'].textContent, 'はじまりの焚き火');
  assert.match(elements['map-selection'].textContent, /^現在地から \d+ m$/);
  assert.deepEqual(actions, [], 'selecting must not itself travel');
  const home = root.children.find((b) => b.dataset.warpPoint === 'fire-50-50');
  assert.equal(home.attrs['aria-pressed'], 'true');
  assert.ok(home.classList.contains('show-label'));

  map.input(frame({ actions: ['confirm'] }), 0.016);
  assert.deepEqual(actions, [['warp', 'fire-50-50']]);
  map.input(frame({ actions: ['confirm', 'confirm'] }), 0.016);
  assert.equal(actions.length, 2, 'each confirm frame sends at most one warp');

  // Right stick zooms around the pointer; the fire under it stays put.
  const before = mapProjection(canvas, true, me).point(50, 50);
  map.input(frame({ zoom: -1 }), 0.1);
  const zoomed = mapProjection(canvas, true, me);
  assert.ok(Math.abs(zoomed.zoom - 4 * 2 ** 0.15) < 1e-9);
  assert.ok(Math.hypot(...zoomed.point(50, 50).map((n, i) => n - before[i])) < 1e-6);
  map.input(frame({ actions: ['zoomOut'] }), 0.016);
  assert.ok(Math.abs(mapProjection(canvas, true, me).zoom - (4 * 2 ** 0.15) / 1.5) < 1e-9);

  // Pushing into the edge band scrolls the map under the pointer.
  map.input(frame({ actions: ['center'] }), 0.016);
  map.input(frame({ pointer: { x: 1, y: 0 } }), 1);
  assert.equal(elements['map-cursor'].style.left, '850px');
  assert.ok(Math.abs(mapProjection(canvas, true, me).point(50, 50)[0] - 250) < 1e-6);
  map.input(frame({ navigation: 'left' }), 0.016);
  assert.equal(elements['map-cursor'].style.left, '849px', 'd-pad nudges one pixel');

  // Square drops the shared pin at the pointer, and square again clears it.
  map.input(frame({ actions: ['pin'] }), 0.016);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, 'mapPin');
  const expected = mapProjection(canvas, true, me).world(849, 310);
  assert.ok(Math.abs(sent[0].x - expected.x) < 1e-6 && Math.abs(sent[0].z - expected.z) < 1e-6);
  pins = [
    {
      id: 'p1',
      ownerId: 'me',
      name: 'Me',
      color: '#fff',
      x: sent[0].x,
      z: sent[0].z,
      expiresAt: 400000,
    },
  ];
  canvas.dispatchEvent(new Event('mapdraw')); // The next snapshot redraw shows the pin.
  assert.equal(elements['map-pin-clear'].hidden, false);
  assert.match(elements['map-pin-status'].textContent, /自分のピン/);
  map.input(frame({ actions: ['pin'] }), 0.016);
  assert.deepEqual(sent[1], { type: 'clearMapPin' });

  map.input(frame({ actions: ['menu'] }), 0.016);
  assert.equal(dialog.closed, 1);
  assert.equal(WARP_POINTS.length, root.children.length, 'every fire has a marker');
});

test('名所: a photo chooses its sight at the centre, the chosen photo, ○ or the button warps, and △ steps through the row', () => {
  const view = atlasCanvas();
  elements['big-map'] = view;
  delete elements['map-card'].dataset.warpId; // A new atlas starts without a choice.
  for (const site of SPAWN_SITES) {
    const photo = new El();
    photo.dataset.mapPlace = `spawn-${site.id}`;
    sights.push(photo);
  }
  const me = { id: 'me', x: 50, z: 50, facing: 0, seals: 0 };
  const actions = [];
  const map = installMapWarp({
    player: () => me,
    pins: () => [],
    pinEnabled: () => true,
    send: () => {},
    now: () => 100000,
    action: (type, id) => actions.push([type, id]),
    icon: () => '',
    connected: () => true,
    redraw: () => view.dispatchEvent(new Event('mapdraw')),
  });
  const photo = (id) => sights.find((sight) => sight.dataset.mapPlace === `spawn-${id}`);

  photo('mammoth').onclick();
  assert.equal(selectedWarpId(), 'spawn-mammoth');
  assert.deepEqual(actions, [], 'choosing a sight must not itself travel');
  assert.equal(elements['map-region'].textContent, '名所');
  assert.equal(elements['map-destination'].textContent, 'マンモスの近く');
  assert.match(
    elements['map-selection'].textContent,
    /^背中に乗れる大きなマンモス\n現在地から \d+ m$/,
  );
  assert.equal(elements['map-card'].dataset.state, 'ready');
  assert.deepEqual(
    sights.map((sight) => sight.attrs['aria-pressed']),
    SPAWN_SITES.map((site) => String(site.id === 'mammoth')),
  );
  const shown = mapProjection(view, true, me);
  assert.ok(Math.abs(620 / shown.scale - 200) < 1e-6, '200 m across the shorter side');
  assert.ok(shown.zoom > 8 && shown.zoom < 32, `zoom ${shown.zoom}`);
  assert.deepEqual(shown.point(33, 32).map(Math.round), [500, 310], 'the sight is centred');
  assert.equal(elements['map-cursor'].style.left, '500px');
  assert.ok(elements['map-cursor'].classList.contains('is-near'), 'the pointer is on it');

  photo('mammoth').onclick();
  assert.deepEqual(actions, [['warp', 'spawn-mammoth']], 'the chosen photo warps');
  map.input(frame({ actions: ['confirm'] }), 0.016);
  elements['map-warp'].onclick();
  assert.deepEqual(actions.slice(1), [
    ['warp', 'spawn-mammoth'],
    ['warp', 'spawn-mammoth'],
  ]);

  // △ follows the row's order and wraps from the last sight to the first.
  map.input(frame({ actions: ['places'] }), 0.016);
  assert.equal(selectedWarpId(), `spawn-${SPAWN_SITES[2].id}`);
  for (let step = 3; step < SPAWN_SITES.length; step++)
    map.input(frame({ actions: ['places'] }), 0.016);
  assert.equal(selectedWarpId(), `spawn-${SPAWN_SITES.at(-1).id}`);
  map.input(frame({ actions: ['places'] }), 0.016);
  assert.equal(selectedWarpId(), 'spawn-camp');

  // The camp lies 7 m from the home fire. Zoomed out until the fire is within reach of the
  // pointer, ○ still takes the sight under it; the fire's own marker then chooses the fire.
  map.input(frame({ actions: ['zoomOut'] }), 0.016);
  const [fireX, fireY] = mapProjection(view, true, me).point(50, 50);
  assert.ok(Math.hypot(fireX - 500, fireY - 310) < 22, 'the fire is within reach');
  map.input(frame({ actions: ['confirm'] }), 0.016);
  assert.deepEqual(actions.at(-1), ['warp', 'spawn-camp']);
  root.children.find((marker) => marker.dataset.warpPoint === 'fire-50-50').onclick();
  assert.equal(selectedWarpId(), 'fire-50-50');
  assert.equal(actions.length, 4, 'moving onto the fire chooses it');
  assert.ok(sights.every((sight) => sight.attrs['aria-pressed'] === 'false'));
  assert.match(elements['map-selection'].textContent, /^現在地から \d+ m$/);

  // The usual travel rules hold for sights: riding blocks the card and the photo.
  me.mountId = 'mammoth-1';
  photo('cave').onclick();
  assert.equal(elements['map-card'].dataset.state, 'blocked');
  assert.equal(elements['map-warp'].disabled, true);
  assert.match(elements['map-warp-status'].textContent, /降りてから/);
  photo('cave').onclick();
  assert.equal(actions.length, 4, 'a blocked sight does not travel');
  sights.length = 0;
});
