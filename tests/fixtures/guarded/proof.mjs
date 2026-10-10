// An r04-shaped proof output for the guarded-surface@1 tests, written into the temp repository: a
// summary bound to a (fixture) implementation, and per key the evidence, the candidate GLB and its
// source-vertex mapping. The candidate is a REAL index-only reduction of the served primary
// (meshoptimizer simplify with LockBorder, compactMesh, exact source vertices), packed with the
// promoted guarded helpers. The evidence has the shape of the real r04 output
// (lowpoly-high-r04-initial/*/evidence.json): per scene its slots, clips, clip tracks and pose
// labels; per instance every pose's holes/interiors/webbing by region with stride-1 sample counts,
// the merged worst statistics and the fixed gate. The posed NUMBERS stand for what the proof engine
// measured (the engine itself is tested beside it); the importer re-derives the rest.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { MeshoptSimplifier } from 'meshoptimizer';
import { sha256 } from '../../../scripts/optimization/glb.mjs';
import { floatsOf, indicesOf } from '../../../scripts/optimization/guarded/checks.mjs';
import { meshCoverage, sceneInstances } from '../../../scripts/optimization/guarded/coverage.mjs';
import {
  collectGarbage,
  decodeDocument,
  gzip6,
  packPlain,
  replacePrimitive,
} from '../../../scripts/optimization/guarded/document.mjs';
import { uint32Sha256, worstOf } from '../../../scripts/optimization/guarded-surface.mjs';
import { file, put, text } from './base.mjs';

export const PROOF_DIR = 'output/proof-fixture';
export const IMPLEMENTATION_FILES = Object.freeze([
  'output/optimization-audit-20261009/proof-lowpoly-high-r04.mjs',
  'output/optimization-audit-20261009/lowpoly-high-tools-r04/proof-core.mjs',
]);
// The real runs' policy (lowpoly-high-r04-initial/summary.json), trimmed of descriptive fields.
export const POLICY = Object.freeze({
  variants: {
    'guarded-body': {
      kind: 'candidate',
      head: 'retain',
      errorMetres: 0.004,
      flags: ['LockBorder', 'ErrorAbsolute'],
      targetRatio: 0.35,
    },
  },
  overrides: {},
  gates: { p99Multiple: 2, maxMultiple: 6, protectedMaxMetres: 0, componentAreaRatio: 0.9 },
  pose: {
    clips: 'all delivered clips',
    fractions: [0.33, 0.66],
    surfaceStride: 1,
    scope: 'sampled poses only, not every frame',
  },
});

/** The served primary of `key` reduced index-only; returns { candidate, sourceVertices, indices }. */
export async function reduceServed(root, record, { ratio = 0.35 } = {}) {
  await MeshoptSimplifier.ready;
  const bytes = await readFile(file(root, `public${record.url}`)),
    source = await decodeDocument(bytes, record.url),
    primitive = source.json.meshes[0].primitives[0],
    positions = floatsOf(source.json, source.views, primitive.attributes.POSITION),
    indices = indicesOf(source.json, source.views, primitive.indices),
    target = Math.floor((indices.length * ratio) / 3) * 3,
    [reduced] = MeshoptSimplifier.simplify(
      Uint32Array.from(indices),
      Float32Array.from(positions),
      3,
      target,
      0.004,
      ['LockBorder', 'ErrorAbsolute'],
    ),
    [remap, unique] = MeshoptSimplifier.compactMesh(Uint32Array.from(reduced)),
    sourceVertices = new Uint32Array(unique);
  for (let old = 0; old < remap.length; old++)
    if (remap[old] !== 0xffffffff) sourceVertices[remap[old]] = old;
  const compacted = Uint32Array.from(reduced, (v) => remap[v]);
  return {
    bytes,
    source,
    candidate: packPlain(
      collectGarbage(replacePrimitive(source, 0, 0, { indices: compacted, sourceVertices })),
      record.url,
    ),
    sourceVertices,
    indices: compacted,
  };
}

// One region's statistics (distances within the 8/24 mm gate).
const stats = (count) => ({ count, max: 0.002, p99: 0.001, mean: 0.0002 });
const side = (count) => ({ all: stats(count), static: stats(count) });

/** The posed record of one instance, as comparePoses writes it, for the given pose labels. */
function instanceRecord(instance, labels, totals) {
  const poses = labels.map((pose) => ({
    pose,
    holes: side(totals.holes),
    interiors: side(totals.interiors),
    webbing: side(totals.webbing),
    shortcuts: { holes: 0, interiors: 0, webbing: 0, enabled: true },
  }));
  return {
    ...instance,
    restWorldMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    transformEqual: true,
    stretch: { max: 1, min: 1 },
    correspondenceMaxMetres: 0,
    poses,
    worst: worstOf(poses),
    gateMetres: { p99: 0.008, max: 0.024, unit: 'world metres, fixed per policy' },
  };
}

/**
 * Write the proof output for `targets` ([{ key, record, candidate?, sourceVertices?, indices? }]),
 * applying `edit(evidence, variant, key)` per key before hashing and `summaryEdit(summary)` before
 * writing. Returns { summaryPath, digest, accept }.
 */
export async function writeProof(
  root,
  targets,
  { dir = PROOF_DIR, edit = () => {}, summaryEdit = () => {} } = {},
) {
  const files = [];
  for (const relative of IMPLEMENTATION_FILES) {
    const bytes = Buffer.from(`// fixture proof implementation ${relative}\n`);
    await put(root, relative, bytes);
    files.push({ file: relative, sha256: sha256(bytes), bytes: bytes.length });
  }
  const digest = sha256(
      Buffer.from(files.map((item) => `${item.sha256}  ${item.file}`).join('\n')),
    ),
    keys = [],
    accept = {};
  for (const target of targets) {
    const reduction = target.candidate
        ? target
        : { ...target, ...(await reduceServed(root, target.record)) },
      source =
        reduction.source ??
        (await decodeDocument(
          await readFile(file(root, `public${target.record.url}`)),
          target.record.url,
        )),
      sourceBytes = reduction.bytes ?? (await readFile(file(root, `public${target.record.url}`))),
      candidate = reduction.candidate,
      json = source.json,
      mapping = Buffer.from(Uint32Array.from(reduction.sourceVertices).buffer),
      coverage = meshCoverage(json),
      { scenes } = sceneInstances(json),
      candidateTriangles = reduction.indices.length / 3,
      primitive = json.meshes[0].primitives[0],
      sourceTriangles = json.accessors[primitive.indices].count / 3,
      totals = {
        holes: json.accessors[primitive.attributes.POSITION].count,
        interiors: sourceTriangles,
        webbing: 4 * candidateTriangles,
      },
      // The fixtures have one scene whose nodes every clip animates.
      clips = (json.animations ?? []).map((animation, c) => animation.name || `animation_${c}`),
      labels = ['rest', ...clips.flatMap((name) => [`${name}@0.33`, `${name}@0.66`])],
      alternative = {
        label: 'source/plain',
        order: 'source',
        storage: 'plain',
        rawBytes: candidate.length,
        gzip6Bytes: gzip6(candidate),
        sha256: sha256(candidate),
        indexSha256: [uint32Sha256(reduction.indices)],
        withinRawBudget: candidate.length <= sourceBytes.length,
        belowSourceGzip: gzip6(candidate) < gzip6(sourceBytes),
      },
      variant = {
        variant: 'guarded-body',
        kind: 'candidate',
        description: 'fixture',
        custom: null,
        primitives: [
          {
            mesh: 0,
            primitive: 0,
            instances: coverage[0].instances.length,
            mode: 'reduce',
            settings: {
              flags: ['LockBorder', 'ErrorAbsolute'],
              targetRatio: 0.35,
              errorMetres: 0.004,
              localErrorMetres: 0.004,
              maxInstanceStretch: 1,
              worldGateMetres: { p99: 0.008, max: 0.024 },
            },
            locks: { lockedVertices: 0, border: 'LockBorder flag: every open-border vertex' },
            action: 'reduced',
            sourceTriangles,
            achievedTriangles: candidateTriangles,
          },
        ],
        status: 'proof-pass-not-visually-reviewed',
        problems: [],
        proof: { structuralAndPosed: 'passed', posesChecked: true },
        storage: {
          budget: { rawBytes: sourceBytes.length, gzip6Bytes: gzip6(sourceBytes) },
          chosen: 'source/plain',
          verifiedOption: 'source/plain',
          reason: 'fixture',
          alternatives: [alternative],
        },
        candidate: {
          rawBytes: candidate.length,
          gzip6Bytes: gzip6(candidate),
          sha256: sha256(candidate),
        },
        topology: [
          {
            mesh: 0,
            primitive: 0,
            problems: [],
            protectedTrianglesLost: 0,
            candidate: { triangles: candidateTriangles },
          },
        ],
        poses: {
          scenes: scenes.map((scene) => ({
            scene: scene.scene,
            instances: scene.instances.length,
            primitiveInstances: scene.instances.length,
            comparedPrimitiveInstances: scene.instances.filter((instance) => instance.mesh === 0)
              .length,
            slotIdentity: `${scene.instances.length} of ${scene.instances.length} slot(s) identified by exact positions and indices`,
            clips,
            clipTracks: clips.map((clip, c) => ({
              clip,
              applicableChannels: json.animations[c].channels.length,
              appliedTracksSource: json.animations[c].channels.length,
              appliedTracksCandidate: json.animations[c].channels.length,
            })),
            clipsNotAnimatingThisScene: [],
            clipsBeyondMaxClips: [],
            poses: labels,
          })),
          scope:
            "rest plus every clip that animates a scene's nodes (fractions 0.33, 0.66); sampled poses, not every frame",
          primitives: [
            {
              mesh: 0,
              primitive: 0,
              instances: coverage[0].instances.map((instance) =>
                instanceRecord(instance, labels, totals),
              ),
            },
          ],
        },
        file: {
          file: `${target.key}/guarded-body.glb`,
          sha256: sha256(candidate),
          bytes: candidate.length,
        },
        mappingFiles: [
          {
            mesh: 0,
            primitive: 0,
            meaning: 'candidate vertex i is served-file vertex u32le[i] of this primitive',
            file: `${target.key}/guarded-body.m0p0.source-vertices.u32le`,
            sha256: sha256(mapping),
            bytes: mapping.length,
          },
        ],
      },
      evidence = {
        key: target.key,
        served: {
          url: target.record.url,
          sha256: target.record.sha256,
          bytes: target.record.bytes,
        },
        levels: { processed: 'primary file only', lods: [], packedScene: null, oldLodsUsed: false },
        coupling: null,
        variants: [variant],
        implementation: digest,
      };
    edit(evidence, variant, target.key);
    await put(root, `${dir}/${target.key}/guarded-body.glb`, candidate);
    await put(root, `${dir}/${target.key}/guarded-body.m0p0.source-vertices.u32le`, mapping);
    const evidenceBytes = Buffer.from(text(evidence));
    await put(root, `${dir}/${target.key}/evidence.json`, evidenceBytes);
    keys.push({
      key: target.key,
      coupling: evidence.coupling,
      served: { ...evidence.served, triangles: target.record.triangles ?? null },
      variants: [{ variant: variant.variant, status: variant.status, file: variant.file }],
      evidence: {
        file: `${target.key}/evidence.json`,
        sha256: sha256(evidenceBytes),
        bytes: evidenceBytes.length,
      },
    });
    accept[target.key] = sha256(candidate);
  }
  const summary = {
    schema: 'cro-magnon/lowpoly-proof@1',
    tool: 'proof-lowpoly-high-r04',
    status: 'output-only proof; nothing adopted, no manifest or public file written',
    implementation: { digest, files },
    policy: structuredClone(POLICY),
    keys,
    implementationAfterRun: { digest, changedDuringRun: false, changedFiles: [] },
  };
  summaryEdit(summary);
  await put(root, `${dir}/summary.json`, text(summary));
  return { summaryPath: `${dir}/summary.json`, digest, accept };
}

export const proofPath = (root, ...parts) => path.join(root, ...PROOF_DIR.split('/'), ...parts);
