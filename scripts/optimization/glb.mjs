// Strict GLB container and layout helpers for the offline runtime-optimization tools.
// Every chunk, buffer, view and accessor range is checked before it is read, and
// external or data URIs are rejected: candidates must embed exactly what they need.
import { createHash } from 'node:crypto';

export const GLB_MAGIC = 0x46546c67;
export const CHUNK_JSON = 0x4e4f534a;
export const CHUNK_BIN = 0x004e4942;
export const MESHOPT = 'EXT_meshopt_compression';
export const COMPONENT_BYTES = Object.freeze({ 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 });
export const TYPE_WIDTH = Object.freeze({ SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 });
export const IMAGE_MIME_TYPES = Object.freeze(['image/png', 'image/jpeg', 'image/webp']);
const MESHOPT_MODES = new Set(['ATTRIBUTES', 'TRIANGLES', 'INDICES']);
const SPARSE_INDEX_BYTES = Object.freeze({ 5121: 1, 5123: 2, 5125: 4 });

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
export const padding4 = (length) => (4 - (length % 4)) % 4;
const isIndex = (value, length) => Number.isInteger(value) && value >= 0 && value < length;

export function asBuffer(bytes) {
  if (Buffer.isBuffer(bytes)) return bytes;
  if (bytes instanceof ArrayBuffer) return Buffer.from(bytes);
  if (ArrayBuffer.isView(bytes)) return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  throw new TypeError('Expected binary data');
}

export function elementSize(accessor, where = 'accessor') {
  const component = COMPONENT_BYTES[accessor?.componentType],
    width = TYPE_WIDTH[accessor?.type];
  if (!component || !width) throw new Error(`${where} has an unsupported componentType or type`);
  if ((accessor.type === 'MAT2' || accessor.type === 'MAT3') && component < 4)
    throw new Error(`${where} is a column-padded ${accessor.type}, which this pipeline does not read`);
  return component * width;
}

/** Parse a GLB 2.0 file. Only one JSON chunk and at most one BIN chunk are accepted. */
export function parseGlb(input, label = 'GLB') {
  const bytes = asBuffer(input);
  const fail = (message) => {
    throw new Error(`${label}: ${message}`);
  };
  if (bytes.length < 20) fail('file is shorter than a GLB header');
  if (bytes.readUInt32LE(0) !== GLB_MAGIC) fail('missing glTF magic');
  if (bytes.readUInt32LE(4) !== 2) fail(`unsupported GLB version ${bytes.readUInt32LE(4)}`);
  if (bytes.readUInt32LE(8) !== bytes.length)
    fail(`header length ${bytes.readUInt32LE(8)} does not match the ${bytes.length}-byte file`);
  let offset = 12,
    chunk = 0,
    json,
    bin = null;
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) fail(`truncated chunk header at byte ${offset}`);
    const length = bytes.readUInt32LE(offset),
      type = bytes.readUInt32LE(offset + 4),
      start = offset + 8,
      end = start + length;
    if (end > bytes.length) fail(`chunk ${chunk} (${length} bytes) exceeds the file`);
    if (length % 4) fail(`chunk ${chunk} length ${length} is not 4-byte aligned`);
    if (chunk === 0) {
      if (type !== CHUNK_JSON) fail('the first chunk is not JSON');
      try {
        json = JSON.parse(bytes.toString('utf8', start, end));
      } catch (error) {
        fail(`invalid JSON chunk (${error.message})`);
      }
    } else if (chunk === 1 && type === CHUNK_BIN) bin = bytes.subarray(start, end);
    else fail(`unsupported chunk ${chunk} of type 0x${type.toString(16)}`);
    offset = end;
    chunk++;
  }
  if (!json || typeof json !== 'object' || Array.isArray(json)) fail('JSON chunk is not an object');
  if (json.asset?.version !== '2.0') fail('asset.version is not "2.0"');
  return { json, bin: bin ?? Buffer.alloc(0), bytes };
}

/** Pack JSON and BIN chunks with the conventional space/zero padding. */
export function packGlb(json, bin = Buffer.alloc(0)) {
  const text = Buffer.from(JSON.stringify(json), 'utf8'),
    binary = asBuffer(bin),
    jsonLength = text.length + padding4(text.length),
    binLength = binary.length + padding4(binary.length),
    total = 20 + jsonLength + (binary.length ? 8 + binLength : 0),
    out = Buffer.alloc(total);
  out.writeUInt32LE(GLB_MAGIC, 0);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(total, 8);
  out.writeUInt32LE(jsonLength, 12);
  out.writeUInt32LE(CHUNK_JSON, 16);
  out.fill(0x20, 20, 20 + jsonLength);
  text.copy(out, 20);
  if (binary.length) {
    const at = 20 + jsonLength;
    out.writeUInt32LE(binLength, at);
    out.writeUInt32LE(CHUNK_BIN, at + 4);
    binary.copy(out, at + 8);
  }
  return out;
}

/** Validate every range and reference this pipeline reads or rewrites. */
export function validateDocument(json, bin, label = 'GLB', { allowMeshopt = false } = {}) {
  const fail = (message) => {
    throw new Error(`${label}: ${message}`);
  };
  const buffers = json.buffers ?? [],
    views = json.bufferViews ?? [],
    accessors = json.accessors ?? [],
    images = json.images ?? [];
  for (const [key, value] of Object.entries({ buffers, bufferViews: views, accessors, images }))
    if (!Array.isArray(value)) fail(`${key} is not an array`);
  if (bin.length && !buffers.length) fail('BIN chunk without a buffer');
  const fallback = buffers.map((buffer, index) => {
    if (!buffer || typeof buffer !== 'object') fail(`buffer ${index} is not an object`);
    if (buffer.uri !== undefined)
      fail(`buffer ${index} has a URI; only the embedded GLB buffer is allowed`);
    if (!Number.isSafeInteger(buffer.byteLength) || buffer.byteLength < 1)
      fail(`buffer ${index} has an invalid byteLength`);
    const isFallback = buffer.extensions?.[MESHOPT]?.fallback === true;
    if (index === 0) {
      if (isFallback) fail('buffer 0 must hold the GLB BIN chunk, not a meshopt fallback');
      if (buffer.byteLength > bin.length || bin.length - buffer.byteLength > 3)
        fail(`buffer 0 byteLength ${buffer.byteLength} does not match the ${bin.length}-byte BIN chunk`);
    } else if (!allowMeshopt || !isFallback)
      fail(`buffer ${index} is neither the GLB buffer nor a meshopt fallback buffer`);
    return isFallback;
  });
  views.forEach((view, index) => {
    const where = `buffer view ${index}`;
    if (!isIndex(view?.buffer, buffers.length)) fail(`${where} references a missing buffer`);
    const offset = view.byteOffset ?? 0;
    if (!Number.isSafeInteger(offset) || offset < 0) fail(`${where} has an invalid byteOffset`);
    if (!Number.isSafeInteger(view.byteLength) || view.byteLength < 1)
      fail(`${where} has an invalid byteLength`);
    if (offset + view.byteLength > buffers[view.buffer].byteLength)
      fail(`${where} range ${offset}+${view.byteLength} exceeds buffer ${view.buffer}`);
    if (
      view.byteStride !== undefined &&
      (!Number.isInteger(view.byteStride) ||
        view.byteStride < 4 ||
        view.byteStride > 252 ||
        view.byteStride % 4)
    )
      fail(`${where} has an invalid byteStride`);
    const ext = view.extensions?.[MESHOPT];
    if (ext === undefined) {
      if (fallback[view.buffer]) fail(`${where} reads uncompressed bytes from a meshopt fallback buffer`);
      return;
    }
    if (!allowMeshopt) fail(`${where} is already ${MESHOPT}-compressed`);
    if (!fallback[view.buffer]) fail(`${where} is compressed but its logical buffer is not a fallback buffer`);
    if (!isIndex(ext.buffer, buffers.length) || fallback[ext.buffer])
      fail(`${where} compressed data must be stored in the GLB buffer`);
    const stored = ext.byteOffset ?? 0;
    if (
      !Number.isSafeInteger(stored) ||
      stored < 0 ||
      !Number.isSafeInteger(ext.byteLength) ||
      ext.byteLength < 1 ||
      stored + ext.byteLength > buffers[ext.buffer].byteLength
    )
      fail(`${where} compressed range is outside buffer ${ext.buffer}`);
    if (!MESHOPT_MODES.has(ext.mode)) fail(`${where} has an unknown meshopt mode ${ext.mode}`);
    if (ext.filter !== undefined && ext.filter !== 'NONE')
      fail(`${where} uses the meshopt filter ${ext.filter}; only lossless unfiltered data is allowed`);
    if (!Number.isSafeInteger(ext.count) || ext.count < 1 || !Number.isInteger(ext.byteStride))
      fail(`${where} has an invalid meshopt count or byteStride`);
    if (
      ext.mode === 'ATTRIBUTES'
        ? ext.byteStride < 4 || ext.byteStride > 256 || ext.byteStride % 4
        : ext.byteStride !== 2 && ext.byteStride !== 4
    )
      fail(`${where} byteStride ${ext.byteStride} is invalid for ${ext.mode}`);
    if (ext.mode === 'TRIANGLES' && ext.count % 3) fail(`${where} TRIANGLES count is not a multiple of 3`);
    if (ext.count * ext.byteStride !== view.byteLength)
      fail(`${where} decodes to ${ext.count * ext.byteStride} bytes, not its byteLength ${view.byteLength}`);
    if (view.byteStride !== undefined && view.byteStride !== ext.byteStride)
      fail(`${where} byteStride differs from its compressed byteStride`);
  });
  accessors.forEach((accessor, index) => {
    const where = `accessor ${index}`,
      size = elementSize(accessor, where),
      component = COMPONENT_BYTES[accessor.componentType],
      offset = accessor.byteOffset ?? 0;
    if (!Number.isSafeInteger(accessor.count) || accessor.count < 1) fail(`${where} has an invalid count`);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset % component)
      fail(`${where} has an invalid or misaligned byteOffset`);
    if (accessor.bufferView !== undefined) {
      if (!isIndex(accessor.bufferView, views.length)) fail(`${where} references a missing buffer view`);
      const view = views[accessor.bufferView],
        stride = view.byteStride ?? size;
      if (stride < size) fail(`${where} elements overlap (stride ${stride} < ${size})`);
      if (offset + stride * (accessor.count - 1) + size > view.byteLength)
        fail(`${where} exceeds buffer view ${accessor.bufferView}`);
    } else if (offset) fail(`${where} has a byteOffset without a buffer view`);
    const sparse = accessor.sparse;
    if (sparse === undefined) return;
    if (!Number.isSafeInteger(sparse.count) || sparse.count < 1 || sparse.count > accessor.count)
      fail(`${where} has an invalid sparse count`);
    const indexBytes = SPARSE_INDEX_BYTES[sparse.indices?.componentType];
    if (!indexBytes) fail(`${where} has invalid sparse indices`);
    for (const [part, bytes] of [
      ['indices', indexBytes],
      ['values', size],
    ]) {
      const item = sparse[part];
      if (!isIndex(item?.bufferView, views.length)) fail(`${where} sparse ${part} reference a missing buffer view`);
      const at = item.byteOffset ?? 0;
      if (!Number.isSafeInteger(at) || at < 0 || at + sparse.count * bytes > views[item.bufferView].byteLength)
        fail(`${where} sparse ${part} exceed buffer view ${item.bufferView}`);
    }
  });
  images.forEach((image, index) => {
    if (image?.uri !== undefined) fail(`image ${index} has a URI; only embedded bufferView images are allowed`);
    if (!isIndex(image.bufferView, views.length)) fail(`image ${index} has no valid bufferView`);
    if (!IMAGE_MIME_TYPES.includes(image.mimeType)) fail(`image ${index} has unsupported mimeType ${image.mimeType}`);
    if (views[image.bufferView].extensions?.[MESHOPT]) fail(`image ${index} is stored in a compressed view`);
  });
  (json.textures ?? []).forEach((texture, index) => {
    for (const source of [texture?.source, texture?.extensions?.EXT_texture_webp?.source])
      if (source !== undefined && !isIndex(source, images.length))
        fail(`texture ${index} references a missing image`);
  });
  validateReferences(json, fail);
}

function validateReferences(json, fail) {
  const nodes = json.nodes ?? [],
    meshes = json.meshes ?? [],
    skins = json.skins ?? [],
    accessors = json.accessors ?? [],
    materials = json.materials ?? [];
  meshes.forEach((mesh, m) => {
    if (!Array.isArray(mesh?.primitives) || !mesh.primitives.length) fail(`mesh ${m} has no primitives`);
    mesh.primitives.forEach((primitive, p) => {
      const where = `mesh ${m} primitive ${p}`,
        attributes = primitive.attributes ?? {};
      if (!isIndex(attributes.POSITION, accessors.length)) fail(`${where} has no valid POSITION accessor`);
      for (const [name, accessor] of Object.entries(attributes))
        if (!isIndex(accessor, accessors.length)) fail(`${where} attribute ${name} references a missing accessor`);
      if (primitive.indices !== undefined && !isIndex(primitive.indices, accessors.length))
        fail(`${where} indices reference a missing accessor`);
      (primitive.targets ?? []).forEach((target, t) => {
        for (const [name, accessor] of Object.entries(target))
          if (!isIndex(accessor, accessors.length)) fail(`${where} target ${t} ${name} references a missing accessor`);
      });
      if (primitive.material !== undefined && !isIndex(primitive.material, materials.length))
        fail(`${where} references a missing material`);
    });
  });
  nodes.forEach((node, n) => {
    if (node.mesh !== undefined && !isIndex(node.mesh, meshes.length)) fail(`node ${n} references a missing mesh`);
    if (node.skin !== undefined && !isIndex(node.skin, skins.length)) fail(`node ${n} references a missing skin`);
    for (const child of node.children ?? [])
      if (!isIndex(child, nodes.length)) fail(`node ${n} has a missing child ${child}`);
    if (node.matrix !== undefined && (!Array.isArray(node.matrix) || node.matrix.length !== 16))
      fail(`node ${n} has an invalid matrix`);
  });
  skins.forEach((skin, s) => {
    if (!Array.isArray(skin.joints) || !skin.joints.length || skin.joints.some((joint) => !isIndex(joint, nodes.length)))
      fail(`skin ${s} has invalid joints`);
    if (skin.skeleton !== undefined && !isIndex(skin.skeleton, nodes.length)) fail(`skin ${s} has a missing skeleton root`);
    if (skin.inverseBindMatrices === undefined) return;
    if (!isIndex(skin.inverseBindMatrices, accessors.length)) fail(`skin ${s} references missing inverse bind matrices`);
    const matrices = accessors[skin.inverseBindMatrices];
    if (matrices.type !== 'MAT4' || matrices.componentType !== 5126 || matrices.count < skin.joints.length)
      fail(`skin ${s} inverse bind matrices do not cover its ${skin.joints.length} joints`);
  });
  (json.animations ?? []).forEach((animation, a) => {
    const samplers = animation.samplers ?? [];
    samplers.forEach((sampler, s) => {
      if (!isIndex(sampler.input, accessors.length) || !isIndex(sampler.output, accessors.length))
        fail(`animation ${a} sampler ${s} references a missing accessor`);
    });
    (animation.channels ?? []).forEach((channel, c) => {
      if (!isIndex(channel.sampler, samplers.length)) fail(`animation ${a} channel ${c} references a missing sampler`);
      if (channel.target?.node !== undefined && !isIndex(channel.target.node, nodes.length))
        fail(`animation ${a} channel ${c} targets a missing node`);
    });
  });
  (json.scenes ?? []).forEach((scene, s) => {
    for (const node of scene.nodes ?? []) if (!isIndex(node, nodes.length)) fail(`scene ${s} references a missing node`);
  });
}

/** Bytes of an uncompressed view stored in the GLB buffer. */
export function storedViewBytes(json, bin, index) {
  const view = json.bufferViews?.[index];
  if (!view || view.buffer !== 0 || view.extensions?.[MESHOPT])
    throw new Error(`buffer view ${index} is not stored uncompressed in the GLB buffer`);
  const offset = view.byteOffset ?? 0;
  return bin.subarray(offset, offset + view.byteLength);
}

export const storedViews = (doc) =>
  (doc.json.bufferViews ?? []).map((_, index) => storedViewBytes(doc.json, doc.bin, index));

/** Tightly packed element bytes of an accessor, with sparse substitution applied. */
export function accessorElements(json, views, index) {
  const accessor = json.accessors[index],
    size = elementSize(accessor, `accessor ${index}`),
    out = Buffer.alloc(size * accessor.count);
  if (accessor.bufferView !== undefined) {
    const data = asBuffer(views[accessor.bufferView]),
      stride = json.bufferViews[accessor.bufferView].byteStride ?? size,
      offset = accessor.byteOffset ?? 0;
    if (stride === size) data.copy(out, 0, offset, offset + out.length);
    else
      for (let i = 0; i < accessor.count; i++)
        data.copy(out, i * size, offset + i * stride, offset + i * stride + size);
  }
  const sparse = accessor.sparse;
  if (sparse) {
    const indexBytes = SPARSE_INDEX_BYTES[sparse.indices.componentType],
      indices = asBuffer(views[sparse.indices.bufferView]),
      values = asBuffer(views[sparse.values.bufferView]),
      indexStart = sparse.indices.byteOffset ?? 0,
      valueStart = sparse.values.byteOffset ?? 0;
    for (let i = 0; i < sparse.count; i++) {
      const at =
        indexBytes === 1
          ? indices[indexStart + i]
          : indexBytes === 2
            ? indices.readUInt16LE(indexStart + 2 * i)
            : indices.readUInt32LE(indexStart + 4 * i);
      if (at >= accessor.count) throw new Error(`accessor ${index} sparse index ${at} is out of range`);
      values.copy(out, at * size, valueStart + i * size, valueStart + (i + 1) * size);
    }
  }
  return out;
}

/** Rebuild the GLB buffer with each view's bytes (optionally replaced), 4-byte aligned.
 * View indices and metadata are kept, so the result maps 1:1 onto the input. */
export function repackViews(json, bin, replacements = new Map()) {
  const out = structuredClone(json),
    parts = [];
  let length = 0;
  (out.bufferViews ?? []).forEach((view, index) => {
    const bytes = asBuffer(replacements.get(index) ?? storedViewBytes(json, bin, index)),
      pad = padding4(length);
    if (pad) {
      parts.push(Buffer.alloc(pad));
      length += pad;
    }
    view.buffer = 0;
    view.byteOffset = length;
    view.byteLength = bytes.length;
    parts.push(bytes);
    length += bytes.length;
  });
  if (length) out.buffers = [{ ...(json.buffers?.[0] ?? {}), byteLength: length }];
  else delete out.buffers;
  return { json: out, bin: Buffer.concat(parts, length) };
}

export function primitiveTriangles(json, primitive) {
  const count = json.accessors?.[primitive.indices ?? primitive.attributes?.POSITION]?.count ?? 0,
    mode = primitive.mode ?? 4;
  if (mode === 4) return Math.floor(count / 3);
  return (mode === 5 || mode === 6) && count >= 3 ? count - 2 : 0;
}

export function triangleCount(json) {
  let triangles = 0;
  for (const mesh of json.meshes ?? []) for (const primitive of mesh.primitives ?? []) triangles += primitiveTriangles(json, primitive);
  return triangles;
}

/** First structural difference between two JSON values (-0 equals 0), or null. */
export function jsonDifference(a, b, where = '$') {
  if (a === b) return null;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return `${where}: array differs from non-array`;
    if (a.length !== b.length) return `${where}: length ${a.length} differs from ${b.length}`;
    for (let i = 0; i < a.length; i++) {
      const difference = jsonDifference(a[i], b[i], `${where}[${i}]`);
      if (difference) return difference;
    }
    return null;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const difference = jsonDifference(a[key], b[key], `${where}.${key}`);
      if (difference) return difference;
    }
    return null;
  }
  return `${where}: ${JSON.stringify(a)} differs from ${JSON.stringify(b)}`;
}
