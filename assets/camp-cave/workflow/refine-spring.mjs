// Refine the retained imagegen -> TRELLIS cave. Never constructs replacement rock.
// All source indices, UVs, embedded images and vertices before the basin are retained.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import * as THREE from 'three';
import { decodeDocument, packCandidate } from '../../../scripts/optimization/guarded/document.mjs';
import { accessorElements, sha256 } from '../../../scripts/optimization/glb.mjs';
import { caveCentreOffset } from '../../../dist/shared/camp-cave-layout.mjs';
import { CAVE_SPRING, caveSpringRadius } from '../../../dist/shared/cave-spring.mjs';

const revision = process.argv[2] ?? 'r27';
assert.match(revision, /^r27(?:-[a-z0-9]+)?$/);
const out = `assets/camp-cave/work/spring/${revision}`;
await mkdir(out, { recursive: true });
const source = 'public/models/camp-cave/model-r26.opt-1debf5dafc216ce0.glb';
const bytes = await readFile(source);
assert.equal(sha256(bytes), '1debf5dafc216ce01c46bd620e43d232026e0b5a4ad282a91e25676078384005');
const document = await decodeDocument(bytes, source),
  { json, views } = document;
assert.equal(json.meshes.length, 1);
assert.equal(json.nodes.length, 1);
assert.deepEqual(Object.keys(json.nodes[0]).sort(), ['mesh', 'name']);
const primitive = json.meshes[0].primitives[0];
const positionIndex = primitive.attributes.POSITION,
  normalIndex = primitive.attributes.NORMAL;
const positions = accessorElements(json, views, positionIndex);
const positionsBefore = Buffer.from(positions);
const count = json.accessors[positionIndex].count;
const smooth = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
let changed = 0,
  basin = 0;
for (let i = 0; i < count; i++) {
  let x = positions.readFloatLE(i * 12),
    y = positions.readFloatLE(i * 12 + 4),
    z = positions.readFloatLE(i * 12 + 8);
  const oldX = x,
    oldY = y,
    oldZ = z,
    depth = -z;
  if (depth > 31.8) {
    // Unroll the old shallow rear wall into a rounded half chamber, retaining
    // its cross-section relief, connected topology and original rock envelope.
    let next;
    if (depth < 33) {
      const q = Math.min(1, (depth - 31.8) / 1.2);
      const shrink = 0.74 + 0.26 * Math.sqrt(1 - q * q);
      next = 31.8 + 5.5 * Math.sqrt(1 - shrink * shrink);
    } else if (depth < 33.3) {
      const q = Math.min(1, (depth - 33) / 0.3);
      const shrink = 0.74 * (1 - (Math.asin(q) * 2) / Math.PI);
      next = 31.8 + 5.5 * Math.sqrt(1 - shrink * shrink);
    } else next = depth + 4;
    z = -next;
    x += caveCentreOffset(z) - caveCentreOffset(oldZ);
    // The old rear cross section was almost rectangular. Round that same
    // connected shell toward an elliptical vault; do not loft a new surface.
    const halfWidth = 5.5,
      halfHeight = 2.775;
    const ox = oldX - caveCentreOffset(oldZ),
      oy = oldY - 3.825;
    const shrink = Math.max(0.001, Math.sqrt(Math.max(0, 1 - ((-z - 31.8) / 5.5) ** 2)));
    if (
      depth < 33.3 &&
      Math.abs(ox) < halfWidth * shrink * 1.09 &&
      Math.abs(oy) < halfHeight * shrink * 1.09
    ) {
      const u = Math.max(-1, Math.min(1, ox / (halfWidth * shrink)));
      const v = Math.max(-1, Math.min(1, oy / (halfHeight * shrink)));
      const weight = smooth(31.8, 35, -z);
      x += ox * (Math.sqrt(1 - v * v * 0.5) - 1) * weight;
      y += oy * (Math.sqrt(1 - u * u * 0.5) - 1) * weight;
    }
  }
  // Sculpt the existing lower shell into a shallow, irregular stone basin.
  // The water's contour shares the same radial definition. No raised circular rim.
  const radius = caveSpringRadius(x, z);
  if (radius < 1.28 && y < 2.75) {
    const edge = smooth(0.66, 1.22, radius);
    const bed = CAVE_SPRING.bottomY + (1.12 - CAVE_SPRING.bottomY) * edge;
    const weight = 1 - smooth(1.7, 2.75, y);
    const lowered = y + (Math.min(y, bed) - y) * weight;
    if (lowered !== y) basin++;
    y = lowered;
  }
  if (x !== oldX || y !== oldY || z !== oldZ) changed++;
  positions.writeFloatLE(x, i * 12);
  positions.writeFloatLE(y, i * 12 + 4);
  positions.writeFloatLE(z, i * 12 + 8);
}
const g = new THREE.BufferGeometry();
const positionArray = new Float32Array(
  positions.buffer.slice(positions.byteOffset, positions.byteOffset + positions.length),
);
g.setAttribute('position', new THREE.BufferAttribute(positionArray, 3));
const ib = accessorElements(json, views, primitive.indices);
assert.equal(json.accessors[primitive.indices].componentType, 5123);
g.setIndex(
  new THREE.BufferAttribute(
    new Uint16Array(ib.buffer.slice(ib.byteOffset, ib.byteOffset + ib.length)),
    1,
  ),
);
g.computeVertexNormals();
const normals = Buffer.from(accessorElements(json, views, normalIndex));
// Keep the original normals where the surface was not changed, including every mural.
for (let i = 0; i < count; i++) {
  const z = positionsBefore.readFloatLE(i * 12 + 8);
  if (z >= -29.5) continue;
  for (let j = 0; j < 3; j++)
    normals.writeFloatLE(g.attributes.normal.array[i * 3 + j], i * 12 + j * 4);
}
for (const [index, data] of [
  [positionIndex, positions],
  [normalIndex, normals],
]) {
  const a = json.accessors[index];
  assert.equal(a.byteOffset ?? 0, 0);
  assert.equal(json.bufferViews[a.bufferView].byteStride ?? 12, 12);
  views[a.bufferView] = data;
}
g.computeBoundingBox();
json.accessors[positionIndex].min = g.boundingBox.min.toArray();
json.accessors[positionIndex].max = g.boundingBox.max.toArray();
const candidate = await packCandidate(document, revision);
await writeFile(`${out}/model.glb`, candidate, { flag: 'wx' });
const report = {
  revision,
  source,
  sourceSha256: sha256(bytes),
  url: `/models/camp-cave/model-${revision}.glb`,
  sha256: sha256(candidate),
  bytes: candidate.length,
  vertices: count,
  triangles: ib.length / 2 / 3,
  changedVertices: changed,
  basinVertices: basin,
  min: g.boundingBox.min.toArray(),
  max: g.boundingBox.max.toArray(),
  preserved: [
    'source topology and indices',
    'all UVs',
    'all 1024px embedded textures',
    'entrance and gallery vertices through Z=-29.5',
  ],
  method: 'source-shell vertex refinement; no primitive or replacement rock',
};
await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(report));
