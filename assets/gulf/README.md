# Three Shores: playable fantasy expansion

Implemented in the existing CRO-MAGNON game on 2026-09-08. Open **「三つの岸の湾」** beside the minimap, then **「湾の集い場へ遠征」**. Existing characters, adventures, combat, continents and model files remain available. This change is local; it has not been deployed to the public Cloudflare game.

## Place and people

The expanded gulf occupies **1,480 × 1,340 m** at x −2950…−1470, z 70…1410: four times the original gulf's rectangular area. World bounds are now **8,192 × 4,096 m**, also four times the earlier area. The original Earth projection remains 4,096 × 2,048 m at its existing coordinates; people, structures, boats and continental journeys keep their scale. The extra world extent accommodates the gulf and future exploration; it is not four times as much finished continental content.

This is explicitly fictional geography, not a reconstruction of an Aegean coastline. The original small gulf is replaced by the expanded horseshoe west of the continents. Its shoreline feeds the same **2 m** distance grid used by rendering, the map, pedestrian collision and boat collision. Original continental land cells, scenery and terrain orientation are preserved. World version 4 and gulf version 2 identify this expansion.

| Place | Role in this expansion |
|---|---|
| 多くの炉の集い場 — Many Hearths | Shared gathering place at the head of the gulf, near a water source and beach. Ten visiting shelters, hearths, a public growing area and exchanges. |
| 長い谷の国 — Long Valley | Inland country with green shelter treatments; plant gathering, cultivation, hunting lore, wooden handles and cordage traditions. |
| 白い尾根の国 — Pale Ridge | Western country with ochre shelter treatments; stoneworking traditions and access to the obsidian outcrops. |
| 葦の岸の国 — Reed Shore | Eastern country with blue-green shelter treatments; coastal gathering, boat repair and fishing lore alongside cultivation. |

Each country has its own camp, twelve public growing plots, a water source, wild berries, wood and ordinary stone. All can support basic gathering, farming and tool/boat construction. Affiliation is chosen at a country's hearth and can be changed by visiting another. It is independent of character species and is shown beneath player names. Countries do not lock access, allocate exclusive professions or introduce mandatory PvP.

The culture descriptions are invented lore. The [fishing increment](../fishing/README.md) adds actual fishing gameplay at five beaches and two offshore grounds. Teaching AI, languages, diplomacy and historical political institutions have not been simulated. The existing friendly-player combat rules support a peaceful gathering place; the lore's shared rules and dispute discussions are fictional social arrangements.

## Play loop

1. At Many Hearths, use **E** or the regional panel to receive six seeds and three berries once per character.
2. Choose a plot in the panel and walk there. Plant one seed. Visit the water source, fill the six-use water bag, return and spend one water to tend the plot.
3. Tend once, then wait for ripening: spring/autumn three minutes, summer two and a half, winter four. Harvest four berries and two seeds. Plots are public: another player can tend or harvest them. Harvest resolves once, and a full inventory leaves the crop available.
4. At any of the four hearths, two berries can be separated into two seeds. Wild gathering remains available, so cultivation is not a prerequisite for survival.
5. Walk to the western obsidian outcrops. Gather with **E** or the gathering action. Obsidian enters inventory and personal procurement progress; the stone axe also improves its gathering yield.
6. Return to Many Hearths. Exchange two obsidian for six wood and two seeds, or prepare a shared gathering by donating eight wood, twelve food and four obsidian in total. Donations are made in batches of two wood, three berries or one obsidian. One cooked fish can replace three berries toward the food total.
7. Completing the shared supplies opens a feast. Each character can claim the current feast once at the hearth: three berries, two seeds and up to 35 energy. The supply counters reset for the next gathering.
8. Visit the six new stopping places and use **E / controller ×** near each hearth to record it. Return to Many Hearths after all six to receive **six wood and four seeds** once. The regional panel tracks the journey and provides walking destinations.

The regional panel also records visits to the four places, harvests and obsidian procurement. Nearby plots and water sources participate in the existing **E** interaction hint. The inventory panel includes obsidian, seeds and carried water. Selected plots remain selected when the panel is reopened after fetching water.

The [village-life increment](../village-life/README.md) adds two named residents at each settlement. They walk between local work areas, hearths and shelters during the four-minute game day. Visit them for conversation and a small daily help request; each player's rewards are independent. Names, customs, schedules and rewards are fiction, and the background routines do not consume shared crops or resources.

## Routes, capacity and visuals

The continuous land route rounds the head of the gulf. Five marked beaches support the existing dugout craft/boarding controls. The main western/eastern crossing is approximately **646 m**, with a second crossing between the two outer beaches. At the existing fast boat speed, the main crossing takes about 92 seconds before boarding and landing; walking from the hub to each country follows routes of roughly 280, 586 and 672 m. These are unobstructed route measurements, not promises of actual journey duration.

Six smaller camps provide a hearth, two shelters, wild berries, wood, stone and water: **谷道の休み場**, **泉の林**, **石割りの野営地**, **西の舟待ち浜**, **海岸林の見晴らし**, and **葦の外湾**. Nineteen reused rock formations and sparse groves mark the longer paths. The formations have measured ground collision; they do not add free climbing or a continuous mountain heightfield. The main four settlements retain their 48 farming plots, settlement IDs and local building spacing.

Open the map with **M** and select **「三つの岸の全図」** to inspect the region, or **「現在地の周辺」** for precise shore approaches. Within the gulf, the entry expedition cannot skip the return journey; walk or sail back. The panel provides an expedition back to the original starting region.

The current connection default remains five. `createGameCore({ playerLimit })` now accepts a separate operational limit; the UI displays the server's limit. An eight-player core is tested using the same region and 48 plots. This is functional capacity verification, not a large-server performance claim. The shared boat cap is now 24, independent of connected players. Raising the public service's player cap or changing its billing is outside this change.

No new GLB was generated or adopted. Shelters, trees, rock outcrops, crops and water reuse the accepted models. Country colors and obsidian use cached material treatments sharing the source geometry and textures. Crops use the existing berry bush at different growth scales. Low plot markers instance the accepted boulder geometry, and grass is excluded from growing areas, water sources and central activity spaces. Crops and water patches are released when distant; regional material eviction remains owned by the existing renderer.

## Historical foundation and fiction

The earlier source-backed comparison and bibliography remain in [WORLD_SETTING_PLAN.md](../../WORLD_SETTING_PLAN.md). The implementation follows the user's later, broader fantasy direction. Archaeology informs the combination of regional mobility, gathering places, useful stone, varied subsistence and small watercraft. The three countries, their names and customs, agriculture, persistent Neanderthal communities, the added gulf and rapidly growing crops are deliberate fiction. They are not archaeological claims. The base Earth map's approximate 50,000 BP framing and the research plan's later Upper Paleolithic reference are not presented as a single historical reconstruction.

Seasons change crop duration. Water sources remain available throughout the year. Fishing uses shared stocks and timed catches as described in the fishing increment. The [crop expansion](../crop-expansion/README.md) adds fictional fire-root grass and aromatic grass alongside berries, with different water costs, growth durations, seeds and hearth meals. All countries can grow every crop. Weather, currents, sailing rigs, monumental towns and political simulation remain outside the current implementation.

## State and verification

Farm stages and deadlines, gathering supplies, feast cycles and personal progress are server-owned. Proximity, obstruction, inventory capacity and incompatible actions are checked before rewards or costs are applied. Existing saves acquire the new fields and resources without discarding their old content. Reconnection and the existing export/import persistence path preserve the new state; elapsed growing time catches up on return. This does not add automatic disk persistence to the local Node server.

Version 3 saves migrate gulf positions into the enlarged region once. Players near the original four camps retain their local camp offsets; travelling players and boat moorings follow the enlarged coast. An obstructed migrated arrival is moved to safe ground. Original continental player coordinates remain unchanged. Resource IDs restore depletion onto the new authored positions; crops, supplies, affiliation, items and achievements persist. Journey records and their once-only reward are included in future saves.

Current expansion checks and local rollout are recorded in [expansion/qa-summary.json](expansion/qa-summary.json) and [expansion/rollout-qa.json](expansion/rollout-qa.json). The [expansion plan](../../WORLD_EXPANSION_PLAN.md) lists the completed scope and remaining worldbuilding work.

### Original gulf verification (version 1, retained history)

The full suite passed **211/211 tests**, and 34 focused tests passed after the final interface changes. Real Chrome verification covered farming, obsidian procurement and exchange, a crossing of approximately 318 m with landing, and the communal feast. Two Chrome contexts plus three WebSocket peers connected together. Crop time and the initial boat/feast supplies were explicit QA fixtures, as recorded in [qa-summary.json](qa-summary.json).

The local server is running at **http://localhost:3000**. It was stopped before this update, so a new `node server.mjs` process was started; no old checkpoint was restored. A fresh browser verified entry into the gulf and receipt of welcome supplies in a dedicated QA room. See [rollout-qa.json](rollout-qa.json).

See [delivery-qa.json](delivery-qa.json) for the 48 delivered GLBs' SHA and structure checks. The full historical asset-provenance verifier still cannot complete because the pre-existing `output/model-generation/models/neanderthal-hunter/qa/adoption-review.json` is missing. The delivered model checks are separate; no missing production history has been invented.

## Subsequent maritime increment

[Weather and currents](../weather-current/README.md) add shared calm, breeze, rain and mist; current-dependent paddling speed; sheltered shoreline routes; a forecast panel; and map arrows. All weather timings, flows, forecasts and station keeping are deliberate fantasy. The same boats, shores and overland alternatives remain usable. See [plan and verification](../../WEATHER_CURRENT_PLAN.md).
