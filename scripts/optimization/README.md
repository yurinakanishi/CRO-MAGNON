# Runtime GLB and texture optimization candidates (offline tooling)

Deterministic derivatives of the adopted TRELLIS-lineage GLBs for the 2026-10-09 optimization
plan: textures downsized to at most 1024 px (or 512 px per model on request) and lossless
`EXT_meshopt_compression`, plus a self-contained startup actor per public player character, plus
downsized copies of the standalone textures the game loads by URL (the ten camp-cave images).
No model or image is generated, reshaped, re-rigged, repainted or adopted here, and
`public/models` is only read.

## Commands

```sh
npm run build                                                        # eligibility and performance-lod.js come from dist/
node --test tests/asset-optimization.test.mjs                        # synthetic fixtures + read-only real sources
node scripts/optimization/generate-candidates.mjs --dry-run          # verify, parse and plan; writes nothing
node scripts/optimization/generate-candidates.mjs                    # → assets/optimized-runtime/20261009-r04
node scripts/optimization/verify-candidates.mjs --revision assets/optimized-runtime/20261009-r04 --write-report
```

The default revision is `20261009-r04`. Two earlier revisions stay on disk as failed visual
evidence (see the startup actor below):

- `20261009-r02`: its startup faces were rejected.
- `20261009-r03`: retained faces, but its adopted LOD bodies were rejected.

Their GLB and image candidates are byte-identical to r04's when inputs and policy match. An
existing revision is never overwritten (only a byte-identical regeneration is accepted), so a
changed plan always needs a new `--out`.

Options: `--out <dir>` (a new folder under `assets/optimized-runtime/` or `output/`),
`--python <exe>` (Pillow; defaults to `$OPTIMIZATION_PYTHON`, `$PERFORMANCE_PYTHON`, then the
Codex runtime), `--python-unisolated`, `--edge-512 key,...` (every image at 512),
`--maps-512 key,...` (normal and data maps at 512, colour at 1024; a key in both lists is
refused), `--webp-quality 90`, `--color-filter lanczos|box`, `--only key,...` (partial run,
requires a separate `--out`), `--base-adoption <id>` (see below).
`OPTIMIZATION_PYTHON` also enables the optional Pillow test. Every image records its treatment
and `maximumEdge`; the verifier holds each one to its treatment's edge.

**Partial revision on an applied adoption** (`--base-adoption <id> --only key,... --out <new dir>`,
`revision-scope.mjs`):

- **Sources:** the originals in the adoption's saved pre-apply manifests (`before/`), never its served candidates.
- **Base checks:** the base is checked first:
  - the plan, the journal (applied) and the candidate revision's records;
  - `before/`, and each `after/` re-derived from it;
  - the current manifests are exactly the applied bytes;
  - every served file and every original, by SHA-256 and length.
- **Scope:** only the base's ordinary compressed models. Startup actors, sole-primary full models (violet-behemoth), image owners (camp-cave) and files shared with an unlisted model are refused.
- **Output:** no startup actors and no standalone images. `verify-candidates.mjs --revision <dir> --base-adoption <id>` verifies such a revision.

## Adoption into the runtime manifests (`adopt-candidates.mjs`, `adoption.mjs`)

Adoption is separate from generation. It follows `output/optimization-audit-20261009/adoption-contract-r04.md`.

```sh
npm run build                                                        # eligibility comes from dist/
node --test tests/runtime-adoption.test.mjs
node scripts/optimization/adopt-candidates.mjs --dry-run             # plan in memory; writes nothing
node scripts/optimization/adopt-candidates.mjs                       # plan → NEW assets/runtime-adoption/20261009-r04-a01/
node scripts/optimization/adopt-candidates.mjs --apply --adoption=20261009-r04-a01
node scripts/optimization/adopt-candidates.mjs --audit --adoption=20261009-r04-a01 [--write-report]
node scripts/optimization/adopt-candidates.mjs --restore --adoption=20261009-r04-a01
```

**Plan.** The default command re-verifies, then writes a new record folder.

- **Re-verified:**
  - the revision: its manifest, its index (derived from the manifest), its passed verification, and its unadopted candidate status;
  - the acceptance documents, by hash;
  - the current manifests and eligibility inputs: byte-identical to the revision's inputs;
  - every original and every selected or retired candidate byte;
  - every hash-named target: absent, or identical (a different file there is an error).
- **Computed in memory:** each `asset.json`/`world-assets.json` rewrite. A file must already be canonical `JSON.stringify(value, null, 2)` output, and every changed JSON path must be one the rewrite declares.
- **Written:** to a folder that must not exist yet:
  - `before/`: every input manifest, exactly as read;
  - `after/`: the planned bytes;
  - `plan.json`: the graph and every operation;
  - `review.json` and `journal.json`.

  Nothing under `public/` is written.

**The graph** (`plan.json` `graph`):

- **`ordinary-compressed`:** every other model keeps its current full/LOD semantics, served from its compressed candidates.
- **`startup-sole-primary`:** the seven startup actors serve their startup file at every distance, and their old LODs are cleared. desert-fennec-mage and giant-ape serve one URL. The plan proves from both stored files that their startup and full candidates are byte-identical.
- **`full-sole-primary`:** the old far LODs in `LOD_REJECTIONS`. Today that is only violet-behemoth (native review addendum): its 7,965-triangle far LOD broke its face and neck at gameplay scale. It serves its verified 39,825-triangle compressed full candidate, and its LODs are cleared. The rule applies only to the reviewed URLs and triangle counts, and only when the revision adopts the model. Its evidence files are hashed. `farTriangles` records the cost: +31,860 visible triangles at far range for one instance. Any mismatch stops the plan for a new review.
- **Standalone cave images:** each serves the candidate. Its `image` holds the candidate's actual size, `uvSource` the original size, and `provenance.runtimeOptimization` the original identity. Nested historical records stay as they are, and images already within 1024 px stay unchanged.

Originals and unused or rejected candidates are listed in `retired`, and the retired candidates' identities in `retiredCandidates`. They stay in place, unchanged, and are never served. Each adopted record keeps its original URL, SHA, bytes, triangles and LODs under `runtimeOptimization.original`, and serves the selected candidate's statistics.

**Apply** runs once, on a `planned` record.

1. It recomputes the plan from the current files and stops unless the plan is byte-identical.
2. It copies candidate bytes to their hash-named URLs. Each copy goes to a temporary file and then a hard link, so an existing file is never replaced.
3. It replaces each manifest, but only while it still holds its before-bytes.

This is one file at a time, not a multi-file transaction. The journal goes `planned → applying → applied`, and a partial application (`applying`) is refused by apply and by the builds.

**Audit** is read-only, and its report has no timestamps. It checks:

- the saved bytes against the plan;
- the re-derivation of `after/` from `before/` (source correspondence uses the saved bytes, never the rewritten manifests);
- originals, served, retired and evidence files;
- the current manifests and the active graph: no retired URL in any runtime field; startup and full-only models with no LOD; cave `uvSource`.

**Restore** writes `before/` back, but only into manifests that still hold exactly the adopted bytes. Any other edit stops it before anything is written. Copied files stay.

Builds (`scripts/runtime-graph.mjs`, used by `build-exhibition.mjs` and `cloudflare-public-build.mjs`) ship exactly the adopted records:

- **URLs:** allowlisted; a hash-named file must be addressed by its SHA.
- **Graph:** no stale original, unaudited candidate or cleared LOD ships.
- **Decoder:** Three's bundled meshopt decoder ships whenever a model needs it, byte-identical to the one recorded.
- **Source manifests:** unchanged by the build.
- **MMO:** with `optimizedAssets`, it requires an applied adoption, and the legacy `assets/public-performance` mapping is no longer read. `--exact-assets` drops only that requirement.
- **Reported, not refused:** quoted literals of retired URLs in shipped code. The runtime loads models and cave images through verified manifest records, and `CAVE_EXTRA_PIGMENTS` still names each frieze's original image.

### Chained adoption of a partial revision (`chained-adoption.mjs`)

```sh
node scripts/optimization/adopt-candidates.mjs --plan --base-adoption=<applied id> --revision=<partial dir> --adoption=<new id> --acceptance=<its own review> [--dry-run]
node scripts/optimization/adopt-candidates.mjs --apply|--audit|--restore --adoption=<new id>
```

Nothing has a default. The acceptance documents must be the partial revision's own: the base's, and r04's, never cover new images.

**Plan.** The plan re-checks the base exactly as the generator does (above). The revision must be:

- a partial revision on that base, verified against it (`verification.json` names the base);
- matching it exactly: scope, base record, sources, coverage, original-derived names and model list;
- holding no unrecorded file.

The decoder and every LOD rejection (with its evidence) must be the base's. The result is **one complete graph under one new id**:

- **Cloned:** the base graph. Startup actors, violet-behemoth's sole primary and cleared LOD, cave images (bytes, size, `uvSource`), kept images and unadopted models keep their served files and decisions exactly.
- **Replaced:** only the scoped ordinary models' files. A candidate byte-identical to the base's file stays served unchanged.
- **Retired:** replaced files join `retired` and `retiredCandidates` (`superseded-by-<id>`). A URL that is still served is never retired.
- **Lineage:** every entry and image records `candidateRevision` (the revision that generated the files it serves, r04 for retained files) and `adoptedBy` (the adoption that first served them). Replaced entries carry `supersedes`. `graph.base` and `graph.scope` name the base and the scope.

**Inherited cave images.** Retained bytes alone do not prove the current loader still reads them with the same meaning.

- **Re-plan:** plan, apply and audit re-plan the base revision's standalone images against the current runtime files. They read the base revision's manifest and the base's saved pre-apply manifests, each SHA-checked and never rewritten. This is the same `runtimeCompatibility` check a complete adoption runs: only `runtimeEntry` and `configuredBy` may differ.
- **Graph check:** the graph must then serve each image exactly as that revision recorded it: identity, size, `uvSource`, wrap and colour space, or the kept original.
- **On a semantic change:** a semantic loader or layout change stops the plan, stops apply (which re-plans) before anything is written, and fails the audit. An edit that keeps every meaning passes.
- **Record:** `plan.runtimeCompatibility` records the current inputs plus `inherited` (the base, its revision and saved manifests, and whether the inputs changed since the base was planned). The audit adds `changedSincePlan`. A base revision without standalone images records null and needs a graph without images.

**Manifests.** They are rewritten from the base's applied bytes, which `before/` saves. Every adopted record and every cave image's `provenance` moves to the new id (`runtimeOptimization.adoption`, plus `adoptedBy`). Their payload stays identical: URL, hash, bytes, LODs, UVs, rig and `original`, which is always the true original. Replaced records change only their file identity, `candidateRevision` and `supersedes`. The builds therefore still see a single adoption; mixed ids stay refused.

**Apply, audit and restore** are the ones above.

- **Apply** re-plans first, so base drift, a corrupt base file, a cave-loader meaning change or a conflicting copy stops it before anything is written.
- **Interrupted apply:** it leaves manifests naming two ids, which the builds refuse until restore.
- **Audit** also checks:
  - the base's plan and `after/` are unchanged;
  - `before/` is its applied bytes;
  - the inherited cave images under the current runtime (above);
  - every retained or new served file is present in public/models.
- **Restore** returns every manifest byte for byte to the base's applied bytes.

The base's own record, journal and audit reports are never rewritten. Once the chain is applied, the base's audit reports its manifests as changed; that is history, not a fault. `readBaseAdoption` refuses the base from then on, because its manifests are no longer current.

**Tests across the chain.** The real-repository tests follow the active adoption:

- before the chain, the applied complete adoption is the base;
- after it, the chain's audit is the proof, and its base record supplies the originals: the startup-actor sources, and `runtime-model-identity.mjs`, which follows `plan.base` hash by hash to the saved pre-adoption manifest.

### Exact repack of the served files (`exact-repack.mjs`, `repack-adoption.mjs`)

```sh
node scripts/optimization/generate-candidates.mjs --recipe exact-repack --base-adoption <applied id> --out <new dir> [--dry-run]
node scripts/optimization/verify-candidates.mjs --revision <dir> --base-adoption <applied id> --write-report
node scripts/optimization/adopt-candidates.mjs --plan --base-adoption=<applied id> --revision=<dir> --adoption=<new id> --acceptance=<its own review> [--dry-run]
```

Recipe `exact-repack@1` (manifest `recipe`). Its inputs are the files the applied base **serves**, not its originals; the base may be complete or chained (`served-base.mjs` checks it like the partial-revision base, plus the chained ancestor's plan). The reviewed scope (`REPACK_SCOPE`) is snow-ground, camp-mountain, meadow-ground and river-water, with snow-ground and camp-mountain packed, plus camp-cave's ten standalone images (the cave GLB is untouched).

- **PNG** (`png-idat.mjs`): strict validation (CRC, chunk order and multiplicity, contiguous IDAT, exact inflate size, filter bytes; APNG and unsafe unknown chunks refused). The filtered scanlines are deflated again (level 9, four strategies × memLevel 9/8, each twice, identical and exact). One IDAT replaces the run; every other chunk is kept byte for byte. A rewrite is used only when strictly smaller; otherwise the served PNG stays. Non-PNG images are never touched.
- **Packing** (`level-pack.mjs`): one GLB per packed template, `model-levels.opt-<sha16>.glb`, scene i = level i. Meshopt streams and every non-image stored byte are copied verbatim; identical image views are stored once. A single-level model gets a new file only if one of its PNGs shrank.
- **Verification** (from disk, against the served levels): every output re-derived byte for byte; canonical per-scene identity with lossless-aware PNG identity; every image byte is its original or its recorded rewrite; both meshopt decoders; a Three r185 decode per scene with geometry and materials isolated. Totals are the unique physical files served before and after.
- **Adoption:** one more chained graph. Packed levels name the same url/sha256/bytes, each its `scene` and triangles; replaced images record `exactOf` (the root revision's output they losslessly rewrite). Each replaced entry records `supersedes`, and its superseded files retire. Startup actors, violet-behemoth's rejection and every other entry carry forward exactly. Apply, audit and restore are the ones above.
- **Build graph** (`runtime-graph.mjs`): a `scene` ships only in an adopted packed entry, scenes 0..N in order, one content-addressed `model-levels` file, one physical copy per URL (`physicalModels`); one URL with two identities is refused.

## Rules the tools enforce

- Inputs: every model in `public/models/world-assets.json` and every `public/models/*/asset.json`.
  The catalog and per-model manifests must agree; each file must match its manifest SHA-256 and
  length before and after the run. Excluded models are recorded with a reason.
- Output: staged next to the target and renamed into place; an existing revision is accepted only
  if regeneration is byte-identical. Names are content addressed: `<source>.opt-<sha16>.glb`,
  `startup.opt-<sha16>.glb`. No timestamps, so identical inputs and toolchain give identical bytes.
- Textures: same format and mime type (EXT_texture_webp only on real WebP), alpha and PNG colour
  chunks kept, never upscaled. Normal maps: box filter + renormalisation. Data maps: box per
  channel. Opaque colour: per channel (no premultiply). Masked/blended colour: premultiplied.
- meshopt: attribute codec v0 (`0xa0`), triangle/index codecs v1 (`0xe1`/`0xd1`), no filters,
  no quantisation, no reordering. Each stream must decode to its exact bytes; triangle data that
  the triangle codec would rotate uses `INDICES`. Interleaved, overlapping, sparse, image and 8-bit
  index views stay stored. The extension is required, and decoded ranges live in a URI-less
  fallback buffer, so a loader without a decoder fails instead of reading stale data.
- Startup actor: the full model's nodes, skins, inverse binds, materials, textures and every clip,
  with geometry chosen per primitive; unreferenced full-model geometry is dropped. The proofs, all
  recorded per actor in `derivation.startup` and re-derived by the verifier:
  - Geometry per primitive (`geometry`, `primitives[].geometry`).
    - Why. r02 put the adopted LOD heads on screen and Codex's Chrome review rejected them:
      the faces of cro-magnon-woman and neanderthal-woman were covered in brown angular fragments,
      and the LOD + full rig reference looked the same. The material pairing is not the fault: the
      LOD heads index the same face atlas (`graft-head.py`: "same atlas (subset vertices)"). They
      were reduced with `simplify(..., 'Sloppy')`, which `scripts/face-remake/simplify.mjs` runs
      as `MeshoptSimplifier.simplifySloppy`, commented "far LOD only". Its graft reports record
      `flags: ["Sloppy"]` for cro-magnon-woman (50,408 → 4,482 triangles), neanderthal-woman
      (49,116 → 4,756) and neanderthal-hunter (59,898 → 4,291). That topology-free clustering joins
      vertices from different UV charts of the fragmented TRELLIS head atlas (74,666 vertices for
      52,910 triangles in cro-magnon-woman), so up close each triangle stretches across unrelated
      atlas texels. The graft script accepted that "at >= 28 m"; the startup actor is seen up close.
      cro-magnon-hunter's head had only its weights changed, so its LOD head is the older
      attribute-aware LOD (1,724 triangles): coarse rather than UV-broken.
    - Rule. A primitive of a multi-primitive mesh with at least 50% of its skin weight on the `Head`
      joint keeps the full model's own primitive: accessors byte-equal to the original high
      source (positions, normals, UVs, joints, weights, indices; tangents where it has them),
      its material and its binding to the full skin (`retention: head-primitive`). The only
      primitive of a single-primitive mesh is retained whole (`retention: whole-single-primitive`):
      Codex's r02 review found the fennec and ape LOD faces damaged too (cheek, eye and muzzle
      facets and UV breaks at gallery distance; `image-review-r02.md`), and they have no separable
      head. That is the full model's geometry cost, not a head-only one; it is a quality baseline
      and is not claimed to meet any FPS, mobile or geometry budget. For today's sources this
      keeps the heads of both women, both men and the cat, and all of the fennec and the ape.
    - Source-derived bodies (default policy `source-derived`, r04).
      - Why. Codex's r03 review rejected the remaining adopted LOD bodies close up. The hunters'
        collars and necks showed sharp triangulated patches, fur and cloak shoulders were shredded,
        and there were gaps. The women showed polygonal skin, shoulder and strap damage, and
        neanderthal-woman's Attack had armpit gaps absent in the source. Those LODs were built with
        far-distance tolerances.
      - Method. Every other primitive is now reduced from its own original full primitive by
        `source-simplify.mjs`, never the adopted LOD.
        - Call: meshoptimizer 1.1.1 `simplifyWithAttributes`, which is index-only (it returns
          indices into the unchanged source vertices), then `compactMesh`.
        - Flags: `LockBorder` (openings and cut edges stay) and `ErrorAbsolute`.
        - Never used: `simplifySloppy`, `Permissive`, `Prune` or `simplifyWithUpdate`. `Regularize`
          is also left out: the 1.1.1 documentation only says it costs geometric quality, not how
          its term relates to the error limit. Skinning is protected by the per-bone weight columns
          and locks instead.
        - Target and limit: 50% of the triangles (`targetRatio`), and an approximate error of at
          most 1.5 mm (`targetErrorMetres`). Whichever binds first wins, and the achieved counts
          are recorded; nothing is relaxed to force the target.
      - Attributes. These steer the error metric only.
        - Vertex normals, every `TEXCOORD_n`, and one column per bone with that bone's normalised
          skin weight (at most 32 columns). Joint indices are categorical and are never treated as
          values.
        - The simplifier compares attributes in its extent-normalised space, so each weight is
          derived per primitive from a tolerance in metres. A normal change of 0.02, a UV change of
          1/2048 or a skin-weight change of 0.02 costs as much as 1.5 mm of position error.
        - If the bones exceed the column budget, vertices weighted to the bones left out are locked
          instead (`locks.jointBudget`).
      - Locks. Every vertex whose exact position another primitive of the mesh has is locked: the
        seams with retained heads, accents and the body. UV and normal seams inside a primitive are
        kept by the simplifier's seam handling, so no triangle spans two UV charts (tested).
      - Data. Each surviving vertex's bytes are copied unchanged from the original for every
        attribute: positions, normals, UVs, tangents, joints and weights. Nothing is interpolated,
        quantised or dropped.
        - Index orientation, material, mesh/primitive identity, the full skin, rest pose and clips
          are kept. The index component type stays the source's.
        - New vertex `i` is source vertex `simplification.sourceVertexIndices[i]`, with
          `sourceVertexSha256`; `indexSha256` hashes the new index buffer. This is the
          correspondence for browser QA.
      - Kept whole instead (recorded, not an optimization). Less than 1% reduction gives
        `retention: unreduced-whole-primitive`. Data the reduction does not handle (morph targets,
        non-triangle or unindexed primitives, other attributes or quantised data) gives
        `unsupported-whole-primitive`.
      - Record (`primitives[].geometry.simplification`). It holds the flags, target, limit, mesh
        scale, attribute columns and computed weights, the lock counts and locked vertices kept,
        and source versus achieved triangles and vertices. It also holds `reachedTarget`, the
        simplifier's own approximate `resultErrorMetres`, face-normal disagreement for source and
        result, and `uvCharts` for the result.
      - Limits of the proof. The simplifier's metric does not prove the deformed surface, skinning
        gaps or texture quality. Codex's close-up review of necks, collars, shoulders, armpits,
        straps, fur and cloaks in every clip decides.
    - Diagnostic policies only, never in a candidate:
      - `retain-face-primitives`: r03, adopted LOD bodies.
      - `adopted-lod-only`.
        Every LOD primitive is still checked under every policy, because the correspondence proves
        the primitive order. The skinned-displacement bound covers only LOD-sourced primitives
        actually shown, which under the default policy means none.
    - Evidence recorded per primitive.
      - `uvCharts`: the area share of triangles whose longest UV edge per metre exceeds 4× the
        full primitive's 99th percentile, for the full and the LOD primitive. The real-source test
        requires each face-remake LOD head to exceed its LOD body.
      - `seam` for retained primitives: how many positions they share exactly with their full
        neighbours, how many of those the startup neighbours still have (source-derived bodies lock
        them all), and the nearest neighbour vertex otherwise. Check that neck close up.
    - Costs.
      - `geometry.retained` (with `retained.byRetention` per kind) gives retained vertices,
        triangles and raw accessor bytes against the LOD primitives they replace.
      - `geometry.simplified` gives the source-derived source and result vertices, triangles and
        raw bytes.
      - Each `geometry.primitives` entry has its own vertices, triangles and raw bytes, and
        `geometry.startup` and `geometry.lodOnly` give the totals.
      - The verification records the exact stored (compressed) bytes per primitive in the packed
        startup file (`storedGeometryBytes`: `retainedFull`, `sourceSimplified`, `adoptedLod`). The
        manifest totals add `startupRetainedGeometryStoredBytes` and
        `startupSourceSimplifiedStoredBytes`, and each record's risks state the differences.
      - Nothing here is claimed to meet an FPS or mobile budget; Codex measures that in game.
    - Verification. `verifyStartup` checks every primitive against its recorded source:
      - `full-model`: byte-equal to the original.
      - `source-simplified`: every vertex's bytes, for every attribute, equal source vertex
        `sourceVertexIndices[i]`; min/max are recomputed; the map's hash, range and uniqueness are
        checked; the index buffer must hash to `indexSha256`, be in range, non-degenerate and in the
        source's component type; no morph targets.
      - `adopted-lod`: diagnostic policies only.
      - `verify-candidates` re-derives the whole report, including the simplifier output, from the
        sources.
    - Runtime. Under the active r04 contract (`adoption-contract-r04.md`), the startup file is
      the actor's sole runtime geometry at every distance. Its old `lods` are cleared on adoption,
      and there is no full-model upgrade. No level may use the old LOD file for any primitive:
      not the heads, not all of the fennec and the ape, and not the bodies.
  - Binding. Mesh nodes and names pair up, mesh world transforms agree to 1e-5, joint names match
    (remapped by name if reordered) and every joint keeps its parent joint. Inverse binds may
    differ by at most 1e-4 per element: about six times the export noise measured on the adopted
    cat-kunoichi (1.65e-5) and neanderthal-woman (1.47e-5) LODs.
  - Skinned displacement. In every pose, LOD vertices skinned with the full model's binds must sit
    within 0.25 mm (model units) of where the LOD's own binds would put them. three.js r185
    binds glTF skins with an identity bind matrix (glTF ignores the skinned mesh node's transform)
    and normalises the weights ŵ. A vertex p therefore lands at s.xyz + (1 − s.w)·t_mesh, with
    s = Σ ŵ·J·IBM·(p, 1). With joint world matrices J = [L t] and p under the two binds written
    (a, α) and (b, β), the difference is Σ ŵ·(L(a − b) + (α − β)(t − t_mesh)). The proof bounds it per
    vertex by Σ ŵ·(factor·|a − b| + |α − β|·(reach + mesh reach)), in exact arithmetic (float32
    rounding, about 1e-7 relative, is not modelled):
    - `factor` bounds |L| down each joint's node chain. A TRS node's linear part
      ((1 − |q|²)I + |q|²R)·S has norm at most (1 + 2·max(0, |q|² − 1))·max|S|. `reach` bounds |t|
      by summing translations down the chain.
    - Both cover every pose three.js's AnimationMixer (normal blending) gives the rest pose and
      clips. LINEAR and STEP samples, and lerp/slerp blends of them, never exceed the largest input
      |q|², |S| component or |T|. three's `slerpFlat` gives |q|² − 1 = a²ε₀ + b²ε₁ with
      a² + b² ≤ 1, or normalises.
    - The bottom-row term is needed because a float32 inverse may leave an IBM bottom row an ulp
      off (0, 0, 0, 1), and its effect grows with the joint's distance from the mesh origin. It is
      always included, and `inverseBindBottomRowDifference` is recorded.
    - Rejected explicitly, since these terms do not bound them: CUBICSPLINE channels on a joint or
      mesh chain (tangents overshoot their keys), `matrix` nodes there (shear, which three.js's
      TRS decomposition drops), morph targets on skinned primitives, and joint sets other than
      `JOINTS_0`/`WEIGHTS_0` (three.js skins with set 0 only).
    - Every quantity the proof compares must be finite: node world matrices, mesh extents,
      transform and bind differences, per-node factors and reaches, and per-vertex bounds. Finite
      but extreme inputs can overflow (Infinity · 0 is NaN), so overflow is an error, and every
      limit is tested as `!(x <= limit)` so that NaN fails.
    - Pose code in `src/` (riding, petting, grounding, torch grasp) is outside the proof. It
      changes the full skeleton for today's LOD and the startup actor alike.
    - 0.25 mm is 0.14 px at 2 m in a 1280 px, 60° view, and under 5% of the adopted LOD heads' own
      simplification error. Their recorded meshopt sloppy errors are 0.024–0.029 of a 0.25–0.3 m
      head extent, about 6–9 mm. A test samples three.js's own mixer poses (single clips and blends,
      with LINEAR scale and bottom-row noise) and checks the actual difference stays under the bound.
    - Current sources, from their JSON: the seven full models have only LINEAR samplers (no
      STEP/CUBICSPLINE), no `matrix` nodes and no morph targets; their LODs have only
      `JOINTS_0`/`WEIGHTS_0` and no morph targets. Their mesh and `Armature` nodes have no
      transform and are not animated, so the mesh reach is 0. `poseBound` records the per-actor
      census.
  - Rest pose. Only recorded. The startup actor uses the full model's nodes and clips, never the
    LOD's, and glTF skinning depends on joint world matrices (full model) and the bind data checked
    above. A different LOD rest pose with the same binds cannot change the result, and
    `performance-lod.ts` skins the LOD the same way today (its shading differs, see below). The
    dangerous cases are rejected: moved binds, a re-parented joint, a renamed joint, a moved mesh
    node, sub-cap bind changes whose displacement exceeds the bound, and LOD geometry posed away
    from its (stale) binds, caught because every LOD vertex must lie within a 10%-of-diagonal
    neighbourhood of its full primitive's bind-pose surface. Tests cover each case.
  - Attributes. Every LOD attribute must exist in the full model with the same layout, and only
    `TANGENT` may be absent: glTF makes it optional, and the adopted LODs never had it. Positions,
    normals, UVs, joints and weights are never dropped.
  - Shading is recorded per primitive, not inferred from the pose (`primitives[].shading`,
    `shading.differsFromExistingLod`). GLTFLoader gives geometry without `TANGENT` derivative
    tangents and a material clone with `normalScale.y` negated (its convention, three.js #11438).
    `existingLod`/`sameAsExistingLod` are historical. They record `performance-lod.ts` as it was
    when r02–r04 were generated: it kept the full mesh's material instance when it swapped the
    LOD in, pairing derivative tangents with the un-negated material. It has since finalised the
    material for the geometry it shows, as GLTFLoader does (the tests check both). The record
    stays as it was so that `verify-candidates` re-derives the r04 reports exactly.
    - In the r02 dry run this affected 11 normal-mapped primitives: cat-kunoichi 2,
      cro-magnon-hunter 3, neanderthal-hunter 2, and one each for cro-magnon-woman,
      desert-fennec-mage, giant-ape and neanderthal-woman. In r03, the retained cat and
      cro-magnon-hunter `HeadSurface` primitives and the whole fennec and ape primitives use the
      full geometry with its vertex tangents and the authored material. That leaves 7 if the
      accent primitives stay LOD-sourced (the report says which).
    - None sets `normalTexture.scale`, so the startup file alone renders `normalScale` (1, −1)
      and today's distance LOD renders (1, 1). The three remade heads have no normal map.
    - The tests build today's binding with `performance-lod.ts` itself (from `dist/`) for every real
      actor. They check identical geometry and inverse binds, and that both bindings' materials
      match this record.
  - Correspondence. Each LOD primitive must lie on its same-index full primitive (at least 50% of
    its vertices in 2%-of-diagonal cells occupied by that primitive, and no other primitive more
    than 10 points better). It must sit inside the whole mesh's bounds (+2%), and a
    `LODGeometrySlot_<name>` that names another primitive is an error. Per-primitive boxes are not
    used: the remade LOD heads tuck their neck seam up to 5 cm below the full head
    (graft reports), and that overhang is recorded.
- Standalone textures (`standalone-images.mjs`, records in `manifest.images`):
  - Which images. Exactly the ones the runtime loads, derived without executing project code,
    from the TypeScript syntax trees of `src/loading-cave.ts` and `src/world-landmarks.ts`. Two
    shapes are recognised.
    - Verified loader (current runtime): both files call `loadCaveTextures(template.asset, …)`.
      The images are then what `caveImageRecords` in `src/verified-texture.ts` reads
      (`asset.rockSurface`, plus the layout's `caveMuralImages`: `pigment`, `characterPigment`,
      `rimoPigment` and `mascotPigments[key]` for every `CAVE_EXTRA_PIGMENTS` key). Its
      `repeat: key === '…'` must name exactly `rockSurface`.
    - Earlier direct reads: both files read the same `template.asset.<key>.url` entries and
      iterate every `CAVE_EXTRA_PIGMENTS` entry.

    The verified shape is read fail-closed:
    - `records = caveImageRecords(asset)`, and one `Object.keys(records).map((key) => …)`;
    - one settings object, holding only `colorSpace: THREE.SRGBColorSpace`, `anisotropy` and
      `repeat`. `repeat` is inline or a single `const`, and is a literal `key === '<name>'` test
      (`||` allowed).
    - `asset` is used only as `asset.<name>`, as `mascotPigments[<plain key>]`, or as the argument
      of the next function in the chain.

    Anything computed, spread, reassigned or unknown is an error. Only `runtimeEntry` and
    `configuredBy` differ between the two shapes; all other plan fields are identical.

    The r04 records name the earlier reads. So the strict `verify-candidates.mjs` against today's
    runtime reports those two fields as changed. That is the runtime's configuration changing,
    and it is not relabelled as a pass. The separate evidence is the adoption plan's
    `runtimeCompatibility`. It re-plans every image with the current runtime files, allows only
    those two fields to differ, and records both versions and the current input hashes. Every
    other field must be identical: id, source identity and size, resize, filter, encoding, UV
    rectangles, wrap, colour space, the recorded risks and the skipped list. Any other difference
    stops the plan. The audit repeats this from the adoption's saved pre-apply manifests and
    marks `changedSincePlan`. `CAVE_EXTRA_PIGMENTS` in `src/cave-gallery-layout.ts`
    must hold only literals, and its keys and URLs (each frieze's original image) must equal
    `mascotPigments` in `public/models/camp-cave/asset.json` before adoption. Every record needs url, SHA-256,
    length and size, must agree with its `world-assets.json` copy, and the file on disk must match
    it. Declared but unloaded images (`pigment.previous`, `mural-side-r04.png`) are listed as
    skipped. A PNG nobody configures is never picked up.

  - Ownership. Images must sit in `/models/camp-cave/`. That model must be eligible and selected
    (`--only`, `--edge-512` apply), and an owner or folder belonging to an excluded character
    (`cloudflare/public-release.json`, today the maruimo species) is an error. The public build
    already ships these ten images with camp-cave; the plan adds nothing from an excluded
    character's folder and rewrites no manifest.
  - Resize. Whole image to whole image: no crop, padding, repacking or redrawing, never upscaled.
    Same format, PNG colour chunks and bit depth, and alpha. Colour filter as for embedded colour
    textures, with premultiplied alpha for transparent images. The limestone is sampled with
    `RepeatWrapping`, so it is filtered across its own opposite edges (3×3 tiling, centre crop);
    the other images are clamp-to-edge.
  - UV mapping. The mural shader turns `CAVE_MOTIFS` pixel rectangles into UVs with fixed source
    sizes: full-image motifs use their own rectangle, the Rimo frieze `[2172, 724]` and the atlas
    `[1254, 1254]` (read from the shader's syntax tree). It never reads the loaded texture's size,
    so a whole-image resize keeps every normalised coordinate on the same artwork. The tool
    requires each normalisation size to equal the source image size and every rectangle to lie
    inside it. Each record keeps `uv.normalizedBy` (source size) and per motif the rectangle, its
    normalised and candidate-pixel equivalents, and the gap to the nearest other motif. Never
    divide old pixel rectangles by the candidate's smaller size; that shifts and crops the art.
  - Verification. Original SHA-256 and length; candidate SHA-256, length and content-addressed
    name (`<source>.opt-<sha16>.<ext>`); format and mime type; exactly the planned size within the
    edge; alpha; PNG colour chunks and bit depth; aspect ratio within whole-pixel rounding.
    `verify-candidates.mjs` re-derives the whole plan from the current files and requires the same
    plan, risks and verification.
  - Sampling risks for Codex's close-up review.
    - In the atlas, the `ochreHorse` and `mammoth` rectangles already overlap by 4 px in the
      original. `redHorse` and `deer` are 3 source px apart, about 2.4 px at 1024. Mipmaps reach
      neighbouring artwork sooner than with the 1254 px original, so check the hands, signs,
      horses, mammoth, bison and deer edges close up and from the far end of the gallery.
    - Transparent frieze outlines may show dark or light fringes against the limestone.
    - Limestone tile seams, and slightly softer pores and bedding: the relief comes from
      screen-space derivatives of this texture.
    - Faces and small markings of the painted characters and mascots must stay recognisable at the
      closest walkable distance and at grazing angles. Compare original and candidate in Chrome and
      WebKit at the same camera positions.
- Verification decodes with `MeshoptDecoder` and compares every non-image view, accessor, skin,
  clip sample and JSON section with the original. It does not render: candidates stay
  `candidate-pending-visual-qa` until Chrome QA. `scripts/inspect-glb.mjs` expects one buffer and
  cannot read compressed candidates; use `verify-candidates.mjs` instead.

## The candidate index (`runtime-index.json`)

The index is the generator's compact record of a revision. It always says
`candidate-pending-visual-qa` / `adopted: false`. The runtime does not read it: it reads the
adopted manifests (see Adoption above). Its `upgrade` field is the identity of each startup
actor's full candidate. It is provenance only: under the active r04 contract, that file is not
served.

```jsonc
{
  "schema": "cro-magnon/runtime-candidate-index@1",
  "status": "candidate-pending-visual-qa", "adopted": false,
  "decoder": { "extension": "EXT_meshopt_compression", "required": true,
               "module": "three/addons/libs/meshopt_decoder.module.js" },
  "files": { "<current manifest url>": { "sourceSha256", "sourceBytes", "url", "sha256", "bytes",
             "maximumTextureEdge", "extensionsRequired" } },
  "startupActors": { "<modelKey>": { "url", "sha256", "bytes", "geometrySource", "fullSource",
             "upgrade": { "url", "sha256", "bytes" }, "lodDistanceMetres", "structure", "lowLevel",
             "geometry": [{ "mesh", "primitive", "material",
                            "source": "full-model|source-simplified|adopted-lod (diagnostic only)",
                            "retention": "head-primitive|whole-single-primitive|unreduced-whole-primitive|unsupported-whole-primitive|null" }],
             "materialPairing": { "rule", "primitives": [{ "mesh", "primitive", "material",
                                  "startup": { "tangents", "normalScale" }, "upgrade": { … } }] } } },
  "textures": { "<current manifest image url>": { "owner", "manifestEntry", "sourceSha256",
             "sourceBytes", "url", "sha256", "bytes", "mimeType", "width", "height",
             "uvSource": { "width", "height" }, "alpha", "colorSpace": "srgb",
             "wrap": "clamp-to-edge|repeat" } }
}
```

**Standalone textures.** On adoption, each manifest image record names its candidate exactly:

- URL, SHA-256 and length;
- `image`: the candidate's actual size;
- `uvSource`: the original size, which normalises the atlas rectangles (never the decoded size).

The runtime downloads the record through its verified path (length and SHA-256 before decoding)
and keeps its colour space and wrap mode. There is no fallback to the original.

**Startup actors.** Under the active r04 contract, an adopted startup actor is a single verified
file at every distance:

- its own GLTFLoader materials, with derivative-tangent clones where it has no `TANGENT`;
- the shared images;
- no LOD;
- no full-geometry upgrade, near level or second root.

The meshopt decoder is set before parsing. `lowLevel` and `geometry` describe what that file
holds. No level may use the old LOD file for any primitive: its heads, single-primitive faces
(r02) and bodies (r03) were all rejected. `whole-single-primitive` actors (desert-fennec-mage,
giant-ape) serve the full model's geometry, byte-identical to their full candidate.
`materialPairing` still says which primitives' startup and full materials differ. That matters
only for a comparison against the full model, never for a runtime swap. A visual or vertex
reference for the startup actor uses:

- the full model's geometry for `full-model` primitives;
- the full model's vertices through `sourceVertexIndices` (and the recorded triangles) for
  `source-simplified` ones;
- the adopted LOD only for `adopted-lod` ones (diagnostic policies).

"Adopted LOD + full rig" reproduces the rejected r02/r03 geometry, and `verifyStartup` rejects a
startup file that does so.

The meshopt tooling requires exactly `meshoptimizer@1.1.1` (`contract.mjs`). It is only a
transitive dependency today; the later package/runtime task must pin that version and load the
matching decoder (three's `meshopt_decoder.module.js` is built from meshoptimizer 1.1). No other
codec or version may be substituted silently.
`manifest.json` holds the audit detail: per-file source and output hashes, texture sizes and
treatments, triangle counts, meshopt decisions, startup proofs and verification results.
