# Startup transfer budget review r09 (read-only) — 2026-10-10

**Sources.** `startup-transfer-breakdown-r02.json`, built from the r07 ledger r02 run (r04 assets, r07 runtime, cold, 10 Mbps / 50 ms / CPU4); `performance-startup-overlap-r07.md`; the r04 candidate `manifest.json` (per-image SHA and bytes); and the current source.

**What the bytes mean.** All byte figures are server-offered response bodies, not bytes the browser had already received. Times derived from bytes are transfer floors only. They use 1.25 MB/s, the theoretical 10 Mbps rate; the calibrated aggregate is about 1.19 MB/s.

**r05.** r05 (a02) changed 19 scoped models but no ground or actor. Codex must re-check any scenery byte figure below against the r05 graph; the snow-ground, meadow-ground and camp-mountain figures are what the r05 graph should still serve.

Nothing was run or changed.

## 1. Where the bytes are (r07 r02)

| Interval | Bodies | What |
|---|---:|---|
| Title, before confirmation | 13.54 MB | Modules 12.52 MB: the data modules 8.36 MB (paleo-coast 3.58, camp-mountain-surface 2.55, landmark-bounds 1.02, castle-surface 0.98, camp-cave-surface 0.22) and Three 2.09 MB. Textures 0.88 MB |
| Confirm → cave playable (15.35 s) | +17.44 MB | Self startup body 5.41, cave model 2.12, 10 cave images 7.58, catalog JSON 0.82, spears (one still in flight) |
| → world ready (50.43 s) | +37.86 MB | World critical set 34.73 (r04), berry-cluster 0.26, mammoth (in flight) |
| → controls (56.54 s) | +4.84 MB GLB, +0.73 MB audio | Mammoth 4.34 + LOD 0.40, meat 0.58, NPC/orb-bot bodies (in flight), wind.mp3 |

At controls, the bytes since confirmation are about 85% GLB (49.93 MB including in-flight) and 8.42 MB standalone images. Only about 1 MB is compressible text: catalog 0.82 MB and worker modules 0.20 MB.

## 2. Physical floors at 10 Mbps (current flow and assets)

- **Self startup body alone:** 5,412,384 B = **4.33 s**. Of that, 0.78 MB is WebP images; the rest is skinned geometry and clips. The retained full head primitive (52,910 triangles, 4.52 MB raw) dominates, under the approved head-retention policy.
- **Self + cave model:** 7.53 MB = 6.03 s. That is already over 5 s, before any mural, the catalog or the world.
- **Cave playable minimum** (catalog, self, cave model and images, spears): about 16.6 MB = **13.3 s**.
- **World ready:** bodies completed by world ready, net of title and non-awaited streams, are about 52.4 MB = **41.9 s** before any CPU.

**So 5 s is not physically reachable for cave playable or for controls with the current mandatory set.** That holds even if every avoidable byte below were removed. Getting there requires a different milestone or new asset-budget decisions: a smaller approved self startup body, cave model and murals. A runtime change alone cannot do it.

## 3. What is required before controls

**Unavoidable with today's assets and the retained cave journey:**
- the verified catalog;
- the selected actor's startup body and held props (`world3d.ts prepareSelf`, essential tier);
- the cave model and its 10 verified images (`loading-cave.ts load` → `loadCaveTextures`);
- the floor grounds within 82 m (meadow-ground, snow-ground; `startup-plan.ts criticalFloorKeys`);
- water (river-water: tiles, ocean, marsh);
- mountain level 0 (seen at camp);
- the camp props built synchronously (`world-scenery.ts sceneryTemplateKeys`, `addModel` / `createResource`);
- the collision and terrain data modules (static imports used by the cave walk and the world).

**Avoidable without any visible change** (identical pixels and geometry), in descending size:

| Item | Bytes (r04) | Evidence |
|---|---:|---|
| Duplicate embedded images, snow-ground | 4,805,628 | All three levels embed the same output images d0ac3101… (1,472,448 B) and f8129f38… (930,366 B). Their geometry is only 151,228 / 26,873 / 7,005 B compressed |
| Duplicate image, camp-mountain LOD | 2,045,159 | The LOD and the full model both embed ef3816a7… (2,045,159 B) |
| Same image again inside meadow-ground (cross-template) | 2,045,159 | meadow-ground also embeds ef3816a7… (manifest line 9435) |
| Duplicate image, firewood-log levels 1 and 2 | 646,748 | 7d243ba0… (323,374 B, unchanged bytes) is embedded in all three files |
| Duplicate base colour, hide-tent LOD | ≈289,000 | Same source image 945acbd3… in both files; the resized output's identity is not yet checked |
| Never-displayed LODs | 823,900 | wood-footbridge LOD 335,096 + drying-rack LOD 488,804. Both keys are only created by `addModel` → `create(key, 0)`, are not in `LOD_PROPS`, and appear in no palette, regional surface or resource path |
| Other LOD base colours (valley-pine, firewood-pile, stone-firepit, valley-boulder) | ≤1.2 MB | Image byte counts suggest the same pattern; SHA not checked |

Verified within-template duplicates total **7.50 MB**, and **9.54 MB** with the meadow/mountain cross-template copy. That is 22–27% of the 34.73 MB world set, or about 6.0–7.6 s of the measured world phase.

**Not visible at spawn, but required today because a template is all-or-nothing:** the camp-mountain LOD and the snow-ground full/LOD2 levels. Once the duplicate images are gone, these cost only their geometry (402 KB, and 151+7 KB). Deferring them would therefore save almost nothing and needs a new LOD architecture. **Do not pursue.**

**Not on the readiness path, but contending during proceed → arrival:** about 5.6 MB.
- the post-ready streamed actors: mammoth, meat, the NPC body, orb-bots;
- the sequential nature-audio fetch, which starts on the proceed gesture (`nature-audio.ts load`).

Their effect on controls is not attributed; arrival mostly needs CPU and a small WebSocket snapshot. **Measure before changing them.** Any change only alters when they appear, and must not create a new missing near object.

**No remote terrain is loaded before controls.** The only grounds are the two floor keys.

## 4. Code facts that shape the fix

- **Embedded resources only.** `embedded-glb.ts parseEmbeddedGLB` refuses anything that isn't embedded (`setURLModifier`, lines 305–308). Separate files cannot simply reference shared image URLs.
- **One file per level.** `world-assets.ts loadTemplate` (277–303) downloads the full model, then each LOD record as a separate verified file. It then runs `coalesceTextures`, which shares textures in GPU memory only after every duplicate has been downloaded.
- **Multi-scene is already handled.** `coalesceTextures` / `disposeModels` (407–469) walk all scenes of a cohort (`scenesOf`) and dispose shared textures and images once. One GLB whose scenes are the template's levels is therefore already handled by release.
- **Few call sites read the manifest's `lods` records:** `world-assets.ts` 141 (progress size), 281 and 525 (load loops) and 332 (distances), plus `character-assets.ts` 65, `performance-lod.ts` 146 and `model-review.ts` 521. Everything else uses the runtime `template.gltf` / `template.lods`.
- **Per-level material mutation.** `world-landmarks.ts` (mountain materials, cave materials, lava) and `open-world.ts prepare` mutate materials per level. A packed GLB must keep **distinct material entries per level**, referencing a shared texture or image index, exactly as today's post-coalesce state.

## 5. Recommended implementation order (each step measured before the next)

**Step 1 — clear the two never-displayed LODs (−823,900 B r04; about 0.66 s floor).**
- **Owner:** Publisher587's adoption graph/plan (clear `lods` for wood-footbridge and drying-rack; files kept, reversible). No runtime change.
- **Tests:** a new behavioural reachability test that builds the camp, regional and resource scenery from the real `SCENERY` / `BIOME_SCENERY` data with a recording `WorldAssets`. It asserts both keys are only ever created at level 0, plus a publisher graph-diff test.
- **Native gate:** identical camp, bridge and drying-rack screenshots at near and far distances. Both LOD URLs absent from the ledger.

**Step 2a — pack snow-ground and camp-mountain into one image-sharing GLB each (−6.85 MB verified; about 5.5 s floor).**
- **Why these two:** neither is touched by r05, and they are the largest duplicates.
- **Asset (publisher):**
  - each template becomes one hash-addressed GLB whose scenes are levels 0..n;
  - images are stored once per SHA, materials stay distinct per level, and node, mesh and accessor values are unchanged;
  - the manifest's level records carry a scene index and distance instead of url/sha/bytes;
  - the verifier decodes every packed scene and compares it value for value with the separate r05 file (the `tests/runtime-model-identity.mjs assertSameGeometry` approach), plus image SHA identity.
- **Runtime:** `world-assets.ts` only (`loadTemplate` and the `loadStartup` size). One verified download per template, with each level wrapped as `{ ...gltf, scene: gltf.scenes[i] }`; everything downstream is unchanged.
- **Unit tests:**
  - per-level geometry and material parity against the separate-file template;
  - one Texture per image identity, `coalesceTextures` retiring 0, each resource disposed and each image closed once;
  - the progress total equals the packed bytes;
  - SHA-mismatch and partial-download rejection unchanged;
  - snow release and re-request (on-demand environment);
  - `OpenWorldTerrain.prepare` per-level meshes equal to the separate-file case;
  - `fitCampMountain` per-level bitwise parity, with mountain materials prepared once per level.
- **Native gates:**
  - screenshots at camp, at snow LOD1/LOD2 distances and of mountain level 1 seen from the castle;
  - GPU texture count not increased;
  - context loss and restore, and CacheStorage entries;
  - ledger bytes −6.85 MB;
  - paired cold 10 Mbps world ready and controls.

**Step 2b — the same packing for firewood-log, hide-tent and the remaining LOD-bearing camp props**, once their output image SHAs are confirmed. That is 0.65 MB verified, plus up to about 1.5 MB.

**Step 3 — lossless re-encoding of the remaining PNG textures** (cave murals 7.58 MB, ef3816a7, the snow images, river-water's).
- **Why:** pixel-exact, so no subjective quality acceptance is needed, and the runtime already decodes `EXT_texture_webp`.
- **Size:** unmeasured. Lossless WebP is often 20–35% smaller than PNG, so perhaps −3 to −5 MB, until actually encoded with a pinned encoder.
- **Verification:**
  - decoded RGBA equality in Chrome and WebKit along the game's own decode paths; PNG gAMA/cHRM chunks may matter;
  - the cave image tests that currently assert a PNG signature must be updated deliberately.
- **Owner:** publisher plus adoption. This is the only listed step that also shortens cave playable.

**Step 4 — cross-template image sharing** (meadow ↔ mountain, 2.05 MB).
- **What it needs:**
  - a verified external-image path, which `parseEmbeddedGLB` refuses by design;
  - image identity outside `selectedImage`;
  - cache accounting;
  - release refcounting across templates with different lifetimes (meadow is on-demand, the mountain is resident).
- **Verdict:** high complexity for 2.05 MB; only after Steps 2–3.

**Step 5 — measure arrival-window contention** (the streamed actors and audio, ≈5.6 MB) using WebSocket join/snapshot timing and long tasks, before considering any start delay.

**Projected floor** (verified items only; CPU tail and arrival extra): bodies to world ready ≈52.4 → ≈44.7 MB after Steps 1 + 2a, or about **35.8 s** theoretical. Further reductions are possible with 2b, 3 and 4. Even with all of them, controls stay at roughly 35 s or more at 10 Mbps cold. **Not a 5 s path.**

## 6. Local raw HTTP vs eventual Cloudflare

**Local test server (raw bodies, as measured).**
- The title's 12.52 MB of modules take about 15.5 s before confirmation, and the 0.82 MB catalog JSON is paid in full.
- If local or exhibition serving matters, enable compression on that server, measured, rather than restructuring the module graph that the title, the gallery collision and the world share.

**Cloudflare.**
- **Text compresses.** A read-only GET of the public site measured the four data modules at 0.872 MB gzip for 8.14 MB decoded. Two match the frozen local SHA and two differ (the public copies are older), so this is not the current build.
- **Since-confirm time barely changes.** About 95% of the since-confirm bytes are PNG/WebP and meshopt GLB. Images are already entropy-coded. Whether `.glb` responses get compressed depends on the served content type and Cloudflare's compressible list. That is unverified; meshopt streams would gain only modestly.
- **Not evidence of current performance.** The older public deployment cannot prove anything about the current build.

**Other transport points.**
- **KTX is GPU compression, not network compression.** The KTX 1024-normal proof gave larger GLBs than r04.
- **Repeat visits** are the separate, cache-bound case: the SHA-keyed verified cache plus immutable caching of hash-addressed URLs. Measure them as a warm-start profile; Step 2 also frees about 7.5 MB of the 64 MiB cache budget.

## 7. Bounded conclusion

- **The next safe implementation** is Step 1, then Step 2a: identical visible content, no readiness, collision or warp change, no fallback, and the cave journey and exhibition flow untouched.
- **Saving:** about 7.7 MB (≈6 s of transfer floor) of the world phase.
- **The requested 5 s target** is unreachable at 10 Mbps with the mandatory self body (4.33 s) plus cave model (1.70 s). It needs asset-budget decisions on the self startup body, the cave assets and the murals, or a redefined milestone. Each of those is a product and acceptance decision, not a runtime change.
