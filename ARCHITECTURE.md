# Architecture and TypeScript

Runtime source is TypeScript. Browser files use `.ts` → `.js`; ESM simulation and server files use `.mts` → `.mjs`. Imports name the emitted extension, so Node and the browser execute the same modules without a runtime transpiler. `dist/` is disposable build output; edit the source, never the emitted files.

## Responsibilities

| Location | Owns | Dependencies |
| --- | --- | --- |
| `shared/` | Game rules, movement, collision, world data, character definitions, public snapshots | Other domain modules |
| `application/` | Room/session lifecycle, action coordination, command decoding, snapshot serialization | Domain and application-owned ports |
| `infrastructure/node/` | HTTP static-file delivery, cache headers and path restrictions | Node APIs |
| `server.mts` | Node HTTP/WebSocket composition and process lifecycle | Application, domain, Node adapter |
| `cloudflare/` | Durable Object storage, socket delivery, free usage limits | Application and Cloudflare APIs |
| `src/` | Browser UI, input, storage and Three.js rendering | Domain and browser adapters |

Dependencies point toward the domain. `scripts/check-architecture.mjs` checks imports and rejects browser/Node globals in domain and application modules. `shared/game-core.mts` is a compatibility facade for existing operational tools; new adapters import `application/game-core.mjs` directly.

`createGameCore` receives a `Runtime` for time, IDs and session tokens. Its `GameConnection` interface describes communication without importing `ws` or a Worker socket. `decodeCommand` turns unknown JSON into a discriminated command union and drops client-authored authority such as damage and identity. Actions retain server-side cost, distance, collision and rate checks.

`createGameServer({ core })` permits an already-created/restored application core to be hosted by Node. The default still creates a fresh in-memory core. This injection does **not** add automatic disk persistence. The restoration integration test uses the application's existing save format and reconnect tokens, replacing its dependency on an untracked one-off rollout script.

Public snapshots have a shared schema separate from private session data. Browser session storage has a small storage interface and keeps the existing memory fallback when browser storage is denied. The Cloudflare socket adapter queues responses until the Worker explicitly flushes them after a successful save.

## Commands

```sh
npm install
npm run build
npm start
npm run dev
npm test
npm run check
npm run format:check
npm run build:cloudflare
npm run check:cloudflare
```

`start` and `test` build first. `dev` watches TypeScript and CSS, rebuilds, and restarts its own server only after a successful build. It keeps the previous server running on compiler errors. Like the old development watcher, successful restarts reset the default Node server's in-memory state; use this mode for development.

`node server.mjs` remains a compatibility launcher after a build. Historical QA and generation scripts stay JavaScript and import compiled runtime modules, so run `npm run build` before invoking them directly. Data generators now write `.mts` source; rebuild after generating data.

The local server serves `/src/*` and `/shared/*` from `dist/`, while models and other static assets stay in `public/`. CSS is copied without transformation. `build:cloudflare` packages compiled browser/domain modules and verifies GLB hashes. Its build report is written to `output/cloudflare-build.json`, leaving historical QA reports intact. It still refuses unexpected stale output; preserve or clean the old generated build before rebuilding when the asset catalog changes.

## Type checking scope

All runtime modules are compiled and structurally type-checked with `noEmitOnError`. `tsconfig.strict.json` additionally enables **all strict checks** for the command decoder, connection/runtime ports, public data schemas, character definitions, spatial index, frame clock, browser storage, Three.js type guards, static-file adapter, and quota/socket adapters. These modules contain no `any` annotations or suppressed diagnostics.

The remaining migrated simulation/rendering modules use the compatibility compiler settings in `tsconfig.json`; implicit parameter types and some dynamic rendering records remain permissive. This is not a claim of repository-wide strict typing. Extend explicit domain and rendering types before adding those modules to the strict project. No `@ts-ignore`, `@ts-nocheck`, blanket module shims, or `noCheck` build is used.

`tsconfig.cloudflare.json` separates Workers globals from Node/DOM globals. `cloudflare/env.d.ts` is generated from Wrangler configuration; refresh it with `npm run types:cloudflare` when bindings change. Generated terrain and model measurements retain their numeric data and are excluded from cosmetic formatting.

## Preserved constraints

Models, textures, rig/animation data, world placement, save schema, room limits and gameplay timing remain unchanged. Builds and dry runs do not deploy or change billing. Existing Workers Free restrictions and save-failure behavior remain in the Cloudflare adapter.
