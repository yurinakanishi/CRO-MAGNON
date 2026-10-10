# Startup r07 — independent cold-link measurements, 2026-10-10

The two-load critical queue now starts mountain geometry fitting as soon as its verified templates are ready, overlapping remaining critical transfers. Critical key membership, geometry, worker implementation and gameplay-entry conditions stay unchanged. Related69 tests include9 mountain-fit parity/cancellation/failure checks. New integrated native touch checks pass5 groups; Chrome and Windows WebKit context/eviction checks pass11 each. Whole optimization remains unfinished.

## Measurements

Native Chrome154, Windows,390x844,DPR1,touch,CPU4 artificial slowdown, global10Mbps download/5Mbps upload/50ms latency, fresh browser per run and page cache disabled. One isolated memory-only server, no user save or existing server. Cold calibration concurrently fetches two2MiB responses; aggregate durations3505–3522ms agree with3355ms theoretical transfer plus latency. The old runtime is adopted-r04-build-r01, new runtime runtime-r11-startup-r07-build-r01, both with actual r04 assets. No other browser, test, build or encoding job ran during these measurements.

| Phase after confirmation | Control r01 | New r01 | Control r02 | New r02 |
|---|---:|---:|---:|---:|
| Cave playable |15.585s|16.038s|15.387s|15.347s|
| World ready |56.401s|51.423s|56.052s|50.434s|
| Controls ready |62.075s|57.593s|61.914s|56.543s|
| Native first movement |63.915s|59.239s|63.746s|58.319s|

Title itself takes15.52–15.83s before confirmation on this uncompressed local test server. These are two paired runs, not physical-phone/cellular tests or a statistical confidence interval. Readiness still misses5s. Existing public gzip evidence is a separate older deployment and cannot replace these measurements.

## Traffic accounting and attribution

Runr01 uses qa-network-ledger-r08.mjs. Playwright sizes reports negative lengths for local blob-image fetches and zero for some worker entry scripts. Do not count blob data as additional network transfer or claim the first ledger completely measures worker bytes.

Runr02 uses qa-network-ledger-r09.mjs, which additionally records protocol and HTTP-server response body bytes. All network request size lookups have0unknown; local blob requests are separated. Server body bytes count data offered to HTTP write/end (possibly ahead of arrival at the browser), and exclude the calibration endpoint in the game totals below. They are not instantaneous browser-received bytes.

At controls, server game response bodies are74,322,948B control and72,235,829B new. The net difference2,087,119B is the old first worker's repeated Three modules2,093,209B minus6,090B of new runtime code. The server confirms old first worker Three responses200 versus new304. Each run still requests all three worker entry scripts (2,116B each) and fit modules (45,580B each). The early worker starts around27.1s after confirmation in new versus46.0s in control; all worker requests are retained in the ledger.

Thus the measured4.5–5.4s reduction combines early fitting with different conditional-cache behavior. It must not all be attributed to compute overlap. All errors0, verified self template present before entry, own actor present before controls and actual finger movement changes the authoritative server position. Screenshots and raw ledgers are in startup-overlap-{control,r07}-ledger-r0{1,2} under output/playwright/optimization-20261009.
