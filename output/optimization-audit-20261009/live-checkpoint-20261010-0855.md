# Live checkpoint — 2026-10-10 08:55 JST, work continuing

This is a progress checkpoint, not a limit or completion. The Oct10 04:20 reset passed; work resumed 08:07. Local Claude Opus5.5 Extra (`--effort xhigh`) only, existing first-party subscription, no MAX thinking, cloud, API/overage/credits/Fast/other model. Latest actual rate status allowed, utilization0.48, reset13:00JST, isUsingOveragefalse. Do not confuse overageStatus rejected (billing disabled) with five_hour status rejected. No publication/distribution/commit/push, original/user-save/server changes.

The applied asset base remains immutable `20261009-r04-a01`, 7 approved startup bodies and 39825-triangle behemoth without rejected LODs. Previous1274 tests and native/package validations describe that base, not today's pending changes. See the final addendum in live-checkpoint-after-0420-limit.md.

## Implementation owners

- Runtime UUID026f16c0-538a-4645-99e9-a78a97eaa58f: r10 lazy companion occlusion gate completed, independently reviewed/formatted/built and13 companion/camera tests passed. Native query parity preserved across three views: traces per query11→5 camp,11→0 mammoth/overview. `runtime-cpu-r10-build-r01` freezes that implementation. r11 HUD now completed (process collected exit0), only main.ts updateHUD/updateHuntingHUD/import and new hud-dom.ts/tests. Formatted; build/test/native verification still pending. No FPS claim yet.
- Publisher UUID587a3bb5-571d-4e42-9bcc-e1e9153ed25e: r15 texture review completed. r16 generator/verifier now completed exit0: checked base-adoption pre-apply original sources, explicit partial scope, per-semantic512px maps, protected actors/behemoth/cave exclusions. Formatted, focused tests running (exec85777). No new texture candidate generated or adopted. Must independently review/preflight/generate/image-check before a separately implemented chained publisher can adopt. Never edit r04 history.
- Startup UUID8031244b-cef0-480e-90d3-f9d81635752a: r06 readonly review complete; r07 active (exec90890, startup-overlap-r07-claude.jsonl). Owns startup-plan.ts, world-landmarks.ts fit helper, world3d.ts initializeWorld/destroy/import only and tests. Preserve runtime's completed companionViewChoice. Mountain-first same critical key set and early worker fit overlapping remaining downloads; cancellation/ownership mandatory. No main.ts or early-terrain phase.

## Independent new evidence

- `performance-cpu-counts-r04.md` and native counts before/after; diagnostic instrumentation is not normal FPS.
- `performance-style-trace-r04.md`: CDP trace proves drawWorldMap font setter causes98–99 UpdateLayoutTree events/~372–395ms per12s after HUD mutations. Other style~357–424ms plus layout~139–149ms; measure TOTAL after r11 so cost is not merely moved.
- `performance-startup-spans-r04.md`: calibrated cold10Mbps/50ms/CPU4, cave15.54s, startup template load29.03s, subsequent initialization11.87s including terrain4.10s and mountain3.76s. Controls62.77s; diagnostic baseline agrees roughly with63.04s normal network run. Overlap gain unmeasured.
- Texture embedded inventory:64models88GLBs160image records134distinct images715739656 estimated RGBA8+mip bytes (not live GPU memory). Pillow exact decode found0fully constant images. Statistics of five orb normals show low variation, not constant. Keep actual semantics and visual review.
- `public-data-compression-20261010.json`: read-only existing public four data modules872128gzip/8135039decoded bytes. Only two match current frozen r04 sources; public site is older. No publication or join. Do not use uncompressed local title latency as public performance.
- `adopted-r04-scene-census-r01`:600 actual frames perview, no errors,1475–1558nodes. River22nodes and mountain lake/waterfall54nodes unchanged in sampled scenes. This does not prove all gameplay immutability. Existing freezeStatic also adds culling, so blindly applying it would change visibility. No matrix freeze implemented yet.

## HUD QA issue to resolve before acceptance

`hud-parity-control-r01` compares OLD r10 HUD against identical extracted old functions in the same isolated real Chrome. Camp/mammoth19cases each match DOM/property/pixels. Overview mounted state has identical DOM/properties but4377different RGBA components. The positive control therefore FAILED; not a production regression, no acceptance yet. QA hook now records input/after state and both minimap PNGs for that mismatch. Use a fresh control output for diagnosis. Driver `qa-hud-parity-r05.mjs` reads `hud-parity-hook-r05.txt` at startup, serves it only in QA main; no product change. Prepared states/direct calls do not establish real touch flows. Later compare r11 and repeat total style trace and uninstrumented CPU4/CPU1.

Full suite/check/new runtime package/native WebKit/context tests remain pending today's changes. Physical mobile/thermal/battery/gamepads remain unverified. Whole optimization remains unfinished.
