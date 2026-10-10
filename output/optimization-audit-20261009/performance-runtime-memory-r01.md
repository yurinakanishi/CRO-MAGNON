# Runtime memory correction before asset adoption — 2026-10-09 23:34 JST

The full task is unfinished. This measures the interim frozen `runtime-integrated-probe-r01` on native Windows Chrome154.0.8037.93,390x844,DPR1,touch emulation,CPU slowdown4,one renderer/four protocol peers,fixed herd and the same3prepared scene views. No forced GC, profiler, other browser QA, build or unit suite overlapped. Remote Claude file-editing jobs and other desktop applications remained active. This is not a physical phone, battery, thermal or mobile network result. Timing begins at page navigation with scripted setup clicks.

Evidence: `output/playwright/optimization-20261009/pre-adoption-runtime-memory-mobile-r01/perf.json`. RuntimeGLTF no longer keeps completed GLTFParser/cache/binary references; the cave verifier is also present. Model URLs and all geometry are still original/unadopted.

| Scene | Runtime fix FPS | p95 ms | usedJSHeapSize MB | Prior control FPS / heap MB | Same-evening repeated control FPS / heap MB |
| --- | ---: | ---: | ---: | --- | --- |
| Camp | 21.733 | 75.0 | 316.8 |29.984 /771.6 |19.472 /790.3 |
| Mammoth |26.808 |62.5 |330.8 |29.987 /790.7 |30.055 /796.6 |
| Overview |25.265 |62.5 |372.7 |29.989 /820.8 |24.645 /807.0 |

Because the new run was slower than the earlier ~30fps control, Codex repeated the old frozen `decoder-foundation-build-r01` immediately under identical script/viewport/CPU conditions (`pre-adoption-control-repeat-mobile-r02`). That old control also varied substantially: p95=70.8/50.0/58.3ms. This establishes variability in the measurement environment; it does not prove that every FPS difference is environmental or that the current code meets30fps. Do not discard either result or claim a resolved performance regression. Final matched measurements after adoption remain required, and targeted profiling may be necessary if instability persists.

Both current and repeated control have identical sampled triangles/calls/geometries/textures: camp1,110,470–1,115,267tri/91–92calls/79geometry/98textures, mammoth988,965/37/88/101, overview975,969/115/98/131. All browser errors0. The retained-memory decrease persists with normal GC (roughly434–474MB lower against the repeated control), independently of the earlier forced-GC diagnostic. `performance.memory.usedJSHeapSize` in this Chrome includes backing buffers and is not process or GPU memory; these are samples, not peak-memory proof.

Current world ready23.189s,cave playable10.201s; repeated control23.485s/10.785s. Loading and frame stability remain above target; asset adoption is still pending. Keep this intermediate effect separate from the eventual compressed/resized asset graph.
