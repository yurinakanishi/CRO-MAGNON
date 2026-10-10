# Adopted r06 — actual transport, play and native validation

2026-10-10. Local adoption `20261010-r06-a02`, plan `db0c29cdc80a6cc9ce45080ccd7b6700f61cf5ccad9055d03c920b9a3b6d60bb`. Whole optimization is **unfinished**. Exact report identities and measurements are in `adopted-r06-final-measurements.json`.

## What changed and what passed

Four static model files now share identical LOD image data where applicable; eight cave PNGs have smaller IDAT compression without changing a pixel or colour metadata. Scoped stored physical bytes are 25,859,733 -> 16,588,076, saving 9,271,657 B. Seven approved initial characters, the 39,825-triangle behemoth sole primary, original models and r04/r05 records remain unchanged. No rejected LOD, KTX or experimental WebP is adopted. See `asset-acceptance-r06.md` and independent before/after plan reports.

All 14 images pass separate PNG-stream/Pillow and native Chrome/WebKit Canvas+GPU exact comparisons. All four actual GLBs / seven levels / four angles match the previously served files through production WorldAssets, with resource ownership checks. Codex opened all seven level sheets and eight changed mural/rock image sheets. The actual model review UI additionally loads all five packed scenes with their correct triangle counts/SHA and rejects unlisted scene999 before fetching; both Chrome and Windows WebKit pass. Codex opened the WebKit mountain LOD and snow LOD2 screenshots. The review floor can intersect a model at its authored origin; these are review fixtures, not new game assets.

Adopted full suite: **1,365 pass, 0 fail, 2 optional benchmarks not run**, including Pillow tests. Final adopted check passes TypeScript/strict,581JavaScript syntax and architecture boundaries; whole configured formatting and git whitespace checks pass. Three real local/exhibition/MMO output packages have verified complete file inventories, actual GLB scenes and hashes, retired-file exclusion, credits and profile behavior. All three pass native Chrome390px portrait credits, cave/exhibition entry and actual touch move/stop. Codex opened the actual local cave/play and MMO play images. None were distributed or deployed. Final independent comparison preserves all695 save/preview files and9 baseline endpoint results, including the original8787 PID2984.

Chrome and Windows WebKit each pass 11 lifecycle cases: five network participants, three native context loss/restoration cycles, two distant actor/template eviction and return cycles, preserved inventory and one animation loop. Cached bodies including the index peak at 65,286,164 B / 66,854,447 B, both below 67,108,864 B (64 MiB). This is not physical-phone/Safari validation.

## Actual same-package identity / gzip startup pair

Same local package `4410cdaa50d8c8f04c88bfaedf39faf7aa55f45bcf89af03dde3b0784c4cfd8e`, Windows Chrome390×844,DPR1,touch, CPU4, global10Mbps download /5Mbps upload /50ms latency. Fresh context/origin, browser cache disabled, no concurrent heavy QA. Two concurrent2MiB calibration requests took3.497 /3.509 s (theoretical3.355s). The production packaged static server serves every asset; the identity baseline changes only its negotiated Accept-Encoding. There is no identity-only module overlay. Server response chunks independently confirm actual gzip on JS/CSS and unchanged binary encodings. The client first-movement confirmation mark was observed in both runs after a bounded additional observation window.

| Milestone | Identity | Gzip |
|---|---:|---:|
| Visible title artwork, from navigation |1.602 s|1.475 s|
| Setup form ready, from navigation |14.724 s|6.805 s|
| Cave playable, after QA confirmation tap begins |14.914 s|14.458 s|
| World ready, after that tap begins |39.109 s|38.512 s|
| Normal controls, after that tap begins |43.939 s|43.331 s|
| First actual touch movement, after that tap begins |45.558 s|44.978 s|

The exact application confirm/controls marks are retained separately. The metric above conservatively includes the tap dispatch rather than subtracting it to improve the number. Normal controls occur59.478 /51.008 s after navigation. Touch moves the isolated authoritative server's player5.294 /5.334 m; browser errors and HTTP failures zero. The earlier identity-r01 failed because the QA incorrectly expected the joined-player `characterAsset` dataset before joining. It is preserved as a harness failure; r02 verifies the world-ready contract and completed own-model body before entry, joined-character readiness at controls, then real input. Actual actor/template readiness and appearance have separate lifecycle/native evidence.

At controls, **completed browser game response bodies** total59,837,489 /47,706,044 B. Calibration traffic and local blobs are excluded, title preload is included. Some worker responses report zero body size; server request records and response coding are retained separately. These values are not all bytes already offered by the server, all in-flight received data, or a wire total including headers. Even this completed-body lower bound far exceeds4MB.

At the same controls milestone, completed server-offered script/CSS bodies are12,736,182 /2,053,685 B. The corresponding GLB bodies are36,271,452 B and image bodies9,224,969 B in both runs. In-flight offered GLB bodies are786,432 /1,179,648 B, separately recorded. Different browser completion and server finish instants must not be combined into a fictitious exact network budget.

Compression materially reduces the wait before setup; it does not make confirmation-to-normal-controls meet5s. One pair does not establish a statistical speedup or assign every second of historical r05/r20 differences to r06. The next task is the mandatory model/mural/terrain dependency set and readiness gate; not hiding the same wait in the title/gallery. `startup-budget-r15-high.txt` is the pending read-only audit.

## Normal-GC play and separate GPU allocation probe

Actual r06 assets and packaged local client, one renderer plus four protocol peers, fixed herd and prepared views on an isolated memory-only server. CPU4 is artificial slowdown, not a phone. Each normal frame sample is12s, with ordinary GC, no forced GC, CPU Profiler or texture instrumentation in that window. Follow-on attribution and GPU timers occur after the frame window. The texture allocation driver is a separate run; its FPS is not performance evidence.

| View | Normal FPS | p95 | JS heap | Visible triangles | Draw calls | Separate texture payload |
|---|---:|---:|---:|---:|---:|---:|
| Camp |27.22|50.1 ms|338.71 MB|1,101,384–1,106,181|91–92|315,582,806 B|
| Mammoth |29.39|45.9 ms|317.52 MB|979,879|37|323,097,598 B|
| Overview |27.94|50.0 ms|320.88 MB|1,265,817|115|397,579,050 B|

Texture payload is exactly the previous adopted-r05 result:102 /105 /130 allocations, unknown levels0 and probe failures0. This counts uploaded WebGL internal-format levels including mipmaps, excluding renderbuffers, geometry, driver padding and the default framebuffer. **The lossless repack produces no measured GPU memory reduction.** The200MB guide and stable30fps remain unmet. Single normal-GC heap samples and small FPS differences are not proof of monotonic improvement or regression.

Codex opened all three actual CPU4 gameplay images; visible faces, scenery, water and portrait controls retain their accepted appearance. Prepared positions are not walking-input tests; real input was separately tested above. Physical phones, thermals, battery and physical controllers remain untested. No existing server/save changes, publication, distribution, commit or push.
