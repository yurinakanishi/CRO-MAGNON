# Startup overlap after the critical load (read-only), r04 adopted — 2026-10-10

Sources: `output/playwright/optimization-20261009/adopted-r04-startup-spans-r01/result.json` (Chrome 154,
CPU4, 10 Mbps / 50 ms, cold cache, the r04 build), the current source and the r04 adoption record.
Nothing was run, built or changed. Times are seconds since the confirm tap (page time 18,318.6 ms). The spans
come from diagnostic wrappers. Phase boundaries are what matter: the uninstrumented baseline's controls were
ready at 63.04 s (62.77 s in this run).

## 1. The measured tail

The startup load ends at **44.95 s**. The last critical byte (camp-mountain `lod-performance`) arrives at
44.81 s, so the load is limited by the network right to its end. World ready is at **56.94 s**: an 11.98 s tail.

| Segment | s | What runs |
|---|---:|---|
| `OpenWorldTerrain.initialize` before `arrive` | 44.955–46.595 (1.64) | `createEarthTextures` (512×256 `geographicWeights` loop), `EarthOcean`, `installBiomeTerrain`. All on the main thread |
| `OpenWorldTerrain.arrive` | 46.595–49.053 (2.46) | Admits chunks < 55 m and runs the bank fits in the terrain's `RiverBankBuilder` worker (one job at a time) |
| Unwrapped gap | 49.053–50.028 (0.98) | Rest of `buildTerrainAssets` (water tiles, marsh, bridge + `installSourceBridge`), `buildForestAssets`, `buildCampAssets`, `buildMotes`, `new WorldLandmarks` |
| `WorldLandmarks.prepareMountain([0])` | 50.028–53.787 (3.76) | Fits the level-0 river bed in a new worker |
| Ready bookkeeping | 53.787–53.927 (0.14) | Sync calls, effect/region/orb renderers |
| `prepareEntry` | 53.927–56.815 (2.89) | Two instancing passes, `compileScene`, one offscreen draw |

- **Why the tail's inputs land last.** Startup templates queue first-in, first-out within `LOAD_TIER.initial`, two at a time. The plan's key order is scenery → floor → landmarks, so the tail's inputs are requested last:
  - meadow-ground loads 31.44–34.87 s;
  - snow-ground 31.66–43.83 s (three files, one after another);
  - camp-mountain 34.87–44.95 s (full model, then its LOD).
- **Not counted as work.** The many zero-millisecond `OpenWorldTerrain.prepare` calls are hits on the `prepared` cache. The `orb-bot-green` span never ended (background load); I did not count it as zero.
- **After ready** (not part of this change):
  - The background level-1 fit (`prepareMountain([0,1])`) runs 56.82–60.57 s in a worker.
  - The proceed tap lands at about 60.31 s; that 3.37 s gap includes the harness's phase capture and Playwright's tap checks, and can't be attributed further.
  - `arrival` runs 60.31–61.30 s.
  - The mammoth template finishes at 62.54 s, after arrival had already finished, so this data doesn't show it being awaited.
  - The remaining 1.47 s from arrival to controls (closing the gallery, the first world frames, `playReady`) needs a long-task or frame trace.

## 2. Dependency graph (current source)

- **E: earth textures, ocean and terrain sampler** (`open-world.ts` `initialize`)
  - Needs the catalog's `placement.heightField` values, shared coast and biome data, and the **river-water** template (the `EarthOcean` constructor calls `worldAssets.get('river-water')`).
  - Doesn't need the floor.
- **F: floor arrival** (`arrive`)
  - Needs E and every floor key within 82 m (meadow-ground and snow-ground at the camp).
  - Bank-fit inputs: level-0 ground geometry plus chunk yaw and position.
  - Side effect: `plan()` requests every land ground out to 128 m (scene tier beyond 82 m).
  - Side effect: once `world.openWorld` exists, `renderWorld` calls `openWorld.update` every frame whenever the gallery isn't shown.
- **W: water, marsh and bridge** (rest of `world-scenery.ts` `buildTerrainAssets`)
  - Needs river-water and wood-footbridge.
  - `installSourceBridge` must run before the builders, because `addModel` places props with `walkHeight`.
- **B: builders** (`buildForestAssets`, `buildCampAssets`, `buildMotes`)
  - Need every scenery key; `create` and `createResource` throw `Missing model` otherwise.
- **L: `new WorldLandmarks`**
  - Needs `world.focus`, the cave template (its constructor starts `prepareCave` and the cave image batch) and the renderer.
  - Drawing the mountain needs `openWorld.earthTextures` (`fillMountainLevel` → `prepareMountainMaterials`) and an already-fitted level.
- **M: mountain fit** (`prepareMountain` → `mountain-river.ts` `prepareMountainRiverBedAsync`)
  - Needs **only the camp-mountain template**: both of its files, because a template is all-or-nothing.
  - The worker fit (`river-bank-worker` → `source-surface-fit`) imports only river, mountain-river, lake, cave and expansion data. It never reads the installed terrain or bridge samplers, so its result doesn't depend on when it runs.
  - Progress is recorded on the template (`riverBed.jobs` / `prepared`), so a later `prepareMountain` call joins a running fit or skips a finished one.
- **P: `prepareEntry`** needs everything else and stays last.

**What can start before the full set arrives:** M (one template), E (river-water only) and F (E plus the floor keys).
W, B, L and P depend on the whole set, for the concrete reasons above.

## 3. Recommended first change: mountain-first request order and an early mountain fit

M comes first because it's the largest single item (3.76 s), has one verified dependency and runs off the main
thread. The existing `riverBed` join already covers it, it makes no requests and has no per-frame side effects,
and it is safe with and without the gallery.

1. **`src/startup-plan.ts` `criticalStartup`.** Build `keys` as `[mountainKey if mountainLevels.length, ...floorKeys, ...landmark keys, ...sceneryKeys]`, deduplicated.
   - The set is unchanged, because `mountainKey` is a landmark key whenever `mountainLevels` is non-empty.
   - Tiers, tickets, the limit of 2 and the radii are unchanged; only the first-in, first-out order within `initial` changes.
   - Floor keys come second so the second change (§4) can use them.
2. **`src/world-landmarks.ts`.** Move the body of `prepareMountain` into an exported `fitCampMountain(template, levels, owner, createBuilder = () => new RiverBankBuilder())`, where `owner` is `{ builders: Set<RiverBankBuilder>; disposed: boolean }`.
   - `WorldLandmarks.prepareMountain(levels)` then becomes `fitCampMountain(this.assets.templates.get(CAMP_MOUNTAIN.key), levels, this)`.
   - Behaviour is identical: one builder per level, disposed in `finally`, and `prepared` added only while the owner is alive.
3. **`src/world3d.ts` `initializeWorld`.** Replace `await loadStartup(...)` with:
   ```ts
   const startup = this.worldAssets.loadStartup(plan.keys, { onProgress });
   const mountain = plan.mountainLevels.length
     ? this.worldAssets.ensureInitial(CAMP_MOUNTAIN.key).then((template) =>
         this.disposed ? undefined : fitCampMountain(template, plan.mountainLevels, this.startupFits))
     : undefined;
   await Promise.all([startup, mountain]);
   ```
   - `ensureInitial` joins the same `template:camp-mountain` job at the initial tier. camp-mountain is a startup record (static, not on-demand).
   - Everything after this stays as it is, including `await this.landmarks.prepareMountain(plan.mountainLevels)`: it resolves at once, or joins a fit that is still running.
   - `destroy()` disposes `startupFits` (sets it disposed and disposes its builders) next to `this.landmarks?.dispose()`, before `worldAssets.dispose()`.
   - **Failures:** `Promise.all` passes the first rejection to the existing `catch`. That gives one `failWorld` with the current message, or silence once disposed. No retry job starts and no rejection goes unhandled.
   - **Branch owner:** world3d is also being edited in `companionViewChoice` by runtime026; this change touches only `initializeWorld`, `destroy` and one field.

**Expected effect (upper bound, unmeasured):** world ready moves at most **3.76 s** earlier (to about 53.2 s). That
needs the fit to finish before 44.95 s:
- **Byte estimate, not a measurement:** the 6.88 MB mountain job finishes around 28 s at half of the measured 1.20 MB/s, so the fit would finish around 32 s.
- **Controls:** they gain at most the same amount, and only if the post-ready path is unchanged.
- **Last critical byte:** the total bytes don't change, so it stays near 44.8 s.

## 4. Second change, after the first is measured: early terrain (E + F)

E and F can start once river-water and the floor keys are verified, but they need three guards. These are the
concrete reasons they aren't in the first change:

1. **Extra ground requests.** `arrive` → `plan()` also requests grounds from 82 to 128 m. If started early, at a spawn site that has such grounds, they would take the free slot during the last critical job and slow it.
   - At the camp the question doesn't arise: the floor is meadow + snow and the run shows no other ground request.
   - Other spawn sites need to be computed.
   - **Guard:** hold non-floor ground requests until `loadStartup` settles, or prove there are none at every spawn site.
2. **Per-frame updates.** Once `world.openWorld` exists, `renderWorld` (the no-gallery path, or after a manual leave) calls `openWorld.update` every frame. That plans around the camera, requests grounds and admits chunks while the download is still running.
   - **Guard:** start early terrain only while the gallery is shown (`background` in `initializeWorld`), or skip that update until `assetsReady`.
3. **`buildTerrainAssets` must be split.**
   - **Early part:** `new OpenWorldTerrain` + `initialize`, after river-water and the floor keys arrive.
   - **Late part (unchanged):** water tiles, marsh, bridge and `installSourceBridge`, still before the builders.

**Expected effect:** at most **4.10 s** more (the `initialize` span). Of that, 1.64 s is one main-thread long
task that already runs while the gallery is open, and 2.46 s is mostly worker time. Together with the first
change, at most 7.86 s of the 11.98 s tail could overlap. W, B, L, ready bookkeeping and `prepareEntry` (about
4.0 s) stay after the full set.

## 5. Invariants that must hold (both changes)

- **Terrain samplers.** `installBiomeTerrain` uses the catalog's height fields. `installSourceBridge` still runs before the builders. Both release functions still run in `destroy`.
- **`WorldLandmarks`.** It is constructed at the same point, so the `prepareCave` condition and cave image timing are unchanged.
- **Missing props.** The builders run only after every `plan.keys` template exists.
- **Workers and cleanup.**
  - Each level gets its own builder, disposed in `finally`.
  - `stop()` rejects queued jobs, and disposal terminates the worker.
  - A failure leads to exactly one `failWorld` and no retry.
  - No new worker dependency. Measurement risk, not an invariant: the unchanged worker modules (`river-bank-worker.js` and its imports) may now be fetched during the critical download, especially in cold or cache-disabled QA. Compare total network URLs/bytes and the critical tail.
- **Context recovery and disposal mid-load.**
  - The fit owns no GPU resource; templates are not drawn until they are instanced.
  - Destroying the world disposes `startupFits` before `worldAssets.dispose()`.
  - A `LoadCancelled` while disposed stays silent.
- **Progress.** Same total, monotonic, and the phases still go `download` → `build` → `ready`.
- **Unchanged outputs.**
  - The `plan.keys` set, `floorKeys`, `landmarkIds` and `mountainLevels`.
  - The fitted geometry, bit for bit.
  - The shoreline: one set of `earthTextures`, and the mountain materials still applied when the mountain is instanced.
- **Unchanged behaviour.**
  - The gallery, the contributors' cave and manual proceed: no `main.ts` or `loading-cave.ts` change.
  - The own verified actor still loads first: `prepareSelf`'s body and spears are at the `essential` tier.
  - `STARTUP` radii, all near objects, `playReady` and the rejection paths.
  - No new LOD architecture and no near-terrain omission.

## 6. Checks

**Unit tests** (existing fakes: `RiverBankBuilder(() => worker)`, the `InlineWorker` in adaptive-surface-fit, `WorldAssets({ loadEnvironment })`):
1. Plan order and set: at the camp and at the castle/sight spawn, the `criticalStartup` key set equals the union of scenery, floor and landmark keys; the mountain and floor keys precede every scenery key; there are no duplicates.
2. Queue order with the real `AssetLoadQueue`: the essential spears start first, then camp-mountain, then the floor, then scenery. Progress has the same total, is monotonic, and ends exactly at the `loadStartup` resolution.
3. Join: a fit started by `startupFits`, followed by `WorldLandmarks.prepareMountain([0])`, produces one build per mesh and one builder. After it completes, no new builder is created. The fitted geometry equals the synchronous `prepareMountainRiverBed` result on a fresh template, bit for bit.
4. Failure: a worker error makes `initializeWorld` reject once, with exactly one `failWorld` (current message), no second fit job and no unhandled rejection.
5. Disposal: `destroy()` during the fit terminates the worker and records no prepared level and no `failWorld`. `destroy()` before the template arrives swallows the `LoadCancelled`.
6. Order: no builder runs before every key is loaded, and `installSourceBridge` still precedes `buildCampAssets`.

**Native checks** (Codex; same profile and r04 build; at least 3 runs each of the spans harness and the uninstrumented one):
- The camp-mountain template starts right after the spears. The early fit ends before `loadStartup` ends, and the in-tail `prepareMountain` span is about 0 ms.
- Measure how much the gap from `loadStartup` end to world ready shrinks (expect at most 3.76 s), and controls against the 63.04 s baseline.
- The critical URL and byte set is identical. No non-critical model is requested before `loadStartup` ends. No cave images are requested in the world phase. Total URLs/bytes match, allowing the unchanged worker modules to be fetched earlier.
- At ready, these datasets are unchanged: `worldStartup`, `worldHashes`, `terrainChunks` 9 / visible 5, `campMountainLod` 0, `landmarks` 2. The first-movement screenshot is unchanged (cave, banks, mountain river bed).
- Gallery frame time on CPU4 during the download shows no new kind of long task.
- A manual leave mid-download leaves no live worker and no error, and re-entering works.

## 7. Context

- **Title-phase modules.** A read-only GET of the four heavy data modules on the public site returned 0.872 MB gzip for 8.14 MB decoded; two of the four match the frozen local SHA and two differ because the public copy is older, so the four are not one build (`public-data-compression-20261010.json`). Rewriting the module format shouldn't be prioritized from local uncompressed title timings. No deploy was made while investigating.
- **Not measured here:** CPU4 throttling of workers, physical phones, and the attribution of the post-arrival 1.47 s.
