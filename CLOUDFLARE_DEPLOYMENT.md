# CRO-MAGNON: zero-charge Cloudflare deployment

The user's latest requirement allows the **$5/month base fee if necessary, but forbids all metered overage charges**, even if the game must stop. This game can run on Workers Free, so no new base-fee subscription is needed. Continue to reject Workers Paid as a deployment target: application counters and budget alerts do not establish a hard zero-overage billing boundary, and refused requests can still be metered. Do not interpret the $5 permission as permission for pay-as-you-go overages or changes to unrelated subscriptions.

## Current status

**2026-10-23 SEO/analytics preparation, not deployed:** the dedicated GA4 property and Search Console domain ownership/link are configured. The site changes add consent-gated analytics, canonical custom-domain metadata, robots.txt and a bilingual sitemap. See [setup, exact verification and remaining publication steps](docs/analytics-search-2026-10-23.md). This does not supersede the live release below.

Deployed source commit `603e444e932f639b972f31371427fe578bf18859` on **2026-10-22 at 22:48 JST**, version `7dcdb4a2-fc9b-4419-a805-c757fa0c8480`, serving 100% at [the public game](https://cromagnonmmo.com/). The exact CRO-MAGNON Free dashboard showed **Free / $0 / Current plan** at 22:45 JST. The release contains 783 files / 137.5 MiB / 87 GLBs / 14 playable characters and 137 selection photographs. The full production gate passed before the same artifact was deployed without rebuilding. All 782 served files match its SHA ledger on the custom domain; 22 principal files and solo health also match on the retained [workers.dev URL](https://cromagnonmmo.cro-magnon.workers.dev/). [Current release and live verification](docs/solo-release-2026-10-22.md); [previous recorded mural release](docs/mural-deploy-2026-10-16.md).

The game remains **solo only**: the browser runs the game and autosaves in IndexedDB, with no game API or WebSocket requests. `SERVICE_ENABLED: "false"` rejects online entry before resolving a Durable Object. The original binding/class/migration and namespace remain for old online saves; no cloud checkpoint was read or changed. Seven live Chrome play checks passed for desktop and 390px touch, autosave/reload, single-writer locking and native touch movement/cancel/jump/save. Additional live desktop/touch checks confirm 18 title contributors, 17 matching mural contributors, the new Jank0vic mural texture hash and world entry. Browser errors and gameplay API/WebSocket requests: zero. Mural revision 42 adds Jank0vic while preserving the prior 24 character cutouts and common physical scales. The release also includes the ape gathering/equipment fixes and three volcano obsidian sources. [Browser QA](assets/cloudflare/solo-live-qa.json), [deployment metadata](assets/cloudflare/deployment.json).

For live browser verification, run `node scripts/qa-solo-play.mjs output/playwright/<new-run> --url=https://cromagnonmmo.com/`. The deployed artifact and ledger are in `output/production-20261022-01/`; canonical upload folders and `output/cloudflare-build.json` were not replaced. The saved `output/cloudflare-deploy/deploy-20261022-01/verify-live-browser.mjs https://cromagnonmmo.com` checks this exact ledger through Chrome's normal TLS validation. Direct Node/.NET HTTPS checks on this host failed certificate-chain validation; Chrome succeeded without certificate overrides. The first six-concurrent file check timed out; the two-concurrent complete check and workers.dev smoke passed with zero retries. `qa-cloudflare-release.mjs` assumes the canonical report matches the deployed artifact; do not compare another build's report with this release. Do not run the old live online client or SQL tests against the solo release. The deployed configuration remains strict JSON through its Prettier override for the existing deployment guard.

The Namecheap domain **cromagnonmmo.com is connected and live-verified**. Its Free zone is `aea4d49230f05d07c13065cdb428616a`, with nameservers `leif.ns.cloudflare.com` and `nora.ns.cloudflare.com`. The same production Worker owns the root Custom Domain. Always Use HTTPS is enabled; `www` redirects to the HTTPS root with path and query preserved. Both public DNS resolvers, both TLS hostnames and seven Chrome checks passed. The default MX/SPF records remain; no registrar transfer or paid service was added. [Domain QA](assets/cloudflare/custom-domain-qa.json).

Custom Domains are managed in the dashboard. Keep `route` and `routes` absent from `wrangler.jsonc` to preserve that management; do not introduce an empty routes list. The two origins have separate browser IndexedDB saves. The workers.dev URL remains enabled for its existing saves; no user save was migrated or removed.

## Local production gate

Before requesting a release, run `npm ci` and `npm run verify:production` with Node.js 24.22.1+ (24 LTS) and Google Chrome installed. The pinned Playwright dependency comes from the project; a private runtime path is not required. The gate fails on type, syntax, architecture, formatting, dependency-audit, test, build, Worker dry-run, or browser errors. Registry access is required for the dependency audit; a network error is not a passing audit.

Each run creates a fresh `output/production-<timestamp>/` directory with the exact public assets, Worker, SHA-256 ledger, logs and `verification.json`. Browser evidence is under `output/playwright/production-<timestamp>/`. An explicit fresh directory is supported with `npm run verify:production -- --output-root=output/<new-directory>`; existing directories are rejected. The gate checks every served public file against the ledger, confirms solo/no-DO behavior, and exercises first entry, autosave/resume, competing tabs, 35-second idle periods, WebGL recovery, native Chrome touch input, failed-save exit/retry, and both language entry points. Optional asset transformation tests can use `OPTIMIZATION_PYTHON` pointing to Python with Pillow; opt-in benchmarks remain separate.

This command only runs local verification. It does not deploy, change plans, touch existing online saves, restart the usual servers, or generate exhibition packages. A successful result applies to that recorded artifact and environment. Rebuilds produce a new identity and require verification; physical-phone performance, native Safari and physical controllers require their own checks. The account/Free-plan checks and explicit release authorization above still apply. [2026-10-16 findings and scope](docs/production-readiness-2026-10-16.md).

## Historical source and deployment observations

The following dated entries retain their original status at the time of observation. Their “not deployed” statements are superseded by the 2026-10-15 deployment above. The online architecture, SQL saving and quota details below describe retained, inactive functionality.

Source/build update on **2026-10-15**, **not deployed**: normal and public entry is now solo only. The title enables 「ソロプレイで始める」 and disables 「オンラインで始める」. A dedicated browser Worker runs the existing game rules and saves progress in IndexedDB; it makes no game API, WebSocket, Durable Object or SQL calls. `multiplayer-config.json` uses `mode: "solo"`; `wrangler.jsonc` uses `SERVICE_ENABLED: "false"`. Static files stay assets-first. Even stale `/ws` and `/api/status` requests are refused before accessing `env.GAME`. Retain the existing DO binding, class and migration to preserve previous online saves; this does not instantiate an object during solo play. Do not enable online or deploy without a new explicit instruction. The online SQL behavior and quotas documented below are retained for a possible future online restart. [Design and verification](docs/solo-play-2026-10-15.md).

Additional source/build update on **2026-10-15**, **not deployed**: character and clothing selection now leads to a separate companion screen; Back preserves the draft. All nine Dots, Rimo-neko and 524 use photographs of their delivered GLBs in setup and the in-game companion menu. The isolated public package includes all 11 photographs, verifies the two-screen flow in its actual browser bundle and validates five independent companion selections in its Worker game core. [Implementation and verification](docs/starting-mascot-2026-10-15.md).

Source/build update on **2026-10-15**, **not deployed**: the shared `cat` roster flag now excludes Cat Kunoichi and her katana from character choices, public profiles, model manifests, clothing dye rules and delivered files. The isolated public build has 13 playable characters and 117 colour photographs at a common physical scale. Its packaged browser and Worker checks pass, including five connections and restoration of privately retained appearances. Source GLBs, animation, photos and saved appearances remain available for immediate restoration. See [retention, restoration and exact verification](docs/kunoichi-retirement-2026-10-15.md). This does not update the live version described below.

Latest deployment: **2026-10-12**, version `173d5535-fec8-44d3-8b1d-e5bd839cf59c`, serving 100% on the same dashboard-verified CRO-MAGNON Free account and Durable Object namespace. Current main includes one mascot per player, player knockback, introductions, clothing colours, the new Cro-Magnon woman, cave/camera/rendering updates and the Neanderthal/Or exclusion. A public-build fix filters clothing dye rules before bundling while preserving the local rules. Public assets: 597 files / 114.7 MiB / 79 GLBs / five playable characters; credits profile `full`. Live five-player/reconnect/model integrity, 53 static-file checks including all three browser bundles, and Chrome entry through the cave into the online world and clothing colour changes passed. The final room status was 0/5. [Release record](docs/mmo-deploy-2026-10-12.md). Earlier dated records below remain historical.

Historical release on **2026-10-01** used the dedicated **CRO-MAGNON Free** account (`a211102818d484cb668c6b62bebff3f9`) after its Workers plans dashboard showed **Free / $0 / Current plan**. [Public game](https://cromagnonmmo.cro-magnon.workers.dev/). That version was `2024e6ad-e30e-47de-9679-1daa52789715`. Five actual WebSocket clients, sixth-player refusal, movement, attack, reconnect and all **81 served GLB hashes** passed, including three split models. Chrome showed eight public character choices and rendered Howkey online without warning/error logs. Maruimo remains available locally and is excluded from the public build.

The Worker was renamed through its existing dashboard settings, retaining Durable Object namespace `9071351c3ff8445d8ce2eebdb7822cec` and its saves. Its old URL now returns 404. The old cloud checkpoint used worldVersion 2; the supported migration and exact original SQLite backup remain intact. Local SQLite tests verified legacy restore, exact backup, runtime eviction, usage limits and storage failures. Long-duration play and physical-device performance remain unverified. No paid subscription or additional chargeable service was created. A read-only recheck at **19:36 JST** returned healthy APIs, zero players and 404 at the previous URL.

Historical billing evidence on 2026-09-07 showed **Workers Free / Active** and **No payment method on file** on the dedicated account. This is dated evidence, not a new billing inspection. The unrelated original account was not downgraded or otherwise modified.

Billing follow-up on the unrelated original account on 2026-09-07: an active billable subscription is not evidence of a current nonzero charge. Its Workers and R2 usage views show zero usage cost; these views exclude fixed subscription fees. Its subscriptions list shows R2 Paid and Images Stream Basic but no Workers subscription, despite the Workers plans page's Paid label. Current recurring Workers fees there remain unconfirmed. This discrepancy does not establish Workers Free or authorize deployment there. Private invoices and refund documents were inspected separately and are not included in this repository.

`assets/cloudflare/account-verification.json` records the observed account/plan. Before every deployment, read the exact destination's [Workers plans dashboard](https://dash.cloudflare.com/a211102818d484cb668c6b62bebff3f9/workers/plans), confirm **Free / $0 / Current plan**, then record that actual observation and time. Never refresh the timestamp or mark the plan Free without observing it. The deployment script rejects Paid, unknown, or evidence older than 15 minutes. Existing Wrangler OAuth has account/user read and Worker deployment/log scopes; it cannot read billing subscriptions through the API. Plan verification therefore uses the dashboard, not the API's `default_usage_model`.

## Public and local credits

The source `src/title-credit-profiles.ts` retains yuri, all four supervisors and all guest profiles. The title's **関わってくれた人たち** and the cave's **壁画の人々** share one complete cast, deduplicated by credit id and case-insensitive X account (2026-10-16). Their names, links and order match; yuri appears only in the title's creator group and is excluded from the paintings and mural list. Cards contain names and an X mark wherever a verified X link is available; exhibition cards have no external links or X marks. OpenAI Dots has one card without a link for its nine painted characters. Credits are independent of mascot availability. The MMO asset manifest omits QR and avatar images; historical acquisition records remain outside the public assets.

`cloudflare/public-release.json` controls only the Cloudflare build:

```json
{ "credits": "full", "excludedCharacters": ["maruimo"] }
```

The required `full` setting ships all 18 credit entries: yuri, the four supervisors, R-524, りも(Limo), the ten friends (including Jank0vic) and OpenAI Dots. The title groups yuri under **制作** and the other 17 entries under **関わってくれた人たち**. The cave paints and lists those same 17 entries, including Ryuichi in gallery r38 and Jank0vic in r42. The former partial `public` credit setting is rejected so the two displays cannot silently diverge. Crediting a dormant mascot's person does not release its model files.

As of 2026-10-08, `shared/mascot-roster.mts` enables only **Dots (all nine), りもねこ and 524**. Mae, Kohaku, the Maruimo mascot, all seven contributor mascots and Howkey stay in the repository with their accepted GLBs, LODs, rigs, animations, portraits and production history. They are not generated in default rooms, downloaded by the browser, or copied to the MMO release. Howkey's flask is also omitted. All cave paintings and their textures stay unchanged. Hidden companion checkpoints remain private in saves and can restore their owners and positions when enabled later.

To restore one retained mascot, set its `enabled` flag to `true` in `shared/mascot-roster.mts`, rebuild and verify the release, then deploy only when requested. This restores the camp companion, selection card and MMO model files; the person's shared credit already ships. The existing local visibility switches must also permit Mae or Howkey when restoring either locally.

Howkey is now a **mascot**, not a selectable player. Its original scientist model, 1.55 m scale, skin, clips and flask are unchanged. The companion adapter uses its existing Head bone for pet contact, Idle_Loop while being petted or hit, and Wave for happiness/idle gestures. Its retained character definition has `playable: false`, so choices, character switches and joins refuse it even when the local switch is true. A legacy Howkey player save resumes as a valid player while keeping possessions and its original private appearance record. Enabling the mascot does not turn it back into a player.

For isolated verification without replacing the preview's upload folders, use `npm run build:mmo -- --output-root=output/<new-build-name>`, then `node scripts/verify-mascot-release.mjs output/<new-build-name>`. The output root must be a new subfolder of `output/`. The normal deploy command still assembles the canonical upload folders and enforces its optimization/account guards.

User instruction on 2026-10-16 unified the contributor and mural casts, including the four supervisors. Deploy only when requested, after verifying that the exact account is still Free as described above. `scripts/verify-mascot-release.mjs` checks the actual shipped title and cave rosters against the common cast and the absence of profile images and the X mark on every linked card.

## Local-only characters

`shared/character-profiles.mts` retains all nine local character definitions. The public build filters `excludedCharacters` before reading character models, copying portraits or generating manifests. Maruimo's GLB, LOD, split parts, portrait, manifest, profile and dedicated octopus pose module are omitted. Its portrait CSS is also removed. All seven former file URLs were checked as 404 at the new URL.

The browser offers five public characters. The uploaded Worker retains seven historical player definitions for private saved appearances; the shared enabled roster excludes the two Neanderthals from joins and public choices (Howkey is retained as a dormant mascot). The Worker entry is assembled under `dist-cloudflare-worker`, using filtered shared modules rather than the local catalog. The deploy guard audits both upload directories and the actual bundled Worker before uploading. The browser dye rules are also filtered to the released model keys before bundling. Confirming a removed character through a forged request, or resuming an old saved appearance, uses a valid public character and retains possessions. Local normalization retains all nine historical definitions, with Howkey excluded from player choices.

The previous release had already included Maruimo. This update excludes it from the current serving paths and new uploads; it does not claim to erase files already received by visitors or Cloudflare's private version history. Preview URLs remain disabled. Do not upload the ordinary local `public` directory or `dist/shared/character-profiles.mjs` directly.

## Architecture and limits

- Worker `cromagnonmmo`, the Namecheap-registered `cromagnonmmo.com` Custom Domain and the retained platform-provided workers.dev URL. DNS and HTTPS use the same account's Free zone. Its namespace keeps the original display label `cro-magnon-free_FreeGameRoom`; renaming that label or recreating storage is unnecessary.
- Static Assets: website, JS/CSS, audio, title images, 79 delivery GLBs including packed LODs, five character portraits and external cave textures. The current build contains 597 files including `_headers`, totaling 114.7 MiB. No R2, D1, external database, AI, image transformation, containers, queues, cron, paid builds or other chargeable binding. Observability/telemetry remains disabled.
- One SQLite-backed `FreeGameRoom` instance named `EMBER`; at most 5 players. Arbitrary room names cannot create additional objects. Local Node server retains multiple rooms.
- Node and Workers use the same `application/game-core.mts` and shared domain modules. Physics remains 50 ms, state broadcast about 100 ms.
- The public build generates its own multiplayer config: online, current origin, room `EMBER`, movement refresh 140 ms. Stops bypass that repeat interval. Keyboard/gamepad direction changes also send immediately. Local config and its existing defaults are preserved.
- Active WebSockets intentionally keep the world running. No timer runs once the last socket disconnects. This is continuous simulation while occupied, not idle chat hibernation.
- Source update on 2026-10-14: players leave after 30 seconds without input. Heartbeats and automatic stop/cancel commands do not renew the deadline. Foreground camera/menu/text input and controller input are reported separately, at most once a second. The browser stops automatic retries on `IDLE_TIMEOUT` / close code 4002 and offers a manual resume with the saved traveller. This update has been verified locally; the 2026-10-12 live deployment does not contain it until an explicitly requested deployment.
- Application ceilings: 12 hours of active room time/day, 400,000 received application messages/day, 2,000 connection attempts/day, 20,000 checkpoint writes/day. Whichever is reached first stops play. These are **not promises of 12 playable hours**: other limits may be reached first.
- Active time is reserved in 60-second blocks and messages in 1,000-message blocks, persisted before use. Restarting may waste the unused reservation but never restores consumed allowance. Daily counters reset at UTC midnight / 09:00 JST. Platform quotas are account-wide and remain the final hard stop on Workers Free.
- Origin validation, 2 KB input cap, original input throttles, no private files in static output. Tokens never appear in public world snapshots.

Cloudflare Static Assets requests and storage are free; `/ws` and `/api/*` invoke the Worker and use its quotas. The platform currently allows 20,000 static files per Free Worker version and 25 MiB per file. [Static Assets billing](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/), [platform limits](https://developers.cloudflare.com/workers/platform/limits/).

The current delivery GLBs all fit the per-file limit, so no split models are served. The build still supports larger assets by splitting bytes into at most 24 MiB content-addressed parts, recording each part's length/SHA and verifying exact reconstruction. The browser checks the parts and full asset SHA before parsing. Delivery cooking validates its allowed quantization and texture conversion against retained source models; the build validates the resulting delivery graph. World manifests keep their original world membership so character models are loaded on demand.

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

For the current solo deployment, use the live solo commands in **Current status** above. Only after a separately authorized online restart would `node scripts/qa-cloudflare.mjs https://<actual-worker-url>` be appropriate; it checks zero players before creating clients and finishes with explicit leave for each test client. `qa-cloudflare-release.mjs` reads static files to verify current public profiles, hidden image denial, solo config and image hashes. Do not occupy the old public room or repeat all downloads unnecessarily.

## Verification records

- `docs/solo-deploy-2026-10-15.md`, `assets/cloudflare/deployment.json` and `assets/cloudflare/solo-live-qa.json`: current solo release and six live Chrome checks, with zero game API/WebSocket requests and no DO access during solo play.
- `assets/cloudflare/public-release-qa.json`: current solo config, 185 served-file hashes including 128 selection photographs, and excluded/dormant model paths returning 404.
- `assets/cloudflare/character-privacy-qa.json`: current 896-file audit plus the uploaded Worker bundle; 16 retained Worker definitions and 18 historical local definitions. The public player roster has 13 entries.
- `output/cloudflare-deploy/deploy-solo-20261015/` and `output/playwright/solo-live-20261015/`: current build, account observation, before/after metadata, logs, screenshots and unchanged local-save evidence. The prior receipts are preserved under `receipts-before/`.

The older online evidence below remains historical; its descriptions of then-current receipt files do not override the current solo records above.

- `output/cloudflare-build.json`: current copied files, public credit mode, excluded characters, exact GLB/part hashes and every public file's length/SHA. The older `assets/cloudflare/build.json` is historical.
- `assets/cloudflare/local-qa.json`: earlier emulator evidence with nine characters and 83 GLBs. The current eight-character rules and save behavior have separate local audits below.
- `assets/cloudflare/live-qa.json`: five actual clients, sixth refused, movement, attack, reconnect, private-file denial and all 79 public GLBs verified at the current HTTPS URL on 2026-10-12.
- `assets/cloudflare/deployment.json`: published version, verified account and browser checks.
- `assets/cloudflare/public-release-qa.json`: 53 served files checked against the final build's hashes, including all three browser bundles, clothing dye modules, ten cave textures, four supervisor avatars, and current credit/QR/private-character rules.
- `assets/cloudflare/character-privacy-qa.json`: 738 public/Worker files plus the actual Worker bundle audited, seven retained Worker and nine historical local character definitions, forged/old appearance normalization and inventory preservation. The browser exposes five playable characters.
- `assets/cloudflare/persistence-qa.json`: current actual SQLite legacy restore/backup and quota/storage-failure results. Earlier evidence is retained under `output/cloudflare-deploy`.
- `output/cloudflare-deploy/deploy-mmo-20261012/`: prior evidence, final build, matching Worker hashes, deployment metadata, browser observation record, and validation logs. All 1,644 enabled tests passed, four conditional tests skipped, no failures; type/strict, 646 JavaScript syntax checks, architecture boundaries and changed-script formatting passed. The 2026-10-11 record and older verification references remain historical.
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
