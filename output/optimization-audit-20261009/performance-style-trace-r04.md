# Minimap style-flush diagnosis — 2026-10-10

Native Chrome154, frozen adopted-r04-build-r01 and actually adopted r04 assets. Same portrait390x844/CPU4, five participants and fixed herd as the other diagnostic runs. Three requested12-second trace windows, devtools.timeline plus style invalidation tracking. Tracing adds overhead: these are causal diagnostics, not normal FPS acceptance or phone timings. Browser errors0. Raw traces and independent grouping are in `output/playwright/optimization-20261009/adopted-r04-style-trace-r01/{camp,mammoth,overview}.trace.json` and `style-attribution.json`.

The profile hypothesis is confirmed: synchronous **UpdateLayoutTree** is nested in `drawWorldMap` at compiled line481 (the `ctx.font` setter), called by `drawMinimap`→`updateHUD`. The trace carries that explicit call stack.

| Scene | Font-set style flushes | Font-set style ms | Other style ms | Layout ms |
|---|---:|---:|---:|---:|
| Camp |98 |387.723 |424.265 |143.966 |
| Mammoth |99 |394.967 |399.915 |139.011 |
| Overview |98 |372.122 |356.537 |148.996 |

Most invalidations are repetitive HUD mutations and `:has()` propagation to HTML/game viewport/hotbar. The mammoth trace explicitly identifies `updateHuntingHUD` setting `cook-button.hidden` and `cooking-status.hidden`. Overview has215 hidden-attribute invalidations each for riding-controls/input-cues/magic-cooldown/cook-button/cooking-status/damage-flash/combat-status. About392–396 text removals/insertions and SMALL hidden changes also recur. These are event counts, not independent additional milliseconds; do not sum overlapping invalidations.

Next authorized narrow candidate: update only changed HUD properties/text/dataset values, and draw the minimap before the synchronous HUD mutation batch. Preserve every value, same update cadence, dynamic state, data hooks, gameplay and bitmap drawing. Compare native DOM snapshots and map pixels for fixed states plus real touch/input flows. Re-trace total style+layout, not just the font stack, to ensure the cost did not merely move. No implementation or gain is established by this note.

Relevant protocol documentation was checked through Context7 against the official [CDP Tracing domain](https://chromedevtools.github.io/devtools-protocol/tot/Tracing/). Trace streams were fully read through IO.read and closed; dataLossOccurred was rejected.
