# Four-area expansion of Three Shores

Started 2026-09-08, following the user's instruction to continue the recommended scale expansion. This is an incremental change to the existing game.

## Scope

- Increase the Three Shores region from 740 × 670 m to 1,480 × 1,340 m (four times its rectangular area).
- Extend the playable world bounds as needed to house the larger gulf west of the existing continents. Preserve the original geographical coordinate system and all original continental content; do not scale people, buildings or boats.
- Keep the existing farming, obsidian, affiliation and feast loops. Add useful stopping places and recognizable natural formations along the longer routes, using the accepted assets.
- Preserve crop stages, resource depletion, inventory, affiliation, personal progress, and boats through an explicit region-version migration. Preserve current local sessions during rollout.
- Verify navigable land loops, boat crossings, interaction approaches, save compatibility, desktop/mobile UI and multiplayer synchronization. The five-player default remains an operational limit.

## Work

- [x] Resolve bounds, geography and shared coastline grid without changing the original continents.
- [x] Expand the region and add intermediate camps, landmarks, resources and travel objectives.
- [x] Migrate the earlier gulf's positions and state; keep character and asset scales unchanged.
- [x] Update the map, regional panel, guide and documentation to describe the actual result.
- [x] Run relevant tests, build/architecture checks and actual browser gameplay, then roll out locally with current progress preserved.

## Delivered

World version 4 spans 8,192 × 4,096 m. The original 4,096 × 2,048 m Earth projection remains at the same coordinates. Gulf version 2 spans 1,480 × 1,340 m and adds six stopping places, nineteen rock formations, two extra boat landings and a six-stop journey reward. The main crossing is approximately 646 m. The five-player default, 48 existing farm plots, boat/character scales and original assets remain independent of the area expansion.

All 230 tests pass. The final preservation audit matches all 14,685 original scenery placements outside the replaced version-1 gulf. Real browser checks covered land travel, water transport, records/reward, farming, obsidian, reload, and desktop/mobile viewports. Four distant stop arrivals, boat starting supplies and selected return positions were explicit QA fixtures; the records distinguish these from ordinary travel. See [QA](assets/gulf/expansion/qa-summary.json) and [local rollout](assets/gulf/expansion/rollout-qa.json).

The earlier live session had expired before rollout; the first fresh checkpoint contained no rooms or resumable players. Its earlier checkpoint remains an ignored local backup and was not reinstated. The final boundary correction preserved the newly created QA session through a second fresh checkpoint. No automatic local disk persistence was added.

## Limits

This expansion does not claim to finish every worldbuilding proposal. NPC household migration, fishing, complex politics, additional crop species and simulated maritime weather remain separate work. No new GLBs, public deployment or billing changes are part of this task.
