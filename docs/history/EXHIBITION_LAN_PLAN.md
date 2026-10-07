# Exhibition / LAN mode

2026-09-09: PC1 hosts the existing authoritative game core on `0.0.0.0`.
Each PC serves an identical, self-contained build on localhost; only WebSocket
gameplay and small diagnostics cross Ethernet. Online keeps its existing
same-origin `/ws`, Cloudflare status/budget behavior and guest profile flow.

- Runtime mode/URL, room, client port and browser launch are configurable.
- Separate Windows host/client launchers, offline package with Node and ws,
  file hashes, build compatibility checks, reachability/status diagnostics.
- LAN never probes Cloudflare, loads third-party assets, or switches to a
  different server when connection fails. Guest identity/session is isolated.
- Local movement prediction in LAN, authoritative reconciliation and existing
  remote interpolation. Existing combat/interaction authority is retained.
- Tests cover two separate local HTTP origins, common WebSocket server,
  bidirectional movement/actions/shared state, failure/reconnect, asset locality,
  offline browser requests, online regression and packaging integrity.
- Document static Ethernet IPs, Private-only firewall rule and day-of checklist.
  Physical PC2 browser/offline cable acceptance must be distinguished from
  same-machine browser and protocol tests.

Initial observation: Ethernet `169.254.141.230/16`, peer `169.254.232.213`
responds twice under 1ms. Wi-Fi active. No `10.10.10.1` configured.
Online/local server PID 20716 on 3000; Docker PID 5252 occupies loopback 8080.
Do not stop either process or reuse old world checkpoints. Other uncommitted
resident-foraging edits were present before this task and must be preserved.

Implemented and verified: runtime Online/LAN config; loopback-only asset server;
sync-only 0.0.0.0 game server; guest/session separation; SHA build matching;
Windows host/client launchers with bundled Node/ws and no launch-time install;
local prediction with shared movement/navigation/collision, including boat and
mount speed/radius, and existing remote interpolation. Settings use port 8081
because Docker occupies 8080 on this PC. No IP/Firewall changes or existing
server restarts were performed.

343 tests pass, final relevant 14 pass. Actual Chrome two-origin LAN browser
test plus Online regression pass, with zero external requests/errors. Bundled
runtime startup, wrong host IP, duplicate port and client discovery pass.
Ethernet is Up at 100 Mbps, currently Public. Physical two-PC Wi-Fi-OFF
acceptance still needs the fixed-IP/Firewall/copy checklist in README-EXHIBITION.md.
See assets/exhibition-lan/qa-summary.json for fixtures and limits.

2026-09-09 physical setup follow-up: configured PC1 10.10.10.1/24 and PC2
10.10.10.2/24 on direct Ethernet, copied and hash-verified the offline package
over SSH/SCP, and launched localhost clients on both PCs. User confirmed joining
the same room after correcting a room-name typo (EXIHIBITION -> EXHIBITION).
SSH key is retained by explicit user instruction; key login is verified.
README-EXHIBITION-NOW.md records exact paths, startup, status locations and
troubleshooting on both PCs. Two-PC Wi-Fi-OFF and full action acceptance remain
unverified; do not equate the user's room-join success with those checks.
