# r21: negotiated gzip for local and exhibition static text

2026-10-10, runtime026 (Opus 5.5, High). This is the first transport slice: the Node static server (`serveStatic`, used by `server.mts` and `exhibition-client.mts`) now gzip-encodes compressible text when the client asks for it.

- No command was run, no server was started or restarted, and nothing was committed, published or distributed.
- Running servers (3000/8787/4173) keep their old code until Codex starts a new build.
- **No time or byte budget is claimed met.** Codex measures actual transfer and CPU.

## Changes

| File | Change |
|---|---|
| `infrastructure/node/static-transport.mts` (new) | `COMPRESSIBLE` (.html .js .mjs .css .json .svg .txt), `GZIP_LEVEL = 6`, `acceptedEncodings()`, `negotiateEncoding()`, `sendBody()`/`sendText()` built on `stream.pipeline` with async `zlib.createGzip`, and `activeStaticStreams()` (a count of open bodies, for the lifetime tests). |
| `infrastructure/node/static-files.mts` | Negotiation, encoded headers, 406, and handle-based streaming. Path checks, 403/404 order, MIME types, visibility filtering and `Cache-Control` are unchanged. |
| `tests/static-transport.test.mjs` (new) | Actual HTTP bytes from a real `http.Server` calling `serveStatic`. |
| `scripts/qa-movement-smoothing-host.mjs` | Boot-entry compatibility only. |
| `scripts/qa-cloudflare-release.mjs` | Boot-entry compatibility only. |

## Response rules

- **Negotiation** follows RFC 9110 §12.5.3:
  - coding names are case-insensitive, and `x-gzip` means gzip;
  - a missing `q` is 1, and `q` must be 0–1 with at most three decimals; an invalid name or `q` drops that element; the first weight for a coding counts;
  - `*` covers unlisted codings, identity included;
  - identity is acceptable unless it is refused by `identity;q=0`, or by `*;q=0` without identity listed;
  - an absent header gets the stored bytes, and an empty header means identity only;
  - gzip is offered only for compressible types and wins ties.
- **406:** if no coding the server can produce is acceptable, the response is an explicit `406` (`no-store`), not an illegal identity body. This includes binaries when identity is refused.
- **gzip 200:** `Content-Encoding: gzip`, `Vary: Accept-Encoding`, no `Content-Length`. Same `Content-Type`, `Cache-Control: no-cache`, and the **same weak `ETag` of the stored file**, which keeps its meaning (size and mtime of the stored revision).
- **Identity 200:** unchanged headers plus `Vary: Accept-Encoding` for compressible types, and the stored `Content-Length`. Binaries (GLB, PNG, WebP, MP3, wasm and so on) get exactly the old headers, with no `Vary` and no encoding.
- **HEAD:** the same headers as GET, with no body. The file handle is closed.
- **304:** `ETag`, `Cache-Control: no-cache` and `Vary` for compressible types; no body.
- **Visibility overrides** (filtered `world-assets.json`, `character-profiles.mjs`) keep their filtered text and `no-store`, have no `ETag`, and are negotiated the same way.
- **Hidden models:** the 404 with `no-store` comes before any negotiation, so nothing leaks.
- **Not compressed:** API, WebSocket and `exhibition-client`'s `/multiplayer-config.json` and `/api/status` are not part of `serveStatic` and are untouched.
- **Revision consistency:** the file is opened once, and its `ETag`, length and bytes all come from that open handle (`handle.stat()`, then `handle.createReadStream({ start: 0, end: size - 1 })`). A replaced file is therefore never sent under the previous revision's validator.

## Lifetime and failure

- **Streaming:** `stream.pipeline` handles backpressure. gzip runs asynchronously on the zlib threadpool, with no synchronous compression and no whole-file read for ordinary files. There is no encoded cache and no promise cache: memory per request is bounded by the stream buffers.
- **Client leaving, read error, zlib error:** pipeline destroys the read stream (which closes the handle), the gzip stream and the response socket.
  - The callback only releases the counter. It never writes a second response or an identity fallback after encoded bytes have been sent.
  - Nothing is rethrown into `server.mts`'s catch after headers were written.
- **Before headers are written:** a stat or open failure propagates exactly as `stat` did before (ENOENT → 404 in both servers). A non-file is still a 404, and the handle is closed on every early return (non-file, 304, HEAD).

## Expected effect and cost

- **Text bytes:** the imports report r01 measured the `main.js` static closure at 12,523,754 B raw and 1,905,698 B with gzip -9. At level 6 the size is expected to be slightly larger, but it has not been measured.
- **Not covered:** GLB, PNG, WebP and audio bytes, which are most of the mandatory transfer, are unchanged by design. So the 4 MB / 5 s gap remains: about 47.6–65.2 MB of identity content before controls at r05.
- **CPU trade-off:** each request recompresses. A cold page compresses about 12–13 MB of JS/CSS/JSON on the server, at an unmeasured cost of roughly a few hundred ms of threadpool CPU. With 5 concurrent cold starts the default 4-thread libuv pool is shared.
  - Revisits normally revalidate with `ETag` and get a 304, which costs no compression.
  - If Codex measures the CPU as material, the next step is prebuilt `.gz` sidecars keyed by the stored file's validator. That needs a build step and invalidation rules, so it was not done here.
- **Measurement caveats:** the browser CPU×4 throttle does not slow the server. QA must use the real `serveStatic`; the old identity QA overlay must not stand in for compressed behavior.

## QA entry compatibility

- **`qa-movement-smoothing-host.mjs`:**
  - It replaces the module entry (`/src/boot.js`, or a legacy `/src/main.js`) with `/motion-observer.js`. The observer still instruments `WorldRenderer` and then imports `main.js` directly, which renders its own title without a shell, as intended.
  - If no such entry exists, it answers 500 with an explicit message instead of silently loading the shell.
  - This overlay serves its HTML as identity, by design.
- **`qa-cloudflare-release.mjs`:**
  - Requires `src/boot.js`, `src/title-shell.js`, `src/icons.js`, `src/startup-marks.js` and `shared/friend-mascot-roster.mjs` in `build.publicFiles`.
  - Verifies their served SHA-256 and length like the other files (fetch decodes any content coding).
  - Asserts that the released `/` has exactly one module entry, `/src/boot.js`, and reports `titleShellFilesVerified`.

## Tests authored (not run)

`tests/static-transport.test.mjs`:

- **Negotiation table:** absent and empty headers, case, `x-gzip`, `q=0`/`0.000`, identity preference and refusal, wildcards with and without identity, binaries, an invalid `q` or token, duplicates, multi-line headers.
- **gzip and identity:** gzip vs identity of a 300 KB module and of `index.html`, decompressed with `gunzipSync` to exact source. Headers checked: equal `ETag`, `Vary`, absent `Content-Length`, type, `Cache-Control`.
- **Refusals:** `406` for refused codings, including a binary whose identity is refused. A binary is byte-identical, with no `Vary` or encoding, even for `gzip, *`. The 403 allowlist still applies first.
- **HEAD and 304:** HEAD headers equal GET's with an empty body, for gzip and identity. A 304 for a matching `If-None-Match` list carries `ETag` and `Vary` and has no body.
- **Revisions:** a modified file gets a new `ETag`, the old validator returns 200, and both the encoded and identity bodies carry the new content.
- **Overrides:** overrides equal `localContentOverride()` output after decoding, keep `no-store`, and have no `ETag`. The filtered catalog keeps only the visible models, and a hidden model's file is a 404 with `no-store`.
- **Client abort:** a client aborting a 12 MB body after the first chunk, with gzip and with identity, brings `activeStaticStreams()` back to 0. Then 4 concurrent full bodies are each exact.
- **Not found:** a missing file is a 404 without encoding, and a directory is never a 200.

## Limits

- No brotli and no prebuilt sidecars.
- A file rewritten in place while it is streaming can still produce a short identity body against its `Content-Length` (an existing risk). A read-error test is not included because it cannot be forced portably.
- Weak `ETag`s are shared across codings, which weak-validator semantics allow. Strong-validator range requests are not supported, as before.
- Cloudflare delivery is a separate platform path and is not changed or measured here.
- `tests/static-transport.test.mjs` uses temporary directories under `os.tmpdir()` and removes them.
