# Matched measurement before r04 adoption — 2026-10-09

Full optimization remains incomplete. This is the current decoder-foundation-build-r01 with original runtime model URLs, not the original whole-project baseline. Candidate files have not been applied. Native Chrome on Windows, 390×844, DPR1, touch emulation, CDP CPU slowdown4, one renderer and four protocol peers. Same fixed herd preparation and three viewpoints; state preparation is not walked gameplay. No network throttle, fresh browser context, no simultaneous browser/build/test run. Other desktop applications and remote Claude file-editing jobs remain active. PERF_PROFILE=0; browser errors0.

Evidence: output/playwright/optimization-20261009/pre-adoption-mobile-cpu4-r01/perf.json and image files. Timing origin and all raw metrics are preserved there. World ready19.237s and cave playable8.870s after page navigation; 34 completed GLB requests/77,099,052 decoded bytes observed at readiness (completion sampling may include already finishing background requests). Five participants and three scenes complete with201,352,160 model bytes transferred. Images/JS/audio are not part of that GLB sum.

| Scene | Average FPS | Frame p95 | JS heap MB | Triangles | Draw calls | GPU mean ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Camp | 29.984 | 45.8ms | 771.6 | 1,110,470–1,115,267 | 91–92 | 5.485 |
| Mammoth | 29.987 | 41.7ms | 790.7 | 988,965 | 37 | 4.900 |
| Overview | 29.989 | 41.7ms | 820.8 | 975,969 | 115 | 5.782 |

Frame intervals include the30fps cap. JS heap is the observed usedJSHeapSize at the scene sample, not maximum/process/GPU memory. GPU times are separate3second WebGL timer-query samples, not GPU utilization. Native(program) profiler samples from the earlier profiling run are not assigned to a particular cause. Physical phone CPU/GPU, battery, thermal behaviour, iOS and cellular network remain unverified. The current heap exceeds400MB and camp triangles exceed1million; average30fps alone is not a pass for overall smartphone suitability. Adopted-graph measurements are still required.

Desktop counterpart completed: pre-adoption-desktop-r01/perf.json, same fixed build and herd,1280×800,CPU1,DPR1, no mobile touch emulation. Camp30.069fps/p9533.4ms/775.8MB/1,222,610tri/113calls/GPUmean9.871ms; mammoth29.990fps/p9533.4ms/798.7MB/1,050,235tri/40calls/GPU8.140ms; overview30.064fps/p9533.4ms/814.5MB/1,086,568tri/145calls/GPU9.152ms. Worldready11.814s,cave5.193s. GLB bytes sampled at ready105,061,628: asynchronous background completions mean this readiness sample is not a minimum required-load budget. Errors0. Desktop and mobile viewport/CPU conditions are distinct; final comparisons must use each corresponding condition.
