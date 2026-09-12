// Remove the root cap TRELLIS closed the grass tufts with (PLAYTEST_FEEDBACK_PLAN.md
// section 12 item 1, 2026-09-12):
//   node scripts/cut-grass-root.mjs meadow-grass 05
//   node scripts/cut-grass-root.mjs meadow-sprig 04 [--cut 0.04]
// The tufts have no separate base mesh; the reconstruction sealed the bottom of
// the clump with a dense, nearly flat root disc (grass: 285 triangles within
// +-0.12 m, sprig: 250 within +-0.04 m) that the 2026-09-11 root recolour turned
// into a green mound. This drops every triangle whose highest vertex lies below
// the cut height (default meadow-grass 0.08 m, meadow-sprig 0.04 m), keeps the
// vertex buffers, materials and texture byte-identical, rewrites only the index
// bufferView (in place, later views shifted) and writes
// output/model-generation/models/<key>/work/low-poly/candidate-<revision>/candidate.glb
// with a cut-report.json. Existing candidates are never overwritten. The model
// height (max y) is unchanged so the placement scale rules still hold; the
// placement sink in src/world-scenery.ts / src/regional-scenery.ts hides the
// cut edge below the ground. Node built-ins only.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

// The earlier 4.5 / 3 cm cut removed only the underside; the horizontal disc
// tops still occupied the 6–8 / 3–4 cm bands. Cut through the full cap.
const DEFAULT_CUT = { 'meadow-grass': 0.08, 'meadow-sprig': 0.04 };
const root = fileURLToPath(new URL('../', import.meta.url)),
  args = process.argv.slice(2),
  cutFlag = args.indexOf('--cut'),
  cutOverride = cutFlag >= 0 ? Number(args.splice(cutFlag, 2)[1]) : undefined,
  key = args[0],
  revision = args[1];
assert.ok(
  ['meadow-grass', 'meadow-sprig'].includes(key),
  'key must be meadow-grass or meadow-sprig',
);
assert.match(revision ?? '', /^\d{2}$/, 'revision must be two digits');
const cutHeight = cutOverride ?? DEFAULT_CUT[key];
assert.ok(
  Number.isFinite(cutHeight) && cutHeight > 0 && cutHeight < 0.2,
  `--cut must be a height in metres, got ${cutOverride}`,
);
const source = resolve(root, 'public/models', key, 'model.glb'),
  targetDir = resolve(
    root,
    'output/model-generation/models',
    key,
    'work/low-poly',
    `candidate-${revision}`,
  ),
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
    for (let c = 0; c < width; c++)
      out[i * width + c] = binary.readFloatLE(start + i * stride + c * 4);
  return out;
}
const INDEX_SIZE = { 5121: 1, 5123: 2, 5125: 4 };
function accessorIndices(json, binary, index) {
  const accessor = json.accessors[index],
    view = json.bufferViews[accessor.bufferView],
    start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0),
    read = {
      5121: (o) => binary.readUInt8(o),
      5123: (o) => binary.readUInt16LE(o),
      5125: (o) => binary.readUInt32LE(o),
    }[accessor.componentType],
    size = INDEX_SIZE[accessor.componentType],
    out = new Uint32Array(accessor.count);
  for (let i = 0; i < accessor.count; i++) out[i] = read(start + i * size);
  return out;
}
function encodeIndices(values, componentType) {
  const size = INDEX_SIZE[componentType],
    out = Buffer.alloc(values.length * size),
    write = {
      5121: (v, o) => out.writeUInt8(v, o),
      5123: (v, o) => out.writeUInt16LE(v, o),
      5125: (v, o) => out.writeUInt32LE(v, o),
    }[componentType];
  for (let i = 0; i < values.length; i++) write(values[i], i * size);
  return out;
}

// Triangles kept / dropped for a position array and index list.
function cut(positions, indices, height) {
  const kept = [];
  let removed = 0;
  for (let t = 0; t < indices.length; t += 3) {
    const top = Math.max(
      positions[indices[t] * 3 + 1],
      positions[indices[t + 1] * 3 + 1],
      positions[indices[t + 2] * 3 + 1],
    );
    if (top < height) removed++;
    else kept.push(indices[t], indices[t + 1], indices[t + 2]);
  }
  return { kept: Uint32Array.from(kept), removed };
}
function stats(positions, indices) {
  let minY = Infinity,
    maxY = -Infinity,
    lowestTop = Infinity;
  for (let t = 0; t < indices.length; t += 3) {
    let top = -Infinity;
    for (let k = 0; k < 3; k++) {
      const y = positions[indices[t + k] * 3 + 1];
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      top = Math.max(top, y);
    }
    lowestTop = Math.min(lowestTop, top);
  }
  return { triangles: indices.length / 3, minY, maxY, lowestTriangleTop: lowestTop };
}

// ---- load -------------------------------------------------------------------
const glb = readFileSync(source),
  { json, binary } = parseGlb(glb);
assert.equal(json.meshes.length, 1);
assert.equal(json.meshes[0].primitives.length, 1);
const primitive = json.meshes[0].primitives[0];
assert.equal(primitive.mode ?? 4, 4, 'triangle list');
const positions = accessorFloats(json, binary, primitive.attributes.POSITION),
  indexAccessor = json.accessors[primitive.indices],
  indexView = json.bufferViews[indexAccessor.bufferView],
  indices = accessorIndices(json, binary, primitive.indices);
assert.equal(indexAccessor.byteOffset ?? 0, 0, 'index accessor starts its bufferView');
assert.equal(
  indexView.byteLength,
  indices.length * INDEX_SIZE[indexAccessor.componentType],
  'index bufferView holds only the index accessor',
);
assert.equal(
  json.accessors.filter((a) => a.bufferView === indexAccessor.bufferView).length,
  1,
  'index bufferView is not shared',
);

const before = stats(positions, indices),
  { kept, removed } = cut(positions, indices, cutHeight),
  after = stats(positions, kept);
assert.ok(removed > 0, 'nothing below the cut height');
assert.ok(kept.length > indices.length / 2, 'the cut removed more than half the mesh');
assert.equal(after.maxY, before.maxY, 'model height unchanged');
assert.ok(after.lowestTriangleTop >= cutHeight, 'every remaining triangle reaches the cut height');

// ---- rewrite the index bufferView in place --------------------------------------
const pad4 = (n) => (n + 3) & ~3,
  indexStart = indexView.byteOffset ?? 0,
  indexBytes = encodeIndices(kept, indexAccessor.componentType),
  delta = pad4(indexBytes.length) - pad4(indexView.byteLength),
  newBinary = Buffer.concat([
    binary.subarray(0, indexStart),
    indexBytes,
    Buffer.alloc(pad4(indexBytes.length) - indexBytes.length, 0),
    binary.subarray(pad4(indexStart + indexView.byteLength)),
  ]);
indexView.byteLength = indexBytes.length;
for (const [i, view] of json.bufferViews.entries())
  if (i !== indexAccessor.bufferView && (view.byteOffset ?? 0) > indexStart)
    view.byteOffset = (view.byteOffset ?? 0) + delta;
let usedMin = Infinity,
  usedMax = -Infinity;
for (const i of kept) {
  usedMin = Math.min(usedMin, i);
  usedMax = Math.max(usedMax, i);
}
indexAccessor.count = kept.length;
if (indexAccessor.min) indexAccessor.min = [usedMin];
if (indexAccessor.max) indexAccessor.max = [usedMax];
json.buffers[0].byteLength = newBinary.length;
const out = buildGlb(json, newBinary);

// Round trip: the written GLB decodes to the kept triangles with the same vertices and texture.
{
  const check = parseGlb(out),
    checkPrimitive = check.json.meshes[0].primitives[0],
    checkIndices = accessorIndices(check.json, check.binary, checkPrimitive.indices),
    checkPositions = accessorFloats(check.json, check.binary, checkPrimitive.attributes.POSITION);
  assert.ok(Buffer.from(checkIndices.buffer).equals(Buffer.from(kept.buffer)), 'index round trip');
  assert.ok(
    Buffer.from(checkPositions.buffer).equals(Buffer.from(positions.buffer)),
    'positions unchanged',
  );
  assert.deepEqual(stats(checkPositions, checkIndices), after);
  assert.equal(check.json.buffers[0].byteLength, check.binary.length);
  for (const attr of ['NORMAL', 'TEXCOORD_0']) {
    const a = accessorFloats(json, binary, primitive.attributes[attr]),
      b = accessorFloats(check.json, check.binary, checkPrimitive.attributes[attr]);
    assert.ok(Buffer.from(a.buffer).equals(Buffer.from(b.buffer)), `${attr} unchanged`);
  }
  const imageView = json.bufferViews[json.images[0].bufferView],
    checkImageView = check.json.bufferViews[check.json.images[0].bufferView],
    original = parseGlb(glb),
    originalImageView = original.json.bufferViews[original.json.images[0].bufferView];
  assert.ok(
    check.binary
      .subarray(
        checkImageView.byteOffset ?? 0,
        (checkImageView.byteOffset ?? 0) + checkImageView.byteLength,
      )
      .equals(
        original.binary.subarray(
          originalImageView.byteOffset ?? 0,
          (originalImageView.byteOffset ?? 0) + originalImageView.byteLength,
        ),
      ),
    'texture unchanged',
  );
  assert.equal(imageView.byteLength, originalImageView.byteLength);
  assert.deepEqual(check.json.materials, original.json.materials, 'materials unchanged');
}
mkdirSync(targetDir, { recursive: true });
writeFileSync(target, out);
const report = {
  key,
  revision,
  cutHeight,
  source: { sha256: createHash('sha256').update(glb).digest('hex'), bytes: glb.length },
  candidate: {
    path: target,
    sha256: createHash('sha256').update(out).digest('hex'),
    bytes: out.length,
  },
  triangles: { before: before.triangles, after: after.triangles, removed },
  vertices: positions.length / 3,
  height: { before: before.maxY, after: after.maxY, unchanged: before.maxY === after.maxY },
  minY: { before: before.minY, after: after.minY },
  lowestTriangleTop: { before: before.lowestTriangleTop, after: after.lowestTriangleTop },
  indexComponentType: indexAccessor.componentType,
};
writeFileSync(resolve(targetDir, 'cut-report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
