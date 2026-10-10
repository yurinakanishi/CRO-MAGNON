# Lossless PNG transport proof r21 (output-only)

Publisher session 587a3bb5, 2026-10-10. Authored by Claude and not run by Claude. Codex runs it, reviews it and repeats the native tests.

**What this proof is:**
- the same PNGs with a smaller zlib stream, written only under its own new `--out`;
- a bounded contribution to the GAME_IMPROVEMENT_PLAN.md 方針4 goal (controls in the normal world within 5 s; 4 MB provisional mandatory transfer, including title preloads), **not the startup fix**. It claims no startup time.

**What it does not touch:**
- no GLB, URL, manifest, adoption, asset, public file, `src`, script or test, and nothing is installed;
- r04, r05/a02, r20 and its run01 report and copies stay as they are;
- Runtime026's startup design and startup803's packing proof are not overlapped.

## Decoder paths: correction to r20

The r20 note says the game decodes both image kinds through `createImageBitmap`. That is wrong for the cave images, and this note supersedes that sentence. The r20 files themselves are executed evidence and stay unchanged.

- **Cave images:** `src/verified-texture.ts` loads them through `THREE.ImageLoader`, i.e. an **HTMLImageElement**.
- **GLB-embedded images:** `embedded-glb.ts parseEmbeddedGLB` normally loads them through `THREE.ImageBitmapLoader`, i.e. **createImageBitmap**.

**r20's WebP candidates in the native tests** (Codex, r03; `output/playwright/optimization-20261009/lossless-r20-{chrome,webkit}-r03/result.json`). These used synthetic test-only GLBs and compared full Canvas2D RGBA and a Three WebGLRenderer RGBA8 sRGB target at native size.
- **GLB ImageBitmap path:** RGBA and GPU matched all 14 images in Chrome and WebKit.
- **Chrome ImageLoader:** Canvas RGBA differed for 12, including all 9 alpha murals, but the GPU matched all 14.
- **WebKit ImageLoader:** Canvas matched all 14, but the GPU differed for each of the 9 alpha murals (144–1140 pixels, max channel difference 2–6).
- **Matched on the current GPU path in both engines:** the opaque limestone and the 4 ground images.
- **WebKit `equalGpuCurrentPaths` is false.** The r20 WebP candidates are not a universal pass.

**Why r21 keeps PNG.** A WebP changes the container, the decoder and, for the murals, the alpha path. r21 changes only the compressed bytes inside IDAT:
- the decompressed filtered scanlines are identical;
- IHDR, palette, transparency, colour chunks and every other chunk are identical byte for byte.

Each image stays on its current decoder, colour and alpha path. Identical decoded output is the expected result, **but it is not assumed**. Codex repeats the native Canvas and GPU tests on both paths, in both engines.

## Scope and inputs

**The set.** Exactly the 14 distinct PNGs r20 proved: 20 served occurrences in 17 served files of `20261010-r05-a02`. That is the ten cave images, plus the PNGs embedded in snow-ground (three levels), camp-mountain (two), meadow-ground and river-water.

The run re-derives this set from the **actual** graph before touching any image, as r20 did:
- a02's journal is applied and belongs to its plan;
- the current manifests name only a02 and serve exactly its files and cave image records;
- every served file matches its SHA-256 and length;
- GLB images are sliced from validated, uncompressed views.

**Comparison with r20.** The derived set is then compared field by field with r20's **SHA-pinned** run01 report (`48dfbe38…`):
- the same a02 plan and journal hashes;
- the same served files, images, SHAs and sizes;
- the counts 17 / 20 / 14, also hard-checked.

Every copy r20 kept is re-read and must match its recorded SHA-256 and length and the bytes served now. Manifests that changed since r20 are listed, not ignored. The r20 native results are recorded by hash and headline flags only.

## Per PNG

**1. Strict structure.** The parser checks:
- the signature;
- every chunk's CRC and type (letters, reserved bit);
- IHDR first and once (13 bytes, valid depth/colour type, compression/filter 0, interlace 0/1);
- IEND last and empty, with nothing after it;
- PLTE rules;
- one or more **contiguous** IDATs;
- the multiplicity and position of every registered ancillary chunk (sRGB, gAMA, cHRM, iCCP, sBIT, cICP, tRNS, bKGD, pHYs, eXIf, oFFs, tIME, text, …).

**Refused:** APNG, unknown critical chunks, and unknown **unsafe-to-copy** ancillary chunks, which may depend on the image data (e.g. a `dSIG` signature). A refusal keeps the original and records the reason.

**2. Exact stream.** The zlib header must be deflate with no preset dictionary. The concatenated IDAT payload must inflate to **exactly** the size IHDR implies, including Adam7 passes and bounded at 512 MiB, with **no bytes after the zlib stream**. Every scanline must have filter type 0–4; the counts are recorded.

**3. Recompression.**
- Node's bundled zlib, `deflateSync`: level 9, windowBits 15, strategies DEFAULT, FILTERED, RLE and FIXED, memLevel 9 and 8. That is 8 attempts.
- Each attempt is encoded **twice** and must be byte-identical. It must also inflate back to the identical scanline stream.
- Every attempt's size, timings and hashes are recorded. The smallest usable one is selected.
- Filters are never changed: they are part of the preserved stream.

**4. Rebuild.**
- The PNG signature, then every non-IDAT chunk copied **byte for byte (length, type, data, CRC) in its original order**, with one new IDAT (valid CRC) in place of the IDAT run.
- The rebuild is done twice and must be identical. It is then re-parsed from its own bytes. The report states each check as a boolean:
  - IHDR identical;
  - non-IDAT chunks identical before and after the IDAT run;
  - stream identical.

  For example, snow-ground's sRGB, gAMA, cHRM, eXIf, oFFs and pHYs stay exactly as they are.

**5. Selection.** The candidate is kept only if it is **strictly smaller** and the Pillow check agrees. Otherwise the original bytes are retained, and both sizes are reported.

**6. Pillow check** (`lossless-png-safe-r21.py`, `python -I`, read-only). It decodes original and candidate and compares:
- size, mode, palette, and samples in their own mode;
- RGBA values: every pixel, including the RGB of transparent pixels;
- alpha extrema and transparent count;
- every Pillow `info` field (gamma, chromaticity, sRGB, ICC, EXIF, transparency, dpi, text).

Any difference rejects the candidate, and the original is retained.

## Output (`--out`)

- `images/<sha>.png`: each original, exactly as served.
- `images/<sha>.r21.png`: the candidate, only when smaller and written.
- `report.json`:
  - decoders, adoption record, current manifests;
  - r20 evidence: report hash, counts, manifests changed since r20, native result flags;
  - provenance: git HEAD read from `.git`; Node and zlib versions; this script, worker and note; helpers; Python, Pillow;
  - per **served file**: images, statuses and image-payload bytes;
  - per **distinct image**:
    - chunk list with each non-IDAT chunk's SHA-256;
    - IDAT counts and sizes, raw stream SHA, filter counts and inflate time;
    - every attempt and the selection;
    - identity booleans and the Pillow result;
    - r20's WebP size, for reference only;
  - totals per occurrence and deduplicated, labelled **not additive** with r20 or startup803.

Writes are exclusive (`wx`). The run is staged in `.<out>.staging-<pid>` beside `--out` and renamed into place only when complete. The rename retries briefly on Windows `EPERM`/`EBUSY`/`EACCES`. On failure only that staging folder is removed, with retries; nothing else is touched.

## Run (Codex)

One line, from the repository root:

```sh
node output/optimization-audit-20261009/lossless-png-safe-r21.mjs --python C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe --out output/optimization-audit-20261009/lossless-png-safe-r21-run01
```

**Arguments:**
- Both flags are required.
- `--out` must be a **new** folder directly inside `output/optimization-audit-20261009`; an existing one is refused.
- No build or network is needed.

**Exit codes:**
- 0: every image ends `candidate` or `original-retained`.
- 1: any `rejected-original-retained` (the report is still written) or any input error (nothing is written).

## Known limits

- **Not acceptance.** Stream identity and Pillow equality are evidence. Native Chrome/WebKit Canvas and GPU equality on **both** game paths must be repeated by Codex for every candidate: ImageLoader for cave images, ImageBitmapLoader for GLB images.
- **Image payload only.** No GLB or URL is rewritten. A real candidate needs new GLB and image files through the generator, verifier and adoption, measured as files and transfer. GLB padding and the meshopt container change the file delta.
- **Not additive.** r20 is an alternative encoding of the same images, and startup803 packing removes duplicate occurrences that the per-occurrence totals still count.
- **No startup time is claimed.** Inflate cost differs per stream, and the 5 s / 4 MB goal needs the whole mandatory set redesigned. The self startup body alone exceeds 4 MB.
- **Determinism** is proven within one Node zlib build (its version is recorded).
- **A bounded search:** zlib level 9 only, the listed strategies and memory levels, and filters preserved. Other deflate encoders or re-filtering could find smaller streams. The latter would change the scanline bytes, so it is outside this proof.
