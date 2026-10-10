# r20 independent native verdict — 2026-10-10

No adoption. The entire14-image WebP replacement is **not accepted**. Pillow equality and a Canvas2D-only pass do not establish the current game's GPU result.

Proof: `lossless-png-proof-r20-run01/report.json`, SHA256 `48dfbe3807f0160e419a7e4a66dd138708f2f62d314d5b62389eee75e059540c`. All14unique PNGs (20references across17served files) have identical full unpremultiplied RGBA with Pillow, exact alpha including hidden transparent RGB, and two identical encodes. Raw image savings8,938,102B perreference /4,962,520B deduplicated. These overlap the LOD-sharing proof and cannot be added to it.

## Native results

Evidence folders under `output/playwright/optimization-20261009/`:

- `lossless-r20-chrome-r01`: stopped after snow's Canvas difference. Preserved as a failed initial diagnostic.
- `lossless-r20-chrome-r02`, `lossless-r20-webkit-r02`: all14, both current decoding functions, full Canvas2D RGBA. Chrome12differences, WebKit0. No GPU comparison in r02.
- `lossless-r20-chrome-r03`, `lossless-r20-webkit-r03`: all14, adds Three WebGLRenderer1:1 RGBA8 sRGB render-target readback, NoBlending/NoToneMapping, same actual texture settings, synthetic diagnostic plane only. No game model is generated or adopted. Executed harness/HTML are frozen in each result directory.

Current cave path is `loadVerifiedTexture` → `decodeImageWith` → Three ImageLoader/HTMLImageElement. It is **not** createImageBitmap as the authored r20 note claimed. Current GLB path is `parseEmbeddedGLB` → Three GLTFLoader/ImageBitmapLoader. QA uses existing synthetic test fixtures with actual encoded image bytes to exercise that path; fixtures are never runtime assets.

| Comparison | Chrome154.0.8037.93 | Windows WebKit |
| --- | --- | --- |
| GLB/ImageBitmap Canvas,14images | exact | exact |
| GLB/ImageBitmap GPU,14images | exact | exact |
| ImageLoader Canvas,14images |12differ, RGB only | exact |
| ImageLoader GPU,14images | exact |9alpha murals differ |
| Current usage GPU:4ground images + opaque cave limestone | exact | exact |
| Current usage GPU:9alpha cave murals | exact |144–1140pixels differ per image, max RGB difference2–6, alpha unchanged |
| Decoded bitmaps closed, standalone textures cleared | pass | pass |
| page/console errors |0 |0 |

**Read r03's individual GPU fields.** Its top-level status was originally named for Canvas decoding; WebKit's `native-decode-equality-passed` is Canvas-only and **does not** mean GPU equality (`equalGpuCurrentPaths:false`). Chrome's `native-decode-differences-found` coexists with `equalGpuCurrentPaths:true`. This verdict records the distinction rather than overwriting executed evidence.

The9alpha murals are not approved as WebP. Publisher587 is authoring a separate r21 PNG IDAT recompression proof that preserves the original filtered stream and every non-IDAT chunk, avoiding format/decoder changes. Four ground PNGs and opaque limestone passed the current native GPU paths but are not yet adopted; snow's sRGB/gAMA/cHRM metadata cannot be represented verbatim in WebP, so its metadata issue remains explicitly recorded despite current native parity.

Manually opened representative r03 sheets: Chrome mural-atlas (`94ca1a...`) and WebKit snow (`d0ac31...`). No obvious visual difference at sheet scale, but that does not overrule full-pixel failures. Other sheets were generated and machine-compared, not all manually viewed. Final in-world cave/terrain appearance, package integration, caches/context lifetime, transfer and startup performance remain untested for any r20 replacement. Windows WebKit is not physical iOS/Safari. Current product remains r05-a02.
