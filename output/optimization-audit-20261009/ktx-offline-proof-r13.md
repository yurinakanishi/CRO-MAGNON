# KTX2 offline proof r13 (stage 1 of runtime-ktx-review-r12)

Runtime session 026f16c0-538a-4645-99e9-a78a97eaa58f, 2026-10-10.

**Authored, not run.** Nothing here has been executed by this session, so no result, size, timing or quality is claimed. Codex runs it, then reviews and inspects the outputs.

These are output-only files:
- `ktx-offline-proof-r13.mjs` (the proof);
- `ktx-offline-proof-r13.py` (the Pillow helper);
- this note.

No `src`, `scripts/optimization`, `tests`, `public`, `assets` or adoption record was changed. The script only reads trusted helpers and records, and writes inside a fresh `--out` directory.

## Command

```
node output/optimization-audit-20261009/ktx-offline-proof-r13.mjs ^
  --out output/optimization-audit-20261009/ktx-offline-proof-r13-run03 ^
  --python C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe
```

`ktx-offline-proof-r13-run01` (before r13b) and `ktx-offline-proof-r13-run02` (before r13c) are preserved failures; never reuse either directory.

- **Python.** The helper runs with the pipeline's Python (`scripts/optimization/textures.mjs` `DEFAULT_PYTHON`) in isolated mode `-I`. Use `--python <exe>` to choose another interpreter, and `--python-unisolated` if Pillow lives in user site-packages.
- **Output directory.** `--out` must be a new directory directly inside `output/optimization-audit-20261009/`. An existing path is refused and nothing is overwritten.
- **Run time.** There is one encode per distinct source image per variant; normal and data maps are shared by both variants. If the LOD colour originals equal the full models' (not yet confirmed for the originals), that is 10 encodes. Each is written twice. Full-resolution sources (2048²) also make the mip-building stage longer. ETC1S at `--clevel 4 --qlevel 255` on one thread may take minutes per image; the timeout is 30 min per encode.
- **Exit status.** 0 with `result.json`, or 1 with `failure.json` naming the failed stage.

## Scope and inputs

- **Keys.** Exactly `hide-tent`, `stone-firepit` and `valley-boulder`, hard-coded. There are no actors, behemoth, cave or other models.
- **Base record.** Adoption `20261009-r04-a01`:
  - `plan.json` must be bound to `journal.json` (plan SHA). The journal state is recorded, not gated, so a later chained adoption does not break the proof.
  - `before/public/models/world-assets.json` and each key's `before/.../asset.json` must be the recorded inputs, by SHA.
  - The before/ manifests and the plan's graph must name the same original model and LOD (URL, SHA-256, bytes).
  - Each graph entry must be `ordinary-compressed` with exactly one LOD.
- **Files.**
  - The originals are `model-c2.glb` and `lod-c2.glb`, read through `readVerifiedSource` (SHA-256 and length checked).
  - Their r04 counterparts are read the same way, for size and geometry comparison only.
  - Served r04 WebP is never encoded from.
- **Image sizes** (corrected in r13b; the first draft wrongly said originals were at most 1024 and never resized):
  - Delivered textures are at most 1024 and must equal the r04 served size of each image.
  - An original up to 1024 is delivered at its own size.
  - A larger original, such as hide-tent's 2048×2048 normal map, is decoded and retained at full resolution and delivered from its own semantic mip chain at the r04 size.
  - r05's 512 maps are not stacked.
- **What the originals look like** (seen in their JSON chunk):
  - every image is lossy WebP;
  - every texture uses `EXT_texture_webp` with no core `source`;
  - one image per texture;
  - sampler minFilter `LINEAR_MIPMAP_LINEAR`, so a full mip chain is mandatory.

## Settings (fixed in the script; recorded in `result.json`)

**Variants**

| Variant | Colour (baseColor/emissive) | Normal | Data (MR/occlusion) |
| --- | --- | --- | --- |
| `color-etc1s` | ETC1S/BasisLZ `--clevel 4 --qlevel 255` | UASTC | UASTC |
| `color-uastc` | UASTC | UASTC | UASTC |

- **UASTC.** LDR 4×4, `--uastc-quality 3`, no RDO, `--zstd 18`.
- **Shared maps.** Normal and data KTX2 files are encoded once and are byte-identical in both variants.
- **Colour space.**
  - Colour: `--format R8G8B8_SRGB --assign-tf srgb --assign-primaries bt709`.
  - Normal and data: `--format R8G8B8_UNORM --assign-tf linear --assign-primaries none`.
  - All: `--assign-texcoord-origin top-left --threads 1`.
- **RGB, not RGBA.**
  - Every source is decoded and verified fully opaque (alpha 255).
  - No in-scope material reads texture alpha, so opaque formats with 8-byte blocks stay possible.
  - An image with any transparent texel is refused.
- **Never used:** `--normal-mode`, swizzles, Y-flip, origin conversion, UASTC RDO, encoder mip generation. XYZ normals stay XYZ in RGB.
- **Mip chain**, supplied raw, down to 1×1.
  - The chain is built from the full-resolution decoded original.
  - Delivered level 0 is the exact decoded source when the original fits in 1024. Otherwise it is the derived reference: the chain level at the delivered size.
  - Every other level is the mean of its exact full-resolution source footprint, rounded once:
    - colour in linear light, with the exact sRGB transfer both ways;
    - normals as XYZ vectors (`byte/127.5 − 1`, as Three decodes them), renormalised;
    - data per channel.
  - A near-zero normal mean is kept unnormalised, like `texture-resize.py`, and counted.
- **Sources.**
  - Pillow decodes each image once.
  - ICC, gAMA, cHRM, EXIF, PNG bit depth other than 8, animation, colour-key transparency and JPEG are refused, not converted.
  - A PNG `sRGB` chunk is allowed and noted.

## Gates (all structural; each failure stops the run)

1. **Tools.**
   - `ktx.exe` matches the verified SHA-256 `9718ed38…34ef`, and its adjacent `ktx.dll` matches `6a5bfec1…d873`. Both are checked before `--version` and again before every `ktx` invocation (correction r13a below).
   - `ktx.exe` reports `v4.4.2`.
   - The installed Three `basis_transcoder.js`/`.wasm` and `meshopt_decoder.module.js` load.
2. **Base record and originals.** As listed under "Scope and inputs".
3. **Original structure.**
   - `validateDocument` and `checkExtensions` pass; only WebP and preserved extensions are used.
   - One selected image per texture, and every image selected.
   - Treatments are colour-opaque, normal or data (`imageSemantics`).
   - No image buffer view is shared with accessor data.
   - Power-of-two sides of at least 4.
   - The delivered size is the source itself up to 1024, else an exact power-of-two reduction to a longest side of 1024. Delivered sides must be at least 4.
   - The delivered size must equal the r04 served image's size at the same index.
4. **Mip chains.** The delivered chain is complete to 1×1. Its level 0 is identical to the decoded source when the source fits; otherwise it is the derived reference at the delivered size.
5. **Encoding.**
   - Each KTX2 is written twice with identical bytes.
   - `ktx validate --gltf-basisu` passes.
6. **KTX2 structure.** Parsed with Three's `ktx-parse`:
   - `vkFormat` UNDEFINED, with the size, levels, 1 face, 0 layers and 0 depth;
   - BasisLZ (ETC1S) or Zstd (UASTC) supercompression;
   - DFD colour model ETC1S or UASTC;
   - transfer sRGB with BT.709 primaries for colour, linear with unspecified primaries for maps;
   - one RGB sample, no premultiplied flag;
   - `KTXorientation` `rd`, no swizzle.
7. **Transcode.** Every level of every file is decoded by the exact installed Three Basis WASM to RGBA32:
   - each level has its expected size;
   - not reported as alpha, decoded alpha 255;
   - read as the planned mode (ETC1S or UASTC);
   - level 0 matches the unflipped delivered level 0 better than the flipped one.
8. **GLB structure.** Built from the original, then re-verified from the written file bytes:
   - JSON is identical except `images` (MIME `image/ktx2`, same buffer view and name), `textures`, the extension lists, views and buffers;
   - `textures` become `KHR_texture_basisu` only, with no `source` and no `EXT_texture_webp`;
   - extension lists: WebP removed; `KHR_texture_basisu` used and required; then `EXT_meshopt_compression` added by the unchanged `compressViews`, as for r04;
   - images are embedded;
   - no stray bytes (`checkStorage`);
   - each image view is exactly its recorded KTX2.
9. **Geometry.**
   - Every view decodes to the original bytes. Three's runtime decoder and the pipeline's meshoptimizer decoder must agree.
   - The accessor identity is equal to the original and to the r04 counterpart for every full and LOD file. It covers type, count, min/max and decoded elements, with counts by role (attribute/index/morph/skin/clip).
10. **Sharing.** A source image shared by a full model and its LOD becomes the same KTX2 bytes in both.

**Recorded, not gated.**
- Per level:
  - per-channel maximum, mean, p99 and signed bias;
  - RGB PSNR for colour, labelled "context only";
  - normal angular error (mean, p95, p99, maximum, fractions over 1/2/5/10°);
  - decoded alpha.
- Encoder times.
- Per-image and per-GLB bytes against the original and the r04 counterpart.
- Theoretical GPU bytes (RGBA8 with mips, and 16-/8-byte blocks with mips).

No metric decides quality.

## Output layout

- `result.json` or `failure.json`.
- **Variants:** `variants/<variant>/<key>/{model-c2,lod-c2}.ktx2.glb`.
- **Encodes:** `ktx2/<job>/run-0.ktx2`, `run-1.ktx2`, the encoder logs and `validate.log`.
- **Work files (`work/`):**
  - the exact source image bytes;
  - the decoded RGBA;
  - every supplied level `.rgb`;
  - the uncompressed GLB before meshopt;
  - the Python job files.
- **Previews (`previews/*.png`), for inspection only:**
  - each original at its own size (`<sha16>-original-WxH`);
  - for a resized original, the derived reference at the delivered size (`<sha16>-reference-WxH`);
  - each decode at the delivered size;
  - an absolute-error map (×8), or for normals an angle map (×25 per degree), against the delivered level 0.

## Specific risks of this first run

- The smoke test covered RGBA input only. RGB raw input (`R8G8B8_*`) is supported by `ktx create --encode`, but this run is its first use here. A refusal stops at the encode stage.
- `--zstd 18` and the ETC1S `--clevel/--qlevel` values have not been run by this session.
- Pillow's WebP decode is the reference. The browser's libwebp decode can differ slightly.

## Limitations (also in `result.json`)

- **Sources are lossy.** The originals are lossy WebP, so KTX2 starts from a decoded lossy image.
- **Metrics compare against the supplied levels,** not against what r04 draws on the GPU (generated mips, filtering, lighting).
- **Mip levels are new data.** Distant appearance can differ from today's GPU mipmaps.
- **The top level is not r04's pixels.** For originals above 1024, r04 used Pillow (Lanczos for colour) and then lossy WebP. Errors here are measured against this proof's own reference at the delivered size, so whether the result looks equivalent to r04 is unknown.
- **No GPU formats are exercised.** There is no BC7/ASTC/ETC/BC1 transcode, upload, sampling, residency or emulation check, and no browser capability check.
- **No glTF Validator run.**
- **The runtime still refuses `KHR_texture_basisu`.** Nothing is loadable, served or adopted.
- **Sizes and determinism are host-specific.** Encoded sizes are for these settings only, and determinism was shown on one host.

## Next steps (not done here)

1. Codex runs the proof and inspects `result.json`, the logs and the previews independently.
2. Native preview (r12 stage 3) needs the runtime support of r12 §3 and the payload probe's compressed block sizes first.

## Correction to runtime-ktx-review-r12.md (appended; r12 itself is kept as history)

1. **Primaries.** r12 §4 and §5 say every KTX2 DFD should carry BT.709 primaries. That is wrong for linear maps.
   - The official `KHR_texture_basisu` additional requirements and the actual `ktx validate --gltf-basisu` check both apply. Codex's r01 smoke test failed validator rule 6304 with linear transfer plus BT.709.
   - Normal and data maps must be **linear with UNSPECIFIED primaries** (`--assign-primaries none`).
   - sRGB colour stays **sRGB with BT.709 primaries**.
   - Consequences: KTX2Loader maps linear+unspecified to `NoColorSpace`, which Three treats as linear, so the r12 sampling conclusion is unchanged. The structural rule in r12 §5 should read "sRGB+BT.709 for colour, linear+unspecified for normal/data".
2. **Supplied mip levels.** r12 §5 called the encoder's support for supplied mip levels unverified. It is supported:
   `ktx create --raw --width W --height H --levels N --format <R8…_SRGB|_UNORM> --assign-tf … --assign-primaries … --assign-texcoord-origin top-left --encode uastc|basis-lz --threads 1 <level files…> <output>`.
   Codex's smoke test (`ktx-offline-smoke-r02`) shows it with RGBA levels, two identical runs, and the installed Three WASM decoding every level in Node. Synthetic fixtures are not asset-quality evidence.
3. **Encoder availability.** KTX-Software 4.4.2 is available offline as a portable CLI, at `offline-ktx-tools-r01`, with the official archive SHA verified, no installer run and no PATH change. r12 §8 "the encoder" is resolved for availability only; cost and quality stay open.

## Correction r13a: the encoder library is pinned too (before any run)

- **Problem.** The portable `ktx.exe` loads the adjacent `offline-ktx-tools-r01/ktx-extracted/bin/ktx.dll`. The first r13 draft pinned only the executable, so a changed encoder library would have been accepted.
- **What is pinned.** The proof now requires both identities from the same officially verified 4.4.2 archive:

  | File | SHA-256 |
  | --- | --- |
  | `ktx.exe` | `9718ed380605db33e18a74621978434cedaf119fa4fe25e142a30cabe02c34ef` |
  | `ktx.dll` | `6a5bfec1731cbb41e36a54bba56c67b58a78e05acef809fed20190588178d873` |

- **When they are checked.** Both are checked before `--version`, and again before every `ktx create` and `ktx validate`. All invocations go through `runKtx`.
- **What is recorded.** The path, bytes and SHA-256 of both files appear in `result.json` (`tools.ktx.exe`, `tools.ktx.dll`) and in the tools gate's details.
- **Nothing else changed.** Encodings, settings, key selection and all other gates are as in the first draft.
- **Limit.** Only these two files are pinned. Windows searches the executable's own directory first for this DLL, but system runtime libraries the DLL may use are not pinned here.

## Correction r13b: separate source size from delivered size (after run01 failed safely)

- **The failure.** `ktx-offline-proof-r13-run01` stopped at the originals. Its `failure.json` and `.log` are preserved, as are all originals. The message was "hide-tent model original image 0 is 2048x2048; this proof never resizes". The draft's assumption that these originals were at most 1024 was wrong. Only the tools and base gates had passed; nothing was decoded or encoded.
- **What the proof does now.**
  - **Unchanged decode.** It decodes each exact SHA-verified original at its own size (retained in `work/sources`), as before.
  - **Delivered size.** The source itself up to 1024. Otherwise, the level of the source's own semantic mip chain whose longest side is 1024: an exact power-of-two factor with the aspect preserved. The filtering is the existing colour in linear light, renormalised XYZ normal box and per-channel data box.
  - **Unsupported sizes.** A non-power-of-two size, or a delivered side under 4, fails clearly.
  - **r04 size gate.** Every selected image's r04 served size is read from the r04 counterpart, read only and never decoded or encoded from. The delivered size must equal it, or the run fails. Served r04/r05 images are still never encoded from.
  - **Delivered chain.** It starts at that level and descends to 1×1. For an original up to 1024, level 0 is still the exact decoded source, and the script checks this.
  - **Metrics and previews.** Errors are measured against delivered level 0 at the delivered size, never against high-resolution pixels. Previews keep the original (`-original-WxH`), the derived reference (`-reference-WxH`) and the decodes and error maps at the delivered size as separate files.
- **Identities kept apart.**
  - Each image and source records two separate identities:
    - the original: size, bytes, SHA-256, and decoded RGBA path and SHA;
    - the output: size, `resized`, `downsampleFactor`, `sourceLevel`, and how level 0 was made.
  - The r04 identity: size, bytes and SHA-256.
  - The whole source chain: every level's size, SHA and role (delivered or not delivered).
  - Each encode records `sourceSize`, `outputSize` and `downsampleFactor`.
  - Each file records the delivered `maximumTextureEdge` and the `originalMaximumTextureEdge` separately.
  - The Python decode check still uses the original size. KTX2, transcode and theoretical-GPU sizes all use the delivered size.
- **Unchanged.**
  - Key selection, encodings and colour-space settings: sRGB+BT.709 for colour, linear+unspecified for maps.
  - The `ktx.exe`/`ktx.dll` pins.
  - The full/LOD byte-identical sharing rule.
  - The geometry and JSON checks. glTF JSON holds no texture size, so no JSON allowance changed.
- **Added limitation.** The delivered top level of a resized original is this proof's own reduction, not r04's Pillow/Lanczos and lossy WebP pixels. Whether it looks equivalent to r04, and how it compares with the currently served r05 512 normal/data maps for these keys, is unknown until visual review.
- **Context.** r05 (adoption `20261010-r05-a02`) now serves these keys. This proof still derives from the immutable r04 `before/` originals and compares with the r04 counterparts. It does not read or modify the r05 graph.

## Correction r13c: create the previews directory (after run02 failed at previews)

- **The failure.** Per Codex, `ktx-offline-proof-r13-run02` passed the encoding, determinism, `ktx validate`, all-level transcode, geometry, JSON and sharing stages. It then failed at stage `previews`: the helper's PNG writer (`ktx-offline-proof-r13.py` line 89) raised `FileNotFoundError` on the first preview, because the script never created `<out>/previews`. This was a path-creation bug, not a Pillow or input problem. Run02, its `failure.json` and its log are preserved unchanged. A run that fails at previews writes no `result.json`, so no run has passed yet.
- **The fix.** One change in the script, just before the PNG step: `mkdir(<out>/previews)`, non-recursive. Inside the fresh `--out` that directory must not exist yet, so the call cannot reuse or overwrite anything.
- **Unchanged.**
  - The Python helper.
  - All gates, encodings, settings, inputs, the `ktx.exe`/`ktx.dll` pins and the r13b size rule.
  - The fresh, mandatory `--out`.
- **Next run.** `ktx-offline-proof-r13-run03`, as in the command above. Run02's encodes or results are not reused.
