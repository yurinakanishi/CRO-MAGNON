# WebGL texture payload before r04 adoption

Whole task unfinished. This measurement is separate from the FPS measurements.

Native Windows Chrome154.0.8037.93,390x844,DPR1,touch,CPU1; one renderer and four protocol peers; fixed herd, camp/mammoth/overview viewpoints from cpu-throttle-performance.mjs. Current frozen runtime-completion-r02 and original/unadopted public model/PNG records. Evidence: output/playwright/optimization-20261009/pre-adoption-texture-payload-r01/perf.json.

| Scene | Live WebGL texture handles | Format payload bytes, mips included | Decimal MB |
| --- | ---: | ---: | ---: |
| Camp |102 |843361862 |843.36 |
| Mammoth |105 |855070958 |855.07 |
| Overview |135 |1036088574 |1036.09 |

Independent instrumentation tracks create/bind/texStorage2D/3D, mutable texImage2D/3D, generated mip levels and deleteTexture. Unknown formats/unsupported allocation paths fail the probe; all three scene samples have zero unknown levels and zero probe/browser errors. The ledger includes the renderer's internal placeholder textures as well as model images and bone textures, unlike only traversing game meshes. It retains no source ImageBitmap or pixel bytes.

This is the uncompressed internal-format payload requested through WebGL. It excludes driver padding, duplication, renderbuffers, geometry buffers and the default framebuffer, and is not physical driver memory. PNG/WebP/JPEG file compression is not GPU texture compression. Texture upload instrumentation makes this run unsuitable as an FPS result. No forcedGC or claim about a physical phone.

The probe was independently checked on native WebGL against known 2D/cube/3D/array/mutable mip/image-source allocations and deletion: cumulative84,204,240,300,384,400bytes then0. Evidence texture-probe-selfcheck-r01.json. Context7 official Three docs confirm renderer.info.memory.textures is a count and texture payload generally depends on dimensions/format/mips, not downloaded image byte length. Installed Three WebGLTextures.js actual allocation paths inspected.

Re-run texture-probe-performance-driver.mjs with adopted manifests and the same views/viewport to measure resizing gains; do not infer them merely from candidate sizes. The project GPU texture guide of200MB is not currently satisfied.
