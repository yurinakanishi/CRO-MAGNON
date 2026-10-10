// GLB documents for guarded-surface@1. PROMOTED unchanged in algorithm from the reviewed
// output-only proof (output/optimization-audit-20261009/lowpoly-high-tools-r04/document.mjs):
// decode a GLB to logical views (production decodeViews), refuse extensions that may reference
// accessors or views, replace a primitive by an exact source subset, collect unreferenced data and
// re-pack with the production lossless packer (compressViews: attribute codec version 0, no
// filters). Pure apart from the meshopt WebAssembly.
import zlib from 'node:zlib';
import {
  COMPONENT_BYTES,
  MESHOPT,
  TYPE_WIDTH,
  accessorElements,
  elementSize,
  packGlb,
  padding4,
  parseGlb,
  validateDocument,
} from '../glb.mjs';
import { compressViews } from '../meshopt-pack.mjs';
import { decodeViews } from '../verify.mjs';

const SAFE_EXTENSIONS =
  /^(EXT_texture_webp|KHR_texture_transform|KHR_texture_basisu|KHR_lights_punctual|KHR_mesh_quantization|KHR_materials_[a-z_]+)$/;

/** Throws unless every extension the document uses or carries cannot reference accessors or views. */
export function checkProofExtensions(json, label) {
  const found = new Set((json.extensionsUsed ?? []).filter((name) => name !== MESHOPT)),
    visit = (value) => {
      if (Array.isArray(value)) return value.forEach(visit);
      if (!value || typeof value !== 'object') return;
      for (const [key, child] of Object.entries(value)) {
        if (key === 'extensions' && child && typeof child === 'object')
          for (const name of Object.keys(child)) if (name !== MESHOPT) found.add(name);
        if (key !== 'extras') visit(child);
      }
    };
  visit(json);
  const unsupported = [...found].filter((name) => !SAFE_EXTENSIONS.test(name)).sort();
  if (unsupported.length)
    throw new Error(
      `${label}: ${unsupported.join(', ')} may reference accessors or buffer views, which this recipe does not renumber; not supported`,
    );
}

/** A GLB as an uncompressed document: { json, views } with one logical byte array per view. */
export async function decodeDocument(bytes, label) {
  const doc = parseGlb(bytes, label);
  validateDocument(doc.json, doc.bin, label, { allowMeshopt: true });
  const { views } = await decodeViews(doc, label),
    json = structuredClone(doc.json);
  for (const view of json.bufferViews ?? []) {
    if (view.extensions?.[MESHOPT]) {
      delete view.extensions[MESHOPT];
      if (!Object.keys(view.extensions).length) delete view.extensions;
    }
    view.buffer = 0;
  }
  const drop = (list) => {
    const kept = (list ?? []).filter((name) => name !== MESHOPT);
    return kept.length ? kept : undefined;
  };
  json.extensionsUsed = drop(json.extensionsUsed);
  json.extensionsRequired = drop(json.extensionsRequired);
  if (!json.extensionsUsed) delete json.extensionsUsed;
  if (!json.extensionsRequired) delete json.extensionsRequired;
  json.buffers = [{ byteLength: 0 }];
  return { json, views: views.map((view) => Buffer.from(view)) };
}

/** Lay `views` out in one buffer (4-byte aligned); returns { json, bin } of a plain GLB. */
export function layOut(json, views) {
  const out = structuredClone(json),
    parts = [];
  let length = 0;
  (out.bufferViews ?? []).forEach((view, index) => {
    const pad = padding4(length);
    if (pad) {
      parts.push(Buffer.alloc(pad));
      length += pad;
    }
    view.buffer = 0;
    view.byteOffset = length;
    view.byteLength = views[index].length;
    parts.push(views[index]);
    length += views[index].length;
  });
  if (length) out.buffers = [{ byteLength: length }];
  else delete out.buffers;
  return { json: out, bin: Buffer.concat(parts, length) };
}

function componentsOf(accessor, bytes) {
  const size = COMPONENT_BYTES[accessor.componentType],
    read = {
      5120: (o) => bytes.readInt8(o),
      5121: (o) => bytes.readUInt8(o),
      5122: (o) => bytes.readInt16LE(o),
      5123: (o) => bytes.readUInt16LE(o),
      5125: (o) => bytes.readUInt32LE(o),
      5126: (o) => bytes.readFloatLE(o),
    }[accessor.componentType],
    values = new Array(bytes.length / size);
  for (let i = 0; i < values.length; i++) values[i] = read(i * size);
  return values;
}

function boundsOf(accessor, bytes) {
  const width = TYPE_WIDTH[accessor.type],
    values = componentsOf(accessor, bytes),
    min = new Array(width).fill(Infinity),
    max = new Array(width).fill(-Infinity);
  for (let i = 0; i < values.length; i++) {
    const k = i % width;
    if (values[i] < min[k]) min[k] = values[i];
    if (values[i] > max[k]) max[k] = values[i];
  }
  if (accessor.componentType === 5126)
    return { min: min.map(Math.fround), max: max.map(Math.fround) };
  return { min, max };
}

/** Element bytes of `accessor` gathered in `order` (new vertex i = source vertex order[i]). */
export function gatherElements(json, views, accessor, order) {
  const size = elementSize(json.accessors[accessor], `accessor ${accessor}`),
    elements = accessorElements(json, views, accessor),
    out = Buffer.alloc(size * order.length);
  for (let i = 0; i < order.length; i++)
    elements.copy(out, i * size, order[i] * size, (order[i] + 1) * size);
  return out;
}

/** Point primitive (mesh, primitive) at new accessors gathered in `sourceVertices` order with `indices`. */
export function replacePrimitive(document, mesh, primitive, { indices, sourceVertices }) {
  const json = structuredClone(document.json),
    views = [...document.views],
    target = json.meshes[mesh].primitives[primitive],
    addView = (bytes, extra) => {
      json.bufferViews.push({ buffer: 0, byteLength: bytes.length, ...extra });
      views.push(bytes);
      return json.bufferViews.length - 1;
    },
    addAccessor = (accessor) => {
      json.accessors.push(accessor);
      return json.accessors.length - 1;
    };
  if (target.targets?.length)
    throw new Error(`mesh ${mesh} primitive ${primitive} has morph targets`);
  for (const [name, accessor] of Object.entries(target.attributes)) {
    const source = document.json.accessors[accessor],
      size = elementSize(source, `accessor ${accessor}`);
    if (size % 4)
      throw new Error(`${name} elements are ${size} bytes, not 4-byte aligned vertex data`);
    const bytes = gatherElements(document.json, document.views, accessor, sourceVertices),
      { bufferView: _v, byteOffset: _o, sparse: _s, min: _min, max: _max, ...rest } = source,
      next = {
        ...rest,
        bufferView: addView(bytes, { byteStride: size, target: 34962 }),
        count: sourceVertices.length,
      };
    if (name === 'POSITION' || source.min !== undefined || source.max !== undefined)
      Object.assign(next, boundsOf(source, bytes));
    target.attributes[name] = addAccessor(next);
  }
  const wide = sourceVertices.length > 65535,
    indexBytes = Buffer.alloc(indices.length * (wide ? 4 : 2));
  for (let i = 0; i < indices.length; i++) {
    if (indices[i] >= sourceVertices.length) throw new Error(`index ${indices[i]} is out of range`);
    if (wide) indexBytes.writeUInt32LE(indices[i], 4 * i);
    else indexBytes.writeUInt16LE(indices[i], 2 * i);
  }
  target.indices = addAccessor({
    bufferView: addView(indexBytes, { target: 34963 }),
    componentType: wide ? 5125 : 5123,
    count: indices.length,
    type: 'SCALAR',
  });
  return { json, views };
}

/** Remove accessors and views nothing references, renumbering every reference. */
export function collectGarbage(document) {
  checkProofExtensions(document.json, 'collectGarbage');
  const json = structuredClone(document.json),
    usedAccessors = new Set(),
    usedViews = new Set();
  for (const mesh of json.meshes ?? [])
    for (const primitive of mesh.primitives ?? []) {
      for (const accessor of Object.values(primitive.attributes ?? {})) usedAccessors.add(accessor);
      if (primitive.indices !== undefined) usedAccessors.add(primitive.indices);
      for (const target of primitive.targets ?? [])
        for (const accessor of Object.values(target)) usedAccessors.add(accessor);
    }
  for (const skin of json.skins ?? [])
    if (skin.inverseBindMatrices !== undefined) usedAccessors.add(skin.inverseBindMatrices);
  for (const animation of json.animations ?? [])
    for (const sampler of animation.samplers ?? []) {
      usedAccessors.add(sampler.input);
      usedAccessors.add(sampler.output);
    }
  const accessorMap = new Map();
  (json.accessors ?? []).forEach((accessor, index) => {
    if (!usedAccessors.has(index)) return;
    accessorMap.set(index, accessorMap.size);
    if (accessor.bufferView !== undefined) usedViews.add(accessor.bufferView);
    if (accessor.sparse) {
      usedViews.add(accessor.sparse.indices.bufferView);
      usedViews.add(accessor.sparse.values.bufferView);
    }
  });
  for (const image of json.images ?? [])
    if (image.bufferView !== undefined) usedViews.add(image.bufferView);
  const viewMap = new Map();
  (json.bufferViews ?? []).forEach((_, index) => {
    if (usedViews.has(index)) viewMap.set(index, viewMap.size);
  });
  const remap = (index) => accessorMap.get(index);
  for (const mesh of json.meshes ?? [])
    for (const primitive of mesh.primitives ?? []) {
      for (const name of Object.keys(primitive.attributes ?? {}))
        primitive.attributes[name] = remap(primitive.attributes[name]);
      if (primitive.indices !== undefined) primitive.indices = remap(primitive.indices);
      for (const target of primitive.targets ?? [])
        for (const name of Object.keys(target)) target[name] = remap(target[name]);
    }
  for (const skin of json.skins ?? [])
    if (skin.inverseBindMatrices !== undefined)
      skin.inverseBindMatrices = remap(skin.inverseBindMatrices);
  for (const animation of json.animations ?? [])
    for (const sampler of animation.samplers ?? []) {
      sampler.input = remap(sampler.input);
      sampler.output = remap(sampler.output);
    }
  json.accessors = (json.accessors ?? [])
    .filter((_, index) => accessorMap.has(index))
    .map((accessor) => {
      const next = { ...accessor };
      if (next.bufferView !== undefined) next.bufferView = viewMap.get(next.bufferView);
      if (next.sparse)
        next.sparse = {
          ...next.sparse,
          indices: {
            ...next.sparse.indices,
            bufferView: viewMap.get(next.sparse.indices.bufferView),
          },
          values: { ...next.sparse.values, bufferView: viewMap.get(next.sparse.values.bufferView) },
        };
      return next;
    });
  for (const image of json.images ?? [])
    if (image.bufferView !== undefined) image.bufferView = viewMap.get(image.bufferView);
  json.bufferViews = (json.bufferViews ?? []).filter((_, index) => viewMap.has(index));
  return { json, views: document.views.filter((_, index) => viewMap.has(index)) };
}

/** A lossless meshopt GLB of `document` (production compressViews), validated. */
export async function packCandidate(document, label) {
  const plain = layOut(document.json, document.views);
  validateDocument(plain.json, plain.bin, label);
  const packed = await compressViews(plain.json, plain.bin, label),
    bytes = packGlb(packed.json, packed.bin),
    check = parseGlb(bytes, label);
  validateDocument(check.json, check.bin, label, { allowMeshopt: true });
  return bytes;
}

/** An uncompressed GLB of `document`, validated. */
export function packPlain(document, label) {
  const plain = layOut(document.json, document.views);
  validateDocument(plain.json, plain.bin, label);
  return packGlb(plain.json, plain.bin);
}

/** Whole-file gzip -6 bytes (the proof's budget measure). */
export const gzip6 = (bytes) => zlib.gzipSync(bytes, { level: 6 }).length;

/** Triangles and vertices of every primitive of a document's JSON. */
export function geometryCounts(json) {
  const primitives = [];
  (json.meshes ?? []).forEach((mesh, m) =>
    (mesh.primitives ?? []).forEach((primitive, p) =>
      primitives.push({
        mesh: m,
        primitive: p,
        vertices: json.accessors[primitive.attributes.POSITION].count,
        triangles:
          primitive.indices === undefined ? 0 : json.accessors[primitive.indices].count / 3,
      }),
    ),
  );
  return {
    primitives,
    vertices: primitives.reduce((s, p) => s + p.vertices, 0),
    triangles: primitives.reduce((s, p) => s + p.triangles, 0),
  };
}
