// Exact level packing and image substitution for static environment templates. Promoted from the
// executed lod-packed-proof-r10 library (output/optimization-audit-20261009/lod-packed-proof-r10.md:
// run02/run03 identical, native Chrome/WebKit pixels, texture counts and isolation passed).
//
// Packing: one GLB per template, scene i is level i.
//   - Each level keeps its own nodes, meshes, accessors, materials, textures, images and samplers.
//   - Buffer views are copied byte for byte: a meshopt view keeps its exact compressed stream, and
//     its logical range moves into the single fallback buffer.
//   - Only views holding nothing but images are deduplicated, when bytes, MIME type and view
//     metadata are identical.
//   - Samplers merge across levels only where Three r185 would share one Texture with one colour
//     space. A samplerless conflict is refused.
//   - Anything not remappable is refused, never copied: unknown keys or extensions, skins,
//     animations, cameras, external resources, several scenes, KTX2.
// Image substitution: a PNG view's bytes are replaced by a validated lossless IDAT rewrite
// (png-idat.mjs). Only that view's bytes and length, stored offsets and buffer 0's length change;
// every other stored byte (meshopt streams included) is copied verbatim.
// Verification reads the written bytes alone. Each scene is compared canonically with its original
// level, with PNG identity aware of the lossless rewrite and every packed image byte mapped to its
// original or its recorded rewrite. A second decode by Three r185 compares geometry and material
// parameters per scene. Pure apart from the lazy Three import.
import {
  MESHOPT,
  accessorElements,
  asBuffer,
  jsonDifference,
  packGlb,
  padding4,
  parseGlb,
  primitiveTriangles,
  sha256,
  storedViewBytes,
  validateDocument,
} from './glb.mjs';
import { checkExtensions, viewUsage } from './gltf-usage.mjs';
import { checkLosslessRewrite, pngIdentity } from './png-idat.mjs';
import { checkStorage, decodeViews } from './verify.mjs';

export const WEBP = 'EXT_texture_webp';
const TRANSFORM = 'KHR_texture_transform';
const BASISU = 'KHR_texture_basisu';
const EXT_HEADERS = Object.freeze({ ATTRIBUTES: 0xa0, TRIANGLES: 0xe1, INDICES: 0xd1 });

// ---------------------------------------------------------------------------------------------
// Supported structure: every key packing remaps or copies, per object type.

const ALLOWED = Object.freeze({
  root: [
    'asset',
    'scene',
    'scenes',
    'nodes',
    'meshes',
    'accessors',
    'bufferViews',
    'buffers',
    'materials',
    'textures',
    'images',
    'samplers',
    'extensionsUsed',
    'extensionsRequired',
    'extras',
    'skins',
    'animations',
    'cameras',
  ],
  asset: ['version', 'generator', 'copyright', 'minVersion', 'extras'],
  scene: ['nodes', 'name', 'extras'],
  node: [
    'children',
    'mesh',
    'matrix',
    'translation',
    'rotation',
    'scale',
    'weights',
    'name',
    'extras',
  ],
  mesh: ['primitives', 'weights', 'name', 'extras'],
  primitive: ['attributes', 'indices', 'material', 'mode', 'targets', 'extras'],
  accessor: [
    'bufferView',
    'byteOffset',
    'componentType',
    'normalized',
    'count',
    'type',
    'max',
    'min',
    'sparse',
    'name',
    'extras',
  ],
  sparse: ['count', 'indices', 'values', 'extras'],
  sparseIndices: ['bufferView', 'byteOffset', 'componentType', 'extras'],
  sparseValues: ['bufferView', 'byteOffset', 'extras'],
  bufferView: [
    'buffer',
    'byteOffset',
    'byteLength',
    'byteStride',
    'target',
    'name',
    'extras',
    'extensions',
  ],
  buffer: ['byteLength', 'extensions', 'name', 'extras'],
  material: [
    'name',
    'pbrMetallicRoughness',
    'normalTexture',
    'occlusionTexture',
    'emissiveTexture',
    'emissiveFactor',
    'alphaMode',
    'alphaCutoff',
    'doubleSided',
    'extras',
    'extensions',
  ],
  pbr: [
    'baseColorFactor',
    'baseColorTexture',
    'metallicFactor',
    'roughnessFactor',
    'metallicRoughnessTexture',
    'extras',
  ],
  textureInfo: ['index', 'texCoord', 'scale', 'strength', 'extras', 'extensions'],
  texture: ['sampler', 'source', 'name', 'extras', 'extensions'],
  image: ['bufferView', 'mimeType', 'name', 'extras'],
  sampler: ['magFilter', 'minFilter', 'wrapS', 'wrapT', 'name', 'extras'],
});
const EXTENSIONS_AT = Object.freeze({
  bufferView: {
    [MESHOPT]: ['buffer', 'byteOffset', 'byteLength', 'byteStride', 'count', 'mode', 'filter'],
  },
  buffer: { [MESHOPT]: ['fallback'] },
  texture: { [WEBP]: ['source'] },
  textureInfo: { [TRANSFORM]: ['offset', 'rotation', 'scale', 'texCoord'] },
  material: {
    KHR_materials_emissive_strength: ['emissiveStrength'],
    KHR_materials_unlit: [],
    KHR_materials_ior: ['ior'],
  },
});
// Core material texture slots and the colour space GLTFLoader r185 assigns for each.
export const SLOTS = Object.freeze([
  { path: ['pbrMetallicRoughness', 'baseColorTexture'], colorSpace: 'srgb' },
  { path: ['pbrMetallicRoughness', 'metallicRoughnessTexture'], colorSpace: 'linear' },
  { path: ['normalTexture'], colorSpace: 'linear' },
  { path: ['occlusionTexture'], colorSpace: 'linear' },
  { path: ['emissiveTexture'], colorSpace: 'srgb' },
]);

const isObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
const isIndex = (value, length) => Number.isInteger(value) && value >= 0 && value < length;
const omit = (value, keys) =>
  Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));
const clone = (value) => (value === undefined ? undefined : structuredClone(value));
const textureInfoAt = (material, path) => path.reduce((value, key) => value?.[key], material);

function keysAllowed(value, type, where, fail) {
  if (!isObject(value)) fail(`${where} is not an object`);
  for (const key of Object.keys(value))
    if (!ALLOWED[type].includes(key)) fail(`${where} has unsupported property "${key}"`);
}

function extensionsAllowed(value, type, where, fail) {
  if (value.extensions === undefined) return;
  if (!isObject(value.extensions)) fail(`${where}.extensions is not an object`);
  const allowed = EXTENSIONS_AT[type] ?? {};
  for (const [name, data] of Object.entries(value.extensions)) {
    if (!(name in allowed)) fail(`${where}.extensions.${name} is not supported here`);
    if (!isObject(data)) fail(`${where}.extensions.${name} is not an object`);
    for (const key of Object.keys(data))
      if (!allowed[name].includes(key) && key !== 'extras')
        fail(`${where}.extensions.${name} has unsupported property "${key}"`);
  }
}

function materialTextureUses(material, where, fail) {
  const uses = [];
  for (const slot of SLOTS) {
    const info = textureInfoAt(material, slot.path);
    if (info !== undefined)
      uses.push({ slot: slot.path.join('.'), colorSpace: slot.colorSpace, info });
  }
  const known = new Set(uses.map((use) => use.info));
  const walk = (value, at) => {
    if (Array.isArray(value)) return value.forEach((item, i) => walk(item, `${at}[${i}]`));
    if (!isObject(value)) return;
    for (const [key, child] of Object.entries(value)) {
      if (key === 'extras') continue;
      if (key === 'index' && !known.has(value))
        fail(`${at} names a texture outside the supported slots`);
      walk(child, `${at}.${key}`);
    }
  };
  walk(material, where);
  return uses;
}

/** Refuse anything packing cannot remap exactly. `sceneCount` is 1 for a level, N for a packed file. */
export function checkSupported(json, label, { sceneCount = 1 } = {}) {
  const fail = (message) => {
    throw new Error(`${label}: ${message}`);
  };
  (json.buffers ?? []).forEach((buffer, index) => {
    if (buffer?.uri !== undefined)
      fail(`buffer ${index} has an external or data URI; only the embedded BIN is allowed`);
  });
  (json.images ?? []).forEach((image, index) => {
    if (image?.uri !== undefined)
      fail(`image ${index} has an external or data URI; only embedded images are allowed`);
  });
  keysAllowed(json, 'root', '$', fail);
  for (const key of ['skins', 'animations', 'cameras'])
    if (json[key] !== undefined && (!Array.isArray(json[key]) || json[key].length))
      fail(`${key} are present; static environment templates must have none`);
  if (
    (json.extensionsUsed ?? []).includes(BASISU) ||
    (json.extensionsRequired ?? []).includes(BASISU)
  )
    fail(`${BASISU} is not loadable by the runtime`);
  keysAllowed(json.asset, 'asset', '$.asset', fail);
  if (json.asset.version !== '2.0') fail('asset.version is not "2.0"');
  if (!Array.isArray(json.scenes) || json.scenes.length !== sceneCount)
    fail(`expected exactly ${sceneCount} scene(s), found ${json.scenes?.length ?? 0}`);
  if (json.scene !== undefined && json.scene !== 0) fail('the default scene is not scene 0');
  const nodes = json.nodes ?? [],
    parents = new Array(nodes.length).fill(-1);
  json.scenes.forEach((scene, s) => {
    keysAllowed(scene, 'scene', `scene ${s}`, fail);
    if (!Array.isArray(scene.nodes) || !scene.nodes.length) fail(`scene ${s} has no nodes`);
  });
  nodes.forEach((node, n) => {
    keysAllowed(node, 'node', `node ${n}`, fail);
    for (const child of node.children ?? []) {
      if (!isIndex(child, nodes.length)) fail(`node ${n} has a missing child ${child}`);
      if (parents[child] !== -1) fail(`node ${child} has more than one parent`);
      parents[child] = n;
    }
  });
  // Every node belongs to exactly one scene tree.
  const reached = new Set();
  json.scenes.forEach((scene, s) => {
    const stack = [];
    for (const root of scene.nodes) {
      if (!isIndex(root, nodes.length)) fail(`scene ${s} names a missing node ${root}`);
      if (parents[root] !== -1) fail(`scene ${s} root ${root} is also a child`);
      stack.push(root);
    }
    while (stack.length) {
      const node = stack.pop();
      if (reached.has(node)) fail(`node ${node} is reached twice (cycle or shared between scenes)`);
      reached.add(node);
      stack.push(...(nodes[node].children ?? []));
    }
  });
  if (reached.size !== nodes.length)
    fail(`${nodes.length - reached.size} node(s) are not in any scene`);
  (json.meshes ?? []).forEach((mesh, m) => {
    keysAllowed(mesh, 'mesh', `mesh ${m}`, fail);
    (mesh.primitives ?? []).forEach((primitive, p) =>
      keysAllowed(primitive, 'primitive', `mesh ${m} primitive ${p}`, fail),
    );
  });
  (json.accessors ?? []).forEach((accessor, a) => {
    keysAllowed(accessor, 'accessor', `accessor ${a}`, fail);
    if (accessor.sparse) {
      keysAllowed(accessor.sparse, 'sparse', `accessor ${a} sparse`, fail);
      keysAllowed(accessor.sparse.indices, 'sparseIndices', `accessor ${a} sparse indices`, fail);
      keysAllowed(accessor.sparse.values, 'sparseValues', `accessor ${a} sparse values`, fail);
    }
  });
  (json.bufferViews ?? []).forEach((view, v) => {
    keysAllowed(view, 'bufferView', `buffer view ${v}`, fail);
    extensionsAllowed(view, 'bufferView', `buffer view ${v}`, fail);
  });
  (json.buffers ?? []).forEach((buffer, b) => {
    keysAllowed(buffer, 'buffer', `buffer ${b}`, fail);
    extensionsAllowed(buffer, 'buffer', `buffer ${b}`, fail);
  });
  const textures = json.textures ?? [],
    images = json.images ?? [],
    samplers = json.samplers ?? [];
  (json.materials ?? []).forEach((material, m) => {
    const where = `material ${m}`;
    keysAllowed(material, 'material', where, fail);
    extensionsAllowed(material, 'material', where, fail);
    if (material.pbrMetallicRoughness !== undefined)
      keysAllowed(material.pbrMetallicRoughness, 'pbr', `${where}.pbrMetallicRoughness`, fail);
    for (const use of materialTextureUses(material, where, fail)) {
      keysAllowed(use.info, 'textureInfo', `${where}.${use.slot}`, fail);
      extensionsAllowed(use.info, 'textureInfo', `${where}.${use.slot}`, fail);
      if (!isIndex(use.info.index, textures.length))
        fail(`${where}.${use.slot} names a missing texture`);
    }
  });
  textures.forEach((texture, t) => {
    keysAllowed(texture, 'texture', `texture ${t}`, fail);
    extensionsAllowed(texture, 'texture', `texture ${t}`, fail);
    if (texture.sampler !== undefined && !isIndex(texture.sampler, samplers.length))
      fail(`texture ${t} names a missing sampler`);
    if (texture.source !== undefined && !isIndex(texture.source, images.length))
      fail(`texture ${t} names a missing image`);
    const webp = texture.extensions?.[WEBP];
    if (webp && !isIndex(webp.source, images.length))
      fail(`texture ${t} ${WEBP} names a missing image`);
    if (texture.source === undefined && !webp) fail(`texture ${t} selects no image`);
  });
  images.forEach((image, i) => {
    keysAllowed(image, 'image', `image ${i}`, fail);
    if (!isIndex(image.bufferView, (json.bufferViews ?? []).length))
      fail(`image ${i} has no buffer view`);
  });
  samplers.forEach((sampler, s) => keysAllowed(sampler, 'sampler', `sampler ${s}`, fail));
}

/** Stable JSON text (sorted keys) for identity keys. */
export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (isObject(value))
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  return JSON.stringify(value === undefined ? null : value);
}

/** The image GLTFLoader r185 decodes for a texture (EXT_texture_webp first, as embedded-glb.ts). */
export const selectedImage = (texture) => texture.extensions?.[WEBP]?.source ?? texture.source;

/** Every material use of every texture: slot, colour space, and whether GLTFLoader clones it. */
export function textureUses(json) {
  const uses = (json.textures ?? []).map(() => []);
  (json.materials ?? []).forEach((material, m) => {
    for (const slot of SLOTS) {
      const info = textureInfoAt(material, slot.path);
      if (info === undefined) continue;
      uses[info.index].push({
        material: m,
        slot: slot.path.join('.'),
        colorSpace: slot.colorSpace,
        clones: (info.texCoord ?? 0) > 0 || !!info.extensions?.[TRANSFORM],
      });
    }
  });
  return uses;
}

/** GLTFLoader r185 texture cache groups: textures sharing (selected image's buffer view, sampler index). */
export function threeTextureGroups(json) {
  const groups = new Map();
  (json.textures ?? []).forEach((texture, t) => {
    const key = `${json.images[selectedImage(texture)].bufferView}:${texture.sampler ?? 'none'}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  });
  return groups;
}

function viewShape(json, bin, index, { image = false } = {}) {
  const view = json.bufferViews[index],
    ext = view.extensions?.[MESHOPT];
  return {
    // An image view's length follows its (possibly rewritten) bytes; the image identity covers it.
    ...(image ? {} : { byteLength: view.byteLength }),
    byteStride: view.byteStride ?? null,
    target: view.target ?? null,
    name: view.name ?? null,
    extras: clone(view.extras) ?? null,
    meshopt: ext
      ? {
          byteLength: ext.byteLength,
          byteStride: ext.byteStride,
          count: ext.count,
          mode: ext.mode,
          filter: ext.filter ?? null,
          extras: clone(ext.extras) ?? null,
          stream: sha256(bin.subarray(ext.byteOffset ?? 0, (ext.byteOffset ?? 0) + ext.byteLength)),
        }
      : null,
  };
}

/** Logical bytes of every view, decoded twice: npm meshoptimizer (verify.mjs) and Three's decoder. */
export async function decodeBoth(doc, label) {
  const npm = await decodeViews(doc, label),
    { MeshoptDecoder } = await import('three/addons/libs/meshopt_decoder.module.js');
  await MeshoptDecoder.ready;
  (doc.json.bufferViews ?? []).forEach((view, index) => {
    const ext = view.extensions?.[MESHOPT];
    if (!ext) return;
    const offset = ext.byteOffset ?? 0,
      source = new Uint8Array(doc.bin.subarray(offset, offset + ext.byteLength));
    if (source[0] !== EXT_HEADERS[ext.mode])
      throw new Error(
        `${label}: view ${index} ${ext.mode} stream header 0x${source[0].toString(16)}`,
      );
    const target = new Uint8Array(ext.count * ext.byteStride);
    MeshoptDecoder.decodeGltfBuffer(
      target,
      ext.count,
      ext.byteStride,
      source,
      ext.mode,
      ext.filter,
    );
    if (!Buffer.from(target.buffer).equals(asBuffer(npm.views[index])))
      throw new Error(`${label}: view ${index}: the Three and meshoptimizer decoders disagree`);
  });
  return { views: npm.views, regions: npm.regions };
}

// ---------------------------------------------------------------------------------------------
// Image substitution: PNG views replaced by validated lossless rewrites, everything else verbatim.

/**
 * `replacements` maps an original PNG's SHA-256 to its rewrite's bytes. Returns
 * { json, bin, substituted: [{ view, images, from, to }] }. With nothing to replace, the input
 * document is returned unchanged.
 */
export function substituteImages(doc, replacements, label) {
  const json = doc.json,
    bin = doc.bin,
    usage = viewUsage(json),
    planned = new Map();
  (json.bufferViews ?? []).forEach((view, v) => {
    const use = usage[v];
    if (!use.images.length) return;
    if (use.accessors.length || use.sparse)
      throw new Error(`${label}: buffer view ${v} holds an image and other data`);
    const bytes = storedViewBytes(json, bin, v),
      digest = sha256(bytes),
      replacement = replacements.get(digest);
    if (!replacement) return;
    if (use.images.some((image) => json.images[image].mimeType !== 'image/png'))
      throw new Error(`${label}: buffer view ${v} is replaced as PNG but declared otherwise`);
    checkLosslessRewrite(bytes, replacement, `${label} view ${v}`);
    planned.set(v, {
      view: v,
      images: [...use.images],
      from: { sha256: digest, bytes: bytes.length },
      to: { sha256: sha256(replacement), bytes: replacement.length },
      data: replacement,
    });
  });
  if (!planned.size) return { json, bin, substituted: [] };
  // Lay out buffer 0 in view order, 4-byte aligned, as meshopt-pack.mjs and packing do.
  const out = structuredClone(json),
    parts = [];
  let length = 0;
  const store = (bytes) => {
    const pad = padding4(length);
    if (pad) {
      parts.push(Buffer.alloc(pad));
      length += pad;
    }
    const at = length;
    parts.push(asBuffer(bytes));
    length += bytes.length;
    return at;
  };
  out.bufferViews.forEach((view, v) => {
    const ext = view.extensions?.[MESHOPT];
    if (ext) {
      const offset = ext.byteOffset ?? 0;
      ext.byteOffset = store(bin.subarray(offset, offset + ext.byteLength));
      return;
    }
    if (view.buffer !== 0)
      throw new Error(`${label}: buffer view ${v} stores data outside the GLB buffer`);
    const replacement = planned.get(v);
    view.byteOffset = store(replacement ? replacement.data : storedViewBytes(json, bin, v));
    if (replacement) view.byteLength = replacement.data.length;
  });
  out.buffers[0].byteLength = length;
  return {
    json: out,
    bin: Buffer.concat(parts, length),
    substituted: [...planned.values()].map(({ data, ...item }) => item),
  };
}

/** Leaf paths where two JSON values differ. */
function changedPaths(a, b, where = '$', out = []) {
  if (a === b) return out;
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length)
    a.forEach((value, i) => changedPaths(value, b[i], `${where}[${i}]`, out));
  else if (isObject(a) && isObject(b))
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)]))
      if (Object.hasOwn(a, key) && Object.hasOwn(b, key))
        changedPaths(a[key], b[key], `${where}.${key}`, out);
      else out.push(`${where}.${key}`);
  else out.push(where);
  return out;
}

/**
 * The substituted document against its original: JSON changes only at stored offsets, buffer 0's
 * length and replaced image views' lengths; every non-image stored byte identical; every image
 * either identical or the recorded lossless rewrite. Returns the problems found.
 */
export function substitutionProblems(original, substituted, replacements, label) {
  const problems = [],
    usage = viewUsage(original.json),
    allowed = new Set(['$.buffers[0].byteLength']);
  original.json.bufferViews.forEach((view, v) => {
    if (view.extensions?.[MESHOPT])
      allowed.add(`$.bufferViews[${v}].extensions.${MESHOPT}.byteOffset`);
    else allowed.add(`$.bufferViews[${v}].byteOffset`);
    if (usage[v].images.length) allowed.add(`$.bufferViews[${v}].byteLength`);
  });
  for (const path of changedPaths(original.json, substituted.json))
    if (!allowed.has(path)) problems.push(`${label}: ${path} changed`);
  if (problems.length) return problems;
  original.json.bufferViews.forEach((view, v) => {
    const ext = view.extensions?.[MESHOPT],
      stored = (doc) => {
        const target = doc.json.bufferViews[v].extensions?.[MESHOPT];
        if (target)
          return doc.bin.subarray(
            target.byteOffset ?? 0,
            (target.byteOffset ?? 0) + target.byteLength,
          );
        return storedViewBytes(doc.json, doc.bin, v);
      },
      before = stored(original),
      after = stored(substituted);
    if (ext || !usage[v].images.length) {
      if (!before.equals(after)) problems.push(`${label}: buffer view ${v} stored bytes changed`);
      return;
    }
    if (before.equals(after)) return;
    const recorded = replacements.get(sha256(before));
    if (!recorded || !recorded.equals(after))
      problems.push(`${label}: image view ${v} holds bytes that are not its recorded rewrite`);
    else
      try {
        checkLosslessRewrite(before, after, `${label} view ${v}`);
      } catch (error) {
        problems.push(error.message);
      }
  });
  try {
    validateDocument(substituted.json, substituted.bin, label, { allowMeshopt: true });
  } catch (error) {
    problems.push(error.message);
  }
  return problems;
}

// ---------------------------------------------------------------------------------------------
// Packing

/** Pack `levels` ([{ label, doc }], level 0 first) into one GLB; scene i is level i. */
export function packLevels(levels, label) {
  const fail = (message) => {
    throw new Error(`${label}: ${message}`);
  };
  if (levels.length < 2) fail('packing needs at least two levels');
  for (const level of levels) {
    checkSupported(level.doc.json, level.label);
    validateDocument(level.doc.json, level.doc.bin, level.label, { allowMeshopt: true });
    checkExtensions(level.doc.json, level.label, { allowMeshopt: true });
  }
  const first = levels[0].doc.json,
    out = {
      asset: clone(first.asset),
      scene: 0,
      scenes: [],
      nodes: [],
      meshes: [],
      accessors: [],
      bufferViews: [],
      materials: [],
      textures: [],
      images: [],
      samplers: [],
    },
    planned = [],
    imageViews = new Map(),
    textureLevel = [],
    report = {
      levels: [],
      deduplicatedImageViews: [],
      notDeduplicated: [],
      droppedBufferMetadata: [],
      differingRootMetadata: [],
    };
  if (first.extras !== undefined) out.extras = clone(first.extras);
  levels.slice(1).forEach((level, i) => {
    for (const key of ['asset', 'extras'])
      if (jsonDifference(level.doc.json[key], first[key]))
        report.differingRootMetadata.push({
          level: i + 1,
          key,
          value: clone(level.doc.json[key]) ?? null,
        });
  });
  levels.forEach((level, L) => {
    const json = level.doc.json,
      bin = level.doc.bin,
      usage = viewUsage(json),
      base = {
        node: out.nodes.length,
        mesh: out.meshes.length,
        accessor: out.accessors.length,
        material: out.materials.length,
        texture: out.textures.length,
        image: out.images.length,
        sampler: out.samplers.length,
      },
      viewMap = [];
    (json.buffers ?? []).forEach((buffer, b) => {
      const meta = omit(buffer, ['byteLength', 'extensions']);
      if (Object.keys(meta).length)
        report.droppedBufferMetadata.push({ level: L, buffer: b, ...meta });
    });
    (json.bufferViews ?? []).forEach((view, v) => {
      const use = usage[v],
        imageOnly = use.images.length > 0 && !use.accessors.length && !use.sparse;
      if (use.images.length && !imageOnly)
        fail(`${level.label}: buffer view ${v} holds an image and other data`);
      let key = null;
      if (imageOnly) {
        const mimes = new Set(use.images.map((image) => json.images[image].mimeType));
        if (mimes.size !== 1)
          fail(`${level.label}: images sharing buffer view ${v} declare different MIME types`);
        const bytes = storedViewBytes(json, bin, v),
          shape = viewShape(json, bin, v);
        key = stableJson({
          sha256: sha256(bytes),
          length: bytes.length,
          mime: [...mimes][0],
          shape,
        });
        const existing = imageViews.get(key);
        if (existing !== undefined) {
          viewMap[v] = existing;
          report.deduplicatedImageViews.push({
            level: L,
            sourceView: v,
            intoView: existing,
            bytes: bytes.length,
            sha256: sha256(bytes),
            mimeType: [...mimes][0],
          });
          return;
        }
        for (const other of imageViews.keys())
          if (JSON.parse(other).sha256 === sha256(bytes) && other !== key)
            report.notDeduplicated.push({
              level: L,
              sourceView: v,
              reason: 'identical bytes, different MIME or view metadata',
            });
      }
      const index = out.bufferViews.length,
        { buffer: _b, byteOffset: _o, extensions, ...rest } = view,
        copy = clone(rest),
        ext = extensions?.[MESHOPT];
      if (ext) {
        const { buffer: _eb, byteOffset: _eo, ...fields } = ext;
        copy.extensions = { [MESHOPT]: clone(fields) };
      }
      out.bufferViews.push(copy);
      planned.push({ level: L, view: v });
      viewMap[v] = index;
      if (key) imageViews.set(key, index);
    });
    for (const accessor of json.accessors ?? []) {
      const copy = clone(accessor);
      if (accessor.bufferView !== undefined) copy.bufferView = viewMap[accessor.bufferView];
      if (accessor.sparse) {
        copy.sparse.indices.bufferView = viewMap[accessor.sparse.indices.bufferView];
        copy.sparse.values.bufferView = viewMap[accessor.sparse.values.bufferView];
      }
      out.accessors.push(copy);
    }
    for (const image of json.images ?? [])
      out.images.push({ ...clone(image), bufferView: viewMap[image.bufferView] });
    for (const sampler of json.samplers ?? []) out.samplers.push(clone(sampler));
    for (const texture of json.textures ?? []) {
      const copy = clone(texture);
      if (texture.source !== undefined) copy.source = base.image + texture.source;
      if (texture.sampler !== undefined) copy.sampler = base.sampler + texture.sampler;
      if (texture.extensions?.[WEBP])
        copy.extensions[WEBP].source = base.image + texture.extensions[WEBP].source;
      out.textures.push(copy);
      textureLevel.push(L);
    }
    for (const material of json.materials ?? []) {
      const copy = clone(material);
      for (const slot of SLOTS) {
        const info = textureInfoAt(copy, slot.path);
        if (info !== undefined) info.index += base.texture;
      }
      out.materials.push(copy);
    }
    for (const mesh of json.meshes ?? []) {
      const copy = clone(mesh);
      for (const primitive of copy.primitives) {
        for (const name of Object.keys(primitive.attributes))
          primitive.attributes[name] += base.accessor;
        if (primitive.indices !== undefined) primitive.indices += base.accessor;
        if (primitive.material !== undefined) primitive.material += base.material;
        for (const target of primitive.targets ?? [])
          for (const name of Object.keys(target)) target[name] += base.accessor;
      }
      out.meshes.push(copy);
    }
    for (const node of json.nodes ?? []) {
      const copy = clone(node);
      if (node.children) copy.children = node.children.map((child) => child + base.node);
      if (node.mesh !== undefined) copy.mesh = node.mesh + base.mesh;
      out.nodes.push(copy);
    }
    const scene = clone(json.scenes[0]);
    scene.nodes = scene.nodes.map((node) => node + base.node);
    out.scenes.push(scene);
    report.levels.push({ level: L, label: level.label, scene: L, offsets: base });
  });
  report.textureSharing = shareTextures(out, textureLevel, fail);
  const parts = [];
  let binLength = 0,
    fallbackLength = 0,
    compressed = 0;
  const store = (bytes) => {
    const pad = padding4(binLength);
    if (pad) {
      parts.push(Buffer.alloc(pad));
      binLength += pad;
    }
    const at = binLength;
    parts.push(asBuffer(bytes));
    binLength += bytes.length;
    return at;
  };
  out.bufferViews = out.bufferViews.map((target, index) => {
    const { level, view } = planned[index],
      doc = levels[level].doc,
      source = doc.json.bufferViews[view],
      ext = source.extensions?.[MESHOPT];
    if (!ext)
      return { buffer: 0, byteOffset: store(storedViewBytes(doc.json, doc.bin, view)), ...target };
    const offset = ext.byteOffset ?? 0,
      at = store(doc.bin.subarray(offset, offset + ext.byteLength));
    fallbackLength += padding4(fallbackLength);
    const logical = fallbackLength;
    fallbackLength += source.byteLength;
    compressed++;
    return {
      buffer: 1,
      byteOffset: logical,
      ...target,
      extensions: { [MESHOPT]: { buffer: 0, byteOffset: at, ...target.extensions[MESHOPT] } },
    };
  });
  out.buffers = [{ byteLength: binLength }];
  if (compressed)
    out.buffers.push({ byteLength: fallbackLength, extensions: { [MESHOPT]: { fallback: true } } });
  const union = (key) => {
    const names = [];
    for (const level of levels)
      for (const name of level.doc.json[key] ?? []) if (!names.includes(name)) names.push(name);
    return names;
  };
  const used = union('extensionsUsed'),
    required = union('extensionsRequired');
  if (used.length) out.extensionsUsed = used;
  if (required.length) out.extensionsRequired = required;
  for (const key of [
    'nodes',
    'meshes',
    'accessors',
    'bufferViews',
    'materials',
    'textures',
    'images',
    'samplers',
  ])
    if (!out[key].length) delete out[key];
  const bin = Buffer.concat(parts, binLength);
  report.binBytes = binLength;
  report.fallbackBytes = fallbackLength;
  report.compressedViews = compressed;
  return { bytes: packGlb(out, bin), json: out, report };
}

/** Per GLTFLoader texture-cache group spanning levels: share (merging equal samplers) or refuse. */
function shareTextures(out, textureLevel, fail) {
  const uses = textureUses(out),
    groups = new Map(),
    decisions = [];
  out.textures.forEach((texture, t) => {
    const key = `${out.images[selectedImage(texture)].bufferView}|${texture.sampler === undefined ? 'none' : stableJson(out.samplers[texture.sampler])}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  });
  for (const [key, members] of groups) {
    const levels = new Set(members.map((t) => textureLevel[t]));
    if (levels.size < 2) continue;
    const spaces = new Set(
        members.flatMap((t) => uses[t].filter((use) => !use.clones)).map((use) => use.colorSpace),
      ),
      decision = {
        view: Number(key.split('|')[0]),
        textures: members,
        levels: [...levels],
        colorSpaces: [...spaces],
      };
    if (out.textures[members[0]].sampler === undefined) {
      if (spaces.size > 1)
        fail(
          `textures ${members.join(', ')} have no sampler, so GLTFLoader would share one Texture with colour spaces ${[...spaces].join(' and ')}`,
        );
      decisions.push({
        ...decision,
        shared: true,
        reason: 'no sampler: GLTFLoader shares by buffer view; one colour space',
      });
      continue;
    }
    if (spaces.size > 1) {
      decisions.push({
        ...decision,
        shared: false,
        reason: 'colour spaces differ; samplers stay per level',
      });
      continue;
    }
    const sampler = out.textures[members[0]].sampler;
    for (const t of members) out.textures[t].sampler = sampler;
    decisions.push({
      ...decision,
      shared: true,
      sampler,
      reason: 'equal sampler, one colour space: one Three texture',
    });
  }
  const referenced = new Set(
    out.textures.map((texture) => texture.sampler).filter((s) => s !== undefined),
  );
  return {
    groups: decisions,
    unreferencedSamplers: out.samplers.map((_, s) => s).filter((s) => !referenced.has(s)),
  };
}

// ---------------------------------------------------------------------------------------------
// Verification: canonical per-scene content, from the file bytes alone

/** Image identity aware of lossless PNG rewrites: PNG by what decoding depends on, else by bytes. */
export const pngAwareIdentity = (bytes, image, label) =>
  image.mimeType === 'image/png'
    ? pngIdentity(asBuffer(bytes), label)
    : { kind: 'bytes', sha256: sha256(bytes), bytes: bytes.length };

/**
 * One scene's content with every index replaced by the order of first visit, samplers inlined,
 * decoded accessor elements hashed and images by `imageIdentity` (default: exact bytes). Also
 * returns the raw indices reached, the image bytes' SHA-256 in visit order and the scene's
 * triangles (each reached mesh once).
 */
export function canonicalScene(
  json,
  bin,
  views,
  sceneIndex,
  { imageIdentity = null, label = 'scene' } = {},
) {
  const tables = { nodes: [], meshes: [], accessors: [], materials: [], textures: [], images: [] },
    maps = Object.fromEntries(Object.keys(tables).map((kind) => [kind, new Map()])),
    reachedViews = new Set(),
    imageBytes = [];
  const ref = (kind, index, build) => {
    if (!maps[kind].has(index)) {
      const id = tables[kind].length;
      maps[kind].set(index, id);
      tables[kind].push(null);
      tables[kind][id] = build(index);
    }
    return maps[kind].get(index);
  };
  const image = (i) => {
    const definition = json.images[i],
      bytes = storedViewBytes(json, bin, definition.bufferView);
    reachedViews.add(definition.bufferView);
    imageBytes.push(sha256(bytes));
    return imageIdentity
      ? {
          ...omit(clone(definition), ['bufferView']),
          view: viewShape(json, bin, definition.bufferView, { image: true }),
          identity: imageIdentity(bytes, definition, `${label} image ${i}`),
        }
      : {
          ...omit(clone(definition), ['bufferView']),
          view: viewShape(json, bin, definition.bufferView),
          bytes: bytes.length,
          sha256: sha256(bytes),
        };
  };
  const texture = (t) => {
    const definition = json.textures[t],
      result = omit(clone(definition), ['source', 'sampler', 'extensions']);
    if (definition.source !== undefined) result.source = ref('images', definition.source, image);
    if (definition.extensions?.[WEBP])
      result.webp = {
        ...clone(definition.extensions[WEBP]),
        source: ref('images', definition.extensions[WEBP].source, image),
      };
    result.sampler =
      definition.sampler === undefined ? null : clone(json.samplers[definition.sampler]);
    return result;
  };
  const material = (m) => {
    const result = clone(json.materials[m]);
    for (const slot of SLOTS) {
      const info = textureInfoAt(result, slot.path);
      if (info !== undefined) info.index = ref('textures', info.index, texture);
    }
    return result;
  };
  const accessor = (a) => {
    const definition = json.accessors[a],
      result = omit(clone(definition), ['bufferView', 'sparse']),
      elements = accessorElements(json, views, a);
    if (definition.bufferView !== undefined) {
      reachedViews.add(definition.bufferView);
      result.view = viewShape(json, bin, definition.bufferView);
    }
    if (definition.sparse) {
      const { indices, values, ...sparse } = definition.sparse;
      reachedViews.add(indices.bufferView);
      reachedViews.add(values.bufferView);
      result.sparse = {
        ...clone(sparse),
        indices: {
          ...omit(clone(indices), ['bufferView']),
          view: viewShape(json, bin, indices.bufferView),
        },
        values: {
          ...omit(clone(values), ['bufferView']),
          view: viewShape(json, bin, values.bufferView),
        },
      };
    }
    result.elementBytes = elements.length;
    result.elements = sha256(elements);
    return result;
  };
  const mesh = (m) => {
    const result = clone(json.meshes[m]);
    for (const primitive of result.primitives) {
      for (const name of Object.keys(primitive.attributes))
        primitive.attributes[name] = ref('accessors', primitive.attributes[name], accessor);
      if (primitive.indices !== undefined)
        primitive.indices = ref('accessors', primitive.indices, accessor);
      for (const target of primitive.targets ?? [])
        for (const name of Object.keys(target))
          target[name] = ref('accessors', target[name], accessor);
      if (primitive.material !== undefined)
        primitive.material = ref('materials', primitive.material, material);
    }
    return result;
  };
  const node = (n) => {
    const definition = json.nodes[n],
      result = omit(clone(definition), ['children', 'mesh']);
    if (definition.mesh !== undefined) result.mesh = ref('meshes', definition.mesh, mesh);
    if (definition.children)
      result.children = definition.children.map((child) => ref('nodes', child, node));
    return result;
  };
  const scene = clone(json.scenes[sceneIndex]);
  scene.nodes = scene.nodes.map((n) => ref('nodes', n, node));
  const triangles = [...maps.meshes.keys()].reduce(
    (total, m) =>
      total +
      json.meshes[m].primitives.reduce(
        (sum, primitive) => sum + primitiveTriangles(json, primitive),
        0,
      ),
    0,
  );
  return {
    canonical: { scene, ...tables },
    imageBytes,
    triangles,
    reached: {
      ...Object.fromEntries(Object.entries(maps).map(([kind, map]) => [kind, new Set(map.keys())])),
      views: reachedViews,
    },
  };
}

/** The runtime's own refusals (src/embedded-glb.ts checkEmbedded/selectedImage), restated. */
function runtimeEmbeddedProblems(json, bin) {
  const problems = [];
  (json.buffers ?? []).forEach((buffer, index) => {
    if (buffer.uri !== undefined) problems.push(`buffer ${index} has a URI`);
    else if (index === 0 && !(buffer.byteLength <= bin.length))
      problems.push('buffer 0 is longer than the BIN chunk');
    else if (index > 0 && buffer.extensions?.[MESHOPT]?.fallback !== true)
      problems.push(`buffer ${index} has neither data nor a meshopt fallback`);
  });
  (json.images ?? []).forEach((image, index) => {
    const view = json.bufferViews?.[image.bufferView];
    if (image.uri !== undefined || !view || view.buffer !== 0 || view.extensions?.[MESHOPT])
      problems.push(`image ${index} is not an uncompressed view of the BIN chunk`);
  });
  (json.textures ?? []).forEach((texture, index) => {
    if (texture.extensions?.[BASISU]) problems.push(`texture ${index} uses ${BASISU}`);
    if (!isIndex(selectedImage(texture), (json.images ?? []).length))
      problems.push(`texture ${index} selects no image`);
  });
  return problems;
}

/**
 * Verify `bytes` (one scene per level) against the ORIGINAL standalone `levels`
 * ([{ label, doc }]) from the bytes alone. `rewrites` maps an original PNG's SHA-256 to its
 * recorded rewrite's SHA-256: each packed image must be its original's bytes or that rewrite, and
 * PNG identity is compared lossless-aware. Returns { problems, scenes, sharing, totals }.
 */
export async function verifyLevels(bytes, levels, label, { rewrites = new Map() } = {}) {
  const problems = [],
    expect = (ok, message) => {
      if (!ok) problems.push(message);
    };
  let doc;
  try {
    doc = parseGlb(bytes, label);
    checkSupported(doc.json, label, { sceneCount: levels.length });
    validateDocument(doc.json, doc.bin, label, { allowMeshopt: true });
    checkExtensions(doc.json, label, { allowMeshopt: true });
  } catch (error) {
    return { problems: [`container: ${error.message}`] };
  }
  for (const problem of runtimeEmbeddedProblems(doc.json, doc.bin))
    problems.push(`runtime refusal: ${problem}`);
  let decoded;
  try {
    decoded = await decodeBoth(doc, label);
    checkStorage(decoded.regions, doc.bin.length, label);
  } catch (error) {
    return { problems: [`views: ${error.message}`] };
  }
  expect((doc.json.scene ?? 0) === 0, 'the default scene is not level 0');
  expect(!jsonDifference(doc.json.asset, levels[0].doc.json.asset), 'asset differs from level 0');
  const union = (key) => {
    const names = [];
    for (const level of levels)
      for (const name of level.doc.json[key] ?? []) if (!names.includes(name)) names.push(name);
    return names;
  };
  for (const key of ['extensionsUsed', 'extensionsRequired'])
    expect(
      !jsonDifference(doc.json[key] ?? [], union(key)),
      `${key} is not exactly the levels' union`,
    );
  const scenes = [],
    reached = [],
    sourceReached = [];
  for (const [L, level] of levels.entries()) {
    let source, packed;
    try {
      const sourceViews = (await decodeBoth(level.doc, level.label)).views;
      source = canonicalScene(
        level.doc.json,
        level.doc.bin,
        sourceViews,
        level.doc.json.scene ?? 0,
        { imageIdentity: pngAwareIdentity, label: level.label },
      );
      packed = canonicalScene(doc.json, doc.bin, decoded.views, L, {
        imageIdentity: pngAwareIdentity,
        label: `${label} scene ${L}`,
      });
    } catch (error) {
      problems.push(`${level.label}: scene ${L} cannot be compared: ${error.message}`);
      continue;
    }
    const difference = jsonDifference(source.canonical, packed.canonical, `scene ${L}`);
    expect(
      !difference,
      `${level.label}: packed scene ${L} differs from the original level: ${difference}`,
    );
    // Every image byte is the original's or its recorded rewrite, nothing else.
    packed.imageBytes.forEach((digest, k) => {
      const original = source.imageBytes[k];
      expect(
        digest === original || digest === rewrites.get(original),
        `${level.label}: scene ${L} image ${k} is neither its original nor its recorded rewrite`,
      );
    });
    expect(
      packed.triangles === source.triangles,
      `${level.label}: scene ${L} has ${packed.triangles} triangles, the level ${source.triangles}`,
    );
    reached.push(packed.reached);
    sourceReached.push(source.reached);
    scenes.push({
      level: L,
      scene: L,
      triangles: packed.triangles,
      canonicalSha256: sha256(Buffer.from(stableJson(packed.canonical))),
    });
  }
  if (reached.length === levels.length) {
    const imageViews = new Set((doc.json.images ?? []).map((image) => image.bufferView));
    for (const kind of ['nodes', 'meshes', 'accessors', 'materials', 'textures', 'images', 'views'])
      for (let a = 0; a < reached.length; a++)
        for (let b = a + 1; b < reached.length; b++)
          for (const index of reached[a][kind])
            if (reached[b][kind].has(index) && !(kind === 'views' && imageViews.has(index)))
              problems.push(`${kind} ${index} is shared by scenes ${a} and ${b}`);
    for (const kind of ['nodes', 'meshes', 'accessors', 'materials', 'textures', 'images']) {
      const sourceOrphans = levels.reduce(
          (sum, level, L) =>
            sum + (level.doc.json[kind] ?? []).length - sourceReached[L][kind].size,
          0,
        ),
        packedOrphans =
          (doc.json[kind] ?? []).length - reached.reduce((n, r) => n + r[kind].size, 0);
      expect(
        packedOrphans === sourceOrphans,
        `${kind}: ${packedOrphans} unreachable in the packed file, ${sourceOrphans} in the levels`,
      );
    }
  }
  const uses = textureUses(doc.json),
    sceneOfTexture = new Map(),
    sharing = [];
  reached.forEach((r, L) => r.textures.forEach((t) => sceneOfTexture.set(t, L)));
  for (const [key, members] of threeTextureGroups(doc.json)) {
    const scenesOf = new Set(members.map((t) => sceneOfTexture.get(t)));
    if (scenesOf.size < 2) continue;
    const spaces = new Set(
      members.flatMap((t) => uses[t].filter((use) => !use.clones).map((use) => use.colorSpace)),
    );
    expect(
      spaces.size <= 1,
      `GLTFLoader would share texture group ${key} across scenes with colour spaces ${[...spaces]}`,
    );
    sharing.push({ key, textures: members, scenes: [...scenesOf], colorSpaces: [...spaces] });
  }
  return {
    problems,
    scenes,
    sharing,
    totals: {
      bytes: bytes.length,
      scenes: doc.json.scenes.length,
      compressedViews: (doc.json.bufferViews ?? []).filter((view) => view.extensions?.[MESHOPT])
        .length,
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Second, independent decode: Three r185 GLTFLoader with its bundled meshopt decoder. Images,
// textures and samplers are removed first (Node cannot decode images; their identity is checked
// above), so this covers the scene graph, transforms, geometry and material parameters.

function withoutTextures(json) {
  const copy = structuredClone(json);
  delete copy.images;
  delete copy.textures;
  delete copy.samplers;
  for (const material of copy.materials ?? [])
    for (const slot of SLOTS) {
      const parent = slot.path.length === 2 ? material[slot.path[0]] : material;
      if (parent) delete parent[slot.path.at(-1)];
    }
  return copy;
}

export async function threeParse(bytes, label) {
  const [{ GLTFLoader }, { MeshoptDecoder }] = await Promise.all([
      import('three/addons/loaders/GLTFLoader.js'),
      import('three/addons/libs/meshopt_decoder.module.js'),
    ]),
    { json, bin } = parseGlb(bytes, label),
    stripped = packGlb(withoutTextures(json), bin);
  await MeshoptDecoder.ready;
  return new GLTFLoader()
    .setMeshoptDecoder(MeshoptDecoder)
    .parseAsync(
      stripped.buffer.slice(stripped.byteOffset, stripped.byteOffset + stripped.length),
      '',
    );
}

function components(attribute) {
  if (!attribute.isInterleavedBufferAttribute) return attribute.array;
  const { count, itemSize } = attribute,
    { array, stride } = attribute.data,
    values = new array.constructor(count * itemSize);
  for (let i = 0; i < count; i++)
    for (let c = 0; c < itemSize; c++)
      values[i * itemSize + c] = array[i * stride + attribute.offset + c];
  return values;
}
const bits = (array) => Buffer.from(array.buffer, array.byteOffset, array.byteLength);
const sameAttribute = (a, b) =>
  a.itemSize === b.itemSize &&
  a.count === b.count &&
  !!a.normalized === !!b.normalized &&
  components(a).constructor === components(b).constructor &&
  bits(components(a)).equals(bits(components(b)));
function materialSignature(material) {
  const json = material.toJSON();
  delete json.uuid;
  return stableJson(json);
}
function nodesOf(root) {
  root.updateMatrixWorld(true);
  const list = [];
  root.traverse((node) => list.push(node));
  return list;
}
// GLTFLoader names objects uniquely per FILE; later scenes may get "_N" suffixes. Only such renames
// are accepted (the glTF names themselves are compared canonically).
const threeNameBase = (name) => name.replace(/(_\d+)+$/, '');

/** Compare one decoded scene with another, value for value. Returns { problems, renames }. */
export function compareThreeScenes(source, packed, where) {
  const problems = [],
    renames = [],
    a = nodesOf(source),
    b = nodesOf(packed),
    outline = (nodes) => {
      const index = new Map(nodes.map((node, i) => [node, i]));
      return nodes.map((node) => [
        node.type,
        index.get(node.parent) ?? -1,
        stableJson(node.userData),
        node.visible,
      ]);
    };
  const difference = jsonDifference(outline(a), outline(b), `${where} outline`);
  if (difference) return { problems: [difference], renames };
  a.forEach((node, i) => {
    const other = b[i],
      at = `${where} ${node.type} "${node.name}"`;
    if (node.name !== other.name) {
      if (threeNameBase(node.name) === threeNameBase(other.name))
        renames.push({ type: node.type, standalone: node.name, packed: other.name });
      else
        problems.push(
          `${at}: Three name "${other.name}" is not a file-wide uniquification of "${node.name}"`,
        );
    }
    if (
      !bits(new Float64Array(node.matrixWorld.elements)).equals(
        bits(new Float64Array(other.matrixWorld.elements)),
      )
    )
      problems.push(`${at}: world transform differs`);
    if (!node.isMesh && !node.isPoints && !node.isLine) return;
    const g = node.geometry,
      h = other.geometry,
      names = (attributes) => Object.keys(attributes).sort();
    if (jsonDifference(names(g.attributes), names(h.attributes)))
      problems.push(`${at}: attribute names differ`);
    else
      for (const name of names(g.attributes))
        if (!sameAttribute(g.attributes[name], h.attributes[name]))
          problems.push(`${at}: ${name} differs`);
    if (!g.index !== !h.index || (g.index && !sameAttribute(g.index, h.index)))
      problems.push(`${at}: indices differ`);
    if (jsonDifference([g.groups, g.drawRange, g.userData], [h.groups, h.drawRange, h.userData]))
      problems.push(`${at}: groups/drawRange/userData differ`);
    const x = [node.material].flat(),
      y = [other.material].flat();
    if (
      x.length !== y.length ||
      x.some((material, m) => materialSignature(material) !== materialSignature(y[m]))
    )
      problems.push(`${at}: material parameters differ`);
  });
  return { problems, renames };
}

/** Geometry and materials Three made for each scene: none may be shared between scenes. */
export function sharedAcrossScenes(scenes) {
  const owner = new Map(),
    problems = [];
  scenes.forEach((scene, s) =>
    scene.traverse((node) => {
      for (const object of [node.geometry, ...[node.material ?? []].flat()].filter(Boolean)) {
        const seen = owner.get(object);
        if (seen !== undefined && seen !== s)
          problems.push(`${object.type} ${object.uuid} is shared by scenes ${seen} and ${s}`);
        owner.set(object, s);
      }
    }),
  );
  return problems;
}

/** The Three decode of `bytes` (scene i) against each original level, plus cross-scene isolation. */
export async function threeProblems(bytes, levels, label) {
  const problems = [],
    renames = [];
  let packed;
  try {
    packed = await threeParse(bytes, label);
  } catch (error) {
    return { problems: [`three: ${error.message}`], renames };
  }
  if (packed.scenes.length !== levels.length)
    return {
      problems: [`three: ${packed.scenes.length} scenes for ${levels.length} levels`],
      renames,
    };
  for (const [L, level] of levels.entries()) {
    const source = await threeParse(level.bytes, level.label),
      result = compareThreeScenes(source.scene, packed.scenes[L], `${level.label} scene ${L}`);
    problems.push(...result.problems);
    renames.push(...result.renames.map((rename) => ({ scene: L, ...rename })));
  }
  problems.push(...sharedAcrossScenes(packed.scenes));
  return { problems, renames };
}
