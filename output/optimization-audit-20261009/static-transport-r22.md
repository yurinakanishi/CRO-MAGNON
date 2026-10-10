# r22: Accept-Encoding selection repair (RFC 9110 §12.5.3)

2026-10-10, runtime026 (Opus 5.5, High). This is a focused repair of `negotiateEncoding` after the single failure in `transport-identity-tests-r23-r01.log`.

- Nothing was run: Codex formats, builds and runs the tests, then the Chrome/WebKit checks.
- No streaming, header, cache or dependency change. `static-files.mts` needed no change.

## The inconsistency

- **Symptom:** `negotiateEncoding('gzip ; Q=0.8', true)` returned `identity`, but the test expected `gzip`.
- **Cause:** the old selector gave identity an implicit weight of 1 whenever the client never mentioned it. It then compared that 1 against gzip, so any fractional gzip-only request lost to an identity the client had never asked for.
- **What RFC 9110 §12.5.3 says:** identity is *acceptable* by default, unless the client refuses it with `identity;q=0`, or with `*;q=0` and no explicit identity. The default makes identity a fallback; it does not give identity a preference weight.

## Change (`infrastructure/node/static-transport.mts`, `negotiateEncoding` only)

- **Two kinds of identity:**
  - **Named identity:** the weight of an explicit `identity`, or otherwise of `*`. It is weighed against gzip, and gzip wins ties (as before).
  - **Implicit identity:** neither `identity` nor `*` appears. It is only the fallback. Any accepted gzip (q > 0) is preferred to it.
- **Fallback:** identity is used when nothing listed is available (`br`, `zstd`, an empty header), unless identity is refused (named weight 0). Then the result is `null` and the caller answers 406, as before.
- **Unchanged rules:**
  - an absent header gets identity;
  - gzip is offered only for compressible types;
  - `x-gzip` means gzip, names are case-insensitive, and an invalid `q` or token drops that element;
  - the first weight for a coding counts;
  - `q=0` refuses;
  - `*` covers every unlisted coding.

## Tests (`tests/static-transport.test.mjs`, negotiation table)

All earlier cases keep their expectations. The previously failing `'gzip ; Q=0.8'` → gzip is unchanged; the new selector satisfies it. Added cases:

| Header | Compressible | Expected | What it covers |
|---|---|---|---|
| `gzip;q=0.3` | yes | gzip | gzip-only fractional request against implicit identity |
| `gzip;q=0.001` | yes | gzip | same |
| `gzip;q=0.3` | no | identity | binary |
| `gzip;q=0.5, identity;q=0.4` | yes | gzip | explicit lower identity |
| `gzip;q=0.5, identity;q=0.5` | yes | gzip | explicit tie |
| `gzip;q=0.5, identity;q=0.6` | yes | identity | explicit higher identity |
| `gzip;q=0.5, *;q=1` | yes | identity | wildcard weighs identity |
| `gzip;q=0.5, *;q=0.4` | yes | gzip | wildcard weighs identity |
| `gzip;q=0.5, identity;q=0.4, *;q=1` | yes | gzip | an explicit identity overrides the wildcard |
| `*;q=0.5` | yes | gzip | wildcard tie |
| `*;q=0.5` | no | identity | binary |
| `br;q=1, gzip;q=0` | yes | identity | unsupported coding falls back |
| `br, zstd` | no | identity | binary falls back |
| `br, *;q=0` | yes | null (406) | wildcard refusal |
| `br, identity;q=0` | yes | null (406) | identity refusal |
| `br, gzip;q=0.2, *;q=0` | yes | gzip | wildcard refusal, but gzip is accepted |

The HTTP-level tests (actual bytes, gunzip, HEAD/304, validators, overrides, abort and concurrency) are unchanged. None of them depended on fractional gzip-only headers.

## Limits

- Only gzip and identity are produced. `br`, `zstd` and `deflate` requests fall back as described.
- A wildcard is treated as a weight for identity whenever identity is not named. That reading is one consistent interpretation of the RFC's "*" semantics, chosen so that `gzip;q=0.5, *;q=1` honors the client's stated preference for any other coding.
- These results are not verified until Codex's build and test run.
