# CRO-MAGNON: researched setting improvement plan

Created: 2026-09-08
Status: first playable fantasy expansion implemented and verified; its four-area enlargement is described in WORLD_EXPANSION_PLAN.md and assets/gulf/README.md. This is not completion of every cultural or simulation proposal below.

This is an improvement to the existing CRO-MAGNON game. The user has now authorized implementation, with agriculture, three fantasy countries, Neanderthals, and obsidian procurement. These newer choices supersede the stricter historical design below. Existing characters, continents, adventures, assets and saved progress remain part of the game. Deployment is outside this change.

## Accepted implementation scope — latest user direction

The new **Three Shores gulf** is a fictional land addition in unused ocean space within the existing world, not a reconstruction of the Argolid. The researched late Upper Paleolithic ecology and gathering traditions below supply inspiration. Cultivation, countries, persistent Neanderthal communities, rapid crop growth, year-round gathering, and the geography are deliberate fantasy. The original world's approximate 50,000 BP Earth map retains its own historical framing; these dates are not presented as one archaeological reconstruction.

- [x] Add a connected gulf landscape with three viable countries and the shared Many Hearths settlement, preserving old coordinates and coastlines elsewhere.
- [x] Add communal berry cultivation: obtain seeds, plant, carry spring water, tend, grow, harvest, and replant. Plot count is independent of connected players.
- [x] Add obsidian outcrops, procurement credit, and exchange at Many Hearths.
- [x] Add country affiliation independent of character species, regional visits, and cooperative gathering contributions.
- [x] Add reachable walking routes, beach landings for existing boats, map labels, contextual actions and a regional travel panel.
- [x] Preserve saves and reconnect behavior; verify authority, multiplayer races, migration, land/water routes, rendering and mobile layout.

Five concurrent players remains the current operational default, not a settlement population or a permanent design limit. The first region uses room for visiting camps and 48 public crop plots. Reuse verified GLB geometry and textures with regional materials; do not replace existing models. Public deployment and paid services are not requested.

Later increments are tracked separately: [fishing](FISHING_PLAN.md), [shellfish, middens and obsidian spears](COASTAL_CRAFT_PLAN.md), [eight named residents with daily routines and help requests](VILLAGE_LIFE_PLAN.md), and [two additional fictional crops with hearth cooking](CROP_EXPANSION_PLAN.md). The residents' names, dialogue, daily exchanges and year-round presence are authored fantasy. Fire-root grass and aromatic grass are invented plants using existing grass models for their above-ground leaves, with distinct water, growth and food uses. All countries can grow every crop. Authored maritime weather, currents and route advice are implemented in [WEATHER_CURRENT_PLAN.md](WEATHER_CURRENT_PLAN.md). The current increment adds [household journeys and temporary stays](HOUSEHOLD_JOURNEYS_PLAN.md): each country's two residents can be helped to travel on foot to Many Hearths, stay for two game days and return. These household groupings, gifts and schedules are fiction, without an assertion of kinship or marriage. Permanent migration, population growth, wider politics and long-term food simulation remain separate work.

## Brief

Develop three culturally distinct Homo sapiens regional networks around a sea or large gulf, connected by coastal boats and overland travel. The region's largest shared place should be a convincing hunter-gatherer gathering camp, with recurrent exchange and communal activities. Consider a fourth group only if it adds a distinct function. Distinguish archaeological evidence, plausible inference, and deliberate fiction throughout.

## Work sequence

- [x] Create this plan before historical research or design recommendations.
- [x] Inspect the existing game's relevant world, travel, gathering, settlement, and multiplayer documentation so the proposal builds on what exists.
- [x] Research and compare approximately 30,000 years ago with a later Upper Paleolithic date; verify Homo sapiens and Neanderthal chronology and geography.
- [x] Research the Argolid/Franchthi landscape, period-specific coastlines and ecology, gathering evidence, nonlocal materials, and the limits of watercraft evidence.
- [x] Compare three viable regional cultures and at least three gathering locations, including a sheltered bay near a river mouth.
- [x] Design the gathering place, seasonal use, fictional social arrangements, compact route network, and conservative boat gameplay.
- [x] Reconcile the proposal with the existing game, identify incremental improvement priorities and historical-fantasy boundaries, and audit important claims against their sources.

## Research rules and deliverable

Prefer original research, archaeological institutions, and museums. Cite sources beside the claims they support. Keep calendar dates distinct from uncalibrated radiocarbon dates; do not import later settlement, boat, farming, or political evidence into an earlier setting. Nonlocal artifacts alone do not establish trade, and evidence of a water crossing does not establish a particular boat or regular commerce.

This file contains the recommended setting and date; comparisons of periods, cultural groups, and gathering locations; settlement layout, seasonality and social design; a text map and exchange routes; an evidence/inference/fiction register; and an incremental improvement sequence for the current game. Proposed changes to the existing world's historical framing are explicitly future design choices.

---

## 1. Recommendation and relationship to the existing game

**Improve CRO-MAGNON around a regional story called “Three Shores”: three Homo sapiens community networks meet at “Many Hearths,” a recurrent gathering camp beside a sheltered gulf. Use approximately 10,500 BCE, or 12,450 calibrated years BP, in the southern Argolid and western Aegean as the historical reference.** All proposed place and community names are invented.

This later Upper Paleolithic reference best supports the combination of varied regional lifeways, small-watercraft travel, and repeated gatherings. For the existing game, present the result as historically informed fantasy: retain its broader world and established characters while making the human communities, journeys, and shared camp more coherent. The recommended date is the reference for this regional design, not a claim that the game's present contents all belong to that date.

At the start of this research, the project already provided five-player rooms, gathering, camp contributions, cooking, exchange with Orl, shared boats, overland navigation, and exploration objectives. Its compressed Earth map measured 4,096 × 2,048 game metres with a 50,000 BP reference. The boat was a 3.8 m dugout with one occupant and five shared boats per room. Subsequent implementation raised the independent boat cap to 24, made the player cap configurable, and extended world bounds to 8,192 × 4,096 m while retaining the original Earth projection and adding the 1,480 × 1,340 m fantasy gulf. Sources: [current world definitions](C:/Users/yurin/Desktop/projects/CRO-MAGNON/shared/world.mts), [geographical reference](C:/Users/yurin/Desktop/projects/CRO-MAGNON/shared/paleo-geography.mts), [current gulf documentation](C:/Users/yurin/Desktop/projects/CRO-MAGNON/assets/gulf/README.md), [exploration documentation](C:/Users/yurin/Desktop/projects/CRO-MAGNON/assets/adventure/README.md).

**Reading key:** **Evidence** means an observed archaeological or environmental result within its stated scope. **Inference** means a reasonable interpretation or extrapolation, with alternatives. **Fiction** means an authored choice, including game balance, named peoples, detailed customs, and reconstructed objects without a local dated example. A source supporting one element does not authenticate the whole design surrounding it.

### Which period fits?

Here, BP means years before 1950; “cal BP” denotes calibrated calendar years. Approximate calendar conversions are used for readability. Older publications sometimes use uncalibrated radiocarbon years: those numbers cannot simply be copied into a calendar timeline.

| Priority | About 30,000 cal BP, approximately 28,050 BCE | Later Upper Paleolithic: approximately 10,500 BCE |
| --- | --- | --- |
| Recognizable regional cultures | Strong starting point. A study of Gravettian ornaments identifies patterned cultural variation across Europe; this is an interpretation of material patterns, not a map of named nations. [Baker et al., 2024](https://www.nature.com/articles/s41562-023-01803-6) | Also suitable, using local late Upper Paleolithic tool traditions and invented community identities. Three simultaneous ethnic groups around this gulf are not documented. |
| Substantial gathering places | Quite possible. Pavlov and Dolní Věstonice provide substantial approximately 30,000-year-old settlement references in Moravia. They are inland and far from Greece; accumulated remains do not directly reveal a single gathering's population. [Archeopark Pavlov](https://www.archeoparkpavlov.cz/en/), [Svoboda et al., 2019](https://doi.org/10.1002/gea.21740) | Repeated occupation is a sound basis. Franchthi's Final Paleolithic stratum U is placed broadly around 12,500–11,700 cal BP in the published sequence. It does not establish a large permanent village. [Stiner and Munro, 2011, table 1](https://doi.org/10.1016/j.jhevol.2010.12.005) |
| Boats and coastal connections in this region | Watercraft remain possible, but regular local coastal traffic needs a larger evidential extrapolation. Early Aegean crossing claims have disputed dating and geographical interpretation. [Papoulia, 2016](https://www.aegeussociety.org/en/new_article/late-pleistocene-to-early-holocene-sea-crossings-in-the-aegean-direct-indirect-and-controversial-evidence/) | Better fit. Carter locates the securely contextualized early Franchthi obsidian in lithic phase VI, in the eleventh millennium cal BCE. The small assemblage supports movement of island stone, not a fleet or commercial port. [Carter, 2016](https://doi.org/10.1017/S006824541600006X) |
| Living Neanderthal neighbours | Chronologically unsupported. | Chronologically unsupported, by an even greater margin. See the population assessment below. |
| Design cost | Good for an earlier Ice Age emphasis; maritime regularity remains a more conspicuous invention. | Best combined fit, with explicit inventions for the gathering's size, continuing availability, social rules, and exact boat. |

The later choice is a better match to the **regional maritime evidence**, rather than a claim that earlier people lacked sophisticated cultures or gathering places. Moving still later into the Mesolithic would strengthen some maritime comparisons, but is unnecessary to preserve this concept and would change the requested Upper Paleolithic frame.

### Human populations

**Evidence:** Cro-Magnon humans belong to Homo sapiens, our species. “Cro-Magnon” can remain the game's title; use Homo sapiens for the biological identity of all three main networks. [Smithsonian, Cro-Magnon 1](https://humanorigins.si.edu/evidence/human-fossils/fossils/cro-magnon-1)

**Evidence:** A major improved-dating study places the European end of the Mousterian around 41,030–39,260 cal BP and finds regional variation in Neanderthal disappearance. Neither 30,000 BP nor 12,450 BP provides a supported date for living Neanderthal communities in the Argolid. [Higham et al., 2014](https://www.nature.com/articles/nature13621)

An earlier Balkan setting around 45,000–43,000 cal BP is a defensible direction if actual contact becomes the priority: Homo sapiens from Bacho Kiro, Bulgaria, dated to 45,930–42,580 cal BP had recent Neanderthal ancestors. This establishes biological contact in that earlier population history; it does not establish a mixed gathering camp in southern Greece. [Hajdinjak et al., 2021](https://www.nature.com/articles/s41586-021-03335-3)

**Fiction for the existing game:** preserve Orl and playable Neanderthals as an explicitly surviving lineage in the fantasy world. This extends their survival by roughly 27,000 years beyond the usual disappearance estimate if the later reference date is used. Make that exception visible in the setting notes. Neanderthal ancestry within Homo sapiens is not equivalent to evidence for a surviving Neanderthal community.

Do not introduce Denisovans or island hominins as neighbouring Aegean peoples without matching local evidence. **Start with three Homo sapiens cultures and no fourth main group.** Later, occasional outer-coast Homo sapiens visitors can introduce a new route; an additional permanent culture should wait until its environment and relationships add more than another supplier.

### Landscape and ecological limits

Use a **fictional gulf inspired by the southern Argolid**, with limestone foothills, a river corridor, exposed coastal flats, and a deeper marine basin. At the chosen date, sea level was still substantially below today's, and much of the present shallow coastal area was land. Relative sea level also depends on local land movement: a single global offset cannot recover an exact ancient harbour. [Lambeck, 1996](https://doi.org/10.1017/S0003598X00083733)

**Evidence:** the date falls within the Younger Dryas, approximately 12,900–11,700 cal BP. Franchthi charcoal indicates an open almond–juniper landscape with local change, rather than a simple copy of modern Mediterranean vegetation. The promontory also has karst springs, now submerged, which researchers consider probably accessible in prehistoric periods. [Asouti, Ntinou and Kabukcu, 2018](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0207805)

Wild legumes occur in the site's Paleolithic botanical record. Include gathered plant foods alongside meat; gathering seeds is not evidence of agriculture. The game's generic food resources can initially represent that broader diet, with locally appropriate plant distinctions added later. [Asouti, Ntinou and Kabukcu, 2018](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0207805)

**Inference for the landscape:** use grass and scrub mosaics, patches of woody cover, wetter river margins, cold exposed uplands, and sheltered lowland pockets. Wood and reliable water should be unevenly available. Winter storms and summer water shortages create choices; the whole region should not become a continuous forest or a frozen wasteland.

**Evidence:** Franchthi's sequence includes red deer, wild equids, wild boar, aurochs, wild goats, hares, and other small prey, with changing proportions. These finds are not proof that every species was equally abundant at the selected moment. [Stiner and Munro, 2011](https://doi.org/10.1016/j.jhevol.2010.12.005)

**Design choice:** emphasize deer and small game in the lowlands, limited wild goats in rocky hinterlands, and shoreline foods near suitable shores. Wild equids and boar can be secondary possibilities. The current mammoths can remain elsewhere in the fantasy world; this evidence does not justify making them the Argolid's principal prey. Keep cactus, permanent ice corridors, and supernatural scenery outside this regional ecological reference.

## 2. Three regional cultures

The following comparison is **fictional cultural design grounded in the environmental framework above**. The names are English working labels, not translations of recovered Paleolithic languages. These are overlapping kinship and visiting networks; their memberships change through partnership, adoption, friendship, and residence. None owns an entire coloured third of the map.

All three gather plants, hunt, obtain workable stone, maintain fires, repair tools, and care for their members. Their food security must survive missed exchanges. Regional distinction should be visible in learned habits and material preferences, with individual variation and borrowed fashions.

| Dimension | Long Valley network | Pale Ridge network | Reed Shore network |
| --- | --- | --- | --- |
| Environment | Open river terraces and inland grass–scrub mosaics, with sheltered side valleys. | Limestone foothills, spring-fed ravines, and accessible chert-bearing exposures placed for the fiction. | Several sheltered coves, rocky shellfish shores, and a small wet river-margin patch; the coast is not uniformly reedy. |
| Seasonal movement | Small parties move among hunting and plant-gathering camps; exposed routes give way to lowland shelter in bad weather. | Families alternate sheltered lower ravines with higher resource visits when conditions permit. They do not occupy a permanently snowy summit. | Households move among coves and adjacent inland camps as weather, freshwater, and local foods change. Boats do not eliminate walking. |
| Subsistence | Deer, hares and gathered plant foods; occasional water-margin resources. | Mixed hunting and gathering, including rocky-slope game, lowland trips, and plant patches around springs. | Shellfish and accessible fish supplement terrestrial hunting and plant gathering; the sea is not their sole pantry. |
| Material preferences | Hide, sinew, antler and bone, plus workable river pebbles. | Selected chert nodules and pigment-bearing stones; hide, wood and plant fibres remain necessary daily materials. | Shell, plant fibre, driftwood, and coastal stone; suitable hull timber is obtained selectively, including inland visits. |
| Toolmaking signature | A preference for resharpenable cutting edges, hide-working tools, and careful repair of hafts. | Shared teaching routines for selecting nodules and producing small backed stone inserts; discarded bad stone is visible at working places. | Small cutting tools, shell perforation, cordage repair and boat maintenance. Exact fishing tackle remains a reconstruction choice. |
| Ornaments and visual recognition | Short tooth-and-shell pendants, asymmetrical sewn trim, travel-worn hide wraps. | Small matched shell groups and paired pigment marks on personal objects; no compulsory uniform. | Longer shell strings and distinctive cord ties; inland members can also wear shell ornaments. |
| Shelters | Portable low hide-covered frames, with extended communal windbreaks during gatherings. | Shelters near rock overhangs, low loose-stone windbreaks, and removable covers. No masonry houses. | Low framed shelters facing away from exposure, removable covers, and raised dry bedding. No stilt village. |
| Invented social tradition | Hosts tell the route by remembering people who offered shelter; a returned gift is recalled with its story. | Learning gatherings honour both the learner and the person who supplied a useful nodule; demonstrated skill grants temporary teaching authority. | Returning travellers recount unsafe landings and missing companions before describing what they brought home. |
| Contributions at Many Hearths | Worked hides, antler/bone blanks, suitable hafts, some preserved meat, and news of inland paths. | Selected stone, prepared blanks, pigments where locally available, and collaborative tool repair. | Shell ornaments, cordage, small quantities of fresh or preserved shoreline food, boat assistance, and coastal news. |
| Reasons to attend | Visit partners and relatives, replace damaged inserts, obtain coastal gifts, and arrange shared journeys. | Renew relationships, learn about lowland conditions, exchange tools or materials, and join collective meals. | Renew inland ties, obtain selected cutting stone or timber, replace worn hides, and find travel companions. |

The preference for backed inserts has a relevant regional foundation: Franchthi and Klisoura sequences document changing bladelet and geometric traditions. The exact three-way distribution above is invented; archaeological tool categories are not ethnic passports. Klisoura's occupation gaps also prevent treating it as the documented contemporary capital of the foothill group. [Çilingiroğlu et al., 2020](https://karaburunyuzey.wordpress.com/wp-content/uploads/2020/11/cilingiroglu-et-al_2020_jfa.pdf)

The languages, kinship terms, stories, motifs, and social meanings cannot be recovered from this evidence. Use fictional neighbouring speech varieties and multilingual visitors. Let players choose cultural affiliation independently of sex and appearance, with skills learnable across communities rather than hereditary profession bonuses.

## 3. Where should Many Hearths be?

These are **comparisons of hypothetical locations**, not identifications of discovered Paleolithic settlements.

| Location | Resources, access and advantages | Problems and seasonal weaknesses | Best role |
| --- | --- | --- | --- |
| **Sheltered bay beside a river mouth, on a raised terrace** | A spring supplies drinking water even if the river mouth becomes brackish or the channel shrinks. Nearby land, freshwater margins and shore provide different food options. A promontory reduces exposure; a beach permits hauling boats out. The valley brings inland visitors to the shore. Scattered woody cover and inland collection routes supply limited fuel. | Flood channels, muddy bars, storm surge and bank erosion make the actual river mouth a poor building site. Put shelters above flooding and behind the beach; launch away from the strongest outflow. Fuel and food become strained during a large gathering. Two differently oriented landing beaches improve, but do not guarantee, access. | **Strongest gathering location.** It combines routes and seasonal options without demanding major construction. |
| River confluence set back from the gulf | Freshwater, riparian fuel, inland paths, hunting access and potentially productive wet margins. A high adjacent terrace can provide dry shelter. | Floodplain floors can flood; the river may be too shallow, obstructed or swift for dependable boat access. Coastal visitors need a landing downstream and an additional walk. Local food abundance does not automatically make it the best meeting point for all networks. | Inland satellite gathering or bad-weather alternative. |
| Small island or promontory at a narrow crossing | Strong visibility from the water, convenient stopping point for crossing parties, rocky-shore foods and some sheltered beach options. A dry high area avoids river floods. | An island may lack dependable freshwater and fuel; useful camp space and terrestrial foods are limited. Exposure changes with wind, strait currents can be hazardous, and inland visitors depend on a boat or long detour. Being defensible does not make it socially neutral. | Seasonal lookout and short-stay landing; unsuitable as the main year-round gathering place unless extra resources are invented. |

**Choose the first option:** a terrace just inside the gulf's inner bend, beside a modest river and a spring, sheltered by a rocky shoulder. The camp overlooks its landing but sits clear of the river's active channels. The spring's dependable flow and the terrace's suitability are deliberate geographical specifications for the fictional site, not verified properties of an exact Franchthi-era location.

People return because this combination is unusually useful: shore travellers can stop without a difficult portage, inland paths converge nearby, visitors can disperse into several food zones, and a second landing offers an alternative in some winds. Established friendships and remembered hospitality then reinforce the geographical advantage. Competing coves remain useful, particularly when a gathering exhausts local fuel or severe weather changes the safest approach.

**Franchthi is a reference for landscape history and material use, not the proposed hub's historical identity.** Early coastal research describes a broad plain and river in front of the cave before later inundation. Today's water-edge cave and Kiladha Bay cannot simply be moved unchanged into this date. Shoreline-distance estimates differ between reconstructions; use the published palaeolandscape cautiously rather than assigning a falsely precise ancient beach to the cave entrance. [van Andel et al., 1980](https://doi.org/10.1179/009346980791505275), [Perlès, 2016](https://www.sciencedirect.com/science/article/pii/S1040618215005534)

No evidence consulted establishes Franchthi as a neutral exchange centre, a port, or the meeting place of three named peoples. Build a fictional shoreward camp inspired by the region's combination of water, terrain and routes.

Franchthi's adjacent open-air settlement, the Paralia, is Neolithic. Its presence must not be used to supply a built village for the Upper Paleolithic design. [Perlès, 2016](https://www.sciencedirect.com/science/article/pii/S1040618215005534)

## 4. Settlement layout, seasonal rhythm and social arrangements

### Occupation model

**Recommendation: a repeatedly occupied camp that expands for short seasonal gatherings.** Seasonal assembly is the conservative social interpretation to explore. The known sequence of repeated occupation does not tell us how many unrelated communities were present together, or establish uninterrupted occupation by permanent residents.

For gameplay, give Many Hearths a small **rotating presence** between gatherings. Some households are staying, others departing, and others arriving; familiar contacts can appear in different roles through the year. Guaranteeing somebody is always available is **fiction for playability**. A small permanent resident population could be imagined without farming, but is not established here and is unnecessary to provide reliable game services.

Suggested narrative scale is **15–30 people between events and roughly 80–120 during a short major gathering**, including children and elders. These are authored targets, not population estimates for Franchthi or a demonstrated carrying capacity. The surrounding seasonal ranges extend well beyond the playable slice. Large gatherings last days or a few weeks, bring provisions, and disperse before local shortages become severe.

### Layout

Everything in this layout is an **inferred practical arrangement or explicit reconstruction choice**. It is not an excavated plan of the proposed Greek camp.

- **Dry residential terrace:** a handful of occupied shelter clusters, each with bedding, tools and a small household hearth. Shelters fit the land, with gaps for movement rather than planned streets.
- **Visiting camp patches:** additional places for removable shelters farther along the terrace. Households choose neighbours through relationships; there are no three segregated national quarters.
- **Several shared hearths:** meal preparation, warmth, conversation, teaching and storytelling. An open patch between them accommodates larger gatherings without becoming a monumental plaza.
- **Exchange encounters:** goods laid on a hide or passed hand to hand near households and shared fires. No permanent stalls, price board, currency, taxation, or market administration is needed.
- **Craft areas:** well-lit stoneworking places away from sleeping areas and busy paths; hide-working and bone-working spots where waste is manageable. Their exact zoning is a design inference.
- **Food processing:** butchery and shell disposal separated from drinking water; small drying supports and modest household caches with spoilage and animal access risks. These support short-term provisions, not warehouses or a permanent surplus bureaucracy.
- **Freshwater path:** access to the spring is kept open; dirty processing occurs downslope and away from it. This is an invented practical rule.
- **Boat beaches:** one main landing and a secondary beach, with boats hauled above ordinary wave reach, repair space and simple carrying paths. No quay, stone dock, shipyard building or breakwater.
- **Retreat spaces:** a nearby sheltered hollow or rock overhang for exceptional weather, plus satellite camps along the river and coast.

Gönnersdorf in Germany provides a useful **distant Upper Paleolithic spatial analogy** for dwellings, hearths, pits and patterned activity areas. Its evidence does not authenticate this Greek layout or its social rules. [Sensburg, settlement study described by LEIZA](https://www.leiza.de/aktuelles/nachricht/neu-im-open-access-martina-sensburgs-publikation-zur-raeumlichen-organisation-der-konzentration-iia-von-goennersdorf)

### A useful place throughout the year

The schedule below is **fiction informed by resource seasonality**, not a recovered ritual calendar. Timing follows local conditions rather than fixed modern calendar dates.

| Season | Camp rhythm and reasons to visit | Playable activities |
| --- | --- | --- |
| Spring | Small arrivals, plant-gathering trips and repair after difficult weather. A larger meeting happens once routes and provisions allow. | Reconnect separated visitors, renew tools, gather shared meal ingredients, scout usable crossings. |
| Summer | Short visits and early or late travel; water and shade become more valuable. Exposed beaches may be poor camps despite apparently inviting weather. | Carry supplies between occupied coves, repair a boat, visit inland springs, arrange a group coastal trip. |
| Autumn | A major gathering timed around several available food sources and households' plans to move. Stored provisions supplement local gathering. | Collective food processing, gifts, teaching, contests and preparations for dispersed cold-season camps. |
| Winter | Fewer visitors; some households use sheltered sites nearby. Sea conditions make the land approach more important. | Shelter repairs, firewood assistance, tool maintenance, local journeys and shared meals. |

The camp's dependable services are **rest, social contact, repair, information and access to nearby routes**. Its stock of food and visiting specialists changes. Avoid an unchanging trader with infinite imported goods. A quiet winter camp remains useful without pretending the peak gathering lasts all year.

### Access and disputes: an invented social design

Many Hearths belongs to no ruler. Familiar host households remember previous visits and help newcomers find space. Access rests on hospitality and reciprocal obligations, including maintaining water access, collecting fuel and clearing dangerous debris. Nobody pays a border toll to a sovereign authority.

For a dispute, each side asks a trusted person to speak with them; an additional person accepted by both helps negotiate a remedy. Repairs, replacement of a damaged object, a shared work obligation, or temporary separation can settle a quarrel. Host households may refuse their own hospitality to a persistently violent visitor. These arrangements are **authored possibilities**, not an established Paleolithic institution.

The shared agreement is specific: no deliberate violence near the gathering fires, no obstruction of drinking water, and respect for occupied shelters and beached boats. Its strength comes from relationships and the possibility that people stop attending. It is not international law, a police force, or proof of universal prehistoric peacefulness. The game can enforce a safe camp as a clear play rule; that absolute enforcement is an additional abstraction.

## 5. Boats, exchange and the text map

### What the boat evidence permits

Keep four claims separate:

| Claim | Assessment |
| --- | --- |
| People or their materials crossed water | Island-sourced obsidian in a secure mainland context supports at least part of its journey crossing water. It need not have travelled directly from its source to its findspot. |
| A particular boat carried them | This does not follow from obsidian. No hull from the selected date and locality has been identified in the evidence reviewed here. |
| They repeatedly followed a particular route | Coastline reconstructions permit possible routes; source-to-findspot links do not identify every stop, traveller, season or frequency. |
| There was organized maritime commerce | This requires much more evidence than occasional nonlocal stone. A regular merchant service, port authority or commercial hub is not established. |

The distinction between indirect crossing evidence, actual vessels and later maritime networks is central to [Papoulia's review](https://www.aegeussociety.org/en/new_article/late-pleistocene-to-early-holocene-sea-crossings-in-the-aegean-direct-indirect-and-controversial-evidence/). Her vessel comparisons and experimental examples suggest possibilities; successful modern replicas do not prove that a particular design was used here.

**Recommendation for this game:** retain the existing small paddled dugout as a **plausible but unverified reconstruction choice**. The Pesse canoe in the Netherlands, dated by its museum to approximately 8250–7550 BCE, is substantially later and in another region. It demonstrates a surviving early logboat, not a dated model for the Argolid in 10,500 BCE. Hide-covered frames, reed bundles and simple rafts are alternative hypotheses; none is a securely attested local winner. [Drents Museum, Pesse canoe](https://drentsmuseum.nl/en/collection/pesse-canoe-the-oldest-boat-in-the-world), [Papoulia, 2016](https://www.aegeussociety.org/en/new_article/late-pleistocene-to-early-holocene-sea-crossings-in-the-aegean-direct-indirect-and-controversial-evidence/)

Use paddles, short coastal stages, visible destinations, and frequent opportunities to haul out. For the first version, keep one paddler per existing boat and a modest bundle of goods. Cargo limits should be a play rule, not an asserted archaeological carrying capacity. Suitable hull timber is a selected resource requiring access and labour; a dugout should not imply that every scrubby cove grows large straight trunks.

A route across the inner gulf can save time in favourable conditions. Wind exposure, breaking waves at a beach, river outflow, and currents near constrictions can make the same route unattractive later. Sheltered water is not automatically safe, and a coastline-hugging route can be dangerous along cliffs without landings. Provide a land alternative around the head of the gulf, plus a higher path when the low crossing floods. The first prototype needs choices between these routes, not a detailed ocean simulation.

Do not make the Melos journey a routine beginner crossing. It concerns a much larger maritime setting than the sheltered local circuit; island links and channel widths also changed with sea level. Leave distant island procurement as an eventual expedition, with its exact route requiring separate research. [Lambeck, 1996](https://doi.org/10.1017/S0003598X00083733)

### What exchange means here

**Inference:** nonlocal stone could arrive through direct collection, a household's seasonal movement, visits between relatives, gifts, or a sequence of transfers. More than one process can operate together. Carter discusses intermediary exchange and gift relationships as interpretations, particularly for later Mesolithic assemblages; those interpretations do not establish this camp's institutions at the chosen earlier date. [Carter, 2016](https://doi.org/10.1017/S006824541600006X)

**Fictional gameplay:** preserve the existing easy exchange interaction, but attach it to people and situations. Someone can lend a replacement tool, give food to a visitor, request help carrying stone, or offer shell ornaments in return for a prepared hide. An exchange is also a reason to meet someone, fulfil a promise, learn a technique or arrange travel. Avoid turning every interaction into a fixed-price sale.

Small, durable or already worked items are attractive travelling goods because they carry value without the burden of whole carcasses or large piles of raw stone. Short boat journeys can help move a limited load, but ordinary households continue obtaining most everyday materials within their own movements. Salt production, bulk grain imports, warehouses and specialist merchant households are unnecessary additions.

Coastal food remains also need restraint: Franchthi's marine-food contribution was modest in most phases, with later episodes of more intensive fishing. Make the Reed Shore community mixed foragers; do not borrow the cave's later tuna emphasis as proof of a large Upper Paleolithic fishing fleet. [Perlès, Food and ornaments](https://www.sciencedirect.com/science/article/pii/S1040618215005534)

### Text map: routes first

**Fictional functional geography:** a long gulf occupies the middle of the regional story and opens southward into a wider sea. Many Hearths stands on its northwestern inner bend. The hub is central in the journey network because inland paths meet coastal routes there; it need not occupy the geometric centre of the water.

To the **north**, the Long Valley route follows dry terraces beside the river. Plant patches, a hunting overlook and a small family camp lie along it. The floodplain offers useful resources but becomes a poor through-route when channels rise.

To the **west**, a sheltered ravine leads towards Pale Ridge. A spring, an exposed stone-collecting place and a working shelter form a chain of useful stops. A pass reconnects this route to the inland valley, so travellers can reach each other without always passing through Many Hearths.

Along the **eastern and southeastern shore**, the Reed Shore route follows a succession of coves. Rocky collection places alternate with landing beaches. A small wet margin supplies a different resource patch. A temporary coastal camp can move between two nearby coves according to conditions.

Across the **inner gulf**, a visible opposite headland marks the short optional crossing. It joins the coastal network to the gathering bay. A route around the gulf's head connects the same communities on foot. Neither a flooded lowland crossing nor a closed boat route should cut off every approach at once.

Farther **south**, exposed headlands lead out of the initial circuit. Their significance is visible, but long sea passages and new communities belong to later expansion. A small islet may be a stopping place only if the selected coastline leaves it an island; no modern island is automatically assumed to have been separated then.

The map therefore has a loop and a cross-link: **Many Hearths → inland valley → ridge pass → Many Hearths**, plus **Many Hearths → head-of-gulf land route → coastal coves → optional boat crossing → Many Hearths**. Put resources and relationships along these journeys, with intermediate refuges, rather than three equal territories around a city.

### Compact scope and the existing global map

Begin with **one gathering camp, three satellite stops, two useful boat landings, one optional crossing, and two overland approaches**. Reuse nearby resource patches and the exploration journal for the first complete circuit. A planning target is a connected coastal area roughly **450–700 game metres across its long axis**, with most direct journeys lasting a few minutes once activities are included. This is a provisional play-space target, not a verified fit or a historical geographical scale.

The existing projection shrinks the real Argolid far below the space needed for a character-scale settlement. Consequently, **a literal Argolid reconstruction cannot be inserted at its present global scale**. Fit the Three Shores story to a suitable portion of the existing sea and coast as an openly fictional analogy. Keep the global outline as the default; exact placement and the target footprint need a later in-game survey. Do not claim that the current 50,000 BP coastline has thereby become the coastline of 10,500 BCE.

If a faithful local Argolid map is ever desired, it would require a separately planned change of geographical scale and coastline reference. It is not part of this improvement proposal. The current wider world remains available beyond the focal network, and its remote environments do not become adjacent ecological zones within the historical reference region.

The cultural networks' full seasonal ranges and populations extend beyond what five players can see. NPC presence and changing occupied shelters can suggest a larger gathering; the first improvement does not require scores of fully simulated residents or larger multiplayer rooms.

## 6. Evidence, inference and fiction register

| Element | Established or reported evidence | Plausible inference | Deliberate fiction or limit |
| --- | --- | --- | --- |
| Human identity | Cro-Magnon fossils are Homo sapiens. [Smithsonian](https://humanorigins.si.edu/evidence/human-fossils/fossils/cro-magnon-1) | Communities can share a species while differing culturally. | The three networks, their names, affiliations and speech varieties. |
| Regional culture | Ornament patterns and local tool sequences vary. [Baker et al.](https://www.nature.com/articles/s41562-023-01803-6), [Çilingiroğlu et al.](https://karaburunyuzey.wordpress.com/wp-content/uploads/2020/11/cilingiroglu-et-al_2020_jfa.pdf) | Social learning and visiting can maintain differences alongside borrowing. | Exactly three cultures; motifs, beliefs, customs and territorial associations. |
| Neanderthals | Verified earlier overlap and much earlier disappearance. [Higham et al.](https://www.nature.com/articles/nature13621), [Hajdinjak et al.](https://www.nature.com/articles/s41586-021-03335-3) | Earlier contact can inform how relationships are imagined. | Surviving Neanderthals at the recommended later date; Orl's personal history. |
| Environment | Lower past shorelines and a changing local vegetation record. [Lambeck](https://doi.org/10.1017/S0003598X00083733), [Asouti et al.](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0207805) | Different nearby habitats support complementary seasonal choices. | Exact gulf, dependable spring, stone exposures, safe terrace and resource placement. |
| Gathering camp | Repeated occupations; substantial Upper Paleolithic camps elsewhere. | Productive, accessible places can attract recurring visits. | Many Hearths, its rank as the region's largest camp, simultaneous attendance and population targets. |
| Exchange | Island stone occurs in mainland contexts. [Carter](https://doi.org/10.1017/S006824541600006X) | Direct collection, movement, gifts and transfers are alternative or combined explanations. | This site's exchange customs and any fixed game conversion rates. |
| Boats | Indirect crossing evidence; later surviving boats. [Papoulia](https://www.aegeussociety.org/en/new_article/late-pleistocene-to-early-holocene-sea-crossings-in-the-aegean-direct-indirect-and-controversial-evidence/), [Drents Museum](https://drentsmuseum.nl/en/collection/pesse-canoe-the-oldest-boat-in-the-world) | Small manually propelled craft can serve the chosen short routes. | The current hull, handling, crafting recipe, cargo and guaranteed repeatable route. |
| Shelter and camp layout | Hearths and spatially organized activities at comparative sites. [LEIZA](https://www.leiza.de/aktuelles/nachricht/neu-im-open-access-martina-sensburgs-publikation-zur-raeumlichen-organisation-der-konzentration-iia-von-goennersdorf) | Dry shelter, water access and waste separation have practical advantages. | The precise structures, neighbourhoods and working areas here. |
| Year-round usefulness | A long archaeological sequence does not establish uninterrupted residence. | Overlapping visits could repeatedly leave someone at a favourable camp. | Guaranteed contacts and services in every game season. |
| Social arrangements | No local evidence reviewed identifies the proposed institutions. | Hospitality and negotiated remedies can make a gathering workable. | Shared rules, mediation, camp safety enforcement and access arrangements. |

**Minimum adaptations needed for the core concept:** invent a specific meeting site and its three communities; reconstruct a small watercraft; make short boat routes more regular and legible than the evidence demonstrates; guarantee a modest off-season presence; and compress distance and population for play. No farming, state, sailing ship or town architecture is required.

**Additional adaptations required to preserve this particular game's identity:** surviving Neanderthals, the mixed chronological frame of the current global world, magical characters, the crow beings, castle, supernatural travel, and mammoth riding. These are existing fantasy commitments, not consequences of archaeological research. Keeping them does not require rebuilding the game; it requires honest setting language.

Do not derive the gathering settlement's architecture from the existing castle. Keep the castle as a fantasy destination and develop Many Hearths from the camp, hearth and shelter vocabulary. Likewise, a crafting action labelled “stone axe” or “build boat” is a game abstraction, not proof of the exact regional technology or production time.

## 7. Sources and research limits

Important claims are cited beside the relevant passages. The following notes identify what each source contributes and prevent applying it outside its date or region. Sources consulted on 2026-09-08.

| Source | Use and boundary |
| --- | --- |
| [Smithsonian Human Origins, Cro-Magnon 1](https://humanorigins.si.edu/evidence/human-fossils/fossils/cro-magnon-1) | Museum identification of Cro-Magnon as Homo sapiens. Not a source for all details of this fictional population. |
| [Baker et al. (2024), Evidence from personal ornaments suggest nine distinct cultural groups between 34,000 and 24,000 years ago in Europe, Nature Human Behaviour](https://www.nature.com/articles/s41562-023-01803-6) | Original comparative ornament research. Supports variation at the earlier comparison date, not three recovered Argolid ethnicities. |
| [Archeopark Pavlov](https://www.archeoparkpavlov.cz/en/) and [Svoboda et al. (2019), Pleistocene landslides and mammoth bone deposits: The case of Dolní Věstonice II, Geoarchaeology](https://doi.org/10.1002/gea.21740) | Museum overview and original research on large Moravian Gravettian sites. Geographically distant; site extent is not a simultaneous population count. |
| [Stiner and Munro (2011), On the evolution of diet and landscape during the Upper Paleolithic through Mesolithic at Franchthi Cave, Journal of Human Evolution](https://doi.org/10.1016/j.jhevol.2010.12.005) | Original faunal study; calibrated sequence in table 1, species variation, and later changes in fishing. Full text inspected through the authors' posted copy. |
| [Carter (2016), Obsidian consumption in the Late Pleistocene–Early Holocene Aegean, Annual of the British School at Athens 111: 13–34](https://doi.org/10.1017/S006824541600006X) | Original sourcing study and contextual review. The Franchthi discussion supplies the chronological anchor; the new Crete data are Mesolithic and are not silently transferred earlier. Full text inspected through the author's posted copy. |
| [Higham et al. (2014), The timing and spatiotemporal patterning of Neanderthal disappearance, Nature](https://www.nature.com/articles/nature13621) | Original chronological modelling; regional variation and the absence of support for a 30,000 BP or later Neanderthal community here. |
| [Hajdinjak et al. (2021), Initial Upper Palaeolithic humans in Europe had recent Neanderthal ancestry, Nature](https://www.nature.com/articles/s41586-021-03335-3) | Original ancient-DNA evidence from Bacho Kiro, Bulgaria. An earlier Balkan contact reference, not an Argolid village excavation. |
| [Asouti, Ntinou and Kabukcu (2018), The impact of environmental change on Palaeolithic and Mesolithic plant use and the transition to agriculture at Franchthi Cave, PLOS ONE](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0207805) | Original charcoal analysis and reassessment of plant evidence. Distinguishes Late Glacial/Younger Dryas vegetation from later Mesolithic and Neolithic conditions. |
| [Lambeck (1996), Sea-level change and shore-line evolution in Aegean Greece since Upper Palaeolithic time, Antiquity](https://doi.org/10.1017/S0003598X00083733) | Original regional shoreline modelling. Uses conventional radiocarbon ages unless specified; its time labels are not automatically cal BP. Published in 1996 despite a later online date. |
| [van Andel, Jacobsen, Jolly and Lianos (1980), Late Quaternary History of the Coastal Zone near Franchthi Cave, Journal of Field Archaeology](https://doi.org/10.1179/009346980791505275) | Original marine-geophysical landscape study; consulted published abstract for the coastal plain and river. No precise local reconstruction is claimed from it. |
| [Perlès (2016), Food and ornaments: Diachronic changes in the exploitation of littoral resources at Franchthi Cave, Quaternary International 407: 45–58](https://www.sciencedirect.com/science/article/pii/S1040618215005534) | Original assessment of marine food and ornamental resources; accessible abstract and indexed article passages consulted. Rejects a simple equation of coastal proximity with intensive fishing. |
| [Çilingiroğlu et al. (2020), Between Anatolia and the Aegean: Epipalaeolithic and Mesolithic Foragers of the Karaburun Peninsula, Journal of Field Archaeology](https://karaburunyuzey.wordpress.com/wp-content/uploads/2020/11/cilingiroglu-et-al_2020_jfa.pdf) | Original regional study with discussion of Franchthi/Klisoura tool sequences and occupation gaps. The invented network is not identified with one excavated cave. |
| [Sensburg (2007), Gönnersdorf spatial study; LEIZA open-access notice (2024)](https://www.leiza.de/aktuelles/nachricht/neu-im-open-access-martina-sensburgs-publikation-zur-raeumlichen-organisation-der-konzentration-iia-von-goennersdorf) | Archaeological institution's account of dwelling, hearth, pit and activity-space analysis. Used only as a distant settlement-layout analogy. |
| [Papoulia (2016), Late Pleistocene to Early Holocene Sea-Crossings in the Aegean, CNRS Éditions, pp. 33–46](https://www.aegeussociety.org/en/new_article/late-pleistocene-to-early-holocene-sea-crossings-in-the-aegean-direct-indirect-and-controversial-evidence/) | Specialist review of direct, indirect and disputed evidence. Publication details and abstract checked through Aegeus; the author's posted text was also consulted. |
| [Drents Museum, Pesse canoe](https://drentsmuseum.nl/en/collection/pesse-canoe-the-oldest-boat-in-the-world) | Museum object record for the later Dutch logboat. Used explicitly as a comparison and chronological limit. |

The major unresolved matters are the exact local palaeoshoreline and spring discharge, peak contemporary attendance, occupation seasonality, boat construction, and the form of relationships behind nonlocal material. Those remain uncertainties or authored choices. Submerged ancient shorelines also limit the surviving record; missing coastal camps are not permission to invent a known trading port.

Research is sufficient for this worldbuilding proposal because the period, population compatibility, environmental reference and maritime limits have been checked. It is not an exhaustive archaeological survey or a reconstruction of an excavated settlement.

## 8. Incremental improvement sequence

**Build a more connected regional experience with the systems already present.** The following are future priorities, not completed implementation or authorization to replace the world.

| Priority | Improvement | Existing foundation | Reviewable outcome |
| --- | --- | --- | --- |
| 1 | Establish the Three Shores story and explicit history/fantasy distinction. Add affiliations to the human community descriptions independently of character species. | Existing profiles, NPC dialogue, exploration journal and world map. | Players understand who visits whom and why, while the current world and characters remain recognizable. |
| 2 | Develop one appropriate existing camp area into Many Hearths through placement, dialogue and shared objectives. Select the actual site by surveying current coast access first. | Camp contributions, hearths, shelters, rest, cooking and existing resource models. | A shared preparation task brings all five players to the camp; visiting areas and the landing are easy to understand. |
| 3 | Connect three nearby satellite stops with a land loop and an optional boat crossing. | Existing navigation, boats, map destinations and exploration objectives. | Players complete a full visit–collect–help–return circuit, with an alternative when they choose to avoid the water. |
| 4 | Add social context to resource transfer: requests, gifts, repairs and return visits. | Existing inventory, exchange interaction and individual exploration rewards. | Each community gives several reasons to visit without monopolizing an essential survival resource. |
| 5 | Add a modest seasonal rotation and variable visiting households. Expand ecological detail only where the gameplay benefits. | Current regional content, resource placement and reusable assets. | The camp remains useful in every season, while food, attendance and preferred routes change. |

The first satisfying loop can use current wood, stone and food: **help prepare a gathering → visit three communities → choose a coastal or inland return → contribute to a shared meal and repairs**. Treat generic resource categories as provisional abstractions. Distinct chert, shell ornaments, hides, fish and locally appropriate fauna can follow selectively; the proposal does not depend on recreating every model or building an entirely new economy.

Preserve existing saves, journeys, adopted models, multiplayer capacity and wider exploration during future improvements. Reuse the TRELLIS assets under the project's established production rules; any genuinely necessary future model remains a separately scoped asset task. Do not substitute a new engine, new global map or newly generated asset set for improving the current game.

Before implementing the regional placement, check that the current coast offers dry camp space, two workable approaches, safe boat landing, and room for all five players. Exact coordinates, collision fit, journey times and performance have **not** been tested by this research task. The outcome delivered now is this source-backed setting and improvement plan.
