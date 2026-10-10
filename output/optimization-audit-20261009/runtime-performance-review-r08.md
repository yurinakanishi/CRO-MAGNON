# Runtime CPU review r08 (read-only)

Runtime owner 026f16c0-538a-4645-99e9-a78a97eaa58f, 2026-10-10. Read-only review: no src/shared/tests/scripts/public/assets file was changed and no command was run. The whole optimization is **not** complete, and nothing here makes a performance-guide or physical-phone claim. r04 candidate, adoption and acceptance records remain untouched.

## Evidence used

- `performance-cpu-adopted-r04-profile.md` and `adopted-r04-cpu-profile-r01/{camp,mammoth,overview}.cpuprofile`, `cpu-attribution.json`: the frozen `adopted-r04-build-r01`, CPU×4, 390×844, sampled for 8619/7116/7062 ms. Compiled line numbers below refer to `adopted-r04-build-r01/dist`.
- `performance-adopted-r04.md` for the normal unprofiled FPS/p95; `performance-gpu-texture-adopted-r04.md`; `startup-network-analysis-r04.md`; `live-checkpoint-after-0420-limit.md` including its final addenda.
- Current source, read only: `src/world3d.ts`, `src/main.ts`, `src/world-map.ts`, `src/companion-view.ts`, `src/regional-scenery.ts`, `src/world-scenery.ts`, `src/world-assets.ts`, `src/visible-actor-group.ts`, `src/skinned-bounds.ts`, `shared/collision.mts`, `application/game-core.mts`, and vendored three r185 `Object3D.updateMatrixWorld` and `WebGLRenderer.setProgram`.

## How to read these numbers

- This is one profiler-perturbed run per view. The effective sample interval is about **1.52 ms**: drawWorldMap's 160/131/120 samples correspond to 242.6/200.2/183.4 ms. Nodes with fewer than about 10 samples are noise.
- The main thread is saturated: `(idle)` is only 2.0–2.1% of sampled time. `(program)` is 3494.7/1978.9/1711.6 ms (40.5/27.8/24.2%). That native time is **unclassified**: style, layout, paint, commit, GPU IPC and similar work cannot be attributed from a V8 profile.
- **Self** is the time with the function on top of the stack. **Inclusive** sums every node of that function. For recursive functions (updateMatrixWorld, projectObject) inclusive counts nested occurrences more than once (1374–2055 ms), so it is not a cost. Inclusive values of callers and callees overlap and must never be summed.
- updateHUD and updateHuntingHUD overlap. updateHuntingHUD has two call paths of similar size. In camp, for example, 33 self samples come under updateHUD (the WebSocket state task) and 34 come directly from the 100 ms `setInterval` timer task.
- Sample shares say where the main thread was. They do not show what limits FPS or p95. Any change must be judged by the same unprofiled 12-second CPU×4 portrait and CPU×1 desktop samples.

## Measured observations

1. **Scene transform traversal.** Three `updateMatrixWorld` self time is 291.4/396.6/325.5 ms, and `multiplyMatrices` self is 76.1/93.7/105.3 ms.
   - The self samples sit in the plain `Object3D` recursion under `WebGLRenderer.render`, at shallow depths:
     - camp, depth 0/1/2/3/4: 17/43/39/33/8 samples;
     - mammoth, depth 0/1/2/3: 26/60/52/31 samples.
   - The actor branch (`VisibleActorGroup.updateMatrixWorld`, a separate frame) is only 148.7/104.7 ms inclusive in mammoth/overview.
   - In code, r185's `updateMatrix()` always sets `matrixWorldNeedsUpdate`. So any node with `matrixAutoUpdate=true` recomposes itself and forces a multiply on its whole subtree every frame. Invisible nodes are traversed too.
   - The scene root, open-world terrain, landscape instanced meshes, landmarks and camp tents/props/ridges (`freezeStatic`) are already frozen.
   - These are still default auto-update roots added directly to the scene:
     - regional props (`RegionalScenery.admit`), including every `THREE.LOD` level clone;
     - fire roots (`buildFireEffect`);
     - the river tile group, mountain river, marsh pools and footbridge;
     - resources.
   - Which of these actually make up the depth 1–3 samples is **not measured**.
2. **Minimap.** drawWorldMap is the largest application self item: 242.6/200.2/183.4 ms.
   - **120/160, 102/131 and 98/120** of its self samples are on compiled line 481, `ctx.font = '12px sans-serif'` (src/world-map.ts:570). This is the first font assignment of each draw.
   - Canvas natives sampled as separate children are tiny (camp: drawImage 5, fillRect 3, beginPath 1 samples). The river/lake path building costs only a few samples.
   - drawMinimap runs inside `updateHUD()` on every state message: the server broadcasts at least every 90 ms on 50 ms ticks, and on every tick when things change. It runs after updateHUD and updateHuntingHUD have already written a lot of HUD DOM.
3. **Companion close-up choice.** `companionViewChoice` inclusive is 97.4/591.4/231.9 ms.
   - Almost all of it is in its per-candidate `.map` callback (581.9 of 591.4 ms in mammoth). In mammoth the callback's children are `segmentFree` (31+28 self samples on the two paths) and `applyMatrix4` (1+1).
   - It is called from updateHuntingHUD only to produce the "inspect" cue label. It runs about 20 times a second (both HUD paths).
   - In code, `world3d.ts companionViewChoice` calls `collision.segmentFree(me, t.point, 0.05)` for **every** candidate. That includes every far orb bot, friend and mascot. The 8 m range and on-screen tests in `chooseCompanionView` are applied only afterwards.
   - segmentFree takes about one `free()` → `nearby()` step (Set allocation plus string grid keys) per 0.25 m of segment length, or per 0.05 m near walk surfaces.
   - In mammoth, collision `nearby` self is 199.9 ms and `free` inclusive is 415.3 ms. The other HUD gates (`nearOrbBot`, resource `nearby()`) already test distance before `interactionVisible`.
4. **Other measured items (no change proposed here).**
   - Draw-time program re-resolution: `getProgram` self 120.9/–/159.8 ms (inclusive 351.6/–/441.0) and `getParameters` self 185.0/–/211.8 ms in camp/overview. In camp, getProgram's parent is `setProgram`, so `needsProgramChange` is true at draw time repeatedly; the reason is unknown.
   - Steady-state texture uploads: `texSubImage2D` self 72.8/44.1/72.6 ms; `uploadTexture` inclusive 124–167 ms.
   - The `JSON.parse` line of the WebSocket handler: 34 samples in camp.
   - `#world` dataset writes in updateHuntingHUD (compiled lines 1501/1630).

## Hypotheses (not established)

- **H1:** Line 481 is a forced synchronous style update.
  - Blink's canvas font setter resolves style for the connected canvas, flushing the HUD's pending invalidations.
  - An alternative is font realization on each 12 → 17 → 10 px change.
  - A trace decides between them. If H1 holds, part of that cost reappears as normal frame style work after any reorder.
- **H2:** Static placements left on auto-update dominate the shallow traversal samples. Hidden LOD levels and culled props are still traversed.
- **H3:** HUD timer and WebSocket tasks (often 3–5 ms each under CPU×4) delay rAF frames and contribute to the 54 ms p95. That needs frame-level trace evidence.

## Prioritized changes (at most three; each needs Codex assignment)

### 1. Companion close-up: test collision last (highest confidence, no behaviour change)

- **Files:**
  - `src/companion-view.ts`: `chooseCompanionView` gets an optional lazy predicate, defaulting to `c => c.clear`, so the existing callers and test are unchanged.
  - `src/world3d.ts`: only `companionViewChoice` changes. It stops eagerly computing `clear` and passes `t => this.collision.segmentFree(me, t.point, 0.05)`.
  - Owner: runtime. No change to `shared/collision.mts`, which belongs to cave/collision owner 8031244b.
- **Invariant:** for every candidate set, the chosen target is identical. `clear` is a pure conjunct, now evaluated only after the finite 8 m distance and the screen x/y/z bounds pass. Ranking and the input list are unchanged. Camera, zoom, inspect and gameplay collision are unchanged.
- **Regression tests:**
  - Extend `tests/companion-view.test.mjs`. The predicate is called only for in-range, on-screen candidates. Results equal the eager result over the existing edge cases (8.01 m, ±1.01 screen, NaN) and a seeded random set.
  - Add a `WorldRenderer.prototype.companionViewChoice.call(fakeWorld)` harness, following the pattern in `automatic-camera.test.mjs`. Use a real `PerspectiveCamera` and a counting `segmentFree`. Far or off-screen targets cause zero calls; a near visible target causes one; an obstructed near target is not offered.
- **Native:** adopted Chrome CPU×4 portrait, at the three views plus scripted cases:
  - companion within 8 m and visible → offered;
  - behind an obstacle → not offered;
  - at 8.5 m → not offered.
  - The inspect cue and close-up view behave as before.
- **Signal:** in a re-profile, mammoth `companionViewChoice` inclusive falls from 591 ms toward the cost of the near candidates. `segmentFree` inclusive, collision `nearby` self and `free` fall by about the same amount. Then compare unprofiled FPS/p95; no FPS gain is promised.

### 2. Minimap forced flush: draw before HUD DOM writes, and skip writes that change nothing (trace first)

- **Gate:** first collect a Chrome trace with `devtools.timeline` and invalidation tracking over 12 s per view. It must confirm that `UpdateLayoutTree` runs inside drawWorldMap's font set and list which writes invalidated style beforehand. Do not implement if H1 is refuted.
- **Files:**
  - `src/main.ts`: `updateHUD`, and `updateHuntingHUD` only for the writes the trace identifies. Move `drawMinimap()` ahead of the HUD DOM writes in the same task; it reads only `state`/`selfId`. Elide `hidden`/`className`/attribute/`dataset` writes whose value is unchanged, following the existing `text()` write-if-changed helper pattern in `barter-ui.ts`, `pantry-ui.ts` and `village-ui.ts`.
  - `src/world-map.ts`: no drawing change.
  - main.ts also contains startup/gallery entry code, so coordinate with startup/cave owner 8031244b before editing.
- **Invariant:**
  - Minimap pixels are identical for the same state.
  - After every update, HUD DOM is identical: text, hidden/disabled, classes, aria, every `#world` data-* QA hook. HUD update frequency and timing are unchanged.
- **Regression tests:**
  - If a helper is extracted, Node tests: no write when equal, a write when different, and the same final semantics as direct assignment (`hidden` boolean, dataset string coercion).
  - The existing tests that read `#world` dataset hooks must pass unchanged.
- **Native:**
  - A minimap `getImageData` hash before/after at fixed prepared states.
  - A HUD DOM snapshot sequence across a scripted mount/dismount, cooking, combat and companion sequence must be identical.
  - The 11 lifecycle checks still pass.
- **Signal:** samples on the first `ctx.font` line fall from 98–120 toward zero. Trace total `UpdateLayoutTree` time per second must **not** increase; otherwise the work was only moved. Fewer attribute mutation records per second while idle.

### 3. Freeze proven-static placements (census first)

- **Gate:** a read-only census on the adopted build first, via CDP `Runtime.queryObjects` on the Scene prototype; no product hook.
  - For each direct scene child, record kind/name/assetKey, descendant count, the number of `matrixAutoUpdate=true` nodes, visible, and whether the local TRS changed over 600 frames.
  - This yields the per-frame number of recomposes and multiplies by category.
  - Freeze only categories with an unchanged TRS and a non-trivial count.
- **Files:**
  - `src/regional-scenery.ts`: props in `admit` (all LOD levels; `THREE.LOD.update` still switches only visibility).
  - `src/world-scenery.ts`: reuse the existing `freezeStatic` pattern for fire roots, the river tile group, mountain river, marsh pools and bridge. The camp-cave hearth is built here, so coordinate with 8031244b.
  - Exclude resources (wood/stone piles, berry fruit attachment, amount handling), actors and anything else that moves.
  - Optional, separately measured phase: a `VisibleActorGroup`-style early return for **hidden frozen** roots, so culled props are not traversed.
- **Invariants:**
  - For every frozen node, `matrixWorld` is exactly equal to what auto-update would produce.
  - No code path writes a frozen root's TRS. Eviction (`scene.remove`), `staticScenery` culling, LOD level selection and context restore are unchanged.
  - No change to visuals, render distance, geometry, materials or collision.
- **Regression tests:** a new focused test, or an extension of `tests/streaming-performance.test.mjs`, using the existing `RegionalScenery.prototype` harness from `warping` and `startup-streaming`:
  - every admitted prop node is frozen, with element-equal `matrixWorld` versus an unfrozen reference;
  - 60 `scene.updateMatrixWorld()` calls perform zero `updateMatrix` calls on frozen nodes, while an animated bone still updates;
  - LOD levels chosen at several distances are unchanged;
  - hide→show keeps exact world positions;
  - eviction and re-admission still work.
- **Native:**
  - repeat the census (frozen roots' TRS unchanged over 600 frames);
  - check camp/overview screenshots;
  - warp across regions (eviction and re-admission);
  - three context loss/restore cycles;
  - unprofiled CPU×4 and CPU×1.
- **Signal:** `updateMatrixWorld` and `multiplyMatrices` self time, and depth 1–3 samples, fall in camp/overview. The recompose count drops by the census number. Traversal visits remain unless the optional phase is applied, so the expected gain is partial.

## Not proposed

- Lowering the HUD or minimap update rate.
- A cached or Path2D minimap layer, OffscreenCanvas text, or material cloning for program re-resolution. Each would change timing, glyph or material behaviour, or material ownership.
- Any vendor patch, shader/material quality change, render-distance change, rejected actor/behemoth LOD, physics relaxation or relaxed test threshold.

## Unresolved evidence requirements

1. A scene census, as described in change 3.
2. A Chrome trace with invalidation tracking, as in change 2. It should also give per-second call counts for updateHUD/updateHuntingHUD/drawMinimap/companionViewChoice and the measured state-message rate.
3. Per-call companion candidate count, segment lengths and segmentFree step counts per view.
4. Classification of `(program)` with a full trace (blink, cc, gpu and v8 categories). Camp's 40.5% is notably higher than 24–28% in the other views.
5. The draw-time `needsProgramChange` cause: CDP logpoints on the vendored setProgram branches, recording object/material names. This belongs to the material/renderer owner. Any fix needs its own visual proof.
6. Which texture(s) are re-uploaded every frame (texSubImage2D/uploadTexture), and whether their contents actually change.
7. After each change: the same unprofiled 12-second CPU×4 portrait and CPU×1 desktop samples (FPS, p95, draws, triangles, heap), the 11 native lifecycle checks, and a re-profile with this note's line mapping refreshed for the new build.
8. Startup is separate. The analysis in `startup-network-analysis-r04.md` predicted 50.5 MB, but the measured cumulative decoded bytes at controls were 71.3 MB. Whether controls wait on the 4.34 MB mammoth body or on synchronous decode/compile is unmeasured. That belongs to the startup/cave owner, and none of the changes above overlap it.
