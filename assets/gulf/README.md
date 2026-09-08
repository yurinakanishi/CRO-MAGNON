# Three Shores: playable fantasy expansion

Implemented in the existing CRO-MAGNON game on 2026-09-08. Open **「三つの岸の湾」** beside the minimap, then **「湾の集い場へ遠征」**. Existing characters, adventures, combat, continents and model files remain available. This change is local; it has not been deployed to the public Cloudflare game.

## Place and people

The new gulf occupies a reserved **740 × 670 m** rectangle at x −2110…−1370, z 460…1130 inside the existing 4096 × 2048 m world. It adds a horseshoe of land in the Pacific portion of the map. This is explicitly fictional geography, not a reconstruction of an Aegean coastline. The shoreline overlay feeds the same distance grid used by rendering, the map, pedestrian collision and boat collision. Cells outside the rectangle, and pre-existing land cells inside it, retain their original values.

| Place | Role in this expansion |
|---|---|
| 多くの炉の集い場 — Many Hearths | Shared gathering place at the head of the gulf, near a water source and beach. Ten visiting shelters, hearths, a public growing area and exchanges. |
| 長い谷の国 — Long Valley | Inland country with green shelter treatments; plant gathering, cultivation, hunting lore, wooden handles and cordage traditions. |
| 白い尾根の国 — Pale Ridge | Western country with ochre shelter treatments; stoneworking traditions and access to the obsidian outcrops. |
| 葦の岸の国 — Reed Shore | Eastern country with blue-green shelter treatments; coastal gathering, boat repair and fishing lore alongside cultivation. |

Each country has its own camp, twelve public growing plots, a water source, wild berries, wood and ordinary stone. All can support basic gathering, farming and tool/boat construction. Affiliation is chosen at a country's hearth and can be changed by visiting another. It is independent of character species and is shown beneath player names. Countries do not lock access, allocate exclusive professions or introduce mandatory PvP.

The culture descriptions are invented lore. They do not imply that fishing, teaching AI, languages, diplomacy or historical political institutions have been simulated. The existing friendly-player combat rules support a peaceful gathering place; the lore's shared rules and dispute discussions are fictional social arrangements.

## Play loop

1. At Many Hearths, use **E** or the regional panel to receive six seeds and three berries once per character.
2. Choose a plot in the panel and walk there. Plant one seed. Visit the water source, fill the six-use water bag, return and spend one water to tend the plot.
3. Tend once, then wait for ripening: spring/autumn three minutes, summer two and a half, winter four. Harvest four berries and two seeds. Plots are public: another player can tend or harvest them. Harvest resolves once, and a full inventory leaves the crop available.
4. At any of the four hearths, two berries can be separated into two seeds. Wild gathering remains available, so cultivation is not a prerequisite for survival.
5. Walk to the western obsidian outcrops. Gather with **E** or the gathering action. Obsidian enters inventory and personal procurement progress; the stone axe also improves its gathering yield.
6. Return to Many Hearths. Exchange two obsidian for six wood and two seeds, or prepare a shared gathering by donating eight wood, twelve berries and four obsidian in total. Donations are made in batches of two wood, three berries or one obsidian.
7. Completing the shared supplies opens a feast. Each character can claim the current feast once at the hearth: three berries, two seeds and up to 35 energy. The supply counters reset for the next gathering.

The regional panel also records visits to the four places, harvests and obsidian procurement. Nearby plots and water sources participate in the existing **E** interaction hint. The inventory panel includes obsidian, seeds and carried water. Selected plots remain selected when the panel is reopened after fetching water.

## Routes, capacity and visuals

The continuous land route rounds the head of the gulf. The three marked beaches support the existing dugout craft/boarding controls, and the western/eastern beaches have a usable water route across the gulf. Within the gulf, the entry expedition cannot be used to skip the return journey; walk or sail back. The panel provides an expedition back to the original starting region.

The current connection default remains five. `createGameCore({ playerLimit })` now accepts a separate operational limit; the UI displays the server's limit. An eight-player core is tested using the same region and 48 plots. This is functional capacity verification, not a large-server performance claim. The shared boat cap is now 24, independent of connected players. Raising the public service's player cap or changing its billing is outside this change.

No new GLB was generated or adopted. Shelters, trees, rock outcrops, crops and water reuse the accepted models. Country colors and obsidian use cached material treatments sharing the source geometry and textures. Crops use the existing berry bush at different growth scales. Low plot markers instance the accepted boulder geometry, and grass is excluded from growing areas, water sources and central activity spaces. Crops and water patches are released when distant; regional material eviction remains owned by the existing renderer.

## Historical foundation and fiction

The earlier source-backed comparison and bibliography remain in [WORLD_SETTING_PLAN.md](../../WORLD_SETTING_PLAN.md). The implementation follows the user's later, broader fantasy direction. Archaeology informs the combination of regional mobility, gathering places, useful stone, varied subsistence and small watercraft. The three countries, their names and customs, agriculture, persistent Neanderthal communities, the added gulf and rapidly growing crops are deliberate fiction. They are not archaeological claims. The base Earth map's approximate 50,000 BP framing and the research plan's later Upper Paleolithic reference are not presented as a single historical reconstruction.

Seasons currently change crop duration. Water sources remain available throughout the year. Weather, currents, sailing rigs, fishing mechanics, differentiated crop species, monumental towns and political simulation are not part of this initial expansion.

## State and verification

Farm stages and deadlines, gathering supplies, feast cycles and personal progress are server-owned. Proximity, obstruction, inventory capacity and incompatible actions are checked before rewards or costs are applied. Existing saves acquire the new fields and resources without discarding their old content. Reconnection and the existing export/import persistence path preserve the new state; elapsed growing time catches up on return. This does not add automatic disk persistence to the local Node server.

The full suite passed **211/211 tests**, and 34 focused tests passed after the final interface changes. Real Chrome verification covered farming, obsidian procurement and exchange, a crossing of approximately 318 m with landing, and the communal feast. Two Chrome contexts plus three WebSocket peers connected together. Crop time and the initial boat/feast supplies were explicit QA fixtures, as recorded in [qa-summary.json](qa-summary.json).

The local server is running at **http://localhost:3000**. It was stopped before this update, so a new `node server.mjs` process was started; no old checkpoint was restored. A fresh browser verified entry into the gulf and receipt of welcome supplies in a dedicated QA room. See [rollout-qa.json](rollout-qa.json).

See [delivery-qa.json](delivery-qa.json) for the 48 delivered GLBs' SHA and structure checks. The full historical asset-provenance verifier still cannot complete because the pre-existing `output/model-generation/models/neanderthal-hunter/qa/adoption-review.json` is missing. The delivered model checks are separate; no missing production history has been invented.
