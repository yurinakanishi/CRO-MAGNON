// Exercise the nine-bot domain before delivery without changing the live dist/.
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const out = 'output/shape-bots-core';
await mkdir(out, { recursive: true });
execFileSync(
  process.execPath,
  ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json', '--outDir', `${out}/dist`],
  { stdio: 'inherit', windowsHide: true },
);
let source = await readFile('tests/orb-bots.test.mjs', 'utf8');
source = source.replaceAll("'../dist/", "'./dist/");
for (const [from, to] of [
  ['../scripts/motion-glb.mjs', 'scripts/motion-glb.mjs'],
  ['./delivered-model.mjs', 'tests/delivered-model.mjs'],
]) {
  source = source.replace(`'${from}'`, JSON.stringify(pathToFileURL(path.resolve(to)).href));
}
await writeFile(`${out}/orb-bots.test.mjs`, source);
execFileSync(process.execPath, ['--test', `${out}/orb-bots.test.mjs`], {
  stdio: 'inherit',
  windowsHide: true,
});
