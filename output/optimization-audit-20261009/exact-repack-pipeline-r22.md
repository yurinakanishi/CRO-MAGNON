# Exact-repack pipeline (r22): production candidate, verification and chained adoption

Status: **code written, nothing executed.** No command, test, generation, plan, apply or build
was run in this session. No revision, adoption record, public file or server was created or
touched. Every claim below is about the code, not about results. All real-data execution is
Codex's.

## Recipe `exact-repack@1`

- **Inputs:** the files the applied base adoption **serves** (not its originals). The base may be
  complete or chained. Intended run: base `20261010-r05-a02` (plan SHA
  `2697ba7246fc06f764989ede94a58cb4f8324765befc6fae0db11ed6430ce444`), new revision
  `assets/optimized-runtime/20261010-r06`.
- **Scope** (fixed in `REPACK_SCOPE`; the CLI accepts no other):
  - snow-ground (3 levels, packed);
  - camp-mountain (2 levels, packed);
  - meadow-ground and river-water (1 level each; a new file only if one of their PNGs shrank);
  - camp-cave's 10 adopted standalone PNGs. The cave GLB is not touched.

  I read a02's `plan.json` and `journal.json`: a02 is applied, its level counts match, it has
  `keptTextures: []`, and it owns exactly 10 camp-cave textures.
- **Step 1, PNG IDAT rewrite** (`png-idat.mjs`, promoted from the r21 proof):
  - **Validation:** strict (CRC, reserved bit, IHDR/IEND, APNG refused, unknown critical or
    unsafe ancillary chunks refused, contiguous IDAT, ancillary order and multiplicity, exact
    Adam7-aware inflate size, nothing after the zlib stream, filter bytes 0–4).
  - **Re-encoding:** level 9 and windowBits 15, with DEFAULT/FILTERED/RLE/FIXED × memLevel 9/8.
    Each attempt is encoded twice and must give identical bytes that inflate exactly back.
  - **Output:** one IDAT, with every non-IDAT chunk byte for byte. IHDR, the chunks before and
    after the IDAT run, and the filtered scanline stream must be identical. A rewrite is used only
    when strictly smaller; otherwise the original is kept. Non-PNG images are never touched.
- **Step 2, packing** (`level-pack.mjs`, promoted from the r10 proof lib):
  - one GLB per packed template, named `models/<dir>/model-levels.opt-<sha16>.glb`, where scene i
    is level i;
  - meshopt streams and every non-image stored byte are copied verbatim;
  - identical image views are stored once;
  - samplers are shared only where Three would share one Texture with one colour space.
- **Step 3, verification:** every output is checked from its bytes against the **original served
  levels**:
  - canonical scene equality per scene, with PNG identity aware of the lossless rewrite;
  - every packed image byte must be its original or its recorded rewrite;
  - both meshopt decoders must agree;
  - a Three r185 decode per scene, with no geometry or material shared across scenes;
  - per-scene triangles must equal the graph's.
- **Totals:** the unique physical files served before and after this revision, actually measured.
  They are not a sum of the r10 and r21 proofs.

## Contract (803) as implemented

- **Records:** an optional integer `scene` on ordinary environment primary/LOD records. Packed
  primary = scene 0, LOD i = scene i. Every level names the same url/sha256/bytes (and parts);
  triangles, distanceMetres and purpose stay per level.
- **Strict packed mode:** any `scene` makes the whole entry strict, and mixing with unpacked
  records is refused (`runtime-graph.mjs` `packedProblem`).
- **Build graph** (`checkRuntimeGraph`):
  - checks scene identity, duplicates and order, and that the file is a content-addressed
    `model-levels` file;
  - refuses a scene outside an adopted packed entry;
  - refuses one URL with two identities;
  - returns `physicalModels` (one entry per URL, with `records`);
  - a swapped scene is refused even with the file SHA unchanged.

  Global model URL rules are unchanged.

## Files

**New:**
- **Production:**
  - `scripts/optimization/png-idat.mjs`;
  - `scripts/optimization/level-pack.mjs`;
  - `scripts/optimization/served-base.mjs` (an applied complete or chained adoption read as a
    served base, with every check of the partial-revision base plus the chained ancestor's plan);
  - `scripts/optimization/exact-repack.mjs` (scope, generator, independent verifier);
  - `scripts/optimization/repack-adoption.mjs` (chained planner).
- **Tests:**
  - `tests/exact-repack-fixtures.mjs`;
  - `tests/exact-repack.test.mjs`.

**Changed:**
- `scripts/optimization/contract.mjs`:
  - `EXACT_REPACK_RECIPE`, `PACKED_ROLE`, the repack runtime index;
  - an unknown `recipe` is now refused instead of being read as a legacy manifest.
- `scripts/optimization/adoption.mjs`:
  - `planAdoption` dispatches a `--base-adoption` plan by the revision's `recipe`, and refuses an
    unknown recipe;
  - the active-graph audit compares `scene`.
- `scripts/optimization/chained-adoption.mjs`:
  - `scene` in the served-record rewrite;
  - replaced images (`supersedes`/`exactOf`);
  - inherited-image compatibility recurses to the chain's complete root.
  - **Bug fix:** the rewrite now treats an entry as replaced only when its `adoptedBy` is this
    graph's id. Before the fix, an r06 on a02 would have carried a02's r05 entries forward with
    their `supersedes`. The rewrite would then have expected the manifests to serve a01's files,
    and planning would have failed. Test (C) below covers this.
- `scripts/optimization/generate-candidates.mjs`: `--recipe exact-repack`.
- `scripts/optimization/verify-candidates.mjs`: verification of exact-repack revisions.
- `scripts/optimization/README.md`: a short section on the recipe.
- `scripts/runtime-graph.mjs`: the packed-level rules and `physicalModels`.
- `tests/runtime-adoption.test.mjs`:
  - an `exact` fixture option;
  - three end-to-end tests;
  - the real-repo tests follow a repack on the r05 chain (`assertActiveRepack`; the r04 test walks
    `plan.base` to the root and compares `exactOf ?? texture`).
- `tests/asset-optimization.test.mjs`: `startupActorSources` walks every `plan.base` to the root.

**Carry-forward:**
- the base graph is cloned with lineage;
- the 7 startup actors and violet-behemoth keep their sole bodies, cleared LODs, LOD rejection
  and evidence, all re-checked;
- unchanged files stay byte-identical;
- superseded files retire with their archive path in the revision that generated them;
- a served URL is never retired, and a copy is never reused;
- plan/apply/restore keep their preconditions, journal, exclusive fresh directories, re-plan on
  apply and protected paths;
- restore returns every manifest byte for byte to the base's applied bytes.

## CLI (Codex)

```sh
node scripts/optimization/generate-candidates.mjs --recipe exact-repack --base-adoption 20261010-r05-a02 --out assets/optimized-runtime/20261010-r06 --dry-run
node scripts/optimization/generate-candidates.mjs --recipe exact-repack --base-adoption 20261010-r05-a02 --out assets/optimized-runtime/20261010-r06
node scripts/optimization/verify-candidates.mjs --revision assets/optimized-runtime/20261010-r06 --base-adoption 20261010-r05-a02 --write-report
node --test tests/exact-repack.test.mjs tests/runtime-adoption.test.mjs tests/asset-optimization.test.mjs
# after native per-level review and a written r06 acceptance document (never r04/r05's):
node scripts/optimization/adopt-candidates.mjs --plan --base-adoption=20261010-r05-a02 --revision=assets/optimized-runtime/20261010-r06 --adoption=20261010-r06-a01 --acceptance=<r06 review> --dry-run
```

- **Exit codes:** the generator writes nothing on `--dry-run` and refuses an existing `--out`.
  `verify-candidates` exits 1 on a failed report.
- **What to compare after generating:**
  - the `png` summary against the r21 run01 report (same 14 PNGs and the same settings; a
    different zlib build may change sizes, not the identity checks);
  - `totals` as the combined actual saving.

  `png-attempts.json` holds the timings, and they decide nothing.

## Tests written (not run)

- **`tests/exact-repack.test.mjs`:**
  - rewrite accepted, keeping IHDR, every non-IDAT chunk (sRGB, gAMA, cHRM, eXIf, oFFs, pHYs,
    tEXt) and the stream; deterministic; an already-optimal PNG is retained;
  - rejected changes: pixel, metadata, dropped chunk, moved chunk, re-filtering;
  - strict parse refusals;
  - substitution keeps meshopt streams byte-identical, refuses a non-lossless replacement and
    reports a tampered stream byte;
  - pack plus verification plus the Three decode; one stored image; packing twice gives the same
    bytes; material isolation; an unrecorded rewrite is refused;
  - tampered vertex, transform, image, metadata, scene order or scene count;
  - graph rules: swapped, duplicate, missing, extra or fewer scenes; same URL with another
    identity; parts differ; a scene outside adoption; an inconsistent graph; a non-`model-levels`
    name; the physical copy count.
- **`tests/runtime-adoption.test.mjs`:**
  - **(A)** generate → verify → plan → apply → build graph (one physical copy, scenes 0/1) →
    restore, byte for byte, with every carry-forward and manifest-payload assertion;
  - **(B)** fail-closed refusals:
    - missing defaults or reused acceptance;
    - an unknown recipe, base SHA tamper or packed scene tamper;
    - protected scopes (hero, behemoth, cave model, unpacked multi-level, wrong image count);
    - a corrupt output or a stray file;
    - base drift, a corrupt served file or archive, or evidence drift;
    - a conflicting copy;
    - apply refused on drift or a conflicting copy;
    - restore refused after a later edit;
  - **(C)** a repack on a chained base: the chain's replaced tree, actors, behemoth and rejection
    carry forward; inherited images refuse a runtime meaning change; restore returns to the chain.

## Remaining integration (outside my ownership)

1. **Required before an r06 apply:** `tests/runtime-model-identity.mjs` `modelIdentities`.
   `tests/camp-landform.test.mjs` runs `verifyModelSource('camp-mountain')`, which demands
   `<original name>.opt-<sha16>.glb`. A packed primary is `model-levels.opt-<sha16>.glb`, scene 0.
   Exact patch, replacing the two lines that build and compare `url`:

   ```js
   const directory = original.url.slice(0, original.url.lastIndexOf('/')),
     packed = asset.scene !== undefined,
     url = packed
       ? `${directory}/model-levels.opt-${served.sha256.slice(0, 16)}.glb`
       : original.url.replace(/\.glb$/, `.opt-${served.sha256.slice(0, 16)}.glb`);
   if (packed) assert.equal(asset.scene, 0, `${key}: a packed primary is scene 0`);
   assert.equal(served.url, url, `${key}: the served URL is not hash-addressed`);
   ```

   `assertSameGeometry` needs no change: it decodes the default scene, and the verifier requires
   the default scene to be level 0. The other users of the scoped keys need nothing:
   - `startup-mountain-fit` and `fixed-water-placement` read the primary through the default
     scene, or a single-level file;
   - `startup-streaming` uses fakes.
2. **Packagers:** no patch needed.
   - `scripts/cloudflare-public-build.mjs` publishes each URL once (`downloads.has`).
   - `scripts/build-exhibition.mjs` now uses `scripts/packaged-models.mjs`: one physical file per
     URL, `scene` in the catalog-vs-own identity, and the GLB count from physical files.
   - `checkRuntimeGraph` refuses two identities under one URL.
3. **Runtime:** the packed-level loader (`src/world-asset-levels.ts`, used by `src/world-assets.ts`)
   is in the working tree, uncommitted, from another session. I did not edit or verify it. Native
   per-level review of the packed scenes is still required. The verifier's report lists runtime
   scene selection, native decoding/GPU, transfer time and mobile as **not verified**.

## Limits

- **PNG identity:** decoded meaning is proven by identity (IHDR, every non-IDAT chunk, the
  filtered scanline stream), not by decoding pixels in Node. r21's native gates passed for this
  transform class; they are not re-run here.
- **Three decode:** textures are stripped, so it covers geometry, transforms and material
  parameters. Images are covered by the identity check.
- **Scope:** the exact repack adds no new optimization. Its gain is only the packed-file
  deduplication plus the PNG IDAT savings, measured together in `totals`.
- **Not run:** the tests may still fail on details I could not execute. These include the Node
  GLTFLoader decode inside the fixture, and fixture speed with ~3 MB raw cave PNGs at one zlib
  setting.
