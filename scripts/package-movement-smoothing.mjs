// Derive a client-only fix from the verified, currently installed exhibition.
// No server, world, model, launcher, dependency or editable setting is replaced.
import { copyFile, mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { verifyExhibition, sha256, buildId } from './exhibition-integrity.mjs';
const root = path.resolve(import.meta.dirname, '..');
const source = path.join(root, 'output/exhibition-a2a0148c');
const target = path.join(root, 'output/exhibition-motion-r01');
const original = await verifyExhibition(source);
const changed = ['dist/src/local-prediction.js', 'dist/src/world3d.js'];
// This narrow patch is only for the original animation API. Later character
// features (such as Downed) require a complete matching exhibition build.
if (
  (await sha256(path.join(root, 'dist/src/character-animation.js'))) !==
  (await sha256(path.join(source, 'dist/src/character-animation.js')))
)
  throw Error('Character animation changed; create a complete exhibition build instead.');
for (const file of changed) {
  const name = path.basename(file, '.js');
  const before = await readFile(
    path.join(root, `output/movement-smoothing/before/${name}.ts`),
    'utf8',
  );
  const emitted = ts
    .transpileModule(before, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
    })
    .outputText.trim();
  const installed = (await readFile(path.join(source, file), 'utf8'))
    .replace(/\/\/# sourceMappingURL=.*$/m, '')
    .trim();
  if (emitted !== installed) throw Error(`Baseline differs: ${file}`);
}
await mkdir(target); // A fresh directory is required; retain every existing build.
const files = [];
let bytes = 0;
for (const file of original.files) {
  const destination = path.join(target, file.path);
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(path.join(changed.includes(file.path) ? root : source, file.path), destination);
  files.push({ path: file.path, sha256: await sha256(destination) });
  bytes += (await stat(destination)).size;
}
await copyFile(path.join(source, 'exhibition.env'), path.join(target, 'exhibition.env'));
bytes += (await stat(path.join(target, 'exhibition.env'))).size;
const manifest = {
  ...original,
  buildId: buildId(files),
  builtAt: new Date().toISOString(),
  files,
  bytes,
};
await writeFile(path.join(target, 'exhibition-build.json'), JSON.stringify(manifest, null, 2));
await verifyExhibition(target);
const result = {
  source,
  target,
  originalBuildId: original.buildId,
  buildId: manifest.buildId,
  files: files.length,
  glbs: original.glbs,
  changed: files.filter((f) => changed.includes(f.path)),
};
await writeFile(
  path.join(root, 'output/movement-smoothing/package.json'),
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify(result, null, 2));
