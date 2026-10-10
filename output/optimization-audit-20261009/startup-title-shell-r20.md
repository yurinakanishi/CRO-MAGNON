# r20: title shell, game-module handoff and startup timing marks

2026-10-10, runtime026 (Opus 5.5, High). This implements the first production slice of `startup-whole-design-r19.md` §5, plus the minimal timing marks from its slice 2.

- No command was run. Build, tests, check, format and native QA are Codex's.
- Nothing was committed, pushed, deployed or published.
- Assets, the asset graph, r04/r05 records, servers and saves are untouched.

**This slice does not reach 5 s or 4 MB, and it does not improve the time from confirmation to controls.** It moves where the existing game-module wait is seen: from before the title to between the title and setup. Codex reports that wait, and the bytes sent before confirmation, as their own figures.

## Files

| File | Change |
|---|---|
| `public/index.html` | Entry is `/src/boot.js`. The import map and stylesheets are unchanged. |
| `src/boot.ts` (new) | Renders the shell, starts the one configuration request, and imports `./main.js` once (see the boot rules below). |
| `src/title-shell.ts` (new) | `titleScreenMarkup()` and `modalMarkup()` (moved verbatim from `main.ts`), `GAME_TITLE`, `titleArtPath`, `titleLinks()`, `TitleShellSession`, `renderTitleShell()`, `takeTitleShell()`, `titleShellConfig()`, `titleShellShown()`. Importing it has no side effects. |
| `src/icons.ts` (new) | `icons` and `icon()` moved unchanged out of `main.ts`. |
| `src/startup-marks.ts` (new) | `StartupMarks` and the shared `startupMarks` instance. |
| `shared/friend-mascot-roster.mts` (new) | The `FRIEND_MASCOTS` literals (their `Object.freeze` included) and the `FriendMascotDefinition` interface, moved unchanged. It has no runtime imports. |
| `shared/friend-mascots.mts` | Imports the roster and re-exports it. Every existing user gets the same frozen object. |
| `src/title-credits.ts` | Imports the roster, which cuts the old chain `friend-mascots → world → paleo-geography → datasets`. |
| `src/main.ts` | Detailed below. |
| `src/loading-cave.ts`, `src/world3d.ts` | Timing marks only; no behavior change. |
| Tests | `tests/title-shell.test.mjs`, `tests/startup-marks.test.mjs`, `tests/title-boot.test.mjs` (new). `tests/game-title.test.mjs`, `tests/screens.test.mjs`, `tests/title-mural.test.mjs` and `tests/title-start.test.mjs` updated to the new source locations. |

**Boot rules (`src/boot.ts`):**
- It imports `./main.js` once, as soon as the shell has painted (`requestAnimationFrame`, then `setTimeout(0)`), or immediately if the page is hidden.
- It never imports when the configuration has failed.
- A rejected game import shows an explicit error with a reload button: in the shell while it is still shown, otherwise as a `.context-recovery` panel.
- `?autostart=1` imports `main.js` directly, with no shell.

**`main.ts` changes:**
- It awaits `titleShellConfig() ?? loadMultiplayerConfig()`, so there is one configuration request.
- On a configuration failure it overwrites `#app` only when no shell is shown, which keeps the old direct-import behavior.
- It takes the shell before rendering.
- It extracts `bindContributorsVisit()` and `visitContributorsCave()`; the visit code itself is unchanged.
- It adds `resumeTitle()` and the attempt marks.

## Handoff contract

1. **Boot renders the shell.**
   - The shell is `<section class="game-viewport"><div id="screens">` plus the title, followed by `<dialog id="modal">`, with the same markup functions `main.ts` uses.
   - It uses the same `touch-mode` rule as `main.ts:255`.
   - `ScreenManager.show('title')` gives the same focus, menu-key and viewport behavior.
2. **Title controls before the game module:**

   | Control | Shell behavior |
   |---|---|
   | Fullscreen | Toggles itself. A refusal shows a notice line instead of the toast. |
   | 関わってくれた人たち | Opens the same `contributorsDialogMarkup` with links only when `titleLinks(config)` is true: `mode !== 'lan'` and not an exhibition build, the same rule as `onlineTitle`. If the configuration failed, it shows no links. Works while `main.js` is blocked. |
   | はじめる / the dialog's cave visit | Records intent `start` or `contributors-cave` and shows `準備しています…` (`role=status`). The visit closes the dialog first, as the game's handler does. |

   **Latest action wins.** Opening the credits withdraws a pending start. A credits request still waiting for the configuration is dropped if a later action or the handoff happens first.
3. **Failure** (configuration or game import): an error line (`role=alert`) and a 再読み込み menu button. Credits stay usable. A failure is never shown as busy, and a notice never hides it.
4. **`takeTitleShell()`**, called once by `main.ts` right after its configuration await:
   - aborts every shell listener, including the dialog, document and title ones (one `AbortController`);
   - destroys the shell's `ScreenManager`;
   - clears the busy, notice and error line;
   - detaches `#screen-title`;
   - returns `{ viewport, title, dialog, intent, contributorsOpen }`. `intent` is consumed, and later calls return `null`.
5. **`main.ts` adopts the nodes.**
   - It inserts its own viewport before the shell's, removes the shell's viewport, and prepends the same title node to its `#screens`, so the title artwork is fetched once.
   - It leaves `#modal` in place, so an open modal dialog stays modal.
   - Its existing top-level `#modal` handlers bind to that adopted node. No duplicate IDs remain, and all of this happens synchronously with no paint in between.
6. **`resumeTitle(handoff)` runs once, at the end of `main.ts` evaluation:**

   | Handoff state | Action |
   |---|---|
   | contributors dialog open | `screens.show('title')` and `bindContributorsVisit()`; nothing is replayed |
   | `start` | `showTitle()`, then `showSetup()` |
   | `contributors-cave` | `showTitle()`, then `visitContributorsCave()`, unless rendering is unavailable or a cave is already loading |
   | none | `showTitle()` |

   Later `showTitle()` calls (leave, back) never replay.
7. **Unchanged:** a direct `/src/main.js` import (QA pages) has no shell and renders its own title and dialog exactly as before. Exhibition/LAN and `?autostart=1` keep their world/background and start rules (`deferWorld` is unchanged). Join still happens on Proceed.

## Startup marks

Each mark is a `performance.mark('cro:<name>', { detail })`. QA reads them with `performance.getEntriesByType('mark')`. Nothing is sampled per frame, nothing is displayed, and the marks do nothing without User Timing.

| Scope | Marks | Recorded |
|---|---|---|
| Page (once per page) | `title-interactive`, `game-module-ready`, `world-start`, `world-critical-loaded`, `world-build-start`, `world-build-end`, `world-fit`, `world-prepare-start`, `world-ready` | Page marks survive new attempts. There is one world load per page (`initializeWorld` is cached), so world boundaries are page marks and can predate the attempt in exhibition/autostart, where the world is not deferred. |
| Attempt (`enterGame` starts one; it clears the previous attempt's marks) | `confirm`; `cave-load-start`, `cave-catalog`, `cave-template` (template + actor), `cave-images`, `cave-playable` (after the first presented frame); `proceed`; `status`; `socket-open`; `welcome`; `first-state`; `arrival-ready` (gallery path only); `controls` (when `playReady` first latches) | Each at most once per attempt. A loading cave, a `connect()` and an arrival keep the attempt they started in, so a late callback after leave, failure or restart records nothing. Reconnects within an attempt add nothing. |
| First actions (attempt-scoped, real input only) | `first-move-sent` (first nonzero `move` actually sent after controls), `first-move-confirmed` (first state whose own server position is ≥ 0.05 m from the position at controls, after a move was sent), `first-gather-sent` (first `action: 'gather'` sent), `first-gather-confirmed` (server `gathered` count rose) | Nothing is synthesized. If the visitor never moves or gathers, those marks are absent. |

**Bounded:** at most 9 page marks and one entry per attempt mark exist at any time (`tests/startup-marks.test.mjs` checks this over 50 attempts).

**Not marked:**
- per-file critical downloads (the network ledger has them);
- the confirmation of gather kinds other than `gather`;
- Proceed or arrival on the non-gallery (autostart/exhibition) path, where arrival is not awaited, so only `controls` exists there;
- a position change caused by something other than the move (a warp right after a move would count as confirmed). Compare `first-move-confirmed` with the authoritative movement before using it.

## Tests authored (not run)

**`tests/title-shell.test.mjs`:**
- Exercises `TitleShellSession` through a recording view:
  - intent consumed once, with listeners released once;
  - every action inert after handoff;
  - latest action wins;
  - the cave visit closes the dialog;
  - an open dialog is handed over without replay;
  - a credits request racing the configuration yields to a later start or to the handoff;
  - configuration and game failures show an error (never busy), keep credits working without links, and are not hidden by a notice.
- Also covers: the link rule; the markup (one title artwork element, IDs, no title or dialog markup left in `main.ts`); roster identity and the credit names.
- Runs the emitted `resumeTitle` against all handoff cases in a VM.

**`tests/startup-marks.test.mjs`:** once per attempt; old attempts cleared; stale owners ignored; page marks persist; bounded entries; no User Timing or a throwing one is harmless.

**`tests/title-boot.test.mjs`:**
- `index.html` has the single module entry `/src/boot.js`.
- The emitted static closure of `boot.js`, parsed with TypeScript, contains no `/vendor/`, no dataset or `landmark-bounds`, no world, terrain, collision, friend-mascots, `main`, `world3d`, `loading-cave` or verified-asset module, and no unmapped bare specifier.
- `boot.js` imports `./main.js` exactly once and only dynamically, after `requestAnimationFrame`.
- `main.js` still statically reaches `title-shell` and `startup-marks` but not `boot`.
- `title-shell.js` has no top-level effects.

**Still for native QA (Codex):**
- DOM-level adoption: one title-art request; no duplicate IDs or listeners; no flash; focus.
- Blocked-`main.js` title, blocked configuration, exhibition/LAN, autostart, repeated entrance.
- The marks compared with the network ledger and authoritative movement.

## Budget, unchanged by this slice (do not read as progress toward 5 s or 4 MB)

| Item | Current figure |
|---|---|
| Mandatory server body before controls (adopted r05 r01, identity transport) | 69,236,322 B; confirmation→controls 51.4–53.6 s |
| Bytes before the title is usable | from 13,543,024 B to about 455,816 B (HTML, CSS, title art) plus the new small modules — expected, not yet measured |
| `main.js` static closure (imports report r01) | 244 modules, 12,523,754 B raw; gzip -9 1,905,698; brotli q5 1,885,444. Those bytes are still mandatory before confirmation. The measured server sends identity, so no compression saving is claimed. |
| Arrival content at the camp (exact r05 assets) | 35,963,417 B: actor 5,412,684 + spears 351,356 + cave 9,706,377 + world LOD0 20,493,000 |
| Gap to the provisional 4,000,000 B | ≥ 65.2 MB of identity transfer. Without the deferrable LOD-level files (11,533,824) and the non-critical streaming before controls (6,062,162) it is still ≥ 47.6 MB. |
| Woman actor (GLB r01) | geometry 3,793,685 + animation 591,055 + skin 1,216 + images 776,340. The head has 3,531 unused and 6,770 duplicate vertices across all attributes, but 65,700 used unique tuples remain, so 16-bit head indices are still infeasible. |
| PNG proof r21 and packed snow/mountain LOD proof | Pixel-exact on Chrome and WebKit, but transfer-only, not combined into r06 and not adopted. Their savings are not counted here, and the two must not be summed where they overlap. |

## Limitations and reports outside my scope

- **Shell status lines** reuse the existing `form-note`, `form-error` and `menu-item` classes (CSS is not in my scope). Their placement inside `.title-welcome` needs a screenshot check.
- **Backdrop:** before `main.js` there is no canvas behind the title, so the backdrop may differ from the later WebGL sky. This is for user acceptance.
- **The title→setup wait** is now visible after はじめる (busy line). Its length equals the game-module load, about where the title used to appear.
- **QA scripts that assume `index.html` loads `/src/main.js`:**
  - `scripts/qa-movement-smoothing-host.mjs:18` replaces that string and will no longer find it.
  - `scripts/qa-cloudflare-release.mjs:10` lists required files; `src/boot.js`, `src/title-shell.js`, `src/icons.js`, `src/startup-marks.js` and `shared/friend-mascot-roster.mjs` may need adding.
  - Scripts that inject a page with `<script src="/src/main.js">` or route `main.js` keep working, because `main.js` still self-renders without a shell.
- **The release and exhibition builders** were not edited. `boot.js`'s dynamic import must stay resolvable for the environment audit.
- **Prettier:** may reflow some lines in the new modules. Codex runs format.
