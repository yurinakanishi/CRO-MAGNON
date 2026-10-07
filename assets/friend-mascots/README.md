# Contributor friend mascots, Howkey's flask and the contributor cave friezes (2026-10-07)

User request: add character mascots for the contributors, list everyone in the title's
「関わってくれた人たち」 with their X icon, name and link, paint them on the cave wall,
and give Howkey (@hawkymisc) an Erlenmeyer flask. Codex `image_gen` may be used for
references; TRELLIS-2 for geometry.

| X account | In the game | Source of the look |
|---|---|---|
| @Saber5656 (Saber@codexer) | new companion `saber-mascot` 「Saber」 | user-supplied `HPqk-oibgAA8hy8.jpg` |
| @eerm16g (りさ) | existing companion こはくちゃん (`kohaku`) | already delivered; credit added |
| @Fairy_Yoshizawa (吉澤フェアリー🇯🇵) | new companion `fairy-mascot` 「フェアリー」 | X profile photo, stylised |
| @Sagasa8045 (さが@迷えるインドア派アニオタSEおじ) | new companion `sagasa-mascot` 「さが」 | user-supplied `HT8ceKObgAALphG.jpg` |
| @nukonuko (ぬこぬこ / NUKO 🇯🇵) | new companion `nukonuko-mascot` 「ぬこぬこ」 | X profile icon |
| @hawkymisc (ほーきー(Hawkie)) | existing playable Howkey + new flask `howkey-flask` | already delivered; flask added |
| @otani_ai_memo (オータニ@AI駆動開発) | new companion `otani-mascot` 「オータニ」 (duck) | X profile icon |
| @yuki_urata (浦田 勇樹 …) | new companion `urata-mascot` 「うらた」 | X profile icon |
| @asahina_AIauto (朝日南) | new companion `rei-mascot` 「怜ちゃん」 (added 2026-10-08) | user-supplied character sheet and illustration of 怜ちゃん (Rei-chan); same character as the X icon |

Note: on 2026-10-07 Sagasa8045's current X icon is the straw-hat cat girl of
`HPqk-oibgAA8hy8.jpg`, and Saber5656's icon is a blonde braided girl. The images were
used exactly as assigned in the request (HPqk → Saber, HT8ce → Sagasa); swapping them
only changes `credit`/`name` in `shared/friend-mascots.mts` and the friezes' captions.

## Credits

`src/title-credit-profiles.ts` adds りさ, Saber@codexer, 吉澤フェアリー🇯🇵, さが,
ほーきー(Hawkie) and 朝日南 to `TITLE_FRIENDS` (友情出演, no QR, so the exhibition QR credits are
unchanged). オータニ, 浦田 and ぬこぬこ were already credited under 監修 with icon and link.
Each card now also shows the person's character: 「仲間・壁画：<name>」 (Howkey:
「キャラクター・壁画」), from `CONTRIBUTOR_CHARACTERS` in `src/title-credits.ts`.
X icons are the public 200×200 profile JPEGs, recorded in
`assets/title-credits/x-avatars-2026-10-07b.json`. The public release build still shows
only 開発者 in 監修 (unchanged policy), so the three 監修 entries appear only locally.

## Companion behaviour

`shared/friend-mascots.mts` is one catalog-driven module for all seven new companions
(instead of a copy per mascot): petting starts the bond, a 1.4 s stroke and 1.4 s
happy reaction with hearts, following at 1.65 m, dismiss/return along the remembered
trail, soft recoil when struck (no health, death or loot), saving/restoring the owner,
selection cards (全選択 included), the close-up 「見る」 and cave rules shared with the
other mascots. Actions: `petFriend` / `dismissFriend` with `targetId` = model key.
`src/friend-mascot-renderer.ts` renders each from the shared `Idle_Loop`, `Walk_Loop`,
`Run_Loop`, `Pet`, `Happy`, `Hit`, `Wave`, `Bow` clips. Homes surround the first camp
fire, facing it.

## 3D pipeline (`assets/friend-mascots/workflow/`)

1. `make_requests.py` → Codex CLI 0.162.0-alpha.2 (`run-codex-refs.ps1`): one
   rig-friendly front reference per character (arms out ~15°, clear gaps, transparent
   background), identity image attached. The elevated Windows sandbox of this Codex
   build could not spawn commands and `gpt-5.6-sol` was at capacity, so the runs use the
   configured default model with `windows.sandbox="unelevated"`. Failed logs are kept as
   `codex-v1.failed-sandbox-capacity.log`.
2. `scripts/remake/trellis_queue.py`: local TRELLIS-2 v0.8.1, seed 42, res 1024 / tex
   1024 for characters (512 for the flask), supplied alpha.
3. `surface.sh`: meshoptimizer position-only reduction (~24k triangles) →
   `prepare_surface.py` (Blender 3.6.2): weld, drop tiny floating islands, Smart UV, 2048
   diffuse-colour bake from the exact dense mesh, scale to 0.52 m, soles centred, deviation
   report, orthographic sheets. The dense sources' metallic input is zeroed before the
   bake: TRELLIS marked Rei's leather/hair (0.89), nukonuko (0.32) and Saga (0.28) as
   partly metallic, and a diffuse-colour bake returns base × (1 − metallic), which had
   crushed those colours; they, Urata and the duck were re-baked with identical geometry
   and re-rigged (Saber and Fairy were ~0 and unchanged). Blender's own decimate collapsed the first attempt and a
   UV-locked meshopt pass stalled near 65k triangles while its permissive seam collapses
   speckled the atlas; both are kept as failed revisions.
4. `texture_fix.py` (only where TRELLIS mis-textured a part, e.g. Saber's tail): repaint
   that region's texels from the character's own colour; geometry/UVs unchanged.
5. `rig.sh` → `rig.py` (adapted from Kohaku's rig) with `<key>/rig.json` landmarks:
   biped skeleton, optional tail / back-hair / skirt chains and rigid zones (wings, hair),
   eight 60 fps in-place clips with leg IK and sole locking, LOD from 8 m; then
   `render_poses.py` + `sheet_poses.py` pose sheets for review.
6. `scripts/adopt-friend-mascot.mjs <key> <rev>`: publishes `model-rNN.glb`,
   `lod-rNN.glb`, `portrait.png` (the reference) and catalog records.

Howkey's flask: same reference/TRELLIS/bake path, `pivot_flask.py` puts the origin at the
neck grip; `src/flask-pose.ts` keeps it upright in her right `Grip.R` and hides it while
that hand gathers, pets, throws, fishes or works the shore. Howkey stays hidden in the
normal local game by `local-visibility.json` (`howkey: false`, the earlier user setting);
set it to `true` to see her there.

## Cave friezes (gallery r34, r35)

`make_mural_requests.py` → Codex image_gen with the character references and the
mae/Kohaku frieze as style reference. `friends-meadow-lascaux-r34.png` (Saber, Fairy,
nukonuko, Saga among a horse, an ibex and a stag) replaces the lone deer;
`friends-river-lascaux-r34.png` (the Otani duck, Urata, Howkey with her flask among an
aurochs, a bison and a horse) replaces the lone bison, both on the west wall. Unmodified
transparent PNGs, `scripts/adopt-friends-murals.mjs`; wall coverage
`assets/camp-cave/qa/gallery-surfaces-r34.json` (221/221 samples on the wall, 0 missing).
r35 (2026-10-08) repaints the river frieze from the r34 painting to add 怜ちゃん holding a book
beside the duck, Urata and Howkey (`friends-river-lascaux-r35.png`, r34 kept); coverage
`gallery-surfaces-r35.json`, again 221/221 for both friezes.

## Delivered models (all 0.52 m tall, 8 in-place 60 fps clips, LOD from 8 m)

| key | rig rev | triangles | LOD | bones | GLB bytes | notes |
|---|---|---:|---:|---:|---:|---|
| `saber-mascot` | r01 (surface r02) | 23,687 | 7,102 | 34 | 7,781,548 | tail + back-hair chains, skirt; tail texels repainted (TRELLIS textured the tail as dark noise) |
| `fairy-mascot` | r01 | 22,035 | 9,882 | 27 | 7,424,528 | wings bound to the chest, skirt |
| `sagasa-mascot` | r03 (surface r02) | 23,632 | 10,624 | 23 | 6,685,712 | r01 kept the curly-hair LOD at 18,899; LOD gate relaxed to p95 0.6 % / max 4 % of H; r03 = metallic-free re-bake |
| `nukonuko-mascot` | r02 (surface r02) | 21,998 | 9,863 | 37 | 7,168,968 | ears, back-hair and right-side curling tail chains, skirt; r02 = metallic-free re-bake |
| `otani-mascot` | r02 (surface r02) | 23,453 | 4,684 | 23 | 6,785,896 | TRELLIS folded the wings into a feather fan behind the body (seed 42 and a second seed 1234 alike, the latter kept unadopted); the fan rides on the hips, `armless` |
| `urata-mascot` | r02 (surface r02) | 23,877 | 4,773 | 23 | 6,444,916 | longer arms, resting angle 50°; r02 = metallic-free re-bake |
| `rei-mascot` | r01 (surface r02) | 23,178 | 6,947 | 25 | 6,498,892 | long hair on a back-hair chain; surface r01 was the dark metallic bake |
| `howkey-flask` | r01 | 4,997 | – | – | 1,194,284 | 15 cm, neck-grip pivot |

TRELLIS-2 at res 1024 took about 17–19 min per character on the RTX 3070 Laptop (8 GB).
Reduction error against the dense surfaces: p95 0.8–1.4 mm, max ≤ 4.3 mm. Selection-card
portraits are the references cropped to 480 px tall. Records: `<key>/rig.json` (input),
`<key>/rig-record.json` (rig output), `public/models/<key>/asset.json`; the public
texture manifest has all 15 current GLBs (`scripts/prepare-friend-public-assets.mjs`; superseded ones removed).

## Verification (2026-10-07/08)

- `tests/friend-mascots.test.mjs` (new, 5): real camp placement, pet → bond → follow →
  dismiss home, ownership and one-stroke-at-a-time, recoil without health, save/restore
  and old saves, cards/credits/friezes/GLB SHAs. Updated mascot-selection, maruimo,
  title-mural, cave-rimo and camp-surface tests for the larger roster and the r34 walls.
- Full suite 1036/1039; the 3 failures are the existing resource/mammoth tests recorded
  before this work. `npm run check` passes (types incl. strict configs, 538 JS files,
  architecture boundaries).
- `scripts/qa-friend-mascots.mjs` in real Chrome with four websocket observers, isolated
  memory world (nothing saved): all six friends V-petted with hearts and the same contact
  clock on five clients, bonded; 20/20 cards with 全選択; selected friends follow a real
  W walk; Howkey holds the flask (`howkey` mode); both friezes on the cave wall, lit by the
  hearth (lit with E) and the five visitors' torches (`cave` mode, screenshot brightness
  checked). 0 page/console/HTTP errors. Final runs with all seven: `r07`, `r07-howkey`,
  `r12-cave` under `output/playwright/friend-mascots-20261007/`; copies in `qa/`. Earlier
  cave captures (r04–r09) were black: the hearth flag was set server-side without a
  broadcast and the friezes lie beyond the hearth light; kept as failed evidence.
- Not verified: real phones, Safari, physical gamepads, long sessions; the duck's wings do
  not flap (no free wing geometry).
