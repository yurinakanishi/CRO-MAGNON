# Adopted r04 integration review — 2026-10-10

This is an integration milestone, not completion of the whole optimization/mobile request. Performance gaps remain in the companion reports.

## Tests and resource lifetime

Full host suite `adopted-r04-full-tests-r03-host.log`: **1274 passed, 0 failed, 2 skipped** of1276. Both skips are explicit optional CRO_BENCH benchmarks (hunting selection and walk/collision queries). Pillow-dependent image tests ran. `npm run check` passed TypeScript,567JavaScript syntax checks and architecture boundaries. `git diff --check` has no whitespace error, only the existing changelog's CRLF conversion warning.

The source/collision regression tests preserve original measured SHA anchors. `runtime-model-identity.mjs` checks original and served bytes independently and proves exact decoded attributes/indices/transforms/skins/clips; negative provenance and wrong geometry cases fail. Focused16tests passed. Publisher's original/current startup proof passed28tests. An earlier whole-suite run under the Windows sandbox encountered temporary renameEPERM and loopback failures and was interrupted; it is not counted as a product pass. The complete host rerun above is authoritative.

Actual adopted Chrome and Windows WebKit each passed11 lifecycle checks (`adopted-r04-{chrome,webkit}-residency-r01/result.json`): five network participants with one renderer, three native WebGL loss/restores, two actor/template eviction-return cycles and destroy. Actor/inventory state is retained as required; no duplicate RAF, reloaded residentGLBs during world recovery or unreleased oldGPUgeometry/texture, browsererrors0. Maximum actual CacheStorage response bodies plus index was67060133bytesChrome/67019388WebKit, within67108864. CacheStorage is distinct from GPU/decoded-memory budgets. These short runs do not prove unlimited-session stability or physical iOSSafari behavior.

## Actual packages

All output roots are separate, unchanged after build. No deployment, fleet distribution or existing service restart.

| Profile | Output root | Verified manifest files | Worker modules | Build ID |
| --- | --- | ---: | ---: | --- |
| local | output/optimization-r04-local-a01 |682 |0 |8daf3591b19988a6f67100dd1387adf4e2d7f1a94d14381f2f2a7202a2b3aeb1 |
| exhibition | output/optimization-r04-exhibition-a01 |687 |0 |e2ae04c166132d425f9948385fb7dbb629722a1a6eac724f4bff39522cbe726b |
| MMO | output/optimization-r04-mmo-a01 |558 |131 |6a9bd9a0da17eead7dbc35d63dcde55b9e985856e514c36564936ccf4dbd4045 |

Independent verifier imports no builder/adoption helpers. It checks every listed file SHA, exact public inventory (including the separate small local identity record), all112adoptedcopies and64model manifests per profile, decoderSHA, activeLOD graph, retiredfileabsence, allfour supervisors and MMOrolefiltering. Evidence `packages-independent-r04-a02.json`, finalsuccessful log`packages-independent-r04-a04.log`. MMOimmutableGLBHTTPheader is stilloff because two inactive hashless grass models ship; verified CacheStorage remains active. Do not claim immutableHTTPcaching was enabled.

`qa-adopted-packages-browser.mjs` r04 independently ran actual bundled Node modules for local/exhibition and all131exact filtered Worker modules in isolated Miniflare forMMO; explicit modules avoid the initial QA loader's failed automatic collection. WindowsChrome154,390×844DPR1touch, fresh contexts and temporary state, no use of existing8787. Allthree profiles passed, browsererrors0/cleanupfailures0. Seven credit images decoded; four supervisors appeared, onlyx.comlinks except exhibition which hasnone; noQR displayed or requested. Offline packages retain seven unused originalQRfiles, MMOdoesnotshipthem. credits=full is the intentionalOct8supervisors change, not a new change here.

Online local/MMO title requested zeroGLBs, used the gallery, and entered only with the adopted character ready. Exhibition retains world-behind-title/directentry; two earlyGLBrequests were observed at the title snapshot, so do not claim the online no-model-title result for exhibition. Native touch moved each authoritative player3.68–5.33m and stopped; width390 without horizontaloverflow, world/characterready, adoptedportraitGLB and hashedmuralPNG requested in eachprofile. One browser/player per package here; separate lifecycle tests supply the fiveparticipant evidence. `adopted-r04-packages-r04/result.json` and screenshots; MMOplay screenshot opened and inspected.

Earlier package-QA attempts exposed assumptions in the QA harness (case of Ryuichi-typeR, exhibition's directentry, Miniflare modulecollection), not accepted product regressions. Their logs/screenshots are retained. None of these corrections changed game code.

Adopted enemy gameplay QA captured crow-shaman/violet-behemoth/sabertooth-tiger at17/28/45maimdistances,9runtime/high pairs,errors0. Each actualactor sourceSHA matches its currentmanifest. Behemoth hasemptylods andexact39825triangles atallthreeviews,high/lowgeometryandmaterialidentitiesequal,ownedvariants0. Its17mand28mimages wereopened: face/neck/bodyretainshapeacrosstheformerbadtransition (`adopted-r04-lod-gameplay-r01`). This is frozen idle/camera preparation, not a combat or movement-input test.

The calibrated afteradoptionnetworkresult isnowrecorded in `performance-network-adopted-r04.md`:controls63.04s versus92.69soriginals,zero repeatedcavePNGsaftergalleryready,errors0. Itstillmisses5sguide. AdoptedCPUprofile has been collected and summarized in `performance-cpu-adopted-r04-profile.md` for nextfixes. Further measured startup/CPU/texture work remains. CPU4framep95~54ms and GPUtexturepayload370–469MB stillmissguides; some scenes exceed1million submittedtriangles. PhysicalAndroid/iOS, thermal/battery and exhibitionhardware remain unverified.
