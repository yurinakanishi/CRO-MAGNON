# Texture budget review r15: next environment-only revision (decision note)

Publisher session 587a3bb5, 2026-10-10. This note is read-only analysis: nothing was generated, run or adopted. Every byte and MB figure marked *est.* is an estimate, not a measurement. The adopted r04 revision, adoption `20261009-r04-a01`, its acceptance evidence, the seven sole-primary actors and the violet-behemoth LOD rejection are untouched by everything proposed here.

## 1. Decision summary

- **Where the camp payload is.**
  - The probe sees **59 × 1024² RGBA textures with mips** in camp (5,592,404 B each): about **330 MB of 370 MB**.
  - Of these, 16–18 belong to the five startup actors in view, about 100–112 MB (two 1016×1024 head maps among them). Those are protected.
  - About 41–43 belong to environment props, grounds, water, the cave model and mascots: about 230–240 MB.
  - Overview has 74 such textures; the eight extra 1024×341 frieze uploads appear only there.
- **The 200 MB guide cannot be met by an environment-only revision.** Halving an image saves 4,194,304 B of GPU payload. Reaching 200 MB in camp needs about 170 MB, i.e. about 41 halvings; nearly every environment texture, including walkable ground tiles, would have to go to 512. That is the "blind lowering" this task excludes.
  - The proposed r05 reaches camp ≈ **286 MB** *est.* without the gated tier, or ≈ **265 MB** *est.* with it.
  - The rest needs a separate decision (§7).
- **Recommended r05.** A finite set of 19 models, in three tiers:
  - **Maps only:** normal and data maps of camp props and flora go to 512; their colour stays at 1024.
  - **Handheld items:** whole-model 512.
  - **Near-constant maps:** the five orb-bot normal maps go to 512.
  - **Ground and water tiles:** a fourth tier, adopted only if new texel-density evidence and close-range native review pass.
- **`--only` plus `--edge-512` is not enough** (§4). The current generator and publisher both read the *current, adopted* manifests:
  - the generator would load compressed r04 candidates as sources, which `validateDocument` rejects;
  - the publisher rejects a partial or chained revision.

  A small "base adoption" mode is needed on both sides (§5).

## 2. Evidence used

- **GPU payload.** `performance-gpu-texture-adopted-r04.md` and its `perf.json`:
  - camp 370,108,758 B, 102 handles;
  - mammoth 381,817,854 B;
  - overview 468,882,218 B.

  Per-texture sizes give the counts above (59 / 61 / 74 at 5,592,404 B).
- **Network.** `performance-network-adopted-r04.md`: controls are ready at 63.04 s at 10 Mbps. ResourceTiming decoded bytes are 71.3 MB at controls.
  - `startup-network-analysis-r04.md` lists the world startup set: 15 keys, r04 34.7 MB.
  - From `texture-inventory-r05.json`, about **25.4 MB of those 34.7 MB are embedded image bytes**. LOD GLBs repeat their full model's colour image byte-for-byte, so each repeat costs another download (GPU sharing is covered in §6).
- **Large lossless PNG duplicates.**
  - The **meadow-ground** and **camp-mountain** colour image is one identical PNG (`ef3816a7…`, 2,045,159 B). It is shipped three times (meadow-ground, camp-mountain, camp-mountain lod-performance) and uploaded twice, because the two are separate templates.
  - **snow-ground** carries two PNGs (1,472,448 + 930,366 B) in each of its three files: 7.2 MB in the startup set.
- **Texture usage, from the source GLB JSON and the runtime.**
  - Ground models are repeated as 32 m world tiles (`shared/world.mts chunkSize: 32`). The shader blends their colour with world-space noise (`paleo-materials.ts` meadow tile).
  - If a tile's UV covers its texture once, 1024 px is about 32 texels/m, already magnified at walking range on a 390×844 view.
  - glTF stores no UV min/max, so the actual UV span is unmeasured. Hence the gate on the ground tier.
- **Near-constant maps.** The five round orb-bots' normal maps are 1024² WebP of **1,948–8,574 B** each, which is strong evidence of near-flat content. Their colour maps (29–45 KB) are smooth too.

## 3. Proposed r05 scope (finite)

GPU deltas are exact per upload (4,194,304 B per 1024²→512² image). Whether that image is resident in a given scene is not measured per source, so the scene totals are *est.* Encoded deltas assume 1024→512 leaves about 30% of a lossy WebP (range 25–40%) and about 27% of a lossless PNG. They are *est.* until Codex generates.

### Tier A — normal and data maps 512, colour stays 1024 (camp props and flora; all in the startup set)

| Model | Maps changed (encoded B now) | Encoded Δ *est.* | GPU Δ per upload |
| --- | --- | ---: | ---: |
| hide-tent | normal 406,204 + metallicRoughness 225,126 | −0.44 MB | −8.39 MB |
| berry-bush | normal 663,902 | −0.46 MB | −4.19 MB |
| valley-pine (full only; LOD maps are already 512) | normal 573,570 | −0.40 MB | −4.19 MB |
| stone-firepit | normal 432,334 | −0.30 MB | −4.19 MB |
| firewood-pile | normal 319,262 | −0.22 MB | −4.19 MB |
| firewood-log | normal 294,308 | −0.21 MB | −4.19 MB |
| drying-rack | normal 287,532 | −0.20 MB | −4.19 MB |
| stone-axe | normal 277,748 | −0.19 MB | −4.19 MB |
| wood-footbridge | normal 213,294 | −0.15 MB | −4.19 MB |
| valley-boulder | normal 147,926 | −0.10 MB | −4.19 MB |
| **Tier A total** | 11 maps, 3,841,206 B | **≈ −2.7 MB (≈ −2.2 s at 10 Mbps)** | **−46.1 MB** |

Colour textures carry recognisability and stay at 1024. The LOD GLBs of these props hold only the colour image, so they are unchanged.

### Tier B — handheld items, whole model 512

| Model | Images (encoded B now) | Encoded Δ *est.* | GPU Δ per upload |
| --- | --- | ---: | ---: |
| wooden-spear (held; prepareSelf) | 79,236 + 119,004 | −0.14 MB | −8.39 MB |
| obsidian-spear (held; prepareSelf) | 104,620 + 144,386 | −0.17 MB | −8.39 MB |
| kunoichi-katana | 142,712 + 130,178 | −0.19 MB | −8.39 MB |
| flint-spear (two 1024 RGBA PNG colour maps) | 1,357,037 + 1,224,765 | −1.9 MB | −8.39 MB |

### Tier C — near-constant normal maps 512 (colour stays 1024)

`orb-bot-white`, `orb-bot-blue`, `orb-bot-green`, `orb-bot-purple`, `orb-bot-orange`: normal maps of 8,180 / 7,682 / 8,574 / 8,070 / 1,948 B. The network change is negligible. GPU is −4.19 MB each, **−21.0 MB** if all five are resident.

Codex must first record decoded per-channel min/max/stddev. If a map is constant within quantisation, a later "constant-map collapse" (a new treatment that needs its own code and review) could remove almost all 5.59 MB per map. r05 itself uses only the existing 512 downsize. The detailed orb-bots (beret, frog, triangle, heart) are excluded.

### Tier D — gated ground and water tiles (colour 512; adopt only if §6 gates pass)

| Model(s) | Images (encoded B now) | Encoded Δ *est.* | GPU Δ per upload |
| --- | --- | ---: | ---: |
| meadow-ground + camp-mountain, together (one identical PNG in 3 files) | 3 × 2,045,159 | −4.5 MB (startup set) | −8.39 MB (two templates) |
| snow-ground | 3 × (1,472,448 + 930,366) | −5.3 MB (startup set) | −8.39 MB |
| river-water (water shader; check that alpha/opacity is really unused) | 1,825,032 | −1.3 MB (startup set) | −4.19 MB |

Ice, desert and volcanic grounds (−4.4 / −1.3 / −2.9 MB *est.*) are regional, not in the startup set. Defer them to a later revision.

### Expected totals (*est.*)

- **Tiers A + B + C:** camp GPU −84 MB (A −46, held spears −17, orb-bots −21 if resident), giving camp ≈ **286 MB**. Startup network ≈ −3.0 MB (Tier A plus the two held spears).
- **Adding Tier D:** camp ≈ **265 MB**. Startup network a further ≈ −11 MB, about −9 s of the 41.9 s post-confirm critical-set lower bound at 10 Mbps.
- These are upper bounds on the saving; the real effect depends on residency.

### Explicitly out of scope

- Not touched:
  - the seven startup actors (all images, including body maps);
  - woolly-mammoth, sabertooth-tiger, violet-behemoth, crow-shaman and the crow equipment set (enemy and animal detail);
  - rimo-neko and yellow-524-mascot;
  - the four detailed orb-bots;
  - camp-cave (model and all ten gallery images);
  - valley-castle, volcanic-cone, glacier-spires, basalt-columns, desert-cactus, dugout-canoe, shell-midden, cockle-shell, berry-cluster, obsidian-blade and mammoth-meat.
- Not done: no format change (PNG stays PNG, WebP stays WebP), no geometry, UV, rig or animation change, and no new images.

## 4. Why `--only` plus `--edge-512` is not enough after adoption

1. **Sources.**
   - `buildInventory` reads the current manifests. After `a01` they name the r04 candidates (`*.opt-*.glb`).
   - `loadSource` calls `validateDocument(json, bin, url)` without `allowMeshopt`, so every compressed r04 file is rejected.
   - If allowed, it would re-encode r04's already lossy WebP (second generation).
   - It would also name outputs `model-c2.opt-X.opt-Y.glb`, which the build allowlist (`runtime-graph.mjs` MODEL_URL) rejects.
   - The originals are still on disk and SHA-recorded in `a01` (`graph.models[*].primary.source`, `before/`). r05 must derive from them, as r04 did.
2. **Edge granularity.** `--edge-512` sets one edge per model and halves every image, colour included. Tiers A and C need a per-treatment edge (normal/data 512, colour 1024).
3. **Startup actors.** `selectWork` throws "a public character needs its adopted LOD" only for *chosen* public characters. `--only` with environment keys avoids that throw, but nothing forbids choosing an actor, violet-behemoth or camp-cave (its standalone images would be re-planned against adopted manifests and fail).
4. **Verification.** `verify-candidates.mjs` resolves originals through the current manifests (`loadOriginal`: "no longer delivered by the current manifests"), so it cannot verify r05 after adoption either.
5. **The publisher (`adoption.mjs` / `adopt-candidates.mjs`) rejects a partial or chained revision before writing anything:**
   - `checkRevision`: `scope.complete !== true` → "a partial revision; only a complete revision can be adopted";
   - `checkInputs`: r05 inputs differ from the current, a01-rewritten, manifests → "stale … nothing was planned";
   - `adoptModel` → "already carries runtimeOptimization", and "not the candidate's source";
   - builds: `activeAdoption` refuses manifests that name two adoptions.

   That is the correct fail-closed behaviour, but it gives r05 no way through.

## 5. Minimal safe pipeline and the code it needs

**Principle.** r05 is a new, partial revision derived from the same SHA-verified originals as r04. It is chained on top of `a01`. Nothing in r04, `a01` or the acceptance documents is rewritten; `a01` stays as history.

### Generator (`scripts/optimization`)

- **`inventory.mjs` → `snapshotInventory(root, adoptionId, rules)`.** It builds the inventory from `assets/runtime-adoption/<id>/before/` (original records) after checking four things:
  - the journal is `applied` and belongs to `plan.json`;
  - every rewritten current manifest equals its `after` SHA, and every other input equals its `before` SHA;
  - every `before` SHA equals `plan.inputs`;
  - r04's `inputs.manifests` matches.

  It reuses the `readManifest` pattern already in `planStandaloneImages`, and the same SHA checks as the r14 test helper.
- **`generate-candidates.mjs --base-adoption <id>`:**
  - It requires `--only` and `--out` and uses `snapshotInventory`.
  - It refuses any `--only` key that is a startup or full-only entry in the base graph, owns standalone images (camp-cave), or is excluded.
  - It runs no startup derivation.
  - It records `scope: { complete: false, only, base: { adoption, planSha256 } }` and the per-model per-treatment edges in the manifest.
  - Output names derive from the *original* URLs, as before.
- **`--maps-512 <keys>`.** `planTextures` accepts `edge` as `{ color, normal, data }` (default 1024 for all). The plan records each image's edge. `verifyDerived` checks each image against its own edge, not the file's single `maximumTextureEdge`. `contract.mjs runtimeIndexOf` keeps the file maximum and adds per-image edges.
- **`verify-candidates.mjs --base-adoption <id>`.** It verifies originals through the snapshot inventory and checks partial-scope coverage (exactly the listed keys). The default strict mode stays unchanged.

### Publisher (`adoption.mjs`)

**`planAdoption({ base })`** accepts a partial revision only when `base` is given:
- **Base checks.** `base` must be applied, and the current manifests must equal its `after` bytes. The revision's base and its `before`-derived inputs must equal the base record.
- **Graph.**
  - The new graph is the base graph cloned. Each scoped *ordinary* entry is replaced with the r05 candidate, and its primary and LOD identities are kept as `supersedes` (adoption, URL, SHA, bytes).
  - Startup, full-only and texture entries are copied byte-equal; it refuses if a scoped key has any other selection.
  - `retired` gains the superseded r04 candidates.
- **Manifest rewrite.** It starts from the current (base-after) bytes:
  - each scoped record's identity must equal the base entry, not the original;
  - only `url`/`sha256`/`bytes` of the primary and LODs change, plus `runtimeOptimization.supersedes`;
  - `runtimeOptimization.adoption` (and the texture provenance id) changes to the new id on every adopted record, so builds still see exactly one active adoption with a complete graph;
  - `original` stays byte-equal.
- **Audit and restore.**
  - Audit checks that the base record's files are unchanged and that `before/` equals the base `after/` bytes.
  - Restore returns the manifests to the `a01` state, not to the originals.
  - After `a02` is applied, `a01`'s own audit will report "current manifests not a01 after-bytes". That is expected history, not a failure to fix.

**`runtime-graph.mjs`** needs no change: the new plan graph is complete.

### Tests (new; synthetic fixtures; no real assets written)

1. `snapshotInventory`: original records from `before/`; fails on a current-manifest drift, a tampered `before/` file, a journal that isn't `applied`, or a plan SHA mismatch.
2. Generator `--base-adoption`: refuses startup actors, violet-behemoth and camp-cave in `--only`. Outputs are named from original URLs. The r04 revision directory is byte-identical before and after.
3. `--maps-512`: normal and data maps 512, colour 1024; verifier rejects a colour image at 512 and a normal map at 1024 under that plan; per-image edges recorded.
4. Publisher with base:
   - partial without base → rejected (existing behaviour kept);
   - with base → the graph equals the base except the scoped entries;
   - startup, full-only and texture entries stay byte-equal;
   - `original` is kept and `supersedes` recorded;
   - restore returns to base-after bytes; the base record is unchanged;
   - builds accept the single new id and reject mixed ids.
5. Real data, read-only: the `--base-adoption 20261009-r04-a01 --only <tier A keys> --maps-512 <tier A keys> --dry-run` plan lists exactly the Tier A images.

## 6. Checks required before any adoption (Codex)

- **Before generation (read-only metrics; new tool output, nothing written to public):**
  - Tier C and the hide-tent data map: decoded per-channel min/max/stddev.
  - Tier D: per-primitive UV span and texels per metre at 1024 and 512, for each ground and water tile.
  - Tier D proceeds only if 512 keeps at least the r04 runtime's apparent sharpness at the closest walkable distance after the shader's world-space noise. Otherwise drop it.
- **Images:** for every changed image, show original, r04 and r05 side by side at 100% and upsampled. Normal maps get box-renormalised decoding; check for banding and lost relief. Report PSNR/SSIM per image as context, not as acceptance.
- **Native renders, Chrome and Windows WebKit**, at 390×844 with DPR 1 *and* a DPR-3-equivalent buffer (the probe ran at DPR 1, so real phones want more texels):
  - each Tier A prop at its closest camp distance (about 1.5–3 m), under firelight and daylight, at raking angles;
  - the held spears and katana in the third-person close camera;
  - the orb-bots close up;
  - for Tier D: ground at walking distance, at grazing angle and across tile edges; the river surface;
  - the camp-mountain flank from spawn.
- **Integrity:** strict `verify-candidates` on r05 with its base; adoption dry-run, apply, audit; then local, exhibition and public build graphs with the decoder and allowlists unchanged. Confirm the 7 actors, violet-behemoth, cave images and r04/`a01` files are unchanged.
- **Measurement (matched to the r04 runs):** texture-payload probe for camp, mammoth and overview (live handle counts must not rise), and the 10 Mbps cold startup.

## 7. What 200 MB would additionally need (separate decisions, not in r05)

- **Character body maps (protected).** Body normal and data maps at 512, with every head/face material kept at 1024, would save about −4.19 MB per map, roughly −40 MB for the five camp actors *est.* This needs per-material edges, a new startup-actor revision derived from originals, and full face, body and animation review. It needs explicit approval.
- **Runtime (owner 026):**
  - share identical encoded images across templates (meadow-ground/camp-mountain, −5.6 MB);
  - release gallery images after leaving the cave (overview);
  - defer LOD-only files that are not drawn at spawn (the network analysis lists 3.65 MB).
- **GPU-compressed formats (KTX2/Basis)** would cut payload about 4–8×, but they are currently unsupported and out of policy.

## 8. Addendum (r16, 2026-10-10): policy wording corrected

§1 ("needs a separate decision") and §7 ("needs explicit approval", "unsupported and out of policy") overstate the policy. Character body maps and GPU-compressed formats fall within the already authorized optimization scope. They need no new user approval, and no policy forbids them. Each needs its own implementation and its own visual review before adoption:
- body maps: per-material edges and a startup-actor revision derived from originals, with face, body and animation review;
- KTX2/Basis: loader, transcoder and packaging support, and device review.

Both are intentionally outside the current narrow change, which is the generator/verifier phase of r05: `--base-adoption`, `--maps-512` and `--edge-512` for the 19 tier A–C models. Codex's exact Pillow decode (`texture-pixels-r05.json`) found zero constant RGBA images among 134, so no map is collapsed to a constant.
