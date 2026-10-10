# Proposed r05 texture payload — 2026-10-10

Not adopted. Current public manifests and immutable r04/a01 records remain unchanged. `assets/optimized-runtime/20261010-r05` contains19ordinary models/33GLBs;15model color images stay1024 while normal/data use512, four spear/katana models use512 for all images. Geometry, rig and animation are original-derived and strictly checked. Original sources are read from the SHA-verified r04 pre-apply manifest snapshot, not decoded/re-encoded r04 textures. No startup actor, behemoth, cave image or ground/water model is selected.

Related52 tool tests passed with Pillow, dry-run/generation completed, strict base verification report passed. Chrome and Windows WebKit each passed19models/35clips, five samples per clip and all vertices; errors0. Five full-view and five close-view Chrome comparison sheets were actually opened for all19models. No new silhouette break, severe color/UV bleed, lost stone/wood/cloth pattern or orb-face deformation was observed in the sampled views. The images are deliberately static source/candidate camera fixtures and do not establish physical-phone quality or all game lighting. Generated revision metadata is immutable; subsequent review evidence lives in this audit directory.

## Measured native preview

`prepare-r05-texture-preview.mjs` independently verified all82 current base manifests and33 candidate bytes. Its response fixture rewrites only proposed file identities in isolated HTTP responses. It retains r04 metadata and is intentionally **not** an adoption or valid release graph. Public files are untouched. This lets the same frozen r04 runtime compare texture payloads before the publisher's chained adoption exists.

Chrome154,390x844,DPR1,touch,CPU1,one real renderer+four peers,fixed herd,same r04 frozen code and allocation probe as adopted-r04-texture-payload-r01. Proposed results: `texture-r05-preview-payload-r01/perf.json`.

| Scene | Actual r04 bytes | Proposed r05 bytes | Saved bytes | Live handles before/after |
|---|---:|---:|---:|---:|
| Camp |370108758|315582806|54525952|102/102|
| Mammoth |381817854|323097598|58720256|105/105|
| Overview |468882218|397579050|71303168|130/130|

Unknown allocation levels0, probe failures0, browser errors0. Camp and overview game screenshots were opened; actors, foliage, props, river and touch controls remain visible. Actual saving54.5–71.3MB is less than the r15 estimate; do not report the estimate as achieved. The200MB texture guide remains unmet. Values include native format/mipmap payload, not driver padding, renderbuffers, geometry or complete GPU memory. Upload instrumentation is not FPS evidence.

Remaining before adoption: strengthened retained-base file validation, reviewed chained publisher with exact r04 restoration, current acceptance documents, actual selected material/game lighting checks as needed, actual apply/audit, exact local/exhibition/MMO packaging and adopted native lifecycle/performance. Do not treat this preview or the52 tests as those results. Physical Android/iOS, thermal, battery and physical controllers remain unverified.
