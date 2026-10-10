// Self-contained startup actor: the adopted same-model LOD geometry bound to the full
// model's nodes, skins, inverse binds, materials, textures and every animation clip.
// performance-lod.ts already poses this geometry on this skeleton at distance, but under the
// full mesh's material instance, so the shading is not the same (see shadingOf). The LOD
// file's own nodes, rest pose and clips are never copied, so what must agree is the binding:
// joint names and topology, inverse binds and mesh node transforms. Doubt is an explicit error.
import { OPTIONAL_LOD_ATTRIBUTES } from './contract.mjs';
import { simplifySourcePrimitive } from './source-simplify.mjs';
import {
  COMPONENT_BYTES,
  TYPE_WIDTH,
  accessorElements,
  elementSize,
  padding4,
  primitiveTriangles,
  storedViews,
  triangleCount,
} from './glb.mjs';

export const STARTUP_TOLERANCE = Object.freeze({
  // Mesh node world transform, per matrix element. three.js binds glTF skins with an identity
  // bind matrix (glTF ignores the skinned mesh node's transform), so for skinned meshes this is
  // a structural check; unskinned LOD meshes are placed by it.
  worldMatrix: 1e-5,
  // Inverse binds may differ per element by at most this: about six times the export noise
  // measured on the adopted LODs (cat-kunoichi 1.65e-5, neanderthal-woman 1.47e-5).
  inverseBindElement: 1e-4,
  // Binding the LOD with the full model's inverse binds instead of its own may move no LOD
  // vertex further than this in any pose the full model's rest pose and clips produce (model
  // units; bindingDisplacement and poseBounds): 0.14 px at 2 m in a 1280 px wide 60° view, and
  // under 5% of the adopted LOD heads' own simplification error (meshopt sloppy errors
  // 0.024-0.029 of a 0.25-0.3 m head extent, about 6-9 mm;
  // assets/face-remake/*/graft-report-r01.json). The r02 dry run (earlier bound) recorded at
  // most 3.9e-6 m.
  skinnedDisplacement: 2.5e-4,
  // Correspondence: most LOD vertices must lie on the same-index full primitive's surface.
  // Cells are 2% of the full mesh diagonal; neighbouring cells count as on the surface.
  surfaceCell: 0.02,
  minimumSurfaceAgreement: 0.5,
  surfaceMargin: 0.1,
  // Bind pose: every LOD vertex must lie in a 10%-of-diagonal neighbourhood of its full
  // primitive (the 5 cm seam tuck passes; limbs posed away from stale binds do not).
  outlierCell: 0.1,
  // Whole-mesh containment. Adopted LOD heads tuck their neck seam up to 5 cm below the full
  // head into the body, so a per-primitive box would reject real, intended geometry.
  meshBoundsPadding: 0.02,
  boundsAbsolute: 0.001,
  minimumDiagonalRatio: 0.5,
  weightSum: 0.01,
});
// Startup geometry per primitive. Codex's r02 Chrome review rejected the startup faces of the
// face-remake actors: their adopted LOD heads were reduced with meshopt simplifySloppy
// (scripts/face-remake/graft-head.py, "far LOD only"; simplify.mjs), which clusters vertices
// across UV charts, so up close every triangle smears unrelated atlas texels. Head primitives
// therefore keep the full model's own geometry, attributes, material and weights; all other
// primitives use the adopted LOD. The same review found the single-primitive fennec and ape LOD
// faces damaged too; with no separable head, their whole primitive keeps the full geometry (a
// whole-model cost, not a head-only one). The r03 review then rejected the remaining adopted LOD
// bodies (far-distance tolerances: collar, shoulder and armpit gaps), so the default policy
// 'source-derived' never shows the adopted LOD: every other primitive is reduced from the
// original full primitive (source-simplify.mjs). 'retain-face-primitives' (r03) and
// 'adopted-lod-only' exist for tests and diagnostics only.
export const GEOMETRY_POLICIES = Object.freeze([
  'source-derived',
  'retain-face-primitives',
  'adopted-lod-only',
]);
export const RETENTION = Object.freeze({
  head: 'head-primitive',
  whole: 'whole-single-primitive',
  // Kept whole because simplification found no useful reduction or cannot handle the data:
  // a safe case, not a geometry optimization.
  unreduced: 'unreduced-whole-primitive',
  unsupported: 'unsupported-whole-primitive',
});
export const STARTUP_GEOMETRY = Object.freeze({
  // A primitive is a head when at least this share of its skin weight is on this joint, and it
  // is not the mesh's only primitive. A mesh's only primitive is retained whole.
  headJoint: 'Head',
  headWeightShare: 0.5,
  // UV chart integrity: a triangle whose longest UV edge per metre exceeds this multiple of the
  // full primitive's 99th percentile (area-weighted) spans unrelated atlas charts.
  crossChartStretch: 4,
  stretchPercentile: 0.99,
});
const SLOT_PREFIX = /^LODGeometrySlot_(.*)$/s;
const JOINTS = /^JOINTS_\d+$/;
const SKIN_SET = /^(JOINTS|WEIGHTS)_\d+$/;
// Interpolations whose samples never leave the range of their keys (see poseBounds).
const BOUNDED_INTERPOLATION = Object.freeze(['LINEAR', 'STEP']);
const BOTTOM_ROW = [3, 7, 11, 15];
const CELL_OFFSET = 1 << 16,
  CELL_SPAN = 1 << 17;
const percent = (value) => `${(value * 100).toFixed(1)}%`;

function localMatrix(node) {
  if (node.matrix) return Float64Array.from(node.matrix);
  const [tx, ty, tz] = node.translation ?? [0, 0, 0],
    [x, y, z, w] = node.rotation ?? [0, 0, 0, 1],
    [sx, sy, sz] = node.scale ?? [1, 1, 1],
    x2 = x + x,
    y2 = y + y,
    z2 = z + z,
    xx = x * x2,
    xy = x * y2,
    xz = x * z2,
    yy = y * y2,
    yz = y * z2,
    zz = z * z2,
    wx = w * x2,
    wy = w * y2,
    wz = w * z2;
  return Float64Array.of(
    (1 - (yy + zz)) * sx,
    (xy + wz) * sx,
    (xz - wy) * sx,
    0,
    (xy - wz) * sy,
    (1 - (xx + zz)) * sy,
    (yz + wx) * sy,
    0,
    (xz + wy) * sz,
    (yz - wx) * sz,
    (1 - (xx + yy)) * sz,
    0,
    tx,
    ty,
    tz,
    1,
  );
}

function multiply(a, b) {
  const out = new Float64Array(16);
  for (let column = 0; column < 4; column++)
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + row] * b[column * 4 + k];
      out[column * 4 + row] = sum;
    }
  return out;
}

function parentIndices(json) {
  const nodes = json.nodes ?? [],
    parent = new Array(nodes.length).fill(-1);
  nodes.forEach((node, index) =>
    (node.children ?? []).forEach((child) => {
      if (parent[child] !== -1) throw new Error(`node ${child} has two parents`);
      parent[child] = index;
    }),
  );
  return parent;
}

export function worldMatrices(json) {
  const nodes = json.nodes ?? [],
    parent = parentIndices(json),
    world = new Array(nodes.length),
    visiting = new Set();
  const compute = (index) => {
    if (world[index]) return world[index];
    if (visiting.has(index)) throw new Error(`node hierarchy has a cycle at node ${index}`);
    visiting.add(index);
    const local = localMatrix(nodes[index]);
    world[index] = parent[index] < 0 ? local : multiply(compute(parent[index]), local);
    visiting.delete(index);
    return world[index];
  };
  nodes.forEach((_, index) => compute(index));
  return world;
}

const largestDifference = (a, b) =>
  a.reduce((worst, value, i) => Math.max(worst, Math.abs(value - b[i])), 0);

/** Column-major 4×4 matrix times (x, y, z, 1), all four rows. */
function transformPoint(m, offset, x, y, z) {
  return [
    m[offset] * x + m[offset + 4] * y + m[offset + 8] * z + m[offset + 12],
    m[offset + 1] * x + m[offset + 5] * y + m[offset + 9] * z + m[offset + 13],
    m[offset + 2] * x + m[offset + 6] * y + m[offset + 10] * z + m[offset + 14],
    m[offset + 3] * x + m[offset + 7] * y + m[offset + 11] * z + m[offset + 15],
  ];
}

function floats(doc, views, accessor, where) {
  if (doc.json.accessors[accessor].componentType !== 5126)
    throw new Error(`${where} must be float data`);
  const bytes = accessorElements(doc.json, views, accessor);
  return new Float32Array(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  );
}

function integers(bytes, componentType) {
  const size = COMPONENT_BYTES[componentType],
    values = new Array(bytes.length / size);
  for (let i = 0; i < values.length; i++)
    values[i] =
      size === 1 ? bytes[i] : size === 2 ? bytes.readUInt16LE(2 * i) : bytes.readUInt32LE(4 * i);
  return values;
}

function weightValues(bytes, accessor) {
  if (accessor.componentType === 5126)
    return new Float32Array(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    );
  const scale = { 5121: 255, 5123: 65535 }[accessor.componentType];
  return integers(bytes, accessor.componentType).map((value) => value / scale);
}

function bounds(values) {
  const min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < values.length; i += 3)
    for (let axis = 0; axis < 3; axis++) {
      const value = values[i + axis];
      if (!Number.isFinite(value)) throw new Error('non-finite POSITION value');
      if (value < min[axis]) min[axis] = value;
      if (value > max[axis]) max[axis] = value;
    }
  return finishBounds(min, max);
}

function finishBounds(min, max) {
  const size = [0, 1, 2].map((axis) => max[axis] - min[axis]),
    result = {
      min,
      max,
      diagonal: Math.hypot(...size),
      centre: [0, 1, 2].map((axis) => (min[axis] + max[axis]) / 2),
    };
  if (!Number.isFinite(result.diagonal) || !result.centre.every(Number.isFinite))
    throw new Error('POSITION extent is not finite');
  return result;
}

/** Every quantity the proof compares must be a finite number: NaN passes any `>` test, and
 * finite inputs can still overflow (Infinity · 0 is NaN). Limits are checked as !(x <= limit). */
function finite(value, what, fail) {
  if (!Number.isFinite(value)) fail(`${what} is not finite (${value})`);
  return value;
}

const unionBounds = (list) =>
  finishBounds(
    [0, 1, 2].map((axis) => Math.min(...list.map((item) => item.min[axis]))),
    [0, 1, 2].map((axis) => Math.max(...list.map((item) => item.max[axis]))),
  );

const cellOf = (value, origin, cell) => Math.floor((value - origin) / cell) + CELL_OFFSET;

function surfaceIndex(values, origin, cell) {
  const index = new Set();
  for (let i = 0; i < values.length; i += 3)
    index.add(
      (cellOf(values[i], origin[0], cell) * CELL_SPAN + cellOf(values[i + 1], origin[1], cell)) *
        CELL_SPAN +
        cellOf(values[i + 2], origin[2], cell),
    );
  return index;
}

/** Fraction of positions with a surface vertex in the same or a neighbouring cell. */
function surfaceAgreement(values, index, origin, cell) {
  let hits = 0;
  for (let i = 0; i < values.length; i += 3) {
    const x = cellOf(values[i], origin[0], cell),
      y = cellOf(values[i + 1], origin[1], cell),
      z = cellOf(values[i + 2], origin[2], cell);
    search: for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++)
          if (index.has(((x + dx) * CELL_SPAN + (y + dy)) * CELL_SPAN + (z + dz))) {
            hits++;
            break search;
          }
  }
  return values.length ? hits / (values.length / 3) : 0;
}

/** Raw (uncompressed) bytes of the accessors these primitives reference, each counted once. */
function rawBytesOf(json, primitives) {
  const used = new Set(
    primitives.flatMap((primitive) => [
      ...Object.values(primitive.attributes),
      ...(primitive.indices === undefined ? [] : [primitive.indices]),
      ...(primitive.targets ?? []).flatMap((target) => Object.values(target)),
    ]),
  );
  return [...used].reduce(
    (sum, index) =>
      sum + elementSize(json.accessors[index], `accessor ${index}`) * json.accessors[index].count,
    0,
  );
}

function indexValues(doc, views, primitive, vertexCount) {
  if (primitive.indices === undefined) return Array.from({ length: vertexCount }, (_, i) => i);
  return integers(
    accessorElements(doc.json, views, primitive.indices),
    doc.json.accessors[primitive.indices].componentType,
  );
}

/** Share of a primitive's JOINTS_0/WEIGHTS_0 weight on one joint (0 without skin data). */
function jointWeightShare(doc, views, primitive, joint) {
  const { JOINTS_0: joints, WEIGHTS_0: weights } = primitive.attributes;
  if (joint < 0 || joints === undefined || weights === undefined) return 0;
  const jointValues = integers(
      accessorElements(doc.json, views, joints),
      doc.json.accessors[joints].componentType,
    ),
    weightList = weightValues(
      accessorElements(doc.json, views, weights),
      doc.json.accessors[weights],
    );
  let on = 0,
    total = 0;
  for (let i = 0; i < jointValues.length; i++) {
    total += weightList[i];
    if (jointValues[i] === joint) on += weightList[i];
  }
  return total > 0 ? on / total : 0;
}

/** Per triangle: 3D area and the longest UV edge per metre of edge (TEXCOORD_0). */
function uvStretch(doc, views, primitive, where) {
  const uv = primitive.attributes.TEXCOORD_0;
  if (uv === undefined || doc.json.accessors[uv].componentType !== 5126) return null;
  const positions = floats(doc, views, primitive.attributes.POSITION, `${where} POSITION`);
  return stretchOf(
    positions,
    floats(doc, views, uv, `${where} TEXCOORD_0`),
    indexValues(doc, views, primitive, positions.length / 3),
  );
}

/** The same measure for triangles given as indices into source position and UV arrays. */
function stretchOf(positions, coordinates, indices) {
  const count = Math.floor(indices.length / 3),
    stretch = new Float64Array(count),
    area = new Float64Array(count);
  for (let t = 0; t < count; t++) {
    const corner = [indices[3 * t], indices[3 * t + 1], indices[3 * t + 2]],
      p = corner.map((v) => [positions[3 * v], positions[3 * v + 1], positions[3 * v + 2]]),
      u = corner.map((v) => [coordinates[2 * v], coordinates[2 * v + 1]]),
      e1 = [0, 1, 2].map((c) => p[1][c] - p[0][c]),
      e2 = [0, 1, 2].map((c) => p[2][c] - p[0][c]);
    area[t] =
      Math.hypot(
        e1[1] * e2[2] - e1[2] * e2[1],
        e1[2] * e2[0] - e1[0] * e2[2],
        e1[0] * e2[1] - e1[1] * e2[0],
      ) / 2;
    for (const [a, b] of [
      [0, 1],
      [1, 2],
      [2, 0],
    ]) {
      const length = Math.hypot(p[a][0] - p[b][0], p[a][1] - p[b][1], p[a][2] - p[b][2]);
      if (length > 0)
        stretch[t] = Math.max(
          stretch[t],
          Math.hypot(u[a][0] - u[b][0], u[a][1] - u[b][1]) / length,
        );
    }
  }
  return { stretch, area };
}

function weightedQuantile({ stretch, area }, q) {
  const order = Array.from(stretch.keys()).sort((a, b) => stretch[a] - stretch[b]),
    total = area.reduce((sum, value) => sum + value, 0);
  let seen = 0;
  for (const t of order) {
    seen += area[t];
    if (seen >= q * total) return stretch[t];
  }
  return order.length ? stretch[order[order.length - 1]] : 0;
}

/** Area share of triangles stretched beyond the full primitive's reference: atlas-chart breaks. */
function crossChartShare({ stretch, area }, limit) {
  let over = 0,
    total = 0;
  for (let t = 0; t < stretch.length; t++) {
    total += area[t];
    if (stretch[t] > limit) over += area[t];
  }
  return total > 0 ? over / total : 0;
}

function uvCharts(full, reduced) {
  if (!full || !reduced) return null;
  const reference = weightedQuantile(full, STARTUP_GEOMETRY.stretchPercentile),
    limit = reference * STARTUP_GEOMETRY.crossChartStretch;
  return {
    fullStretchP99: reference,
    lodStretchP99: weightedQuantile(reduced, STARTUP_GEOMETRY.stretchPercentile),
    fullCrossChartAreaShare: crossChartShare(full, limit),
    lodCrossChartAreaShare: crossChartShare(reduced, limit),
  };
}

const positionKeys = (values) => {
  const keys = [];
  for (let i = 0; i < values.length; i += 3)
    keys.push(`${values[i]},${values[i + 1]},${values[i + 2]}`);
  return keys;
};

/** Where a retained full primitive meets its neighbours: the positions it shares exactly with
 * the other full primitives, and whether the LOD-sourced neighbours still have them. */
function seamOf(retained, fullOthers, lodOthers) {
  const shared = new Set(fullOthers.flatMap(positionKeys)),
    seam = [...new Set(positionKeys(retained).filter((key) => shared.has(key)))],
    lodKeys = new Set(lodOthers.flatMap(positionKeys)),
    lodPoints = lodOthers.flatMap((values) => Array.from(values));
  let still = 0,
    max = 0,
    sum = 0;
  for (const key of seam) {
    if (lodKeys.has(key)) still++;
    const [x, y, z] = key.split(',').map(Number);
    let nearest = Infinity;
    for (let i = 0; i < lodPoints.length; i += 3)
      nearest = Math.min(
        nearest,
        Math.hypot(lodPoints[i] - x, lodPoints[i + 1] - y, lodPoints[i + 2] - z),
      );
    if (Number.isFinite(nearest)) {
      max = Math.max(max, nearest);
      sum += nearest;
    }
  }
  return {
    positionsSharedWithFullNeighbours: seam.length,
    stillSharedWithLodNeighbours: still,
    nearestLodNeighbourVertexMetres:
      seam.length && lodPoints.length ? { max, mean: sum / seam.length } : null,
  };
}

function meshNodes(json, which, fail) {
  const nodes = (json.nodes ?? [])
    .map((node, index) => ({ node, index }))
    .filter(({ node }) => node.mesh !== undefined);
  (json.meshes ?? []).forEach((_, mesh) => {
    const count = nodes.filter(({ node }) => node.mesh === mesh).length;
    if (count !== 1)
      fail(`${which} mesh ${mesh} is used by ${count} nodes; startup actors need exactly one`);
  });
  return nodes;
}

function compareSkins(
  high,
  lod,
  highViews,
  lodViews,
  highWorld,
  lodWorld,
  highSkin,
  lodSkin,
  fail,
) {
  const H = high.json,
    L = lod.json,
    a = H.skins[highSkin],
    b = L.skins[lodSkin],
    names = (json, skin) => skin.joints.map((joint) => json.nodes[joint].name),
    highNames = names(H, a),
    lodNames = names(L, b);
  for (const [list, which] of [
    [highNames, 'full-model'],
    [lodNames, 'LOD'],
  ]) {
    if (list.some((name) => typeof name !== 'string' || !name))
      fail(`${which} skin has an unnamed joint`);
    if (new Set(list).size !== list.length) fail(`${which} skin has duplicate joint names`);
  }
  if (highNames.length !== lodNames.length)
    fail(`LOD skin has ${lodNames.length} joints, the full model has ${highNames.length}`);
  const remap = lodNames.map((name) => {
    const index = highNames.indexOf(name);
    if (index < 0) fail(`LOD joint "${name}" is not in the full-model skeleton`);
    return index;
  });
  // Same names must mean the same bones: every joint keeps its parent joint.
  const parentJoint = (json, skin) => {
      const parent = parentIndices(json),
        members = new Set(skin.joints);
      return skin.joints.map((joint) =>
        members.has(parent[joint]) ? json.nodes[parent[joint]].name : null,
      );
    },
    highParents = parentJoint(H, a),
    lodParents = parentJoint(L, b);
  remap.forEach((h, l) => {
    if (highParents[h] !== lodParents[l])
      fail(
        `joint hierarchy differs: "${lodNames[l]}" has parent "${lodParents[l]}" in the LOD but "${highParents[h]}" in the full model`,
      );
  });
  if (a.inverseBindMatrices === undefined || b.inverseBindMatrices === undefined)
    fail('both skins must define inverseBindMatrices');
  const highBind = floats(
      high,
      highViews,
      a.inverseBindMatrices,
      'full-model inverse bind matrices',
    ),
    lodBind = floats(lod, lodViews, b.inverseBindMatrices, 'LOD inverse bind matrices');
  let inverseBindDifference = 0,
    bottomRowDifference = 0;
  remap.forEach((h, l) => {
    for (let k = 0; k < 16; k++) {
      const difference = Math.abs(highBind[h * 16 + k] - lodBind[l * 16 + k]);
      if (!Number.isFinite(difference)) fail('inverse bind matrices must be finite');
      inverseBindDifference = Math.max(inverseBindDifference, difference);
      if (BOTTOM_ROW.includes(k)) bottomRowDifference = Math.max(bottomRowDifference, difference);
    }
  });
  if (!(inverseBindDifference <= STARTUP_TOLERANCE.inverseBindElement))
    fail(
      `inverse bind matrices differ by ${inverseBindDifference} (limit ${STARTUP_TOLERANCE.inverseBindElement})`,
    );
  const root = (json, skin) =>
    skin.skeleton === undefined ? null : json.nodes[skin.skeleton].name;
  if (a.skeleton !== undefined && b.skeleton !== undefined && root(H, a) !== root(L, b))
    fail(`skin skeleton roots differ ("${root(L, b)}" vs "${root(H, a)}")`);
  // Recorded only: the startup actor uses the full model's rest pose, never the LOD's.
  let restPoseDifference = 0;
  remap.forEach((h, l) => {
    restPoseDifference = Math.max(
      restPoseDifference,
      largestDifference(highWorld[a.joints[h]], lodWorld[b.joints[l]]),
    );
  });
  finite(restPoseDifference, 'joint rest pose difference', fail);
  return {
    highSkin,
    lodSkin,
    jointNames: highNames,
    remap,
    identity: remap.every((value, index) => value === index),
    inverseBindDifference,
    bottomRowDifference,
    restPoseDifference,
    highBind,
    lodBind,
  };
}

/** JOINTS_0/WEIGHTS_0, the only set three.js skins with. GLTFLoader normalises the weights
 * (normalised integers are re-quantised, so a share may exceed w/Σw by `slack`). */
function skinInfluences(lod, lodViews, primitive, jointCount, where, fail) {
  const sets = Object.keys(primitive.attributes)
    .filter((key) => SKIN_SET.test(key))
    .sort();
  if (sets.join() !== 'JOINTS_0,WEIGHTS_0')
    fail(
      `${where} skins with ${sets.join(', ') || 'no joint attributes'}; three.js skins with JOINTS_0/WEIGHTS_0 only`,
    );
  const count = lod.json.accessors[primitive.attributes.POSITION].count,
    jointsAccessor = lod.json.accessors[primitive.attributes.JOINTS_0],
    weightsAccessor = lod.json.accessors[primitive.attributes.WEIGHTS_0];
  if (jointsAccessor.count !== count || weightsAccessor.count !== count)
    fail(`${where} skin attribute counts differ from POSITION`);
  if (
    jointsAccessor.type !== 'VEC4' ||
    weightsAccessor.type !== 'VEC4' ||
    ![5121, 5123].includes(jointsAccessor.componentType)
  )
    fail(`${where} JOINTS_0/WEIGHTS_0 must be VEC4 with unsigned byte or short joints`);
  if (
    weightsAccessor.componentType !== 5126 &&
    !(weightsAccessor.normalized && [5121, 5123].includes(weightsAccessor.componentType))
  )
    fail(`${where} WEIGHTS_0 must be float or normalized unsigned integers`);
  const joints = integers(
      accessorElements(lod.json, lodViews, primitive.attributes.JOINTS_0),
      jointsAccessor.componentType,
    ),
    weights = weightValues(
      accessorElements(lod.json, lodViews, primitive.attributes.WEIGHTS_0),
      weightsAccessor,
    ),
    sums = new Float64Array(count);
  for (let i = 0; i < joints.length; i++) {
    if (joints[i] >= jointCount) fail(`${where} references joint ${joints[i]} of ${jointCount}`);
    if (!(weights[i] >= 0)) fail(`${where} has a negative or invalid weight`);
    sums[Math.floor(i / 4)] += weights[i];
  }
  let worst = 0;
  for (const sum of sums) worst = Math.max(worst, Math.abs(1 - sum));
  if (!(worst <= STARTUP_TOLERANCE.weightSum))
    fail(`${where} vertex weights deviate from 1 by ${worst}`);
  const slack =
    weightsAccessor.componentType === 5126
      ? 0
      : 0.5 / { 5121: 255, 5123: 65535 }[weightsAccessor.componentType];
  return { joints, weights, slack, maxWeightSumError: worst };
}

/** Bound, over LOD vertices and every pose poseBounds covers, on the distance between the LOD
 * skinned with the full model's inverse binds and with its own. three.js binds glTF skins with
 * an identity bind matrix and normalised weights ŵ, so a vertex p lands at s.xyz + (1 − s.w)·t_m
 * with s = Σ ŵ·J·IBM·(p, 1) and t_m the mesh node's world translation. With J = [L t] and the
 * two bound points (a, α), (b, β), the difference is Σ ŵ·(L(a − b) + (α − β)(t − t_m)), so it
 * is at most Σ ŵ·(factor·|a − b| + |α − β|·(reach + mesh reach)). `bindDistance` drops the
 * factor and bottom-row terms: the bound for rigid joints and identical bottom rows. */
function bindingDisplacement(positions, { joints, weights, slack }, skin, meshReach, where, fail) {
  let bound = 0,
    bindDistance = 0;
  for (let v = 0; v < positions.length / 3; v++) {
    const x = positions[3 * v],
      y = positions[3 * v + 1],
      z = positions[3 * v + 2];
    let total = 0;
    for (let k = 4 * v; k < 4 * v + 4; k++) total += weights[k];
    let vertexBound = 0,
      vertexDistance = 0;
    for (let k = 4 * v; k < 4 * v + 4; k++) {
      if (!(weights[k] > 0)) continue;
      const l = joints[k],
        h = skin.remap[l],
        share = Math.min(1, weights[k] / total + slack),
        a = transformPoint(skin.highBind, 16 * h, x, y, z),
        b = transformPoint(skin.lodBind, 16 * l, x, y, z),
        distance = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
      vertexDistance += share * distance;
      vertexBound +=
        share *
        (skin.jointFactor[h] * distance + Math.abs(a[3] - b[3]) * (skin.jointReach[h] + meshReach));
    }
    finite(vertexDistance, `${where} bind distance at LOD vertex ${v}`, fail);
    finite(vertexBound, `${where} skinned displacement bound at LOD vertex ${v}`, fail);
    if (vertexBound > bound) bound = vertexBound;
    if (vertexDistance > bindDistance) bindDistance = vertexDistance;
  }
  return { bound, bindDistance };
}

/** Per node of the joint and mesh chains, over every pose three.js's AnimationMixer (normal
 * blending) gives the full model's rest pose and clips: `factor` bounds the spectral norm of the
 * world matrix's linear part and `reach` the length of its translation. compose(T, q, S) has
 * linear part ((1 − |q|²)I + |q|²R)·S, of norm at most (1 + 2·max(0, |q|² − 1))·max|S|; norms
 * multiply down a chain. LINEAR and STEP samples, and the mixer's blends of them with the rest
 * value, never exceed the largest input |q|², |S| component or |T|: lerps are convex, and
 * slerpFlat gives |q|² − 1 = a²ε₀ + b²ε₁ with a, b ≥ 0 and a² + b² ≤ 1 (or normalises).
 * Unsupported input is rejected: CUBICSPLINE tangents can overshoot their keys, and a node
 * matrix may hold shear that three.js's TRS decomposition does not keep. */
function poseBounds(high, highViews, starts, fail) {
  const json = high.json,
    nodes = json.nodes,
    parent = parentIndices(json),
    chain = new Set();
  for (const start of starts)
    for (let n = start; n >= 0 && !chain.has(n); n = parent[n]) chain.add(n);
  const named = (n) => `node ${n}${nodes[n].name ? ` "${nodes[n].name}"` : ''}`,
    extremes = new Map(),
    norms = [Infinity, -Infinity],
    scales = [Infinity, -Infinity];
  const note = (n, path, values, where) => {
    if (!values.every(Number.isFinite)) fail(`${where} is not finite`);
    const entry = extremes.get(n);
    if (path === 'translation')
      entry.translation = Math.max(entry.translation, Math.hypot(...values));
    else if (path === 'rotation') {
      const norm = values.reduce((sum, value) => sum + value * value, 0);
      entry.norm = Math.max(entry.norm, norm);
      norms[0] = Math.min(norms[0], norm);
      norms[1] = Math.max(norms[1], norm);
    } else
      for (const value of values) {
        entry.scale = Math.max(entry.scale, Math.abs(value));
        scales[0] = Math.min(scales[0], Math.abs(value));
        scales[1] = Math.max(scales[1], Math.abs(value));
      }
  };
  for (const n of chain) {
    const node = nodes[n];
    if (node.matrix)
      fail(
        `${named(n)} on a joint or mesh chain uses a matrix; the binding bound covers TRS nodes only (three.js decomposes a matrix into TRS and drops shear)`,
      );
    extremes.set(n, { translation: 0, norm: -Infinity, scale: 0 });
    note(n, 'translation', node.translation ?? [0, 0, 0], `${named(n)} translation`);
    note(n, 'rotation', node.rotation ?? [0, 0, 0, 1], `${named(n)} rotation`);
    note(n, 'scale', node.scale ?? [1, 1, 1], `${named(n)} scale`);
  }
  const channels = { translation: 0, rotation: 0, scale: 0 },
    interpolation = Object.fromEntries(BOUNDED_INTERPOLATION.map((mode) => [mode, 0]));
  (json.animations ?? []).forEach((animation, index) => {
    const clip = `clip "${animation.name ?? `animation_${index}`}"`;
    for (const channel of animation.channels ?? []) {
      const n = channel.target?.node,
        path = channel.target?.path;
      if (!chain.has(n) || !Object.hasOwn(channels, path)) continue;
      const sampler = animation.samplers[channel.sampler],
        mode = sampler.interpolation ?? 'LINEAR';
      if (!BOUNDED_INTERPOLATION.includes(mode))
        fail(
          `${clip} animates ${named(n)} ${path} with ${mode}; the binding bound covers LINEAR and STEP keys only (cubic tangents can overshoot their keys)`,
        );
      channels[path]++;
      interpolation[mode]++;
      const width = path === 'rotation' ? 4 : 3;
      if (json.accessors[sampler.output]?.type !== `VEC${width}`)
        fail(`${clip} ${path} keyframes must be VEC${width}`);
      const values = floats(high, highViews, sampler.output, `${clip} ${path} keyframes`);
      for (let i = 0; i + width <= values.length; i += width)
        note(
          n,
          path,
          Array.from(values.subarray(i, i + width)),
          `${clip} ${named(n)} ${path} keyframe`,
        );
    }
  });
  const factor = new Map(),
    reach = new Map();
  const visit = (n) => {
    if (factor.has(n)) return;
    const up = parent[n];
    if (up >= 0) visit(up);
    const { translation, norm, scale } = extremes.get(n),
      above = up >= 0 ? factor.get(up) : 1;
    factor.set(
      n,
      finite(
        above * (1 + 2 * Math.max(0, norm - 1)) * scale,
        `${named(n)} pose bound factor`,
        fail,
      ),
    );
    reach.set(
      n,
      finite(
        (up >= 0 ? reach.get(up) : 0) + above * translation,
        `${named(n)} pose bound reach`,
        fail,
      ),
    );
  };
  for (const n of chain) visit(n);
  return {
    factor,
    reach,
    census: {
      model:
        'TRS nodes; LINEAR/STEP keys; three.js AnimationMixer normal blending of rest pose and clips',
      chainNodes: chain.size,
      channels,
      interpolation,
      quaternionNormSquared: norms,
      scaleRange: scales,
    },
  };
}

// Every error names the actor, including those raised by shared readers.
function withLabel(prefix, action) {
  try {
    return action();
  } catch (error) {
    if (error.message.startsWith(prefix)) throw error;
    throw new Error(`${prefix}${error.message}`, { cause: error });
  }
}

/** Prove that the LOD geometry belongs to this skeleton and these primitives, and decide per
 * primitive whether the startup actor shows the full model's geometry or the adopted LOD's. */
export const checkStartupCompatibility = (high, lod, label, options = {}) =>
  withLabel(`${label}: incompatible startup LOD: `, () =>
    proveCompatibility(high, lod, label, options),
  );

function proveCompatibility(high, lod, label, { geometryPolicy = GEOMETRY_POLICIES[0] } = {}) {
  const fail = (message) => {
    throw new Error(`${label}: incompatible startup LOD: ${message}`);
  };
  if (!GEOMETRY_POLICIES.includes(geometryPolicy))
    fail(`unknown geometry policy ${geometryPolicy}`);
  const H = high.json,
    L = lod.json,
    highViews = storedViews(high),
    lodViews = storedViews(lod);
  if (!(H.animations ?? []).length) fail('the full model has no animation clips to carry');
  if ((H.meshes ?? []).length !== (L.meshes ?? []).length)
    fail(
      `LOD has ${(L.meshes ?? []).length} meshes, the full model has ${(H.meshes ?? []).length}`,
    );
  const highNodes = meshNodes(H, 'full-model', fail),
    lodNodes = meshNodes(L, 'LOD', fail),
    highWorld = worldMatrices(H),
    lodWorld = worldMatrices(L);
  for (const [which, json, world] of [
    ['full-model', H, highWorld],
    ['LOD', L, lodWorld],
  ])
    world.forEach((matrix, n) => {
      if (!matrix.every(Number.isFinite))
        fail(
          `${which} node ${n}${json.nodes[n].name ? ` "${json.nodes[n].name}"` : ''} world transform is not finite`,
        );
    });
  if (highNodes.length !== lodNodes.length) fail('mesh node counts differ');
  const skins = new Map();
  const pairs = highNodes.map((h, i) => {
    const l = lodNodes[i];
    if (h.node.mesh !== l.node.mesh)
      fail(`mesh node ${i} uses mesh ${l.node.mesh} in the LOD, ${h.node.mesh} in the full model`);
    if (h.node.name !== l.node.name)
      fail(`mesh node "${l.node.name}" differs from "${h.node.name}"`);
    if ((h.node.skin === undefined) !== (l.node.skin === undefined))
      fail(`mesh node "${h.node.name}" skinning differs`);
    const worldTransformDifference = finite(
      largestDifference(highWorld[h.index], lodWorld[l.index]),
      `mesh node "${h.node.name}" world transform difference`,
      fail,
    );
    if (!(worldTransformDifference <= STARTUP_TOLERANCE.worldMatrix))
      fail(`mesh node "${h.node.name}" world transform differs by ${worldTransformDifference}`);
    if (h.node.skin !== undefined && !skins.has(l.node.skin))
      skins.set(
        l.node.skin,
        compareSkins(
          high,
          lod,
          highViews,
          lodViews,
          highWorld,
          lodWorld,
          h.node.skin,
          l.node.skin,
          fail,
        ),
      );
    if (h.node.skin !== undefined && skins.get(l.node.skin).highSkin !== h.node.skin)
      fail('one LOD skin maps to two different full-model skins');
    return {
      mesh: h.node.mesh,
      node: h.node.name,
      highNode: h.index,
      lodNode: l.index,
      highSkin: h.node.skin,
      lodSkin: l.node.skin,
      worldTransformDifference,
    };
  });
  for (const [lodSkin, skin] of skins) {
    const joints = H.skins[skin.highSkin].joints,
      skinned = pairs.filter((pair) => pair.lodSkin === lodSkin).map((pair) => pair.highNode),
      pose = poseBounds(high, highViews, [...joints, ...skinned], fail);
    skin.jointFactor = joints.map((joint) => pose.factor.get(joint));
    skin.jointReach = joints.map((joint) => pose.reach.get(joint));
    skin.meshReach = new Map(skinned.map((node) => [node, pose.reach.get(node)]));
    skin.pose = {
      ...pose.census,
      largestJointFactor: Math.max(...skin.jointFactor),
      largestJointReachMetres: Math.max(...skin.jointReach),
      meshReachMetres: Math.max(...skin.meshReach.values()),
    };
    skin.skinnedDisplacementBound = 0;
  }
  const primitives = [],
    // `${mesh}:${primitive}` -> source-derived indices and source vertex map (not in the report).
    simplified = new Map();
  for (const pair of pairs) {
    const highMesh = H.meshes[pair.mesh],
      lodMesh = L.meshes[pair.mesh],
      skin = pair.lodSkin === undefined ? null : skins.get(pair.lodSkin);
    if (highMesh.primitives.length !== lodMesh.primitives.length)
      fail(
        `mesh ${pair.mesh} has ${lodMesh.primitives.length} LOD primitives, ${highMesh.primitives.length} full`,
      );
    const fullPositions = highMesh.primitives.map((hp, p) =>
        floats(
          high,
          highViews,
          hp.attributes.POSITION,
          `mesh ${pair.mesh} primitive ${p} full POSITION`,
        ),
      ),
      fullBounds = fullPositions.map(bounds),
      meshBounds = unionBounds(fullBounds),
      cell = Math.max(STARTUP_TOLERANCE.surfaceCell * meshBounds.diagonal, 1e-6),
      coarse = Math.max(STARTUP_TOLERANCE.outlierCell * meshBounds.diagonal, 1e-6),
      pad =
        STARTUP_TOLERANCE.meshBoundsPadding * meshBounds.diagonal +
        STARTUP_TOLERANCE.boundsAbsolute,
      surfaces = fullPositions.map((values) => surfaceIndex(values, meshBounds.min, cell)),
      headJoint =
        pair.highSkin === undefined
          ? -1
          : H.skins[pair.highSkin].joints.findIndex(
              (joint) => H.nodes[joint].name === STARTUP_GEOMETRY.headJoint,
            ),
      jointNamesOfSkin =
        pair.highSkin === undefined
          ? []
          : H.skins[pair.highSkin].joints.map((joint) => H.nodes[joint].name),
      sources = highMesh.primitives.map((hp, p) => {
        const headWeightShare = jointWeightShare(high, highViews, hp, headJoint),
          single = highMesh.primitives.length === 1,
          kind = single
            ? RETENTION.whole
            : headWeightShare >= STARTUP_GEOMETRY.headWeightShare
              ? RETENTION.head
              : null,
          base = {
            headWeightShare,
            fullRawBytes: rawBytesOf(H, [hp]),
            lodRawBytes: rawBytesOf(L, [lodMesh.primitives[p]]),
          };
        if (kind && geometryPolicy !== 'adopted-lod-only')
          return {
            source: 'full-model',
            retention: kind,
            reason:
              kind === RETENTION.whole
                ? 'single-primitive player mesh: its adopted LOD face is damaged at gallery distance (Codex r02 review), so the whole primitive keeps the full model geometry, a whole-model cost rather than a head-only one'
                : 'head primitive: the full model keeps its own geometry, UVs and weights at startup',
            ...base,
          };
        if (geometryPolicy !== 'source-derived')
          return {
            source: 'adopted-lod',
            retention: null,
            reason: kind ? 'policy adopted-lod-only' : 'not a head primitive',
            ...base,
          };
        // Seams with every other primitive (retained heads, accents, the body) stay exactly.
        const attempt = simplifySourcePrimitive({
          doc: high,
          views: highViews,
          primitive: hp,
          lockedPositions: new Set(fullPositions.filter((_, i) => i !== p).flatMap(positionKeys)),
          jointNames: jointNamesOfSkin,
        });
        if (!attempt.supported)
          return {
            source: 'full-model',
            retention: RETENTION.unsupported,
            reason: `not simplified (${attempt.reason}); the whole original primitive is kept, which is not a geometry optimization`,
            ...base,
          };
        if (!attempt.reduced)
          return {
            source: 'full-model',
            retention: RETENTION.unreduced,
            reason:
              'no useful reduction within the error limit; the whole original primitive is kept, which is not a geometry optimization',
            simplification: attempt.record,
            ...base,
          };
        simplified.set(`${pair.mesh}:${p}`, attempt);
        const indexSize = COMPONENT_BYTES[H.accessors[hp.indices].componentType];
        return {
          source: 'source-simplified',
          retention: null,
          reason:
            'deterministic index-only reduction of the original full primitive (no adopted LOD); every surviving vertex is a source vertex copied byte for byte',
          simplification: attempt.record,
          simplifiedRawBytes:
            Object.values(hp.attributes).reduce(
              (sum, a) =>
                sum + elementSize(H.accessors[a], `accessor ${a}`) * attempt.sourceVertices.length,
              0,
            ) +
            indexSize * attempt.indices.length,
          ...base,
        };
      }),
      lodPositionList = [];
    highMesh.primitives.forEach((hp, p) => {
      const lp = lodMesh.primitives[p],
        where = `mesh ${pair.mesh} primitive ${p}`,
        { source } = sources[p],
        retained = source === 'full-model',
        fromLod = source === 'adopted-lod',
        derived = simplified.get(`${pair.mesh}:${p}`);
      if ((hp.mode ?? 4) !== (lp.mode ?? 4)) fail(`${where} primitive mode differs`);
      const highKeys = Object.keys(hp.attributes),
        lodKeys = Object.keys(lp.attributes),
        omitted = highKeys.filter((key) => !lodKeys.includes(key));
      if (
        lodKeys.some((key) => !highKeys.includes(key)) ||
        omitted.some((key) => !OPTIONAL_LOD_ATTRIBUTES.includes(key))
      )
        fail(
          `${where} attributes differ (LOD ${[...lodKeys].sort()} vs full ${[...highKeys].sort()}); only ${OPTIONAL_LOD_ATTRIBUTES.join(', ')} may be absent from the LOD`,
        );
      for (const key of lodKeys) {
        const a = H.accessors[hp.attributes[key]],
          b = L.accessors[lp.attributes[key]];
        if (
          a.type !== b.type ||
          a.componentType !== b.componentType ||
          !!a.normalized !== !!b.normalized
        )
          fail(`${where} ${key} layout differs`);
        if (b.sparse || b.bufferView === undefined)
          fail(`${where} ${key} uses sparse or implicit LOD data`);
      }
      if ((hp.indices === undefined) !== (lp.indices === undefined))
        fail(`${where} indexing differs`);
      if (
        lp.indices !== undefined &&
        (L.accessors[lp.indices].sparse || L.accessors[lp.indices].bufferView === undefined)
      )
        fail(`${where} uses sparse or implicit LOD indices`);
      if ((hp.targets?.length ?? 0) !== (lp.targets?.length ?? 0))
        fail(`${where} morph target counts differ`);
      (hp.targets ?? []).forEach((target, t) => {
        if (Object.keys(target).sort().join() !== Object.keys(lp.targets[t]).sort().join())
          fail(`${where} morph target ${t} attributes differ`);
      });
      if (skin && fromLod && lp.targets?.length)
        fail(
          `${where} is skinned and has morph targets; the binding bound covers unmorphed positions only`,
        );
      // Delivered LODs name their placeholder slot after the full material; a name that
      // points at another primitive proves the order differs. Renamed materials are allowed.
      let materialSlot = 'unnamed';
      const slot = SLOT_PREFIX.exec(L.materials?.[lp.material]?.name ?? '');
      if (slot) {
        if (slot[1] === H.materials?.[hp.material]?.name) materialSlot = 'name-matched';
        else {
          const other = highMesh.primitives.findIndex(
            (q, i) => i !== p && H.materials?.[q.material]?.name === slot[1],
          );
          if (other >= 0)
            fail(`${where} LOD slot "${slot[1]}" names full-model primitive ${other}`);
          materialSlot = 'full-material-renamed';
        }
      }
      const lodPositions = floats(lod, lodViews, lp.attributes.POSITION, `${where} LOD POSITION`),
        reduced = bounds(lodPositions),
        full = fullBounds[p];
      lodPositionList[p] = lodPositions;
      // Every LOD primitive is still checked: the correspondence proves the primitive order even
      // where the full geometry is kept.
      for (let axis = 0; axis < 3; axis++)
        if (!(
          reduced.min[axis] >= meshBounds.min[axis] - pad &&
          reduced.max[axis] <= meshBounds.max[axis] + pad
        ))
          fail(
            `${where} LOD extends outside the full mesh bounds on ${'xyz'[axis]}; wrong actor or scale`,
          );
      const agreements = surfaces.map((surface) =>
          surfaceAgreement(lodPositions, surface, meshBounds.min, cell),
        ),
        own = agreements[p],
        competing = Math.max(0, ...agreements.filter((_, i) => i !== p));
      if (!(own >= STARTUP_TOLERANCE.minimumSurfaceAgreement))
        fail(
          `${where} surface agreement: only ${percent(own)} of LOD vertices lie on the full primitive; wrong primitive order or actor`,
        );
      if (!(competing - own <= STARTUP_TOLERANCE.surfaceMargin))
        fail(
          `${where} surface agreement: LOD lies on full-model primitive ${agreements.indexOf(competing)} (${percent(competing)}) rather than its own (${percent(own)})`,
        );
      const outliers = Math.round(
        (1 -
          surfaceAgreement(
            lodPositions,
            surfaceIndex(fullPositions[p], meshBounds.min, coarse),
            meshBounds.min,
            coarse,
          )) *
          (lodPositions.length / 3),
      );
      if (outliers !== 0)
        fail(
          `${where} bind pose: ${outliers} LOD vertices lie more than ${coarse.toFixed(3)} m from the full primitive (posed geometry or a different part)`,
        );
      const diagonalRatio = full.diagonal ? reduced.diagonal / full.diagonal : 1;
      if (!(diagonalRatio >= STARTUP_TOLERANCE.minimumDiagonalRatio))
        fail(`${where} LOD bounds are only ${diagonalRatio.toFixed(3)} of the full primitive`);
      // Information only: simplified surfaces usually reuse source vertices exactly.
      const known = new Set();
      for (let i = 0; i < fullPositions[p].length; i += 3)
        known.add(`${fullPositions[p][i]},${fullPositions[p][i + 1]},${fullPositions[p][i + 2]}`);
      let reused = 0;
      for (let i = 0; i < lodPositions.length; i += 3)
        if (known.has(`${lodPositions[i]},${lodPositions[i + 1]},${lodPositions[i + 2]}`)) reused++;
      // The binding proof covers the geometry the startup actor shows: retained primitives are
      // the full model's own, bound by its own skin.
      let weights = null,
        displacement = null;
      if (skin && fromLod) {
        weights = skinInfluences(lod, lodViews, lp, skin.jointNames.length, where, fail);
        displacement = bindingDisplacement(
          lodPositions,
          weights,
          skin,
          skin.meshReach.get(pair.highNode),
          where,
          fail,
        );
        skin.skinnedDisplacementBound = Math.max(skin.skinnedDisplacementBound, displacement.bound);
      }
      const fullStretch = uvStretch(high, highViews, hp, `${where} full`);
      if (derived) {
        // The same chart measure for the source-derived triangles (indices into source vertices).
        const uv = hp.attributes.TEXCOORD_0;
        sources[p].simplification.uvCharts =
          uv === undefined || H.accessors[uv].componentType !== 5126
            ? null
            : uvCharts(
                fullStretch,
                stretchOf(
                  fullPositions[p],
                  floats(high, highViews, uv, `${where} TEXCOORD_0`),
                  Uint32Array.from(derived.indices, (index) => derived.sourceVertices[index]),
                ),
              );
      }
      primitives.push({
        mesh: pair.mesh,
        primitive: p,
        material: H.materials?.[hp.material]?.name ?? null,
        materialSlot,
        geometry: {
          ...sources[p],
          startupVertices: retained
            ? fullPositions[p].length / 3
            : derived
              ? derived.sourceVertices.length
              : lodPositions.length / 3,
          startupTriangles: retained
            ? primitiveTriangles(H, hp)
            : derived
              ? derived.indices.length / 3
              : primitiveTriangles(L, lp),
          fullTriangles: primitiveTriangles(H, hp),
          lodTriangles: primitiveTriangles(L, lp),
          uvCharts: uvCharts(fullStretch, uvStretch(lod, lodViews, lp, `${where} LOD`)),
        },
        omittedAttributes: fromLod ? omitted : [],
        shading: shadingOf(H.materials?.[hp.material], hp, lp, fromLod ? lp : hp),
        lodVertices: lodPositions.length / 3,
        fullVertices: fullPositions[p].length / 3,
        exactVertexReuse: lodPositions.length ? reused / (lodPositions.length / 3) : 0,
        surfaceAgreement: own,
        competingSurfaceAgreement: competing,
        bindPoseOutliers: outliers,
        overhangBeyondFullPrimitiveMetres: Math.max(
          0,
          ...[0, 1, 2].flatMap((axis) => [
            full.min[axis] - reduced.min[axis],
            reduced.max[axis] - full.max[axis],
          ]),
        ),
        boundsDiagonalRatio: diagonalRatio,
        boundsCentreOffsetMetres: Math.hypot(
          ...[0, 1, 2].map((axis) => reduced.centre[axis] - full.centre[axis]),
        ),
        maxWeightSumError: weights?.maxWeightSumError ?? null,
        bindDistanceMetres: displacement?.bindDistance ?? null,
        skinnedDisplacementBoundMetres: displacement?.bound ?? null,
      });
    });
    // A retained full primitive meets its startup neighbours: record whether the seam positions
    // it shared with the full neighbours still exist in them, and how far the rest are.
    const startupPositions = (i) => {
      if (sources[i].source === 'full-model') return fullPositions[i];
      const derivedOther = simplified.get(`${pair.mesh}:${i}`);
      if (!derivedOther) return lodPositionList[i];
      const rows = new Float32Array(derivedOther.sourceVertices.length * 3);
      derivedOther.sourceVertices.forEach((v, j) =>
        rows.set(fullPositions[i].subarray(3 * v, 3 * v + 3), 3 * j),
      );
      return rows;
    };
    highMesh.primitives.forEach((_, p) => {
      if (sources[p].source !== 'full-model') return;
      const others = highMesh.primitives.map((__, i) => i).filter((i) => i !== p),
        record = primitives.find((item) => item.mesh === pair.mesh && item.primitive === p);
      record.geometry.seam = seamOf(
        fullPositions[p],
        others.map((i) => fullPositions[i]),
        others.map(startupPositions),
      );
    });
  }
  for (const skin of skins.values())
    if (
      !(
        finite(skin.skinnedDisplacementBound, 'skinned displacement bound', fail) <=
        STARTUP_TOLERANCE.skinnedDisplacement
      )
    )
      fail(
        `skinned displacement: binding the LOD with the full model's inverse binds can move LOD vertices up to ${skin.skinnedDisplacementBound} m in some pose (limit ${STARTUP_TOLERANCE.skinnedDisplacement} m)`,
      );
  return { pairs, skins, primitives, simplified };
}

/** The normal-map frame each three.js binding of this primitive renders. GLTFLoader gives
 * geometry without TANGENT derivative tangents and a material clone with normalScale.y negated
 * (its convention for that frame, three.js #11438); geometry with TANGENT keeps the material as
 * authored. The same pose says nothing about this. `startupPrimitive` is the geometry the
 * startup actor shows: the LOD's, or the full model's own where it is retained.
 *
 * `existingLod` and `sameAsExistingLod` are historical. They describe performance-lod.ts as it was
 * when r02–r04 were generated: it swapped the LOD geometry in under the full mesh's material
 * instance, so where only the full model has TANGENT it paired derivative tangents with the
 * un-negated material. performance-lod.ts has since finalised the material for the geometry it
 * shows, as GLTFLoader does. The fields are kept unchanged because verify-candidates re-derives
 * the recorded reports exactly; they say nothing about today's binding. */
function shadingOf(material, fullPrimitive, lodPrimitive, startupPrimitive) {
  // GLTFLoader ignores normal maps on unlit (MeshBasicMaterial) materials.
  if (material?.normalTexture === undefined || material.extensions?.KHR_materials_unlit)
    return { normalMap: false, sameAsExistingLod: true };
  const scale = material.normalTexture.scale ?? 1,
    full = fullPrimitive.attributes.TANGENT !== undefined,
    reduced = lodPrimitive.attributes.TANGENT !== undefined,
    startup = startupPrimitive.attributes.TANGENT !== undefined,
    binding = (geometryTangents, materialTangents) => ({
      tangents: geometryTangents ? 'vertex' : 'derivative',
      normalScale: [scale, materialTangents ? scale : -scale],
      loaderConvention: geometryTangents === materialTangents,
    });
  return {
    normalMap: true,
    normalScale: scale,
    upgrade: binding(full, full),
    startup: binding(startup, startup),
    existingLod: binding(reduced, full),
    sameAsExistingLod: startup === reduced && startup === full,
  };
}

function remapJoints(bytes, componentType, remap) {
  const size = COMPONENT_BYTES[componentType],
    out = Buffer.from(bytes);
  for (let i = 0; i < out.length / size; i++) {
    const value =
        size === 1 ? out[i] : size === 2 ? out.readUInt16LE(2 * i) : out.readUInt32LE(4 * i),
      mapped = remap[value];
    if (mapped === undefined) throw new Error(`joint index ${value} has no remap`);
    if (size === 1) out[i] = mapped;
    else if (size === 2) out.writeUInt16LE(mapped, 2 * i);
    else out.writeUInt32LE(mapped, 4 * i);
  }
  return out;
}

function padRows(bytes, count, size, stride) {
  const out = Buffer.alloc(count * stride);
  for (let i = 0; i < count; i++) bytes.copy(out, i * stride, i * size, (i + 1) * size);
  return out;
}

/** Build the merged document. Full-model geometry that nothing references any more is dropped. */
export const buildStartupActor = (high, lod, label, options = {}) =>
  withLabel(`${label}: `, () => mergeStartupActor(high, lod, label, options));

function mergeStartupActor(high, lod, label, { geometryPolicy = GEOMETRY_POLICIES[0] } = {}) {
  const compatibility = checkStartupCompatibility(high, lod, label, { geometryPolicy }),
    sourceOf = (mesh, primitive) =>
      compatibility.primitives.find((item) => item.mesh === mesh && item.primitive === primitive)
        .geometry.source,
    H = high.json,
    L = lod.json,
    lodViews = storedViews(lod),
    json = structuredClone(H),
    added = [],
    cache = new Map();
  // New accessors are referenced as -(n + 1) until the final renumbering.
  const copy = (index, semantic, skin) => {
    const remap = JOINTS.test(semantic) && skin && !skin.identity ? skin.remap : null,
      key = `${index}:${remap ? skin.lodSkin : '-'}`;
    if (cache.has(key)) return cache.get(key);
    const source = L.accessors[index],
      size = elementSize(source, `LOD accessor ${index}`),
      indices = semantic === 'indices',
      stride = indices ? size : size + padding4(size);
    let bytes = accessorElements(L, lodViews, index);
    if (remap) bytes = remapJoints(bytes, source.componentType, remap);
    const accessor = {};
    for (const [field, value] of Object.entries(source))
      if (field !== 'bufferView' && field !== 'byteOffset')
        accessor[field] = structuredClone(value);
    if (remap && (accessor.min || accessor.max)) {
      const values = integers(bytes, source.componentType),
        min = [Infinity, Infinity, Infinity, Infinity],
        max = [-Infinity, -Infinity, -Infinity, -Infinity];
      values.forEach((value, i) => {
        min[i % 4] = Math.min(min[i % 4], value);
        max[i % 4] = Math.max(max[i % 4], value);
      });
      accessor.min = min;
      accessor.max = max;
    }
    added.push({
      accessor,
      bytes: stride === size ? bytes : padRows(bytes, source.count, size, stride),
      target: indices ? 34963 : 34962,
      byteStride: stride === size ? undefined : stride,
    });
    const marker = -added.length;
    cache.set(key, marker);
    return marker;
  };
  // Source-derived primitives: the surviving source vertices' rows, byte for byte, in the
  // compacted order (new vertex i = source vertex sourceVertices[i]).
  const highViews = storedViews(high),
    rows = (index, sourceVertices) => {
      const source = H.accessors[index],
        size = elementSize(source, `accessor ${index}`),
        stride = size + padding4(size),
        all = accessorElements(H, highViews, index),
        bytes = Buffer.alloc(sourceVertices.length * size);
      sourceVertices.forEach((v, i) => all.copy(bytes, i * size, v * size, (v + 1) * size));
      const accessor = {};
      for (const [field, value] of Object.entries(source))
        if (!['bufferView', 'byteOffset', 'sparse', 'min', 'max'].includes(field))
          accessor[field] = structuredClone(value);
      accessor.count = sourceVertices.length;
      if (source.min || source.max) {
        const width = TYPE_WIDTH[source.type],
          values =
            source.componentType === 5126
              ? new Float32Array(
                  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length),
                )
              : integers(bytes, source.componentType),
          min = new Array(width).fill(Infinity),
          max = new Array(width).fill(-Infinity);
        for (let i = 0; i < values.length; i++) {
          min[i % width] = Math.min(min[i % width], values[i]);
          max[i % width] = Math.max(max[i % width], values[i]);
        }
        if (source.min) accessor.min = min;
        if (source.max) accessor.max = max;
      }
      added.push({
        accessor,
        bytes: stride === size ? bytes : padRows(bytes, sourceVertices.length, size, stride),
        target: 34962,
        byteStride: stride === size ? undefined : stride,
      });
      return -added.length;
    },
    indicesOf = (index, values) => {
      const source = H.accessors[index],
        size = COMPONENT_BYTES[source.componentType],
        bytes = Buffer.alloc(values.length * size);
      values.forEach((value, i) =>
        size === 1
          ? (bytes[i] = value)
          : size === 2
            ? bytes.writeUInt16LE(value, 2 * i)
            : bytes.writeUInt32LE(value, 4 * i),
      );
      added.push({
        accessor: {
          componentType: source.componentType,
          count: values.length,
          type: 'SCALAR',
          ...(source.name ? { name: source.name } : {}),
        },
        bytes,
        target: 34963,
      });
      return -added.length;
    };
  for (const pair of compatibility.pairs) {
    const skin = pair.lodSkin === undefined ? null : compatibility.skins.get(pair.lodSkin);
    json.meshes[pair.mesh].primitives.forEach((primitive, p) => {
      // Retained primitives keep the full model's accessors exactly (attributes, indices, targets).
      if (sourceOf(pair.mesh, p) === 'full-model') return;
      const derived = compatibility.simplified.get(`${pair.mesh}:${p}`);
      if (derived) {
        // Same attribute names and order as the original primitive; no attribute is dropped.
        primitive.attributes = Object.fromEntries(
          Object.entries(primitive.attributes).map(([key, index]) => [
            key,
            rows(index, derived.sourceVertices),
          ]),
        );
        primitive.indices = indicesOf(primitive.indices, derived.indices);
        return;
      }
      const reduced = L.meshes[pair.mesh].primitives[p];
      // Full-model attribute order; optional attributes the LOD never had stay absent.
      primitive.attributes = Object.fromEntries(
        Object.keys(primitive.attributes)
          .filter((key) => reduced.attributes[key] !== undefined)
          .map((key) => [key, copy(reduced.attributes[key], key, skin)]),
      );
      if (reduced.indices !== undefined) primitive.indices = copy(reduced.indices, 'indices', null);
      if (primitive.targets)
        primitive.targets = primitive.targets.map((target, t) =>
          Object.fromEntries(
            Object.keys(target).map((key) => [
              key,
              copy(reduced.targets[t][key], `target ${key}`, null),
            ]),
          ),
        );
    });
  }
  // Reachability from everything the startup actor keeps.
  const keptHigh = new Set();
  const note = (reference) => {
    if (reference >= 0) keptHigh.add(reference);
  };
  (json.meshes ?? []).forEach((mesh, m) =>
    mesh.primitives.forEach((primitive, p) => {
      const references = [
          ...Object.values(primitive.attributes),
          ...(primitive.indices === undefined ? [] : [primitive.indices]),
          ...(primitive.targets ?? []).flatMap((target) => Object.values(target)),
        ],
        retained = sourceOf(m, p) === 'full-model';
      if (
        retained
          ? references.some((reference) => reference < 0)
          : references.some((reference) => reference >= 0)
      )
        throw new Error(`${label}: mesh ${m} primitive ${p} mixes full-model and LOD geometry`);
      if (retained) references.forEach(note);
    }),
  );
  for (const skin of json.skins ?? [])
    if (skin.inverseBindMatrices !== undefined) note(skin.inverseBindMatrices);
  for (const animation of json.animations ?? [])
    for (const sampler of animation.samplers) {
      note(sampler.input);
      note(sampler.output);
    }
  const highAccessors = [...keptHigh].sort((a, b) => a - b),
    accessorMap = new Map(highAccessors.map((reference, index) => [reference, index]));
  added.forEach((_, j) => accessorMap.set(-(j + 1), highAccessors.length + j));
  const highViewSet = new Set();
  for (const reference of highAccessors) {
    const accessor = H.accessors[reference];
    if (accessor.bufferView !== undefined) highViewSet.add(accessor.bufferView);
    if (accessor.sparse) {
      highViewSet.add(accessor.sparse.indices.bufferView);
      highViewSet.add(accessor.sparse.values.bufferView);
    }
  }
  for (const image of json.images ?? []) highViewSet.add(image.bufferView);
  const highViewList = [...highViewSet].sort((a, b) => a - b),
    viewMap = new Map(highViewList.map((view, index) => [view, index])),
    highStored = storedViews(high),
    parts = [],
    bufferViews = [];
  let length = 0;
  const store = (bytes) => {
    const pad = padding4(length);
    if (pad) {
      parts.push(Buffer.alloc(pad));
      length += pad;
    }
    const at = length;
    parts.push(bytes);
    length += bytes.length;
    return at;
  };
  for (const view of highViewList) {
    const source = H.bufferViews[view];
    bufferViews.push({
      ...source,
      buffer: 0,
      byteOffset: store(highStored[view]),
      byteLength: source.byteLength,
    });
  }
  for (const item of added)
    bufferViews.push({
      buffer: 0,
      byteOffset: store(item.bytes),
      byteLength: item.bytes.length,
      ...(item.byteStride ? { byteStride: item.byteStride } : {}),
      target: item.target,
    });
  const accessors = highAccessors.map((reference) => {
    const accessor = structuredClone(H.accessors[reference]);
    if (accessor.bufferView !== undefined) accessor.bufferView = viewMap.get(accessor.bufferView);
    if (accessor.sparse) {
      accessor.sparse.indices.bufferView = viewMap.get(accessor.sparse.indices.bufferView);
      accessor.sparse.values.bufferView = viewMap.get(accessor.sparse.values.bufferView);
    }
    return accessor;
  });
  added.forEach((item, j) =>
    accessors.push({ bufferView: highViewList.length + j, ...item.accessor }),
  );
  const map = (reference) => accessorMap.get(reference);
  for (const mesh of json.meshes ?? [])
    for (const primitive of mesh.primitives) {
      primitive.attributes = Object.fromEntries(
        Object.entries(primitive.attributes).map(([key, value]) => [key, map(value)]),
      );
      if (primitive.indices !== undefined) primitive.indices = map(primitive.indices);
      if (primitive.targets)
        primitive.targets = primitive.targets.map((target) =>
          Object.fromEntries(Object.entries(target).map(([key, value]) => [key, map(value)])),
        );
    }
  for (const skin of json.skins ?? [])
    if (skin.inverseBindMatrices !== undefined)
      skin.inverseBindMatrices = map(skin.inverseBindMatrices);
  for (const animation of json.animations ?? [])
    for (const sampler of animation.samplers) {
      sampler.input = map(sampler.input);
      sampler.output = map(sampler.output);
    }
  for (const image of json.images ?? []) image.bufferView = viewMap.get(image.bufferView);
  json.accessors = accessors;
  json.bufferViews = bufferViews;
  json.buffers = [{ ...(H.buffers?.[0] ?? {}), byteLength: length }];
  const removedViews = (H.bufferViews ?? [])
      .map((_, view) => view)
      .filter((view) => !highViewSet.has(view)),
    retained = compatibility.primitives.filter((item) => item.geometry.source === 'full-model'),
    sum = (list, field) => list.reduce((total, item) => total + item.geometry[field], 0),
    costOf = (list) => ({
      primitives: list.length,
      vertices: list.reduce((total, item) => total + item.fullVertices, 0),
      triangles: sum(list, 'fullTriangles'),
      rawBytes: rawBytesOf(
        H,
        list.map((item) => H.meshes[item.mesh].primitives[item.primitive]),
      ),
      replacedLodVertices: list.reduce((total, item) => total + item.lodVertices, 0),
      replacedLodTriangles: sum(list, 'lodTriangles'),
      replacedLodRawBytes: rawBytesOf(
        L,
        list.map((item) => L.meshes[item.mesh].primitives[item.primitive]),
      ),
    });
  return {
    json,
    bin: Buffer.concat(parts, length),
    report: {
      structure:
        'full-model nodes (rest pose), skins, inverse binds, materials, textures and clips; per primitive the full model geometry (retained), a source-derived reduction of it, or (diagnostic policies only) the adopted LOD geometry, in the same mesh/primitive order',
      geometry: {
        policy: geometryPolicy,
        rule:
          geometryPolicy === 'source-derived'
            ? `primitives of a multi-primitive mesh with at least ${STARTUP_GEOMETRY.headWeightShare * 100}% of their skin weight on the ${STARTUP_GEOMETRY.headJoint} joint, and the only primitive of a single-primitive mesh, keep the full model's geometry byte for byte; every other primitive is an index-only reduction of its own full primitive (source-simplify.mjs), or kept whole where that finds no useful reduction; the adopted LOD is never shown`
            : `diagnostic policy ${geometryPolicy}: face primitives ${geometryPolicy === 'adopted-lod-only' ? 'and all others' : 'are retained; all others'} show the adopted LOD`,
        lowLevel:
          "this geometry is the player's low level: a runtime distance or far level must not use the adopted LOD file for any primitive; retained primitives (heads, the whole primitive of single-primitive actors, unreduced primitives) stay full and source-simplified primitives keep exactly this file's geometry, so no level may swap retained primitives back to the adopted LOD; the full upgrade replaces geometry only, keeping pose and root",
        primitives: compatibility.primitives.map(({ mesh, primitive, material, geometry }) => ({
          mesh,
          primitive,
          material,
          source: geometry.source,
          retention: geometry.retention,
          vertices: geometry.startupVertices,
          triangles: geometry.startupTriangles,
          rawBytes:
            geometry.source === 'full-model'
              ? geometry.fullRawBytes
              : geometry.source === 'source-simplified'
                ? geometry.simplifiedRawBytes
                : geometry.lodRawBytes,
        })),
        retained: {
          ...costOf(retained),
          byRetention: Object.fromEntries(
            Object.values(RETENTION).map((kind) => [
              kind,
              costOf(retained.filter((item) => item.geometry.retention === kind)),
            ]),
          ),
        },
        simplified: (() => {
          const list = compatibility.primitives.filter(
            (item) => item.geometry.source === 'source-simplified',
          );
          return {
            primitives: list.length,
            sourceVertices: list.reduce((total, item) => total + item.fullVertices, 0),
            sourceTriangles: sum(list, 'fullTriangles'),
            sourceRawBytes: list.reduce((total, item) => total + item.geometry.fullRawBytes, 0),
            vertices: sum(list, 'startupVertices'),
            triangles: sum(list, 'startupTriangles'),
            rawBytes: list.reduce((total, item) => total + item.geometry.simplifiedRawBytes, 0),
          };
        })(),
        startup: {
          vertices: sum(compatibility.primitives, 'startupVertices'),
          triangles: sum(compatibility.primitives, 'startupTriangles'),
        },
        lodOnly: {
          vertices: compatibility.primitives.reduce((total, item) => total + item.lodVertices, 0),
          triangles: sum(compatibility.primitives, 'lodTriangles'),
        },
      },
      meshNodes: compatibility.pairs.map(({ node, mesh, worldTransformDifference }) => ({
        node,
        mesh,
        worldTransformDifference,
      })),
      skins: [...compatibility.skins.values()].map((skin) => ({
        joints: skin.jointNames.length,
        jointOrder: skin.identity ? 'identical' : 'remapped-by-name',
        remap: skin.identity ? null : skin.remap,
        hierarchy: 'identical parent joints',
        inverseBindDifference: skin.inverseBindDifference,
        inverseBindBottomRowDifference: skin.bottomRowDifference,
        skinnedDisplacementBoundMetres: skin.skinnedDisplacementBound,
        poseBound: skin.pose,
        restPoseDifference: skin.restPoseDifference,
      })),
      primitives: compatibility.primitives,
      shading: {
        rule: 'TANGENT is kept only where the adopted LOD has it; GLTFLoader shades geometry without TANGENT with derivative tangents on a material clone whose normalScale.y is negated, and geometry with TANGENT with the material as authored',
        differsFromExistingLod: compatibility.primitives
          .filter((primitive) => !primitive.shading.sameAsExistingLod)
          .map(({ mesh, primitive, material }) => ({ mesh, primitive, material })),
      },
      clips: (H.animations ?? []).map((animation) => animation.name ?? null),
      removedFullModelAccessors: (H.accessors ?? []).length - highAccessors.length,
      removedFullModelViews: removedViews.length,
      removedFullModelBytes: removedViews.reduce(
        (sum, view) => sum + H.bufferViews[view].byteLength,
        0,
      ),
      lodAccessors: added.length,
      triangles: { full: triangleCount(H), lod: triangleCount(L), startup: triangleCount(json) },
    },
  };
}
