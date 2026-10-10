// Generate runtime-optimization candidates for every eligible model GLB and every standalone
// runtime texture (the camp-cave images). Reads the current manifests and the public/models
// originals (verified by SHA-256 and length), writes only a new revision directory, and never
// adopts or publishes anything. With --base-adoption it writes a partial revision of the --only
// models instead, derived from the originals in that applied adoption's saved pre-apply
// manifests (revision-scope.mjs).
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import {
  CANDIDATE_STATUS,
  MANIFEST_SCHEMA,
  MESHOPTIMIZER_VERSION,
  ORIGINAL_KEPT_STATUS,
  STANDALONE_ROLE,
  STARTUP_ROLE,
  runtimeIndexOf,
} from './contract.mjs';
import {
  jsonDifference,
  packGlb,
  parseGlb,
  sha256,
  storedViewBytes,
  triangleCount,
  validateDocument,
} from './glb.mjs';
import { checkExtensions } from './gltf-usage.mjs';
import { sniffImage } from './images.mjs';
import { buildInventory, loadEligibilityRules, readVerifiedSource } from './inventory.mjs';
import { compressViews } from './meshopt-pack.mjs';
import {
  DEFAULT_REVISION,
  REPO_ROOT,
  candidateLocation,
  imageCandidateLocation,
  resolveRevisionDirectory,
} from './paths.mjs';
import {
  baseRecordOf,
  modelSummary,
  readBaseAdoption,
  selectWork,
  skippedStandalone,
  supersededModels,
} from './revision-scope.mjs';
import { prepareSourceSimplifier } from './source-simplify.mjs';
import { planStandaloneImages, readVerifiedImage } from './standalone-images.mjs';
import { buildStartupActor } from './startup-actor.mjs';
import {
  DEFAULT_PYTHON,
  applyTextures,
  planTextures,
  runTextureJobs,
  stageTextureInput,
} from './textures.mjs';
import { verifyDerived, verifyStandaloneImage, verifyStartup } from './verify.mjs';

const KNOWN_RISKS = Object.freeze({
  'rimo-neko':
    '2026-10-02: 1024 px textures bled unrelated texels across densely packed UV islands into the fur; inspect closely before any adoption.',
});
const USAGE = `Usage: node scripts/optimization/generate-candidates.mjs [options]
  Eligible model GLBs, startup actors and the standalone camp-cave textures.
  --out <dir>            new revision folder (default ${DEFAULT_REVISION})
  --python <exe>         Python with Pillow (default $OPTIMIZATION_PYTHON, $PERFORMANCE_PYTHON or the Codex runtime)
  --python-unisolated    run Python without -I (only if Pillow is in user site-packages)
  --edge-512 <keys>      comma-separated eligible models whose textures use 512 instead of 1024
  --maps-512 <keys>      comma-separated eligible models whose normal and data maps use 512; colour
                         stays 1024 (a key in both lists is refused)
  --webp-quality <1-100> quality for re-encoding lossy WebP (default 90)
  --color-filter <name>  lanczos (default) or box for colour textures
  --only <keys>          partial run for listed models; requires a separate --out
  --base-adoption <id>   partial revision of the --only models against this applied adoption, derived
                         from its saved pre-apply manifests; needs --only and a new --out; no startup
                         actors, sole-primary full models or standalone images
  --recipe exact-repack  instead: repack the files the applied --base-adoption SERVES, exactly
                         (lossless PNG IDAT rewrites, snow-ground/camp-mountain levels packed into one
                         file each, camp-cave's standalone PNGs); fixed scope; needs a new --out
  --dry-run              verify, parse and plan everything without writing or running Python`;

function readOptions(argv) {
  const { values } = parseArgs({
    args: argv,
    strict: true,
    allowPositionals: false,
    options: {
      out: { type: 'string', default: DEFAULT_REVISION },
      python: { type: 'string' },
      'python-unisolated': { type: 'boolean', default: false },
      'edge-512': { type: 'string', default: '' },
      'maps-512': { type: 'string', default: '' },
      'webp-quality': { type: 'string', default: '90' },
      'color-filter': { type: 'string', default: 'lanczos' },
      only: { type: 'string', default: '' },
      'base-adoption': { type: 'string' },
      recipe: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  });
  const list = (value) =>
      new Set(
        value
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean),
      ),
    webpQuality = Number(values['webp-quality']);
  if (!Number.isInteger(webpQuality) || webpQuality < 1 || webpQuality > 100)
    throw new Error('--webp-quality must be an integer from 1 to 100');
  if (!['lanczos', 'box'].includes(values['color-filter']))
    throw new Error('--color-filter must be lanczos or box');
  return {
    out: values.out,
    python:
      values.python ??
      process.env.OPTIMIZATION_PYTHON ??
      process.env.PERFORMANCE_PYTHON ??
      DEFAULT_PYTHON,
    isolated: !values['python-unisolated'],
    edge512: list(values['edge-512']),
    maps512: list(values['maps-512']),
    webpQuality,
    colorFilter: values['color-filter'],
    only: list(values.only),
    baseAdoption: values['base-adoption'] ?? null,
    recipe: values.recipe ?? null,
    dryRun: values['dry-run'],
    help: values.help,
  };
}

async function checkMeshoptimizer(root) {
  const manifest = JSON.parse(
    await readFile(path.join(root, 'node_modules', 'meshoptimizer', 'package.json'), 'utf8'),
  );
  // Only a transitive dependency today; never substitute another codec or version silently.
  if (manifest.version !== MESHOPTIMIZER_VERSION)
    throw new Error(
      `meshoptimizer ${manifest.version} is installed; this tool was checked against exactly ${MESHOPTIMIZER_VERSION} (encodeGltfBuffer version 0, EXT headers)`,
    );
}

// Standalone images are colour images: their owner's colour edge applies.
const colourEdges = (owners) => new Map([...owners].map(([key, edges]) => [key, edges.color]));

const standaloneSummary = (standalone) => ({
  owner: standalone.owner,
  inputs: standalone.inputs,
  images: standalone.images.map((item) => ({ id: item.id, ...item.plan, knownRisks: item.risks })),
  skipped: standalone.skipped,
});

async function loadSource(root, record) {
  const doc = parseGlb(await readVerifiedSource(root, record), record.url);
  validateDocument(doc.json, doc.bin, record.url);
  checkExtensions(doc.json, record.url);
  return doc;
}

/** Phase 1: verify, parse and plan every source; stage each distinct resize input once. */
async function prepare(root, selection, options, work) {
  const plans = new Map(),
    jobs = new Map();
  for (const file of selection.files) {
    const source = await loadSource(root, file),
      plan = planTextures(source.json, source.bin, {
        label: file.url,
        edge: file.edges,
        colorFilter: options.colorFilter,
        webpQuality: options.webpQuality,
      });
    for (const image of plan.images)
      if (image.job && !jobs.has(image.job.key)) {
        if (work)
          await stageTextureInput(
            work,
            image.job,
            storedViewBytes(source.json, source.bin, image.bufferView),
          );
        jobs.set(image.job.key, image.job);
      }
    plans.set(file.url, { plan, triangles: triangleCount(source.json) });
  }
  return { plans, jobs };
}

async function preflight(root, inventory, selection, standalone, options, base) {
  const { plans, jobs } = await prepare(root, selection, options, null),
    actors = [];
  for (const item of standalone.images) if (item.job) jobs.set(item.job.key, item.job);
  for (const actor of selection.startup) {
    const merged = buildStartupActor(
      await loadSource(root, inventory.files.get(actor.full)),
      await loadSource(root, inventory.files.get(actor.lod)),
      `${actor.modelKey} startup actor`,
    );
    // The per-vertex source maps go to the manifest; the dry run shows their size and hash.
    const primitives = merged.report.primitives.map((primitive) =>
      primitive.geometry.simplification?.sourceVertexIndices
        ? {
            ...primitive,
            geometry: {
              ...primitive.geometry,
              simplification: {
                ...primitive.geometry.simplification,
                sourceVertexIndices: `${primitive.geometry.simplification.sourceVertexIndices.length} entries (sha256 ${primitive.geometry.simplification.sourceVertexSha256})`,
              },
            },
          }
        : primitive,
    );
    actors.push({
      modelKey: actor.modelKey,
      full: actor.full,
      lod: actor.lod,
      ...merged.report,
      primitives,
    });
  }
  const images = [...plans.values()].flatMap(({ plan }) => plan.images);
  return {
    dryRun: true,
    ...(base
      ? {
          base: {
            adoption: base.id,
            planSha256: base.planSha256,
            sources: 'saved pre-apply manifests',
            supersedes: supersededModels(base, options.only),
          },
        }
      : {}),
    textureEdges: Object.fromEntries(selection.owners),
    plannedImages: [...plans.entries()].map(([url, { plan }]) => ({
      url,
      images: plan.images.map((image) => ({
        index: image.index,
        treatment: image.treatment,
        maximumEdge: image.maximumEdge,
        source: `${image.source.width}x${image.source.height}`,
        target: `${image.target.width}x${image.target.height}`,
        resized: image.resized,
      })),
    })),
    eligibleModels: inventory.models
      .filter((model) => model.eligible)
      .map((model) => [model.modelKey, model.reason]),
    excludedModels: inventory.models
      .filter((model) => !model.eligible)
      .map((model) => [model.modelKey, model.reason]),
    currentUniqueGlbs: inventory.files.size,
    currentUniqueBytes: [...inventory.files.values()].reduce((sum, file) => sum + file.bytes, 0),
    candidateSources: selection.files.length,
    candidateSourceBytes: selection.files.reduce((sum, file) => sum + file.bytes, 0),
    imagesToResize: images.filter((image) => image.resized).length,
    distinctResizeJobs: jobs.size,
    imagesUnchanged: images.filter((image) => !image.resized).length,
    warnings: [...plans.entries()].flatMap(([url, { plan }]) => [
      ...plan.warnings.map((warning) => `${url}: ${warning}`),
      ...plan.images.flatMap((image) =>
        image.warnings.map((warning) => `${url} image ${image.index}: ${warning}`),
      ),
    ]),
    startupActors: actors,
    standaloneImages: standaloneSummary(standalone),
  };
}

async function writeCandidate(staging, file, bytes) {
  const target = path.join(staging, ...file.split('/'));
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, bytes, { flag: 'wx' });
}

function risksFor(modelKeys, images, startupReport = null, startupVerification = null) {
  const risks = modelKeys.filter((key) => KNOWN_RISKS[key]).map((key) => KNOWN_RISKS[key]);
  if (images.some((image) => image.resized))
    risks.push(
      'Downsized textures can bleed across UV island borders; compare with the original in Chrome before adoption.',
    );
  if (startupReport) {
    const { byRetention } = startupReport.geometry.retained,
      retainedOf = (kind) =>
        startupReport.primitives.filter((primitive) => primitive.geometry.retention === kind),
      heads = retainedOf('head-primitive'),
      whole = retainedOf('whole-single-primitive'),
      storedOf = (list) =>
        list.reduce(
          (sum, item) =>
            sum +
            (startupVerification?.storedGeometryBytes.primitives.find(
              (entry) => entry.mesh === item.mesh && entry.primitive === item.primitive,
            )?.storedBytes ?? 0),
          0,
        ),
      cost = (kind, list) =>
        `+${byRetention[kind].vertices - byRetention[kind].replacedLodVertices} vertices, +${byRetention[kind].triangles - byRetention[kind].replacedLodTriangles} triangles, +${byRetention[kind].rawBytes - byRetention[kind].replacedLodRawBytes} raw bytes against the adopted LOD; ${storedOf(list)} stored bytes in the startup file`;
    risks.push(
      'Startup geometry is shown at every distance until the full model arrives; confirm close-range appearance and the upgrade swap in Chrome and WebKit.',
    );
    for (const primitive of startupReport.primitives) {
      const share = primitive.geometry.uvCharts?.lodCrossChartAreaShare ?? 0;
      if (primitive.geometry.source === 'adopted-lod' && share > 0.02)
        risks.push(
          `Adopted LOD primitive ${primitive.primitive} (${primitive.material ?? 'unnamed'}) puts ${(share * 100).toFixed(1)}% of its area on triangles spanning UV charts; inspect its texture close up.`,
        );
    }
    if (heads.length)
      risks.push(
        `${heads.length} head primitive(s) (${heads.map(({ material }) => material ?? 'unnamed').join(', ')}) keep the full model's geometry (${cost('head-primitive', heads)}). Check the neck where the full head meets the body (seam records); a runtime distance or far level must not swap these heads back to the adopted LOD geometry.`,
      );
    const derived = startupReport.primitives.filter(
        (primitive) => primitive.geometry.source === 'source-simplified',
      ),
      keptWhole = startupReport.primitives.filter((primitive) =>
        ['unreduced-whole-primitive', 'unsupported-whole-primitive'].includes(
          primitive.geometry.retention,
        ),
      );
    if (derived.length)
      risks.push(
        `${derived.length} primitive(s) are index-only reductions of their own original full primitive (${derived
          .map(
            ({ material, geometry: { simplification: s } }) =>
              `${material ?? 'unnamed'}: ${s.sourceTriangles} -> ${s.achievedTriangles} triangles, ${s.sourceVertexCount} -> ${s.achievedVertices} vertices, simplifier error about ${(s.resultErrorMetres * 1000).toFixed(2)} mm, target ${s.reachedTarget ? 'reached' : 'not reached'}`,
          )
          .join(
            '; ',
          )}). The simplifier's error is approximate and proves nothing about deformed surfaces or textures: inspect collars, necks, shoulders, armpits, straps, fur and cloaks close up in every clip, especially Attack.`,
      );
    for (const { material, geometry } of derived) {
      const share = geometry.simplification.uvCharts?.lodCrossChartAreaShare ?? 0;
      if (share > 0.02)
        risks.push(
          `Source-derived ${material ?? 'unnamed'} puts ${(share * 100).toFixed(1)}% of its area on triangles stretched like UV-chart breaks; inspect its texture close up.`,
        );
    }
    if (keptWhole.length)
      risks.push(
        `${keptWhole.length} primitive(s) (${keptWhole.map(({ material, geometry }) => `${material ?? 'unnamed'}: ${geometry.reason}`).join('; ')}) are kept whole: a safe case, not a geometry optimization.`,
      );
    if (whole.length)
      risks.push(
        `Single-primitive actor: its whole primitive (${whole.map(({ material }) => material ?? 'unnamed').join(', ')}) keeps the full model's geometry because the adopted LOD face is damaged (${cost('whole-single-primitive', whole)}). This is the full model's geometry cost, not a head-only one, and is not claimed to meet any FPS or mobile geometry budget; a runtime far level must not reintroduce the adopted LOD.`,
      );
    // Retained heads differ from today's LOD in geometry (above); these are the tangent-less LOD ones.
    const differing = startupReport.shading.differsFromExistingLod.filter(
      ({ mesh, primitive }) =>
        startupReport.primitives.find((item) => item.mesh === mesh && item.primitive === primitive)
          .geometry.source === 'adopted-lod',
    );
    if (differing.length)
      risks.push(
        `${differing.length} normal-mapped primitive(s) (${differing.map(({ material }) => material ?? 'unnamed').join(', ')}) have no TANGENT, as in the adopted LOD. Loaded alone, GLTFLoader shades them with derivative tangents and normalScale.y negated; today's performance-lod.ts LOD shades the same geometry with the full material's un-negated normalScale. Compare both with the full model, and keep each geometry with its own file's material on upgrade.`,
      );
  }
  return risks;
}

const imageSummary = (images) =>
  images.map((image) => ({
    index: image.index,
    mimeType: image.mimeType,
    treatment: image.treatment,
    maximumEdge: image.maximumEdge,
    resized: image.resized,
    filter: image.filter,
    encoding: image.encoding,
    source: {
      width: image.source.width,
      height: image.source.height,
      bytes: image.source.bytes,
      sha256: image.source.sha256,
    },
    output: image.output,
    uses: image.uses,
  }));

function outputSummary(location, digest, bytes, json, edge, edges, images, triangles) {
  return {
    file: location.file,
    url: location.url,
    sha256: digest,
    bytes,
    triangles,
    maximumTextureEdge: edge,
    textureEdges: edges,
    extensionsUsed: json.extensionsUsed ?? [],
    extensionsRequired: json.extensionsRequired ?? [],
    images: imageSummary(images),
  };
}

const textureSummary = (plan, images) => ({
  resized: images.filter((image) => image.resized).length,
  unchanged: images.filter((image) => !image.resized).length,
  warnings: [
    ...plan.warnings,
    ...plan.images.flatMap((image) =>
      image.warnings.map((warning) => `image ${image.index}: ${warning}`),
    ),
  ],
});

async function generate(root, inventory, selection, standalone, options, staging) {
  const work = path.join(staging, '.work'),
    { plans, jobs } = await prepare(root, selection, options, work);
  for (const item of standalone.images)
    if (item.job && !jobs.has(item.job.key)) {
      await stageTextureInput(work, item.job, item.data);
      jobs.set(item.job.key, item.job);
    }
  const textureRun = await runTextureJobs([...jobs.values()], {
      python: options.python,
      isolated: options.isolated,
      workDir: work,
    }),
    records = [],
    imageRecords = [],
    candidates = new Map();
  for (const file of selection.files) {
    const source = await loadSource(root, file),
      { plan } = plans.get(file.url),
      textured = applyTextures(source.json, source.bin, plan.images, textureRun.outputs, file.url),
      packed = await compressViews(textured.json, textured.bin, file.url),
      bytes = packGlb(packed.json, packed.bin),
      digest = sha256(bytes),
      location = candidateLocation(file.url, digest);
    await writeCandidate(staging, location.file, bytes);
    const verification = await verifyDerived({
      source,
      output: parseGlb(bytes, location.file),
      textures: textured.images,
      edge: file.edge,
      edges: file.edges,
      label: file.url,
    });
    candidates.set(file.url, { location, digest, bytes: bytes.length });
    const modelKeys = [...new Set(file.uses.map((use) => use.modelKey))];
    records.push({
      id: file.url,
      role: [...new Set(file.uses.map((use) => use.role))].join('+'),
      uses: file.uses,
      source: {
        url: file.url,
        sha256: file.sha256,
        bytes: file.bytes,
        triangles: triangleCount(source.json),
        images: plan.images.map((image) => ({
          index: image.index,
          mimeType: image.mimeType,
          ...image.source,
        })),
      },
      output: outputSummary(
        location,
        digest,
        bytes.length,
        packed.json,
        file.edge,
        file.edges,
        textured.images,
        verification.triangles,
      ),
      derivation: { textures: textureSummary(plan, textured.images), meshopt: packed.report },
      verification,
      status: CANDIDATE_STATUS,
      knownRisks: risksFor(modelKeys, textured.images),
    });
    console.error(`candidate ${location.url} (${file.bytes} -> ${bytes.length} bytes)`);
  }
  for (const actor of selection.startup) {
    const label = `${actor.modelKey} startup actor`,
      fullRecord = inventory.files.get(actor.full),
      lodRecord = inventory.files.get(actor.lod),
      full = await loadSource(root, fullRecord),
      lod = await loadSource(root, lodRecord),
      merged = buildStartupActor(full, lod, label),
      plan = planTextures(merged.json, merged.bin, {
        label,
        edge: actor.edges,
        colorFilter: options.colorFilter,
        webpQuality: options.webpQuality,
      });
    for (const image of plan.images)
      if (image.job && !textureRun.outputs.has(image.job.key))
        throw new Error(`${label}: image ${image.index} was not resized for the full model`);
    const textured = applyTextures(merged.json, merged.bin, plan.images, textureRun.outputs, label),
      packed = await compressViews(textured.json, textured.bin, label),
      bytes = packGlb(packed.json, packed.bin),
      digest = sha256(bytes),
      location = candidateLocation(actor.full, digest, 'startup');
    await writeCandidate(staging, location.file, bytes);
    const upgrade = candidates.get(actor.full),
      highOutput = parseGlb(
        await readFile(path.join(staging, ...upgrade.location.file.split('/'))),
        upgrade.location.file,
      ),
      verification = await verifyStartup({
        high: full,
        lod,
        output: parseGlb(bytes, location.file),
        highOutput,
        edge: actor.edge,
        label,
        startup: merged.report,
      });
    records.push({
      id: `startup:${actor.modelKey}`,
      role: STARTUP_ROLE,
      uses: [{ modelKey: actor.modelKey, role: STARTUP_ROLE, lodIndex: null }],
      source: {
        geometry: {
          url: lodRecord.url,
          sha256: lodRecord.sha256,
          bytes: lodRecord.bytes,
          triangles: triangleCount(lod.json),
        },
        full: {
          url: fullRecord.url,
          sha256: fullRecord.sha256,
          bytes: fullRecord.bytes,
          triangles: triangleCount(full.json),
        },
      },
      output: outputSummary(
        location,
        digest,
        bytes.length,
        packed.json,
        actor.edge,
        actor.edges,
        textured.images,
        verification.triangles,
      ),
      upgrade: {
        sourceUrl: actor.full,
        url: upgrade.location.url,
        sha256: upgrade.digest,
        bytes: upgrade.bytes,
      },
      lodDistanceMetres: actor.lodDistanceMetres,
      derivation: {
        startup: merged.report,
        textures: textureSummary(plan, textured.images),
        meshopt: packed.report,
      },
      verification,
      status: CANDIDATE_STATUS,
      knownRisks: risksFor([actor.modelKey], textured.images, merged.report, verification),
    });
    console.error(`startup actor ${location.url} (${bytes.length} bytes)`);
  }
  for (const item of standalone.images) {
    const { plan } = item;
    if (!item.job) {
      imageRecords.push({
        id: item.id,
        role: STANDALONE_ROLE,
        plan,
        output: null,
        verification: null,
        status: ORIGINAL_KEPT_STATUS,
        knownRisks: [],
      });
      continue;
    }
    const bytes = textureRun.outputs.get(item.job.key),
      digest = sha256(bytes),
      info = sniffImage(bytes),
      location = imageCandidateLocation(plan.source.url, digest),
      output = {
        file: location.file,
        url: location.url,
        sha256: digest,
        bytes: bytes.length,
        format: info.format,
        mimeType: plan.source.mimeType,
        width: info.width,
        height: info.height,
        alpha: info.alpha,
        maximumTextureEdge: plan.edge,
      };
    await writeCandidate(staging, location.file, bytes);
    const verification = verifyStandaloneImage({
      source: await readVerifiedImage(root, plan.source),
      candidate: bytes,
      plan,
      output,
      label: item.id,
    });
    imageRecords.push({
      id: item.id,
      role: STANDALONE_ROLE,
      plan,
      output,
      verification,
      status: CANDIDATE_STATUS,
      knownRisks: item.risks,
    });
    console.error(
      `standalone texture ${location.url} (${plan.source.bytes} -> ${bytes.length} bytes)`,
    );
  }
  // The originals must still be exactly what the manifests describe.
  for (const file of selection.files) await readVerifiedSource(root, file);
  for (const item of standalone.images) await readVerifiedImage(root, item.plan.source);
  return { records, imageRecords, candidates, toolchain: textureRun.toolchain };
}

function manifestOf(revision, inventory, rules, selection, standalone, options, result, base) {
  const derived = result.records.filter((record) => record.role !== STARTUP_ROLE),
    actors = result.records.filter((record) => record.role === STARTUP_ROLE),
    images = result.records.flatMap((record) => record.output.images),
    textures = result.imageRecords.filter((record) => record.output);
  return {
    schema: MANIFEST_SCHEMA,
    revision: path.basename(revision.absolute),
    directory: revision.relative,
    status: 'candidate',
    adoption: 'not-adopted',
    visualQa: 'pending-codex-chrome',
    gpuValidation: 'not-performed',
    scope: { complete: !options.only.size, only: [...options.only].sort() },
    ...(base ? { base: baseRecordOf(base, options.only) } : {}),
    policy: {
      maximumTextureEdge: 1024,
      stricter512: [...options.edge512].sort(),
      maps512: [...options.maps512].sort(),
      textures:
        'downsize only, never upscale; same image format and mime type; alpha and colour chunks kept',
      textureEdges:
        'each image records its treatment and maximumEdge: colour and unsampled images use the colour edge, normal and data maps their own; stricter512 sets all three to 512, maps512 only normal and data',
      meshopt:
        'EXT_meshopt_compression, lossless: attribute codec v0, index codec v1, no filters, no quantisation, no reordering',
      standaloneTextures: base
        ? `not planned: a partial revision on ${base.id} keeps the base's adopted standalone images`
        : 'runtime-loaded images declared by current manifests and runtime configuration; whole-image downsize only (no crop, pad, repack or redraw), same format, alpha and colour chunks, premultiplied alpha, repeat-wrapped textures filtered across their edges; UV rectangles stay normalised by the source size',
      provenance: base
        ? `deterministic derivatives of the original GLBs that ${base.id}'s saved pre-apply manifests record, never of its served candidates; not a new model or image generation; originals unchanged`
        : 'deterministic derivatives of the adopted TRELLIS-lineage GLBs and of the audited cave images; not a new model or image generation; originals unchanged',
    },
    inputs: {
      manifests: inventory.manifests,
      eligibility: rules.inputs,
      standaloneImages: standalone.inputs,
    },
    options: {
      webpQuality: options.webpQuality,
      colorFilter: options.colorFilter,
      pythonIsolated: options.isolated,
    },
    toolchain: {
      node: process.version,
      meshoptimizer: MESHOPTIMIZER_VERSION,
      python: result.toolchain?.python ?? null,
      pillow: result.toolchain?.pillow ?? null,
      webp: result.toolchain?.webp ?? null,
    },
    totals: {
      models: inventory.models.length,
      eligibleModels: inventory.models.filter((model) => model.eligible).length,
      excludedModels: inventory.models.filter((model) => !model.eligible).length,
      selectedModels: selection.chosen.length,
      currentUniqueGlbs: inventory.files.size,
      currentUniqueBytes: [...inventory.files.values()].reduce((sum, file) => sum + file.bytes, 0),
      candidateFiles: derived.length,
      candidateSourceBytes: derived.reduce((sum, record) => sum + record.source.bytes, 0),
      candidateBytes: derived.reduce((sum, record) => sum + record.output.bytes, 0),
      startupActors: actors.length,
      startupActorBytes: actors.reduce((sum, record) => sum + record.output.bytes, 0),
      // Stored (compressed) bytes of full-model geometry the startup actors retain.
      startupRetainedGeometryStoredBytes: actors.reduce(
        (sum, record) => sum + record.verification.storedGeometryBytes.retainedFull,
        0,
      ),
      startupSourceSimplifiedStoredBytes: actors.reduce(
        (sum, record) => sum + record.verification.storedGeometryBytes.sourceSimplified,
        0,
      ),
      imagesResized: images.filter((image) => image.resized).length,
      imagesUnchanged: images.filter((image) => !image.resized).length,
      compressedViews: result.records.reduce(
        (sum, record) => sum + record.verification.compressedViews,
        0,
      ),
      standaloneTextures: result.imageRecords.length,
      standaloneTextureCandidates: textures.length,
      standaloneTextureSourceBytes: textures.reduce(
        (sum, record) => sum + record.plan.source.bytes,
        0,
      ),
      standaloneTextureBytes: textures.reduce((sum, record) => sum + record.output.bytes, 0),
    },
    originals: {
      checked: selection.files.length,
      standaloneImagesChecked: result.imageRecords.length,
      unchangedAfterGeneration: true,
    },
    standaloneImageOwner: standalone.owner,
    standaloneImagesSkipped: standalone.skipped,
    models: inventory.models.map((model) =>
      modelSummary(
        model,
        selection.chosen.includes(model),
        (url) => result.candidates.get(url)?.location.url ?? null,
        actors.find((record) => record.uses[0].modelKey === model.modelKey)?.output.url ?? null,
      ),
    ),
    files: result.records,
    images: result.imageRecords,
  };
}

const writeJson = (file, value) =>
  writeFile(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });

async function listFiles(directory, prefix = '') {
  const entries = (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    ),
    files = [];
  for (const entry of entries) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory())
      files.push(...(await listFiles(path.join(directory, entry.name), relative)));
    else if (entry.isFile()) files.push(relative);
    else throw new Error(`unexpected non-file entry ${relative}`);
  }
  return files;
}

async function treeDifference(created, existing) {
  const a = await listFiles(created),
    b = await listFiles(existing);
  if (a.join('\n') !== b.join('\n'))
    return `file lists differ (${a.length} generated, ${b.length} existing)`;
  for (const file of a) {
    const [x, y] = await Promise.all([
      readFile(path.join(created, ...file.split('/'))),
      readFile(path.join(existing, ...file.split('/'))),
    ]);
    if (!x.equals(y)) return `${file} differs`;
  }
  return null;
}

/** Move the finished staging folder into place, or accept a byte-identical regeneration (never for
 * a `fresh` revision, which must not exist yet). */
async function commit(staging, target, { fresh = false } = {}) {
  await rm(path.join(staging, '.work'), { recursive: true, force: true });
  if (!existsSync(target)) {
    await rename(staging, target);
    return 'created';
  }
  if (fresh) {
    await rm(staging, { recursive: true, force: true });
    throw new Error(
      `Refusing to write into ${target}, which appeared during generation; a partial revision needs a new --out`,
    );
  }
  const difference = await treeDifference(staging, target);
  await rm(staging, { recursive: true, force: true });
  if (difference)
    throw new Error(
      `Refusing to overwrite the different existing revision ${target}: ${difference}`,
    );
  return 'identical-regeneration';
}

async function main() {
  const options = readOptions(process.argv.slice(2));
  if (options.help) return console.log(USAGE);
  if (options.recipe !== null) {
    // Exact repack of an applied adoption's served files (exact-repack.mjs); no encoder runs.
    if (options.recipe !== 'exact-repack')
      throw new Error(`unknown --recipe ${options.recipe}; the only recipe is exact-repack`);
    if (!options.baseAdoption)
      throw new Error('--recipe exact-repack needs --base-adoption=<applied adoption>');
    if (options.only.size || options.edge512.size || options.maps512.size)
      throw new Error(
        '--recipe exact-repack has a fixed, reviewed scope; --only, --edge-512 and --maps-512 do not apply',
      );
    const { generateExactRepack } = await import('./exact-repack.mjs'),
      rules = await loadEligibilityRules(REPO_ROOT);
    return console.log(
      JSON.stringify(
        await generateExactRepack(REPO_ROOT, {
          base: options.baseAdoption,
          out: options.out,
          rules,
          dryRun: options.dryRun,
        }),
        null,
        2,
      ),
    );
  }
  const revision = resolveRevisionDirectory(REPO_ROOT, options.out);
  if (options.only.size && revision.relative === DEFAULT_REVISION)
    throw new Error('--only writes a partial revision; pass a separate --out');
  if (options.baseAdoption) {
    if (!options.only.size)
      throw new Error('--base-adoption writes a partial revision; list its models with --only');
    if (existsSync(revision.absolute))
      throw new Error(
        `--base-adoption needs a new --out; ${revision.relative} already exists and is never reused`,
      );
  }
  await checkMeshoptimizer(REPO_ROOT);
  await prepareSourceSimplifier();
  const rules = await loadEligibilityRules(REPO_ROOT),
    base = options.baseAdoption
      ? await readBaseAdoption(REPO_ROOT, options.baseAdoption, rules)
      : null,
    inventory = base ? base.inventory : await buildInventory(REPO_ROOT, rules),
    selection = selectWork(inventory, options, base),
    standalone = base
      ? skippedStandalone(base)
      : await planStandaloneImages(REPO_ROOT, {
          inventory,
          rules,
          edges: colourEdges(selection.owners),
          colorFilter: options.colorFilter,
          webpQuality: options.webpQuality,
        });
  if (base && selection.startup.length)
    throw new Error('a partial revision on a base adoption has no startup actors');
  if (options.dryRun)
    return console.log(
      JSON.stringify(
        await preflight(REPO_ROOT, inventory, selection, standalone, options, base),
        null,
        2,
      ),
    );
  const staging = path.join(
    path.dirname(revision.absolute),
    `.${path.basename(revision.absolute)}.staging-${process.pid}-${Date.now()}`,
  );
  await mkdir(staging, { recursive: true });
  try {
    const result = await generate(REPO_ROOT, inventory, selection, standalone, options, staging),
      manifest = manifestOf(
        revision,
        inventory,
        rules,
        selection,
        standalone,
        options,
        result,
        base,
      );
    if (base) {
      // The base must still be applied, unchanged, when the revision is written.
      const again = await readBaseAdoption(REPO_ROOT, base.id, rules),
        difference =
          jsonDifference(baseRecordOf(again, options.only), manifest.base) ??
          jsonDifference(again.inventory.manifests, inventory.manifests);
      if (difference)
        throw new Error(`Base adoption ${base.id} changed during generation (${difference})`);
    }
    await writeJson(path.join(staging, 'manifest.json'), manifest);
    await writeJson(path.join(staging, 'runtime-index.json'), runtimeIndexOf(manifest));
    const outcome = await commit(staging, revision.absolute, { fresh: !!base });
    console.log(
      JSON.stringify(
        { revision: revision.relative, outcome, status: manifest.status, totals: manifest.totals },
        null,
        2,
      ),
    );
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

main().catch((error) => {
  console.error(error.stack ?? error.message);
  process.exitCode = 1;
});
