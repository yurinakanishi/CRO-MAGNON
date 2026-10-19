import ts from 'typescript';
import { readdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { removeStaleTemporaries, writeFileAtomic, writeFilesAtomic } from './atomic-write.mjs';
import { build as bundle } from 'esbuild';

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
  // The server and tests read dist/ while builds run: every output replaces its file in one
  // rename (atomic-write.mjs) instead of the default host's truncate-and-rewrite. As before,
  // a later program's copy of a shared module is the one written.
  const emitted = new Map();
  for (const program of programs)
    program.emit(undefined, (file, text, writeByteOrderMark) =>
      emitted.set(
        path.resolve(file),
        writeByteOrderMark ? String.fromCharCode(0xfeff) + text : text,
      ),
    );
  await writeFilesAtomic(emitted);
  // Only the browser adapter and application are bundled here. Domain modules
  // still come from this host's filtered /shared tables and world data.
  const solo = await bundle({
    entryPoints: [path.join(root, 'dist/infrastructure/browser/solo-worker.mjs')],
    outfile: path.join(root, 'dist/src/solo-worker.js'),
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    write: false,
    plugins: [
      {
        name: 'solo-shared-modules',
        setup(builder) {
          builder.onResolve({ filter: /^\./ }, (args) => {
            const destination = path.resolve(args.resolveDir, args.path);
            const shared = path.relative(path.join(root, 'dist/shared'), destination);
            if (!shared.startsWith('..') && !path.isAbsolute(shared))
              return { path: `../shared/${shared.split(path.sep).join('/')}`, external: true };
          });
        },
      },
    ],
  });
  await writeFileAtomic(path.join(root, 'dist/src/solo-worker.js'), solo.outputFiles[0].contents);
  // Removed journal and graphics-selector modules must not survive incremental builds or be packaged.
  for (const file of [
    'adventure-ui.js',
    'adventure-ui.js.map',
    'graphics-settings.js',
    'graphics-settings.js.map',
    'cave-preview-label.js',
    'cave-preview-label.js.map',
  ])
    await rm(path.join(root, 'dist/src', file), { force: true });
  // Camp deliveries are retired; never keep their old module in incremental builds.
  for (const file of ['camp-contribution.mjs', 'camp-contribution.mjs.map'])
    await rm(path.join(root, 'dist/shared', file), { force: true });
  // Module workers do not inherit the document's import map. Publish the exact
  // same fitter and Three utility with explicit relative URLs, no second algorithm.
  const workerModules = [
    ['dist/src/source-surface-fit.js', 'dist/src/river-bank-worker-fit.js'],
    [
      'node_modules/three/examples/jsm/utils/BufferGeometryUtils.js',
      'dist/src/river-bank-worker-utils.js',
    ],
  ];
  for (const [source, target] of workerModules) {
    let code = await readFile(path.join(root, source), 'utf8');
    if (!code.includes("from 'three'")) throw new Error(`Missing worker Three import: ${source}`);
    code = code
      .replaceAll("from 'three'", "from '../vendor/three.module.js'")
      .replaceAll(
        "from 'three/addons/utils/BufferGeometryUtils.js'",
        "from './river-bank-worker-utils.js'",
      )
      .replace(/^\/\/# sourceMappingURL=.*$/gm, '');
    await writeFileAtomic(path.join(root, target), code);
  }
  for (const name of await readdir(path.join(root, 'src'))) {
    if (name.endsWith('.css'))
      await writeFileAtomic(
        path.join(root, 'dist/src', name),
        await readFile(path.join(root, 'src', name)),
      );
  }
  for (const directory of new Set([...emitted.keys()].map((file) => path.dirname(file))))
    await removeStaleTemporaries(directory);
  console.log('Built browser, shared domain, application, Node and Cloudflare modules.');
} else console.log('TypeScript checks passed.');
