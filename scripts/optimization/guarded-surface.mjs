// guarded-surface@1: a partial candidate revision that replaces the CURRENT PRIMARY file of
// explicitly listed models with an independently proven, reviewed index-only reduction of that
// very file. The geometry is NOT lossless: fewer triangles over the exact surviving source
// vertices. Everything else (every surviving vertex attribute byte, nodes, skins, inverse binds,
// clips, materials, embedded images, untouched primitives) is the served file's.
//
// Inputs, all explicit; there are no defaults:
//   - the applied base adoption (served files are the sources) and its plan SHA-256;
//   - one or more COMPLETE proof summaries of the output-only proof engine (proof-lowpoly-high-r04),
//     all of the one expected implementation digest and one identical strict policy, covering
//     disjoint keys; and per key the reviewed candidate's SHA-256. Each summary is archived byte
//     for byte in the revision (never merged or rewritten).
// The proof's expensive posed results are taken from its evidence, bound by hashes to the exact
// candidate, and fail closed: every scene, instance, pose label, clip, applicable channel count
// (derived from the source document), slot total and measurement is checked against the source
// and re-gated at the fixed world gate. Everything cheap is re-derived from the actual bytes:
// mapping validity, decoded attribute identity, preservation, identity-based topology, index
// digests and the raw/gzip budget. The same summary policy check runs at generation and on the
// archived copies (only the availability of the engine's own files is waived once archived).
// Writes only a NEW revision folder. Adoption is separate (guarded-adoption.mjs).
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { checkModelUrl } from '../runtime-graph.mjs';
import { LOD_REJECTIONS, SELECTION } from './adoption.mjs';
import {
  CANDIDATE_STATUS,
  GUARDED_RECIPE,
  MANIFEST_SCHEMA,
  MESHOPTIMIZER_VERSION,
  runtimeIndexOf,
} from './contract.mjs';
import { MESHOPT, jsonDifference, parseGlb, sha256 } from './glb.mjs';
import {
  correspondenceProblems,
  floatsOf,
  indicesOf,
  preservationProblems,
  topologyReport,
} from './guarded/checks.mjs';
import { clipsOfScenes, meshCoverage, sceneInstances } from './guarded/coverage.mjs';
import {
  checkProofExtensions,
  decodeDocument,
  geometryCounts,
  gzip6,
} from './guarded/document.mjs';
import { candidateLocation, resolveCandidateFile, resolveRevisionDirectory } from './paths.mjs';
import { readServedBase } from './served-base.mjs';

export const GUARDED_ROLE = 'guarded-primary';
export const PROOF = Object.freeze({
  schema: 'cro-magnon/lowpoly-proof@1',
  tool: 'proof-lowpoly-high-r04',
  variant: 'guarded-body',
  status: 'proof-pass-not-visually-reviewed',
  errorMetres: 0.004,
  flags: Object.freeze(['LockBorder', 'ErrorAbsolute']),
  gates: Object.freeze({
    p99Multiple: 2,
    maxMultiple: 6,
    protectedMaxMetres: 0,
    componentAreaRatio: 0.9,
  }),
  fractions: Object.freeze([0.33, 0.66]),
});
// The fixed world gate in metres (8 mm p99, 24 mm max at the 4 mm bound); never scaled.
const GATE = Object.freeze({
  p99: PROOF.gates.p99Multiple * PROOF.errorMetres,
  max: PROOF.gates.maxMultiple * PROOF.errorMetres,
});
const SIDES = Object.freeze(['holes', 'interiors', 'webbing']);
// Never in this recipe: collision-, footprint- or fit-coupled templates (camp-landform, castle,
// landmark bounds, geometry-derived region features, mandatory floors and water), and the
// biome grounds the proof's report-only list missed. Matching names are refused too.
export const COUPLED_KEYS = Object.freeze([
  'camp-cave',
  'camp-mountain',
  'valley-castle',
  'glacier-spires',
  'volcanic-cone',
  'desert-cactus',
  'volcanic-basalt-columns',
  'meadow-ground',
  'snow-ground',
  'desert-ground',
  'ice-ground',
  'volcanic-ground',
  'river-water',
]);
const COUPLED_NAME = /ground|floor|mountain|cave|castle|landmark|water|river|lake|terrain/;
const REVISION_REPORT = 'verification.json';
const VERIFICATION_SCHEMA = 'cro-magnon/optimized-runtime-verification@1';
const fail = (message) => {
  throw new Error(message);
};
const identity = (record) => ({ url: record?.url, sha256: record?.sha256, bytes: record?.bytes });
const sameFile = (a, b) => a?.url === b?.url && a?.sha256 === b?.sha256 && a?.bytes === b?.bytes;
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const plainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const measured = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const counted = (value) => Number.isSafeInteger(value) && value >= 0;
const isSha256 = (value) => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const slotOf = (item) => `${item?.mesh}/${item?.primitive}`;
export const uint32Sha256 = (values) => sha256(Buffer.from(Uint32Array.from(values).buffer));
export const implementationDigest = (files) =>
  sha256(Buffer.from(files.map((item) => `${item.sha256}  ${item.file}`).join('\n')));
// The archived copy of the n-th summary (1-based). A model key never contains '.', so it never
// collides with proof/<key>/.
const summaryFile = (index) => `proof/summary-${index + 1}.json`;
// Clip names as Three r185's GLTFLoader gives them (the proof posed and labelled Three's clips).
const threeClipName = (json, c) =>
  json.animations[c].name ? json.animations[c].name : `animation_${c}`;

/** A relative path under `directory`, refusing anything that could leave it. */
function inside(directory, relative, what) {
  if (
    typeof relative !== 'string' ||
    !relative ||
    path.isAbsolute(relative) ||
    relative.split(/[\\/]/).some((part) => part === '..' || part === '')
  )
    fail(`${what}: unsafe path ${JSON.stringify(relative)}`);
  return path.join(directory, ...relative.split('/'));
}

async function readExact(file, expected, what) {
  const bytes = await readFile(file);
  if (bytes.length !== expected?.bytes || sha256(bytes) !== expected?.sha256)
    fail(
      `${what}: ${bytes.length} bytes, SHA-256 ${sha256(bytes)}; recorded ${expected?.bytes}, ${expected?.sha256}`,
    );
  return bytes;
}

/** The scope: the explicit keys, each an ordinary or startup entry of the base whose primary can be replaced alone. */
export function guardedTargets(base, keys) {
  if (!Array.isArray(keys) || !keys.length)
    fail(
      'guarded-surface@1 needs an explicit, non-empty list of model keys; there is no default scope',
    );
  if (new Set(keys).size !== keys.length) fail('a model key is listed twice');
  return keys.map((key) => {
    if (typeof key !== 'string' || !/^[a-z0-9-]+$/.test(key))
      fail(`unsafe model key ${JSON.stringify(key)}`);
    if (COUPLED_KEYS.includes(key) || COUPLED_NAME.test(key))
      fail(
        `${key} is collision-, footprint- or fit-coupled geometry; guarded-surface@1 never replaces it`,
      );
    const entry = Object.hasOwn(base.graph.models, key) ? base.graph.models[key] : null;
    if (!entry) fail(`${key} is not a model of base adoption ${base.id}`);
    if (
      Object.hasOwn(LOD_REJECTIONS, key) ||
      entry.selection === SELECTION.full ||
      entry.lodRejection
    )
      fail(
        `${key} is ${entry.selection} with a reviewed LOD rejection; it is not supported in this iteration`,
      );
    if (entry.selection !== SELECTION.ordinary && entry.selection !== SELECTION.startup)
      fail(`${key} is ${entry.selection}; only ordinary and startup primaries are supported`);
    if ([entry.primary, ...entry.lods].some((record) => record.scene !== undefined))
      fail(
        `${key} is a packed template (its primary shares a file with LOD scenes); not supported`,
      );
    const model = base.current.models.find((item) => item.modelKey === key);
    if (!model?.eligible) fail(`${key} is not an eligible model of the current manifests`);
    const users = [
      ...new Set(
        (base.current.files.get(entry.primary.url)?.uses ?? []).map((use) => use.modelKey),
      ),
    ];
    if (users.length !== 1 || users[0] !== key)
      fail(
        `${entry.primary.url} is delivered by ${users.join(', ') || 'no current manifest'}, not only ${key}`,
      );
    return { key, entry, startup: entry.selection === SELECTION.startup };
  });
}

/**
 * The problems of ONE complete proof summary under the fixed policy. The same function judges a
 * summary at generation and its archived copy at verification:
 *   - schema and tool; a valid run status;
 *   - the implementation: its file list complete, its digest re-derived and equal to `expected`,
 *     the after-run digest equal and changedDuringRun false with no changed file;
 *   - the policy: only the guarded-body variant (kind candidate, head retained, 4 mm, LockBorder
 *     and ErrorAbsolute), no override, the fixed gates, every delivered clip at 0.33/0.66, stride 1;
 *   - its keys: listed once each.
 */
export function summaryProblems(summary, expected) {
  if (!plainObject(summary)) return ['is not a proof summary object'];
  const problems = [],
    { implementation, policy } = summary,
    files = implementation?.files;
  if (summary.schema !== PROOF.schema || summary.tool !== PROOF.tool)
    problems.push(
      `is ${summary.tool ?? 'no'} ${summary.schema ?? ''} output, not ${PROOF.tool} ${PROOF.schema}`,
    );
  if (typeof summary.status !== 'string' || summary.status.startsWith('INVALID'))
    problems.push(`the proof run is ${summary.status}`);
  if (
    !Array.isArray(files) ||
    !files.length ||
    files.some(
      (item) => typeof item?.file !== 'string' || !isSha256(item.sha256) || !counted(item.bytes),
    )
  )
    problems.push('records no complete implementation file list');
  else {
    const digest = implementationDigest(files);
    if (digest !== implementation.digest || digest !== expected)
      problems.push(
        `implementation ${implementation.digest} (re-derived ${digest}) is not the expected ${expected}`,
      );
  }
  const after = summary.implementationAfterRun;
  if (
    !plainObject(after) ||
    after.digest !== expected ||
    after.changedDuringRun !== false ||
    !Array.isArray(after.changedFiles) ||
    after.changedFiles.length
  )
    problems.push(
      'the implementation changed during the proof run (or its after-run identity is not the expected one)',
    );
  const variant = policy?.variants?.[PROOF.variant];
  if (
    !plainObject(policy) ||
    jsonDifference(Object.keys(policy.variants ?? {}), [PROOF.variant]) ||
    variant?.kind !== 'candidate' ||
    variant.head !== 'retain' ||
    variant.errorMetres !== PROOF.errorMetres ||
    jsonDifference(variant.flags, [...PROOF.flags]) ||
    !plainObject(policy.overrides) ||
    Object.keys(policy.overrides).length ||
    jsonDifference(policy.gates, { ...PROOF.gates }) ||
    policy.pose?.clips !== 'all delivered clips' ||
    policy.pose.surfaceStride !== 1 ||
    jsonDifference(policy.pose.fractions, [...PROOF.fractions])
  )
    problems.push(
      `not a full-coverage ${PROOF.variant} run (only that variant, head retained, no override, fixed gates, every delivered clip, stride 1, ${PROOF.errorMetres} m)`,
    );
  if (!Array.isArray(summary.keys) || summary.keys.some((item) => typeof item?.key !== 'string'))
    problems.push('lists no keys');
  else {
    const keys = summary.keys.map((item) => item.key),
      twice = keys.filter((key, index) => keys.indexOf(key) !== index);
    if (twice.length) problems.push(`lists ${[...new Set(twice)].join(', ')} more than once`);
  }
  return problems;
}

/** Problems across summaries: one implementation, one identical policy, disjoint keys. */
function summarySetProblems(summaries) {
  const problems = [],
    [first] = summaries,
    owners = new Map();
  summaries.forEach(({ label, summary }) => {
    if (jsonDifference(summary.implementation?.files, first.summary.implementation?.files))
      problems.push(`${label} and ${first.label} do not record one implementation`);
    if (jsonDifference(summary.policy, first.summary.policy))
      problems.push(`${label} and ${first.label} do not share one policy`);
    for (const { key } of summary.keys ?? []) owners.set(key, [...(owners.get(key) ?? []), label]);
  });
  for (const [key, labels] of owners)
    if (labels.length > 1)
      problems.push(`${key} appears in more than one proof summary (${labels.join(', ')})`);
  return problems;
}

/**
 * The named proof summaries, each checked by summaryProblems, together by summarySetProblems, and
 * (before archiving) every implementation file on disk unchanged.
 */
export async function readProofSummaries(root, summaryPaths, expected) {
  if (!isSha256(expected))
    fail(
      'the proof implementation digest must be given explicitly (--proof-implementation <sha256>)',
    );
  if (!Array.isArray(summaryPaths) || !summaryPaths.length)
    fail('guarded-surface@1 needs at least one explicit, complete proof summary (--proof-summary)');
  const read = [];
  for (const summaryPath of summaryPaths) {
    if (typeof summaryPath !== 'string' || !summaryPath) fail('a proof summary path is empty');
    const file = path.resolve(root, summaryPath);
    if (read.some((item) => item.file === file)) fail(`${summaryPath} is named twice`);
    const bytes = await readFile(file);
    let summary;
    try {
      summary = JSON.parse(bytes.toString('utf8'));
    } catch (error) {
      fail(`${summaryPath}: not JSON (${error.message})`);
    }
    const problems = summaryProblems(summary, expected);
    if (problems.length) fail(`${summaryPath}: ${problems.join('; ')}`);
    read.push({
      label: summaryPath,
      file,
      directory: path.dirname(file),
      from: path.relative(root, file).split(path.sep).join('/'),
      bytes,
      summary,
    });
  }
  const problems = summarySetProblems(read);
  if (problems.length) fail(problems.join('; '));
  for (const item of read[0].summary.implementation.files)
    await readExact(
      inside(root, item.file, 'implementation file'),
      item,
      `implementation file ${item.file}`,
    );
  return read;
}

/** The per-region worst statistics of one instance over its poses, as the proof merges them. */
export function worstOf(poses) {
  const worst = {};
  for (const entry of poses)
    for (const side of SIDES)
      for (const [region, stats] of Object.entries(entry[side])) {
        const known = (worst[side] ??= {})[region];
        worst[side][region] = known
          ? {
              max: Math.max(known.max, stats.max),
              p99: Math.max(known.p99, stats.p99),
              mean: Math.max(known.mean, stats.mean),
              worstPose: stats.max > known.max ? entry.pose : known.worstPose,
            }
          : { max: stats.max, p99: stats.p99, mean: stats.mean, worstPose: entry.pose };
      }
  return worst;
}

/**
 * One posed measurement (one instance, one pose), fail closed: every side present; every region a
 * positive sample count and finite, nonnegative max/p99/mean (p99 and mean within max); the
 * stride-1 sample totals of this primitive (`totals`); regions covering every sample; locked
 * vertices only among the holes, exactly `locked` of them, all on the candidate surface; and the
 * fixed world gate on every other region.
 */
function measurementProblems(entry, totals, locked, at) {
  const problems = [];
  for (const side of SIDES) {
    const regions = entry?.[side];
    if (!plainObject(regions) || !plainObject(regions.all)) {
      problems.push(`${at}: no ${side} measurement`);
      continue;
    }
    let covered = 0;
    for (const [region, stats] of Object.entries(regions)) {
      if (
        !plainObject(stats) ||
        !Number.isSafeInteger(stats.count) ||
        stats.count <= 0 ||
        ![stats.max, stats.p99, stats.mean].every(measured) ||
        stats.p99 > stats.max ||
        stats.mean > stats.max
      ) {
        problems.push(`${at} ${side} ${region}: not a complete finite, nonnegative measurement`);
        continue;
      }
      if (region !== 'all') covered += stats.count;
      if (region === 'locked') {
        if (side !== 'holes')
          problems.push(`${at} ${side}: a locked region is never measured here`);
        else if (!(stats.max <= PROOF.gates.protectedMaxMetres))
          problems.push(`${at}: a locked vertex is ${stats.max} m off the surface`);
        continue;
      }
      if (!(stats.p99 <= GATE.p99) || !(stats.max <= GATE.max))
        problems.push(
          `${at} ${side} ${region}: p99 ${stats.p99} / max ${stats.max} m exceed the fixed world gate`,
        );
    }
    if (regions.all.count !== totals[side])
      problems.push(
        `${at} ${side}: ${regions.all.count} samples, the stride-1 proof has ${totals[side]}`,
      );
    if (covered !== regions.all.count)
      problems.push(`${at} ${side}: its regions cover ${covered} of ${regions.all.count} samples`);
  }
  if ((entry?.holes?.locked?.count ?? 0) !== locked)
    problems.push(
      `${at}: ${entry?.holes?.locked?.count ?? 0} locked hole sample(s), the plan locks ${locked}`,
    );
  const shortcuts = entry?.shortcuts;
  if (
    !plainObject(shortcuts) ||
    SIDES.some((side) => !counted(shortcuts[side]) || shortcuts[side] > (totals[side] ?? 0))
  )
    problems.push(`${at}: no valid shortcut record`);
  return problems;
}

/**
 * The recorded posed and coverage evidence of one variant, fail closed against the source
 * document itself: exactly its scenes in order; per scene its instance, slot and compared counts,
 * every slot identified exactly, every delivered clip by Three's name, its applicable channel
 * count derived from the source's channels on the scene's nodes (equal to the record, and covered
 * by the applied source and candidate tracks; a weights channel may expand into several tracks),
 * and exactly the rest + clip@fraction pose labels; exactly the reduced primitives, each with
 * exactly its instances (path and skin), every pose of its scene measured completely, the worst
 * statistics those of its poses, the fixed world gate and exact transforms and correspondence.
 */
function poseEvidenceProblems({ source, candidate, variant, reduced }) {
  const problems = [],
    json = source.json,
    poses = variant.poses;
  if (!plainObject(poses) || !Array.isArray(poses.scenes) || !Array.isArray(poses.primitives))
    return ['the evidence records no posed comparison'];
  const coverage = meshCoverage(json),
    { scenes } = sceneInstances(json),
    sceneClips = clipsOfScenes(json, scenes),
    reducedSlots = new Set(reduced.map(slotOf)),
    labelsOf = new Map();
  if (
    jsonDifference(
      poses.scenes.map((record) => record?.scene),
      scenes.map((scene) => scene.scene),
    )
  )
    problems.push(
      `the evidence records scenes ${JSON.stringify(poses.scenes.map((record) => record?.scene))}, not exactly the source's ${scenes.length}`,
    );
  for (const scene of scenes) {
    const record = poses.scenes.find((item) => item?.scene === scene.scene),
      at = `scene ${scene.scene}`;
    if (!record) continue;
    const slots = scene.instances.flatMap((instance) =>
        json.meshes[instance.mesh].primitives.map((_, p) => `${instance.mesh}/${p}`),
      ),
      compared = slots.filter((slot) => reducedSlots.has(slot)).length;
    if (
      record.instances !== scene.instances.length ||
      record.primitiveInstances !== slots.length ||
      record.comparedPrimitiveInstances !== compared
    )
      problems.push(
        `${at}: ${record.instances}/${record.primitiveInstances}/${record.comparedPrimitiveInstances} instances/slots/compared recorded, the source has ${scene.instances.length}/${slots.length}/${compared}`,
      );
    if (
      record.slotIdentity !==
      `${slots.length} of ${slots.length} slot(s) identified by exact positions and indices`
    )
      problems.push(
        `${at}: not every one of its ${slots.length} mesh slot(s) was identified by exact positions and indices`,
      );
    if (!compared) {
      if (record.poses !== undefined || record.clips !== undefined)
        problems.push(`${at}: poses are recorded although nothing was compared there`);
      continue;
    }
    const clips = sceneClips[scene.scene],
      names = clips.map((c) => threeClipName(json, c)),
      labels = [
        'rest',
        ...names.flatMap((name) => PROOF.fractions.map((fraction) => `${name}@${fraction}`)),
      ],
      notAnimating = (json.animations ?? [])
        .map((animation, c) => [animation.name ?? `clip ${c}`, c])
        .filter(([, c]) => !clips.includes(c))
        .map(([name]) => name);
    labelsOf.set(scene.scene, labels);
    if (
      jsonDifference(record.clips, names) ||
      jsonDifference(record.clipsBeyondMaxClips, []) ||
      jsonDifference(record.clipsNotAnimatingThisScene, notAnimating)
    )
      problems.push(
        `${at}: not every delivered clip was posed (recorded ${JSON.stringify(record.clips)}, the source animates ${JSON.stringify(names)})`,
      );
    if (jsonDifference(record.poses, labels))
      problems.push(
        `${at}: ${Array.isArray(record.poses) ? record.poses.length : 0} poses recorded, not exactly the ${labels.length} of rest and every delivered clip at ${PROOF.fractions.join(', ')}`,
      );
    const tracks = Array.isArray(record.clipTracks) ? record.clipTracks : [];
    if (tracks.length !== clips.length)
      problems.push(
        `${at}: ${tracks.length} clip track record(s) for ${clips.length} delivered clip(s)`,
      );
    clips.forEach((c, i) => {
      const track = tracks[i],
        applicable = (json.animations[c].channels ?? []).filter((channel) =>
          scene.reached.has(channel.target?.node),
        ).length;
      if (
        !plainObject(track) ||
        track.clip !== names[i] ||
        track.applicableChannels !== applicable ||
        !counted(track.appliedTracksSource) ||
        !counted(track.appliedTracksCandidate) ||
        track.appliedTracksSource < applicable ||
        track.appliedTracksCandidate !== track.appliedTracksSource
      )
        problems.push(
          `${at} clip ${names[i]}: the source has ${applicable} applicable channel(s); recorded ${track?.applicableChannels}, applied ${track?.appliedTracksSource}/${track?.appliedTracksCandidate}`,
        );
    });
  }
  const recordedSlots = poses.primitives.map(slotOf);
  if (
    new Set(recordedSlots).size !== recordedSlots.length ||
    jsonDifference([...recordedSlots].sort(byText), [...reducedSlots].sort(byText))
  )
    problems.push(
      `the posed primitives ${JSON.stringify(recordedSlots)} are not exactly the reduced ${JSON.stringify([...reducedSlots])}`,
    );
  for (const plan of reduced) {
    const where = `mesh ${plan.mesh} primitive ${plan.primitive}`,
      expected = coverage[plan.mesh],
      settings = plan.settings;
    if (!expected?.verifiable) problems.push(`${where}: not verifiable in every instance`);
    if (
      plan.mode !== 'reduce' ||
      settings?.errorMetres !== PROOF.errorMetres ||
      jsonDifference(settings.flags, [...PROOF.flags]) ||
      jsonDifference(settings.worldGateMetres, { ...GATE }) ||
      !(
        measured(settings.localErrorMetres) &&
        settings.localErrorMetres > 0 &&
        settings.localErrorMetres <= PROOF.errorMetres
      )
    )
      problems.push(
        `${where}: not the ${PROOF.variant} body reduction at ${PROOF.errorMetres} m with the fixed world gate`,
      );
    if (plan.instances !== expected?.instances.length)
      problems.push(
        `${where}: the plan names ${plan.instances} instance(s), the source has ${expected?.instances.length ?? 0}`,
      );
    const locked = plan.locks?.lockedVertices;
    if (!counted(locked)) problems.push(`${where}: the plan records no locked vertex count`);
    const results = poses.primitives.filter((item) => slotOf(item) === slotOf(plan)),
      result = results.length === 1 ? results[0] : null,
      instances = Array.isArray(result?.instances) ? result.instances : [],
      keyOf = (item) => `${item?.scene}/${item?.node}`,
      keys = instances.map(keyOf);
    if (
      !result ||
      new Set(keys).size !== keys.length ||
      jsonDifference([...keys].sort(byText), (expected?.instances ?? []).map(keyOf).sort(byText))
    ) {
      problems.push(
        `${where}: the evidence does not compare exactly its ${expected?.instances?.length ?? 0} instance(s)`,
      );
      continue;
    }
    const sourcePrimitive = json.meshes[plan.mesh].primitives[plan.primitive],
      candidatePrimitive = candidate.json.meshes[plan.mesh]?.primitives[plan.primitive],
      totals = {
        holes: json.accessors[sourcePrimitive.attributes.POSITION].count,
        interiors: json.accessors[sourcePrimitive.indices]?.count / 3,
        webbing: 4 * (candidate.json.accessors[candidatePrimitive?.indices]?.count / 3),
      };
    for (const instance of instances) {
      const at = `${where} scene ${instance.scene} node ${instance.node}`,
        derived = expected.instances.find((item) => keyOf(item) === keyOf(instance)),
        labels = labelsOf.get(instance.scene);
      if (jsonDifference(instance.path, derived.path) || instance.skin !== derived.skin)
        problems.push(`${at}: its path or skin is not the source's`);
      if (instance.transformEqual !== true || instance.correspondenceMaxMetres !== 0)
        problems.push(`${at}: transform or posed correspondence is not exact`);
      if (
        jsonDifference(
          instance.gateMetres && { p99: instance.gateMetres.p99, max: instance.gateMetres.max },
          { ...GATE },
        )
      )
        problems.push(`${at}: its recorded gate is not the fixed world gate`);
      const entries = Array.isArray(instance.poses) ? instance.poses : [];
      if (
        !labels ||
        jsonDifference(
          entries.map((entry) => entry?.pose),
          labels,
        )
      ) {
        problems.push(
          `${at}: poses ${JSON.stringify(entries.map((entry) => entry?.pose))} are not its scene's ${labels?.length ?? 0}`,
        );
        continue;
      }
      const before = problems.length;
      for (const entry of entries)
        problems.push(
          ...measurementProblems(
            entry,
            totals,
            counted(locked) ? locked : -1,
            `${at} ${entry.pose}`,
          ),
        );
      if (problems.length === before && jsonDifference(instance.worst, worstOf(entries)))
        problems.push(`${at}: its worst statistics are not those of its poses`);
    }
  }
  return problems;
}

/** The storage budget, whole files: raw <= the source's AND gzip -6 below the source's. */
export function budgetProblems(sourceBytes, candidateBytes) {
  const problems = [],
    sourceGzip = gzip6(sourceBytes),
    candidateGzip = gzip6(candidateBytes);
  if (candidateBytes.length > sourceBytes.length)
    problems.push(`raw ${candidateBytes.length} bytes exceed the source's ${sourceBytes.length}`);
  if (!(candidateGzip < sourceGzip))
    problems.push(`gzip -6 ${candidateGzip} bytes is not below the source's ${sourceGzip}`);
  return problems;
}

/** Cross-primitive seam positions of one mesh (bit-exact keys shared by two of its primitives). */
function sharedKeysOf(document, mesh) {
  const owners = new Map();
  document.json.meshes[mesh].primitives.forEach((primitive, p) => {
    const positions = floatsOf(document.json, document.views, primitive.attributes.POSITION),
      bits = new Uint32Array(positions.buffer, positions.byteOffset, positions.length);
    for (let v = 0; v < positions.length / 3; v++) {
      const key = `${bits[3 * v]},${bits[3 * v + 1]},${bits[3 * v + 2]}`;
      (owners.get(key) ?? owners.set(key, new Set()).get(key)).add(p);
    }
  });
  return new Set([...owners].filter(([, set]) => set.size > 1).map(([key]) => key));
}

/**
 * Everything one candidate must satisfy, from bytes: the proof evidence (bound and re-gated,
 * fail closed) and the decoded comparison of candidate and source. Returns { problems,
 * verification }; the verification's status is failed whenever a problem exists.
 */
export async function checkCandidate({
  key,
  sourceBytes,
  candidateBytes,
  evidence,
  variant,
  mappings,
  digest,
}) {
  const problems = [],
    plans = Array.isArray(variant.primitives) ? variant.primitives : [],
    reduced = plans.filter((plan) => plan.action === 'reduced');
  // The proof's verdicts, as recorded.
  if (evidence.key !== key || evidence.implementation !== digest)
    problems.push('the evidence is not this key under this implementation');
  if (evidence.coupling !== null)
    problems.push(`the proof reports ${key} as coupled geometry (or records no coupling verdict)`);
  if (evidence.levels?.oldLodsUsed !== false || evidence.levels.packedScene !== null)
    problems.push('the proof used old LODs or a packed scene');
  if (variant.variant !== PROOF.variant || variant.kind !== 'candidate' || variant.custom !== null)
    problems.push(`not an unmodified ${PROOF.variant} candidate`);
  if (
    variant.status !== PROOF.status ||
    !Array.isArray(variant.problems) ||
    variant.problems.length ||
    variant.proof?.structuralAndPosed !== 'passed' ||
    variant.proof?.posesChecked !== true
  )
    problems.push(`the proof status is ${variant.status}, not a passed structural and posed proof`);
  const planSlots = plans.map(slotOf);
  if (
    new Set(planSlots).size !== planSlots.length ||
    plans.some((plan) => plan.action !== 'reduced' && plan.action !== 'retained')
  )
    problems.push('the primitive plans are not each reduced or retained once');
  const chosen = (variant.storage?.alternatives ?? []).find(
    (item) => item.label === variant.storage?.chosen,
  );
  if (
    !chosen ||
    variant.storage.verifiedOption !== chosen.label ||
    !chosen.withinRawBudget ||
    !chosen.belowSourceGzip
  )
    problems.push('the proof chose no storage within both budgets');
  if (!reduced.length) problems.push('the proof reduced no primitive');
  // The actual bytes.
  if (
    variant.candidate?.sha256 !== sha256(candidateBytes) ||
    chosen?.sha256 !== sha256(candidateBytes)
  )
    problems.push('the evidence describes another candidate file');
  checkProofExtensions(parseGlb(sourceBytes, `${key} source`).json, `${key} source`);
  const raw = parseGlb(candidateBytes, `${key} candidate`).json;
  checkProofExtensions(raw, `${key} candidate`);
  for (const [index, view] of (raw.bufferViews ?? []).entries())
    if (view.extensions?.[MESHOPT]?.filter !== undefined)
      problems.push(
        `buffer view ${index} uses meshopt filter ${view.extensions[MESHOPT].filter}; filters are not lossless`,
      );
  const source = await decodeDocument(sourceBytes, `${key} source`),
    candidate = await decodeDocument(candidateBytes, `${key} candidate`),
    reducedSet = new Set(reduced.map(slotOf));
  if (jsonDifference(mappings.map(slotOf).sort(byText), [...reducedSet].sort(byText)))
    problems.push('the mappings are not exactly the reduced primitives');
  for (const plan of reduced)
    if (
      !source.json.meshes[plan.mesh]?.primitives[plan.primitive] ||
      source.json.meshes[plan.mesh].primitives[plan.primitive].indices === undefined
    )
      problems.push(`${slotOf(plan)}: not an indexed source primitive`);
  if (problems.length)
    return { problems, verification: { status: 'failed', recipe: GUARDED_RECIPE } };
  problems.push(...poseEvidenceProblems({ source, candidate, variant, reduced }));
  const records = [];
  for (const [index, plan] of reduced.entries()) {
    const mapping = mappings.find(
      (item) => item.mesh === plan.mesh && item.primitive === plan.primitive,
    );
    if (!mapping) continue;
    const where = `mesh ${plan.mesh} primitive ${plan.primitive}`,
      primitive = source.json.meshes[plan.mesh].primitives[plan.primitive],
      count = source.json.accessors[primitive.attributes.POSITION].count,
      seen = new Uint8Array(count);
    let invalid = 0;
    for (const s of mapping.sourceVertices) {
      if (s >= count || seen[s]) invalid++;
      else seen[s] = 1;
    }
    if (invalid) {
      problems.push(`${where}: the mapping is not one-to-one within the ${count} source vertices`);
      continue;
    }
    problems.push(
      ...correspondenceProblems(
        source,
        candidate,
        plan.mesh,
        plan.primitive,
        mapping.sourceVertices,
      ),
    );
    const report = topologyReport({
      source,
      candidate,
      mesh: plan.mesh,
      primitive: plan.primitive,
      sourceVertices: mapping.sourceVertices,
      protectedVertices: null,
      sharedKeys: sharedKeysOf(source, plan.mesh),
      borderLocked: true,
      componentAreaRatio: PROOF.gates.componentAreaRatio,
    });
    problems.push(...report.problems.map((problem) => `${where}: ${problem}`));
    const indices = indicesOf(
        candidate.json,
        candidate.views,
        candidate.json.meshes[plan.mesh].primitives[plan.primitive].indices,
      ),
      indexSha256 = uint32Sha256(indices);
    if (chosen.indexSha256?.[index] !== indexSha256)
      problems.push(`${where}: the candidate's indices are not the ones the proof chose`);
    const recorded = (variant.topology ?? []).filter(
      (item) => item.mesh === plan.mesh && item.primitive === plan.primitive,
    );
    if (
      recorded.length !== 1 ||
      recorded[0].protectedTrianglesLost !== 0 ||
      recorded[0].candidate?.triangles !== indices.length / 3
    )
      problems.push(`${where}: the proof's protection record does not describe this candidate`);
    records.push({
      mesh: plan.mesh,
      primitive: plan.primitive,
      sourceVertices: count,
      candidateVertices: mapping.sourceVertices.length,
      sourceTriangles: report.source.triangles,
      candidateTriangles: indices.length / 3,
      indexSha256,
      mappingSha256: uint32Sha256(mapping.sourceVertices),
    });
  }
  problems.push(...preservationProblems(source, candidate, reducedSet));
  const before = geometryCounts(source.json),
    after = geometryCounts(candidate.json);
  problems.push(...budgetProblems(sourceBytes, candidateBytes));
  if (!(after.triangles < before.triangles)) problems.push('no triangle was removed');
  return {
    problems,
    verification: {
      status: problems.length ? 'failed' : 'passed',
      recipe: GUARDED_RECIPE,
      triangles: { source: before.triangles, candidate: after.triangles },
      vertices: { source: before.vertices, candidate: after.vertices },
      rawBytes: { source: sourceBytes.length, candidate: candidateBytes.length },
      gzip6Bytes: { source: gzip6(sourceBytes), candidate: gzip6(candidateBytes) },
      reduced: records,
      proof: {
        tool: PROOF.tool,
        implementation: digest,
        variant: PROOF.variant,
        storage: chosen.label,
        posedInstances: (Array.isArray(variant.poses?.primitives)
          ? variant.poses.primitives
          : []
        ).reduce(
          (sum, item) => sum + (Array.isArray(item?.instances) ? item.instances.length : 0),
          0,
        ),
        scenes: Array.isArray(variant.poses?.scenes) ? variant.poses.scenes.length : 0,
      },
    },
  };
}

const mappingOf = (bytes) =>
  new Uint32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));

/**
 * Read one key's proof records. From a proof output (`revisionLayout` false) the paths are the
 * proof's own; from a revision, evidence and mappings sit under proof/<key>/ and the candidate at
 * its content-addressed output file (`candidateFile`).
 */
async function proofRecords(
  directory,
  keyEntry,
  key,
  { revisionLayout = false, candidateFile = null } = {},
) {
  const evidencePath = revisionLayout ? `${key}/evidence.json` : keyEntry.evidence?.file,
    evidenceBytes = await readExact(
      inside(directory, evidencePath, `${key} evidence`),
      keyEntry.evidence,
      `${key} evidence`,
    ),
    evidence = JSON.parse(evidenceBytes.toString('utf8')),
    variants = (evidence.variants ?? []).filter((item) => item?.variant === PROOF.variant);
  if (!variants.length) fail(`${key}: the proof has no ${PROOF.variant} result`);
  if (variants.length > 1)
    fail(`${key}: the proof records ${variants.length} ${PROOF.variant} results`);
  const [variant] = variants;
  if (!variant.file) fail(`${key}: the ${PROOF.variant} result wrote no candidate`);
  const candidateBytes = await readExact(
      candidateFile ?? inside(directory, variant.file.file, `${key} candidate`),
      variant.file,
      `${key} candidate`,
    ),
    mappings = [];
  for (const item of variant.mappingFiles ?? []) {
    const relative = revisionLayout ? `${key}/${path.posix.basename(item.file)}` : item.file,
      bytes = await readExact(
        inside(directory, relative, `${key} mapping`),
        item,
        `${key} mapping ${item.file}`,
      );
    if (bytes.length % 4) fail(`${key}: mapping ${item.file} is not a u32le array`);
    mappings.push({
      mesh: item.mesh,
      primitive: item.primitive,
      file: item.file,
      sha256: item.sha256,
      bytes: item.bytes,
      raw: bytes,
      sourceVertices: mappingOf(bytes),
    });
  }
  return { evidenceBytes, evidence, variant, candidateBytes, mappings };
}

async function servedBytes(root, record) {
  checkModelUrl(record.url, record.sha256);
  return readExact(
    path.join(root, 'public', ...record.url.slice(1).split('/')),
    record,
    record.url,
  );
}

function outputLocation(target, digest) {
  return target.startup
    ? candidateLocation(target.entry.primary.source.url, digest, 'startup')
    : candidateLocation(target.entry.primary.source.url, digest);
}

/** The summary's own record of a key agrees with its evidence and the served primary. */
function keyEntryProblems(keyEntry, proof, target) {
  const problems = [],
    listed = (keyEntry.variants ?? []).filter((item) => item?.variant === PROOF.variant);
  if (keyEntry.coupling !== null)
    problems.push('the summary reports it as coupled geometry (or records no coupling verdict)');
  if (
    !sameFile(keyEntry.served, target.entry.primary) ||
    !sameFile(keyEntry.served, proof.evidence.served)
  )
    problems.push("the summary's served file is not the evidence's and the served primary");
  if (
    listed.length !== 1 ||
    listed[0].status !== proof.variant.status ||
    jsonDifference(listed[0].file, proof.variant.file)
  )
    problems.push(`the summary's ${PROOF.variant} entry is not the evidence's result`);
  return problems;
}

/** The manifest record of one accepted candidate. */
function recordOf(target, candidateBytes, location, proof, verification) {
  const json = parseGlb(candidateBytes, target.key).json;
  return {
    id: `model:${target.key}`,
    role: GUARDED_ROLE,
    status: CANDIDATE_STATUS,
    modelKey: target.key,
    selection: target.entry.selection,
    source: {
      ...identity(target.entry.primary),
      triangles: target.entry.primary.triangles ?? null,
      original: identity(target.entry.primary.source),
    },
    output: {
      file: location.file,
      url: location.url,
      sha256: sha256(candidateBytes),
      bytes: candidateBytes.length,
      triangles: verification.triangles.candidate,
      extensionsUsed: json.extensionsUsed ?? [],
      extensionsRequired: json.extensionsRequired ?? [],
    },
    // The unchanged LODs of an ordinary model, archived (same bytes) so that later lineage can
    // resolve each served file inside the revision that now names the entry. Never copied anew.
    lineageArchive: target.entry.lods.map((lod) => ({ file: lod.url.slice(1), ...identity(lod) })),
    proof,
    verification,
    knownRisks: [
      'Geometry is reduced (not lossless); surviving vertex attributes are exact. Posed checks are the proof engine sampled poses (rest plus every delivered clip at 33% and 66%), not every frame.',
      'Native visual review and in-game QA of this exact file are required before acceptance documents are written.',
    ],
  };
}

/** key -> { index, entry } over every summary (keys are disjoint, checked before). */
function keyIndexOf(summaries) {
  const index = new Map();
  summaries.forEach((summary, i) => {
    for (const entry of summary.keys) index.set(entry.key, { index: i, entry });
  });
  return index;
}

async function computeRevision(root, base, request, { fromRevision = null } = {}) {
  const targets = guardedTargets(base, request.keys),
    keyIndex = keyIndexOf(request.summaries.map((item) => item.summary)),
    records = [],
    outputs = new Map(),
    proofFiles = new Map(),
    summaryKeys = request.summaries.map(() => []);
  for (const target of targets) {
    const found = keyIndex.get(target.key);
    if (!found || found.entry.status === 'error')
      fail(`${target.key}: no proof summary has a result for it`);
    const keyEntry = found.entry,
      expected = request.accept[target.key];
    if (!isSha256(expected)) fail(`${target.key}: no reviewed candidate SHA-256`);
    const proof = fromRevision
      ? await proofRecords(path.join(fromRevision, 'proof'), keyEntry, target.key, {
          revisionLayout: true,
          candidateFile: resolveCandidateFile(fromRevision, outputLocation(target, expected).file),
        })
      : await proofRecords(request.summaries[found.index].directory, keyEntry, target.key);
    if (sha256(proof.candidateBytes) !== expected)
      fail(
        `${target.key}: the proof's candidate ${sha256(proof.candidateBytes)} is not the reviewed ${expected}`,
      );
    if (!sameFile(proof.evidence.served, target.entry.primary))
      fail(
        `${target.key}: the proof was made from ${proof.evidence.served?.url} ${proof.evidence.served?.sha256}, not the served primary ${target.entry.primary.url} ${target.entry.primary.sha256}`,
      );
    const listed = keyEntryProblems(keyEntry, proof, target);
    if (listed.length) fail(`${target.key}: ${listed.join('; ')}`);
    const source = await servedBytes(root, target.entry.primary),
      { problems, verification } = await checkCandidate({
        key: target.key,
        sourceBytes: source,
        candidateBytes: proof.candidateBytes,
        evidence: proof.evidence,
        variant: proof.variant,
        mappings: proof.mappings,
        digest: request.digest,
      });
    if (problems.length || verification.status !== 'passed')
      fail(`${target.key}: ${problems.slice(0, 8).join('; ')}`);
    const location = outputLocation(target, sha256(proof.candidateBytes)),
      proofRecord = {
        summary: summaryFile(found.index),
        evidence: {
          file: `proof/${target.key}/evidence.json`,
          sha256: sha256(proof.evidenceBytes),
          bytes: proof.evidenceBytes.length,
        },
        mappings: proof.mappings.map((item) => ({
          mesh: item.mesh,
          primitive: item.primitive,
          file: `proof/${target.key}/${path.posix.basename(item.file)}`,
          sha256: item.sha256,
          bytes: item.bytes,
        })),
        reviewedCandidateSha256: expected,
      };
    records.push(recordOf(target, proof.candidateBytes, location, proofRecord, verification));
    summaryKeys[found.index].push(target.key);
    outputs.set(location.file, proof.candidateBytes);
    proofFiles.set(proofRecord.evidence.file, proof.evidenceBytes);
    proof.mappings.forEach((item, i) => proofFiles.set(proofRecord.mappings[i].file, item.raw));
    for (const lod of target.entry.lods)
      outputs.set(lod.url.slice(1), await servedBytes(root, lod));
  }
  return { targets, records, outputs, proofFiles, summaryKeys };
}

/**
 * Write a fresh guarded-surface@1 revision of the accepted keys on the applied base.
 * `summaries` lists the complete proof summaries (paths); each accepted key occurs in exactly one.
 */
export async function generateGuardedRevision(
  root,
  {
    base: baseId,
    basePlanSha256,
    summaries: summaryPaths,
    implementation,
    accept,
    out,
    rules,
    dryRun = false,
  } = {},
) {
  if (typeof baseId !== 'string' || !baseId)
    fail('guarded-surface@1 needs its applied base adoption (--base-adoption)');
  if (!accept || typeof accept !== 'object' || !Object.keys(accept).length)
    fail(
      'guarded-surface@1 needs explicit reviewed candidates (--accept key=sha256); the default scope is empty',
    );
  for (const [key, digest] of Object.entries(accept))
    if (!isSha256(digest)) fail(`${key}: the reviewed candidate SHA-256 is missing or malformed`);
  const revision = resolveRevisionDirectory(root, out);
  if (existsSync(revision.absolute))
    fail(`${revision.relative} already exists; a guarded revision needs a new --out`);
  const base = await readServedBase(root, baseId, rules);
  if (base.planSha256 !== basePlanSha256)
    fail(
      `base adoption ${baseId} has plan SHA-256 ${base.planSha256}, not the stated ${basePlanSha256}`,
    );
  const summaries = await readProofSummaries(root, summaryPaths, implementation),
    keys = Object.keys(accept).sort(byText),
    computed = await computeRevision(root, base, {
      keys,
      accept,
      summaries,
      digest: implementation,
    }),
    unused = summaries.filter((_, i) => !computed.summaryKeys[i].length).map((item) => item.label);
  if (unused.length)
    fail(
      `${unused.join(', ')} supplies no accepted key; name only the summaries this revision uses`,
    );
  const manifest = {
    schema: MANIFEST_SCHEMA,
    recipe: GUARDED_RECIPE,
    revision: path.basename(revision.absolute),
    directory: revision.relative,
    status: 'candidate',
    adoption: 'not-adopted',
    visualQa: 'pending-native-review',
    scope: { complete: false, only: keys, models: keys },
    base: base.record,
    inputs: { manifests: base.current.manifests },
    toolchain: { node: process.version, meshoptimizer: MESHOPTIMIZER_VERSION },
    proof: {
      tool: PROOF.tool,
      implementation: { digest: implementation, files: summaries[0].summary.implementation.files },
      // Each original summary, archived byte for byte, with where it came from and the keys it supplies.
      summaries: summaries.map((item, i) => ({
        file: summaryFile(i),
        sha256: sha256(item.bytes),
        bytes: item.bytes.length,
        from: item.from,
        keys: computed.summaryKeys[i],
      })),
      accepted: Object.fromEntries(keys.map((key) => [key, accept[key]])),
    },
    policy:
      'the CURRENT primary of each listed model replaced by its proven, reviewed index-only reduction; every LOD, texture and other entry unchanged',
    files: computed.records,
    images: [],
  };
  if (dryRun)
    return {
      dryRun: true,
      revision: revision.relative,
      keys,
      summaries: manifest.proof.summaries,
      files: manifest.files.map((record) => ({
        key: record.modelKey,
        output: record.output.url,
        triangles: record.verification.triangles,
        gzip6Bytes: record.verification.gzip6Bytes,
      })),
    };
  const staging = path.join(
    path.dirname(revision.absolute),
    `.${path.basename(revision.absolute)}.staging-${process.pid}`,
  );
  await mkdir(staging);
  try {
    const write = async (relative, bytes) => {
      const target = inside(staging, relative, 'revision file');
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, bytes, { flag: 'wx' });
    };
    for (const [file, bytes] of computed.outputs) await write(file, bytes);
    for (const [file, bytes] of computed.proofFiles) await write(file, bytes);
    for (const [i, item] of summaries.entries()) await write(summaryFile(i), item.bytes);
    await write('manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
    await write('runtime-index.json', `${JSON.stringify(runtimeIndexOf(manifest), null, 2)}\n`);
    if (existsSync(revision.absolute))
      fail(`${revision.relative} appeared during generation; nothing was moved there`);
    await rename(staging, revision.absolute);
  } catch (error) {
    await rm(staging, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    throw error;
  }
  return { revision: revision.relative, keys };
}

async function listFiles(directory, prefix = '') {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory())
      files.push(...(await listFiles(path.join(directory, entry.name), relative)));
    else files.push(relative);
  }
  return files.sort(byText);
}

/**
 * Re-verify a guarded-surface@1 revision against its applied base from disk: base record and
 * inputs; every archived summary by the same summaryProblems as at generation (and together by
 * summarySetProblems), equal to the recorded implementation (and to `implementation`, when
 * given), each scoped key in exactly one of them; and every candidate re-checked from its stored
 * bytes, evidence and mappings exactly as at generation. Returns the verification report.
 */
export async function verifyGuardedRevision(
  root,
  requested,
  { base: baseId, rules, served = null, implementation = null } = {},
) {
  const revision = resolveRevisionDirectory(root, requested),
    manifest = JSON.parse(await readFile(path.join(revision.absolute, 'manifest.json'), 'utf8')),
    runtimeIndex = JSON.parse(
      await readFile(path.join(revision.absolute, 'runtime-index.json'), 'utf8'),
    );
  if (manifest.schema !== MANIFEST_SCHEMA || manifest.recipe !== GUARDED_RECIPE)
    fail(`${revision.relative} is not a ${GUARDED_RECIPE} revision`);
  if (manifest.base?.adoption !== baseId)
    fail(`${revision.relative} replaces primaries of ${manifest.base?.adoption}, not ${baseId}`);
  const base = served ?? (await readServedBase(root, baseId, rules)),
    checks = [],
    results = [],
    check = (name, problems) =>
      checks.push({
        name,
        status: problems.length ? 'failed' : 'passed',
        ...(problems.length ? { problems: problems.slice(0, 40) } : {}),
      }),
    diff = (a, b, where) => {
      const difference = jsonDifference(a, b, where);
      return difference ? [difference] : [];
    };
  check(
    'the base adoption is still applied with the recorded records',
    diff(manifest.base, base.record, '$.base'),
  );
  check(
    "the inputs are the base's current manifests",
    diff(manifest.inputs?.manifests, base.current.manifests, '$.inputs.manifests'),
  );
  check(
    'runtime-index.json is exactly derived from manifest.json',
    diff(runtimeIndexOf(manifest), runtimeIndex, '$index'),
  );
  check(
    'every record is an unadopted candidate',
    manifest.status === 'candidate' &&
      manifest.adoption === 'not-adopted' &&
      manifest.files.every(
        (record) => record.status === CANDIDATE_STATUS && record.role === GUARDED_ROLE,
      ) &&
      !(manifest.images ?? []).length
      ? []
      : ['a record claims another status or role'],
  );
  const keys = manifest.scope?.models ?? [];
  check(
    'the scope is the recorded explicit list',
    diff(manifest.scope, { complete: false, only: keys, models: keys }, '$.scope').concat(
      jsonDifference([...keys].sort(byText), keys) ? ['the scope is not sorted'] : [],
    ),
  );
  const digest = manifest.proof?.implementation?.digest,
    stored = [],
    summaryCheck =
      'every archived proof summary is a complete, strict full-coverage run of the one recorded implementation, covering each scoped key exactly once';
  try {
    if (!isSha256(digest) || (implementation !== null && digest !== implementation))
      fail(
        `the recorded implementation ${digest} is not the expected ${implementation ?? 'sha256'}`,
      );
    const records = manifest.proof.summaries;
    if (!Array.isArray(records) || !records.length) fail('the manifest records no proof summary');
    for (const [i, record] of records.entries()) {
      if (record?.file !== summaryFile(i))
        fail(`summary ${i + 1} is recorded at ${record?.file}, not ${summaryFile(i)}`);
      const bytes = await readExact(
          inside(revision.absolute, record.file, 'proof summary'),
          record,
          record.file,
        ),
        summary = JSON.parse(bytes.toString('utf8')),
        problems = summaryProblems(summary, digest);
      if (problems.length) fail(`${record.file}: ${problems.join('; ')}`);
      stored.push({ label: record.file, summary, record });
    }
    const problems = [
      ...summarySetProblems(stored),
      ...diff(
        stored[0].summary.implementation.files,
        manifest.proof.implementation.files,
        '$.proof.implementation.files',
      ),
      ...diff(
        manifest.proof.accepted && Object.keys(manifest.proof.accepted).sort(byText),
        keys,
        '$.proof.accepted',
      ),
    ];
    const keyIndex = keyIndexOf(stored.map((item) => item.summary));
    stored.forEach((item, i) => {
      const supplied = keys.filter((key) => keyIndex.get(key)?.index === i);
      if (!supplied.length || jsonDifference(item.record.keys, supplied))
        problems.push(
          `${item.label} supplies ${JSON.stringify(supplied)}, recorded ${JSON.stringify(item.record.keys)}`,
        );
    });
    for (const key of keys)
      if (!keyIndex.has(key)) problems.push(`${key} is in no archived proof summary`);
    if (problems.length) fail(problems.join('; '));
    check(summaryCheck, []);
  } catch (error) {
    check(summaryCheck, [error.message]);
    return reportOf(manifest, base, checks, results);
  }
  let computed;
  try {
    computed = await computeRevision(
      root,
      base,
      { keys, accept: manifest.proof.accepted, summaries: stored, digest },
      { fromRevision: revision.absolute },
    );
  } catch (error) {
    check('every candidate re-verifies from its stored bytes, evidence and mappings', [
      error.message,
    ]);
    return reportOf(manifest, base, checks, results);
  }
  for (const expected of computed.records) {
    const record = manifest.files.find((item) => item.id === expected.id);
    if (!record) {
      results.push({ id: expected.id, status: 'failed', error: 'no record' });
      continue;
    }
    try {
      const bytes = await readExact(
        resolveCandidateFile(revision.absolute, record.output.file),
        record.output,
        record.output.file,
      );
      if (!bytes.equals(computed.outputs.get(expected.output.file)))
        fail('the stored candidate is not the proof candidate');
      for (const item of record.lineageArchive ?? [])
        await readExact(
          inside(revision.absolute, item.file, 'lineage archive'),
          item,
          `lineage archive ${item.file}`,
        );
      const difference = jsonDifference(record, expected);
      if (difference) fail(`the record differs from the re-derived one (${difference})`);
      results.push({ id: record.id, status: 'passed', verification: record.verification });
    } catch (error) {
      results.push({ id: record.id, status: 'failed', error: error.message });
    }
  }
  check(
    'no record outside the scope or twice',
    manifest.files.length === computed.records.length
      ? []
      : ['the records are not exactly the scope'],
  );
  const listed = new Set([
    'manifest.json',
    'runtime-index.json',
    REVISION_REPORT,
    ...stored.map((item) => item.record.file),
    ...computed.outputs.keys(),
    ...computed.proofFiles.keys(),
  ]);
  check(
    'the revision folder holds only recorded files',
    (await listFiles(revision.absolute)).filter((file) => !listed.has(file)),
  );
  return reportOf(manifest, base, checks, results);
}

function reportOf(manifest, base, checks, results) {
  const failures =
    checks.filter((item) => item.status !== 'passed').length +
    results.filter((item) => item.status !== 'passed').length;
  return {
    schema: VERIFICATION_SCHEMA,
    revision: manifest.revision,
    recipe: GUARDED_RECIPE,
    base: { adoption: base.id, planSha256: base.planSha256 },
    scope: manifest.scope,
    status: failures ? 'failed' : 'passed',
    candidateStatus: CANDIDATE_STATUS,
    verified:
      'local files only: base applied and current; every archived proof summary judged by the same strict policy check as at generation, one implementation and policy, disjoint keys; evidence fail closed against the source (every scene, slot, instance, delivered clip and applicable channel, every pose label and measurement, worst statistics, fixed world gate); mapping one-to-one, decoded surviving attributes exact, rig/clips/images/untouched geometry exact, identity-based topology, index digests, whole-file raw and gzip -6 budget',
    notVerified: [
      'native rendering and visual acceptance',
      'every animation frame (the proof samples poses)',
      'in-game QA, transfer and startup time',
      'mobile devices',
      "the proof engine's own files once archived (their identity is the recorded digest)",
    ],
    checks,
    files: results,
  };
}

export const GUARDED_REPORT = REVISION_REPORT;
