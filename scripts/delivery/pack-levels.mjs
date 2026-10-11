// Pack a static template's level GLBs into one delivery GLB whose scene i is level i.
//
// Each LOD master embeds its own copy of the textures it shares with the full model (the same
// image bytes, often 0.3-1 MB). A separate file per level downloads and uploads every copy. The
// game already loads packed levels (world-asset-levels.ts: scene i = level i, no shared geometry
// or material, textures shared through GLTFLoader's image cache), as the camp mountain and snow
// ground ship. Packing here stores each distinct image once, so the client downloads and uploads
// it once. Every geometry stream, material and node is copied verbatim; only indices move.
import { MeshoptDecoder } from 'meshoptimizer';
import { createHash } from 'node:crypto';
import { MESHOPT, parseGlb } from './cook-glb.mjs';

const GLB_MAGIC = 0x46546c67,
  CHUNK_JSON = 0x4e4f534a,
  CHUNK_BIN = 0x004e4942;
const align4 = (n) => (n + 3) & ~3;
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const fail = (label, message) => {
  throw new Error(`${label}: ${message}`);
};

/** Offset every texture-info `index` of a material (glTF materials use `index` only there). */
function remapTextureInfos(value, offset) {
  if (Array.isArray(value)) return value.map((v) => remapTextureInfos(v, offset));
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, child] of Object.entries(value))
    out[key] =
      key === 'index' && Number.isInteger(child)
        ? child + offset
        : remapTextureInfos(child, offset);
  return out;
}

/** Whether a part can be packed: one scene, no skins, animations or cameras. */
export function packable(json) {
  return (
    (json.scenes?.length ?? 0) === 1 &&
    !json.skins?.length &&
    !json.animations?.length &&
    !json.cameras?.length &&
    !(json.nodes ?? []).some(
      (node) => node.skin !== undefined || node.camera !== undefined || node.weights,
    )
  );
}

/**
 * Pack `levels` (GLB buffers, level 0 first) into one GLB with scene i = level i. Returns the
 * packed bytes; throws if a level cannot be packed.
 */
export async function packLevels(levels, label = 'levels') {
  await MeshoptDecoder.ready;
  const parts = levels.map((bytes, i) => ({ ...parseGlb(bytes, `${label} level ${i}`) }));
  parts.forEach(({ json }, i) => {
    if (!packable(json)) fail(label, `level ${i} has skins, animations, cameras or several scenes`);
    if ((json.buffers ?? []).some((b) => b.uri !== undefined))
      fail(label, `level ${i} has an external buffer`);
  });
  const out = {
    asset: parts[0].json.asset,
    scene: 0,
    scenes: [],
    nodes: [],
    meshes: [],
    materials: [],
    textures: [],
    images: [],
    samplers: [],
    accessors: [],
    bufferViews: [],
    buffers: [],
  };
  const used = new Set(),
    required = new Set();
  const chunks = [];
  let binLength = 0,
    fallbackLength = 0,
    anyStream = false;
  const push = (bytes) => {
    const offset = binLength;
    chunks.push({ offset, bytes });
    binLength = align4(binLength + bytes.length);
    return offset;
  };
  const imageViewByHash = new Map();
  const samplerByJson = new Map();
  for (const [level, { json, bin }] of parts.entries()) {
    for (const name of json.extensionsUsed ?? []) used.add(name);
    for (const name of json.extensionsRequired ?? []) required.add(name);
    const imageViews = new Set(
      (json.images ?? []).map((image) => image.bufferView).filter((v) => v !== undefined),
    );
    // Views: images deduplicated by content, everything else copied verbatim.
    const viewMap = [];
    for (const [index, view] of (json.bufferViews ?? []).entries()) {
      const ext = view.extensions?.[MESHOPT];
      if (imageViews.has(index)) {
        if (ext || (view.buffer ?? 0) !== 0)
          fail(label, `level ${level} image view ${index} is not plain`);
        const bytes = bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
        const key = sha(bytes);
        if (!imageViewByHash.has(key)) {
          imageViewByHash.set(key, out.bufferViews.length);
          const copy = { buffer: 0, byteOffset: push(bytes), byteLength: bytes.length };
          if (view.name !== undefined) copy.name = view.name;
          out.bufferViews.push(copy);
        }
        viewMap[index] = imageViewByHash.get(key);
        continue;
      }
      const copy = { ...view };
      delete copy.extensions;
      if (ext) {
        if ((ext.buffer ?? 0) !== 0)
          fail(label, `level ${level} view ${index} stream is outside BIN`);
        const stream = bin.subarray(ext.byteOffset ?? 0, (ext.byteOffset ?? 0) + ext.byteLength);
        anyStream = true;
        copy.buffer = 1;
        copy.byteOffset = fallbackLength;
        fallbackLength = align4(fallbackLength + view.byteLength);
        copy.extensions = {
          ...view.extensions,
          [MESHOPT]: { ...ext, buffer: 0, byteOffset: push(stream) },
        };
      } else {
        if ((view.buffer ?? 0) !== 0)
          fail(label, `level ${level} view ${index} reads a fallback buffer`);
        copy.buffer = 0;
        copy.byteOffset = push(
          bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength),
        );
      }
      viewMap[index] = out.bufferViews.length;
      out.bufferViews.push(copy);
    }
    const base = {
      accessors: out.accessors.length,
      meshes: out.meshes.length,
      materials: out.materials.length,
      textures: out.textures.length,
      images: out.images.length,
      nodes: out.nodes.length,
    };
    for (const accessor of json.accessors ?? []) {
      const copy = structuredClone(accessor);
      if (copy.bufferView !== undefined) copy.bufferView = viewMap[copy.bufferView];
      if (copy.sparse) {
        copy.sparse.indices.bufferView = viewMap[copy.sparse.indices.bufferView];
        copy.sparse.values.bufferView = viewMap[copy.sparse.values.bufferView];
      }
      out.accessors.push(copy);
    }
    const samplerMap = (json.samplers ?? []).map((sampler) => {
      const key = JSON.stringify(sampler);
      if (!samplerByJson.has(key)) {
        samplerByJson.set(key, out.samplers.length);
        out.samplers.push(structuredClone(sampler));
      }
      return samplerByJson.get(key);
    });
    for (const image of json.images ?? []) {
      const copy = structuredClone(image);
      if (copy.bufferView !== undefined) copy.bufferView = viewMap[copy.bufferView];
      out.images.push(copy);
    }
    for (const texture of json.textures ?? []) {
      const copy = structuredClone(texture);
      if (copy.source !== undefined) copy.source += base.images;
      if (copy.sampler !== undefined) copy.sampler = samplerMap[copy.sampler];
      for (const extension of Object.values(copy.extensions ?? {}))
        if (Number.isInteger(extension?.source)) extension.source += base.images;
      out.textures.push(copy);
    }
    for (const material of json.materials ?? [])
      out.materials.push(remapTextureInfos(structuredClone(material), base.textures));
    for (const mesh of json.meshes ?? []) {
      const copy = structuredClone(mesh);
      for (const primitive of copy.primitives) {
        for (const name of Object.keys(primitive.attributes))
          primitive.attributes[name] += base.accessors;
        if (primitive.indices !== undefined) primitive.indices += base.accessors;
        if (primitive.material !== undefined) primitive.material += base.materials;
        for (const target of primitive.targets ?? [])
          for (const name of Object.keys(target)) target[name] += base.accessors;
      }
      out.meshes.push(copy);
    }
    for (const node of json.nodes ?? []) {
      const copy = structuredClone(node);
      if (copy.mesh !== undefined) copy.mesh += base.meshes;
      if (copy.children) copy.children = copy.children.map((child) => child + base.nodes);
      out.nodes.push(copy);
    }
    const scene = structuredClone(json.scenes[json.scene ?? 0]);
    scene.nodes = (scene.nodes ?? []).map((node) => node + base.nodes);
    out.scenes.push(scene);
  }
  out.buffers.push({ byteLength: binLength });
  if (anyStream)
    out.buffers.push({ byteLength: fallbackLength, extensions: { [MESHOPT]: { fallback: true } } });
  for (const key of ['samplers', 'textures', 'images', 'materials'])
    if (!out[key].length) delete out[key];
  if (used.size) out.extensionsUsed = [...used].sort();
  if (required.size) out.extensionsRequired = [...required].sort();
  const binChunk = Buffer.alloc(binLength);
  for (const { offset, bytes } of chunks) binChunk.set(bytes, offset);
  const text = Buffer.from(JSON.stringify(out), 'utf8');
  const jsonChunk = Buffer.alloc(align4(text.length), 0x20);
  text.copy(jsonChunk);
  const header = Buffer.alloc(20);
  header.writeUInt32LE(GLB_MAGIC, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + binChunk.length, 8);
  header.writeUInt32LE(jsonChunk.length, 12);
  header.writeUInt32LE(CHUNK_JSON, 16);
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(binChunk.length, 0);
  binHeader.writeUInt32LE(CHUNK_BIN, 4);
  const packed = Buffer.concat([header, jsonChunk, binHeader, binChunk]);
  verifyPacked(parts, packed, label);
  return packed;
}

/** The packed file's every accessor and image equals its level's, byte for byte. */
function verifyPacked(parts, packed, label) {
  const { json, bin } = parseGlb(packed, `${label} (packed)`);
  if (json.scenes.length !== parts.length) fail(label, 'packed scene count differs');
  const logical = (gltf, data, index) => {
    const view = gltf.bufferViews[index];
    const ext = view.extensions?.[MESHOPT];
    if (!ext) return data.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
    const out = new Uint8Array(ext.count * ext.byteStride);
    MeshoptDecoder.decodeGltfBuffer(
      out,
      ext.count,
      ext.byteStride,
      data.subarray(ext.byteOffset ?? 0, (ext.byteOffset ?? 0) + ext.byteLength),
      ext.mode,
      ext.filter ?? 'NONE',
    );
    return out;
  };
  let accessorBase = 0,
    imageBase = 0,
    meshBase = 0,
    nodeBase = 0;
  for (const [level, part] of parts.entries()) {
    for (const [index, accessor] of (part.json.accessors ?? []).entries()) {
      const packedAccessor = json.accessors[accessorBase + index];
      const strip = ({ bufferView, sparse, ...rest }) => (void bufferView, void sparse, rest);
      if (JSON.stringify(strip(accessor)) !== JSON.stringify(strip(packedAccessor)))
        fail(label, `level ${level} accessor ${index} changed`);
      if (accessor.bufferView === undefined) continue;
      const a = logical(part.json, part.bin, accessor.bufferView),
        b = logical(json, bin, packedAccessor.bufferView);
      if (Buffer.compare(Buffer.from(a), Buffer.from(b)) !== 0)
        fail(label, `level ${level} accessor ${index} data changed`);
    }
    for (const [index, image] of (part.json.images ?? []).entries()) {
      const packedImage = json.images[imageBase + index];
      if (image.mimeType !== packedImage.mimeType)
        fail(label, `level ${level} image ${index} type changed`);
      const a = logical(part.json, part.bin, image.bufferView),
        b = logical(json, bin, packedImage.bufferView);
      if (Buffer.compare(Buffer.from(a), Buffer.from(b)) !== 0)
        fail(label, `level ${level} image ${index} bytes changed`);
    }
    const nodes = json.scenes[level].nodes ?? [];
    const own = (part.json.scenes[part.json.scene ?? 0].nodes ?? []).map((node) => node + nodeBase);
    if (JSON.stringify(nodes) !== JSON.stringify(own))
      fail(label, `level ${level} scene roots changed`);
    accessorBase += part.json.accessors?.length ?? 0;
    imageBase += part.json.images?.length ?? 0;
    meshBase += part.json.meshes?.length ?? 0;
    nodeBase += part.json.nodes?.length ?? 0;
  }
  void meshBase;
}
