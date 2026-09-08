# Four-area expansion verification

This extends the existing game. `WORLD_EXPANSION_PLAN.md` records the scope; the parent `README.md` describes the current playable region. The original version-1 QA records remain in the parent directory.

- `qa-summary.json`: scope, tests, limitations and browser fixtures.
- `routes-qa.json`: shared-collider path lengths, launch points, every original scenery placement, and sampled terrain orientation.
- `game-qa.json`: the public snapshot after a two-Chrome/three-WebSocket session, observations, FPS samples and fixture disclosures. No session tokens.
- `delivery-qa.json`: 33 existing models / 48 delivered GLBs, hashes and structure. Its adventure placement counts describe the reused verifier's original scope; the gulf's nineteen formations are counted separately in `routes-qa.json`.
- `rollout-qa.json`: fresh checkpoint handling, final local server identity, versions and served-file hashes. Private checkpoints remain ignored under `output/gulf-expansion/`.

Run `node scripts/build.mjs`, then `node --test tests/gulf-expansion.test.mjs tests/gulf.test.mjs` for the focused regression tests. Run `node scripts/qa-gulf-expansion.mjs` in an interactive terminal for the isolated browser helper; `PLAYWRIGHT_MODULE` can override the existing bundled runtime. It starts its own temporary server and accepts one JSON command per line. Use `{"type":"quit"}` to stop it. Replays write under `output/playwright/gulf-expansion/` by default.

The helper's `fixture` command changes only its isolated QA room and is deliberately separate from ordinary UI commands. The actual run used ordinary movement from Many Hearths through the first two stops; the other four stop arrivals and final return were fixtures. Boat starting position and twelve wood were fixtures, followed by ordinary crafting, boarding, the complete crossing, landing and walking to Reed Shore. Crop growth used real elapsed time. The subsequent quarry visit began with a camp-position fixture and continued on foot to ordinary obsidian gathering.

The final north-east boundary correction retained 31 original trees and 13 original rocks in the continental corner of the gulf's rectangular map extent. An exhaustive preservation comparison and the full test suite were rerun afterward. It changes neither the tested gulf paths nor the settlement/crop/landing coordinates.

The screenshots are verification captures, not new game assets. Frame-rate samples include a single 8 FPS reading immediately after reload; the other fifteen readings were 58–60. These snapshots do not establish sustained performance. Physical phones/controllers, larger player loads and long-duration sessions were not tested in this expansion.
