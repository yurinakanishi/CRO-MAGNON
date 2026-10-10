# Parse-only buffer retention experiment — 2026-10-09

Read-only source review found every retained runtime GLTF keeps its parser, including embedded GLB bytes and parser caches after the final scene and clips have loaded. Runtime references to `.parser` are confined to embedded-glb hash association and context-recovery's GLTF discriminator. The latter matters for production integration; do not remove it without preserving traversal.

Codex independently ran qa-parser-retention.mjs in a throwaway native Chrome game with fixedlod-material-build-r01 and original runtime models. The scene was paused after becoming playable. Both samples force garbage collection through CDP, so this is a controlled retention experiment, not ordinary gameplay memory or frame-time performance. No production source or manifests were changed. The only intervention deletedparser references from68world/character template GLTFs; it retained their scene,scenes,animations,cameras,asset,userData and all render instances.

| Metric | Before forced GC sample | After reference release and forced GC |
| --- | ---: | ---: |
| CDP used JS heap | 65,402,804 B | 61,862,072 B |
| CDP backing storage | 505,182,462 B | 159,008,477 B |
| performance.memory.usedJSHeapSize | 570,595,298 B | 220,880,613 B |

Backing storage fell346,173,985B; reportedperformance.memory fell349,714,685B. The retained parsers'embeddedbody sum was143,014,284B; it is not the same as totalretention because parser caches and intermediatebuffers also remain. Do not conflate CDPJSheap withbrowserperformance.memory (which includes these buffers in this Chrome environment), nor sumoverlappingcategories. Errors0. Codex openedafter-parser-release.png and confirmed the player,props,terrain,companions andmammothstilldraw. This single frozen view does not prove live animation, context recovery, safeeviction orretry after a production fix.

Evidence output/playwright/optimization-20261009/parser-retention-r01/result.json. Runtime owner must add an explicit scene/clip-only return contract after successfulparse/hashwork, preserve failedparsecleanup, updateGLTF-specifictypesandcontextresourceidentification, testallrelevantflows and retainexactsource-byteverification. No globalCacheclearing orforceGC inproduct, no disposingliveresources. Do not mark the full project complete.
