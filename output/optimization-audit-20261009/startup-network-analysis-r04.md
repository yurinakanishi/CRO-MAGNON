# Startup network analysis (read-only), r04 candidates vs current originals — 2026-10-10

Scope: source reading of the current tree plus `pre-adoption-network-r01/result.json` (native Chrome, 390x844,
CPU4, 10 Mbps / 50 ms, cold cache, local uncompressed serving) and the saved r04 `runtime-index.json`.
Nothing was run, built, generated or modified. Byte figures are exact file sizes from manifests/index.
Times derived from bytes are **transfer lower bounds** at the calibrated aggregate rate in r01
(2 x 2,097,152 B in 3,480.7 ms = **1.205 MB/s**); they exclude CPU (hashing, meshopt decode, PNG
decode, shader compile, terrain/mountain fitting) and are **not** post-adoption timings.
r01's final assertion was a QA error (the gallery prepares the template; join/arrival follow proceed);
the phase data below is unaffected.

## 1. What r01 actually shows (pre-adoption)

| Phase (r01) | at / since confirm | Network content |
|---|---|---|
| Title | 14.47 s from navigation | ~11 MB JS/CSS, no GLB. Largest: paleo-coast-data 3,577,314 B, three.core 1,443,356, camp-mountain-surface-data 2,551,193, landmark-bounds 1,024,791, castle-surface-data 984,579, three.module 650,453 |
| Cave playable | 35.8 s | world-assets.json 773,457; asset.json 20,691; cave GLB 5,393,776; body 11,552,512 + LOD 736,684 (serial behind the body); then all 10 cave images 21,980,553 (33.2–50.8 s) |
| World prepared | 86.96 s | starts only after `cave.load()` resolves (52.7 s): spears 721,172; 15 startup keys 49,334,212 (each key = full + **every** LOD, sequential inside one queue job, 2 jobs at a time, FIFO in key order, camp-mountain last at 78.8–94.0 s); 2 cave images re-downloaded 3,737,216 (see §4); then ~9.8 s CPU tail from last critical byte (94.0 s) to ready (103.9 s), of which `worldPreparedMs` 2,311 |

Both bandwidth-bound windows match the calibrated rate: gallery critical bytes 39.66 MB / 1.205 = 32.9 s
(observed download window 32.8 s); world `loadStartup` 50.06 MB / 1.205 = 41.5 s (observed `worldLoadMs` 41,455).

Call sequence (all still current): `main.ts` `enterGame` → `await cave.load()` → `await Promise.all([renderer.startWorld(), renderer.prepareSelf(profile)])` → `cave.markWorldReady()`; proceed → `arriveFromGallery` → `renderer.arrival()` (snapshot + floor + attached own actor). `LoadingCave.load` = `loadCatalog` → `ensureInitial(camp-cave)` ∥ `provider.create` (body, essential ticket) → `loadCaveTextures` (10 verified images, **not** queued) → materials → `compileScene` → first render + rAF. `WorldRenderer.initializeWorld` = `planStartup` → `worldAssets.loadStartup(plan.keys)` → `buildTerrainAssets` (`OpenWorldTerrain.arrive`, bank worker jobs) → forest/camp builders → `new WorldLandmarks` (starts cave images when the arrival is near the cave) → `prepareMountain(plan.mountainLevels)` → `prepareEntry`.

## 2. Exact essential candidate bytes (r04 index vs current files)

Gallery critical set (after confirm; JSON excluded, unchanged):

| File | Original B | r04 B |
|---|---:|---:|
| camp-cave model-r26 | 5,393,776 | 2,120,208 |
| cro-magnon-woman body (+LOD) → r04 `startup.opt-7d7616b26f06a2ac.glb`, sole primary, LODs cleared | 11,552,512 + 736,684 | 5,412,384 |
| 10 cave images | 21,980,553 | 7,582,869 |
| **Total** | **39,663,525** | **15,115,461** (−24,548,064, −61.9%) |
| transfer lower bound @1.205 MB/s | 32.9 s | 12.5 s |

r04 image bytes: atlas 1,276,113; limestone 2,284,797; 524 565,002; Rimo 560,607; roundBots 463,714;
shapeBots 501,873; maruimo 500,299; maeKohaku 468,227; friendsMeadow 475,063; friendsRiver 487,174.
(The body figure is the measured character, cro-magnon-woman; other characters differ.)

World critical set, current semantics (camp focus 48,57; keys from r01 `worldStartup`; camp-cave shared with the gallery):

| Key | Original full + LODs B | r04 full + LODs B |
|---|---:|---:|
| river-water | 1,905,036 | 1,888,804 |
| wood-footbridge | 1,814,304 + 794,156 | 811,604 + 335,096 |
| stone-axe | 817,044 | 754,124 |
| firewood-log | 805,748 + 365,064 + 339,432 | 761,000 + 353,856 + 335,588 |
| valley-pine | 2,149,136 + 905,208 | 1,685,752 + 686,388 |
| valley-boulder | 658,708 + 388,760 | 617,496 + 378,352 |
| hide-tent | 4,508,752 + 1,786,616 | 2,223,204 + 756,756 |
| drying-rack | 2,599,104 + 1,189,340 | 1,170,356 + 488,804 |
| firewood-pile | 972,828 + 429,888 | 895,528 + 405,968 |
| berry-bush | 2,415,948 | 2,048,808 |
| stone-firepit | 1,412,152 + 547,584 | 1,252,948 + 492,456 |
| meadow-ground | 2,126,388 | 2,105,700 |
| snow-ground | 3,092,188 + 2,907,308 + 2,877,800 | 2,557,764 + 2,433,372 + 2,413,924 |
| camp-mountain | 8,929,000 + 2,596,720 | 4,427,636 + 2,449,664 |
| **Total** | **49,334,212** (LOD files 15,127,876) | **34,730,948** (LOD files 11,530,224) |
| + held spears (prepareSelf) | 721,172 | 652,272 |

Post-confirm critical total: original 89,718,909 B → r04 50,498,681 B (−43.7%); transfer lower bound 74.5 s → 41.9 s.
r04 compression reduces bytes only; the serial order (gallery fully loaded → world starts) is unchanged.

## 3. Which LODs are genuinely needed at the camp spawn

| LOD | Used by | At spawn | r04 B |
|---|---|---|---:|
| wood-footbridge lod-c2 | none: `world-scenery.ts addModel` → `create(key, 0)` (not in `LOD_PROPS`) | **never drawn anywhere** | 335,096 |
| drying-rack lod-c2 | none: only a camp prop via `addModel`; not a biome palette entry | **never drawn anywhere** | 488,804 |
| valley-boulder lod-c2 | camp `LandscapeInstances` distances `[28, 28, 110]` → level 1 never selected; impostor is rendered from the full model. Only regional rock variants (`regional-scenery.ts` `[28, 50, 110]`) draw it at 28–50 m | not at spawn (r01: camp boulders `[1,0,4]`, snow variant `[0,0,1]`) | 378,352 |
| camp-mountain lod-performance | mountain level 1, chosen by `campMountainVisualLod` away from the mountain; fitted in background by `prepareMountain([0, 1])` after world-ready | not at spawn (`mountainLevels: [0]`) | 2,449,664 |
| valley-pine lod-c2 | camp trees 14–38 m | **needed** (r01 `[0,4,15]`: 4 instances at level 1) | 686,388 |
| snow-ground lod1/lod2 | terrain level 1 (44–82 m) / 2 (beyond); `OpenWorldTerrain.prepare` builds every level at once | snow is not admitted before arrival (r01 `terrainAssetTypes 1`, 11 meadow chunks within `admitRadius` 55 m) but joins within frames in the 55–82 m band and beyond; keep. Whether snow **level 0** is ever drawn near camp (chunks < 44 m or river/mountain-river bank chunks) must be computed, not assumed | 4,847,296 |
| hide-tent / firewood-pile / stone-firepit / firewood-log LODs | `LOD_PROPS` via `createResource` and regional shelters/hearths | some instances beyond their distanceMetres; keep | 2,338,624 |

Not needed at spawn: 3,651,916 B r04 (10.5% of the world set; ≈ 3.0 s lower bound), original 4,968,976 B.
Of that, 823,900 B r04 (original 1,983,496) is never displayed by any runtime path.

## 4. Repeated cave-image download (measured)

In r01 the world's cave preparation re-fetched `mural-atlas-r05.png` and `bot-round-lascaux-r31.png`
(3,737,216 B, ≈ 3.1 s); the other 8 came from the verified CacheStorage. The 64 MiB LRU cache stored
the gallery's 40 MB and then ~50 MB of startup scenery, evicting the oldest gallery entries before the
world asked for them. With r04 the whole first-session critical set (~50.5 MB + JSON) fits inside
64 MiB, so a repeat is not expected — this must be measured, not assumed (assert zero image requests
during the world phase).

## 5. Is parallel gallery/world preparation safe with the current queue?

Functionally yes. `startWorld()` requesting `camp-cave` joins the gallery's `template:camp-cave` job
(`WorldAssets.requestTemplate` → `joinOrRequest`); the body is one `CharacterAssets` template for the
gallery and `prepareSelf`; concurrent identical verified downloads are coalesced (`downloadVerifiedAsset`
running map) with separate decoded ownership; `prepareEntry` already draws offscreen behind the gallery.
Priorities: body essential (0), cave template and all 15 world keys initial (same tier, FIFO by request
order), limit 2.

It would not shorten time-to-cave: the 10 cave images are not queued, so world jobs would share the link
with them. The CPU headroom between the last gallery byte and cave-ready was only ~1.9 s in r01. If tried,
start world **downloads** only after the gallery's verified files arrive (or give the image batch a queue
ticket), never before; and measure gallery frame time on CPU4, because world building already runs while
the gallery is interactive.

## 6. Ordered plan (each step measured before the next)

1. **Apply r04 as contracted** (publisher/Codex). Expected bytes: gallery −24.55 MB, world −14.60 MB,
   spears −0.07 MB. Re-run `qa-network-startup` r02 with the same profile; record per-phase bytes and
   times; assert zero cave-image requests during the world phase and unchanged spawn screenshots
   (cave, shoreline, river bank, camp props).
2. **Stop transferring never-displayed LODs** (wood-footbridge, drying-rack: 823,900 B r04). Cleanest at
   the adoption-graph level (clear these `lods`, files kept, reversible), mirroring the startup-actor rule;
   no visual change by construction. Guard with a usage test (below). Owner: publisher + Codex decision.
3. **Overlap CPU with the remaining downloads.** Request camp-mountain and the grounds first (key order
   in `startup-plan.ts criticalStartup`: today scenery → floor → landmarks, so the 8.9 MB mountain lands
   last), and start `prepareMountain([0])` and floor bank fits when each template lands instead of after
   all 15 (`world3d.ts initializeWorld`, `open-world.ts arrive`). r01 has a ~9.8 s tail after the last
   critical byte (2.3 s of it `prepareEntry`); instrument fit durations on CPU4 before claiming a gain.
4. **Only after 1–3: defer later-only LODs** (camp-mountain lod-performance 2.45 MB, regional-only
   boulder LOD 0.38 MB). This is an **invasive redesign**: a template is all-or-nothing today
   (`WorldAssets.loadTemplate` loads every level as one job, `coalesceTextures` shares images across the
   whole cohort, `createSurfaceTemplate`, `LandscapeInstances`, `OpenWorldTerrain.prepare`,
   `createResource`, landmark LOD roots, release/dispose and hash diagnostics all assume every level is
   present). A narrow mountain-only "append level 1 later" is possible but still touches WorldAssets
   texture sharing and `fillMountainLevel`.
5. **Title-phase JS** (8.14 MB of data modules + 2.09 MB Three before the title). Measure the public
   Cloudflare compressed transfer first; local serving is uncompressed and must not be extrapolated.
   Lazy-importing data modules means changing the shared module graph that the title and gallery also
   import (the cave walk uses collision). Decide only on measured public bytes.

Keep throughout: gallery/contributors' cave and manual proceed; own verified body before controls
(`arrival` → `selfRenderReady`); `STARTUP` floor/view/admit radii and critical landmarks (shoreline and
startup scene); original rigs and collision; one fixed quality; fail-closed `downloadVerifiedAsset` and
manifest verification. Do not use the rejected low behemoth or player-face LODs, primitive placeholders, or
silent omission of nearby objects to meet a number.

## 7. Practical tests

- **LOD usage audit (new, unit):** from real `SCENERY`, `BIOME_SCENERY`, layout and placement data with the
  real thresholds (`LandscapeInstances` distances, `LOD_PROPS` / `createResource` distanceMetres,
  terrain 44 / 82 m, `admitRadius` 55, `campMountainVisualLod`, bank predicates), compute the (key, level)
  pairs any runtime path can draw, and those visible from focus (48, 57). Assert that the footbridge and
  drying-rack LODs are unreferenced, that the boulder LOD is regional-only, and that mountain level 1 is
  not visible at the camp focus. Report snow chunk distances and bank flags to settle snow level 0.
- **Startup queue order (extend startup-streaming):** the critical keys are requested mountain/floor first;
  the world's `camp-cave` joins the gallery's template job (one job); the body is loaded once.
- **Network QA r02/r03 (Codex, before/after adoption):** per-phase byte budgets from §2; no world-phase
  cave-image requests; no requests for never-displayed LOD URLs after step 2; the same spawn screenshots;
  verified-hash failures still stop entry.

Unverified here: actual Cloudflare compression, physical phones, iOS Safari, cellular, thermal, and CPU
durations of fits and decodes after adoption.
