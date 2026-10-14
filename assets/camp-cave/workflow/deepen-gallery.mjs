// Deepen the retained imagegen -> TRELLIS cave by moving source-shell vertices only.
// Never constructs replacement rock, primitives, lofts or new surfaces.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import * as THREE from 'three';
import {
  decodeDocument,
  packCandidate,
} from '../../../scripts/optimization/guarded/document.mjs';
import { accessorElements, sha256 } from '../../../scripts/optimization/glb.mjs';
import { caveCentreOffset } from '../../../dist/shared/camp-cave-layout.mjs';

const revision = process.argv[2] ?? 'r28-deep';
assert.equal(revision, 'r28-deep');

const source = 'public/models/camp-cave/model-r27-rounded.glb';
const out = `assets/camp-cave/work/deepen/${revision}`;
const D0 = 2.0;
const D1 = 29.5;
const DELTA = 7.9;
const K = (D1 - D0 + DELTA) / (D1 - D0);
const SAMPLE_DEPTHS = [10, 20, 29.5, 33, 37];
const WALL_HEIGHTS = [1.5, 2.5, 3.5];
const SOURCE_SHA256 = 'f3e513c9f311ba2bafdc8ebb8a846a9de0eba15be4c1f35b302e10efbd58b75b';

const remapDepth = (depth) => {
  if (depth <= D0) return depth;
  if (depth <= D1) return D0 + (depth - D0) * K;
  return depth + DELTA;
};

const bytes = await readFile(source);
assert.equal(sha256(bytes), SOURCE_SHA256);
const document = await decodeDocument(bytes, source);
const { json, views } = document;
assert.equal(json.meshes.length, 1);
assert.equal(json.nodes.length, 1);
assert.deepEqual(Object.keys(json.nodes[0]).sort(), ['mesh', 'name']);
assert.equal(json.meshes[0].primitives.length, 1);
const primitive = json.meshes[0].primitives[0];
assert.equal(primitive.mode ?? 4, 4);

const positionIndex = primitive.attributes.POSITION;
const normalIndex = primitive.attributes.NORMAL;
const uvIndex = primitive.attributes.TEXCOORD_0;
const indexIndex = primitive.indices;
assert.notEqual(positionIndex, undefined);
assert.notEqual(normalIndex, undefined);
assert.notEqual(uvIndex, undefined);
assert.notEqual(indexIndex, undefined);

const positionAccessor = json.accessors[positionIndex];
const normalAccessor = json.accessors[normalIndex];
const indexAccessor = json.accessors[indexIndex];
for (const [name, accessor] of [
  ['POSITION', positionAccessor],
  ['NORMAL', normalAccessor],
]) {
  assert.equal(accessor.componentType, 5126, `${name} must use float32 components`);
  assert.equal(accessor.type, 'VEC3', `${name} must be VEC3`);
  assert.equal(accessor.byteOffset ?? 0, 0, `${name} accessor must start at its view`);
  assert.equal(
    json.bufferViews[accessor.bufferView].byteStride ?? 12,
    12,
    `${name} must have a 12-byte stride`,
  );
}
assert.equal(positionAccessor.count, normalAccessor.count);
assert.equal(indexAccessor.componentType, 5123, 'indices must be 16-bit');
assert.equal(indexAccessor.type, 'SCALAR');
assert.equal(indexAccessor.count % 3, 0);

const positions = accessorElements(json, views, positionIndex);
const positionsBefore = Buffer.from(positions);
const normalsBefore = accessorElements(json, views, normalIndex);
const indexBytesBefore = accessorElements(json, views, indexIndex);
const uvBytesBefore = accessorElements(json, views, uvIndex);
const count = positionAccessor.count;
assert.equal(positions.length, count * 12);
assert.equal(normalsBefore.length, count * 12);

const readIndices = (data) => {
  const indices = new Uint16Array(data.length / 2);
  for (let i = 0; i < indices.length; i++) indices[i] = data.readUInt16LE(i * 2);
  return indices;
};
const indices = readIndices(indexBytesBefore);

// Intersect an axis-aligned line with each source triangle by projecting that
// triangle into the other two axes. The interpolated third coordinate is the
// exact hit on the triangle plane (apart from ordinary float arithmetic).
const axisHits = (positionBytes, axis, fixedA, fixedB) => {
  const axes =
    axis === 0 ? [1, 2] : axis === 1 ? [0, 2] : [0, 1];
  const hits = [];
  for (let i = 0; i < indices.length; i += 3) {
    const ia = indices[i] * 12;
    const ib = indices[i + 1] * 12;
    const ic = indices[i + 2] * 12;
    const a0 = positionBytes.readFloatLE(ia + axes[0] * 4);
    const a1 = positionBytes.readFloatLE(ia + axes[1] * 4);
    const b0 = positionBytes.readFloatLE(ib + axes[0] * 4);
    const b1 = positionBytes.readFloatLE(ib + axes[1] * 4);
    const c0 = positionBytes.readFloatLE(ic + axes[0] * 4);
    const c1 = positionBytes.readFloatLE(ic + axes[1] * 4);
    if (
      fixedA < Math.min(a0, b0, c0) - 1e-7 ||
      fixedA > Math.max(a0, b0, c0) + 1e-7 ||
      fixedB < Math.min(a1, b1, c1) - 1e-7 ||
      fixedB > Math.max(a1, b1, c1) + 1e-7
    )
      continue;
    const denominator = (b1 - c1) * (a0 - c0) + (c0 - b0) * (a1 - c1);
    if (Math.abs(denominator) < 1e-12) continue;
    const wa = ((b1 - c1) * (fixedA - c0) + (c0 - b0) * (fixedB - c1)) / denominator;
    const wb = ((c1 - a1) * (fixedA - c0) + (a0 - c0) * (fixedB - c1)) / denominator;
    const wc = 1 - wa - wb;
    if (wa < -1e-7 || wb < -1e-7 || wc < -1e-7) continue;
    hits.push(
      wa * positionBytes.readFloatLE(ia + axis * 4) +
        wb * positionBytes.readFloatLE(ib + axis * 4) +
        wc * positionBytes.readFloatLE(ic + axis * 4),
    );
  }
  return hits;
};

const finiteOrNull = (value) => (Number.isFinite(value) ? value : null);
const measureSection = (positionBytes, depth) => {
  const z = -depth;
  const centreX = caveCentreOffset(z);
  const walls = Object.fromEntries(
    WALL_HEIGHTS.map((y) => {
      const hits = axisHits(positionBytes, 0, y, z);
      const leftX = Math.max(...hits.filter((x) => x < centreX - 1e-5));
      const rightX = Math.min(...hits.filter((x) => x > centreX + 1e-5));
      const left = centreX - leftX;
      const right = rightX - centreX;
      return [
        y.toFixed(1),
        {
          left: finiteOrNull(left),
          right: finiteOrNull(right),
          halfWidth: finiteOrNull((left + right) / 2),
        },
      ];
    }),
  );
  const vertical = [];
  for (let step = -10; step <= 10; step++) {
    const x = centreX + step / 10;
    const hits = axisHits(positionBytes, 1, x, z);
    // Y=3.5 remains inside the walkable void even where the rounded rear floor
    // rises above 1.5 m, and is also the highest requested mural-wall sample.
    const floorY = Math.max(...hits.filter((y) => y < 3.5 - 1e-5));
    const ceilingY = Math.min(...hits.filter((y) => y > 3.5 + 1e-5));
    if (Number.isFinite(floorY) && Number.isFinite(ceilingY))
      vertical.push({ xOffset: step / 10, floorY, ceilingY, headroom: ceilingY - floorY });
  }
  assert.ok(vertical.length, `no centre floor/ceiling intersections at depth ${depth}`);
  return {
    depth,
    localZ: z,
    centreX,
    innerWallHalfWidth: walls,
    centreHeadroom: {
      lowestCeilingY: Math.min(...vertical.map((sample) => sample.ceilingY)),
      highestFloorY: Math.max(...vertical.map((sample) => sample.floorY)),
      minimum: Math.min(...vertical.map((sample) => sample.headroom)),
      samples: vertical.length,
    },
  };
};

let deepestBefore = Infinity;
for (let i = 0; i < count; i++) deepestBefore = Math.min(deepestBefore, positions.readFloatLE(i * 12 + 8));

for (let i = 0; i < count; i++) {
  const at = i * 12;
  const x = positions.readFloatLE(at);
  const oldZ = positions.readFloatLE(at + 8);
  const depth = -oldZ;
  if (depth <= D0) continue;
  const newZ = -remapDepth(depth);
  positions.writeFloatLE(x + caveCentreOffset(newZ) - caveCentreOffset(oldZ), at);
  positions.writeFloatLE(newZ, at + 8);
}

const geometry = new THREE.BufferGeometry();
const positionArray = new Float32Array(
  positions.buffer.slice(positions.byteOffset, positions.byteOffset + positions.length),
);
geometry.setAttribute('position', new THREE.BufferAttribute(positionArray, 3));
geometry.setIndex(new THREE.BufferAttribute(indices, 1));
geometry.computeVertexNormals();

const normals = Buffer.from(normalsBefore);
let changedVertices = 0;
let unchangedVerticesByteIdentical = true;
for (let i = 0; i < count; i++) {
  const at = i * 12;
  const originalDepth = -positionsBefore.readFloatLE(at + 8);
  const positionChanged = !positions.subarray(at, at + 12).equals(positionsBefore.subarray(at, at + 12));
  if (positionChanged) changedVertices++;
  if (originalDepth > D0) {
    for (let component = 0; component < 3; component++)
      normals.writeFloatLE(geometry.attributes.normal.array[i * 3 + component], at + component * 4);
  } else if (
    positionChanged ||
    !normals.subarray(at, at + 12).equals(normalsBefore.subarray(at, at + 12))
  ) {
    unchangedVerticesByteIdentical = false;
  }
}
assert.equal(unchangedVerticesByteIdentical, true);

for (const [accessorIndex, data] of [
  [positionIndex, positions],
  [normalIndex, normals],
]) {
  const accessor = json.accessors[accessorIndex];
  assert.equal(accessor.byteOffset ?? 0, 0);
  assert.equal(json.bufferViews[accessor.bufferView].byteStride ?? 12, 12);
  views[accessor.bufferView] = data;
}
geometry.computeBoundingBox();
json.accessors[positionIndex].min = geometry.boundingBox.min.toArray();
json.accessors[positionIndex].max = geometry.boundingBox.max.toArray();

// The only logical buffers replaced above are POSITION and NORMAL.
assert.ok(accessorElements(json, views, indexIndex).equals(indexBytesBefore));
assert.ok(accessorElements(json, views, uvIndex).equals(uvBytesBefore));

const crossSections = SAMPLE_DEPTHS.map((depthBefore) => {
  const depthAfter = remapDepth(depthBefore);
  return {
    depthBefore,
    depthAfter,
    before: measureSection(positionsBefore, depthBefore),
    after: measureSection(positions, depthAfter),
  };
});

const candidate = await packCandidate(document, revision);
await mkdir(out, { recursive: true });
await writeFile(`${out}/model.glb`, candidate, { flag: 'wx' });

let deepestAfter = Infinity;
for (let i = 0; i < count; i++) deepestAfter = Math.min(deepestAfter, positions.readFloatLE(i * 12 + 8));
const report = {
  revision,
  source,
  sourceSha256: sha256(bytes),
  sha256: sha256(candidate),
  bytes: candidate.length,
  vertices: count,
  triangles: indices.length / 3,
  changedVertices,
  unchangedVerticesByteIdentical,
  constants: { D0, D1, DELTA, K },
  min: geometry.boundingBox.min.toArray(),
  max: geometry.boundingBox.max.toArray(),
  deepestLocalZ: { before: deepestBefore, after: deepestAfter },
  crossSections,
  method:
    'source-shell vertex remap; uniform gallery stretch and rear translation; no primitive or replacement rock',
  preserved: [
    'source topology and indices',
    'all UVs',
    'all 1024px embedded textures',
    'all vertices and original normal bytes through depth 2m',
    'rear chamber and spring-basin shape under exact translation',
  ],
};
await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(report));
