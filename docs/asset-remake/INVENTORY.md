# 全3Dアセット一覧と旧→新対応表（自動生成）

生成: 2026-10-07T02:11:15.941Z — `node scripts/remake/build-tracker.mjs`。進捗の正本は `assets/asset-remake/status.json`、詳細は `assets/asset-remake/tracker.json`。

利用中GLB 70件（flint-spearはレビュー画面のみ）＋コード生成の代用品2件。

## player-character（9）

| key | 現行GLB | 三角形 | クリップ | 依存データ | 進捗 | 新GLB | 検証 |
|---|---|---:|---|---|---|---|---|
| cro-magnon-woman | model-c2.glb | 67133 | 10 |  | integrated-in-branch | model-c2.glb | 67,133 tris; posed deviation 0 m; clip curves within 0.14 deg; face close-up compare (cro: .../graft/face-compare3.jpg, neanderthal: output/asset-remake/guests/neanderthal-woman/face-compare.jpg); delivered heights kept |
| cro-magnon-hunter | model-c2.glb | 50561 | 10 |  | integrated-in-branch | model-c2.glb | 87 character tests pass; pose sheet output/asset-remake/motion/cro-magnon-hunter/clips-sheet.jpg; head close-ups .../graft/merged-r12-head.jpg; game QA before/after output/asset-remake/game/compare-cro-male.jpg, 5 players, 0 errors Head re-baked on xatlas charts (merged-r13: sharper beard/lips, less orange skin) and body normal map repaired; rig r02 + spear/downed/locomotion rebuilt. |
| neanderthal-woman | model-c2.glb | 66179 | 10 |  | integrated-in-branch | model-c2.glb | 66,179 tris; posed deviation 0 m; clip curves within 0.14 deg; face close-up compare (cro: .../graft/face-compare3.jpg, neanderthal: output/asset-remake/guests/neanderthal-woman/face-compare.jpg); delivered heights kept |
| neanderthal-hunter | model-c2.glb | 53176 | 10 |  | integrated-in-branch | model-c2.glb | 53,176 tris (LOD 10,635); head graft r01-r03 kept (r01 blocky body beard, r02 clipped collar + white plinth, r03 adopted): output/asset-remake/compare/neanderthal-hunter/head-r0*.jpg; clip poses c2-clips-sheet.jpg; 37 character/human/downed/spear tests pass. In game: one of five synced players at camp (output/asset-remake/game/final-r1/players-front.png). |
| cat-kunoichi | model-c2.glb | 52420 | 10 |  | integrated-in-branch | model-c2.glb | 52,420 tris (LOD 10,484); neck seam iterations r02-r11 kept (output/asset-remake/compare/cat-kunoichi/neck-r0*.jpg); clips and head before/after c2-sheet.jpg; 42 character/human/downed/fantasy/katana tests pass. Known: a small dark notch at the throat front in close-up. In game: one of five synced players at camp holding the katana (output/asset-remake/game/final-r1/players-front.png). |
| desert-fennec-mage | model-c2.glb | 53151 | 10 |  | integrated-in-branch | model-c2.glb | posed deviation 0 m vs delivered skin (kept vertices are a subset); clip curves within 0.05-0.2 deg; render compare output/asset-remake/guests/desert-fennec-mage/compare-views.jpg |
| giant-ape | model-c2.glb | 58216 | 13 |  | integrated-in-branch | model-c2.glb | posed deviation 0 m vs delivered skin (kept vertices are a subset); clip curves within 0.05-0.2 deg; render compare output/asset-remake/guests/giant-ape/compare-views.jpg |
| howkey-scientist | model-c2.glb | 49079 | 10 |  | integrated-in-branch | model-c2.glb | posed deviation 0 m vs delivered skin (kept vertices are a subset); clip curves within 0.05-0.2 deg; render compare output/asset-remake/guests/howkey-scientist/compare-views.jpg |
| maruimo-octopus | model-c2.glb | 58030 | 13 |  | integrated-in-branch | model-c2.glb | posed deviation 0 m vs delivered skin (kept vertices are a subset); clip curves within 0.05-0.2 deg; render compare output/asset-remake/guests/maruimo-octopus/compare-views.jpg |

## animal（1）

| key | 現行GLB | 三角形 | クリップ | 依存データ | 進捗 | 新GLB | 検証 |
|---|---|---:|---|---|---|---|---|
| woolly-mammoth | model-c2.glb | 39982 | 5 | shared/model-bounds.mts | integrated-in-branch | model-c2.glb | seed 7 dense (seed 42 rejected: twin tails); rig r05 pose sheets; game QA: R mount, W/Shift ride 6.6-7.7 m, F hunt -> Death -> meat, 0 errors; riding/hunting/motion tests pass (pre-existing failures unchanged) 2026-10-07 later: normal map repaired (back-face hits from overlapping layers flipped, z>=0.25; scripts/remake/repair_normal_maps.py), other bytes unchanged. Gameplay body radius pinned to the C1 value in shared/animals.mts (MAMMOTH_BODY_RADIUS) so the hit size is unchanged by the wider remade fur. |

## enemy（3）

| key | 現行GLB | 三角形 | クリップ | 依存データ | 進捗 | 新GLB | 検証 |
|---|---|---:|---|---|---|---|---|
| crow-shaman | model-c2.glb | 33548 | 6 |  | integrated-in-branch | model-c2.glb | 33,548 tris (LOD 10,064 @28 m); bake misses 2,472/1,504,543; unweighted 0; renders output/asset-remake/compare/crow-shaman/sheet-t01.jpg; tests/enemies.test.mjs 21/21. TRELLIS 0738 (new-reference crow) kept queued only for comparison. In game (output/asset-remake/game/final-r1): every rank loads with its props on the right bones, 0 page errors. |
| violet-behemoth | model-c2.glb | 39825 | 14 |  | integrated-in-branch | model-c2.glb | posed deviation 0 m vs delivered skin (kept vertices are a subset); clip curves within 0.05-0.2 deg; render compare output/asset-remake/guests/violet-behemoth/compare-views.jpg |
| sabertooth-tiger | model-c2.glb | 38535 | 11 |  | integrated-in-branch | model-c2.glb | 16 sabertooth tests pass; pose sheets output/asset-remake/motion/sabertooth-tiger/sheet-r06-*.jpg; head close-up cmp-head-zoom3.jpg; Death min z 0.001 m (r13 0.10 m). qa-sabertooth.mjs: all behaviour checks pass but the final "Alert rendered" sample fails under GPU load - the unchanged baseline fails identically now; rerun when the TRELLIS queue is idle. r07: bake on welded xatlas seams, same 48-degree crease as the rig. |

## companion（14）

| key | 現行GLB | 三角形 | クリップ | 依存データ | 進捗 | 新GLB | 検証 |
|---|---|---:|---|---|---|---|---|
| yellow-524-mascot | model-c2.glb | 24997 | 1 | tests/companion-524.test.mjs | integrated-in-branch | model-c2.glb | posed deviation 0 m vs delivered skin (kept vertices are a subset); clip curves within 0.05-0.2 deg; render compare output/asset-remake/guests/yellow-524-mascot/compare-views.jpg |
| rimo-neko | model-c2.glb | 27474 | 7 |  | integrated-in-branch | model-c2.glb | posed deviation 0 m vs delivered skin (kept vertices are a subset); clip curves within 0.05-0.2 deg; render compare output/asset-remake/guests/rimo-neko/compare-views.jpg |
| orb-bot-white | model-c2.glb | 4000 | 7 |  | integrated-in-branch | model-c2.glb | posed deviation 0 m vs delivered skin (kept vertices are a subset); clip curves within 0.05-0.2 deg; render compare output/asset-remake/guests/orb-bot-white/compare-views.jpg |
| orb-bot-blue | model-c2.glb | 4000 | 7 |  | integrated-in-branch | model-c2.glb | posed deviation 0 m vs delivered skin (kept vertices are a subset); clip curves within 0.05-0.2 deg; render compare output/asset-remake/guests/orb-bot-blue/compare-views.jpg |
| orb-bot-green | model-c2.glb | 4000 | 7 |  | integrated-in-branch | model-c2.glb | posed deviation 0 m vs delivered skin (kept vertices are a subset); clip curves within 0.05-0.2 deg; render compare output/asset-remake/guests/orb-bot-green/compare-views.jpg |
| orb-bot-purple | model-c2.glb | 4000 | 7 |  | integrated-in-branch | model-c2.glb | posed deviation 0 m vs delivered skin (kept vertices are a subset); clip curves within 0.05-0.2 deg; render compare output/asset-remake/guests/orb-bot-purple/compare-views.jpg |
| orb-bot-orange | model-c2.glb | 2531 | 7 |  | integrated-in-branch | model-c2.glb | posed deviation 0 m vs delivered skin (kept vertices are a subset); clip curves within 0.05-0.2 deg; render compare output/asset-remake/guests/orb-bot-orange/compare-views.jpg |
| orb-bot-beret | model-c2.glb | 3914 | 7 |  | integrated-in-branch | model-c2.glb | posed deviation 0 m vs delivered skin (kept vertices are a subset); clip curves within 0.05-0.2 deg; render compare output/asset-remake/guests/orb-bot-beret/compare-views.jpg |
| orb-bot-frog | model-c2.glb | 3624 | 7 |  | integrated-in-branch | model-c2.glb | posed deviation 0 m vs delivered skin (kept vertices are a subset); clip curves within 0.05-0.2 deg; render compare output/asset-remake/guests/orb-bot-frog/compare-views.jpg |
| orb-bot-triangle | model-c2.glb | 3993 | 7 |  | integrated-in-branch | model-c2.glb | posed deviation 0 m vs delivered skin (kept vertices are a subset); clip curves within 0.05-0.2 deg; render compare output/asset-remake/guests/orb-bot-triangle/compare-views.jpg |
| orb-bot-heart | model-c2.glb | 3935 | 7 |  | integrated-in-branch | model-c2.glb | posed deviation 0 m vs delivered skin (kept vertices are a subset); clip curves within 0.05-0.2 deg; render compare output/asset-remake/guests/orb-bot-heart/compare-views.jpg |
| mae | model-c2.glb | 10843 | 6 |  | integrated-in-branch | model-c2.glb | posed deviation 0 m vs delivered skin (kept vertices are a subset); clip curves within 0.05-0.2 deg; render compare output/asset-remake/guests/mae/compare-views.jpg |
| kohaku | model-c2.glb | 29058 | 8 |  | integrated-in-branch | model-c2.glb | posed deviation 0 m vs delivered skin (kept vertices are a subset); clip curves within 0.05-0.2 deg; render compare output/asset-remake/guests/kohaku/compare-views.jpg |
| maruimo-mascot | model-c2.glb | 28911 | 13 |  | integrated-in-branch | model-c2.glb | posed deviation 0 m vs delivered skin (kept vertices are a subset); clip curves within 0.05-0.2 deg; render compare output/asset-remake/guests/maruimo-mascot/compare-views.jpg |

## equipment（6）

| key | 現行GLB | 三角形 | クリップ | 依存データ | 進捗 | 新GLB | 検証 |
|---|---|---:|---|---|---|---|---|
| flint-spear | model.glb | 5679 | 0 |  | kept-with-reason |  | Legacy asset referenced only by src/model-review.ts; not equipped or placed in the game (wooden/obsidian spears are). Kept. |
| stone-axe | model-c2.glb | 3941 | 0 |  | integrated-in-branch | model-c2.glb | output/asset-remake/stone-axe/compare-c2.jpg; first BiRefNet run crashed (GPU contention), requeued |
| kunoichi-katana | model-c2.glb | 5997 | 0 |  | integrated-in-branch | model-c2.glb | 5,997 tris, p95 0.3 mm; grip-to-butt 0.1583 / grip-to-tip 0.8917 m (C1 0.1583 / 0.8917). In game: held by the cat kunoichi peer (output/asset-remake/game/final-r1/players-front.png). |
| wooden-spear | model-c2.glb | 2500 | 0 |  | integrated-in-branch | model-c2.glb | output/asset-remake/wooden-spear/compare-c2.jpg |
| obsidian-spear | model-c2.glb | 3995 | 0 |  | integrated-in-branch | model-c2.glb | 3,995 tris, p95 0.6 mm; grip-to-butt 0.7133 / grip-to-tip 1.3853 m (C1 0.7136 / 1.3854). In game: held at GripR when an obsidian head is fitted, visible at idle and in the real F thrust (output/asset-remake/game/final-weapons). |
| obsidian-blade | model-c2.glb | 1500 | 0 |  | integrated-in-branch | model-c2.glb | 1,500 tris, p95 0.5 mm; output/asset-remake/compare/weapons/blade.jpg (faint ochre matte fringe on the edges). Not placed in the current world: SHELL_BEDS / MIDDEN_SITES / KNAPPING_SITES (shared/coastal-sites.mts) are filtered to the gulf region removed on 2026-09-22, so they are all empty and src/coastal-renderer.ts never requests this asset; verified by renders only. |

## prop-structure（21）

| key | 現行GLB | 三角形 | クリップ | 依存データ | 進捗 | 新GLB | 検証 |
|---|---|---:|---|---|---|---|---|
| valley-boulder | model-c2.glb | 3498 | 0 | shared/model-bounds.mts | integrated-in-branch | model-c2.glb | output/asset-remake/valley-boulder/compare-c2.jpg; stone-pile tests pass Later: m03 scaled x0.975 so the footprint stays within C1 (open-world-restore test position no longer nudged). |
| firewood-pile | model-c2.glb | 5907 | 0 | shared/model-bounds.mts | integrated-in-branch | model-c2.glb | output/asset-remake/firewood-pile/compare-c2.jpg, compare-xatlas.jpg |
| hide-tent | model-c2.glb | 17991 | 0 | shared/model-bounds.mts | integrated-in-branch | model-c2.glb | neutral review compare (output/asset-remake/hide-tent/compare-r01.jpg); collision bounds re-measured; in game at camp (output/asset-remake/game/final-r1/players-front.png, player-run.png) and in both perf comparisons; 2026-10-07 later: normal map repaired (back-face hits from overlapping layers flipped, z>=0.25; scripts/remake/repair_normal_maps.py), other bytes unchanged. Later: r02 scaled uniformly to 3.176 m so the collision footprint stays within C1 (x 1.000, z 0.931 of C1). |
| drying-rack | model-c2.glb | 11816 | 0 | shared/model-bounds.mts | integrated-in-branch | model-c2.glb | output/asset-remake/drying-rack/compare-c2.jpg |
| stone-firepit | model-c2.glb | 8356 | 0 | shared/model-bounds.mts | integrated-in-branch | model-c2.glb | neutral compare output/asset-remake/stone-firepit/compare-c2r04.jpg and compare-xatlas.jpg (Smart UV vs xatlas) |
| wood-footbridge | model-c2.glb | 8987 | 0 | shared/model-bounds.mts, placement.deckHeightMetres | integrated-in-branch | model-c2.glb | output/asset-remake/wood-footbridge/compare-c2.jpg; scripts/remake/measure_bridge.py, output/asset-remake/bridge-width.py |
| mammoth-meat | model-c2.glb | 2996 | 0 |  | integrated-in-branch | model-c2.glb | output/asset-remake/mammoth-meat/compare-c2.jpg |
| dugout-canoe | model-c2.glb | 13998 | 0 |  | integrated-in-branch | model-c2.glb | output/asset-remake/dugout-canoe/compare-c2.jpg |
| cockle-shell | model-c2.glb | 1474 | 0 |  | integrated-in-branch | model-c2.glb | 1,474 tris, p95 1.6 mm; output/asset-remake/compare/cockle-shell/sheet.jpg (new TRELLIS rejected: flat, black slit) and sheet2.jpg (adopted reduction ~identical to C1). Not placed in the current world: SHELL_BEDS / MIDDEN_SITES / KNAPPING_SITES (shared/coastal-sites.mts) are filtered to the gulf region removed on 2026-09-22, so they are all empty and src/coastal-renderer.ts never requests this asset; verified by renders only. |
| shell-midden | model-c2.glb | 8940 | 0 |  | integrated-in-branch | model-c2.glb | 8,940 tris, p95 6.0 mm, 1.5 m wide (height 0.43 vs 0.39 m; no collision footprint); output/asset-remake/compare/shell-midden/sheet.jpg. Not placed in the current world: SHELL_BEDS / MIDDEN_SITES / KNAPPING_SITES (shared/coastal-sites.mts) are filtered to the gulf region removed on 2026-09-22, so they are all empty and src/coastal-renderer.ts never requests this asset; verified by renders only. |
| firewood-log | model-c2.glb | 2984 | 0 | shared/model-bounds.mts, shared/wood-pile-layout.mts | integrated-in-branch | model-c2.glb | output/asset-remake/firewood-log/compare-c2.jpg |
| crow-soldier-spear | model-c2.glb | 2993 | 0 |  | not-started |  |  |
| crow-brute-axe | model-c2.glb | 3457 | 0 |  | not-started |  |  |
| crow-prelate-glaive | model-c2.glb | 2949 | 0 |  | not-started |  |  |
| crow-pontiff-crozier | model-c2.glb | 3494 | 0 |  | not-started |  |  |
| crow-hide-shield | model-c2.glb | 2372 | 0 |  | not-started |  |  |
| crow-red-mantle | model-c2.glb | 2596 | 0 |  | not-started |  |  |
| crow-ivory-vestment | model-c2.glb | 2584 | 0 |  | not-started |  |  |
| crow-pontiff-crown | model-c2.glb | 2929 | 0 |  | not-started |  |  |
| berry-cluster | model-c2.glb | 1172 | 0 |  | not-started |  |  |
| crow-bone-pauldrons | model-c2.glb | 2677 | 0 |  | not-started |  |  |

## vegetation（5）

| key | 現行GLB | 三角形 | クリップ | 依存データ | 進捗 | 新GLB | 検証 |
|---|---|---:|---|---|---|---|---|
| valley-pine | model.glb | 12609 | 0 | shared/model-bounds.mts | kept-with-reason |  | Rejected: the new reconstruction has granular clumped needles (the rejected look): output/asset-remake/compare/valley-pine/sheet.jpg. Kept the user-approved smooth canopy. |
| meadow-grass | model.glb | 42587 | 0 | tests/meadow-ground-tint.test.mjs | kept-with-reason |  | Rejected the new reconstruction (thin yellow wisps, disconnected blades; would also re-tint the meadow ground): output/asset-remake/compare/meadow-grass/sheet.jpg. Kept the user-approved tuft. |
| berry-bush | model-c2.glb | 11691 | 0 |  | integrated-in-branch | model-c2.glb | output/asset-remake/berry-bush/compare-c3.jpg (c2 = rejected ref-a) |
| desert-cactus | model-c2.glb | 8991 | 0 | shared/region-feature-bounds.mts, tests/region-features.test.mjs | integrated-in-branch | model-c2.glb | output/asset-remake/compare/desert-cactus/sheet.jpg; footprint 16 cells / 10 boxes (C1 see qa/footprint-rev03.json), 0 misses; region-features/adventures/paleo-world tests 23/23. In game: region loads and renders (output/asset-remake/game/final-r1/landmark-desert-cactus-1.png). |
| meadow-sprig | model.glb | 11546 | 0 |  | kept-with-reason |  | Rejected: same shape, yellower blades that would re-tint the meadow ground (output/asset-remake/compare/meadow-sprig/sheet.jpg). Kept the user-approved sprig. |

## terrain-water（6）

| key | 現行GLB | 三角形 | クリップ | 依存データ | 進捗 | 新GLB | 検証 |
|---|---|---:|---|---|---|---|---|
| meadow-ground | model.glb | 2720 | 0 | tests/meadow-ground-tint.test.mjs | kept-with-reason |  | Delivered tile is a modular 20 m square whose walking top was deliberately flattened (top relief ~1.2 cm, opposite-edge mismatch ~1e-5 m) and whose placement.heightField drives authoritative terrain height. The TRELLIS dense is a thick slab with ~2 m relief: the 2026-10-07 trial (scripts/remake/normal_pipeline.sh) fitted at RMS 2.38 m with 2.07M of 3.34M texels unhit, so a dense-derived normal map would paint hills that the flat walk surface does not have. Rebuilding the tile would change the heightField (walk height = game spec). Kept; not adopted. Trial outputs output/model-generation/models/meadow-ground/work/candidate-02/. |
| river-water | model.glb | 2693 | 0 |  | kept-with-reason |  | Water sheet whose look comes from runtime shaders (ocean waves, shoreline discard, marsh pools in src/paleo-materials.ts/src/world-scenery.ts); a baked normal would fight the animated water. Kept. |
| snow-ground | model.glb | 5903 | 0 |  | kept-with-reason |  | Delivered tile is a modular 20 m square whose walking top was deliberately flattened (top relief ~1.2 cm, opposite-edge mismatch ~1e-5 m) and whose placement.heightField drives authoritative terrain height. The TRELLIS dense is a thick slab with ~2 m relief: the 2026-10-07 trial (scripts/remake/normal_pipeline.sh) fitted at RMS 2.38 m with 2.07M of 3.34M texels unhit, so a dense-derived normal map would paint hills that the flat walk surface does not have. Rebuilding the tile would change the heightField (walk height = game spec). Kept; not adopted. Same tile construction as meadow-ground (heightField placement). |
| ice-ground | model.glb | 5500 | 0 |  | kept-with-reason |  | Delivered tile is a modular 20 m square whose walking top was deliberately flattened (top relief ~1.2 cm, opposite-edge mismatch ~1e-5 m) and whose placement.heightField drives authoritative terrain height. The TRELLIS dense is a thick slab with ~2 m relief: the 2026-10-07 trial (scripts/remake/normal_pipeline.sh) fitted at RMS 2.38 m with 2.07M of 3.34M texels unhit, so a dense-derived normal map would paint hills that the flat walk surface does not have. Rebuilding the tile would change the heightField (walk height = game spec). Kept; not adopted. Same tile construction as meadow-ground (heightField placement). |
| desert-ground | model.glb | 9600 | 0 |  | kept-with-reason |  | Delivered tile is a modular 20 m square whose walking top was deliberately flattened (top relief ~1.2 cm, opposite-edge mismatch ~1e-5 m) and whose placement.heightField drives authoritative terrain height. The TRELLIS dense is a thick slab with ~2 m relief: the 2026-10-07 trial (scripts/remake/normal_pipeline.sh) fitted at RMS 2.38 m with 2.07M of 3.34M texels unhit, so a dense-derived normal map would paint hills that the flat walk surface does not have. Rebuilding the tile would change the heightField (walk height = game spec). Kept; not adopted. Same tile construction as meadow-ground (heightField placement). |
| volcanic-ground | model.glb | 5594 | 0 |  | kept-with-reason |  | Delivered tile is a modular 20 m square whose walking top was deliberately flattened (top relief ~1.2 cm, opposite-edge mismatch ~1e-5 m) and whose placement.heightField drives authoritative terrain height. The TRELLIS dense is a thick slab with ~2 m relief: the 2026-10-07 trial (scripts/remake/normal_pipeline.sh) fitted at RMS 2.38 m with 2.07M of 3.34M texels unhit, so a dense-derived normal map would paint hills that the flat walk surface does not have. Rebuilding the tile would change the heightField (walk height = game spec). Kept; not adopted. Same tile construction as meadow-ground (heightField placement). |

## landmark（6）

| key | 現行GLB | 三角形 | クリップ | 依存データ | 進捗 | 新GLB | 検証 |
|---|---|---:|---|---|---|---|---|
| glacier-spires | model-c2.glb | 11999 | 0 | shared/landmark-bounds.mts, tests/landmarks.test.mjs | integrated-in-branch | model-c2.glb | output/asset-remake/compare/glacier-spires/sheet.jpg; footprint 187 cells / 158 boxes (C1 182 / 149), plan envelope within 5 cm; tests/landmarks, paleo-world, open-world 17/17. A few dark crevices read as deep concavities. In game: renders at glacier-gate (output/asset-remake/game/final-r1/landmark-glacier-gate.png). |
| volcanic-cone | model-c1-normal.glb | 13382 | 0 | shared/landmark-bounds.mts, tests/landmarks.test.mjs | integrated-in-branch | model-c1-normal.glb | Accessor bytes identical (4); bake misses 729 / 2,162,402 texels; footprint unchanged (hash updated in shared/landmark-bounds.mts); output/asset-remake/compare/volcanic-cone/sheet.jpg (rejected TRELLIS) and normal-sheet.jpg (adopted). tests/landmarks pass. In game: renders with the lava glow at volcano-main (output/asset-remake/game/final-r1/landmark-volcano-main.png). |
| volcanic-basalt-columns | model-c2.glb | 13608 | 0 | shared/region-feature-bounds.mts, tests/region-features.test.mjs | integrated-in-branch | model-c2.glb | output/asset-remake/compare/volcanic-basalt-columns/sheet.jpg (m01 shown at 4.6 m; adopted m02 is the same mesh at 0.917 scale); footprint 53 cells / 36 boxes (C1 58 / 35), 0 misses; region/adventure/paleo tests 23/23. In game: region loads (output/asset-remake/game/final-r1/landmark-volcanic-basalt-columns-1.png). |
| valley-castle | model-r13-normal.glb | 127254 | 0 | shared/castle-surface-data.mts, tests/castle.test.mjs | integrated-in-branch | model-r13-normal.glb | fit rms 0.52 m / p95 1.10 m (dense vs delivered, 110 m wide); 2048 bake, first-pass misses 5,753 of 2,120,288 texels; accessor bytes identical (4 accessors); tests/castle.test.mjs 3/3; renders output/asset-remake/compare/valley-castle/pair*.png |
| camp-mountain | model-r15.glb | 245000 | 0 | shared/camp-mountain-surface-data.mts, tests/camp-landform.test.mjs | kept-with-reason |  | Ray-projected TRELLIS massif (r15) with measured LOD switching and cave roof fitting; its source massif-v2-res1024-seed42.glb is not on this host and the surface is hash-locked by tests/camp-landform.test.mjs. Kept. |
| camp-cave | model-r26.glb | 74458 | 0 | shared/camp-cave-surface-data.mts, tests/cave-rimo-mural.test.mjs, tests/update-cave.test.mjs, cave mural coordinates | kept-with-reason |  | Walkable cave (shared walk/floor/ceiling data and camera grid measured from model-r26 in tests/camp-landform.test.mjs) with projected murals; its TRELLIS dense (work/trellis/dense-res1024-seed42.glb per assets/camp-cave/README.md) is not on this host, so a lineage-preserving re-bake is impossible here. Kept. |

## コード生成の代用品（2）

| id | 場所 | 内容 | 進捗 |
|---|---|---|---|
| crow-faction-props | src/crow-faction-visuals.ts:20-41 | Cylinder/Cone/Sphere/Torus spears, axe, shield, crown, halo, mantle, staff orb on crow bones | integrated-in-branch |
| berry-spheres | src/world3d.ts:624-640 | red sphere berries placed on berry-bush vertices (resource amount display) | integrated-in-branch |
