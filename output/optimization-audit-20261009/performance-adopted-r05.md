# Adopted r05: independent runtime and cold-start measurements

2026-10-10, adopted graph `20261010-r05-a02`, frozen client `adopted-r05-build-r01/dist`. Whole optimization remains unfinished. `adopted-r05-final-measurements.json` records raw report SHAs and the exact numbers below.

## Normal play versus texture-allocation probe

Real Chrome on Windows/AMD integrated graphics,390x844,DPR1,touch, one rendered player plus4 protocol peers, fixed herd. Three viewpoints are prepared on an isolated memory-only server; these prepared positions are not native travel tests. Each normal measurement is12seconds, with normal GC, no forced GC, CPU sampling or texture instrumentation. CPU4 is an artificial slowdown, not a physical phone.

| View | FPS | p95 ms | JS heap MB | Draw calls | Visible triangles |
|---|---:|---:|---:|---:|---:|
| Camp |28.03|50.0|303.15|91–92|1,101,384–1,106,181|
| Mammoth |29.82|37.6|357.68|37|979,879|
| Overview |27.04|54.1|375.80|115|1,265,817|

Source: `adopted-r05-cpu4-r01/perf.json`; Codex opened all three actual gameplay screenshots. The current code's prior actual-r04 run measured28.07/30.02/28.84fps. These single runs do not establish a statistically attributable FPS change or monotonic memory improvement. Steady30fps remains unmet.

Separate instrumented native allocation run, `adopted-r05-payload-r01`, counts actual WebGL internal formats and all mip levels; errors0 and unknownlevels0:

| View | Actual r04 bytes | Actual adopted r05 bytes | Decrease |
|---|---:|---:|---:|
| Camp |370,108,758|315,582,806|54,525,952|
| Mammoth |381,817,854|323,097,598|58,720,256|
| Overview |468,882,218|397,579,050|71,303,168|

This confirms the earlier isolated texture-preview prediction after real adoption. It excludes geometry, renderbuffers, driver padding and the default framebuffer; it is not total GPU memory. This instrumented run is not normal FPS evidence. The200MB texture budget is still missed.

## Actual r05 cold startup

Two separate fresh Chrome sessions;390x844,DPR1,touch, CPU4, global10Mbps download/5Mbps upload/50ms latency. Browser HTTP cache disabled, fresh origin/context/verified cache, no concurrent browser/build/encoder/test job. The link is calibrated by two concurrent2MiB transfers; exact calibration results are retained in the raw reports. This local server sends uncompressed modules, which differs from a potential public compressed response. No current public deployment measurement is claimed.

| Milestone | r01 | r02 |
|---|---:|---:|
| Title ready, before confirmation |14.510s|14.352s|
| Cave playable, after confirmation |15.029s|15.121s|
| World ready, after confirmation |47.530s|46.701s|
| Controls ready, after confirmation |53.575s|51.418s|
| First native touch movement, after confirmation |55.602s|53.050s|

Errors0, unknown network sizes0, verified self template present before entry and own rendered actor present before controls. Real touch changes the authoritative isolated-server position by5.46m and5.19m. **Both runs fail the5s target.** Results are under `adopted-r05-network-r0{1,2}`.

At controls, completed server game response bodies equal69,236,322B in both runs; additionally1,376,256B /851,968B have been offered on in-flight requests. These are server-offered body bytes, not instantaneous bytes received by the browser. Calibration requests are excluded; title traffic is included in the totals. The title is13,543,024B, and cave-playable total30,696,869B. Avoid conflating complete and in-flight figures, or blob decoding with network transfer.

Earlier r07 code with r04 assets measured56.543–57.593s to controls. The current result is lower, but it is not a fresh paired attribution experiment: material transfer, later runtime changes and scheduling differ. The earlier worker200/304 confound is retained in `performance-startup-overlap-r07.md`. Do not claim every second as an r05 texture effect.

## Desktop reference after adoption

`adopted-r05-desktop-r01`: real Chrome on the same desktop,1280x800 viewport,DPR1, actual drawing buffer1214x758, CPU1 (no artificial slowdown), normal GC/no Profiler/no texture probe, one rendered player plus4 peers and12s/view. Camp/mammoth/overview measure29.989/29.992/29.994fps, all p95≈33.4ms; JS heap327.48/336.90/282.88MB, errors0. Visible triangles1,299,490 /1,041,149 /1,432,109. Codex opened the camp and overview screenshots. This is one desktop run at the game's30fps cap, not a mobile guarantee or before/after statistical proof.

## Other acceptance evidence and limits

Full1311 tests pass,0 fail,2 optional benchmarks skipped; strict/check570JS/architecture and scoped formatting pass. All3 actual local/exhibition/MMO package inventories, asset hashes, credits/cave/entry and native390px touch checks pass. Adopted Chrome and Windows WebKit each pass11 lifecycle cases with5 participants,3 context cycles and2 eviction/returns. Cache including index remains below64MiB. See `live-checkpoint-after-1300-limit.md` for exact output names and hashes.

No deployment, fleet distribution, existing-server restart, user-save edit, commit or push. Physical phones/Safari, ASTC/ETC device paths, thermals, batteries and physical controllers are not tested. The rejected KTX experiments do not change these adopted-r05 results. Next work is verified LOD image sharing and pixel-preserving PNG compression, followed by independent measurements.
