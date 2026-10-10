# r04 applied, integration still unfinished — 2026-10-10 00:10 JST

This supersedes all earlier "r04 not applied" checkpoints. **The whole project is NOT complete.** Extra/xhigh only, no MAX/cloud/API/credits/Fast. No publication/deployment/fleetdistribution/commit/push/serverrestart/savechange.

## Actual adoption

Codex reviewed/completed publisher r13 after57/57 tests passed (asset optimization, runtime adoption, environment profiles), including semantic image-plan compatibility and behemoth full-only rule. Runtime r06 independently passed50tests and r07 passed39 before adoption. They preserve original full/low fixture proofs and test actual current sole-primary or compressed pairs after adoption. Cave r03 passed30.

`assets/runtime-adoption/20261009-r04-a01` is now **applied**. PlanSHA`3be1a8bf493027043676335614e17057a3e1b518cf0d8bb91092fe02d5d0ecc8`. Copied112content-addressed files (102GLBs,10PNGs),152071861bytes;65manifests rewritten.64selectedmodels,7startupsoleprimary,1behemothfullsoleprimary,8oldLODs cleared,15candidatefilesretiredonly(notdeleted). Servedbytes272896677→152071861; this is graph inventory, not startup transfer. Behemoth39825triangles atallranges, old7965triLOD excluded(+31860fartri). All7startups aggregatefarincrease392114; final renderingcost stillto measure. Original/candidate files remain unchanged.

Independent `qa-adoption-independent.mjs` passed in BOTH planned/applied states:102GLBs,10PNGs,120originalfiles,82savedcurrentmanifestinputs. Verifies own mapping without publisher imports, source/candidate SHA/len, GLBtriangle/clip structure, PNGdimensions, current/appliedbyteequality, exact unrelatedmetadata preservation. Evidence`independent-20261009-r04-a01-{planned,applied}.json`. Publisher auditpassed and wrote separateauditreport; no candidate revision record changed.

Current image-plan semantic proof permits only explanatory runtimeEntry/configuredBy change after verifiedloader refactor; allIDs/source/resize/UV/material/risk/skipped facts must equal. Planrecords bothdescriptors+currentruntimeSHA; auditreplansusing saved **before** manifests. Strictcandidateverifier remains strictaboutconfigurationdrift andshouldnot beclaimedcurrentpassed. Its originalpassed127fileproof andallcandidatehashes retained. Never overwrite immutable r04 or acceptance docs(image-review-r04.md/adoption-contract-r04.md).

Immediately beforeandafterapply, `snapshot-adoption-safety.mjs` checked695files inuser `.cro-magnon-save` andexistingdist-cloudflare/dist-cloudflare-worker: allbytes/SHAidentical.9HTTPoutcomesidentical. Only8787runningworkerdPID2984,health/status200andservedworldcatalogSHAunchanged;3000/4173ECONNREFUSED bothbeforeandafter. No serversstarted/stopped. Evidence`safety-{before,after}-r04-a01.json`, `safety-r04-a01-comparison.json`.

## Current execution

exec74599: `npm run build` then full `node --test --test-concurrency=4 tests/*.test.mjs`, logs`adopted-r04-build.log`, `adopted-r04-full-tests.log`. This is first whole-suite run on actual adopted manifests. Inspect real failures and delegate fixes; don't treat pre-apply branches as proof of post-apply success.

No Claude implementation active as of this checkpoint. Lastactualrateallowed_warning91%,resetOct10 04:20JST,isUsingOveragefalse. No actualrejection yet. Publisherr13UUID587a3bb5-571d-4e42-9bcc-e1e9153ed25e complete; runtime r07UUID026f16c0-538a-4645-99e9-a78a97eaa58f complete; cave analysisr04UUID8031244b-cef0-480e-90d3-f9d81635752a complete. Collectpendingexec89701/24741 onlyifdesired,do not duplicate. Subsequentprompts shoulduse sameUUIDandfreshlognames.

Beforeadoption `npm run check` passedstrictTS/565JS/architecture (`integration-r03-check.log`). Post-adoption finalformat/check/fulltests pending.

## New measurements and remaining work

NormalGC memorycorrection: `performance-runtime-memory-r01.md`,317–373MB currentvs790–807MBoldcontrol. New/oldCPU4FPSbothvaried, no30fpspass. GPUuncompressedformatpayload843/855/1036MBoriginal, `performance-gpu-texture-pre-adoption.md`; selfcheckedactualWebGLallocationledger, notphysicaldrivermemory. `texture-probe-performance-driver.mjs` postadoptionrepeatrequired; instrumentationinvalidatesFPSclaims.

Cold10Mbps/50ms/CPU4network on originals fullymeasured (`performance-network-pre-adoption.md`,pre-adoption-network-r02):title14.564s,noGLB;gallery36.324safterconfirm;worldready87.606;controlswithownactor92.686;actualtouchmovement94.229s,errors0. r01QAassertionwronglyexpectedjoinedactoringallery, fixedinr02;notaproductbug. Originalr01dataretained.

Claude READONLY analysis`startup-network-analysis-r04.md` needsCodexcheck: predictsessential50.50MBafterr04(transferlowerbound41.9satcalibrated1.205MB/s),gallery15.12MB/world34.73MBplusprops. Serialgallery-beforeworld,alltemplateLODs upfront,2caveimagescacheevictedandredownloadedoriginals. Suggestfirstmeasureadopted; unusedbridge/dryingrackLODs0.82MB; defermountain/boulderLOD2.83MBrequiresmulti-leveltemplateredesign; reordercriticalmountain/groundtooverlapCPUwithnetwork. No code change fromanalysis. Do notreduceviewradius/shorequalityorusebrokenfacesjusttohitnumbers. Currentr04contractsoleprimaryimmutable; anynewadoptionplanrevisionneedsnewexplicitrecord.

Next: finishfullsuite/resolveactualfailures; createfreshfrozenadoptedbuild; actuallocal/exhibition/publicpackagesisolatedoutputs(use`build-exhibition.mjs --local output/<fresh>`,withoutlocalfor exhibition,`cloudflare-public-build.mjs --output-root=output/<fresh>`; NEVER defaultrootexistingpreview). NativeChrome/WebKit lifecycle/context/cache/cave/textures/behemothandtouch; matchedPC/CPU4FPS/heap/GPUand10Mbpsnetwork. ActualHTTPimmutablecacheheader maybeoffdue2unusedgrassoriginalURLs; **CacheStorage stillenabled**, don'tconflate. Verifyprofiles/filtering/decoder/parts,keepingexistingservices untouched. Finalwholecompletionrequiresaddressingload/performancegaps,notjusttests.

`cpu-throttle-performance.mjs` now optionallyroutesmanifestsfrom`PERF_MANIFEST_ROOT=assets/runtime-adoption/20261009-r04-a01/before` for honestoriginal-assetscontrolsafterapply, withoutrestoringdiskfiles. Defaultunsetusescurrentadoptedmanifests. Frozenbuildselectionunchanged. StandardperformancerunsnocpuProfiler/noTextureinstrumentation.

Ifactualnewrate rejection occurs, update SAME automationcro-magnon-claude toshownreset+1min andrecordallactualstateshere. Do notpausepreemptively. CurrentheartbeatturnendsexactoneXML; meaningfuladoptionisNOTIFYwhenendingbutnofalsewholecompletion.
