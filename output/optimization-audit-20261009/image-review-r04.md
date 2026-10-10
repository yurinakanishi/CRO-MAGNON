# r04 asset acceptance for integration — 2026-10-09

Codex accepts `assets/optimized-runtime/20261009-r04` for the next integration stage, not as completion of the optimization project. No runtime manifests have been changed yet. All original files and rejected r02/r03 revisions remain intact.

## Structural and browser evidence

- Final source-body pipeline tests: `asset-proof-tests-r09-final.log`, 27/27 pass. The earlier intermediate run failed four tests; its output is retained and superseded by the final run, not hidden.
- Dry run, generation and independent verification: `asset-dry-run-r04.log`, `asset-generation-r04.log`, `asset-verify-r04.log`; verification.json in the revision records eight common checks and 127 file checks passing. The verifier independently re-derives the reduction and checks source/candidate bytes, attributes, topology, rigs, clips and texture constraints.
- Native Chrome and Windows WebKit 26.5: `output/playwright/optimization-20261009/startup-candidates-r04-{chrome,webkit}/result.json`. Seven startup characters, all 73 clips, five sampled times per clip, all vertices compared to audited source-derived geometry, zero page/console errors. The comparison reference uses original vertex attributes, original rig and clip curves, and candidate connectivity only after its audited index hash and bounds match. It is an animation-correspondence proof; the separate Node verifier and actual original-column image review establish geometry provenance and sampled visual quality.
- `r04-unchanged-candidate-proof.json`: all 110 ordinary candidate GLBs and ten standalone cave images are byte-identical to r03 and r02. The earlier complete 64-model and cave-image visual review therefore applies to those exact unchanged bytes.

## Images actually inspected

Four columns are original, compressed full model, audited source-derived reference using original textures, and compressed startup model. Codex opened every listed image and compared original with candidate, rather than treating matching numerical tests as image approval.

- Chrome: heads and necks for all seven characters, four full-body directions for all seven, and every one of the 73 clip mid-poses at inspection size through all 22 `startup-pose-sheets-r04-chrome/*-poses-*.png` sheets. The neck sheets include first-clip and walk mid-poses from front, 45 degrees and back.
- WebKit: heads and necks for all seven; additionally four full-body directions for cat-kunoichi and neanderthal-woman. All 73 clips also passed numerical vertex comparison in WebKit. This is not a claim that every WebKit pose screenshot was manually inspected.
- No new facial collapse, shoulder/clothing fragmentation, large UV patch, lost limb or animation cutout was observed in those views. The r03 old-LOD body problems are absent. The 1024px textures are softer at close range, with shape and recognizable face preserved.
- Existing original head/body neck seams and angular skin remain visible, especially in close-up human characters. They appear in the original column too and are not improvements delivered by this revision. They must not be described as repaired or flawless.

## Cost and limitations

Startup bodies now use conservative index-only reduction of each full source, retaining exact surviving attributes, locked boundaries and original heads. Fennec and ape retain their complete single primitive. No old far-LOD body or face is acceptable for these seven characters at any distance. Body triangle reductions are only approximately 1–15%; the 50% target was not reached within the strict quality bounds.

Ordinary candidate GLBs total 148,468,536 B versus 250,916,124 B for their source files. The ten cave images total 7,582,869 B versus 21,980,553 B. Seven startup candidates total 41,137,872 B, larger than the rejected r03 set (30,341,408 B). Individual startup files can be larger than compressed full files because retained/source-index geometry is less compact; do not imply that startup bytes are always the minimum. Integration should avoid redundant transfers when startup and full are identical or a quality-safe full is smaller, without using rejected far LODs.

Still required: actual runtime adoption, staged loading, safe resource lifetime after eviction/reentry/context loss, profile-specific exact release graphs, full final checks, and matched gameplay/performance measurements. The later adoption-contract-r04.md makes the reviewed startup geometry the sole primary for these seven actors and explicitly cancels a redundant full-geometry upgrade. These desktop browser engines are not physical Android/iPhone or iOS Safari tests. No publication, fleet distribution, commit or push is authorized by this acceptance.
