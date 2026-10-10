import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { bundleBrowser, bundledIndex } from '../scripts/bundle-browser.mjs';

async function fixture(t, files) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'cro-browser-bundle-'));
  assert.ok(path.relative(os.tmpdir(), directory).startsWith('cro-browser-bundle-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(path.join(directory, 'src'));
  await mkdir(path.join(directory, 'shared'));
  await writeFile(path.join(directory, 'package.json'), '{"type":"module"}');
  for (const [name, contents] of Object.entries(files))
    await writeFile(path.join(directory, name), contents);
  return directory;
}

test('title and dynamic game entry share the same module state after splitting', async (t) => {
  const root = await fixture(t, {
    'src/boot.js':
      "import { increment } from './counter.js'; increment(); export const ready = import('./main.js');",
    'src/main.js':
      "import { increment, count } from './counter.js'; increment(); export { count };",
    'src/counter.js': 'export let count = 0; export function increment() { count++; }',
  });
  const result = await bundleBrowser(root);
  for (const file of result.files) await writeFile(path.join(root, file.name), file.bytes);
  const boot = await import(pathToFileURL(path.join(root, result.record.entry)).href);
  assert.equal((await boot.ready).count, 2, 'a second bundled counter would lose the title update');
  assert.equal(
    result.record.outputs.filter((file) => file.inputs.includes('src/counter.js')).length,
    1,
  );
});

test('runtime visibility and Three stay external while worker URLs retain their /src base', async (t) => {
  const root = await fixture(t, {
    'src/boot.js':
      "import { CHARACTER_MODELS } from '../shared/character-profiles.mjs'; import * as THREE from 'three'; export { CHARACTER_MODELS, THREE }; export const worker = new URL('./river-bank-worker.js', import.meta.url);",
    'shared/character-profiles.mjs': 'export const CHARACTER_MODELS = ["must-not-be-inlined"];',
  });
  const result = await bundleBrowser(root);
  const code = result.files.map((file) => file.bytes.toString('utf8')).join('\n');
  assert.doesNotMatch(code, /must-not-be-inlined/);
  const imports = result.record.outputs.flatMap((file) => file.imports);
  assert.ok(
    imports.some((item) => item.external && item.path === '/shared/character-profiles.mjs'),
  );
  assert.ok(imports.some((item) => item.external && item.path === 'three'));
  assert.match(code, /new URL\(["']\.\/river-bank-worker\.js["'],import\.meta\.url\)/);
  assert.ok(result.files.every((file) => path.posix.dirname(file.name) === 'src'));
});

test('the bundled entry replaces exactly one title script and refuses an ambiguous document', () => {
  const html = Buffer.from('<script type="module" src="/src/boot.js"></script>');
  assert.equal(
    bundledIndex(html).toString(),
    '<script type="module" src="/src/boot-bundle.js"></script>',
  );
  assert.throws(() => bundledIndex(Buffer.from('no entry')));
  assert.throws(() => bundledIndex(Buffer.concat([html, html])));
});
