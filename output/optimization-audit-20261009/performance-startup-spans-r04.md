# Startup preparation spans after adoption — 2026-10-10

Fresh diagnostic wrappers around actual r04 methods, Chrome154 portrait390x844, CPU4 and calibrated global10Mbps/50ms, cold cache, isolated memory-only server. Frozen adopted-r04-build-r01, applied r04 assets. No source mutation. Evidence `output/playwright/optimization-20261009/adopted-r04-startup-spans-r01/result.json`. Errors0; real finger input moved the player. Controls62.769s versus uninstrumented63.038s, consistent within this single-run comparison. Not a physical-phone or final performance result.

| Method / phase | Start / end after confirm (s) | Duration (s) |
|---|---:|---:|
| LoadingCave.load |0.371 /15.911 |15.540 |
| WorldRenderer.initializeWorld |15.911 /56.827 |40.916 |
| WorldAssets.loadStartup |15.920 /44.953 |29.033 |
| OpenWorldTerrain.initialize |44.955 /49.053 |4.098 |
| OpenWorldTerrain.arrive (inside initialize) |46.595 /49.053 |2.458 |
| WorldLandmarks.prepareMountain initial |50.028 /53.786 |3.758 |
| WorldRenderer.prepareEntry |53.927 /56.815 |2.888 |
| Background mountain preparation |56.816 /60.567 |3.750 |
| WorldRenderer.arrival |60.310 /61.297 |0.987 |
| Mammoth template load |53.930 /62.536 |8.606 |

Do not add nested durations. After the critical templates finish, approximately11.87s remain until initializeWorld resolves. The floor, mountain and entry stages currently run sequentially. Starting verified floor/mountain work earlier is a candidate only after checking constructor/template/sampler/worker/disposal dependencies. The startup owner is reviewing those exact dependencies.

Arrival completes before the mammoth load. Therefore their nearby timestamps do not establish an explicit mammoth readiness dependency. Later prepare calls that reuse an existing template take approximately0ms; one unfinished orb background span has no end and must not be represented as duration0. The full JSON retains those distinctions.
