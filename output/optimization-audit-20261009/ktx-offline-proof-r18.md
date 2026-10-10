# KTX2 offline experiment r18: UASTC with every map at most 512 (three opaque camp props)

Runtime session 026f16c0-538a-4645-99e9-a78a97eaa58f, 2026-10-10.

**Authored, not run.** No result, size, timing or visual outcome of r18 is claimed. Codex runs it into a fresh `ktx-offline-proof-r18-run01` and inspects it.

This is an experiment. It is not an adoption, not a runtime implementation and not a texture policy.

- **What I edited.** I own only:
  - `ktx-offline-proof-r18.mjs`, Codex's unchanged copy of the archived r13 run03 script (`ktx-proof-r13-source/`), now modified;
  - this note.
- **Reused unchanged:** the r13 Pillow helper `ktx-offline-proof-r13.py`.
- **Not touched:** r13's script, helper, note and run artifacts, and every product, script, test, asset and adoption record.

## Why r18 exists

1. **r13 quality (native, Codex).**
   - r13 run03 passed all 12 structural gates: 7 source images, 6 GLBs, 2 variants.
   - Native Chrome r02 and WebKit r01 both passed loading, geometry, texture semantics, compressed upload and native handle deletion for all 6 files, with 0 errors.
   - On the day/fire comparison sheets, the **ETC1S colour variant shows visible green/purple blotches** on the nominally grey stone-firepit and valley-boulder. **UASTC looks closer to r04.**
   - ETC1S colour is therefore rejected for these props on this host. GPU-byte maths is not visual acceptance.
   - The corrected disposal check counts actual owned GL handles (`gl.isTexture` while the context is live), all released. Three's 4 placeholder textures and its DFG texture are not model leaks. This standalone QA makes no product lifecycle claim.
2. **Transfer trade-off (Codex's measured bytes, 6 files).**

   | | Bytes |
   | --- | ---: |
   | r04 files (lossy WebP) | 5,721,212 |
   | r13 ETC1S-colour variant | 8,512,512 |
   | r13 UASTC variant (1024) | 14,111,764 |

   UASTC at 1024 is about 2.5× the r04 transfer. Given the startup goal (63 s to controls at 10 Mbps is already too slow), an all-UASTC-1024 delivery cannot be adopted blindly.
3. **The next bounded question.** The same three opaque props, UASTC only, with every map at most 512. How much transfer does that save, and how does it look against r05 and the 1024 variants?

## What changed from r13 (narrow)

- **Identity.**
  - Script path, usage, schema `cro-magnon/ktx-offline-proof@r18` and purpose now name r18.
  - `result.json` records the r18 script identity, the archived r13 script identity it derives from, and the unchanged helper.
- **One variant.**
  - Only `color-uastc`. Colour, normal and data are all UASTC LDR 4×4, quality 3, no RDO, Zstd 18, single-threaded, each encoded twice and required to be identical.
  - The ETC1S encoding was removed from the script.
- **Two caps, kept apart, computed per image from the original** (`cappedSize`, an exact power-of-two reduction with the aspect preserved):
  - **r04 size** = min(original, 1024). It must equal the size of the image the r04 counterpart actually serves; that is the former r13 check, now computed on its own.
  - **Delivered size** = min(original, 512), never above the r04 size.
  - `result.json` records the original, r04 and delivered sizes separately: per image (`original`, `r04` with `expected`, `output`), per source (`original`, `r04Size`, `output`) and per file (`originalMaximumTextureEdge`, `r04MaximumTextureEdge`, `maximumTextureEdge`).
  - The source chain marks the level at the r04 size (`atR04Size`).
- **Mip chain.**
  - Still built from the full-resolution decoded original, which is retained in `work/sources`. The semantic filtering is unchanged: colour in linear light, renormalised XYZ normal box, per-channel data box.
  - Delivered level 0 is that chain's 512 level, or the exact decoded source if the original is at most 512. Levels below it descend to 1×1.
  - Numeric errors are measured against that derived 512 reference, never against high-resolution, r04, r05 or r13 pixels.
- **Never an input:** r13 KTX2 output, served r04 WebP and r05 images.
- **Unchanged.**
  - The keys (hide-tent, stone-firepit, valley-boulder; no actors, alpha foliage or cave).
  - The immutable r04-a01 base and before/ checks, the original and r04 counterpart SHA/length checks.
  - The `ktx.exe`/`ktx.dll` pins.
  - The colour-space rule: sRGB+BT.709 for colour, linear+unspecified for maps.
  - The KTX2 structure, all-level transcode, alpha, orientation, GLB JSON, geometry and full/LOD sharing gates.
  - The fresh, mandatory `--out` and the creation of the previews folder.
  - The script does not read the r05 graph.

## Command (Codex)

```
node output/optimization-audit-20261009/ktx-offline-proof-r18.mjs ^
  --out output/optimization-audit-20261009/ktx-offline-proof-r18-run01 ^
  --python C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe
```

## Unknowns

- **Transfer.** The r18 file sizes and their saving against r04, r05 and r13 UASTC are not yet known.
- **Visual quality.**
  - It is unknown whether 512 colour, normal and data maps look acceptable on these props up close, under daylight and firelight, and at DPR 3. Native QA is to compare current r05, r13 UASTC 1024 and r18 UASTC 512.
  - The 512 top level is this experiment's own box reduction, not r04's or r05's Pillow pixels.
- **Before any decision.** GPU memory, transcode or upload time, browser format choice beyond this host (BC on Windows; no ASTC/ETC here), phone behaviour and startup timing all need their own measurements.
- **Scope of the result.** Even a good result is evidence for these three opaque props only. Max 512 is not a policy, and nothing here is adopted or loadable by the runtime, which still refuses `KHR_texture_basisu`.
