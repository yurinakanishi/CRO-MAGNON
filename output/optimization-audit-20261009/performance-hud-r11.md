# HUD r11 independent verification — 2026-10-10

Whole optimization remains unfinished. Implementation by local Claude026, reviewed and run independently by Codex. Extra/xhigh only, subscription authentication, no API/cloud/overage. Runtime freeze `runtime-r11-startup-r07-build-r01` includes r10 lazy companion queries, r11 HUD writes, startup r07 overlap; assets remain actually applied r04. Build passed, related69 tests passed, check passed TypeScript/strict/569JS/architecture. This does not replace the final full integration suite after remaining publisher work.

## Code and behavior

The r11 diff against `cpu-before-r10/src/main.ts` is confined to the helper import and updateHUD/updateHuntingHUD. The minimap is drawn first in the same updateHUD invocation; equal text/hidden/disabled/class/title/ARIA/dataset and energy width writes are skipped. Carry/mount final button state is written once. Query cadence, live countdowns, diagnostic data fields and map drawing implementation remain. `hud-dom.ts` preserves final DOM values and contains no game-state cache.

`hud-parity-runtime-r11-r01` uses actual Chrome154,390x844,DPR1,touch,CPU1 and five network participants. Across camp/mammoth/overview,19 prepared states each (57 total), actual final viewport DOM, control properties and every160x115 minimap RGBA component equal the extracted old functions. Includes energy, cooking/fishing/coastal progress, downed/protected/cooldown, mount/dismount and carry transitions. Browser errors0. Repeated idle-state mutations81→19 in every scene. These are prepared states and direct function calls; actual finger flows are a separate required check.

## Positive control and readback limitation

The first two old-vs-old controls failed only at the overview mounted image (4377/4378 RGBA components); DOM/properties and serialized input/output game state were equal. This is retained as failed QA evidence. Repeated canvas readback can change its rendering path. Choosing `willReadFrequently:true` at initial creation of the **QA-only minimap** made all57 old-vs-old cases pass. MDN documents that option's software-canvas purpose and that later getContext calls return the same context: [MDN getContext](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/getContext). The rendering-path explanation is an inference, not a measured backend trace. Product Canvas options remain unchanged.

Control r03 accidentally used the driver's default1280x800/CPU4 because the shell supplied PERF_WIDTH/HEIGHT/CPU instead of its actual PERF_W/H/CPU_RATE names. Its own recorded metadata exposes this; it is not portrait evidence. Fresh `hud-parity-control-r04-portrait` with correct390x844/CPU1 also passed57 states. The r11 comparison above uses the correct names and matching metadata. No parity run is FPS evidence.

## Native style trace

Same Chrome154,390x844,CPU4,fixed herd,one renderer+four peers,12s requested per scene. CDP timeline, invalidation tracking and stacks; no simultaneous benchmark/browser/build. Compare `adopted-r04-style-trace-r01` to `runtime-r11-style-trace-r01` and their `style-attribution.json` files. The sum includes both synchronous map-induced style flushes and the other main-thread style/layout events, avoiding a claim based only on moving a flush elsewhere.

| Scene | Before style+layout ms | After ms | Reduction |
|---|---:|---:|---:|
| Camp |955.954|819.762|14.25%|
| Mammoth |933.890|741.177|20.64%|
| Overview |877.655|782.753|10.81%|

The map font still triggers98/97/98 synchronous style updates, now197.7/130.2/189.5ms. Other style cost remains622.1/611.0/593.3ms; no Layout event was recorded after the change. Unchanged external HUD modules and renderer label style writes remain potential work, not an established blanket CPU attribution. This single paired instrumented trace is not normal FPS or physical-phone evidence.

## Normal runs (no profiler, allocation probe or forced GC)

`runtime-r11-cpu4-r01` and `runtime-r11-cpu1-r01` use the same frozen r11/r07 runtime and actual r04 assets, one renderer plus four peers and fixed herd, 12s per scene. Correct driver variables are `PERF_W`, `PERF_H`, `PERF_CPU_RATE`. Browser errors0 in both runs.

| Scene | Before CPU4 fps / p95 ms | After CPU4 fps / p95 ms | After CPU1 fps / p95 ms |
|---|---:|---:|---:|
| Camp |26.59 /54.2|26.91 /54.2|29.99 /33.4|
| Mammoth |29.14 /54.1|30.04 /37.6|30.00 /37.5|
| Overview |25.33 /54.3|27.74 /50.0|30.00 /33.4|

CPU4 is390x844 portrait and artificial4x CPU slowdown; CPU1 is1280x800 desktop. This is one paired run, not physical-mobile evidence or a confidence interval. Camp and overview still miss stable30fps. Normal-GC heap after CPU4 is298.54/294.76/283.05MB; CPU1 is282.02/325.55/346.59MB. GC timing varies, so no monotonic memory improvement is claimed for the HUD change.

## Companion r10 evidence

Before `adopted-r04-cpu-counts-r01` and after `runtime-cpu-r10-counts-r01`, the actual native chosen IDs remain orb:heart at camp and none in the other two views. Collision traces per query11→5 at camp and11→0 at mammoth/overview. The13 companion/camera tests include3000 seeded eager/lazy selection parity cases. These diagnostic counters establish removed work and retained choices, not the whole frame-rate benefit.
