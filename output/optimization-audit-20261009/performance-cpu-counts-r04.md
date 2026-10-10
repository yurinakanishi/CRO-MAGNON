# Additional adopted-r04 diagnostics, 2026-10-10

Read-only Chrome154 counter run, frozen adopted-r04-build-r01, current r04 assets, 390x844 DPR1, artificial CPU4, one renderer and four protocol peers, fixed herd. Requested 6-second windows, no forced GC. Counters wrap the real minimap and companion-choice functions. This instrumentation is diagnostic, not a normal FPS measurement. Evidence: `output/playwright/optimization-20261009/adopted-r04-cpu-counts-r01/perf.json`. Browser errors0.

| Scene | Map calls / measured ms | Companion choice calls / collision segment checks / measured ms | Result |
|---|---:|---:|---|
| Camp |50 /213.8 |111 /1221 /101.9 |orb:heart111 |
| Mammoth |48 /203.7 |109 /1199 /476.8 |none109 |
| Overview |50 /213.0 |110 /1210 /218.3 |none110 |

All choices trace eleven targets regardless of whether they can pass the existing range/screen predicate. Preserve exact boundary, stable ranking, current collision and input semantics in any change. A scalar distance/screen gate can avoid expensive traces without caching state across frames. This is a candidate for Claude implementation and independent parity/native testing, not an implemented optimization yet. `cpu-before-r10/provenance.json` snapshots six relevant source/test files before any next implementation.

Texture inspection found134 distinct encoded images among160 image records in88 eligible GLBs. Exact Pillow decode/extrema found **zero fully constant RGBA images**; a constant-image replacement is unsupported by this evidence. `texture-inventory-r05.json` and `texture-pixels-r05.json` are inventory estimates, not live allocations. They do not include the standalone cave PNGs.

Read-only GETs of the existing public site's four largest data modules (not the unpublished r04 build) measured872128 gzip bytes for8135039 decoded bytes. Paleo-coast and camp-mountain modules exactly match the frozen local build; landmark-bounds and castle-surface differ in SHA. Evidence `public-data-compression-20261010.json` with retained headers/source. Do not extrapolate local uncompressed title timings to the public site or claim its deployed code is r04. No game join, publication or mutation occurred.
