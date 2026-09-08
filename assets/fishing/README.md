# Fishing in the expanded gulf

An incremental addition to the existing game, planned in [FISHING_PLAN.md](../../FISHING_PLAN.md). The world remains 8,192 × 4,096 m and Three Shores remains 1,480 × 1,340 m. The countries, crops, obsidian routes, continents and existing activities remain available.

## How to play

1. Open **もちもの (I)**. Make **釣り道具** for three wood and one stone. The kit is reusable. All countries and character types can use it.
2. Open **魚場と釣り方** from inventory, the pause menu or the Three Shores panel. Its route buttons lead to five fishing beaches and two grounds farther out. The map marks fish grounds in turquoise. Offshore grounds require a canoe.
3. Stop within ten metres of a fish ground and use **E / controller ×**, the nearby-action button, or **ここで魚を待つ**. A six-second progress bar appears. A completed catch gives one raw fish and uses two energy. Each catch requires a new action.
4. Return to an existing fire and cook for three seconds. Eat cooked fish for up to thirty energy, or bring it to Many Hearths. One cooked fish contributes three food units to a feast; berries remain an alternative. The existing eight wood, twelve food and four obsidian total is unchanged. The compatible saved field `stores.berry` now represents these food units.

Shore grounds hold six fish, returning one every 45 seconds. Offshore grounds hold ten, returning one every 30 seconds. Stocks are shared and capped; these are gameplay timers, not an ecological simulation or a permanent relationship to the player cap. Boat cargo still uses the existing inventory limits.

Movement, taking damage, defeat, boarding/disembarking, attacks, menus, leaving the page and explicit cancellation interrupt a catch. Starting does not reserve fish. When several people finish together, the server awards only the available stock. Distance, obstacles, boat occupancy, activity conflicts and inventory capacity are checked. Walking or moving a canoe while fishing cancels even if a client bypasses the interface.

Raw food remains in inventory until cooking completes. Cancellation, interruption or a full cooked-food inventory does not destroy it. Cooking rechecks access to the fire at completion. Eating and meal contributions are server-owned actions.

## State and presentation

Kit ownership, catch/share records, raw/cooked fish and shared stock depletion use the existing reconnect and export/import mechanisms. Older saves receive default fish fields. Unfinished catches are cancelled on reconnect/import. Local Node operation still has its existing short memory-only resume window; this change does not add automatic disk persistence or account login.

No new GLBs, textures, package dependencies or substitute world models are added. Shore fishing uses the existing work animation and hides held weapons during the activity; canoes retain their seated pose. Fish and the kit are represented by inventory, progress feedback and labelled grounds. There are no visible fish, fishing-line or tackle meshes in this increment.

## Historical foundation and fiction

The archaeological comparison and sources remain in [WORLD_SETTING_PLAN.md](../../WORLD_SETTING_PLAN.md), including its warning against borrowing later intensive fishing at Franchthi as evidence for an earlier maritime economy. This implementation does not assert particular tackle, fish species, fishing institutions or regular maritime commerce in the base map's approximately 50,000 BP reference.

The seven grounds, recipe, guaranteed timed catches, year-round recovery, meal conversion and Reed Shore's first-fish sharing custom are deliberate fantasy/gameplay design. Fishing is open to everybody and complements farming, gathering and hunting. NPC teaching and household migration are not implemented by the custom's lore text.

## Verification

See [qa-summary.json](qa-summary.json) for final checks and limitations. The repeatable browser harness is [scripts/qa-fishing.mjs](../../scripts/qa-fishing.mjs); fixtures and normal play are distinguished in its recorded commands. Checks include real Chrome rendering and UI, network players, controller API input, phone-sized layouts, cooking, donations, canoe travel and reconnects. These do not establish physical-controller/device compatibility, high-player-count performance or sustained 60 FPS.
