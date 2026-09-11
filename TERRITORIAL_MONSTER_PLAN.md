# Territorial purple monster

2026-09-09. The user explicitly reopened implementation with “create as enemy monster”. This work adds only the requested enemy; the previously deferred backlog remains future work.

## Appearance and production

Use the supplied `ChatGPT Image Sep 9, 2026, 09_16_01 PM.png`: purple, heavy amphibian-like body, enormous forearms, small hind legs, multiple eyes, facial barbels and a long thick tail. Preserve the source. Prepare an isolated reference, reconstruct with local TRELLIS-2, retain dense and revision files, and create a body-specific skin and animation rig. No primitive replacement or model fallback.

User correction: hind legs are degenerated/vestigial. They must remain tiny, close to the body, and must not support a conventional four-legged gait. Forearms and tail provide propulsion. The first isolated reference was rejected for overdeveloped hind legs before reconstruction.

Working name: 紫尾の巨獣 (Violet-tailed Behemoth), model key `violet-behemoth`. Latest user correction: a longer tail and total length **6 m**. Keep the approximately 2.06 m tall body and forearms from the 4 m revision and extend the tail by 2 m. Earlier 2.6 m height and 4 m length are superseded. The ground origin remains under the body, so the long tail extends behind it. Calibrate collision and attack reach from the final mesh.

## Gameplay

- One monster in a broad low marsh near a European grassland settlement: a shallow basin (0.22 m, shared walk surface) with ankle-deep tea-coloured pool sheets, mud, thinned tufts and a drifting mist; no trees or rocks. Keep a safe separation from homes and player spawn.
- Forward vision with line of sight; approaching from behind does not trigger detection. Tracked intruders can be pursued after turning behind it.
- Tail sways side to side before charging. Running uses sweeping, rotating forearms and fish-like lateral tail motion.
- Initial tuning: 300 health, 5.15 m/s charge (great ape sprint is 5.4 m/s), bounded territory. Tune timing and reach against the actual mesh and play tests.
- Charge, bite, and full-turn tail sweep. Server owns targeting, telegraphs, hit times, ranges, obstruction, damage and recovery. No repeated damage from one strike.
- Leaving territory immediately cancels pursuit and attacks; the monster returns to its exact home, then resumes guard duty. Preserve existing defeat/recovery and inventory rules.
- Include death/respawn, reconnect and saved-world compatibility, animation timestamps, health and readable attack cues.

## Verification and delivery

Verify exported GLB structure, dimensions, materials, skin, all clips, loop boundaries, in-place movement and contact. Test forward/rear detection, all attacks, escape, return, obstacles, damage, defeat, respawn and snapshot compatibility. Run build/type checks and regression tests, then inspect the real game in desktop/mobile dimensions and multiplayer.

Use an isolated preview and save directory during development. Do not reapply an old save or change exhibition/public deployment. Record completed checks and remaining limitations without claiming unperformed tests.

Status: complete in the workspace and isolated preview. Adopted rig revision 03, total length 6 m, 67,223 triangles, 20 bones and 9 clips. Full 412 tests, build/type checks, syntax/architecture and real Chrome multiplayer/responsive verification passed. The final death pose was corrected; the other eight clips, source surface and materials match reviewed revision 02. Details and limitations: `assets/violet-behemoth/README.md`. Preview: http://localhost:3022/ with a separate save directory. Normal port 3000 was not stopped or restarted; no old save was reapplied. Concurrent carry-support work is outside this request.
