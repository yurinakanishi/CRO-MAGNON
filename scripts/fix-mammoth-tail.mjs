// 2026-09-13: the woolly mammoth read as having two tails. The TRELLIS surface
// carries two thin fur strands hanging from either side of the rump (Hips-
// weighted, no tail bones) beside the real bone-driven tail in the middle. This
// collapses each strand onto the rump vertices it hangs from so only the
// central tail remains.
//
// Nothing in the delivered GLB is removed or re-encoded: the original binary
// chunk stays byte-for-byte as a prefix, a new POSITION buffer view is appended
// after it (positions, then normals), and only the POSITION and NORMAL accessors
// are repointed. Indices, UVs, skin weights, bones and every animation clip are
// the same bytes as before.
// Usage: node scripts/fix-mammoth-tail.mjs [--write] [--inset metres] [--out file]
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const SOURCE = 'public/models/woolly-mammoth/model-motion-r04.glb';
const TARGET = 'public/models/woolly-mammoth/model-motion-r05.glb';
// glTF space: +Y up, the mammoth faces +Z, so the rump is at negative Z.
const STRAND = Object.freeze({
  rumpZ: -2.3, // strand geometry hangs behind this plane
  minX: 0.15, // clear of the central tail
  maxX: 0.75,
  minY: 0.55, // above the hind feet
  maxY: 2.3, // below the back line
  inset: 0, // exactly on the ring vertex: zero-area slivers, no fan
});
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

function parse(bytes) {
  const jsonLength = bytes.readUInt32LE(12),
    doc = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8')),
    binLength = bytes.readUInt32LE(20 + jsonLength);
  return { doc, binary: bytes.subarray(28 + jsonLength, 28 + jsonLength + binLength) };
}
function indices(doc, binary, accessorIndex) {
  const accessor = doc.accessors[accessorIndex],
    view = doc.bufferViews[accessor.bufferView],
    offset = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0),
    Type = { 5121: Uint8Array, 5123: Uint16Array, 5125: Uint32Array }[accessor.componentType];
  return new Type(
    binary.buffer.slice(
      binary.byteOffset + offset,
      binary.byteOffset + offset + accessor.count * Type.BYTES_PER_ELEMENT,
    ),
  );
}
function floats(doc, binary, accessorIndex) {
  const accessor = doc.accessors[accessorIndex],
    view = doc.bufferViews[accessor.bufferView];
  if (view.byteStride && view.byteStride !== 12) throw new Error('interleaved accessor');
  const offset = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  return new Float32Array(
    binary.buffer.slice(
      binary.byteOffset + offset,
      binary.byteOffset + offset + accessor.count * 12,
    ),
  );
}

export function foldStrands(bytes, options = {}) {
  const inset = options.inset ?? STRAND.inset;
  const { doc, binary } = parse(bytes);
  const primitive = doc.meshes[0].primitives[0];
  const positions = floats(doc, binary, primitive.attributes.POSITION),
    normals = floats(doc, binary, primitive.attributes.NORMAL),
    count = positions.length / 3;
  const strand = [];
  for (let i = 0; i < count; i++) {
    const x = positions[i * 3],
      y = positions[i * 3 + 1],
      z = positions[i * 3 + 2];
    if (
      z < STRAND.rumpZ &&
      Math.abs(x) > STRAND.minX &&
      Math.abs(x) < STRAND.maxX &&
      y > STRAND.minY &&
      y < STRAND.maxY
    )
      strand.push(i);
  }
  // Every strand vertex collapses onto the nearest vertex of the ring of rump
  // vertices its strand hangs from (same side), taking that vertex's normal.
  // The strand's own triangles become zero-area slivers along the seam and the
  // triangles bridging the ring degenerate, so nothing of the strand is drawn.
  const selected = new Set(strand),
    tris = indices(doc, binary, primitive.indices),
    ring = { L: [], R: [] },
    seen = new Set();
  for (let t = 0; t < tris.length; t += 3) {
    const corners = [tris[t], tris[t + 1], tris[t + 2]];
    if (!corners.some((i) => selected.has(i))) continue;
    for (const i of corners)
      if (!selected.has(i) && !seen.has(i)) {
        seen.add(i);
        ring[positions[i * 3] < 0 ? 'L' : 'R'].push(i);
      }
  }
  for (const side of ['L', 'R'])
    if (!ring[side].length) throw new Error(`no attachment ring on side ${side}`);
  const folded = new Float32Array(positions),
    foldedNormals = new Float32Array(normals);
  for (const i of strand) {
    let best = -1,
      bestDistance = Infinity;
    for (const j of ring[positions[i * 3] < 0 ? 'L' : 'R']) {
      const dx = positions[j * 3] - positions[i * 3],
        dy = positions[j * 3 + 1] - positions[i * 3 + 1],
        dz = positions[j * 3 + 2] - positions[i * 3 + 2],
        d = dx * dx + dy * dy + dz * dz;
      if (d < bestDistance) {
        bestDistance = d;
        best = j;
      }
    }
    for (let k = 0; k < 3; k++) {
      folded[i * 3 + k] = positions[best * 3 + k] - normals[best * 3 + k] * inset;
      foldedNormals[i * 3 + k] = normals[best * 3 + k];
    }
  }
  const anchor = { L: { ring: ring.L.length }, R: { ring: ring.R.length } };
  const min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < count; i++)
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], folded[i * 3 + k]);
      max[k] = Math.max(max[k], folded[i * 3 + k]);
    }
  // Append the folded positions and normals after the untouched original binary.
  const padded = Math.ceil(binary.length / 4) * 4,
    appended = Buffer.concat([Buffer.from(folded.buffer), Buffer.from(foldedNormals.buffer)]);
  const viewIndex = doc.bufferViews.length;
  doc.bufferViews.push(
    { buffer: 0, byteOffset: padded, byteLength: folded.byteLength, target: 34962 },
    {
      buffer: 0,
      byteOffset: padded + folded.byteLength,
      byteLength: foldedNormals.byteLength,
      target: 34962,
    },
  );
  doc.accessors[primitive.attributes.POSITION] = {
    ...doc.accessors[primitive.attributes.POSITION],
    bufferView: viewIndex,
    byteOffset: 0,
    min,
    max,
  };
  doc.accessors[primitive.attributes.NORMAL] = {
    ...doc.accessors[primitive.attributes.NORMAL],
    bufferView: viewIndex + 1,
    byteOffset: 0,
  };
  doc.buffers[0].byteLength = padded + appended.length;
  const json = Buffer.from(JSON.stringify(doc)),
    jsonPadded = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]),
    bin = Buffer.concat([binary, Buffer.alloc(padded - binary.length), appended]);
  const out = Buffer.alloc(28 + jsonPadded.length + bin.length);
  out.writeUInt32LE(0x46546c67, 0);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(out.length, 8);
  out.writeUInt32LE(jsonPadded.length, 12);
  out.writeUInt32LE(0x4e4f534a, 16);
  jsonPadded.copy(out, 20);
  out.writeUInt32LE(bin.length, 20 + jsonPadded.length);
  out.writeUInt32LE(0x004e4942, 24 + jsonPadded.length);
  bin.copy(out, 28 + jsonPadded.length);
  return { bytes: out, strand: strand.length, anchors: anchor, min, max, count };
}

if (process.argv[1]?.endsWith('fix-mammoth-tail.mjs')) {
  const source = await readFile(SOURCE);
  const arg = (name) => {
    const i = process.argv.indexOf(name);
    return i > 0 ? process.argv[i + 1] : undefined;
  };
  const result = foldStrands(source, {
    inset: arg('--inset') ? Number(arg('--inset')) : undefined,
  });
  const target = arg('--out') ?? TARGET;
  const report = {
    source: SOURCE,
    sourceSha256: hash(source),
    target,
    sha256: hash(result.bytes),
    bytes: result.bytes.length,
    vertices: result.count,
    foldedVertices: result.strand,
    anchors: result.anchors,
    bounds: { min: result.min, max: result.max },
    criteria: STRAND,
  };
  if (process.argv.includes('--write')) await writeFile(target, result.bytes);
  console.log(JSON.stringify(report, null, 2));
}
