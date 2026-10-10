# Cold startup on a constrained link — 2026-10-09

Not an acceptance result: whole-project optimization and r04 adoption remain unfinished.

Native Windows Chrome154.0.8037.93,390x844,DPR1,touch,CDP CPU slowdown4,global network rule10Mbps download/5Mbps upload/50ms latency. Fresh context, HTTP cache disabled; no previous CacheStorage. Original public model URLs, frozen runtime-completion-r02. Isolated memory-only server, no other browser/build/test overlapped. Remote Claude file jobs and other desktop applications stayed active. This does not measure physical smartphone, 4G, thermal or battery behaviour, and local uncompressed module transfer is not Cloudflare compression behaviour.

Script`qa-network-startup.mjs`; result`output/playwright/optimization-20261009/pre-adoption-network-r02/result.json`. Bandwidth enforcement calibrated with two parallel2MiB downloads against the aggregate3.355s theoretical minimum. Full raw resource timings and world readiness diagnostics retained.

- Title ready14.564s after navigation; no GLB fetched at title.
- Cave playable36.324s after start confirmation.
- World/own character template ready87.606s after confirmation.
- Play controls visible with actual own actor92.686s after confirmation.
- Actual native touch-stick movement on server94.229s after confirmation. No fixture warp or substituted input.
- Browser errors0. Under5s target not met.

The first attempt r01 stopped on an incorrect QA assertion: it expected a joined world actor while the gallery was still open. Source review confirms that world-ready means own template/equipment loaded; joining happens after the proceed button, and controls wait on actual actor arrival. r02 verifies both phases separately. r01 also received the calibration HTML's implicit favicon404; r02 declares an inline icon. Neither is counted as a game regression. Preserve r01 as diagnostic evidence.

The current code awaits complete gallery loading before starting the surrounding world. Critical world templates also include their full and far LOD files. These are real sources of startup bytes/delay, but r04 is not yet applied, so these numbers must not be described as compressed-graph performance. Publisher integration is pending, and the cave owner's startup-network-analysis-r04 is read-only analysis of exact candidate costs and safe scheduling changes.
