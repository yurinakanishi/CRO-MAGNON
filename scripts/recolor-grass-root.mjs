// Recolour the brown/ochre root band that TRELLIS baked into the grass tuft
// textures (PLAYTEST_FEEDBACK_PLAN.md section 6, 2026-09-11):
//   node scripts/recolor-grass-root.mjs meadow-grass 03
//   node scripts/recolor-grass-root.mjs meadow-sprig 02
// Reads public/models/<key>/model.glb (single mesh, one embedded 8-bit RGBA
// PNG), finds the texels the lowest 18% of the blades reference, and replaces
// every texel there that is not leaf green (g < r*1.35) or is dull (low
// saturation) with the mean leaf-green chromaticity of the blades above 30%
// height at the texel's own luminance, so the baked shading survives. The PNG
// is re-encoded into the same bufferView and the GLB is written as
// output/model-generation/models/<key>/work/low-poly/candidate-<revision>/candidate.glb.
// Existing candidates are never overwritten. Node built-ins only.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { inflateSync, deflateSync, crc32 } from 'node:zlib';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('../', import.meta.url)),
  key = process.argv[2],
  revision = process.argv[3],
  ROOT_BAND = 0.18, // normalized height below which texels are recoloured
  LEAF_BAND = 0.3, // normalized height above which the leaf green is sampled
  LEAF_RATIO = 1.35, // g >= r*LEAF_RATIO counts as leaf green
  DULL_SATURATION = 0.55, // (max-min)/max below this counts as dull (sprig root)
  RADIUS = 1;
assert.ok(['meadow-grass', 'meadow-sprig'].includes(key), 'key must be meadow-grass or meadow-sprig');
assert.match(revision ?? '', /^\d{2}$/, 'revision must be two digits');
const source = resolve(root, 'public/models', key, 'model.glb'),
  targetDir = resolve(root, 'output/model-generation/models', key, 'work/low-poly', `candidate-${revision}`),
  target = resolve(targetDir, 'candidate.glb');
assert.ok(!existsSync(targetDir), `${targetDir} already exists; pick a new revision`);

// ---- GLB ------------------------------------------------------------------
function parseGlb(bytes) {
  assert.equal(bytes.readUInt32LE(0), 0x46546c67, 'GLB magic');
  assert.equal(bytes.readUInt32LE(8), bytes.length, 'GLB length');
  const jsonLength = bytes.readUInt32LE(12);
  assert.equal(bytes.readUInt32LE(16), 0x4e4f534a, 'JSON chunk');
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8'));
  const binLength = bytes.readUInt32LE(20 + jsonLength);
  assert.equal(bytes.readUInt32LE(24 + jsonLength), 0x004e4942, 'BIN chunk');
  const binary = bytes.subarray(28 + jsonLength, 28 + jsonLength + binLength);
  assert.equal(28 + jsonLength + binLength, bytes.length, 'exactly two chunks');
  return { json, binary };
}
function buildGlb(json, binary) {
  const pad4 = (n) => (n + 3) & ~3;
  let text = Buffer.from(JSON.stringify(json), 'utf8');
  text = Buffer.concat([text, Buffer.alloc(pad4(text.length) - text.length, 0x20)]);
  const bin = Buffer.concat([binary, Buffer.alloc(pad4(binary.length) - binary.length, 0)]);
  const out = Buffer.alloc(28 + text.length + bin.length);
  out.writeUInt32LE(0x46546c67, 0);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(out.length, 8);
  out.writeUInt32LE(text.length, 12);
  out.writeUInt32LE(0x4e4f534a, 16);
  text.copy(out, 20);
  out.writeUInt32LE(bin.length, 20 + text.length);
  out.writeUInt32LE(0x004e4942, 24 + text.length);
  bin.copy(out, 28 + text.length);
  return out;
}
function accessorFloats(json, binary, index) {
  const accessor = json.accessors[index],
    view = json.bufferViews[accessor.bufferView],
    width = { SCALAR: 1, VEC2: 2, VEC3: 3 }[accessor.type],
    stride = view.byteStride ?? width * 4,
    start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  assert.equal(accessor.componentType, 5126, `accessor ${index} is float`);
  const out = new Float32Array(accessor.count * width);
  for (let i = 0; i < accessor.count; i++)
    for (let c = 0; c < width; c++) out[i * width + c] = binary.readFloatLE(start + i * stride + c * 4);
  return out;
}
function accessorIndices(json, binary, index) {
  const accessor = json.accessors[index],
    view = json.bufferViews[accessor.bufferView],
    start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0),
    read = { 5121: (o) => binary.readUInt8(o), 5123: (o) => binary.readUInt16LE(o), 5125: (o) => binary.readUInt32LE(o) }[
      accessor.componentType
    ],
    size = { 5121: 1, 5123: 2, 5125: 4 }[accessor.componentType],
    out = new Uint32Array(accessor.count);
  for (let i = 0; i < accessor.count; i++) out[i] = read(start + i * size);
  return out;
}

// ---- PNG (8-bit RGBA, non-interlaced) ---------------------------------------
function decodePng(png) {
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'PNG signature');
  const width = png.readUInt32BE(16),
    height = png.readUInt32BE(20);
  assert.deepEqual([png[24], png[25], png[26], png[28]], [8, 6, 0, 0], 'PNG is 8-bit RGBA, non-interlaced');
  const chunks = [],
    idat = [];
  for (let at = 8; at < png.length; ) {
    const length = png.readUInt32BE(at),
      type = png.subarray(at + 4, at + 8).toString('latin1');
    if (type === 'IDAT') idat.push(png.subarray(at + 8, at + 8 + length));
    else chunks.push({ type, data: png.subarray(at + 8, at + 8 + length) });
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat)),
    stride = width * 4,
    pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)],
      line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)),
      out = pixels.subarray(y * stride, (y + 1) * stride),
      prior = y ? pixels.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= 4 ? out[i - 4] : 0,
        b = prior[i],
        c = i >= 4 ? prior[i - 4] : 0;
      let predictor = 0;
      if (filter === 1) predictor = a;
      else if (filter === 2) predictor = b;
      else if (filter === 3) predictor = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c,
          pa = Math.abs(p - a),
          pb = Math.abs(p - b),
          pc = Math.abs(p - c);
        predictor = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else assert.equal(filter, 0, 'PNG filter');
      out[i] = (line[i] + predictor) & 255;
    }
  }
  return { width, height, pixels, chunks };
}
// Re-encode with the original ancillary chunks (IHDR first, IEND last), a
// per-row adaptive filter (minimum absolute sum) and zlib level 9.
function encodePng({ width, height, pixels, chunks }) {
  const stride = width * 4,
    raw = Buffer.alloc((stride + 1) * height),
    candidates = Array.from({ length: 5 }, () => Buffer.alloc(stride));
  for (let y = 0; y < height; y++) {
    const line = pixels.subarray(y * stride, (y + 1) * stride),
      prior = y ? pixels.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    let best = 0,
      bestSum = Infinity;
    for (let filter = 0; filter < 5; filter++) {
      const out = candidates[filter];
      let sum = 0;
      for (let i = 0; i < stride; i++) {
        const a = i >= 4 ? line[i - 4] : 0,
          b = prior[i],
          c = i >= 4 ? prior[i - 4] : 0;
        let predictor = 0;
        if (filter === 1) predictor = a;
        else if (filter === 2) predictor = b;
        else if (filter === 3) predictor = (a + b) >> 1;
        else if (filter === 4) {
          const p = a + b - c,
            pa = Math.abs(p - a),
            pb = Math.abs(p - b),
            pc = Math.abs(p - c);
          predictor = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        }
        const v = (line[i] - predictor) & 255;
        out[i] = v;
        sum += v < 128 ? v : 256 - v;
      }
      if (sum < bestSum) {
        bestSum = sum;
        best = filter;
      }
    }
    raw[y * (stride + 1)] = best;
    candidates[best].copy(raw, y * (stride + 1) + 1);
  }
  const chunk = (type, data) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, 'latin1');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(data, crc32(head.subarray(4))) >>> 0, 0);
    return Buffer.concat([head, data, crc]);
  };
  const parts = [Buffer.from('89504e470d0a1a0a', 'hex')];
  for (const c of chunks) if (c.type !== 'IEND') parts.push(chunk(c.type, c.data));
  parts.push(chunk('IDAT', deflateSync(raw, { level: 9 })));
  parts.push(chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(parts);
}

// ---- colour helpers ----------------------------------------------------------
const linear = (c) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4),
  srgb = (v) => Math.round(255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055)),
  luminance = (R, G, B) => 0.2126 * R + 0.7152 * G + 0.0722 * B,
  isOchre = (r, g, b) => r > g * 0.85 && g > b * 1.1 && r > 40,
  isLeaf = (r, g) => g >= r * LEAF_RATIO,
  saturation = (r, g, b) => {
    const max = Math.max(r, g, b);
    return max ? (max - Math.min(r, g, b)) / max : 0;
  };

// ---- load ---------------------------------------------------------------------
const glb = readFileSync(source),
  { json, binary } = parseGlb(glb);
assert.equal(json.meshes.length, 1);
assert.equal(json.meshes[0].primitives.length, 1);
assert.equal(json.images.length, 1);
const primitive = json.meshes[0].primitives[0],
  positions = accessorFloats(json, binary, primitive.attributes.POSITION),
  uvs = accessorFloats(json, binary, primitive.attributes.TEXCOORD_0),
  indices = accessorIndices(json, binary, primitive.indices),
  vertexCount = positions.length / 3,
  imageView = json.bufferViews[json.images[0].bufferView],
  imageStart = imageView.byteOffset ?? 0,
  image = decodePng(binary.subarray(imageStart, imageStart + imageView.byteLength)),
  { width, height, pixels } = image;

let minY = Infinity,
  maxY = -Infinity;
for (let i = 0; i < vertexCount; i++) {
  minY = Math.min(minY, positions[i * 3 + 1]);
  maxY = Math.max(maxY, positions[i * 3 + 1]);
}
const heightOf = (i) => (positions[i * 3 + 1] - minY) / (maxY - minY),
  texelOf = (i) => {
    const x = Math.min(width - 1, Math.max(0, Math.floor(uvs[i * 2] * width))),
      y = Math.min(height - 1, Math.max(0, Math.floor(uvs[i * 2 + 1] * height)));
    return y * width + x;
  };

// Per-band stats over the texels each band's vertices reference.
function bandStats() {
  const bands = Array.from({ length: 10 }, () => new Set());
  for (let i = 0; i < vertexCount; i++) bands[Math.min(9, Math.floor(heightOf(i) * 10))].add(texelOf(i));
  return bands.map((set, band) => {
    let r = 0,
      g = 0,
      b = 0,
      ochre = 0;
    for (const t of set) {
      const R = pixels[t * 4],
        G = pixels[t * 4 + 1],
        B = pixels[t * 4 + 2];
      r += R;
      g += G;
      b += B;
      if (isOchre(R, G, B)) ochre++;
    }
    const n = set.size || 1;
    return {
      band: `${band * 10}-${band * 10 + 10}%`,
      texels: set.size,
      rgb: [r / n, g / n, b / n].map((v) => Math.round(v)),
      ochrePercent: Math.round((1000 * ochre) / n) / 10,
    };
  });
}
const before = bandStats();

// Leaf-green reference: texels referenced by vertices at >= LEAF_BAND that are
// clearly green; mean linear colour gives the target chromaticity.
const leafSum = [0, 0, 0];
let leafCount = 0;
{
  const seen = new Set();
  for (let i = 0; i < vertexCount; i++) {
    if (heightOf(i) < LEAF_BAND) continue;
    const t = texelOf(i);
    if (seen.has(t)) continue;
    seen.add(t);
    const r = pixels[t * 4],
      g = pixels[t * 4 + 1],
      b = pixels[t * 4 + 2],
      a = pixels[t * 4 + 3];
    if (a < 128 || !isLeaf(r, g) || saturation(r, g, b) < DULL_SATURATION) continue;
    leafSum[0] += linear(r);
    leafSum[1] += linear(g);
    leafSum[2] += linear(b);
    leafCount++;
  }
}
assert.ok(leafCount > 1000, `leaf-green sample too small: ${leafCount}`);
const leaf = leafSum.map((v) => v / leafCount),
  leafLuminance = luminance(...leaf);

// Root-band texels: every texel referenced by a vertex below ROOT_BAND (radius
// RADIUS), plus the texels covered by triangles whose interpolated height is
// below ROOT_BAND (so blade interiors between sparse vertices are included).
const rootTexels = new Set(),
  mark = (x, y) => {
    for (let dy = -RADIUS; dy <= RADIUS; dy++)
      for (let dx = -RADIUS; dx <= RADIUS; dx++) {
        const px = x + dx,
          py = y + dy;
        if (px >= 0 && py >= 0 && px < width && py < height) rootTexels.add(py * width + px);
      }
  };
for (let i = 0; i < vertexCount; i++) if (heightOf(i) < ROOT_BAND) mark(texelOf(i) % width, Math.floor(texelOf(i) / width));
for (let t = 0; t < indices.length; t += 3) {
  const ids = [indices[t], indices[t + 1], indices[t + 2]],
    hs = ids.map(heightOf);
  if (Math.min(...hs) >= ROOT_BAND) continue;
  const xs = ids.map((i) => uvs[i * 2] * width),
    ys = ids.map((i) => uvs[i * 2 + 1] * height),
    x0 = Math.max(0, Math.floor(Math.min(...xs))),
    x1 = Math.min(width - 1, Math.ceil(Math.max(...xs))),
    y0 = Math.max(0, Math.floor(Math.min(...ys))),
    y1 = Math.min(height - 1, Math.ceil(Math.max(...ys))),
    det = (xs[1] - xs[0]) * (ys[2] - ys[0]) - (xs[2] - xs[0]) * (ys[1] - ys[0]);
  if (Math.abs(det) < 1e-9) continue;
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const cx = x + 0.5,
        cy = y + 0.5,
        l1 = ((cx - xs[0]) * (ys[2] - ys[0]) - (xs[2] - xs[0]) * (cy - ys[0])) / det,
        l2 = ((xs[1] - xs[0]) * (cy - ys[0]) - (cx - xs[0]) * (ys[1] - ys[0])) / det,
        l0 = 1 - l1 - l2;
      if (l0 < -1e-6 || l1 < -1e-6 || l2 < -1e-6) continue;
      if (l0 * hs[0] + l1 * hs[1] + l2 * hs[2] < ROOT_BAND) mark(x, y);
    }
}

// Recolour: keep luminance, take the leaf chromaticity.
let recoloured = 0;
for (const t of rootTexels) {
  const r = pixels[t * 4],
    g = pixels[t * 4 + 1],
    b = pixels[t * 4 + 2],
    a = pixels[t * 4 + 3];
  if (a === 0) continue;
  if (isLeaf(r, g) && saturation(r, g, b) >= DULL_SATURATION) continue;
  const Y = luminance(linear(r), linear(g), linear(b)),
    scale = Y / leafLuminance;
  pixels[t * 4] = Math.max(0, Math.min(255, srgb(leaf[0] * scale)));
  pixels[t * 4 + 1] = Math.max(0, Math.min(255, srgb(leaf[1] * scale)));
  pixels[t * 4 + 2] = Math.max(0, Math.min(255, srgb(leaf[2] * scale)));
  recoloured++;
}
const after = bandStats();

// ---- write ----------------------------------------------------------------------
const originalPngBytes = imageView.byteLength,
  png = encodePng(image),
  viewIndex = json.images[0].bufferView,
  pad4 = (n) => (n + 3) & ~3,
  delta = pad4(png.length) - pad4(imageView.byteLength),
  newBinary = Buffer.concat([
    binary.subarray(0, imageStart),
    png,
    Buffer.alloc(pad4(png.length) - png.length, 0),
    binary.subarray(pad4(imageStart + imageView.byteLength)),
  ]);
imageView.byteLength = png.length;
for (const [i, view] of json.bufferViews.entries())
  if (i !== viewIndex && (view.byteOffset ?? 0) > imageStart) view.byteOffset = (view.byteOffset ?? 0) + delta;
json.buffers[0].byteLength = newBinary.length;
const out = buildGlb(json, newBinary);
// Round trip: the written GLB decodes to the recoloured pixels.
{
  const check = parseGlb(out),
    view = check.json.bufferViews[check.json.images[0].bufferView],
    decoded = decodePng(check.binary.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength));
  assert.ok(decoded.pixels.equals(pixels), 'PNG round trip');
  assert.equal(check.json.buffers[0].byteLength, check.binary.length);
}
mkdirSync(targetDir, { recursive: true });
writeFileSync(target, out);
const report = {
  key,
  revision,
  source: { sha256: createHash('sha256').update(glb).digest('hex'), bytes: glb.length },
  candidate: { path: target, sha256: createHash('sha256').update(out).digest('hex'), bytes: out.length },
  texture: { width, height, pngBytesBefore: originalPngBytes, pngBytes: png.length },
  rules: { ROOT_BAND, LEAF_BAND, LEAF_RATIO, DULL_SATURATION, RADIUS },
  leafGreen: { sRGB: leaf.map(srgb), linear: leaf.map((v) => +v.toFixed(4)), sampledTexels: leafCount },
  rootTexels: rootTexels.size,
  recoloured,
  before,
  after,
};
writeFileSync(resolve(targetDir, 'recolor-report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
