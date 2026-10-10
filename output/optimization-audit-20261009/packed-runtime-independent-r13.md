# Packed runtime independent validation — 2026-10-10 14:01 JST

The r12 implementation plus r13 TypeScript narrowing fix passes the supported runtime integration gates. Production adoption is still r05-a02: the packed files used here are output-only fixtures, not adopted assets. The overall optimization and startup targets remain unfinished.

- Build: `packed-runtime-build-r13-r01.log`, passed. Related tests: `packed-runtime-tests-r13-r01.log`, 72 passed, 0 failed, 0 skipped. This is not a new full-suite result.
- Browser input is the frozen compiled client in `packed-runtime-r13-build-r01/dist`, using actual `WorldAssets` and `releaseLostContext`, not a substitute loader.
- Chrome: `output/playwright/optimization-20261009/packed-runtime-r12-chrome-r04/result.json`, `native-runtime-pixels-lifetime-passed`, 2 templates, no errors.
- WebKit: `output/playwright/optimization-20261009/packed-runtime-r12-webkit-r01/result.json`, same result, 2 templates, no errors.
- Snow has 3 levels and mountain has 2. All levels match their separate-file references at four angles. Each template uses one parse, one physical-file progress contribution, and independent per-level geometry/material state. Texture sharing preserves state.
- Both engines passed two context-loss/restore cycles and two eviction/reacquisition cycles per template, including a provider disposed after an actual parse. Owned bitmap, geometry, material and native GPU resources were released. The context test follows the production resource-release path before restoration.

Earlier failed harness attempts remain saved. Chrome r01 served the old raw-proof HTML due to a harness path replacement error; r02 requested restore before the native loss event had settled; r03 restored without the production lost-context resource release, leaving old-generation handles. The corrected r04 uses the actual game cleanup path and a settled native loss event. These failed attempts are not silently counted as passes.

The runner and HTML actually executed are frozen beside each browser result. No claim is made here about the combined PNG/repack candidate, real profile packages, whole-game recovery after adoption, ordinary-play frame times, startup time, GPU memory improvement or physical phones. The accepted raw packing proof reduced transfer bytes; GPU texture payload was unchanged. The combined candidate still needs separate review and validation.

Latest human policy remains High (`--effort high`) for every subsequent Claude start/resume, superseding Extra and MAX thinking in historical records. Existing first-party subscription only; no cloud, API billing, extra usage or credits.
