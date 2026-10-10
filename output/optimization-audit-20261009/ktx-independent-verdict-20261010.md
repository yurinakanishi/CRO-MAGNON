# KTX2 candidates: native quality, transfer and allocation evidence

Codex independent review, 2026-10-10. **No KTX candidate is adopted.** Current game assets remain the verified r05 chain, `20261010-r05-a02`. GPU-byte savings alone are insufficient acceptance evidence.

## Provenance and scope

Three opaque camp props only: hide-tent, stone-firepit and valley-boulder, each with its existing LOD. The r13/r18 proofs start from SHA-recorded original GLBs, keep all geometry and material semantics, and derive their own semantic mip chains. They do not encode from previously compressed candidates. The original top-level pixels, resized reference, numeric error measurements and served r04 image sizes remain distinct.

Offline tools are the locally extracted official KTX4.4.2 release. Both executable and DLL are SHA-pinned before every invocation; no cloud/API or paid service. UASTC uses quality3, Zstd18, noRDO, one thread. Each encoding is run twice and required byte-identical. Colour uses sRGB/BT.709; normal/data uses linear/unspecified primaries. All mip levels are decoded using the installed Three transcoder. These steps passed12 structural gates for7 unique input images. Numeric error metrics are measurements, not quality thresholds.

- `ktx-offline-proof-r13-run03/result.json`: SHA `35572c880856e960e1648fd630abfb2d774510a8f43d6f059bb86aca239f5431`. At most1024px, two variants: ETC1S colour with UASTC maps, and all-UASTC.
- `ktx-offline-proof-r18-run01/result.json`: SHA `0ddac5b8082b3f2691b20a7990d00693ea33d21354afab781e94dfdfd46476d2`. At most512px, UASTC only. The r04 size gate remains1024 independently of experimental512 delivery. This is not a global512px policy.

## Native checks

Independent QA uses the installed Three GLTFLoader/KTX2Loader directly, without importing the encoder or the product loader. Every input is verified by browser SHA/length before parsing. Exact decoded geometry/index/transform equality, texture colour/sampler/orientation semantics, complete compressed mip chains, and real native texture handles are checked. No uncompressed fallback is accepted.

- r13: Chrome `ktx-native-chrome-r02`, Windows WebKit `ktx-native-webkit-r01`, six full/LOD cases each, errors0.
- r18: Chrome and Windows WebKit `ktx-r18-*-dpr1-r01`, six cases each, errors0. Chrome `ktx-r18-chrome-dpr3-r01`, three full-model cases with a960px draw buffer per320CSSpx panel, errors0.
- After rendering, every actual asset GL handle is observed alive, then deleted while the context stays live. Four Three1x1 placeholder textures (36B total) and a16x16 DFG lookup (1024B) are separately identified. Closing the isolated browser context releases those internals. This standalone result does not prove the unimplemented product KTX lifecycle.

Both encodings choose **BC7** on this Windows host, including the ETC1S source. This was measured, not inferred from encoder names. Neither ASTC nor ETC hardware path is tested. Windows WebKit is not iPhone Safari.

## Transfer cost and measured texture allocation

Total transfer for these six distinct GLBs:

| Delivery | Bytes | Difference from actual r05 |
|---|---:|---:|
| Current adopted r05 |4,869,588|0|
| r13 UASTC1024 |14,111,764|+9,242,176|
| r18 UASTC512 |5,622,936|+753,348|

The older r04 six-file baseline is5,721,212B. Thus r18 saves98,276B against obsolete r04 but **increases transfer by15.5% against current r05**. The latter is the relevant adoption comparison. r13 ETC1S-colour files total8,512,512B and also increase transfer.

Actual native internal-format texture allocation including mipmaps, per full model, identical on both tested engines:

| Full model | r05 RGBA | UASTC1024→BC7 | UASTC512→BC7 |
|---|---:|---:|---:|
| hide-tent |8,388,604|4,194,384|1,048,656|
| stone-firepit |6,990,504|2,796,256|699,104|
| valley-boulder |6,990,504|2,796,256|699,104|

One-map LODs are5,592,404 /1,398,128 /349,552B. **Do not sum these per-file GPU values into a game total:** each QA case has a fresh context while the game shares images within a template. No driver padding, framebuffer, geometry or renderbuffer is counted. Detail is in `ktx-native-payload-r01.json` and `ktx-native-payload-r18.json`.

## Visual decision

**ETC1S colour is rejected for these candidates.** Codex opened all18 r13 Chrome sheets (full/LOD, day/fire/far, four angles), and the three full-model daytime WebKit sheets. The ETC1S column introduces visible green/purple blotches on nominally grey stone and changes some cloth tones. UASTC1024 is closer to the reference, but its transfer increase prevents adoption as a general solution.

**All-maps512 r18 is not accepted.** Codex opened:

- All three high-DPI full-model daylight near comparisons and all three firelight near comparisons (angle0).
- Three full-model distant Chrome sheets, four angles each.
- Three full-model daylight WebKit sheets, four angles each.

The tent's wood/hide grain and stone surfaces lose close detail in the512 column, especially at high DPI; some stone shading becomes visibly coarse. Distant views are closer but do not establish near-quality preservation. Geometry and silhouettes remain exact. Combined with the measured transfer increase, this is insufficient for adoption. The remaining generated LOD/other-angle/high-DPI sheets have not all been manually reviewed; no blanket visual pass is claimed. Dark firelight sides are inconclusive for fine detail and were complemented by daylight views.

The r05 reference versus1024-versus512 labels and hashes are embedded in every new QA report. These comparisons use the **current** served r05 GLBs. The game currently rejects KHR_texture_basisu; no KTX runtime integration, packed profile, device performance or context-restoration claim follows from the standalone tests.

Next work prioritizes pixel-preserving PNG compression and within-template LOD image sharing. Preserve these rejected experiments as evidence. A different KTX candidate needs a new revision and new quality/transfer/native review; never relax the gate just to meet the GPU arithmetic.
