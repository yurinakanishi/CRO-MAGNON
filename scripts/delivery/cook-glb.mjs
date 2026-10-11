// Delivery cooking of a verified GLB: the same scene, rig, clips and materials in fewer bytes.
//
// The adopted GLBs (public/models) are the authoring masters. They store every float exactly
// (lossless meshopt, no filters) and some textures as PNG. That is the right master format and the
// wrong delivery format: float32 mantissas and PNG photographs are most of every download. This
// module derives the delivery form a phone receives:
//
// - Float vertex data (positions, normals, tangents, UVs, colours, skin weights, morph targets)
//   and animation translations/scales go through the meshopt EXPONENTIAL filter. They still decode
//   to float32 attributes of the same layout, so the runtime and every helper that reads geometry
//   see the same types, item sizes, vertex order and triangle order; only mantissa bits below a
//   stated tolerance are dropped. Each tolerance is checked by decoding the cooked stream again.
// - Animation rotations use the QUATERNION filter (normalized int16, which glTF 2.0 permits for
//   rotation outputs; GLTFLoader turns them back into float tracks).
// - Indices, joints, inverse binds, animation times and every non-float view are copied
//   losslessly (their existing meshopt stream verbatim when there is one).
// - Opaque PNG colour textures become lossy WebP; PNG normal/data maps become near-lossless WebP
//   (no chroma subsampling). PNGs whose alpha matters stay PNG. WebP/JPEG inputs are kept.
//
// Nothing here changes topology, vertex count, UV layout, skeleton, clip list or material
// parameters. The report records every view's encoding and measured error.
import { createHash } from 'node:crypto';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

export const COOK_RECIPE = 'cro-magnon/delivery-cook@1';
export const MESHOPT = 'EXT_meshopt_compression';
const KHR_MESHOPT = 'KHR_meshopt_compression';
const WEBP = 'EXT_texture_webp';
const GLB_MAGIC = 0x46546c67,
  CHUNK_JSON = 0x4e4f534a,
  CHUNK_BIN = 0x004e4942;

/** Tolerances are maxima of the decoded value's absolute error. */
export const DEFAULT_POLICY = Object.freeze({
  // 0.1 mm for models; terrain-scale models use the same absolute bound, which costs them a
  // few more mantissa bits rather than opening seams between neighbouring templates.
  positionMetres: 1e-4,
  // Unit vectors: 1/512 per component keeps every normal and tangent within about 0.2 degrees.
  unitComponent: 1 / 512,
  // 1/8 texel of the largest delivered texture (maxTextureEdge 1024).
  texcoord: 1 / 8192,
  colour: 1 / 1024,
  // Skin weights are snapped to a 1/4096 grid and re-summed to exactly one.
  weightGrid: 4096,
  animationTranslationMetres: 1e-4,
  animationScale: 1e-4,
  morphWeight: 1 / 4096,
  // QUATERNION filter bits (4..16); 14 bits keeps every rotation within about 0.007 degrees.
  rotationBits: 14,
  rotationRadians: 3e-4,
  webpColourQuality: 88,
  // Lossy colour must stay this close (PSNR, dB) to the master; otherwise near-lossless is used.
  minimumColourPsnr: 36,
  webpDataNearLossless: 80,
  // The single graphics profile's texture limit (GAME_IMPROVEMENT_PLAN.md); larger masters are
  // downscaled for delivery.
  maxTextureEdge: 1024,
});

const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
const TYPED = {
  5120: Int8Array,
  5121: Uint8Array,
  5122: Int16Array,
  5123: Uint16Array,
  5125: Uint32Array,
  5126: Float32Array,
};
const FLOAT = 5126,
  SHORT = 5122;

const fail = (label, message) => {
  throw new Error(`${label}: ${message}`);
};
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const align4 = (n) => (n + 3) & ~3;

export async function cookerReady() {
  await MeshoptDecoder.ready;
  await MeshoptEncoder.ready;
}

/** The JSON and BIN chunks of a GLB 2.0 file, every range checked. */
export function parseGlb(bytes, label = 'GLB') {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (buffer.length < 20 || buffer.readUInt32LE(0) !== GLB_MAGIC) fail(label, 'not a GLB file');
  if (buffer.readUInt32LE(4) !== 2) fail(label, 'not GLB version 2');
  if (buffer.readUInt32LE(8) !== buffer.length) fail(label, 'header length does not match');
  const jsonLength = buffer.readUInt32LE(12);
  if (buffer.readUInt32LE(16) !== CHUNK_JSON || 20 + jsonLength > buffer.length)
    fail(label, 'missing JSON chunk');
  const json = JSON.parse(buffer.toString('utf8', 20, 20 + jsonLength));
  let bin = new Uint8Array(0);
  const binHeader = 20 + jsonLength;
  if (binHeader < buffer.length) {
    if (binHeader + 8 > buffer.length) fail(label, 'truncated BIN chunk header');
    const length = buffer.readUInt32LE(binHeader);
    if (buffer.readUInt32LE(binHeader + 4) !== CHUNK_BIN) fail(label, 'second chunk is not BIN');
    if (binHeader + 8 + length > buffer.length) fail(label, 'BIN chunk exceeds the file');
    bin = new Uint8Array(buffer.buffer, buffer.byteOffset + binHeader + 8, length);
  }
  return { json, bin };
}

function meshoptOf(view) {
  return view?.extensions?.[MESHOPT] ?? view?.extensions?.[KHR_MESHOPT] ?? null;
}

/** Every bufferView's logical bytes (decoded when meshopt-compressed). */
export function logicalViews(json, bin, label) {
  const buffers = json.buffers ?? [];
  buffers.forEach((buffer, index) => {
    if (buffer.uri !== undefined) fail(label, `buffer ${index} has an external URI`);
    const isFallback = !!(
      buffer.extensions?.[MESHOPT]?.fallback || buffer.extensions?.[KHR_MESHOPT]?.fallback
    );
    if (index === 0 && isFallback) fail(label, 'buffer 0 must be the BIN chunk');
    if (index > 0 && !isFallback)
      fail(label, `buffer ${index} is neither BIN nor a meshopt fallback`);
  });
  return (json.bufferViews ?? []).map((view, index) => {
    const ext = meshoptOf(view);
    if (ext) {
      if ((ext.buffer ?? 0) !== 0)
        fail(label, `view ${index} compressed data is not in the BIN chunk`);
      const start = ext.byteOffset ?? 0;
      if (start + ext.byteLength > bin.length)
        fail(label, `view ${index} compressed range exceeds BIN`);
      if (ext.count * ext.byteStride !== view.byteLength)
        fail(
          label,
          `view ${index} decodes to ${ext.count * ext.byteStride} bytes, not ${view.byteLength}`,
        );
      const out = new Uint8Array(ext.count * ext.byteStride);
      MeshoptDecoder.decodeGltfBuffer(
        out,
        ext.count,
        ext.byteStride,
        bin.subarray(start, start + ext.byteLength),
        ext.mode,
        ext.filter ?? 'NONE',
      );
      return {
        bytes: out,
        compressed: { ...ext, data: bin.subarray(start, start + ext.byteLength) },
      };
    }
    if ((view.buffer ?? 0) !== 0)
      fail(label, `view ${index} reads a fallback buffer without compression`);
    const start = view.byteOffset ?? 0;
    if (start + view.byteLength > bin.length) fail(label, `view ${index} exceeds BIN`);
    return { bytes: bin.subarray(start, start + view.byteLength), compressed: null };
  });
}

/** What each accessor holds, from the meshes, skins and animations that read it. */
function accessorUsage(json) {
  const usage = new Map();
  const mark = (index, kind) => {
    if (index === undefined) return;
    const previous = usage.get(index);
    usage.set(index, previous && previous !== kind ? 'MIXED' : kind);
  };
  for (const mesh of json.meshes ?? [])
    for (const primitive of mesh.primitives ?? []) {
      for (const [name, index] of Object.entries(primitive.attributes ?? {}))
        mark(index, attributeKind(name));
      mark(primitive.indices, (primitive.mode ?? 4) === 4 ? 'TRIANGLE_INDICES' : 'INDICES');
      for (const target of primitive.targets ?? [])
        for (const [name, index] of Object.entries(target))
          mark(index, `MORPH_${attributeKind(name)}`);
    }
  for (const skin of json.skins ?? []) mark(skin.inverseBindMatrices, 'IBM');
  for (const animation of json.animations ?? [])
    for (const channel of animation.channels ?? []) {
      const sampler = animation.samplers?.[channel.sampler];
      if (!sampler) continue;
      mark(sampler.input, 'ANIM_INPUT');
      const path = channel.target?.path;
      const interpolation = sampler.interpolation ?? 'LINEAR';
      // Cubic splines store tangents beside values; keep them exact.
      const kind =
        interpolation === 'CUBICSPLINE'
          ? 'ANIM_OTHER'
          : path === 'rotation'
            ? 'ANIM_ROTATION'
            : path === 'translation'
              ? 'ANIM_TRANSLATION'
              : path === 'scale'
                ? 'ANIM_SCALE'
                : path === 'weights'
                  ? 'ANIM_WEIGHTS'
                  : 'ANIM_OTHER';
      mark(sampler.output, kind);
    }
  return usage;
}

function attributeKind(name) {
  if (name === 'POSITION') return 'POSITION';
  if (name === 'NORMAL') return 'NORMAL';
  if (name === 'TANGENT') return 'TANGENT';
  if (/^TEXCOORD_\d+$/.test(name)) return 'TEXCOORD';
  if (/^COLOR_\d+$/.test(name)) return 'COLOR';
  if (/^WEIGHTS_\d+$/.test(name)) return 'WEIGHTS';
  if (/^JOINTS_\d+$/.test(name)) return 'JOINTS';
  return 'CUSTOM';
}

const LOSSY = new Set([
  'POSITION',
  'NORMAL',
  'TANGENT',
  'TEXCOORD',
  'COLOR',
  'WEIGHTS',
  'MORPH_POSITION',
  'MORPH_NORMAL',
  'MORPH_TANGENT',
  'ANIM_ROTATION',
  'ANIM_TRANSLATION',
  'ANIM_SCALE',
  'ANIM_WEIGHTS',
]);

function tolerance(kind, policy) {
  switch (kind) {
    case 'POSITION':
    case 'MORPH_POSITION':
      return policy.positionMetres;
    case 'NORMAL':
    case 'TANGENT':
    case 'MORPH_NORMAL':
    case 'MORPH_TANGENT':
      return policy.unitComponent;
    case 'TEXCOORD':
      return policy.texcoord;
    case 'COLOR':
      return policy.colour;
    case 'ANIM_TRANSLATION':
      return policy.animationTranslationMetres;
    case 'ANIM_SCALE':
      return policy.animationScale;
    case 'ANIM_WEIGHTS':
      return policy.morphWeight;
    default:
      return 0;
  }
}

function floats(bytes) {
  // Copy: the source may be an unaligned view of the BIN chunk.
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Float32Array(copy.buffer);
}

function maxAbsError(a, b) {
  let error = 0;
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i] - b[i]);
    if (!(d <= error)) error = Number.isNaN(d) ? Infinity : d;
  }
  return error;
}

/** Smallest EXPONENTIAL encoding whose decoded floats stay within `limit` of `values`. */
function encodeExpWithin(values, count, stride, limit, mode, exact = false) {
  for (let bits = 8; bits <= 24; bits++) {
    const filtered = MeshoptEncoder.encodeFilterExp(values, count, stride, bits, mode);
    const decoded = new Uint8Array(filtered.length);
    const stream = MeshoptEncoder.encodeGltfBuffer(filtered, count, stride, 'ATTRIBUTES');
    MeshoptDecoder.decodeGltfBuffer(decoded, count, stride, stream, 'ATTRIBUTES', 'EXPONENTIAL');
    const result = new Float32Array(decoded.buffer);
    const error = maxAbsError(values, result);
    if (exact ? error === 0 : error <= limit)
      return { stream, bits, error, filter: 'EXPONENTIAL', decoded: result };
  }
  return null;
}

/** Snap each weight vector to a 1/grid lattice whose components sum exactly to one. */
function snapWeights(values, width, grid) {
  const out = new Float32Array(values.length);
  for (let v = 0; v < values.length; v += width) {
    let sum = 0;
    for (let c = 0; c < width; c++) sum += values[v + c];
    if (!(sum > 0)) {
      for (let c = 0; c < width; c++) out[v + c] = values[v + c];
      continue;
    }
    const q = [];
    let total = 0,
      largest = 0;
    for (let c = 0; c < width; c++) {
      q[c] = Math.round((values[v + c] / sum) * grid);
      total += q[c];
      if (q[c] > q[largest]) largest = c;
    }
    q[largest] += grid - total;
    for (let c = 0; c < width; c++) out[v + c] = q[c] / grid;
  }
  return out;
}

function quaternionAngleError(a, b16) {
  let worst = 0;
  for (let i = 0; i < a.length; i += 4) {
    const bx = b16[i] / 32767,
      by = b16[i + 1] / 32767,
      bz = b16[i + 2] / 32767,
      bw = b16[i + 3] / 32767;
    const bl = Math.hypot(bx, by, bz, bw);
    const al = Math.hypot(a[i], a[i + 1], a[i + 2], a[i + 3]);
    const dot = Math.abs((a[i] * bx + a[i + 1] * by + a[i + 2] * bz + a[i + 3] * bw) / (al * bl));
    const angle = 2 * Math.acos(Math.min(1, dot));
    if (!(angle <= worst)) worst = Number.isNaN(angle) ? Infinity : angle;
  }
  return worst;
}

/** The roles each image plays, from the materials that sample it. */
function imageRoles(json) {
  const roles = new Map();
  const sourceOf = (textureIndex) => {
    const texture = json.textures?.[textureIndex];
    if (!texture) return undefined;
    return (
      texture.extensions?.[WEBP]?.source ??
      texture.extensions?.EXT_texture_avif?.source ??
      texture.source
    );
  };
  const add = (info, role, material) => {
    if (!info) return;
    const image = sourceOf(info.index);
    if (image === undefined) return;
    if (!roles.has(image)) roles.set(image, { roles: new Set(), alpha: false });
    const entry = roles.get(image);
    entry.roles.add(role);
    if (role === 'colour' && (material.alphaMode === 'MASK' || material.alphaMode === 'BLEND'))
      entry.alpha = true;
  };
  for (const material of json.materials ?? []) {
    const pbr = material.pbrMetallicRoughness ?? {};
    add(pbr.baseColorTexture, 'colour', material);
    add(material.emissiveTexture, 'colour', material);
    add(material.normalTexture, 'normal', material);
    add(pbr.metallicRoughnessTexture, 'data', material);
    add(material.occlusionTexture, 'data', material);
    for (const [name, extension] of Object.entries(material.extensions ?? {}))
      for (const [key, value] of Object.entries(extension ?? {}))
        if (value && typeof value === 'object' && Number.isInteger(value.index))
          (add(value, /color|colour/i.test(key) ? 'colour' : 'data', material), void name);
  }
  return roles;
}

/** Downscale raw RGB(A) normal-map texels and renormalize each tangent-space vector. */
async function resizeNormalMap(sharp, bytes, width, height, channels) {
  const resized = await sharp(Buffer.from(bytes))
    .removeAlpha()
    .resize(width, height, { kernel: 'cubic', fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const data = resized.data;
  for (let i = 0; i < data.length; i += resized.info.channels) {
    const x = data[i] / 127.5 - 1,
      y = data[i + 1] / 127.5 - 1,
      z = data[i + 2] / 127.5 - 1;
    const length = Math.hypot(x, y, z) || 1;
    data[i] = Math.round((x / length + 1) * 127.5);
    data[i + 1] = Math.round((y / length + 1) * 127.5);
    data[i + 2] = Math.round((z / length + 1) * 127.5);
  }
  void channels;
  return sharp(data, { raw: { width, height, channels: resized.info.channels } });
}

async function cookImage(bytes, mime, info, policy, sharp, alphaSampled) {
  if (!info || !['image/png', 'image/webp', 'image/jpeg'].includes(mime)) return null;
  const meta = await sharp(Buffer.from(bytes), { failOn: 'error' }).metadata();
  const edge = Math.max(meta.width, meta.height);
  const scale = edge > policy.maxTextureEdge ? policy.maxTextureEdge / edge : 1;
  const width = Math.max(1, Math.round(meta.width * scale)),
    height = Math.max(1, Math.round(meta.height * scale));
  // Already lossy-coded (WebP/JPEG) and within the size limit: nothing to gain.
  if (mime !== 'image/png' && scale === 1) return { kept: 'within-limit' };
  let alphaVaries = false;
  if (meta.hasAlpha) {
    const stats = await sharp(Buffer.from(bytes)).stats();
    alphaVaries = stats.channels[stats.channels.length - 1].min < 255;
  }
  const roles = info.roles;
  const normal = roles.has('normal');
  const lossyColour = roles.size === 1 && roles.has('colour');
  // An OPAQUE material never reads alpha (Three forces it to one), so its alpha plane is dropped
  // and the colour kept as stored. Alpha that is sampled (MASK/BLEND, or a runtime material the
  // caller names) keeps its format: WebKit's WebP alpha path premultiplies and is not
  // pixel-faithful, so a sampled-alpha PNG stays PNG (only downscaled when over the limit).
  const keepAlpha = alphaVaries && (info.alpha || alphaSampled);
  if (keepAlpha && mime === 'image/png' && scale === 1) return { kept: 'alpha' };
  const resizedSource = () =>
    normal
      ? resizeNormalMap(sharp, bytes, width, height)
      : Promise.resolve(
          (keepAlpha ? sharp(Buffer.from(bytes)) : sharp(Buffer.from(bytes)).removeAlpha()).resize(
            width,
            height,
            { kernel: 'lanczos3', fit: 'fill' },
          ),
        );
  const source = async () => (scale === 1 ? sharp(Buffer.from(bytes)) : await resizedSource());
  // The master at the delivered size (a lossless resize of it): what each encoding is measured on.
  const reference = await (
    scale === 1
      ? sharp(Buffer.from(bytes))
      : normal
        ? await resizeNormalMap(sharp, bytes, width, height)
        : sharp(Buffer.from(bytes)).resize(width, height, { kernel: 'lanczos3', fit: 'fill' })
  )
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const measure = async (out) => {
    const b = await sharp(out).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const a = reference;
    if (a.info.width !== b.info.width || a.info.height !== b.info.height || a.info.width !== width)
      throw new Error('re-encoded texture has an unexpected size');
    let sq = 0,
      worst = 0;
    for (let i = 0; i < a.data.length; i++) {
      const d = a.data[i] - b.data[i];
      sq += d * d;
      if (Math.abs(d) > worst) worst = Math.abs(d);
    }
    const mse = sq / a.data.length;
    return { psnr: mse === 0 ? Infinity : 10 * Math.log10((255 * 255) / mse), worst };
  };
  const encodings = [];
  if (keepAlpha && mime === 'image/png')
    encodings.push(['png-resized', 'image/png', (s) => s.png({ compressionLevel: 9, effort: 10 })]);
  else {
    const plane = (s) => (keepAlpha ? s : s.removeAlpha());
    if (lossyColour)
      encodings.push([
        `webp-q${policy.webpColourQuality}`,
        'image/webp',
        (s) =>
          plane(s).webp({
            quality: policy.webpColourQuality,
            alphaQuality: 100,
            smartSubsample: true,
            effort: 6,
          }),
      ]);
    // Normal and data maps, and colour the lossy coder cannot hold within the quality bound.
    encodings.push([
      `webp-nearlossless${policy.webpDataNearLossless}`,
      'image/webp',
      (s) =>
        plane(s).webp({
          lossless: true,
          nearLossless: true,
          quality: policy.webpDataNearLossless,
          effort: 6,
        }),
    ]);
  }
  for (const [encoding, outMime, encode] of encodings) {
    const out = await encode(await source()).toBuffer();
    if (scale === 1 && out.length >= bytes.length) continue;
    const { psnr, worst } = await measure(out);
    if (encoding.startsWith('webp-q') && psnr < policy.minimumColourPsnr) continue;
    return {
      bytes: out,
      mime: outMime,
      encoding: scale === 1 ? encoding : `${encoding}@${width}x${height}`,
      width,
      height,
      ...(scale === 1 ? {} : { resizedFrom: [meta.width, meta.height] }),
      psnr: Number.isFinite(psnr) ? Number(psnr.toFixed(2)) : 'exact',
      maxChannelError: worst,
    };
  }
  // Nothing smaller within the bound: the master image is delivered unchanged (only possible at
  // its own size; an oversized master always takes the last, near-lossless, encoding).
  return { kept: 'larger' };
}

/**
 * Cook one GLB. Returns { bytes, report }. `options.sharp` is the image codec (sharp); without it
 * images are kept as they are.
 */
export async function cookGlb(
  input,
  { label = 'GLB', policy = DEFAULT_POLICY, sharp = null, alphaSampled = false } = {},
) {
  await cookerReady();
  const source = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const { json: original, bin } = parseGlb(source, label);
  const json = structuredClone(original);
  const views = logicalViews(json, bin, label);
  const usage = accessorUsage(json);
  const accessors = json.accessors ?? [];
  const byView = new Map();
  accessors.forEach((accessor, index) => {
    if (accessor.bufferView === undefined) return;
    if (!byView.has(accessor.bufferView)) byView.set(accessor.bufferView, []);
    byView.get(accessor.bufferView).push(index);
    if (accessor.sparse) byView.get(accessor.bufferView).sparse = true;
  });
  for (const accessor of accessors)
    if (accessor.sparse) {
      for (const part of [accessor.sparse.indices, accessor.sparse.values])
        if (part?.bufferView !== undefined) {
          if (!byView.has(part.bufferView)) byView.set(part.bufferView, []);
          byView.get(part.bufferView).sparse = true;
        }
    }
  const imageViews = new Map();
  (json.images ?? []).forEach((image, index) => {
    if (image.uri !== undefined) fail(label, `image ${index} has an external URI`);
    if (image.bufferView === undefined) return;
    if (!imageViews.has(image.bufferView)) imageViews.set(image.bufferView, []);
    imageViews.get(image.bufferView).push(index);
  });

  const plan = []; // per view: { kind: 'raw'|'stream', bytes|stream, ext, logicalLength, stride }
  const report = { recipe: COOK_RECIPE, views: [], images: [], errors: {} };
  const noteError = (kind, value) => {
    report.errors[kind] = Math.max(report.errors[kind] ?? 0, value);
  };
  const imageRole = imageRoles(json);

  for (let index = 0; index < views.length; index++) {
    const view = json.bufferViews[index];
    const logical = views[index];
    const readers = byView.get(index) ?? [];
    if (imageViews.has(index)) {
      plan[index] = { kind: 'raw', bytes: logical.bytes };
      continue;
    }
    const single = readers.length === 1 && !readers.sparse ? accessors[readers[0]] : null;
    const kind = single ? usage.get(readers[0]) : undefined;
    const width = single ? COMPONENTS[single.type] : 0;
    const elementBytes = single ? width * TYPED[single.componentType].BYTES_PER_ELEMENT : 0;
    const whole =
      single &&
      (single.byteOffset ?? 0) === 0 &&
      (view.byteStride === undefined || view.byteStride === elementBytes) &&
      single.count * elementBytes === view.byteLength;
    if (whole && single.componentType === FLOAT && LOSSY.has(kind) && elementBytes % 4 === 0) {
      const values = floats(logical.bytes);
      if (kind === 'ANIM_ROTATION' && width === 4) {
        const bits = policy.rotationBits;
        const filtered = MeshoptEncoder.encodeFilterQuat(values, single.count, 8, bits);
        const stream = MeshoptEncoder.encodeGltfBuffer(filtered, single.count, 8, 'ATTRIBUTES');
        const decoded = new Uint8Array(single.count * 8);
        MeshoptDecoder.decodeGltfBuffer(
          decoded,
          single.count,
          8,
          stream,
          'ATTRIBUTES',
          'QUATERNION',
        );
        const error = quaternionAngleError(values, new Int16Array(decoded.buffer));
        if (error <= policy.rotationRadians) {
          noteError(kind, error);
          plan[index] = {
            kind: 'stream',
            stream,
            ext: { byteStride: 8, count: single.count, mode: 'ATTRIBUTES', filter: 'QUATERNION' },
            accessorChange: { index: readers[0], componentType: SHORT, normalized: true },
          };
          report.views.push({ view: index, kind, filter: `QUATERNION/${bits}`, error });
          continue;
        }
      }
      if (kind === 'WEIGHTS') {
        const snapped = snapWeights(values, width, policy.weightGrid);
        const encoded = encodeExpWithin(
          snapped,
          single.count,
          elementBytes,
          0,
          'SharedComponent',
          true,
        );
        const error = maxAbsError(values, snapped);
        if (encoded) {
          noteError(kind, error);
          plan[index] = {
            kind: 'stream',
            stream: encoded.stream,
            ext: {
              byteStride: elementBytes,
              count: single.count,
              mode: 'ATTRIBUTES',
              filter: 'EXPONENTIAL',
            },
          };
          report.views.push({ view: index, kind, filter: `EXPONENTIAL/${encoded.bits}`, error });
          continue;
        }
      }
      if (kind !== 'WEIGHTS' && kind !== 'ANIM_ROTATION') {
        const limit = tolerance(kind, policy);
        const mode = kind.startsWith('ANIM') ? 'Separate' : 'SharedComponent';
        const encoded = encodeExpWithin(values, single.count, elementBytes, limit, mode);
        if (encoded) {
          noteError(kind, encoded.error);
          plan[index] = {
            kind: 'stream',
            stream: encoded.stream,
            ext: {
              byteStride: elementBytes,
              count: single.count,
              mode: 'ATTRIBUTES',
              filter: 'EXPONENTIAL',
            },
          };
          // GLTFLoader builds bounds from POSITION min/max; keep them those of the decoded data.
          if (kind === 'POSITION' && single.min && single.max) {
            const min = new Array(width).fill(Infinity),
              max = new Array(width).fill(-Infinity);
            for (let i = 0; i < encoded.decoded.length; i++) {
              const c = i % width;
              if (encoded.decoded[i] < min[c]) min[c] = encoded.decoded[i];
              if (encoded.decoded[i] > max[c]) max[c] = encoded.decoded[i];
            }
            plan[index].bounds = { index: readers[0], min, max };
          }
          report.views.push({
            view: index,
            kind,
            filter: `EXPONENTIAL/${encoded.bits}`,
            error: encoded.error,
          });
          continue;
        }
      }
    }
    // Lossless: the existing stream verbatim, a new lossless stream, or the plain bytes.
    if (logical.compressed) {
      const { data, buffer, byteOffset, byteLength, ...ext } = logical.compressed;
      (void buffer, byteOffset, byteLength);
      plan[index] = { kind: 'stream', stream: data, ext };
      continue;
    }
    const stride = view.byteStride ?? (whole ? elementBytes : 0);
    if (
      whole &&
      stride &&
      stride % 4 === 0 &&
      stride <= 256 &&
      kind !== 'IBM' &&
      !kind?.includes('INDICES')
    ) {
      const count = view.byteLength / stride;
      const stream = MeshoptEncoder.encodeGltfBuffer(
        logical.bytes.slice(),
        count,
        stride,
        'ATTRIBUTES',
      );
      plan[index] = {
        kind: 'stream',
        stream,
        ext: { byteStride: stride, count, mode: 'ATTRIBUTES' },
      };
      continue;
    }
    plan[index] = { kind: 'raw', bytes: logical.bytes };
  }

  // Images: re-encode PNG masters; every texture that read a re-encoded image reads it through
  // EXT_texture_webp, which becomes required (there is no PNG fallback left to read).
  const replacedImages = new Set();
  if (sharp)
    for (const [viewIndex, imageIndices] of imageViews) {
      // Images sharing one view (a packed file stores identical images once) are one decode.
      const first = json.images[imageIndices[0]];
      if (imageIndices.some((i) => json.images[i].mimeType !== first.mimeType))
        fail(label, `images of view ${viewIndex} disagree on their MIME type`);
      const infos = imageIndices.map((i) => imageRole.get(i)).filter(Boolean);
      const info = infos.length
        ? { roles: new Set(infos.flatMap((i) => [...i.roles])), alpha: infos.some((i) => i.alpha) }
        : undefined;
      const result = await cookImage(
        plan[viewIndex].bytes,
        first.mimeType,
        info,
        policy,
        sharp,
        alphaSampled,
      );
      const entry = {
        image: imageIndices.length === 1 ? imageIndices[0] : imageIndices,
        name: first.name ?? null,
        mime: first.mimeType,
        bytes: plan[viewIndex].bytes.length,
      };
      if (result?.bytes) {
        plan[viewIndex] = { kind: 'raw', bytes: new Uint8Array(result.bytes) };
        for (const i of imageIndices) {
          json.images[i].mimeType = result.mime;
          if (result.mime === 'image/webp') replacedImages.add(i);
        }
        Object.assign(entry, {
          cooked: result.encoding,
          cookedBytes: result.bytes.length,
          width: result.width,
          height: result.height,
          ...(result.resizedFrom ? { resizedFrom: result.resizedFrom } : {}),
          psnr: result.psnr,
          maxChannelError: result.maxChannelError,
        });
      } else entry.kept = result?.kept ?? 'unused';
      report.images.push(entry);
    }
  if (replacedImages.size) {
    for (const texture of json.textures ?? []) {
      if (texture.extensions?.[WEBP]) continue;
      if (replacedImages.has(texture.source)) {
        texture.extensions = { ...(texture.extensions ?? {}), [WEBP]: { source: texture.source } };
        delete texture.source;
      }
    }
    // A texture already reading WebP through the extension may still name the PNG as `source`.
    for (const texture of json.textures ?? [])
      if (texture.source !== undefined && replacedImages.has(texture.source)) delete texture.source;
    json.extensionsUsed = [...new Set([...(json.extensionsUsed ?? []), WEBP])];
    json.extensionsRequired = [...new Set([...(json.extensionsRequired ?? []), WEBP])];
  }

  // Accessor type changes (quaternion rotations become normalized int16) and decoded bounds.
  for (const entry of plan) {
    if (entry?.bounds) {
      accessors[entry.bounds.index].min = entry.bounds.min;
      accessors[entry.bounds.index].max = entry.bounds.max;
    }
    if (entry?.accessorChange) {
      const accessor = accessors[entry.accessorChange.index];
      accessor.componentType = entry.accessorChange.componentType;
      accessor.normalized = entry.accessorChange.normalized;
      delete accessor.min;
      delete accessor.max;
    }
  }

  // Assemble: BIN holds plain views and compressed streams; buffer 1 is the decoded fallback.
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
  json.bufferViews = plan.map((entry, index) => {
    const previous = original.bufferViews[index];
    const out = {};
    if (previous.name !== undefined) out.name = previous.name;
    if (entry.kind === 'raw') {
      out.buffer = 0;
      out.byteOffset = push(entry.bytes);
      out.byteLength = entry.bytes.length;
      if (previous.byteStride !== undefined) out.byteStride = previous.byteStride;
      if (previous.target !== undefined) out.target = previous.target;
      return out;
    }
    anyStream = true;
    const logicalLength = entry.ext.count * entry.ext.byteStride;
    const streamOffset = push(entry.stream);
    out.buffer = 1;
    out.byteOffset = fallbackLength;
    out.byteLength = logicalLength;
    fallbackLength = align4(fallbackLength + logicalLength);
    if (previous.byteStride !== undefined)
      out.byteStride = entry.ext.mode === 'ATTRIBUTES' ? entry.ext.byteStride : previous.byteStride;
    if (previous.target !== undefined) out.target = previous.target;
    const ext = {
      buffer: 0,
      byteOffset: streamOffset,
      byteLength: entry.stream.length,
      byteStride: entry.ext.byteStride,
      count: entry.ext.count,
      mode: entry.ext.mode,
    };
    if (entry.ext.filter && entry.ext.filter !== 'NONE') ext.filter = entry.ext.filter;
    out.extensions = { [MESHOPT]: ext };
    return out;
  });
  json.buffers = [{ byteLength: binLength }];
  if (anyStream) {
    json.buffers.push({
      byteLength: fallbackLength,
      extensions: { [MESHOPT]: { fallback: true } },
    });
    json.extensionsUsed = [...new Set([...(json.extensionsUsed ?? []), MESHOPT])].filter(
      (n) => n !== KHR_MESHOPT,
    );
    json.extensionsRequired = [...new Set([...(json.extensionsRequired ?? []), MESHOPT])].filter(
      (n) => n !== KHR_MESHOPT,
    );
  }
  const binChunk = Buffer.alloc(binLength);
  for (const { offset, bytes } of chunks) binChunk.set(bytes, offset);
  let jsonText = Buffer.from(JSON.stringify(json), 'utf8');
  const jsonPadded = Buffer.alloc(align4(jsonText.length), 0x20);
  jsonText.copy(jsonPadded);
  const total = 12 + 8 + jsonPadded.length + 8 + binChunk.length;
  const header = Buffer.alloc(12);
  header.writeUInt32LE(GLB_MAGIC, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(total, 8);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonPadded.length, 0);
  jsonHeader.writeUInt32LE(CHUNK_JSON, 4);
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(binChunk.length, 0);
  binHeader.writeUInt32LE(CHUNK_BIN, 4);
  const bytes = Buffer.concat([header, jsonHeader, jsonPadded, binHeader, binChunk]);
  report.source = { bytes: source.length, sha256: sha256(source) };
  report.cooked = { bytes: bytes.length, sha256: sha256(bytes) };
  verifyCooked(original, bin, bytes, report, policy, label);
  return { bytes, report };
}

/** Decode the cooked file again and compare every accessor with the master. */
export function verifyCooked(original, originalBin, cookedBytes, report, policy, label) {
  const { json, bin } = parseGlb(cookedBytes, `${label} (cooked)`);
  const before = logicalViews(original, originalBin, label);
  const after = logicalViews(json, bin, `${label} (cooked)`);
  const same = (key) => JSON.stringify(original[key] ?? null) === JSON.stringify(json[key] ?? null);
  for (const key of [
    'scene',
    'scenes',
    'nodes',
    'meshes',
    'skins',
    'animations',
    'materials',
    'samplers',
    'cameras',
  ])
    if (!same(key)) fail(label, `cooking changed ${key}`);
  if ((original.accessors ?? []).length !== (json.accessors ?? []).length)
    fail(label, 'accessor count changed');
  if ((original.images ?? []).length !== (json.images ?? []).length)
    fail(label, 'image count changed');
  const usage = accessorUsage(original);
  (original.accessors ?? []).forEach((a, index) => {
    const b = json.accessors[index];
    for (const key of ['bufferView', 'count', 'type'])
      if (a[key] !== b[key]) fail(label, `accessor ${index} ${key} changed`);
    if (a.bufferView === undefined) return;
    const width = COMPONENTS[a.type];
    const read = (accessor, views, gltf) => {
      const T = TYPED[accessor.componentType];
      const view = gltf.bufferViews[accessor.bufferView];
      const element = width * T.BYTES_PER_ELEMENT;
      const stride = view.byteStride ?? element;
      const raw = views[accessor.bufferView].bytes;
      const copy = new Uint8Array(raw.byteLength);
      copy.set(raw);
      const out = new Float64Array(accessor.count * width);
      const dv = new DataView(copy.buffer);
      const get = {
        5120: (o) => dv.getInt8(o),
        5121: (o) => dv.getUint8(o),
        5122: (o) => dv.getInt16(o, true),
        5123: (o) => dv.getUint16(o, true),
        5125: (o) => dv.getUint32(o, true),
        5126: (o) => dv.getFloat32(o, true),
      }[accessor.componentType];
      const scale = accessor.normalized
        ? { 5120: 1 / 127, 5121: 1 / 255, 5122: 1 / 32767, 5123: 1 / 65535 }[accessor.componentType]
        : 1;
      for (let i = 0; i < accessor.count; i++)
        for (let c = 0; c < width; c++) {
          let value =
            get((accessor.byteOffset ?? 0) + i * stride + c * T.BYTES_PER_ELEMENT) * scale;
          if (accessor.normalized && accessor.componentType % 2 === 0) value = Math.max(-1, value);
          out[i * width + c] = value;
        }
      return out;
    };
    const x = read(a, before, original),
      y = read(b, after, json);
    const kind = usage.get(index);
    let limit = 0;
    if (kind === 'ANIM_ROTATION') limit = 2 * Math.sin(policy.rotationRadians / 2) * 1.01;
    // Rounding slack is re-summed onto the largest weight: at most width/2 lattice steps.
    else if (kind === 'WEIGHTS') limit = (width / 2 + 0.5) / policy.weightGrid;
    else if (LOSSY.has(kind)) limit = tolerance(kind, policy) * 1.0001;
    // Rotations may flip sign as a whole; compare per quaternion up to sign.
    if (kind === 'ANIM_ROTATION' && width === 4) {
      for (let i = 0; i < x.length; i += 4) {
        const d1 = Math.max(...[0, 1, 2, 3].map((c) => Math.abs(x[i + c] - y[i + c])));
        const d2 = Math.max(...[0, 1, 2, 3].map((c) => Math.abs(x[i + c] + y[i + c])));
        if (Math.min(d1, d2) > limit + 1e-4)
          fail(label, `accessor ${index} rotation ${i / 4} differs by ${Math.min(d1, d2)}`);
      }
      return;
    }
    for (let i = 0; i < x.length; i++) {
      const d = Math.abs(x[i] - y[i]);
      if (!(d <= limit))
        fail(label, `accessor ${index} (${kind}) element ${i} differs by ${d} (limit ${limit})`);
    }
  });
  report.verified = true;
}
