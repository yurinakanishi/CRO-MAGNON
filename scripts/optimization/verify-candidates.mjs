// Re-verify a candidate revision from disk, independently of the generator run:
// originals still match the current manifests; candidate files match their recorded
// SHA-256, length and content-addressed names; decoded data equals the originals; startup
// actors carry LOD geometry plus every full-model clip; standalone textures are the planned
// resize of the currently configured, audited images; the folder holds nothing else.
// A partial revision on a base adoption (--base-adoption, which must name the base the manifest
// records) is checked instead against that base: still applied with unchanged records, sources
// from its saved pre-apply manifests, exactly the listed models' files, no actors or images.
// Images recorded with per-image edges are held to their treatment's edge under the policy.
// Nothing is rendered: GPU, visual and UV-bleed review remain Codex Chrome QA.
import { existsSync } from 'node:fs';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import {
  CANDIDATE_STATUS,
  EXACT_REPACK_RECIPE,
  MANIFEST_SCHEMA,
  MESHOPTIMIZER_VERSION,
  ORIGINAL_KEPT_STATUS,
  STANDALONE_ROLE,
  STARTUP_ROLE,
  runtimeIndexOf,
} from './contract.mjs';
import { jsonDifference, parseGlb, sha256, validateDocument } from './glb.mjs';
import { checkExtensions } from './gltf-usage.mjs';
import { buildInventory, loadEligibilityRules, readVerifiedSource } from './inventory.mjs';
import {
  DEFAULT_REVISION,
  REPO_ROOT,
  imageCandidateLocation,
  resolveCandidateFile,
  resolveRevisionDirectory,
} from './paths.mjs';
import { checkPartialRevision, readBaseAdoption, recordEdges } from './revision-scope.mjs';
import { prepareSourceSimplifier } from './source-simplify.mjs';
import { planStandaloneImages, readVerifiedImage } from './standalone-images.mjs';
import { buildStartupActor } from './startup-actor.mjs';
import { verifyDerived, verifyStandaloneImage, verifyStartup } from './verify.mjs';

const REPORT_NAME = 'verification.json';

async function readCandidate(revision, output) {
  const file = resolveCandidateFile(revision.absolute, output.file);
  if (output.url !== `/${output.file}`)
    throw new Error(`${output.file}: URL ${output.url} does not match the file`);
  if (
    !/^[0-9a-f]{64}$/.test(output.sha256 ?? '') ||
    !output.file.endsWith(`.opt-${output.sha256.slice(0, 16)}.glb`)
  )
    throw new Error(`${output.file}: the name is not addressed by its recorded SHA-256`);
  const bytes = await readFile(file);
  if (bytes.length !== output.bytes)
    throw new Error(`${output.file}: ${bytes.length} bytes, the manifest records ${output.bytes}`);
  const digest = sha256(bytes);
  if (digest !== output.sha256)
    throw new Error(`${output.file}: SHA-256 ${digest} differs from the manifest`);
  return parseGlb(bytes, output.file);
}

async function readCandidateImage(revision, record) {
  const { output, plan } = record,
    expected = imageCandidateLocation(plan.source.url, output.sha256 ?? '');
  if (
    !/^[0-9a-f]{64}$/.test(output.sha256 ?? '') ||
    output.file !== expected.file ||
    output.url !== expected.url
  )
    throw new Error(
      `${record.id}: ${output.file} is not the content-addressed name ${expected.file}`,
    );
  const bytes = await readFile(resolveCandidateFile(revision.absolute, output.file));
  if (bytes.length !== output.bytes)
    throw new Error(`${output.file}: ${bytes.length} bytes, the manifest records ${output.bytes}`);
  const digest = sha256(bytes);
  if (digest !== output.sha256)
    throw new Error(`${output.file}: SHA-256 ${digest} differs from the manifest`);
  return bytes;
}

async function loadOriginal(record, current) {
  const now = current.get(record.url);
  if (!now) throw new Error(`${record.url} is no longer delivered by the current manifests`);
  if (now.sha256 !== record.sha256 || now.bytes !== record.bytes)
    throw new Error(
      `${record.url} changed in the current manifests after generation; this candidate is stale`,
    );
  const doc = parseGlb(await readVerifiedSource(REPO_ROOT, record), record.url);
  validateDocument(doc.json, doc.bin, record.url);
  checkExtensions(doc.json, record.url);
  return doc;
}

async function listFiles(directory, prefix = '') {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory())
      files.push(...(await listFiles(path.join(directory, entry.name), relative)));
    else files.push(relative);
  }
  return files.sort();
}

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    strict: true,
    allowPositionals: false,
    options: {
      revision: { type: 'string', default: DEFAULT_REVISION },
      'base-adoption': { type: 'string' },
      'write-report': { type: 'boolean', default: false },
    },
  });
  await prepareSourceSimplifier();
  const revision = resolveRevisionDirectory(REPO_ROOT, values.revision);
  if (!existsSync(path.join(revision.absolute, 'manifest.json')))
    throw new Error(`${revision.relative}/manifest.json does not exist`);
  const manifest = JSON.parse(
    await readFile(path.join(revision.absolute, 'manifest.json'), 'utf8'),
  );
  if (manifest.schema !== MANIFEST_SCHEMA)
    throw new Error(`unexpected manifest schema ${manifest.schema}`);
  if (manifest.recipe !== undefined) {
    // An exact-repack revision (exact-repack.mjs): every output re-derived from the base's served
    // files and compared scene by scene with the original levels.
    if (manifest.recipe !== EXACT_REPACK_RECIPE)
      throw new Error(`${revision.relative} names the unknown recipe ${manifest.recipe}`);
    if (values['base-adoption'] !== manifest.base?.adoption)
      throw new Error(
        `${revision.relative} repacks ${manifest.base?.adoption}; verify it with --base-adoption ${manifest.base?.adoption}`,
      );
    const { verifyExactRepack } = await import('./exact-repack.mjs'),
      report = await verifyExactRepack(REPO_ROOT, revision.relative, {
        base: values['base-adoption'],
        rules: await loadEligibilityRules(REPO_ROOT),
      }),
      text = JSON.stringify(report, null, 2) + '\n';
    if (values['write-report']) {
      const target = path.join(revision.absolute, REPORT_NAME);
      if (existsSync(target) && (await readFile(target, 'utf8')) !== text)
        throw new Error(
          `${revision.relative}/${REPORT_NAME} exists with different content; move it aside first`,
        );
      await writeFile(target, text);
    }
    process.stdout.write(text);
    if (report.status !== 'passed') process.exitCode = 1;
    return;
  }
  const baseId = values['base-adoption'] ?? null;
  if (manifest.base !== undefined && baseId !== manifest.base?.adoption)
    throw new Error(
      `${revision.relative} is a partial revision on ${manifest.base?.adoption}; verify it with --base-adoption ${manifest.base?.adoption}`,
    );
  if (manifest.base === undefined && baseId)
    throw new Error(
      `${revision.relative} records no base adoption; verify it without --base-adoption`,
    );
  const checks = [],
    check = (name, passed, detail) =>
      checks.push({ name, status: passed ? 'passed' : 'failed', ...(passed ? {} : { detail }) }),
    installed = JSON.parse(
      await readFile(path.join(REPO_ROOT, 'node_modules', 'meshoptimizer', 'package.json'), 'utf8'),
    ).version;
  check(
    `the installed meshoptimizer is exactly ${MESHOPTIMIZER_VERSION}`,
    installed === MESHOPTIMIZER_VERSION &&
      manifest.toolchain?.meshoptimizer === MESHOPTIMIZER_VERSION,
    { installed, generatedWith: manifest.toolchain?.meshoptimizer ?? null },
  );
  const imageRecords = manifest.images ?? [];
  check(
    'every record is still an unadopted candidate pending visual QA',
    manifest.status === 'candidate' &&
      manifest.adoption === 'not-adopted' &&
      manifest.files.every((record) => record.status === CANDIDATE_STATUS) &&
      imageRecords.every(
        (record) =>
          record.role === STANDALONE_ROLE &&
          record.status === (record.output ? CANDIDATE_STATUS : ORIGINAL_KEPT_STATUS),
      ),
    'a record claims a status other than candidate-pending-visual-qa',
  );
  const runtimeIndex = JSON.parse(
      await readFile(path.join(revision.absolute, 'runtime-index.json'), 'utf8'),
    ),
    indexDifference = jsonDifference(runtimeIndexOf(manifest), runtimeIndex);
  check(
    'runtime-index.json is exactly derived from manifest.json',
    !indexDifference,
    indexDifference,
  );
  const rules = await loadEligibilityRules(REPO_ROOT),
    base = baseId ? await readBaseAdoption(REPO_ROOT, baseId, rules) : null;
  if (base && revision.relative === base.record.candidateRevision.directory)
    throw new Error(
      `${revision.relative} is the base's own candidate revision; verify it without --base-adoption`,
    );
  // A partial revision on a base reads its originals from the base's saved pre-apply manifests.
  const inventory = base ? base.inventory : await buildInventory(REPO_ROOT, rules);
  if (base)
    for (const { name, problems } of checkPartialRevision(manifest, base))
      check(name, !problems.length, problems);
  if (manifest.scope?.complete) {
    const recorded = new Set(
        manifest.files
          .filter((record) => record.role !== STARTUP_ROLE)
          .map((record) => record.source.url),
      ),
      missing = inventory.models
        .filter((model) => model.eligible)
        .flatMap((model) => model.files.map((file) => file.url))
        .filter((url) => !recorded.has(url)),
      actors = new Set(
        manifest.files
          .filter((record) => record.role === STARTUP_ROLE)
          .map((record) => record.uses[0].modelKey),
      ),
      missingActors = inventory.models
        .filter((model) => model.eligible && model.publicCharacter)
        .map((model) => model.modelKey)
        .filter((key) => !actors.has(key)),
      reviewed = new Set(manifest.models.map((model) => model.modelKey)),
      unreviewed = inventory.models
        .map((model) => model.modelKey)
        .filter((key) => !reviewed.has(key));
    check('every currently eligible GLB has a candidate', !missing.length, missing);
    check(
      'every public player character has a startup actor',
      !missingActors.length,
      missingActors,
    );
    check(
      'every current model is recorded as eligible or excluded',
      !unreviewed.length,
      unreviewed,
    );
  }
  // Standalone textures are re-planned from the current manifests and runtime configuration (a
  // partial revision on a base plans none; checkPartialRevision requires that none is recorded).
  let standalone = { images: [] };
  if (!base) {
    const owners = new Map(
      inventory.models
        .filter(
          (model) =>
            model.eligible &&
            (manifest.scope?.complete || (manifest.scope?.only ?? []).includes(model.modelKey)),
        )
        .map((model) => [
          model.modelKey,
          (manifest.policy?.stricter512 ?? []).includes(model.modelKey) ? 512 : 1024,
        ]),
    );
    standalone = await planStandaloneImages(REPO_ROOT, {
      inventory,
      rules,
      edges: owners,
      colorFilter: manifest.options?.colorFilter,
      webpQuality: manifest.options?.webpQuality,
    });
    const plannedIds = standalone.images.map((item) => item.id).sort(),
      recordedIds = imageRecords.map((record) => record.id).sort();
    check(
      'standalone textures are exactly the currently configured runtime images',
      plannedIds.join('\n') === recordedIds.join('\n'),
      { planned: plannedIds, recorded: recordedIds },
    );
  }
  const listed = new Set([
      'manifest.json',
      'runtime-index.json',
      REPORT_NAME,
      ...manifest.files.map((record) => record.output.file),
      ...imageRecords.filter((record) => record.output).map((record) => record.output.file),
    ]),
    stray = (await listFiles(revision.absolute)).filter((file) => !listed.has(file));
  check('the revision folder holds only recorded files', !stray.length, stray);
  const results = [],
    candidates = new Map();
  for (const record of manifest.files) {
    try {
      let verification;
      if (record.role !== STARTUP_ROLE) {
        // Null for records written before per-image edges: those keep the single-edge check.
        const edges = recordEdges(manifest, record),
          source = await loadOriginal(record.source, inventory.files),
          output = await readCandidate(revision, record.output);
        verification = await verifyDerived({
          source,
          output,
          textures: record.output.images,
          edge: record.output.maximumTextureEdge,
          ...(edges ? { edges } : {}),
          label: record.id,
        });
        candidates.set(record.source.url, output);
      } else {
        const upgrade = manifest.files.find(
          (other) => other.role !== STARTUP_ROLE && other.source.url === record.source.full.url,
        );
        if (
          !upgrade ||
          upgrade.output.url !== record.upgrade.url ||
          upgrade.output.sha256 !== record.upgrade.sha256
        )
          throw new Error(
            `${record.id}: its upgrade does not match the full-model candidate record`,
          );
        const high = await loadOriginal(record.source.full, inventory.files),
          lod = await loadOriginal(record.source.geometry, inventory.files),
          // The compatibility proofs (binding displacement, hierarchy, surface agreement) must
          // reproduce exactly from the current sources.
          proofDifference = jsonDifference(
            record.derivation.startup,
            buildStartupActor(high, lod, record.id).report,
          );
        if (proofDifference)
          throw new Error(
            `${record.id}: startup proofs differ from the manifest (${proofDifference})`,
          );
        verification = await verifyStartup({
          high,
          lod,
          output: await readCandidate(revision, record.output),
          highOutput:
            candidates.get(record.source.full.url) ??
            (await readCandidate(revision, upgrade.output)),
          edge: record.output.maximumTextureEdge,
          label: record.id,
          startup: record.derivation.startup,
        });
      }
      const recordedDifference = jsonDifference(record.verification, verification);
      if (recordedDifference)
        throw new Error(
          `${record.id}: re-verification differs from the manifest (${recordedDifference})`,
        );
      results.push({ id: record.id, status: 'passed', verification });
    } catch (error) {
      results.push({ id: record.id, status: 'failed', error: error.message });
    }
  }
  for (const record of imageRecords) {
    try {
      const planned = standalone.images.find((item) => item.id === record.id);
      if (!planned) throw new Error(`${record.id}: no longer a configured runtime texture`);
      const planDifference = jsonDifference(record.plan, planned.plan);
      if (planDifference)
        throw new Error(
          `${record.id}: the plan differs from the current configuration (${planDifference})`,
        );
      const risksDifference = jsonDifference(record.knownRisks, record.output ? planned.risks : []);
      if (risksDifference)
        throw new Error(`${record.id}: recorded risks differ (${risksDifference})`);
      let verification = null;
      if (record.output) {
        if (!planned.job)
          throw new Error(`${record.id}: a candidate exists for an image that needs no resize`);
        verification = verifyStandaloneImage({
          source: await readVerifiedImage(REPO_ROOT, planned.plan.source),
          candidate: await readCandidateImage(revision, record),
          plan: record.plan,
          output: record.output,
          label: record.id,
        });
      } else if (planned.job)
        throw new Error(`${record.id}: the image needs a resize but has no candidate`);
      const recordedDifference = jsonDifference(record.verification, verification);
      if (recordedDifference)
        throw new Error(
          `${record.id}: re-verification differs from the manifest (${recordedDifference})`,
        );
      results.push({ id: record.id, status: 'passed', verification });
    } catch (error) {
      results.push({ id: record.id, status: 'failed', error: error.message });
    }
  }
  const failures =
      checks.filter((item) => item.status !== 'passed').length +
      results.filter((item) => item.status !== 'passed').length,
    report = {
      schema: 'cro-magnon/optimized-runtime-verification@1',
      revision: manifest.revision,
      ...(base
        ? { base: { adoption: base.id, planSha256: base.planSha256 }, scope: manifest.scope }
        : {}),
      status: failures ? 'failed' : 'passed',
      candidateStatus: CANDIDATE_STATUS,
      verified:
        'local files only: hashes, ranges, extension headers, decoded bytes, accessors, skins, clips, images, standalone texture plans, sizes, alpha and aspect',
      notVerified: [
        'GPU upload or rendering',
        'visual appearance, UV-island bleeding, mural edges and tile seams, and LOD transitions',
        'runtime loader integration, caching and memory',
        'mobile devices',
      ],
      checks,
      files: results,
    };
  const text = JSON.stringify(report, null, 2) + '\n';
  if (values['write-report']) {
    const target = path.join(revision.absolute, REPORT_NAME);
    if (existsSync(target) && (await readFile(target, 'utf8')) !== text)
      throw new Error(
        `${revision.relative}/${REPORT_NAME} exists with different content; move it aside first`,
      );
    await writeFile(target, text);
  }
  process.stdout.write(text);
  if (failures) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.stack ?? error.message);
  process.exitCode = 1;
});
