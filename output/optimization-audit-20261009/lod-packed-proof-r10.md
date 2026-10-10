# LOD multi-scene packing proof r10 (output-only)

**Status: run01 failed at its self-tests, before any packing; corrected and not yet re-run.** Codex
runs it and reviews it independently. Nothing here is adopted, served or loadable, and no production
file, schema, asset, adoption record or server was changed.

## Run history

- **run01** (`lod-packed-proof-r10-run01/result.json`; executed source frozen in `lod-packed-proof-r10-source/`):
  - 18 of 19 self-tests behaved as expected. The case "refuse: samplerless textures … conflicting colour spaces" completed instead of refusing.
  - **Cause, a fixture bug:** `synthetic()` destructured `sampler = SAMPLER`. A default parameter also replaces an explicit `undefined`, so the D0/D1 fixtures carried a sampler and were never samplerless.
  - The packing refusal itself was never reached by that fixture. Nothing was packed or written except `result.json`.
- **Correction** (self-test file only; no production function changed):
  - **`null` sentinel:** `sampler: null` now builds a truly samplerless texture (no `texture.sampler`, no `samplers` array). Any other non-object value throws.
  - **Shape assertions:** every accepting case (A–C) and the samplerless refusal (D) first read the built GLB back and assert its shape: sampler presence, sampler count, slot, MIME type and identical image bytes. A mis-built fixture now fails with a message no refusal pattern matches.
  - **Exact refusal message:** D now requires the full message (`have no sampler, so GLTFLoader would share one Texture with colour spaces srgb and linear`).
  - **Tamper cases:** both now require the specific "packed scene 1 differs" report rather than any problem.
  - Self-tests and the real run call the same `packLevels`, `verifyPacked`, `threeParse`, `compareThreeScenes`, `decodeBoth` and `checkBytes`.

## Why this exists, and what it does not claim

This is one pixel-preserving part of 方針4, item 5 in `GAME_IMPROVEMENT_PLAN.md` (「同じ画像を繰り返し送らない」).
The startup goal remains: about 5 s from confirmation to normal-world controls, with a provisional
mandatory budget of 4 MB including title-side preloads.

The r09 review counted about 6.85 MB of duplicate embedded images in two templates, about 5.5 s of
transfer at 10 Mbps. **Removing them does not solve the startup problem.** It does not touch:
- the self actor (5.41 MB);
- the cave and murals;
- the title modules;
- the readiness design itself.

That design is Runtime026's output-only whole-startup work; lossless PNG is Publisher587's proof.
This proof makes **no** GPU, visual, decode, load-speed or startup claim.

## Files

| File | Role |
|---|---|
| `lod-packed-proof-r10.mjs` | Entry point: inputs, ancestry, packing, verification, the fresh output |
| `lod-packed-proof-r10-lib.mjs` | Pure packing and independent verification (no file writes) |
| `lod-packed-proof-r10-selftest.mjs` | Synthetic in-memory GLBs run through the same code |

```
node output/optimization-audit-20261009/lod-packed-proof-r10.mjs --out output/optimization-audit-20261009/<new directory>
```

`--out` must be a new directory directly inside this audit directory. It is created non-recursively,
and the run fails if the directory exists. The run writes only:
- `result.json` (always, with `status` `passed` or `failed`);
- `<key>/<key>.levels-packed.<sha16>.glb`, only for a template whose verification passed.

It reuses `scripts/optimization/glb.mjs`, `gltf-usage.mjs`, `verify.mjs`, `paths.mjs` and
`scripts/runtime-graph.mjs` read-only, plus the installed Three r185 and meshoptimizer 1.1.1. No
dependency is added and no encoder runs: meshopt streams are copied verbatim.

## Scope and inputs (gates, in order)

The templates in scope are `snow-ground` (full model plus LOD 1 and LOD 2) and `camp-mountain` (full model
plus `lod-performance`). Each gate below must pass before any packing:

1. **Self-tests** (below) must all behave as expected. Otherwise nothing is packed.
2. **r05-a02 adoption record.**
   - `plan.json` SHA-256 is exactly `2697ba72…ce444`, and the plan is complete.
   - `journal.json` belongs to that plan and its state is `applied`.
   - The plan and the journal both name base `20261009-r04-a01` with plan SHA-256 `3be1a8bf…ecc8`.
3. **r04-a01 adoption record.** Its plan SHA-256 and applied journal are checked the same way, and it has no base of its own.
4. **r04 candidate revision files** (`manifest.json`, `runtime-index.json`, `verification.json`): SHA-256 and length must match the r05 plan's record.
5. **Both templates in the r05 graph.**
   - The selection is `ordinary-compressed`, the key is not in r05's scope, and `candidateRevision` is r04 with `adoptedBy` `20261009-r04-a01`.
   - `primary` and `lods` must equal the r04 graph exactly. This records the unchanged r04 ancestry.
6. **Current manifests.**
   - Each `public/models/<key>/asset.json` must be byte-exact (SHA-256 and length) to what r05 wrote, carry r05's stamp, and name the graph's served files.
   - The catalog entries must name the same files. The catalog's own SHA-256 is recorded, but not required to match.
7. **Ancestry and file bytes.**
   - Each served file must be the r04 candidate output of its recorded original, and that candidate's verification must have passed.
   - Served and original GLBs are read and checked for exact SHA-256 and length; originals are only read.
   - Each served file's triangle count must equal the graph's.

## Packing rules

- **One GLB per template; scene *i* is level *i*.** Every level keeps its own nodes, meshes, accessors, materials, textures, images and samplers. The runtime mutates materials per level, and GLTFLoader caches meshes and geometry per index.
- **Buffer views are copied byte for byte.**
  - Each compressed view keeps its exact meshopt stream, and its logical range moves into the single fallback buffer, as in `meshopt-pack.mjs`.
  - BIN storage is 4-byte aligned with no unreferenced bytes (`checkStorage`).
- **Deduplication only of buffer views that hold nothing but embedded images.**
  - Bytes, length, declared MIME type and view metadata must all be identical. Identical bytes under another MIME type stay separate and are listed.
  - Image entries (names, extras, MIME) stay per level. Within one template only.
- **Texture sharing follows Three r185 exactly.**
  - `GLTFLoader.loadTextureImage` caches by (selected image's buffer view, sampler index). `assignTexture` then sets `colorSpace` on that cached Texture unless the use clones it (`texCoord > 0` or `KHR_texture_transform`).
  - Samplers are merged across levels only where the sampler JSON is equal and every non-cloning use has one colour space (sRGB for base colour and emissive, linear otherwise). Otherwise samplers stay per level.
  - A samplerless texture that Three would share with conflicting colour spaces is **refused**.
  - This reproduces, at load time, the sharing today's `coalesceTextures` performs after load; that equivalence still needs a native check.
- **Refused, never copied verbatim:**
  - external or `data:` URIs;
  - skins, animations and cameras;
  - more than one scene per input, or nodes outside the scene tree;
  - unknown properties on any object, root `extensions`, and extensions outside a per-object allowlist;
  - texture references outside the five core material slots;
  - `KHR_texture_basisu`;
  - an image view shared with vertex data.
- **Root metadata.** The packed file keeps level 0's `asset` and root `extras`. Other levels' differing values, buffer names/extras and unreferenced samplers are listed in `packing`.

## Verification (from the written bytes alone)

1. Container, ranges and references (`validateDocument`), the extension allowlist, and the same structural refusals as the inputs.
2. The runtime's own embedded-resource rules, restated from `src/embedded-glb.ts`:
   - BIN or meshopt fallback buffers only;
   - images in uncompressed BIN views;
   - a selectable image for every texture;
   - no KTX2.
3. Both meshopt decoders (npm meshoptimizer 1.1.1 and Three's bundled decoder) agree on every view of every input and output.
4. **Per-scene canonical identity.** Each scene is walked from its roots, with every index replaced by visit order, and compared with its standalone level. The comparison covers:
   - node TRS/matrix;
   - decoded accessor elements, with type, count, normalisation, min/max and byteOffset;
   - buffer-view layout and meshopt parameters and stream hash;
   - indices and every attribute (normals, UVs and so on);
   - materials and textureInfos;
   - textures with inlined sampler JSON;
   - image JSON with byte SHA-256.
5. **No sharing between scenes, and no new orphans.**
   - Scenes share no node, mesh, accessor, material, texture, image or non-image view.
   - Each kind's unreachable objects equal the inputs' own.
6. Every GLTFLoader texture-cache group that spans scenes has a single colour space among its non-cloning uses.
7. **A second decode by Three r185 GLTFLoader**, with images, textures and samplers removed because Node cannot decode images.
   - Per scene, the comparison covers: outline, world matrices (bitwise), every geometry attribute and index (bitwise), groups, drawRange, morph data and material parameters.
   - No geometry or material object may be shared across scenes.
8. Packing twice gives identical bytes.

**Known Three behaviour, recorded rather than hidden.** `GLTFLoader.createUniqueName` makes object
names unique per *file*, and unnamed meshes become `mesh_<index>`. So in the Three decode, later scenes
can get `_N` suffixes or renumbered default mesh names; these are reported as `threeFileWideRenames`.
The glTF names themselves are proven identical by gate 4. No runtime path for these two templates
looks objects up by name: the `getObjectByName` uses in `src` are all actor bones and grips. This
renaming is also one reason skinned actors must not be packed this way.

## Self-tests (synthetic; must all behave as expected)

**Accepted:**
- a clean two-level pack: one stored image, both scenes exact, one shared texture;
- conflicting colour spaces with samplers: bytes stored once, textures kept apart;
- the same bytes under another MIME type, which stay separate.

**Refused:**
- samplerless conflicting colour spaces;
- an external image URL and an external buffer URL;
- a skin, an animation and a camera;
- a texture referenced from an unsupported material extension;
- an unknown node property and root `extensions`;
- `KHR_texture_basisu`;
- two scenes in one input;
- an image view shared with vertex data;
- an input SHA-256 mismatch and an input length mismatch.

**The verifier must report** a flipped vertex byte and a changed node translation, each as a
"packed scene 1 differs" finding.

Each accepting case and the samplerless refusal first assert the fixture's shape, read back from its
GLB bytes, so a fixture that is not what its name says fails the run.

## Expected numbers (from the r04 candidate manifest; the run reports actual values)

| Template | Served inputs | Duplicate image bytes expected | Notes |
|---|---:|---:|---|
| snow-ground | 7,405,060 B (2,557,764 + 2,433,372 + 2,413,924) | 4,805,628 | The two images d0ac3101… (1,472,448 B) and f8129f38… (930,366 B) are embedded in all three levels |
| camp-mountain | 6,877,300 B (4,427,636 + 2,449,664) | 2,045,159 | The image ef3816a7… is embedded in both levels |

The saving is expected to be slightly less than the duplicate bytes, because the packed JSON chunk
grows. A value differs from expectation only if view metadata differs between levels, and the run
then lists why. **These are file sizes, not transfer or startup measurements.** The meadow-ground
copy of ef3816a7… is cross-template and out of scope.

## Proposed level-to-scene mapping (recorded, not adopted)

| Template | Scene / level | Selected today when |
|---|---|---|
| snow-ground | 0 | Camera-to-chunk-centre distance < 44 m, and every river-bank chunk (`src/open-world.ts` update/admit) |
| snow-ground | 1 | 44 m to < 82 m |
| snow-ground | 2 | ≥ 82 m |
| camp-mountain | 0 | Within the 100 m detail radius around (42, 86), with 3 m hysteresis (`campMountainVisualLod`) |
| camp-mountain | 1 | Beyond it; manifest `distanceMetres` 100, `medium-distance-lod` |

## What a later runtime step would need (not done here)

- **Loader.** `WorldAssets.loadTemplate` would make one verified download per template, with each level wrapped as `{ ...gltf, scene: gltf.scenes[i] }`.
- **Manifest records.** Level records would carry a scene index instead of url/sha/bytes. Progress totals and CacheStorage entries would follow from that.
- **Release.** `coalesceTextures` and `disposeModels` already walk every scene of a cohort (`scenesOf`).
- **Native gates.**
  - Per-level screenshots against the standalone files, in Chrome and WebKit.
  - GPU texture count and memory, context loss and restore, release and re-request.
  - The terrain admit and mountain-fit paths per level.
  - Cold-network bytes and timing on the actual startup path.

## Known limits

- No image is decoded and no pixel is compared. Image identity rests on byte equality, plus equality of the JSON that decides decoding.
- The texture-sharing analysis is a static reading of Three r185. Whether the GPU textures end up as today's needs a native check.
- The Three decode removes texture inputs, so texture-dependent material parameters are covered by gate 4 only.
- Duplicate images across templates (for example meadow-ground and camp-mountain), standalone cave images and PNG re-encoding are out of scope.
- Only these two static templates are covered. Skinned actors are refused by design.

## For Codex

1. Run the proof into a new directory, for example `--out output/optimization-audit-20261009/lod-packed-proof-r10-run02`. Leave run01 and `lod-packed-proof-r10-source/` as they are.
2. Require `status: passed`, every self-test `passed`, and empty `verification.problems` for both templates.
3. Inspect `savings`, `packing.deduplicatedImageViews`, `packing.textureSharing`, `packing.differingRootMetadata` and `threeFileWideRenames`.
4. For cross-run determinism, run once more into a second new directory and compare the packed SHA-256 values.
5. Treat any failure as a finding; do not weaken a gate to pass.
