// Reproduce unrelated failing tests using the unchanged domain and pre-change Node entry.
// A separate output tree prevents writes to the working source or user saves.
import path from 'node:path';
import { mkdir, cp, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';
const root = path.resolve(import.meta.dirname, '..');
const destination = path.join(root, 'output/environments/baseline-20261006');
const tests = [
  'boats-server.test.mjs',
  'boats.test.mjs',
  'hunting.test.mjs',
  'mammoth-ground.test.mjs',
  'maritime-weather.test.mjs',
];
const unchanged = spawnSync(
  'git',
  [
    'diff',
    '--name-only',
    'HEAD',
    '--',
    'shared',
    'application',
    'src/local-prediction.ts',
    ...tests.map((name) => `tests/${name}`),
  ],
  { cwd: root, encoding: 'utf8', windowsHide: true },
);
if (unchanged.status || unchanged.stdout.trim())
  throw new Error('Baseline domain or test sources have changed');
await mkdir(path.join(destination, 'tests'), { recursive: true });
await cp(path.join(root, 'dist'), path.join(destination, 'dist'), { recursive: true });
function original(name) {
  const r = spawnSync('git', ['show', `HEAD:${name}`], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (r.status) throw new Error(`Cannot read baseline ${name}`);
  return r.stdout;
}
const config = JSON.parse(await readFile(path.join(root, 'tsconfig.json'), 'utf8'));
const options = ts.convertCompilerOptionsFromJson(config.compilerOptions, root).options;
await writeFile(
  path.join(destination, 'dist/server.mjs'),
  ts.transpileModule(original('server.mts'), { compilerOptions: options, fileName: 'server.mts' })
    .outputText,
);
await writeFile(path.join(destination, 'server.mjs'), original('server.mjs'));
await writeFile(path.join(destination, 'package.json'), '{"type":"module"}');
for (const name of tests)
  await writeFile(path.join(destination, 'tests', name), original(`tests/${name}`));
const result = spawnSync(process.execPath, ['--test', ...tests.map((name) => `tests/${name}`)], {
  cwd: destination,
  encoding: 'utf8',
  windowsHide: true,
});
await writeFile(path.join(destination, 'test.log'), result.stdout + result.stderr);
const failures = result.stdout.split('\n').filter((line) => line.startsWith('✖ '));
console.log(
  JSON.stringify(
    { status: result.status, failures, log: path.join(destination, 'test.log') },
    null,
    2,
  ),
);
if (result.error) throw result.error;
