# packed-profile-review-r14 — packed levels in the model review page and offline package inventory

Status: **edited, not executed.** The author ran no commands and claims no pass. Codex builds
and tests.

Nothing is adopted. Assets, manifests, `src/world-assets.ts`, `src/world-asset-levels.ts`,
`world3d` and all files owned by publisher587 or runtime026 are untouched. That includes
`scripts/optimization/**`, `scripts/runtime-graph.mjs`, boot, main, title and startup marks.
`scripts/cloudflare-public-build.mjs` was reviewed read-only and not edited. Candidate r06 is
not generated; r04 and r05 are untouched.

## Files

| File | Change |
| --- | --- |
| `src/model-review-levels.ts` (new) | `reviewChoices`, `choiceLevel` and `reviewedModel`: the review menu and scene selection, built on the game's strict `templateLevels`/`packedLevels`. |
| `src/model-review.ts` | Packed selection, owner/shown split, verified download for packed choices, equipment guard, menu built from `reviewChoices`. |
| `scripts/packaged-models.mjs` (new) | `checkPhysicalModels` and `runtimeFiles` (now including scene and parts). |
| `scripts/build-exhibition.mjs` | Uses those helpers; `glbs` counts physical files; adds `glbLevels`. |
| `tests/model-review-packed.test.mjs` (new) | 3 tests on the helper plus 1 test of the actual page module. |
| `tests/packaged-models.test.mjs` (new) | 3 tests. |

## 1. Model review (`src/model-review.ts`)

### Menu

`reviewChoices(record, title)` builds the menu entries for each catalog record.

- **Ordinary record:** exactly the entries as before.
  - Labels are the title, then `<name|modelKey> · LOD i`.
  - Values are the file URLs.
- **Packed record** (one that passes `templateLevels`): one entry per level.
  - Labels are `<title> · scene 0` and `<name> · LOD i · scene i`.
  - Values are `<url>#scene=<i>`.
- **Record the game would refuse:** a single **disabled** entry,
  `<title> · 確認不可: <the game's refusal>`, with an empty value. This covers mixed levels,
  out-of-range, negative, duplicate or non-integer scenes, another file, and actor kinds.
  Nothing falls back to scene 0 or to another file.

### Opening a scene

Selecting a value that carries a fragment (`#scene=…`) works like this:

1. The page waits for the catalog menu to load. This also covers the `?model=` address at
   page load.
2. The page accepts only a value that one of those packed entries names exactly. Any other
   scene address is refused with
   `読込失敗: <value> はカタログのパック済みLODではありません`, before anything is fetched.
3. The bytes come from `downloadVerifiedAsset(record)`, which checks length and SHA-256 and
   handles parts. They do not come from an unchecked fetch.
4. The page parses once with `parseEmbeddedGLB(buffer, name)`. The name is
   `<file> · scene i/N`.
5. `reviewedModel` calls `packedLevels(parse, N, key)[i]`. This checks scene count, default
   scene and distinct roots, and refuses animation, skin, bones and geometry or materials
   shared across levels.

### What the page shows

- Everything shown (clones, bounds, triangles, meshes, clips) comes from that level's scene
  only.
- The model info adds `/ パック済みファイル N シーン中 scene i / 記録 <triangles> triangles`.
  It appends ` — 不一致` when the level record's `triangles` differs from the triangles
  actually counted. This is shown, not refused.
- The MB figure is the whole packed file.

### Ownership

- The page keeps `owner`, the whole parse with every scene, and `model`, what is shown.
- The shown level is replaced only after the new load succeeds. Then `disposeModels([owner])`
  releases every scene of the old parse once.
- A load superseded after its parse releases its whole parse.
- A refused parse releases its whole parse. As before for any failed load, it also releases
  the model shown before, and the page shows nothing.
- An address refused before download leaves the shown model as it is.

### Unchanged paths

- Local file input, ordinary served URLs (plain fetch), rigs, actors, clips, the 5-clone
  layout and equipment for ordinary records are unchanged.
- The literal `parseEmbeddedGLB(buffer, name)` call is still present; the existing test checks
  for it.
- Equipment now calls `requireSeparateLevels(asset, 'equipment')` before loading, as
  `WorldAssets` does. A scene-bearing equipment record shows
  `装備の読込失敗: <key>: equipment templates cannot have packed levels`.

## 2. Offline package (`scripts/build-exhibition.mjs`, both normal and `--local`)

### Model files

- `checkPhysicalModels(root, runtimeGraph)` replaces the per-record loop. It checks each entry
  of `runtimeGraph.physicalModels` once: URL allowlist (`checkModelUrl`), SHA-256 and length on
  disk, and whether the file requires meshopt. It then adds that file to the package.
- `checkRuntimeGraph` already refuses one URL with two identities. The helper additionally
  requires the following, and refuses (never repairs) any mismatch:
  - every logical record in `runtimeGraph.models` is served by a checked physical file with
    its own URL, SHA-256 and length;
  - each physical file's `records` count equals the number of logical records naming it;
  - no physical URL is listed twice.

### Report

- `glbs` is now the number of **unique physical GLB files**.
- `glbLevels` (new) is the number of logical level records.
- `runtimeGraph` is unchanged and still lists every level with its `scene`.
- The console line reads `N GLBs (M model levels)`.

### Own-manifest comparison

`runtimeFiles` now compares, per level, `[url, sha256, bytes, scene ?? null, parts]`, plus
runtime textures. Previously it compared only `[url, sha256, bytes]`. So
`public/models/<key>/asset.json` must agree with `world-assets.json` on scenes and parts too.

### Not changed

- The adopted-graph check, the URL allowlist, the texture checks, the decoder check, the
  manifest digest checks and the retired-literal report.
- The set of packaged files: the same model files, now added once each.
- This edit is not authority to produce or deploy packages.

## 3. `scripts/cloudflare-public-build.mjs` (read-only review)

**Deduplication.**
- `checkRuntimeGraph(assets, …)` runs first, so the build fails if one URL is named with two
  identities.
- The model loop then skips a URL it has already published (`downloads.has(record.url)`), so
  each physical GLB is hashed, published and split once.
- `models` and the report list unique physical downloads.

**Scene preservation.**
- `transform` builds `{ ...lod, ...downloads.get(lod.url) }`. The download carries only `url`,
  `sha256`, `bytes` and, for files over 25 MiB, `parts`, so `scene`, `distanceMetres`,
  `purpose` and `triangles` are kept.
- A split packed file gives every level the same `parts`, so the runtime's identity check
  (`templateLevels`) still accepts it.

**Own manifests.**
- Each own manifest is checked per record against the shipped identity, and with
  `checkRuntimeGraph([source], adoption, …)`.
- For an adopted packed entry, that graph check requires each level's scene. A source
  without the adoption field fails as "not the adopted one". A non-adopted record may not
  carry `scene` at all.
- So a scene mismatch between the catalog and an own manifest cannot ship, even though the
  per-record comparison there does not look at `scene`.

**Verdict:** no further patch is needed for packed levels.

**Observation, not a defect today.** No source record has `parts`. If a source record ever
carried stale `parts` for a file of 25 MiB or less, `transform` would keep them, because the
download adds no `parts` key to override them. A later patch could strip source `parts`
before spreading.

## Tests authored (not run)

```
npm run build
npm run check
npm run format:check
node --test tests/model-review-packed.test.mjs tests/packaged-models.test.mjs tests/model-review.test.mjs tests/packed-world-assets.test.mjs tests/exact-repack.test.mjs tests/exhibition-lan.test.mjs
```

### `tests/model-review-packed.test.mjs`

**Helper tests**
- Ordinary record entries are exactly as before. Packed entries have their labels, values,
  levels and recorded triangles.
- Seven kinds of malformed metadata each give one disabled entry naming the game's refusal:
  missing scene, out-of-range 7, negative, duplicate, 1.5, another SHA-256, quadruped.
- With a real parse in which level L has L+1 triangles, each choice shows exactly
  `scenes[L]` with L+1 triangles. An ordinary choice, or no choice, shows the model itself.
  The record and file disagreeing on level count (4 or 2 levels against 3 scenes) is
  refused, and so is an animated rig.

**Page test** (the actual page module with a packed catalog):
- A `?model=` scene address waits for the menu, then shows scene 1 with 2 triangles, the
  recorded count, and the file's SHA-256, after one download.
- The menu shows the expected entries, including the disabled refusal entry.
- Scene 0 is superseded mid-parse by scene 2:
  - scene 2 shows 3 triangles and the recorded mismatch (99);
  - every geometry and material of the replaced parse (9 resources over 3 scenes) and of
    the superseded parse is disposed exactly once;
  - the shown parse is not disposed, and the image counts are `[0, 1, 1]`.
- `#scene=7` is refused with no fetch, and the shown model is kept.
- A record with 3 levels whose file has 2 scenes: one download, one parse, refused as
  `rock: has 2 scenes for 3 packed levels`, released whole together with the model shown
  before. All four images are closed once.
- An ordinary entry still shows `model.glb / … 1 triangles` with no packed suffix.
- Packed equipment is refused without fetching its GLB.

### `tests/packaged-models.test.mjs`

- An adopted packed `hill` (3 levels, one meshopt file) plus an original `pond` (2 files),
  real files in a temporary directory:
  - 3 physical files listed once each;
  - meshopt detected;
  - the graph keeps 5 logical records with scenes `0, 1, 2, null, null`.
- Failures:
  - a changed packed file gives `Model integrity failed`;
  - a missing LOD file gives `ENOENT`;
  - a records-count mismatch, a record with another length, and a physical URL listed
    twice are each refused.
- `runtimeFiles` is equal for copies and for descriptive differences. It differs for a
  missing scene, swapped levels, a changed scene, a missing level, added parts and an added
  texture.

## Limits

- The page test uses stand-in browser objects, not a GPU. Native review of an actual
  adopted packed file is left to the independent check after a real candidate is adopted.
- The model review page is a development page. It is not packaged by `build-exhibition`
  (only `public/index.html` is added) or published by the Cloudflare build. Both builds do
  copy every `dist/src` module, so `model-review.js` and `model-review-levels.js` ship as
  files no shipped page loads.
- A packed file opened without a scene address (local file input or a plain URL) is reviewed
  as before, as the whole parse with its default scene 0. Exact level review needs the
  catalog entry.
- A triangle mismatch with the record is reported, not refused.
- The build-exhibition script itself was not executed. Its new logic lives in the tested
  helper, and the script wiring was checked only by reading.
