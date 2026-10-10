# Lossless PNG → WebP proof r20 (output-only)

Publisher session 587a3bb5, 2026-10-10. Authored by Claude; nothing was run by Claude. Codex runs it into a fresh `lossless-png-proof-r20-run01` and reviews it.

**What this proof is:**
- an isolated image proof: lossless WebP encodings of the PNGs the applied adoption `20261010-r05-a02` actually serves, compared pixel for pixel with Pillow;
- written only under its own new `--out` folder.

**What it is not:**
- No GLB is rewritten, and no adoption, graph, schema, manifest, asset, public file, `src`, script or test is created or changed.
- r04, r05 and their records stay immutable.
- It does not overlap startup803's packed-LOD proof: no image sharing or multi-scene packing is tried here.

## Where it fits (GAME_IMPROVEMENT_PLAN.md 方針4)

The target stays **controls in the normal world within 5 s** of confirming, cold, at 10 Mbps. The provisional design budget is **4 MB of mandatory transfer, including title-side preloads**.

This proof measures one contribution to that budget: re-encoding PNG payload without changing a single decoded value. It is **not the startup fix**:
- The approved self startup body (≈5.41 MB) alone is over the budget.
- The cave model, murals, grounds and module graph need the whole dependency redesign that Runtime026 is planning.

The proof's bytes are image-payload deltas only. No startup time is claimed or extrapolated from them. Murals and the cave journey are kept exactly: the same pixels, never removed, blanked or replaced.

## Scope (fixed)

- **The ten cave images** a02 serves (`graph.textures`, owner `camp-cave`): the adopted 1024-edge candidates as served, not their originals.
- **The PNGs embedded in every served level** of snow-ground (model, lod1, lod2), camp-mountain (model-r15, lod-performance), meadow-ground and river-water. That is 7 GLBs.
- **Not in scope:**
  - every other model, the camp-cave GLB itself and actors;
  - embedded images that are not PNG. These are listed in the report as out of scope and are never re-encoded; WebP is never re-compressed.

## What the run checks before touching any image

1. `assets/runtime-adoption/20261010-r05-a02`: `journal.json` belongs to `plan.json` (SHA-256), says `applied`, and both name a02's graph.
2. The current `public/models/world-assets.json` and the asset.json of camp-cave and the four grounds name **only** a02. Every model record (and LOD) serves exactly the graph's url/SHA/bytes, and every cave image record serves the graph's candidate, size and provenance id.
3. Every served file is read inside `public/models` and matched to the graph by SHA-256 and length.
4. Each GLB passes the pipeline's strict container checks (`scripts/optimization/glb.mjs` `parseGlb` and `validateDocument` with meshopt allowed). Embedded images must sit in uncompressed views of the GLB buffer, so no meshopt decoding is needed.
   - Each image is sliced from its validated view.
   - Its declared mimeType must match its bytes.
   - Its slot and semantic come from `gltf-usage.mjs` `imageSemantics`. Ambiguous semantics stop the run.
5. Distinct image bytes are deduplicated **for the work only**. Every served occurrence stays in the report.

Any mismatch stops the run with an explicit error. Nothing is written outside the staging folder, which is removed on failure.

## Encoding and verification

**Worker.** `lossless-png-proof-r20.py`, run as `python -I`. It uses the installed Pillow, and nothing is downloaded or installed.

**Per distinct PNG:**
- **Input.** The SHA-256 and length are checked, and every chunk is walked: CRC, IHDR first, IEND last, nothing after it, no unknown critical chunk.
- **Refused explicitly:**
  - APNG;
  - 16-bit samples (lossless WebP is 8-bit, so they are never reduced);
  - an EXIF orientation other than 1;
  - an unusual Pillow mode;
  - a size that differs from the record.
- **Encoding.** `Image.save(format="WEBP", lossless=True, quality=100, method=6, exact=True)`. `exact` keeps the RGB of fully transparent pixels.
  - Palette and colour-key transparency expand exactly to RGB or RGBA; nothing is resampled.
  - The image is encoded **twice** in one process, and both encodes must be byte-identical.
  - Both runs' timings, SHA-256 and bytes are recorded.
- **Verification.** The WebP is decoded with Pillow.
  - **Pixels:** every RGBA value of every pixel (unpremultiplied, including transparent pixels' RGB) must equal the PNG's. The report records the pixel and transparent-pixel counts, the number of differing pixels and the maximum difference per channel.
  - **Size and orientation:** the size must match and there must be no orientation.
  - **Alpha:** alpha presence must be unchanged. An all-255 alpha channel that libwebp stores as opaque is noted; its RGBA values are still identical.
  - **ICC and EXIF:** both must survive byte for byte.
- **Independent check (Node).** The orchestrator re-reads every written WebP. It checks:
  - the SHA-256 and length;
  - a single lossless `VP8L` bitstream, with no lossy, alpha or animation chunks;
  - the size;
  - that the `ICCP`/`EXIF` chunks are present exactly when the PNG had iCCP/eXIf;
  - the alpha flag.

A failure in either check marks the image `rejected` and records the reason. Its encoding is kept as `<sha>.rejected.webp` for inspection, and the run ends `incomplete` with exit code 1.

## Metadata and colour

**Recorded from the chunks themselves:**
- IHDR (bit depth, colour type, interlace);
- the full chunk list;
- iCCP (profile name, size and SHA-256), sRGB intent, gAMA, cHRM, cICP and eXIf;
- tRNS, text keywords, pHYs and anything else.

**Carried and checked:**
- iCCP, as the WebP ICCP chunk (same profile bytes);
- eXIf, as the WebP EXIF chunk;
- PLTE/tRNS, as exact pixels.

**Never synthesised:** an sRGB profile is not invented, for example.

**Not carried, and listed per image (never silently):**
- sRGB, gAMA, cHRM, cICP, mDCV and cLLI, which have no WebP equivalent;
- informational chunks: text, pHYs, tIME, bKGD, sBIT, hIST and sPLT.

**Colour status per image:**
- `no-colour-metadata`: the PNG has no colour chunk. Pixel identity still needs the native decode check.
- `icc-carried-pending-native`: the profile is carried, but whether the game's decode path applies it identically to PNG and WebP is unverified.
- `not-accepted`: a colour chunk had to be left out, so a browser could map the PNG's colours differently from the WebP's. Such an image cannot claim exact appearance until it is reviewed natively.

## Output (`--out`)

- `images/<sha256>.png`: each distinct PNG, exactly as served or extracted, beside `images/<sha256>.webp` (or `.rejected.webp`).
- `report.json`:
  - the adoption record and manifest identities;
  - provenance: the git HEAD read from `.git`, Node, this script, the worker and this note, the imported helpers, and the Python executable, version, isolation, Pillow and libwebp versions;
  - per **served file**: URL, file, SHA-256 and bytes, and every image with its index, view, name, mimeType, treatment, material/slot uses (or manifest entry, colour space, wrap and uvSource for cave images), SHA-256, bytes and size, plus its image-payload saving;
  - per **distinct image**: references, both runs, verification, alpha, metadata, colour status and saving;
  - totals **per reference**: every served occurrence, which is what today's graph transfers, within-template duplicates included;
  - totals **deduplicated**: each image once.

  Negative savings are reported as they are.

## Run (Codex)

One line, from the repository root:

```sh
node output/optimization-audit-20261009/lossless-png-proof-r20.mjs --python C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe --out output/optimization-audit-20261009/lossless-png-proof-r20-run01
```

**Arguments and output:**
- `--python` is required: the existing cached Python with Pillow and WebP.
- `--out` must be a new folder directly inside `output/optimization-audit-20261009`. An existing folder is refused; a re-run needs a new name.
- No build or network is needed, and nothing is installed.
- The summary is printed as JSON.

**Exit codes:**
- 0: every distinct PNG verified.
- 1: any rejection (the report is still written) or any input error (nothing is written).

## Known limits

- **Pillow equality is evidence, not acceptance.** Nothing here is accepted. Before any candidate is chosen, Codex must check decoded RGBA equality in Chrome and WebKit along the game's own paths: GLB images through the embedded-GLB loader, and cave images through the verified cave-texture loader, both via `createImageBitmap`. This applies to PNG and WebP alike, and colour chunks may matter there.
- **Image payload only.** A real candidate would embed WebP through `EXT_texture_webp`, which changes the GLB's JSON, alignment padding and container, and it would be served under new URLs through the generator, verifier and adoption. File and transfer deltas must be measured on such a candidate, not taken from these numbers.
- **Interaction with packing.** These figures overlap startup803's packing proof: per-reference savings include duplicates that packing would remove. The two must not be added.
- **No startup time is claimed.** The bytes do not show time to controls, which also depends on decode (WebP lossless decodes differently from PNG), GPU upload and the whole mandatory set.
- **Determinism is proven within one encoder build:** two encodes in one process. Another Pillow or libwebp may produce other bytes, so its versions are recorded.
- **Sample depth.** 16-bit PNGs are refused, never reduced; lossless WebP stores 8-bit samples.
- **Cave murals** are measured as the adopted 1024-edge candidates. Their UV normalisation (`uvSource`) and sizes are unchanged by any WebP re-encode, but any adoption still needs the cave tests that assert PNG signatures to be updated deliberately.
