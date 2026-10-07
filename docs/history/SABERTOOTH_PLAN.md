# Sabre-toothed cat enemy

2026-09-11. User request: 「敵のサーベルタイガーつくって。かなりつよいし、動きも早い。ステップとかしてくる。ジャンプ飛びかかりとか。」 — a strong, fast enemy that side-steps and pounces. This adds one enemy; it does not reopen the deferred backlog.

## Appearance and production

The host has no local image generator, so at the user's direction the reference came from the Codex CLI's built-in `image_gen` (`gpt-5.6-sol`, reasoning `medium`), run from Claude Code with a fixed prompt (`assets/sabertooth-tiger/source/codex-request.txt`). Three colourways were generated; the user chose **candidate 01** (tawny, faint stripes). The chosen PNG is `source/original/reference-v1.png`; provenance records the generator honestly (`asset.json → provenance`).

Pipeline: BiRefNet matte → local TRELLIS-2 (1024, seed 42, 535 s) → weld, floater removal, bounded speckle smoothing, QEM at ratio 0.25 within surface tolerances (72,892 triangles; p95 deviation 1.5 mm, max 5 mm) → rigid spine-line yaw and uniform 2.6 m length → quadruped rig (24 skin joints, no jaw: the mouth is closed and the sabers hang in front of the chin) → nine clips at 60 fps keys. Working name 剣牙の大虎, key `sabertooth-tiger`. No visible geometry is authored; only the TRELLIS surface is skinned.

Rig notes: paws are found by splitting the ground-contact cluster at the largest gap per side; leg columns are traced upward in thin bands; the back midline is measured per slice because the reconstructed pose is slightly bent. Planted paws use two-bone IK with the paw kept in rest orientation, plus a scapula glide that adds reach at stride extremes (residual planted-paw shortfall ≤ 0.09 m in Walk/Run, none elsewhere). Belly and chest midline vertices are handed back to the torso so opposite legs cannot tear the underside; fur tufts are smoothed across spatially adjacent shells so touching strands share bones. Ground lock lifts the body when the lowest vertex sinks below 2 mm.

Clips (in-place; the server moves the body): `Idle_Loop` 3 s, `Walk_Loop` 0.8 s (1.3 m/s lateral-sequence walk), `Run_Loop` 0.4 s (6.2 m/s rotary gallop), `Alert` 0.6 s roar, `Pounce` 1.55 s (0.45 crouch, 0.6 leap with reaching forelegs, 0.5 landing), `Step` 0.35 s tucked hop, `Attack` 1.0 s two-swipe claw (impacts at 0.32 s and 0.62 s), `Hit` 0.3 s, `Death` 1.5 s side collapse.

## Gameplay

- One cat on the snow plain just south of the starting camp at `(80, −30)`, 85 m from the camp fire, east of the river that runs south through the plain — the nearest snow post whose 14 m pounce ground stays dry (river 15 m away), clear of the coast (32 m) and outside the castle grounds (14 m beyond their clearance); the territory's western edge reaches the fordable river. It first stood north of the Siberian snow-plain fire at `(493, −19)`; on 2026-09-11 the user moved it to the European grassland at `(−25, 50)` and then to this snow plain. Territory radius 24 m; no tree stands within 28 m of the post (the whole territory), and rocks are cleared within ~14 m. The map draws an amber territory ring and label.
- 340 health. Chase 6.2 m/s — faster than the great ape's 5.4 m/s sprint — so the territory edge is the only escape. Walks home at 1.5 m/s.
- Detection: 24 m forward cone (±75°) with line of sight, plus 7 m hearing all round.
- Pounce (30): from 3.5–10 m, a still 450 ms crouch (interruptible by a hit) then a 600 ms leap toward the target's led position with super armour (damage counts, no flinch), one hit on body contact after 45 % of the leap, then a 500 ms landing opening. 2.6 s cooldown.
- Claw combo (16 + 16): within 0.9 m reach, two separate frontal swipes with independent hit lists; every second combo ends with a back-step.
- Side-step: when a player's thrust/swing is winding up within 4.2 m and aimed at it, or a light orb is flying at it within 6 m, the cat hops 3.4 m across the line of attack (alternating sides, walls checked; backs off if both sides are blocked). Its body cannot be targeted during the hop; 1.8 s cooldown; a pounce is allowed immediately after.
- Leash, return, recovery, death (1.5 s) and respawn (90 s, waits for a free post), reconnect and old saves follow the behemoth pattern; restore clears strikes, super armour and evasion and resumes from a return.

## Verification

`tests/sabertooth.test.mjs` (12): old-save addition and restore, forward/hearing/rear detection, outrunning the ape, pounce phases and single hit, crouch interruption, super armour mid-leap, two claw swipes, side-step on a thrust (thrust misses, cooldown), side-step on an orb, leash cancel and exact return, death/respawn, client clip requirements and one-shot sampling. Numeric GLB QA at 60 Hz (`assets/sabertooth-tiger/numeric.json`): no root motion, loop closure 0, ground ≥ −2 mm, edge stretch ≤ 5.6×. Pose sheets (`assets/sabertooth-tiger/r11-sheet-*.png`) reviewed for left, three-quarter and front. Browser QA: `node scripts/qa-sabertooth.mjs <out>` (two real Chrome pages + three socket peers against an isolated in-memory server; roar/sprint/pounce/claw damage in real time, real F-key thrust dodged, escape, return, keyboard movement, 390×844 / 844×390, reload, death).

Status and limitations are recorded in the AGENTS.md entry for 2026-09-11.
