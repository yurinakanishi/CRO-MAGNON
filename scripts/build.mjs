import ts from 'typescript';
import { mkdir, readdir, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const checkOnly = process.argv.includes('--check');
let failed = false;
const programs = [];
for (const configName of ['tsconfig.json', 'tsconfig.cloudflare.json', 'tsconfig.strict.json']) {
  const configPath = path.join(root, configName);
  const source = ts.readConfigFile(configPath, ts.sys.readFile);
  const config = ts.parseJsonConfigFileContent(source.config, ts.sys, root);
  const program = ts.createProgram(config.fileNames, {
    ...config.options,
    ...(checkOnly ? { noEmit: true } : {}),
  });
  const diagnostics = [source.error, ...config.errors, ...ts.getPreEmitDiagnostics(program)].filter(
    Boolean,
  );
  if (diagnostics.length) {
    console.error(
      ts.formatDiagnosticsWithColorAndContext(diagnostics, {
        getCanonicalFileName: (file) => file,
        getCurrentDirectory: () => root,
        getNewLine: () => '\n',
      }),
    );
    failed = true;
  } else programs.push(program);
}
if (failed) process.exitCode = 1;
else if (!checkOnly) {
  for (const program of programs) program.emit();
  await mkdir(path.join(root, 'dist/src'), { recursive: true });
  for (const name of await readdir(path.join(root, 'src'))) {
    if (name.endsWith('.css'))
      await copyFile(path.join(root, 'src', name), path.join(root, 'dist/src', name));
  }
  console.log('Built browser, shared domain, application, Node and Cloudflare modules.');
} else console.log('TypeScript checks passed.');
