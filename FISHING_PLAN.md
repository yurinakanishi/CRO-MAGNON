# Fishing in Three Shores

Started 2026-09-08. Continue improving the existing expanded world with a complete fishing, cooking and shared-meal loop.

## Scope

- Make a reusable fishing kit from existing wood and stone. Fish from marked shoreline places or a stationary canoe; keep ordinary gathering, farming and hunting viable.
- Use server-controlled fishing time, finite shared shoals and gradual recovery. Validate distance, obstacles, movement, inventory capacity and simultaneous catches. Cancel safely on travel, combat, disconnection and defeat.
- Cook fish at existing fires, eat it for energy, or contribute cooked fish as an alternative to berries at Many Hearths. Preserve existing feast requirements and progress.
- Add nearby actions, progress feedback, inventory controls, route markers and controller access using existing UI and assets. Keep the three countries and fantasy setting.
- Preserve supplies, the kit, catch records and shoal depletion in existing save/export and reconnect mechanisms. Do not resume unfinished catches after reconnecting.
- Verify authoritative rules, save compatibility, multiplayer contention, actual browser interactions and responsive layouts. Roll out locally after validation.

## Evidence and adaptation

Fishing and aquatic foods are a reasonable prehistoric inspiration. These particular locations, reusable kit recipe, catch timers, fish stocks and meal conversion are deliberate game design. They do not establish fishing tackle or regular maritime commerce in the game's approximately 50,000-year-old geographical reference. No new archaeological claims or reconstructed fish/boat models are part of this change.

## Work

- [x] Implement the server rules, cooking, shared meals and persistence.
- [x] Integrate world markers, controls, inventory and guidance.
- [x] Validate rules, multiplayer, browser play and existing content.
- [x] Document the result and update the local game.

Delivered seven fishing grounds, a reusable kit, raw/cooked fish, stock recovery, cooking/eating and food contributions. All 240 tests passed; the final 17 related checks passed after cancellation refinements. Real Chrome checks covered shore and canoe catches, travel, cooking, eating, sharing, controller input, reload and responsive layouts. The local server was empty before restarting with the final build; no old checkpoint was restored. See [fishing notes](assets/fishing/README.md) and [QA summary](assets/fishing/qa-summary.json).

NPC household schedules, further crop species and simulated maritime weather remain future work. Public hosting and billing are outside this increment.

Subsequently completed locally: [貝の暮らしと黒曜石の道具](COASTAL_CRAFT_PLAN.md), added at the user's request. Shellfish, shared middens and crafted spearheads extend the coastal food and material-procurement loops.
