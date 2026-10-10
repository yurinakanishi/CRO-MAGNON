# Adopted CPU profile for the next measured optimization

This is diagnostic attribution, not a normal FPS result. The normal performance evidence remains `performance-adopted-r04.md`.

Frozen adopted-r04-build-r01, applied r04 manifests, Windows Chrome154,390×844DPR1touch,CPU×4,fixedherd,one renderer+fourpeers. Requested6-second samples and1msV8 profiler sampling. Actual sampled durations: camp8619.274ms, mammoth7115.962ms, overview7061.899ms. CPU throttling and profiler overhead affect sampling; large `(program)` time is unclassified, not evidence of a specific game function. No forcedGC. Evidence `adopted-r04-cpu-profile-r01/{camp,mammoth,overview}.cpuprofile`, `cpu-attribution.json`.

| Function | Camp self ms | Mammoth self ms | Overview self ms |
| --- | ---: | ---: | ---: |
| Three updateMatrixWorld |291.428 |396.588 |325.493 |
| drawWorldMap |242.632 |200.163 |183.376 |
| Three projectObject |185.265 |201.437 |168.703 |
| Three setProgram |135.673 |126.756 |133.132 |

Application inclusive samples also identify updateHuntingHUD529.963/840.095/482.231ms and updateHUD686.092/754.914/530.886ms. In the mammoth view, companionViewChoice includes591.387ms and its descendant collision segment/free queries are visible. These are call-stack attributions, not independent buckets: do not sum overlapping inclusive values, especially recursive updateMatrixWorld/projectObject occurrences.

Review candidates after subscription reset: unchanged static transforms and scene traversal, redundant HUD/nearby interaction work, and static minimap terrain redraw. Establish actual call counts and behavior invariants before implementation; no vendor patch, stale dynamic transforms, invisible player, changed map information or relaxed gameplay/collision tests. Compare the same unprofiled12-second samples after any change, including CPU1desktop andCPU4portrait. This profile has not been reviewed by Claude yet: r08 was rejected after4reads before these files existed.

Loading is separate. The adopted calibrated network run reaches worldready56.95s and controls63.04s afterconfirmation. Between those phases, a4.34MBmammothbody download that began beforeworldready finishes, and meat/LOD/background assets also arrive. These timings do not by themselves prove the controls explicitly await mammoth loading; inspect the entry path and measure synchronous decode/compile work before assigning a cause. No repeatedwallpaintingPNGs occurred aftergalleryready.
