# CRO-MAGNON: zero-charge Cloudflare deployment

The user's latest requirement allows the **$5/month base fee if necessary, but forbids all metered overage charges**, even if the game must stop. This game can run on Workers Free, so no new base-fee subscription is needed. Continue to reject Workers Paid as a deployment target: application counters and budget alerts do not establish a hard zero-overage billing boundary, and refused requests can still be metered. Do not interpret the $5 permission as permission for pay-as-you-go overages or changes to unrelated subscriptions.

## Current status

Deployed and live-verified on the dedicated **CRO-MAGNON Free** account (`a211102818d484cb668c6b62bebff3f9`) after its Workers plans dashboard showed **Free / $0 / Current plan**. URL: https://cro-magnon-free.cro-magnon.workers.dev . Version: `a3ae1674-f900-4d76-89ec-011467315915`. Five-player network checks, sixth-player refusal, movement/attack/reconnect, all 46 served GLB hashes, actual 3D rendering and world-map UI passed. No browser warning/error logs were observed. Persistence across runtime eviction and quota/storage failure tests passed in the isolated local emulator; a production runtime eviction was not forced. No $5 subscription was purchased. After deployment, Billing showed only **Workers Free / Active** and **No payment method on file**. The unrelated original account was not downgraded or otherwise modified.

Billing follow-up on the unrelated original account on 2026-09-07: an active billable subscription is not evidence of a current nonzero charge. Its Workers and R2 usage views show zero usage cost; these views exclude fixed subscription fees. Its subscriptions list shows R2 Paid and Images Stream Basic but no Workers subscription, despite the Workers plans page's Paid label. Current recurring Workers fees there remain unconfirmed. This discrepancy does not establish Workers Free or authorize deployment there. Private invoices and refund documents were inspected separately and are not included in this repository.

`assets/cloudflare/account-verification.json` records the observed account/plan. Refresh the evidence by reading the exact destination's Workers plans dashboard before each deployment. Never change the evidence to Free without actually verifying it. The deployment script rejects Paid, unknown, or evidence older than 15 minutes. Wrangler OAuth currently has only account/user read and Worker deployment/log scopes; it cannot read billing subscriptions through the API. Therefore plan verification uses the dashboard, not the API's `default_usage_model` (which is NOT proof of a free plan).

## Architecture and limits

- Worker `cro-magnon-free`, platform-provided workers.dev URL, no domain purchase.
- Static Assets: website, JS/CSS, 31 existing models and their 15 LODs; GLB bytes checked against their manifests. No R2, external database, AI, images transformation, containers, queues, cron, paid builds, or other chargeable binding. Observability/telemetry disabled in config.
- One SQLite-backed `FreeGameRoom` instance named `EMBER`; at most 5 players. Arbitrary room names cannot create additional objects. Local Node server retains multiple rooms.
- Original game rules extracted to `shared/game-core.mjs`, shared by Node and Workers. Physics remains 50 ms, state broadcast about 100 ms.
- Active WebSockets intentionally keep the world running. No timer runs once the last socket disconnects. This is continuous simulation while occupied, not idle chat hibernation.
- Application ceilings: 12 hours of active room time/day, 400,000 received application messages/day, 2,000 connection attempts/day, 20,000 checkpoint writes/day. Whichever is reached first stops play. These are **not promises of 12 playable hours**: other limits may be reached first.
- Active time is reserved in 60-second blocks and messages in 1,000-message blocks, persisted before use. Restarting may waste the unused reservation but never restores consumed allowance. Daily counters reset at UTC midnight / 09:00 JST. Platform quotas are account-wide and remain the final hard stop on Workers Free.
- Origin validation, 2 KB input cap, original input throttles, no private files in static output. Tokens never appear in public world snapshots.

## Saving and stopping

SQLite stores the world, camp, resources, animals/enemies and resume sessions. Inventory/camp/resource/combat-result changes save before queued state is released; positions save at least every 30 seconds while occupied. New sessions and disconnects save immediately. An abrupt runtime interruption can lose up to the most recent movement checkpoint; it cancels pending attacks/cooking/riding on restore and keeps raw meat.

Same-tab session tokens are retained in sessionStorage. Server-side sessions last up to 7 days, with the most recent 100 disconnected sessions retained. This is not cross-device account login. Closing the browser tab may discard the token, and explicit profile re-entry resets personal progress. The world checkpoint remains.

On application quota/storage failures the server stops simulation, discards uncommitted outgoing updates, closes sockets, and returns a service-paused response. Clients check status before joining; a service-paused or quota response stops automatic retry, while a status check that cannot reach the server at all keeps the reconnect backoff. Ordinary interrupted connections use backoff up to 60 seconds. Platform-enforced quota failures can prevent a tailored message; the static page still explains connection failure. Capacity limits do not reset daily.

To pause manually: set `SERVICE_ENABLED` to `false` and deploy the same Free account; keep the Durable Object binding/class/migration so saves are retained. A rollout closes existing sockets, and further joins receive 503. Never delete the namespace or deploy a deleted_classes migration to pause service.

## Commands

```
npm run build:cloudflare
npm run check:cloudflare
npm run dev:cloudflare
node scripts/qa-cloudflare.mjs
node scripts/qa-cloudflare-persistence.mjs
npm run deploy:cloudflare
```

The persistence QA requires a dry-run bundle at `output/cloudflare-dry-run/worker.js` (`wrangler deploy --dry-run --outdir output/cloudflare-dry-run`). It starts a separate local emulator, seeds local test-only SQL, evicts objects, exhausts each application quota, and injects a SQL write failure. It never contacts cloud storage.

After deployment run `node scripts/qa-cloudflare.mjs https://<actual-worker-url>` and inspect the game in a browser. Do not call deployment complete until the live URL works. This network QA uses the public EMBER room; run it only while the room is empty, and finish with explicit leave for every test client.

## Verification records

- `assets/cloudflare/build.json`: copied files and exact GLB hashes.
- `assets/cloudflare/local-qa.json`: five actual WebSocket clients, sixth refused, movement, attack, reconnect, private-file denial and all 46 GLBs served by the emulator.
- `assets/cloudflare/live-qa.json`: the same checks against the public HTTPS URL.
- `assets/cloudflare/deployment.json`: published version, verified account and browser checks.
- `assets/cloudflare/persistence-qa.json`: actual SQLite restore and quota/storage-failure behavior.
- `tests/cloudflare-core.test.mjs`: serialization privacy, restore, invalid-schema rejection and budget reservations.
- Existing game suite: 151 tests pass. One historical test cannot load `output/open-world-restart/run.mjs`, an absent ignored rollout helper; it fails before assertions and is unrelated to this migration. It has not been removed or silently skipped.

Official policies checked 2026-09-07:
- https://developers.cloudflare.com/durable-objects/platform/pricing/
- https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/
- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/billing/manage/budget-alerts/

If the account is later upgraded to Paid, these billing guarantees no longer apply. Do not upgrade the dedicated account or add pay-as-you-go services. Never rely on a missing/declined card to prevent charges.
