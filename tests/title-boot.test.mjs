import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as typescript from 'typescript';

const ts = typescript.default ?? typescript;
const root = new URL('../', import.meta.url);

/** Served URL → emitted file, as the local server maps them (static-files.mts). */
function fileFor(url) {
  if (url.startsWith('/src/')) return new URL(`dist${url}`, root);
  if (url.startsWith('/shared/')) return new URL(`dist${url}`, root);
  return new URL(`public${url}`, root);
}

const importMap = JSON.parse(
  /<script type="importmap">([\s\S]*?)<\/script>/.exec(
    await readFile(new URL('public/index.html', root), 'utf8'),
  )[1],
).imports;

function resolve(specifier, from) {
  if (/^\.{0,2}\//.test(specifier)) return new URL(specifier, `https://local${from}`).pathname;
  if (importMap[specifier]) return importMap[specifier];
  const prefix = Object.keys(importMap).find(
    (key) => key.endsWith('/') && specifier.startsWith(key),
  );
  return prefix ? importMap[prefix] + specifier.slice(prefix.length) : `bare:${specifier}`;
}

/** Static imports and re-exports only: what the browser must fetch before evaluating. */
async function staticImports(url) {
  const text = await readFile(fileFor(url), 'utf8');
  const source = ts.createSourceFile(url, text, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS);
  const found = [];
  for (const statement of source.statements)
    if (
      (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) &&
      statement.moduleSpecifier &&
      ts.isStringLiteral(statement.moduleSpecifier)
    )
      found.push(resolve(statement.moduleSpecifier.text, url));
  return found;
}

async function closure(entry) {
  const seen = new Set([entry]);
  for (const url of seen) for (const next of await staticImports(url)) seen.add(next);
  return seen;
}

const HEAVY =
  /^\/vendor\/|-data\.mjs$|\/landmark-bounds\.mjs$|\/(world3d|loading-cave|main|verified-asset-cache|embedded-glb)\.js$|\/shared\/(world|paleo-geography|terrain|collision|camp-mountain|friend-mascots)\.mjs$/;

test('the page entry is the title shell, and the shell reaches no 3D or world data', async () => {
  const html = await readFile(new URL('public/index.html', root), 'utf8');
  assert.deepEqual(
    [...html.matchAll(/<script type="module" src="([^"]+)"/g)].map((m) => m[1]),
    ['/src/boot.js'],
  );
  const modules = await closure('/src/boot.js');
  const heavy = [...modules].filter((url) => HEAVY.test(url) || url.startsWith('bare:'));
  assert.deepEqual(heavy, [], `title-shell closure: ${[...modules].join(', ')}`);
  for (const needed of [
    '/src/title-shell.js',
    '/src/title-credits.js',
    '/shared/friend-mascot-roster.mjs',
  ])
    assert.ok(modules.has(needed), needed);
});

test('the boot imports the game once, only dynamically, after the painted title', async () => {
  const boot = await readFile(new URL('dist/src/boot.js', root), 'utf8');
  assert.equal(boot.match(/import\(['"]\.\/main\.js['"]\)/g)?.length, 1);
  assert.doesNotMatch(boot, /^import [^;]*['"]\.\/main\.js['"]/m);
  assert.match(boot, /requestAnimationFrame\(/);
  assert.match(boot, /startupMarks\.page\('title-interactive'\)/);
});

test('the game module still loads directly and owns the same title handoff contract', async () => {
  const modules = await closure('/src/main.js');
  assert.ok(modules.has('/src/title-shell.js'));
  assert.ok(modules.has('/src/startup-marks.js'));
  assert.ok(!modules.has('/src/boot.js'), 'a direct main.js import never renders a shell');
  const shell = await readFile(new URL('dist/src/title-shell.js', root), 'utf8');
  // Importing the shell has no effect until boot renders it.
  const source = ts.createSourceFile(
    'shell',
    shell,
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.JS,
  );
  const effects = source.statements.filter((s) => ts.isExpressionStatement(s));
  assert.deepEqual(effects, []);
});
