# WebGL texture payload after actual r04 adoption

Whole task unfinished. This measurement is separate from FPS measurements. No physical-phone claim.

Matched Windows Chrome 154.0.8037.93, 390×844, DPR 1, touch, CPU rate 1; one renderer plus four protocol peers; fixed herd and identical camp/mammoth/overview preparation. Before: runtime-completion-r02 and original public manifests. After: adopted-r04-build-r01 and actually applied 20261009-r04-a01 manifests. Same allocation probe, no forced GC. Source runtime differences between those freezes concern CPU test helpers only.

| Scene | Before payload bytes | After payload bytes | After decimal MB | Before / after live handles |
| --- | ---: | ---: | ---: | ---: |
| Camp | 843361862 | 370108758 | 370.11 | 102 / 102 |
| Mammoth | 855070958 | 381817854 | 381.82 | 105 / 105 |
| Overview | 1036088574 | 468882218 | 468.88 | 135 / 130 |

All samples have zero unknown allocation levels, zero probe failures, and zero browser errors. Evidence: `output/playwright/optimization-20261009/{pre-adoption,adopted-r04}-texture-payload-r01/perf.json`. Camp and overview screenshots opened and inspected after adoption; actors, props, vegetation, terrain, touch controls and world remain visible. These wide views do not replace individual character-face or enemy LOD review.

Values are WebGL internal-format payload, mipmaps included. They exclude driver padding/duplication, renderbuffers, geometry and default framebuffer, so they are not complete physical GPU memory. The independently self-checked probe measures native allocation/deletion calls, including renderer placeholder textures. Upload instrumentation invalidates this run as FPS evidence. `renderer.info.memory.textures` is a count, not bytes; downloaded PNG/GLB compression is not GPU texture compression.

The 200 MB texture guide is **not met** after adoption. The revised assets reduce payload substantially, but many 1024-square RGBA/SRGB textures each still occupy 5,592,404 bytes with mipmaps. A future texture-budget change requires its own visual review and candidate/adoption revision; do not alter the immutable r04 candidates or silently lower texture dimensions.
