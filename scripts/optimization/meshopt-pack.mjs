// Lossless EXT_meshopt_compression for embedded GLBs, using the installed meshoptimizer 1.1.1.
// No reordering, quantisation or filters: every compressed view must decode to its exact
// source bytes before it is accepted. Views that cannot be compressed safely stay stored.
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { COMPONENT_BYTES, MESHOPT, asBuffer, elementSize, padding4, storedViewBytes } from './glb.mjs';
import { overlappingViews, viewUsage } from './gltf-usage.mjs';

// EXT_meshopt_compression stream headers: attribute codec v0, index codecs v1. Decoders also
// accept attribute v1 (0xa1), which only KHR_meshopt_compression allows, so check explicitly.
export const MESHOPT_HEADER = Object.freeze({ ATTRIBUTES: 0xa0, TRIANGLES: 0xe1, INDICES: 0xd1 });

let ready;
export const meshoptReady = () => (ready ??= Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]));

const gcd = (a, b) => (b ? gcd(b, a % b) : a);

function encodeExactly(source, count, stride, mode, label) {
  // encodeGltfBuffer defaults to version 0 for ATTRIBUTES; the index codecs ignore it.
  const encoded = MeshoptEncoder.encodeGltfBuffer(source, count, stride, mode, 0);
  if (encoded[0] !== MESHOPT_HEADER[mode])
    throw new Error(`${label}: ${mode} encoder wrote header 0x${encoded[0].toString(16)}, not an EXT stream`);
  const decoded = new Uint8Array(count * stride);
  MeshoptDecoder.decodeGltfBuffer(decoded, count, stride, encoded, mode);
  return { encoded, exact: Buffer.from(decoded.buffer).equals(asBuffer(source)) };
}

function planView(json, bin, index, use, overlapping, label) {
  const view = json.bufferViews[index],
    where = `${label} buffer view ${index}`,
    keep = (reason) => ({ index, action: 'keep', reason });
  if (use.images.length) return keep(use.accessors.length ? 'image-and-accessor' : 'image');
  if (use.sparse) return keep('sparse');
  if (!use.accessors.length) return keep('unreferenced');
  if (overlapping) return keep('overlapping');
  // Encoders read typed arrays from offset 0; never hand them a misaligned file slice.
  const source = new Uint8Array(view.byteLength);
  source.set(storedViewBytes(json, bin, index));
  const accessors = use.accessors.map((accessor) => json.accessors[accessor]);
  if (use.roles.has('index')) {
    if (use.roles.size !== 1) return keep('index-and-data');
    if (view.byteStride !== undefined) return keep('strided-index');
    const types = new Set(accessors.map((accessor) => accessor.componentType));
    if (types.size !== 1) return keep('mixed-index-types');
    const size = COMPONENT_BYTES[[...types][0]];
    if (size !== 2 && size !== 4) return keep('8-bit-indices');
    if (view.byteLength % size) return keep('index-view-length');
    const count = view.byteLength / size,
      modes = use.triangleLists && count % 3 === 0 ? ['TRIANGLES', 'INDICES'] : ['INDICES'];
    let best = null,
      rotated = false;
    for (const mode of modes) {
      const { encoded, exact } = encodeExactly(source, count, size, mode, where);
      if (!exact) {
        // The triangle codec may rotate a triangle's vertices; keep the exact index order instead.
        if (mode === 'TRIANGLES') {
          rotated = true;
          continue;
        }
        throw new Error(`${where}: INDICES round trip changed the index bytes`);
      }
      if (!best || encoded.length < best.encoded.length) best = { mode, encoded };
    }
    if (!best || best.encoded.length >= view.byteLength) return keep('no-gain');
    return { index, action: 'compress', mode: best.mode, stride: size, count, encoded: best.encoded, rotated };
  }
  const sizes = accessors.map((accessor, i) => elementSize(accessor, `accessor ${use.accessors[i]}`));
  if (view.byteStride !== undefined && (accessors.length > 1 || view.byteStride !== sizes[0]))
    return keep('interleaved-or-strided');
  const stride = view.byteStride ?? sizes.reduce(gcd);
  if (stride % 4) return keep('element-size-not-multiple-of-4');
  if (stride > 256) return keep('element-size-over-256');
  if (view.byteLength % stride) return keep('length-not-multiple-of-element-size');
  const count = view.byteLength / stride,
    { encoded, exact } = encodeExactly(source, count, stride, 'ATTRIBUTES', where);
  if (!exact) throw new Error(`${where}: ATTRIBUTES round trip changed the data`);
  if (encoded.length >= view.byteLength) return keep('no-gain');
  return { index, action: 'compress', mode: 'ATTRIBUTES', stride, count, encoded, rotated: false };
}

/** Compress compatible views; the result has the same view indices and logical byte lengths. */
export async function compressViews(json, bin, label) {
  await meshoptReady();
  if ((json.buffers ?? []).length > 1) throw new Error(`${label}: expected one embedded buffer before compression`);
  if ((json.extensionsUsed ?? []).includes(MESHOPT)) throw new Error(`${label}: already uses ${MESHOPT}`);
  const usage = viewUsage(json),
    overlaps = overlappingViews(json),
    plans = (json.bufferViews ?? []).map((_, index) =>
      planView(json, bin, index, usage[index], overlaps.has(index), label),
    ),
    compressed = plans.filter((plan) => plan.action === 'compress'),
    out = structuredClone(json),
    parts = [];
  let length = 0,
    fallbackLength = 0;
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
  for (const plan of plans) {
    const view = out.bufferViews[plan.index];
    if (plan.action === 'keep') {
      view.buffer = 0;
      view.byteOffset = store(storedViewBytes(json, bin, plan.index));
      continue;
    }
    const at = store(plan.encoded);
    // The logical (decoded) range lives in a fallback buffer that has no data and no URI.
    fallbackLength += padding4(fallbackLength);
    view.buffer = 1;
    view.byteOffset = fallbackLength;
    fallbackLength += view.byteLength;
    view.extensions = {
      ...(view.extensions ?? {}),
      [MESHOPT]: {
        buffer: 0,
        byteOffset: at,
        byteLength: plan.encoded.length,
        byteStride: plan.stride,
        count: plan.count,
        mode: plan.mode,
      },
    };
  }
  if (length) out.buffers = [{ ...(json.buffers?.[0] ?? {}), byteLength: length }];
  else delete out.buffers;
  if (compressed.length) {
    out.buffers.push({ byteLength: fallbackLength, extensions: { [MESHOPT]: { fallback: true } } });
    out.extensionsUsed = [...(json.extensionsUsed ?? []), MESHOPT];
    // Required: a loader without a meshopt decoder must fail instead of reading empty data.
    out.extensionsRequired = [...(json.extensionsRequired ?? []), MESHOPT];
  }
  const kept = {},
    modes = {};
  for (const plan of plans)
    if (plan.action === 'keep') kept[plan.reason] = (kept[plan.reason] ?? 0) + 1;
    else modes[plan.mode] = (modes[plan.mode] ?? 0) + 1;
  return {
    json: out,
    bin: Buffer.concat(parts, length),
    report: {
      views: plans.length,
      compressedViews: compressed.length,
      modes,
      keptViews: kept,
      triangleRotationFallbacks: compressed.filter((plan) => plan.rotated).length,
      logicalViewBytes: (json.bufferViews ?? []).reduce((sum, view) => sum + view.byteLength, 0),
      compressedStreamBytes: compressed.reduce((sum, plan) => sum + plan.encoded.length, 0),
      storedBinBytes: length,
      fallbackBufferBytes: fallbackLength,
    },
  };
}
