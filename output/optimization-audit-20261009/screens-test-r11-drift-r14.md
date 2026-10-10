# screens.test.mjs: assertions left stale by r11 HUD writes (r14)

Runtime session 026f16c0-538a-4645-99e9-a78a97eaa58f, 2026-10-10. The only file changed is the test `tests/screens.test.mjs`. No production, asset, proof or publisher file was changed, and nothing was run.

## What failed and why

`adopted-r05-full-tests-r01.log` lists exactly two failures, both in this file. Both are source-text assertions written before r11:

| Test | Line | Assertion that failed | What r11 wrote instead |
| --- | --- | --- | --- |
| `tests/screens.test.mjs:8` | 17 | `$('#riding-hint').hidden = !ridingHint` | `setFlag($('#riding-hint'), 'hidden', !ridingHint)` (`src/main.ts:1624`) |
| `tests/screens.test.mjs:33` | 37 | `$('#interaction-hint').hidden = !target` | `setFlag($('#interaction-hint'), 'hidden', !target)` (`src/main.ts:1001`), with the label written by `setText($('#interaction-hint span'), target?.label ?? '')` (1002) |

## Evidence that the behaviour is unchanged

- **`setFlag` leaves the same DOM.** `src/hud-dom.ts` `setFlag` skips only when the attribute is already exactly `''` (true) or absent (false); otherwise it performs `element[name] = value`.
  - `tests/hud-dom.test.mjs` checks it against the plain `element.hidden = …` on twin spec-modelled elements.
  - After every step, attributes and children must be identical, including for the non-canonical `hidden="hidden"` and `until-found`.
- **Nothing else in the interaction-hint logic changed.**
  - `src/main.ts:1000-1002` still sets `target = nearby()`, hides the hint when there is no target, and writes the target's own label.
  - The markup still starts hidden (`id="interaction-hint" hidden><kbd>E</kbd><span></span>`).
  - The gather range (`range: GATHER_RANGE`) and the visibility filter (`renderer.resourceVisible?.(r.id)`) are unchanged.
  - No other code writes the hint's `hidden`. The other references set role, tabIndex, click and key handlers, or the key label.
- **Native evidence.** Codex's 57-state exact DOM/property/minimap parity against the old HUD, and the native touch checks, passed after r11.

## The change (assertions only)

- **The helper is the real one.** Both tests now require that `main.ts` imports `setFlag` from `./hud-dom.js`, and that it defines no local `function setFlag`.
- **Riding hint.** The test requires the exact call `setFlag($('#riding-hint'), 'hidden', !ridingHint)`. Generic `setFlag` calls are not accepted. The other assertions in that test are unchanged, including the boat hint's direct `hidden = !hint` in `boat-ui.ts`, which r11 did not touch.
- **Interaction hint.** The test requires the exact contiguous sequence:
  1. `const target = nearby();`
  2. `setFlag($('#interaction-hint'), 'hidden', !target);`
  3. `setText($('#interaction-hint span'), target?.label ?? '');`

  It also requires that `main.ts` sets the hint's `hidden` exactly once, and never through a direct `$('#interaction-hint').hidden =` assignment. The markup, "no generic 調べる label", `GATHER_RANGE` and `resourceVisible` assertions are unchanged.

## Why coverage remains

- **The hint stays hidden without a real target.** The hidden flag is still bound to `!target` with `target = nearby()`, through a helper proven equivalent to the assignment.
- **Coverage is now tighter.** The test also pins the visible label to that same target and rules out a second, generic writer of `hidden`.
- **Product code was not touched.** Nothing in product code was changed to satisfy a regex.
- **Not yet confirmed by a run.** Codex should rerun `node --test tests/screens.test.mjs` and the full suite.
