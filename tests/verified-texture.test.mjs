// Standalone cave images: verified bytes (origin, length, SHA-256) before decoding,
// the decoded size checked against the manifest, and every texture, decoded image
// and blob URL released exactly once, whoever leaves or fails first.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { downloadVerifiedAsset } from '../dist/src/asset-download.js';
import { VerifiedAssetCache } from '../dist/src/verified-asset-cache.js';
import { isLoadCancelled } from '../dist/src/asset-load-queue.js';
import {
  VerifiedTextureBatch,
  caveImageRecords,
  checkImageRecord,
  decodeImageWith,
  loadCaveTextures,
  loadVerifiedTexture,
  releaseVerifiedTexture,
} from '../dist/src/verified-texture.js';
import { CAVE_EXTRA_PIGMENTS } from '../dist/src/cave-gallery-layout.js';
import { WorldAssets } from '../dist/src/world-assets.js';
import { WorldLandmarks } from '../dist/src/world-landmarks.js';
import { LoadingCave } from '../dist/src/loading-cave.js';
import { CAMP_CAVE } from '../dist/shared/camp-cave-layout.mjs';
import { CollisionWorld } from '../dist/shared/collision.mjs';

const unhandled = [];
process.on('unhandledRejection', (error) => unhandled.push(error));

const origin = 'https://game.test';
const settings = { colorSpace: THREE.SRGBColorSpace, anisotropy: 8 };
const MURAL_FAILURE = '洞窟の壁画を読み込めませんでした。再読み込みしてください。';
const RIMO_FAILURE = 'りもねこの壁画を読み込めませんでした。再読み込みしてください。';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const copy = (bytes) => new Uint8Array(bytes).buffer;
const tick = () => new Promise((resolve) => setImmediate(resolve));
async function until(condition) {
  for (let i = 0; i < 500 && !condition(); i++) await tick();
  assert.ok(condition(), 'condition not reached');
}
function deferred() {
  let resolve;
  const promise = new Promise((yes) => (resolve = yes));
  return { promise, resolve };
}
/** All `count` decoded images exist and each was closed. */
const allClosed = (images, count) =>
  images.length === count && images.every((image) => image.closed);
const sizeOf = (texture) => ({ width: texture.image.width, height: texture.image.height });

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
/** A PNG-shaped file: signature and IHDR (its decoded size), then a body. */
function png(width, height, body = 'pixels') {
  const head = Buffer.alloc(33);
  SIGNATURE.copy(head, 0);
  head.writeUInt32BE(13, 8);
  head.write('IHDR', 12, 'latin1');
  head.writeUInt32BE(width, 16);
  head.writeUInt32BE(height, 20);
  head[24] = 8;
  head[25] = 6;
  return Buffer.concat([head, Buffer.from(body)]);
}
const record = (url, bytes, image) => ({ url, sha256: hash(bytes), bytes: bytes.length, image });

/** Same-origin files by path, counting requests. */
function network(files) {
  const requests = [];
  const transport = async (url) => {
    requests.push(url.pathname);
    const bytes = files.get(url.pathname);
    return bytes ? new Response(bytes) : new Response('', { status: 404 });
  };
  return { requests, transport };
}
/** The game's own verified download, through a test transport. */
const verified =
  (transport, cache = null) =>
  (file) =>
    downloadVerifiedAsset(file, origin, { cache, transport });

/** A decoder of PNG-shaped bytes: the IHDR gives the decoded size, as a browser
 * decoder reports it; a broken signature or a CORRUPT body fails like a decode
 * error. Each decoded image counts its close() calls. `gate` holds decodes. */
function pngDecoder() {
  const decoder = { calls: [], images: [], gate: null };
  decoder.decode = async (bytes, file) => {
    const view = Buffer.from(bytes);
    decoder.calls.push({ url: file.url, sha256: hash(view) });
    if (decoder.gate) await decoder.gate(file);
    if (!view.subarray(0, 8).equals(SIGNATURE) || view.includes('CORRUPT'))
      throw new Error(`${file.url}: undecodable`);
    const image = { width: view.readUInt32BE(16), height: view.readUInt32BE(20), closed: 0 };
    image.close = () => image.closed++;
    decoder.images.push(image);
    return { image, width: image.width, height: image.height };
  };
  return decoder;
}
/** Decodes held per URL until the test opens them. */
function gated(decoder) {
  const gates = new Map();
  const gate = (url) => {
    if (!gates.has(url)) gates.set(url, deferred());
    return gates.get(url);
  };
  decoder.gate = (file) => gate(file.url).promise;
  return (url) => gate(url).resolve();
}

/** dispose() calls per texture, with the image each held when disposed. */
function watchDisposals(t) {
  const disposals = new Map();
  t.mock.method(THREE.Texture.prototype, 'dispose', function () {
    const entry = disposals.get(this) ?? { count: 0, image: this.image };
    entry.count++;
    disposals.set(this, entry);
  });
  return (image) => {
    let count = 0;
    for (const entry of disposals.values()) if (entry.image === image) count += entry.count;
    return count;
  };
}

const CAVE_SIZES = {
  pigment: [1254, 1254],
  rockSurface: [1254, 1254],
  characterPigment: [2171, 724],
  rimoPigment: [2172, 724],
  ...Object.fromEntries(Object.keys(CAVE_EXTRA_PIGMENTS).map((key) => [key, [2172, 724]])),
};
const CAVE_KEYS = Object.keys(CAVE_SIZES);
/** A camp-cave manifest of PNG-shaped files: originals, or whole-image resizes to a
 * 1024 px edge served under new URLs with their original size as uvSource. */
function caveManifest({ resized = false, corrupt = [] } = {}) {
  const files = new Map();
  const entry = (key) => {
    const [width, height] = CAVE_SIZES[key];
    const scale = resized ? 1024 / Math.max(width, height) : 1;
    const image = { width: Math.round(width * scale), height: Math.round(height * scale) };
    const url = `/models/camp-cave/${key}${resized ? '.opt-0123456789abcdef' : ''}.png`;
    const body = `${corrupt.includes(key) ? 'CORRUPT' : 'pixels'} ${key}`;
    const bytes = png(image.width, image.height, body);
    files.set(url, bytes);
    return { ...record(url, bytes, image), ...(resized ? { uvSource: { width, height } } : {}) };
  };
  const manifest = {
    pigment: entry('pigment'),
    rockSurface: entry('rockSurface'),
    characterPigment: entry('characterPigment'),
    rimoPigment: entry('rimoPigment'),
    mascotPigments: Object.fromEntries(
      Object.keys(CAVE_EXTRA_PIGMENTS).map((key) => [key, entry(key)]),
    ),
  };
  return { manifest, files };
}
const urlOf = (manifest, key) =>
  (key in CAVE_EXTRA_PIGMENTS ? manifest.mascotPigments[key] : manifest[key]).url;

test('a verified image becomes the texture TextureLoader would make, set up as before', async () => {
  const bytes = png(4, 3);
  const file = record('/models/camp-cave/mural.png', bytes, { width: 4, height: 3 });
  const { requests, transport } = network(new Map([[file.url, bytes]]));
  const decoder = pngDecoder();
  const options = { download: verified(transport), decode: decoder.decode };
  const texture = await loadVerifiedTexture(file, settings, options);
  assert.deepEqual(requests, [file.url]);
  assert.deepEqual(decoder.calls, [{ url: file.url, sha256: file.sha256 }], 'the verified bytes');
  assert.equal(texture.image, decoder.images[0]);
  // TextureLoader makes `new Texture()` and sets its image: same orientation, alpha,
  // format, filtering and clamping; only the configured settings differ.
  const plain = new THREE.Texture();
  const loaderDefaults = [
    'flipY',
    'premultiplyAlpha',
    'generateMipmaps',
    'unpackAlignment',
    'format',
    'type',
    'mapping',
    'minFilter',
    'magFilter',
    'wrapS',
    'wrapT',
  ];
  for (const key of loaderDefaults) assert.equal(texture[key], plain[key], key);
  assert.equal(texture.colorSpace, THREE.SRGBColorSpace);
  assert.equal(texture.anisotropy, 8);
  assert.ok(texture.version > 0, 'marked for upload');
  const rock = await loadVerifiedTexture(file, { ...settings, repeat: true }, options);
  assert.equal(rock.wrapS, THREE.RepeatWrapping);
  assert.equal(rock.wrapT, THREE.RepeatWrapping);
  assert.notEqual(rock.image, texture.image, 'each texture owns its decoded image');
  releaseVerifiedTexture(texture);
  releaseVerifiedTexture(rock);
  assert.ok(allClosed(decoder.images, 2));
  assert.ok(decoder.images.every((image) => image.closed === 1));
  assert.equal(texture.image, null);
});

test('a wrong SHA-256 or length is rejected before the decoder sees any byte', async () => {
  const bytes = png(4, 3);
  const file = record('/models/camp-cave/mural.png', bytes, { width: 4, height: 3 });
  const sameSize = Buffer.from(bytes);
  sameSize[35] ^= 1;
  const served = [
    [sameSize, /SHA-256 mismatch/],
    [bytes.subarray(0, 30), /file length mismatch/],
    [null, /HTTP 404/],
  ];
  for (const [content, error] of served) {
    const decoder = pngDecoder();
    const { transport } = network(new Map(content ? [[file.url, content]] : []));
    const options = { download: verified(transport), decode: decoder.decode };
    await assert.rejects(loadVerifiedTexture(file, settings, options), error);
    assert.equal(decoder.calls.length, 0, 'never decoded');
  }
});

test('verified bytes that fail to decode, or decode to another size, are rejected and released', async () => {
  const broken = png(4, 3, 'CORRUPT');
  const file = record('/models/camp-cave/mural.png', broken, { width: 4, height: 3 });
  const decoder = pngDecoder();
  const options = (bytes) => ({
    download: verified(network(new Map([[file.url, bytes]])).transport),
    decode: decoder.decode,
  });
  await assert.rejects(loadVerifiedTexture(file, settings, options(broken)), /undecodable/);
  const calls = [{ url: file.url, sha256: file.sha256 }];
  assert.deepEqual(decoder.calls, calls, 'its SHA-256 was right');
  // The manifest says 4x3; the file decodes to 4x2.
  const short = png(4, 2);
  const wrongSize = record(file.url, short, { width: 4, height: 3 });
  await assert.rejects(
    loadVerifiedTexture(wrongSize, settings, options(short)),
    /mural\.png: decoded 4x2, the manifest records 4x3/,
  );
  assert.equal(decoder.images.length, 1);
  assert.equal(decoder.images[0].closed, 1, 'the wrongly sized image is released');
});

test('the browser decoder revokes its blob URL once and keeps nothing in THREE.Cache', async (t) => {
  THREE.Cache.enabled = true;
  t.after(() => {
    THREE.Cache.clear();
    THREE.Cache.enabled = false;
  });
  const created = [],
    revoked = [];
  const page = (load) => ({
    createObjectURL(blob) {
      const url = `blob:${origin}/${created.length}`;
      created.push({ url, blob });
      return url;
    },
    revokeObjectURL: (url) => revoked.push(url),
    async load(url) {
      const image = await load(url);
      THREE.Cache.add(`image:${url}`, image); // as THREE.ImageLoader does when enabled
      return image;
    },
  });
  const bytes = png(4, 3);
  const file = record('/models/camp-cave/mural.png', bytes, { width: 4, height: 3 });
  const element = { naturalWidth: 4, naturalHeight: 3, width: 4, height: 3 };
  const decoded = await decodeImageWith(page(async () => element))(copy(bytes), file);
  assert.equal(decoded.image, element);
  assert.deepEqual([decoded.width, decoded.height], [4, 3]);
  assert.equal(created[0].blob.type, 'image/png');
  const blobBytes = Buffer.from(await created[0].blob.arrayBuffer());
  assert.deepEqual(blobBytes, bytes, 'exactly the verified bytes');
  assert.deepEqual(revoked, [created[0].url]);
  assert.equal(THREE.Cache.get(`image:${created[0].url}`), undefined);
  // The element's error event: one clear rejection, its URL still revoked once.
  const errorEvent = async () => {
    throw { type: 'error' };
  };
  const failing = decodeImageWith(page(errorEvent));
  await assert.rejects(
    failing(copy(bytes), file),
    /mural\.png: the verified image could not be decoded/,
  );
  assert.deepEqual(revoked, [created[0].url, created[1].url]);
});

test('missing or incomplete records fail before anything is requested', async () => {
  const { requests, transport } = network(new Map());
  const decoder = pngDecoder();
  const options = { download: verified(transport), decode: decoder.decode };
  const good = record('/models/camp-cave/mural.png', png(1, 1), { width: 1, height: 1 });
  const incomplete = [
    [undefined, /the manifest records no image/],
    [{ ...good, url: '' }, /the manifest records no image/],
    [{ ...good, sha256: undefined }, /no SHA-256 and length/],
    [{ ...good, bytes: 0 }, /no SHA-256 and length/],
    [{ ...good, image: undefined }, /no image size/],
    [{ ...good, image: { width: 1 } }, /no image size/],
  ];
  for (const [bad, pattern] of incomplete)
    await assert.rejects(loadVerifiedTexture(bad, settings, options), pattern);
  assert.equal(checkImageRecord(good), good);
  const cave = (change) => {
    const { manifest } = caveManifest();
    change(manifest);
    return () => loadCaveTextures(manifest, 1, options);
  };
  assert.throws(
    cave((m) => delete m.rockSurface),
    /camp-cave rockSurface: the manifest records no image/,
  );
  assert.throws(
    cave((m) => delete m.rockSurface.sha256),
    /camp-cave rockSurface: the manifest records no SHA-256 and length/,
  );
  assert.throws(
    cave((m) => delete m.mascotPigments.roundBots),
    /camp-cave mascotPigments\.roundBots: the manifest records no image/,
  );
  assert.throws(
    cave((m) => delete m.mascotPigments.shapeBots.bytes),
    /camp-cave mascotPigments\.shapeBots: the manifest records no SHA-256 and length/,
  );
  assert.equal(requests.length, 0);
  assert.equal(decoder.calls.length, 0);
});

/** A minimal Cache API and lock manager for the game's verified file cache. */
function cacheStorage() {
  const entries = new Map();
  const cache = {
    entries,
    match: async (url) => (entries.has(url) ? new Response(entries.get(url).slice()) : undefined),
    async put(url, response) {
      const bytes = new Uint8Array(await response.arrayBuffer());
      entries.delete(url);
      entries.set(url, bytes);
    },
    delete: async (url) => entries.delete(url),
    keys: async () => [...entries.keys()].map((url) => ({ url })),
  };
  let tail = Promise.resolve();
  const locks = {
    request(name, options, callback) {
      const run = tail.then(() => callback());
      tail = run.then(
        () => {},
        () => {},
      );
      return run;
    },
  };
  return { cache, storage: { open: async () => cache }, locks };
}

test('the same file is verified again from the cache, and a failed load can be retried', async () => {
  const bytes = png(4, 3);
  const file = record('/models/camp-cave/mural.png', bytes, { width: 4, height: 3 });
  const { cache: stored, storage, locks } = cacheStorage();
  const cache = new VerifiedAssetCache({ storage, origin, locks });
  const requests = [];
  let failing = true;
  const transport = async (url) => {
    requests.push(url.pathname);
    return failing ? new Response('', { status: 503 }) : new Response(bytes);
  };
  const decoder = pngDecoder();
  const options = { download: verified(transport, cache), decode: decoder.decode };
  await assert.rejects(loadVerifiedTexture(file, settings, options), /HTTP 503/);
  assert.equal(decoder.calls.length, 0);
  failing = false;
  const first = await loadVerifiedTexture(file, settings, options);
  await cache.idle();
  const second = await loadVerifiedTexture(file, settings, options);
  assert.deepEqual(requests, [file.url, file.url], 'the second texture needed no request');
  assert.equal(cache.stats.hits, 1);
  assert.notEqual(first.image, second.image);
  // A damaged cached copy is never decoded: the file is fetched once more and verified.
  const key = `${origin}/__verified-assets/v1/sha256-${file.sha256}-${file.bytes}`;
  stored.entries.get(key)[35] ^= 1;
  const third = await loadVerifiedTexture(file, settings, options);
  assert.deepEqual(requests, [file.url, file.url, file.url]);
  assert.equal(cache.stats.corrupt, 1);
  const decoded = decoder.calls.map((call) => call.sha256);
  assert.deepEqual(decoded, [file.sha256, file.sha256, file.sha256], 'only verified bytes');
  await cache.idle();
  for (const texture of [first, second, third]) releaseVerifiedTexture(texture);
});

/** Named PNG-shaped files of 2x2 pixels, served by one network. */
function smallFiles(names, corrupt = null) {
  const files = names.map((name) => {
    const bytes = png(2, 2, name === corrupt ? 'CORRUPT' : name);
    return [name, record(`/models/camp-cave/${name}.png`, bytes, { width: 2, height: 2 }), bytes];
  });
  const { transport } = network(new Map(files.map(([, file, bytes]) => [file.url, bytes])));
  const entries = files.map(([name, file]) => [name, file, settings]);
  return { entries, transport };
}

test('leaving while images decode releases each texture and image once, late ones included', async (t) => {
  const disposedWith = watchDisposals(t);
  const { entries, transport } = smallFiles(['a', 'b']);
  const decoder = pngDecoder();
  const open = gated(decoder);
  const options = { download: verified(transport), decode: decoder.decode };
  const batch = new VerifiedTextureBatch(entries, options);
  await until(() => decoder.calls.length === 2);
  open('/models/camp-cave/a.png');
  await until(() => batch.textures.size === 1);
  // Made but waiting for its sibling: held where lost-context cleanup reaches it.
  const held = batch.textures.get('a');
  assert.ok(held.isTexture);
  batch.cancel();
  assert.equal(batch.textures.size, 0);
  await assert.rejects(batch.ready, (error) => isLoadCancelled(error));
  open('/models/camp-cave/b.png');
  await until(() => allClosed(decoder.images, 2));
  for (const image of decoder.images) {
    assert.equal(image.closed, 1);
    assert.equal(disposedWith(image), 1);
  }
  assert.throws(() => batch.take(), /not ready/);
  batch.cancel();
  assert.ok(decoder.images.every((image) => image.closed === 1));
});

test('one failed image ends the batch once and releases its siblings, late ones included', async (t) => {
  const disposedWith = watchDisposals(t);
  const { entries, transport } = smallFiles(['a', 'b', 'c'], 'b');
  const decoder = pngDecoder();
  const open = gated(decoder);
  const options = { download: verified(transport), decode: decoder.decode };
  const batch = new VerifiedTextureBatch(entries, options);
  let failures = 0;
  batch.ready.catch(() => failures++);
  await until(() => decoder.calls.length === 3);
  open('/models/camp-cave/a.png');
  await until(() => batch.textures.size === 1);
  open('/models/camp-cave/b.png');
  await assert.rejects(batch.ready, /b\.png: undecodable/);
  assert.equal(batch.failedKey, 'b');
  assert.equal(batch.textures.size, 0, 'the finished sibling is released');
  open('/models/camp-cave/c.png');
  await until(() => allClosed(decoder.images, 2));
  for (const image of decoder.images) {
    assert.equal(image.closed, 1);
    assert.equal(disposedWith(image), 1);
  }
  await tick();
  assert.equal(failures, 1, 'settled once');
  assert.throws(() => batch.take(), /not ready/);
});

test('the cave loads its ten images from the manifest records, resized copies included', async () => {
  const { manifest, files } = caveManifest({ resized: true });
  const { requests, transport } = network(files);
  const decoder = pngDecoder();
  const options = { download: verified(transport), decode: decoder.decode };
  const batch = loadCaveTextures(manifest, 4, options);
  await batch.ready;
  const textures = batch.take();
  assert.deepEqual(Object.keys(textures).sort(), [...CAVE_KEYS].sort());
  const urls = CAVE_KEYS.map((key) => urlOf(manifest, key));
  assert.deepEqual([...requests].sort(), urls.sort(), 'exactly the manifest URLs');
  for (const pigment of Object.values(CAVE_EXTRA_PIGMENTS))
    assert.ok(!requests.includes(pigment.url), `never the original ${pigment.url}`);
  const records = caveImageRecords(manifest);
  for (const [key, texture] of Object.entries(textures)) {
    assert.equal(texture.colorSpace, THREE.SRGBColorSpace, key);
    assert.equal(texture.anisotropy, 4, key);
    const wrap = key === 'rockSurface' ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
    assert.equal(texture.wrapS, wrap, key);
    assert.equal(texture.wrapT, wrap, key);
    assert.deepEqual(sizeOf(texture), records[key].image, `${key} decodes at its served size`);
  }
  for (const texture of Object.values(textures)) releaseVerifiedTexture(texture);
});

test('the served camp-cave images verify and decode at their recorded sizes', async () => {
  const asset = JSON.parse(await readFile('public/models/camp-cave/asset.json', 'utf8')),
    catalog = JSON.parse(await readFile('public/models/world-assets.json', 'utf8'));
  const manifests = [asset, catalog.assets.find((entry) => entry.modelKey === 'camp-cave')];
  const served = new Map();
  for (const manifest of manifests) {
    const records = caveImageRecords(manifest);
    assert.deepEqual(Object.keys(records).sort(), [...CAVE_KEYS].sort());
    for (const file of Object.values(records))
      if (!served.has(file.url)) served.set(file.url, await readFile(`public${file.url}`));
    const { requests, transport } = network(served);
    const decoder = pngDecoder();
    const options = { download: verified(transport), decode: decoder.decode };
    const batch = loadCaveTextures(manifest, 8, options);
    await batch.ready;
    const textures = batch.take();
    const urls = Object.values(records).map((file) => file.url);
    assert.deepEqual([...requests].sort(), urls.sort());
    for (const [key, texture] of Object.entries(textures)) {
      assert.deepEqual(sizeOf(texture), records[key].image, key);
      releaseVerifiedTexture(texture);
    }
  }
});

/** Browser globals the cave label and the gallery need; restored afterwards. */
function element() {
  return {
    style: {},
    dataset: {},
    hidden: false,
    disabled: false,
    textContent: '',
    innerHTML: '',
    value: 0,
    width: 0,
    height: 0,
    classList: { add() {}, remove() {}, toggle() {} },
    append() {},
    remove() {},
    setAttribute() {},
    addEventListener() {},
    setPointerCapture() {},
    querySelector: () => element(),
    getContext: () => new Proxy({}, { get: () => () => {}, set: () => true }),
  };
}
function browser(t) {
  const values = {
    document: {
      hidden: false,
      hasFocus: () => false,
      createElement: element,
      body: { classList: { add() {}, remove() {} } },
      addEventListener() {},
    },
    window: { addEventListener() {} },
    requestAnimationFrame: (callback) => setImmediate(() => callback(0)),
  };
  for (const [key, value] of Object.entries(values)) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    t.after(() =>
      previous ? Object.defineProperty(globalThis, key, previous) : delete globalThis[key],
    );
  }
}

/** The landmark manager's world: the resident cave template and a renderer. */
function caveWorld(manifest, focus = null) {
  const assets = new WorldAssets();
  assets.catalog = { assets: [] };
  const material = new THREE.MeshStandardMaterial(),
    scene = new THREE.Group();
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(30, 6, 80), material));
  const template = { asset: { modelKey: CAMP_CAVE.key, ...manifest }, gltf: { scene }, lods: [] };
  assets.templates.set(CAMP_CAVE.key, template);
  const failures = [];
  const world = {
    worldAssets: assets,
    scene: new THREE.Scene(),
    canvas: { dataset: {} },
    renderer: { capabilities: { getMaxAnisotropy: () => 16 } },
    focus,
    updateAssetDiagnostics() {},
    failWorld: (message, error) => failures.push({ message, error }),
  };
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(CAMP_CAVE.x, 2, CAMP_CAVE.z + 10);
  camera.updateMatrixWorld(true);
  return { world, assets, template, material, failures, camera };
}
/** What the cave program binds (prepareCaveMaterials' onBeforeCompile). */
function caveUniforms(material) {
  const shader = {
    uniforms: {},
    vertexShader: '#include <begin_vertex>',
    fragmentShader: [
      '#include <map_fragment>',
      '#include <roughnessmap_fragment>',
      '#include <normal_fragment_maps>',
      '#include <lights_fragment_begin>',
      '#include <lights_fragment_end>',
    ].join('\n'),
  };
  material.onBeforeCompile(shader, {});
  return shader.uniforms;
}

test('the world draws the cave only once its ten verified images are installed', async (t) => {
  browser(t);
  const disposedWith = watchDisposals(t);
  const { manifest, files } = caveManifest();
  const { world, assets, template, material, failures, camera } = caveWorld(manifest);
  const { requests, transport } = network(files);
  const decoder = pngDecoder();
  const open = gated(decoder);
  const images = { download: verified(transport), decode: decoder.decode };
  const landmarks = new WorldLandmarks(world, [CAMP_CAVE], { images });
  assert.equal(landmarks.caveImages, null, 'nothing before the cave is wanted');
  landmarks.update(camera, 0);
  assert.ok(landmarks.caveImages, 'verifying');
  assert.ok(landmarks.pending.has(CAMP_CAVE.key), 'in flight, so never released meanwhile');
  await until(() => decoder.calls.length === 10);
  landmarks.update(camera, 0.4);
  landmarks.update(camera, 0.8);
  assert.equal(requests.length, 10, 'loaded once, not every frame');
  assert.equal(landmarks.instances.size, 0, 'no cave before its images');
  assert.equal(template.cavePrepared, undefined);
  for (const key of CAVE_KEYS) open(urlOf(manifest, key));
  await landmarks.pending.get(CAMP_CAVE.key);
  assert.equal(template.cavePrepared, true);
  assert.equal(landmarks.caveImages, null);
  assert.ok(!landmarks.pending.has(CAMP_CAVE.key));
  // The program samples exactly the verified textures.
  const uniforms = caveUniforms(material);
  assert.equal(uniforms.cavePigment.value, landmarks.cavePigment);
  assert.equal(uniforms.caveLimestone.value, landmarks.caveLimestone);
  assert.equal(uniforms.caveCharacter524.value, landmarks.caveCharacter524);
  assert.equal(uniforms.caveRimoPigment.value, landmarks.caveRimoPigment);
  for (const key of Object.keys(CAVE_EXTRA_PIGMENTS))
    assert.equal(uniforms[`cave_${key}`].value, landmarks.caveExtraPigments[key]);
  assert.ok(uniforms.cave_comingSoon.value.isCanvasTexture);
  assert.equal(landmarks.caveLimestone.wrapS, THREE.RepeatWrapping);
  const installed = [
    landmarks.cavePigment,
    landmarks.caveLimestone,
    landmarks.caveCharacter524,
    landmarks.caveRimoPigment,
    ...Object.keys(CAVE_EXTRA_PIGMENTS).map((key) => landmarks.caveExtraPigments[key]),
  ];
  const installedImages = installed.map((texture) => texture.image);
  assert.deepEqual(new Set(installedImages), new Set(decoder.images));
  landmarks.update(camera, 1.2);
  assert.ok(landmarks.instances.has(CAMP_CAVE.id));
  assert.equal(requests.length, 10);
  landmarks.dispose();
  for (const image of decoder.images) {
    assert.equal(image.closed, 1);
    assert.equal(disposedWith(image), 1);
  }
  assert.equal(failures.length, 0);
  assets.dispose();
});

test('one cave image failing fails the world once and releases every sibling', async (t) => {
  browser(t);
  const disposedWith = watchDisposals(t);
  const { manifest, files } = caveManifest({ corrupt: ['rimoPigment'] });
  const { world, assets, template, failures, camera } = caveWorld(manifest);
  const { requests, transport } = network(files);
  const decoder = pngDecoder();
  const open = gated(decoder);
  const images = { download: verified(transport), decode: decoder.decode };
  const landmarks = new WorldLandmarks(world, [CAMP_CAVE], { images });
  landmarks.update(camera, 0);
  const preparing = landmarks.pending.get(CAMP_CAVE.key);
  await until(() => decoder.calls.length === 10);
  // Some siblings finish first, the Rimo frieze fails, the rest arrive late.
  for (const key of ['pigment', 'rockSurface', 'roundBots']) open(urlOf(manifest, key));
  open(urlOf(manifest, 'rimoPigment'));
  await preparing;
  assert.equal(failures.length, 1);
  assert.equal(failures[0].message, RIMO_FAILURE);
  assert.match(failures[0].error.message, /rimoPigment\.png: undecodable/);
  for (const key of CAVE_KEYS) open(urlOf(manifest, key));
  await until(() => allClosed(decoder.images, 9));
  for (const image of decoder.images) {
    assert.equal(image.closed, 1);
    assert.equal(disposedWith(image), 1);
  }
  for (let time = 0.4; time < 3; time += 0.4) landmarks.update(camera, time);
  assert.equal(requests.length, 10, 'not requested again');
  assert.equal(failures.length, 1, 'the world fails once');
  assert.equal(landmarks.instances.size, 0, 'no cave with unverified or missing paintings');
  assert.equal(template.cavePrepared, undefined);
  assert.equal(landmarks.cavePigment, undefined);
  landmarks.dispose();
  assert.ok(decoder.images.every((image) => image.closed === 1));
  assets.dispose();
});

test('a cave that cannot be installed fails the world once and keeps no half-installed image', async (t) => {
  browser(t);
  // A browser that cannot allocate the preview label's 2D canvas (getContext → null).
  globalThis.document.createElement = () => ({ ...element(), getContext: () => null });
  const disposedWith = watchDisposals(t);
  const { manifest, files } = caveManifest();
  const { world, assets, template, failures, camera } = caveWorld(manifest);
  const { requests, transport } = network(files);
  const decoder = pngDecoder();
  const images = { download: verified(transport), decode: decoder.decode };
  const landmarks = new WorldLandmarks(world, [CAMP_CAVE], { images });
  landmarks.update(camera, 0);
  // The preparation settles: no rejection is left for nobody to handle.
  await landmarks.pending.get(CAMP_CAVE.key);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].message, MURAL_FAILURE);
  assert.ok(failures[0].error instanceof TypeError);
  assert.equal(decoder.images.length, 10, 'all ten were verified and taken');
  for (const image of decoder.images) {
    assert.equal(image.closed, 1);
    assert.equal(disposedWith(image), 1);
  }
  assert.equal(template.cavePrepared, undefined);
  assert.equal(landmarks.cavePigment, undefined);
  assert.deepEqual(landmarks.caveExtraPigments, {});
  for (let time = 0.4; time < 3; time += 0.4) landmarks.update(camera, time);
  assert.equal(requests.length, 10, 'not loaded again');
  assert.equal(failures.length, 1, 'the world fails once');
  assert.equal(landmarks.instances.size, 0);
  landmarks.dispose();
  assert.ok(decoder.images.every((image) => image.closed === 1));
  assets.dispose();
});

test('leaving the world while cave images load releases them once as they arrive', async (t) => {
  browser(t);
  const disposedWith = watchDisposals(t);
  const { manifest, files } = caveManifest();
  // An arrival beside the cave starts verifying its images at once.
  const arrival = { x: CAMP_CAVE.x, z: CAMP_CAVE.z };
  const { world, assets, template, failures } = caveWorld(manifest, arrival);
  const { transport } = network(files);
  const decoder = pngDecoder();
  const open = gated(decoder);
  const images = { download: verified(transport), decode: decoder.decode };
  const landmarks = new WorldLandmarks(world, [CAMP_CAVE], { images });
  const batch = landmarks.caveImages;
  assert.ok(batch, 'started with the world');
  const preparing = landmarks.pending.get(CAMP_CAVE.key);
  await until(() => decoder.calls.length === 10);
  for (const key of CAVE_KEYS.slice(0, 4)) open(urlOf(manifest, key));
  await until(() => batch.textures.size === 4);
  landmarks.dispose();
  assert.equal(landmarks.caveImages, null);
  for (const key of CAVE_KEYS) open(urlOf(manifest, key));
  await preparing;
  await until(() => allClosed(decoder.images, 10));
  for (const image of decoder.images) {
    assert.equal(image.closed, 1);
    assert.equal(disposedWith(image), 1);
  }
  assert.equal(template.cavePrepared, undefined);
  assert.equal(failures.length, 0, 'leaving is not a failure');
  assets.dispose();
});

/** The gallery's view of the world, as the context tests build it. */
function galleryWorld(manifest) {
  const avatar = {
    root: new THREE.Group(),
    animation: { name: 'Idle_Loop', update() {} },
    dispose() {},
  };
  const cave = () => {
    const scene = new THREE.Group();
    const geometry = new THREE.BoxGeometry(30, 6, 80);
    scene.add(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial()));
    return scene;
  };
  return {
    canvas: { parentElement: element(), dataset: {} },
    worldAssets: {
      loadCatalog: async () => ({ assets: [] }),
      ensureInitial: async () => ({ asset: manifest }),
      create: cave,
    },
    humanAssets: new Map([['cro-magnon-woman', { create: async () => avatar }]]),
    renderer: {
      // A lost context: compiling waits for a restore, as in context-recovery.test.
      getContext: () => ({ isContextLost: () => true }),
      compile: () => new Set(),
      render() {},
      capabilities: { getMaxAnisotropy: () => 4 },
    },
    collision: new CollisionWorld(),
    camera: { aspect: 1 },
    loadProgress: { phase: 'download', loaded: 0, total: 0 },
  };
}
/** A gallery visit with the given verified image loading. */
const gallery = (manifest, images) =>
  new LoadingCave(galleryWorld(manifest), ignore, ignore, {
    character: 'cro-magnon-woman',
    images,
  });
function ignore() {}

test('the gallery paints only verified images and releases them when it closes', async (t) => {
  browser(t);
  const disposedWith = watchDisposals(t);
  const { manifest, files } = caveManifest({ resized: true });
  const { requests, transport } = network(files);
  const decoder = pngDecoder();
  const cave = gallery(manifest, { download: verified(transport), decode: decoder.decode });
  await cave.load();
  assert.equal(requests.length, 10);
  let mesh = null;
  cave.scene.traverse((node) => {
    if (node.isMesh) mesh = node;
  });
  const uniforms = caveUniforms(mesh.material);
  const samplers = [
    uniforms.cavePigment,
    uniforms.caveLimestone,
    uniforms.caveCharacter524,
    uniforms.caveRimoPigment,
    ...Object.keys(CAVE_EXTRA_PIGMENTS).map((key) => uniforms[`cave_${key}`]),
  ];
  const painted = samplers.map(({ value }) => value.image);
  assert.deepEqual(new Set(painted), new Set(decoder.images), 'every sampler is a verified image');
  assert.equal(uniforms.caveLimestone.value.wrapS, THREE.RepeatWrapping);
  cave.dispose();
  for (const image of decoder.images) {
    assert.equal(image.closed, 1);
    assert.equal(disposedWith(image), 1);
  }
});

test('the gallery fails on one bad image, releasing the rest, and leaving mid-decode is quiet', async (t) => {
  browser(t);
  const disposedWith = watchDisposals(t);
  {
    const { manifest, files } = caveManifest({ corrupt: ['friendsRiver'] });
    const decoder = pngDecoder();
    const transport = network(files).transport;
    const cave = gallery(manifest, { download: verified(transport), decode: decoder.decode });
    await assert.rejects(cave.load(), /friendsRiver\.png: undecodable/);
    await until(() => allClosed(decoder.images, 9));
    cave.dispose();
    for (const image of decoder.images) {
      assert.equal(image.closed, 1);
      assert.equal(disposedWith(image), 1);
    }
  }
  const { manifest, files } = caveManifest();
  const decoder = pngDecoder();
  const open = gated(decoder);
  const transport = network(files).transport;
  const cave = gallery(manifest, { download: verified(transport), decode: decoder.decode });
  const loading = cave.load();
  await until(() => decoder.calls.length === 10);
  for (const key of CAVE_KEYS.slice(0, 4)) open(urlOf(manifest, key));
  await until(() => cave.images?.textures.size === 4);
  cave.dispose();
  for (const key of CAVE_KEYS) open(urlOf(manifest, key));
  assert.equal(await loading, undefined, 'the visit ends quietly');
  await until(() => allClosed(decoder.images, 10));
  for (const image of decoder.images) {
    assert.equal(image.closed, 1);
    assert.equal(disposedWith(image), 1);
  }
  assert.equal(cave.textures.size, 0, 'the gallery kept none of them');
  assert.equal(cave.images, null);
});

test('no image load leaves an unhandled rejection', async () => {
  await tick();
  assert.deepEqual(unhandled, []);
});
