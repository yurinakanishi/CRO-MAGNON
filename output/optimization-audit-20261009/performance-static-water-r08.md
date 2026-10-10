# Static water transform review — 2026-10-10

The only incremental runtime change after HUD r11/startup r07 is local-matrix recomposition disabled for89 immutable water nodes: river22, mountain water54 and marsh pools13. The scene root flag already existed in the earlier build and is not a new r08 improvement. Shader time/material state stays live, bounds and visibility are unchanged, and no new culling is introduced.17 related tests passed after independent review; native touch gameplay5 groups and Chrome/WebKit residency/context11 checks each passed on `runtime-static-r08-build-r01`.

Normal unprofiled Chrome CPU4,390x844,DPR1,fixed herd, one renderer/four peers,12 seconds per view, no resource probe and no forced GC: `runtime-static-r08-cpu4-r01/perf.json` gives camp28.0659fps/p9550ms/heap303.881MB, mammoth30.0198fps/p9537.6ms/301.257MB, overview28.8390fps/p9545.9ms/316.670MB. Earlier `runtime-r11-cpu4-r01` was26.91/30.04/27.74fps with p9554.2/37.6/50ms. This is a single same-condition run of each build, not a statistical attribution of all variation to89 nodes. Camp and overview still miss steady30fps; no physical-phone claim.

Both builds use the actual r04 asset graph. r05 is a later separate adoption and is absent from this comparison. The new r05 performance must be measured separately.
