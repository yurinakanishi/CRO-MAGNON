# r06 exact repack candidate acceptance — 2026-10-10

Codex accepts the four scoped static-model repacks and eight rewritten standalone cave PNGs in `assets/optimized-runtime/20261010-r06` for a controlled local chained-adoption plan on `20261010-r05-a02`. This is candidate acceptance only. Adoption, three actual profile packages and integrated native gameplay/cache/performance remain separate gates. No publication, distribution or existing server replacement is authorized here.

## Exact inputs

- Base plan SHA256 `2697ba7246fc06f764989ede94a58cb4f8324765befc6fae0db11ed6430ce444`.
- r06 manifest SHA256 `e73b6a6993b11869da76529a7ab1d5ef32f63ecc33ca5e2bba66e911e65c1a7c`.
- r06 runtime-index SHA256 `628b50cbc206749d6a39526a9722bec7f2d78b7efce27949aa0c646498def79c`.
- r06 verification SHA256 `121341ee475ca2b235727cc1e32ec0432c10a29c9ee75b198044dff31df1f8df`, status passed; kept immutable. Its pending visual gate is resolved by this document for this scope only.

## Scope and preservation

Snow-ground has three scenes and camp-mountain two scenes in one GLB per template, sharing unchanged PNG pixels. Meadow-ground and river-water remain single-scene GLBs. PNG processing rewrites IDAT compression only when strictly smaller; filtered scanlines, all non-IDAT chunk bytes/order, colour metadata, dimensions and RGBA (including hidden RGB at alpha zero) are exact. No KTX or WebP substitution, image resizing, geometry simplification, animation or new visible model is introduced. Full-scene transforms, attributes, materials, texture state and meshopt-decoded geometry are independently checked by the canonical verifier.

The seven approved initial characters, 39,825-triangle violet-behemoth sole primary and rejected LOD decisions remain inherited unchanged. Camp-cave geometry and all unrelated models remain unchanged. Two standalone images are retained byte for byte; only eight get new content-addressed names. Original GLBs/images, all existing derivative files, immutable r04/r05 candidates and adoption records must remain intact.

The scoped physical delivery changes from 17 files / 25,859,733 bytes to 14 files / 16,588,076 bytes, saving exactly 9,271,657 bytes. This combines PNG and LOD sharing once, without summing overlapping raw proofs. It is stored-body saving, not a measured startup transfer, memory, GPU or FPS improvement.

## Independent actual-candidate evidence

- `exact-r06-independent-r01/pillow-result.json`: independent extraction from actual r06 bytes, input/output SHA checks, PNG CRC and non-IDAT comparison, zlib filtered scanline equality, Pillow exact RGBA/dimensions/metadata for all 14 unique images.
- `output/playwright/optimization-20261009/repack-r06-png-chrome-r01` and `repack-r06-png-webkit-r01`: all 14 actual old/new PNG byte pairs, both real game decoding paths (ImageLoader and GLTFLoader/ImageBitmap in synthetic QA-only GLBs), Canvas and GPU pixel differences zero, expected disposal successful, browser errors zero. The retained images are explicitly identified. Synthetic triangles are test fixtures and never game assets.
- `output/playwright/optimization-20261009/repack-r06-models-chrome-r01` and `repack-r06-models-webkit-r01`: actual r06 GLBs through production WorldAssets, four templates / seven levels at 0, 90, 180 and 270 degrees. Every source/candidate framebuffer comparison is exact. One physical parse/progress entry for each packed file, repeated native context loss/restoration, eviction/reload and late disposal passed. No browser errors. Frozen harnesses identify the executed code; provenance ties the frozen runtime to its sources.
- Codex opened the four primary Chrome comparison sheets and all three additional WebKit LOD sheets (all seven levels), and all eight changed standalone PNG sheets in WebKit. Shapes, UV positions, colours, faces and transparent mural outlines match the prior accepted r05 appearance. Existing terrain patterning is unchanged; this is a preservation acceptance, not a redesign claim.

## Remaining integration gates and limits

Review the exact complete graph, manifest changes, copy list, lineage and protected-file snapshot before apply. Require the packed runtime-model identity helper to preserve original geometry proofs. After apply run relevant real-manifest checks and actual local/exhibition/MMO package validation, then native lifecycle/cache/gameplay and comparable performance measurements. The four-model isolated native tests are not full-game or physical-phone evidence.

GPU texture allocation is expected unchanged for a pixel-exact repack. Prior CPU4 results around 27–30 fps, p95 up to 54 ms and GPU payload around 316–398 MB remain unresolved. The latest title-shell identity-transport test showed visible title around 1.6 s, setup-ready around 16 s and confirmation-to-controls around 55 s; it did not achieve the 5-second/4 MB startup goal. Production gzip transport and the combined r06 outcome still need measurement.
