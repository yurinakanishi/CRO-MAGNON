// Synthetic, test-only GLB models (never game assets) compressed with the pinned
// meshoptimizer 1.1.1 encoder, and the browser services three r185's GLTFLoader
// needs in Node. Only image decoding is a stand-in (decodeImages), reached through
// GLTFLoader's own ImageBitmapLoader.
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { MeshoptEncoder } from 'meshoptimizer';

export const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const padding4 = (length) => (4 - (length % 4)) % 4;
export const arrayBuffer = (bytes) =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
export const settle = () => new Promise(setImmediate);
export const deferred = () => {
  let resolve;
  const promise = new Promise((done) => (resolve = done));
  return { promise, resolve };
};

export const PNG = Buffer.from('fallback PNG bytes of the albedo');
export const WEBP = Buffer.from('selected WebP bytes of the albedo');
export const BROKEN = Buffer.from('bytes no browser can decode');

/** Replace browser globals for one test; restored afterwards. */
export function globalsFor(t, values) {
  for (const [key, value] of Object.entries(values)) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    t.after(() =>
      previous ? Object.defineProperty(globalThis, key, previous) : delete globalThis[key],
    );
  }
}

function packGlb(json, bin) {
  const text = Buffer.from(JSON.stringify(json)),
    jsonLength = text.length + padding4(text.length),
    binLength = bin.length + padding4(bin.length),
    total = 20 + jsonLength + (bin.length ? 8 + binLength : 0),
    out = Buffer.alloc(total);
  out.writeUInt32LE(0x46546c67, 0);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(total, 8);
  out.writeUInt32LE(jsonLength, 12);
  out.writeUInt32LE(0x4e4f534a, 16);
  out.fill(0x20, 20, 20 + jsonLength);
  text.copy(out, 20);
  if (bin.length) {
    out.writeUInt32LE(binLength, 20 + jsonLength);
    out.writeUInt32LE(0x004e4942, 24 + jsonLength);
    bin.copy(out, 28 + jsonLength);
  }
  return out;
}

/** A triangle whose positions and indices are EXT_meshopt_compression streams (their
 * logical views live in a fallback buffer without data), textured by one image with
 * a PNG `source` and an EXT_texture_webp source, which GLTFLoader prefers.
 *
 * `rig` makes it a skinned, animated character with two scenes, as delivered models
 * are: the triangle ("Body") is weighted to one joint ("Bone") whose translation the
 * clip "Idle_Loop" animates; a second scene holds another triangle ("Second") whose
 * material samples the PNG; the root carries glTF extras. Skin, clip and the second
 * triangle are plain views of the binary chunk, returned as `rig` for comparison. */
export async function compressedModel({
  change = () => {},
  images = [PNG, WEBP],
  corrupt = false,
  rig = false,
} = {}) {
  await MeshoptEncoder.ready;
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    indices = new Uint16Array([0, 1, 2]);
  const streams = [
    [new Uint8Array(positions.buffer), 12, 'ATTRIBUTES'],
    [new Uint8Array(indices.buffer), 2, 'TRIANGLES'],
  ];
  const parts = [];
  let length = 0;
  const store = (bytes) => {
    const pad = padding4(length);
    if (pad) parts.push(Buffer.alloc(pad));
    length += pad;
    // A copy of the bytes of any typed array.
    parts.push(Buffer.from(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)));
    length += bytes.byteLength;
    return length - bytes.byteLength;
  };
  const views = streams.map(([source, stride, mode], index) => {
    // Version 0: the attribute codec EXT_meshopt_compression allows.
    const encoded = MeshoptEncoder.encodeGltfBuffer(source, 3, stride, mode, 0);
    if (corrupt && mode === 'ATTRIBUTES') encoded[0] = 0;
    return {
      buffer: 1,
      byteOffset: index ? 36 : 0,
      byteLength: source.length,
      extensions: {
        EXT_meshopt_compression: {
          buffer: 0,
          byteOffset: store(encoded),
          byteLength: encoded.length,
          byteStride: stride,
          count: 3,
          mode,
        },
      },
    };
  });
  for (const image of images)
    views.push({ buffer: 0, byteOffset: store(image), byteLength: image.length });
  const data = rig
    ? {
        joints: new Uint8Array(12),
        weights: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]),
        times: new Float32Array([0, 1]),
        moves: new Float32Array([0, 0, 0, 0, 0.5, 0]),
        second: new Float32Array([0, 0, 0, 0, 0, 2, 2, 0, 0]),
      }
    : null;
  const plain = (array) => {
    views.push({ buffer: 0, byteOffset: store(array), byteLength: array.byteLength });
    return views.length - 1;
  };
  const json = {
    asset: { version: '2.0' },
    extensionsUsed: ['EXT_meshopt_compression', 'EXT_texture_webp'],
    extensionsRequired: ['EXT_meshopt_compression'],
    buffers: [
      { byteLength: 0 },
      { byteLength: 42, extensions: { EXT_meshopt_compression: { fallback: true } } },
    ],
    bufferViews: views,
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 3,
        type: 'VEC3',
        min: [0, 0, 0],
        max: [1, 1, 0],
      },
      { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' },
    ],
    images: images.map((_, index) => ({
      bufferView: 2 + index,
      mimeType: index ? 'image/webp' : 'image/png',
    })),
    samplers: [{}],
    textures: [{ sampler: 0, source: 0, extensions: { EXT_texture_webp: { source: 1 } } }],
    materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }],
    nodes: [{ mesh: 0 }],
    scenes: [{ nodes: [0] }],
    scene: 0,
  };
  if (rig) {
    json.asset.generator = 'embedded-glb test';
    json.extras = { review: 'rig' };
    json.accessors.push(
      { bufferView: plain(data.joints), componentType: 5121, count: 3, type: 'VEC4' },
      { bufferView: plain(data.weights), componentType: 5126, count: 3, type: 'VEC4' },
      {
        bufferView: plain(data.times),
        componentType: 5126,
        count: 2,
        type: 'SCALAR',
        min: [0],
        max: [1],
      },
      { bufferView: plain(data.moves), componentType: 5126, count: 2, type: 'VEC3' },
      {
        bufferView: plain(data.second),
        componentType: 5126,
        count: 3,
        type: 'VEC3',
        min: [0, 0, 0],
        max: [2, 0, 2],
      },
    );
    Object.assign(json.meshes[0].primitives[0].attributes, { JOINTS_0: 2, WEIGHTS_0: 3 });
    json.meshes.push({ primitives: [{ attributes: { POSITION: 6 }, material: 1 }] });
    json.textures.push({ sampler: 0, source: 0 });
    json.materials.push({ pbrMetallicRoughness: { baseColorTexture: { index: 1 } } });
    json.nodes = [
      { name: 'Body', mesh: 0, skin: 0 },
      { name: 'Bone' },
      { name: 'Second', mesh: 1 },
    ];
    json.skins = [{ joints: [1] }];
    json.scenes = [{ nodes: [0, 1] }, { name: 'Alternate', nodes: [2] }];
    json.animations = [
      {
        name: 'Idle_Loop',
        samplers: [{ input: 4, output: 5 }],
        channels: [{ sampler: 0, target: { node: 1, path: 'translation' } }],
      },
    ];
  }
  json.buffers[0].byteLength = length;
  change(json);
  return { json, glb: packGlb(json, Buffer.concat(parts, length)), positions, rig: data };
}

/** The browser's image decoding for GLTFLoader in Node: blob URLs resolve to their
 * bytes and each decode yields a stand-in ImageBitmap that records close(). Bytes
 * matching `fails` do not decode, reported the way ImageBitmapLoader reports it;
 * `hold` may keep a decode pending. */
export function decodeImages(t, { fails = () => false, hold = async () => {} } = {}) {
  const blobs = new Map(),
    bitmaps = [];
  if (typeof self === 'undefined') globalsFor(t, { self: globalThis });
  globalsFor(t, { createImageBitmap: () => Promise.reject(new Error('decoded by the stub')) });
  t.mock.method(URL, 'createObjectURL', (blob) => {
    const url = `blob:test/${blobs.size}`;
    blobs.set(url, blob);
    return url;
  });
  t.mock.method(URL, 'revokeObjectURL', () => {});
  t.mock.method(THREE.ImageBitmapLoader.prototype, 'load', function (url, onLoad, _, onError) {
    const resolved = this.manager.resolveURL(url);
    this.manager.itemStart(resolved);
    blobs
      .get(resolved)
      .arrayBuffer()
      .then(async (buffer) => {
        const bytes = Buffer.from(buffer);
        await hold(bytes);
        if (fails(bytes)) {
          onError?.(new Error('undecodable image'));
          this.manager.itemError(resolved);
        } else {
          const bitmap = {
            width: 1,
            height: 1,
            bytes,
            closed: 0,
            close() {
              this.closed++;
            },
          };
          bitmaps.push(bitmap);
          onLoad(bitmap);
        }
        this.manager.itemEnd(resolved);
      });
  });
  return bitmaps;
}

/** This game's origin and the files it serves; every other path is a 404. */
export function serve(t, files, place = { origin: 'http://asset.test' }) {
  globalsFor(t, { location: place });
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    const path = new URL(String(url), place.origin).pathname,
      file = files[path];
    requests.push(path);
    if (file === undefined) return new Response(null, { status: 404 });
    if (typeof file === 'function') return file();
    return Buffer.isBuffer(file) ? new Response(file) : Response.json(file);
  });
  return requests;
}

export const record = (url, glb) => ({ url, bytes: glb.length, sha256: sha(glb) });
export const firstMesh = (gltf) => gltf.scene.getObjectByProperty('isMesh', true);

/** Which of `targets` can be reached from `root` through own enumerable fields,
 * array items, Map and Set entries and the buffers of typed arrays: what a retained
 * object keeps alive, closures aside. */
export function reachable(root, targets) {
  const wanted = new Set(targets),
    found = new Set(),
    seen = new Set(),
    stack = [root];
  while (stack.length) {
    const value = stack.pop();
    if (typeof value !== 'object' || value === null || seen.has(value)) continue;
    seen.add(value);
    if (wanted.has(value)) found.add(value);
    if (ArrayBuffer.isView(value)) stack.push(value.buffer);
    if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) continue;
    if (value instanceof Map) for (const [key, item] of value) stack.push(key, item);
    if (value instanceof Set) for (const item of value) stack.push(item);
    for (const key of Object.keys(value)) stack.push(value[key]);
  }
  return found;
}
