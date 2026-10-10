# Normal-play performance with actually adopted r04 assets

Whole optimization remains unfinished. No physical-phone or stable-30-fps claim on the CPU-constrained profile.

Both runs use Windows Chrome 154.0.8037.93 on the AMD Radeon Graphics D3D11 backend, DPR 1, one actual renderer plus four protocol peers, fixed herd, and 12 seconds of normal play per prepared view. Runtime: `adopted-r04-build-r01/dist`; manifest adoption: `20261009-r04-a01`. No forced GC, V8 CPU profiler, texture-allocation instrumentation or other heavy QA during the timed samples. GPU timer/process measurements occur in separate intervals. Positions/cameras are controlled preparation, not walking-input validation.

| Profile / view | Average fps | Frame p95 ms | Sampled JS heap MB | Submitted triangles | Draw calls |
| --- | ---: | ---: | ---: | ---: | ---: |
| 390×844 touch, CPU×4 / camp | 26.586 | 54.2 | 301.72 | 1101384–1106181 | 91–92 |
| 390×844 touch, CPU×4 / mammoth | 29.137 | 54.1 | 288.87 | 979879 | 37 |
| 390×844 touch, CPU×4 / overview | 25.333 | 54.3 | 301.53 | 1265817 | 115 |
| 1280×800 desktop, CPU×1 / camp | 29.998 | 33.4 | 292.91 | 1299490 | 113 |
| 1280×800 desktop, CPU×1 / mammoth | 29.991 | 33.4 | 318.47 | 1041149 | 40 |
| 1280×800 desktop, CPU×1 / overview | 29.988 | 33.4 | 297.99 | 1432109 | 145 |

Both runs have five connected participants and no browser errors. Evidence: `output/playwright/optimization-20261009/adopted-r04-{mobile,desktop}-perf-r01/perf.json`.

Comparable pre-adoption CPU×4 run with the repaired parser lifetime and original asset graph was 21.733 / 26.808 / 25.265 fps, p95 75 / 62.5 / 62.5 ms, JS heap 316.8 / 330.8 / 372.7 MB (camp/mammoth/overview; `performance-runtime-memory-r01.md`). Older parser control sampled 790–807 MB with no forced GC. These are finite scene samples, not peak process memory. Repeated old-control FPS varied, so the difference is not a universal speedup guarantee.

The sole-primary decisions preserve acceptable faces. Their cost is visible in the overview: 1,265,817 submitted triangles after adoption versus 975,969 before (CPU×4 portrait). The 1-million triangle guide is exceeded in some scenes, and CPU×4 p95 is over the 40 ms guide. Desktop reaches the configured 30-fps cap in these scenes; artificial CPU slowdown does not reproduce a phone GPU, thermal or battery behavior.

Separate post-sample GPU timer intervals had CPU×4 simulation means 6.1–7.1 ms and submission means 12.3–19.5 ms, while GPU means were 4.6–6.5 ms. These point toward further CPU/render submission investigation; they do not establish one bottleneck or justify skipping a profile. Texture payload is independently 370–469 MB, above the 200 MB guide (`performance-gpu-texture-adopted-r04.md`). Initial-readiness network measurement remains separate.
