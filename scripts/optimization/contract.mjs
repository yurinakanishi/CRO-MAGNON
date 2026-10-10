// Manifest contract shared by the generator and the verifier. The compact runtime index
// is what a future loader would read; it is derived from the audit manifest only.
export const MANIFEST_SCHEMA = 'cro-magnon/optimized-runtime-candidates@1';
export const RUNTIME_INDEX_SCHEMA = 'cro-magnon/runtime-candidate-index@1';
export const CANDIDATE_STATUS = 'candidate-pending-visual-qa';
export const STARTUP_ROLE = 'startup-actor';
export const STANDALONE_ROLE = 'standalone-texture';
// A revision whose files are exact repacks of an applied adoption's served files (exact-repack.mjs):
// lossless PNG IDAT rewrites and multi-scene packing, nothing else.
export const EXACT_REPACK_RECIPE = 'exact-repack@1';
export const PACKED_ROLE = 'packed-levels';
// Reduced (not lossless) current primaries of explicitly listed models (guarded-surface.mjs).
export const GUARDED_RECIPE = 'guarded-surface@1';
// A standalone texture already within the maximum edge keeps its original; no candidate file.
export const ORIGINAL_KEPT_STATUS = 'original-within-edge';

/**
 * `runtime-index.json` `textures[<current manifest url>]`: one verified standalone texture.
 * A loader refuses it unless `sourceSha256`/`sourceBytes` equal the current manifest record,
 * verifies `sha256`/`bytes` after download, and keeps `colorSpace` and `wrap` as today. Atlas
 * rectangles stay normalised by `uvSource` (the original's pixel size), never by `width`/`height`.
 * @typedef {object} StandaloneTextureIndexRecord
 * @property {string} owner             model key whose manifest declares the image
 * @property {string} manifestEntry     path of the record in that manifest, e.g. `mascotPigments.roundBots`
 * @property {string} sourceSha256
 * @property {number} sourceBytes
 * @property {string} url               candidate URL, `/models/<owner>/<name>.opt-<sha16>.<ext>`
 * @property {string} sha256
 * @property {number} bytes
 * @property {'image/png'|'image/jpeg'|'image/webp'} mimeType
 * @property {number} width
 * @property {number} height
 * @property {{ width: number, height: number }} uvSource
 * @property {boolean} alpha
 * @property {'srgb'} colorSpace
 * @property {'clamp-to-edge'|'repeat'} wrap
 */
// The only full-model attribute an adopted LOD may lack. glTF makes tangents optional and
// GLTFLoader then uses derivative tangents (cloning the material with normalScale.y negated).
// The current runtime already renders these LODs without tangents, but under the full mesh's
// un-negated material, so normal-mapped shading differs (startup report `shading`).
export const OPTIONAL_LOD_ATTRIBUTES = Object.freeze(['TANGENT']);

/** Primitives whose startup and upgrade geometry need different three.js material instances. */
export const materialPairingOf = (startupReport) => ({
  rule: 'keep each geometry with the material GLTFLoader assigns to it in its own file: the derivative-tangent clone (normalScale.y negated) for startup geometry without TANGENT, the authored material for upgrade geometry with TANGENT; never move one onto the other',
  primitives: startupReport.primitives
    .filter(
      ({ shading }) => shading.normalMap && shading.startup.tangents !== shading.upgrade.tangents,
    )
    .map(({ mesh, primitive, material, shading }) => ({
      mesh,
      primitive,
      material,
      startup: shading.startup,
      upgrade: shading.upgrade,
    })),
});

// meshoptimizer is only a transitive dependency today; the encoder defaults and EXT headers were
// checked against exactly this version. A later package/runtime task must pin it explicitly.
export const MESHOPTIMIZER_VERSION = '1.1.1';

// Fields a manifest records only since per-image texture edges and base adoptions; an index
// derived from an older manifest stays exactly as it was.
const edgesOf = (output) => (output.textureEdges ? { textureEdges: output.textureEdges } : {});
const baseOf = (manifest) =>
  manifest.base
    ? {
        // A partial revision: it supersedes only `scope.only` of this applied adoption.
        base: {
          adoption: manifest.base.adoption,
          planSha256: manifest.base.planSha256,
          candidateRevision: manifest.base.candidateRevision.directory,
        },
        scope: { complete: manifest.scope.complete, only: manifest.scope.only },
      }
    : {};

const decoderOf = (manifest) => ({
  extension: 'EXT_meshopt_compression',
  required: manifest.files.some((record) =>
    record.output.extensionsRequired.includes('EXT_meshopt_compression'),
  ),
  module: 'three/addons/libs/meshopt_decoder.module.js',
  loader: 'GLTFLoader.setMeshoptDecoder(MeshoptDecoder) before parseAsync',
});

/** The index of an exact-repack revision: per model the one file it serves and each level's scene. */
function repackIndexOf(manifest) {
  return {
    schema: RUNTIME_INDEX_SCHEMA,
    revision: manifest.revision,
    status: CANDIDATE_STATUS,
    adopted: false,
    recipe: manifest.recipe,
    base: { adoption: manifest.base.adoption, planSha256: manifest.base.planSha256 },
    scope: manifest.scope,
    decoder: decoderOf(manifest),
    models: Object.fromEntries(
      manifest.files.map((record) => [
        record.modelKey,
        {
          url: record.output.url,
          sha256: record.output.sha256,
          bytes: record.output.bytes,
          extensionsRequired: record.output.extensionsRequired,
          levels: record.output.scenes.map((scene) => ({
            ...(record.output.packed ? { scene: scene.scene } : {}),
            triangles: scene.triangles,
            sourceUrl: record.source.levels[scene.level].url,
            sourceSha256: record.source.levels[scene.level].sha256,
          })),
        },
      ]),
    ),
    textures: Object.fromEntries(
      manifest.images
        .filter((record) => record.output)
        .map((record) => [
          record.original.url,
          {
            owner: record.owner,
            manifestEntry: record.manifestEntry,
            sourceUrl: record.source.url,
            sourceSha256: record.source.sha256,
            url: record.output.url,
            sha256: record.output.sha256,
            bytes: record.output.bytes,
            width: record.output.width,
            height: record.output.height,
          },
        ]),
    ),
  };
}

/** The index of a guarded-surface@1 revision: per model the one primary file it now serves. */
function guardedIndexOf(manifest) {
  return {
    schema: RUNTIME_INDEX_SCHEMA,
    revision: manifest.revision,
    status: CANDIDATE_STATUS,
    adopted: false,
    recipe: manifest.recipe,
    base: { adoption: manifest.base.adoption, planSha256: manifest.base.planSha256 },
    scope: manifest.scope,
    decoder: decoderOf(manifest),
    models: Object.fromEntries(
      manifest.files.map((record) => [
        record.modelKey,
        {
          selection: record.selection,
          url: record.output.url,
          sha256: record.output.sha256,
          bytes: record.output.bytes,
          triangles: record.output.triangles,
          extensionsRequired: record.output.extensionsRequired,
          sourceUrl: record.source.url,
          sourceSha256: record.source.sha256,
        },
      ]),
    ),
  };
}

export function runtimeIndexOf(manifest) {
  if (manifest.recipe === EXACT_REPACK_RECIPE) return repackIndexOf(manifest);
  if (manifest.recipe === GUARDED_RECIPE) return guardedIndexOf(manifest);
  // Never read a manifest of another recipe as a legacy one.
  if (manifest.recipe !== undefined)
    throw new Error(`${manifest.revision} names the unknown recipe ${manifest.recipe}`);
  const derived = manifest.files.filter((record) => record.role !== STARTUP_ROLE),
    actors = manifest.files.filter((record) => record.role === STARTUP_ROLE);
  return {
    schema: RUNTIME_INDEX_SCHEMA,
    revision: manifest.revision,
    status: CANDIDATE_STATUS,
    adopted: false,
    ...baseOf(manifest),
    decoder: {
      extension: 'EXT_meshopt_compression',
      required: manifest.files.some((record) =>
        record.output.extensionsRequired.includes('EXT_meshopt_compression'),
      ),
      module: 'three/addons/libs/meshopt_decoder.module.js',
      loader: 'GLTFLoader.setMeshoptDecoder(MeshoptDecoder) before parseAsync',
    },
    files: Object.fromEntries(
      derived.map((record) => [
        record.source.url,
        {
          sourceSha256: record.source.sha256,
          sourceBytes: record.source.bytes,
          url: record.output.url,
          sha256: record.output.sha256,
          bytes: record.output.bytes,
          maximumTextureEdge: record.output.maximumTextureEdge,
          ...edgesOf(record.output),
          extensionsRequired: record.output.extensionsRequired,
        },
      ]),
    ),
    startupActors: Object.fromEntries(
      actors.map((record) => [
        record.uses[0].modelKey,
        {
          url: record.output.url,
          sha256: record.output.sha256,
          bytes: record.output.bytes,
          maximumTextureEdge: record.output.maximumTextureEdge,
          ...edgesOf(record.output),
          extensionsRequired: record.output.extensionsRequired,
          geometrySource: {
            url: record.source.geometry.url,
            sha256: record.source.geometry.sha256,
          },
          fullSource: { url: record.source.full.url, sha256: record.source.full.sha256 },
          upgrade: {
            url: record.upgrade.url,
            sha256: record.upgrade.sha256,
            bytes: record.upgrade.bytes,
          },
          lodDistanceMetres: record.lodDistanceMetres,
          structure:
            'same nodes, skins, joint order, mesh/primitive order, glTF materials, textures and clips as the upgrade; geometry per primitive from the full model (retained) or the adopted LOD, as listed in geometry',
          // The player's low level: a distance LOD must never swap retained primitives back to the
          // adopted LOD geometry; the full upgrade replaces geometry only, keeping pose and root.
          lowLevel: record.derivation.startup.geometry.lowLevel,
          // Every primitive comes from the startup file (full-model: byte-equal to the upgrade;
          // source-simplified: a recorded index-only reduction of the upgrade's primitive), never
          // from the adopted LOD file. adopted-lod appears only under diagnostic policies.
          geometry: record.derivation.startup.geometry.primitives.map(
            ({ mesh, primitive, material, source, retention }) => ({
              mesh,
              primitive,
              material,
              source,
              retention,
            }),
          ),
          materialPairing: materialPairingOf(record.derivation.startup),
        },
      ]),
    ),
    textures: Object.fromEntries(
      (manifest.images ?? [])
        .filter((record) => record.output)
        .map((record) => [
          record.plan.source.url,
          /** @type {StandaloneTextureIndexRecord} */ ({
            owner: record.plan.owner,
            manifestEntry: record.plan.manifestEntry,
            sourceSha256: record.plan.source.sha256,
            sourceBytes: record.plan.source.bytes,
            url: record.output.url,
            sha256: record.output.sha256,
            bytes: record.output.bytes,
            mimeType: record.output.mimeType,
            width: record.output.width,
            height: record.output.height,
            uvSource: record.plan.uv.normalizedBy,
            alpha: record.output.alpha,
            colorSpace: record.plan.colorSpace,
            wrap: record.plan.uv.wrap,
          }),
        ]),
    ),
  };
}
