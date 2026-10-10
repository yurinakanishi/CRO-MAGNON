# Runtime KTX2/Basis review r12 (read-only)

Runtime session 026f16c0-538a-4645-99e9-a78a97eaa58f, 2026-10-10.

This is a read-only review. No code, asset, manifest, script or test was changed and no command was run. Nothing here is a measurement: every reduction below is labelled *theoretical*, and no FPS, memory, quality or encoder cost is claimed.

- No encoder is installed. Codex found only Three's `basis_transcoder.js`/`.wasm`, which is a transcoder (decoder).
- r04 adoption `a01` and the unadopted r05 candidates are not touched.
- Nothing here touches:
  - the 7 startup actors;
  - the violet-behemoth;
  - camp-cave and its gallery images.

## 1. Short answer

1. **One transcoder per page.**
   - A new runtime module (proposed `src/ktx2-textures.ts`, owner 026) holds exactly one Three `KTX2Loader` per page.
   - It is created when the page's WebGL renderer is registered, but stays dormant: no fetch and no worker until the first texture that requires `KHR_texture_basisu`. Then `init()` downloads the transcoder once.
   - `setWorkerLimit(1)` initially; 2 only after mobile measurement.
   - It is never disposed while a transcode is pending. It is disposed with its renderer.
2. **Who calls `detectSupport`: the code that constructs the renderer, synchronously, right after constructing it.**
   - In the game that is the `WorldRenderer` constructor, immediately after `new THREE.WebGLRenderer(...)` at `src/world3d.ts:399`.
   - `src/model-review.ts:55` and `src/biome-review.ts:11` do the same for their own renderers.
   - Registration builds the loader and runs `loader.detectSupport(renderer)` on a fresh, not-lost context.
   - It then applies the sRGB-safety filter (§3.1) before any worker can exist. Workers receive the config only when they are created (`KTX2Loader.js:332-337`).
3. **Model parsing does not precede WebGL initialization in the current game.**
   - `main.ts:498` constructs `WorldRenderer` while the module is evaluated. Inside the constructor:
     - `WorldAssets` and `CharacterAssets` are constructed but inert (`world3d.ts:380-389`; `world-assets.ts:52-67`);
     - the WebGL renderer is created at line 399;
     - `startWorld()` runs at line 457.
   - `prepareSelf` and the gallery's `cave.load()` run later through that renderer's providers.
   - So no waiting mechanism is needed. A GLB requiring `KHR_texture_basisu` that is parsed with no registered renderer (Node tests, or a future reorder) must fail fast with a clear error. It must not wait, fall back to RGBA or use a PNG.
   - Byte download and SHA verification may still start earlier; only parse and transcode need the renderer. This is a constraint for the startup owner's future world-initialization work.
4. **GLTFLoader gets a per-parse adapter, not the shared loader.**
   - `parseEmbeddedGLB` passes a small per-parse object to `setKTX2Loader`. Its `load(url, onLoad, _, onError)`:
     - fetches the blob URL through the parse's own `LoadingManager`, so the existing URL modifier records and revokes it and `onError` reaches `undecoded`;
     - passes the fresh `ArrayBuffer` to the shared loader's `parse()`;
     - wraps that in its own tracked promise with a timeout.
   - Any failure or timeout marks the image undecoded, so the existing fail-fast path and `releaseParse` handle it.
   - The adapter is held only by `parser.options`, so it is dropped with the parser exactly as r03 requires.

## 2. Facts in the installed code that force the design

- **The transcoder needs `detectSupport` first.**
  - `KTX2Loader.load/parse` throw without `workerConfig` (`:377-381`, `:409-413`).
  - Workers copy the config at creation (`:332-337`), so changing capabilities later needs a new loader.
  - A second instance warns, because each loads its own transcoder and workers (`:345-358`).
- **Worker lifetime is not guarded.**
  - `WorkerPool` listens only for `message` (`WorkerPool.js:60-98`). A worker error, out-of-memory or WASM init failure never resolves its task.
  - `dispose()` drops pending resolvers and the queue (`:157-165`), so pending transcodes hang forever.
  - Both would hang `parseEmbeddedGLB` and `releaseParse` (`embedded-glb.ts:240-248`). This is why the adapter needs tracked tasks, a timeout, and rejection on dispose.
- **WorkerPool keeps the last result.**
  - `workersResolve[id]` is not cleared after resolving. One finished task's message, including its transferred mip buffers, stays reachable per worker until that worker's next task.
  - This is bounded by the worker limit times one texture (about 1.4 MB for a 1024² 16-byte-block texture, *theoretical*). It must be shown by a forced-GC diagnostic, like the r03 parser finding.
- **Buffers are transferred.** `parse()` transfers its `ArrayBuffer` to the worker (`:497`). The GLTF path is safe: GLTFLoader writes the image to a Blob URL and the adapter fetches a new buffer. Any future shortcut that hands it a view of the GLB bytes would detach the verified GLB; it must copy.
- **GLTFLoader turns a failed texture into nothing.**
  - `loadTextureImage(...).catch(() => null)` (`GLTFLoader.js:3275-3279`) means a failed KTX2 texture becomes a material with no map, silently.
  - PNG failures are caught today only because `undecoded` listens to our manager. A KTX2 Loader's own `FileLoader` would not use that manager, hence the adapter.
- **Without a loader, an optional basisu texture silently uses its fallback.** The basisu plugin returns null for a non-required extension and GLTFLoader uses the `source` fallback (`:1474-1486`).
  - `selectedImage` already refuses *required* basisu (`embedded-glb.ts:122-126`).
  - It must also refuse optional basisu, so no fallback image can be substituted.
- **Colour space is assigned in two places.**
  - `assignTexture` sets sRGB only for colour slots (`:3415-3419`, used at 835 and 3674).
  - Normal, metallic-roughness and occlusion keep the KTX2 file's own label (DFD), via `parseColorSpace`, `KTX2Loader.js:1251-1273`. A normal map labelled sRGB would be decoded as sRGB and shade wrongly.
- **Mipmaps must be complete.**
  - The glTF sampler default overrides KTX2Loader's filter to `LinearMipmapLinear` (`:3266`), and `generateMipmaps` is false for compressed textures (`:3269`).
  - A KTX2 file without its full mip chain is an incomplete texture and renders black or wrong.
- **sRGB block formats can be unavailable.**
  - BC1/BC3 in sRGB needs `WEBGL_compressed_texture_s3tc_srgb`, or Three gets a null format and only warns (`three.module.js:13562-13579`, `12145-12148`).
  - ETC1 has no sRGB variant. ETC2, ASTC and BPTC have sRGB variants in their own extensions.
- **There is an uncompressed fallback.** With no supported target, Basis falls back to RGBA32 (`KTX2Loader.js:866-874`): no GPU saving, plus a retained JS copy (§4).
- **Raw formats bypass the transcoder.** Raw `vkFormat`s and UASTC HDR take `createRawTexture` and need no transcoder (`:484-491`). Raw BC7 on a device without BPTC would simply fail, so only Basis ETC1S and UASTC LDR 4×4 may be allowed.
- **Our code treats compressed textures as different from images.**
  - `textureIdentity` returns null for compressed textures (`embedded-glb.ts:365-366`), so `coalesceTextures` would not share a KTX2 colour map between a full model and its LOD. Every LOD in r05's inventory repeats its colour image byte for byte.
  - Release paths call `image.close()`. A compressed texture's `image` is `{width,height}` and its CPU data is `mipmaps`, freed only by GC.
- **Packaging.**
  - `prepare-vendor.mjs:13-20` publishes only GLTFLoader, the meshopt decoder and three utilities.
  - `KTX2Loader` additionally needs:
    - `utils/WorkerPool.js`;
    - `libs/ktx-parse.module.js` and `libs/zstddec.module.js`;
    - `math/ColorSpaces.js`;
    - `libs/basis/basis_transcoder.js` and `.wasm`.
  - The default transcoder URLs resolve from `import.meta.url` (`:106-107`), so publishing at the mirrored `/vendor/addons/` path needs no `setTranscoderPath`.
  - The exhibition CSP already allows `'wasm-unsafe-eval'`, `worker-src 'self' blob:` and `connect-src blob:` (`infrastructure/node/exhibition-client.mts:31`). It must stay that way.
- **The probe cannot count compressed textures.** The GPU texture-payload probe would record compressed allocations through `texStorage2D` as `UNKNOWN` (bytes null), and flags `compressedTexImage2D` as unsupported (`texture-storage-probe.mjs:27-32, 79`). It cannot measure KTX2 until it learns block sizes.

## 3. Minimal runtime design (future; owner 026; coordinate world3d with startup 803)

### 3.1 Capability path

- **Registration.** `registerTextureTranscoder(renderer)` creates the KTX2Loader and runs `detectSupport`.
  - It refuses a lost context or a second live renderer.
  - It then sets `dxtSupported &&= has('WEBGL_compressed_texture_s3tc_srgb')` and `etc1Supported = false`, before any worker exists. WebGL2 devices with ETC use ETC2, which has sRGB.
- **QA record.** It records the effective config and each texture's chosen format, e.g. `canvas.dataset.textureTranscoder`, for QA.
- **After a context restore, before drawing.** Re-query exactly the extensions that the live compressed textures' formats need.
  - On any mismatch (for example a GPU-process fallback), use the existing stalled/reload path (`context-recovery.ts`), never black textures.
  - Same capabilities: Three re-uploads from the retained `mipmaps`, as it re-uploads retained ImageBitmaps today (`releaseLostContext`).

### 3.2 Changes to `parseEmbeddedGLB` (`embedded-glb.ts` only)

- **Which image is hashed.** `selectedImage` returns the basisu `source` when `KHR_texture_basisu` is in `extensionsRequired` and a renderer is registered. Otherwise it throws:
  - optional basisu, or basisu with a fallback `source`: rejected;
  - no renderer: rejected.
- **Image checks.** `checkEmbedded` already forces embedded `bufferView` images. Additionally require `mimeType` `image/ktx2` for basisu sources.
- **Wiring.** Call `loader.setKTX2Loader(adapter)` only when the file uses basisu. Files without basisu (all current assets) keep exactly today's path, and the transcoder is never fetched.
- **New checks after parse, failing the parse.** For every texture with `userData.mimeType === 'image/ktx2'`:
  - `isCompressedTexture`;
  - full mip chain when the sampler filters through mipmaps;
  - format in the approved set (RGBA32 fallback is a failure unless a later product decision allows it);
  - data slots (normal, roughness, metalness, AO) not sRGB.
- **Sharing between full model and LOD.** `textureIdentity` accepts a KTX2 compressed texture: the same encoded SHA, the same transcoded format/type/colour space/mip count, plus today's sampler and transform fields. Then LOD pairs share one upload.
- **Release.** `releaseParse` and `disposeModels` need no new logic beyond dropping references. `close()` is absent and harmless.

### 3.3 Lifecycle, cancellation, cache

- **Tasks.** The service tracks every in-flight task.
  - Each task has a generous timeout, so a stuck worker fails the parse instead of hanging it.
  - `dispose()` (from `WorldRenderer.dispose`) rejects tracked tasks, then calls `loader.dispose()`, which terminates workers and revokes the worker Blob URL.
  - A transcoder download failure leaves `transcoderPending` rejected. Every later KTX2 parse then fails through `failWorld`; there is no silent retry with another loader.
- **Cancellation.** `AssetLoadQueue` (limit 2) still bounds concurrent parses. As today, a started load completes even if withdrawn, because WorkerPool cannot cancel. With one worker, a withdrawn load's textures can delay essential ones; this must be measured.
- **Integrity.**
  - GLB bytes stay SHA-verified (`downloadVerifiedAsset`, verified cache); embedded KTX2 bytes are covered and hashed per selected image.
  - No transcoded output is ever persisted, so there is no new cache surface.
  - Transcoder files are same-origin vendor files: byte-identical to `node_modules/three` at build, with the SHA recorded in the adoption graph (like `checkDecoder`). They are not hash-checked at runtime, which is the same trust as `three.module.js` and the meshopt decoder.
  - Larger or smaller GLBs change the 64 MiB verified-cache eviction pattern, which must be re-checked.

### 3.4 CPU memory and ImageBitmap differences (explicit)

- **Today (PNG/WebP).**
  - An `ImageBitmap` decoded by the browser outside the JS heap, often GPU-backed, closed by our dispose.
  - Mipmaps are generated on the GPU (×4/3 payload).
  - The browser may apply PNG gamma/ICC colour conversion.
- **KTX2.**
  - The transcoded mip chain lives in JS `ArrayBuffer`s and stays referenced by `texture.mipmaps`, which context restore needs. Its size equals the GPU size, ×4/3 included.
  - Upload uses `texStorage2D` plus `compressedTexSubImage2D` per level, with no GPU mip generation.
  - No colour conversion: an image with `gAMA` or `iCCP` that the browser converts today would change appearance.
- **Peak per texture in flight (all unmeasured).**
  - The GLB buffer (already resident during the parse);
  - a Blob copy and a fetched copy of the KTX2 bytes;
  - the KTX2 bytes copied into the worker's WASM heap;
  - the output mips.
  - Each worker's WASM heap grows to its largest texture and never shrinks until terminated. A limit of 1 bounds this on phones.
- **RGBA32 fallback.** GPU equals today's. The JS heap additionally keeps all mips (5,592,404 B per 1024², *theoretical*), more than today's 4,194,304 B ImageBitmap. Never treat the fallback as a saving.

## 4. Formats and capability (theoretical, per 1024² with a full mip chain)

| Basis mode → transcoded target | Chosen when | Bytes | vs RGBA8 5,592,404 B |
| --- | --- | ---: | ---: |
| UASTC → ASTC 4×4 / BC7 / ETC2-EAC (RGBA) / BC3 | ASTC, else BPTC, else ETC2, else S3TC | 1,398,128 | −75% (−4,194,276 B) |
| ETC1S → BC7 | BPTC present (desktop Windows Chrome very likely), no ETC2 | 1,398,128 | −75% |
| ETC1S opaque → ETC2 RGB (ETC1 data) / BC1 | ETC2 (mobile), else BC1 if no BPTC | 699,064 | −87.5% |
| ETC1S or UASTC with alpha | any compressed target (alpha needs a 16-byte block) | 1,398,128 | −75% |
| Either → RGBA32 fallback | no compressed target | 5,592,404 (+ JS copy) | 0% |

Block math: 16 B per 4×4 block on every level, with levels at 4 px and below using one block each.

- **Colour (baseColor, emissive): sRGB.** The DFD must say BT.709 primaries with sRGB transfer, although GLTFLoader forces sRGB anyway.
- **Normal and data: linear.** The DFD must say linear transfer, because the file's label decides here.
  - Use UASTC for normals and ORM. ETC1S crosstalk and block artefacts are poor for those maps.
  - Never use 2-channel normal modes (`--normal_mode`, any `KTXswizzle` other than `rgba`): Three samples xyz from RGB.
- **Alpha.**
  - Opaque materials may drop alpha only if every source alpha is 255 and no runtime shader reads `map.a`. The regional surface shader reads only `diffuseColor.rgb` (`biome-surfaces.ts:47-77`).
  - MASK/BLEND must keep alpha.
  - The premultiplied-alpha DFD flag must be 0.
- **Emulated formats.** WebGL-level accounting cannot see ANGLE or driver emulation, for example ETC exposed but decompressed, or KTX2Loader's own Mesa note at `:258-273`. A real saving needs browser GPU-process memory evidence, not only the probe.

## 5. Future publisher phase (owner 587; listed only, nothing touched)

**Generation (`scripts/optimization`)**

- **A KTX2 encode job beside `resizeJob`.**
  - The "formats never change" invariant (`textures.mjs:2`) becomes a per-revision policy.
  - Per-treatment modes, e.g. colour ETC1S or UASTC; normal and data UASTC + Zstd.
  - Quality, RDO and Zstd levels are recorded in the manifest and plan. The job key is the source SHA, encoder identity and settings.
- **Pinned offline encoder.** KTX-Software `toktx`/`ktx create` or Basis `basisu`, restricted to ETC1S and UASTC LDR 4×4, which r185's transcoder supports.
  - Record version and binary SHA in `toolchain`.
  - Run isolated, with no network and no cloud API.
- **Sources.** Encode from the SHA-verified originals (as r04/r05 do), never from r04 lossy WebP.
- **Mipmaps.**
  - Full chain to 1×1.
  - Colour filtered in linear light; normals box-renormalised (the existing filter); data box per channel. These come either as our Pillow levels fed to the encoder, or as encoder-generated levels with explicit flags; which encoder supports level input needs evidence.
  - No `y_flip`; `KTXorientation` `rd`; no premultiplication.
- **GLB rewrite.**
  - Image → `image/ktx2`.
  - Texture → `{sampler, extensions: {KHR_texture_basisu: {source}}}`, with no `source` and no `EXT_texture_webp`.
  - Add `KHR_texture_basisu` to `extensionsUsed` and `extensionsRequired`.
  - Remove images left unreferenced, with an index remap.
  - A full model and its LOD carry byte-identical KTX2 bytes for a shared source image.
- **Files.**
  - `gltf-usage.mjs`: `checkExtensions` allowlist (KTX2 mode only); `imageSemantics` must count the basisu source.
  - `images.mjs`: a KTX2 sniffer and MIME type.
  - `glb.mjs`: `IMAGE_MIME_TYPES`.
  - `contract.mjs`: per-image `format/mode/transfer/levels/alpha`.

**Structural verification (`verify.mjs` `verifyDerived` + a KTX2 image check)**

- **JSON.** The JSON must equal the source except for the KTX2 edits listed above.
- **Container.**
  - `vkFormat` UNDEFINED (Basis only; no raw formats, no HDR).
  - Supercompression: BasisLZ for ETC1S, Zstd or none for UASTC.
  - DFD colour model matches the mode; transfer sRGB for colour, linear otherwise; BT.709 primaries; no premultiplied flag; alpha channel presence as planned.
  - Size: the planned size, a power of two and a multiple of 4; 1 face; 0 layers; depth 0.
  - Full `levelCount` with exact per-level sizes.
  - KV: orientation `rd`, no non-identity swizzle, `KTXwriter` recorded.
- **Decoded parity, every level.**
  - Decode with the vendored transcoder, byte-identical to Three's, to RGBA32.
  - Compare with reference levels from the original:
    - colour: PSNR/SSIM as context;
    - normals: angular error mean and p95;
    - data: per-channel maximum and p95;
    - alpha: alpha-cutoff crossings;
    - orientation: a flipped-image check.
  - Whether Three's `basis_transcoder.js` runs in Node is **unverified** and is the first evidence item.
- **Determinism.** Re-encode and compare.

**Build and adoption**

- `prepare-vendor.mjs` publishes the seven KTX2Loader files (§2).
- `runtime-graph.mjs` gains a `checkDecoder`-like transcoder check, required only when a shipped GLB requires `KHR_texture_basisu`.
- The adoption graph records the transcoder SHAs.
- Package QA inventories (local, exhibition, MMO) include the transcoder files.

## 6. Restricted first proof

**Yes, a restricted subset works.** The first proof is **hide-tent, valley-boulder and stone-firepit**:

- They are ordinary static camp props, on screen at spawn, outside the 7 actors, the violet-behemoth and camp-cave.
- They are opaque; per `texture-inventory-r05.json`, every image currently has no alpha channel.
- They have no skinning or morph targets.
- Between them they cover all three treatments:
  - hide-tent: colour, normal and metallic-roughness;
  - boulder and firepit: colour and normal.
- They exercise:
  - the LOD props hide-tent and firepit (`THREE.LOD` in `createResource`, `world-scenery.ts:33-39`);
  - valley-boulder's instanced landscape and impostor capture (`world-scenery.ts:336-343`, `world-assets.ts` `renderImpostor`). After a restore that capture is drawn again from the retained mips.
  - regional-surface material clones (shared texture objects);
  - full/LOD colour sharing: each LOD repeats its full model's colour image with the same SHA.
- Excluded for now:
  - ground and water tiles (custom terrain and water shaders, alpha questions);
  - valley-pine (canopy and LOD specifics; the boulder already covers the instanced and impostor path);
  - wood and stone piles (resource logic);
  - mascots and orb-bots;
  - every non-power-of-two image (1016×1024 heads, 1024×341 friezes, cave murals).
- **Overlap with r05.** r05 Tier A plans 512 normal/data maps for these same keys. The proof should stay outside adoption and isolate the format change at today's 1024 sizes. Stacking it with r05 is a later chained decision with publisher 587.

**Theoretical size**

- 7 distinct 1024² images.
- If each is resident once and transcoded to 16-byte blocks, the GPU payload falls by 7 × 4,194,276 = **29,359,932 B** (camp 370.1 → about 340.7 MB, *theoretical*).
- The 3 colour maps on ETC2/BC1 targets (ETC1S, mobile) would save up to 3 × 699,064 B more.
- Upper bound for all environment textures: r15's 41–43 environment 1024² uploads in camp would be −172.0 to −180.4 MB (*theoretical*). That set includes protected and excluded items; it shows reach, not a plan.
- Download effect: unknown. These images are lossy WebP of about 148–432 KB today (`texture-inventory-r05.json`; r15 Tier A table); UASTC + Zstd may be larger and ETC1S smaller.

**Staged steps (each stage passes before the next)**

0. **Evidence, Codex.**
   - Obtain a pinned offline open-source encoder and record its version and SHA.
   - Confirm that Three's transcoder decodes KTX2 → RGBA32 in Node.
   - Record the WebGL extension lists for the Chrome and Windows WebKit QA profiles (and phones when available).
   - Extend and self-check the payload probe for compressed block sizes.
1. **Offline candidates, outside `public/`.**
   - Encode the 7 images from the originals, in both colour modes (ETC1S and UASTC) and UASTC for normal/MR.
   - Build full and LOD GLBs and run the §5 structural and decoded checks.
   - Report encoded bytes against today's files.
2. **Runtime, owner 026.** Implement §3 with unit tests:
   - a fake transcoder (Node has no Worker);
   - adapter failure, timeout and dispose-rejection;
   - optional, fallback and no-renderer rejection;
   - colour-space, mip and format assertions;
   - KTX2 identity sharing;
   - capability filter;
   - restore mismatch.

   Every current asset keeps today's path and must make no transcoder request.
3. **QA-only native preview** with a separate build root and no manifest rewrite. Chrome and Windows WebKit, 390×844, CPU×1 and CPU×4:
   - formats chosen and no RGBA fallback;
   - extended payload probe;
   - close-ups in daylight and firelight, at raking angles and at minification distance, at DPR 1 and DPR-3-equivalent;
   - 3 context loss/restore cycles;
   - eviction and return;
   - one worker;
   - forced-GC retention (WorkerPool bound);
   - JS heap including retained mips;
   - transcoder and GLB network bytes;
   - transcode and upload time.
4. **Decision.** Only then choose per-treatment modes, followed by a separate publisher revision and adoption.

## 7. Concrete failure cases (each needs a test or native check)

1. A normal or MR map encoded with an sRGB DFD is decoded as sRGB and shades wrongly.
2. A single mip level with the glTF default sampler gives an incomplete (black) texture.
3. sRGB data transcoded to BC1/BC3 without `s3tc_srgb` gets a null internal format and a broken texture.
4. No compressed target means RGBA32 fallback: no saving, plus a retained JS copy.
5. 2-channel normal encodings or `KTXswizzle` produce wrong normals.
6. A `y_flip` or a non-`rd` orientation produces flipped textures.
7. A premultiplied-alpha DFD flag produces wrong blending or a pixel-store error.
8. A PNG with `gAMA`/`iCCP` is colour-converted by ImageBitmap today but not by KTX2, so colours shift.
9. Non-power-of-two or non-multiple-of-4 sizes misalign blocks.
10. Optional basisu with a fallback `source` lets the PNG be substituted silently.
11. A transcoder 404 or CSP block (WASM or blob worker) fails every KTX2 parse; this must surface as a world failure.
12. A worker crash, out-of-memory or WASM init hang leaves the parse and `releaseParse` hanging.
13. Disposing KTX2Loader with pending tasks leaves them never settling.
14. Multiple KTX2Loaders duplicate transcoders and workers.
15. A capability snapshot taken while the context is lost is empty.
16. A restored context with different extensions leaves live compressed textures unsupported.
17. A null `textureIdentity` makes full and LOD upload twice, so the saving is not realised.
18. The WorkerPool's retained last result keeps evicted texture data alive.
19. UASTC files larger than today's WebP slow startup (already 63.04 s to controls at 10 Mbps).
20. Encoding from r04 WebP loses quality a second time.
21. Handing KTX2Loader a view of the GLB bytes detaches the verified buffer.
22. Driver or ANGLE emulation shows a saving at WebGL level but none in real GPU memory.
23. The current payload probe reports compressed allocations as `UNKNOWN`.
24. Windows WebKit capabilities are not iOS Safari's: there is no physical-phone evidence.

## 8. Not established

- The encoder and its cost.
- Node decoding with Three's transcoder.
- Encoded sizes.
- Transcode and upload time.
- Worker WASM heap size.
- Per-browser and per-device formats.
- Real GPU memory under emulation.
- Visual quality of either colour mode.
- FPS.

All are §6 stage 0–3 evidence. No adoption or implementation decision exists.
