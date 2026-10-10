# Calibrated cold startup after actual r04 adoption

Whole optimization remains incomplete. Online local profile on Windows Chrome154.0.8037.93,390×844DPR1touch,CPU×4,global CDPnetwork rule10Mbpsdown/5Mbpsup/50mslatency,cold HTTP and verified-asset cache. Same `qa-network-startup.mjs` and controls/movement checks as the pre-adoption r02 baseline. No other heavy browser/test/build ran during this after measurement. No physicalphone,cellular,Cloudflarecompression,thermal or battery claim.

Two concurrent2MiBdownloads calibrated3504.1ms after versus3517.7ms before; idealaggregate3355.44ms. This constrains parallel transfers globally rather than assigning10Mbpsto eachrequest.

| Phase | Before ms | After ms | Clock origin |
| --- | ---: | ---: | --- |
| Title ready |14563.9 |15295.2 |Navigation |
| Cave playable |36324.0 |15430.6 |Actual confirmation tap |
| World + own template ready |87606.3 |56952.9 |Confirmation |
| Own actor + controls visible |92686.4 |63037.6 |Confirmation |
| Actual native-touch movement observed |94229.0 |64934.2 |Confirmation |

Before: repaired runtime with original manifests (`pre-adoption-network-r02`). After: frozen`adopted-r04-build-r01` and applied`20261009-r04-a01` (`adopted-r04-network-r01`). No browser orHTTPerrors. Native stick input moved the actual server player5.12m afteradoption and stopped. The after first-movement screenshot is retained. Controls readiness improved about29.65s in this pair but remains **63.04s**, far above the5sguide. Both runs loaded zeroGLBsat the title.

ResourceTiming cumulative decodedbodybytes atcontrols:111620040→71302278. Atworldready:110984189→65968311. Title bytes12652218 were unchanged and localuncompressed; do not present them as productionCloudflarewirebytes. BrowserResourceTiming is the measurement definition, not arbitrary modelinventorysum.

The after world phase issued **zero cavePNGrequests** after galleryready. The exact before r02 had three repeatedcavePNGs (muralatlas,botround,botshapes); the earlier read-only analysis described two in its separate r01baseline. Do not mix these repetitions or timings. All ten adopted verifiedwallpaintings remainedavailable through cache.

Further investigation must address the remaining essential transfer and CPU/entry delay without removing the accepted faces, shoreline, nearby world, gallery interaction or own-actor readiness. `startup-network-analysis-r04.md` is a prior hypothesis report; its estimated50.5MB is not the actual complete controls transfer here. Keep stage-wise bytes/timing and post-worldready requests separate when choosing the next change.
