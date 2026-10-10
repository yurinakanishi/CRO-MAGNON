// Independent checks of a candidate against its source, from the decoded documents alone.
// PROMOTED unchanged in algorithm from the reviewed output-only proof
// (output/optimization-audit-20261009/lowpoly-high-tools-r04/checks.mjs):
//   - correspondence: every candidate vertex element equals its source vertex element byte for byte;
//   - preservation: nodes, skins, inverse binds, clips (bytes), materials, textures, images (bytes),
//     scenes and extensions are the source's (strict comparison in preservation.mjs);
//   - topology, by identity (structure.mjs), seam positions, protected triangles, component area.
// Each check returns a list of problems (empty = passed).
import { accessorElements, jsonDifference } from '../glb.mjs';
import { defectCounts, describeEdges, sourceStructure, structuralDefects } from './structure.mjs';
import { faceNormalDisagreement, triangleArea, triangleKey } from './topology.mjs';

export const floatsOf = (json, views, accessor) => {
  const bytes = accessorElements(json, views, accessor);
  return new Float32Array(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  );
};

export function indicesOf(json, views, accessor) {
  const bytes = accessorElements(json, views, accessor),
    size = { 5121: 1, 5123: 2, 5125: 4 }[json.accessors[accessor].componentType],
    out = new Uint32Array(bytes.length / size);
  for (let i = 0; i < out.length; i++)
    out[i] =
      size === 1 ? bytes[i] : size === 2 ? bytes.readUInt16LE(2 * i) : bytes.readUInt32LE(4 * i);
  return out;
}

/** Every attribute of candidate primitive = source attribute at sourceVertices; indices in range, none degenerate. */
export function correspondenceProblems(source, candidate, mesh, primitive, sourceVertices) {
  const problems = [],
    a = source.json.meshes[mesh].primitives[primitive],
    b = candidate.json.meshes[mesh].primitives[primitive],
    where = `mesh ${mesh} primitive ${primitive}`;
  if (jsonDifference(Object.keys(a.attributes).sort(), Object.keys(b.attributes).sort()))
    return [`${where}: the attribute set changed`];
  for (const key of ['material', 'mode', 'extras', 'extensions'])
    if (jsonDifference(a[key], b[key])) problems.push(`${where}: ${key} changed`);
  for (const [name, accessor] of Object.entries(a.attributes)) {
    const sa = source.json.accessors[accessor],
      sb = candidate.json.accessors[b.attributes[name]];
    for (const key of ['componentType', 'type', 'normalized'])
      if ((sa[key] ?? null) !== (sb[key] ?? null))
        problems.push(`${where} ${name}: ${key} changed`);
    if (sb.count !== sourceVertices.length) {
      problems.push(
        `${where} ${name}: ${sb.count} elements for ${sourceVertices.length} mapped vertices`,
      );
      continue;
    }
    const before = accessorElements(source.json, source.views, accessor),
      after = accessorElements(candidate.json, candidate.views, b.attributes[name]),
      size = before.length / sa.count;
    let wrong = 0;
    for (let i = 0; i < sourceVertices.length; i++) {
      const s = sourceVertices[i];
      if (
        s >= sa.count ||
        !after.subarray(i * size, (i + 1) * size).equals(before.subarray(s * size, (s + 1) * size))
      )
        wrong++;
    }
    if (wrong)
      problems.push(
        `${where} ${name}: ${wrong} vertex element(s) are not their source vertex's bytes`,
      );
  }
  const indices = indicesOf(candidate.json, candidate.views, b.indices);
  if (indices.length % 3)
    problems.push(`${where}: index count ${indices.length} is not a triangle list`);
  let degenerate = 0;
  for (let t = 0; t < indices.length; t += 3) {
    const [x, y, z] = [indices[t], indices[t + 1], indices[t + 2]];
    if (x >= sourceVertices.length || y >= sourceVertices.length || z >= sourceVertices.length)
      return [...problems, `${where}: an index is out of range`];
    if (x === y || y === z || x === z) degenerate++;
  }
  if (degenerate) problems.push(`${where}: ${degenerate} degenerate triangle(s)`);
  return problems;
}

// Codex independent review closes retained-material, accessor and metadata gaps.
export { preservationProblems } from './preservation.mjs';

/**
 * Topology and protection of one reduced primitive. `sourceVertices` maps candidate vertices to
 * source vertices; `protectedVertices` (Uint8Array over source vertices, or null) must keep every
 * source triangle all of whose vertices are protected; `sharedKeys` are cross-primitive seam positions.
 */
export function topologyReport({
  source,
  candidate,
  mesh,
  primitive,
  sourceVertices,
  protectedVertices,
  sharedKeys,
  borderLocked,
  componentAreaRatio,
}) {
  const a = source.json.meshes[mesh].primitives[primitive],
    b = candidate.json.meshes[mesh].primitives[primitive],
    positions = floatsOf(source.json, source.views, a.attributes.POSITION),
    normals =
      a.attributes.NORMAL === undefined
        ? null
        : floatsOf(source.json, source.views, a.attributes.NORMAL),
    sourceIndices = indicesOf(source.json, source.views, a.indices),
    mapped = Uint32Array.from(
      indicesOf(candidate.json, candidate.views, b.indices),
      (i) => sourceVertices[i],
    ),
    structure = sourceStructure(positions, normals, sourceIndices),
    { ids } = structure,
    before = structure.stats,
    defects = structuralDefects(structure, mapped),
    after = defects.candidate,
    problems = [];
  if (defects.newNonmanifold.length)
    problems.push(
      `${defects.newNonmanifold.length} non-manifold edge(s) absent from the source (source ${before.nonmanifold}, candidate ${after.nonmanifold})`,
    );
  if (defects.newInconsistent.length)
    problems.push(
      `${defects.newInconsistent.length} incoherently wound edge(s) absent from the source (source ${before.inconsistent}, candidate ${after.inconsistent})`,
    );
  if (defects.newBorder.length)
    problems.push(`${defects.newBorder.length} new open-border edge(s) (cracks)`);
  if (borderLocked && defects.lostBorder.length)
    problems.push(
      `${defects.lostBorder.length} source border edge(s) changed although borders are locked`,
    );
  if (defects.newDegenerate.length)
    problems.push(
      `${defects.newDegenerate.length} new welded or geometrically degenerate triangle(s)`,
    );
  if (defects.newFlipped.length)
    problems.push(
      `${defects.newFlipped.length} new triangle(s) facing against their vertex normals`,
    );
  if (defects.merged)
    problems.push(`${defects.merged} candidate component(s) join source components`);
  if (defects.split) problems.push(`${defects.split} source component(s) split into several`);
  if (defects.vanished) problems.push(`${defects.vanished} source component(s) vanished`);
  const bits = new Uint32Array(positions.buffer, positions.byteOffset, positions.length),
    kept = new Set(sourceVertices),
    keyOf = (v) => `${bits[3 * v]},${bits[3 * v + 1]},${bits[3 * v + 2]}`,
    keptKeys = new Set([...kept].map(keyOf));
  let seamLost = 0;
  for (let v = 0; v < positions.length / 3; v++)
    if (sharedKeys.has(keyOf(v)) && !keptKeys.has(keyOf(v))) seamLost++;
  if (seamLost) problems.push(`${seamLost} cross-primitive seam vertex position(s) lost`);
  const candidateTriangles = new Set();
  for (let t = 0; t < mapped.length; t += 3)
    candidateTriangles.add(triangleKey(mapped[t], mapped[t + 1], mapped[t + 2]));
  let protectedTriangles = 0,
    protectedLost = 0;
  if (protectedVertices)
    for (let t = 0; t < sourceIndices.length; t += 3) {
      const [x, y, z] = [sourceIndices[t], sourceIndices[t + 1], sourceIndices[t + 2]];
      if (!protectedVertices[x] || !protectedVertices[y] || !protectedVertices[z]) continue;
      protectedTriangles++;
      if (!candidateTriangles.has(triangleKey(x, y, z))) protectedLost++;
    }
  if (protectedLost)
    problems.push(`${protectedLost} of ${protectedTriangles} fully protected triangle(s) changed`);
  const { componentOfPosition } = structure.components,
    area = (indices) => {
      const totals = new Map();
      for (let t = 0; t < indices.length; t += 3) {
        const c = componentOfPosition[ids[indices[t]]];
        totals.set(
          c,
          (totals.get(c) ?? 0) +
            triangleArea(positions, indices[t], indices[t + 1], indices[t + 2]),
        );
      }
      return totals;
    },
    areaBefore = area(sourceIndices),
    areaAfter = area(mapped),
    shrunk = [...areaBefore].filter(
      ([c, value]) => value > 0 && (areaAfter.get(c) ?? 0) < componentAreaRatio * value,
    );
  if (shrunk.length)
    problems.push(
      `${shrunk.length} of ${areaBefore.size} connected component(s) lost more than ${Math.round(100 * (1 - componentAreaRatio))}% of their area (thin parts)`,
    );
  return {
    problems,
    source: {
      triangles: before.triangles,
      edges: before.edges,
      border: before.border,
      nonmanifold: before.nonmanifold,
      inconsistent: before.inconsistent,
      degenerate: before.degenerate,
      components: areaBefore.size,
    },
    candidate: after,
    defects: defectCounts(defects),
    newBadEdges: describeEdges(structure, [
      ...defects.newNonmanifold,
      ...defects.newInconsistent,
      ...defects.newBorder,
    ]),
    crossPrimitiveSeamPositionsLost: seamLost,
    protectedTriangles,
    protectedTrianglesLost: protectedLost,
    shrunkComponents: shrunk.length,
    faceNormalDisagreement: {
      source: faceNormalDisagreement(positions, normals, sourceIndices),
      candidate: faceNormalDisagreement(positions, normals, mapped),
    },
  };
}
