// Bundle only a build's already-filtered browser modules. Worker URLs stay beside
// the emitted chunks in /src; Three still uses the one verified import-map copy.
import assert from 'node:assert/strict';
import path from 'node:path';
import { build, version } from 'esbuild';

export async function bundleBrowser(directory) {
  const root = path.resolve(directory);
  const profiles = path.join(root, 'shared/character-profiles.mjs');
  const result = await build({
    absWorkingDir: root,
    entryPoints: ['src/boot.js'],
    outdir: 'src',
    entryNames: '[name]-bundle',
    chunkNames: 'runtime-[name]-[hash]',
    bundle: true,
    splitting: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    write: false,
    metafile: true,
    sourcemap: false,
    minifyWhitespace: true,
    minifySyntax: true,
    plugins: [
      {
        name: 'runtime-character-visibility',
        setup(builder) {
          builder.onResolve({ filter: /^(?:three(?:\/|$)|\.)/ }, (args) => {
            if (args.path === 'three' || args.path.startsWith('three/'))
              return { path: args.path, external: true };
            // The local server filters this table at request time. Inlining it
            // would reveal characters the user hid in local-visibility.json.
            if (path.resolve(args.resolveDir, args.path) === profiles)
              return { path: '/shared/character-profiles.mjs', external: true };
          });
        },
      },
    ],
  });
  const files = result.outputFiles.map((file) => {
    const name = path.relative(root, file.path).split(path.sep).join('/');
    assert.match(name, /^src\/(?:boot-bundle|runtime-[A-Za-z0-9_-]+)\.js$/);
    return { name, bytes: Buffer.from(file.contents) };
  });
  assert.ok(files.some((file) => file.name === 'src/boot-bundle.js'));
  assert.ok(!Object.hasOwn(result.metafile.inputs, 'shared/character-profiles.mjs'));
  return {
    files,
    record: {
      tool: `esbuild ${version}`,
      entry: 'src/boot-bundle.js',
      inputs: Object.keys(result.metafile.inputs).length,
      outputs: Object.entries(result.metafile.outputs).map(([name, value]) => ({
        name,
        bytes: value.bytes,
        inputs: Object.keys(value.inputs),
        imports: value.imports,
      })),
    },
  };
}

export function bundledIndex(bytes) {
  const source = bytes.toString('utf8');
  assert.equal(source.split('/src/boot.js').length, 2, 'Expected one existing browser entry');
  return Buffer.from(source.replace('/src/boot.js', '/src/boot-bundle.js'));
}
