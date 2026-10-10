# Packed-primary model identity (r23)

Status: **written, not run.** No command or test was executed. Nothing under `public/` or
`assets/` was touched, including r06 and every adoption record. No production file changed.

## Scope

This is the pre-apply integration the r22 note named. `tests/camp-landform.test.mjs` runs
`verifyModelSource('camp-mountain')`. After an r06 adoption, camp-mountain serves the packed
`model-levels.opt-<sha16>.glb`, and the old helper would have refused it.

## Changes

**`tests/runtime-model-identity.mjs`:**

- **`modelIdentities`** (now exported) detects a packed template by any `scene` key on the record
  or a LOD, including `null`.
  - **Unadopted with a scene:** refused (`a packed scene without an adoption stamp`).
  - **Adopted:** after the existing stamp checks (complete stamp, complete original, served ≠
    original), every level must name scene `index` as an integer and exactly the served
    url/sha256/bytes, with at least two levels. The served URL must be
    `/models/<key>/model-levels.opt-<sha16 of served SHA-256>.glb`.
  - **Ordinary records** (no `scene` anywhere) follow the old path unchanged and still require
    `<original name>.opt-<sha16>.glb`. The return value gains `packed`.
- **`verifyModelSource`**, for a packed record, adds three steps to the unchanged ones:
  - **Graph check:** `assertPackedAdopted` runs the build graph's own `checkRuntimeGraph`
    against `activeAdoption` (journal applied and bound to its plan). It enforces the exact
    adopted packed entry, scenes 0..N in order, one content-addressed `model-levels` file, and the
    stamp's adoption id.
  - **GLB structure:** the packed GLB's JSON chunk must have default scene 0 and exactly one scene
    per level. Scene 0 is the scene `assertSameGeometry` decodes.
  - **Unchanged steps:** `assertRecorded` (the plan chain, hash by hash, to the saved original;
    stamp vs graph; the served primary and its source), the original's exact SHA/length, the
    served file's exact SHA/length and GLB magic, and value-for-value geometry against the
    original.

**`tests/runtime-model-identity.test.mjs`** (new, synthetic, reads no file):

- **Ordinary records:** unadopted and adopted records behave as before. An ordinary record under
  the packed name is refused.
- **Packed record accepted:** a valid packed record is accepted.
- **Packed records refused:**
  - no stamp, on the primary or a LOD only;
  - scene 1, `"0"`, `null`, missing, a LOD scene of 2 or 0.5;
  - a LOD naming another file;
  - a single level;
  - the original-derived name, the wrong SHA prefix, or an unhashed name.
- **Graph check refusals:** no adoption, an adoption without the model, an unpacked graph entry,
  another adoption id, an inconsistent packed graph.

## Limits

- Per-LOD geometry (scenes 1..N) is not decoded here; ordinary records never checked LOD geometry
  in this helper either. The r06 verifier proved every scene against its original level.
- Not run: Codex must run at least `node --test tests/runtime-model-identity.test.mjs tests/camp-landform.test.mjs tests/castle.test.mjs tests/landmarks.test.mjs tests/region-features.test.mjs`.
  Before the r06 apply, the camp-landform path stays on the ordinary branch. After the apply, it
  exercises the packed branch against the real record.
