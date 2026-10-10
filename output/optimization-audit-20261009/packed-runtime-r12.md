# packed-runtime-r12 — runtime support for packed multi-scene LOD templates

Status: **implemented, not executed.** The author ran no commands: nothing is built,
type-checked, formatted or tested yet. Codex runs the build/check and the tests, then
native context/cancel/scene QA. **Nothing is adopted.** No manifest, asset, script or
public file changed. No production record has a `scene` field (checked: no `"scene":`
in `public/models/**/*.json`), so every current asset still takes the ordinary path.
This adds runtime support only. It is not a byte saving, not startup progress, and
not completion of the 5 s / 4 MB goal.

## Files

| File | Change |
| --- | --- |
| `src/world-asset-levels.ts` (new) | Pure contract: `templateLevels`, `templateDownloadBytes`, `requireSeparateLevels`, `packedLevels`. |
| `src/world-assets.ts` | `loadTemplate` packed branch; `loadStartup` sizes via `templateDownloadBytes`; one-line refusal guard in `loadEquipmentTemplate` and `loadEnemyTemplate`; doc comment on `environmentLoader`. |
| `tests/packed-world-assets.test.mjs` (new) | 9 focused tests; real `loadVerifiedGLB` → `parseEmbeddedGLB` on synthetic GLBs from `tests/glb-fixtures.mjs`. |

Not touched: `embedded-glb.ts`, `asset-download.ts`, `verified-asset-cache.ts` (the SHA
cache and its 64 MiB limit), `createAnimal`/`cloneSkeleton`, `CharacterAssets`,
`biome-surfaces.ts`, any existing test, and every proof source or result
(`lod-packed-proof-r10*`, run01–run03).

## Exact contract

### Record (catalog JSON, no schema file changed)

An ordinary world-template record gets an optional integer `scene` on the record
itself (level 0) and on each `lods[i]` (level i+1).

- **No `scene` on any level → ordinary.** One verified file per level, loaded in
  order, exactly as before.
- **`scene` on any level → packed.** The record is accepted only if all of these hold:
  1. Every level has `scene`. Otherwise:
     `<key>: <n> of its <m> levels name a scene; a packed template names one for every level`.
  2. `kind` is not `quadruped`, `companion` or `enemy`. Otherwise:
     `<key>: a <kind> cannot have packed levels`.
  3. Each `scene` is an integer. Otherwise:
     `<key>: level <i> names scene <json>, not a scene index`.
  4. No scene is named twice. Otherwise:
     `<key>: levels <a> and <b> both name scene <s>`.
  5. Level i names scene i: primary 0, `lods[k]` k+1. Otherwise:
     `<key>: level <i> names scene <s>; packed level <i> is scene <i>`.
  6. Every level has the same `url`, `sha256`, `bytes` and `parts`, compared as
     `[url, sha256, bytes]` per part, in order. Otherwise:
     `<key>: level <i> is not the file level 0 names (URL, SHA-256, length and parts must agree)`.
- `distanceMetres` and `purpose` on each LOD are kept and used as before:
  `createResource` reads `asset.lods[i].distanceMetres`.
- A packed record with no LODs (scene 0 only) is accepted and requires a one-scene file.
- These checks run with no network access. `loadStartup` runs them while sizing, before
  it requests any model. `ensureEnvironment`/`ensureInitial`/`ensureCompanion` run them
  in `loadTemplate`, before the loader is called. A refusal rejects; there is no
  fallback to scene 0, to separate files or to an older model.
- `loadEnemyTemplate` and `loadEquipmentTemplate` refuse any record with `scene` on any
  level, before the loader is called:
  `<key>: enemy|equipment templates cannot have packed levels`.
  These are the only lines added to actor or equipment loading. Records without
  `scene` load exactly as before.

### Load (`WorldAssets.loadTemplate`, packed branch)

1. **One** `environmentLoader(asset)` call. With the default loader that is one
   `downloadVerifiedAsset`, which keeps its length and SHA-256 checks, its parts and its
   cache unchanged, and one `parseEmbeddedGLB`. Concurrent and repeat requests join or
   reuse it through the existing `joinOrRequest`/`templates` paths.
2. If the provider was disposed meanwhile: `disposeModels([parsed])` releases every
   scene of the file, then the load rejects with `World assets disposed`.
3. `packedLevels(parsed, levels, key)` validates the actual parse before anything is
   published. It refuses:
   - a scene count that is not the level count: `has <n> scenes for <levels> packed levels`;
   - repeated scenes, or a default scene that is not `scenes[0]`:
     `its scenes must be distinct, with scene 0 the default`;
   - any animation: `packed levels cannot be animated`;
   - a scene that is not a root `Object3D`: `scene <i> is not a root scene graph`;
   - any `SkinnedMesh` or `Bone`: `scene <i> is skinned; packed levels are static`;
   - a scene with no object that has geometry: `scene <i> draws nothing`;
   - any geometry or material reachable from two level scenes:
     `scenes <a> and <b> share geometry|a material`. This also catches GLTFLoader
     r185's clone of a node that two scenes share.

   Textures may be shared. On any refusal the **whole parsed model**, all scenes, is
   released by `disposeModels([parsed])`, then the load rejects.
4. Published template: `{ asset, gltf: views[0], lods: views.slice(1) }`, where
   `views[i] = { ...parsed, scene: parsed.scenes[i], scenes: [parsed.scenes[i]] }`.
   - Each view is still a `RuntimeGLTF` (`isRuntimeGLTF: true`, no parser).
   - The views share the file's `animations` (empty), `cameras`, `asset` and `userData`
     by reference.
5. `coalesceTextures(views)` and the shadow-flag pass run exactly as for ordinary
   templates. The cohort is the template's levels, so a Texture GLTFLoader made twice
   for one image (another sampler index) is coalesced only if `textureIdentity` agrees.
6. `releaseEnvironment`, `dispose` and the catch path use the unchanged
   `disposeModels([gltf, ...lods])`. The views cover each scene of the file once, so
   each geometry, material, texture and image is released once.

### Startup bytes

`templateDownloadBytes(record)` is the physical download of one template:
- packed: `record.bytes` once;
- ordinary: `bytes + Σ lods[i].bytes` (each `?? 0`), the same arithmetic as before.

`loadStartup` uses it for both `total` and per-template increments. It is computed per
template and does **not** deduplicate across templates.

## What the tests check (`tests/packed-world-assets.test.mjs`)

1. **Load once, levels from their own scenes.** A real 3-scene meshopt GLB, with
   per-level node `L<i>` at x = 10·i, its own mesh, accessors, material and texture
   entry, and level 2 on a second identical sampler. The test checks:
   - one loader call, one fetch and one `GLTFLoader.parseAsync` for two concurrent
     requests plus one repeat;
   - the parser, its JSON and the GLB body are not reachable from the template;
   - `levels[i].scene === parsed.scenes[i]` and `scenes` is that scene only, with names
     L0/L1/L2 and materials `level 0..2`;
   - 3 distinct geometries; mutating level 1's colour leaves levels 0 and 2 white;
   - one Texture across all levels (level 2's copy coalesced), with WebP identity and
     one decode;
   - `create(key, i)` selects `L<i>` at x = 10·i with that level's geometry, and
     `create(key, 3)` throws;
   - `createResource` gives LOD levels `[0, L0] [18, L1] [60, L2]`;
   - `releaseEnvironment` disposes each of the 6 geometries and materials exactly once
     and closes the image once.
2. **Abort and reacquire with an injected loader.** A request withdrawn while queued
   (both slots held) is cancelled with no loader call and no fetch. A later request
   makes exactly one call. After release, the next request makes one more call.
3. **Provider disposed during the download.** The late parse completes and is released
   whole: each resource once, the image once. The load rejects with
   `World assets disposed` and nothing is kept.
4. **Metadata refused before any request** (10 cases, each through `ensureEnvironment`
   and `loadStartup`): a missing scene on one level, the full model naming scene 1, LODs
   swapped, a scene named twice, a non-integer scene, another URL, another SHA-256,
   another length, parts on one level only, and a packed quadruped. For every case: the
   loader is never called, there is no fetch and no progress report, and nothing is
   kept.
5. **Packed enemy or equipment record** refused with no fetch.
6. **Refused after one parse and released whole** (5 cases): an extra scene, a missing
   scene, default scene 1, levels sharing one mesh, levels sharing one material. For
   every case: one download, one parse, every geometry and material of every scene
   disposed exactly once, every image closed once, nothing kept, queue idle.
7. **Animation and skin refused** using the rig fixture as a 2-level packed static
   record (clip+skin, skin only, clip only). Both images are closed once each time.
8. **Ordinary template unchanged.** Three files fetched in order, the LOD textures
   coalesced into the full model's, images closed `[0,1,1]` then `[1,1,1]`.
9. **Startup bytes.** Packed 3-level `snow` plus ordinary 2-file `stone`:
   - total = `snow.bytes + 2 × stone.bytes`;
   - three reports, ending `[total, total]`;
   - `/snow.glb` fetched once.

## Verifiable limits

- **Not run.** Results come only from Codex's build/check, `format:check`,
  `node --test tests/packed-world-assets.test.mjs`, the existing asset tests
  (`asset-lifecycle`, `environment-loading`, `embedded-glb`, `startup-streaming`,
  `biome-surfaces`, `context-recovery`, `context-release`) and native QA.
- **Node only.** Image decoding is a stand-in. GPU upload, context loss/restore and
  pixels are not exercised. The packed views have not been run through
  `createSurfaceTemplate`, `LandscapeInstances`, the camp-mountain fit, context
  recovery or `model-review`. By reading the code, those read only `model.scene`
  (and context recovery walks each view's fields), but this is unverified.
- **The runtime sees only what GLTFLoader built.** It cannot see JSON nodes, meshes,
  images, cameras or lights that no scene references, or a file's root extensions. The
  packer's r10 refusals must cover those. Unreferenced bytes would still be downloaded
  and counted.
- **Colour space is not checked at runtime.** GLTFLoader r185 gives levels one Texture
  whenever image view and sampler index agree, and sets `colorSpace` on that shared
  Texture. A packed file using one image+sampler in both a colour and a non-colour slot
  is not detected here; the packer's r10 samplerless/colour-space refusal is required.
  Cameras are not refused at runtime either (r10 refuses them).
- **Names.** GLTFLoader names objects uniquely per file, so objects in later scenes may
  be renamed. Every `getObjectByName` in `src/` is on actors, which cannot be packed,
  so no static-template path depends on names (checked by grep, not by test).
- **Peak memory not measured.** A packed template holds its whole file and parse at
  once, where ordinary levels loaded one after another.
- **Out of scope / not owned:** `CharacterAssets` and `model-review` do not understand
  `scene`; `model-review` would list the same URL per level and show scene 0. Neither
  is a world-template path. Generator, graph, adoption and any manifest change belong
  to Publisher587.
- **Progress granularity is unchanged:** one report per completed template.
