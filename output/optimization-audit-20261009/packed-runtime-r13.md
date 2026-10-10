# packed-runtime-r13 — type-narrowing fix for r12

Status: **edited, not executed.** The author ran no commands and claims no pass. Codex
builds and tests.

## Failure (packed-runtime-build-r12-r01.log)

`npm run build` reported TS2339 `Property 'files' does not exist on type 'TemplateLevels'`
at two places:

- `src/world-asset-levels.ts:92`
- `src/world-assets.ts:298`

`TemplateLevels` is a union discriminated by the boolean literals `packed: true` and
`packed: false`. The build uses `tsconfig.json`, where `strict` is false and therefore
`strictNullChecks` is off. Without `strictNullChecks`, TypeScript does not narrow the
union when the code tests `plan.packed` for truthiness, so `plan.files` stayed
unresolved on the falsy branch.

## Fix

The code now narrows by the property that only one member of the union has. `in`
narrowing works with and without `strictNullChecks`.

- `src/world-asset-levels.ts` (`templateDownloadBytes`):
  `files = 'files' in plan ? plan.files : [plan.file];`
- `src/world-assets.ts` (`loadTemplate`):
  `if ('file' in plan) { …packed… } else for (const record of plan.files) …`

The fix adds no `any`, no casts, and no changes to tsconfig or checks. The
`TemplateLevels` type, including its `packed` flag, is unchanged. Behaviour is
unchanged: the packed member is the only one with `file`, and the ordinary member is
the only one with `files`.

## Unchanged

- Everything else in the r12 contract, including the approved enemy and equipment
  guards.
- The nine tests in `tests/packed-world-assets.test.mjs`.
- All assets and manifests.
