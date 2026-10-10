// Source-derived startup geometry: a deterministic, index-only reduction of an ORIGINAL full-model
// primitive with the pinned meshoptimizer 1.1.1 MeshoptSimplifier.simplifyWithAttributes, then
// compactMesh. Every surviving vertex is an unchanged source vertex: the caller copies its bytes
// (positions, normals, UVs, tangents, joints, weights) exactly; nothing is interpolated,
// quantised or dropped. Not used: simplifySloppy, the Permissive and Prune flags, and
// simplifyWithUpdate (vertex-position update).
//
// Attributes guide the error metric only: vertex normals, every TEXCOORD_n and one column per
// bone holding that bone's skin weight. Joint indices are categorical and never used as values.
// The simplifier compares attribute values in its extent-normalised space (ErrorAbsolute only
// rescales the error limit), so each weight is derived from a tolerance stated in metres: an
// attribute change of `tolerances[kind]` costs as much as `targetErrorMetres` of position error.
import { MeshoptSimplifier } from 'meshoptimizer';
import { COMPONENT_BYTES, accessorElements, sha256 } from './glb.mjs';

let ready = false;
const readiness = MeshoptSimplifier.ready.then(() => {
  ready = true;
});
/** Await once before deriving startup geometry (the simplifier is WebAssembly). */
export const prepareSourceSimplifier = () => readiness;

export const SOURCE_SIMPLIFY = Object.freeze({
  method: 'meshoptimizer 1.1.1 MeshoptSimplifier.simplifyWithAttributes (index-only), then compactMesh',
  // LockBorder keeps topological borders (openings, cut edges) exactly; ErrorAbsolute states the
  // limit in metres. Regularize is not used: the 1.1.1 documentation only says it costs geometric
  // quality, not how its term relates to the error limit. Skinning is protected by the per-bone
  // weight columns and locks instead.
  flags: Object.freeze(['LockBorder', 'ErrorAbsolute']),
  targetRatio: 0.5,
  targetErrorMetres: 0.0015,
  tolerances: Object.freeze({ normal: 0.02, uv: 1 / 2048, skinWeight: 0.02 }),
  maxAttributes: 32,
  // Less reduction than this is not worth a re-encoded primitive: the original is kept instead.
  minimumReduction: 0.01,
});
const SUPPORTED = /^(POSITION|NORMAL|TANGENT|TEXCOORD_\d+|JOINTS_0|WEIGHTS_0)$/;
const UNUSED = 0xffffffff;

const floatsOf = (doc, views, accessor) => {
  const bytes = accessorElements(doc.json, views, accessor);
  return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
};

function integersOf(doc, views, accessor) {
  const bytes = accessorElements(doc.json, views, accessor),
    size = COMPONENT_BYTES[doc.json.accessors[accessor].componentType],
    values = new Uint32Array(bytes.length / size);
  for (let i = 0; i < values.length; i++)
    values[i] = size === 1 ? bytes[i] : size === 2 ? bytes.readUInt16LE(2 * i) : bytes.readUInt32LE(4 * i);
  return values;
}

function weightsOf(doc, views, accessor) {
  const info = doc.json.accessors[accessor];
  if (info.componentType === 5126) return floatsOf(doc, views, accessor);
  const scale = { 5121: 255, 5123: 65535 }[info.componentType];
  return Float32Array.from(integersOf(doc, views, accessor), (value) => value / scale);
}

export const uint32Sha256 = (values) => sha256(Buffer.from(Uint32Array.from(values).buffer));

/** Share of triangles whose face normal points against the mean of their vertex normals. */
function faceNormalDisagreement(positions, normals, triangles, vertexOf) {
  if (!normals || !triangles.length) return null;
  let against = 0;
  for (let t = 0; t < triangles.length; t += 3) {
    const [a, b, c] = [vertexOf(triangles[t]), vertexOf(triangles[t + 1]), vertexOf(triangles[t + 2])],
      p = (v, k) => positions[3 * v + k],
      e1 = [0, 1, 2].map((k) => p(b, k) - p(a, k)),
      e2 = [0, 1, 2].map((k) => p(c, k) - p(a, k)),
      face = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]],
      mean = [0, 1, 2].map((k) => normals[3 * a + k] + normals[3 * b + k] + normals[3 * c + k]);
    if (face[0] * mean[0] + face[1] * mean[1] + face[2] * mean[2] < 0) against++;
  }
  return against / (triangles.length / 3);
}

/**
 * Reduce one full-model primitive. `lockedPositions` holds exact position keys ("x,y,z") shared
 * with the mesh's other primitives (seams with retained heads, accents, the body); those vertices
 * are locked. `jointNames` names the skin joints for the record. `maxAttributes` may only be
 * lowered (tests); production uses SOURCE_SIMPLIFY.
 */
export function simplifySourcePrimitive({ doc, views, primitive, lockedPositions, jointNames = [], maxAttributes = SOURCE_SIMPLIFY.maxAttributes }) {
  if (!ready) throw new Error('await prepareSourceSimplifier() before deriving startup geometry');
  const json = doc.json,
    keys = Object.keys(primitive.attributes),
    unsupported =
      (primitive.mode ?? 4) !== 4
        ? 'not a triangle list'
        : primitive.indices === undefined
          ? 'not indexed'
          : primitive.targets?.length
            ? 'has morph targets'
            : keys.find((key) => !SUPPORTED.test(key))
              ? `attribute ${keys.find((key) => !SUPPORTED.test(key))}`
              : keys.find((key) => /^(POSITION|NORMAL|TEXCOORD_\d+)$/.test(key) && json.accessors[primitive.attributes[key]].componentType !== 5126)
                ? 'non-float position, normal or UV data'
                : null;
  if (unsupported) return { supported: false, reason: unsupported };
  const positions = floatsOf(doc, views, primitive.attributes.POSITION),
    count = positions.length / 3,
    indices = integersOf(doc, views, primitive.indices),
    normals = primitive.attributes.NORMAL === undefined ? null : floatsOf(doc, views, primitive.attributes.NORMAL),
    uvKeys = keys.filter((key) => /^TEXCOORD_\d+$/.test(key)).sort(),
    uvs = uvKeys.map((key) => floatsOf(doc, views, primitive.attributes[key])),
    fixedColumns = (normals ? 3 : 0) + 2 * uvKeys.length;
  if (fixedColumns > maxAttributes) return { supported: false, reason: `${fixedColumns} normal/UV columns exceed ${maxAttributes}` };
  // Skin: one column per bone, holding the vertex's normalised weight on it.
  const skinned = primitive.attributes.JOINTS_0 !== undefined && primitive.attributes.WEIGHTS_0 !== undefined,
    joints = skinned ? integersOf(doc, views, primitive.attributes.JOINTS_0) : null,
    weights = skinned ? weightsOf(doc, views, primitive.attributes.WEIGHTS_0) : null,
    totals = new Map();
  if (skinned)
    for (let v = 0; v < count; v++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += weights[4 * v + k];
      for (let k = 0; k < 4; k++)
        if (weights[4 * v + k] > 0 && sum > 0) totals.set(joints[4 * v + k], (totals.get(joints[4 * v + k]) ?? 0) + weights[4 * v + k] / sum);
    }
  const budget = maxAttributes - fixedColumns,
    chosen = [...totals.entries()]
      .sort((a, b) => b[1] - a[1] || a[0] - b[0])
      .slice(0, budget)
      .map(([joint]) => joint)
      .sort((a, b) => a - b),
    column = new Map(chosen.map((joint, i) => [joint, fixedColumns + i])),
    stride = fixedColumns + chosen.length,
    attributes = new Float32Array(Math.max(1, stride) * count),
    lock = new Uint8Array(count);
  let crossPrimitive = 0,
    jointBudget = 0;
  for (let v = 0; v < count; v++) {
    const row = v * stride;
    if (normals) attributes.set(normals.subarray(3 * v, 3 * v + 3), row);
    uvs.forEach((values, i) => attributes.set(values.subarray(2 * v, 2 * v + 2), row + (normals ? 3 : 0) + 2 * i));
    if (skinned) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += weights[4 * v + k];
      for (let k = 0; k < 4; k++) {
        const w = weights[4 * v + k];
        if (!(w > 0) || !(sum > 0)) continue;
        if (column.has(joints[4 * v + k])) attributes[row + column.get(joints[4 * v + k])] += w / sum;
        else if (!lock[v]) {
          lock[v] = 1;
          jointBudget++;
        }
      }
    }
    if (lockedPositions.has(`${positions[3 * v]},${positions[3 * v + 1]},${positions[3 * v + 2]}`) && !lock[v]) {
      lock[v] = 1;
      crossPrimitive++;
    }
  }
  const scale = MeshoptSimplifier.getScale(positions, 3),
    normalised = SOURCE_SIMPLIFY.targetErrorMetres / scale,
    attributeWeights = {
      normal: normalised / SOURCE_SIMPLIFY.tolerances.normal,
      uv: normalised / SOURCE_SIMPLIFY.tolerances.uv,
      skinWeight: normalised / SOURCE_SIMPLIFY.tolerances.skinWeight,
    },
    weightList = [
      ...(normals ? [attributeWeights.normal, attributeWeights.normal, attributeWeights.normal] : []),
      ...uvKeys.flatMap(() => [attributeWeights.uv, attributeWeights.uv]),
      ...chosen.map(() => attributeWeights.skinWeight),
    ],
    targetIndexCount = Math.floor((indices.length * SOURCE_SIMPLIFY.targetRatio) / 3) * 3,
    [result, error] = MeshoptSimplifier.simplifyWithAttributes(
      Uint32Array.from(indices),
      Float32Array.from(positions),
      3,
      stride ? attributes : new Float32Array(0),
      stride,
      weightList,
      lock,
      targetIndexCount,
      SOURCE_SIMPLIFY.targetErrorMetres,
      [...SOURCE_SIMPLIFY.flags],
    ),
    record = {
      method: SOURCE_SIMPLIFY.method,
      flags: [...SOURCE_SIMPLIFY.flags],
      targetRatio: SOURCE_SIMPLIFY.targetRatio,
      targetIndexCount,
      targetErrorMetres: SOURCE_SIMPLIFY.targetErrorMetres,
      scaleMetres: scale,
      attributeColumns: [
        ...(normals ? ['NORMAL.x', 'NORMAL.y', 'NORMAL.z'] : []),
        ...uvKeys.flatMap((key) => [`${key}.u`, `${key}.v`]),
        ...chosen.map((joint) => `weight:${jointNames[joint] ?? `joint ${joint}`}`),
      ],
      tolerances: { ...SOURCE_SIMPLIFY.tolerances },
      attributeWeights,
      locks: {
        border: 'LockBorder: every topological border vertex (openings, cut edges)',
        crossPrimitivePositions: crossPrimitive,
        jointBudget,
      },
      lockedVertices: crossPrimitive + jointBudget,
      sourceTriangles: indices.length / 3,
      sourceVertexCount: count,
      achievedTriangles: result.length / 3,
      reachedTarget: result.length <= targetIndexCount,
      // The simplifier's own approximate error (metres, attributes included); not a proof of the
      // deformed surface or texture quality.
      resultErrorMetres: error,
    };
  if (!Number.isFinite(error)) throw new Error('the simplifier returned a non-finite error');
  if (result.length > indices.length * (1 - SOURCE_SIMPLIFY.minimumReduction))
    return { supported: true, reduced: false, record: { ...record, achievedVertices: count } };
  const compacted = Uint32Array.from(result),
    [remap, unique] = MeshoptSimplifier.compactMesh(compacted),
    sourceVertices = new Uint32Array(unique);
  for (let old = 0; old < remap.length; old++) if (remap[old] !== UNUSED) sourceVertices[remap[old]] = old;
  for (let t = 0; t < compacted.length; t += 3) {
    const [a, b, c] = [compacted[t], compacted[t + 1], compacted[t + 2]];
    if (a === b || b === c || a === c || a >= unique || b >= unique || c >= unique)
      throw new Error(`simplified triangle ${t / 3} is degenerate or out of range`);
  }
  let lockedKept = 0;
  const kept = new Set(sourceVertices);
  for (let v = 0; v < count; v++) if (lock[v] && kept.has(v)) lockedKept++;
  return {
    supported: true,
    reduced: true,
    indices: compacted,
    sourceVertices,
    record: {
      ...record,
      achievedVertices: unique,
      lockedVerticesKept: lockedKept,
      faceNormalDisagreement: {
        source: faceNormalDisagreement(positions, normals, indices, (v) => v),
        simplified: faceNormalDisagreement(positions, normals, compacted, (v) => sourceVertices[v]),
      },
      sourceVertexSha256: uint32Sha256(sourceVertices),
      indexSha256: uint32Sha256(compacted),
      // New vertex i is source vertex sourceVertexIndices[i] (for verification and browser QA).
      sourceVertexIndices: Array.from(sourceVertices),
    },
  };
}
