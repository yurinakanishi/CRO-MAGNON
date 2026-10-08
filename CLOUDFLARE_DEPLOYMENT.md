# CRO-MAGNON: zero-charge Cloudflare deployment

The user's latest requirement allows the **$5/month base fee if necessary, but forbids all metered overage charges**, even if the game must stop. This game can run on Workers Free, so no new base-fee subscription is needed. Continue to reject Workers Paid as a deployment target: application counters and budget alerts do not establish a hard zero-overage billing boundary, and refused requests can still be metered. Do not interpret the $5 permission as permission for pay-as-you-go overages or changes to unrelated subscriptions.

## Current status

Latest deployment: **2026-10-06**, version `d525625d-e3bc-4438-b845-1777a28e9992`, on the same verified CRO-MAGNON Free account and Durable Object namespace. The current shared-source updates include inventory boats and crafting-menu-only boat production. Optimized public assets: 488 files / 485.3 MiB / 105 GLBs. Live five-player/reconnect/model integrity and 49 static-file checks passed. [Release record](docs/mmo-deploy-2026-10-06.md). Earlier dated records below remain historical.

Updated and live-verified on **2026-10-01** on the dedicated **CRO-MAGNON Free** account (`a211102818d484cb668c6b62bebff3f9`) after its Workers plans dashboard showed **Free / $0 / Current plan**. [Public game](https://cromagnonmmo.cro-magnon.workers.dev/). Current version: `2024e6ad-e30e-47de-9679-1daa52789715`. Five actual WebSocket clients, sixth-player refusal, movement, attack, reconnect and all **81 served GLB hashes** passed, including three split models. Chrome showed eight public character choices and rendered Howkey online without warning/error logs. Maruimo remains available locally and is excluded from the public build.

The Worker was renamed through its existing dashboard settings, retaining Durable Object namespace `9071351c3ff8445d8ce2eebdb7822cec` and its saves. Its old URL now returns 404. The old cloud checkpoint used worldVersion 2; the supported migration and exact original SQLite backup remain intact. Local SQLite tests verified legacy restore, exact backup, runtime eviction, usage limits and storage failures. Long-duration play and physical-device performance remain unverified. No paid subscription or additional chargeable service was created. A read-only recheck at **19:36 JST** returned healthy APIs, zero players and 404 at the previous URL.

Historical billing evidence on 2026-09-07 showed **Workers Free / Active** and **No payment method on file** on the dedicated account. This is dated evidence, not a new billing inspection. The unrelated original account was not downgraded or otherwise modified.

Billing follow-up on the unrelated original account on 2026-09-07: an active billable subscription is not evidence of a current nonzero charge. Its Workers and R2 usage views show zero usage cost; these views exclude fixed subscription fees. Its subscriptions list shows R2 Paid and Images Stream Basic but no Workers subscription, despite the Workers plans page's Paid label. Current recurring Workers fees there remain unconfirmed. This discrepancy does not establish Workers Free or authorize deployment there. Private invoices and refund documents were inspected separately and are not included in this repository.

`assets/cloudflare/account-verification.json` records the observed account/plan. Before every deployment, read the exact destination's [Workers plans dashboard](https://dash.cloudflare.com/a211102818d484cb668c6b62bebff3f9/workers/plans), confirm **Free / $0 / Current plan**, then record that actual observation and time. Never refresh the timestamp or mark the plan Free without observing it. The deployment script rejects Paid, unknown, or evidence older than 15 minutes. Existing Wrangler OAuth has account/user read and Worker deployment/log scopes; it cannot read billing subscriptions through the API. Plan verification therefore uses the dashboard, not the API's `default_usage_model`.

## Public and local credits

The local source `src/title-credit-profiles.ts` retains yuri, all four supervisors and all guest profiles and images. All home screens put the developer, supervisors and guests in the **関わってくれた人たち** dialog, with icons and names and no QR codes. Online cards link to X; exhibition cards have no external links. The local contributor dialog retains the supervisors; guest icons and links follow the currently enabled mascot roster. The MMO asset manifest omits unused QR images while their source files remain in the repository.

`cloudflare/public-release.json` controls only the Cloudflare build:

```json
{ "credits": "full", "excludedCharacters": ["maruimo"] }
```

The current `full` setting publishes **yuri, supervisors Ryuichi-typeR / ぬこぬこ / オータニ / 浦田, and guests R-524 and りも(Limo)**. The supervisors appear in that order in **監修**, with their existing X icons and links. Dormant guests still follow the mascot roster and stay excluded. The alternative `public` setting publishes only yuri and the enabled guests and excludes supervisors' avatars. Neither setting includes QR images.

As of 2026-10-08, `shared/mascot-roster.mts` enables only **Dots (all nine), りもねこ and 524**. Mae, Kohaku, the Maruimo mascot, all seven contributor mascots and Howkey stay in the repository with their accepted GLBs, LODs, rigs, animations, portraits and production history. They are not generated in default rooms, downloaded by the browser, or copied to the MMO release. Howkey's flask is also omitted. All cave paintings and their textures stay unchanged. Hidden companion checkpoints remain private in saves and can restore their owners and positions when enabled later.

To restore one retained mascot, set its `enabled` flag to `true` in `shared/mascot-roster.mts`, rebuild and verify the release, then deploy only when requested. This restores the camp companion, selection card, guest credit and MMO model files together. The existing local visibility switches must also permit Mae or Howkey when restoring either locally. Supervisor credits remain independent of their dormant mascots.

Howkey is now a **mascot**, not a selectable player. Its original scientist model, 1.55 m scale, skin, clips and flask are unchanged. The companion adapter uses its existing Head bone for pet contact, Idle_Loop while being petted or hit, and Wave for happiness/idle gestures. Its retained character definition has `playable: false`, so choices, character switches and joins refuse it even when the local switch is true. A legacy Howkey player save resumes as a valid player while keeping possessions and its original private appearance record. Enabling the mascot does not turn it back into a player.

For isolated verification without replacing the preview's upload folders, use `npm run build:mmo -- --output-root=output/<new-build-name>`, then `node scripts/verify-mascot-release.mjs output/<new-build-name>`. The output root must be a new subfolder of `output/`. The normal deploy command still assembles the canonical upload folders and enforces its optimization/account guards.

User instruction on 2026-10-08 restored the four supervisors in the public build configuration. Deploy only when requested, after verifying that the exact account is still Free as described above. To hide supervisors again, change `credits` to `public`, rebuild and verify. No source profiles or local images need to be recreated. `qa-cloudflare-release.mjs` verifies the selected setting, including supervisor avatars and the absence of QR images.

## Local-only characters

`shared/character-profiles.mts` retains all nine local character definitions. The public build filters `excludedCharacters` before reading character models, copying portraits or generating manifests. Maruimo's GLB, LOD, split parts, portrait, manifest, profile and dedicated octopus pose module are omitted. Its portrait CSS is also removed. All seven former file URLs were checked as 404 at the new URL.

The browser and uploaded Worker use the same seven-character catalog (Howkey is retained as a dormant mascot). The Worker entry is assembled under `dist-cloudflare-worker`, using filtered shared modules rather than the local catalog. The deploy guard audits both upload directories and the actual bundled Worker before uploading. This prevents hiding the card while still uploading its data. Confirming a removed character through a forged request, or resuming an old saved appearance, uses a valid public character and retains possessions. Local normalization retains all nine historical definitions, with Howkey excluded from player choices.

The previous release had already included Maruimo. This update excludes it from the current serving paths and new uploads; it does not claim to erase files already received by visitors or Cloudflare's private version history. Preview URLs remain disabled. Do not upload the ordinary local `public` directory or `dist/shared/character-profiles.mjs` directly.

## Architecture and limits

- Worker `cromagnonmmo`, platform-provided workers.dev URL, no domain purchase. Its namespace keeps the original display label `cro-magnon-free_FreeGameRoom`; renaming that label or recreating storage is unnecessary.
- Static Assets: website, JS/CSS, motion model/runtime, title images, 81 adopted GLBs including LODs, eight character portraits and external cave textures. The current build contains 404 files including `_headers`, totaling 500.2 MiB. No R2, D1, external database, AI, image transformation, containers, queues, cron, paid builds or other chargeable binding. Observability/telemetry remains disabled.
- One SQLite-backed `FreeGameRoom` instance named `EMBER`; at most 5 players. Arbitrary room names cannot create additional objects. Local Node server retains multiple rooms.
- Node and Workers use the same `application/game-core.mts` and shared domain modules. Physics remains 50 ms, state broadcast about 100 ms.
- The public build generates its own multiplayer config: online, current origin, room `EMBER`, movement refresh 140 ms. Stops bypass that repeat interval. Keyboard/gamepad direction changes also send immediately. Local config and its existing defaults are preserved.
- Active WebSockets intentionally keep the world running. No timer runs once the last socket disconnects. This is continuous simulation while occupied, not idle chat hibernation.
- Application ceilings: 12 hours of active room time/day, 400,000 received application messages/day, 2,000 connection attempts/day, 20,000 checkpoint writes/day. Whichever is reached first stops play. These are **not promises of 12 playable hours**: other limits may be reached first.
- Active time is reserved in 60-second blocks and messages in 1,000-message blocks, persisted before use. Restarting may waste the unused reservation but never restores consumed allowance. Daily counters reset at UTC midnight / 09:00 JST. Platform quotas are account-wide and remain the final hard stop on Workers Free.
- Origin validation, 2 KB input cap, original input throttles, no private files in static output. Tokens never appear in public world snapshots.

Cloudflare Static Assets requests and storage are free; `/ws` and `/api/*` invoke the Worker and use its quotas. The platform currently allows 20,000 static files per Free Worker version and 25 MiB per file. [Static Assets billing](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/), [platform limits](https://developers.cloudflare.com/workers/platform/limits/).

Three public GLBs exceed that per-file limit: cro-magnon-woman, neanderthal-woman and Howkey. The build splits their original bytes into at most 24 MiB content-addressed parts, records each part's length/SHA and verifies exact reconstruction. The browser checks the parts and full original SHA before parsing. Smaller GLBs are copied unchanged; geometry, textures, rigs and animation are preserved. World manifests keep their original world membership so character models are loaded on demand.

Current Durable Objects Free quotas include 100,000 requests/day, 13,000 GB-s/day, 5 million SQLite rows read/day, 100,000 rows written/day and 5 GB total SQL storage. Incoming WebSocket messages use a 20:1 compute-request billing ratio. Free quota exhaustion fails further operations; daily limits reset at 09:00 JST. The application ceilings above may stop play earlier, so five players do not imply uninterrupted daily operation. [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/).

## Saving and stopping

SQLite stores the world, camp, resources, animals/enemies and resume sessions. Inventory/camp/resource/combat-result changes save before queued state is released; positions save at least every 30 seconds while occupied. New sessions and disconnects save immediately. An abrupt runtime interruption can lose up to the most recent movement checkpoint; it cancels pending attacks/cooking/riding on restore and keeps raw meat.

Same-tab session tokens are retained in sessionStorage. Server-side sessions last up to 7 days, with the most recent 100 disconnected sessions retained. This is not cross-device account login. Closing the browser tab may discard the token, and explicit profile re-entry resets personal progress. The world checkpoint remains.

Saved schema 1 from world versions 2, 3 and the current version 4 is supported. Unknown formats still fail closed. After successfully importing a legacy checkpoint, `FreeGameRoom` retains its original JSON in `checkpoint_backup` at id 1 using `INSERT OR IGNORE`, followed by storage sync. The first backup is never overwritten; normal saves update `checkpoint`. Do not delete either table or the Durable Object namespace to resolve a restore error. The backup remains private inside the same SQLite object.

On application quota/storage failures the server stops simulation, discards uncommitted outgoing updates, closes sockets, and returns a service-paused response. Clients check status before joining; a service-paused or quota response stops automatic retry, while a status check that cannot reach the server at all keeps the reconnect backoff. Ordinary interrupted connections use backoff up to 60 seconds. Platform-enforced quota failures can prevent a tailored message; the static page still explains connection failure. Capacity limits do not reset daily.

To pause manually: set `SERVICE_ENABLED` to `false` and deploy the same Free account; keep the Durable Object binding/class/migration so saves are retained. A rollout closes existing sockets, and further joins receive 503. Never delete the namespace or deploy a deleted_classes migration to pause service.

## Commands

```
npm run build:cloudflare
npm run check:cloudflare
npm run dev:cloudflare
node scripts/qa-cloudflare.mjs
node scripts/qa-cloudflare-persistence.mjs
node scripts/qa-cloudflare-character-privacy.mjs
node scripts/qa-cloudflare-release.mjs https://cromagnonmmo.cro-magnon.workers.dev
npm run deploy:cloudflare
```

The persistence QA requires a dry-run bundle at `output/cloudflare-dry-run/worker.js` (`wrangler deploy --dry-run --outdir output/cloudflare-dry-run`). It starts a separate local emulator, seeds legacy test-only SQL, verifies its exact backup, evicts objects, exhausts each application quota and injects a SQL write failure. It never contacts cloud storage.

The public build validates files in fresh staging directories, then swaps `dist-cloudflare` and `dist-cloudflare-worker`, retaining previous contents under `output/cloudflare-deploy/previous-*`. On Windows, stop your own local Wrangler process before rebuilding if it holds those directories open. Keep the normal Node server and its saves running separately. The deploy guard checks the exact Worker name, uses this filtered entry point and runs the local character privacy audit after its dry run.

During this deployment, the inherited `CLOUDFLARE_API_TOKEN` lacked access to the dedicated account. Removing `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_API_KEY` only from that command's process allowed the existing Wrangler OAuth to be used. No saved credentials or global environment variables were changed. Set `CLOUDFLARE_ACCOUNT_ID` to the exact dedicated account, `WRANGLER_SEND_METRICS=false`, and `WRANGLER_LOG_PATH` to a workspace output file for these commands. Never print credentials into QA records.

After a functional deployment, run `node scripts/qa-cloudflare.mjs https://<actual-worker-url>` while `EMBER` is empty and inspect the game in a browser. The script checks zero players before creating clients and finishes with explicit leave for each test client. `qa-cloudflare-release.mjs` reads static files to verify current public profiles, hidden image denial, client config and texture hashes. Read-only health/status checks are sufficient after documentation-only changes; do not occupy the public room or repeat all downloads unnecessarily.

## Verification records

- `output/cloudflare-build.json`: current copied files, public credit mode, excluded characters, exact GLB/part hashes and every public file's length/SHA. The older `assets/cloudflare/build.json` is historical.
- `assets/cloudflare/local-qa.json`: earlier emulator evidence with nine characters and 83 GLBs. The current eight-character rules and save behavior have separate local audits below.
- `assets/cloudflare/live-qa.json`: five actual clients, sixth refused, movement, attack, reconnect, private-file denial and all 81 public GLBs verified at the new HTTPS URL.
- `assets/cloudflare/deployment.json`: published version, verified account and browser checks.
- `assets/cloudflare/public-release-qa.json`: 26 served client/image files checked against build hashes, all eight supervisor image URLs and seven excluded character file URLs refused, three external cave textures verified.
- `assets/cloudflare/character-privacy-qa.json`: 521 public/Worker files plus the actual Worker bundle audited, eight public and nine local characters, forged/old appearance normalization and inventory preservation.
- `assets/cloudflare/persistence-qa.json`: current actual SQLite legacy restore/backup and quota/storage-failure results. Earlier evidence is retained under `output/cloudflare-deploy`.
- `output/cloudflare-deploy/tests-with-public-exclusion-final.log`: all 771 tests pass with concurrency 4; none skipped. Normal/Cloudflare/strict type checks, JavaScript syntax checks, architecture boundaries and changed-file formatting also passed.
- `tests/cloudflare-core.test.mjs` and `tests/asset-download.test.mjs`: legacy progress preservation, unknown-format rejection, quota reservations and corrupt/misordered/cross-origin part rejection.
- `output/cloudflare-deploy/cromagnonmmo-readonly-check.json`: healthy live APIs, zero players and 404 at the old URL after closing QA clients.
- `output/cloudflare-deploy/cromagnonmmo-browser-qa.json`: eight visible choices and Howkey online at the new URL, with no warning/error logs. Browser resource timing is unavailable in its read-only scope; file/bundle audits and HTTP checks provide the separate exclusion evidence.
- `output/cloudflare-deploy/screenshots`: current eight-character selection, Howkey and observed Free plan; previous home/local screenshots are retained.
- `docs/cloudflare-public-release-2026-10-01.md`: dated release notes and completed work record. Existing unrelated working-tree changes were retained; no commit/push was made.

Official policies checked 2026-10-01:

- https://developers.cloudflare.com/durable-objects/platform/pricing/
- https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/
- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/billing/manage/budget-alerts/ (last inspected 2026-09-07)

If the account is later upgraded to Paid, these billing guarantees no longer apply. Do not upgrade the dedicated account or add pay-as-you-go services. Never rely on a missing/declined card to prevent charges.
