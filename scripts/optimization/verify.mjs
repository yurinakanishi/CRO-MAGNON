// Independent verification of optimized candidates. Compressed views are decoded with
// MeshoptDecoder (not with any encoder helper) and compared with the original bytes.
// This checks data and structure only; it does not render, so it is not visual or GPU QA.
import { MeshoptDecoder } from 'meshoptimizer';
import { OPTIONAL_LOD_ATTRIBUTES } from './contract.mjs';
import {
  MESHOPT,
  accessorElements,
  asBuffer,
  elementSize,
  jsonDifference,
  primitiveTriangles,
  sha256,
  storedViews,
  triangleCount,
  validateDocument,
} from './glb.mjs';
import { checkExtensions, imageSemantics } from './gltf-usage.mjs';
import { MIME_BY_FORMAT, sniffImage, targetDimensions } from './images.mjs';
import { maximumEdgeOf, textureEdges, treatmentEdge } from './textures.mjs';

// EXT_meshopt_compression: attribute codec v0, triangle/index codecs v1.
const EXT_HEADERS = Object.freeze({ ATTRIBUTES: 0xa0, TRIANGLES: 0xe1, INDICES: 0xd1 });
const hex = (value) => `0x${value.toString(16).padStart(2, '0')}`;

function expectEqual(a, b, where) {
  const difference = jsonDifference(a, b, where);
  if (difference) throw new Error(difference);
}

/** Decode every view of a candidate and check that the BIN chunk holds nothing else. */
export async function decodeViews(doc, label) {
  await MeshoptDecoder.ready;
  const regions = [],
    views = (doc.json.bufferViews ?? []).map((view, index) => {
      const ext = view.extensions?.[MESHOPT];
      if (!ext) {
        const offset = view.byteOffset ?? 0;
        regions.push([offset, offset + view.byteLength]);
        return doc.bin.subarray(offset, offset + view.byteLength);
      }
      const offset = ext.byteOffset ?? 0,
        source = new Uint8Array(doc.bin.subarray(offset, offset + ext.byteLength));
      regions.push([offset, offset + ext.byteLength]);
      if (source[0] !== EXT_HEADERS[ext.mode])
        throw new Error(
          `${label}: buffer view ${index} ${ext.mode} stream header ${hex(source[0])} is not the EXT_meshopt_compression header ${hex(EXT_HEADERS[ext.mode])}`,
        );
      const target = new Uint8Array(ext.count * ext.byteStride);
      try {
        MeshoptDecoder.decodeGltfBuffer(
          target,
          ext.count,
          ext.byteStride,
          source,
          ext.mode,
          ext.filter,
        );
      } catch (error) {
        throw new Error(`${label}: buffer view ${index} does not decode (${error.message})`);
      }
      return Buffer.from(target.buffer);
    });
  return { views, regions };
}

/** Stored ranges may not overlap, and only 4-byte alignment gaps are allowed between them. */
export function checkStorage(regions, binLength, label) {
  const sorted = regions
    .map(([start, end]) => [start, end])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let end = 0,
    gaps = 0;
  for (const [start, stop] of sorted) {
    if (start < end) throw new Error(`${label}: stored ranges overlap at byte ${start}`);
    if (start - end > 3)
      throw new Error(`${label}: ${start - end} unreferenced bytes before byte ${start}`);
    gaps += start - end;
    end = stop;
  }
  if (binLength - end > 3)
    throw new Error(`${label}: ${binLength - end} unreferenced trailing bytes in the BIN chunk`);
  return gaps + binLength - end;
}

function checkCandidateContainer(output, label) {
  validateDocument(output.json, output.bin, label, { allowMeshopt: true });
  checkExtensions(output.json, label, { allowMeshopt: true });
  const compressed = (output.json.bufferViews ?? []).filter(
    (view) => view.extensions?.[MESHOPT],
  ).length;
  if (compressed) {
    if (!(output.json.extensionsRequired ?? []).includes(MESHOPT))
      throw new Error(`${label}: compressed views exist but ${MESHOPT} is not required`);
    for (const [index, buffer] of (output.json.buffers ?? []).entries())
      if (index > 0 && buffer.uri !== undefined)
        throw new Error(`${label}: fallback buffer ${index} has a URI`);
  } else if ((output.json.extensionsUsed ?? []).includes(MESHOPT))
    throw new Error(`${label}: ${MESHOPT} is declared without any compressed view`);
  return compressed;
}

const withMeshopt = (list, compressed) => (compressed ? [...(list ?? []), MESHOPT] : (list ?? []));

function checkImage(before, after, record, edge, where) {
  const a = sniffImage(before),
    b = sniffImage(after);
  if (b.format !== a.format)
    throw new Error(`${where}: format changed from ${a.format} to ${b.format}`);
  if (Math.max(b.width, b.height) > edge)
    throw new Error(`${where}: ${b.width}x${b.height} exceeds ${edge}`);
  if (b.width > a.width || b.height > a.height) throw new Error(`${where}: upscaled`);
  if (b.alpha !== a.alpha) throw new Error(`${where}: alpha channel presence changed`);
  if (a.webp && b.webp.lossless !== a.webp.lossless)
    throw new Error(`${where}: WebP lossless mode changed`);
  if (a.png && b.png.colorChunks.join() !== a.png.colorChunks.join())
    throw new Error(`${where}: PNG colour chunks changed`);
  if (a.png && b.png.bitDepth < a.png.bitDepth) throw new Error(`${where}: PNG bit depth dropped`);
  if (record) {
    if (b.width !== record.output.width || b.height !== record.output.height)
      throw new Error(
        `${where}: ${b.width}x${b.height} differs from the recorded ${record.output.width}x${record.output.height}`,
      );
    if (sha256(after) !== record.output.sha256)
      throw new Error(`${where}: bytes differ from the recorded SHA-256`);
    if (!record.resized && !asBuffer(after).equals(asBuffer(before)))
      throw new Error(`${where}: an image recorded as unchanged differs`);
  }
  return b;
}

/** A standalone texture candidate: exactly the planned whole-image resize of the recorded
 * original. `plan` is the record's plan (source, target, edge); `output` its output summary. */
export function verifyStandaloneImage({ source, candidate, plan, output, label }) {
  const fail = (message) => {
    throw new Error(`${label}: ${message}`);
  };
  if (source.length !== plan.source.bytes || sha256(source) !== plan.source.sha256)
    fail('the original differs from the recorded SHA-256/length');
  if (candidate.length !== output.bytes || sha256(candidate) !== output.sha256)
    fail('the candidate differs from the recorded SHA-256/length');
  const a = sniffImage(source),
    b = checkImage(source, candidate, null, plan.edge, label),
    expected = targetDimensions(a.width, a.height, plan.edge);
  if (a.width !== plan.source.width || a.height !== plan.source.height)
    fail('the original size differs from the plan');
  if (!expected.resized) fail('the original is within the edge and needs no candidate');
  if (
    b.width !== expected.width ||
    b.height !== expected.height ||
    b.width !== output.width ||
    b.height !== output.height
  )
    fail(`${b.width}x${b.height} differs from the planned ${expected.width}x${expected.height}`);
  if (MIME_BY_FORMAT[b.format] !== plan.source.mimeType || output.mimeType !== plan.source.mimeType)
    fail('the mime type changed');
  if (b.alpha !== plan.source.alpha || output.alpha !== b.alpha) fail('alpha presence changed');
  // Whole-image resize: only rounding each side to whole pixels (at most half a pixel of the
  // exact scaled size) may move the aspect ratio.
  const aspectError = Math.abs((b.width / b.height) * (a.height / a.width) - 1),
    ex = 0.5 / (b.width - 0.5),
    ey = 0.5 / (b.height - 0.5),
    aspectLimit = (ex + ey) / (1 - Math.min(0.999, Math.max(ex, ey)));
  if (!(aspectError <= aspectLimit))
    fail(`aspect ratio moved by ${aspectError}, more than pixel rounding allows`);
  return {
    status: 'passed',
    format: b.format,
    width: b.width,
    height: b.height,
    alpha: b.alpha,
    aspectError,
    checks: [
      'original SHA-256/length',
      'candidate SHA-256/length',
      'format and mime',
      'planned size, no upscale, edge',
      'alpha',
      'PNG colour chunks and bit depth',
      'aspect within pixel rounding',
    ],
  };
}

/** Per-image edges: each image's recorded treatment is the one its source materials give it, its
 * maximum edge is the policy's for that treatment, its recorded source is the original image and
 * its size is exactly the planned resize at that edge. Returns the edge to check the image against. */
function declaredEdge(records, semantics, edges, before, after, where) {
  for (const record of records) {
    const actual = semantics[record.index].treatment,
      expected = treatmentEdge(edges, actual, where);
    if (record.treatment !== actual)
      throw new Error(
        `${where}: recorded as ${record.treatment}, but the source samples it as ${actual}`,
      );
    if (record.maximumEdge !== expected)
      throw new Error(
        `${where}: maximum edge ${record.maximumEdge} is not the ${expected} the policy gives ${actual} images`,
      );
    if (record.maximumEdge !== records[0].maximumEdge)
      throw new Error(`${where}: images sharing this view need different edges`);
  }
  const [record] = records,
    a = sniffImage(before),
    b = sniffImage(after),
    target = targetDimensions(a.width, a.height, record.maximumEdge);
  if (
    record.source?.sha256 !== sha256(before) ||
    record.source.bytes !== before.length ||
    record.source.width !== a.width ||
    record.source.height !== a.height
  )
    throw new Error(`${where}: the recorded source differs from the original image`);
  if (b.width !== target.width || b.height !== target.height || record.resized !== target.resized)
    throw new Error(
      `${where}: ${b.width}x${b.height} is not the planned ${target.width}x${target.height} at edge ${record.maximumEdge}`,
    );
  return record.maximumEdge;
}

/** Same-structure derivative (texture resize and/or compression) of one source GLB. `edges`
 * (`{ color, normal, data }`) holds every image to its own treatment's edge; without it, as for
 * records written before per-image edges, every image is checked against `edge`. */
export async function verifyDerived({ source, output, textures = [], edge, edges = null, label }) {
  if (edges && (jsonDifference(textureEdges(edges, label), edges) || maximumEdgeOf(edges) !== edge))
    throw new Error(
      `${label}: maximum edge ${edge} is not the largest of the texture edges ${JSON.stringify(edges)}`,
    );
  const semantics = edges ? imageSemantics(source.json, label) : null;
  const compressed = checkCandidateContainer(output, label),
    { views, regions } = await decodeViews(output, label),
    unreferencedBytes = checkStorage(regions, output.bin.length, label),
    sourceViews = storedViews(source),
    skip = new Set(['bufferViews', 'buffers', 'extensionsUsed', 'extensionsRequired']);
  for (const key of new Set([...Object.keys(source.json), ...Object.keys(output.json)]))
    if (!skip.has(key)) expectEqual(source.json[key], output.json[key], `${label}: $.${key}`);
  expectEqual(
    withMeshopt(source.json.extensionsUsed, compressed),
    output.json.extensionsUsed ?? [],
    `${label}: extensionsUsed`,
  );
  expectEqual(
    withMeshopt(source.json.extensionsRequired, compressed),
    output.json.extensionsRequired ?? [],
    `${label}: extensionsRequired`,
  );
  if (sourceViews.length !== views.length) throw new Error(`${label}: buffer view count changed`);
  const imageViews = new Map();
  (source.json.images ?? []).forEach((image, index) =>
    imageViews.set(image.bufferView, [...(imageViews.get(image.bufferView) ?? []), index]),
  );
  let identical = 0,
    resized = 0,
    unchanged = 0;
  sourceViews.forEach((bytes, index) => {
    const a = source.json.bufferViews[index],
      b = output.json.bufferViews[index],
      where = `${label}: buffer view ${index}`;
    for (const key of ['byteStride', 'target', 'name', 'extras'])
      expectEqual(a[key], b[key], `${where} ${key}`);
    const images = imageViews.get(index);
    if (!images) {
      if (b.byteLength !== a.byteLength || !views[index].equals(bytes))
        throw new Error(`${where} differs after decoding`);
      identical++;
      return;
    }
    const record = textures.find((item) => item.index === images[0]);
    if (!record) throw new Error(`${where}: no texture record for image ${images[0]}`);
    for (const image of images.slice(1))
      if (textures.find((item) => item.index === image)?.output.sha256 !== record.output.sha256)
        throw new Error(`${where}: images sharing this view have different records`);
    const imageWhere = `${where} (image ${images.join(', ')})`,
      imageEdge = edges
        ? declaredEdge(
            images.map((image) => textures.find((item) => item.index === image)),
            semantics,
            edges,
            bytes,
            views[index],
            imageWhere,
          )
        : edge;
    checkImage(bytes, views[index], record, imageEdge, imageWhere);
    if (record.resized) resized++;
    else unchanged++;
  });
  return {
    status: 'passed',
    nonImageViewsByteIdentical: identical,
    imagesResized: resized,
    imagesUnchanged: unchanged,
    compressedViews: compressed,
    accessors: (output.json.accessors ?? []).length,
    skins: (output.json.skins ?? []).length,
    clips: (output.json.animations ?? []).length,
    triangles: triangleCount(output.json),
    alignmentPaddingBytes: unreferencedBytes,
    ...(edges ? { textureEdges: textureEdges(edges, label) } : {}),
  };
}

function accessorMeta(accessor, { withBounds = true } = {}) {
  return {
    type: accessor.type,
    componentType: accessor.componentType,
    count: accessor.count,
    normalized: !!accessor.normalized,
    name: accessor.name,
    sparse: !!accessor.sparse,
    ...(withBounds ? { min: accessor.min, max: accessor.max } : {}),
  };
}

function sameAccessor(a, aDoc, aViews, b, bDoc, bViews, where, options) {
  expectEqual(
    accessorMeta(aDoc.json.accessors[a], options),
    accessorMeta(bDoc.json.accessors[b], options),
    where,
  );
  if (!accessorElements(aDoc.json, aViews, a).equals(accessorElements(bDoc.json, bViews, b)))
    throw new Error(`${where}: data differs`);
}

function integerValues(bytes, componentType) {
  const size = { 5121: 1, 5123: 2, 5125: 4 }[componentType];
  if (!size) throw new Error(`unsupported joint component type ${componentType}`);
  const values = new Array(bytes.length / size);
  for (let i = 0; i < values.length; i++)
    values[i] =
      size === 1 ? bytes[i] : size === 2 ? bytes.readUInt16LE(2 * i) : bytes.readUInt32LE(4 * i);
  return values;
}

/** Bytes a primitive's data occupies in the stored file (the compressed stream for meshopt views);
 * a view shared with another primitive is counted for each. */
function storedPrimitiveBytes(json, primitive) {
  const views = new Set();
  for (const index of [
    ...Object.values(primitive.attributes),
    ...(primitive.indices === undefined ? [] : [primitive.indices]),
    ...(primitive.targets ?? []).flatMap((target) => Object.values(target)),
  ]) {
    const accessor = json.accessors[index];
    if (accessor.bufferView !== undefined) views.add(accessor.bufferView);
    if (accessor.sparse) {
      views.add(accessor.sparse.indices.bufferView);
      views.add(accessor.sparse.values.bufferView);
    }
  }
  return [...views].reduce(
    (sum, view) =>
      sum +
      (json.bufferViews[view].extensions?.[MESHOPT]?.byteLength ??
        json.bufferViews[view].byteLength),
    0,
  );
}

const uint32Hash = (values) => sha256(Buffer.from(Uint32Array.from(values).buffer));

/** A source-derived primitive: every vertex is the recorded source vertex, byte for byte, for every
 * attribute of the original primitive; the indices are exactly the recorded simplifier output. */
function verifySourceDerived({ high, highViews, output, views, primitive, out, record, where }) {
  const H = high.json,
    O = output.json,
    map = record?.sourceVertexIndices;
  if (!Array.isArray(map) || !map.length)
    throw new Error(`${where}: no source vertex map is recorded`);
  if (uint32Hash(map) !== record.sourceVertexSha256)
    throw new Error(`${where}: the source vertex map does not match its SHA-256`);
  const sourceCount = H.accessors[primitive.attributes.POSITION].count;
  if (
    map.some((v) => !Number.isInteger(v) || v < 0 || v >= sourceCount) ||
    new Set(map).size !== map.length
  )
    throw new Error(`${where}: the source vertex map has out-of-range or repeated vertices`);
  expectEqual(
    Object.keys(primitive.attributes),
    Object.keys(out.attributes),
    `${where} attribute names (source-derived)`,
  );
  for (const key of Object.keys(primitive.attributes)) {
    const a = H.accessors[primitive.attributes[key]],
      b = O.accessors[out.attributes[key]];
    if (
      a.type !== b.type ||
      a.componentType !== b.componentType ||
      !!a.normalized !== !!b.normalized
    )
      throw new Error(
        `${where} ${key}: type, component type or normalisation differs from the source`,
      );
    if (b.count !== map.length)
      throw new Error(`${where} ${key}: ${b.count} vertices, the map has ${map.length}`);
    const size = elementSize(a, `${where} ${key}`),
      source = accessorElements(H, highViews, primitive.attributes[key]),
      derived = accessorElements(O, views, out.attributes[key]);
    for (let i = 0; i < map.length; i++)
      if (
        !derived
          .subarray(i * size, (i + 1) * size)
          .equals(source.subarray(map[i] * size, (map[i] + 1) * size))
      )
        throw new Error(`${where} ${key}: vertex ${i} differs from source vertex ${map[i]}`);
    if (a.min || a.max) {
      const width = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type],
        values =
          a.componentType === 5126
            ? new Float32Array(
                derived.buffer.slice(derived.byteOffset, derived.byteOffset + derived.length),
              )
            : integerValues(derived, a.componentType),
        min = new Array(width).fill(Infinity),
        max = new Array(width).fill(-Infinity);
      for (let i = 0; i < values.length; i++) {
        min[i % width] = Math.min(min[i % width], values[i]);
        max[i % width] = Math.max(max[i % width], values[i]);
      }
      if (a.min) expectEqual(min, b.min, `${where} ${key} min`);
      if (a.max) expectEqual(max, b.max, `${where} ${key} max`);
    }
  }
  if (out.indices === undefined)
    throw new Error(`${where}: source-derived geometry must be indexed`);
  if (O.accessors[out.indices].componentType !== H.accessors[primitive.indices].componentType)
    throw new Error(`${where}: the index component type differs from the source`);
  const indices = integerValues(
    accessorElements(O, views, out.indices),
    O.accessors[out.indices].componentType,
  );
  if (uint32Hash(indices) !== record.indexSha256)
    throw new Error(`${where}: indices differ from the recorded simplifier output`);
  if (indices.length !== record.achievedTriangles * 3)
    throw new Error(`${where}: triangle count differs from the record`);
  for (let t = 0; t < indices.length; t += 3) {
    const [x, y, z] = [indices[t], indices[t + 1], indices[t + 2]];
    if (x === y || y === z || x === z || Math.max(x, y, z) >= map.length)
      throw new Error(`${where}: triangle ${t / 3} is degenerate or out of range`);
  }
  if (out.targets?.length)
    throw new Error(`${where}: source-derived geometry has no morph targets`);
}

/** Startup actor: per primitive the recorded geometry source (the original full model's own
 * primitive, byte-equal after decoding, or the adopted LOD's), the full-model skeleton, clips and
 * materials, and nothing stale. `startup` is the derivation report (`geometry.primitives`). */
export async function verifyStartup({ high, lod, output, highOutput, edge, label, startup }) {
  const sourceOf = (m, p) => {
    const entry = startup?.geometry?.primitives?.find(
      (item) => item.mesh === m && item.primitive === p,
    );
    if (!entry || !['full-model', 'source-simplified', 'adopted-lod'].includes(entry.source))
      throw new Error(`${label}: mesh ${m} primitive ${p} has no recorded geometry source`);
    return entry.source;
  };
  const simplificationOf = (m, p) =>
    startup.primitives?.find((item) => item.mesh === m && item.primitive === p)?.geometry
      ?.simplification;
  checkCandidateContainer(highOutput, `${label} full candidate`);
  const compressed = checkCandidateContainer(output, label),
    decoded = await decodeViews(output, label),
    views = decoded.views,
    alignmentPaddingBytes = checkStorage(decoded.regions, output.bin.length, label),
    highViews = storedViews(high),
    lodViews = storedViews(lod),
    fullViews = (await decodeViews(highOutput, `${label} full candidate`)).views,
    H = high.json,
    L = lod.json,
    O = output.json,
    skip = new Set([
      'accessors',
      'bufferViews',
      'buffers',
      'meshes',
      'skins',
      'animations',
      'images',
      'extensionsUsed',
      'extensionsRequired',
    ]);
  for (const key of new Set([...Object.keys(H), ...Object.keys(O)]))
    if (!skip.has(key)) expectEqual(H[key], O[key], `${label}: $.${key}`);
  expectEqual(
    withMeshopt(H.extensionsUsed, compressed),
    O.extensionsUsed ?? [],
    `${label}: extensionsUsed`,
  );
  expectEqual(
    withMeshopt(H.extensionsRequired, compressed),
    O.extensionsRequired ?? [],
    `${label}: extensionsRequired`,
  );
  // Images: same metadata as the full model, same bytes as the optimized full model.
  if ((H.images ?? []).length !== (O.images ?? []).length)
    throw new Error(`${label}: image count differs`);
  (H.images ?? []).forEach((image, index) => {
    const { bufferView: _a, ...expected } = image,
      { bufferView: _b, ...actual } = O.images[index],
      fullImage = highOutput.json.images[index],
      where = `${label}: image ${index}`;
    expectEqual(expected, actual, where);
    if (!views[O.images[index].bufferView].equals(fullViews[fullImage.bufferView]))
      throw new Error(
        `${where}: bytes differ from the optimized full model, so textures could not be shared`,
      );
    checkImage(highViews[image.bufferView], views[O.images[index].bufferView], null, edge, where);
  });
  // Skeleton and skin binding come from the full model.
  if ((H.skins ?? []).length !== (O.skins ?? []).length)
    throw new Error(`${label}: skin count differs`);
  (H.skins ?? []).forEach((skin, s) => {
    const { inverseBindMatrices: a, ...expected } = skin,
      { inverseBindMatrices: b, ...actual } = O.skins[s];
    expectEqual(expected, actual, `${label}: skin ${s}`);
    if ((a === undefined) !== (b === undefined))
      throw new Error(`${label}: skin ${s} inverse binds missing`);
    if (a !== undefined)
      sameAccessor(a, high, highViews, b, output, views, `${label}: skin ${s} inverse binds`);
  });
  // Every clip, channel and keyframe sample from the full model.
  if ((H.animations ?? []).length !== (O.animations ?? []).length)
    throw new Error(`${label}: clip count differs`);
  let channels = 0,
    keyframes = 0;
  (H.animations ?? []).forEach((animation, a) => {
    const other = O.animations[a],
      where = `${label}: clip ${animation.name ?? a}`;
    const { samplers: _s1, ...expected } = animation,
      { samplers: _s2, ...actual } = other;
    expectEqual(expected, actual, where);
    if (animation.samplers.length !== other.samplers.length)
      throw new Error(`${where}: sampler count differs`);
    animation.samplers.forEach((sampler, s) => {
      const { input: i1, output: o1, ...first } = sampler,
        { input: i2, output: o2, ...second } = other.samplers[s];
      expectEqual(first, second, `${where} sampler ${s}`);
      sameAccessor(i1, high, highViews, i2, output, views, `${where} sampler ${s} input`);
      sameAccessor(o1, high, highViews, o2, output, views, `${where} sampler ${s} output`);
      keyframes += H.accessors[i1].count;
    });
    channels += animation.channels.length;
  });
  // Geometry per primitive from its recorded source. Retained primitives are the full model's
  // own; LOD joint indices may be renumbered but must name the same bones.
  if ((H.meshes ?? []).length !== (O.meshes ?? []).length)
    throw new Error(`${label}: mesh count differs`);
  const nodeOf = (json, mesh) => (json.nodes ?? []).find((node) => node.mesh === mesh),
    jointNames = (json, node) =>
      node?.skin === undefined
        ? null
        : json.skins[node.skin].joints.map((joint) => json.nodes[joint].name);
  let remappedJoints = 0,
    omittedOptionalAttributes = 0,
    retainedFullPrimitives = 0,
    sourceSimplifiedPrimitives = 0,
    lodPrimitives = 0,
    expectedTriangles = 0;
  const stored = [];
  (H.meshes ?? []).forEach((mesh, m) => {
    const { primitives: _p1, ...expected } = mesh,
      { primitives: _p2, ...actual } = O.meshes[m],
      lodMesh = L.meshes[m],
      outputNames = jointNames(O, nodeOf(O, m)),
      lodNames = jointNames(L, nodeOf(L, m));
    expectEqual(expected, actual, `${label}: mesh ${m}`);
    if (
      !lodMesh ||
      mesh.primitives.length !== O.meshes[m].primitives.length ||
      mesh.primitives.length !== lodMesh.primitives.length
    )
      throw new Error(`${label}: mesh ${m} primitive count differs`);
    if (!outputNames !== !lodNames)
      throw new Error(`${label}: mesh ${m} skinning differs between the LOD and the startup actor`);
    mesh.primitives.forEach((primitive, p) => {
      const out = O.meshes[m].primitives[p],
        reduced = lodMesh.primitives[p],
        where = `${label}: mesh ${m} primitive ${p}`,
        strip = ({ attributes: _a, indices: _i, targets: _t, ...rest }) => rest;
      expectEqual(strip(primitive), strip(out), where);
      stored.push({
        mesh: m,
        primitive: p,
        source: sourceOf(m, p),
        storedBytes: storedPrimitiveBytes(O, out),
      });
      if (sourceOf(m, p) === 'full-model') {
        // Byte-equal to the original full model: positions, normals, UVs, joints, weights, indices.
        expectEqual(
          Object.keys(primitive.attributes),
          Object.keys(out.attributes),
          `${where} attribute names (full model)`,
        );
        for (const key of Object.keys(primitive.attributes))
          sameAccessor(
            primitive.attributes[key],
            high,
            highViews,
            out.attributes[key],
            output,
            views,
            `${where} ${key} (full model)`,
          );
        if ((primitive.indices === undefined) !== (out.indices === undefined))
          throw new Error(`${where}: indexing differs`);
        if (out.indices !== undefined)
          sameAccessor(
            primitive.indices,
            high,
            highViews,
            out.indices,
            output,
            views,
            `${where} indices (full model)`,
          );
        if ((primitive.targets?.length ?? 0) !== (out.targets?.length ?? 0))
          throw new Error(`${where}: morph targets differ`);
        (primitive.targets ?? []).forEach((target, t) => {
          expectEqual(Object.keys(target), Object.keys(out.targets[t]), `${where} target ${t}`);
          for (const key of Object.keys(target))
            sameAccessor(
              target[key],
              high,
              highViews,
              out.targets[t][key],
              output,
              views,
              `${where} target ${t} ${key} (full model)`,
            );
        });
        expectedTriangles += primitiveTriangles(H, primitive);
        retainedFullPrimitives++;
        return;
      }
      if (sourceOf(m, p) === 'source-simplified') {
        verifySourceDerived({
          high,
          highViews,
          output,
          views,
          primitive,
          out,
          record: simplificationOf(m, p),
          where,
        });
        expectedTriangles += O.accessors[out.indices].count / 3;
        sourceSimplifiedPrimitives++;
        return;
      }
      expectedTriangles += primitiveTriangles(L, reduced);
      lodPrimitives++;
      const fullKeys = Object.keys(primitive.attributes),
        outputKeys = Object.keys(out.attributes),
        omitted = fullKeys.filter((key) => !outputKeys.includes(key));
      expectEqual(
        Object.keys(reduced.attributes).sort(),
        [...outputKeys].sort(),
        `${where} attribute names (LOD)`,
      );
      if (
        outputKeys.some((key) => !fullKeys.includes(key)) ||
        omitted.some((key) => !OPTIONAL_LOD_ATTRIBUTES.includes(key))
      )
        throw new Error(
          `${where}: attributes ${outputKeys} are not the full model's ${fullKeys} less optional ${OPTIONAL_LOD_ATTRIBUTES}`,
        );
      omittedOptionalAttributes += omitted.length;
      for (const key of Object.keys(out.attributes)) {
        const isJoints = /^JOINTS_\d+$/.test(key);
        if (!isJoints || !outputNames) {
          sameAccessor(
            reduced.attributes[key],
            lod,
            lodViews,
            out.attributes[key],
            output,
            views,
            `${where} ${key}`,
          );
          continue;
        }
        expectEqual(
          accessorMeta(L.accessors[reduced.attributes[key]], { withBounds: false }),
          accessorMeta(O.accessors[out.attributes[key]], { withBounds: false }),
          `${where} ${key}`,
        );
        const before = integerValues(
            accessorElements(L, lodViews, reduced.attributes[key]),
            L.accessors[reduced.attributes[key]].componentType,
          ),
          after = integerValues(
            accessorElements(O, views, out.attributes[key]),
            O.accessors[out.attributes[key]].componentType,
          );
        before.forEach((value, i) => {
          if (outputNames[after[i]] !== lodNames[value])
            throw new Error(
              `${where} ${key}: component ${i} binds "${outputNames[after[i]]}", the LOD bound "${lodNames[value]}"`,
            );
          if (after[i] !== value) remappedJoints++;
        });
      }
      if ((reduced.indices === undefined) !== (out.indices === undefined))
        throw new Error(`${where}: indexing differs`);
      if (out.indices !== undefined)
        sameAccessor(
          reduced.indices,
          lod,
          lodViews,
          out.indices,
          output,
          views,
          `${where} indices`,
        );
      (out.targets ?? []).forEach((target, t) => {
        for (const key of Object.keys(target))
          sameAccessor(
            reduced.targets[t][key],
            lod,
            lodViews,
            target[key],
            output,
            views,
            `${where} target ${t} ${key}`,
          );
      });
    });
  });
  // Nothing stale: every accessor and view in the startup actor is referenced.
  const usedAccessors = new Set(),
    usedViews = new Set();
  for (const mesh of O.meshes ?? [])
    for (const primitive of mesh.primitives) {
      Object.values(primitive.attributes).forEach((a) => usedAccessors.add(a));
      if (primitive.indices !== undefined) usedAccessors.add(primitive.indices);
      for (const target of primitive.targets ?? [])
        Object.values(target).forEach((a) => usedAccessors.add(a));
    }
  for (const skin of O.skins ?? [])
    if (skin.inverseBindMatrices !== undefined) usedAccessors.add(skin.inverseBindMatrices);
  for (const animation of O.animations ?? [])
    for (const sampler of animation.samplers) {
      usedAccessors.add(sampler.input);
      usedAccessors.add(sampler.output);
    }
  (O.accessors ?? []).forEach((accessor, index) => {
    if (!usedAccessors.has(index))
      throw new Error(`${label}: accessor ${index} is unreferenced (stale geometry?)`);
    if (accessor.bufferView !== undefined) usedViews.add(accessor.bufferView);
    if (accessor.sparse) {
      usedViews.add(accessor.sparse.indices.bufferView);
      usedViews.add(accessor.sparse.values.bufferView);
    }
  });
  for (const image of O.images ?? []) usedViews.add(image.bufferView);
  (O.bufferViews ?? []).forEach((_, index) => {
    if (!usedViews.has(index)) throw new Error(`${label}: buffer view ${index} is unreferenced`);
  });
  const triangles = triangleCount(O);
  if (triangles !== expectedTriangles)
    throw new Error(
      `${label}: ${triangles} triangles, the recorded sources give ${expectedTriangles}`,
    );
  return {
    status: 'passed',
    triangles,
    retainedFullPrimitives,
    sourceSimplifiedPrimitives,
    lodPrimitives,
    storedGeometryBytes: {
      retainedFull: stored
        .filter((item) => item.source === 'full-model')
        .reduce((sum, item) => sum + item.storedBytes, 0),
      sourceSimplified: stored
        .filter((item) => item.source === 'source-simplified')
        .reduce((sum, item) => sum + item.storedBytes, 0),
      adoptedLod: stored
        .filter((item) => item.source === 'adopted-lod')
        .reduce((sum, item) => sum + item.storedBytes, 0),
      primitives: stored,
    },
    clips: (O.animations ?? []).length,
    channels,
    keyframes,
    skins: (O.skins ?? []).length,
    images: (O.images ?? []).length,
    remappedJointComponents: remappedJoints,
    omittedOptionalAttributes,
    compressedViews: compressed,
    alignmentPaddingBytes,
  };
}
