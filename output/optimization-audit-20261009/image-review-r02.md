# Independent image review — 2026-10-09 14:50 JST

Candidate revision `assets/optimized-runtime/20261009-r02` remains **unadopted**. This record accepts only the specified comparison views; it does not accept startup actors or the whole optimization.

## Full compressed GLBs

All64 source/full-candidate comparisons in `asset-review-sheets-r02/sheet-01.png` through `sheet-16.png` were opened and reviewed. These show four directions (0/90/180/270 degrees), original/candidate pairs cropped from the actual Chrome screenshots at50% scale. No visible new silhouette, color, material or UV mismatch was found in these views. Close original/full-candidate heads were also reviewed for the seven player models. The earlier numeric check covers all64 models,180 animation clips at five sample times in Chrome and WebKit, not every animation frame. This is not yet a runtime LOD/material upgrade or five-player acceptance.

Because the four-direction terrain views were too edge-on, eight assets (meadow, river water, snow, ice, desert, volcanic ground, castle, camp mountain) were additionally rendered with elevated cameras. Both `terrain-review-sheets-top-r02` images were reviewed; surfaces and colors match at this scale. These screenshots show the underlying assets without every game shader.

## Startup actors rejected

All seven startup head comparisons show visibly degraded shape/face detail. In particular cro-magnon-woman and both Neanderthals are shredded into angular facets; cat-kunoichi, fennec and ape also have unacceptable face damage at gallery distance. The full original/compressed candidates preserve their faces. Do not accept startup candidates because the independently reconstructed old-LOD reference is numerically identical.

`startup-original-lod-diagnostic-r03` fixed the earlier clipped fifth column. Cro-magnon-woman and Neanderthal-hunter original LOD geometry with its own white placeholder material also shows fragmented faceting. Therefore the issue is not established as only texture binding/normal-map convention. Claude assets r06 must preserve valid head geometry and correct per-primitive provenance; r02 remains failed evidence.

## Standalone cave images accepted for tested views

`qa-cave-candidate-images.mjs` substitutes only the ten independently SHA/length-checked derived PNG responses into the frozen context-r01 runtime. The actual camp-cave GLB, mural shader/source UV sizes, gallery light and stone shader remain unchanged. Cameras are deliberate fixtures, actor hidden, no walking-performance claim.

`cave-candidate-images-r04-chrome` and `-webkit` each captured60 pictures: original and candidate at near/far/grazing views for ten distinct mural motifs. All ten image URLs were exercised in each variant, including limestone in every view; console/page errors0. The five paired review sheets for **each engine** were all opened and inspected. Source and candidate preserve motif/character placement, outline, transparency, stone pattern and repeated texture appearance; near pigment detail becomes slightly softer, as expected at1024px. No newly visible halo, neighboring motif bleed or stone repetition seam was found in these views. Rimo near original/candidate and corrected grazing PNGs were also viewed at full size. This does not verify physical Safari, arbitrary magnification or all possible mip angles.

The first r02 cave attempt timed out because QA omitted character selection. r03 captured pictures but a straight grazing-camera offset left the curved cave; it is not valid grazing evidence. r04 casts against the actual cave wall at the new depth and checks the eye-to-target ray for obstruction, keeping the camera inside; those are the reviewed images.

Do not blanket-adopt the r02 index: startup faces are rejected, runtime integrity/decoder/mapping/shared-image lifetime is not implemented yet, and final mobile/performance/lifecycle verification remains.
